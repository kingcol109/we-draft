// src/components/SocialMakerKit.jsx
//
// What the social post makers share — Instagram's (AdminInstagram.jsx) and
// X's (AdminX.jsx): the drawing environment for the pure SVG modules
// (utils/instagram/posts.js, utils/x/graphics.js), SVG → image, the photo
// controls and the schedule picker. Nothing here knows a platform.
import { useEffect, useRef, useState } from "react";
import { sanitizeImgur } from "./MarginAds";
import { IG_W, IG_H, IG_FONT, PHOTO_SCALE, imageUrls } from "../utils/instagram/posts";
import { knockOut, hasBackdrop, opaqueBounds } from "../utils/instagram/knockout";
import { fmtET } from "../utils/contentCalendar/platforms";
import BebasNeue from "../assets/fonts/BebasNeue-Regular.ttf";

export const BLUE = "#0055a5";
export const GOLD = "#f6a21d";
export const field = { padding: "6px 9px", border: "1px solid #d5dce6", borderRadius: "6px", fontSize: "13px", fontWeight: 700, width: "100%", boxSizing: "border-box" };
export const label = { fontSize: "10px", fontWeight: 900, color: "#7a8597", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "3px" };
export const btn = (primary) => ({
  border: primary ? "none" : "1px solid #d5dce6", borderRadius: "999px", padding: "7px 16px", fontWeight: 900, fontSize: "12px",
  background: primary ? BLUE : "#fff", color: primary ? "#fff" : "#33415a", cursor: "pointer",
});
export const linkBtn = { border: "none", background: "none", color: BLUE, fontWeight: 900, fontSize: "11px", cursor: "pointer", padding: "0 4px" };
export const fileName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export { fmtET };

// ── The drawing environment (posts.js env) ──
// Bebas Neue: registered for measuring, and as an @font-face for the SVG.
let fontReady = null;
export function loadFont() {
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
export function measure(text, size) {
  const key = `${size}|${text}`;
  if (!widths.has(key)) {
    measureCtx.font = `${size}px "${IG_FONT}"`;
    widths.set(key, measureCtx.measureText(String(text)).width);
  }
  return widths.get(key);
}

// An image as { href (data URI), w, h }, or null when it won't load (no CORS, gone).
const imageCache = {};
export function loadDataImage(url) {
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
export function loadFeatureImage(url, cutout) {
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
export async function envFor(input, overrides = {}, urls = imageUrls(input)) {
  const fontCss = await loadFont();
  const loaded = await Promise.all(urls.map((u) => overrides[u] || loadDataImage(u)));
  const images = {};
  urls.forEach((u, i) => { if (loaded[i]) images[u] = loaded[i]; });
  return { measure, fontCss, images, missing: urls.filter((u, i) => !loaded[i]) };
}

// An SVG → an image blob at full size: a PNG to download, or a JPEG (on
// white — JPEG has no transparency) for Instagram, which takes JPEG only.
export async function svgToBlob(svg, type = "image/png", quality, w = IG_W, h = IG_H) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (type === "image/jpeg") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise((resolve) => c.toBlob(resolve, type, quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}
export const svgToPng = (svg) => svgToBlob(svg, "image/png");
// A slide as Instagram gets it: a JPEG, base64 (one API request a slide,
// kept well under the request size limit).
export async function svgToJpegBase64(svg) {
  let blob = await svgToBlob(svg, "image/jpeg", 0.92);
  if (blob && blob.size > 3e6) blob = await svgToBlob(svg, "image/jpeg", 0.85);
  if (!blob) throw new Error("Couldn't make the JPEG.");
  const dataUrl = await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(blob); });
  return String(dataUrl).split(",")[1];
}
export async function downloadSvg(svg, name, w = IG_W, h = IG_H) {
  const blob = await svgToBlob(svg, "image/png", undefined, w, h);
  if (!blob) throw new Error("Couldn't export the PNG.");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Which side of a shot to keep: a player facing left is kept to the right.
export const focusFor = (shot) => (shot?.orientation === "left" ? "right" : shot?.orientation === "right" ? "left" : "center");
export const FOCUS = [["left", "Left"], ["center", "Center"], ["right", "Right"]];

// A player photo's size and place on the post: { x, y (post pixels), scale }.
export const NO_ADJUST = { x: 0, y: 0, scale: 1 };
const NUDGE = 20;
export function PhotoAdjust({ value, onChange }) {
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
export function useDragAdjust(setAdjust, canvasW = IG_W) {
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
        drag.current = { x: e.clientX, y: e.clientY, k: canvasW / e.currentTarget.getBoundingClientRect().width };
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
export function useSvgUrls(svgs) {
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


// ms ↔ a datetime-local input's value (the browser's own time zone).
export const toLocalInput = (ms) => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
export const fromLocalInput = (v) => (v ? new Date(v).getTime() : NaN);
// The default pick: the next whole hour at least an hour away.
export const nextHour = () => { const d = new Date(Date.now() + 3600e3); d.setMinutes(0, 0, 0); return d.getTime() < Date.now() + 3600e3 ? d.getTime() + 3600e3 : d.getTime(); };
export function WhenPicker({ value, onChange }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
      <input type="datetime-local" value={value} min={toLocalInput(Date.now() + 5 * 60e3)} onChange={(e) => onChange(e.target.value)} style={{ ...field, width: "auto", padding: "4px 7px", fontSize: "12px" }} />
      {value && <span style={{ fontSize: "11px", fontWeight: 800, color: "#5b6b84" }}>{fmtET(fromLocalInput(value))}</span>}
    </span>
  );
}

const loadImg = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("the browser can't read that image.")); i.src = src; });
// An image → a JPEG data URI of at most maxChars: smaller and softer until it fits.
export async function shrinkToFit(src, maxChars, maxEdge = 2048) {
  const img = await loadImg(src);
  let edge = Math.min(maxEdge, Math.max(img.width, img.height));
  for (const quality of [0.9, 0.82, 0.72, 0.6, 0.5]) {
    const k = edge / Math.max(img.width, img.height);
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const out = c.toDataURL("image/jpeg", quality);
    if (out.length <= maxChars) return { data: out, w: c.width, h: c.height };
    edge = Math.round(edge * 0.85);
  }
  throw new Error("that image is too big even when shrunk.");
}
// A small JPEG data URI, "" when the image can't be read (a link without CORS).
export async function thumbOf(src, width = 240) {
  try {
    const img = await loadImg(src);
    const c = document.createElement("canvas");
    c.width = width;
    c.height = Math.round((width * img.height) / img.width);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.7);
  } catch {
    return "";
  }
}
