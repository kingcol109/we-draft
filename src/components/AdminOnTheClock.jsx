// src/components/AdminOnTheClock.jsx
//
// Admin → Stream Manager → On the Clock: the nightly Draft Sim broadcast
// (utils/draftSim/onTheClock.js).
//   Nightly schedule   on/off, the start time (ET) and each weekday's format
//                      (or no show) — config/onTheClock
//   Shows              each show's script (simShows/{id}): generate one in
//                      this browser (the CPU drafts all 32 teams, with the
//                      full desk), preview it at any point, regenerate it
//                      until it's on
import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, limit, deleteDoc, doc } from "firebase/firestore";
import { db } from "../firebase";
import { SHOW_FORMATS, DEFAULT_FORMAT, PRESHOW_MS, showTimeline, showEndsAt, showIdFor } from "../utils/draftSim/onTheClock";
import { loadConfig, saveConfig, generateShow, saveShow, easternTime, nightFormat, DEFAULT_CONFIG } from "../utils/draftSim/onTheClockData";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const card = { background: "#fff", border: "1px solid #dde3ec", borderRadius: 12, padding: 16, marginBottom: 16 };
const btn = (bg, disabled) => ({ background: disabled ? "#aab" : bg, color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 800, cursor: disabled ? "default" : "pointer" });
const input = { padding: "6px 8px", border: "1px solid #ccd", borderRadius: 6, fontSize: 14 };

const fmtWhen = (ms) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
const fmtLen = (ms) => `${Math.floor(ms / 3600000)}h ${String(Math.round((ms % 3600000) / 60000)).padStart(2, "0")}m`;

function statusOf(s, now) {
  const end = showEndsAt(s, showTimeline(s));
  if (now >= end) return ["Aired", "#778"];
  if (now >= s.startAt) return ["On air", "#d62828"];
  if (now >= s.startAt - PRESHOW_MS) return ["Pre-show", GOLD];
  return ["Ready", "#2e7d32"];
}

function Schedule({ onMessage }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { loadConfig().then(setCfg).catch((e) => { setCfg(DEFAULT_CONFIG); onMessage({ kind: "error", text: e.message }); }); }, [onMessage]);
  if (!cfg) return <div style={card}>Loading schedule…</div>;
  const setNight = (d, patch) => setCfg((c) => ({ ...c, nights: { ...c.nights, [d]: { ...nightFormat(c, d), ...patch } } }));
  const save = async () => {
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
        <label style={{ fontWeight: 700 }}>Start (ET) <input type="time" value={cfg.startTime} onChange={(e) => setCfg({ ...cfg, startTime: e.target.value })} style={input} /></label>
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
        The broadcast goes on YouTube through Stream Manager. Each night's draft is run once, before the show, and frozen. Votes and chat never change a pick.
      </div>
    </div>
  );
}

function Generate({ onMessage }) {
  const [day, setDay] = useState(() => showIdFor(Date.now()));
  const [time, setTime] = useState("21:00");
  const [formatKey, setFormatKey] = useState(DEFAULT_FORMAT);
  const [rounds, setRounds] = useState("");
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadConfig().then((c) => {
      setTime(c.startTime || "21:00");
      const n = nightFormat(c, new Date(`${showIdFor(Date.now())}T12:00:00`).getDay());
      setFormatKey(n.format);
      setRounds(n.rounds || "");
    }).catch(() => {});
  }, []);
  const run = async () => {
    setBusy(true);
    try {
      const startAt = easternTime(Date.parse(`${day}T12:00:00-05:00`), time);
      const script = await generateShow({ formatKey, rounds: Number(rounds) || null, seed: seed === "" ? undefined : Number(seed), startAt, id: day });
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
        <label style={{ fontWeight: 700 }}>Start (ET) <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={input} /></label>
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
  if (!rows) return <div style={card}>Loading shows…</div>;
  const remove = async (s) => {
    if (!window.confirm(`Delete the show for ${s.id}? Its votes stay in Firestore.`)) return;
    try { await deleteDoc(doc(db, "simShows", s.id)); } catch (e) { onMessage({ kind: "error", text: e.message }); }
  };
  return (
    <div style={card}>
      <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 10 }}>Shows</div>
      {!rows.length && <div style={{ color: "#667" }}>None yet. Generate one above.</div>}
      {rows.map((s) => {
        const [label, color] = statusOf(s, now);
        const tl = showTimeline(s);
        const r1End = tl.segs.find((g) => g.kind === "roundBreak")?.start;
        const base = `/broadcast/ontheclock?show=${s.id}`;
        return (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid #eef", flexWrap: "wrap" }}>
            <span style={{ background: color, color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 900 }}>{label}</span>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontWeight: 800 }}>{s.title}</div>
              <div style={{ fontSize: 12, color: "#667" }}>{fmtWhen(s.startAt)} · {s.beats.length} picks · {fmtLen(tl.finalAt)} · seed {s.seed}</div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Preview:</span>
            {[["Countdown", -20], ["Intro", 0], ["Pick 1", 44], ...(r1End ? [["Round break", Math.round(r1End / 1000) - 2]] : []), ["Final", Math.round(tl.finalAt / 1000) - 3]].map(([l, at]) => (
              <a key={l} href={`${base}&at=${at}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700, color: BLUE }}>{l}</a>
            ))}
            <button onClick={() => remove(s)} style={{ ...btn("#c0392b", false), padding: "4px 10px", fontSize: 12 }}>Delete</button>
          </div>
        );
      })}
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
