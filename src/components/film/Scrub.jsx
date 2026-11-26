// src/components/film/Scrub.jsx
//
// The Film Manager's scrub row (user, 2026-11-25) — the same in Cut plays
// and Players:
//   ◀ / ▶   HOLD = fast motion that way (forward plays at 3×, back plays
//           backwards at 3× — FilmPlayer api.rewind); let go and it's back
//           to how it was. DOUBLE-CLICK = the last / next play.
//   the bar grab it anywhere and drag: the film pauses while you drag and
//           follows your hand (seeks are coalesced — api.scrubTo — so it
//           never lags behind a queue of seeks), then plays on if it was
//           playing. Plays show as ticks on the bar.
//   fine    (Players, user 2026-11-25: "move less to cover less ground") —
//           after the click, the hand covers that share of the bar's time
//           (0.5 = twice as precise); the thumb shows where the film is.
// useFastMotion is the hold logic, for the arrow keys too.
import { useEffect, useRef, useState } from "react";

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const clock = (s) => { const t = Math.max(0, s || 0); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const x = (t % 60).toFixed(1).padStart(4, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`; };

export function useFastMotion(apiRef, speed = 3) {
  const hold = useRef(null);
  const end = () => {
    const h = hold.current;
    const a = apiRef.current;
    hold.current = null;
    if (!h || !a) return;
    h.stop?.();
    if (h.dir > 0) a.setRate(h.rate);
    if (h.paused) a.pause(); else a.play();
  };
  const start = (dir) => {
    const a = apiRef.current;
    if (!a || hold.current) return;
    const h = { dir, paused: a.paused(), rate: a.rate() || 1 };
    if (dir > 0) { a.setRate(speed); a.play(); } else h.stop = a.rewind(speed);
    hold.current = h;
  };
  const endRef = useRef(end);
  endRef.current = end;
  useEffect(() => {
    const lost = () => endRef.current();
    window.addEventListener("blur", lost);
    return () => { window.removeEventListener("blur", lost); hold.current?.stop?.(); };
  }, []);
  return { start, end, holding: () => !!hold.current };
}

function Arrow({ dir, motion, onDouble, onClicks, title }) {
  return (
    <button type="button" title={title}
      onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture?.(e.pointerId); motion.start(dir); }}
      onPointerUp={motion.end} onPointerCancel={motion.end} onLostPointerCapture={motion.end}
      onDoubleClick={onDouble}
      onClick={(e) => onClicks?.(e.detail)}
      style={{ border: "1px solid #334058", background: "#1b2538", color: "#e8edf5", borderRadius: 8, padding: "4px 12px", fontSize: 15, fontWeight: 900, cursor: "pointer", userSelect: "none", touchAction: "none" }}>
      {dir < 0 ? "◀" : "▶"}
    </button>
  );
}

// The bar itself: min..max (seconds), t now, ticks [{ in, out, hot }].
export function ScrubBar({ apiRef, min, max, t, ticks = [], color = "#f6a21d", fine = 1 }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const [pos, setPos] = useState(null); // where the hand is while dragging (and just after)
  const [hover, setHover] = useState(null);
  const span = Math.max(0.001, max - min);
  const at = (e) => { const b = ref.current.getBoundingClientRect(); return min + clamp((e.clientX - b.left) / b.width, 0, 1) * span; };
  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    ref.current.setPointerCapture?.(e.pointerId);
    const a = apiRef.current;
    const x = at(e);
    drag.current = { playing: a ? !a.paused() : false, cx: e.clientX, t0: x };
    a?.pause();
    setPos(x);
    a?.scrubTo(x);
  };
  // Where the drag has the film: under the hand, or (fine) the click's spot + a share of the way moved.
  const dragAt = (e) => {
    const d = drag.current;
    if (fine >= 1 || !d) return at(e);
    const b = ref.current.getBoundingClientRect();
    return clamp(d.t0 + ((e.clientX - d.cx) / b.width) * span * fine, min, max);
  };
  const move = (e) => {
    setHover(at(e));
    if (!drag.current) return;
    const x = dragAt(e);
    setPos(x);
    apiRef.current?.scrubTo(x);
  };
  const up = (e) => {
    const d = drag.current;
    if (!d) return;
    const x = dragAt(e);
    drag.current = null;
    apiRef.current?.scrubTo(x);
    if (d.playing) apiRef.current?.play();
    // Hold the thumb where it was let go until the film's clock catches up.
    setTimeout(() => setPos((p) => (drag.current ? p : null)), 300);
  };
  const v = clamp(pos ?? t, min, max);
  const pct = ((v - min) / span) * 100;
  const pctOf = (x) => `${clamp(((x - min) / span) * 100, 0, 100)}%`;
  return (
    <div ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => setHover(null)}
      style={{ position: "relative", flex: 1, minWidth: 0, height: 26, cursor: "pointer", touchAction: "none", userSelect: "none" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 10, height: 6, borderRadius: 3, background: "#26324a" }} />
      {ticks.map((p, i) => (
        <div key={p.id || i} style={{ position: "absolute", top: 8, height: 10, left: pctOf(p.in), width: `max(2px, calc(${pctOf(p.out)} - ${pctOf(p.in)}))`, borderRadius: 2, background: p.hot ? color : "#4b6a96", opacity: 0.85 }} />
      ))}
      <div style={{ position: "absolute", left: 0, top: 10, height: 6, width: `${pct}%`, borderRadius: 3, background: color, opacity: 0.55 }} />
      <div style={{ position: "absolute", top: 4, left: `calc(${pct}% - 9px)`, width: 18, height: 18, borderRadius: "50%", background: color, boxShadow: drag.current ? `0 0 0 6px ${color}44` : "0 1px 4px rgba(0,0,0,0.5)" }} />
      {hover != null && !drag.current && (
        <div style={{ position: "absolute", bottom: 26, left: `calc(${((hover - min) / span) * 100}% - 30px)`, width: 60, textAlign: "center", fontSize: 11, fontWeight: 900, color: "#e8edf5", background: "rgba(8,12,22,0.9)", borderRadius: 4, padding: "1px 0", pointerEvents: "none" }}>{clock(hover - min)}</div>
      )}
    </div>
  );
}

// ◀ [bar] ▶ time — the whole row.
export default function ScrubRow({ apiRef, min, max, t, ticks, motion, onPrev, onNext, onClicks, label, fine = 1, prevTitle = "Hold: play backwards fast · double-click: last play", nextTitle = "Hold: fast forward · double-click: next play" }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", borderRadius: 8, background: "#141c2b", border: "1px solid #263247" }}>
      <Arrow dir={-1} motion={motion} onDouble={onPrev} onClicks={onClicks && ((n) => onClicks(-1, n))} title={prevTitle} />
      <ScrubBar apiRef={apiRef} min={min} max={max} t={t} ticks={ticks} fine={fine} />
      <Arrow dir={1} motion={motion} onDouble={onNext} onClicks={onClicks && ((n) => onClicks(1, n))} title={nextTitle} />
      <span style={{ fontSize: 12, fontWeight: 900, fontVariantNumeric: "tabular-nums", color: "#9fb0c8", minWidth: 92, textAlign: "right" }}>{label ?? `${clock(t - min)} / ${clock(max - min)}`}</span>
    </div>
  );
}
