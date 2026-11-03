// src/components/AdminInstagram.jsx
//
// Admin → Content → Instagram: 1080×1350 posts, drawn by
// utils/instagram/posts.js (SVG — the same a server can draw; see
// scripts/renderInstagram.mjs), rendered here to PNG for upload.
//   Weekly Mock  a class's published week as a carousel: round 1 over three
//                slides (10, 10, 12 picks), then a slide a round; each slide
//                one PNG, with a caption to copy.
//   Spotlight    a prospect in two slides: the cover (his action shot, school,
//                position, height, weight; an ADVANCE SCOUTING badge for a
//                class past the next draft) and his scouting report as his
//                player page has it (utils/instagram/spotlight.js).
// Wherever a player's photo is drawn, it can be made bigger or smaller and
// moved (PhotoAdjust — or dragged on the preview).
// Any post can be saved (SaveBar) and opened again from Saved posts — see
// instagramPosts below — to edit, or published to @wedraftsite: Publish to
// Instagram sends the slides exactly as previewed (as JPEGs) to
// api/instagram.js, which posts them (server/instagram/publish.js) and
// records the post's Instagram media ID and permalink on it.
//   Player       one prospect over one of his action shots (Admin → Content
//                → Photos), with a kicker and up to three chips (his class
//                rank, his Weekly Mock pick, his grade — or typed).
// Each of the carousel's round-1 slides (picks 1–16, 17–32) features one of
// its picks over his action shot, its plain backdrop taken out
// (utils/instagram/knockout.js) so he stands on the slide's own colors.
// The font is the bundled Bebas Neue (assets/fonts, SIL OFL), embedded in the
// SVG, since an SVG drawn as an image can't reach the page's fonts. Images
// are read as data URIs for the same reason (and so the PNG exports).
import { useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, documentId, getDoc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { sanitizeImgur } from "./MarginAds";
import { headshotsFor } from "./AdminSideGraphics";
import { fetchNflBranding } from "../utils/draftProfileData";
import { getSiteSnapshot } from "../utils/siteSnapshots";
import { WEEKLY_YEARS, MAIN_WEEKLY_YEAR, loadWeeklyMockSummary, weeklyMockDate } from "../utils/weeklyMockNews";
import { NFL_TEAMS } from "../utils/coachHistory";
import {
  IG_W, IG_H, IG_FONT, IG_MAX_SLIDES, PHOTO_SCALE, mockSlides, mockInput, mockCaption, mockSlidePlan, playerPost, playerInput, playerCaption, imageUrls,
} from "../utils/instagram/posts";
import { knockOut, hasBackdrop, opaqueBounds } from "../utils/instagram/knockout";
import { spotlightSlides, spotlightInput, spotlightCaption, spotlightImageUrls, scoutingReport } from "../utils/instagram/spotlight";
import { igApi } from "../utils/instagram/api";
import BebasNeue from "../assets/fonts/BebasNeue-Regular.ttf";
import WdLogo from "../assets/Logo2.png";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const CLASS_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB"];
const field = { padding: "6px 9px", border: "1px solid #d5dce6", borderRadius: "6px", fontSize: "13px", fontWeight: 700, width: "100%", boxSizing: "border-box" };
const label = { fontSize: "10px", fontWeight: 900, color: "#7a8597", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "3px" };
const btn = (primary) => ({
  border: primary ? "none" : "1px solid #d5dce6", borderRadius: "999px", padding: "7px 16px", fontWeight: 900, fontSize: "12px",
  background: primary ? BLUE : "#fff", color: primary ? "#fff" : "#33415a", cursor: "pointer",
});
const linkBtn = { border: "none", background: "none", color: BLUE, fontWeight: 900, fontSize: "11px", cursor: "pointer", padding: "0 4px" };
const fileName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ── The drawing environment (posts.js env) ──
// Bebas Neue: registered for measuring, and as an @font-face for the SVG.
let fontReady = null;
function loadFont() {
  if (!fontReady) {
    fontReady = fetch(BebasNeue).then((r) => r.arrayBuffer()).then(async (buf) => {
      const face = new FontFace(IG_FONT, buf);
      await face.load();
      document.fonts.add(face);
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return `@font-face{font-family:"${IG_FONT}";src:url(data:font/ttf;base64,${btoa(bin)}) format("truetype");}`;
    });
    fontReady.catch(() => { fontReady = null; });
  }
  return fontReady;
}
const measureCtx = document.createElement("canvas").getContext("2d");
const widths = new Map();
function measure(text, size) {
  const key = `${size}|${text}`;
  if (!widths.has(key)) {
    measureCtx.font = `${size}px "${IG_FONT}"`;
    widths.set(key, measureCtx.measureText(String(text)).width);
  }
  return widths.get(key);
}

// An image as { href (data URI), w, h }, or null when it won't load (no CORS, gone).
const imageCache = {};
function loadDataImage(url) {
  if (!imageCache[url]) {
    const src = sanitizeImgur(url) || url;
    imageCache[url] = fetch(src, { mode: "cors" }).then((r) => (r.ok ? r.blob() : null)).then(async (blob) => {
      if (!blob || !blob.type.startsWith("image/")) return null;
      const href = await new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => resolve(null); fr.readAsDataURL(blob); });
      if (!href) return null;
      const bmp = await createImageBitmap(blob).catch(() => null);
      return { href, w: bmp?.width || 0, h: bmp?.height || 0 };
    }).catch(() => null);
  }
  return imageCache[url];
}
// An action shot at most FEATURE_MAX tall (ours are up to 7680), its plain
// backdrop taken out when it has one and cutout is on.
const FEATURE_MAX = 1400;
const featureCache = {};
function loadFeatureImage(url, cutout) {
  const key = `${cutout ? 1 : 0}|${url}`;
  if (!featureCache[key]) {
    featureCache[key] = fetch(sanitizeImgur(url) || url, { mode: "cors" }).then((r) => (r.ok ? r.blob() : null)).then(async (blob) => {
      if (!blob) return null;
      const bmp = await createImageBitmap(blob);
      const k = Math.min(1, FEATURE_MAX / bmp.height);
      const w = Math.round(bmp.width * k);
      const h = Math.round(bmp.height * k);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(bmp, 0, 0, w, h);
      if (cutout) {
        const data = ctx.getImageData(0, 0, w, h);
        if (hasBackdrop(data.data, w, h)) {
          knockOut(data.data, w, h);
          ctx.putImageData(data, 0, 0);
        }
        // Trimmed to the player (a cut-out shot's empty edges too), so he fills the frame.
        const b = opaqueBounds(data.data, w, h);
        if (b && (b.w < w || b.h < h)) {
          const t = document.createElement("canvas");
          t.width = b.w;
          t.height = b.h;
          t.getContext("2d").drawImage(c, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
          return { href: t.toDataURL("image/png"), w: b.w, h: b.h };
        }
      }
      return { href: c.toDataURL("image/png"), w, h };
    }).catch(() => null);
  }
  return featureCache[key];
}

// overrides: { [url]: a promise of its image } in place of loading it as is;
// urls: the images the post draws (posts.js imageUrls by default).
async function envFor(input, overrides = {}, urls = imageUrls(input)) {
  const fontCss = await loadFont();
  const loaded = await Promise.all(urls.map((u) => overrides[u] || loadDataImage(u)));
  const images = {};
  urls.forEach((u, i) => { if (loaded[i]) images[u] = loaded[i]; });
  return { measure, fontCss, images, missing: urls.filter((u, i) => !loaded[i]) };
}

// An SVG → an image blob at full size: a PNG to download, or a JPEG (on
// white — JPEG has no transparency) for Instagram, which takes JPEG only.
async function svgToBlob(svg, type = "image/png", quality) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const c = document.createElement("canvas");
    c.width = IG_W;
    c.height = IG_H;
    const ctx = c.getContext("2d");
    if (type === "image/jpeg") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, IG_W, IG_H);
    }
    ctx.drawImage(img, 0, 0, IG_W, IG_H);
    return await new Promise((resolve) => c.toBlob(resolve, type, quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}
const svgToPng = (svg) => svgToBlob(svg, "image/png");
// A slide as Instagram gets it: a JPEG, base64 (one API request a slide,
// kept well under the request size limit).
async function svgToJpegBase64(svg) {
  let blob = await svgToBlob(svg, "image/jpeg", 0.92);
  if (blob && blob.size > 3e6) blob = await svgToBlob(svg, "image/jpeg", 0.85);
  if (!blob) throw new Error("Couldn't make the JPEG.");
  const dataUrl = await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(blob); });
  return String(dataUrl).split(",")[1];
}
async function downloadSvg(svg, name) {
  const blob = await svgToPng(svg);
  if (!blob) throw new Error("Couldn't export the PNG.");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// A college logo by player id ({ lg, ld }) and each player's class-board row,
// from a class's position snapshots.
const classCache = {};
function loadClassRows(year) {
  if (!classCache[year]) {
    classCache[year] = Promise.all(CLASS_POSITIONS.map((pos) => getSiteSnapshot(`class_${year}_${pos}`).then((s) => (s?.rows || []).map((r) => ({ ...r, pos })))))
      .then((lists) => Object.fromEntries(lists.flat().map((r) => [r.i, r])));
  }
  return classCache[year];
}

// The round-1 slides' picks, by part ({ 1: [...], 2: [...] }) — the ones each can feature.
const roundOneParts = (week) => Object.fromEntries(mockSlidePlan(week.picks.filter((p) => p.player)).filter((sl) => sl.part).map((sl) => [sl.part, sl.picks]));
// Action shots by player id (playerPhotos action[]), 30 ids a query.
async function actionShotsFor(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await getDocs(query(collection(db, "playerPhotos"), where(documentId(), "in", ids.slice(i, i + 30)))).catch(() => null);
    (snap?.docs || []).forEach((d) => { out[d.id] = d.data().action || []; });
  }
  return out;
}
// Which side of a shot to keep: a player facing left is kept to the right.
const focusFor = (shot) => (shot?.orientation === "left" ? "right" : shot?.orientation === "right" ? "left" : "center");
const FOCUS = [["left", "Left"], ["center", "Center"], ["right", "Right"]];

// A player photo's size and place on the post: { x, y (post pixels), scale }.
const NO_ADJUST = { x: 0, y: 0, scale: 1 };
const NUDGE = 20;
function PhotoAdjust({ value, onChange }) {
  const v = { ...NO_ADJUST, ...value };
  const set = (k, n) => onChange({ ...v, [k]: n });
  const scaleTo = (n) => set("scale", Math.round(Math.min(PHOTO_SCALE[1], Math.max(PHOTO_SCALE[0], n)) * 100) / 100);
  const b = { border: "1px solid #d5dce6", background: "#fff", borderRadius: "5px", width: "24px", height: "24px", padding: 0, fontSize: "14px", fontWeight: 900, color: "#33415a", cursor: "pointer" };
  const moved = v.x || v.y || v.scale !== 1;
  return (
    <div>
      <div style={{ ...label, display: "flex", alignItems: "center" }}>
        Photo size &amp; position · or drag it on the preview
        {moved ? <button onClick={() => onChange(NO_ADJUST)} style={{ ...linkBtn, marginLeft: "auto", fontSize: "10px" }}>RESET</button> : null}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "38px 24px 1fr 24px 44px", alignItems: "center", gap: "6px" }}>
        <span style={{ fontSize: "12px", fontWeight: 800, color: "#33415a" }}>Size</span>
        <button onClick={() => scaleTo(v.scale - 0.05)} style={b} aria-label="Smaller">−</button>
        <input type="range" min={PHOTO_SCALE[0]} max={PHOTO_SCALE[1]} step={0.01} value={v.scale} onChange={(e) => scaleTo(Number(e.target.value))} />
        <button onClick={() => scaleTo(v.scale + 0.05)} style={b} aria-label="Bigger">+</button>
        <span style={{ fontSize: "11px", fontWeight: 800, color: "#5b6b84", textAlign: "right" }}>{Math.round(v.scale * 100)}%</span>
      </div>
      <div style={{ display: "flex", gap: "12px", marginTop: "6px", flexWrap: "wrap" }}>
        {[["x", "X", "Left", "Right"], ["y", "Y", "Up", "Down"]].map(([k, t, less, more]) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", fontWeight: 800, color: "#33415a" }}>
            {t}
            <button onClick={() => set(k, v[k] - NUDGE)} style={b} aria-label={less}>{k === "x" ? "←" : "↑"}</button>
            <input type="number" value={v[k]} onChange={(e) => set(k, Number(e.target.value) || 0)} style={{ ...field, width: "64px", padding: "3px 6px", fontSize: "12px" }} />
            <button onClick={() => set(k, v[k] + NUDGE)} style={b} aria-label={more}>{k === "x" ? "→" : "↓"}</button>
          </span>
        ))}
      </div>
    </div>
  );
}

// Dragging the photo on a preview: the pointer's travel in post pixels onto
// the adjust (one update a frame). A drag isn't also a click (the previews
// download on click): swallowClick says so and eats it.
function useDragAdjust(setAdjust) {
  const drag = useRef(null);
  const dragged = useRef(false);
  const pending = useRef({ x: 0, y: 0, frame: 0 });
  const flush = () => {
    const { x, y } = pending.current;
    pending.current = { x: 0, y: 0, frame: 0 };
    setAdjust((a) => ({ ...NO_ADJUST, ...a, x: Math.round((a?.x || 0) + x), y: Math.round((a?.y || 0) + y) }));
  };
  const end = () => { drag.current = null; };
  return {
    handlers: {
      onPointerDown: (e) => {
        drag.current = { x: e.clientX, y: e.clientY, k: IG_W / e.currentTarget.getBoundingClientRect().width };
        dragged.current = false;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      },
      onPointerMove: (e) => {
        const d = drag.current;
        if (!d) return;
        const dx = (e.clientX - d.x) * d.k;
        const dy = (e.clientY - d.y) * d.k;
        if (!dragged.current && Math.hypot(dx, dy) < 6) return;
        dragged.current = true;
        d.x = e.clientX;
        d.y = e.clientY;
        pending.current.x += dx;
        pending.current.y += dy;
        if (!pending.current.frame) pending.current.frame = requestAnimationFrame(flush);
      },
      onPointerUp: end,
      onPointerCancel: end,
      draggable: false,
      style: { cursor: "grab", touchAction: "none" },
    },
    swallowClick: () => {
      if (!dragged.current) return false;
      dragged.current = false;
      return true;
    },
  };
}

// Slide previews as object URLs (revoked when they change).
// A slide whose SVG didn't change keeps its URL (dragging redraws one).
function useSvgUrls(svgs) {
  const [urls, setUrls] = useState([]);
  const made = useRef(new Map());
  useEffect(() => {
    const keep = new Map();
    const next = svgs.map((s) => {
      const u = made.current.get(s) || URL.createObjectURL(new Blob([s], { type: "image/svg+xml" }));
      keep.set(s, u);
      return u;
    });
    // Old ones go a beat later, once their <img>s show the new ones.
    made.current.forEach((u, s) => { if (!keep.has(s)) setTimeout(() => URL.revokeObjectURL(u), 1500); });
    made.current = keep;
    setUrls(next);
  }, [svgs]);
  useEffect(() => () => made.current.forEach((u) => URL.revokeObjectURL(u)), []);
  return urls;
}

// ── Saved posts ──
// instagramPosts/{id} (admin only — firestore.rules):
//   { type: "mock" | "spotlight" | "player", name, status, state (the
//     maker's settings, enough to draw the post again — each maker's
//     stateNow), caption, slides (how many), thumb (slide 1 as a small JPEG
//     data URI, for the list), playerIds (the players it features — for
//     Instagram Analytics), subject ({ kind: "mock", year, weekId } |
//     { kind: "player", playerId }), createdAt, updatedAt, createdBy,
//     postedAt, ig (the server's: publishing state, Instagram's mediaId,
//     permalink, publishedAt, error — server/instagram/publish.js) }
// status: draft → ready → publishing → published | failed — the last three
// set only by the server, published only once Instagram confirms. posted:
// marked published by hand (posted outside We-Draft).
const POST_TYPES = { mock: "Weekly Mock carousel", spotlight: "Player spotlight", player: "Player post" };
const STATUS = {
  draft: ["Draft", "#8a97ab"], ready: ["Ready to Publish", "#b7791f"], publishing: ["Publishing", BLUE],
  published: ["Published", "#15803d"], failed: ["Failed", "#a52a1e"], posted: ["Published (by hand)", "#15803d"],
};
// What the page can set itself (firestore.rules agrees).
const CHOOSABLE = ["draft", "ready", "posted"];
const THUMB_W = 216;
const locked = (status) => status === "publishing" || status === "published";

// Runs the post's publish (server) until Instagram is done with it: each
// call goes up to ~4 minutes and returns pending if Instagram is still
// processing, then picks up where it was.
async function runUntilDone(postId, attempt, onPhase) {
  for (let k = 0; k < 6; k++) {
    const r = await igApi("publish", { postId, attempt });
    if (!r.pending) return r;
    onPhase?.("Instagram is still processing…");
    await new Promise((res) => setTimeout(res, 15000));
  }
  return { pending: true };
}
const igLink = { color: BLUE, fontWeight: 900, fontSize: "11px", textDecoration: "none" };

// Slide 1 as a small JPEG data URI.
async function svgThumb(svg) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const c = document.createElement("canvas");
    c.width = THUMB_W;
    c.height = Math.round((THUMB_W * IG_H) / IG_W);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.72);
  } catch {
    return "";
  } finally {
    URL.revokeObjectURL(url);
  }
}
// Firestore takes no undefined: the state as plain JSON.
const plain = (v) => JSON.parse(JSON.stringify(v ?? null));

// Save, or save as a new post: the post's name, then the buttons. A post
// opened from the list (or once saved) saves over itself. Publish to
// Instagram saves first, then sends these slides — the preview, as is.
// A post that's publishing or published is Instagram's now: only Save as
// new (a fresh draft) from here.
function SaveBar({ type, defaultName, stateNow, caption, svgs, post, setPost, onSaved, setMsg, playerIds = [], subject = null }) {
  const { user } = useAuth();
  const [name, setName] = useState(post?.name || "");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const shown = name || defaultName;
  const status = post?.status || "draft";
  const isLocked = locked(status);
  // → the saved post's id (null when it couldn't save).
  const save = async (asNew, quiet = false) => {
    if (!svgs.length) return null;
    const data = {
      type, name: shown, state: plain(stateNow()), caption, slides: svgs.length, thumb: await svgThumb(svgs[0]),
      playerIds: [...new Set(playerIds.filter(Boolean))], subject: plain(subject), updatedAt: serverTimestamp(),
    };
    let id = asNew ? null : post?.id;
    if (id) await updateDoc(doc(db, "instagramPosts", id), data);
    else id = (await addDoc(collection(db, "instagramPosts"), { ...data, status: "draft", createdAt: serverTimestamp(), createdBy: user?.uid || "" })).id;
    setPost({ id, name: shown, status: asNew ? "draft" : status, ig: asNew ? null : post?.ig || null });
    if (!quiet) setMsg(`Saved "${shown}".`);
    return id;
  };
  const saveClick = async (asNew) => {
    setBusy(true);
    try { await save(asNew); onSaved(); } catch (e) { setMsg(`Couldn't save: ${e.message}`); } finally { setBusy(false); }
  };
  // The post as the server left it.
  const reload = async (id) => {
    const d = await getDoc(doc(db, "instagramPosts", id)).catch(() => null);
    if (d?.exists()) setPost({ id, name: d.data().name, status: d.data().status, ig: d.data().ig || null });
  };
  const publish = async () => {
    const n = svgs.length;
    if (!n || busy) return;
    if (!window.confirm(`Publish this ${n > 1 ? `${n}-slide carousel` : "post"} to @wedraftsite now?\n\nIt goes live on Instagram right away, with the caption as written.`)) return;
    setBusy(true);
    let id = null;
    try {
      setPhase("Saving…");
      id = await save(false, true);
      setPhase("Starting…");
      const start = await igApi("publish-start", { postId: id, slides: n });
      let r = start;
      if (!start.alreadyPublished) {
        for (let i = 0; i < n; i++) {
          setPhase(`Sending slide ${i + 1} of ${n}…`);
          await igApi("stage", { postId: id, attempt: start.attempt, index: i, jpeg: await svgToJpegBase64(svgs[i]) });
        }
        setPhase("Publishing — Instagram is processing…");
        r = await runUntilDone(id, start.attempt, setPhase);
      }
      setMsg(r.pending ? "Instagram is still processing it. Saved posts shows it as Publishing — Resume it from there." : "Published to Instagram.");
    } catch (e) {
      setMsg(`Couldn't publish: ${e.message}`);
    } finally {
      if (id) await reload(id);
      setBusy(false);
      setPhase("");
      onSaved();
    }
  };
  return (
    <div style={{ border: "1px solid #e3e8ef", borderRadius: "8px", padding: "8px 10px", background: "#f8fafc" }}>
      <div style={{ ...label, display: "flex", alignItems: "center", gap: "6px" }}>
        {post?.id ? "Saved post" : "Save this post"}
        {post?.id && <span style={{ color: STATUS[status]?.[1] || "#8a97ab" }}>· {STATUS[status]?.[0] || status}</span>}
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName} style={field} disabled={isLocked} />
      <div style={{ display: "flex", gap: "6px", marginTop: "6px", alignItems: "center", flexWrap: "wrap" }}>
        {!isLocked && <button onClick={() => saveClick(false)} disabled={busy || !svgs.length} style={{ ...btn(true), padding: "5px 14px", opacity: busy || !svgs.length ? 0.5 : 1 }}>{post?.id ? "Save changes" : "Save"}</button>}
        {post?.id && <button onClick={() => saveClick(true)} disabled={busy || !svgs.length} style={{ ...btn(false), padding: "5px 14px" }}>Save as new</button>}
        {!isLocked && status !== "posted" && (
          <button onClick={publish} disabled={busy || !svgs.length} title="Save, then post these slides to @wedraftsite"
            style={{ ...btn(true), background: GOLD, color: "#1d2433", padding: "5px 14px", opacity: busy || !svgs.length ? 0.5 : 1 }}>
            {status === "failed" ? "Retry publishing" : "Publish to Instagram"}
          </button>
        )}
        {busy && <span style={{ fontSize: "11px", fontWeight: 800, color: BLUE }}>{phase || "Saving…"}</span>}
      </div>
      {status === "published" && (
        <div style={{ marginTop: "6px", fontSize: "11px", fontWeight: 800, color: "#15803d" }}>
          On Instagram{post.ig?.publishedAt ? ` since ${new Date(post.ig.publishedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
          {post.ig?.permalink && <> · <a href={post.ig.permalink} target="_blank" rel="noreferrer" style={igLink}>View on Instagram ↗</a></>}
        </div>
      )}
      {status === "publishing" && !busy && <div style={{ marginTop: "6px", fontSize: "11px", fontWeight: 800, color: BLUE }}>Publishing — follow it (or resume it) in Saved posts.</div>}
      {status === "failed" && post.ig?.error && <div style={{ marginTop: "6px", fontSize: "11px", fontWeight: 700, color: "#a52a1e" }}>Last attempt failed: {post.ig.error.message}</div>}
      {status === "posted" && <div style={{ marginTop: "6px", fontSize: "11px", fontWeight: 700, color: "#5b6b84" }}>Marked as posted by hand. Set it back to Draft in Saved posts to publish it from here.</div>}
    </div>
  );
}

function SavedPosts({ version, onOpen, setMsg }) {
  const [posts, setPosts] = useState(null);
  const [open, setOpen] = useState(true);
  const [mine, setMine] = useState(0);
  useEffect(() => {
    getDocs(query(collection(db, "instagramPosts"), orderBy("updatedAt", "desc"), limit(60)))
      .then((snap) => setPosts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((e) => { setPosts([]); setMsg(`Couldn't load the saved posts: ${e.message}`); });
  }, [version, mine, setMsg]);
  const setStatus = async (p, status) => {
    await updateDoc(doc(db, "instagramPosts", p.id), { status, ...(status === "posted" ? { postedAt: serverTimestamp() } : {}) });
    setMine((n) => n + 1);
  };
  // A post that went through publishing may have staged slides in Storage:
  // the server deletes it with them.
  const remove = async (p) => {
    const extra = p.status === "published" ? "\n\nIt stays on Instagram — this only deletes We-Draft's copy." : "";
    if (!window.confirm(`Delete the saved post "${p.name}"?${extra}`)) return;
    if (p.ig) await igApi("delete-post", { postId: p.id });
    else await deleteDoc(doc(db, "instagramPosts", p.id));
    setMine((n) => n + 1);
  };
  // A publish left mid-way (a closed tab, Instagram slow): pick it up.
  const [resuming, setResuming] = useState("");
  const resume = async (p) => {
    setResuming(p.id);
    try {
      const r = await runUntilDone(p.id, p.ig.attempt);
      setMsg(r.pending ? "Instagram is still processing it — try Resume again in a minute." : `Published "${p.name}" to Instagram.`);
    } catch (e) {
      setMsg(`Couldn't publish "${p.name}": ${e.message}`);
    } finally {
      setResuming("");
      setMine((n) => n + 1);
    }
  };
  const when = (ts) => ts?.toDate?.()?.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) || "";
  return (
    <div style={{ border: "1px solid #e3e8ef", borderRadius: "10px", background: "#fff" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: "flex", width: "100%", alignItems: "center", gap: "8px", border: "none", background: "none", padding: "8px 12px", cursor: "pointer" }}>
        <span style={{ ...label, marginBottom: 0 }}>Saved posts{posts ? ` · ${posts.length}` : ""}</span>
        <span style={{ marginLeft: "auto", fontSize: "11px", fontWeight: 900, color: BLUE }}>{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 12px 10px" }}>
          {!posts && <div style={{ fontSize: "12px", fontWeight: 700, color: "#8a97ab" }}>Loading…</div>}
          {posts && !posts.length && <div style={{ fontSize: "12px", fontWeight: 700, color: "#8a97ab" }}>None yet. Make a post below and save it.</div>}
          <div style={{ display: "flex", gap: "10px", overflowX: "auto", paddingBottom: "4px" }}>
            {(posts || []).map((p) => (
              <div key={p.id} style={{ flex: "0 0 150px", border: "1px solid #e3e8ef", borderRadius: "8px", overflow: "hidden", background: "#f8fafc" }}>
                <button onClick={() => onOpen(p)} title="Open to edit" style={{ display: "block", width: "100%", border: "none", padding: 0, cursor: "pointer", background: "#0b1426" }}>
                  {p.thumb ? <img src={p.thumb} alt="" style={{ width: "100%", display: "block", aspectRatio: `${IG_W} / ${IG_H}` }} /> : <div style={{ aspectRatio: `${IG_W} / ${IG_H}` }} />}
                </button>
                <div style={{ padding: "5px 7px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 900, color: "#1d2433", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.name}>{p.name}</div>
                  <div style={{ fontSize: "10px", fontWeight: 800, color: "#8a97ab" }}>{POST_TYPES[p.type] || p.type} · {p.slides || 1} slide{p.slides === 1 ? "" : "s"}</div>
                  <div style={{ fontSize: "10px", fontWeight: 700, color: "#8a97ab" }}>{when(p.updatedAt)}</div>
                  {(() => {
                    const s = p.status || "draft";
                    const [text, color] = STATUS[s] || [s, "#8a97ab"];
                    if (locked(s)) {
                      return <div style={{ fontSize: "11px", fontWeight: 900, color, marginTop: "4px" }}>{s === "publishing" && resuming === p.id ? "Publishing…" : text}</div>;
                    }
                    return (
                      <select value={s} onChange={(e) => setStatus(p, e.target.value).catch((er) => setMsg(`Couldn't update it: ${er.message}`))}
                        style={{ ...field, padding: "3px 5px", fontSize: "11px", marginTop: "4px", color }}>
                        {s === "failed" && <option value="failed" disabled>Failed</option>}
                        {CHOOSABLE.map((v) => <option key={v} value={v}>{STATUS[v][0]}</option>)}
                      </select>
                    );
                  })()}
                  {p.status === "published" && (
                    <div style={{ fontSize: "10px", fontWeight: 700, color: "#5b6b84", marginTop: "3px" }}>
                      {p.ig?.publishedAt ? new Date(p.ig.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                      {p.ig?.permalink ? <> · <a href={p.ig.permalink} target="_blank" rel="noreferrer" style={igLink}>View ↗</a></> : " · link pending"}
                    </div>
                  )}
                  {p.status === "failed" && p.ig?.error && (
                    <div title={`${p.ig.error.message}${p.ig.error.fbtraceId ? `\nInstagram trace ${p.ig.error.fbtraceId}` : ""}`}
                      style={{ fontSize: "10px", fontWeight: 700, color: "#a52a1e", marginTop: "3px", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {p.ig.error.message}
                    </div>
                  )}
                  {p.status === "publishing" && !(p.ig?.leaseUntil > Date.now()) && resuming !== p.id && (
                    <button onClick={() => resume(p)} style={{ ...linkBtn, padding: "3px 0 0" }} title="Pick up where this publish left off">Resume publishing</button>
                  )}
                  <div style={{ display: "flex", marginTop: "3px" }}>
                    <button onClick={() => onOpen(p)} style={linkBtn}>{p.status === "failed" ? "Open to retry" : "Open"}</button>
                    {p.status !== "publishing" && <button onClick={() => remove(p).catch((er) => setMsg(`Couldn't delete it: ${er.message}`))} style={{ ...linkBtn, marginLeft: "auto", color: "#a52a1e" }}>Delete</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminInstagram() {
  const [kind, setKind] = useState("mock");
  const [msg, setMsg] = useState("");
  // The post open in the maker (from Saved posts), and a count that starts
  // the maker over when one's opened or New is picked.
  const [opened, setOpened] = useState(null);
  const [run, setRun] = useState(0);
  const [version, setVersion] = useState(0);
  const start = (type, post = null) => { setKind(type); setOpened(post); setRun((n) => n + 1); setMsg(""); };
  const props = { setMsg, saved: opened && opened.type === kind ? opened : null, onSaved: () => setVersion((v) => v + 1) };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <SavedPosts version={version} onOpen={(p) => start(p.type, p)} setMsg={setMsg} />
      <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
        {Object.entries(POST_TYPES).map(([v, t]) => (
          <button key={v} onClick={() => start(v)} style={{ ...btn(kind === v), padding: "6px 14px" }}>{t}</button>
        ))}
        {opened && <span style={{ fontSize: "12px", fontWeight: 800, color: "#5b6b84", marginLeft: "8px" }}>Editing &ldquo;{opened.name}&rdquo; · <button onClick={() => start(kind)} style={linkBtn}>New post</button></span>}
      </div>
      {kind === "mock" && <MockCarousel key={run} {...props} />}
      {kind === "spotlight" && <SpotlightMaker key={run} {...props} />}
      {kind === "player" && <PlayerPostMaker key={run} {...props} />}
      {msg && <div style={{ fontSize: "12px", fontWeight: 800, color: /^Couldn't|^No /.test(msg) ? "#a52a1e" : "#15803d" }}>{msg}</div>}
    </div>
  );
}

// A post's caption: written from the post until it's edited (or opened
// saved), then the admin's — Regenerate writes it fresh.
function useCaption(saved, make) {
  const [caption, setCaption] = useState(saved?.caption || "");
  const [edited, setEdited] = useState(!!saved?.caption);
  useEffect(() => { if (!edited && make) setCaption(make); }, [make, edited]);
  return { caption, edit: (v) => { setCaption(v); setEdited(true); }, regenerate: () => setEdited(false), edited };
}

function CaptionBox({ c }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div style={{ ...label, display: "flex", alignItems: "center" }}>
        Caption
        {c.edited && <button onClick={c.regenerate} style={{ ...linkBtn, marginLeft: "auto" }} title="Write it fresh from the post">Regenerate</button>}
        <button onClick={() => navigator.clipboard?.writeText(c.caption).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })} style={{ ...linkBtn, marginLeft: c.edited ? 0 : "auto" }}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <textarea value={c.caption} onChange={(e) => c.edit(e.target.value)} rows={12} style={{ ...field, fontWeight: 600, fontFamily: "Arial, sans-serif", resize: "vertical" }} />
    </div>
  );
}

// ── Weekly Mock carousel ──
// One round-1 slide's featured pick: which (its overall; 0 for none), which
// of his action shots, the side kept in frame, and where it sits (adjust —
// dragged on the slide's preview).
function useFeature(picks, shots) {
  const [featured, setFeatured] = useState(0);
  const [shotIdx, setShotIdx] = useState(0);
  const [focus, setFocus] = useState("center");
  const [adjust, setAdjust] = useState(NO_ADJUST);
  const drag = useDragAdjust(setAdjust);
  const pick = picks.find((p) => p.overall === featured) || null;
  const list = pick ? shots[pick.player.id] || [] : [];
  const shot = list[shotIdx] || list[0] || null;
  // A new pick or photo starts where the layout puts it.
  const choose = (overall, idx = 0, action = shots, from = picks) => {
    const p = from.find((x) => x.overall === overall);
    setFeatured(p ? overall : 0);
    setShotIdx(idx);
    setFocus(focusFor(p ? (action[p.player.id] || [])[idx] : null));
    setAdjust(NO_ADJUST);
  };
  // A saved post's: the same pick and photo, framed as it was.
  const restore = (st, action, from) => {
    const p = st ? from.find((x) => x.overall === st.overall) : null;
    const idx = p ? (action[p.player.id] || []).findIndex((a) => a.url === st.photo) : -1;
    if (!p || idx < 0) { choose(0, 0, action, from); return; }
    choose(st.overall, idx, action, from);
    setFocus(st.focus || "center");
    setAdjust({ ...NO_ADJUST, ...st.adjust });
  };
  const feature = useMemo(() => (shot ? { overall: featured, photo: shot.url, focus, adjust } : null), [shot, featured, focus, adjust]);
  return {
    featured, list, shot, focus, setFocus, adjust, setAdjust, drag, feature, choose, restore,
    // To start: the first of the slide's picks with an action shot.
    start: (action, from) => choose(from.find((p) => action[p.player.id]?.length)?.overall || 0, 0, action, from),
  };
}

function FeatureBox({ title, f, picks, shots }) {
  return (
    <div style={{ border: "1px solid #e3e8ef", borderRadius: "8px", padding: "8px 10px", background: "#f8fafc" }}>
      <div style={label}>{title}</div>
      <select value={f.featured} onChange={(e) => f.choose(Number(e.target.value))} style={field}>
        <option value={0}>None (the plain list)</option>
        {picks.map((p) => {
          const n = (shots[p.player.id] || []).length;
          return <option key={p.overall} value={p.overall} disabled={!n}>{p.overall}. {p.player.First} {p.player.Last}{n ? ` · ${n} action shot${n === 1 ? "" : "s"}` : " · no action shots"}</option>;
        })}
      </select>
      {f.list.length > 0 && (
        <>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>
            {f.list.map((a, i) => (
              <button key={a.url} onClick={() => f.choose(f.featured, i)} title={`Action shot ${i + 1}${a.orientation ? ` · facing ${a.orientation}` : ""}`}
                style={{ border: `2px solid ${f.shot?.url === a.url ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", padding: "2px", cursor: "pointer", width: "60px", height: "76px" }}>
                <img src={sanitizeImgur(a.url) || a.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "5px" }} />
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
            {FOCUS.map(([v, t]) => <button key={v} onClick={() => f.setFocus(v)} style={{ ...btn(f.focus === v), padding: "4px 10px" }}>{t}</button>)}
          </div>
          <div style={{ marginTop: "8px" }}><PhotoAdjust value={f.adjust} onChange={f.setAdjust} /></div>
        </>
      )}
      {!picks.some((p) => (shots[p.player.id] || []).length) && (
        <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a97ab", marginTop: "4px" }}>None of these picks has an action shot yet (Content → Photos) — the slide is a plain list.</div>
      )}
    </div>
  );
}

function MockCarousel({ setMsg, saved, onSaved }) {
  // A saved post's settings, used up as what they need loads (its week, then its features).
  const restoring = useRef(saved?.state || null);
  const st = saved?.state || {};
  const [post, setPost] = useState(saved ? { id: saved.id, name: saved.name, status: saved.status, ig: saved.ig || null } : null);
  const [year, setYear] = useState(st.year || MAIN_WEEKLY_YEAR);
  const [weeks, setWeeks] = useState(null);
  const [weekId, setWeekId] = useState("");
  const [theme, setTheme] = useState(st.theme || "dark");
  const [kicker, setKicker] = useState(st.kicker ?? "WE-DRAFT.COM WEEKLY MOCK DRAFT");
  const [title, setTitle] = useState(st.title || "");
  const [dated, setDated] = useState("");
  const [parts, setParts] = useState(null);
  const [slides, setSlides] = useState([]);
  const [busy, setBusy] = useState("");
  // Round 1's action shots ({ [playerId]: [...] }) and each round-1 slide's featured pick.
  const [shots, setShots] = useState({});
  const [cutout, setCutout] = useState(st.cutout ?? true);
  // After round 1: the Draft Sim ad.
  const [simAd, setSimAd] = useState(st.simAd ?? true);

  // The class's published weeks, newest first.
  useEffect(() => {
    setWeeks(null);
    setWeekId("");
    getDocs(query(collection(db, "weeklyMocks"), where("year", "==", String(year)))).then((snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((w) => w.publishedAt && w.picks?.length)
        .sort((a, b) => b.publishedAt.toMillis() - a.publishedAt.toMillis());
      setWeeks(list);
      const want = restoring.current?.weekId;
      setWeekId(want && list.some((w) => w.id === want) ? want : list[0]?.id || "");
    }).catch((e) => { setWeeks([]); setMsg(`Couldn't load the weeks: ${e.message}`); });
  }, [year, setMsg]);

  const week = (weeks || []).find((w) => w.id === weekId) || null;
  const halves = useMemo(() => (week ? roundOneParts(week) : {}), [week]);
  const f1 = useFeature(halves[1] || [], shots);
  const f2 = useFeature(halves[2] || [], shots);
  const feats = { 1: f1, 2: f2 };
  useEffect(() => {
    const r = restoring.current;
    setDated(week && r && r.weekId === week.id && r.dated != null ? r.dated : week ? weeklyMockDate(week.publishedAt, { month: "short", day: "numeric", year: "numeric" }) : "");
  }, [week]);

  // The week's data: team branding, round 1's headshots, college logos.
  useEffect(() => {
    if (!week) { setParts(null); return; }
    let live = true;
    setBusy("Loading the picks…");
    const r1 = week.picks.filter((p) => p.round === 1 && p.player).map((p) => p.player.id);
    const split = roundOneParts(week);
    Promise.all([fetchNflBranding(), headshotsFor(r1), loadClassRows(week.year), actionShotsFor(r1)]).then(([branding, headshots, rows, action]) => {
      if (!live) return;
      const collegeLogos = Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, { lg: r.lg || "", ld: r.ld || "" }]));
      setParts({ branding, headshots, collegeLogos });
      setShots(action);
      // Each slide starts on the first of its picks with an action shot —
      // or, a saved post's week, as it was saved.
      const r = restoring.current;
      if (r && r.weekId === week.id) {
        f1.restore(r.features?.[1], action, split[1] || []);
        f2.restore(r.features?.[2], action, split[2] || []);
      } else {
        f1.start(action, split[1] || []);
        f2.start(action, split[2] || []);
      }
      restoring.current = null;
    }).catch((e) => setMsg(`Couldn't load the picks: ${e.message}`)).finally(() => live && setBusy(""));
    return () => { live = false; };
  }, [week, setMsg]); // eslint-disable-line react-hooks/exhaustive-deps

  const features = useMemo(() => ({ 1: f1.feature, 2: f2.feature }), [f1.feature, f2.feature]);
  const input = useMemo(() => (week && parts ? mockInput({ week, ...parts, theme, dated, brandLogo: WdLogo, kicker, title, features, simAd }) : null), [week, parts, theme, dated, kicker, title, features, simAd]);
  const cap = useCaption(saved, useMemo(() => (input ? mockCaption(input) : ""), [input]));

  // Draw the slides (images load once; redraws are quick after).
  useEffect(() => {
    if (!input) { setSlides([]); return; }
    let live = true;
    setBusy((b) => b || "Drawing…");
    const overrides = Object.fromEntries(Object.values(input.features).map((f) => [f.photo, loadFeatureImage(f.photo, cutout)]));
    envFor(input, overrides).then((env) => {
      if (!live) return;
      setSlides(mockSlides(input, env));
      setBusy("");
      if (env.missing.length) setMsg(`${env.missing.length} image${env.missing.length === 1 ? "" : "s"} couldn't load and ${env.missing.length === 1 ? "is" : "are"} left out.`);
    }).catch((e) => { setBusy(""); setMsg(`Couldn't draw: ${e.message}`); });
    return () => { live = false; };
  }, [input, cutout, setMsg]);

  const svgs = useMemo(() => slides.map((s) => s.svg), [slides]);
  const urls = useSvgUrls(svgs);
  const total = week ? mockSlidePlan(week.picks.filter((p) => p.player)).length : 0;
  const base = `wedraft-${year}-mock-${fileName(dated)}`;

  const downloadAll = async () => {
    for (let i = 0; i < slides.length; i++) {
      setBusy(`Downloading ${i + 1} / ${slides.length}…`);
      await downloadSvg(slides[i].svg, `${base}-${String(i + 1).padStart(2, "0")}-${slides[i].name}`);
      // A beat between files, so the browser takes each download.
      await new Promise((r) => setTimeout(r, 350));
    }
    setBusy("");
    setMsg(`Downloaded ${slides.length} slides.`);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: "18px", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "8px" }}>
          <div>
            <div style={label}>Class</div>
            <select value={year} onChange={(e) => setYear(e.target.value)} style={field}>{WEEKLY_YEARS.map((y) => <option key={y}>{y}</option>)}</select>
          </div>
          <div>
            <div style={label}>Week</div>
            <select value={weekId} onChange={(e) => setWeekId(e.target.value)} style={field} disabled={!weeks?.length}>
              {!weeks && <option>Loading…</option>}
              {weeks && !weeks.length && <option>None published</option>}
              {(weeks || []).map((w, i) => <option key={w.id} value={w.id}>{weeklyMockDate(w.publishedAt, { month: "short", day: "numeric", year: "numeric" })}{i === 0 ? " · latest" : ""}</option>)}
            </select>
          </div>
        </div>
        <div>
          <div style={label}>Look</div>
          <div style={{ display: "flex", gap: "4px" }}>
            {[["dark", "Dark"], ["light", "Light"]].map(([v, t]) => <button key={v} onClick={() => setTheme(v)} style={{ ...btn(theme === v), padding: "5px 12px" }}>{t}</button>)}
          </div>
        </div>
        <div><div style={label}>Kicker</div><input value={kicker} onChange={(e) => setKicker(e.target.value)} style={field} /></div>
        <div><div style={label}>Title</div><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${year} NFL MOCK DRAFT`} style={field} /></div>
        <div><div style={label}>Date</div><input value={dated} onChange={(e) => setDated(e.target.value)} style={field} /></div>
        {week && [1, 2].filter((part) => halves[part]?.length).map((part) => (
          <FeatureBox key={part} title={`Slide ${part} · picks ${halves[part][0].overall}–${halves[part][halves[part].length - 1].overall} · feature a pick`} f={feats[part]} picks={halves[part]} shots={shots} />
        ))}
        {week && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 800, color: "#33415a" }}>
            <input type="checkbox" checked={cutout} onChange={(e) => setCutout(e.target.checked)} /> Remove the action shots&apos; backdrops
          </label>
        )}
        {week && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 800, color: "#33415a" }}>
            <input type="checkbox" checked={simAd} onChange={(e) => setSimAd(e.target.checked)} /> After round 1: Draft Sim ad (&ldquo;Don&apos;t like the picks? Make your own!&rdquo;)
          </label>
        )}
        {week && (
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#5b6b84" }}>
            {total + (simAd ? 1 : 0)} slides: round 1 on two (picks 1–16, 17–32){simAd ? ", then the Draft Sim ad" : ""}{week.rounds > 1 ? `, then rounds 2–${week.rounds}, one a slide` : ""}. Picks a Draft Sim trade moved say SIM TRADE.
            {total > IG_MAX_SLIDES && <span style={{ color: "#a52a1e" }}> Instagram takes {IG_MAX_SLIDES}; the rest are left off.</span>}
          </div>
        )}
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => downloadAll().catch((e) => { setBusy(""); setMsg(`Couldn't export: ${e.message}`); })} disabled={!slides.length || !!busy} style={{ ...btn(true), opacity: slides.length && !busy ? 1 : 0.5 }}>
            Download all ({slides.length})
          </button>
          {busy && <span style={{ fontSize: "12px", fontWeight: 800, color: BLUE }}>{busy}</span>}
        </div>
        {input && (
          <SaveBar type="mock" defaultName={`${year} Mock · ${dated || "draft"}`} caption={cap.caption} svgs={svgs} post={post} setPost={setPost} onSaved={onSaved} setMsg={setMsg}
            playerIds={[1, 2].map((part) => (halves[part] || []).find((p) => p.overall === feats[part].feature?.overall)?.player?.id)} subject={{ kind: "mock", year: String(year), weekId }}
            stateNow={() => ({ year, weekId, theme, kicker, title, dated, cutout, simAd, features: { 1: f1.feature, 2: f2.feature } })} />
        )}
        {input && <CaptionBox c={cap} />}
      </div>

      <div>
        <div style={label}>Preview · {IG_W}×{IG_H} · click a slide to download it</div>
        {!slides.length && <div style={{ fontSize: "13px", fontWeight: 700, color: "#8a97ab" }}>{weeks && !weeks.length ? `No published ${year} Weekly Mock yet.` : "Loading…"}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "12px" }}>
          {slides.map((s, i) => (
            (() => {
              // A slide with a featured photo: drag it there (a click still downloads).
              const f = s.part && feats[s.part]?.feature ? feats[s.part] : null;
              return (
                <button key={s.name} onClick={() => { if (!(f && f.drag.swallowClick())) downloadSvg(s.svg, `${base}-${String(i + 1).padStart(2, "0")}-${s.name}`).catch((e) => setMsg(`Couldn't export: ${e.message}`)); }}
                  title={f ? "Drag to move his photo · click to download" : "Download this slide"} style={{ border: "1px solid #d5dce6", borderRadius: "8px", padding: 0, background: "#fff", cursor: "pointer", overflow: "hidden", textAlign: "left" }}>
                  {urls[i] && <img src={urls[i]} alt={`Slide ${i + 1}`} {...(f ? f.drag.handlers : {})} style={{ width: "100%", display: "block", aspectRatio: `${IG_W} / ${IG_H}`, ...(f ? f.drag.handlers.style : {}) }} />}
                  <div style={{ fontSize: "11px", fontWeight: 900, color: "#5b6b84", padding: "5px 8px" }}>{i + 1} · {s.ad ? "Draft Sim ad" : `${s.part ? `Round 1 · part ${s.part}` : `Round ${s.round}`} · ${s.picks} picks`}</div>
                </button>
              );
            })()
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Player post ──
function PlayerPostMaker({ setMsg, saved, onSaved }) {
  const [post, setPost] = useState(saved ? { id: saved.id, name: saved.name, status: saved.status, ig: saved.ig || null } : null);
  const [players, setPlayers] = useState(null);
  const [search, setSearch] = useState("");
  const [player, setPlayer] = useState(null);
  const [school, setSchool] = useState({});
  const [photos, setPhotos] = useState({ headshot: null, action: [] });
  const [photoUrl, setPhotoUrl] = useState("");
  const [focus, setFocus] = useState("center");
  const [focusY, setFocusY] = useState("top");
  const [adjust, setAdjust] = useState(NO_ADJUST);
  const drag = useDragAdjust(setAdjust);
  // A new photo starts where the layout puts it.
  const choosePhoto = (url) => { setPhotoUrl(url); setAdjust(NO_ADJUST); };
  const [kicker, setKicker] = useState("");
  const [chips, setChips] = useState([{ value: "", label: "" }, { value: "", label: "" }, { value: "", label: "" }]);
  // Chips offered from his data: [{ value, label }].
  const [offers, setOffers] = useState([]);
  const [svg, setSvg] = useState("");

  useEffect(() => {
    getDocs(collection(db, "players")).then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.First && p.Last).sort((a, b) => a.Last.localeCompare(b.Last) || a.First.localeCompare(b.First))))
      .catch((e) => setMsg(`Couldn't load players: ${e.message}`));
  }, [setMsg]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !players) return [];
    return players.filter((p) => `${p.First} ${p.Last}`.toLowerCase().includes(q)).slice(0, 12);
  }, [players, search]);
  // A saved post: its player, then its settings over what he loads with.
  useEffect(() => {
    if (!saved?.state?.playerId) return;
    getDoc(doc(db, "players", saved.state.playerId)).then((d) => { if (d.exists()) pick({ id: d.id, ...d.data() }, saved.state); })
      .catch((e) => setMsg(`Couldn't open it: ${e.message}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (p, restore = null) => {
    setSearch("");
    setMsg("Loading…");
    try {
      const [schoolSnap, photoSnap, rows, summary] = await Promise.all([
        getDocs(query(collection(db, "schools"), where("School", "==", p.School || ""), limit(1))),
        getDoc(doc(db, "playerPhotos", p.id)),
        loadClassRows(String(p.Eligible || "")).catch(() => ({})),
        WEEKLY_YEARS.includes(String(p.Eligible)) ? loadWeeklyMockSummary(String(p.Eligible)) : null,
      ]);
      const ph = photoSnap.exists() ? photoSnap.data() : {};
      const action = ph.action || [];
      setPlayer(p);
      setSchool(schoolSnap.docs[0]?.data() || {});
      setPhotos({ headshot: ph.headshot || null, action });
      const first = action[0] || null;
      choosePhoto(first?.url || "");
      setFocus(first?.orientation === "left" ? "right" : first?.orientation === "right" ? "left" : "center");
      setKicker(`${p.Eligible ? `${p.Eligible} ` : ""}NFL DRAFT PROSPECT`);
      // What his data offers as chips: his class rank at his position, his
      // Weekly Mock pick, his community grade.
      const row = rows[p.id];
      const mock = summary?.players?.[p.id];
      const list = [
        row?.cr && { value: `#${row.cr} ${row.pos}`, label: `${p.Eligible} CLASS` },
        mock && { value: `PICK ${mock.overall}`, label: `${(NFL_TEAMS[mock.team] || mock.team).split(" ").pop()} · WEEKLY MOCK` },
        row?.g && { value: String(row.g), label: "COMMUNITY GRADE" },
      ].filter(Boolean);
      setOffers(list);
      setChips([0, 1, 2].map((i) => list[i] || { value: "", label: "" }));
      if (restore) {
        setPhotoUrl(restore.photoUrl ?? "");
        setFocus(restore.focus || "center");
        setFocusY(restore.focusY || "top");
        setKicker(restore.kicker ?? "");
        if (Array.isArray(restore.chips)) setChips([0, 1, 2].map((i) => restore.chips[i] || { value: "", label: "" }));
        setAdjust({ ...NO_ADJUST, ...restore.adjust });
      }
      setMsg(action.length || restore?.photoUrl ? "" : "No action shots for him yet (Content → Photos) — his school's logo stands in, or paste an image link.");
    } catch (e) {
      setMsg(`Couldn't load him: ${e.message}`);
    }
  };

  const input = useMemo(() => (player ? {
    ...playerInput({ player, school, photo: photoUrl ? { url: photoUrl } : null, kicker, chips, brandLogo: WdLogo }),
    focus, focusY, adjust,
  } : null), [player, school, photoUrl, kicker, chips, focus, focusY, adjust]);
  const capText = input ? playerCaption(input) : "";
  const cap = useCaption(saved, capText);

  useEffect(() => {
    if (!input) { setSvg(""); return; }
    let live = true;
    // His photo's plain backdrop taken out, as slide 1's featured pick's.
    envFor(input, input.photo ? { [input.photo]: loadFeatureImage(input.photo, true) } : {}).then((env) => {
      if (!live) return;
      setSvg(playerPost(input, env));
      if (env.missing.includes(input.photo)) setMsg("Couldn't load that photo — it may not allow downloads (try an imgur link).");
    }).catch((e) => setMsg(`Couldn't draw: ${e.message}`));
    return () => { live = false; };
  }, [input, setMsg]);
  const svgs = useMemo(() => (svg ? [svg] : []), [svg]);
  const [url] = useSvgUrls(svgs);
  const setChip = (i, f, v) => setChips((c) => c.map((x, j) => (j === i ? { ...x, [f]: v } : x)));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 380px) 1fr", gap: "18px", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ position: "relative" }}>
          <div style={label}>Player</div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={players ? (player ? `${player.First} ${player.Last} — search another…` : "Search a prospect…") : "Loading players…"} style={field} />
          {matches.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #d5dce6", borderRadius: "6px", zIndex: 5, maxHeight: "260px", overflowY: "auto" }}>
              {matches.map((p) => (
                <button key={p.id} onClick={() => pick(p)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "#fff", padding: "6px 9px", fontSize: "13px", fontWeight: 800, cursor: "pointer" }}>
                  {p.First} {p.Last} <span style={{ color: "#8a97ab", fontWeight: 700 }}>{p.Position} · {p.School} · {p.Eligible}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {player && (
          <>
            <div>
              <div style={label}>Photo · click to use</div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {photos.action.map((a, i) => (
                  <button key={a.url} onClick={() => { choosePhoto(a.url); setFocus(a.orientation === "left" ? "right" : a.orientation === "right" ? "left" : "center"); }}
                    title={`Action shot ${i + 1}${a.orientation ? ` · facing ${a.orientation}` : ""}`}
                    style={{ border: `2px solid ${photoUrl === a.url ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", padding: "2px", cursor: "pointer", width: "72px", height: "90px" }}>
                    <img src={sanitizeImgur(a.url) || a.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "5px" }} />
                  </button>
                ))}
                {photos.headshot?.url && (
                  <button onClick={() => choosePhoto(photos.headshot.url)} title="His headshot"
                    style={{ border: `2px solid ${photoUrl === photos.headshot.url ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", padding: "2px", cursor: "pointer", width: "72px", height: "90px", fontSize: "10px", fontWeight: 900, color: "#5b6b84" }}>
                    <img src={photos.headshot.url} alt="" style={{ width: "100%", height: "70%", objectFit: "contain" }} />HEADSHOT
                  </button>
                )}
                <button onClick={() => choosePhoto("")} style={{ border: `2px solid ${!photoUrl ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", cursor: "pointer", width: "72px", height: "90px", fontSize: "10px", fontWeight: 900, color: "#5b6b84" }}>NO PHOTO</button>
              </div>
              <input value={photoUrl} onChange={(e) => choosePhoto(e.target.value)} placeholder="Or any image link…" style={{ ...field, marginTop: "6px" }} />
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <div>
                <div style={label}>Keep in frame</div>
                <div style={{ display: "flex", gap: "4px" }}>{FOCUS.map(([v, t]) => <button key={v} onClick={() => setFocus(v)} style={{ ...btn(focus === v), padding: "5px 10px" }}>{t}</button>)}</div>
              </div>
              <div>
                <div style={label}>From</div>
                <div style={{ display: "flex", gap: "4px" }}>{[["top", "Top"], ["middle", "Middle"]].map(([v, t]) => <button key={v} onClick={() => setFocusY(v)} style={{ ...btn(focusY === v), padding: "5px 10px" }}>{t}</button>)}</div>
              </div>
            </div>
            {photoUrl && <PhotoAdjust value={adjust} onChange={setAdjust} />}
            <div><div style={label}>Kicker (blank for none)</div><input value={kicker} onChange={(e) => setKicker(e.target.value)} style={field} /></div>
            <div>
              <div style={label}>Chips · up to three</div>
              {chips.map((c, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr auto", gap: "6px", marginBottom: "5px" }}>
                  <input value={c.value} onChange={(e) => setChip(i, "value", e.target.value)} placeholder="Value — #3 TE" style={field} />
                  <input value={c.label} onChange={(e) => setChip(i, "label", e.target.value)} placeholder="Label — 2029 CLASS" style={field} />
                  <button onClick={() => setChips((x) => x.map((y, j) => (j === i ? { value: "", label: "" } : y)))} style={{ ...linkBtn, color: "#8a97ab" }}>✕</button>
                </div>
              ))}
              {offers.length > 0 && (
                <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                  {offers.map((o) => (
                    <button key={o.label} onClick={() => setChips((x) => { const at = x.findIndex((y) => !y.value && !y.label); return at < 0 ? x : x.map((y, j) => (j === at ? o : y)); })}
                      style={{ border: "1px solid #d5dce6", background: "#fff", borderRadius: "999px", padding: "3px 9px", fontSize: "11px", fontWeight: 800, color: "#33415a", cursor: "pointer" }}>
                      + {o.value} <span style={{ color: "#8a97ab" }}>{o.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div><button onClick={() => downloadSvg(svg, `wedraft-${fileName(`${player.First}-${player.Last}`)}`).catch((e) => setMsg(`Couldn't export: ${e.message}`))} disabled={!svg} style={btn(true)}>Download PNG</button></div>
            <SaveBar type="player" defaultName={`Player · ${player.First} ${player.Last}`} caption={cap.caption} svgs={svgs} post={post} setPost={setPost} onSaved={onSaved} setMsg={setMsg}
              playerIds={[player.id]} subject={{ kind: "player", playerId: player.id }}
              stateNow={() => ({ playerId: player.id, photoUrl, focus, focusY, kicker, chips, adjust })} />
            <CaptionBox c={cap} />
          </>
        )}
      </div>

      <div>
        <div style={label}>Preview · {IG_W}×{IG_H}</div>
        {url
          ? <img src={url} alt="Post preview" {...(photoUrl ? drag.handlers : {})} title={photoUrl ? "Drag to move his photo" : undefined} style={{ width: "100%", maxWidth: "540px", display: "block", borderRadius: "8px", border: "1px solid #d5dce6", ...(photoUrl ? drag.handlers.style : {}) }} />
          : <div style={{ fontSize: "13px", fontWeight: 700, color: "#8a97ab" }}>Pick a player.</div>}
      </div>
    </div>
  );
}

// ── Player spotlight ──
// A class past the next draft gets the ADVANCE SCOUTING badge to start.
const isAdvance = (year) => Number(year) > Number(MAIN_WEEKLY_YEAR);

function SpotlightMaker({ setMsg, saved, onSaved }) {
  const [post, setPost] = useState(saved ? { id: saved.id, name: saved.name, status: saved.status, ig: saved.ig || null } : null);
  const [players, setPlayers] = useState(null);
  const [search, setSearch] = useState("");
  const [player, setPlayer] = useState(null);
  // What his page reads: school, photos, and the scouting report.
  const [data, setData] = useState(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [focus, setFocus] = useState("center");
  const [advance, setAdvance] = useState(false);
  // The cover's look (wash | spotlight) and its accent ("" = the school's second color).
  const [look, setLook] = useState("wash");
  // The ADVANCE SCOUTING badge's design (crest | plate).
  const [badge, setBadge] = useState("crest");
  const [accent, setAccent] = useState("");
  const [adjust, setAdjust] = useState(NO_ADJUST);
  const drag = useDragAdjust(setAdjust);
  // A new photo starts where the layout puts it.
  const choosePhoto = (url) => { setPhotoUrl(url); setAdjust(NO_ADJUST); };
  const [slides, setSlides] = useState([]);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    getDocs(collection(db, "players")).then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.First && p.Last).sort((a, b) => a.Last.localeCompare(b.Last) || a.First.localeCompare(b.First))))
      .catch((e) => setMsg(`Couldn't load players: ${e.message}`));
  }, [setMsg]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !players) return [];
    return players.filter((p) => `${p.First} ${p.Last}`.toLowerCase().includes(q)).slice(0, 12);
  }, [players, search]);

  // A saved post: its player, then its settings over what he loads with.
  useEffect(() => {
    if (!saved?.state?.playerId) return;
    getDoc(doc(db, "players", saved.state.playerId)).then((d) => { if (d.exists()) pick({ id: d.id, ...d.data() }, saved.state); })
      .catch((e) => setMsg(`Couldn't open it: ${e.message}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (p, restore = null) => {
    setSearch("");
    setBusy("Loading…");
    setMsg("");
    try {
      const [schoolSnap, photoSnap, evalSnap, classSnap, fits, branding] = await Promise.all([
        getDocs(query(collection(db, "schools"), where("School", "==", p.School || ""), limit(1))),
        getDoc(doc(db, "playerPhotos", p.id)),
        getDocs(collection(db, "players", p.id, "evaluations")),
        getSiteSnapshot(`class_${p.Eligible}_${p.Position}`),
        getSiteSnapshot("_nflFits"),
        fetchNflBranding(),
      ]);
      const ph = photoSnap.exists() ? photoSnap.data() : {};
      const report = scoutingReport({
        player: p, evaluations: evalSnap.docs.map((d) => d.data()), classSnap, nflFits: fits?.rows?.[p.id] || [], branding, teamNames: NFL_TEAMS,
      });
      const action = ph.action || [];
      setPlayer(p);
      setData({ school: schoolSnap.docs[0]?.data() || {}, action, headshot: ph.headshot?.url || "", report });
      choosePhoto(action[0]?.url || "");
      setFocus(focusFor(action[0]));
      setAdvance(isAdvance(p.Eligible));
      // A new player: his own school's accent.
      setAccent("");
      if (restore) {
        setPhotoUrl(restore.photoUrl ?? "");
        setFocus(restore.focus || "center");
        setAdvance(!!restore.advance);
        setLook(restore.look || "wash");
        setBadge(restore.badge === "plate" ? "plate" : "crest");
        setAccent(restore.accent || "");
        setAdjust({ ...NO_ADJUST, ...restore.adjust });
      }
      if (!action.length && !restore?.photoUrl) setMsg("No action shots for him yet (Content → Photos) — the cover shows his school's logo, or paste an image link.");
    } catch (e) {
      setMsg(`Couldn't load him: ${e.message}`);
    } finally {
      setBusy("");
    }
  };

  const input = useMemo(() => (player && data ? {
    ...spotlightInput({ player, school: data.school, photo: photoUrl ? { url: photoUrl } : null, headshot: data.headshot, report: data.report, advance, brandLogo: WdLogo, look, accent, badge }),
    focus, adjust,
  } : null), [player, data, photoUrl, advance, focus, adjust, look, accent, badge]);
  const cap = useCaption(saved, useMemo(() => (input ? spotlightCaption(input) : ""), [input]));

  useEffect(() => {
    if (!input) { setSlides([]); return; }
    let live = true;
    // His photo's plain backdrop taken out and trimmed, as the mock's feature.
    envFor(input, input.photo ? { [input.photo]: loadFeatureImage(input.photo, true) } : {}, spotlightImageUrls(input)).then((env) => {
      if (!live) return;
      setSlides(spotlightSlides(input, env));
      if (input.photo && !env.images[input.photo]) setMsg("Couldn't load that photo — it may not allow downloads (try an imgur link).");
    }).catch((e) => setMsg(`Couldn't draw: ${e.message}`));
    return () => { live = false; };
  }, [input, setMsg]);
  const svgs = useMemo(() => slides.map((s) => s.svg), [slides]);
  const urls = useSvgUrls(svgs);
  const base = player ? `wedraft-spotlight-${fileName(`${player.First}-${player.Last}`)}` : "";
  const downloadAll = async () => {
    for (let i = 0; i < slides.length; i++) {
      setBusy(`Downloading ${i + 1} / ${slides.length}…`);
      await downloadSvg(slides[i].svg, `${base}-${i + 1}-${slides[i].name}`);
      await new Promise((r) => setTimeout(r, 350));
    }
    setBusy("");
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: "18px", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ position: "relative" }}>
          <div style={label}>Player</div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={players ? (player ? `${player.First} ${player.Last} — search another…` : "Search a prospect…") : "Loading players…"} style={field} />
          {matches.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #d5dce6", borderRadius: "6px", zIndex: 5, maxHeight: "260px", overflowY: "auto" }}>
              {matches.map((p) => (
                <button key={p.id} onClick={() => pick(p)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "#fff", padding: "6px 9px", fontSize: "13px", fontWeight: 800, cursor: "pointer" }}>
                  {p.First} {p.Last} <span style={{ color: "#8a97ab", fontWeight: 700 }}>{p.Position} · {p.School} · {p.Eligible}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {player && data && (
          <>
            <div>
              <div style={label}>Cover photo · click to use</div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {data.action.map((a, i) => (
                  <button key={a.url} onClick={() => { choosePhoto(a.url); setFocus(focusFor(a)); }} title={`Action shot ${i + 1}${a.orientation ? ` · facing ${a.orientation}` : ""}`}
                    style={{ border: `2px solid ${photoUrl === a.url ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", padding: "2px", cursor: "pointer", width: "60px", height: "76px" }}>
                    <img src={sanitizeImgur(a.url) || a.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "5px" }} />
                  </button>
                ))}
                <button onClick={() => choosePhoto("")} style={{ border: `2px solid ${!photoUrl ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", cursor: "pointer", width: "60px", height: "76px", fontSize: "10px", fontWeight: 900, color: "#5b6b84" }}>NO PHOTO</button>
              </div>
              <input value={photoUrl} onChange={(e) => choosePhoto(e.target.value)} placeholder="Or any image link…" style={{ ...field, marginTop: "6px" }} />
            </div>
            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: "4px" }}>
                {FOCUS.map(([v, t]) => <button key={v} onClick={() => setFocus(v)} style={{ ...btn(focus === v), padding: "4px 10px" }}>{t}</button>)}
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 800, color: "#33415a" }}>
                <input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} /> Advance Scouting badge
              </label>
              {advance && (
                <div style={{ display: "flex", gap: "4px" }}>
                  {[["crest", "Crest"], ["plate", "Plate"]].map(([v, t]) => <button key={v} onClick={() => setBadge(v)} style={{ ...btn(badge === v), padding: "4px 10px" }}>{t}</button>)}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: "14px", alignItems: "flex-end", flexWrap: "wrap" }}>
              <div>
                <div style={label}>Cover background</div>
                <div style={{ display: "flex", gap: "4px" }}>
                  {[["wash", "Color wash"], ["spotlight", "Spotlight on black"]].map(([v, t]) => <button key={v} onClick={() => setLook(v)} style={{ ...btn(look === v), padding: "5px 12px" }}>{t}</button>)}
                </div>
              </div>
              <div>
                <div style={label}>Accent color</div>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <input type="color" value={accent || data.school.Color2 || "#f6a21d"} onChange={(e) => setAccent(e.target.value)} style={{ ...field, width: "46px", height: "30px", padding: "2px" }} title="The frame, the stat bars, the glow and the headshot ring" />
                  {accent
                    ? <button onClick={() => setAccent("")} style={{ ...linkBtn, fontSize: "10px" }} title="Back to the school's second color">DEFAULT</button>
                    : <span style={{ fontSize: "11px", fontWeight: 700, color: "#8a97ab" }}>School&apos;s second color</span>}
                </div>
              </div>
            </div>
            {photoUrl && <PhotoAdjust value={adjust} onChange={setAdjust} />}
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#5b6b84" }}>
              Report: {data.report.grade.avg == null ? "Watchlist" : data.report.grade.label} · {data.report.evals} evaluation{data.report.evals === 1 ? "" : "s"}
              {data.report.posRank ? ` · #${data.report.posRank} ${player.Position}` : ""}{data.report.fits.length ? ` · ${data.report.fits.length} NFL fit${data.report.fits.length === 1 ? "" : "s"}` : ""}
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button onClick={() => downloadAll().catch((e) => { setBusy(""); setMsg(`Couldn't export: ${e.message}`); })} disabled={!slides.length || !!busy} style={{ ...btn(true), opacity: slides.length && !busy ? 1 : 0.5 }}>Download both</button>
              {busy && <span style={{ fontSize: "12px", fontWeight: 800, color: BLUE }}>{busy}</span>}
            </div>
            <SaveBar type="spotlight" defaultName={`Spotlight · ${player.First} ${player.Last}`} caption={cap.caption} svgs={svgs} post={post} setPost={setPost} onSaved={onSaved} setMsg={setMsg}
              playerIds={[player.id]} subject={{ kind: "player", playerId: player.id }}
              stateNow={() => ({ playerId: player.id, photoUrl, focus, advance, adjust, look, accent, badge })} />
            <CaptionBox c={cap} />
          </>
        )}
        {busy && !data && <span style={{ fontSize: "12px", fontWeight: 800, color: BLUE }}>{busy}</span>}
      </div>
      <div>
        <div style={label}>Preview · {IG_W}×{IG_H} · click a slide to download it</div>
        {!slides.length && <div style={{ fontSize: "13px", fontWeight: 700, color: "#8a97ab" }}>Pick a player.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 420px))", gap: "12px" }}>
          {slides.map((s, i) => (
            <button key={s.name} onClick={() => { if (!(i === 0 && photoUrl && drag.swallowClick())) downloadSvg(s.svg, `${base}-${i + 1}-${s.name}`).catch((e) => setMsg(`Couldn't export: ${e.message}`)); }}
              title={i === 0 && photoUrl ? "Drag to move his photo · click to download" : "Download this slide"} style={{ border: "1px solid #d5dce6", borderRadius: "8px", padding: 0, background: "#fff", cursor: "pointer", overflow: "hidden", textAlign: "left" }}>
              {urls[i] && <img src={urls[i]} alt={`Spotlight slide ${i + 1}`} {...(i === 0 && photoUrl ? drag.handlers : {})} style={{ width: "100%", display: "block", aspectRatio: `${IG_W} / ${IG_H}`, ...(i === 0 && photoUrl ? drag.handlers.style : {}) }} />}
              <div style={{ fontSize: "11px", fontWeight: 900, color: "#5b6b84", padding: "5px 8px" }}>{i + 1} · {i ? "Scouting report" : "Cover"}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
