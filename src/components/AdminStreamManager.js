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
//   Broadcasts  broadcasts/{id} records, live from Firestore (admin read)
//   New         pick a liveGames game, title / description / visibility / start
//   Detail      GAME / YOUTUBE / WORKER panels + actions
//
// Every change goes through api/stream-manager.js (admin-checked); nothing
// here writes Firestore or sees a token or stream key. The per-broadcast
// worker controls are placeholders until the orchestration phase.
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { auth, db } from "../firebase";

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
  error: { label: "Error", color: RED },
};

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
const matchup = (b) => `${teamName(b.awayTeam)} vs ${teamName(b.homeTeam)}`;
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
const isLiveGuard = (e) => e?.status === 409 && /broadcast is live/i.test(e.message || "");
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
        const typed = window.prompt(`${e.message}\n\nStopping now ENDS the live stream. Type STOP to stop the VM anyway.`);
        if (typed !== "STOP") return setMsg({ kind: "error", text: "Stop cancelled — a broadcast is live, so the VM was left running." });
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
        <Pill s={OVERALL[b.status] || OVERALL.scheduled} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
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

        <Panel title="Worker" accent="#556">
          <Row k="Status"><Pill s={WORKER[w.status] || WORKER.idle} small /></Row>
          <Row k="Instance" mono>{w.instanceId}</Row>
          <Row k="Last heartbeat">{w.lastHeartbeat ? fmtFull(ms(w.lastHeartbeat)) : "—"}</Row>
          <Row k="Started">{w.startedAt ? fmtFull(ms(w.startedAt)) : "—"}</Row>
          <Row k="Stopped">{w.stoppedAt ? fmtFull(ms(w.stoppedAt)) : "—"}</Row>
          {w.error && <div style={{ fontSize: 12, color: RED, fontWeight: 800, fontFamily: "Arial" }}>{w.error}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button disabled style={btn(GREEN, true, true)} title="Coming soon — worker orchestration is the next phase">Start Worker</button>
            <button disabled style={btn(RED, false, true)} title="Coming soon — worker orchestration is the next phase">Stop Worker</button>
          </div>
          <div style={{ fontSize: 11, color: "#99a", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>Coming soon</div>
        </Panel>
      </div>

      <div style={{ marginTop: 14, border: "2px solid #e6ecf3", borderRadius: 12, background: "#fff", padding: "14px 16px" }}>
        <div style={{ ...label, marginBottom: 10 }}>Actions</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {!bound && (
            <button onClick={createYt} disabled={!!busy || creating} style={btn(RED, true, !!busy || creating)}>
              {busy === "create" || creating ? "Creating on YouTube…" : y.broadcastId ? "Finish YouTube Setup (bind stream)" : "Create YouTube Broadcast"}
            </button>
          )}
          <button onClick={() => run("refresh", "youtube-refresh", "YouTube status refreshed.")} disabled={!!busy || !y.broadcastId} style={btn(BLUE, false, !!busy || !y.broadcastId)}>
            {busy === "refresh" ? "Refreshing…" : "Refresh YouTube Status"}
          </button>
          {!y.broadcastId && <button onClick={onEdit} disabled={!!busy} style={btn("#556", false, !!busy)}>Edit</button>}
          <span style={{ flex: 1 }} />
          <button onClick={del} disabled={!!busy} style={btn(RED, false, !!busy)}>Delete Record</button>
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
            <div><Pill s={OVERALL[b.status] || OVERALL.scheduled} small /></div>
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
  const [view, setView] = useState({ kind: "list" }); // list | new | detail {id} | edit {id}
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

  const shown = useMemo(() => {
    const all = rows || [];
    if (filter === "all") return all;
    const done = (b) => b.status === "ended";
    return filter === "upcoming"
      ? all.filter((b) => !done(b)).sort((a, b) => ms(a.scheduledStart) - ms(b.scheduledStart))
      : all.filter(done);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c = { live: 0, preparing: 0, scheduled: 0, error: 0 };
    (rows || []).forEach((b) => { if (c[b.status] != null) c[b.status]++; });
    return c;
  }, [rows]);

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
