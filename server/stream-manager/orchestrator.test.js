// server/stream-manager/orchestrator.test.js
//
// Automated broadcasts end to end in a simulated world: the real
// orchestrator (runTick, agentReport, selectGame, …) and the real VM agent
// reconcile loop, against fake Firestore, a fake VM, a fake Docker and a
// fake YouTube. Time is simulated minute by minute. Nothing leaves the
// machine; no VM, container or YouTube broadcast is touched.
//
//   npm run stream-manager:test

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { fakeFirestore } = require("./__fakes__/firestore");
const orch = require("./orchestrator");
const bc = require("./broadcasts");
const agent = require("../broadcast-agent/agent");

const MIN = 60e3;
const K1 = Date.UTC(2026, 9, 10, 19, 30); // kickoff, game 1
const K2 = K1 + 30 * MIN;                 // kickoff, game 2 (overlaps)
const { CFG } = orch;

const logs = [];
const realLog = console.log;
console.log = (...a) => logs.push(a.join(" "));

// ── The world ──

let db, w, clock;

function scheduleDoc(id, { home, away, kickoff, cfbd, slug, final = false }) {
  return { [`schedule26/${id}`]: { Home: home, Away: away, KickoffAt: { toMillis: () => kickoff }, CFBDGameId: cfbd, Slug: slug, Final: final } };
}

function setup({ slots = ["streamA"], maxConcurrent = 1 } = {}) {
  clock = K1 - 60 * MIN;
  db = fakeFirestore({
    ...scheduleDoc("s1", { home: "LSU", away: "Clemson", kickoff: K1, cfbd: 401001, slug: "clemson-vs-lsu" }),
    ...scheduleDoc("s2", { home: "Texas", away: "Ohio State", kickoff: K2, cfbd: 401002, slug: "ohio-state-vs-texas" }),
    ...scheduleDoc("s3", { home: "Navy", away: "Army", kickoff: K1, cfbd: null, slug: "army-vs-navy" }),
    ...scheduleDoc("s4", { home: "Iowa", away: "Ohio", kickoff: K1, cfbd: 401004, slug: "ohio-vs-iowa", final: true }),
    "liveGames/401001": { status: "scheduled", slug: "clemson-vs-lsu", home: { school: "LSU" }, away: { school: "Clemson" } },
    "liveGames/401002": { status: "scheduled", slug: "ohio-state-vs-texas", home: { school: "Texas" }, away: { school: "Ohio State" } },
    "streamManager/youtube": { connected: true, channelId: "UC1", workerStreamId: slots[0] },
    "streamManager/orchestrator": { slotStreamIds: slots, maxConcurrent },
  });
  w = {
    vm: "stopped", vmStarts: 0, vmStops: [], containers: new Map(), broadcasts: {}, creates: 0, transitions: [],
    events: [], // ordered side effects, for ordering checks
    exitOnStart: null, keyMissing: false, agentDown: false, ytCreateFails: 0, ingestBroken: false,
    monitorOff: false, testingError: null, ytReadFails: false, completeFails: false,
    slots,
  };
}

const deps = () => ({
  now: () => clock,
  log: (m) => logs.push(`orch ${m}`),
  compute: {
    status: async () => ({ instance: { name: "we-draft-broadcast-01", state: w.vm, status: w.vm.toUpperCase() } }),
    start: async (uid) => { assert.equal(uid, "orchestrator"); w.vmStarts++; w.vm = "starting"; w.events.push("vm-start"); return { result: "starting" }; },
    stop: async (_db, uid, body) => {
      assert.equal(body.confirmLive, undefined, "the orchestrator must never override the live guard");
      const active = await db.collection("broadcasts").where("auto.active", "==", true).limit(1).get();
      if (!active.empty) throw Object.assign(new Error("guard"), { status: 409 });
      w.vmStops.push(uid); w.vm = "stopping"; w.events.push("vm-stop"); return { result: "stopping" };
    },
  },
  yt: {
    SETTINGS: ["streamManager", "youtube"],
    accessToken: async () => "yt-access-token-never-logged",
    getStream: async (_t, id) => ({ id, title: id, streamStatus: streamActive(id) ? "active" : "ready", healthStatus: streamActive(id) ? "good" : "noData" }),
    getBroadcast: async (_t, id) => {
      if (w.ytReadFails) throw Object.assign(new Error("YouTube liveBroadcasts failed: Invalid Credentials (authError)"), { status: 502 });
      return w.broadcasts[id] ? { ...w.broadcasts[id] } : null;
    },
    transitionBroadcast: async (_t, id, to) => {
      const b = w.broadcasts[id];
      w.events.push(`yt-try-${to}:${id}`);
      if (to === "testing" && w.testingError) throw Object.assign(new Error(`YouTube liveBroadcasts/transition failed: nope (${w.testingError})`), { status: 400 });
      if (to === "testing" && w.monitorOff) throw Object.assign(new Error("YouTube liveBroadcasts/transition failed: Invalid transition (invalidTransition)"), { status: 400 });
      if (to === "complete" && w.completeFails) throw Object.assign(new Error("YouTube liveBroadcasts/transition failed: backend (backendError)"), { status: 502 });
      const ok = (to === "testing" && b.lifeCycleStatus === "ready" && streamActive(b.boundStreamId))
        || (to === "live" && (b.lifeCycleStatus === "testing" || (w.monitorOff && b.lifeCycleStatus === "ready")) && streamActive(b.boundStreamId))
        || (to === "complete" && ["live", "testing"].includes(b.lifeCycleStatus));
      if (!ok) throw Object.assign(new Error(`invalidTransition ${b.lifeCycleStatus}→${to}`), { status: 400 });
      b.lifeCycleStatus = to;
      w.transitions.push(`${id}:${to}`);
      w.events.push(`yt-${to}:${id}`);
      return { ...b };
    },
  },
  bc: {
    deriveStatus: bc.deriveStatus,
    youtubeCreate: async (_db, { id, streamId }) => {
      if (w.ytCreateFails > 0) { w.ytCreateFails--; throw Object.assign(new Error("YouTube liveBroadcasts failed: quota"), { status: 502 }); }
      const rec = db.data(`broadcasts/${id}`);
      let bid = rec.youtube.broadcastId;
      if (!bid) { bid = `yt-${id}`; w.creates++; w.broadcasts[bid] = { id: bid, lifeCycleStatus: "ready", boundStreamId: null }; }
      w.broadcasts[bid].boundStreamId = streamId;
      await db.doc(`broadcasts/${id}`).update({ "youtube.broadcastId": bid, "youtube.videoId": bid, "youtube.streamId": streamId, "youtube.lifecycleStatus": "ready" });
      return { ok: true, broadcastId: bid };
    },
  },
});

// A stream is receiving when a running container on the VM is on its slot.
function streamActive(streamId) {
  if (w.vm !== "running" || w.ingestBroken) return false;
  return [...w.containers.values()].some((c) => c.state === "running" && w.slots[c.slot] === streamId);
}

const fakeDocker = {
  list: async () => [...w.containers.values()].map((c) => ({ ...c })),
  hasImage: async () => true,
  start: async (d) => {
    assert.ok(!w.containers.has(d.id) || w.containers.get(d.id).state !== "running", `duplicate worker for ${d.id}`);
    w.containers.set(d.id, { id: d.id, slot: d.slot, game: d.game, state: w.exitOnStart == null ? "running" : "exited", exitCode: w.exitOnStart });
    w.events.push(`worker-start:${d.id}`);
  },
  stop: async (id) => { w.containers.delete(id); w.events.push(`worker-stop:${id}`); },
  remove: async (id) => { w.containers.delete(id); },
};
const agentState = { restarts: new Map(), errors: new Map() };
const agentCfg = { maxWorkers: 4, keyDir: "/keys", defaultRuntimeSec: 6 * 3600 };
const fakeFs = { existsSync: () => !w.keyMissing };
let lastDesired = [];

async function agentCycle() {
  if (w.vm !== "running" || w.agentDown) return;
  const containers = await fakeDocker.list();
  const r = await orch.agentReport(db, { containers: agent.report(containers, lastDesired, agentState), host: { version: "test" } }, clock);
  lastDesired = r.desired;
  await agent.reconcile(lastDesired, containers, clock, agentCfg, fakeDocker, agentState, fakeFs);
}

async function minute(n = 1) {
  for (let i = 0; i < n; i++) {
    clock += MIN;
    if (w.vm === "starting") w.vm = "running";
    if (w.vm === "stopping") { w.vm = "stopped"; w.containers.clear(); }
    await agentCycle();
    await orch.runTick(db, deps());
  }
}
async function until(pred, max = 120) {
  for (let i = 0; i < max; i++) { if (pred()) return; await minute(); }
  assert.fail(`condition not reached in ${max} min (phases: ${JSON.stringify(phases())})`);
}
const rec = (id) => db.data(`broadcasts/${id}`);
const phase = (id) => rec(id)?.auto?.phase;
const phases = () => Object.fromEntries([...db.store.keys()].filter((k) => k.startsWith("broadcasts/")).map((k) => [k.slice(11), db.store.get(k).auto?.phase]));
const setGame = (id, status) => db.doc(`liveGames/${id}`).update({ status });
const select = (scheduleId, extra = {}) => orch.selectGame(db, "admin1", { scheduleId, ...extra }, clock);

beforeEach(() => {
  setup();
  agentState.restarts.clear(); agentState.errors.clear(); lastDesired = [];
});

// ── Selection ──

test("selecting a game creates one record and starts nothing", async () => {
  const r = await select("s1");
  assert.equal(r.id, "g401001");
  assert.deepEqual(await select("s1"), { id: "g401001", already: true });
  const d = rec("g401001");
  assert.equal(d.auto.phase, "selected");
  assert.equal(d.auto.prepAt, K1 - 15 * MIN);
  assert.equal(d.gameSlug, "clemson-vs-lsu");
  assert.equal(d.youtube.privacyStatus, "unlisted");
  await minute(30); // up to K1-30m
  assert.equal(phase("g401001"), "selected");
  assert.equal(w.vmStarts, 0);
  assert.equal(w.creates, 0);
  assert.equal(w.containers.size, 0);
});

test("only linked, unplayed games can be selected; public needs confirmation", async () => {
  await assert.rejects(select("s3"), /isn't linked to We-Draft Live/);
  await assert.rejects(select("s4"), /already final/);
  await assert.rejects(select("nope"), /isn't in the CFB schedule/);
  await assert.rejects(select("../x"), /Pick a game/);
  await assert.rejects(select("s1", { privacyStatus: "public" }), /public confirmation/);
  assert.equal((await select("s1", { privacyStatus: "public", confirmPublic: true })).id, "g401001");
});

test("an existing manual record for the game is adopted, not duplicated", async () => {
  await db.doc("broadcasts/manual1").set({ gameId: "401001", status: "scheduled", youtube: { title: "Mine", broadcastId: null }, worker: {} });
  const r = await select("s1");
  assert.deepEqual(r, { id: "manual1", adopted: true });
  assert.equal(rec("manual1").youtube.title, "Mine");
  assert.equal(rec("g401001"), undefined);
});

// ── Full lifecycle ──

test("kickoff workflow: prepare at T-15, go live once ingest is active, end 15 min after FINAL", async () => {
  await select("s1");
  await minute(44); // K1-16m
  assert.equal(phase("g401001"), "selected");
  await minute(); // K1-15m
  assert.equal(phase("g401001"), "preparing");
  assert.equal(w.vmStarts, 1);

  await until(() => phase("g401001") === "live", 15);
  const d = rec("g401001");
  assert.ok(clock <= K1 - 5 * MIN, "on air before kickoff");
  assert.equal(w.creates, 1);
  assert.equal(d.youtube.streamId, "streamA");
  assert.equal(d.auto.slot, 0);
  assert.equal(w.containers.get("g401001").game, "clemson-vs-lsu");
  // testing → live only after the stream was active
  assert.deepEqual(w.transitions, ["yt-g401001:testing", "yt-g401001:live"]);
  assert.equal(d.status, "live");
  assert.equal(d.worker.status, "running");

  // Game runs long — no fixed duration: still live 4h later.
  await setGame(401001, "in_progress");
  await minute(240);
  assert.equal(phase("g401001"), "live");

  await setGame(401001, "final");
  await minute();
  assert.equal(phase("g401001"), "postgame");
  const finalAt = rec("g401001").auto.finalSeenAt;
  await minute(14);
  assert.equal(phase("g401001"), "postgame", "still on air during the 15-min postgame");
  assert.ok(w.containers.has("g401001"));
  await until(() => phase("g401001") === "completed", 5);
  assert.ok(clock >= finalAt + 15 * MIN);
  // YouTube complete before the worker stops.
  const iComplete = w.events.indexOf("yt-complete:yt-g401001");
  const iStop = w.events.indexOf("worker-stop:g401001");
  assert.ok(iComplete >= 0 && iStop > iComplete, w.events.join(","));
  assert.equal(rec("g401001").status, "ended");
  assert.equal(rec("g401001").auto.open, false);

  // VM: idle 10 min, then the orchestrator (which started it) stops it.
  assert.equal(w.vmStops.length, 0);
  await minute(11);
  assert.deepEqual(w.vmStops, ["orchestrator"]);
});

test("a FINAL that's taken back returns to live and restarts the 15-min wait", async () => {
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  await setGame(401001, "final");
  await minute(5);
  assert.equal(phase("g401001"), "postgame");
  await setGame(401001, "in_progress");
  await minute();
  assert.equal(phase("g401001"), "live");
  assert.equal(rec("g401001").auto.finalSeenAt, null);
  await setGame(401001, "final");
  await minute();
  await minute(14);
  assert.equal(phase("g401001"), "postgame");
  await until(() => phase("g401001") === "completed", 6);
});

test("hard maximum runtime ends a broadcast whose game never goes FINAL", async () => {
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  const deadline = rec("g401001").auto.deadlineAt;
  assert.equal(deadline - rec("g401001").auto.workerStartedAt, CFG.MAX_RUNTIME_MS);
  await until(() => phase("g401001") === "completed", 7 * 60);
  assert.ok(clock >= deadline);
  assert.match(rec("g401001").auto.error, /maximum runtime/);
  assert.ok(w.transitions.includes("yt-g401001:complete"));
});

// ── Concurrency ──

test("two overlapping games share the VM on separate stream slots", async () => {
  setup({ slots: ["streamA", "streamB"], maxConcurrent: 2 });
  await select("s1");
  await select("s2");
  await until(() => phase("g401001") === "live" && phase("g401002") === "live", 120);
  assert.equal(w.vmStarts, 1, "one VM for both");
  assert.notEqual(rec("g401001").auto.slot, rec("g401002").auto.slot);
  assert.equal(rec("g401002").youtube.streamId, "streamB");
  assert.equal(w.containers.size, 2);

  // Game 1 ends; game 2 is still on air → VM stays up.
  await setGame(401001, "final");
  await until(() => phase("g401001") === "completed", 20);
  await minute(30);
  assert.equal(w.vmStops.length, 0);
  assert.equal(w.vm, "running");
  assert.equal(phase("g401002"), "live");

  await setGame(401002, "final");
  await until(() => phase("g401002") === "completed", 20);
  await minute(11);
  assert.deepEqual(w.vmStops, ["orchestrator"]);
});

test("with one slot, an overlapping game waits for the slot instead of doubling up", async () => {
  await select("s1");
  await select("s2");
  await until(() => phase("g401001") === "live", 60);
  await minute(25); // K2-15 passed
  assert.equal(phase("g401002"), "preparing");
  assert.match(rec("g401002").auto.waiting, /free stream slot/);
  assert.equal(w.containers.size, 1);
  await setGame(401001, "final");
  await until(() => phase("g401001") === "completed", 20);
  await until(() => phase("g401002") === "live", 15);
  assert.equal(rec("g401002").auto.slot, 0);
});

// ── Duplicates ──

test("overlapping ticks don't double-act (lease), and repeated ticks never re-create", async () => {
  await select("s1");
  await minute(45); // preparing
  clock += MIN;
  w.vm = "running";
  await agentCycle();
  const [a, b] = await Promise.all([orch.runTick(db, deps()), orch.runTick(db, deps())]);
  assert.ok(a.skipped || b.skipped, "one tick skipped");
  await until(() => phase("g401001") === "live", 20);
  await minute(10);
  assert.equal(w.creates, 1);
  assert.equal(w.containers.size, 1);
  assert.equal(w.vmStarts, 1);
});

// ── Failures and recovery ──

test("worker exit 2 (bad settings) fails with an actionable error and isn't restarted", async () => {
  w.exitOnStart = 2;
  await select("s1");
  await until(() => phase("g401001") === "failed", 90);
  assert.match(rec("g401001").auto.error, /refused its settings/);
  assert.equal(w.events.filter((e) => e === "worker-start:g401001").length, 1);
  assert.equal(rec("g401001").status, "error");
});

test("missing key file on the VM is reported", async () => {
  w.keyMissing = true;
  await select("s1");
  await until(() => phase("g401001") === "failed", 90);
  assert.match(rec("g401001").auto.error, /no key file for stream slot 0/);
});

test("YouTube never seeing the stream times out with a hint", async () => {
  w.ingestBroken = true;
  await select("s1");
  await until(() => phase("g401001") === "failed", 90);
  assert.match(rec("g401001").auto.error, /never received the worker's stream/);
  assert.equal(w.transitions.length, 0, "never went live without ingest");
});

test("VM up but agent silent → fails after the VM timeout", async () => {
  w.agentDown = true;
  await select("s1");
  await until(() => phase("g401001") === "failed", 90);
  assert.match(rec("g401001").auto.error, /agent isn't reporting/);
});

test("transient YouTube create errors retry; five in a row fail", async () => {
  w.ytCreateFails = 2;
  await select("s1");
  await until(() => phase("g401001") === "live", 90);
  assert.equal(w.creates, 1);

  setup();
  w.ytCreateFails = 99;
  await select("s1");
  await until(() => phase("g401001") === "failed", 90);
  assert.match(rec("g401001").auto.error, /quota/);
});

test("a worker crash on air is restarted by the agent and the broadcast stays live", async () => {
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  w.containers.get("g401001").state = "exited";
  w.containers.get("g401001").exitCode = 1;
  await minute();
  assert.equal(phase("g401001"), "live");
  await minute(2);
  assert.equal(w.containers.get("g401001").state, "running");
  assert.equal(phase("g401001"), "live");
  assert.ok(w.events.filter((e) => e === "worker-start:g401001").length >= 2);
});

test("a VM that dies mid-broadcast is restarted and the worker relaunched", async () => {
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  w.vm = "stopped"; // preempted / crashed
  w.containers.clear();
  await minute();
  assert.equal(w.vmStarts, 2);
  await minute(3);
  assert.equal(w.containers.get("g401001")?.state, "running");
  assert.equal(phase("g401001"), "live");
});

test("a game that's already over when preparation would start fails as missed", async () => {
  await select("s1");
  await setGame(401001, "final");
  await db.doc("schedule26/s1").update({ Final: true });
  await minute(46);
  assert.equal(phase("g401001"), "failed");
  assert.equal(w.vmStarts, 0);
});

// ── Admin cancel / retry ──

test("cancel before prep → cancelled; retry → selected again", async () => {
  await select("s1");
  await orch.cancelGame(db, "admin1", { id: "g401001" });
  await minute();
  assert.equal(phase("g401001"), "cancelled");
  await minute(60);
  assert.equal(w.vmStarts, 0);
  await orch.retryGame(db, "admin1", { id: "g401001" });
  assert.equal(phase("g401001"), "selected");
  await assert.rejects(orch.retryGame(db, "admin1", { id: "g401001" }), /Only a failed or cancelled/);
});

test("disabling a live broadcast needs confirmEnd, then ends it cleanly", async () => {
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  await assert.rejects(orch.cancelGame(db, "admin1", { id: "g401001" }), (e) => e.status === 409 && /confirmEnd/.test(e.message));
  await minute();
  assert.equal(phase("g401001"), "live");
  await orch.cancelGame(db, "admin1", { id: "g401001", confirmEnd: true });
  await until(() => phase("g401001") === "completed", 5);
  assert.equal(rec("g401001").auto.endReason, "ended by admin");
  assert.ok(w.transitions.includes("yt-g401001:complete"));
});

// ── VM shutdown decisions ──

test("a VM an admin started manually is never stopped by the orchestrator", async () => {
  w.vm = "running";
  await orch.noteManualVm(db, "vm-start", { result: "starting" }, {}, clock);
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  assert.equal(w.vmStarts, 0, "reused the running VM");
  await setGame(401001, "final");
  await until(() => phase("g401001") === "completed", 20);
  await minute(30);
  assert.equal(w.vmStops.length, 0);
});

test("the VM is kept warm when another selected game prepares soon", async () => {
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  await setGame(401001, "final");
  await until(() => phase("g401001") === "completed", 20);
  // A game 40 min after now → within KEEP_WARM, so no stop.
  await db.doc("schedule26/s2").update({ KickoffAt: { toMillis: () => clock + 55 * MIN } });
  await select("s2");
  await minute(15);
  assert.equal(w.vmStops.length, 0);
  assert.equal(w.vm, "running");
});

test("after a forced manual stop, automatic VM starts pause", async () => {
  await select("s1");
  await orch.noteManualVm(db, "vm-stop", { result: "stopping" }, { confirmLive: true }, clock + 45 * MIN);
  await minute(47); // preparing → vm, then waiting in vm
  assert.equal(phase("g401001"), "vm");
  assert.equal(w.vmStarts, 0);
  assert.match(rec("g401001").auto.waiting || "", /stopped manually/);
});

test("the orchestrator never stops the VM while anything is active", async () => {
  setup({ slots: ["streamA", "streamB"], maxConcurrent: 2 });
  await select("s1");
  await select("s2");
  for (let i = 0; i < 300; i++) {
    await minute();
    if (i === 200) { await setGame(401001, "final"); }
    const anyActive = ["g401001", "g401002"].some((id) => orch.ACTIVE.includes(phase(id)));
    if (anyActive) assert.equal(w.vmStops.length, 0, `stopped at minute ${i} while active`);
  }
});

// ── Agent endpoint answer ──

test("desired workers only include on-air phases with a valid game", () => {
  const r = (id, phase, extra = {}) => ({ id, gameSlug: "a-b", gameId: "1", auto: { open: true, slot: 0, phase, deadlineAt: 5, ...extra } });
  const out = orch.desiredWorkers([
    r("a", "selected"), r("b", "vm"), r("c", "worker"), r("d", "live"), r("e", "ending"), r("f", "ending", { youtubeDone: true }),
    r("g", "live", { slot: null }), { ...r("h", "live"), gameSlug: "bad slug; rm -rf", gameId: "x" },
  ]);
  assert.deepEqual(out.map((x) => x.id), ["c", "d", "e"]);
});

// ── Production-readiness regressions ──

test("YouTube LIVE: with the monitor stream off, ready goes straight to live", async () => {
  w.monitorOff = true;
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  assert.deepEqual(w.transitions, ["yt-g401001:live"]);
});

test("YouTube LIVE: any other testing error never falls through to live", async () => {
  w.testingError = "errorStreamInactive";
  await select("s1");
  await until(() => phase("g401001") === "failed", 60);
  assert.ok(!w.events.some((e) => e.startsWith("yt-try-live")), w.events.join(","));
  assert.equal(w.transitions.length, 0);
});

test("YouTube LIVE: never attempted before the worker's stream is active", async () => {
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  const firstTry = w.events.findIndex((e) => e.startsWith("yt-try-"));
  const workerStart = w.events.indexOf("worker-start:g401001");
  assert.ok(workerStart >= 0 && firstTry > workerStart);
});

test("YouTube read failures on air don't stop FINAL handling; the worker still stops", async () => {
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  w.ytReadFails = true;
  w.completeFails = true;
  await minute();
  assert.equal(phase("g401001"), "live");
  assert.match(rec("g401001").auto.waiting, /Can't read YouTube status/);
  await setGame(401001, "final");
  await until(() => phase("g401001") === "ending", 20);
  await until(() => phase("g401001") === "completed", 10);
  assert.match(rec("g401001").auto.error, /end it in YouTube Studio/);
  assert.ok(!w.containers.has("g401001"), "worker stopped");
});

test("lease: a busy lease skips the tick; an old tick can't release a newer tick's lease", async () => {
  const { lock, unlock } = orch._lease;
  const a = await lock(db, 1000);
  assert.ok(a);
  assert.equal(await lock(db, 1000 + CFG.LOCK_MS - 1), null);
  const b = await lock(db, 1000 + CFG.LOCK_MS + 1); // a's lease expired
  assert.ok(b && b !== a);
  await unlock(db, a); // the old tick finishing late
  assert.equal(db.data("streamManagerPrivate/orchestratorLock").owner, b);
  assert.equal(await lock(db, 1000 + CFG.LOCK_MS + 2), null);
  await unlock(db, b);
  assert.ok(await lock(db, 1000 + CFG.LOCK_MS + 3));
});

test("enabling a game whose manual broadcast is already testing/live is refused", async () => {
  await db.doc("broadcasts/manual1").set({ gameId: "401001", status: "live", youtube: { broadcastId: "yt-m", lifecycleStatus: "live" }, worker: {} });
  await assert.rejects(select("s1"), /testing or live — finish it manually/);
  assert.equal(rec("manual1").auto, undefined);
});

// ── Cancellation ──

test("cancel → status cancelled, automation disabled/closed, and nothing restarts it", async () => {
  await select("s1");
  await orch.cancelGame(db, "admin1", { id: "g401001" });
  await minute();
  const d = rec("g401001");
  assert.equal(d.auto.phase, "cancelled");
  assert.equal(d.status, "cancelled");
  assert.equal(d.auto.enabled, false);
  assert.equal(d.auto.open, false);
  assert.equal(d.auto.active, false);
  assert.equal(d.auto.slot, null);
  // Past prep time and kickoff: still cancelled, no VM, no YouTube, no worker.
  await minute(90);
  assert.equal(phase("g401001"), "cancelled");
  assert.equal(w.vmStarts, 0);
  assert.equal(w.creates, 0);
  assert.equal(w.containers.size, 0);
  assert.deepEqual(orch.desiredWorkers([{ id: "g401001", ...rec("g401001") }]), []);
});

test("cancel while starting ends via YouTube-first path and lands on cancelled + disabled", async () => {
  await select("s1");
  await until(() => phase("g401001") === "ingest", 60);
  await orch.cancelGame(db, "admin1", { id: "g401001" });
  await until(() => phase("g401001") === "cancelled", 10);
  const d = rec("g401001");
  assert.equal(d.status, "cancelled");
  assert.equal(d.auto.enabled, false);
  assert.ok(!w.containers.has("g401001"), "worker stopped");
  assert.ok(!w.transitions.some((t) => t.endsWith(":live")), "never went live");
});

test("a live broadcast that's cancelled ends as completed (it was on air), not cancelled", async () => {
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  await orch.cancelGame(db, "admin1", { id: "g401001", confirmEnd: true });
  await until(() => phase("g401001") === "completed", 6);
  assert.equal(rec("g401001").status, "ended");
});

test("retry re-enables a cancelled record; selecting the game again reuses it", async () => {
  await select("s1");
  await orch.cancelGame(db, "admin1", { id: "g401001" });
  await minute();
  await orch.retryGame(db, "admin1", { id: "g401001" });
  let d = rec("g401001");
  assert.equal(d.auto.phase, "selected");
  assert.equal(d.auto.enabled, true);
  assert.equal(d.auto.open, true);
  assert.equal(d.status, "scheduled");

  await orch.cancelGame(db, "admin1", { id: "g401001" });
  await minute();
  const r = await select("s1");
  assert.deepEqual(r, { id: "g401001", adopted: true });
  d = rec("g401001");
  assert.equal(d.auto.enabled, true);
  assert.equal(d.auto.phase, "selected");
  assert.equal([...db.store.keys()].filter((k) => k.startsWith("broadcasts/")).length, 1, "no duplicate record");
});

test("an open record with auto.enabled false is treated as cancelled (kill switch)", async () => {
  await select("s1");
  await db.doc("broadcasts/g401001").update({ "auto.enabled": false });
  await minute();
  assert.equal(phase("g401001"), "cancelled");
  assert.equal(rec("g401001").auto.open, false);
});

test("desired workers skip a disabled record, except one that's already ending", () => {
  const r = (phase, extra = {}) => ({ id: `x${phase.replace(/-/g, "")}`, gameSlug: "a-b", auto: { open: true, slot: 0, phase, enabled: false, ...extra } });
  const out = orch.desiredWorkers([r("live"), r("worker"), r("ending")]);
  assert.deepEqual(out.map((x) => x.id), ["xending"]);
});

test("nothing logged contains a token", () => {
  for (const l of logs) assert.ok(!l.includes("yt-access-token-never-logged"), l);
  console.log = realLog;
});
