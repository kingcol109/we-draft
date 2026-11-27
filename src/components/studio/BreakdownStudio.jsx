// src/components/studio/BreakdownStudio.jsx
//
// The Breakdown Studio (user, 2026-11-25): edit a ~4-minute player video
// right on the site, in one sitting — no downloading graphics, no Premiere
// round trips. Opened from a breakdown tab (Draft / Portal Breakdowns,
// Draft Reactions) on the player that's open there.
//
//   1. Face cam: the admin's recording (MP4) — the video's clock and audio.
//   2. Film: the player's Premiere project (.prproj) — the plays he already
//      cut from full games into a sequence (utils/studio/prproj.js) — and the
//      folder the game MP4s live in (utils/studio/filmFolder.js). Nothing is
//      copied or uploaded; plays are read straight out of the game files.
//   3. Marks: tap M (or Mark) as the recording moves to the next segment —
//      each segment's breakdown frame comes in there (and the verdict's
//      reveals). The YouTube chapters come from them.
//   4. Plays: each segment's plays fill the film window back to back
//      (looping if the segment runs longer). Auto-fill puts two in the intro
//      (the first with the Scouting Card) and splits the rest between
//      strengths and weaknesses. Any play can carry a Scouting Card, Player
//      ID or Play Result (videoAssets/*); "Spot" then a click on the preview
//      puts it on the player.
//   5. Export: the finished 1080p MP4, rendered in the browser and written
//      to a file the admin picks (utils/studio/exportMp4.js).
//
// The marks and the plays' layout are kept in this browser (localStorage,
// per player) so a reload doesn't lose them; the files are picked again.
import { useEffect, useMemo, useRef, useState } from "react";
import { parsePrproj, prprojText, baseName } from "../../utils/studio/prproj";
import { pickFolder, resolveFiles } from "../../utils/studio/filmFolder";
import { assetAt, autoAssign, chaptersText, defaultMarks, filmAt, filmLayout, markOrder, overlayViewAt, segmentAt, ASSET_SECONDS } from "../../utils/studio/timeline";
import { drawCover, exportMp4, EXPORT } from "../../utils/studio/exportMp4";
import { DEFAULT_CARD, drawScoutCard } from "../videoAssets/scoutCard";
import { DEFAULT_RESULT, drawPlayResult, RESULT_PRESETS } from "../videoAssets/playResult";

const W = 1920;
const H = 1080;
const VIDEO_EXT = /\.(mp4|m4v|mov)$/i;
const UI_BLUE = "#0055a5";
const UI_GOLD = "#f6a21d";
const SEG_COLORS = ["#0055a5", "#6d28d9", "#15803d", "#a52a1e", "#b7791f", "#0e7490", "#be185d"];
const clock = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const btn = (primary) => ({
  border: `1px solid ${primary ? UI_BLUE : "#cfd7e3"}`, background: primary ? UI_BLUE : "#fff", color: primary ? "#fff" : "#1d2433",
  borderRadius: 8, padding: "6px 12px", fontWeight: 800, fontSize: 13, cursor: "pointer",
});
const mini = { ...btn(false), padding: "2px 7px", fontSize: 11 };
const field = { border: "1px solid #cfd7e3", borderRadius: 8, padding: "5px 8px", fontSize: 12 };
const head = { fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.5, color: "#5b6b84" };
const box = { display: "grid", gap: 8, padding: 12, border: "1px solid #e3e8ef", borderRadius: 10, background: "#fff" };
const OVERLAYS = [["none", "No graphic"], ["scoutcard", "Scouting Card"], ["playerid", "Player ID"], ["result", "Play Result"]];

const storeKey = (bd) => `wd.studio.${bd.playerId}.${bd.mode || "draft"}`;
const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };

/**
 * props: bd, branding, draw(canvas, view) → the breakdown frame,
 * segs (segsOf), entries (sequenceOf), animSec(anim), boxes(view) → { VID, FACE, hold? }
 * (the windows for a view — the intro's and the zoom out of it are their own;
 * hold: keep the last film frame up), times (DEFAULT_TIMES)
 */
export default function BreakdownStudio({ bd, draw, segs, entries, animSec, boxes, times, onClose }) {
  const segKeys = useMemo(() => segs.map((s) => s.key), [segs]);
  const reveals = useMemo(() => entries.filter((e) => e.kind === "mov" && e.seg === "verdict" && e.step > 0).length, [entries]);
  const order = useMemo(() => markOrder(segKeys, reveals), [segKeys, reveals]);
  const stored = useMemo(() => load(storeKey(bd)), [bd.playerId, bd.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const [face, setFace] = useState(null); // { file, url, duration }
  const [project, setProject] = useState(null); // { name, sequences }
  const [seqId, setSeqId] = useState(stored?.seqId || "");
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState({}); // path → File | null
  const [marks, setMarks] = useState(stored?.marks || null);
  const [assign, setAssign] = useState(stored?.assign || {});
  const [loop, setLoop] = useState(stored?.loop ?? true);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [spotFor, setSpotFor] = useState(null); // { seg, index }
  const [prog, setProg] = useState(null);
  const [msg, setMsg] = useState("");
  const [av, setAv] = useState(null); // AdminVideoAssets (lookOf, drawPlayerId), loaded on open
  const canvasRef = useRef(null);
  const faceRef = useRef(null);
  const filmRef = useRef(null);
  const cancelRef = useRef(false);

  useEffect(() => { import("../AdminVideoAssets").then(setAv).catch(() => {}); }, []);
  // Kept per player in this browser.
  useEffect(() => { save(storeKey(bd), { seqId, marks, assign, loop, project: project?.name || stored?.project || "" }); }, [seqId, marks, assign, loop]); // eslint-disable-line react-hooks/exhaustive-deps

  const duration = face?.duration || 0;
  const sequence = project?.sequences.find((s) => s.id === seqId) || null;
  const plays = useMemo(() => (sequence?.plays || []).filter((p) => VIDEO_EXT.test(p.file)), [sequence]);
  const urls = useMemo(() => Object.fromEntries(Object.entries(files).filter(([, f]) => f).map(([p, f]) => [p, URL.createObjectURL(f)])), [files]);
  useEffect(() => () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)), [urls]);
  const layout = useMemo(() => (marks && duration ? filmLayout({ segKeys, marks, duration, assign, plays, loop }) : []), [segKeys, marks, duration, assign, plays, loop]);
  const missing = [...new Set(layout.map((x) => x.src.path))].filter((p) => !files[p]);

  // ── Inputs ──
  const openFace = (file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      const d = v.duration || 0;
      setFace((old) => { if (old?.url) URL.revokeObjectURL(old.url); return { file, url, duration: d }; });
      setMarks((m) => (m && Object.values(m).every((x) => x <= d) ? m : defaultMarks(segKeys, d, times, reveals, animSec("verdict") || 2)));
      setMsg(`Face cam: ${file.name} (${clock(d)}).`);
    };
    v.onerror = () => setMsg("That file won't play here — it needs to be an MP4 (H.264).");
    v.src = url;
  };
  const openProject = async (file) => {
    if (!file) return;
    try {
      const xml = await prprojText(await file.arrayBuffer());
      const p = parsePrproj(xml);
      const seqs = p.sequences.map((s) => ({ ...s, playCount: s.plays.filter((x) => VIDEO_EXT.test(x.file)).length })).filter((s) => s.playCount > 0);
      if (!seqs.length) throw new Error("no sequences with video in it");
      setProject({ name: file.name, sequences: seqs });
      // Keep the saved sequence if it's here, else the one with the most plays.
      const keep = seqs.find((s) => s.id === seqId) || [...seqs].sort((a, b) => b.playCount - a.playCount)[0];
      setSeqId(keep.id);
      setMsg(`${file.name}: ${seqs.length} sequence${seqs.length > 1 ? "s" : ""} with plays.`);
      if (folders.length) findFiles(folders, seqs);
    } catch (e) {
      setMsg(`Couldn't read that project: ${e.message}`);
    }
  };
  const findFiles = async (dirs, seqs = project?.sequences || []) => {
    const paths = [...new Set(seqs.flatMap((s) => s.plays.filter((x) => VIDEO_EXT.test(x.file)).map((x) => x.path)))];
    if (!paths.length) return;
    setMsg("Finding the game files…");
    const found = await resolveFiles(paths, dirs);
    setFiles(found);
    const n = Object.values(found).filter(Boolean).length;
    setMsg(`Found ${n} of ${paths.length} game files.`);
  };
  const addFolder = async () => {
    try {
      const dir = await pickFolder();
      const next = [...folders, dir];
      setFolders(next);
      await findFiles(next);
    } catch (e) {
      if (e.name !== "AbortError") setMsg(e.message);
    }
  };

  // ── Marks ──
  const setMark = (id, v) => setMarks((m) => ({ ...m, [id]: Math.max(0, Math.min(duration, Math.round(v * 10) / 10)) }));
  // M: the next transition happens now (the first mark after the playhead).
  const markNow = () => {
    if (!marks) return;
    const now = faceRef.current?.currentTime ?? t;
    const next = order.find((o) => (marks[o.id] ?? Infinity) > now + 0.05);
    if (next) setMark(next.id, now);
  };
  useEffect(() => {
    const onKey = (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "m" || e.key === "M") { e.preventDefault(); markNow(); }
      if (e.key === " ") { e.preventDefault(); toggle(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── Playback ──
  const toggle = () => {
    const v = faceRef.current;
    if (!v || !face) return;
    if (v.paused) { v.play().then(() => setPlaying(true)).catch(() => {}); } else { v.pause(); setPlaying(false); }
  };
  const seek = (s) => {
    const v = faceRef.current;
    if (v) v.currentTime = Math.max(0, Math.min(duration, s));
    setT(Math.max(0, Math.min(duration, s)));
  };

  // The asset for a play at a moment (shared by the preview and the export).
  const assetBase = useMemo(() => ({
    playerId: bd.playerId, first: bd.first, last: bd.last, pos: bd.pos, school: bd.school, cls: bd.cls,
    height: bd.facts?.height || "", weight: String(bd.facts?.weight || "").replace(/\s*lbs?\.?$/i, ""),
    headshot: bd.headshot || "", schoolLogo: bd.logo || "", stats: [], rank: null, recruit: null,
  }), [bd]);
  const drawAsset = async (canvas, hit) => {
    if (!hit || !av) return false;
    const ov = hit.item.overlay || {};
    const { VID } = boxes({ seg: hit.item.seg });
    const spot = ov.spot || { x: VID.x + VID.w / 2, y: VID.y + VID.h / 2 };
    const look = av.lookOf("wd", null, "");
    const base = { ...assetBase, look, seconds: hit.seconds };
    if (hit.kind === "scoutcard") await drawScoutCard(canvas, { ...base, card: { ...DEFAULT_CARD, cx: spot.x, cy: spot.y } }, hit.p);
    else if (hit.kind === "playerid") await av.drawPlayerId(canvas, { ...base, place: { cx: spot.x, cy: spot.y, size: 100, tag: "auto", dx: 0, dy: 0 }, fadeOut: true }, hit.p);
    else if (hit.kind === "result") await drawPlayResult(canvas, { ...base, result: { ...DEFAULT_RESULT, preset: ov.preset || "TOUCHDOWN", x: VID.x + VID.w / 2, y: VID.y + VID.h - 130, s: 0.8 } }, hit.p);
    else return false;
    return true;
  };

  // The breakdown frame: stills cached per view, clips drawn as they go.
  const cache = useRef({});
  useEffect(() => { cache.current = {}; }, [bd]);
  const overlayCanvas = async (view, into) => {
    const key = view.anim ? null : `${view.seg}|${view.step}`;
    if (key && cache.current[key]) return cache.current[key];
    const c = into || document.createElement("canvas");
    c.width = W;
    c.height = H;
    await draw(c, view);
    if (key) {
      const copy = document.createElement("canvas");
      copy.width = W;
      copy.height = H;
      copy.getContext("2d").drawImage(c, 0, 0);
      cache.current[key] = copy;
      return copy;
    }
    return c;
  };
  const viewAt = (s) => overlayViewAt({ segKeys, marks, duration, entries, animSec }, s);

  // ── The preview loop ──
  const live = useRef({});
  live.current = { face, marks, layout, urls, playing, spotFor, av, duration, viewAt, overlayCanvas, drawAsset, boxes };
  useEffect(() => {
    let raf = 0;
    let stop = false;
    let ovBusy = false;
    let ovImg = null;
    let ovKey = "";
    let asBusy = false;
    let asImg = null;
    const asCanvas = document.createElement("canvas");
    asCanvas.width = W;
    asCanvas.height = H;
    let lastUi = 0;
    const tick = () => {
      if (stop) return;
      const L = live.current;
      const c = canvasRef.current;
      const fv = filmRef.current;
      const v = faceRef.current;
      if (c && L.marks && L.duration) {
        const now = v ? v.currentTime : 0;
        const ctx = c.getContext("2d");
        // The film: the play at now, at its source time.
        const hit = filmAt(L.layout, now);
        if (fv) {
          const url = hit ? L.urls[hit.item.src.path] : "";
          if (url && fv.dataset.src !== url) { fv.src = url; fv.dataset.src = url; }
          if (hit && url && fv.readyState >= 1) {
            const off = Math.abs(fv.currentTime - hit.srcTime);
            if (off > (L.playing ? 0.35 : 0.04) && !fv.seeking) fv.currentTime = hit.srcTime;
            if (L.playing && fv.paused) fv.play().catch(() => {});
          }
          if (!L.playing && !fv.paused) fv.pause();
        }
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        // The breakdown frame's view sets the windows (the zoom moves them).
        const view = L.viewAt(now);
        const bx = L.boxes(view);
        if (fv && !hit && !fv.paused) fv.pause();
        if (fv && fv.readyState >= 2 && fv.dataset.src && (hit ? L.urls[hit.item.src.path] : bx.hold)) drawCover(ctx, fv, bx.VID);
        if (v && v.readyState >= 2) drawCover(ctx, v, bx.FACE);
        // The breakdown frame (redrawn when it changes; one draw at a time).
        const key = JSON.stringify(view);
        if (key !== ovKey && !ovBusy) {
          ovBusy = true;
          const k = key;
          L.overlayCanvas(view).then((img) => { ovImg = img; ovKey = k; }).catch(() => {}).finally(() => { ovBusy = false; });
        }
        if (ovImg) ctx.drawImage(ovImg, 0, 0);
        // A graphic on the play.
        const a = assetAt(L.layout, now);
        if (a && !asBusy) {
          asBusy = true;
          L.drawAsset(asCanvas, a).then((ok) => { asImg = ok ? asCanvas : null; }).catch(() => {}).finally(() => { asBusy = false; });
        }
        if (!a) asImg = null;
        if (asImg) ctx.drawImage(asImg, 0, 0);
        // Placing a graphic: a crosshair hint.
        if (L.spotFor) {
          ctx.fillStyle = "rgba(246,162,29,0.9)";
          ctx.font = "800 40px Arial";
          const { VID } = L.boxes({ seg: L.spotFor.seg });
          ctx.fillText("CLICK THE PLAYER", VID.x + 30, VID.y + 60);
        }
        const tnow = performance.now();
        if (tnow - lastUi > 120) { lastUi = tnow; setT(now); if (v && v.paused && L.playing) setPlaying(false); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { stop = true; cancelAnimationFrame(raf); };
  }, [av]); // eslint-disable-line react-hooks/exhaustive-deps

  // A click on the preview: put the waiting graphic on the player.
  const onCanvasClick = (e) => {
    if (!spotFor) return;
    const r = canvasRef.current.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * W);
    const y = Math.round(((e.clientY - r.top) / r.height) * H);
    editItem(spotFor.seg, spotFor.index, (it) => ({ ...it, overlay: { ...(it.overlay || {}), spot: { x, y } } }));
    setSpotFor(null);
    setMsg("Spot set.");
  };

  // ── Plays in segments ──
  const editItem = (seg, index, fn) => setAssign((a) => ({ ...a, [seg]: (a[seg] || []).map((it, i) => (i === index ? fn(it) : it)) }));
  const move = (seg, index, d) => setAssign((a) => {
    const list = [...(a[seg] || [])];
    const j = index + d;
    if (j < 0 || j >= list.length) return a;
    [list[index], list[j]] = [list[j], list[index]];
    return { ...a, [seg]: list };
  });
  const remove = (seg, index) => setAssign((a) => ({ ...a, [seg]: (a[seg] || []).filter((_, i) => i !== index) }));
  const addPlay = (seg, playIdx) => {
    const p = plays[playIdx];
    if (!p) return;
    setAssign((a) => ({ ...a, [seg]: [...(a[seg] || []), { play: playIdx, in: p.in, out: p.out, overlay: { kind: "none" } }] }));
  };
  const autoFill = () => {
    if (!marks || !plays.length) return;
    if (Object.values(assign).some((l) => l?.length) && !window.confirm("Replace the plays already placed?")) return;
    setAssign(autoAssign(segKeys, marks, duration, plays));
  };
  const jumpToItem = (seg, index) => {
    const x = layout.find((l) => l.seg === seg && l.index === index && l.pass === 0);
    if (x) seek(x.start + Math.min(0.5, (x.end - x.start) / 3));
  };
  const used = useMemo(() => {
    const m = {};
    Object.values(assign).forEach((l) => (l || []).forEach((it) => { m[it.play] = (m[it.play] || 0) + 1; }));
    return m;
  }, [assign]);
  const segFilled = (k) => {
    const list = assign[k] || [];
    const len = list.reduce((s, it) => s + Math.max(0, it.out - it.in), 0);
    const seg = marks ? segmentAt(segKeys, marks, duration, k === segKeys[0] ? 0 : marks[k]) : null;
    return { len, span: seg ? seg.end - seg.start : 0 };
  };

  // ── Export ──
  const doExport = async () => {
    if (!face || !marks) return;
    if (missing.length) { setMsg(`Find the game files first — ${missing.length} missing.`); return; }
    if (!window.showSaveFilePicker) { setMsg("Export needs Chrome or Edge."); return; }
    let handle;
    try {
      handle = await window.showSaveFilePicker({ suggestedName: `${bd.first}-${bd.last}-Breakdown.mp4`.replace(/\s+/g, "-"), types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }] });
    } catch { return; }
    faceRef.current?.pause();
    setPlaying(false);
    cancelRef.current = false;
    const started = Date.now();
    setProg({ i: 0, n: 1, status: "Starting…" });
    const ovC = document.createElement("canvas");
    const asC = document.createElement("canvas");
    asC.width = W;
    asC.height = H;
    try {
      const writable = await handle.createWritable();
      await exportMp4(writable, {
        duration, faceFile: face.file, files, layout,
        boxesAt: (s) => boxes(viewAt(s)),
        overlayAt: (s) => overlayCanvas(viewAt(s), ovC),
        assetAt: async (s) => { const a = assetAt(layout, s); return a && (await drawAsset(asC, a)) ? asC : null; },
        onProgress: (p) => setProg(p),
        isCancelled: () => cancelRef.current,
      });
      setMsg(`Exported ${handle.name} in ${Math.round((Date.now() - started) / 1000)} s.`);
    } catch (e) {
      setMsg(e.message === "cancelled" ? "Export cancelled." : `Export failed: ${e.message}`);
    }
    setProg(null);
  };

  const filmSegs = segKeys.filter((k) => assign[k] || ["intro", "strengths", "weaknesses"].includes(k));
  const cur = marks ? segmentAt(segKeys, marks, duration, t) : null;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: "#1d2433", flex: 1 }}>Studio · {bd.first} {bd.last}</div>
        {onClose && <button type="button" style={btn(false)} onClick={onClose}>Back to the frames</button>}
      </div>

      {/* Inputs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        <div style={box}>
          <div style={head}>1 · Face cam</div>
          <label style={{ ...btn(!face), justifySelf: "start" }}>{face ? "Change recording" : "Open recording (MP4)"}
            <input type="file" accept="video/mp4,video/*" style={{ display: "none" }} onChange={(e) => openFace(e.target.files?.[0])} />
          </label>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#5b6b84" }}>{face ? `${face.file.name} · ${clock(face.duration)}` : "Your face + audio. It sets the video's length."}</div>
        </div>
        <div style={box}>
          <div style={head}>2 · Plays (Premiere)</div>
          <label style={{ ...btn(!project), justifySelf: "start" }}>{project ? "Change project" : "Open .prproj"}
            <input type="file" accept=".prproj" style={{ display: "none" }} onChange={(e) => openProject(e.target.files?.[0])} />
          </label>
          {project && (
            <select value={seqId} onChange={(e) => setSeqId(e.target.value)} style={field}>
              {project.sequences.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.playCount} plays · {clock(s.duration)}</option>)}
            </select>
          )}
          {!project && stored?.project && <div style={{ fontSize: 12, fontWeight: 700, color: "#7a8597" }}>Last time: {stored.project}</div>}
        </div>
        <div style={box}>
          <div style={head}>3 · Game files</div>
          <button type="button" style={{ ...btn(!folders.length && !!project), justifySelf: "start" }} onClick={addFolder}>{folders.length ? "Add another folder" : "Choose film folder"}</button>
          <div style={{ fontSize: 12, fontWeight: 700, color: missing.length ? "#a52a1e" : "#5b6b84" }}>
            {folders.length ? `${folders.map((f) => f.name).join(", ")} · ${Object.values(files).filter(Boolean).length} found${missing.length ? ` · ${missing.length} still missing` : ""}` : "Pick the folder above your game folders (e.g. KC Entertainment)."}
          </div>
          {missing.length > 0 && <div style={{ fontSize: 11, color: "#a52a1e" }}>{missing.map(baseName).join(", ")}</div>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 12, alignItems: "start" }}>
        {/* Preview + transport + timeline */}
        <div style={{ display: "grid", gap: 8 }}>
          <canvas ref={canvasRef} width={W} height={H} onClick={onCanvasClick}
            style={{ width: "100%", aspectRatio: "16 / 9", borderRadius: 10, background: "#0b1426", cursor: spotFor ? "crosshair" : "default" }} />
          <video ref={faceRef} src={face?.url || undefined} style={{ display: "none" }} playsInline onEnded={() => setPlaying(false)} />
          <video ref={filmRef} muted playsInline style={{ display: "none" }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" style={btn(true)} onClick={toggle} disabled={!face}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
            <button type="button" style={btn(false)} onClick={markNow} disabled={!face} title="The next segment starts now (key: M)">Mark (M)</button>
            <span style={{ fontSize: 13, fontWeight: 900, color: "#1d2433", fontVariantNumeric: "tabular-nums" }}>{clock(t)} / {clock(duration)}</span>
            {cur && <span style={{ fontSize: 12, fontWeight: 900, color: SEG_COLORS[cur.index % SEG_COLORS.length], textTransform: "uppercase" }}>{segs[cur.index]?.label}</span>}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#7a8597" }}>Space: play/pause · M: next segment starts now</span>
          </div>
          {marks && duration > 0 && (
            <div style={{ position: "relative", height: 54, borderRadius: 8, overflow: "hidden", background: "#eef2f7", cursor: "pointer" }}
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * duration); }}>
              {segKeys.map((k, i) => {
                const s = i === 0 ? 0 : marks[k];
                const e2 = i < segKeys.length - 1 ? marks[segKeys[i + 1]] : duration;
                return (
                  <div key={k} title={segs[i].label} style={{ position: "absolute", left: `${(s / duration) * 100}%`, width: `${((e2 - s) / duration) * 100}%`, top: 0, height: 26,
                    background: SEG_COLORS[i % SEG_COLORS.length], color: "#fff", fontSize: 10, fontWeight: 900, padding: "6px 4px", boxSizing: "border-box", overflow: "hidden", whiteSpace: "nowrap", borderRight: "2px solid #fff" }}>
                    {segs[i].label}
                  </div>
                );
              })}
              {layout.map((x, i) => (
                <div key={i} title={`${x.src.file} · ${clock(x.in)}`} style={{ position: "absolute", left: `${(x.start / duration) * 100}%`, width: `${((x.end - x.start) / duration) * 100}%`, top: 30, height: 20,
                  background: x.pass ? "#c3cad4" : files[x.src.path] ? "#5b6b84" : "#e8a39c", borderRight: "1px solid #fff", boxSizing: "border-box" }}>
                  {x.overlay?.kind && x.overlay.kind !== "none" && x.pass === 0 && <div style={{ width: 6, height: 6, borderRadius: 3, background: UI_GOLD, margin: "7px 3px" }} />}
                </div>
              ))}
              <div style={{ position: "absolute", left: `${(t / duration) * 100}%`, top: 0, bottom: 0, width: 2, background: "#1d2433" }} />
            </div>
          )}

          {/* Export */}
          <div style={{ ...box, gridTemplateColumns: "1fr auto", alignItems: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#5b6b84" }}>
              {prog ? `${prog.status}` : `Exports 1080p · ${EXPORT.fps} fps · H.264 ${EXPORT.videoBitrate / 1e6} Mbps + AAC, rendered on this computer and saved where you choose.`}
              {prog && <div style={{ height: 6, background: "#eef2f7", borderRadius: 3, marginTop: 6 }}><div style={{ height: 6, width: `${(prog.i / prog.n) * 100}%`, background: UI_BLUE, borderRadius: 3 }} /></div>}
            </div>
            {prog ? <button type="button" style={btn(false)} onClick={() => { cancelRef.current = true; }}>Cancel</button>
              : <button type="button" style={btn(true)} onClick={doExport} disabled={!face || !marks}>Export MP4</button>}
          </div>
          {msg && <div style={{ fontSize: 13, fontWeight: 800, color: "#1d2433" }}>{msg}</div>}
        </div>

        {/* Marks + plays */}
        <div style={{ display: "grid", gap: 10 }}>
          <div style={box}>
            <div style={head}>Segments</div>
            {!marks && <div style={{ fontSize: 12, color: "#7a8597", fontWeight: 700 }}>Open your recording first.</div>}
            {marks && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 800 }}><span>{segs[0].label}</span><span>0:00.0</span></div>
                {order.map((o) => (
                  <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 800, paddingLeft: o.reveal ? 14 : 0, color: o.reveal ? "#5b6b84" : "#1d2433" }}>
                    <span style={{ flex: 1, textTransform: "uppercase" }}>{o.reveal ? `↳ Reveal ${o.reveal}` : segs.find((s) => s.key === o.seg)?.label}</span>
                    <button type="button" style={mini} onClick={() => setMark(o.id, (marks[o.id] || 0) - 0.5)}>−½</button>
                    <button type="button" style={{ ...mini, minWidth: 56, fontVariantNumeric: "tabular-nums" }} onClick={() => seek(marks[o.id] || 0)} title="Jump here">{clock(marks[o.id] || 0)}</button>
                    <button type="button" style={mini} onClick={() => setMark(o.id, (marks[o.id] || 0) + 0.5)}>+½</button>
                    <button type="button" style={mini} onClick={() => setMark(o.id, faceRef.current?.currentTime ?? t)} title="Set to the playhead">Now</button>
                  </div>
                ))}
                <button type="button" style={{ ...mini, justifySelf: "start" }} onClick={() => navigator.clipboard?.writeText(chaptersText(segs, marks)).then(() => setMsg("YouTube chapters copied."))}>Copy YouTube chapters</button>
              </>
            )}
          </div>

          <div style={box}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ ...head, flex: 1 }}>Plays</div>
              <button type="button" style={mini} onClick={autoFill} disabled={!plays.length || !marks}>Auto-fill</button>
            </div>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 800 }}>
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop plays when a segment runs long
            </label>
            {!plays.length && <div style={{ fontSize: 12, color: "#7a8597", fontWeight: 700 }}>Open the player&apos;s Premiere project to get his plays.</div>}
            {plays.length > 0 && filmSegs.map((k) => {
              const list = assign[k] || [];
              const f = segFilled(k);
              return (
                <div key={k} style={{ display: "grid", gap: 4, paddingTop: 6, borderTop: "1px solid #edf0f5" }}>
                  <div style={{ display: "flex", fontSize: 12, fontWeight: 900, color: "#1d2433" }}>
                    <span style={{ flex: 1, textTransform: "uppercase" }}>{segs.find((s) => s.key === k)?.label}</span>
                    <span style={{ color: f.len >= f.span || loop ? "#5b6b84" : "#b7791f" }}>{Math.round(f.len)}s of film / {Math.round(f.span)}s</span>
                  </div>
                  {list.map((it, i) => {
                    const p = plays[it.play];
                    const ov = it.overlay || { kind: "none" };
                    return (
                      <div key={i} style={{ display: "grid", gap: 3, padding: 6, borderRadius: 6, background: spotFor?.seg === k && spotFor?.index === i ? "#fff8ea" : "#f6f8fb" }}>
                        <div style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11, fontWeight: 800 }}>
                          <button type="button" style={{ ...mini, border: "none", background: "none", color: UI_BLUE }} onClick={() => jumpToItem(k, i)} title="Jump to it">▶</button>
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p?.file}>#{it.play + 1} {p ? p.file.replace(/\.mp4$/i, "").replace(/^(FLORIDA STATE|FSU) O VS[.-]?\s*/i, "vs ") : "?"}</span>
                          <span style={{ color: "#7a8597" }}>{(it.out - it.in).toFixed(1)}s</span>
                          <button type="button" style={mini} onClick={() => move(k, i, -1)}>↑</button>
                          <button type="button" style={mini} onClick={() => move(k, i, 1)}>↓</button>
                          <button type="button" style={{ ...mini, color: "#a52a1e" }} onClick={() => remove(k, i)}>✕</button>
                        </div>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <select value={ov.kind} style={{ ...field, padding: "2px 5px", fontSize: 11 }} onChange={(e) => editItem(k, i, (x) => ({ ...x, overlay: { ...(x.overlay || {}), kind: e.target.value } }))}>
                            {OVERLAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                          {ov.kind === "result" && (
                            <select value={ov.preset || "TOUCHDOWN"} style={{ ...field, padding: "2px 5px", fontSize: 11 }} onChange={(e) => editItem(k, i, (x) => ({ ...x, overlay: { ...x.overlay, preset: e.target.value } }))}>
                              {RESULT_PRESETS.map(([g, l]) => <optgroup key={g} label={g}>{l.map((r) => <option key={r} value={r}>{r}</option>)}</optgroup>)}
                            </select>
                          )}
                          {(ov.kind === "scoutcard" || ov.kind === "playerid") && (
                            <button type="button" style={{ ...mini, color: ov.spot ? "#15803d" : UI_GOLD }} title="Click the player on the preview"
                              onClick={() => { jumpToItem(k, i); faceRef.current?.pause(); setPlaying(false); setSpotFor({ seg: k, index: i }); }}>{ov.spot ? "Spot ✓" : "Spot"}</button>
                          )}
                          {ov.kind !== "none" && <span style={{ fontSize: 10, color: "#7a8597", fontWeight: 700 }}>{ov.kind === "result" ? "at its end" : "at its start"} · {ASSET_SECONDS[ov.kind]}s</span>}
                        </div>
                      </div>
                    );
                  })}
                  <select value="" style={{ ...field, fontSize: 11 }} onChange={(e) => { if (e.target.value !== "") addPlay(k, Number(e.target.value)); }}>
                    <option value="">+ Add a play…</option>
                    {plays.map((p, pi) => <option key={pi} value={pi}>#{pi + 1} {p.file.replace(/\.mp4$/i, "")} · {(p.out - p.in).toFixed(1)}s{used[pi] ? " (used)" : ""}</option>)}
                  </select>
                </div>
              );
            })}
            {plays.length > 0 && (
              <select value="" style={{ ...field, fontSize: 11 }} onChange={(e) => { if (e.target.value) setAssign((a) => ({ ...a, [e.target.value]: a[e.target.value] || [] })); }}>
                <option value="">Film in another segment…</option>
                {segKeys.filter((k) => !filmSegs.includes(k)).map((k) => <option key={k} value={k}>{segs.find((s) => s.key === k)?.label}</option>)}
              </select>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
