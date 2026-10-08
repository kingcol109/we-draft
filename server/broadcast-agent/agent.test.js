// server/broadcast-agent/agent.test.js — the VM agent's reconcile loop with
// a fake Docker. Nothing is launched.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { reconcile, report, validDesired, keyFile, backoff, singleInstance } = require("./agent");

const NOW = 1_800_000_000_000;
const cfg = { maxWorkers: 2, keyDir: "/home/wd/.we-draft", defaultRuntimeSec: 6 * 3600 };
const fs = { existsSync: () => true };

function fakeDocker({ image = true } = {}) {
  const calls = [];
  return {
    calls,
    hasImage: async () => image,
    start: async (d, sec) => calls.push(["start", d.id, d.game, d.slot, sec]),
    stop: async (id) => calls.push(["stop", id]),
    remove: async (id) => calls.push(["remove", id]),
  };
}
const fresh = () => ({ restarts: new Map(), errors: new Map() });
const want = (id, extra = {}) => ({ id, game: "clemson-vs-lsu", slot: 0, deadlineAt: NOW + 3600e3, ...extra });

test("starts a wanted worker with --duration up to its deadline", async () => {
  const d = fakeDocker();
  await reconcile([want("g1")], [], NOW, cfg, d, fresh(), fs);
  assert.deepEqual(d.calls, [["start", "g1", "clemson-vs-lsu", 0, 3600]]);
});

test("leaves a running wanted worker alone; stops an unwanted one", async () => {
  const d = fakeDocker();
  await reconcile([want("g1")], [{ id: "g1", state: "running" }, { id: "g2", state: "running" }, { id: "g3", state: "exited", exitCode: 0 }], NOW, cfg, d, fresh(), fs);
  assert.deepEqual(d.calls, [["stop", "g2"], ["remove", "g3"]]);
});

test("stops a worker past its deadline even if the control plane still wants it", async () => {
  const d = fakeDocker();
  await reconcile([want("g1", { deadlineAt: NOW - 1 })], [{ id: "g1", state: "running" }], NOW, cfg, d, fresh(), fs);
  assert.deepEqual(d.calls, [["stop", "g1"]]);
});

test("restarts a crashed worker with backoff; never restarts exit 2", async () => {
  const st = fresh();
  let d = fakeDocker();
  await reconcile([want("g1")], [], NOW, cfg, d, st, fs);
  d = fakeDocker();
  await reconcile([want("g1")], [{ id: "g1", state: "exited", exitCode: 1 }], NOW + 1000, cfg, d, st, fs);
  assert.equal(d.calls[0][0], "start");
  d = fakeDocker();
  await reconcile([want("g1")], [{ id: "g1", state: "exited", exitCode: 1 }], NOW + 2000, cfg, d, st, fs);
  assert.deepEqual(d.calls, [], "waits out the backoff");
  d = fakeDocker();
  await reconcile([want("g1")], [{ id: "g1", state: "exited", exitCode: 1 }], NOW + 1000 + backoff(1), cfg, d, st, fs);
  assert.equal(d.calls[0][0], "start");
  d = fakeDocker();
  await reconcile([want("g1")], [{ id: "g1", state: "exited", exitCode: 2 }], NOW + 30 * 60e3, cfg, d, st, fs);
  assert.deepEqual(d.calls, []);
});

test("respects MAX_WORKERS", async () => {
  const d = fakeDocker();
  await reconcile([want("g1"), want("g2", { slot: 1 }), want("g3", { slot: 2 })], [], NOW, cfg, d, fresh(), fs);
  assert.equal(d.calls.filter((c) => c[0] === "start").length, 2);
});

test("missing key file or image → reported, not launched", async () => {
  const st = fresh();
  let d = fakeDocker();
  await reconcile([want("g1", { slot: 1 })], [], NOW, cfg, d, st, { existsSync: (p) => p !== keyFile(cfg.keyDir, 1) });
  assert.deepEqual(d.calls, []);
  assert.deepEqual(report([], [want("g1", { slot: 1 })], st), [{ id: "g1", slot: 1, state: "missing", error: "no-key" }]);
  d = fakeDocker({ image: false });
  await reconcile([want("g2")], [], NOW, cfg, d, st, fs);
  assert.equal(st.errors.get("g2"), "no-image");
});

test("an unreachable control plane keeps the last desired list (live games keep running)", async () => {
  const d = fakeDocker();
  // main() reuses the last answer on a failed poll — same list in, nothing stopped.
  await reconcile([want("g1")], [{ id: "g1", state: "running" }], NOW, cfg, d, fresh(), fs);
  assert.deepEqual(d.calls, []);
});

test("rejects anything from the control plane that could reach a shell or path", () => {
  const bad = [
    { id: "g1; rm -rf /", game: "a", slot: 0 },
    { id: "g1", game: "../../etc", slot: 0 },
    { id: "g1", game: "a b", slot: 0 },
    { id: "g1", game: "--url=http://evil", slot: 0 },
    { id: "g1", game: "a", slot: -1 },
    { id: "g1", game: "a", slot: "0" },
  ];
  assert.deepEqual(validDesired(bad), []);
  assert.deepEqual(validDesired([{ id: "g401001", game: "401001", slot: 0 }]).length, 1);
});

test("slot key files: slot 0 is the existing youtube-key", () => {
  assert.match(keyFile("/k", 0), /youtube-key$/);
  assert.match(keyFile("/k", 2), /youtube-key-2$/);
});

test("only one agent runs per VM (pid lock; stale locks are taken over)", () => {
  const files = {};
  const fs_ = { readFileSync: (p) => { if (!(p in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return files[p]; }, writeFileSync: (p, v) => { files[p] = v; } };
  const alive = new Set([100]);
  const kill = (pid) => { if (!alive.has(pid)) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" }); };
  assert.equal(singleInstance("/l", fs_, kill, 100), true);
  assert.equal(singleInstance("/l", fs_, kill, 200), false, "100 is still running");
  alive.delete(100);
  assert.equal(singleInstance("/l", fs_, kill, 200), true, "stale lock taken over");
  assert.equal(files["/l"], "200");
});
