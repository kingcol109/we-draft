// server/broadcast-agent/agent-docker.test.js — the agent's Docker layer:
// DRY_RUN must never run anything, and rehearsals never stream. The runner
// is a spy; no process is started.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { realDocker, reconcile, report } = require("./agent");

const logs = [];
const realLog = console.log;
console.log = (...a) => logs.push(a.join(" "));

const cfg = (dryRun) => ({ dryRun, image: "we-draft-broadcast-worker", streamUrl: "rtmps://a.rtmps.youtube.com/live2", keyDir: "/home/wd/.we-draft", base: "https://we-draft.com", outDir: "/home/wd/out", maxWorkers: 2, defaultRuntimeSec: 3600 });
const spy = () => {
  const calls = [];
  const runner = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: "", stderr: "" }; };
  return { calls, runner };
};
const d = (id, extra = {}) => ({ id, game: "clemson-vs-lsu", slot: 0, deadlineAt: Date.now() + 3600e3, ...extra });

test("DRY_RUN never runs a command, and simulates containers for the lifecycle", async () => {
  const s = spy();
  const docker = realDocker(cfg(true), s.runner);
  assert.deepEqual(await docker.list(), []);
  assert.equal(await docker.hasImage(), true);
  await docker.start(d("r1", { rehearsal: true }), 600);
  assert.deepEqual(await docker.list(), [{ id: "r1", slot: 0, state: "running", exitCode: null, simulated: true }]);
  await docker.stop("r1");
  await docker.start(d("g2"), 600);
  await docker.remove("g2");
  assert.deepEqual(await docker.list(), []);
  assert.deepEqual(s.calls, [], "no docker (or any) command was executed");
  assert.ok(logs.some((l) => l.includes("[dry-run] docker run")), "logs what it would run");
  assert.ok(!logs.some((l) => l.includes("youtube-key")), "the key file mount isn't logged");
});

test("real mode calls docker with an argument list (no shell) and the slot's key file", async () => {
  const s = spy();
  const docker = realDocker(cfg(false), s.runner);
  await docker.start(d("g1", { slot: 1 }), 900);
  const run = s.calls.find((c) => c[1] === "run");
  assert.equal(run[0], "docker");
  assert.ok(run.includes("--game") && run[run.indexOf("--game") + 1] === "clemson-vs-lsu");
  assert.ok(run.includes("/home/wd/.we-draft/youtube-key-1:/run/secrets/youtube-key:ro") || run.some((a) => /youtube-key-1:\/run\/secrets\/youtube-key:ro$/.test(a)));
  assert.equal(run[run.indexOf("--duration") + 1], "900");
});

test("a real (non-DRY_RUN) agent refuses a rehearsal worker and reports why", async () => {
  const s = spy();
  const docker = realDocker(cfg(false), s.runner);
  const state = { restarts: new Map(), errors: new Map() };
  const did = await reconcile([d("r1", { rehearsal: true })], [], Date.now(), cfg(false), docker, state, { existsSync: () => true });
  assert.match(did.join(), /refused rehearsal r1/);
  assert.ok(!s.calls.some((c) => c[1] === "run"), "never launched");
  assert.deepEqual(report([], [d("r1", { rehearsal: true })], state), [{ id: "r1", slot: 0, state: "missing", error: "rehearsal-needs-dry-run" }]);
});

test("a DRY_RUN agent runs a rehearsal (simulated) without needing a key file", async () => {
  const s = spy();
  const docker = realDocker(cfg(true), s.runner);
  const state = { restarts: new Map(), errors: new Map() };
  await reconcile([d("r1", { rehearsal: true })], [], Date.now(), cfg(true), docker, state, { existsSync: () => false });
  const list = await docker.list();
  assert.equal(list[0].state, "running");
  assert.deepEqual(report(list, [], state)[0].simulated, true);
  assert.deepEqual(s.calls, []);
  console.log = realLog;
});
