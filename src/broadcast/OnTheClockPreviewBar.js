// src/broadcast/OnTheClockPreviewBar.js
//
// The preview bar under On the Clock's frame (pages/BroadcastOnTheClockPage.js,
// previews only — never on the stream): play/pause, speed, previous / next
// beat, jumps to the countdown, intro, each round and the final, and a
// scrubber over the whole show. Keys: space (play/pause), ← → (beat).
import { useEffect } from "react";

const SPEEDS = [1, 2, 5, 20];
const fmt = (ms) => {
  const neg = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${neg ? "-" : ""}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const btn = (on) => ({
  background: on ? "#f6a21d" : "#1c2a44", color: on ? "#111" : "#fff", border: "none", borderRadius: 6, padding: "6px 10px",
  fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "Arial, sans-serif", whiteSpace: "nowrap",
});

export default function OnTheClockPreviewBar({ script, timeline, m, vc, t, seek, control }) {
  const segs = timeline.segs;
  // Where ⏮ / ⏭ land: each pick's clock, the intro, round breaks, the final.
  const marks = segs.filter((g) => ["clock", "intro", "roundBreak", "final"].includes(g.kind)).map((g) => g.start);
  const prev = () => { const p = [...marks].reverse().find((x) => x < t - 1500); seek(p ?? -15000); };
  const next = () => { const n = marks.find((x) => x > t + 50); if (n != null) seek(n); };
  const toggle = () => control({ paused: !vc.paused });

  useEffect(() => {
    const on = (e) => {
      if (e.target.tagName === "INPUT" && e.target.type !== "range") return;
      if (e.code === "Space") { e.preventDefault(); toggle(); }
      if (e.code === "ArrowLeft") { e.preventDefault(); prev(); }
      if (e.code === "ArrowRight") { e.preventDefault(); next(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const rounds = [...new Set(script.beats.map((b) => b.round))];
  const roundStart = (r) => segs.find((g) => g.beat != null && script.beats[g.beat].round === r)?.start;
  const max = timeline.finalAt + 60000;
  const b = m.beat;
  const where = m.kind === "preshow" ? "Countdown" : m.kind === "intro" ? "Intro" : m.kind === "final" ? "Final"
    : m.kind === "roundBreak" ? `Round ${m.seg.round} break` : b ? `R${b.round} · No. ${b.overall} · ${m.kind}` : m.kind;

  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 10, background: "rgba(6,12,24,.94)", borderTop: "1px solid #24324d", padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6, fontFamily: "Arial, sans-serif", color: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <button style={btn(false)} onClick={prev} title="Previous beat (←)">⏮</button>
        <button style={btn(vc.paused)} onClick={toggle} title="Play / pause (space)">{vc.paused ? "▶ Play" : "⏸ Pause"}</button>
        <button style={btn(false)} onClick={next} title="Next beat (→)">⏭</button>
        <span style={{ width: 8 }} />
        {SPEEDS.map((s) => <button key={s} style={btn(vc.speed === s)} onClick={() => control({ speed: s })}>{s}×</button>)}
        <span style={{ width: 8 }} />
        <button style={btn(false)} onClick={() => seek(-15000)}>Countdown</button>
        <button style={btn(false)} onClick={() => seek(0)}>Intro</button>
        {rounds.map((r) => <button key={r} style={btn(b?.round === r && m.kind !== "final")} onClick={() => seek(roundStart(r))}>R{r}</button>)}
        {segs.some((g) => g.kind === "roundBreak") && <button style={btn(m.kind === "roundBreak")} onClick={() => seek(segs.find((g) => g.kind === "roundBreak" && g.start > t)?.start ?? segs.find((g) => g.kind === "roundBreak").start)}>Next break</button>}
        {segs.some((g) => g.kind === "trade") && <button style={btn(m.kind === "trade")} onClick={() => { const g = segs.find((x) => x.kind === "trade" && x.start > t) || segs.find((x) => x.kind === "trade"); seek(g.start); }}>Next trade</button>}
        <button style={btn(m.kind === "final")} onClick={() => seek(timeline.finalAt)}>Final</button>
        <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "#9fb0c8" }}>{where}</span>
        <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: "#f6a21d", minWidth: 120, textAlign: "right" }}>{fmt(t)} / {fmt(timeline.finalAt)}</span>
      </div>
      <input type="range" min={-60000} max={max} step={1000} value={Math.max(-60000, Math.min(max, t))} onChange={(e) => seek(Number(e.target.value))} style={{ width: "100%", accentColor: "#f6a21d" }} />
    </div>
  );
}
