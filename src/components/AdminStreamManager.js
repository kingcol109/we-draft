// src/components/AdminStreamManager.js
//
// Admin → Stream Manager: the control plane for We-Draft Live YouTube
// broadcasts. The broadcast worker (server/broadcast-worker — Chromium →
// FFmpeg → RTMP) is the streaming engine; this is where broadcasts are
// planned, created on YouTube and watched.
//
//   Channel     the connected YouTube channel (OAuth, server-side) and the
//               worker stream every broadcast binds to
//   Worker VM   Compute Engine status / start / stop of the broadcast worker
//               VM (vm-* actions; Google Cloud is only ever called server-side)
//   Auto        Auto Schedule: enable games from the saved CFB schedule
//               (schedule26) for automatic broadcast, and edit each game's
//               YouTube title / description draft (Edit Metadata — saved
//               only, never activates anything) — run server-side by
//               server/stream-manager/orchestrator.js — and National
//               Coverage: /broadcast/national (every game's big plays and
//               storylines) for a time window, same automation
//   Broadcasts  broadcasts/{id} records, live from Firestore (admin read)
//   New         pick a liveGames game, title / description / visibility / start
//   Detail      GAME / YOUTUBE / WORKER panels + actions
//
// Every change goes through api/stream-manager.js (admin-checked); nothing
// here writes Firestore or sees a token or stream key. The per-broadcast
// worker controls are placeholders until the orchestration phase.
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { auth, db } from "../firebase";
import { LIMITS as YT_LIMITS, validateMetadata, charCount, byteCount } from "../utils/youtubeMetadata";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#0b1a2e";
const RED = "#c0392b";
const GREEN = "#2e9e4f";
const AMBER = "#e0a100";

// ── Status vocab ──
const OVERALL = {
  scheduled: { label: "Scheduled", color: "#b8c2cf" },
  preparing: { label: "Preparing", color: AMBER },
  live: { label: "Live", color: GREEN, pulse: true },
  ended: { label: "Ended", color: "#333" },
  cancelled: { label: "Cancelled", color: "#8a94a3" },
  rehearsal: { label: "Rehearsal", color: "#7b5ea7" },
  error: { label: "Error", color: RED },
};

// The overall status to show. Same as the stored one, except a cancelled
// automation still stored as scheduled/preparing (records saved before the
// cancelled status existed — "Repair Statuses" fixes the data itself).
export function overallStatus(b) {
  if (b?.auto?.phase === "cancelled" && ["scheduled", "preparing"].includes(b.status)) return "cancelled";
  return b?.status || "scheduled";
}
// Ended and cancelled broadcasts are done: they're listed under Ended and
// aren't counted as Scheduled or Upcoming.
export const isDone = (b) => ["ended", "cancelled"].includes(overallStatus(b));
export function filterBroadcasts(rows, filter) {
  const all = rows || [];
  if (filter === "all") return all;
  return filter === "upcoming"
    ? all.filter((b) => !isDone(b)).sort((a, b) => (ms(a.scheduledStart) || 0) - (ms(b.scheduledStart) || 0))
    : all.filter(isDone);
}
export function statusCounts(rows) {
  const c = { live: 0, preparing: 0, scheduled: 0, error: 0 };
  (rows || []).forEach((b) => { const s = overallStatus(b); if (c[s] != null) c[s]++; });
  return c;
}

function youtubeState(y = {}) {
  if (y.error) return { label: "Error", color: RED };
  if (!y.broadcastId) return { label: "Not created", color: "#b8c2cf" };
  switch (y.lifecycleStatus) {
    case "created": return { label: "Created", color: "#8aa4c8" };
    case "ready": return { label: "Ready", color: BLUE };
    case "testStarting": case "testing": return { label: "Testing", color: AMBER };
    case "liveStarting": case "live": return { label: "Live", color: GREEN, pulse: true };
    case "complete": return { label: "Complete", color: "#333" };
    case "revoked": return { label: "Revoked", color: "#333" };
    default: return { label: y.lifecycleStatus || "Unknown", color: "#b8c2cf" };
  }
}

// The API's values (status.healthStatus.status) — YouTube Studio shows "good" as "Excellent".
const HEALTH = { good: { label: "Good", color: GREEN }, ok: { label: "OK", color: AMBER }, bad: { label: "Bad", color: RED }, noData: { label: "No data", color: "#b8c2cf" } };
const health = (h) => HEALTH[h] || { label: h || "—", color: "#ddd" };

const WORKER = {
  idle: { label: "Not started", color: "#b8c2cf" },
  starting: { label: "Starting", color: AMBER },
  running: { label: "Running", color: GREEN, pulse: true },
  stopped: { label: "Stopped", color: "#333" },
  error: { label: "Error", color: RED },
};

const PRIVACY = [
  { key: "unlisted", label: "Unlisted", note: "Anyone with the link" },
  { key: "private", label: "Private", note: "Only the channel" },
  { key: "public", label: "Public", note: "Everyone — needs confirmation" },
];

// ── Helpers ──
const ms = (v) => (v?.toMillis ? v.toMillis() : typeof v === "number" ? v : Date.parse(v) || null);
const fmtDay = (t) => (t ? new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "—");
const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—");
const fmtFull = (t) => (t ? `${fmtDay(t)} · ${fmtTime(t)}` : "—");
const toLocalInput = (t) => (t ? new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const teamName = (t) => t?.school || t?.short || "TBD";
const isNational = (b) => b?.kind === "national";
const matchup = (b) => (isNational(b) ? "National Coverage" : `${teamName(b.awayTeam)} vs ${teamName(b.homeTeam)}`);
// Same defaults as server/stream-manager/broadcasts.js.
const defaultTitle = (g) => `We-Draft Live: ${teamName(g.away)} vs ${teamName(g.home)}`;
const defaultDescription = (g) =>
  `${teamName(g.away)} at ${teamName(g.home)} — live scores, play-by-play, stats and analysis from We-Draft Live.\n\nFollow along: https://we-draft.com/live/${g.slug || g.id}`;

async function api(action, payload = {}) {
  const token = await auth.currentUser?.getIdToken();
  const r = await fetch("/api/stream-manager", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 404) throw new Error("the Stream Manager API isn't deployed here (it runs on the live site, or locally under `vercel dev`).");
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
  return j;
}

const btn = (color = BLUE, solid = true, disabled = false) => ({
  padding: "9px 16px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.06em",
  border: `2px solid ${disabled ? "#ccc" : color}`, borderRadius: "8px", cursor: disabled ? "default" : "pointer",
  background: disabled ? "#f2f2f2" : solid ? color : "#fff", color: disabled ? "#aaa" : solid ? "#fff" : color,
  whiteSpace: "nowrap",
});
const input = { width: "100%", padding: "10px 12px", border: "2px solid #dde3ea", borderRadius: "8px", fontSize: "14px", fontFamily: "Arial, sans-serif", boxSizing: "border-box" };
const label = { fontSize: "11px", fontWeight: 900, color: "#667", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" };

function Dot({ color, pulse }) {
  return (
    <span style={{ position: "relative", display: "inline-block", width: 10, height: 10, flexShrink: 0 }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color }} />
      {pulse && <span style={{ position: "absolute", inset: -3, borderRadius: "50%", border: `2px solid ${color}`, animation: "smPulse 1.4s ease-out infinite" }} />}
    </span>
  );
}

function Pill({ s, small }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 7, padding: small ? "3px 9px" : "5px 11px",
      borderRadius: 999, background: "#f4f6f9", border: "1px solid #e3e8ef",
      fontSize: small ? 11 : 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: "#334",
    }}>
      <Dot color={s.color} pulse={s.pulse} />{s.label}
    </span>
  );
}

function Message({ msg }) {
  if (!msg) return null;
  const bad = msg.kind === "error";
  return (
    <div style={{ margin: "12px 0", padding: "10px 14px", borderRadius: 8, fontSize: 13, fontWeight: 800, fontFamily: "Arial, sans-serif",
      background: bad ? "#fff2f0" : "#eef8f1", color: bad ? RED : "#1e6b36", border: `1px solid ${bad ? "#f3c4bd" : "#bfe3c9"}` }}>
      {msg.text}
    </div>
  );
}

// ── Channel strip ──
function ChannelPanel({ onMessage }) {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const load = async (withStreams = true) => {
    setErr("");
    try { setSt(await api("channel", { streams: withStreams })); } catch (e) {
      setErr(e.message);
      // Still show what's stored if the live check failed.
      try { setSt(await api("channel")); } catch { /* the first error says it */ }
    }
  };
  useEffect(() => { load(); }, []);

  const act = async (what, fn) => {
    setBusy(what); setErr("");
    try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(""); }
  };
  const connect = () => act("connect", async () => { window.location.href = (await api("connect")).url; });
  const disconnect = () => act("disconnect", async () => {
    if (!window.confirm("Disconnect the YouTube channel? Existing YouTube broadcasts stay on YouTube; Stream Manager just can't manage them until you reconnect.")) return;
    await api("disconnect"); onMessage({ kind: "ok", text: "YouTube channel disconnected." }); await load(false);
  });
  const pickStream = (streamId) => act("stream", async () => { await api("set-stream", { streamId }); await load(); });

  const ch = st?.channel;
  return (
    <div style={{ border: "2px solid #e6ecf3", borderRadius: 12, background: "#fff", padding: "16px 18px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ ...label, marginBottom: 0, minWidth: 120 }}>YouTube Channel</div>
        {!st ? (
          <span style={{ fontSize: 13, color: "#999", fontWeight: 700 }}>Checking…</span>
        ) : st.connected ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 260 }}>
            {ch?.thumb && <img src={ch.thumb} alt="" style={{ width: 34, height: 34, borderRadius: "50%" }} />}
            <div>
              <div style={{ fontWeight: 900, fontSize: 15, color: INK }}>
                {ch?.title || "—"} {ch?.customUrl && <span style={{ color: "#889", fontWeight: 700, fontSize: 12 }}>{ch.customUrl}</span>}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 12, color: "#667" }}>
                {ch?.id}
                {st.channelVerified === true && <span style={{ color: GREEN, fontFamily: "Arial", fontWeight: 900, marginLeft: 8 }}>✓ verified live</span>}
              </div>
            </div>
          </div>
        ) : (
          <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "#889" }}>
            {st.configured ? "Not connected." : "Server isn't configured for YouTube OAuth yet (env vars missing)."}
          </span>
        )}
        {st && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={connect} disabled={!!busy || !st.configured} style={btn(st.connected && !st.needsReconnect ? BLUE : GOLD, !st.connected || st.needsReconnect, !!busy || !st.configured)}>
              {busy === "connect" ? "Opening Google…" : st.connected ? "Reconnect" : "Connect YouTube"}
            </button>
            {st.connected && <button onClick={disconnect} disabled={!!busy} style={btn(RED, false, !!busy)}>Disconnect</button>}
          </div>
        )}
      </div>

      {st?.connected && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #eef1f5", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ ...label, marginBottom: 0, minWidth: 120 }}>Worker Stream</div>
          {st.streams ? (
            <select value={st.workerStream?.id || ""} onChange={(e) => e.target.value && pickStream(e.target.value)} disabled={!!busy} style={{ ...input, width: "auto", minWidth: 280, padding: "8px 10px" }}>
              <option value="">{st.workerStream ? "" : "Auto — “We-Draft Live Worker” (created if missing)"}</option>
              {st.streams.map((s) => (
                <option key={s.id} value={s.id}>{s.title || s.id} · {s.streamStatus || "?"}{s.isReusable === false ? " · single-use" : ""}</option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 800, color: INK }}>{st.workerStream?.title || "Auto"}</span>
          )}
          <span style={{ fontSize: 12, color: "#778", fontFamily: "Arial", flex: 1, minWidth: 240 }}>
            Every broadcast binds to this stream. Its key must be the one on the worker VM — match it by name in YouTube Studio's stream-key list. Keys are never shown here.
          </span>
        </div>
      )}
      {(err || st?.lastError) && <Message msg={{ kind: "error", text: err || st.lastError }} />}
    </div>
  );
}

// ── Worker VM ──
// The VM's Compute Engine state (server/stream-manager/compute.js STATES).
const VM_STATE = {
  starting: { label: "Starting", color: AMBER, pulse: true },
  running: { label: "Running", color: GREEN },
  stopping: { label: "Stopping", color: AMBER, pulse: true },
  stopped: { label: "Stopped", color: "#333" },
  suspended: { label: "Suspended", color: "#8aa4c8" },
  repairing: { label: "Repairing", color: RED },
  unknown: { label: "Unknown", color: "#b8c2cf" },
};
const VM_MOVING = ["starting", "stopping"];
// The backend's 409 when a broadcast is live and confirmLive wasn't sent.
// (Also its twin for an automatic broadcast that's starting.)
const isLiveGuard = (e) => e?.status === 409 && /confirmLive/.test(e.message || "");
// The API's messages are written to be shown (no keys or tokens); fetch's own
// network errors aren't helpful as-is.
const vmError = (e) => (e instanceof TypeError ? "Couldn't reach the server — check your connection and Refresh." : String(e?.message || e).slice(0, 300));

// Reads status on open; starts or stops only on an admin's click. After a
// start/stop, polls vm-status until the VM settles or timeoutMs passes.
export function VmPanel({ liveCount = 0, pollMs = 5000, timeoutMs = 3 * 60 * 1000 }) {
  const [inst, setInst] = useState(null);
  const [busy, setBusy] = useState("load"); // load | refresh | start | stop | poll | ""
  const [msg, setMsg] = useState(null);
  const alive = useRef(true);

  const status = async () => {
    const { instance } = await api("vm-status");
    if (alive.current) setInst(instance);
    return instance;
  };

  useEffect(() => {
    alive.current = true;
    status().catch((e) => alive.current && setMsg({ kind: "error", text: vmError(e) })).finally(() => alive.current && setBusy(""));
    return () => { alive.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const poll = async (want) => {
    setBusy("poll");
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (alive.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      if (!alive.current) return;
      try {
        last = await status();
        if (!VM_MOVING.includes(last.state)) break;
      } catch { /* one failed poll isn't fatal; keep trying until the deadline */ }
    }
    if (!alive.current) return;
    if (last?.state === want) setMsg({ kind: "ok", text: `Worker VM is ${want}.` });
    else if (last && !VM_MOVING.includes(last.state)) setMsg({ kind: "error", text: `Worker VM ended up ${last.state} (${last.status}), not ${want}.` });
    else setMsg({ kind: "error", text: `Worker VM still isn't ${want} after ${Math.max(1, Math.round(timeoutMs / 60000))} min — Refresh to check again, or look in the Google Cloud console.` });
  };

  const act = async (what, fn) => {
    setBusy(what); setMsg(null);
    try { await fn(); } catch (e) { if (alive.current) setMsg({ kind: "error", text: vmError(e) }); } finally { if (alive.current) setBusy(""); }
  };

  const refresh = () => act("refresh", status);

  const start = () => {
    if (!window.confirm(`Start the worker VM (${inst?.name})?\n\nThis boots the machine (Compute Engine billing starts). It doesn't start a stream.`)) return;
    act("start", async () => {
      const r = await api("vm-start");
      setInst(r.instance);
      if (r.result === "already-running") return setMsg({ kind: "ok", text: "Worker VM is already starting or running." });
      setMsg({ kind: "ok", text: "Start requested — waiting for the VM…" });
      await poll("running");
    });
  };

  const stop = () => {
    const warn = liveCount > 0
      ? `\n\n⚠ ${liveCount} broadcast${liveCount > 1 ? "s are" : " is"} LIVE. Stopping the VM will end the stream.`
      : "\n\nAny stream the worker is sending will end.";
    if (!window.confirm(`Stop the worker VM (${inst?.name})?${warn}`)) return;
    act("stop", async () => {
      let r;
      try {
        r = await api("vm-stop");
      } catch (e) {
        if (!isLiveGuard(e)) throw e;
        // The server's guard tripped. Only a second, typed confirmation sends the override.
        const typed = window.prompt(`${e.message}\n\nStopping now ENDS the stream. Type STOP to stop the VM anyway.`);
        if (typed !== "STOP") return setMsg({ kind: "error", text: "Stop cancelled — a broadcast is live or starting, so the VM was left running." });
        r = await api("vm-stop", { confirmLive: true });
      }
      setInst(r.instance);
      if (r.result === "already-stopped") return setMsg({ kind: "ok", text: "Worker VM is already stopped or stopping." });
      setMsg({ kind: "ok", text: "Stop requested — waiting for the VM…" });
      await poll("stopped");
    });
  };

  const state = inst?.state || "unknown";
  const locked = !!busy;
  const canStart = !locked && state === "stopped";
  const canStop = !locked && ["running", "starting", "repairing"].includes(state);
  const fmtTs = (t) => (t ? fmtFull(Date.parse(t)) : "—");

  return (
    <div style={{ border: "2px solid #e6ecf3", borderRadius: 12, background: "#fff", padding: "16px 18px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ ...label, marginBottom: 0, minWidth: 120 }}>Worker VM</div>
        {busy === "load" && !inst ? (
          <span style={{ flex: 1, fontSize: 13, color: "#999", fontWeight: 700 }}>Checking…</span>
        ) : inst ? (
          <div style={{ display: "flex", alignItems: "center", gap: 18, flex: 1, minWidth: 260, flexWrap: "wrap" }}>
            <Pill s={VM_STATE[state] || VM_STATE.unknown} />
            <div>
              <div style={{ fontWeight: 900, fontSize: 15, color: INK, fontFamily: "monospace" }}>{inst.name}</div>
              <div style={{ fontSize: 12, color: "#667", fontWeight: 700 }}>
                {inst.zone} · {inst.machineType || "—"} · <span style={{ fontFamily: "monospace" }}>{inst.status || "—"}</span>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#778", fontWeight: 700 }}>
              <div>Last start: {fmtTs(inst.lastStartTimestamp)}</div>
              <div>Last stop: {fmtTs(inst.lastStopTimestamp)}</div>
            </div>
          </div>
        ) : (
          <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "#889" }}>Status unavailable.</span>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={refresh} disabled={locked} style={btn(BLUE, false, locked)}>{busy === "refresh" || busy === "load" ? "Checking…" : "Refresh Status"}</button>
          <button onClick={start} disabled={!canStart} style={btn(GREEN, true, !canStart)}>{busy === "start" ? "Starting…" : "Start VM"}</button>
          <button onClick={stop} disabled={!canStop} style={btn(RED, false, !canStop)}>{busy === "stop" ? "Stopping…" : "Stop VM"}</button>
        </div>
      </div>
      {busy === "poll" && (
        <div style={{ marginTop: 10, fontSize: 12, fontWeight: 800, color: "#778" }}>
          Waiting for the VM to finish {state === "stopping" ? "stopping" : "starting"}… (checking every {Math.max(1, Math.round(pollMs / 1000))}s)
        </div>
      )}
      <Message msg={msg} />
    </div>
  );
}

// ── Auto Schedule ──
// Games from the saved CFB schedule (schedule26) an admin enables for
// automatic broadcast. Enabling only writes the selection; the server's
// orchestrator (api/stream-orchestrator.js, every minute) does everything
// else, starting 15 min before kickoff. Nothing here runs a lifecycle step.
const AUTO = {
  selected: { label: "Selected", color: "#b8c2cf" },
  scheduled: { label: "Scheduled", color: BLUE },
  starting: { label: "Starting", color: AMBER, pulse: true },
  live: { label: "Live", color: GREEN, pulse: true },
  postgame: { label: "Live · Postgame", color: GREEN, pulse: true },
  ending: { label: "Ending", color: AMBER },
  completed: { label: "Completed", color: "#333" },
  failed: { label: "Failed", color: RED },
  cancelled: { label: "Cancelled", color: "#b8c2cf" },
  cancelling: { label: "Cancelling", color: AMBER },
};
const STARTING_PHASES = ["preparing", "vm", "worker", "ingest", "going-live"];
const PREP_LEAD_MS = 15 * 60e3; // a scheduled start's default: kickoff − 15 min (orchestrator CFG.PREP_LEAD_MS)
const NATIONAL_MAX_H = 20; // an open-ended national's failsafe (orchestrator CFG.NATIONAL_MAX_MS)
function autoBase(a) {
  if (a.cancelRequested) return AUTO.cancelling;
  if (a.phase === "selected") return a.error ? { label: "Blocked", color: RED } : a.kickoffAt ? AUTO.scheduled : AUTO.selected;
  if (STARTING_PHASES.includes(a.phase)) return AUTO.starting;
  return AUTO[a.phase] || AUTO.selected;
}
// A rehearsal's states are simulated — always labelled so.
export function autoState(b) {
  const a = b?.auto;
  if (!a) return null;
  const s = autoBase(a);
  return b.rehearsal ? { ...s, label: `Rehearsal · ${s.label}`, pulse: false } : s;
}
const GAME_STATUS = {
  scheduled: { label: "Upcoming", color: "#b8c2cf" },
  in_progress: { label: "In progress", color: GREEN, pulse: true },
  final: { label: "Final", color: "#333" },
};
const ago = (t, now) => (t ? `${Math.max(0, Math.round((now - t) / 1000))}s ago` : "never");

// Presentational: everything comes in as props (tested on its own).
//   games   schedule26 docs { id, Home, Away, KickoffAt (ms), Week, CFBDGameId, Final }
//   statusById  liveGames status by CFBD id (from liveSlate/current)
//   rows    broadcasts records; orchDoc / agentDoc: streamManager docs
export function AutoSchedule({ games, statusById = {}, rows = [], orchDoc, agentDoc, now, onOpen }) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [search, setSearch] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [days, setDays] = useState(7);
  const [editing, setEditing] = useState(null); // the schedule game whose metadata is open
  // Schedule / Rehearse open a start-time field for that game:
  // { gameId, rehearsal, at (datetime-local, default kickoff − 15 min) }.
  const [scheduling, setScheduling] = useState(null);

  // One record per game; the open one (or the latest) wins.
  const recByGame = useMemo(() => {
    const m = new Map();
    for (const b of rows) {
      if (!b.auto) continue;
      const k = String(b.gameId);
      const cur = m.get(k);
      if (!cur || (b.auto.open && !cur.auto.open) || (!!b.auto.open === !!cur.auto.open && (b.auto.selectedAt || 0) > (cur.auto.selectedAt || 0))) m.set(k, b);
    }
    return m;
  }, [rows]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const end = now + days * 86400e3;
    return (games || [])
      .filter((g) => g.KickoffAt && g.KickoffAt <= end)
      .filter((g) => !q || `${g.Home} ${g.Away}`.toLowerCase().includes(q))
      .filter((g) => !onlySelected || recByGame.get(String(g.CFBDGameId))?.auto?.open)
      .sort((a, b) => a.KickoffAt - b.KickoffAt);
  }, [games, search, onlySelected, days, now, recByGame]);

  // Resolves true when the action succeeded.
  const act = async (key, fn, ok) => {
    setBusy(key); setMsg(null);
    try { const r = await fn(); setMsg({ kind: "ok", text: typeof ok === "function" ? ok(r) : ok }); return true; } catch (e) { setMsg({ kind: "error", text: vmError(e) }); return false; } finally { setBusy(""); }
  };
  const openSchedule = (g, rehearsal) => setScheduling({ gameId: g.id, rehearsal, at: toLocalInput(g.KickoffAt - PREP_LEAD_MS) });
  // Schedule (or Rehearse) at the chosen start. The default, kickoff − 15 min,
  // is sent as no start time, so the server keeps following kickoff changes.
  const confirmSchedule = (g) => {
    const { rehearsal, at } = scheduling;
    const t = Date.parse(at);
    if (!Number.isFinite(t)) return setMsg({ kind: "error", text: "Set a start time." });
    const isDefault = at === toLocalInput(g.KickoffAt - PREP_LEAD_MS);
    const what = rehearsal
      ? "A rehearsal never touches YouTube: no broadcast is created, bound, started or ended, and no Worker Stream is needed. The server runs the lifecycle with a simulated worker — only on a VM agent in DRY_RUN mode."
      : "The server starts the VM, creates the YouTube broadcast (Unlisted unless this game already has a record with another visibility) and goes live once the stream is received.";
    if (!window.confirm(`${rehearsal ? "Rehearse" : "Schedule"} ${g.Away} at ${g.Home}?\n\nStarts ${fmtFull(t)}${isDefault ? " (15 min before kickoff)" : ""}. ${what} It ends 15 min after the game is FINAL.`)) return;
    act(`g${g.id}`, () => api("auto-select", { scheduleId: g.id, ...(isDefault ? {} : { startAt: new Date(t).toISOString() }), ...(rehearsal ? { rehearsal: true } : {}) }),
      (r) => (r.already ? (rehearsal ? "Already rehearsing." : "Already scheduled.") : rehearsal ? "Rehearsal scheduled — nothing goes to YouTube." : `Scheduled — it starts automatically ${fmtFull(t)}.`))
      .then((ok) => ok && setScheduling(null));
  };
  // Start Now: a game that isn't scheduled yet is scheduled to start now; a
  // scheduled one (still waiting) starts now. Within a minute either way.
  const startNow = (g, b) => {
    const waiting = b?.auto?.open && b.auto.phase === "selected";
    const label = waiting && b.rehearsal ? "the rehearsal of " : "";
    if (!window.confirm(`Start ${label}${g.Away} at ${g.Home} now?\n\n${waiting && b.rehearsal
      ? "The rehearsal starts within a minute — no YouTube, simulated worker only."
      : "Within a minute the server starts the VM, creates the YouTube broadcast (Unlisted unless this game already has a record with another visibility) and goes live once the stream is received — usually a few minutes."} It ends 15 min after the game is FINAL, or when you end it.`)) return;
    act(`g${g.id}`, () => (waiting ? api("auto-start-now", { id: b.id }) : api("auto-select", { scheduleId: g.id, startNow: true })),
      (r) => (r.already && r.phase ? "It's already starting." : "Starting — the server prepares it within a minute."));
  };
  const disable = (b) => {
    const onAir = ["live", "postgame"].includes(b.auto.phase);
    if (onAir) {
      if (!window.confirm("This broadcast is ON AIR.\n\nDisabling it ends the YouTube broadcast now and stops its worker. End it?")) return;
    } else if (!window.confirm(STARTING_PHASES.includes(b.auto.phase) ? "This broadcast is starting. Disable it and stop its preparation?" : "Disable the automatic broadcast for this game?")) return;
    act(`g${b.gameId}`, () => api("auto-cancel", { id: b.id, ...(onAir ? { confirmEnd: true } : {}) }), onAir ? "Ending — the server is completing the YouTube broadcast." : "Disabled.");
  };
  const retry = (b) => act(`g${b.gameId}`, () => api("auto-retry", { id: b.id }), "Re-enabled.");

  const agentOnline = agentDoc?.lastSeenAt && now - agentDoc.lastSeenAt < 60e3;
  const tickOk = orchDoc?.lastTickAt && now - orchDoc.lastTickAt < 3 * 60e3;
  // Real capacity as the orchestrator computed it (0 = no Worker Stream); unknown until it has run.
  const capacity = typeof orchDoc?.capacity === "number" ? orchDoc.capacity : null;

  return (
    <div>
      <div style={{ border: "2px solid #e6ecf3", borderRadius: 12, background: "#fff", padding: "14px 18px", marginBottom: 14, display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ ...label, marginBottom: 0 }}>Orchestrator</div>
        <span style={{ fontSize: 13, fontWeight: 800, color: tickOk ? "#1e6b36" : RED }}>{tickOk ? "●" : "○"} Last run {ago(orchDoc?.lastTickAt, now)}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: agentOnline ? "#1e6b36" : "#889" }}>{agentOnline ? "●" : "○"} VM agent {agentOnline ? "online" : `offline (last ${ago(agentDoc?.lastSeenAt, now)})`}{agentDoc?.dryRun ? " · DRY RUN" : ""}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: capacity === 0 ? RED : INK }}>Slots {orchDoc?.slotsInUse ?? 0}/{capacity ?? "?"} in use</span>
        {orchDoc?.rehearsalOnly && <span style={{ fontSize: 12, fontWeight: 900, color: "#7b5ea7" }}>REHEARSAL-ONLY MODE</span>}
        {orchDoc?.vmOwned && <span style={{ fontSize: 12, fontWeight: 800, color: "#667" }}>VM started automatically (stops when idle)</span>}
        {orchDoc?.vmManual && <span style={{ fontSize: 12, fontWeight: 800, color: "#667" }}>VM started manually (stops 30 min after the day's last broadcast)</span>}
        {(orchDoc?.lastTick?.errors || []).length > 0 && (
          <span style={{ fontSize: 12, fontWeight: 800, color: RED, flexBasis: "100%" }}>Last run: {orchDoc.lastTick.errors.slice(0, 2).join(" · ")}</span>
        )}
      </div>

      {capacity === 0 && (
        <Message msg={{ kind: "error", text: "No Worker Stream is configured (0 stream slots), so real broadcasts can't start: an enabled game is held before preparation (no VM, no YouTube) and fails at kickoff. Pick a Worker Stream in Channel → Worker Stream (needs YouTube live streaming), or use Rehearse to test without YouTube." }} />
      )}
      {agentDoc?.dryRun && (
        <Message msg={{ kind: "ok", text: "The VM agent is in DRY_RUN mode: real broadcasts are blocked, and rehearsals run with a simulated worker. Nothing is streamed." }} />
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search teams…" style={{ ...input, width: 220, padding: "8px 10px" }} />
        {[[2, "2 days"], [7, "7 days"], [21, "3 weeks"]].map(([d, l]) => (
          <button key={d} onClick={() => setDays(d)} style={{ ...btn(BLUE, days === d), padding: "7px 12px" }}>{l}</button>
        ))}
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 800, color: "#556" }}>
          <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} /> Enabled only
        </label>
      </div>
      <Message msg={msg} />

      <div style={{ border: "2px solid #e6ecf3", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
        {/* National coverage: always the first row, whatever the search / filters. */}
        <NationalCoverage rows={rows} now={now} onOpen={onOpen} pinned />
        {!games ? (
          <div style={{ padding: 30, textAlign: "center", color: "#99a", fontWeight: 800 }}>Loading schedule…</div>
        ) : !shown.length ? (
          <div style={{ padding: "30px 20px", textAlign: "center", color: "#99a", fontWeight: 800, fontSize: 13 }}>
            No games in this window. Games without a kickoff time in the CFB schedule appear once they have one.
          </div>
        ) : (
          shown.map((g) => {
            const b = recByGame.get(String(g.CFBDGameId));
            const s = autoState(b);
            const a = b?.auto;
            const gs = statusById[String(g.CFBDGameId)] || (g.Final ? "final" : "scheduled");
            const linked = /^\d+$/.test(String(g.CFBDGameId ?? ""));
            const key = `g${g.id}`;
            const rowBusy = busy === key || busy === `g${g.CFBDGameId}`;
            const blocked = !!busy || !linked || g.Final || gs === "final";
            const sch = scheduling?.gameId === g.id ? scheduling : null;
            return (
              <div key={g.id} data-testid={`game-${g.id}`} style={{ borderBottom: "1px solid #f0f2f6" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,1.6fr) 1fr 0.8fr minmax(150px,1.3fr) auto", gap: 10, padding: "12px 16px", alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 14, color: INK }}>{g.Away} at {g.Home}</div>
                  <div style={{ fontSize: 11, color: "#889", fontWeight: 700 }}>{g.Week || ""}{linked ? "" : " · not linked to We-Draft Live"}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#445" }}>{fmtFull(g.KickoffAt)}</div>
                <div><Pill s={GAME_STATUS[gs] || GAME_STATUS.scheduled} small /></div>
                <div style={{ minWidth: 0 }}>
                  {s ? <Pill s={s} small /> : <span style={{ fontSize: 12, color: "#aab", fontWeight: 800 }}>Not enabled</span>}
                  {a?.open && a.phase === "selected" && a.prepAt && <div style={{ fontSize: 11, color: "#445", fontWeight: 800, marginTop: 3 }}>Starts {fmtFull(a.prepAt)}</div>}
                  {a?.open && a.waiting && <div style={{ fontSize: 11, color: "#667", fontWeight: 700, marginTop: 3 }}>{a.waiting}</div>}
                  {a?.error && <div style={{ fontSize: 11, color: RED, fontWeight: 800, marginTop: 3 }}>{a.error}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {a?.open ? (
                    <>
                      {a.phase === "selected" && !a.cancelRequested && (
                        <button onClick={() => startNow(g, b)} disabled={!!busy} style={btn(GREEN, true, !!busy)}>{rowBusy ? "…" : "Start Now"}</button>
                      )}
                      <button onClick={() => disable(b)} disabled={!!busy || a.cancelRequested || a.phase === "ending"} style={btn(RED, ["live", "postgame"].includes(a.phase), !!busy || a.cancelRequested || a.phase === "ending")}>
                        {rowBusy && a.phase !== "selected" ? "…" : ["live", "postgame"].includes(a.phase) ? "End Broadcast" : "Disable"}
                      </button>
                    </>
                  ) : a && ["failed", "cancelled"].includes(a.phase) ? (
                    <button onClick={() => retry(b)} disabled={!!busy || g.Final || a.ytUnconfirmed === true}
                      title={a.ytUnconfirmed === true ? "The YouTube end was never confirmed — check Studio, then Refresh YouTube Status on the broadcast first" : undefined}
                      style={btn(GOLD, true, !!busy || g.Final || a.ytUnconfirmed === true)}>{rowBusy ? "…" : "Retry"}</button>
                  ) : a?.phase === "completed" ? null : (
                    <>
                      <button onClick={() => startNow(g, null)} disabled={blocked} style={btn(GREEN, true, blocked)}>{rowBusy ? "…" : "Start Now"}</button>
                      <button onClick={() => openSchedule(g, false)} disabled={blocked} style={btn(GREEN, false, blocked)}>Schedule</button>
                      <button onClick={() => openSchedule(g, true)} disabled={blocked} style={btn("#7b5ea7", false, blocked)}>Rehearse</button>
                    </>
                  )}
                  <button onClick={() => setEditing(g)} disabled={!linked}
                    title={linked ? "YouTube title and description for this game — saved as a draft only" : "Not linked to We-Draft Live (no CFBD game id)"}
                    style={{ ...btn(BLUE, false, !linked), padding: "9px 10px" }}>Edit Metadata</button>
                  {b && onOpen && <button onClick={() => onOpen(b.id)} style={{ ...btn("#889", false), padding: "9px 10px" }}>Open</button>}
                </div>
              </div>
              {sch && (
                <div data-testid={`schedule-${g.id}`} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", padding: "0 16px 12px", justifyContent: "flex-end" }}>
                  <div>
                    <div style={label}>{sch.rehearsal ? "Rehearsal starts" : "Broadcast starts"} (your time)</div>
                    <input type="datetime-local" aria-label="Start time" value={sch.at} onChange={(e) => setScheduling({ ...sch, at: e.target.value })} style={{ ...input, width: 210, padding: "8px 10px" }} />
                  </div>
                  <span style={{ fontSize: 11, color: "#778", fontWeight: 700, paddingBottom: 10 }}>Default: 15 min before kickoff</span>
                  <button onClick={() => confirmSchedule(g)} disabled={!!busy} style={btn(sch.rehearsal ? "#7b5ea7" : GREEN, true, !!busy)}>{rowBusy ? "…" : sch.rehearsal ? "Confirm Rehearsal" : "Confirm Schedule"}</button>
                  <button onClick={() => setScheduling(null)} style={btn("#889", false)}>Cancel</button>
                </div>
              )}
              </div>
            );
          })
        )}
      </div>
      {editing && <MetadataEditor game={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ── Metadata editor ──
// A game's YouTube title / description, prepared ahead of time (e.g. text
// generated elsewhere and pasted in) and saved as a draft:
// broadcastMetadata/{CFBDGameId} through metadata-get / metadata-save
// (server/stream-manager/metadata.js). Saving never creates, schedules or
// changes a YouTube broadcast, enables automation or touches the VM; the
// draft is used when automation later creates the game's broadcast.
// Works for any linked game, enabled or not.
// Thumbnail: Generate draws one from the fixed template
// (server/stream-manager/thumbnail.js — the teams' colors and logos, no AI)
// as a preview; Save Thumbnail stores that exact image
// (broadcastThumbnails/{CFBDGameId}). Neither uploads it — that's Upload
// Thumbnail on a created broadcast.
//   game: the schedule26 game { id, Home, Away, KickoffAt, CFBDGameId }
//   national: { startAt, endAt } (ms) instead — the national stream's
//     draft and thumbnail (broadcastMetadata/national), generated for that
//     window (its Game of the Week / Featured games)
const fmtSaved = (t) => (t ? new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
export function MetadataEditor({ game, national, onClose }) {
  // What every request is about.
  const req = useMemo(() => (national
    ? { national: true, startAt: new Date(national.startAt).toISOString(), endAt: new Date(national.endAt).toISOString() }
    : { scheduleId: game.id }), [national?.startAt, national?.endAt, game?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [data, setData] = useState(null); // metadata-get's answer
  const [loadErr, setLoadErr] = useState(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saved, setSaved] = useState(null); // { title, description } — the saved draft, or the defaults when none
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [thumb, setThumb] = useState(null); // the saved thumbnail
  const [preview, setPreview] = useState(null); // a generated, unsaved one
  const [thumbBusy, setThumbBusy] = useState("");
  const [thumbMsg, setThumbMsg] = useState(null);

  useEffect(() => {
    let alive = true;
    api("metadata-get", req)
      .then((r) => {
        if (!alive) return;
        // A saved draft always wins over the defaults — reopening never overwrites manual edits.
        const start = r.draft || r.defaults;
        setData(r);
        setThumb(r.thumbnail || null);
        setSaved({ title: start.title, description: start.description });
        setTitle(start.title);
        setDescription(start.description);
      })
      .catch((e) => { if (alive) setLoadErr(vmError(e)); });
    return () => { alive = false; };
  }, [req]);

  const limits = data?.limits || YT_LIMITS;
  const v = validateMetadata({ title, description }, limits);
  const invalid = Object.keys(v.errors).length > 0;
  const textDirty = !!saved && (title !== saved.title || description !== saved.description);
  const thumbDirty = !!preview && preview.sha256 !== thumb?.sha256;
  const dirty = textDirty || thumbDirty;
  const draft = data?.draft || null;

  // Leaving the page with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const close = () => {
    if (dirty && !window.confirm(`You have unsaved changes to this game's ${[textDirty && "YouTube title / description", thumbDirty && "thumbnail"].filter(Boolean).join(" and ")}. Close without saving?`)) return;
    onClose();
  };
  const reset = () => {
    if (!data) return;
    const d = data.defaults;
    if ((title !== d.title || description !== d.description) && !window.confirm("Replace the title and description with the generated text? Nothing is saved until you press Save Draft.")) return;
    setTitle(d.title);
    setDescription(d.description);
    setMsg(null);
  };
  const save = async () => {
    if (invalid || saving) return;
    setSaving(true); setMsg(null);
    try {
      const r = await api("metadata-save", { ...req, title, description, baseVersion: draft?.version || 0 });
      setData((x) => ({ ...x, draft: r.draft }));
      setSaved({ title: r.draft.title, description: r.draft.description });
      setTitle(r.draft.title);
      setDescription(r.draft.description);
      setMsg({ kind: "ok", text: "Draft saved." });
    } catch (e) {
      setMsg({ kind: "error", text: vmError(e) });
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    setThumbBusy("generate"); setThumbMsg(null);
    try { setPreview(await api("metadata-thumbnail-generate", req)); } catch (e) { setThumbMsg({ kind: "error", text: vmError(e) }); } finally { setThumbBusy(""); }
  };
  const saveThumb = async () => {
    if (!preview) return;
    setThumbBusy("save"); setThumbMsg(null);
    try {
      const r = await api("metadata-thumbnail-save", { ...req, sha256: preview.sha256 });
      setThumb(r.thumbnail);
      setPreview(null);
      // The server also pushes it to a YouTube broadcast that already exists.
      const yt = r.youtube || [];
      const failed = yt.filter((x) => x.error);
      const sent = yt.filter((x) => x.uploaded).length;
      setThumbMsg(failed.length
        ? { kind: "error", text: `Thumbnail saved, but the YouTube upload failed: ${failed[0].error}` }
        : { kind: "ok", text: sent ? "Thumbnail saved and set on the YouTube broadcast." : "Thumbnail saved." });
    } catch (e) { setThumbMsg({ kind: "error", text: vmError(e) }); } finally { setThumbBusy(""); }
  };
  const shown = preview || thumb;

  const status = dirty ? { text: "Unsaved changes", color: AMBER }
    : draft ? { text: `Saved ${fmtSaved(draft.updatedAt)}`, color: GREEN }
      : { text: "Generated automatically — not saved", color: "#889" };
  const field = (err) => ({ ...input, borderColor: err ? RED : "#dde3ea" });
  const count = (n, max, unit) => (
    <span style={{ fontSize: 11, fontWeight: 800, color: n > max ? RED : "#889" }}>{n.toLocaleString()} / {max.toLocaleString()} {unit}</span>
  );
  const canSave = !!data && !saving && !invalid && (textDirty || !draft);

  return (
    <div role="dialog" aria-modal="true" aria-label="Edit YouTube metadata"
      onKeyDown={(e) => { if (e.key === "Escape") close(); }}
      // Above the site's fixed navbar (z-index 10000–10002), centered, and
      // never taller than the window: the header and the Save / Cancel row
      // stay on screen while the middle scrolls.
      style={{ position: "fixed", inset: 0, zIndex: 10050, background: "rgba(11,26,46,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
      <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 860, maxHeight: "calc(100vh - 48px)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", fontFamily: "Arial, sans-serif" }}>
        <div style={{ padding: "16px 20px", borderBottom: "2px solid #eef1f5", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={label}>YouTube metadata</div>
            {national ? (
              <>
                <div style={{ fontWeight: 900, fontSize: 17, color: INK }}>National Coverage</div>
                <div style={{ fontSize: 12, color: "#778", fontWeight: 700 }}>{fmtFull(national.startAt)} → {fmtTime(national.endAt)} · used for every national window</div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 900, fontSize: 17, color: INK }}>{game.Away} at {game.Home}</div>
                <div style={{ fontSize: 12, color: "#778", fontWeight: 700 }}>Kickoff {fmtFull(game.KickoffAt)} · CFBD game {game.CFBDGameId}</div>
              </>
            )}
          </div>
          <span data-testid="metadata-status" style={{ fontSize: 12, fontWeight: 900, color: status.color }}>● {status.text}</span>
          <button onClick={close} aria-label="Close" style={{ ...btn("#889", false), padding: "6px 10px" }}>✕</button>
        </div>

        <div data-testid="metadata-body" style={{ padding: "16px 20px", overflowY: "auto", flex: "1 1 auto", minHeight: 0 }}>
          {loadErr ? <Message msg={{ kind: "error", text: loadErr }} /> : !data ? (
            <div style={{ padding: 30, textAlign: "center", color: "#99a", fontWeight: 800 }}>Loading…</div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "#556", fontWeight: 700, marginBottom: 12, lineHeight: 1.5 }}>
                {data.broadcast?.youtubeCreated
                  ? <span style={{ color: RED, fontWeight: 900 }}>{national ? "This window's" : "This game's"} YouTube broadcast already exists. Saving here does not change it — edit it in YouTube Studio. The draft is only used for a broadcast created later.</span>
                  : draft ? "Saved as a draft only: nothing is created on YouTube and automation isn't enabled. When automation creates this game's YouTube broadcast, it uses this title and description."
                    : national ? "Generated automatically — the window's top game (Game of the Week, else Featured) goes in the hashtags. Automation uses this unless you save your own. Saving a draft only stores it: nothing is created on YouTube and nothing is scheduled."
                      : "Generated automatically from the matchup, ranks and kickoff — automation uses this unless you save your own. Saving a draft only stores it: nothing is created on YouTube and automation isn't enabled."}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <label htmlFor="md-title" style={label}>YouTube title</label>
                {count(charCount(v.title), limits.titleMax, "characters")}
              </div>
              <input id="md-title" value={title} onChange={(e) => setTitle(e.target.value)} style={field(v.errors.title)} />
              {v.errors.title && <div role="alert" style={{ color: RED, fontSize: 12, fontWeight: 800, marginTop: 4 }}>{v.errors.title}</div>}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 14 }}>
                <label htmlFor="md-description" style={label}>YouTube description</label>
                {count(byteCount(v.description), limits.descriptionMaxBytes, "bytes")}
              </div>
              <textarea id="md-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={10}
                style={{ ...field(v.errors.description), resize: "vertical", lineHeight: 1.45 }} />
              {v.errors.description && <div role="alert" style={{ color: RED, fontSize: 12, fontWeight: 800, marginTop: 4 }}>{v.errors.description}</div>}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 18 }}>
                <div style={label}>Thumbnail</div>
                <span data-testid="thumbnail-status" style={{ fontSize: 11, fontWeight: 900, color: thumbDirty ? AMBER : thumb ? GREEN : "#889" }}>
                  {thumbDirty ? "Preview — not saved" : thumb ? `Saved ${fmtSaved(thumb.updatedAt)}` : "None yet"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ width: 384, maxWidth: "100%", aspectRatio: "16 / 9", borderRadius: 8, overflow: "hidden", background: "#eef1f5", border: `2px solid ${thumbDirty ? AMBER : "#e3e8ef"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {shown ? <img src={shown.dataUrl} alt={thumbDirty ? "Thumbnail preview (not saved)" : "Saved thumbnail"} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                    : <span style={{ fontSize: 12, fontWeight: 800, color: "#99a", padding: 12, textAlign: "center" }}>{thumbBusy === "generate" ? "Generating…" : national ? "Generate one from the window's Game of the Week and Featured games" : "Generate one from the teams' colors and logos"}</span>}
                </div>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={generate} disabled={!!thumbBusy} style={btn(BLUE, !shown, !!thumbBusy)}>
                      {thumbBusy === "generate" ? "Generating…" : shown ? "Regenerate" : "Generate Thumbnail"}
                    </button>
                    {thumbDirty && <button onClick={saveThumb} disabled={!!thumbBusy} style={btn(GREEN, true, !!thumbBusy)}>{thumbBusy === "save" ? "Saving…" : "Save Thumbnail"}</button>}
                    {thumbDirty && <button onClick={() => setPreview(null)} disabled={!!thumbBusy} style={btn("#889", false, !!thumbBusy)}>Discard</button>}
                  </div>
                  {(preview?.notes || []).map((n) => <div key={n} style={{ fontSize: 12, color: "#8a6100", fontWeight: 800, marginTop: 6 }}>{n}</div>)}
                  <div style={{ fontSize: 11, color: "#889", fontWeight: 700, marginTop: 8, lineHeight: 1.45 }}>
                    {national ? "1280×720 PNG from the national template — a tile per Game of the Week / Featured game in the window (schools' colors and logos), then the rest as “+N more”." : "1280×720 PNG from the We-Draft template — the schools' saved colors and logos."} It becomes the YouTube thumbnail automatically: when automation creates the broadcast, or right away on save if the broadcast already exists.
                  </div>
                  <Message msg={thumbMsg} />
                </div>
              </div>

              <div style={{ ...label, marginTop: 18 }}>Preview</div>
              <div data-testid="metadata-preview" style={{ border: "2px solid #eef1f5", borderRadius: 10, padding: "14px 16px", background: "#fafbfc" }}>
                <div data-testid="preview-title" style={{ fontSize: 18, fontWeight: 800, color: "#0f0f0f", wordBreak: "break-word" }}>{v.title || <span style={{ color: "#aab" }}>(no title)</span>}</div>
                <div data-testid="preview-description" style={{ marginTop: 10, fontSize: 13, color: "#333", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>{v.description || <span style={{ color: "#aab" }}>(no description)</span>}</div>
              </div>

              <Message msg={msg} />
            </>
          )}
        </div>

        <div style={{ padding: "14px 20px", borderTop: "2px solid #eef1f5", display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", flexShrink: 0 }}>
          <button onClick={reset} disabled={!data || saving} style={btn("#889", false, !data || saving)}>Reset</button>
          <button onClick={close} style={btn("#889", false)}>Cancel</button>
          <button onClick={save} disabled={!canSave} style={btn(GREEN, true, !canSave)}>{saving ? "Saving…" : "Save Draft"}</button>
        </div>
      </div>
    </div>
  );
}

// Stream slots: one reusable YouTube stream per concurrent broadcast; slot
// i's key is on the VM as ~/.we-draft/youtube-key (slot 0) / youtube-key-i.
export function SlotSettings({ orchDoc }) {
  const [open, setOpen] = useState(false);
  const [streams, setStreams] = useState(null);
  const [ids, setIds] = useState([]);
  const [max, setMax] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const edit = async () => {
    setOpen(true); setMsg(null);
    setIds(orchDoc?.slotStreamIds?.length ? orchDoc.slotStreamIds : []);
    setMax(orchDoc?.maxConcurrent || 1);
    try {
      const ch = await api("channel", { streams: true });
      setStreams(ch.streams || []);
      if (!orchDoc?.slotStreamIds?.length && ch.workerStream?.id) setIds([ch.workerStream.id]);
    } catch (e) { setMsg({ kind: "error", text: vmError(e) }); }
  };
  const save = async () => {
    setBusy(true); setMsg(null);
    try { await api("auto-config", { slotStreamIds: ids.filter(Boolean), maxConcurrent: Number(max) }); setMsg({ kind: "ok", text: "Saved." }); setOpen(false); } catch (e) { setMsg({ kind: "error", text: vmError(e) }); } finally { setBusy(false); }
  };
  const title = (id) => streams?.find((s) => s.id === id)?.title || id;

  return (
    <div style={{ border: "2px solid #e6ecf3", borderRadius: 12, background: "#fff", padding: "14px 18px", marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ ...label, marginBottom: 0 }}>Stream Slots</div>
        <span style={{ fontSize: 13, fontWeight: 800, color: INK, flex: 1 }}>
          {orchDoc?.slotStreamIds?.length ? `${orchDoc.slotStreamIds.length} slot(s), up to ${orchDoc.maxConcurrent || 1} at once`
            : orchDoc?.capacity ? "Default: 1 slot (the Channel's Worker Stream)" : "No Worker Stream selected — 0 slots"}
        </span>
        {!open && <button onClick={edit} style={btn(BLUE, false)}>Edit</button>}
      </div>
      {open && (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          {ids.map((id, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 900, width: 200, color: "#556" }}>Slot {i} <span style={{ fontFamily: "monospace", fontWeight: 700 }}>({i === 0 ? "youtube-key" : `youtube-key-${i}`})</span></span>
              <select value={id} onChange={(e) => setIds(ids.map((x, j) => (j === i ? e.target.value : x)))} style={{ ...input, width: "auto", minWidth: 260, padding: "7px 10px" }}>
                <option value="">Pick a stream…</option>
                {(streams || []).map((s) => <option key={s.id} value={s.id}>{s.title || s.id}</option>)}
                {id && !streams?.some((s) => s.id === id) && <option value={id}>{title(id)}</option>}
              </select>
              {i > 0 && i === ids.length - 1 && <button onClick={() => setIds(ids.slice(0, -1))} style={{ ...btn(RED, false), padding: "6px 10px" }}>Remove</button>}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {ids.length < 6 && <button onClick={() => setIds([...ids, ""])} style={{ ...btn(BLUE, false), padding: "6px 10px" }}>+ Slot</button>}
            <span style={{ fontSize: 12, fontWeight: 800, color: "#556" }}>Max at once</span>
            <input type="number" min={1} max={6} value={max} onChange={(e) => setMax(e.target.value)} style={{ ...input, width: 70, padding: "6px 8px" }} />
            <button onClick={save} disabled={busy} style={btn(BLUE, true, busy)}>{busy ? "Saving…" : "Save"}</button>
            <button onClick={() => setOpen(false)} disabled={busy} style={btn("#889", false, busy)}>Cancel</button>
          </div>
          <div style={{ fontSize: 12, color: "#778", fontFamily: "Arial" }}>
            Each slot needs its stream's key on the VM in the file shown. Raise “max at once” only if the VM has the CPU for it (about 2 vCPUs per broadcast).
          </div>
        </div>
      )}
      <Message msg={msg} />
    </div>
  );
}

// National coverage: /broadcast/national (no one game — the big plays and
// storylines from every game) for a window, run by the same orchestrator
// (orchestrator.js selectNational). Presentational: rows are broadcasts
// records; the national ones are picked out here.
// Wall-clock h:m on ET date (y, mo, d) as a timestamp (EDT or EST, whichever
// is in effect then).
const ET_TZ = "America/New_York";
function etAt(y, mo, d, h, m) {
  const guess = Date.UTC(y, mo, d, h, m);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ET_TZ, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
    .formatToParts(new Date(guess)).map((x) => [x.type, Number(x.value)]));
  return guess - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess);
}
// Default window: the next Saturday in ET (today if it's Saturday), 11:30 AM
// to 11:59 PM ET. (An earlier start set by hand — from 6 AM — opens with
// We-Draft Gameday, the preview show, until the first kickoff:
// utils/broadcastNational.js isGameday.)
export function defaultNationalWindow(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ET_TZ, year: "numeric", month: "numeric", day: "numeric", weekday: "short" })
    .formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const ahead = (6 - ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) + 7) % 7;
  const [y, mo, d] = [Number(p.year), Number(p.month) - 1, Number(p.day) + ahead];
  return { start: etAt(y, mo, d, 11, 30), end: etAt(y, mo, d, 23, 59) };
}
export function NationalCoverage({ rows = [], now, onOpen, pinned = false }) {
  const def = useMemo(() => defaultNationalWindow(now), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [start, setStart] = useState(toLocalInput(def.start));
  const [end, setEnd] = useState(toLocalInput(def.end));
  const [privacy, setPrivacy] = useState("unlisted");
  const [confirmPublic, setConfirmPublic] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [editing, setEditing] = useState(null); // { startAt, endAt } — the metadata editor's window

  // Open windows first (soonest first), then the three latest closed ones.
  const recs = useMemo(() => {
    const n = rows.filter((b) => isNational(b) && b.auto);
    const open = n.filter((b) => b.auto.open).sort((a, b) => (a.auto.kickoffAt || 0) - (b.auto.kickoffAt || 0));
    const closed = n.filter((b) => !b.auto.open).sort((a, b) => (b.auto.kickoffAt || 0) - (a.auto.kickoffAt || 0)).slice(0, 3);
    return [...open, ...closed];
  }, [rows]);

  const act = async (key, fn, ok) => {
    setBusy(key); setMsg(null);
    try { const r = await fn(); setMsg({ kind: "ok", text: typeof ok === "function" ? ok(r) : ok }); } catch (e) { setMsg({ kind: "error", text: vmError(e) }); } finally { setBusy(""); }
  };
  const schedule = (rehearsal) => {
    const s = Date.parse(start);
    const e = Date.parse(end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return setMsg({ kind: "error", text: "Set a start and an end." });
    if (e <= s) return setMsg({ kind: "error", text: "The end must be after the start." });
    if (privacy === "public" && !confirmPublic && !rehearsal) return setMsg({ kind: "error", text: "Tick the public confirmation, or choose Unlisted." });
    const what = rehearsal
      ? "A rehearsal never touches YouTube: the lifecycle runs with a simulated worker, only on a VM agent in DRY_RUN mode."
      : `The server starts the VM 15 min before, creates the YouTube broadcast (${privacy.toUpperCase()}) and goes live once the stream is received.`;
    if (!window.confirm(`${rehearsal ? "Rehearse" : "Schedule"} national coverage?\n\n${fmtFull(s)} → ${fmtFull(e)}\n\n${what} It ends 15 min after every game in the window is FINAL, or at the end time, whichever comes first.`)) return;
    act(rehearsal ? "rehearse" : "enable",
      () => api("auto-national", { startAt: new Date(s).toISOString(), endAt: new Date(e).toISOString(), privacyStatus: privacy, confirmPublic: privacy === "public" && confirmPublic, ...(rehearsal ? { rehearsal: true } : {}) }),
      (r) => (r.already ? "Already scheduled." : rehearsal ? "Rehearsal scheduled — nothing goes to YouTube." : "Scheduled — it starts automatically 15 min before the window."));
  };
  // Start Now: a new open-ended national broadcast, on air until an admin ends it.
  const startNowNew = () => {
    if (privacy === "public" && !confirmPublic) return setMsg({ kind: "error", text: "Tick the public confirmation, or choose Unlisted." });
    if (!window.confirm(`Start national coverage now?\n\nWithin a minute the server starts the VM, creates the YouTube broadcast (${privacy.toUpperCase()}) and goes live once the stream is received — usually a few minutes.\n\nIt stays on air until you click End Broadcast (failsafe: ${NATIONAL_MAX_H}h). The start/end times above are only for Schedule.`)) return;
    act("start-now", () => api("auto-national", { startNow: true, privacyStatus: privacy, confirmPublic: privacy === "public" && confirmPublic }),
      "Starting — the server prepares it within a minute. End it with End Broadcast.");
  };
  // Start Now on a scheduled window that's still waiting.
  const startNowScheduled = (b) => {
    if (!window.confirm(`Start this ${b.rehearsal ? "rehearsal" : "national coverage"} now instead of 15 min before ${fmtFull(b.auto.kickoffAt)}?\n\nIt still ends at ${fmtFull(b.auto.endAt)}, or 15 min after every game in the window is FINAL.`)) return;
    act(b.id, () => api("auto-start-now", { id: b.id }), (r) => (r.already && r.phase ? "It's already starting." : "Starting — the server prepares it within a minute."));
  };
  const disable = (b) => {
    const onAir = ["live", "postgame"].includes(b.auto.phase);
    if (!window.confirm(onAir ? "National coverage is ON AIR.\n\nDisabling it ends the YouTube broadcast now and stops its worker. End it?" : "Disable this national coverage window?")) return;
    act(b.id, () => api("auto-cancel", { id: b.id, ...(onAir ? { confirmEnd: true } : {}) }), onAir ? "Ending — the server is completing the YouTube broadcast." : "Disabled.");
  };
  const retry = (b) => act(b.id, () => api("auto-retry", { id: b.id }), "Re-enabled.");
  // The editor follows the next open (real) window, else the one set above.
  const editMetadata = () => {
    const open = recs.find((b) => b.auto.open && !b.rehearsal);
    const s = open ? open.auto.kickoffAt : Date.parse(start);
    // An open-ended one (Start Now) has no end: the 12h ahead stand in (as on the server).
    const e = open ? open.auto.endAt ?? s + 12 * 3600e3 : Date.parse(end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return setMsg({ kind: "error", text: "Set a start and an end first — the metadata is generated for that window." });
    setEditing({ startAt: s, endAt: e });
  };

  return (
    <div data-testid={pinned ? "game-national" : undefined}
      style={pinned
        ? { background: "#fffaf0", borderLeft: `5px solid ${GOLD}`, borderBottom: "2px solid #f3e6c8", padding: "14px 16px" }
        : { border: "2px solid #e6ecf3", borderTop: `4px solid ${GOLD}`, borderRadius: 12, background: "#fff", padding: "14px 18px", marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        {pinned && <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", color: "#fff", background: GOLD, borderRadius: 999, padding: "3px 9px" }}>PINNED</span>}
        <div style={{ ...label, marginBottom: 0, color: "#a86b00" }}>National Coverage</div>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#667", fontFamily: "Arial", flex: 1, minWidth: 240 }}>
          Every game's big plays and storylines, no one game — <a href="/broadcast/national" target="_blank" rel="noreferrer" style={{ color: BLUE, fontWeight: 800 }}>/broadcast/national</a>. Uses a stream slot like a game broadcast.
        </span>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <div style={label}>Starts (your time)</div>
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} style={{ ...input, width: 210, padding: "8px 10px" }} />
        </div>
        <div>
          <div style={label}>Ends</div>
          <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} style={{ ...input, width: 210, padding: "8px 10px" }} />
        </div>
        <div>
          <div style={label}>Visibility</div>
          <div style={{ display: "flex", gap: 6 }}>
            {PRIVACY.map((p) => (
              <button key={p.key} type="button" onClick={() => { setPrivacy(p.key); if (p.key !== "public") setConfirmPublic(false); }} title={p.note}
                style={{ ...btn(p.key === "public" ? RED : BLUE, privacy === p.key), padding: "7px 12px" }}>{p.label}</button>
            ))}
          </div>
        </div>
        <button onClick={startNowNew} disabled={!!busy} title="Go on air now; it runs until you end it" style={btn(GREEN, true, !!busy)}>{busy === "start-now" ? "…" : "Start Now"}</button>
        <button onClick={() => schedule(false)} disabled={!!busy} title="A separate national broadcast for this window" style={btn(GREEN, false, !!busy)}>{busy === "enable" ? "…" : "Schedule"}</button>
        <button onClick={() => schedule(true)} disabled={!!busy} style={btn("#7b5ea7", false, !!busy)}>{busy === "rehearse" ? "…" : "Rehearse"}</button>
        <button onClick={editMetadata} title="The national stream's YouTube title, description and thumbnail — saved as a draft only" style={{ ...btn(BLUE, false), padding: "9px 10px" }}>Edit Metadata</button>
      </div>
      {privacy === "public" && (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, fontSize: 12, fontWeight: 800, color: RED, fontFamily: "Arial" }}>
          <input type="checkbox" checked={confirmPublic} onChange={(e) => setConfirmPublic(e.target.checked)} />
          I want this to be a PUBLIC YouTube broadcast, visible to everyone.
        </label>
      )}
      <Message msg={msg} />
      {recs.length > 0 && (
        <div style={{ marginTop: 12, border: "1px solid #eef1f5", borderRadius: 10, overflow: "hidden" }}>
          {recs.map((b) => {
            const a = b.auto;
            const s = autoState(b);
            const onAir = ["live", "postgame"].includes(a.phase);
            return (
              <div key={b.id} data-testid={`national-${b.id}`} style={{ display: "grid", gridTemplateColumns: "minmax(220px,1.4fr) minmax(150px,1.3fr) auto", gap: 10, padding: "10px 14px", alignItems: "center", borderBottom: "1px solid #f0f2f6" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 13, color: INK }}>{a.openEnded ? `${fmtFull(a.kickoffAt)} → until ended` : `${fmtFull(a.kickoffAt)} → ${fmtTime(a.endAt)}`}</div>
                  <div style={{ fontSize: 11, color: "#889", fontWeight: 700, fontFamily: "Arial" }}>{a.openEnded ? "Started now · " : "Scheduled · "}{b.rehearsal ? "Rehearsal" : (b.youtube?.privacyStatus || "")}{a.endReason ? ` · ended: ${a.endReason}` : ""}</div>
                  {a.open && a.phase === "selected" && !a.openEnded && a.prepAt && <div style={{ fontSize: 11, color: "#445", fontWeight: 800 }}>Starts {fmtFull(a.prepAt)}</div>}
                </div>
                <div style={{ minWidth: 0 }}>
                  {s && <Pill s={s} small />}
                  {a.open && a.waiting && <div style={{ fontSize: 11, color: "#667", fontWeight: 700, marginTop: 3 }}>{a.waiting}</div>}
                  {a.error && <div style={{ fontSize: 11, color: RED, fontWeight: 800, marginTop: 3 }}>{a.error}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {a.open ? (
                    <>
                      {a.phase === "selected" && !a.cancelRequested && (a.prepAt || 0) > now && (
                        <button onClick={() => startNowScheduled(b)} disabled={!!busy} style={btn(GREEN, true, !!busy)}>Start Now</button>
                      )}
                      <button onClick={() => disable(b)} disabled={!!busy || a.cancelRequested || a.phase === "ending"} style={btn(RED, onAir, !!busy || a.cancelRequested || a.phase === "ending")}>
                        {busy === b.id ? "…" : onAir ? "End Broadcast" : "Disable"}
                      </button>
                    </>
                  ) : ["failed", "cancelled"].includes(a.phase) && (a.openEnded || (a.endAt || 0) > now) ? (
                    <button onClick={() => retry(b)} disabled={!!busy || a.ytUnconfirmed === true} style={btn(GOLD, true, !!busy || a.ytUnconfirmed === true)}>{busy === b.id ? "…" : "Retry"}</button>
                  ) : null}
                  {onOpen && <button onClick={() => onOpen(b.id)} style={{ ...btn("#889", false), padding: "9px 10px" }}>Open</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editing && <MetadataEditor national={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// Container: loads the schedule and live statuses, renders AutoSchedule
// (national coverage is its pinned first row).
function AutoPanel({ rows, now, onOpen, onBack }) {
  const [games, setGames] = useState(null);
  const [statusById, setStatusById] = useState({});
  const [orchDoc, setOrchDoc] = useState(null);
  const [agentDoc, setAgentDoc] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const since = new Date(Date.now() - 6 * 3600e3);
    getDocs(query(collection(db, "schedule26"), where("KickoffAt", ">=", since), orderBy("KickoffAt"), limit(500)))
      .then((snap) => setGames(snap.docs.map((d) => { const x = d.data(); return { id: d.id, ...x, KickoffAt: ms(x.KickoffAt) }; })))
      .catch((e) => { setErr(e.message); setGames([]); });
    const unsubs = [
      onSnapshot(doc(db, "liveSlate", "current"), (s) => setStatusById(Object.fromEntries((s.data()?.games || []).map((g) => [String(g.id), g.status])))),
      onSnapshot(doc(db, "streamManager", "orchestrator"), (s) => setOrchDoc(s.data() || null), () => {}),
      onSnapshot(doc(db, "streamManager", "agent"), (s) => setAgentDoc(s.data() || null), () => {}),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  return (
    <div>
      <button onClick={onBack} style={{ ...btn("#889", false), marginBottom: 14 }}>← All broadcasts</button>
      {err && <Message msg={{ kind: "error", text: `Couldn't load the schedule: ${err}` }} />}
      <SlotSettings orchDoc={orchDoc} />
      <AutoSchedule games={games} statusById={statusById} rows={rows || []} orchDoc={orchDoc} agentDoc={agentDoc} now={now} onOpen={onOpen} />
    </div>
  );
}

// ── Create / edit form ──
function BroadcastForm({ games, existing, onDone, onCancel }) {
  const editing = !!existing;
  const [gameId, setGameId] = useState(existing?.gameId || "");
  const game = games.find((g) => g.id === gameId);
  const [title, setTitle] = useState(existing?.youtube?.title || "");
  const [description, setDescription] = useState(existing?.youtube?.description || "");
  const [privacy, setPrivacy] = useState(existing?.youtube?.privacyStatus || "unlisted");
  const [confirmPublic, setConfirmPublic] = useState(existing?.youtube?.privacyStatus === "public");
  const [start, setStart] = useState(existing ? toLocalInput(ms(existing.scheduledStart)) : "");
  const [touched, setTouched] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // New broadcast: the game fills in the defaults until something's typed.
  useEffect(() => {
    if (editing || !game || touched) return;
    setTitle(defaultTitle(game));
    setDescription(defaultDescription(game));
    setStart(toLocalInput(Date.parse(game.startDate)));
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setErr("");
    if (!editing && !gameId) return setErr("Pick a game.");
    if (!start) return setErr("Set a scheduled start.");
    if (privacy === "public" && !confirmPublic) return setErr("Tick the public confirmation, or choose Unlisted.");
    setBusy(true);
    try {
      const payload = { title, description, privacyStatus: privacy, confirmPublic: privacy === "public" && confirmPublic, scheduledStart: new Date(start).toISOString() };
      const r = editing ? await api("update", { id: existing.id, ...payload }) : await api("create", { gameId, ...payload });
      onDone(editing ? existing.id : r.id);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const byDay = useMemo(() => {
    const m = new Map();
    games.forEach((g) => { const k = fmtDay(Date.parse(g.startDate)); if (!m.has(k)) m.set(k, []); m.get(k).push(g); });
    return [...m.entries()];
  }, [games]);

  return (
    <div style={{ border: "2px solid #e6ecf3", borderRadius: 12, background: "#fff", padding: 20 }}>
      <div style={{ fontSize: 18, fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 16 }}>
        {editing ? "Edit Broadcast" : "New Broadcast"}
      </div>
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <div style={label}>Game</div>
          {editing ? (
            <div style={{ fontWeight: 900, color: INK }}>{matchup(existing)} <span style={{ color: "#889", fontSize: 12 }}>· game {existing.gameId}</span></div>
          ) : (
            <select value={gameId} onChange={(e) => setGameId(e.target.value)} style={input}>
              <option value="">{games.length ? "Select a We-Draft Live game…" : "No upcoming games in We-Draft Live yet"}</option>
              {byDay.map(([day, gs]) => (
                <optgroup key={day} label={day}>
                  {gs.map((g) => (
                    <option key={g.id} value={g.id}>
                      {teamName(g.away)} at {teamName(g.home)} — {g.startTimeTBD ? "TBD" : fmtTime(Date.parse(g.startDate))}{g.tv ? ` · ${g.tv}` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </div>
        <div>
          <div style={label}>YouTube Title <span style={{ color: title.length > 100 ? RED : "#aab" }}>{title.length}/100</span></div>
          <input value={title} onChange={(e) => { setTitle(e.target.value); setTouched(true); }} style={input} placeholder="We-Draft Live: Clemson vs LSU" />
        </div>
        <div>
          <div style={label}>YouTube Description</div>
          <textarea value={description} onChange={(e) => { setDescription(e.target.value); setTouched(true); }} rows={5} style={{ ...input, resize: "vertical" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={label}>Visibility</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PRIVACY.map((p) => (
                <button key={p.key} type="button" onClick={() => { setPrivacy(p.key); if (p.key !== "public") setConfirmPublic(false); }} title={p.note}
                  style={{ ...btn(p.key === "public" ? RED : BLUE, privacy === p.key), padding: "8px 14px" }}>
                  {p.label}
                </button>
              ))}
            </div>
            {privacy === "public" && (
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, fontSize: 12, fontWeight: 800, color: RED, fontFamily: "Arial" }}>
                <input type="checkbox" checked={confirmPublic} onChange={(e) => setConfirmPublic(e.target.checked)} />
                I want this to be a PUBLIC YouTube broadcast, visible to everyone.
              </label>
            )}
          </div>
          <div>
            <div style={label}>Scheduled Start (your local time)</div>
            <input type="datetime-local" value={start} onChange={(e) => { setStart(e.target.value); setTouched(true); }} style={input} />
            {game && <div style={{ fontSize: 11, color: "#889", marginTop: 5, fontWeight: 700 }}>Kickoff {game.startTimeTBD ? "TBD" : fmtFull(Date.parse(game.startDate))}</div>}
          </div>
        </div>
      </div>
      <Message msg={err && { kind: "error", text: err }} />
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button onClick={submit} disabled={busy} style={btn(BLUE, true, busy)}>{busy ? "Saving…" : editing ? "Save Changes" : "Create Broadcast Record"}</button>
        <button onClick={onCancel} disabled={busy} style={btn("#889", false, busy)}>Cancel</button>
      </div>
      {!editing && (
        <div style={{ fontSize: 12, color: "#889", marginTop: 12, fontFamily: "Arial" }}>
          This saves the plan in We-Draft only. The YouTube broadcast is created from the broadcast's detail view.
        </div>
      )}
    </div>
  );
}

// ── Detail ──
function Panel({ title, children, accent = BLUE }) {
  return (
    <div style={{ border: "2px solid #e6ecf3", borderTop: `4px solid ${accent}`, borderRadius: 12, background: "#fff", padding: "14px 16px" }}>
      <div style={{ ...label, color: accent, marginBottom: 12 }}>{title}</div>
      <div style={{ display: "grid", gap: 9 }}>{children}</div>
    </div>
  );
}
function Row({ k, children, mono }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", fontSize: 13 }}>
      <span style={{ color: "#889", fontWeight: 800, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{k}</span>
      <span style={{ fontWeight: 800, color: INK, textAlign: "right", fontFamily: mono ? "monospace" : "inherit", wordBreak: "break-all" }}>{children ?? "—"}</span>
    </div>
  );
}

function BroadcastDetail({ b, onBack, onEdit }) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const y = b.youtube || {};
  const w = b.worker || {};
  const bound = !!(y.broadcastId && y.streamId);
  const creating = y.creatingAt && Date.now() - y.creatingAt < 90000;

  const run = async (what, action, ok) => {
    setBusy(what); setMsg(null);
    try {
      const r = await api(action, { id: b.id });
      setMsg({ kind: "ok", text: typeof ok === "function" ? ok(r) : ok });
      return true;
    } catch (e) { setMsg({ kind: "error", text: e.message }); return false; } finally { setBusy(""); }
  };
  const createYt = () => {
    const vis = (y.privacyStatus || "unlisted").toUpperCase();
    if (!window.confirm(`Create the YouTube broadcast now?\n\n“${y.title}”\nVisibility: ${vis}\nStart: ${fmtFull(ms(b.scheduledStart))}`)) return;
    run("create", "youtube-create", (r) => `YouTube broadcast ${r.broadcastId} created and bound to the worker stream.${r.streamCreated ? " A new “We-Draft Live Worker” stream was created — put its key (YouTube Studio) on the worker VM." : ""}`);
  };
  const uploadThumb = () => {
    if (!window.confirm("Upload this game's saved thumbnail (Auto Schedule → Edit Metadata) to its YouTube broadcast? It replaces the broadcast's current thumbnail.")) return;
    run("thumb", "youtube-thumbnail", "Thumbnail uploaded to YouTube.");
  };
  const del = () => {
    const warn = y.broadcastId ? "\n\nThis only removes the We-Draft record — the YouTube broadcast stays on YouTube (delete it in Studio if it's not wanted)." : "";
    if (!window.confirm(`Delete this broadcast record?${warn}`)) return;
    run("delete", "delete", "Deleted.").then((ok) => ok && onBack());
  };

  return (
    <div>
      <button onClick={onBack} style={{ ...btn("#889", false), marginBottom: 14 }}>← All broadcasts</button>
      <div style={{ background: INK, color: "#fff", borderRadius: 12, padding: "18px 20px", marginBottom: 14, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {b.awayTeam?.logo && <img src={b.awayTeam.logo} alt="" style={{ width: 40, height: 40, objectFit: "contain" }} />}
          <span style={{ color: GOLD, fontWeight: 900 }}>VS</span>
          {b.homeTeam?.logo && <img src={b.homeTeam.logo} alt="" style={{ width: 40, height: 40, objectFit: "contain" }} />}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 20, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.03em" }}>{matchup(b)}</div>
          <div style={{ fontSize: 13, color: "#9fb3cc", fontWeight: 700, fontFamily: "Arial" }}>{y.title}</div>
        </div>
        <Pill s={OVERALL[overallStatus(b)] || OVERALL.scheduled} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        {isNational(b) ? (
          <Panel title="Coverage">
            <Row k="Broadcast">National — every game</Row>
            <Row k="Window starts">{fmtFull(b.national?.startAt ?? b.auto?.kickoffAt)}</Row>
            <Row k="Window ends">{b.auto?.openEnded ? "When ended (Start Now)" : fmtFull(b.national?.endAt ?? b.auto?.endAt)}</Row>
            <Row k="Broadcast start">{fmtFull(ms(b.scheduledStart))}</Row>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <a href="/live" target="_blank" rel="noreferrer" style={{ ...btn(BLUE, false), textDecoration: "none", padding: "6px 10px", fontSize: 11 }}>/live</a>
              <a href="/broadcast/national" target="_blank" rel="noreferrer" style={{ ...btn(BLUE, false), textDecoration: "none", padding: "6px 10px", fontSize: 11 }}>Broadcast preview</a>
            </div>
          </Panel>
        ) : (
        <Panel title="Game">
          <Row k="Matchup">{matchup(b)}</Row>
          <Row k="Kickoff">{fmtFull(ms(b.kickoff))}</Row>
          <Row k="Broadcast start">{fmtFull(ms(b.scheduledStart))}</Row>
          <Row k="Game ID" mono>{b.gameId}</Row>
          <Row k="Slug" mono>{b.gameSlug}</Row>
          {b.gameSlug && (
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <a href={`/live/${b.gameSlug}`} target="_blank" rel="noreferrer" style={{ ...btn(BLUE, false), textDecoration: "none", padding: "6px 10px", fontSize: 11 }}>/live</a>
              <a href={`/broadcast/${b.gameSlug}`} target="_blank" rel="noreferrer" style={{ ...btn(BLUE, false), textDecoration: "none", padding: "6px 10px", fontSize: 11 }}>Broadcast preview</a>
            </div>
          )}
        </Panel>
        )}

        {b.rehearsal ? (
          <Panel title="YouTube (simulated)" accent="#7b5ea7">
            <div style={{ fontSize: 12, color: "#7b5ea7", fontWeight: 900, fontFamily: "Arial" }}>
              Rehearsal — no YouTube broadcast exists or will be created. These states are simulated.
            </div>
            <Row k="Simulated lifecycle" mono>{b.auto?.sim?.lifecycleStatus}</Row>
            <Row k="Simulated stream" mono>{b.auto?.sim?.streamStatus}</Row>
          </Panel>
        ) : (
        <Panel title="YouTube" accent={RED}>
          <Row k="State"><Pill s={youtubeState(y)} small /></Row>
          <Row k="Broadcast ID" mono>{y.broadcastId}</Row>
          <Row k="Video ID" mono>{y.videoId}</Row>
          <Row k="Visibility">{y.privacyStatus ? y.privacyStatus[0].toUpperCase() + y.privacyStatus.slice(1) : "—"}</Row>
          <Row k="Lifecycle" mono>{y.lifecycleStatus}</Row>
          <Row k="Stream" mono>{y.streamId ? `${y.streamStatus || "?"}` : null}</Row>
          <Row k="Ingest health">{y.streamId ? <Pill s={health(y.healthStatus)} small /> : "—"}</Row>
          <Row k="Last synced">{y.lastSyncedAt ? fmtFull(ms(y.lastSyncedAt)) : "—"}</Row>
          {y.error && <div style={{ fontSize: 12, color: RED, fontWeight: 800, fontFamily: "Arial" }}>{y.error}</div>}
          {y.broadcastId && (
            <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
              <a href={`https://studio.youtube.com/video/${y.broadcastId}/livestreaming`} target="_blank" rel="noreferrer" style={{ ...btn(RED, false), textDecoration: "none", padding: "6px 10px", fontSize: 11 }}>Studio</a>
              <a href={`https://www.youtube.com/watch?v=${y.videoId}`} target="_blank" rel="noreferrer" style={{ ...btn(RED, false), textDecoration: "none", padding: "6px 10px", fontSize: 11 }}>Watch page</a>
            </div>
          )}
        </Panel>
        )}

        <Panel title="Worker" accent="#556">
          <Row k="Status"><Pill s={WORKER[w.status] || WORKER.idle} small /></Row>
          <Row k="Instance" mono>{w.instanceId}</Row>
          <Row k="Last heartbeat">{w.lastHeartbeat ? fmtFull(ms(w.lastHeartbeat)) : "—"}</Row>
          <Row k="Started">{w.startedAt ? fmtFull(ms(w.startedAt)) : "—"}</Row>
          <Row k="Stopped">{w.stoppedAt ? fmtFull(ms(w.stoppedAt)) : "—"}</Row>
          {w.error && <div style={{ fontSize: 12, color: RED, fontWeight: 800, fontFamily: "Arial" }}>{w.error}</div>}
          <div style={{ fontSize: 11, color: "#99a", fontWeight: 800, fontFamily: "Arial" }}>
            {b.auto?.enabled ? "Started and stopped automatically (Auto Schedule)." : "Workers run only for games (or national coverage) enabled in Auto Schedule."}
          </div>
        </Panel>

        {b.auto && (
          <Panel title="Automation" accent={GOLD}>
            <Row k="State"><Pill s={autoState(b) || AUTO.selected} small /></Row>
            <Row k="Mode">{b.rehearsal ? "Rehearsal (simulated, no YouTube)" : "Real broadcast"}</Row>
            <Row k="Phase" mono>{b.auto.phase}</Row>
            <Row k={isNational(b) ? "Window" : "Kickoff"}>{isNational(b) ? `${fmtFull(b.auto.kickoffAt)} → ${b.auto.openEnded ? "until ended" : fmtTime(b.auto.endAt)}` : fmtFull(b.auto.kickoffAt)}</Row>
            <Row k="Prep starts">{fmtFull(b.auto.prepAt)}</Row>
            <Row k="Stream slot">{b.auto.slot ?? "—"}</Row>
            <Row k={isNational(b) ? "All final seen" : "Final seen"}>{b.auto.finalSeenAt ? fmtFull(b.auto.finalSeenAt) : "—"}</Row>
            <Row k="Failsafe end">{b.auto.deadlineAt ? fmtFull(b.auto.deadlineAt) : "—"}</Row>
            {b.auto.endReason && <Row k="Ended">{b.auto.endReason}</Row>}
            {b.auto.waiting && <div style={{ fontSize: 12, color: "#667", fontWeight: 800, fontFamily: "Arial" }}>{b.auto.waiting}</div>}
            {b.auto.error && <div style={{ fontSize: 12, color: RED, fontWeight: 800, fontFamily: "Arial" }}>{b.auto.error}</div>}
            {b.auto.ytUnconfirmed === true && (
              <div style={{ fontSize: 12, color: RED, fontWeight: 900, fontFamily: "Arial" }}>
                YouTube end unconfirmed — the broadcast may still be on air. Check YouTube Studio, then Refresh YouTube Status. Retry and Delete stay blocked until YouTube confirms it's off the air.
              </div>
            )}
          </Panel>
        )}
      </div>

      <div style={{ marginTop: 14, border: "2px solid #e6ecf3", borderRadius: 12, background: "#fff", padding: "14px 16px" }}>
        <div style={{ ...label, marginBottom: 10 }}>Actions</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {!bound && !b.rehearsal && (
            <button onClick={createYt} disabled={!!busy || creating} style={btn(RED, true, !!busy || creating)}>
              {busy === "create" || creating ? "Creating on YouTube…" : y.broadcastId ? "Finish YouTube Setup (bind stream)" : "Create YouTube Broadcast"}
            </button>
          )}
          {!b.rehearsal && (
            <button onClick={() => run("refresh", "youtube-refresh", "YouTube status refreshed.")} disabled={!!busy || !y.broadcastId} style={btn(BLUE, false, !!busy || !y.broadcastId)}>
              {busy === "refresh" ? "Refreshing…" : "Refresh YouTube Status"}
            </button>
          )}
          {!b.rehearsal && b.kind !== "national" && y.broadcastId && (
            <button onClick={uploadThumb} disabled={!!busy} title={y.thumbnailUploadedAt ? `Last uploaded ${fmtFull(y.thumbnailUploadedAt)}` : undefined} style={btn(BLUE, false, !!busy)}>
              {busy === "thumb" ? "Uploading…" : "Upload Thumbnail"}
            </button>
          )}
          {!y.broadcastId && <button onClick={onEdit} disabled={!!busy} style={btn("#556", false, !!busy)}>Edit</button>}
          <span style={{ flex: 1 }} />
          <button onClick={del} disabled={!!busy || !!b.auto?.open || !!b.auto?.active || b.auto?.ytUnconfirmed === true}
            title={b.auto?.open || b.auto?.active ? "Under automation — disable it in Auto Schedule first" : b.auto?.ytUnconfirmed === true ? "YouTube end unconfirmed — Refresh YouTube Status first" : undefined}
            style={btn(RED, false, !!busy || !!b.auto?.open || !!b.auto?.active || b.auto?.ytUnconfirmed === true)}>Delete Record</button>
        </div>
        <Message msg={msg} />
      </div>
    </div>
  );
}

// ── List ──
function BroadcastList({ rows, onOpen }) {
  if (!rows.length) {
    return (
      <div style={{ border: "2px dashed #dde3ea", borderRadius: 12, padding: "40px 20px", textAlign: "center", color: "#99a", fontWeight: 800, fontSize: 13 }}>
        No broadcasts here. “+ New Broadcast” plans one for a We-Draft Live game.
      </div>
    );
  }
  const cols = "1.6fr 0.8fr 0.7fr 1fr 0.9fr 0.9fr 90px";
  const head = { ...label, marginBottom: 0, fontSize: 10 };
  return (
    <div style={{ border: "2px solid #e6ecf3", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "10px 16px", background: "#f6f8fb", borderBottom: "1px solid #e6ecf3" }}>
        {["Game", "Date", "Time", "YouTube", "Worker", "Status", ""].map((h) => <div key={h} style={head}>{h}</div>)}
      </div>
      {rows.map((b) => {
        const t = ms(b.scheduledStart);
        return (
          <div key={b.id} onClick={() => onOpen(b.id)} style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "12px 16px", alignItems: "center", borderBottom: "1px solid #f0f2f6", cursor: "pointer" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f8fbff"; }} onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              {b.awayTeam?.logo && <img src={b.awayTeam.logo} alt="" style={{ width: 22, height: 22, objectFit: "contain" }} />}
              {b.homeTeam?.logo && <img src={b.homeTeam.logo} alt="" style={{ width: 22, height: 22, objectFit: "contain" }} />}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: 14, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{matchup(b)}</div>
                <div style={{ fontSize: 11, color: "#889", fontWeight: 700, fontFamily: "Arial", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {b.youtube?.privacyStatus || ""}{b.youtube?.title ? ` · ${b.youtube.title}` : ""}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#445" }}>{fmtDay(t)}</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#445" }}>{fmtTime(t)}</div>
            <div><Pill s={youtubeState(b.youtube)} small /></div>
            <div><Pill s={WORKER[b.worker?.status] || WORKER.idle} small /></div>
            <div><Pill s={OVERALL[overallStatus(b)] || OVERALL.scheduled} small /></div>
            <div style={{ textAlign: "right", fontSize: 12, fontWeight: 900, color: BLUE, textTransform: "uppercase" }}>Open →</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Section ──
export default function AdminStreamManager() {
  const [rows, setRows] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [games, setGames] = useState([]);
  const [view, setView] = useState({ kind: "list" }); // list | auto | new | detail {id} | edit {id}
  const [filter, setFilter] = useState("upcoming");
  const [msg, setMsg] = useState(null);
  const [now, setNow] = useState(Date.now());

  // Back from Google's consent screen: ?section=streams&yt=connected|error
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("yt") === "connected") setMsg({ kind: "ok", text: `YouTube channel connected: ${p.get("channel") || ""}` });
    if (p.get("yt") === "error") setMsg({ kind: "error", text: `YouTube connection failed: ${p.get("msg") || "unknown error"}` });
    if (p.get("yt")) window.history.replaceState(null, "", "/admin?section=streams");
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => onSnapshot(query(collection(db, "broadcasts"), orderBy("scheduledStart", "desc"), limit(200)),
    (snap) => { setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoadErr(""); },
    (e) => { console.error("Stream Manager broadcasts error:", e); setLoadErr(e.message); setRows([]); }), []);

  // Pickable games: We-Draft Live's own liveGames docs (this game week's), not started more than 6h ago.
  useEffect(() => {
    const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    getDocs(query(collection(db, "liveGames"), where("startDate", ">=", since), orderBy("startDate"), limit(300)))
      .then((snap) => setGames(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((e) => console.error("Stream Manager games error:", e));
  }, []);

  const shown = useMemo(() => filterBroadcasts(rows, filter), [rows, filter]);
  const counts = useMemo(() => statusCounts(rows), [rows]);

  // Two steps: list what would change, then apply only on confirmation.
  const [repairing, setRepairing] = useState(false);
  const repairStatuses = async () => {
    setRepairing(true); setMsg(null);
    try {
      const { changes } = await api("refresh-statuses");
      if (!changes.length) return setMsg({ kind: "ok", text: "All broadcast statuses are consistent — nothing to repair." });
      const list = changes.slice(0, 12).map((c) => `• ${c.matchup}: ${c.from || "—"} → ${c.to}${c.disableAuto ? " (automation disabled)" : ""}`).join("\n");
      if (!window.confirm(`Repair ${changes.length} broadcast status${changes.length > 1 ? "es" : ""}?\n\n${list}${changes.length > 12 ? "\n…" : ""}\n\nOnly the stored status (and auto.enabled on cancelled records) changes. Nothing is deleted, and nothing on YouTube or the VM is touched.`)) return;
      const r = await api("refresh-statuses", { apply: true });
      setMsg({ kind: "ok", text: `Repaired ${r.changes.length} status${r.changes.length > 1 ? "es" : ""}.` });
    } catch (e) { setMsg({ kind: "error", text: vmError(e) }); } finally { setRepairing(false); }
  };

  const current = (view.kind === "detail" || view.kind === "edit") && (rows || []).find((b) => b.id === view.id);

  return (
    <div>
      <style>{"@keyframes smPulse{0%{transform:scale(.6);opacity:.9}100%{transform:scale(1.8);opacity:0}}"}</style>

      {/* Control-room header */}
      <div style={{ background: `linear-gradient(90deg, ${INK}, #12305a)`, borderRadius: 12, padding: "16px 20px", marginBottom: 16, color: "#fff", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 22, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            <span style={{ color: GOLD }}>●</span> Stream Manager
          </div>
          <div style={{ fontSize: 12, color: "#9fb3cc", fontWeight: 700, fontFamily: "Arial" }}>We-Draft Live → YouTube Live control plane</div>
        </div>
        {[["live", "Live"], ["preparing", "Preparing"], ["scheduled", "Scheduled"], ["error", "Error"]].map(([k, l]) => (
          <div key={k} style={{ textAlign: "center", minWidth: 70 }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: counts[k] ? OVERALL[k].color === "#333" ? "#fff" : OVERALL[k].color : "#4d6584" }}>{counts[k]}</div>
            <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9fb3cc" }}>{l}</div>
          </div>
        ))}
        <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 700, color: GOLD, minWidth: 110, textAlign: "right" }}>
          {new Date(now).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </div>
      </div>

      <Message msg={msg} />
      <ChannelPanel onMessage={setMsg} />
      <VmPanel liveCount={counts.live} />

      {view.kind === "auto" && (
        <AutoPanel rows={rows} now={now} onOpen={(id) => setView({ kind: "detail", id })} onBack={() => setView({ kind: "list" })} />
      )}
      {view.kind === "new" && (
        <BroadcastForm games={games} onCancel={() => setView({ kind: "list" })} onDone={(id) => { setMsg({ kind: "ok", text: "Broadcast record created." }); setView({ kind: "detail", id }); }} />
      )}
      {view.kind === "edit" && current && (
        <BroadcastForm games={games} existing={current} onCancel={() => setView({ kind: "detail", id: current.id })} onDone={(id) => setView({ kind: "detail", id })} />
      )}
      {view.kind === "detail" && current && (
        <BroadcastDetail b={current} onBack={() => setView({ kind: "list" })} onEdit={() => setView({ kind: "edit", id: current.id })} />
      )}
      {(view.kind === "detail" || view.kind === "edit") && rows && !current && (
        <div>
          <Message msg={{ kind: "error", text: "That broadcast record is gone." }} />
          <button onClick={() => setView({ kind: "list" })} style={btn("#889", false)}>← All broadcasts</button>
        </div>
      )}

      {view.kind === "list" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {[["upcoming", "Upcoming"], ["ended", "Ended"], ["all", "All"]].map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} style={{ ...btn(BLUE, filter === k), padding: "7px 14px" }}>{l}</button>
            ))}
            <span style={{ flex: 1 }} />
            <button onClick={repairStatuses} disabled={repairing} style={btn("#556", false, repairing)} title="Recompute stored statuses of closed records (shows the changes first)">{repairing ? "Checking…" : "Repair Statuses"}</button>
            <button onClick={() => setView({ kind: "auto" })} style={btn(BLUE, true)}>Auto Schedule</button>
            <button onClick={() => setView({ kind: "new" })} style={btn(GOLD, true)}>+ New Broadcast</button>
          </div>
          {loadErr && <Message msg={{ kind: "error", text: `Couldn't load broadcasts: ${loadErr}` }} />}
          {rows === null ? (
            <div style={{ padding: 30, textAlign: "center", color: "#99a", fontWeight: 800 }}>Loading…</div>
          ) : (
            <BroadcastList rows={shown} onOpen={(id) => setView({ kind: "detail", id })} />
          )}
        </>
      )}
    </div>
  );
}
