// src/components/AdminOnTheClock.jsx
//
// Admin → Stream Manager → On the Clock: the nightly Draft Sim broadcast
// (utils/draftSim/onTheClock.js).
//   Nightly schedule   on/off, when the stream goes up and when Round 1
//                      Pick 1 goes on the clock (ET), and each weekday's
//                      format (or no show) — config/onTheClock
//   Shows              each show's script (simShows/{id}): generate one in
//                      this browser (the CPU drafts all 32 teams, with the
//                      full desk), preview it at any point, regenerate it
//                      until it's on — and put it on YouTube: Stream
//                      Manager's automation (server/stream-manager/
//                      orchestrator.js, kind "otc") starts the VM and the
//                      worker 15 min before the stream time, goes live and
//                      ends at the show's end. Rehearse runs the same steps
//                      with YouTube simulated.
import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, limit, deleteDoc, doc, where, updateDoc, deleteField } from "firebase/firestore";
import { db, auth } from "../firebase";
import { SHOW_FORMATS, DEFAULT_FORMAT, showTimeline, showEndsAt, showIdFor, showTimes, startForFirstPick, INTRO_MS } from "../utils/draftSim/onTheClock";
import { loadConfig, saveConfig, generateShow, saveShow, easternTime, nightFormat, streamTimeOf, DEFAULT_CONFIG, SCHEDULE_REF } from "../utils/draftSim/onTheClockData";
import { MetadataEditor } from "./AdminStreamManager";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const card = { background: "#fff", border: "1px solid #dde3ec", borderRadius: 12, padding: 16, marginBottom: 16 };
const btn = (bg, disabled) => ({ background: disabled ? "#aab" : bg, color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 800, cursor: disabled ? "default" : "pointer" });
const input = { padding: "6px 8px", border: "1px solid #ccd", borderRadius: 6, fontSize: 14 };

const fmtWhen = (ms) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
const fmtTime = (ms) => new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const fmtLen = (ms) => `${Math.floor(ms / 3600000)}h ${String(Math.round((ms % 3600000) / 60000)).padStart(2, "0")}m`;

function statusOf(s, now) {
  const end = showEndsAt(s, showTimeline(s));
  if (now >= end) return ["Aired", "#778"];
  if (now >= s.startAt) return ["On air", "#d62828"];
  if (now >= showTimes(s).stream) return ["Pre-show", GOLD];
  return ["Ready", "#2e7d32"];
}

function Schedule({ onMessage }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { loadConfig().then(setCfg).catch((e) => { setCfg(DEFAULT_CONFIG); onMessage({ kind: "error", text: e.message }); }); }, [onMessage]);
  if (!cfg) return <div style={card}>Loading schedule…</div>;
  const setNight = (d, patch) => setCfg((c) => ({ ...c, nights: { ...c.nights, [d]: { ...nightFormat(c, d), ...patch } } }));
  const save = async () => {
    if (streamTimeOf(cfg) >= cfg.startTime) { onMessage({ kind: "error", text: "The stream has to start before the first pick." }); return; }
    setSaving(true);
    try { await saveConfig(cfg); onMessage({ kind: "ok", text: "Schedule saved." }); } catch (e) { onMessage({ kind: "error", text: e.message }); }
    setSaving(false);
  };
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>Nightly schedule</div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
          <input type="checkbox" checked={!!cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} /> On
        </label>
        <label style={{ fontWeight: 700 }}>Stream starts (ET) <input type="time" value={streamTimeOf(cfg)} onChange={(e) => setCfg({ ...cfg, streamTime: e.target.value })} style={input} /></label>
        <label style={{ fontWeight: 700 }}>First pick (ET) <input type="time" value={cfg.startTime} onChange={(e) => setCfg({ ...cfg, startTime: e.target.value })} style={input} /></label>
        <span style={{ flex: 1 }} />
        <button onClick={save} disabled={saving} style={btn(BLUE, saving)}>{saving ? "Saving…" : "Save schedule"}</button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <tbody>
          {DAYS.map((day, d) => {
            const n = nightFormat(cfg, d);
            return (
              <tr key={day} style={{ borderTop: "1px solid #eef" }}>
                <td style={{ padding: "6px 4px", fontWeight: 800, width: 110 }}>{day}</td>
                <td style={{ padding: "6px 4px" }}>
                  <label style={{ marginRight: 10 }}><input type="checkbox" checked={!n.off} onChange={(e) => setNight(d, { off: !e.target.checked })} /> Show</label>
                  <select value={n.format} disabled={n.off} onChange={(e) => setNight(d, { format: e.target.value })} style={input}>
                    {Object.entries(SHOW_FORMATS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
                  </select>
                  <select value={n.rounds || ""} disabled={n.off} onChange={(e) => setNight(d, { rounds: Number(e.target.value) || null })} style={{ ...input, marginLeft: 8 }}>
                    <option value="">Format's rounds ({SHOW_FORMATS[n.format].rounds})</option>
                    {[1, 2, 3, 4, 5, 6, 7].map((r) => <option key={r} value={r}>{r} round{r === 1 ? "" : "s"}</option>)}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ fontSize: 12, color: "#667", marginTop: 8 }}>
        The stream opens on the countdown, the {INTRO_MS / 1000}-second intro plays at its end, and Round 1 Pick 1 goes on the clock at the first-pick time.
        The broadcast goes on YouTube through Stream Manager. Each night's draft is run once, before the show, and frozen. Votes and chat never change a pick.
      </div>
    </div>
  );
}

function Generate({ onMessage }) {
  const [day, setDay] = useState(() => showIdFor(Date.now()));
  const [time, setTime] = useState("21:00");
  const [streamTime, setStreamTime] = useState("20:45");
  const [formatKey, setFormatKey] = useState(DEFAULT_FORMAT);
  const [rounds, setRounds] = useState("");
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadConfig().then((c) => {
      setTime(c.startTime || "21:00");
      setStreamTime(streamTimeOf(c));
      const n = nightFormat(c, new Date(`${showIdFor(Date.now())}T12:00:00`).getDay());
      setFormatKey(n.format);
      setRounds(n.rounds || "");
    }).catch(() => {});
  }, []);
  const run = async () => {
    const noon = Date.parse(`${day}T12:00:00-05:00`);
    const firstPickAt = easternTime(noon, time);
    const startAt = startForFirstPick(firstPickAt);
    const streamAt = easternTime(noon, streamTime);
    if (streamAt > startAt) { onMessage({ kind: "error", text: `The stream has to start at least ${INTRO_MS / 1000} seconds before the first pick (the intro).` }); return; }
    setBusy(true);
    try {
      const script = await generateShow({ formatKey, rounds: Number(rounds) || null, seed: seed === "" ? undefined : Number(seed), startAt, streamAt, id: day });
      await saveShow(script);
      const len = showTimeline(script).finalAt;
      onMessage({ kind: "ok", text: `Generated ${script.id}: ${script.beats.length} picks, ${fmtLen(len)} on air (seed ${script.seed}).` });
    } catch (e) {
      console.error(e);
      onMessage({ kind: "error", text: `Couldn't generate: ${e.message}` });
    }
    setBusy(false);
  };
  return (
    <div style={card}>
      <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 10 }}>Generate a show</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontWeight: 700 }}>Night <input type="date" value={day} onChange={(e) => setDay(e.target.value)} style={input} /></label>
        <label style={{ fontWeight: 700 }}>Stream starts (ET) <input type="time" value={streamTime} onChange={(e) => setStreamTime(e.target.value)} style={input} /></label>
        <label style={{ fontWeight: 700 }}>First pick (ET) <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={input} /></label>
        <select value={formatKey} onChange={(e) => setFormatKey(e.target.value)} style={input}>
          {Object.entries(SHOW_FORMATS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
        </select>
        <select value={rounds} onChange={(e) => setRounds(e.target.value)} style={input}>
          <option value="">Format's rounds</option>
          {[1, 2, 3, 4, 5, 6, 7].map((r) => <option key={r} value={r}>{r} round{r === 1 ? "" : "s"}</option>)}
        </select>
        <input placeholder="Seed (random)" value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9-]/g, ""))} style={{ ...input, width: 130 }} />
        <button onClick={run} disabled={busy} style={btn(GOLD, busy)}>{busy ? "Drafting…" : "Generate"}</button>
      </div>
      <div style={{ fontSize: 12, color: "#667", marginTop: 8 }}>Generating a night that already has a show replaces it, so don't regenerate one that's on air.</div>
    </div>
  );
}

function Shows({ onMessage }) {
  const [rows, setRows] = useState(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);
  useEffect(() => onSnapshot(query(collection(db, "simShows"), orderBy("startAt", "desc"), limit(14)),
    (s) => setRows(s.docs.map((d) => d.data())), (e) => onMessage({ kind: "error", text: e.message })), [onMessage]);
  const [recs, setRecs] = useState(null);
  useEffect(() => onSnapshot(query(collection(db, "broadcasts"), where("kind", "==", "otc")),
    (s) => setRecs(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setRecs([])), []);
  if (!rows) return <div style={card}>Loading shows…</div>;
  // Its schedule entry goes too, so a YouTube broadcast scheduled for it never starts.
  const remove = async (s) => {
    if (!window.confirm(`Delete the show for ${s.id}? Its votes stay in Firestore.`)) return;
    try {
      await deleteDoc(doc(db, "simShows", s.id));
      await updateDoc(SCHEDULE_REF(), { [`shows.${s.id}`]: deleteField() }).catch(() => {});
    } catch (e) { onMessage({ kind: "error", text: e.message }); }
  };
  // The YouTube broadcasts for the shows (broadcasts kind "otc"), by show and kind.
  const recFor = (id, rehearsal) => (recs || []).find((r) => r.auto?.showId === id && !!r.rehearsal === rehearsal) || null;
  return (
    <div style={card}>
      <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 10 }}>Shows</div>
      {!rows.length && <div style={{ color: "#667" }}>None yet. Generate one above.</div>}
      {rows.map((s) => {
        const [label, color] = statusOf(s, now);
        const times = showTimes(s);
        const tl = showTimeline(s);
        const r1End = tl.segs.find((g) => g.kind === "roundBreak")?.start;
        const base = `/broadcast/ontheclock?show=${s.id}`;
        return (
          <div key={s.id} style={{ padding: "10px 0", borderTop: "1px solid #eef" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ background: color, color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 900 }}>{label}</span>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontWeight: 800 }}>{s.title}</div>
              <div style={{ fontSize: 12, color: "#667" }}>Stream {fmtWhen(times.stream)} · First pick {fmtTime(times.firstPick)} ET · {s.beats.length} picks · {fmtLen(tl.finalAt)} · seed {s.seed}</div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Preview:</span>
            {[["Countdown", -20], ["Intro", 0], ["Pick 1", 44], ...(r1End ? [["Round break", Math.round(r1End / 1000) - 2]] : []), ["Final", Math.round(tl.finalAt / 1000) - 3]].map(([l, at]) => (
              <a key={l} href={`${base}&at=${at}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700, color: BLUE }}>{l}</a>
            ))}
            <button onClick={() => remove(s)} style={{ ...btn("#c0392b", false), padding: "4px 10px", fontSize: 12 }}>Delete</button>
          </div>
          {(label !== "Aired" || recFor(s.id, false)?.auto?.open || recFor(s.id, true)?.auto?.open) && <OnYouTube show={s} rec={recFor(s.id, false)} rehearsal={recFor(s.id, true)} onMessage={onMessage} />}
          </div>
        );
      })}
    </div>
  );
}

// Stream Manager's API (api/stream-manager.js), as AdminStreamManager calls it.
async function smApi(action, payload = {}) {
  const token = await auth.currentUser?.getIdToken();
  const r = await fetch("/api/stream-manager", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 404) throw new Error("the Stream Manager API isn't deployed here (it runs on the live site, or locally under `vercel dev`).");
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

const PHASE_LOOK = {
  selected: ["Scheduled", "#2e7d32"], preparing: ["Preparing", GOLD], vm: ["Starting VM", GOLD], worker: ["Starting worker", GOLD],
  ingest: ["Connecting", GOLD], "going-live": ["Going live", GOLD], live: ["Live", "#d62828"], postgame: ["Live", "#d62828"],
  ending: ["Ending", "#778"], completed: ["Done", "#778"], failed: ["Failed", "#c0392b"], cancelled: ["Cancelled", "#778"],
};

// One show on YouTube: schedule it (privacy) or rehearse it; then its
// automation's phase, what it's waiting on, its link, End and Retry.
function OnYouTube({ show, rec, rehearsal, onMessage }) {
  const [privacy, setPrivacy] = useState("unlisted");
  const [busy, setBusy] = useState(false);
  // The show's YouTube title, description and thumbnail (Stream Manager's editor).
  const [editing, setEditing] = useState(false);
  const meta = <button onClick={() => setEditing(true)} style={{ ...btn(BLUE, false), padding: "4px 10px", fontSize: 12 }}>Edit Metadata</button>;
  const run = async (action, payload, ok) => {
    setBusy(true);
    try { await smApi(action, payload); if (ok) onMessage({ kind: "ok", text: ok }); } catch (e) { onMessage({ kind: "error", text: e.message }); }
    setBusy(false);
  };
  const schedule = (asRehearsal) => {
    const isPublic = !asRehearsal && privacy === "public";
    if (isPublic && !window.confirm("Make this broadcast PUBLIC on YouTube? Everyone will be able to watch it.")) return;
    run("auto-otc", { showId: show.id, privacyStatus: asRehearsal ? "unlisted" : privacy, confirmPublic: isPublic, rehearsal: asRehearsal },
      asRehearsal ? `Rehearsal scheduled for ${show.id}.` : `${show.id} is scheduled on YouTube — the VM starts 15 min before the stream.`);
  };
  const end = (r) => {
    const onAir = ["live", "postgame"].includes(r.auto.phase);
    if (onAir && !window.confirm("End the broadcast now? This ends it on YouTube and stops the worker.")) return;
    run("auto-cancel", { id: r.id, confirmEnd: onAir }, onAir ? "Ending the broadcast…" : "Cancelled.");
  };
  const row = (r, kind) => {
    const [txt, col] = PHASE_LOOK[r.auto?.phase] || [r.auto?.phase || "?", "#778"];
    const open = r.auto?.open;
    const vid = r.youtube?.videoId;
    return (
      <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
        <span style={{ fontWeight: 900, color: "#445" }}>{kind}</span>
        <span style={{ background: col, color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 900 }}>{txt}</span>
        <span style={{ color: r.auto?.error ? "#c0392b" : "#667", flex: 1, minWidth: 200 }}>
          {r.auto?.error || r.auto?.waiting || (r.auto?.phase === "selected" ? `Starts preparing ${fmtWhen(r.auto.prepAt)} · ${r.youtube?.privacyStatus}` : r.auto?.endReason ? `Ended: ${r.auto.endReason}` : "")}
        </span>
        {vid && !r.rehearsal && <a href={`https://youtu.be/${vid}`} target="_blank" rel="noreferrer" style={{ fontWeight: 800, color: BLUE }}>YouTube ↗</a>}
        {open && <button disabled={busy} onClick={() => end(r)} style={{ ...btn("#c0392b", busy), padding: "4px 10px", fontSize: 12 }}>{["live", "postgame"].includes(r.auto.phase) ? "End now" : "Cancel"}</button>}
        {["failed", "cancelled"].includes(r.auto?.phase) && <button disabled={busy} onClick={() => run("auto-retry", { id: r.id }, "Scheduled again.")} style={{ ...btn(BLUE, busy), padding: "4px 10px", fontSize: 12 }}>Retry</button>}
      </div>
    );
  };
  return (
    <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "#f5f7fb", display: "flex", flexDirection: "column", gap: 6 }}>
      {editing && <MetadataEditor otc={{ showId: show.id, title: show.title }} onClose={() => setEditing(false)} />}
      {rec ? <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ flex: 1 }}>{row(rec, "YouTube")}</div>{meta}</div> : (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
          <span style={{ fontWeight: 900, color: "#445" }}>YouTube</span>
          <select value={privacy} onChange={(e) => setPrivacy(e.target.value)} style={input}>
            <option value="unlisted">Unlisted</option><option value="private">Private</option><option value="public">Public</option>
          </select>
          <button disabled={busy} onClick={() => schedule(false)} style={{ ...btn("#d62828", busy), padding: "5px 12px", fontSize: 12 }}>Schedule on YouTube</button>
          {!rehearsal && <button disabled={busy} onClick={() => schedule(true)} style={{ ...btn("#667", busy), padding: "5px 12px", fontSize: 12 }}>Rehearse</button>}
          {meta}
          <span style={{ color: "#667" }}>Goes up automatically 15 min before {fmtTime(showTimes(show).stream)} ET; ends with the show.</span>
        </div>
      )}
      {rehearsal && row(rehearsal, "Rehearsal")}
    </div>
  );
}

export default function AdminOnTheClock({ onBack }) {
  const [msg, setMsg] = useState(null);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <button onClick={onBack} style={btn("#889", false)}>← Broadcasts</button>
        <div style={{ fontSize: 22, fontWeight: 900 }}>On the Clock <span style={{ fontSize: 13, color: "#667", fontWeight: 700 }}>nightly Draft Sim broadcast</span></div>
      </div>
      {msg && <div style={{ ...card, background: msg.kind === "error" ? "#fdecea" : "#eaf6ec", borderColor: msg.kind === "error" ? "#f5c2bd" : "#bfe3c6", fontWeight: 700 }}>{msg.text}</div>}
      <Schedule onMessage={setMsg} />
      <Generate onMessage={setMsg} />
      <Shows onMessage={setMsg} />
    </div>
  );
}
