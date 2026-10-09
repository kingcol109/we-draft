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
    "streamManager/youtube": { connected: true, channelId: "UC1", workerStreamId: slots[0] || null },
    "streamManager/orchestrator": { slotStreamIds: slots, maxConcurrent },
  });
  w = {
    vm: "stopped", vmStarts: 0, vmStops: [], containers: new Map(), broadcasts: {}, creates: 0, transitions: [],
    events: [], // ordered side effects, for ordering checks
    exitOnStart: null, keyMissing: false, agentDown: false, ytCreateFails: 0, ingestBroken: false,
    monitorOff: false, testingError: null, ytReadFails: false, completeFails: false,
    agentDryRun: false, ytCalls: [], createArgs: [], liveFails: false, liveStuck: false, completeFailCount: 0, completeRedundant: false, testStuck: false,
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
    accessToken: async () => { w.ytCalls.push("accessToken"); return "yt-access-token-never-logged"; },
    getStream: async (_t, id) => (w.ytCalls.push("getStream"), { id, title: id, streamStatus: streamActive(id) ? "active" : "ready", healthStatus: streamActive(id) ? "good" : "noData" }),
    getBroadcast: async (_t, id) => {
      w.ytCalls.push("getBroadcast");
      const cur = w.broadcasts[id];
      if (cur && cur.lifeCycleStatus === "liveStarting" && !w.liveStuck) cur.lifeCycleStatus = "live";
      if (cur && cur.lifeCycleStatus === "testStarting" && !w.testStuck) cur.lifeCycleStatus = "testing";
      if (w.ytReadFails) throw Object.assign(new Error("YouTube liveBroadcasts failed: Invalid Credentials (authError)"), { status: 502 });
      return w.broadcasts[id] ? { ...w.broadcasts[id] } : null;
    },
    transitionBroadcast: async (_t, id, to) => {
      w.ytCalls.push(`transition:${to}`);
      const b = w.broadcasts[id];
      w.events.push(`yt-try-${to}:${id}`);
      if (to === "live" && w.liveFails) throw Object.assign(new Error("YouTube liveBroadcasts/transition failed: Backend Error (backendError)"), { status: 502 });
      if (to === "complete" && w.completeFailCount > 0) { w.completeFailCount--; throw Object.assign(new Error("YouTube liveBroadcasts/transition failed: Backend Error (backendError)"), { status: 502 }); }
      if (to === "complete" && w.completeRedundant && ["live", "testing"].includes(b.lifeCycleStatus)) {
        b.lifeCycleStatus = "complete"; w.transitions.push(`${id}:complete`); w.events.push(`yt-complete:${id}`);
        throw Object.assign(new Error("YouTube liveBroadcasts/transition failed: Redundant transition (redundantTransition)"), { status: 400 });
      }
      if (to === "testing" && w.testingError) throw Object.assign(new Error(`YouTube liveBroadcasts/transition failed: nope (${w.testingError})`), { status: 400 });
      if (to === "testing" && w.monitorOff) throw Object.assign(new Error("YouTube liveBroadcasts/transition failed: Invalid transition (invalidTransition)"), { status: 400 });
      if (to === "complete" && w.completeFails) throw Object.assign(new Error("YouTube liveBroadcasts/transition failed: backend (backendError)"), { status: 502 });
      const ok = (to === "testing" && b.lifeCycleStatus === "ready" && streamActive(b.boundStreamId))
        || (to === "live" && (b.lifeCycleStatus === "testing" || (w.monitorOff && b.lifeCycleStatus === "ready")) && streamActive(b.boundStreamId))
        || (to === "complete" && ["live", "testing"].includes(b.lifeCycleStatus));
      if (!ok) throw Object.assign(new Error(`invalidTransition ${b.lifeCycleStatus}→${to}`), { status: 400 });
      b.lifeCycleStatus = to === "live" && w.liveStuck ? "liveStarting" : to === "testing" && w.testStuck ? "testStarting" : to;
      w.transitions.push(`${id}:${to}`);
      w.events.push(`yt-${to}:${id}`);
      return { ...b };
    },
  },
  bc: {
    deriveStatus: bc.deriveStatus,
    youtubeCreate: async (_db, { id, streamId, useDraft }) => {
      w.ytCalls.push("youtubeCreate");
      w.createArgs.push({ id, streamId, useDraft });
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
  const r = await orch.agentReport(db, { dryRun: w.agentDryRun, containers: agent.report(containers, lastDesired, agentState), host: { version: "test" } }, clock);
  lastDesired = r.desired;
  await agent.reconcile(lastDesired, containers, clock, { ...agentCfg, dryRun: w.agentDryRun }, fakeDocker, agentState, fakeFs);
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
  // the YouTube create takes the game's metadata draft (metadata.js), if any
  assert.deepEqual(w.createArgs[0], { id: "g401001", streamId: "streamA", useDraft: true });
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

test("YouTube read failures on air don't stop FINAL handling; unconfirmed end → failed, worker stopped only after the bound", async () => {
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  w.ytReadFails = true;
  w.completeFails = true;
  await minute();
  assert.equal(phase("g401001"), "live");
  assert.match(rec("g401001").auto.waiting, /Can't read YouTube status/);
  await setGame(401001, "final");
  await until(() => phase("g401001") === "ending", 20);
  const endingAt = clock;
  // YouTube can't be confirmed off the air: the worker keeps running until the bound.
  await minute(4);
  assert.equal(phase("g401001"), "ending");
  assert.ok(w.containers.has("g401001"), "worker not stopped while YouTube may be live");
  await until(() => phase("g401001") === "failed", 10);
  assert.ok(clock - endingAt > CFG.ENDING_YT_TIMEOUT_MS);
  const d = rec("g401001");
  assert.match(d.auto.error, /Couldn't confirm the YouTube broadcast ended/);
  assert.equal(d.auto.ytUnconfirmed, true);
  assert.equal(d.status, "error", "never reported as a success");
  assert.ok(!w.containers.has("g401001"), "worker stopped after the bound");
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

// ── D1: server-enforced rehearsal ──

const rsel = (id) => select(id, { rehearsal: true });

test("rehearsal: full lifecycle with no Worker Stream and zero YouTube calls", async () => {
  setup({ slots: [] });
  w.agentDryRun = true;
  const r = await rsel("s1");
  assert.deepEqual(r, { id: "r401001", created: true, rehearsal: true });
  assert.equal(rec("r401001").rehearsal, true);
  assert.match(rec("r401001").youtube.title, /^\[Rehearsal\]/);
  await until(() => phase("r401001") === "live", 60);
  let d = rec("r401001");
  assert.equal(d.status, "rehearsal", "never shown as a real live broadcast");
  assert.equal(d.auto.sim.lifecycleStatus, "live");
  assert.equal(d.youtube.broadcastId, null);
  assert.equal(d.youtube.lifecycleStatus, null, "youtube.* never written");
  assert.equal(d.auto.slot, null, "no real slot used");
  assert.equal(w.vmStarts, 1);
  assert.ok(w.containers.has("r401001"), "simulated worker running");
  await setGame(401001, "final");
  await until(() => phase("r401001") === "completed", 25);
  d = rec("r401001");
  assert.equal(d.status, "ended");
  assert.equal(d.auto.sim.lifecycleStatus, "complete");
  assert.ok(!w.containers.has("r401001"));
  assert.deepEqual(w.ytCalls, [], "no YouTube call of any kind");
  assert.equal(w.creates, 0);
  assert.deepEqual(w.transitions, []);
});

test("rehearsal: never dispatched to a real (non-DRY_RUN) agent; fails with an actionable error", async () => {
  setup({ slots: [] });
  await rsel("s1");
  await until(() => phase("r401001") === "failed", 70);
  assert.match(rec("r401001").auto.error, /DRY_RUN/);
  assert.ok(!w.events.some((e) => e.startsWith("worker-start")), "no worker ever launched");
  assert.deepEqual(w.ytCalls, []);
  const recs = [{ id: "r1", rehearsal: true, gameSlug: "a-b", auto: { open: true, slot: null, phase: "worker", enabled: true } }];
  assert.deepEqual(orch.desiredWorkers(recs), []);
  assert.deepEqual(orch.desiredWorkers(recs, { agentDryRun: true }).map((x) => [x.id, x.slot, x.rehearsal]), [["r1", 0, true]]);
});

test("rehearsal: failure, cancellation and retry paths make no YouTube calls", async () => {
  setup({ slots: [] });
  w.agentDryRun = true;
  w.exitOnStart = 2;
  await rsel("s1");
  await until(() => phase("r401001") === "failed", 70);
  w.exitOnStart = null;
  await orch.retryGame(db, "admin1", { id: "r401001" });
  assert.equal(rec("r401001").rehearsal, true, "retry keeps it a rehearsal");
  await until(() => phase("r401001") === "live", 30);
  await assert.rejects(orch.cancelGame(db, "admin1", { id: "r401001" }), /confirmEnd/);
  await orch.cancelGame(db, "admin1", { id: "r401001", confirmEnd: true });
  await until(() => phase("r401001") === "completed", 6);
  assert.equal(rec("r401001").auto.endReason, "ended by admin");

  // cancelled while the (simulated) worker is starting
  await rsel("s1");
  assert.equal(phase("r401001"), "selected", "a finished rehearsal can be rehearsed again");
  await until(() => phase("r401001") === "worker" || phase("r401001") === "ingest", 60);
  await orch.cancelGame(db, "admin1", { id: "r401001" });
  await until(() => phase("r401001") === "cancelled", 6);
  assert.deepEqual(w.ytCalls, []);
});

test("rehearsal: the record's own YouTube actions are refused server-side", async () => {
  setup({ slots: [] });
  await rsel("s1");
  await assert.rejects(bc.youtubeCreate(db, { id: "r401001" }), (e) => e.status === 409 && /rehearsal record/.test(e.message));
  await assert.rejects(bc.youtubeCreate(db, { id: "r401001", streamId: "streamA" }), /rehearsal record/);
  await assert.rejects(bc.youtubeRefresh(db, { id: "r401001" }), /rehearsal record/);
  assert.equal(rec("r401001").youtube.broadcastId, null);
});

test("rehearsal and real records never stand in for each other", async () => {
  await rsel("s1");
  await assert.rejects(select("s1"), /open rehearsal — disable it first/);
  await orch.cancelGame(db, "admin1", { id: "r401001" });
  await minute();
  const real = await select("s1");
  assert.equal(real.id, "g401001", "a new real record, not the rehearsal");
  assert.equal(rec("g401001").rehearsal, undefined);
  await assert.rejects(rsel("s1"), /open real broadcast — disable it first/);
});

test("STREAM_REHEARSAL_ONLY: real broadcasts can't start or mutate YouTube; rehearsals still run", async () => {
  await select("s1"); // selected before the switch
  process.env.STREAM_REHEARSAL_ONLY = "1";
  try {
    await assert.rejects(select("s2"), /rehearsal-only mode/);
    await minute(50); // past prep time
    assert.equal(phase("g401001"), "selected");
    assert.match(rec("g401001").auto.error, /rehearsal-only mode/);
    assert.equal(w.vmStarts, 0);
    assert.deepEqual(w.ytCalls, []);
    await assert.rejects(bc.youtubeCreate(db, { id: "g401001" }), /rehearsal-only mode/);
    await until(() => phase("g401001") === "failed", 20);
    assert.match(rec("g401001").auto.error, /Kickoff passed/);
    await assert.rejects(orch.retryGame(db, "admin1", { id: "g401001" }), /rehearsal-only mode/);
  } finally {
    delete process.env.STREAM_REHEARSAL_ONLY;
  }
});

test("STREAM_REHEARSAL_ONLY still lets a real broadcast already on air be completed", async () => {
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  process.env.STREAM_REHEARSAL_ONLY = "1";
  try {
    await orch.cancelGame(db, "admin1", { id: "g401001", confirmEnd: true });
    await until(() => phase("g401001") === "completed", 6);
    assert.ok(w.transitions.includes("yt-g401001:complete"));
  } finally {
    delete process.env.STREAM_REHEARSAL_ONLY;
  }
});

// ── D2: failures after YouTube may be on air ──

test("failure while testing: live transition keeps failing → completed on YouTube, then worker stopped, ends failed", async () => {
  w.liveFails = true;
  await select("s1");
  await until(() => phase("g401001") === "going-live", 60);
  await until(() => phase("g401001") === "ending", 10);
  assert.ok(w.containers.has("g401001"), "worker still running while YouTube is testing");
  await until(() => phase("g401001") === "failed", 8);
  const d = rec("g401001");
  assert.match(d.auto.failReason, /backendError/);
  assert.equal(d.status, "error");
  const iComplete = w.events.indexOf("yt-complete:yt-g401001");
  const iStop = w.events.indexOf("worker-stop:g401001");
  assert.ok(iComplete >= 0 && iStop > iComplete, w.events.join(","));
  assert.ok(!w.transitions.includes("yt-g401001:live"));
});

test("going-live times out while YouTube is liveStarting: waits, completes once live, worker kept until then", async () => {
  w.liveStuck = true;
  await select("s1");
  await until(() => phase("g401001") === "going-live", 60);
  await until(() => phase("g401001") === "ending", 10);
  await minute(2);
  assert.equal(phase("g401001"), "ending");
  assert.match(rec("g401001").auto.waiting, /liveStarting/);
  assert.ok(w.containers.has("g401001"), "worker kept while YouTube may go live");
  w.liveStuck = false; // YouTube finishes going live
  await until(() => phase("g401001") === "failed", 8);
  const iComplete = w.events.indexOf("yt-complete:yt-g401001");
  const iStop = w.events.indexOf("worker-stop:g401001");
  assert.ok(iComplete >= 0 && iStop > iComplete, w.events.join(","));
  assert.match(rec("g401001").auto.error, /didn't go live/);
});

test("failure after YouTube is live (reads failing while going live): ends it on YouTube once reachable", async () => {
  await select("s1");
  await until(() => phase("g401001") === "going-live", 60);
  w.ytReadFails = true; // YouTube went live, but we can't see it
  await until(() => phase("g401001") === "ending", 10);
  assert.ok(w.containers.has("g401001"));
  w.ytReadFails = false;
  await until(() => phase("g401001") === "failed", 6);
  assert.equal(w.broadcasts["yt-g401001"].lifeCycleStatus, "complete");
  const iComplete = w.events.indexOf("yt-complete:yt-g401001");
  const iStop = w.events.indexOf("worker-stop:g401001");
  assert.ok(iComplete >= 0 && iStop > iComplete, w.events.join(","));
  assert.equal(rec("g401001").auto.ytUnconfirmed, undefined);
});

test("completion retries: transient complete errors retry until confirmed; the worker waits", async () => {
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  w.completeFailCount = 3;
  await setGame(401001, "final");
  await until(() => phase("g401001") === "ending", 20);
  await minute(2);
  assert.equal(phase("g401001"), "ending");
  assert.match(rec("g401001").auto.waiting, /Completing on YouTube failed/);
  assert.ok(w.containers.has("g401001"));
  await until(() => phase("g401001") === "completed", 6);
  assert.equal(rec("g401001").status, "ended");
  assert.equal(rec("g401001").auto.error, null);
});

test("completion is idempotent: a redundantTransition is confirmed by the next read", async () => {
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  w.completeRedundant = true;
  await orch.cancelGame(db, "admin1", { id: "g401001", confirmEnd: true });
  await until(() => phase("g401001") === "completed", 6);
  assert.equal(w.broadcasts["yt-g401001"].lifeCycleStatus, "complete");
});

test("retry is refused while the YouTube broadcast may still be on the air", async () => {
  await db.doc("broadcasts/gx").set({ gameId: "9", status: "error", youtube: { broadcastId: "b", lifecycleStatus: "live" }, worker: {}, auto: { phase: "failed", open: false } });
  await assert.rejects(orch.retryGame(db, "admin1", { id: "gx" }), /may still be on the air/);
});

// ── D3: zero slots ──

test("slotsOf never turns 'no stream' into one slot", () => {
  assert.equal(orch.slotsOf({}, {}).capacity, 0);
  assert.equal(orch.slotsOf({ maxConcurrent: 3 }, {}).capacity, 0);
  assert.equal(orch.slotsOf({ slotStreamIds: [] }, { workerStreamId: null }).capacity, 0);
  assert.equal(orch.slotsOf({}, { workerStreamId: "a" }).capacity, 1);
  assert.equal(orch.slotsOf({ slotStreamIds: ["a", "b"], maxConcurrent: 1 }).capacity, 1);
});

test("zero slots: a real game is held (no VM, no YouTube), capacity reported 0, fails at kickoff", async () => {
  setup({ slots: [] });
  await select("s1");
  await minute(50); // K1-10m — past prep time
  assert.equal(phase("g401001"), "selected");
  assert.match(rec("g401001").auto.error, /No Worker Stream is configured/);
  assert.equal(rec("g401001").auto.active, false);
  assert.equal(w.vmStarts, 0);
  assert.deepEqual(w.ytCalls, []);
  const o = db.data("streamManager/orchestrator");
  assert.equal(o.capacity, 0);
  assert.equal(o.slotsInUse, 0);
  await until(() => phase("g401001") === "failed", 15);
  assert.match(rec("g401001").auto.error, /Kickoff passed/);
  assert.equal(w.vmStarts, 0);
});

test("zero slots: an older record stuck in preparing fails at once without starting the VM", async () => {
  setup({ slots: [] });
  await select("s1");
  await db.doc("broadcasts/g401001").update({ "auto.phase": "preparing", "auto.active": true, "auto.phaseAt": clock });
  await minute();
  assert.equal(phase("g401001"), "failed");
  assert.match(rec("g401001").auto.error, /No Worker Stream/);
  assert.equal(w.vmStarts, 0);
  assert.deepEqual(w.ytCalls, []);
});

test("zero slots: a blocked game doesn't keep an orchestrator-owned VM warm", async () => {
  setup({ slots: [] });
  w.vm = "running";
  await db.doc("streamManager/orchestrator").set({ vmOwned: true }, { merge: true });
  await select("s1"); // prep in 45 min — would normally keep the VM warm
  await minute(12);
  assert.deepEqual(w.vmStops, ["orchestrator"]);
});

test("an agent in DRY_RUN blocks real broadcasts before any YouTube call", async () => {
  w.agentDryRun = true;
  w.vm = "running";
  await minute(); // the agent reports DRY_RUN
  await select("s1");
  await minute(48);
  assert.equal(phase("g401001"), "selected");
  assert.match(rec("g401001").auto.error, /DRY_RUN mode — real broadcasts are blocked/);
  assert.deepEqual(w.ytCalls, []);
  assert.equal(w.creates, 0);
});


// ── D2: unconfirmed endings ──

const snapshot = (id) => { const d = rec(id); return JSON.stringify({ auto: d.auto, status: d.status, youtube: d.youtube, worker: d.worker }); };

test("YouTube still live past the ending deadline (complete keeps failing) → failed + unconfirmed; worker stopped only after the bound", async () => {
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  w.completeFails = true;
  await setGame(401001, "final");
  await until(() => phase("g401001") === "ending", 20);
  const endingAt = clock;
  await minute(4);
  assert.equal(phase("g401001"), "ending");
  assert.ok(w.containers.has("g401001"), "worker kept while YouTube is live");
  await until(() => phase("g401001") === "failed", 8);
  assert.ok(clock - endingAt > CFG.ENDING_YT_TIMEOUT_MS);
  const d = rec("g401001");
  assert.equal(d.auto.ytUnconfirmed, true);
  assert.match(d.auto.error, /Couldn't confirm the YouTube broadcast ended \(still live after 5 min\)/);
  assert.equal(d.status, "error");
  assert.ok(!w.containers.has("g401001"), "worker stopped after the bound");
});

for (const [name, knob] of [["liveStarting", "liveStuck"], ["testStarting", "testStuck"]]) {
  test(`YouTube stuck in ${name} past the ending deadline → failed + unconfirmed`, async () => {
    w[knob] = true;
    await select("s1");
    await until(() => phase("g401001") === "going-live", 60);
    await until(() => phase("g401001") === "ending", 10);
    await minute(3);
    assert.equal(phase("g401001"), "ending");
    assert.match(rec("g401001").auto.waiting, new RegExp(name));
    assert.ok(w.containers.has("g401001"), "worker kept while YouTube may go on air");
    await until(() => phase("g401001") === "failed", 10);
    const d = rec("g401001");
    assert.equal(d.auto.ytUnconfirmed, true);
    assert.match(d.auto.error, new RegExp(`still ${name} after 5 min`));
    assert.equal(d.status, "error");
    assert.ok(!w.transitions.includes("yt-g401001:complete"), "never completed (couldn't be)");
  });
}

test("a failed, unconfirmed record is untouched by later runs and blocks every way back in", async () => {
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  w.completeFails = true;
  await setGame(401001, "final");
  await until(() => phase("g401001") === "failed", 30);
  // Simulate a stale stored state: it says "ready" though YouTube may be live.
  await db.doc("broadcasts/g401001").update({ "youtube.lifecycleStatus": "ready" });
  const before = snapshot("g401001");
  const ytBefore = w.ytCalls.length;
  const createsBefore = w.creates;
  await minute(30);
  assert.equal(snapshot("g401001"), before, "no later run changed it (never marked completed)");
  assert.equal(w.ytCalls.length, ytBefore, "no YouTube call for it");
  assert.equal(w.creates, createsBefore, "no new YouTube broadcast");
  assert.deepEqual(orch.desiredWorkers([{ id: "g401001", ...rec("g401001") }]), [], "no worker");

  const unconfirmed = (e) => e.status === 409 && /never confirmed/.test(e.message);
  await assert.rejects(orch.retryGame(db, "admin1", { id: "g401001" }), unconfirmed, "Retry");
  await assert.rejects(select("s1"), unconfirmed, "re-enable");
  await assert.rejects(bc.deleteRecord(db, { id: "g401001" }), unconfirmed, "delete");
  await assert.rejects(bc.youtubeCreate(db, { id: "g401001" }), unconfirmed, "manual create/bind");
  // Repair Statuses can't clear the flag or open a way around the guard.
  await bc.refreshStatuses(db, { apply: true });
  assert.equal(rec("g401001").auto.ytUnconfirmed, true);
  assert.equal(rec("g401001").status, "error");
  await assert.rejects(orch.retryGame(db, "admin1", { id: "g401001" }), unconfirmed, "Retry after repair");
  assert.equal(w.creates, createsBefore);
});

test("a worker that crashes during ending is not relaunched; the ending still completes", async () => {
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  w.completeFailCount = 4;
  await setGame(401001, "final");
  await until(() => phase("g401001") === "ending", 20);
  assert.equal(orch.desiredWorkers([{ id: "g401001", ...rec("g401001") }])[0].noRestart, true);
  const starts = () => w.events.filter((e) => e === "worker-start:g401001").length;
  const before = starts();
  w.containers.get("g401001").state = "exited";
  w.containers.get("g401001").exitCode = 1;
  await minute(3);
  assert.equal(starts(), before, "not relaunched");
  assert.equal(w.containers.get("g401001")?.state, "exited");
  await until(() => phase("g401001") === "completed", 6);
  assert.ok(w.transitions.includes("yt-g401001:complete"));
  assert.equal(rec("g401001").auto.ytUnconfirmed, undefined);
});

test("outside ending, a crashed worker is still restarted (regression)", async () => {
  await select("s1");
  await until(() => phase("g401001") === "live", 60);
  assert.equal(orch.desiredWorkers([{ id: "g401001", ...rec("g401001") }])[0].noRestart, undefined);
  w.containers.get("g401001").state = "exited";
  w.containers.get("g401001").exitCode = 1;
  await minute(2);
  assert.equal(w.containers.get("g401001").state, "running");
});


// ── National coverage (/broadcast/national) ──

const iso = (t) => new Date(t).toISOString();
const slate = (games) => db.doc("liveSlate/current").set({ games });
const national = (extra = {}) => orch.selectNational(db, "admin1", { startAt: iso(K1), endAt: iso(K1 + 10 * 60 * MIN), ...extra }, clock);

test("national: validation, one record per window, no overlaps", async () => {
  await assert.rejects(national({ startAt: "nope" }), /starts and ends/);
  await assert.rejects(national({ endAt: iso(K1 - MIN) }), /after its start/);
  await assert.rejects(national({ endAt: iso(K1 + 17 * 60 * MIN) }), /at most 16 hours/);
  await assert.rejects(national({ startAt: iso(K1 - 300 * MIN), endAt: iso(clock + 10 * MIN) }), /over/);
  await assert.rejects(national({ privacyStatus: "public" }), /public confirmation/);
  const r = await national();
  assert.equal(r.id, `n${K1}`);
  assert.deepEqual(await national(), { id: `n${K1}`, already: true });
  await assert.rejects(national({ startAt: iso(K1 + 60 * MIN), endAt: iso(K1 + 3 * 60 * MIN) }), /already scheduled/);
  // A rehearsal is its own record and may share the window.
  assert.equal((await national({ rehearsal: true })).id, `rn${K1}`);
  const d = rec(`n${K1}`);
  assert.equal(d.kind, "national");
  assert.equal(d.gameSlug, "national");
  assert.equal(d.gameId, null);
  assert.equal(d.auto.prepAt, K1 - 15 * MIN);
  assert.equal(d.auto.endAt, K1 + 10 * 60 * MIN);
  assert.match(d.youtube.title, /Every Game/);
});

test("national: prepares before the window, streams /broadcast/national, ends 15 min after the last game is final", async () => {
  await slate([
    { id: "401001", status: "scheduled", startDate: iso(K1) },
    { id: "401002", status: "scheduled", startDate: iso(K2) },
  ]);
  const id = (await national()).id;
  await minute(44);
  assert.equal(phase(id), "selected");
  await minute();
  assert.equal(phase(id), "preparing");
  await until(() => phase(id) === "live", 15);
  assert.equal(w.containers.get(id).game, "national");
  assert.equal(rec(id).auto.deadlineAt, K1 + 10 * 60 * MIN + CFG.NATIONAL_TAIL_MS, "failsafe follows the window, not the 6h game limit");
  // Six hours of games — past the single-game runtime limit — still live.
  await slate([{ id: "401001", status: "in_progress", startDate: iso(K1) }, { id: "401002", status: "in_progress", startDate: iso(K2) }]);
  await minute(6 * 60);
  assert.equal(phase(id), "live");
  // One game final, the other still on: stays live.
  await slate([{ id: "401001", status: "final", startDate: iso(K1) }, { id: "401002", status: "in_progress", startDate: iso(K2) }]);
  await minute(5);
  assert.equal(phase(id), "live");
  await slate([{ id: "401001", status: "final", startDate: iso(K1) }, { id: "401002", status: "final", startDate: iso(K2) }]);
  await minute();
  assert.equal(phase(id), "postgame");
  await minute(14);
  assert.equal(phase(id), "postgame");
  await until(() => phase(id) === "completed", 5);
  assert.equal(rec(id).auto.endReason, "every game final");
  const iComplete = w.events.indexOf(`yt-complete:yt-${id}`);
  const iStop = w.events.indexOf(`worker-stop:${id}`);
  assert.ok(iComplete >= 0 && iStop > iComplete, w.events.join(","));
  assert.equal(rec(id).status, "ended");
});

test("national: the window's end ends it even with games on; it never waits on a game after the window", async () => {
  await slate([{ id: "401001", status: "scheduled", startDate: iso(K1) }]);
  const id = (await national({ endAt: iso(K1 + 3 * 60 * MIN) })).id;
  await until(() => phase(id) === "live", 60);
  await slate([{ id: "401001", status: "in_progress", startDate: iso(K1) }]);
  await until(() => phase(id) === "ending", 4 * 60);
  assert.ok(clock >= K1 + 3 * 60 * MIN);
  assert.equal(rec(id).auto.endReason, "coverage window ended");
  await until(() => phase(id) === "completed", 6);
  await assert.rejects(orch.retryGame(db, "admin1", { id }), /Only a failed or cancelled/);
});

test("national: a window whose end passes before it starts fails; retry is refused once it's over", async () => {
  await slate([]);
  const id = (await national({ startAt: iso(clock + 120 * MIN), endAt: iso(clock + 150 * MIN) })).id;
  await orch.cancelGame(db, "admin1", { id });
  await minute();
  assert.equal(phase(id), "cancelled");
  clock += 200 * MIN;
  await assert.rejects(orch.retryGame(db, "admin1", { id }, clock), /window is over/);
});

test("nationalDone: games in progress or still to kick off in the window hold it open", () => {
  const now = K1;
  const end = K1 + 5 * 60 * MIN;
  const g = (status, k) => ({ status, startDate: iso(k) });
  assert.equal(orch.nationalDone(null, end, now), false, "no slate is unknown, not done");
  assert.equal(orch.nationalDone({ games: [] }, end, now), true);
  assert.equal(orch.nationalDone({ games: [g("in_progress", K1)] }, end, now), false);
  assert.equal(orch.nationalDone({ games: [g("scheduled", K1 + 60 * MIN)] }, end, now), false);
  assert.equal(orch.nationalDone({ games: [g("scheduled", end + MIN)] }, end, now), true, "after the window doesn't count");
  assert.equal(orch.nationalDone({ games: [g("scheduled", K1 - 7 * 60 * MIN)] }, end, now), true, "postponed doesn't count");
  assert.equal(orch.nationalDone({ games: [g("final", K1)] }, end, now), true);
});

test("national: desired worker opens /broadcast/national", () => {
  const ws = orch.desiredWorkers([{ id: `n${K1}`, kind: "national", gameSlug: "national", gameId: null, auto: { open: true, enabled: true, phase: "live", slot: 0, deadlineAt: K1 } }]);
  assert.deepEqual(ws, [{ id: `n${K1}`, game: "national", slot: 0, deadlineAt: K1 }]);
});

test("nothing logged contains a token", () => {
  for (const l of logs) assert.ok(!l.includes("yt-access-token-never-logged"), l);
  console.log = realLog;
});
