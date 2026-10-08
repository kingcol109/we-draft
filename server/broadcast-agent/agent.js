#!/usr/bin/env node
// server/broadcast-agent/agent.js
//
// Runs on the worker VM (systemd, see README.md). Every POLL_SEC it:
//   1. lists its broadcast worker containers (docker ps, label wedraft.role)
//   2. reports them to the control plane (api/broadcast-agent.js)
//   3. gets back the workers that should be running, and makes it so:
//      launches missing ones (the existing worker image, OUTPUT_MODE=youtube,
//      /broadcast/<game>?mode=stream), restarts crashed ones with backoff,
//      stops ones that are no longer wanted (docker stop -t 30 → the worker's
//      clean SIGTERM shutdown).
//
// Safety:
//   - Each worker gets --duration up to its hard deadline, and the agent also
//     stops anything past its deadline itself — so even if the control plane
//     is unreachable, nothing streams past the failsafe.
//   - If the control plane can't be reached, running workers are left alone
//     (a network blip never ends a live game) until their deadline.
//   - Exit 2 (bad settings) is never restarted — it's reported.
//   - Stream keys: only the key FILE for the slot is mounted read-only into
//     the container; the agent never reads, sends or logs a key. The agent
//     token is read from a file and only ever sent in the Authorization header.
//   - docker is always called with an argument array (no shell), and every
//     id / game / slot from the control plane is validated first.
//   - DRY_RUN=1 logs what it would do without touching Docker.
//
// No npm dependencies (Node 18+ for fetch).

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const VERSION = "1.0.0";
const HOME = os.homedir();
const env = process.env;
const CFG = {
  url: env.AGENT_URL || "https://we-draft.com/api/broadcast-agent",
  tokenFile: env.AGENT_TOKEN_FILE || path.join(HOME, ".we-draft", "agent-token"),
  streamUrl: env.YOUTUBE_STREAM_URL || "",
  keyDir: env.KEY_DIR || path.join(HOME, ".we-draft"),
  image: env.WORKER_IMAGE || "we-draft-broadcast-worker",
  base: env.BASE_URL || "https://we-draft.com",
  outDir: env.OUT_DIR || path.join(HOME, "we-draft-out"),
  pollSec: Math.max(5, Number(env.POLL_SEC) || 10),
  maxWorkers: Math.max(1, Number(env.MAX_WORKERS) || 2),
  dryRun: env.DRY_RUN === "1",
  lockFile: env.LOCK_FILE || path.join(HOME, ".we-draft", "agent.pid"),
  defaultRuntimeSec: 6 * 3600,
};

const ID_RE = /^[A-Za-z0-9]{1,40}$/;
const GAME_RE = /^([a-z0-9][a-z0-9-]{0,119}|\d{1,20})$/;
const LABEL = "wedraft.role=broadcast-worker";
const nameOf = (id) => `wd-bc-${id}`;
const keyFile = (dir, slot) => path.join(dir, slot === 0 ? "youtube-key" : `youtube-key-${slot}`);
const log = (m) => console.log(`${new Date().toISOString()} agent ${m}`);

function validDesired(list) {
  return (Array.isArray(list) ? list : []).filter((d) =>
    ID_RE.test(String(d?.id || "")) && GAME_RE.test(String(d?.game || "")) && Number.isInteger(d.slot) && d.slot >= 0 && d.slot < 10
    && (d.deadlineAt == null || Number.isFinite(d.deadlineAt)));
}

// ── Docker ──

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 60e3, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
  });
}

function realDocker(cfg) {
  const docker = (args) => (cfg.dryRun ? (log(`[dry-run] docker ${args.filter((a) => !a.includes("youtube-key")).join(" ")}`), { code: 0, stdout: "", stderr: "" }) : run("docker", args));
  return {
    async list() {
      if (cfg.dryRun) return [];
      const r = await run("docker", ["ps", "-a", "--filter", `label=${LABEL}`, "--format", "{{json .}}"]);
      if (r.code) throw new Error(`docker ps failed: ${r.stderr.trim().slice(0, 200)}`);
      return r.stdout.split("\n").filter(Boolean).map((line) => {
        const j = JSON.parse(line);
        const labels = Object.fromEntries(String(j.Labels || "").split(",").map((kv) => kv.split("=")));
        const exit = /Exited \((\d+)\)/.exec(j.Status || "");
        return { id: labels["wedraft.id"], slot: Number(labels["wedraft.slot"]), state: j.State, exitCode: exit ? Number(exit[1]) : null };
      }).filter((c) => ID_RE.test(c.id || ""));
    },
    async hasImage() {
      if (cfg.dryRun) return true;
      return (await run("docker", ["image", "inspect", cfg.image])).code === 0;
    },
    async start(d, durationSec) {
      await docker(["rm", "-f", nameOf(d.id)]);
      const r = await docker([
        "run", "-d", "--name", nameOf(d.id),
        "--label", LABEL, "--label", `wedraft.id=${d.id}`, "--label", `wedraft.slot=${d.slot}`,
        "-e", "OUTPUT_MODE=youtube",
        "-e", `YOUTUBE_STREAM_URL=${cfg.streamUrl}`,
        "-e", "YOUTUBE_STREAM_KEY_FILE=/run/secrets/youtube-key",
        "-v", `${keyFile(cfg.keyDir, d.slot)}:/run/secrets/youtube-key:ro`,
        "-v", `${cfg.outDir}:/out`,
        cfg.image,
        "node", "worker.js", "--game", d.game, "--base", cfg.base, "--duration", String(durationSec),
      ]);
      if (r.code) throw new Error(`docker run failed: ${r.stderr.trim().slice(0, 200)}`);
    },
    async stop(id) {
      await docker(["stop", "-t", "30", nameOf(id)]);
      await docker(["rm", "-f", nameOf(id)]);
    },
    async remove(id) {
      await docker(["rm", "-f", nameOf(id)]);
    },
  };
}

// ── Reconcile ──
//
// state: { restarts: Map(id → { count, nextAt }), errors: Map(id → code) }
// Returns the list of things it did (for logs and tests).

const backoff = (n) => Math.min(120e3, 10e3 * 2 ** Math.max(0, n - 1));

async function reconcile(desiredIn, containers, now, cfg, docker, state, fs_ = fs) {
  const did = [];
  // Past its deadline = not wanted, whatever the control plane last said.
  const desired = new Map(validDesired(desiredIn).filter((d) => !d.deadlineAt || d.deadlineAt > now).map((d) => [d.id, d]));
  const have = new Map(containers.map((c) => [c.id, c]));

  for (const c of containers) {
    if (desired.has(c.id)) continue;
    if (["running", "restarting", "created", "paused"].includes(c.state)) {
      await docker.stop(c.id);
      did.push(`stop ${c.id}`);
    } else {
      await docker.remove(c.id);
      did.push(`remove ${c.id}`);
    }
    state.restarts.delete(c.id);
    state.errors.delete(c.id);
  }

  let running = containers.filter((c) => c.state === "running" && desired.has(c.id)).length;
  for (const d of desired.values()) {
    const c = have.get(d.id);
    if (c?.state === "running" || c?.state === "restarting" || c?.state === "created") continue;
    if (c?.state === "exited" && c.exitCode === 2) continue; // bad settings: restarting won't help — reported instead
    const r = state.restarts.get(d.id) || { count: 0, nextAt: 0 };
    if (c && now < r.nextAt) continue; // crashed: wait out the backoff
    if (running >= cfg.maxWorkers) { did.push(`skip ${d.id} (at MAX_WORKERS ${cfg.maxWorkers})`); continue; }
    if (!fs_.existsSync(keyFile(cfg.keyDir, d.slot))) { state.errors.set(d.id, "no-key"); did.push(`no key for slot ${d.slot}`); continue; }
    if (!(await docker.hasImage())) { state.errors.set(d.id, "no-image"); did.push("no image"); continue; }
    const durationSec = Math.max(60, Math.floor(((d.deadlineAt || now + cfg.defaultRuntimeSec * 1000) - now) / 1000));
    try {
      await docker.start(d, durationSec);
      state.errors.delete(d.id);
      if (c) state.restarts.set(d.id, { count: r.count + 1, nextAt: now + backoff(r.count + 1) });
      else state.restarts.set(d.id, { count: 0, nextAt: 0 });
      running++;
      did.push(`${c ? "restart" : "start"} ${d.id} game=${d.game} slot=${d.slot} duration=${durationSec}s`);
    } catch (e) {
      state.errors.set(d.id, "launch-failed");
      did.push(`launch failed ${d.id}: ${e.message}`);
    }
  }
  return did;
}

// What goes to the control plane: real containers, plus desired ones that
// couldn't launch (with why).
function report(containers, desired, state) {
  const out = containers.map((c) => ({ id: c.id, slot: c.slot, state: c.state, exitCode: c.exitCode, restarts: state.restarts.get(c.id)?.count || 0 }));
  for (const d of validDesired(desired)) {
    if (!containers.some((c) => c.id === d.id) && state.errors.has(d.id)) out.push({ id: d.id, slot: d.slot, state: "missing", error: state.errors.get(d.id) });
  }
  return out;
}

// One agent per VM: a second copy (a manual `node agent.js` while the
// service runs) would fight the first over the same containers.
function singleInstance(file, fs_ = fs, kill = process.kill.bind(process), pid = process.pid) {
  try {
    const other = Number(fs_.readFileSync(file, "utf8"));
    if (other && other !== pid) {
      try { kill(other, 0); return false; } catch (e) { if (e.code === "EPERM") return false; /* ESRCH: stale lock */ }
    }
  } catch { /* no lock file yet */ }
  fs_.writeFileSync(file, String(pid));
  return true;
}

async function main() {
  if (!singleInstance(CFG.lockFile)) { console.error(`agent: another agent is already running (${CFG.lockFile}).`); process.exit(2); }
  let token;
  try { token = fs.readFileSync(CFG.tokenFile, "utf8").trim(); } catch (e) { console.error(`agent: can't read AGENT_TOKEN_FILE (${e.code}).`); process.exit(2); }
  if (token.length < 32) { console.error("agent: the agent token must be 32+ characters."); process.exit(2); }
  if (!/^rtmps?:\/\/[^/\s]+\/\S*$/i.test(CFG.streamUrl)) { console.error("agent: YOUTUBE_STREAM_URL must be the rtmp(s):// ingest URL."); process.exit(2); }
  const docker = realDocker(CFG);
  const state = { restarts: new Map(), errors: new Map() };
  let desired = [];
  let lastOk = 0;
  log(`v${VERSION} polling ${CFG.url} every ${CFG.pollSec}s${CFG.dryRun ? " (DRY RUN)" : ""}`);
  for (;;) {
    try {
      const containers = await docker.list();
      try {
        const r = await fetch(CFG.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            containers: report(containers, desired, state),
            host: { version: VERSION, load1: os.loadavg()[0], memFreeMb: Math.round(os.freemem() / 1048576), cpus: os.cpus().length },
          }),
          signal: AbortSignal.timeout(10e3),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        desired = validDesired((await r.json()).desired);
        lastOk = Date.now();
      } catch (e) {
        // Keep the last answer: running games keep running until their deadline.
        log(`control plane unreachable (${e.message}) — keeping current workers${lastOk ? `, last contact ${Math.round((Date.now() - lastOk) / 1000)}s ago` : ""}`);
      }
      for (const line of await reconcile(desired, containers, Date.now(), CFG, docker, state)) log(line);
    } catch (e) {
      log(`error: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, CFG.pollSec * 1000));
  }
}

if (require.main === module) main();

module.exports = { reconcile, report, validDesired, keyFile, backoff, nameOf, singleInstance, VERSION };
