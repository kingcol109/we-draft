// src/components/studio/StreamWindow.jsx
//
// The stream window (user, 2026-11-25): a stylized 1920×1080 window for the
// admin's own YouTube streams — a separate setup from the automated
// broadcasts (those run on a cloud machine that can't reach the film). It's
// the Draft Breakdown frame (any segment's — the film window and face cam
// window are cut out) with the player's film playing in the film window.
//
//   Film: his plays from the Film Manager (filmPlays tagged to him), WASHED by
//   default (a play with no washed version shows its original), or the
//   originals; pick which plays and their order; it loops. Marks (circles /
//   arrows) can show. The video plays off the admin's own disk (the Film
//   Manager's library folder) — nothing is uploaded.
//   Face cam window: chroma green (default — OBS keys the camera in), or black.
//   Pop out: a window with just the 1920×1080 frame, for OBS (Window Capture).
//   The film plays in that window, so it keeps going when this tab is in the
//   background.
import { useEffect, useMemo, useRef, useState } from "react";
import { gamesByIds, LABEL_COLORS, LABELS, playsForPlayer } from "../../utils/film/data";
import { gameFile, rootAccess, savedRoot } from "../../utils/film/library";
import { cropOf, drawMark, MARK_SIZES, washAt } from "../film/FilmPlayer";
import { filmName } from "../../utils/film/schedule";

const W = 1920;
const H = 1080;
const UI_BLUE = "#0055a5";
const UI_GOLD = "#f6a21d";
const btn = (on) => ({ border: `1px solid ${on ? UI_BLUE : "#cfd7e3"}`, background: on ? UI_BLUE : "#fff", color: on ? "#fff" : "#1d2433", borderRadius: 8, padding: "6px 12px", fontWeight: 800, fontSize: 13, cursor: "pointer" });
const mini = { ...btn(false), padding: "2px 8px", fontSize: 11 };
const box = { display: "grid", gap: 8, padding: 12, border: "1px solid #e3e8ef", borderRadius: 10, background: "#fff" };
const head = { fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.5, color: "#5b6b84" };
const clock = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const FACE_FILLS = { green: "#00ff00", black: "#000000" };

/** props: bd, draw(canvas, view) → the breakdown frame, segs (segsOf), boxes(view) → { VID, FACE }, onClose */
export default function StreamWindow({ bd, draw, segs, boxes, onClose }) {
  const key = `wd_${bd.playerId}`;
  const [seg, setSeg] = useState(segs[0]?.key || "intro");
  const [plays, setPlays] = useState(null);
  const [games, setGames] = useState({});
  const [picked, setPicked] = useState([]); // play ids, in order
  const [washed, setWashed] = useState(true);
  const [marks, setMarks] = useState(true);
  const [face, setFace] = useState("green");
  const [root, setRoot] = useState(null);
  const [access, setAccess] = useState("none");
  const [now, setNow] = useState({ i: 0, t: 0 });
  const [popped, setPopped] = useState(false);
  const [msg, setMsg] = useState("");
  const previewRef = useRef(null);
  const popRef = useRef(null); // { win, canvas, video }
  const frameRef = useRef({}); // the breakdown frame per segment (drawn once)
  const files = useRef({}); // gameId → object URL

  // His plays, their games, the film folder.
  useEffect(() => {
    playsForPlayer(key).then(async (ps) => {
      setPlays(ps);
      setPicked(ps.map((p) => p.id));
      const gs = await gamesByIds(ps.map((p) => p.gameId));
      setGames(Object.fromEntries(gs.map((g) => [g.id, g])));
    }).catch((e) => setMsg(e.message));
    savedRoot().then(async (h) => { if (h) { setRoot(h); setAccess(await rootAccess(h)); } });
  }, [key]);
  useEffect(() => () => Object.values(files.current).forEach((u) => URL.revokeObjectURL(u)), []);

  // The frame for the chosen segment (its finished still — windows cut out).
  useEffect(() => {
    if (frameRef.current[seg]) return;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    draw(c, { seg, step: 0 }).then(() => { frameRef.current[seg] = c; }).catch(() => {});
  }, [seg, draw]);

  const byId = useMemo(() => Object.fromEntries((plays || []).map((p) => [p.id, p])), [plays]);
  const list = picked.map((id) => byId[id]).filter(Boolean);
  const tagOf = (p) => p?.players?.[key] || {};
  // His cut of a play (tag.trim) when he has one, else the play.
  const rangeOf = (p) => ({ in: tagOf(p).trim?.in ?? p.in, out: tagOf(p).trim?.out ?? p.out });

  // The live state the draw loop reads.
  const live = useRef({});
  live.current = { list, seg, washed, marks, face, access, root, games, now };

  const urlFor = async (p) => {
    if (files.current[p.gameId]) return files.current[p.gameId];
    const g = games[p.gameId];
    const f = g && live.current.access === "granted" ? await gameFile(live.current.root, g).catch(() => null) : null;
    if (!f) return "";
    files.current[p.gameId] = URL.createObjectURL(f);
    return files.current[p.gameId];
  };

  // One frame: the film in the film window (washed or not, with its mark), the
  // face cam window filled, the breakdown frame over it.
  const compose = (ctx, video, p) => {
    const L = live.current;
    const { VID, FACE } = boxes({ seg: L.seg });
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    if (p && video && video.readyState >= 2 && video.videoWidth) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const tg = tagOf(p);
      const keys = tg.wash?.keys || [];
      const r = L.washed && keys.length ? cropOf(washAt(keys, video.currentTime), vw, vh) : { sx: 0, sy: 0, sw: vw, sh: vh };
      // Fill the film window (16:9 both — a straight fit).
      ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, VID.x, VID.y, VID.w, VID.h);
      const s = tg.spot;
      if (L.marks && s && Math.abs(video.currentTime - s.t) <= 1) {
        const kind = s.kind || (tg.legacy?.mark === "arrow" ? "arrow" : "circle");
        const px = VID.x + ((s.x * vw - r.sx) / r.sw) * VID.w;
        const py = VID.y + ((s.y * vh - r.sy) / r.sh) * VID.h;
        const size = (s.size || MARK_SIZES[kind]) * VID.h * (vh / r.sh);
        ctx.save();
        ctx.beginPath();
        ctx.rect(VID.x, VID.y, VID.w, VID.h);
        ctx.clip();
        drawMark(ctx, kind, px, py, size, UI_GOLD);
        ctx.restore();
      }
    }
    ctx.fillStyle = FACE_FILLS[L.face] || "#000";
    ctx.fillRect(FACE.x, FACE.y, FACE.w, FACE.h);
    const fr = frameRef.current[L.seg];
    if (fr) ctx.drawImage(fr, 0, 0);
  };

  // The player: a video element (in the pop-out window when there is one, so it
  // keeps playing when this tab is hidden), stepping through the plays and looping.
  useEffect(() => {
    let stop = false;
    let video = null;
    let doc = document;
    let raf = (fn) => requestAnimationFrame(fn);
    let idx = 0;
    let loading = false;
    const make = () => {
      const pop = popRef.current;
      doc = pop?.win && !pop.win.closed ? pop.win.document : document;
      raf = pop?.win && !pop.win.closed ? (fn) => pop.win.requestAnimationFrame(fn) : (fn) => requestAnimationFrame(fn);
      video = doc.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.style.display = "none";
      doc.body.appendChild(video);
      if (pop) pop.video = video;
    };
    make();
    const load = async (i) => {
      const L = live.current;
      if (!L.list.length) return;
      idx = ((i % L.list.length) + L.list.length) % L.list.length;
      const p = L.list[idx];
      loading = true;
      const url = await urlFor(p);
      if (stop) return;
      if (!url) { setMsg("The film folder needs permission (or the game file is missing) — use Allow film folder."); loading = false; return; }
      if (video.src !== url) video.src = url;
      const go = () => { video.currentTime = rangeOf(p).in; video.play().catch(() => {}); loading = false; };
      if (video.readyState >= 1) go(); else video.onloadedmetadata = go;
    };
    load(0);
    let lastUi = 0;
    const tick = () => {
      if (stop) return;
      const L = live.current;
      const p = L.list[idx];
      if (p && !loading && video.readyState >= 1 && video.currentTime >= rangeOf(p).out - 0.03) load(idx + 1);
      const pop = popRef.current;
      if (pop?.canvas && !pop.win.closed) compose(pop.canvas.getContext("2d"), video, p);
      if (previewRef.current && !document.hidden) compose(previewRef.current.getContext("2d"), video, p);
      const tnow = performance.now();
      if (tnow - lastUi > 300) { lastUi = tnow; setNow({ i: idx, t: p ? video.currentTime - rangeOf(p).in : 0 }); }
      raf(tick);
    };
    raf(tick);
    live.current.jump = (i) => load(i);
    return () => { stop = true; video.pause(); video.remove(); };
  }, [popped, access, picked.join(","), plays]); // eslint-disable-line react-hooks/exhaustive-deps

  const popOut = () => {
    const win = window.open("", "wd-stream-window", `width=${W},height=${H}`);
    if (!win) { setMsg("The browser blocked the pop-out window — allow pop-ups for this site."); return; }
    win.document.title = `Stream · ${bd.first} ${bd.last}`;
    win.document.body.style.cssText = "margin:0;background:#000;overflow:hidden";
    win.document.body.innerHTML = "";
    const canvas = win.document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvas.style.cssText = "display:block;width:100vw;height:100vh;object-fit:contain";
    win.document.body.appendChild(canvas);
    popRef.current = { win, canvas, video: null };
    win.addEventListener("beforeunload", () => { popRef.current = null; setPopped(false); });
    setPopped(true);
    setMsg("Popped out — in OBS, add a Window Capture of that window (1920×1080). Key the face cam window's green to put your camera in.");
  };
  const closePop = () => { popRef.current?.win?.close(); popRef.current = null; setPopped(false); };
  useEffect(() => () => popRef.current?.win?.close(), []);

  const allow = async () => { const a = await rootAccess(root, true); setAccess(a); };
  const move = (id, d) => setPicked((ids) => { const i = ids.indexOf(id); const j = i + d; if (i < 0 || j < 0 || j >= ids.length) return ids; const n = [...ids]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const toggle = (id) => setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const washedCount = (plays || []).filter((p) => tagOf(p).wash?.keys?.length).length;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: "#1d2433", flex: 1 }}>📺 Stream window · {bd.first} {bd.last}</div>
        {popped ? <button type="button" style={btn(false)} onClick={closePop}>Close the pop-out</button> : <button type="button" style={btn(true)} onClick={popOut}>Pop out for OBS</button>}
        {onClose && <button type="button" style={btn(false)} onClick={onClose}>Back to the frames</button>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 12, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <canvas ref={previewRef} width={W} height={H} style={{ width: "100%", aspectRatio: "16 / 9", borderRadius: 10, background: "#000" }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: "#5b6b84" }}>
            {list.length ? `Play ${now.i + 1} of ${list.length} · ${clock(Math.max(0, now.t))}${list[now.i] ? ` · ${filmName(games[list[now.i].gameId] || { file: list[now.i].file })}` : ""}` : plays ? "Pick some plays." : "Loading his plays…"}
          </div>
          {msg && <div style={{ fontSize: 13, fontWeight: 800, color: "#1d2433" }}>{msg}</div>}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={box}>
            <div style={head}>Frame</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {segs.map((s) => <button key={s.key} type="button" style={{ ...btn(seg === s.key), padding: "4px 9px", fontSize: 11 }} onClick={() => setSeg(s.key)}>{s.label}</button>)}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 800 }}>Film</span>
              <button type="button" style={{ ...btn(washed), padding: "4px 9px", fontSize: 11 }} onClick={() => setWashed(true)}>Washed</button>
              <button type="button" style={{ ...btn(!washed), padding: "4px 9px", fontSize: 11 }} onClick={() => setWashed(false)}>Original</button>
              <span style={{ fontSize: 11, color: "#7a8597", fontWeight: 700 }}>{washedCount} of {(plays || []).length} washed</span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 800 }}><input type="checkbox" checked={marks} onChange={(e) => setMarks(e.target.checked)} /> Circles / arrows</label>
              <span style={{ fontSize: 12, fontWeight: 800, marginLeft: 8 }}>Face cam window</span>
              {[["green", "Green"], ["black", "Black"]].map(([k, l]) => <button key={k} type="button" style={{ ...btn(face === k), padding: "3px 8px", fontSize: 11 }} onClick={() => setFace(k)}>{l}</button>)}
            </div>
            {root && access !== "granted" && <button type="button" style={{ ...btn(true), justifySelf: "start" }} onClick={allow}>Allow film folder</button>}
            {!root && <div style={{ fontSize: 12, fontWeight: 700, color: "#a52a1e" }}>Set up the film library in Admin → Film Manager first.</div>}
          </div>
          <div style={box}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ ...head, flex: 1 }}>Plays · {list.length} of {(plays || []).length}</div>
              <button type="button" style={mini} onClick={() => setPicked((plays || []).map((p) => p.id))}>All</button>
              <button type="button" style={mini} onClick={() => setPicked([])}>None</button>
              {LABELS.slice(0, 2).map((l) => <button key={l} type="button" style={mini} onClick={() => setPicked((plays || []).filter((p) => tagOf(p).label === l).map((p) => p.id))}>{l}</button>)}
            </div>
            <div style={{ display: "grid", gap: 2, maxHeight: 520, overflowY: "auto" }}>
              {(plays || []).slice().sort((a, b) => { const ia = picked.indexOf(a.id); const ib = picked.indexOf(b.id); return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib); }).map((p) => {
                const tg = tagOf(p);
                const on = picked.includes(p.id);
                const g = games[p.gameId];
                return (
                  <div key={p.id} style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 6px", borderRadius: 6, background: list[now.i]?.id === p.id ? "#fff8ea" : on ? "#f4f8fd" : "transparent", borderLeft: `4px solid ${tg.label ? LABEL_COLORS[tg.label] : "#d5dce6"}` }}>
                    <input type="checkbox" checked={on} onChange={() => toggle(p.id)} />
                    <button type="button" onClick={() => on && live.current.jump?.(picked.indexOf(p.id))} style={{ flex: 1, textAlign: "left", border: "none", background: "none", cursor: on ? "pointer" : "default", padding: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: "#1d2433" }}>{filmName(g || { file: p.file })}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#7a8597" }}>{(rangeOf(p).out - rangeOf(p).in).toFixed(1)}s{tg.trim ? " (his cut)" : ""} · {tg.label || "no label"}{tg.wash?.keys?.length ? " · washed" : " · original only"}{tg.traits?.length ? ` · ${tg.traits.slice(0, 3).join(", ")}` : ""}</div>
                    </button>
                    {on && <><button type="button" style={mini} onClick={() => move(p.id, -1)}>↑</button><button type="button" style={mini} onClick={() => move(p.id, 1)}>↓</button></>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
