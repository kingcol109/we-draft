// src/components/film/Timeline.jsx
//
// The cutting timeline under the game film (user, 2026-11-25): the playhead
// sits 25% in from the left (user, 2026-11-25) — a quarter of the window is
// film behind it, three quarters ahead — and the strip scrolls as the film plays. The wheel scrubs
// (Shift: faster), a click jumps there. Every play cut from this game is a
// block on it; drag a block's left or right edge to start the play sooner /
// later or end it sooner / later. A razor cut in progress (its start marked)
// shows as a shaded run from its start to the playhead.
//
// props: apiRef (FilmPlayer's), plays [{ id, in, out, playerIds }], hotId,
//   pendingIn (seconds | null), onTrim(play, { in, out }) (on release),
//   onSelect(play)
import { useEffect, useRef, useState } from "react";

const HEAD = 0.25; // the playhead's place: 25% in
const SPANS = [[20, "20s"], [60, "1m"], [180, "3m"], [600, "10m"]];
const EDGE = 7; // px: grabbing a block's edge
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function Timeline({ apiRef, plays = [], hotId = null, pendingIn = null, onTrim, onSelect }) {
  const canvasRef = useRef(null);
  const [span, setSpan] = useState(60);
  const drag = useRef(null); // { play, edge: "in" | "out", value }
  const live = useRef({});
  live.current = { plays, hotId, pendingIn, span };

  // Where things are: the window's start, and time ↔ x.
  const geom = () => {
    const c = canvasRef.current;
    const t = apiRef.current?.time() || 0;
    const w = c.clientWidth;
    const start = t - HEAD * live.current.span;
    return { c, t, w, start, x: (s) => ((s - start) / live.current.span) * w, s: (x) => start + (x / w) * live.current.span };
  };

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const c = canvasRef.current;
      if (c && apiRef.current) {
        const dpr = window.devicePixelRatio || 1;
        const cw = c.clientWidth;
        const ch = c.clientHeight;
        if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
        const ctx = c.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const g = geom();
        const L = live.current;
        const dur = apiRef.current.duration() || 0;
        ctx.fillStyle = "#0f1726";
        ctx.fillRect(0, 0, cw, ch);
        // Outside the game: dimmed.
        ctx.fillStyle = "#070b13";
        if (g.start < 0) ctx.fillRect(0, 0, g.x(0), ch);
        if (dur && g.start + L.span > dur) ctx.fillRect(g.x(dur), 0, cw - g.x(dur), ch);
        // Ticks: every second, longer every 5, labeled by the window's size.
        const step = L.span <= 20 ? 1 : L.span <= 60 ? 5 : L.span <= 180 ? 15 : 60;
        const label = L.span <= 20 ? 5 : L.span <= 60 ? 10 : L.span <= 180 ? 30 : 120;
        ctx.font = "700 11px Arial";
        for (let s = Math.ceil(g.start / step) * step; s <= g.start + L.span; s += step) {
          const x = g.x(s);
          const big = s % label === 0;
          ctx.strokeStyle = big ? "#3a4a66" : "#243149";
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, big ? 14 : 8); ctx.stroke();
          if (big && s >= 0) { ctx.fillStyle = "#6f81a0"; ctx.fillText(mmss(s), x + 3, 12); }
        }
        // The plays: blocks, the hot one gold; their edges are handles.
        const top = 22;
        const bh = ch - top - 10;
        L.plays.forEach((p) => {
          const d = drag.current?.play.id === p.id ? drag.current : null;
          const a = d?.edge === "in" ? d.value : p.in;
          const b = d?.edge === "out" ? d.value : p.out;
          const x0 = g.x(a);
          const x1 = g.x(b);
          if (x1 < -5 || x0 > cw + 5) return;
          const hot = p.id === L.hotId;
          ctx.fillStyle = hot ? "rgba(246,162,29,0.85)" : "rgba(47,134,214,0.75)";
          ctx.fillRect(x0, top, Math.max(2, x1 - x0), bh);
          ctx.fillStyle = hot ? "#fff3d6" : "#d8e9fb";
          ctx.fillRect(x0, top, 3, bh);
          ctx.fillRect(x1 - 3, top, 3, bh);
          ctx.fillStyle = hot ? "#1d1405" : "#ffffff";
          ctx.font = "800 11px Arial";
          if (x1 - x0 > 40) ctx.fillText(`${(b - a).toFixed(1)}s${p.playerIds?.length ? ` · ${p.playerIds.length}` : ""}`, x0 + 7, top + bh / 2 + 4);
        });
        // A razor cut in progress: its start → the playhead.
        if (L.pendingIn != null) {
          const x0 = g.x(L.pendingIn);
          const x1 = g.x(g.t);
          ctx.fillStyle = "rgba(246,162,29,0.25)";
          ctx.fillRect(Math.min(x0, x1), top, Math.abs(x1 - x0), bh);
          ctx.strokeStyle = "#f6a21d";
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 4]);
          ctx.beginPath(); ctx.moveTo(x0, top - 4); ctx.lineTo(x0, ch); ctx.stroke();
          ctx.setLineDash([]);
        }
        // The playhead, 25% in.
        const px = HEAD * cw;
        ctx.fillStyle = "#ff4d4d";
        ctx.fillRect(px - 1, 0, 2, ch);
        ctx.beginPath(); ctx.moveTo(px - 6, 0); ctx.lineTo(px + 6, 0); ctx.lineTo(px, 8); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "800 12px Arial";
        ctx.fillText(`${mmss(g.t)}.${String(Math.floor((g.t % 1) * 10))}`, px + 8, ch - 6);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Hit test: a block's edge, a block, or empty timeline.
  const hit = (e) => {
    const g = geom();
    const r = g.c.getBoundingClientRect();
    const x = e.clientX - r.left;
    for (const p of live.current.plays) {
      const x0 = g.x(p.in);
      const x1 = g.x(p.out);
      if (Math.abs(x - x0) <= EDGE) return { kind: "edge", play: p, edge: "in", g };
      if (Math.abs(x - x1) <= EDGE) return { kind: "edge", play: p, edge: "out", g };
    }
    const p = live.current.plays.find((q) => x > g.x(q.in) && x < g.x(q.out));
    return p ? { kind: "play", play: p, g, x } : { kind: "empty", g, x };
  };
  const onDown = (e) => {
    const h = hit(e);
    if (h.kind === "edge") { drag.current = { play: h.play, edge: h.edge, value: h.play[h.edge] }; e.currentTarget.setPointerCapture?.(e.pointerId); apiRef.current?.pause(); return; }
    if (h.kind === "play") { onSelect?.(h.play); apiRef.current?.seek(h.g.s(h.x)); return; }
    apiRef.current?.seek(Math.max(0, h.g.s(h.x)));
  };
  const onMove = (e) => {
    const c = canvasRef.current;
    if (!drag.current) {
      const h = hit(e);
      c.style.cursor = h.kind === "edge" ? "ew-resize" : h.kind === "play" ? "pointer" : "text";
      return;
    }
    const g = geom();
    const r = c.getBoundingClientRect();
    const v = g.s(e.clientX - r.left);
    const d = drag.current;
    d.value = d.edge === "in" ? Math.max(0, Math.min(v, d.play.out - 0.3)) : Math.max(v, d.play.in + 0.3);
    // Show the frame at the edge while dragging it.
    apiRef.current?.seek(d.value);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && Math.abs(d.value - d.play[d.edge]) > 0.02) onTrim?.(d.play, { in: d.edge === "in" ? d.value : d.play.in, out: d.edge === "out" ? d.value : d.play.out });
  };
  const onWheel = (e) => {
    const a = apiRef.current;
    if (!a) return;
    a.pause();
    const step = span * 0.02 * (e.shiftKey ? 5 : 1);
    a.seek(Math.max(0, a.time() + (e.deltaY > 0 ? step : -step)));
  };
  useEffect(() => {
    const c = canvasRef.current;
    const block = (e) => e.preventDefault();
    c.addEventListener("wheel", block, { passive: false });
    return () => c.removeEventListener("wheel", block);
  }, []);

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
        style={{ width: "100%", height: 74, display: "block", borderRadius: 8, border: "1px solid #263247", touchAction: "none" }} />
      <div style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11, fontWeight: 800, color: "#8494ad" }}>
        <span>Window</span>
        {SPANS.map(([s, l]) => (
          <button key={s} type="button" onClick={() => setSpan(s)} style={{ border: `1px solid ${span === s ? "#0055a5" : "#334058"}`, background: span === s ? "#0055a5" : "#1b2538", color: "#e8edf5", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 800, cursor: "pointer" }}>{l}</button>
        ))}
        <span style={{ flex: 1 }} />
        <span>Scroll to scrub (Shift: faster) · click to jump · drag a play&apos;s edge to start / end it sooner or later</span>
      </div>
    </div>
  );
}
