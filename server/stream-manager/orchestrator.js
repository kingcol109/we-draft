// server/stream-manager/orchestrator.js
//
// Automated We-Draft Live broadcasts for games an admin explicitly enabled
// in Stream Manager → Auto Broadcasts. Nothing here runs on its own clock:
//
//   api/stream-orchestrator.js   Vercel Cron, every minute → runTick()
//   api/broadcast-agent.js       the VM agent's 10s poll → agentReport()
//   api/stream-manager.js        admin actions → selectGame / cancelGame /
//                                retryGame / setConfig
//
// runTick() is a reconciler: it reads Firestore, the VM's state and YouTube,
// moves each enabled broadcast at most one phase forward, and writes the
// result back. A crashed or skipped tick loses nothing — the next one picks
// up from Firestore. A lease (streamManagerPrivate/orchestratorLock) keeps
// two ticks from overlapping, and the tick is the only writer of
// auto.phase; admin actions leave requests (cancelRequested) or touch only
// closed records (retry), so they can't race it.
//
// Data (reused, not copied):
//   schedule26/{scheduleId}      the saved CFB schedule — KickoffAt, Final,
//                                Slug, CFBDGameId (kept current by the CFBD sync)
//   liveGames/{CFBDGameId}       live status: scheduled | in_progress | final
//   broadcasts/{id}.auto         this module's state (below)
//   streamManager/orchestrator   slots, capacity, VM ownership, last tick (admin-readable)
//   streamManager/agent          the VM agent's last report (admin-readable)
//
// broadcasts/{id}.auto:
//   enabled, open (non-terminal → ticked), active (holds a slot / needs the VM)
//   scheduleId, phase, phaseAt, slot, kickoffAt, prepAt
//   workerStartedAt, deadlineAt (hard max runtime), liveAt, finalSeenAt
//   youtubeDone, youtubeDoneAt, endReason, completedAt
//   error, errorAt, errors, waiting (a non-error "what it's waiting on")
//   cancelRequested, selectedBy, selectedAt
//
// Phases: selected → preparing → vm → worker → ingest → going-live → live
//         → postgame → ending → completed;  failed / cancelled (retryable)
//
// Stream slots: a reusable YouTube stream (one key) carries one feed at a
// time, so each concurrent broadcast needs its own slot. Slot i is
// slotStreamIds[i] (default: the Channel's worker stream as slot 0) and its
// key lives only on the VM (~/.we-draft/youtube-key, youtube-key-1, …).
// capacity = min(slots, maxConcurrent).
//
// Logs: phase changes and VM actions with record ids — never tokens or keys.

const crypto = require("crypto");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { httpError } = require("./youtube");

const CFG = {
  PREP_LEAD_MS: 15 * 60e3,          // preparation starts this long before kickoff
  POSTGAME_MS: 15 * 60e3,           // stay on air this long after FINAL
  MAX_RUNTIME_MS: 6 * 3600e3,       // hard failsafe from worker start
  VM_READY_TIMEOUT_MS: 10 * 60e3,   // VM running + agent reporting
  WORKER_START_TIMEOUT_MS: 5 * 60e3,
  INGEST_TIMEOUT_MS: 5 * 60e3,      // YouTube sees the stream
  GO_LIVE_TIMEOUT_MS: 5 * 60e3,
  ENDING_TIMEOUT_MS: 3 * 60e3,      // worker stop after YouTube complete
  AGENT_FRESH_MS: 60e3,
  IDLE_STOP_MS: 10 * 60e3,          // an orchestrator-started VM idles this long before stopping
  KEEP_WARM_MS: 45 * 60e3,          // …unless a selected game prepares within this
  MISSED_MS: 4 * 3600e3,            // too late to start after kickoff + this
  MAX_ERRORS: 5,                    // consecutive failures of one step before giving up
  LOCK_MS: 70e3,                    // > the function's 60s maxDuration, so a lease never expires under a live tick
  HOLD_MS: 30 * 60e3,               // an admin's forced manual stop pauses auto VM starts
  MAX_SLOTS: 6,
};

const TERMINAL = ["completed", "failed", "cancelled"];
// A step that keeps throwing still gives up when its phase times out.
const PHASE_TIMEOUTS = { vm: CFG.VM_READY_TIMEOUT_MS, worker: CFG.WORKER_START_TIMEOUT_MS, ingest: CFG.INGEST_TIMEOUT_MS, "going-live": CFG.GO_LIVE_TIMEOUT_MS };
const ACTIVE = ["preparing", "vm", "worker", "ingest", "going-live", "live", "postgame", "ending"]; // hold a slot, need the VM
const RUN_WORKER = ["worker", "ingest", "going-live", "live", "postgame"];

const ORCH = "streamManager/orchestrator";
const AGENT = "streamManager/agent";
const LOCK = "streamManagerPrivate/orchestratorLock";

const toMs = (v) => (v?.toMillis ? v.toMillis() : v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v) || null);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;
const ID_RE = /^[A-Za-z0-9]{1,40}$/;

// The slug the worker opens (/broadcast/:slug?mode=stream) — the /live slug,
// else the CFBD id, which the broadcast route also accepts.
const workerGame = (r) => (SLUG_RE.test(r.gameSlug || "") ? r.gameSlug : /^\d{1,20}$/.test(String(r.gameId || "")) ? String(r.gameId) : null);

function slotsOf(orch = {}, ytSettings = {}) {
  const ids = Array.isArray(orch.slotStreamIds) && orch.slotStreamIds.length ? orch.slotStreamIds
    : ytSettings.workerStreamId ? [ytSettings.workerStreamId] : [];
  const capacity = Math.min(ids.length, Math.max(1, Number(orch.maxConcurrent) || 1));
  return { ids, capacity };
}

// What the VM agent should be running right now (also the agent's answer).
// A disabled record (auto.enabled false) never gets a worker, except to
// finish an ending that's already completing YouTube.
function desiredWorkers(records) {
  return records
    .filter((r) => r.auto?.open && r.auto.slot != null && (r.auto.enabled !== false || r.auto.phase === "ending")
      && (RUN_WORKER.includes(r.auto.phase) || (r.auto.phase === "ending" && !r.auto.youtubeDone)))
    .map((r) => ({ id: r.id, game: workerGame(r), slot: r.auto.slot, deadlineAt: r.auto.deadlineAt || null }))
    .filter((w) => w.game && ID_RE.test(w.id));
}

// ── One record, one step ──

async function step(r, ctx) {
  const a = r.auto || {};
  const now = ctx.now;
  const phase = a.phase || "selected";
  const p = {}; // auto.* changes
  const y = {}; // youtube.* changes
  const to = (next, more = {}) => Object.assign(p, { phase: next, phaseAt: now, error: null, errors: 0, waiting: null }, more);
  const fail = (msg) => to("failed", { error: msg, errorAt: now, slot: null });
  const since = now - (a.phaseAt || now);

  const sched = ctx.schedules.get(a.scheduleId);
  const game = ctx.games.get(String(r.gameId));
  const kickoff = toMs(sched?.KickoffAt) || a.kickoffAt || null;
  if (kickoff !== (a.kickoffAt ?? null)) Object.assign(p, { kickoffAt: kickoff, prepAt: kickoff ? kickoff - CFG.PREP_LEAD_MS : null });
  const prepAt = kickoff ? kickoff - CFG.PREP_LEAD_MS : null;
  const final = game?.status === "final";

  const syncYoutube = (b) => {
    if (!b) return;
    Object.assign(y, { lifecycleStatus: b.lifeCycleStatus, privacyStatus: b.privacyStatus, actualStartTime: b.actualStartTime, actualEndTime: b.actualEndTime });
  };
  // ready → testing (the default: monitor stream on). Only when YouTube
  // says testing itself isn't allowed for this broadcast (invalidTransition
  // — monitor stream off) does it go straight to live; "already testing"
  // (redundantTransition) is fine; anything else is a real error. YouTube
  // itself refuses testing/live unless the bound stream is active.
  const startTesting = async () => {
    try {
      syncYoutube(await ctx.transition(r.youtube.broadcastId, "testing"));
    } catch (e) {
      if (/redundantTransition/.test(e.message)) return;
      if (!/invalidTransition/.test(e.message)) throw e;
      syncYoutube(await ctx.transition(r.youtube.broadcastId, "live"));
    }
  };

  // Admin asked to stop this game (or it was disabled some other way).
  if (a.cancelRequested || (a.enabled === false && !TERMINAL.includes(phase))) {
    p.cancelRequested = false;
    if (phase === "ending") return { p, y };
    // A worker may be up (and YouTube testing/live): end it the normal way.
    if (RUN_WORKER.includes(phase)) return { p: to("ending", { endReason: "ended by admin", cancelRequested: false }), y };
    return { p: to("cancelled", { slot: null, cancelRequested: false }), y };
  }

  // Hard failsafe, whatever the game status says.
  if (a.deadlineAt && now >= a.deadlineAt && RUN_WORKER.includes(phase)) {
    to("ending", { endReason: "max runtime" });
    p.error = `Hit the ${Math.round(CFG.MAX_RUNTIME_MS / 3600e3)}h maximum runtime — ended automatically.`;
    p.errorAt = now;
    return { p, y };
  }

  switch (phase) {
    case "selected": {
      if (!kickoff) { p.waiting = "Kickoff time isn't set in the CFB schedule yet."; break; }
      if (final || sched?.Final) { fail("The game was already final before the broadcast started."); break; }
      if (now > kickoff + CFG.MISSED_MS) { fail("Missed — the game kicked off over 4h ago and was never prepared."); break; }
      if (now >= prepAt) to("preparing");
      else if (a.waiting) p.waiting = null;
      break;
    }

    case "preparing": {
      let slot = a.slot ?? null;
      if (slot == null) {
        slot = ctx.takeSlot(r.youtube?.streamId);
        if (slot == null) {
          if (kickoff && now > kickoff + CFG.MISSED_MS) { fail("No stream slot came free in time."); break; }
          p.waiting = `Waiting for a free stream slot — all ${ctx.capacity} in use${ctx.capacity ? "" : " (none configured: pick a Worker Stream in Channel)"}.`;
          break;
        }
        p.slot = slot;
      }
      const streamId = ctx.slots[slot];
      if (!game) throw httpError(409, "The game isn't in We-Draft Live (liveGames) yet — the live ingester adds this week's games.");
      const yt = r.youtube || {};
      if (yt.broadcastId && ["complete", "revoked"].includes(yt.lifecycleStatus)) throw httpError(409, "This record's YouTube broadcast already ended — Retry creates a new one.");
      if (!(yt.broadcastId && yt.streamId === streamId)) {
        // A new YouTube broadcast needs a scheduled start in the future.
        if (!yt.broadcastId && (toMs(r.scheduledStart) || 0) < now + 2 * 60e3) await ctx.setScheduledStart(r.id, Math.max(kickoff || 0, now + 3 * 60e3));
        await ctx.youtubeCreate(r.id, streamId);
      }
      to("vm", { slot });
      break;
    }

    case "vm": {
      if (ctx.vmReady) { to("worker", { workerStartedAt: now, deadlineAt: now + CFG.MAX_RUNTIME_MS }); break; }
      if (since > CFG.VM_READY_TIMEOUT_MS) {
        fail(ctx.vm?.state === "running"
          ? "The VM is running but its broadcast agent isn't reporting — check `systemctl status we-draft-agent` on the VM."
          : `The VM didn't come up within ${CFG.VM_READY_TIMEOUT_MS / 60e3} min (state: ${ctx.vm?.state || "unknown"}).`);
        break;
      }
      p.waiting = ctx.vmHeld ? "The VM was stopped manually — automatic starts are paused for 30 min (Start VM resumes)."
        : ctx.vm?.state === "running" ? "VM running — waiting for the broadcast agent." : "Starting the VM…";
      break;
    }

    case "worker": {
      const c = ctx.containers.get(r.id);
      if (c?.state === "running") { to("ingest"); break; }
      if (c?.state === "exited" && c.exitCode === 2) { fail("The worker refused its settings (exit 2) — check YOUTUBE_STREAM_URL and this slot's key file on the VM."); break; }
      if (c?.error === "no-image") { fail("The worker Docker image isn't on the VM — build it (server/broadcast-agent/README.md)."); break; }
      if (c?.error === "no-key") { fail(`The VM has no key file for stream slot ${a.slot} — see server/broadcast-agent/README.md.`); break; }
      if (since > CFG.WORKER_START_TIMEOUT_MS) { fail(`The worker didn't start within ${CFG.WORKER_START_TIMEOUT_MS / 60e3} min${c ? ` (last state: ${c.state})` : ""}.`); break; }
      p.waiting = c ? `Worker ${c.state}…` : "Waiting for the agent to launch the worker…";
      break;
    }

    case "ingest": {
      const st = await ctx.getStream(ctx.slots[a.slot]);
      Object.assign(y, { streamStatus: st?.streamStatus || null, healthStatus: st?.healthStatus || null });
      if (st?.streamStatus === "active") { await startTesting(); to("going-live"); break; }
      if (since > CFG.INGEST_TIMEOUT_MS) { fail(`YouTube never received the worker's stream (status: ${st?.streamStatus || "unknown"}) — check that slot ${a.slot}'s key file on the VM belongs to stream “${st?.title || ctx.slots[a.slot]}”.`); break; }
      p.waiting = `Waiting for YouTube to receive the stream (${st?.streamStatus || "?"}).`;
      break;
    }

    case "going-live": {
      const b = await ctx.getBroadcast(r.youtube.broadcastId);
      syncYoutube(b);
      const lc = b?.lifeCycleStatus;
      if (lc === "live") { to("live", { liveAt: now }); break; }
      if (!b || lc === "complete" || lc === "revoked") { fail("The YouTube broadcast was deleted or ended outside Stream Manager."); break; }
      if (since > CFG.GO_LIVE_TIMEOUT_MS) { fail(`YouTube didn't go live within ${CFG.GO_LIVE_TIMEOUT_MS / 60e3} min (lifecycle: ${lc}).`); break; }
      if (lc === "testing") syncYoutube(await ctx.transition(r.youtube.broadcastId, "live"));
      else if (lc === "ready") await startTesting();
      p.waiting = `Going live (YouTube: ${lc})…`;
      break;
    }

    case "live":
    case "postgame": {
      // A YouTube read failing (quota, revoked auth, outage) must not stop
      // the FINAL / postgame logic — the game still ends on time.
      let b, ytErr = null;
      try { b = await ctx.getBroadcast(r.youtube.broadcastId); syncYoutube(b); } catch (e) { ytErr = String(e.message || e).slice(0, 150); }
      if (!ytErr && (!b || ["complete", "revoked"].includes(b.lifeCycleStatus))) { to("ending", { endReason: "ended on YouTube", youtubeDone: true, youtubeDoneAt: now }); break; }
      const c = ctx.containers.get(r.id);
      const note = !ctx.vmReady ? "VM or agent unavailable — recovering."
        : c?.state !== "running" ? "Worker isn't running — the agent is restarting it."
        : ytErr ? `Can't read YouTube status (${ytErr}) — still on air.` : null;
      if (phase === "live") {
        if (final) { to("postgame", { finalSeenAt: now }); break; }
        if (note !== (a.waiting ?? null)) p.waiting = note;
        break;
      }
      // A FINAL that's taken back (stat correction) puts the game back on air.
      if (!final) { to("live", { finalSeenAt: null, waiting: "The game left FINAL — back to live." }); break; }
      if (now >= a.finalSeenAt + CFG.POSTGAME_MS) { to("ending", { endReason: "game final" }); break; }
      p.waiting = note || `Final — ending at ${new Date(a.finalSeenAt + CFG.POSTGAME_MS).toISOString()}.`;
      break;
    }

    case "ending": {
      if (!a.youtubeDone) {
        // YouTube first, then the worker, so the stream never shows a dead feed.
        try {
          const b = r.youtube?.broadcastId ? await ctx.getBroadcast(r.youtube.broadcastId) : null;
          syncYoutube(b);
          if (b && ["live", "testing"].includes(b.lifeCycleStatus)) syncYoutube(await ctx.transition(b.id, "complete"));
          Object.assign(p, { youtubeDone: true, youtubeDoneAt: now, waiting: "Stopping the worker…" });
        } catch (e) {
          const errors = (a.errors || 0) + 1;
          if (errors < CFG.MAX_ERRORS) throw e;
          Object.assign(p, { youtubeDone: true, youtubeDoneAt: now, errors, error: `Couldn't complete the YouTube broadcast (${e.message}) — end it in YouTube Studio.`, errorAt: now });
        }
        break;
      }
      const c = ctx.containers.get(r.id);
      const stopped = !c || c.state !== "running" || !ctx.vmReady;
      // The stop wait counts from when YouTube was done, not from the
      // start of ending (completing may have taken a few retries).
      if (stopped || now - (a.youtubeDoneAt || a.phaseAt || now) > CFG.ENDING_TIMEOUT_MS) {
        // Never on air (cancelled while starting) → cancelled, so it can be retried.
        to(a.liveAt ? "completed" : "cancelled", { completedAt: now, slot: null });
        // Keep a failsafe / YouTube note, and add the worker one if needed.
        const notes = [a.error, !stopped && "The worker didn't confirm it stopped — check the VM."].filter(Boolean);
        if (notes.length) Object.assign(p, { error: notes.join(" "), errorAt: now });
      }
      break;
    }

    default:
      break;
  }
  return { p, y };
}

// ── Tick ──

function realDeps() {
  return {
    now: () => Date.now(),
    compute: require("./compute"),
    yt: require("./youtube"),
    bc: require("./broadcasts"),
    log: (m) => console.log(`stream-orchestrator ${m}`),
  };
}

// Returns this tick's owner id, or null when another tick holds the lease.
async function lock(db, now) {
  const ref = db.doc(LOCK);
  const owner = crypto.randomBytes(8).toString("hex");
  return db.runTransaction(async (tx) => {
    const l = (await tx.get(ref)).data();
    if (l?.until > now) return null;
    tx.set(ref, { until: now + CFG.LOCK_MS, owner });
    return owner;
  });
}

// Only the tick that holds the lease releases it.
async function unlock(db, owner) {
  const ref = db.doc(LOCK);
  await db.runTransaction(async (tx) => {
    const l = (await tx.get(ref)).data();
    if (l?.owner === owner) tx.set(ref, { until: 0, owner: null });
  });
}

async function runTick(db, deps = realDeps()) {
  const now = deps.now();
  const owner = await lock(db, now);
  if (!owner) return { skipped: "another tick is running" };
  const summary = { at: now, records: 0, changes: [], vm: null, errors: [] };
  try {
    const [orchSnap, agentSnap, ytSnap, recSnap] = await Promise.all([
      db.doc(ORCH).get(), db.doc(AGENT).get(), db.doc(deps.yt.SETTINGS.join("/")).get(),
      db.collection("broadcasts").where("auto.open", "==", true).get(),
    ]);
    const orch = orchSnap.data() || {};
    const agent = agentSnap.data() || {};
    const records = recSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
      .sort((x, z) => (x.auto?.kickoffAt || 9e15) - (z.auto?.kickoffAt || 9e15));
    summary.records = records.length;

    const schedules = new Map();
    const games = new Map();
    await Promise.all(records.map(async (r) => {
      if (r.auto?.scheduleId) schedules.set(r.auto.scheduleId, (await db.collection("schedule26").doc(r.auto.scheduleId).get()).data());
      if (r.gameId) games.set(String(r.gameId), (await db.collection("liveGames").doc(String(r.gameId)).get()).data());
    }));

    const soon = (r) => r.auto?.phase === "selected" && r.auto.kickoffAt && r.auto.kickoffAt - CFG.PREP_LEAD_MS - now <= CFG.KEEP_WARM_MS && now - r.auto.kickoffAt < CFG.MISSED_MS;
    const needsVmNow = () => records.some((r) => ACTIVE.includes(r.auto?.phase));

    // The VM (only asked about when it matters).
    let vm = null;
    if (needsVmNow() || records.some(soon) || orch.vmOwned) {
      try { vm = (await deps.compute.status()).instance; } catch (e) { summary.errors.push(`vm-status: ${e.message}`); }
    }
    const agentFresh = !!agent.lastSeenAt && now - agent.lastSeenAt < CFG.AGENT_FRESH_MS;
    const containers = new Map((agentFresh ? agent.containers || [] : []).map((c) => [c.id, c]));
    const vmHeld = (orch.vmHoldUntil || 0) > now;

    const { ids: slots, capacity } = slotsOf(orch, ytSnap.data() || {});
    const used = new Set(records.filter((r) => ACTIVE.includes(r.auto?.phase) && r.auto.slot != null).map((r) => r.auto.slot));
    const takeSlot = (preferStreamId) => {
      const free = [...Array(capacity).keys()].filter((i) => !used.has(i));
      const pick = free.find((i) => slots[i] === preferStreamId) ?? free[0];
      if (pick == null) return null;
      used.add(pick);
      return pick;
    };

    let token = null;
    const tok = async () => (token ||= await deps.yt.accessToken(db));
    const ctx = {
      now, db, vm, vmHeld, containers, slots, capacity, takeSlot, schedules, games,
      vmReady: vm?.state === "running" && agentFresh,
      getStream: async (id) => deps.yt.getStream(await tok(), id),
      getBroadcast: async (id) => deps.yt.getBroadcast(await tok(), id),
      transition: async (id, to) => deps.yt.transitionBroadcast(await tok(), id, to),
      youtubeCreate: (id, streamId) => deps.bc.youtubeCreate(db, { id, streamId }),
      setScheduledStart: (id, ms) => db.collection("broadcasts").doc(id).update({ scheduledStart: Timestamp.fromMillis(ms) }),
    };

    for (const r of records) {
      const a = r.auto || {};
      let out;
      try {
        out = await step(r, ctx);
      } catch (e) {
        // A failed step is retried next tick; repeated failures of the
        // preparing step give up (later phases have their own timeouts).
        const errors = (a.errors || 0) + 1;
        const msg = String(e.message || e).slice(0, 300);
        out = { p: { errors, error: msg, errorAt: now }, y: {} };
        const limit = PHASE_TIMEOUTS[a.phase];
        if ((a.phase === "preparing" && errors >= CFG.MAX_ERRORS) || (limit && now - (a.phaseAt || now) > limit)) {
          Object.assign(out.p, { phase: "failed", phaseAt: now, slot: null, waiting: null });
        }
        summary.errors.push(`${r.id}: ${msg}`);
      }
      const { p, y } = out;
      if (!Object.keys(p).length && !Object.keys(y).length) continue;
      const phase = p.phase || a.phase;
      if (p.phase && p.phase !== a.phase) {
        p.open = !TERMINAL.includes(p.phase);
        p.active = ACTIVE.includes(p.phase);
        if (p.phase === "cancelled") p.enabled = false; // disabled until an admin retries
        if (!p.open && a.slot != null) used.delete(a.slot);
        summary.changes.push(`${r.id}: ${a.phase} → ${p.phase}`);
        deps.log(`${r.id} ${a.phase} → ${p.phase}${p.error ? ` (${p.error})` : ""}`);
      }
      Object.assign(r.auto, p); // later decisions this tick see it
      const upd = { updatedAt: FieldValue.serverTimestamp() };
      for (const [k, v] of Object.entries(p)) upd[`auto.${k}`] = v === undefined ? null : v;
      for (const [k, v] of Object.entries(y)) upd[`youtube.${k}`] = v === undefined ? null : v;
      const merged = { ...r, auto: r.auto, youtube: { ...r.youtube, ...y } };
      upd.status = deps.bc.deriveStatus(merged);
      if (phase === "completed" || phase === "cancelled" || phase === "failed") upd["worker.status"] = phase === "failed" ? "error" : "stopped";
      await r.ref.update(upd);
    }

    // ── VM: start when needed, stop only when nothing needs it ──
    const orchUpd = {};
    const needVm = needsVmNow();
    const warm = records.some(soon);
    if (vm) summary.vm = vm.state;
    if (needVm) {
      orchUpd.vmIdleSince = null;
      if (vm?.state === "stopped" && !vmHeld) {
        try {
          await deps.compute.start("orchestrator");
          orchUpd.vmOwned = true;
          summary.vm = "start requested";
          deps.log("vm start (broadcasts need it)");
        } catch (e) { summary.errors.push(`vm-start: ${e.message}`); }
      }
    } else if (!warm && orch.vmOwned && vm && ["running", "starting"].includes(vm.state)) {
      const idleSince = orch.vmIdleSince || now;
      orchUpd.vmIdleSince = idleSince;
      if (now - idleSince >= CFG.IDLE_STOP_MS) {
        try {
          // Never confirmLive: compute.stop's own live guard stays in force.
          await deps.compute.stop(db, "orchestrator", {});
          Object.assign(orchUpd, { vmOwned: false, vmIdleSince: null });
          summary.vm = "stop requested";
          deps.log("vm stop (idle, nothing scheduled soon)");
        } catch (e) { summary.errors.push(`vm-stop: ${e.message}`); }
      }
    } else {
      orchUpd.vmIdleSince = null;
      if (vm?.state === "stopped" && orch.vmOwned) orchUpd.vmOwned = false;
    }
    await db.doc(ORCH).set({ ...orchUpd, lastTickAt: now, lastTick: summary }, { merge: true });
    return summary;
  } finally {
    await unlock(db, owner);
  }
}

// ── Agent ──

const C_STATES = ["created", "running", "restarting", "exited", "dead", "missing", "removing", "paused"];

function cleanReport(body) {
  const list = Array.isArray(body?.containers) ? body.containers : [];
  if (list.length > 20) throw httpError(400, "Too many containers in the report.");
  return list.map((c) => {
    if (!ID_RE.test(String(c?.id || ""))) throw httpError(400, "Bad container id in the report.");
    return {
      id: String(c.id),
      state: C_STATES.includes(c.state) ? c.state : "unknown",
      exitCode: Number.isInteger(c.exitCode) ? c.exitCode : null,
      restarts: Number.isInteger(c.restarts) ? Math.min(c.restarts, 1e6) : 0,
      error: ["no-image", "no-key", "launch-failed"].includes(c.error) ? c.error : null,
      slot: Number.isInteger(c.slot) ? c.slot : null,
    };
  });
}

const WORKER_STATUS = { running: "running", created: "starting", restarting: "starting", paused: "error", exited: "error", dead: "error", missing: "starting" };

// The agent's poll: record what it's running, answer with what it should run.
async function agentReport(db, body, now = Date.now()) {
  const containers = cleanReport(body);
  const host = body?.host && typeof body.host === "object" ? {
    version: String(body.host.version || "").slice(0, 20) || null,
    load1: Number.isFinite(body.host.load1) ? body.host.load1 : null,
    memFreeMb: Number.isFinite(body.host.memFreeMb) ? body.host.memFreeMb : null,
    cpus: Number.isInteger(body.host.cpus) ? body.host.cpus : null,
  } : null;
  await db.doc(AGENT).set({ lastSeenAt: now, containers, host }, { merge: false });

  // Only records that hold a slot can need a worker (every 10s — keep it small).
  const recs = (await db.collection("broadcasts").where("auto.active", "==", true).get()).docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
  const byId = new Map(containers.map((c) => [c.id, c]));
  await Promise.all(recs.filter((r) => ACTIVE.includes(r.auto?.phase)).map((r) => {
    const c = byId.get(r.id);
    const status = c ? (c.state === "exited" && c.exitCode === 0 ? "stopped" : WORKER_STATUS[c.state] || "error") : RUN_WORKER.includes(r.auto.phase) ? "starting" : "idle";
    const w = r.worker || {};
    const error = c && status === "error" ? `Worker ${c.state}${c.exitCode != null ? ` (exit ${c.exitCode})` : ""}${c.restarts ? ` — restarted ${c.restarts}×` : ""}` : null;
    if (w.status === status && (w.error || null) === error && now - (w.lastHeartbeat || 0) < 30e3) return null;
    return r.ref.update({
      "worker.status": status,
      "worker.error": error,
      "worker.lastHeartbeat": now,
      "worker.instanceId": c ? `wd-bc-${r.id}` : w.instanceId || null,
      ...(status === "running" && w.status !== "running" ? { "worker.startedAt": now } : {}),
      ...(status === "stopped" && w.status !== "stopped" ? { "worker.stoppedAt": now } : {}),
    });
  }));
  return { desired: desiredWorkers(recs), pollSec: 10 };
}

// ── Admin actions ──

async function selectGame(db, uid, body, now = Date.now()) {
  const bc = require("./broadcasts");
  const scheduleId = String(body.scheduleId || "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(scheduleId)) throw httpError(400, "Pick a game from the schedule.");
  const s = (await db.collection("schedule26").doc(scheduleId).get()).data();
  if (!s) throw httpError(404, "That game isn't in the CFB schedule.");
  const gameId = String(s.CFBDGameId ?? "");
  if (!/^\d{1,20}$/.test(gameId)) throw httpError(400, "This game isn't linked to We-Draft Live (no CFBD game id) — set it in Admin → CFB Schedule.");
  if (s.Final) throw httpError(400, "That game is already final.");
  const kickoff = toMs(s.KickoffAt);
  if (kickoff && now > kickoff + CFG.MISSED_MS) throw httpError(400, "That game was played already.");
  const privacyStatus = bc.cleanPrivacy(body.privacyStatus || "unlisted", body.confirmPublic);

  const freshAuto = {
    enabled: true, open: true, active: false, scheduleId, phase: "selected", phaseAt: now,
    slot: null, kickoffAt: kickoff || null, prepAt: kickoff ? kickoff - CFG.PREP_LEAD_MS : null,
    workerStartedAt: null, deadlineAt: null, liveAt: null, finalSeenAt: null,
    youtubeDone: false, endReason: null, completedAt: null,
    error: null, errorAt: null, errors: 0, waiting: null, cancelRequested: false,
    selectedBy: uid, selectedAt: now,
  };

  return db.runTransaction(async (tx) => {
    const existing = (await tx.get(db.collection("broadcasts").where("gameId", "==", gameId))).docs;
    const live = (await tx.get(db.collection("liveGames").doc(gameId))).data();
    for (const d of existing) {
      const x = d.data();
      if (x.auto?.open) return { id: d.id, already: true };
    }
    // An existing record for this game is reused, never duplicated — but not
    // one that's already on YouTube's air (or testing): that stays manual.
    const reuse = existing.find((d) => d.data().status !== "ended" && d.data().auto?.phase !== "completed");
    if (reuse && ["testStarting", "testing", "liveStarting", "live"].includes(reuse.data().youtube?.lifecycleStatus)) {
      throw httpError(409, "This game already has a broadcast on YouTube that's testing or live — finish it manually before enabling automation.");
    }
    if (reuse) {
      tx.update(reuse.ref, { auto: freshAuto, updatedAt: FieldValue.serverTimestamp() });
      return { id: reuse.id, adopted: true };
    }
    if (existing.length) throw httpError(409, "This game was already broadcast.");

    const team = (lg, name) => ({ school: lg?.school || name || null, short: lg?.short || null, logo: lg?.logo || null, color: lg?.color || null, rank: lg?.rank ?? null });
    const g = { home: { school: s.Home }, away: { school: s.Away }, slug: s.Slug, providerGameId: gameId };
    const ref = db.collection("broadcasts").doc(`g${gameId}`);
    tx.set(ref, {
      gameId, gameSlug: s.Slug || live?.slug || null,
      homeTeam: team(live?.home, s.Home), awayTeam: team(live?.away, s.Away),
      kickoff: kickoff ? new Date(kickoff).toISOString() : null,
      scheduledStart: Timestamp.fromMillis(kickoff || now + 24 * 3600e3),
      status: "scheduled",
      youtube: {
        title: bc.defaultTitle(g).slice(0, 100), description: bc.defaultDescription(g), privacyStatus,
        broadcastId: null, videoId: null, streamId: null, channelId: null,
        lifecycleStatus: null, streamStatus: null, healthStatus: null, lastSyncedAt: null, error: null, creatingAt: null,
      },
      worker: { status: "idle", instanceId: null, startedAt: null, stoppedAt: null, lastHeartbeat: null, error: null },
      auto: freshAuto,
      createdBy: uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    return { id: ref.id, created: true };
  });
}

// Disable a selected game. One that's on air needs confirmEnd: true, and
// then ends through the normal path (YouTube complete, worker stop).
async function cancelGame(db, uid, body) {
  const bc = require("./broadcasts");
  const { ref, data } = await bc.loadRecord(db, body.id);
  const a = data.auto;
  if (!a?.open) throw httpError(400, "That broadcast isn't scheduled for automation.");
  if (["live", "postgame"].includes(a.phase) && body.confirmEnd !== true) {
    throw httpError(409, "This broadcast is on air — disabling it ends the YouTube broadcast and stops its worker. Send confirmEnd: true to end it.");
  }
  await ref.update({ "auto.cancelRequested": true, "auto.cancelledBy": uid, updatedAt: FieldValue.serverTimestamp() });
  console.log(`stream-manager auto-cancel uid=${uid} id=${body.id} phase=${a.phase}`);
  return { ok: true, phase: a.phase };
}

// Failed / cancelled → selected again. The tick never touches closed
// records, so this can write the phase directly.
async function retryGame(db, uid, body) {
  const bc = require("./broadcasts");
  const { ref } = await bc.loadRecord(db, body.id);
  return db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    const a = d.auto;
    if (!a || !["failed", "cancelled"].includes(a.phase)) throw httpError(409, "Only a failed or cancelled automatic broadcast can be retried.");
    const s = a.scheduleId ? (await tx.get(db.collection("schedule26").doc(a.scheduleId))).data() : null;
    if (s?.Final) throw httpError(400, "That game is already final.");
    const upd = {
      "auto.phase": "selected", "auto.phaseAt": Date.now(), "auto.open": true, "auto.active": false, "auto.enabled": true,
      "auto.slot": null, "auto.error": null, "auto.errorAt": null, "auto.errors": 0, "auto.waiting": null,
      "auto.workerStartedAt": null, "auto.deadlineAt": null, "auto.liveAt": null, "auto.finalSeenAt": null,
      "auto.youtubeDone": false, "auto.endReason": null, "auto.cancelRequested": false,
      "worker.error": null, "youtube.error": null, status: "scheduled", updatedAt: FieldValue.serverTimestamp(),
    };
    // A YouTube broadcast that already ended can't go live again.
    if (["complete", "revoked"].includes(d.youtube?.lifecycleStatus)) {
      Object.assign(upd, { "youtube.broadcastId": null, "youtube.videoId": null, "youtube.streamId": null, "youtube.lifecycleStatus": null });
    }
    tx.update(ref, upd);
    console.log(`stream-manager auto-retry uid=${uid} id=${body.id}`);
    return { ok: true };
  });
}

// Stream slots and capacity. Not while anything holds a slot.
async function setConfig(db, uid, body, deps = { yt: require("./youtube") }) {
  const ids = Array.isArray(body.slotStreamIds) ? body.slotStreamIds.map(String) : null;
  if (!ids || ids.length > CFG.MAX_SLOTS || ids.some((s) => !/^[A-Za-z0-9_-]{1,64}$/.test(s)) || new Set(ids).size !== ids.length) {
    throw httpError(400, `Stream slots must be up to ${CFG.MAX_SLOTS} different YouTube streams.`);
  }
  const maxConcurrent = Number(body.maxConcurrent);
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > CFG.MAX_SLOTS) throw httpError(400, `Max concurrent broadcasts must be 1–${CFG.MAX_SLOTS}.`);
  const active = await db.collection("broadcasts").where("auto.active", "==", true).limit(1).get();
  if (!active.empty) throw httpError(409, "A broadcast is in progress — change slots once it's finished.");
  if (ids.length) {
    const token = await deps.yt.accessToken(db);
    for (const id of ids) if (!(await deps.yt.getStream(token, id))) throw httpError(400, `Stream ${id} isn't on the connected channel.`);
  }
  await db.doc(ORCH).set({ slotStreamIds: ids, maxConcurrent, configuredBy: uid, configuredAt: Date.now() }, { merge: true });
  console.log(`stream-manager auto-config uid=${uid} slots=${ids.length} max=${maxConcurrent}`);
  return { ok: true };
}

// Manual VM buttons: a manual start hands the VM to the admin (the
// orchestrator won't idle-stop it); a forced stop during broadcasts pauses
// automatic starts for a while so the two don't fight.
async function noteManualVm(db, action, result, body = {}, now = Date.now()) {
  if (action === "vm-start" && result.result === "starting") await db.doc(ORCH).set({ vmOwned: false, vmHoldUntil: null, vmIdleSince: null }, { merge: true });
  if (action === "vm-stop" && result.result === "stopping") {
    await db.doc(ORCH).set({ vmOwned: false, vmIdleSince: null, ...(body.confirmLive === true ? { vmHoldUntil: now + CFG.HOLD_MS } : {}) }, { merge: true });
  }
}

module.exports = {
  CFG, ACTIVE, TERMINAL, RUN_WORKER, ORCH, AGENT,
  step, runTick, agentReport, desiredWorkers, slotsOf, workerGame,
  selectGame, cancelGame, retryGame, setConfig, noteManualVm,
  _lease: { lock, unlock }, // tests
};
