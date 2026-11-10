// src/components/AdminYouTubeGraphics.jsx
//
// Admin → Videos → Graphics → Thumbnail / Outline: the YouTube videos'
// thumbnails and outlines (the frame round a cut-up), by template — Ice Cold
// (utils/youtube/icecold.js) and, for thumbnails, Game Review
// (utils/youtube/gamereview.js: every element moved, sized and spaced —
// GameReviewControls.jsx). Thumbnails can be saved with their metadata and
// put on the video they went up on (ThumbLibrary.jsx), for Thumb Analytics. Pick a player and his info fills in:
// his name, position and size, his school's logo, his career table from ESPN
// (the season in progress starred, with its games from his ESPN game log)
// and his photos (playerPhotos) for the thumbnail's cutout.
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { field, label, btn, linkBtn, fileName, loadDataImage, loadFeatureImage, svgToBlob, downloadSvg, useSvgUrls, useDragAdjust, PhotoAdjust, NO_ADJUST } from "./SocialMakerKit";
import { liveSeason, outlineTable, loadCutupPlayer } from "../utils/youtube/cutupPlayer";
import { cutupText, statLineOf, TITLE_MAX } from "../utils/youtube/videoText";
import { ICE_W, ICE_H, SCRIPT, BOLD_WEIGHT, iceOutline, iceOutlineImageUrls, iceThumb, iceThumbImageUrls } from "../utils/youtube/icecold";
import { GR_W, GR_NAME_FONT, GR_HEAD_FONT, GR_DEFAULTS, gameReview, gameReviewImageUrls, gameReviewBoxes } from "../utils/youtube/gamereview";
import { localFontCss } from "../utils/youtube/localFonts";
import { thumbMeta } from "../utils/youtube/thumbStore";
import GameReviewControls, { defaultLayout } from "./GameReviewControls";
import ThumbLibrary from "./ThumbLibrary";
import WdLogo from "../assets/Logo2.png";

const TEMPLATES = { thumbnail: [{ id: "icecold", name: "Ice Cold" }, { id: "gamereview", name: "Game Review" }], outline: [{ id: "icecold", name: "Ice Cold" }] };
const hex6 = (v) => (/^#?[0-9a-f]{6}$/i.test(String(v || "").trim()) ? `#${String(v).trim().replace("#", "").toLowerCase()}` : "");
// Game Review measures in its own fonts (localFonts.js), not cached: they load after the first draw.
function grMeasure(text, size, which) {
  measureCtx.font = `${size}px "${which === "name" ? GR_NAME_FONT : GR_HEAD_FONT}", "Arial Black", sans-serif`;
  return measureCtx.measureText(String(text)).width;
}
const CTA = "Evaluate on We-Draft.com";


// Measuring in this computer's fonts (Magneto is its bold face; Franklin
// Gothic Demi, to a browser, is "Franklin Gothic" at 600).
const measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
const widths = new Map();
function measure(text, size, family) {
  const key = `${family}|${size}|${text}`;
  if (!widths.has(key)) {
    measureCtx.font = family === SCRIPT ? `bold ${size}px "Magneto"` : `${BOLD_WEIGHT} ${size}px "Franklin Gothic"`;
    widths.set(key, measureCtx.measureText(String(text)).width);
  }
  return widths.get(key);
}
// Is a font on this computer? (A missing one measures like its fallback.)
function hasFont(css) {
  const t = "Ice-Cold Cut-Ups 0123 WMB";
  return ["monospace", "serif"].some((fb) => {
    measureCtx.font = `${css}, ${fb}`;
    const a = measureCtx.measureText(t).width;
    measureCtx.font = `${css.replace(/"[^"]+"/, "zzNoSuchFont")}, ${fb}`;
    return a !== measureCtx.measureText(t).width;
  });
}




export default function AdminYouTubeGraphics({ kind }) {
  const templates = TEMPLATES[kind] || [];
  const [template, setTemplate] = useState(templates[0]?.id || "");
  const [players, setPlayers] = useState(null);
  const [search, setSearch] = useState("");
  const [p, setP] = useState(null); // { player, school, photos: { action, headshot }, espn, games }
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [env, setEnv] = useState(null);
  const [fonts, setFonts] = useState({ script: true, bold: true });
  // Both
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  // Outline
  const [sub, setSub] = useState("");
  const [cat, setCat] = useState("");
  const [avg, setAvg] = useState(false);
  const [live, setLive] = useState(liveSeason());
  const [games, setGames] = useState(0);
  const [logo, setLogo] = useState("");
  const [number, setNumber] = useState("");
  // The YouTube text: what's been typed over the generated title / description / comment.
  const [textEdits, setTextEdits] = useState({});
  const [copied, setCopied] = useState("");
  const [cta, setCta] = useState(CTA);
  const [fillWindow, setFillWindow] = useState(false);
  // Thumbnail
  const [tag, setTag] = useState(`${liveSeason() || new Date().getFullYear()} Film`);
  const [nameSize, setNameSize] = useState(1);
  const [tagSize, setTagSize] = useState(1);
  const [photo, setPhoto] = useState("");
  const [cutout, setCutout] = useState(true);
  const [iceEdge, setIceEdge] = useState(true);
  const [showLogo, setShowLogo] = useState(false);
  const [adjust, setAdjust] = useState(NO_ADJUST);
  const [photoUrl, setPhotoUrl] = useState("");
  const [seed, setSeed] = useState(11);
  const drag = useDragAdjust(setAdjust, ICE_W);
  // Game Review
  const isGr = kind === "thumbnail" && template === "gamereview";
  const [gr, setGr] = useState(() => ({ ...GR_DEFAULTS, color: "#0055a5", accent: "#f6a21d", headColor: "#ffffff", dotColor: "", layout: defaultLayout() }));
  const [grSel, setGrSel] = useState("headline");
  const [grFonts, setGrFonts] = useState({ css: "", missing: [] });
  useEffect(() => { if (isGr) localFontCss().then(setGrFonts).catch(() => {}); }, [isGr]);
  // The saved thumbnail that's open (ThumbLibrary.jsx), or null.
  const [savedId, setSavedId] = useState(null);

  useEffect(() => {
    const check = () => setFonts({ script: hasFont('bold 40px "Magneto"'), bold: hasFont(`${BOLD_WEIGHT} 40px "Franklin Gothic"`) });
    check();
    document.fonts?.ready.then(check).catch(() => {});
  }, []);
  useEffect(() => {
    getDocs(collection(db, "players")).then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((x) => x.First && x.Last).sort((a, b) => a.Last.localeCompare(b.Last) || a.First.localeCompare(b.First))))
      .catch((e) => setMsg(`Couldn't load players: ${e.message}`));
  }, []);

  // restore: opening a saved thumbnail (its own settings go on after).
  const pick = async (pl, restore = false) => {
    setSearch("");
    setBusy(true);
    setMsg("Loading…");
    try {
      const c = await loadCutupPlayer(pl);
      setP(c);
      setTextEdits({});
      setFirst(pl.First);
      setLast(pl.Last);
      setSub(c.sub);
      setCat(c.groups[0] || "");
      setLive(c.season);
      setGames(c.games);
      setLogo(c.logo);
      setNumber(c.jersey);
      setPhoto(c.photos.action[0]?.url || c.photos.headshot || "");
      setCutout(true);
      setAdjust(NO_ADJUST);
      setGr((g) => ({ ...g, color: hex6(c.school.Color1) || g.color, accent: hex6(c.school.Color2) || g.accent, dotColor: "" }));
      if (!restore) setSavedId(null);
      setMsg(c.problem || (!c.photos.action.length && kind === "thumbnail" ? "He has no action shots in Photos, so this is his headshot. Add one in Content → Photos, or paste or upload a cutout below." : ""));
    } catch (e) {
      setMsg(`Couldn't load him: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const table = useMemo(() => (p?.espn && cat ? outlineTable(p.espn, cat, p.player.Position, { avg, live }) : null), [p, cat, avg, live]);
  // The video's season: the one in progress, else his latest.
  const videoSeason = live || table?.rows?.[table.rows.length - 1]?.year || "";
  const generated = useMemo(() => (kind === "outline" && p ? cutupText({
    first, last, position: p.player.Position, school: p.player.School, mascot: p.school.Mascot, eligible: p.player.Eligible, slug: p.player.Slug,
    season: videoSeason, statLine: statLineOf(table, videoSeason), games: live && live === videoSeason ? Number(games) || 0 : 0,
  }) : null), [kind, p, first, last, videoSeason, table, live, games]);
  const ytText = generated ? Object.fromEntries(Object.keys(generated).map((k) => [k, textEdits[k] ?? generated[k]])) : null;
  const copy = (k) => navigator.clipboard.writeText(ytText[k]).then(() => { setCopied(k); setTimeout(() => setCopied(""), 1500); }).catch(() => setMsg("Couldn't copy — select the text and copy it."));
  const input = useMemo(() => (kind === "outline"
    ? { first, last, sub, table, games: Number(games) || 0, number, logo, cta, fillWindow, seed }
    : isGr
      ? { name: `${first} ${last}`.trim(), headline: gr.headline, color: gr.color, accent: gr.accent, headColor: gr.headColor, dotColor: gr.dotColor, dots: gr.dots, photo, adjust, brandLogo: WdLogo, logoWhite: gr.logoWhite, photoBehind: gr.photoBehind, layout: gr.layout }
      : { name: `${first} ${last}`.trim(), tag, nameSize, tagSize, photo, adjust, logo, showLogo, iceEdge, seed }), [kind, isGr, gr, first, last, sub, table, games, number, logo, cta, fillWindow, tag, nameSize, tagSize, photo, adjust, showLogo, iceEdge, seed]);

  // The images: the photo cut out (or as it is), the rest as they are.
  const urls = useMemo(() => (kind === "outline" ? iceOutlineImageUrls(input) : isGr ? gameReviewImageUrls(input) : iceThumbImageUrls(input)), [kind, isGr, input]);
  const urlKey = urls.join("|");
  useEffect(() => {
    let live2 = true;
    Promise.all(urls.map((u) => (kind === "thumbnail" && u === photo ? loadFeatureImage(u, cutout) : loadDataImage(u)))).then((loaded) => {
      if (!live2) return;
      const images = {};
      urls.forEach((u, i) => { if (loaded[i]) images[u] = loaded[i]; });
      setEnv({ measure: isGr ? grMeasure : measure, fontCss: isGr ? grFonts.css : "", images, missing: urls.filter((u, i) => !loaded[i]), gr: isGr });
    });
    return () => { live2 = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey, cutout, kind, isGr, grFonts.css]);
  // Game Review: the export, and the preview with the picked element outlined.
  const svgs = useMemo(() => {
    if (!env) return [];
    if (isGr) return env.gr ? [gameReview(input, env), gameReview({ ...input, selected: grSel }, env)] : [];
    return !env.gr && template === "icecold" ? [kind === "outline" ? iceOutline(input, env) : iceThumb(input, env)] : [];
  }, [env, input, kind, template, isGr, grSel]);
  const svgUrls = useSvgUrls(svgs);
  const url = svgUrls[isGr ? 1 : 0];

  // Game Review on the preview: click a word, the logo or him, and drag.
  const previewRef = useRef(null);
  const grDrag = useRef(null);
  const grPoint = (e) => {
    const r = previewRef.current.getBoundingClientRect();
    const k = GR_W / r.width;
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
  };
  const grHandlers = {
    ref: previewRef,
    onPointerDown: (e) => {
      if (!env?.gr) return;
      const [x, y] = grPoint(e);
      const boxes = gameReviewBoxes(input, env);
      const inBox = (b) => b && b[2] > 0 && x >= b[0] - 12 && x <= b[0] + b[2] + 12 && y >= b[1] - 12 && y <= b[1] + b[3] + 12;
      const hit = ["name", "headline", "logo", "photo"].find((k) => inBox(boxes[k]));
      if (!hit) return;
      setGrSel(hit);
      grDrag.current = { k: hit, x, y, start: hit === "photo" ? { ...adjust } : { ...(gr.layout?.[hit] || {}) } };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e) => {
      const d = grDrag.current;
      if (!d) return;
      const [x, y] = grPoint(e);
      const dx = Math.round(x - d.x);
      const dy = Math.round(y - d.y);
      if (d.k === "photo") setAdjust({ ...d.start, x: (Number(d.start.x) || 0) + dx, y: (Number(d.start.y) || 0) + dy });
      else setGr((g) => ({ ...g, layout: { ...g.layout, [d.k]: { ...d.start, dx: (Number(d.start.dx) || 0) + dx, dy: (Number(d.start.dy) || 0) + dy } } }));
    },
    onPointerUp: () => { grDrag.current = null; },
    onPointerCancel: () => { grDrag.current = null; },
    style: { cursor: "move", touchAction: "none" },
  };

  // What's saved with a thumbnail (ThumbLibrary.jsx): its settings, and the metadata the analytics group by.
  const templateName = (TEMPLATES[kind] || []).find((t) => t.id === template)?.name || template;
  const photoKind = !photo ? "none" : p?.photos.action.some((a) => a.url === photo) ? "action" : photo === p?.photos.headshot ? "headshot" : photo.startsWith("data:") ? "upload" : "link";
  const thumbCurrent = kind !== "thumbnail" ? null : {
    template, templateName, label: `${`${first} ${last}`.trim() || "Thumbnail"} · ${templateName}`,
    playerId: p?.player.id || "", playerName: `${first} ${last}`.trim(), school: p?.player.School || "", position: p?.player.Position || "", eligible: String(p?.player.Eligible || ""),
    headline: isGr ? gr.headline : tag,
    // An uploaded photo isn't kept (too big for the record): upload it again to edit.
    design: isGr
      ? { first, last, photo: photo.startsWith("data:") ? "" : photo, cutout, adjust, gr }
      : { first, last, photo: photo.startsWith("data:") ? "" : photo, cutout, adjust, tag, nameSize, tagSize, iceEdge, showLogo, seed },
    meta: thumbMeta({ template, headline: isGr ? gr.headline : tag, name: `${first} ${last}`, photoKind, colors: isGr ? { color: gr.color, accent: gr.accent } : {}, photoBehind: isGr && gr.photoBehind }),
  };
  const openSaved = async (t) => {
    const d = t.design || {};
    setMsg("Opening…");
    try {
      setTemplate(t.template);
      if (t.playerId) {
        const snap = await getDoc(doc(db, "players", t.playerId));
        if (snap.exists()) await pick({ id: snap.id, ...snap.data() }, true);
      }
      setFirst(d.first || "");
      setLast(d.last || "");
      if (d.photo) setPhoto(d.photo);
      setCutout(d.cutout !== false);
      setAdjust(d.adjust || NO_ADJUST);
      if (t.template === "gamereview" && d.gr) setGr({ ...GR_DEFAULTS, ...d.gr });
      if (t.template === "icecold") {
        if (d.tag != null) setTag(d.tag);
        setNameSize(d.nameSize || 1);
        setTagSize(d.tagSize || 1);
        setIceEdge(d.iceEdge !== false);
        setShowLogo(!!d.showLogo);
        if (d.seed) setSeed(d.seed);
      }
      setSavedId(t.id);
      setMsg(d.photo || !t.design ? "" : "Its photo was an upload, which isn't kept: upload it again.");
    } catch (e) {
      setMsg(`Couldn't open it: ${e.message}`);
    }
  };

  const base = fileName(`${template}-${kind}-${first}-${last}`) || `${template}-${kind}`;
  const exportPng = () => downloadSvg(svgs[0], base, ICE_W, ICE_H).catch((e) => setMsg(`Couldn't export: ${e.message}`));
  // YouTube's thumbnail: 1280×720 JPEG, under its 2 MB cap.
  const exportJpg = async () => {
    try {
      let blob = await svgToBlob(svgs[0], "image/jpeg", 0.92, 1280, 720);
      if (blob && blob.size > 2e6) blob = await svgToBlob(svgs[0], "image/jpeg", 0.8, 1280, 720);
      if (!blob) throw new Error("no image");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${base}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { setMsg(`Couldn't export: ${e.message}`); }
  };
  const upload = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => { setPhoto(String(fr.result)); setAdjust(NO_ADJUST); };
    fr.readAsDataURL(f);
    e.target.value = "";
  };

  const q = search.trim().toLowerCase();
  const hits = q && players ? players.filter((x) => `${x.First} ${x.Last}`.toLowerCase().includes(q)).slice(0, 10) : [];
  const shots = p ? [...p.photos.action.map((a) => a.url), p.photos.headshot].filter(Boolean) : [];
  const box = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: "10px", padding: "12px", display: "flex", flexDirection: "column", gap: "10px" };
  const check = (v, set, text) => (
    <label style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "12px", fontWeight: 800, color: "#33415a" }}>
      <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} /> {text}
    </label>
  );

  return (
    <div style={{ display: "flex", gap: "20px", alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: "0 0 360px", minWidth: "300px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={box}>
          <div>
            <div style={label}>Template</div>
            <select style={field} value={template} onChange={(e) => setTemplate(e.target.value)}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div style={{ position: "relative" }}>
            <div style={label}>Player</div>
            <input style={field} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={players ? "Search prospects…" : "Loading players…"} />
            {hits.length > 0 && (
              <div style={{ position: "absolute", zIndex: 5, left: 0, right: 0, background: "#fff", border: "1px solid #d5dce6", borderRadius: "6px", boxShadow: "0 6px 18px rgba(0,0,0,.12)" }}>
                {hits.map((x) => (
                  <button key={x.id} onClick={() => pick(x)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", padding: "6px 10px", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
                    {x.First} {x.Last} <span style={{ color: "#7a8597" }}>· {x.Position} · {x.School} · {x.Eligible}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{ flex: 1 }}><div style={label}>First</div><input style={field} value={first} onChange={(e) => setFirst(e.target.value)} /></div>
            <div style={{ flex: 1 }}><div style={label}>Last</div><input style={field} value={last} onChange={(e) => setLast(e.target.value)} /></div>
          </div>

          {kind === "outline" && (
            <>
              <div><div style={label}>Under his name</div><input style={field} value={sub} onChange={(e) => setSub(e.target.value)} placeholder={'WR | 6\'1" 195'} /></div>
              {p?.groups?.length > 1 && (
                <div>
                  <div style={label}>Stats table</div>
                  <select style={field} value={cat} onChange={(e) => setCat(e.target.value)}>
                    {p.groups.map((g) => <option key={g} value={g}>{g[0].toUpperCase() + g.slice(1)}</option>)}
                  </select>
                </div>
              )}
              {table && check(avg, setAvg, "Show the AVG column")}
              {table && (
                <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <div style={label}>Season in progress (starred)</div>
                    <select style={field} value={live} onChange={(e) => setLive(e.target.value)}>
                      <option value="">None</option>
                      {table.rows.map((r) => <option key={r.year} value={r.year}>{r.year}</option>)}
                    </select>
                  </div>
                  {live && <div style={{ width: "90px" }}><div style={label}>Games</div><input type="number" min={0} style={field} value={games} onChange={(e) => setGames(e.target.value)} /></div>}
                </div>
              )}
              <div><div style={label}>Jersey number (blank = his school&apos;s logo)</div><input style={{ ...field, width: "100px" }} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="18" /></div>
              <div><div style={label}>Bottom line</div><input style={field} value={cta} onChange={(e) => setCta(e.target.value)} /></div>
              {check(fillWindow, setFillWindow, "Fill the video window (off: transparent, for Premiere)")}
            </>
          )}

          {kind === "thumbnail" && (
            <>
              {!isGr && <div><div style={label}>Tag under his name</div><input style={field} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="2026 Film" /></div>}
              {!isGr && [["Name size", nameSize, setNameSize], ["Tag size", tagSize, setTagSize]].map(([t, v, set]) => (
                <div key={t}>
                  <div style={{ ...label, display: "flex" }}>{t}<span style={{ marginLeft: "auto" }}>{Math.round(v * 100)}%</span>{v !== 1 && <button style={{ ...linkBtn, fontSize: "10px" }} onClick={() => set(1)}>RESET</button>}</div>
                  <input type="range" min={0.4} max={2} step={0.05} value={v} onChange={(e) => set(Number(e.target.value))} style={{ width: "100%" }} />
                </div>
              ))}
              <div>
                <div style={label}>Photo</div>
                {shots.length > 0 && (
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "6px" }}>
                    {shots.map((s) => (
                      <button key={s} onClick={() => { setPhoto(s); setAdjust(NO_ADJUST); setCutout(s !== p.photos.headshot || cutout); }} style={{ border: `2px solid ${photo === s ? "#0055a5" : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", padding: "2px", cursor: "pointer", width: "54px", height: "68px" }}>
                        <img src={s} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "5px" }} />
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: "6px" }}>
                  <input style={field} value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="Paste an image URL" />
                  <button style={btn(false)} onClick={() => { if (photoUrl.trim()) { setPhoto(photoUrl.trim()); setAdjust(NO_ADJUST); setPhotoUrl(""); } }}>Use</button>
                </div>
                <label style={{ ...linkBtn, display: "inline-block", marginTop: "6px", cursor: "pointer" }}>
                  Upload a file…<input type="file" accept="image/*" onChange={upload} style={{ display: "none" }} />
                </label>
              </div>
              {check(cutout, setCutout, "Remove the photo's backdrop")}
              {!isGr && check(iceEdge, setIceEdge, "Ice edge round him")}
              {!isGr && check(showLogo, setShowLogo, "His school's logo, faint behind him")}
              {!isGr && <PhotoAdjust value={adjust} onChange={setAdjust} />}
              {isGr && (
                <GameReviewControls gr={gr} setGr={setGr} selected={grSel} setSelected={setGrSel} adjust={adjust} setAdjust={setAdjust}
                  school={{ color: hex6(p?.school?.Color1) || gr.color, accent: hex6(p?.school?.Color2) || gr.accent }} fonts={grFonts} setFonts={setGrFonts} setMsg={setMsg} />
              )}
            </>
          )}
          {!isGr && <button style={{ ...linkBtn, alignSelf: "flex-start" }} onClick={() => setSeed((s) => s + 1)}>❄ Shake the snow</button>}
        </div>
      </div>

      <div style={{ flex: "1 1 560px", minWidth: "320px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button style={btn(true)} disabled={!url || busy} onClick={exportPng}>Download PNG (1920×1080)</button>
          {kind === "thumbnail" && <button style={btn(false)} disabled={!url || busy} onClick={exportJpg}>Download YouTube JPG (1280×720)</button>}
        </div>
        <div
          {...(isGr ? grHandlers : kind === "thumbnail" ? drag.handlers : {})}
          data-gr-preview={isGr ? "" : undefined}
          style={{ ...(isGr ? grHandlers.style : kind === "thumbnail" ? drag.handlers.style : {}), background: "repeating-conic-gradient(#d9dee6 0% 25%, #fff 0% 50%) 50% / 24px 24px", borderRadius: "10px", border: "1px solid #e3e8ef", overflow: "hidden" }}
        >
          {url ? <img src={url} alt="Preview" draggable={false} style={{ width: "100%", display: "block", pointerEvents: "none" }} /> : <div style={{ aspectRatio: "16 / 9" }} />}
        </div>
        {!isGr && (!fonts.script || !fonts.bold) && (
          <div style={{ fontSize: "12px", fontWeight: 800, color: "#c0392b" }}>
            {[!fonts.script && "Magneto", !fonts.bold && "Franklin Gothic Demi"].filter(Boolean).join(" and ")} isn&apos;t on this computer, so a stand-in font is used. Both ship with Microsoft Office.
          </div>
        )}
        {env?.missing?.length > 0 && <div style={{ fontSize: "12px", fontWeight: 800, color: "#b9770e" }}>{env.missing.length} image{env.missing.length === 1 ? "" : "s"} wouldn&apos;t load (the host blocks it).</div>}
        {msg && <div data-gfx-msg style={{ fontSize: "12px", fontWeight: 800, color: "#33415a" }}>{msg}</div>}
        {kind === "thumbnail" && <ThumbLibrary current={thumbCurrent} svg={svgs[0] || ""} savedId={savedId} setSavedId={setSavedId} onOpen={openSaved} setMsg={setMsg} />}
        {ytText && (
          <div style={{ background: "#fff", border: "1px solid #e3e8ef", borderRadius: "10px", padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ ...label, display: "flex", alignItems: "center", marginBottom: 0 }}>
              YouTube text
              {Object.keys(textEdits).length > 0 && <button style={{ ...linkBtn, marginLeft: "auto" }} onClick={() => setTextEdits({})}>Regenerate</button>}
            </div>
            {[["title", "Title", 1], ["description", "Description", 12], ["comment", "Pinned comment", 2]].map(([k, t, rows]) => (
              <div key={k}>
                <div style={{ ...label, display: "flex", alignItems: "center" }}>
                  {t}
                  {k === "title" && <span style={{ marginLeft: "8px", color: ytText.title.length > TITLE_MAX ? "#c0392b" : "#7a8597" }}>{ytText.title.length}/{TITLE_MAX}</span>}
                  <button style={{ ...linkBtn, marginLeft: "auto" }} onClick={() => copy(k)}>{copied === k ? "Copied ✓" : "Copy"}</button>
                </div>
                {rows === 1
                  ? <input style={field} value={ytText[k]} onChange={(e) => setTextEdits((m) => ({ ...m, [k]: e.target.value }))} />
                  : <textarea rows={rows} style={{ ...field, fontFamily: "inherit", fontWeight: 600, lineHeight: 1.4, resize: "vertical" }} value={ytText[k]} onChange={(e) => setTextEdits((m) => ({ ...m, [k]: e.target.value }))} />}
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: "12px", color: "#7a8597", fontWeight: 700 }}>
          {kind === "outline"
            ? "The video window exports transparent: lay the PNG over the cut-up in Premiere. The starred season counts the games in his ESPN game log; change the number if it's off."
            : isGr
              ? "Click a word, the logo or him on the preview and drag to move it; size and spacing are on the left. The JPG is the size YouTube wants (under 2 MB)."
              : "Drag him on the preview to move him. The JPG is the size YouTube wants (under 2 MB)."}
        </div>
      </div>
    </div>
  );
}
