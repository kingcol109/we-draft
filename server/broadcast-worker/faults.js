#!/usr/bin/env node
// server/broadcast-worker/faults.js
//
// Health/restart behavior: start the worker, break one thing, and check it
// exits with the code a supervisor needs — and leaves nothing behind.
//
//   chromium-killed  Chromium's browser process SIGKILLed     → exit 1
//   renderer-crash   the page's renderer SIGKILLed            → exit 1
//   ffmpeg-killed    FFmpeg SIGKILLed                         → exit 1
//   page-frozen      the renderer SIGSTOPped (hung page)      → exit 1 within ~30s
//   sigterm          SIGTERM to the worker (docker stop)      → exit 0, file finished
//   sigint           SIGINT to the worker (Ctrl+C)            → exit 130, file finished
//
// After each: FFmpeg and every Playwright Chromium are gone, and the output
// decodes. page-frozen, sigterm and sigint need POSIX signals (Linux/macOS,
// i.e. the container); on Windows they're skipped.
//
//   node faults.js [--only sigterm,ffmpeg-killed] [--game <slug>] [--base <url>]
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { parseFlags, outputDir } = require("./config");
const { ffmpegPath } = require("./encoder");
const procStats = require("./procStats");

const f = parseFlags(process.argv.slice(2));
const GAME = f.game || process.env.GAME_ID || "clemson-vs-lsu-9-5-2026";
const BASE = f.base || process.env.BASE_URL || "http://localhost:3000";
const DIR = path.join(outputDir(), "faults");
const POSIX = process.platform !== "win32";
const RUN_BEFORE_FAULT_MS = 10000;
const EXIT_TIMEOUT_MS = 90000;

const SCENARIOS = [
  { name: "chromium-killed", expect: 1, inject: (p) => kill(p.chromium.find((c) => c.type === "browser")?.pid, "SIGKILL") },
  // Every renderer: Chromium keeps a spare one, and nothing maps the page to its pid.
  { name: "renderer-crash", expect: 1, inject: (p) => renderers(p).map((pid) => kill(pid, "SIGKILL")).join(", ") },
  // FFmpeg killed mid-write leaves a cut-off last fragment; what came before must still play.
  { name: "ffmpeg-killed", expect: 1, truncatedOk: true, inject: (p) => kill(p.ffmpeg, "SIGKILL") },
  { name: "page-frozen", expect: 1, posix: true, maxSec: 50, inject: (p) => renderers(p).map((pid) => kill(pid, "SIGSTOP")).join(", ") },
  { name: "sigterm", expect: 0, posix: true, maxSec: 15, inject: (p) => kill(p.worker, "SIGTERM") },
  { name: "sigint", expect: 130, posix: true, maxSec: 15, inject: (p) => kill(p.worker, "SIGINT") },
];

function renderers(p) {
  const list = p.chromium.filter((c) => c.type === "renderer").map((c) => c.pid);
  if (!list.length) throw new Error("no renderer pids");
  return list;
}

function kill(pid, sig) {
  if (!pid) throw new Error(`no pid to send ${sig} to`);
  process.kill(pid, sig);
  return `${sig} → ${pid}`;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function decodes(file) {
  return new Promise((resolve) => {
    if (!fs.existsSync(file)) return resolve({ ok: false, frames: 0, err: "no file" });
    execFile(ffmpegPath(), ["-hide_banner", "-v", "error", "-progress", "pipe:1", "-i", file, "-f", "null", "-"],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        const frames = Number([...String(stdout).matchAll(/^frame=(\d+)/gm)].pop()?.[1] || 0);
        resolve({ ok: !err && !String(stderr).trim() && frames > 0, frames, err: String(stderr).trim().split("\n")[0] });
      });
  });
}

async function runScenario(s) {
  const out = path.join(DIR, `${s.name}.mp4`);
  fs.rmSync(out, { force: true });
  const proc = spawn(process.execPath, [path.join(__dirname, "worker.js"), "--mode", "file", "--game", GAME, "--base", BASE, "--replay", "4", "--stats", "5", "--out", out],
    { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  const onData = (d) => { log += d; };
  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);
  const exited = new Promise((r) => proc.on("exit", (code, signal) => r({ code, signal })));

  // Wait for the pids line + "encoding", then let it run a bit.
  const t0 = Date.now();
  while (!/\] encoding\b/.test(log) && Date.now() - t0 < 120000 && proc.exitCode == null) await wait(250);
  const pids = JSON.parse((/ pids (\{.*\})/.exec(log) || [, "null"])[1]);
  if (!pids) {
    proc.kill("SIGKILL");
    return { name: s.name, ok: false, detail: "worker never started encoding", log };
  }
  await wait(RUN_BEFORE_FAULT_MS);

  const injected = s.inject(pids);
  const tFault = Date.now();
  const r = await Promise.race([exited, wait(EXIT_TIMEOUT_MS).then(() => null)]);
  if (!r) proc.kill("SIGKILL");
  const sec = (Date.now() - tFault) / 1000;

  await wait(2000); // let orphaned children finish dying
  const ffmpegLeft = await procStats.alive([pids.ffmpeg]);
  const chromiumLeft = await procStats.playwrightChromium();
  for (const pid of chromiumLeft) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } } // don't poison the next scenario
  const file = await decodes(out);

  const problems = [];
  if (!r) problems.push(`didn't exit within ${EXIT_TIMEOUT_MS / 1000}s`);
  else if (r.code !== s.expect) problems.push(`exit ${r.code ?? r.signal}, expected ${s.expect}`);
  if (s.maxSec && sec > s.maxSec) problems.push(`took ${sec.toFixed(1)}s (max ${s.maxSec}s)`);
  if (ffmpegLeft.length) problems.push("FFmpeg still running");
  if (chromiumLeft.length) problems.push(`${chromiumLeft.length} Chromium process(es) left`);
  if (s.truncatedOk ? file.frames === 0 : !file.ok) problems.push(`output doesn't decode cleanly (${file.err || `${file.frames} frames`})`);
  const reason = (/stopping: (.*)/.exec(log) || [, "?"])[1];
  return {
    name: s.name, ok: problems.length === 0,
    detail: `${injected}; exit ${r ? r.code ?? r.signal : "timeout"} after ${sec.toFixed(1)}s ("${reason}"); ${file.frames} frames playable`
      + (problems.length ? ` — ${problems.join("; ")}` : ""),
    log,
  };
}

async function main() {
  try {
    const r = await fetch(BASE, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error(`The site isn't reachable at ${BASE} (${e.message}). Start it first: npm start`);
    process.exit(2);
  }
  fs.mkdirSync(DIR, { recursive: true });
  const only = f.only ? new Set(f.only.split(",")) : null;
  const results = [];
  for (const s of SCENARIOS) {
    if (only && !only.has(s.name)) continue;
    if (s.posix && !POSIX) { console.log(`SKIP  ${s.name} — needs POSIX signals (run in the container)`); continue; }
    process.stdout.write(`....  ${s.name}\r`);
    const r = await runScenario(s);
    results.push(r);
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${s.name} — ${r.detail}`);
    fs.writeFileSync(path.join(DIR, `${s.name}.log`), r.log);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? `FAILED (${failed.length} of ${results.length})` : `ALL ${results.length} SCENARIOS PASSED`} — worker logs in ${DIR}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
