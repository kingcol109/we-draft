// src/components/CalendarPostPanel.jsx
//
// The Content Calendar's side panel for one scheduled or published thing: what
// it is, when it goes, its text, what it goes with, and what can be done to it
// from here. Instagram's changes go through its API as they do in the Post
// Manager (publish.js owns a scheduled post); X's are plain saves (utils/x/store.js).
// A whole edit opens the record in its own tab — the calendar never holds a copy.
import { useState } from "react";
import { igApi } from "../utils/instagram/api";
import { scheduleXPost, unscheduleXPost, markXPosted } from "../utils/x/store";
import { PLATFORMS, fmtET } from "../utils/contentCalendar/platforms";

const BLUE = "#0055a5";
const small = { fontSize: "10px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" };
const action = (color = BLUE, solid = false) => ({
  width: "100%", marginTop: "6px", background: solid ? color : "#fff", color: solid ? "#fff" : color, border: `2px solid ${color}`, borderRadius: "8px",
  padding: "7px", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer",
});
const toLocal = (ms) => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export function PlatformTag({ platform }) {
  const p = PLATFORMS[platform] || PLATFORMS.other;
  return <span style={{ background: p.fill || p.color, color: "#fff", borderRadius: "4px", padding: "1px 6px", fontSize: "10px", fontWeight: 900, whiteSpace: "nowrap" }}>{p.label}</span>;
}

export default function CalendarPostPanel({ entry, links, onSelect, onOpen, onChanged, onClose }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [picking, setPicking] = useState("");
  const [copied, setCopied] = useState(false);
  const run = async (fn, done) => {
    setBusy(true);
    setMsg("");
    try {
      await fn();
      setPicking("");
      setMsg(done);
      await onChanged();
    } catch (e) {
      setMsg(`Failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };
  const isIg = entry.source === "instagram";
  const isX = entry.source === "x";
  const canOpen = isIg || isX;
  const changeTime = () => {
    const at = new Date(picking).getTime();
    if (!Number.isFinite(at) || at < Date.now() + 5 * 60e3) { setMsg("Failed: pick a time at least 5 minutes from now."); return; }
    run(() => (isIg ? igApi("schedule-change", { postId: entry.refId, scheduledAt: at }) : scheduleXPost(entry.refId, at)), `Now ${fmtET(at)}.`);
  };
  const cancel = () => {
    if (isIg) {
      if (!window.confirm(`Cancel the schedule for "${entry.subjectLabel}"?\n\nIt goes back to a draft; nothing is posted.`)) return;
      run(() => igApi("schedule-cancel", { postId: entry.refId }), "Schedule cancelled.");
    } else {
      run(() => unscheduleXPost(entry.refId), "Back to a draft.");
    }
  };
  const copy = () => navigator.clipboard?.writeText(entry.body).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });

  return (
    <div style={{ padding: "14px" }} data-calendar-panel={entry.id}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
        <PlatformTag platform={entry.platform} />
        <span style={{ fontSize: "11px", fontWeight: 800, color: "#5b6b84" }}>{entry.kindLabel}</span>
      </div>
      <div style={{ fontWeight: 900, fontSize: "14px", color: BLUE, marginBottom: "8px", overflowWrap: "anywhere" }}>{entry.fullLabel || entry.subjectLabel}</div>
      {entry.thumb && <img src={entry.thumb} alt="" style={{ width: "100%", borderRadius: "6px", display: "block", marginBottom: "8px", border: "1px solid #e3e8ef" }} />}

      <div style={small}>{entry.statusLabel || "Date"}</div>
      <div data-calendar-when style={{ fontSize: "12px", fontWeight: 800, color: entry.due ? "#b7791f" : "#33415a", marginBottom: "10px" }}>
        {entry.whenMs != null ? fmtET(entry.whenMs) : entry.dateKey}
        {entry.whenMs == null && <span style={{ color: "#8a97ab" }}> · no set time</span>}
      </div>
      {entry.due && <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a5a00", marginBottom: "10px" }}>X isn&apos;t connected: copy this to X, then mark it posted.</div>}
      {entry.problem && <div style={{ fontSize: "11px", fontWeight: 700, color: "#a52a1e", marginBottom: "10px" }}>{entry.problem}</div>}

      {entry.body && (
        <>
          <div style={small}>{isX ? "Post" : isIg ? "Caption" : "Note"}</div>
          <div style={{ fontSize: "12px", fontWeight: 500, color: "#33415a", whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "130px", overflowY: "auto", border: "1px solid #eef1f5", borderRadius: "6px", padding: "6px 8px", marginBottom: "10px" }}>{entry.body}</div>
        </>
      )}

      {links.length > 0 && (
        <div style={{ marginBottom: "10px" }}>
          <div style={small}>Goes with</div>
          {links.map((l) => (
            <button key={`${l.platform}|${l.id}`} onClick={() => l.entry && onSelect(l.entry)} disabled={!l.entry} title={l.entry ? "Show it" : "Not on the calendar yet"}
              style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "5px", width: "100%", textAlign: "left", background: "#f8fafc", border: "1px solid #e3e8ef", borderRadius: "6px", padding: "5px 7px", marginBottom: "4px", cursor: l.entry ? "pointer" : "default" }}>
              <PlatformTag platform={l.platform} />
              <span style={{ fontSize: "11px", fontWeight: 800, color: "#33415a", overflowWrap: "anywhere" }}>{l.label}</span>
              <span style={{ fontSize: "10px", fontWeight: 700, color: "#8a97ab", width: "100%" }}>{l.entry ? (l.entry.whenMs != null ? fmtET(l.entry.whenMs) : l.entry.dateKey) : "Not scheduled"}</span>
            </button>
          ))}
        </div>
      )}

      {entry.permalink && <a href={entry.permalink} target="_blank" rel="noreferrer" style={{ display: "block", fontSize: "12px", fontWeight: 900, color: BLUE, marginBottom: "4px" }}>View the post ↗</a>}
      {entry.link && <a href={entry.link} target="_blank" rel="noreferrer" style={{ display: "block", fontSize: "12px", fontWeight: 900, color: BLUE, marginBottom: "4px" }}>Watch it ↗</a>}
      {entry.manageHint && <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a97ab", marginBottom: "4px" }}>{entry.manageHint}</div>}

      {canOpen && <button onClick={() => onOpen(entry)} style={action(BLUE, true)}>Open {isX ? "in X Posts" : "in Instagram"}</button>}
      {isX && entry.body && <button onClick={copy} style={action()}>{copied ? "Copied" : "Copy text"}</button>}
      {isX && entry.status === "scheduled" && <button onClick={() => run(() => markXPosted(entry.refId), "Marked as posted.")} disabled={busy} style={action("#15803d")}>Mark posted</button>}
      {entry.movable && !picking && <button onClick={() => setPicking(toLocal(entry.whenMs > Date.now() ? entry.whenMs : Date.now() + 3600e3))} disabled={busy} style={action()}>Change time</button>}
      {entry.movable && picking && (
        <div style={{ marginTop: "6px" }}>
          <input type="datetime-local" value={picking} onChange={(e) => setPicking(e.target.value)} data-calendar-time style={{ width: "100%", boxSizing: "border-box", border: "2px solid #ddd", borderRadius: "6px", padding: "5px", fontSize: "12px", fontWeight: 700 }} />
          {Number.isFinite(new Date(picking).getTime()) && <div style={{ fontSize: "11px", fontWeight: 800, color: "#5b6b84", marginTop: "3px" }}>{fmtET(new Date(picking).getTime())}</div>}
          <button onClick={changeTime} disabled={busy} style={action(BLUE, true)}>Save time</button>
          <button onClick={() => setPicking("")} disabled={busy} style={{ ...action("#888"), border: "none" }}>Never mind</button>
        </div>
      )}
      {entry.movable && <button onClick={cancel} disabled={busy} style={action("#c0392b")}>{isIg ? "Cancel schedule" : "Unschedule"}</button>}
      <button onClick={onClose} style={{ width: "100%", marginTop: "8px", background: "none", border: "none", color: "#999", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer", padding: "4px" }}>Close</button>
      {msg && <div style={{ marginTop: "8px", textAlign: "center", fontSize: "12px", fontWeight: 800, color: msg.startsWith("Failed") ? "#c0392b" : "#2e7d32" }}>{msg}</div>}
    </div>
  );
}
