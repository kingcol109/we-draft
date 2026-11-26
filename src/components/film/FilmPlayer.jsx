// src/components/film/FilmPlayer.jsx
//
// The Film Manager's player: a game MP4 off the admin's disk, drawn to a
// canvas so it can show the "washed" version of a play (user, 2026-11-25 —
// zoomed in on the player with keyframes, less field, more of him) and the
// marks on players.
//
// Marks (user, 2026-11-25): a circle or an arrow, placed by click and sized
// by scroll — a circle's click is its middle, an arrow's click is its tip
// (the arrow points down at him).
//
// props:
//   file        a File (the game)
//   range       { in, out } — loop a play; null for the whole game
//   spots       [{ t, x, y, kind ("circle"|"arrow"), size, color, label }] —
//               x/y normalized to the frame, size a fraction of its height,
//               t in game seconds; shown for a second around t
//   mode        "original" | "wash"
//   washKeys    [{ t, x, y, z }] — the washed view's keyframes (center, zoom)
//   markTool    "circle" | "arrow" | null — clicking places (onMark), the
//               wheel sizes (onMarkSize)
//   onMark      (x, y, t)        onMarkSize (factor)
//   onTime      (t, playing) — about 8× a second
//   fsBar       what to show along the bottom in full screen (the parent's controls)
//   overlay     shown over the top-left of the film (in full screen too) — e.g. live voice feedback
//   center      shown in the middle of the film — voice updates and questions (user, 2026-11-25)
//   liveWash    hold the mouse on the film: drag pans, scroll zooms — the wash
//               is set right there (user, 2026-11-25); onWashHold(true / false)
//               tells the parent when the hold starts / ends (it keys the wash)
//   onWashEdit  () — the wheel changed the view (the parent saves it)
//   wheelWash   the wheel always zooms the wash (Players, user 2026-11-25) —
//               marks are sized with ↑ / ↓ there, not the wheel
//   onEnd       () — the play reached its end (instead of looping): play-through
//   apiRef      → { seek, play, pause, toggle, time, duration, paused, step, nudge, setRate, rate, view, setDraft, draft, fullscreen }
// In wash mode, dragging pans and the wheel zooms a draft view; the parent
// saves it as a keyframe (api.view()). F (or ⛶) toggles full screen.
import { useEffect, useRef, useState } from "react";

const CW = 1280;
const CH = 720;
const FPS = 30;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FULL = { x: 0.5, y: 0.5, z: 1 };
export const MARK_SIZES = { circle: 0.06, arrow: 0.08 };

// The washed view at t: the keyframes interpolated (before the first / after
// the last: held). No keys: the whole frame.
export function washAt(keys, t) {
  const k = (keys || []).slice().sort((a, b) => a.t - b.t);
  if (!k.length) return { x: 0.5, y: 0.5, z: 1 };
  if (t <= k[0].t) return k[0];
  if (t >= k[k.length - 1].t) return k[k.length - 1];
  const i = k.findIndex((x) => x.t > t);
  const a = k[i - 1];
  const b = k[i];
  const p = (t - a.t) / (b.t - a.t || 1);
  const e = p * p * (3 - 2 * p); // smoothstep
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, z: a.z + (b.z - a.z) * e };
}
// The source rect a view shows (vw × vh frame).
export function cropOf(view, vw, vh) {
  const z = Math.max(1, view.z || 1);
  const w = vw / z;
  const h = vh / z;
  const cx = clamp(view.x * vw, w / 2, vw - w / 2);
  const cy = clamp(view.y * vh, h / 2, vh - h / 2);
  return { sx: cx - w / 2, sy: cy - h / 2, sw: w, sh: h };
}

// A mark on the canvas: px/py where it lands, s its size in canvas pixels.
export function drawMark(ctx, kind, px, py, s, color) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (kind === "arrow") {
    // Pointing down, its tip at (px, py): a shaft above and a head.
    const len = s * 2.2;
    const head = s * 0.9;
    const hw = s * 0.62;
    const sw = s * 0.26;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - hw, py - head);
      ctx.lineTo(px - sw, py - head);
      ctx.lineTo(px - sw, py - len);
      ctx.lineTo(px + sw, py - len);
      ctx.lineTo(px + sw, py - head);
      ctx.lineTo(px + hw, py - head);
      ctx.closePath();
    };
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 8;
    path();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(2, s * 0.08);
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.stroke();
  } else {
    ctx.lineWidth = Math.max(4, s * 0.16);
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath(); ctx.arc(px, py, s, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = Math.max(3, s * 0.1);
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(px, py, s, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

export default function FilmPlayer({ file, range = null, spots = [], mode = "original", washKeys = [], editWash = true, markTool = null, onMark, onMarkSize, onTime, fsBar = null, overlay = null, center = null, gate = null, stageRef = null, autoPlay = false, quickMarks = false, onQuickMark, onMarkMove, liveWash = false, wheelWash = false, onWashHold, onWashEdit, onEnd, apiRef, style }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const [url, setUrl] = useState("");
  const [, setRateState] = useState(1);
  const [full, setFull] = useState(false);
  // Full screen with the whole tab (stageRef: the list + every control) —
  // the film just grows to fit (user, 2026-11-25).
  const [stage, setStage] = useState(false);
  const scrubNext = useRef(null);
  useEffect(() => {
    const x = videoRef.current;
    if (!x) return undefined;
    const on = () => { if (scrubNext.current != null) { const to = scrubNext.current; scrubNext.current = null; x.currentTime = to; } };
    x.addEventListener("seeked", on);
    return () => x.removeEventListener("seeked", on);
  }, []);
  const draftRef = useRef(null);
  const drag = useRef(null);
  const live = useRef({});
  live.current = { range, spots, mode, washKeys, onTime, markTool, onMarkSize, editWash, autoPlay, quickMarks, onEnd, wheelWash };
  const ended = useRef(false);
  // Moving a mark: where the hand has it (drawn there, saved on release).
  const markDrag = useRef(null);
  const drawn = useRef([]); // the marks as last drawn: [{ px, py, size }] (canvas px)
  const clickWait = useRef(null);

  useEffect(() => {
    if (!file) { setUrl(""); return undefined; }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  // A new play: to its start.
  useEffect(() => {
    const v = videoRef.current;
    if (v && range && v.readyState >= 1) { v.currentTime = range.in; if (autoPlay) v.play().catch(() => {}); }
  }, [range?.in, range?.out, url]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { draftRef.current = null; ended.current = false; }, [range?.in, mode]);

  // Full screen: the parent's whole tab when it gives a stageRef (so every
  // edit control stays on screen), else the player + the parent's bar. F toggles it.
  // bare: just the film, nothing around it (Players → Watch all).
  const toggleFull = (bare = false) => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else ((bare === true ? null : stageRef?.current) || wrapRef.current)?.requestFullscreen?.().catch(() => {});
  };
  useEffect(() => {
    const on = () => {
      setFull(document.fullscreenElement === wrapRef.current);
      setStage(!!document.fullscreenElement && document.fullscreenElement === stageRef?.current);
    };
    document.addEventListener("fullscreenchange", on);
    const key = (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "f" || e.key === "F") { e.preventDefault(); toggleFull(); }
    };
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("fullscreenchange", on); window.removeEventListener("keydown", key); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // What's on screen: the view being set, else the washed view (wash mode), else the whole frame.
  const viewNow = () => {
    const v = videoRef.current;
    return draftRef.current || (live.current.mode === "wash" ? washAt(live.current.washKeys, v?.currentTime || 0) : FULL);
  };

  // The draw loop.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = () => {
      const v = videoRef.current;
      const c = canvasRef.current;
      const L = live.current;
      if (v && c) {
        if (L.range && v.currentTime >= L.range.out - 0.02 && !v.seeking) {
          // Play-through: the parent moves on (once); else the play loops.
          if (L.onEnd) { if (!ended.current) { ended.current = true; L.onEnd(); } } else v.currentTime = L.range.in;
        }
        const ctx = c.getContext("2d");
        const vw = v.videoWidth;
        const vh = v.videoHeight;
        if (!vw) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, CW, CH); }
        if (vw && v.readyState >= 2) {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, CW, CH);
          const r = L.mode === "wash" || draftRef.current ? cropOf(viewNow(), vw, vh) : { sx: 0, sy: 0, sw: vw, sh: vh };
          ctx.drawImage(v, r.sx, r.sy, r.sw, r.sh, 0, 0, CW, CH);
          // Marks, where they fall in this view. A play's mark shows from the
          // play's start until the moment it was put down (user, 2026-11-25);
          // always while placing or moving one.
          drawn.current = [];
          (L.spots || []).forEach((s0, i) => {
            if (s0 == null) return;
            const s = i === 0 && markDrag.current ? { ...s0, x: markDrag.current.x, y: markDrag.current.y } : s0;
            const showing = L.markTool || markDrag.current || (L.range ? v.currentTime >= L.range.in - 0.05 && v.currentTime <= s.t + 0.05 : Math.abs(v.currentTime - s.t) <= 1);
            if (!showing) return;
            const px = ((s.x * vw - r.sx) / r.sw) * CW;
            const py = ((s.y * vh - r.sy) / r.sh) * CH;
            const size = (s.size || MARK_SIZES[s.kind] || MARK_SIZES.circle) * CH * (vh / r.sh);
            drawMark(ctx, s.kind || "circle", px, py, size, s.color || "#f6a21d");
            drawn.current[i] = { px, py, size, kind: s.kind || "circle" };
            if (s.label) { ctx.font = "800 22px Arial"; ctx.fillStyle = s.color || "#f6a21d"; ctx.fillText(s.label, px + size + 6, py - size); }
          });
          if (L.mode === "wash") {
            ctx.fillStyle = "rgba(0,0,0,0.55)";
            ctx.fillRect(0, CH - 34, 260, 34);
            ctx.fillStyle = "#f6a21d";
            ctx.font = "800 20px Arial";
            ctx.fillText(`${L.editWash ? "WASH EDITOR" : "WASHED"} · ${viewNow().z.toFixed(2)}×${draftRef.current ? " (unsaved)" : ""}`, 10, CH - 11);
          }
          if (L.markTool) {
            ctx.fillStyle = "rgba(0,0,0,0.6)";
            ctx.fillRect(0, 0, 470, 34);
            ctx.fillStyle = "#f6a21d";
            ctx.font = "800 18px Arial";
            ctx.fillText(L.markTool === "arrow" ? "ARROW · click = its tip · scroll = size" : "CIRCLE · click = its middle · scroll = size", 10, 23);
          }
        }
        const now = performance.now();
        if (now - last > 120) { last = now; L.onTime?.(v.currentTime, !v.paused); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The parent's controls.
  useEffect(() => {
    if (!apiRef) return;
    const v = () => videoRef.current;
    apiRef.current = {
      seek: (t) => { if (v()) v().currentTime = Math.max(0, t); },
      // Dragging the scrub bar: only the newest spot is sought — while one
      // seek is still decoding, the next waits (and is replaced), so the
      // film keeps up with the hand instead of chewing through a queue.
      scrubTo: (t) => {
        const x = v();
        if (!x) return;
        const R = live.current.range;
        const to = R ? Math.min(R.out - 0.05, Math.max(R.in, t)) : Math.max(0, t);
        if (x.seeking) { scrubNext.current = to; return; }
        scrubNext.current = null;
        x.currentTime = to;
      },
      play: () => v()?.play().catch(() => {}),
      pause: () => v()?.pause(),
      toggle: () => { const x = v(); if (!x) return; if (x.paused) x.play().catch(() => {}); else x.pause(); },
      time: () => v()?.currentTime || 0,
      duration: () => v()?.duration || 0,
      paused: () => v()?.paused ?? true,
      step: (frames) => { const x = v(); if (!x) return; x.pause(); x.currentTime = Math.max(0, x.currentTime + frames / FPS); },
      // Rewind like playing backwards (the video can't play in reverse): seek
      // back, wait for that frame to show, seek again — each step as far as
      // the real time passed × speed. stop() ends it.
      rewind: (speed = 1) => {
        const x = v();
        if (!x) return () => {};
        x.pause();
        let on = true;
        let last = performance.now();
        const step = () => {
          if (!on) return;
          const R = live.current.range;
          const now = performance.now();
          const to = x.currentTime - ((now - last) / 1000) * speed;
          last = now;
          const floor = R ? R.in : 0;
          if (x.currentTime <= floor + 0.01) { requestAnimationFrame(step); return; }
          x.currentTime = Math.max(floor, to);
        };
        const onSeeked = () => requestAnimationFrame(step);
        x.addEventListener("seeked", onSeeked);
        step();
        return () => { on = false; x.removeEventListener("seeked", onSeeked); };
      },
      nudge: (s) => { const x = v(); if (!x) return; const R = live.current.range; const to = x.currentTime + s; x.currentTime = R ? Math.min(R.out - 0.05, Math.max(R.in, to)) : Math.max(0, to); },
      setRate: (r) => { const x = v(); if (x) x.playbackRate = r; setRateState(r); },
      // The film's real speed (Chrome puts a newly loaded file back to 1×, so a
      // remembered number could be stale — and a hold would "restore" it).
      rate: () => v()?.playbackRate || 1,
      view: () => viewNow(),
      draft: () => draftRef.current,
      setDraft: (d) => { draftRef.current = d; },
      fullscreen: toggleFull,
    };
  });

  // Mouse: in wash, drag pans and the wheel zooms; with a mark tool, a click
  // places the mark and the wheel sizes it.
  const norm = (e) => {
    const c = canvasRef.current;
    const v = videoRef.current;
    const b = c.getBoundingClientRect();
    const fx = (e.clientX - b.left) / b.width;
    const fy = (e.clientY - b.top) / b.height;
    if ((live.current.mode !== "wash" && !draftRef.current) || !v?.videoWidth) return { x: fx, y: fy };
    const r = cropOf(viewNow(), v.videoWidth, v.videoHeight);
    return { x: (r.sx + fx * r.sw) / v.videoWidth, y: (r.sy + fy * r.sh) / v.videoHeight };
  };
  // Is the pointer on the mark (as drawn)? A circle: inside its ring; an arrow: near its tip / shaft.
  const onMarkAt = (e) => {
    const m = drawn.current[0];
    const c = canvasRef.current;
    if (!m || !c) return false;
    const b = c.getBoundingClientRect();
    const cx = ((e.clientX - b.left) / b.width) * CW;
    const cy = ((e.clientY - b.top) / b.height) * CH;
    const dy = m.kind === "arrow" ? Math.min(0, cy - m.py) : 0; // an arrow's shaft runs up from its tip
    return Math.hypot(cx - m.px, (cy - m.py) - dy) <= Math.max(18, m.size * 1.15) && cy <= m.py + m.size * 0.6;
  };
  const startMarkDrag = (e, p) => {
    markDrag.current = { x: p.x, y: p.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onDown = (e) => {
    if (e.button !== 0) return;
    // With a tool picked (C / A): the click puts it down — and keep holding to slide it into place.
    if (markTool && onMark) { const p = norm(e); const tm = videoRef.current?.currentTime || 0; videoRef.current?.pause(); onMark(p.x, p.y, tm); startMarkDrag(e, p); markDrag.current.place = { x: p.x, y: p.y, t: tm }; return; }
    // Grab the mark and move it — smoothly, wherever the hand goes.
    if (quickMarks && onMarkMove && !(mode === "wash" && editWash) && onMarkAt(e)) { startMarkDrag(e, norm(e)); return; }
    // Hold on the film: drag pans (the wash), scroll zooms — keyed by the parent while held.
    if ((mode === "wash" && editWash) || liveWash) {
      drag.current = { x: e.clientX, y: e.clientY, view: viewNow() };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      if (liveWash) onWashHold?.(true);
    }
  };
  const onMove = (e) => {
    if (markDrag.current) { const p = norm(e); markDrag.current = { ...markDrag.current, x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) }; return; }
    const d = drag.current;
    if (!d) return;
    const b = canvasRef.current.getBoundingClientRect();
    const z = d.view.z || 1;
    draftRef.current = { ...d.view, x: clamp(d.view.x - (e.clientX - d.x) / b.width / z, 0, 1), y: clamp(d.view.y - (e.clientY - d.y) / b.height / z, 0, 1) };
  };
  const onUp = () => {
    if (drag.current && liveWash) onWashHold?.(false);
    drag.current = null;
    const m = markDrag.current;
    if (!m) return;
    markDrag.current = null;
    // Just put down with a tool: slid somewhere → put it down there instead.
    if (m.place) { if (Math.hypot(m.x - m.place.x, m.y - m.place.y) > 0.002) onMark?.(m.x, m.y, m.place.t); return; }
    onMarkMove?.(m.x, m.y);
  };
  // Marks any time (user, 2026-11-25): double-click = a circle, triple-click = an arrow.
  const onClick = (e) => {
    if (!quickMarks || !onQuickMark || markTool || (mode === "wash" && editWash)) return;
    if (e.detail === 2) {
      const p = norm(e);
      const tm = videoRef.current?.currentTime || 0;
      clearTimeout(clickWait.current);
      clickWait.current = setTimeout(() => onQuickMark("circle", p.x, p.y, tm), 280);
    } else if (e.detail === 3) {
      clearTimeout(clickWait.current);
      const p = norm(e);
      onQuickMark("arrow", p.x, p.y, videoRef.current?.currentTime || 0);
    }
  };
  const onWheel = (e) => {
    const held = !!drag.current; // a click held down + scroll = zoom (the wash), never the mark's size
    if (!held && !wheelWash && (markTool || (quickMarks && drawn.current[0] && !(mode === "wash" && editWash)))) { onMarkSize?.(e.deltaY < 0 ? 1.1 : 1 / 1.1); return; }
    if (!held && !wheelWash && (mode !== "wash" || !editWash)) return;
    const cur = viewNow();
    draftRef.current = { ...cur, z: clamp((cur.z || 1) * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 1, 5) };
    // Panning from here on starts at the new zoom.
    if (drag.current) drag.current = { x: e.clientX, y: e.clientY, view: draftRef.current };
    if (!held) onWashEdit?.();
  };
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    const block = (e) => { const L = live.current; if ((L.mode === "wash" && L.editWash) || L.wheelWash || L.markTool || drag.current || (L.quickMarks && drawn.current[0])) e.preventDefault(); };
    c.addEventListener("wheel", block, { passive: false });
    return () => c.removeEventListener("wheel", block);
  }, []);

  return (
    <div ref={wrapRef} className="wd-fs-video" style={{ position: "relative", ...(stage ? { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#000", containerType: "size" } : {}), ...(full ? { background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "100vw", height: "100vh" } : {}), ...style }}>
      <canvas ref={canvasRef} width={CW} height={CH} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel} onClick={onClick}
        style={{ display: "block", borderRadius: full || stage ? 0 : 10, background: "#0b1426", cursor: markTool ? "crosshair" : (mode === "wash" && editWash) || liveWash ? "grab" : "default", touchAction: "none",
          ...(full ? { width: `min(100vw, calc((100vh - ${fsBar ? 64 : 0}px) * 16 / 9))`, aspectRatio: "16 / 9" }
            : stage ? { width: "min(100cqw, calc(100cqh * 16 / 9))", aspectRatio: "16 / 9" }
              : { width: "100%", aspectRatio: "16 / 9" }) }} />
      <video ref={videoRef} src={url || undefined} muted playsInline preload="auto" style={{ display: "none" }}
        onLoadedMetadata={(e) => { e.currentTarget.playbackRate = 1; setRateState(1); if (range) e.currentTarget.currentTime = range.in; if (live.current.autoPlay) e.currentTarget.play().catch(() => {}); }} />
      <button type="button" onClick={toggleFull} title={full || stage ? "Exit full screen (F / Esc)" : "Full screen (F)"}
        style={{ position: "absolute", top: 8, right: 8, border: "none", borderRadius: 6, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 16, fontWeight: 900, padding: "4px 9px", cursor: "pointer" }}>{full || stage ? "✕" : "⛶"}</button>
      {overlay && <div style={{ position: "absolute", top: 10, left: 10, maxWidth: "70%", pointerEvents: "none", zIndex: 2 }}>{overlay}</div>}
      {center && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", zIndex: 3 }}><div style={{ maxWidth: "80%", pointerEvents: "auto" }}>{center}</div></div>}
      {full && fsBar && <div style={{ width: "100%", minHeight: 64, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexWrap: "wrap", padding: "8px 12px", boxSizing: "border-box", background: "#0b1220", colorScheme: "dark" }}>{fsBar}</div>}
      {!file && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", alignContent: "center", gap: 10, color: "#8a97ab", fontWeight: 800, textAlign: "center", padding: 20 }}>
          {gate ? (
            <>
              <button type="button" onClick={gate.go} style={{ border: "none", background: "#0055a5", color: "#fff", borderRadius: 10, padding: "12px 22px", fontSize: 16, fontWeight: 900, cursor: "pointer" }}>{gate.label}</button>
              <div style={{ fontSize: 13 }}>{gate.hint}</div>
            </>
          ) : "No film loaded"}
        </div>
      )}
    </div>
  );
}
