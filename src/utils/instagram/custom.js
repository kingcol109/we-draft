// src/utils/instagram/custom.js
//
// "Create a post" (Admin → Content → Instagram): a blank 1080×1350 canvas the
// admin builds by hand, one or more slides, each a background and a stack of
// layers, last on top. Drawn like posts.js — plain data in, SVG out.
//
// A layer: { id, kind, x, y (its top-left, in post pixels), ... }
//   player  { url, w, cutout, name, playerId, opacity }  an action shot or headshot
//   logo    { url, w, name, opacity }                    a school's or NFL team's
//   brand   { w, opacity }                               the We-Draft logo (the
//           build's own file, so it's never saved as a link that goes stale)
//   image   { url, w, cutout, opacity }                  any image link
//   text    { value, size, color, align, spacing }       Bebas Neue, capitals; \n for lines
//   shape   { w, h, color, opacity, radius }             a rectangle
// A slide: { bg: { color, color2 (a gradient to it, or ""), image }, layers }.
import { kit, IG_W, IG_H } from "./posts.js";

const { NAVY, hex, up, r1, widthOf, text, image, svgDoc, footer, themeOf } = kit;
export { IG_W as CUSTOM_W, IG_H as CUSTOM_H };

const LINE_HEIGHT = 0.98;
export const LAYER_LABELS = { player: "Player", logo: "Logo", brand: "We-Draft logo", image: "Image", text: "Text", shape: "Shape" };
export const blankSlide = () => ({ bg: { color: NAVY, color2: "", image: "" }, layers: [] });
export const hasPicture = (l) => l.kind === "player" || l.kind === "logo" || l.kind === "image" || l.kind === "brand";

const lid = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// A new layer, about where it's likely wanted.
export function newLayer(kind, props = {}) {
  const base = { id: lid(), kind, opacity: 1 };
  if (kind === "text") return { ...base, x: 80, y: 120, value: "YOUR TEXT", size: 120, color: "#ffffff", align: "left", spacing: 2, ...props };
  if (kind === "shape") return { ...base, x: 60, y: 900, w: 960, h: 200, color: "#f6a21d", radius: 0, ...props };
  if (kind === "player") return { ...base, x: 190, y: 250, w: 700, cutout: true, ...props };
  if (kind === "brand") return { ...base, x: 60, y: 60, w: 420, ...props };
  if (kind === "image") return { ...base, x: 240, y: 340, w: 600, cutout: false, ...props };
  return { ...base, x: 390, y: 80, w: 300, ...props };
}

const urlOf = (l, brandLogo) => (l.kind === "brand" ? brandLogo : l.url || "");
const linesOf = (l) => String(l.value ?? "").split("\n").map((t) => up(t));

// Where a layer sits on the post → { x, y, w, h }: what the preview's handles
// are drawn around. A picture's height comes from the image itself.
export function layerBox(l, env, brandLogo = "") {
  if (l.kind === "text") {
    const lines = linesOf(l);
    const w = Math.max(40, ...lines.map((t) => widthOf(env, t, l.size, l.spacing || 0)));
    return { x: l.x, y: l.y, w, h: Math.max(1, lines.length) * l.size * LINE_HEIGHT };
  }
  if (l.kind === "shape") return { x: l.x, y: l.y, w: l.w, h: l.h };
  const im = env.images?.[urlOf(l, brandLogo)];
  const ratio = im?.w && im?.h ? im.h / im.w : 1;
  return { x: l.x, y: l.y, w: l.w, h: l.w * ratio };
}

function drawLayer(l, env, brandLogo) {
  const box = layerBox(l, env, brandLogo);
  if (l.kind === "text") {
    const anchor = l.align === "center" ? "middle" : l.align === "right" ? "end" : "start";
    const x = l.align === "center" ? box.x + box.w / 2 : l.align === "right" ? box.x + box.w : box.x;
    return linesOf(l).map((t, i) => (t ? text(x, box.y + l.size * 0.8 + i * l.size * LINE_HEIGHT, t, l.size, hex(l.color) || "#ffffff", { anchor, spacing: l.spacing || 0 }) : "")).join("");
  }
  const opacity = l.opacity ?? 1;
  if (l.kind === "shape") {
    return `<rect x="${r1(box.x)}" y="${r1(box.y)}" width="${r1(box.w)}" height="${r1(box.h)}" rx="${l.radius || 0}" fill="${hex(l.color) || "#ffffff"}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ""}/>`;
  }
  return image(env, urlOf(l, brandLogo), box.x, box.y, box.w, box.h, "xMidYMid meet", opacity);
}

function slideSvg(env, input, slide, i, total) {
  const bg = slide.bg || {};
  const c1 = hex(bg.color) || NAVY;
  const c2 = hex(bg.color2);
  const defs = c2 ? `<linearGradient id="customBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>` : "";
  let body = c2 ? `<rect width="${IG_W}" height="${IG_H}" fill="url(#customBg)"/>` : "";
  if (bg.image) body += image(env, bg.image, 0, 0, IG_W, IG_H, "xMidYMid slice");
  (slide.layers || []).forEach((l) => { body += drawLayer(l, env, input.brandLogo); });
  if (input.footerOn) {
    const more = i < total - 1;
    body += footer(env, themeOf("dark"), { logo: input.brandLogo, cta: more ? "SWIPE FOR MORE" : input.cta || "WE-DRAFT.COM", more });
  }
  return svgDoc(env, defs, body, c1);
}

// → [{ name, svg }], a slide each.
export const customSlides = (input, env) => (input.slides || []).map((s, i, all) => ({ name: `slide-${i + 1}`, svg: slideSvg(env, input, s, i, all.length) }));

// Every image the post draws.
export function customImageUrls(input) {
  const urls = [input.brandLogo];
  (input.slides || []).forEach((s) => {
    if (s.bg?.image) urls.push(s.bg.image);
    (s.layers || []).forEach((l) => { if (hasPicture(l)) urls.push(urlOf(l, input.brandLogo)); });
  });
  return [...new Set(urls.filter(Boolean))];
}

// The urls drawn with their plain backdrops taken out (knockout.js).
export function customCutoutUrls(input) {
  const urls = [];
  (input.slides || []).forEach((s) => (s.layers || []).forEach((l) => { if (l.cutout && l.url) urls.push(l.url); }));
  return [...new Set(urls)];
}

// The players it features, for Instagram Analytics.
export function customPlayerIds(input) {
  const ids = [];
  (input.slides || []).forEach((s) => (s.layers || []).forEach((l) => { if (l.kind === "player" && l.playerId) ids.push(l.playerId); }));
  return [...new Set(ids)];
}

// A starting caption: the post's words, the players' names as tags.
export function customCaption(input) {
  const words = [];
  const tags = ["#NFLDraft", "#CollegeFootball"];
  (input.slides || []).forEach((s) => (s.layers || []).forEach((l) => {
    if (l.kind === "text" && l.value?.trim()) words.push(l.value.trim().replace(/\s*\n\s*/g, " "));
    if (l.kind === "player" && l.name) tags.push(`#${l.name.replace(/[^A-Za-z0-9]/g, "")}`);
  }));
  const tagLine = [...new Set(tags)].join(" ");
  return words.length ? `${words.join(". ")}\n\n${tagLine}` : tagLine;
}

// customSlides' input. brandLogo: the build's We-Draft logo.
export const customInput = ({ slides, footerOn = true, cta = "", brandLogo = "" }) => ({ slides, footerOn, cta, brandLogo });
