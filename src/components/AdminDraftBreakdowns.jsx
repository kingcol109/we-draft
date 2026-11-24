// src/components/AdminDraftBreakdowns.jsx
//
// Admin → Videos → Graphics → Draft Breakdowns: the ~4-minute YouTube player
// breakdowns' frames, 1920×1080 PNGs for Premiere, in the site's blue and
// gold (a school's colors only as an accent — the background card's photo
// tile, the title card's stripe). Bebas Neue + Barlow Condensed, the On the
// Clock broadcast's fonts (Google Fonts).
//
// Standard windows, so footage drops in at a round scale:
//   film window  1440×810 at (36, 150)  — 1080p footage at 75%
//   face cam      384×216 at (1500, 36) — 1080p webcam at 20%
// both transparent. Under the face, the segment's panel; along the bottom,
// the tracker and the We-Draft.com logo.
//
// The show, and its frames (numbered so Premiere sorts them):
//   00 title       a full card on an action shot — the cold open
//   01 intro       top plays in the film window; the panel pitches subscribing
//   02 background  no film: a card over the window — photo, hometown, high
//                  school, recruiting, measurements, career stats, career
//                  path; the panel has his season's four stats
//   03 strengths   the list, then one frame a strength (lit in the panel,
//                  named in a lower third over the film)
//   04 weaknesses  the same, in red
//   05 verdict     a card revealing what's included (grade, comp, fits —
//                  all by default); the panel recaps his key traits
//   06 community   the We-Draft community's grade and top traits, and a
//                  call to grade him yourself
// Cutting from one step's PNG to the next is the "animation".
//
// Live data, kept live: a player opens from King Cold's evaluation, his
// player doc, his photos, his ESPN stats, his career path (the player page's
// own useCareerPath) and his community evaluations — read fresh every time.
// Only what's edited here is saved (config/draftBreakdowns.players.{id}
// .edits), layered on top; a note on a trait follows the trait. "Back to
// live" drops the edits.
//
// Comps come from the draft history (utils/draftSim/draftHistory.json,
// 2000–2026): a pick's name, year, round, pick and team.
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, FieldPath, getDoc, getDocs, limit, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { NFL_TEAM_ABBRS, teamNameFromAbbr } from "./MarginAds";
import { fetchNflBranding } from "../utils/draftProfileData";
import { GRADE_SCALE, gradeLabel, gradeLook } from "../utils/gradeScale";
import { communityAverage } from "../utils/gradeWindow";
import { careerGroups, careerTable, defaultStats, espnIdFor, espnStats, loadImage, statOptions } from "./AdminSideGraphics";
import { useCareerPath } from "./PlayerEligibilityInfo";
import { draftLogo } from "../utils/draftLogos";
import { activePortalSeason, currentDraftClass } from "../utils/eligibility";
import { encodeMov } from "../utils/movEncoder";
import KingColdLogo from "../assets/KingColdSports.png";
import WeDraftLogo from "../assets/Logo2.png";
// The community card's gold bar: the outlined blue We-Draft.com (user, 2026-11-24).
import WeDraftOutline from "../assets/LogoOutlineBlue.png";
import { fetchPortalManual } from "../utils/portalData";
import { SILHOUETTE, BAND } from "../utils/proDayIcon";

// The portal's arrows, white (for the dark thumbnail).
const PORTAL_LOGO_WHITE = "/logos/transfer-portal-white.svg";
// The site's blue and gold. A frame draws in the theme's colors (the five
// below, set per draw by setTheme): the site's, or — a transfer portal
// breakdown, user 2026-11-24 — the new school's (teamTheme). The editor's
// own UI stays site blue / gold (UI_BLUE, UI_GOLD).
const SITE = { BLUE: "#0055a5", NAVY: "#00264d", DEEP: "#001833", GOLD: "#f6a21d", INK: "#0b1f3a" };
const UI_BLUE = SITE.BLUE;
const UI_GOLD = SITE.GOLD;
let BLUE = SITE.BLUE;
let NAVY = SITE.NAVY;
let DEEP = SITE.DEEP;
let GOLD = SITE.GOLD;
let INK = SITE.INK;
function setTheme(th) { ({ BLUE, NAVY, DEEP, GOLD, INK } = th); }
const GREEN = "#1e9e57";
const RED = "#d23c3c";
const W = 1920;
const H = 1080;
const KINGCOLD_UID = "pYSpX6IRyHdAlYpFP5NNbQ19ARI3"; // King Cold Sports — the admin's own evaluations (as AdminGo.jsx)
const BD_DOC = doc(db, "config", "draftBreakdowns");
const FONTS_CSS = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Bebas+Neue&family=Montserrat:wght@900&display=block";
const DISP = '"Bebas Neue", Impact, "Arial Narrow", sans-serif';
const BODY = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';
const disp = (s) => `${s}px ${DISP}`;
const body = (s, w = 700) => `${w} ${s}px ${BODY}`;
const MAX_TRAITS = 5;
const MAX_FITS = 3;
const STAT_COUNT = 4;

const VID = { x: 36, y: 150, w: 1440, h: 810 };
const FACE = { x: 1500, y: 36, w: 384, h: 216 };
const PANEL = { x: 1500, y: 276, w: 384, h: 684 };
const TRACK = { x: 36, y: 980, w: 1440, h: 64 };
const RIBBON_H = 64;

const SEGMENTS = [
  { key: "intro", label: "INTRO", chapter: "Intro" },
  { key: "background", label: "BACKGROUND", chapter: "Player Background" },
  { key: "strengths", label: "STRENGTHS", chapter: "Strengths" },
  { key: "weaknesses", label: "WEAKNESSES", chapter: "Weaknesses" },
  { key: "verdict", label: "VERDICT", chapter: "Grade, Team Fits & Player Comp" },
  { key: "community", label: "COMMUNITY", chapter: "We-Draft Community Grade" },
];
// A draft reaction's verdict is its Pick Grade.
const reactionMode = (bd) => bd?.mode === "reaction";
const segsOf = (bd) => (reactionMode(bd) ? SEGMENTS.map((s) => (s.key === "verdict" ? { key: "pickgrade", label: "PICK GRADE", chapter: "Pick Grade" } : s)) : SEGMENTS);
const DEFAULT_TIMES = { intro: 15, background: 30, strengths: 80, weaknesses: 55, verdict: 45, pickgrade: 40, community: 15 };
// A portal breakdown's verdict is no grade / comp / fits — it celebrates the move.
const PORTAL_CHAPTERS = { verdict: "The Verdict" };
const VERDICT_ITEMS = [["grade", "Draft grade"], ["comp", "Player comp"], ["fits", "Team fits"]];

// ── Fonts: the stylesheet once, then each face loaded before drawing ──
let fontsReady = null;
function ensureFonts() {
  if (fontsReady) return fontsReady;
  fontsReady = new Promise((resolve) => {
    const load = () => Promise.all([disp(40), body(30, 800), body(30, 700), body(30, 600), '900 40px "Montserrat"'].map((f) => document.fonts.load(f))).then(resolve, resolve);
    let link = document.querySelector(`link[href="${FONTS_CSS}"]`);
    if (link) { load(); return; }
    link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONTS_CSS;
    link.onload = load;
    link.onerror = resolve;
    document.head.appendChild(link);
    setTimeout(resolve, 5000);
  });
  return fontsReady;
}

// ── Drawing helpers ──
const alpha = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const lum = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255].map((v) => v / 255).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
};
const isHex = (hex) => /^#?[0-9a-f]{6}$/i.test(String(hex || "").trim());
// hex blended toward black by k (0…1).
const darken = (hex, k) => {
  const n = parseInt(String(hex).trim().replace("#", ""), 16);
  const ch = (v) => Math.round(v * (1 - k)).toString(16).padStart(2, "0");
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
};
// A school's colors as a frame theme: its darker color the ground, its
// lighter one the accent (frames, ribbons, gold text) — white when it has
// no light one. Too little to go on → the site's.
function teamTheme(brand) {
  const c1 = isHex(brand?.Color1) ? `#${brand.Color1.trim().replace("#", "")}` : "";
  const c2 = isHex(brand?.Color2) ? `#${brand.Color2.trim().replace("#", "")}` : "";
  const primary = [c1, c2].find((c) => c && lum(c) < 0.5);
  if (!primary) return SITE;
  const other = primary === c1 ? c2 : c1;
  // Light enough to read dark words on, and to stand out (a mid gray doesn't).
  const accent = other && lum(other) >= 0.6 ? other : "#ffffff";
  return { BLUE: primary, NAVY: darken(primary, 0.5), DEEP: darken(primary, 0.72), GOLD: accent, INK: darken(primary, 0.78) };
}
// An NFL team's colors as a draft reaction's theme (user, 2026-11-24):
// the site's blue becomes its Color1, the gold its Color2 — white only when
// it has no usable second color. (A light Color1 trades places with a dark
// Color2, so the ground stays dark.)
function nflTheme(brand) {
  const h = (c) => (isHex(c) ? `#${String(c).trim().replace("#", "")}`.toLowerCase() : "");
  let c1 = h(brand?.Color1);
  let c2 = h(brand?.Color2);
  if (!c1) return SITE;
  if (lum(c1) >= 0.6 && c2 && lum(c2) < 0.6) [c1, c2] = [c2, c1];
  const accent = c2 && c2 !== c1 && lum(c2) >= 0.25 ? c2 : "#ffffff";
  return { BLUE: c1, NAVY: darken(c1, 0.5), DEEP: darken(c1, 0.72), GOLD: accent, INK: darken(c1, 0.78) };
}
function rr(ctx, x, y, w, h, r) {
  const q = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + q, y);
  ctx.arcTo(x + w, y, x + w, y + h, q);
  ctx.arcTo(x + w, y + h, x, y + h, q);
  ctx.arcTo(x, y + h, x, y, q);
  ctx.arcTo(x, y, x + w, y, q);
  ctx.closePath();
}
// Text at the biggest size from max down to min that fits maxW. → the size.
function fit(ctx, text, x, y, maxW, max, min = 12, align = "left", f = disp) {
  let size = max;
  ctx.font = f(size);
  while (size > min && ctx.measureText(text).width > maxW) { size -= 1; ctx.font = f(size); }
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  ctx.textAlign = "left";
  return size;
}
// Text broken into at most maxLines lines; the last ends in "…" when some was left over.
function wrapLines(ctx, text, maxW, size, maxLines, f = disp) {
  ctx.font = f(size);
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  let i = 0;
  for (; i < words.length; i += 1) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= maxW || !line) { line = next; continue; }
    lines.push(line);
    line = words[i];
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) { lines.push(line); i = words.length; }
  if (i < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last.includes(" ") && ctx.measureText(`${last}…`).width > maxW) last = last.replace(/\s*\S+$/, "");
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}
// The biggest size from max to min whose wrap fits maxLines without cutting.
function wrapFit(ctx, text, maxW, max, min, maxLines, f = disp) {
  for (let s = max; s >= min; s -= 2) {
    const lines = wrapLines(ctx, text, maxW, s, maxLines, f);
    ctx.font = f(s);
    // A word too long for the line on its own also shrinks it.
    if ((!lines.some((l) => l.endsWith("…")) && lines.every((l) => ctx.measureText(l).width <= maxW)) || s - 2 < min) return { size: s, lines };
  }
  return { size: min, lines: wrapLines(ctx, text, maxW, min, maxLines, f) };
}
// Lines drawn from a top edge (each line's height lh), centered or not. → the bottom.
function drawLines(ctx, lines, x, top, size, lh, align = "left", f = disp) {
  ctx.font = f(size);
  ctx.textAlign = align;
  lines.forEach((l, i) => ctx.fillText(l, x, top + size * 0.8 + i * lh));
  ctx.textAlign = "left";
  return top + lines.length * lh;
}
function contain(ctx, img, x, y, w, h, a = 1, middle = true) {
  if (!img) return;
  const s = Math.min(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.drawImage(img, x + (w - dw) / 2, middle ? y + (h - dh) / 2 : y + h - dh, dw, dh);
  ctx.restore();
}
// A box's border, the box itself cut out (transparent) or left for a card.
function frameBox(ctx, box, color, bw, r, hole) {
  rr(ctx, box.x - bw, box.y - bw, box.w + bw * 2, box.h + bw * 2, r + bw);
  ctx.fillStyle = color;
  ctx.fill();
  if (!hole) return;
  ctx.save();
  rr(ctx, box.x, box.y, box.w, box.h, r);
  ctx.clip();
  ctx.clearRect(box.x, box.y, box.w, box.h);
  ctx.restore();
}
function stripes(ctx, x, y, w, h, a = 0.045) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalAlpha = a;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 34;
  for (let sx = x - h; sx < x + w; sx += 124) { ctx.beginPath(); ctx.moveTo(sx, y + h); ctx.lineTo(sx + h, y); ctx.stroke(); }
  ctx.restore();
}
function backdrop(ctx, x, y, w, h, from = BLUE, to = NAVY) {
  const g = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  stripes(ctx, x, y, w, h);
}
// A check or a cross (kind), on a disc of bg when bg is given.
function mark(ctx, kind, cx, cy, r, color, bg) {
  if (bg) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = bg; ctx.fill(); }
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, r * 0.26);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (kind === "check") {
    ctx.moveTo(cx - r * 0.42, cy + r * 0.02);
    ctx.lineTo(cx - r * 0.12, cy + r * 0.32);
    ctx.lineTo(cx + r * 0.44, cy - r * 0.3);
  } else {
    const d = r * 0.34;
    ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d);
    ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d);
  }
  ctx.stroke();
  ctx.restore();
}
// A section heading on a card: gold words, a rule out to the right.
function heading(ctx, text, x, y, w, size = 34) {
  ctx.fillStyle = GOLD;
  ctx.font = disp(size);
  ctx.fillText(text, x, y);
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = alpha("#ffffff", 0.18);
  ctx.fillRect(x + tw + 16, y - size * 0.32, Math.max(0, w - tw - 16), 3);
}

// ── Animation ──
// Every frame can be drawn at a moment t (0…1) of its animation; no t is
// the finished frame — its PNG — so every clip lands exactly on its PNG.
const ease = (p) => 1 - (1 - p) ** 3;
// An overshoot, for things that pop in.
const easeBack = (p) => 1 + 2.7 * (p - 1) ** 3 + 1.7 * (p - 1) ** 2;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
// How far along (0…1) a piece is whose move runs from a to b.
const phase = (t, a, b) => (t == null ? 1 : ease(clamp01((t - a) / (b - a))));
const pop = (t, a, b) => (t == null ? 1 : easeBack(clamp01((t - a) / (b - a))));
// A bump 0 → 1 → 0 across a…b (always 0 on the finished frame).
const pulse = (t, a, b) => (t == null || t < a || t > b ? 0 : Math.sin(Math.PI * ((t - a) / (b - a))));
// The i-th of n, staggered across a…b, each taking `span` of it.
const stagger = (t, i, n, a, b, span = 0.4) => {
  const len = b - a;
  const each = n > 1 ? len * span : len;
  const gap = n > 1 ? (len - each) / (n - 1) : 0;
  return phase(t, a + i * gap, a + i * gap + each);
};
// fn drawn faded in by p and slid in from (dx, dy) away.
function animIn(ctx, p, dx, dy, fn) {
  if (p <= 0) return;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, p);
  ctx.translate(dx * (1 - p), dy * (1 - p));
  fn();
  ctx.restore();
}
// fn drawn scaled by s about (cx, cy).
function scaled(ctx, s, cx, cy, fn) {
  if (s <= 0) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.translate(-cx, -cy);
  fn();
  ctx.restore();
}
// A white shine sweeping across a box (p 0…1; nothing at either end).
function shine(ctx, box, p) {
  if (p <= 0 || p >= 1) return;
  const sx = box.x - 160 + (box.w + 320) * p;
  ctx.save();
  rr(ctx, box.x, box.y, box.w, box.h, box.r || 0);
  ctx.clip();
  const g = ctx.createLinearGradient(sx - 80, 0, sx + 80, 0);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.5, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(sx - 80, box.y, 160, box.h);
  ctx.restore();
}
// A stat counted up to its value by p, written the way the value is ("4,129", "67.1%").
const countUp = (value, p) => {
  const s = String(value);
  if (p >= 1) return s;
  const m = s.match(/^([^\d]*)([\d,]*\.?\d+)(.*)$/);
  if (!m) return s;
  const num = parseFloat(m[2].replace(/,/g, ""));
  if (Number.isNaN(num)) return s;
  const dec = (m[2].split(".")[1] || "").length;
  const v = num * p;
  const txt = m[2].includes(",") ? v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec);
  return `${m[1]}${txt}${m[3]}`;
};
// Each animation's length (s); a clip then holds its last frame ANIM_HOLD more.
export const ANIM_SECONDS = { intro: 3.2, background: 2.6, list: 1.6, swap: 2.2, verdict: 1.8, reveal: 1.5, community: 3, celebrate: 4, pickgrade: 2.4 };
// A portal background runs longer: the new school lands on the career path last.
// A reaction's background opens on the draft moment first.
const animSeconds = (bd, anim) => (anim === "background" && bd.mode === "portal" ? 4.6 : anim === "background" && bd.mode === "reaction" ? 6.4 : ANIM_SECONDS[anim]);
export const ANIM_HOLD = 0.5;

const fullName = (bd) => `${bd.first || ""} ${bd.last || ""}`.trim().toUpperCase();
const traitList = (bd, seg) => (bd[seg] || []).filter((x) => String(x.title || "").trim());
const keyTraits = (bd) => [
  ...traitList(bd, "strengths").filter((x) => x.key).map((x) => ["check", GREEN, x.title]),
  ...traitList(bd, "weaknesses").filter((x) => x.key).map((x) => ["cross", RED, x.title]),
];
const verdictShown = (bd) => VERDICT_ITEMS.map(([k]) => k).filter((k) => bd.verdict?.[k] !== false);
const compLine = (c) => (c?.year ? `${c.year} DRAFT · ${c.round ? `RD ${c.round}, PICK ${c.pick}` : "UNDRAFTED"}` : "");
const playerUrl = (bd) => (bd.slug ? `we-draft.com/player/${bd.slug}` : "we-draft.com");

// ── The frame ──
// view: { seg, step, anim?, t? }. A list's step 0 is the whole list, 1…n
// lights one trait; the verdict's step is how many of its items are
// revealed (0 = the empty card). anim: the clip being drawn — "intro",
// "background", "list", "verdict", "community" (the segment coming in) or
// "reveal" (the verdict's step-th item flipping open) — at t.
export async function drawBreakdown(canvas, bd, view, branding) {
  await ensureFonts();
  const ctx = canvas.getContext("2d");
  const nflLogo = (a) => (a ? loadImage(branding[a]?.LogoDark || branding[a]?.Logo1) : null);
  const career = careerOf(bd, branding);
  const table = bd.careerTables?.[bd.careerCat] || null;
  const portalOn = portalMode(bd);
  const reaction = reactionMode(bd);
  const [logo, headshot, cutout, draft, wd, kcs, fitLogos, compLogo, careerLogos, tableLogos, commFitLogos, portal, fromLogo, toLogo, fromLogoDark, toLogoDark, wdOutline, states, pickLogo] = await Promise.all([
    loadImage(bd.logo), loadImage(bd.headshot),
    view.seg === "title" || (portalOn && view.seg === "verdict") ? loadImage(bd.photo || bd.headshot) : view.seg === "background" ? loadImage(bd.bgPhoto || bd.photo || bd.headshot) : null,
    view.seg === "title" || (reaction && view.seg === "background") ? loadImage(draftLogo(bd.cls)) : null,
    loadImage(WeDraftLogo), loadImage(KingColdLogo),
    Promise.all((bd.fits || []).filter(Boolean).slice(0, MAX_FITS).map(nflLogo)),
    nflLogo(bd.comp?.team),
    Promise.all(career.map((r) => loadImage(r.logo))),
    Promise.all((table?.rows || []).map((r) => loadImage(r.logo))),
    Promise.all((bd.community?.fits || []).map(nflLogo)),
    portalOn ? loadImage(PORTAL_LOGO_WHITE) : null,
    portalOn ? loadImage(schoolLogo(bd.fromBrand)) : null, portalOn ? loadImage(schoolLogo(bd.toBrand)) : null,
    portalOn ? loadImage(schoolLogo(bd.fromBrand, true)) : null, portalOn ? loadImage(schoolLogo(bd.toBrand, true)) : null,
    view.seg === "community" ? loadImage(WeDraftOutline) : null,
    view.seg === "background" && career.some((r) => r.state && !r.logo) ? stateOutlines() : null,
    reaction ? nflLogo(bd.nflTeam) : null,
  ]);
  // A portal breakdown's background tile watermark: the new school's.
  const tileLogo = portalOn && bd.toSchool ? toLogoDark || logo : reaction ? pickLogo || logo : logo;
  const img = { logo, tileLogo, headshot, cutout, draft, wd, wdOutline, kcs, fitLogos, compLogo, careerLogos, tableLogos, commFitLogos, career, table, branding, portal, fromLogo, toLogo, fromLogoDark, toLogoDark, states, pickLogo };
  // Everything loaded — from here the drawing is synchronous, so the theme
  // can't leak into another frame being drawn at the same time.
  // A reaction's thumbnail is in the NFL team's colors.
  // A reaction is in the drafting team's colors, every frame.
  setTheme(portalOn && bd.toSchool ? teamTheme(bd.toBrand) : reaction ? nflTheme(branding?.[bd.nflTeam]) : SITE);
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";
  if (view.seg === "title") {
    if (portalOn) drawTitlePortal(ctx, bd, img);
    else drawTitle(ctx, bd, reaction ? { ...img, logo: pickLogo || logo } : img);
    return;
  }
  // The segment's own coming-in time (a verdict reveal leaves the rest still).
  const tin = view.anim && view.anim !== "reveal" ? view.t : undefined;

  backdrop(ctx, 0, 0, W, H);
  // Portal: the header's logo is the new school's — in the intro's clip it
  // swaps over from the old one as the move lands.
  if (portalOn) {
    const swapP = view.anim === "intro" ? phase(view.t, 0.5, 0.7) : 1;
    const oldL = fromLogoDark || logo;
    const newL = bd.toSchool ? toLogoDark || logo : oldL;
    drawHeader(ctx, bd, swapP >= 1 ? newL : oldL, swapP > 0 && swapP < 1 ? { logo: newL, p: swapP } : null);
  } else drawHeader(ctx, bd, reaction ? pickLogo || logo : logo);
  // The film window is always cut out; a card fills it in over the footage.
  frameBox(ctx, VID, GOLD, 6, 12, true);
  // A reaction's background clip: the draft moment, then it slides off and
  // the background card fills in (on its own time, bt).
  const moment = reaction && view.seg === "background" && tin != null;
  const bt = moment ? (tin < 0.46 ? 0 : (tin - 0.46) / 0.54) : tin;
  if (view.seg === "background") cardBackground(ctx, bd, img, bt);
  if (moment && tin < 0.62) cardDraftMoment(ctx, bd, img, Math.min(1, tin / 0.46), phase(tin, 0.5, 0.62));
  if (view.seg === "pickgrade") cardPickGrade(ctx, bd, img, tin);
  if (view.seg === "verdict") { if (portalOn) cardCelebrate(ctx, bd, img, tin); else cardVerdict(ctx, bd, view, img, tin); }
  if (view.seg === "community") cardCommunity(ctx, bd, img, tin);
  frameBox(ctx, FACE, GOLD, 5, 14, true);
  drawPanel(ctx, bd, view, img, bt);
  drawTracker(ctx, view.seg, phase(tin, 0, 0.4), segsOf(bd));
  contain(ctx, wd, PANEL.x, TRACK.y, PANEL.w, TRACK.h);
}

// swapTo: { logo, p } — a second logo fading in over the first (the portal's move).
function drawHeader(ctx, bd, logo, swapTo) {
  if (swapTo) {
    contain(ctx, logo, 36, 24, 104, 104, 1 - swapTo.p);
    scaled(ctx, 0.7 + 0.3 * swapTo.p, 88, 76, () => contain(ctx, swapTo.logo, 36, 24, 104, 104, swapTo.p));
  } else contain(ctx, logo, 36, 24, 104, 104);
  const x0 = logo || swapTo ? 160 : VID.x;
  ctx.font = disp(36);
  const badge = portalMode(bd) ? "TRANSFER PORTAL BREAKDOWN" : `${bd.cls ? `${bd.cls} ` : ""}DRAFT ${reactionMode(bd) ? "REACTION" : "BREAKDOWN"}`;
  const bw = ctx.measureText(badge).width + 60;
  const bx = VID.x + VID.w - bw;
  rr(ctx, bx, 50, bw, 58, 29);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.fillStyle = NAVY;
  fit(ctx, badge, bx + bw / 2, 92, bw - 30, 36, 18, "center");
  ctx.fillStyle = "#ffffff";
  fit(ctx, fullName(bd) || "PLAYER NAME", x0, 98, bx - x0 - 30, 96, 40);
  ctx.fillStyle = GOLD;
  ctx.letterSpacing = "1px";
  const sub = portalMode(bd)
    ? [bd.pos, bd.toSchool ? `${bd.fromSchool || "?"} → ${bd.toSchool}` : `${bd.fromSchool || bd.school} · IN THE PORTAL`]
    : reactionMode(bd) ? [bd.pos, bd.school, pickLine(bd), bd.nflTeam && (teamNameFromAbbr(bd.nflTeam) || bd.nflTeam)]
    : [bd.pos, bd.school, bd.cls && `${bd.cls} DRAFT CLASS`];
  fit(ctx, sub.filter(Boolean).join("  ·  ").toUpperCase(), x0 + 2, 133, bx - x0 - 30, 26, 14, "left", (s) => body(s, 800));
  ctx.letterSpacing = "0px";
}

// The tracker. p: the gold highlight sliding over from the last segment
// (growing in on the first) — the last one closes as the new one opens.
function drawTracker(ctx, seg, p = 1, SEGS = SEGMENTS) {
  const cur = SEGS.findIndex((s) => s.key === seg);
  const gap = 10;
  const pw = (TRACK.w - gap * (SEGS.length - 1)) / SEGS.length;
  const pillX = (i) => TRACK.x + i * (pw + gap);
  const label = (i, color) => {
    const done = i < cur;
    ctx.font = disp(32);
    const tw = Math.min(ctx.measureText(SEGS[i].label).width, pw - 50);
    const cx = pillX(i) + pw / 2 + (done ? 14 : 0);
    if (done) mark(ctx, "check", cx - tw / 2 - 18, TRACK.y + TRACK.h / 2, 11, color === NAVY ? NAVY : GOLD);
    ctx.fillStyle = color;
    fit(ctx, SEGS[i].label, cx, TRACK.y + TRACK.h / 2 + 11, pw - 50, 32, 16, "center");
  };
  SEGS.forEach((s, i) => {
    rr(ctx, pillX(i), TRACK.y, pw, TRACK.h, TRACK.h / 2);
    if (i < cur) { ctx.fillStyle = alpha("#ffffff", 0.14); ctx.fill(); label(i, "#ffffff"); }
    else if (i > cur || p < 1) { ctx.strokeStyle = alpha("#ffffff", 0.3); ctx.lineWidth = 3; ctx.stroke(); label(i, alpha("#ffffff", 0.55)); }
  });
  const hw = cur > 0 ? pw : pw * p;
  if (hw < 2) return;
  const hx = cur > 0 ? pillX(cur - 1) + (pillX(cur) - pillX(cur - 1)) * p : pillX(cur) + (pw - hw) / 2;
  rr(ctx, hx, TRACK.y, hw, TRACK.h, TRACK.h / 2);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.save();
  rr(ctx, hx, TRACK.y, hw, TRACK.h, TRACK.h / 2);
  ctx.clip();
  [cur - 1, cur].filter((i) => i >= 0).forEach((i) => label(i, NAVY));
  ctx.restore();
}

// ── The panel under the face cam ──
// pRib: the ribbon dropping in.
// The accent for a fill on a white panel, and its ink: a white accent (a
// school with no light color) would vanish there, so its main color stands in.
const accentOnWhite = () => (lum(GOLD) > 0.85 ? [BLUE, "#ffffff"] : [GOLD, NAVY]);
function panelShell(ctx, title, ribbon = GOLD, ribbonInk = NAVY, fill = "#ffffff", rh = RIBBON_H, size = 40, pRib = 1) {
  const { x, y, w, h } = PANEL;
  if (fill === "#ffffff" && ribbon === GOLD) [ribbon, ribbonInk] = accentOnWhite();
  rr(ctx, x - 5, y - 5, w + 10, h + 10, 20);
  ctx.fillStyle = GOLD;
  ctx.fill();
  rr(ctx, x, y, w, h, 15);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  if (title) {
    animIn(ctx, pRib, 0, -rh, () => {
      ctx.fillStyle = ribbon;
      ctx.fillRect(x, y, w, rh);
      ctx.fillStyle = ribbonInk;
      fit(ctx, title, x + w / 2, y + rh / 2 + size * 0.35, w - 40, size, 18, "center");
    });
  }
  return { x, y: y + (title ? rh : 0), w, h: h - (title ? rh : 0) };
}
function drawPanel(ctx, bd, view, img, t) {
  const seg = view.seg;
  if (seg === "intro") { if (portalMode(bd)) panelMove(ctx, bd, img, t); else panelSubscribe(ctx, bd, img, t); }
  else if (seg === "background") panelSeason(ctx, bd, t);
  else if (seg === "strengths" || seg === "weaknesses") panelList(ctx, bd, seg, view.step, t, view.anim === "swap");
  else if (seg === "verdict" || seg === "pickgrade") panelKeyTraits(ctx, bd, t);
  else panelYourTurn(ctx, bd, t);
  ctx.restore();
}

// Intro: the pitch to subscribe — MORE DRAFT BREAKDOWNS / ALL WEEK, the
// button, the King Cold Sports logo under it. Animated: the words pop in
// line by line, ALL WEEK slides in over its underline, the button pops,
// pulses twice with a shine across it.
function panelSubscribe(ctx, bd, { kcs }, t) {
  const b = panelShell(ctx, null, GOLD, NAVY, DEEP);
  stripes(ctx, b.x, b.y, b.w, b.h, 0.05);
  const cx = b.x + b.w / 2;
  const head = wrapFit(ctx, String(bd.subTitle || "").toUpperCase(), b.w - 40, 124, 40, 3);
  const lh = head.size * 0.88;
  const subSize = 116;
  const bh = 124;
  const kh = 76;
  const total = head.lines.length * lh + 18 + subSize * 0.8 + 52 + bh + 30 + kh + 36 + 24;
  let y = b.y + Math.max(26, (b.h - total) / 2);
  head.lines.forEach((l, i) => {
    const s = pop(t, 0.04 + i * 0.09, 0.3 + i * 0.09);
    const ly = y;
    scaled(ctx, s, cx, ly + i * lh + head.size * 0.45, () => {
      ctx.fillStyle = "#ffffff";
      ctx.font = disp(head.size);
      ctx.textAlign = "center";
      ctx.fillText(l, cx, ly + head.size * 0.8 + i * lh);
      ctx.textAlign = "left";
    });
  });
  y += head.lines.length * lh + 18;
  const sy = y;
  animIn(ctx, phase(t, 0.28, 0.5), -70, 0, () => {
    const text = String(bd.subLine || "").toUpperCase();
    ctx.fillStyle = GOLD;
    const sz = fit(ctx, text, cx, sy + subSize * 0.8, b.w - 40, subSize, 30, "center");
    ctx.font = disp(sz);
    const tw = ctx.measureText(text).width;
    ctx.fillRect(cx - tw / 2, sy + subSize * 0.8 + 12, tw * phase(t, 0.36, 0.6), 6);
  });
  y += subSize * 0.8 + 52;
  // The button: YouTube red, a play mark, SUBSCRIBE.
  const bw = b.w - 56;
  const bx = b.x + 28;
  const by = y;
  const beat = pulse(t, 0.62, 0.76) + pulse(t, 0.8, 0.94);
  scaled(ctx, pop(t, 0.42, 0.58) * (1 + 0.07 * beat), cx, by + bh / 2, () => {
    ctx.save();
    ctx.shadowColor = `rgba(255,0,0,${0.35 + 0.45 * beat})`;
    ctx.shadowBlur = 22 + 30 * beat;
    ctx.shadowOffsetY = 6;
    rr(ctx, bx, by, bw, bh, 16);
    ctx.fillStyle = "#ff0000";
    ctx.fill();
    ctx.restore();
    const px = bx + 54;
    rr(ctx, px - 30, by + bh / 2 - 22, 60, 44, 12);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(px - 8, by + bh / 2 - 12);
    ctx.lineTo(px + 13, by + bh / 2);
    ctx.lineTo(px - 8, by + bh / 2 + 12);
    ctx.closePath();
    ctx.fillStyle = "#ff0000";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    fit(ctx, "SUBSCRIBE", px + 46, by + bh / 2 + 24, bw - 110, 70, 24);
    shine(ctx, { x: bx, y: by, w: bw, h: bh, r: 16 }, phase(t, 0.62, 0.9));
  });
  y += bh + 30;
  const ky = y;
  animIn(ctx, phase(t, 0.5, 0.68), 0, 24, () => contain(ctx, kcs, b.x + 24, ky, b.w - 48, kh));
  y += kh + 36;
  const ny = y;
  animIn(ctx, phase(t, 0.6, 0.78), 0, 16, () => {
    ctx.fillStyle = alpha("#ffffff", 0.65);
    ctx.letterSpacing = "2px";
    fit(ctx, "TURN ON NOTIFICATIONS", cx, ny, b.w - 60, 22, 12, "center", (sz) => body(sz, 800));
    ctx.letterSpacing = "0px";
  });
}

// Background: his season — big numbers on navy, each with its national
// rank when it's top 50. Animated: the ribbon drops, the rows slide in and
// count up.
function panelSeason(ctx, bd, t) {
  const stats = (bd.stats || []).filter((s) => s.label && s.value).slice(0, STAT_COUNT);
  const b = panelShell(ctx, String(bd.statsTitle || "THE SEASON").toUpperCase(), GOLD, NAVY, DEEP, 104, 74, phase(t, 0.1, 0.3));
  stripes(ctx, b.x, b.y, b.w, b.h, 0.04);
  if (!stats.length) {
    ctx.fillStyle = alpha("#ffffff", 0.5);
    fit(ctx, "NO STATS YET", b.x + b.w / 2, b.y + 80, b.w - 40, 34, 16, "center");
    return;
  }
  const rowH = b.h / stats.length;
  stats.forEach((s, i) => {
    const p = stagger(t, i, stats.length, 0.22, 0.75);
    const ry = b.y + i * rowH;
    animIn(ctx, p, 60, 0, () => {
      if (i) {
        ctx.fillStyle = alpha("#ffffff", 0.12);
        ctx.fillRect(b.x + 26, ry, b.w - 52, 2);
      }
      const mid = ry + rowH / 2;
      ctx.fillStyle = GOLD;
      ctx.letterSpacing = "2px";
      fit(ctx, String(s.label).toUpperCase(), b.x + 30, mid - rowH * 0.2, b.w - 60, 22, 12, "left", (sz) => body(sz, 800));
      ctx.letterSpacing = "0px";
      let chipW = 0;
      const rank = rankText(s.rank);
      if (rank) {
        ctx.font = body(20, 800);
        chipW = ctx.measureText(rank).width + 26;
        rr(ctx, b.x + b.w - 26 - chipW, mid + 2, chipW, 36, 18);
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = GOLD;
        fit(ctx, rank, b.x + b.w - 26 - chipW / 2, mid + 27, chipW - 12, 20, 12, "center", (sz) => body(sz, 800));
      }
      ctx.fillStyle = "#ffffff";
      fit(ctx, countUp(s.value, p), b.x + 28, mid + rowH * 0.34, b.w - 60 - (chipW ? chipW + 16 : 0), Math.round(rowH * 0.56), 30);
    });
  });
}
// CFBD's rank ("12" / "T-12") → "#12 FBS" — only a top-50 rank is worth showing.
const RANK_SHOWN = 50;
const rankText = (r) => {
  const n = parseInt(String(r || "").replace(/^T-/, ""), 10);
  return n && n <= RANK_SHOWN ? `${String(r).startsWith("T-") ? "T-" : ""}#${n} FBS` : "";
};

// Strengths / weaknesses, top down. Animated (the list's clip): the ribbon
// drops and the traits file in one by one. The weaknesses' clip is the swap
// from the strengths: they slide out, the red ribbon wipes over the green,
// then the weaknesses file in.
function panelList(ctx, bd, seg, step, t, swap) {
  const items = traitList(bd, seg);
  const color = seg === "strengths" ? GREEN : RED;
  const kind = seg === "strengths" ? "check" : "cross";
  const swapping = swap && t != null;
  const b = panelShell(ctx, seg === "strengths" ? "STRENGTHS" : "WEAKNESSES", color, "#ffffff", "#ffffff", RIBBON_H, 40, swapping ? 1 : phase(t, 0.08, 0.3));
  const pad = 16;
  const rowFor = (list) => Math.min(118, (b.h - pad * 2) / Math.max(list.length, 1));
  // One trait row (state "all": the list as it holds).
  const row = (it, i, list, rowColor, rowKind) => {
    const rh = rowFor(list);
    const box = { x: b.x + 14, y: b.y + pad + i * rh + 4, w: b.w - 28, h: rh - 8 };
    const r = Math.min(23, box.h / 2 - 8);
    const cx = box.x + 24 + r;
    const cy = box.y + box.h / 2;
    mark(ctx, rowKind, cx, cy, r, "#ffffff", rowColor);
    const tx = cx + r + 16;
    const { size, lines } = wrapFit(ctx, String(it.title).toUpperCase(), box.x + box.w - tx - 12, 38, 22, 2);
    ctx.fillStyle = INK;
    const lh = size * 0.95;
    drawLines(ctx, lines, tx, cy - (lines.length * lh) / 2 - size * 0.06, size, lh);
  };
  if (swapping) {
    // The green ribbon, still over the part the red hasn't wiped yet.
    const wipe = phase(t, 0.22, 0.45);
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x + b.w * wipe, PANEL.y, b.w * (1 - wipe), RIBBON_H);
    ctx.clip();
    ctx.fillStyle = GREEN;
    ctx.fillRect(PANEL.x, PANEL.y, PANEL.w, RIBBON_H);
    ctx.fillStyle = "#ffffff";
    fit(ctx, "STRENGTHS", PANEL.x + PANEL.w / 2, PANEL.y + RIBBON_H / 2 + 14, PANEL.w - 40, 40, 18, "center");
    ctx.restore();
    // The strengths going out, top first.
    const out = traitList(bd, "strengths");
    out.forEach((it, i) => {
      const gone = phase(t, 0.02 + i * 0.05, 0.22 + i * 0.05);
      animIn(ctx, 1 - gone, -80, 0, () => row(it, i, out, GREEN, "check"));
    });
  }
  if (!items.length) {
    if (!swapping || t > 0.5) { ctx.fillStyle = "#9aa4b2"; fit(ctx, "ADD SOME IN THE EDITOR", b.x + b.w / 2, b.y + 70, b.w - 40, 30, 14, "center"); }
    return;
  }
  items.forEach((it, i) => {
    animIn(ctx, stagger(t, i, items.length, swapping ? 0.36 : 0.22, swapping ? 0.92 : 0.92), 70, 0, () => row(it, i, items, color, kind));
  });
  void step;
}

// Verdict: the key traits, picked by ★ in the editor, top down.
function panelKeyTraits(ctx, bd, t) {
  const rows = keyTraits(bd);
  const b = panelShell(ctx, "KEY TRAITS", GOLD, NAVY, "#ffffff", RIBBON_H, 40, phase(t, 0.08, 0.3));
  if (!rows.length) {
    ctx.fillStyle = "#9aa4b2";
    fit(ctx, "STAR SOME TRAITS", b.x + b.w / 2, b.y + 70, b.w - 40, 30, 14, "center");
    return;
  }
  const pad = 18;
  const rowH = Math.min(104, (b.h - pad * 2) / rows.length);
  rows.forEach(([kind, color, title], i) => {
    const ry = b.y + pad + i * rowH;
    animIn(ctx, stagger(t, i, rows.length, 0.3, 0.95), 60, 0, () => {
      if (i) { ctx.fillStyle = "#e3e8ef"; ctx.fillRect(b.x + 24, ry, b.w - 48, 2); }
      const cy = ry + rowH / 2;
      mark(ctx, kind, b.x + 46, cy, 20, "#ffffff", color);
      const { size, lines } = wrapFit(ctx, String(title).toUpperCase(), b.w - 110, 38, 22, 2);
      ctx.fillStyle = INK;
      const lh = size * 0.95;
      drawLines(ctx, lines, b.x + 82, cy - (lines.length * lh) / 2 - size * 0.06, size, lh);
    });
  });
}

// Community: how to grade him yourself.
function panelYourTurn(ctx, bd, t) {
  const b = panelShell(ctx, "YOUR TURN", GOLD, NAVY, "#ffffff", RIBBON_H, 40, phase(t, 0.08, 0.3));
  const steps = ["GO TO WE-DRAFT.COM", `SEARCH ${String(bd.last || "HIM").toUpperCase()}`, "HIT EVALUATE"];
  const rowH = 116;
  let y = b.y + 28;
  steps.forEach((s, i) => {
    const cy = y + rowH / 2;
    animIn(ctx, stagger(t, i, steps.length, 0.25, 0.7), 60, 0, () => {
      ctx.beginPath();
      ctx.arc(b.x + 54, cy, 28, 0, Math.PI * 2);
      ctx.fillStyle = BLUE;
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      fit(ctx, String(i + 1), b.x + 54, cy + 14, 40, 40, 20, "center");
      ctx.fillStyle = INK;
      fit(ctx, s, b.x + 100, cy + 15, b.w - 124, 44, 22);
      if (i < steps.length - 1) { ctx.fillStyle = "#dbe3ee"; ctx.fillRect(b.x + 52, cy + 32, 4, rowH - 64); }
    });
    y += rowH;
  });
  const ty = y;
  animIn(ctx, phase(t, 0.6, 0.8), 0, 20, () => {
    ctx.fillStyle = "#4a5565";
    const lines = wrapLines(ctx, "Grade him, pick his strengths and weaknesses, and see how your call stacks up with the community.", b.w - 56, 26, 5, (s) => body(s, 600));
    drawLines(ctx, lines, b.x + b.w / 2, ty + 10, 26, 33, "center", (s) => body(s, 600));
  });
  scaled(ctx, pop(t, 0.72, 0.92), b.x + b.w / 2, b.y + b.h - 60, () => {
    rr(ctx, b.x + 28, b.y + b.h - 92, b.w - 56, 64, 32);
    const [pill, ink] = accentOnWhite();
    ctx.fillStyle = pill;
    ctx.fill();
    ctx.fillStyle = ink;
    fit(ctx, "IT'S FREE", b.x + b.w / 2, b.y + b.h - 47, b.w - 90, 38, 18, "center");
  });
}

// ── Cards over the film window ──
// The card's ground, faded in by p over the footage (it "fills in"). Leaves
// the window's clip on (closed by the card's last restore).
function cardShell(ctx, p = 1) {
  const { x, y, w, h } = VID;
  ctx.save();
  rr(ctx, x, y, w, h, 12);
  ctx.clip();
  if (p <= 0) return;
  ctx.save();
  ctx.globalAlpha *= p;
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, DEEP);
  g.addColorStop(1, NAVY);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  stripes(ctx, x, y, w, h, 0.035);
  ctx.restore();
}
function cardTitle(ctx, text, y, p = 1) {
  animIn(ctx, p, 0, -40, () => {
    ctx.fillStyle = "#ffffff";
    fit(ctx, text, VID.x + VID.w / 2, y, VID.w - 200, 76, 30, "center");
    ctx.fillStyle = GOLD;
    ctx.fillRect(VID.x + VID.w / 2 - 80 * p, y + 18, 160 * p, 6);
  });
}

// Background: his cutout on a tile in his school's colors (moved and sized
// in the editor), measurements, career stats, career path. Animated: the
// card fills in, the tile slides in and he rises into it, the measurements
// pop in one by one, the stat rows slide in, the career path draws left to right.
export const BG_TILE = { x: VID.x + 32, y: VID.y + 32, w: 520, h: VID.h - 64 };
export const DEFAULT_BG_POS = { x: BG_TILE.x + BG_TILE.w / 2, y: BG_TILE.y + BG_TILE.h, s: 1 };
function cardBackground(ctx, bd, { tileLogo: logo, cutout, career, careerLogos, table, tableLogos, states }, t) {
  cardShell(ctx, phase(t, 0, 0.25));
  const { x, y, h } = VID;
  const pad = 32;
  const tile = BG_TILE;
  // A portal breakdown's tile is in the new school's colors (the theme).
  const school = (portalMode(bd) && bd.toSchool) || reactionMode(bd) ? BLUE : bd.c1 && lum(bd.c1) < 0.75 ? bd.c1 : BLUE;
  animIn(ctx, phase(t, 0.1, 0.4), -90, 0, () => {
    ctx.save();
    rr(ctx, tile.x, tile.y, tile.w, tile.h, 20);
    ctx.clip();
    const g = ctx.createLinearGradient(tile.x, tile.y, tile.x, tile.y + tile.h);
    g.addColorStop(0, school);
    g.addColorStop(1, DEEP);
    ctx.fillStyle = g;
    ctx.fillRect(tile.x, tile.y, tile.w, tile.h);
    stripes(ctx, tile.x, tile.y, tile.w, tile.h, 0.06);
    contain(ctx, logo, tile.x + 40, tile.y + 40, tile.w - 80, 380, 0.2);
    animIn(ctx, phase(t, 0.22, 0.6), 0, 140, () => placeCutout(ctx, cutout, { ...DEFAULT_BG_POS, ...(bd.bgPos || {}) }, tile.h - 30));
    ctx.restore();
    rr(ctx, tile.x, tile.y, tile.w, tile.h, 20);
    ctx.strokeStyle = alpha(GOLD, 0.9);
    ctx.lineWidth = 4;
    ctx.stroke();
  });

  // The right side.
  const rx = tile.x + tile.w + 36;
  const rw = x + VID.w - pad - rx;
  let ry = y + pad + 30;
  const measures = (bd.measures || []).filter((m) => m.value).slice(0, 8);
  if (measures.length) {
    const hy = ry;
    animIn(ctx, phase(t, 0.22, 0.38), -40, 0, () => heading(ctx, "MEASUREMENTS", rx, hy, rw));
    ry += 20;
    const perRow = Math.min(4, measures.length);
    const gap = 14;
    const mw = (rw - gap * (perRow - 1)) / perRow;
    const mh = 92;
    measures.forEach((m, i) => {
      const mx = rx + (i % perRow) * (mw + gap);
      const my = ry + Math.floor(i / perRow) * (mh + gap);
      const p = stagger(t, i, measures.length, 0.26, 0.62, 0.3);
      animIn(ctx, p, 0, 0, () => scaled(ctx, 0.7 + 0.3 * p, mx + mw / 2, my + mh / 2, () => {
        rr(ctx, mx, my, mw, mh, 12);
        ctx.fillStyle = alpha("#ffffff", 0.08);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        fit(ctx, String(m.value), mx + mw / 2, my + 56, mw - 24, 54, 22, "center");
        ctx.fillStyle = GOLD;
        ctx.letterSpacing = "1.5px";
        fit(ctx, String(m.label).toUpperCase(), mx + mw / 2, my + 81, mw - 20, 19, 11, "center", (s) => body(s, 800));
        ctx.letterSpacing = "0px";
      }));
    });
    ry += Math.ceil(measures.length / perRow) * (mh + gap) + 34;
  }
  const rows = table?.rows?.slice(-3) || [];
  if (rows.length) {
    const hy = ry;
    animIn(ctx, phase(t, 0.44, 0.58), -40, 0, () => heading(ctx, `CAREER ${table.title}`, rx, hy, rw));
    ry += 14;
    const rowH = 44;
    const yearW = 160;
    const cw = (rw - yearW) / table.cols.length;
    const cy0 = ry;
    animIn(ctx, phase(t, 0.46, 0.6), 0, 0, () => {
      ctx.fillStyle = alpha("#ffffff", 0.55);
      table.cols.forEach((c, j) => fit(ctx, c, rx + yearW + cw * j + cw / 2, cy0 + 24, cw - 10, 22, 12, "center", (s) => body(s, 800)));
    });
    ry += 34;
    const logoOf = (r) => tableLogos[table.rows.indexOf(r)];
    const all = [...rows, { year: "CAREER", vals: table.total, total: true }];
    const r0 = ry;
    all.forEach((r, i) => {
      const yy = r0 + i * rowH;
      animIn(ctx, stagger(t, i, all.length, 0.48, 0.78), 90, 0, () => {
        rr(ctx, rx, yy, rw, rowH - 6, 8);
        ctx.fillStyle = r.total ? alpha(GOLD, 0.95) : alpha("#ffffff", i % 2 ? 0.05 : 0.09);
        ctx.fill();
        if (!r.total) contain(ctx, logoOf(r), rx + 12, yy + 5, 28, 28);
        ctx.fillStyle = r.total ? NAVY : "#ffffff";
        fit(ctx, String(r.year), rx + (r.total ? 18 : 52), yy + 30, yearW - 56, 30, 16);
        r.vals.forEach((v, j) => fit(ctx, String(v || "—"), rx + yearW + cw * j + cw / 2, yy + 30, cw - 10, 30, 14, "center"));
      });
    });
    ry += all.length * rowH + 30;
  }
  // Career path, oldest on the left: teams' main logos (Logo1) on white
  // discs; the fewer the stops, the bigger each one. A stop's honors are
  // lines of their own (a high school's stars and national rank each get one).
  // A high school with no logo: its state's silhouette, as on the player
  // page (StateShape). A portal breakdown's new school (r.isNew) lands last
  // with a burst, and the ring passes to it from the old school (r.wasCurrent).
  const stops = career.slice(0, 4).map((r, i) => [r, careerLogos[i]]).reverse();
  const room = y + h - pad - ry;
  // A new stop lands last: the portal's new school, a reaction's NFL team.
  const portalOn = portalMode(bd) || reactionMode(bd);
  const newAt = portalOn ? phase(t, 0.84, 0.9) : 1; // the ring's handover
  const disc = (cx, cy, d, r) => {
    ctx.beginPath();
    ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    const ring = r.current && !r.wasCurrent ? 1 : r.wasCurrent ? 1 - newAt : 0;
    if (ring > 0) { ctx.save(); ctx.globalAlpha *= ring; ctx.lineWidth = 6; ctx.strokeStyle = GOLD; ctx.stroke(); ctx.restore(); }
  };
  const discFill = (r, l, cx, cy, d) => {
    const st = !l && r.state && states?.[r.state];
    if (l) contain(ctx, l, cx - d * 0.34, cy - d * 0.34, d * 0.68, d * 0.68);
    else if (st) drawState(ctx, st, cx, cy, d * 0.66);
    else if (r.unknown) { ctx.fillStyle = NAVY; fit(ctx, "?", cx, cy + d * 0.2, d, Math.round(d * 0.6), 20, "center"); }
    else { ctx.fillStyle = NAVY; fit(ctx, String(r.fallback || r.name || "").slice(0, 3).toUpperCase(), cx, cy + d * 0.14, d - 20, Math.round(d * 0.38), 14, "center"); }
  };
  // The new school's gold burst, rings running out as it lands.
  const burst = (cx, cy, d) => {
    const b = t == null ? 0 : clamp01((t - 0.86) / 0.14);
    if (b <= 0 || b >= 1) return;
    ctx.save();
    ctx.globalAlpha *= 1 - b;
    ctx.strokeStyle = GOLD;
    [0, 0.35].forEach((lag) => {
      const q = clamp01(b * 1.35 - lag);
      if (q <= 0) return;
      ctx.lineWidth = 10 * (1 - q) + 2;
      ctx.beginPath();
      ctx.arc(cx, cy, d / 2 + d * 0.7 * q, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  };
  if (stops.length && room > 170) {
    const hy = ry;
    animIn(ctx, phase(t, 0.6, 0.72), -40, 0, () => heading(ctx, "CAREER PATH", rx, hy, rw));
    const top = ry + 22;
    const nw = rw / stops.length;
    const accN = Math.max(0, ...stops.map(([r]) => (r.acc || []).length));
    // The old stops come in through 0.82; the new school after them.
    const isNew = (i) => portalOn && stops[i]?.[0].isNew;
    const olds = stops.filter(([r]) => !(portalOn && r.isNew)).length;
    const nodeP = (i) => (isNew(i) ? phase(t, 0.84, 0.96) : stagger(t, i, olds, 0.64, portalOn ? 0.82 : 0.98, 0.45));
    const nodePop = (i) => (isNew(i) ? pop(t, 0.84, 0.98) : nodeP(i) > 0 ? pop(t, 0.64 + i * (portalOn ? 0.05 : 0.08), 0.78 + i * (portalOn ? 0.05 : 0.08)) : 0);
    if (stops.length <= 2) {
      // One or two stops: a big logo with its words beside it, a gold chevron between.
      const d = Math.min(room - 40, 150);
      stops.forEach(([r, l], i) => {
        const nx = rx + nw * i + (i ? 34 : 0);
        const cy = top + (room - 22) / 2;
        if (isNew(i)) burst(nx + d / 2, cy, d);
        scaled(ctx, nodePop(i), nx + d / 2, cy, () => { disc(nx + d / 2, cy, d, r); discFill(r, l, nx + d / 2, cy, d); });
        animIn(ctx, nodeP(i), -30, 0, () => {
          const tx = nx + d + 22;
          const tw = rx + nw * (i + 1) - tx - (i ? 0 : 40);
          const nm = wrapFit(ctx, String(r.name).toUpperCase(), tw, 50, 24, 2);
          const acc = r.acc || [];
          let ty = cy - (nm.lines.length * nm.size * 0.95 + 36 + acc.length * 30) / 2;
          ctx.fillStyle = "#ffffff";
          ty = drawLines(ctx, nm.lines, tx, ty, nm.size, nm.size * 0.95);
          ctx.fillStyle = GOLD;
          fit(ctx, String(r.span || r.label || "").toUpperCase(), tx, ty + 30, tw, 28, 14, "left", (sz) => body(sz, 800));
          ty += 36;
          acc.forEach((a, j) => { ctx.fillStyle = "#ffffff"; fit(ctx, String(a).toUpperCase(), tx, ty + 26 + j * 30, tw, 25, 13, "left", (sz) => body(sz, 700)); });
        });
        if (i === 0 && stops.length === 2) {
          animIn(ctx, nodeP(1), -20, 0, () => {
            const ax = rx + nw + 4;
            ctx.strokeStyle = GOLD;
            ctx.lineWidth = 6;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(ax - 8, cy - 18); ctx.lineTo(ax + 8, cy); ctx.lineTo(ax - 8, cy + 18);
            ctx.stroke();
          });
        }
      });
    } else {
      // k scales a stop: logo 96·k, name 36·k (two lines), span 24·k, each honor 24·k.
      const needed = (k) => 22 + 96 * k + 8 + 2 * 36 * k * 0.95 + 32 * k + accN * 28 * k;
      let k = Math.min(1.8, nw / 205);
      while (k > 0.7 && needed(k) > room) k -= 0.05;
      const d = 96 * k;
      // The line draws across as the stops pop in (a portal's last leg —
      // over to the new school — runs out as it lands).
      if (stops.length > 1) {
        ctx.fillStyle = alpha(GOLD, 0.55);
        const last = isNew(stops.length - 1);
        const span = rw - nw - (last ? nw : 0);
        ctx.fillRect(rx + nw / 2, top + d / 2 - 3, span * phase(t, 0.64, last ? 0.8 : 0.95), 6);
        if (last) {
          ctx.fillStyle = GOLD;
          ctx.fillRect(rx + nw / 2 + span, top + d / 2 - 4, nw * phase(t, 0.8, 0.88), 8);
        }
      }
      stops.forEach(([r, l], i) => {
        const cx = rx + nw * i + nw / 2;
        if (isNew(i)) burst(cx, top + d / 2, d);
        scaled(ctx, nodePop(i), cx, top + d / 2, () => { disc(cx, top + d / 2, d, r); discFill(r, l, cx, top + d / 2, d); });
        animIn(ctx, nodeP(i), 0, 24, () => {
          ctx.fillStyle = "#ffffff";
          const nm = wrapFit(ctx, String(r.name).toUpperCase(), nw - 18, Math.round(36 * k), 20, 2);
          let ty = drawLines(ctx, nm.lines, cx, top + d + 8 * k, nm.size, nm.size * 0.95, "center");
          ctx.fillStyle = GOLD;
          fit(ctx, String(r.span || r.label || "").toUpperCase(), cx, ty + 26 * k, nw - 16, Math.round(24 * k), 13, "center", (sz) => body(sz, 800));
          ty += 32 * k;
          (r.acc || []).forEach((a, j) => {
            ctx.fillStyle = "#ffffff";
            fit(ctx, String(a).toUpperCase(), cx, ty + 24 * k + j * 28 * k, nw - 14, Math.round(24 * k), 13, "center", (sz) => body(sz, 700));
          });
        });
      });
    }
  }
  ctx.restore();
}

// The verdict: three chips (those included). step = how many are revealed;
// 0 is the empty card. Animated: coming in (tin) the card fills in and the
// empty chips rise in turn; a reveal (view.anim "reveal", at view.t) flips
// the step-th chip open and builds what's on it.
function cardVerdict(ctx, bd, view, { fitLogos, compLogo, branding }, tin) {
  cardShell(ctx, phase(tin, 0, 0.25));
  const { x, y, w, h } = VID;
  cardTitle(ctx, "THE VERDICT", y + 96, phase(tin, 0.1, 0.35));
  const items = verdictShown(bd);
  const step = view.step || 0;
  const rt = view.anim === "reveal" ? view.t : undefined;
  const revealing = view.anim === "reveal" ? step - 1 : -1;
  const pad = 44;
  const gap = 30;
  const n = Math.max(items.length, 1);
  const cw = Math.min(560, (w - pad * 2 - gap * (n - 1)) / n);
  const left = x + (w - (cw * n + gap * (n - 1))) / 2;
  const top = y + 156;
  const ch = h - 156 - pad;
  const imgs = { fitLogos, compLogo, branding };
  items.forEach((key, i) => {
    const cx = left + i * (cw + gap);
    const mid = cx + cw / 2;
    const geo = { cx, mid, top, cw, ch };
    animIn(ctx, stagger(tin, i, items.length, 0.25, 0.8), 0, 70, () => {
      if (i !== revealing || rt == null) {
        drawVerdictChip(ctx, bd, key, i < step, geo, imgs, undefined);
        return;
      }
      // The flip: the empty chip narrows away, the open one widens in, then fills.
      const opening = rt >= 0.22;
      const sx = opening ? phase(rt, 0.22, 0.48) : 1 - ease(clamp01(rt / 0.22));
      ctx.save();
      ctx.translate(mid, top + ch / 2);
      ctx.scale(Math.max(0.001, sx), 1);
      ctx.translate(-mid, -(top + ch / 2));
      drawVerdictChip(ctx, bd, key, opening, geo, imgs, opening ? rt : undefined, pulse(rt, 0.3, 0.9));
      ctx.restore();
    });
  });
  ctx.restore();
}
// One verdict chip, open (revealed) or not. it: the reveal's time (its
// contents build from 0.45 on); glow: the gold flash around it.
function drawVerdictChip(ctx, bd, key, open, { cx, mid, top, cw, ch }, { fitLogos, compLogo, branding }, it, glow = 0) {
  const titles = { grade: "DRAFT GRADE", comp: "PLAYER COMP", fits: "TEAM FITS" };
  const look = key === "grade" && bd.grade ? gradeLook(bd.grade) : null;
  const compTeam = key === "comp" && bd.comp?.team ? branding[bd.comp.team] || {} : null;
  ctx.save();
  rr(ctx, cx, top, cw, ch, 22);
  ctx.clip();
  if (open && look) {
    const g = ctx.createLinearGradient(cx, top, cx, top + ch);
    g.addColorStop(0, look.bg);
    g.addColorStop(1, look.border);
    ctx.fillStyle = g;
  } else if (open && compTeam?.Color1) {
    const g = ctx.createLinearGradient(cx, top, cx, top + ch);
    g.addColorStop(0, compTeam.Color1);
    g.addColorStop(1, DEEP);
    ctx.fillStyle = g;
  } else ctx.fillStyle = alpha("#ffffff", 0.06);
  ctx.fillRect(cx, top, cw, ch);
  if (open && (look || compTeam)) stripes(ctx, cx, top, cw, ch, 0.06);
  if (open && key === "comp" && compLogo) animIn(ctx, phase(it, 0.45, 0.8), 0, 0, () => contain(ctx, compLogo, cx - cw * 0.15, top + ch * 0.18, cw * 1.3, ch * 0.75, 0.13));
  ctx.restore();
  ctx.save();
  if (glow > 0) { ctx.shadowColor = GOLD; ctx.shadowBlur = 50 * glow; }
  rr(ctx, cx, top, cw, ch, 22);
  ctx.strokeStyle = open ? GOLD : alpha("#ffffff", 0.14);
  ctx.lineWidth = 4 + 4 * glow;
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = open && (look || compTeam) ? "#ffffff" : GOLD;
  ctx.letterSpacing = "1px";
  fit(ctx, titles[key], mid, top + 62, cw - 40, 40, 18, "center");
  ctx.letterSpacing = "0px";
  if (!open) {
    ctx.fillStyle = alpha("#ffffff", 0.12);
    fit(ctx, "?", mid, top + ch / 2 + 90, cw, 240, 80, "center");
    return;
  }
  if (key === "grade" && look) {
    // The round, as big as the chip takes: EARLY / 1ST / FIRST ROUND.
    const round = String(bd.grade).replace(/^(Early|Middle|Late)\s+/i, "").toUpperCase();
    let yy = top + 90 + (ch - 130) * 0.08;
    if (look.qualifier) {
      const qy = yy;
      animIn(ctx, phase(it, 0.5, 0.7), 0, -30, () => { ctx.fillStyle = alpha("#ffffff", 0.9); fit(ctx, look.qualifier, mid, qy + 70, cw - 60, 84, 30, "center"); });
      yy += 80;
    }
    const by = yy + (look.qualifier ? 250 : 290);
    scaled(ctx, pop(it, 0.45, 0.75), mid, by - 100, () => {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = "#ffffff";
      fit(ctx, look.short.toUpperCase(), mid, by, cw - 50, look.qualifier ? 280 : 330, 80, "center");
      ctx.restore();
    });
    animIn(ctx, phase(it, 0.65, 0.9), 0, 40, () => {
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      rr(ctx, cx + 30, top + ch - 104, cw - 60, 70, 35);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      fit(ctx, round, mid, top + ch - 53, cw - 100, 50, 22, "center");
    });
  } else if (key === "comp" && bd.comp?.name) {
    // His name stacked big, then where he went in the draft, then why.
    const parts = String(bd.comp.name).toUpperCase().split(/\s+/);
    const first = parts.length > 1 ? parts.slice(0, -1).join(" ") : "";
    const last = parts[parts.length - 1];
    const note = bd.compNote ? wrapLines(ctx, bd.compNote, cw - 64, 28, 4, (s) => body(s, 600)) : [];
    const noteH = note.length * 35;
    let yy = top + 96;
    if (compLogo) { const ly = yy; scaled(ctx, pop(it, 0.45, 0.7), mid, ly + 65, () => contain(ctx, compLogo, mid - 80, ly, 160, 130)); yy += 150; }
    if (first) { const fy = yy; animIn(ctx, phase(it, 0.52, 0.75), 0, 40, () => { ctx.fillStyle = "#ffffff"; fit(ctx, first, mid, fy + 66, cw - 50, 76, 30, "center"); }); yy += 76; }
    // The last name's size, worked out up front (it sets where the rest goes).
    ctx.font = disp(136);
    const lastW = ctx.measureText(last).width;
    const ls = lastW > cw - 40 ? Math.max(40, Math.floor(136 * ((cw - 40) / lastW))) : 136;
    const lyy = yy;
    animIn(ctx, phase(it, 0.58, 0.82), 0, 50, () => { ctx.fillStyle = GOLD; fit(ctx, last, mid, lyy + 118, cw - 40, 136, 40, "center"); });
    yy += Math.max(70, ls * 0.88) + 16;
    const iy = yy;
    animIn(ctx, phase(it, 0.68, 0.9), 0, 20, () => {
      let zy = iy;
      ctx.fillStyle = "#ffffff";
      ctx.letterSpacing = "1px";
      if (compLine(bd.comp)) { fit(ctx, compLine(bd.comp), mid, zy + 28, cw - 50, 30, 14, "center", (s) => body(s, 800)); zy += 38; }
      ctx.fillStyle = alpha("#ffffff", 0.7);
      if (bd.comp.school) { fit(ctx, String(bd.comp.school).toUpperCase(), mid, zy + 26, cw - 50, 24, 12, "center", (s) => body(s, 700)); zy += 34; }
      ctx.letterSpacing = "0px";
      if (note.length) {
        const ny = Math.max(zy + 14, top + ch - 50 - noteH);
        ctx.fillStyle = alpha("#ffffff", 0.9);
        drawLines(ctx, note, mid, ny, 28, 35, "center", (s) => body(s, 600));
      }
    });
  } else if (key === "fits") {
    const fits = (bd.fits || []).filter(Boolean).slice(0, MAX_FITS);
    const rowH = Math.min(170, (ch - 100) / Math.max(fits.length, 1));
    fits.forEach((abbr, j) => {
      const ry = top + 96 + j * rowH;
      animIn(ctx, stagger(it, j, fits.length, 0.45, 0.95), 60, 0, () => {
        if (j) { ctx.fillStyle = alpha("#ffffff", 0.12); ctx.fillRect(cx + 30, ry, cw - 60, 2); }
        const ls = rowH - 34;
        contain(ctx, fitLogos[j], cx + 28, ry + 17, ls, ls);
        const b = branding[abbr] || {};
        const tx = cx + 28 + ls + 22;
        ctx.fillStyle = alpha("#ffffff", 0.65);
        fit(ctx, String(b.City || teamNameFromAbbr(abbr).replace(/\s+\S+$/, "")).toUpperCase(), tx, ry + rowH / 2 - 10, cx + cw - tx - 20, 26, 12, "left", (s) => body(s, 800));
        ctx.fillStyle = "#ffffff";
        fit(ctx, String(b.Team || teamNameFromAbbr(abbr).split(" ").pop()).toUpperCase(), tx, ry + rowH / 2 + 40, cx + cw - tx - 20, 60, 20);
      });
    });
  }
}

// The community's grade and top traits, and the call to grade him — GRADE
// HIM YOURSELF and the We-Draft.com logo filling a gold bar. Animated: the
// card fills in, the grade pops, the bars fill, the gold bar rises and the
// logo pops, pulses and shines.
function cardCommunity(ctx, bd, { commFitLogos, wdOutline: wd }, t) {
  cardShell(ctx, phase(t, 0, 0.25));
  const { x, y, w, h } = VID;
  cardTitle(ctx, "WE-DRAFT.COM COMMUNITY GRADE", y + 96, phase(t, 0.1, 0.35));
  const c = bd.community || {};
  const pad = 44;
  const ctaH = 156;
  const top = y + 150;
  const bottom = y + h - pad - ctaH - 24;
  if (!c.count) {
    animIn(ctx, phase(t, 0.25, 0.5), 0, 30, () => {
      ctx.fillStyle = "#ffffff";
      fit(ctx, "NO COMMUNITY GRADES YET", x + w / 2, top + (bottom - top) / 2, w - 200, 80, 30, "center");
      ctx.fillStyle = GOLD;
      fit(ctx, "BE THE FIRST TO GRADE HIM", x + w / 2, top + (bottom - top) / 2 + 70, w - 200, 50, 24, "center");
    });
  } else {
    // The grade.
    const gw = 380;
    const label = gradeLabel(c.avg) || "";
    const look = gradeLook(label);
    const s = 230;
    const gx = x + pad + (gw - s) / 2;
    scaled(ctx, pop(t, 0.2, 0.45), gx + s / 2, top + 30 + s / 2, () => {
      rr(ctx, gx, top + 30, s, s, 28);
      ctx.fillStyle = look.bg;
      ctx.fill();
      ctx.strokeStyle = look.border;
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      if (look.qualifier) fit(ctx, look.qualifier, gx + s / 2, top + 88, s - 30, 42, 16, "center");
      fit(ctx, look.short.toUpperCase(), gx + s / 2, top + 30 + (look.qualifier ? 190 : 165), s - 30, 140, 40, "center");
    });
    animIn(ctx, phase(t, 0.35, 0.5), 0, 20, () => { ctx.fillStyle = "#ffffff"; fit(ctx, label.toUpperCase(), x + pad + gw / 2, top + s + 82, gw - 20, 44, 20, "center"); });
    const fl = commFitLogos.filter(Boolean);
    if (fl.length) {
      const ls = 64;
      const fx = x + pad + gw / 2 - (fl.length * (ls + 14) - 14) / 2;
      fl.forEach((l, i) => scaled(ctx, pop(t, 0.42 + i * 0.05, 0.58 + i * 0.05), fx + i * (ls + 14) + ls / 2, top + s + 112 + ls / 2, () => contain(ctx, l, fx + i * (ls + 14), top + s + 112, ls, ls)));
    }
    // The traits, as bars.
    const colX = x + pad + gw + 40;
    const colW = (x + w - pad - colX - 40) / 2;
    [["TOP STRENGTHS", c.strengths || [], GREEN], ["TOP WEAKNESSES", c.weaknesses || [], RED]].forEach(([title, list, color], k) => {
      const cx = colX + k * (colW + 40);
      animIn(ctx, phase(t, 0.28 + k * 0.05, 0.42 + k * 0.05), -30, 0, () => heading(ctx, title, cx, top + 50, colW, 36));
      const rows = list.slice(0, 4);
      const rowH = Math.min(96, (bottom - top - 80) / Math.max(rows.length, 1));
      rows.forEach((r, i) => {
        const ry = top + 80 + i * rowH;
        const p = stagger(t, i, rows.length, 0.34 + k * 0.05, 0.8 + k * 0.05);
        animIn(ctx, Math.min(1, p * 2), 0, 0, () => {
          ctx.fillStyle = "#ffffff";
          fit(ctx, String(r.term).toUpperCase(), cx, ry + 36, colW - 80, 36, 18);
          ctx.fillStyle = alpha("#ffffff", 0.75);
          fit(ctx, `${Math.round(r.pct * p)}%`, cx + colW, ry + 36, 80, 28, 14, "right", (sz) => body(sz, 800));
          rr(ctx, cx, ry + 50, colW, 14, 7);
          ctx.fillStyle = alpha("#ffffff", 0.12);
          ctx.fill();
          rr(ctx, cx, ry + 50, Math.max(14, colW * Math.min(1, r.pct / 100) * p), 14, 7);
          ctx.fillStyle = color;
          ctx.fill();
        });
      });
    });
  }
  // The call to action: GRADE HIM YOURSELF, the logo filling the rest —
  // the outlined blue We-Draft.com, on the site's own gold whatever the
  // theme (it's We-Draft.com's box).
  const bar = { x: x + pad, y: y + h - pad - ctaH, w: w - pad * 2, h: ctaH, r: 24 };
  animIn(ctx, phase(t, 0.55, 0.75), 0, 80, () => {
    rr(ctx, bar.x, bar.y, bar.w, bar.h, bar.r);
    ctx.fillStyle = SITE.GOLD;
    ctx.fill();
    const inner = 40;
    const lh = Math.min(96, bar.h - 56);
    const lw = wd ? Math.min((wd.width / wd.height) * lh, bar.w * 0.55) : 0;
    const tw = bar.w - inner * 3 - lw;
    ctx.fillStyle = SITE.NAVY;
    const words = wrapFit(ctx, String(bd.cta || "GRADE HIM YOURSELF").toUpperCase(), tw, 72, 30, 2);
    const blockH = words.lines.length * words.size * 0.92;
    drawLines(ctx, words.lines, bar.x + inner, bar.y + (bar.h - blockH) / 2 - words.size * 0.06, words.size, words.size * 0.92);
    if (wd) {
      const lh2 = (wd.height / wd.width) * lw;
      const lx = bar.x + bar.w - inner - lw;
      const ly = bar.y + (bar.h - lh2) / 2;
      const s = pop(t, 0.68, 0.84) * (1 + 0.06 * (pulse(t, 0.84, 0.92) + pulse(t, 0.92, 1)));
      scaled(ctx, s, lx + lw / 2, ly + lh2 / 2, () => contain(ctx, wd, lx, ly, lw, lh2));
    }
    shine(ctx, bar, phase(t, 0.82, 1));
  });
  ctx.restore();
}

// A cutout placed by { x (its center), y (its feet), s (size) }; h0 is its height at size 1.
function placeCutout(ctx, img, pos, h0) {
  if (!img) return;
  const h = h0 * (pos.s || 1);
  const w = (img.width / img.height) * h;
  ctx.drawImage(img, pos.x - w / 2, pos.y - h, w, h);
}
export const DEFAULT_THUMB_POS = { x: 1390, y: H, s: 1 };
const THUMB_H = 1000;

// The title card — the video's thumbnail (a still), built to hit at eye
// level (user, 2026-11-24, after a "HE'S HOW OLD?!" reference): site blue
// with the frames' diagonal lines (no school logo behind), a gold bar down the left edge, his cutout on
// the right, We-Draft.com big and anchored to the bottom. Heavy type
// (Montserrat Black). Two layouts (bd.thumbMode):
//   "name" (default)  his name, big — first gold, last white; under it his
//                     position and school LOGO (not its name); under that
//                     the draft graphic (the class's draft logo + BREAKDOWN)
//   "hook"            2–3 typed words (bd.thumbHook), huge, white, one line
//                     a word (or the lines as typed); his name a gold eyebrow
// The thumbnail's highlight words (first name, eyebrow): the accent, or —
// when the accent is white (a team with no light color) — a light tint of
// the main color, so they still differ from the white words.
const lighten = (hex, k) => {
  const n = parseInt(String(hex).trim().replace("#", ""), 16);
  const ch = (v) => Math.round(v + (255 - v) * k).toString(16).padStart(2, "0");
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
};
const highlight = () => (lum(GOLD) > 0.85 ? lighten(BLUE, 0.55) : GOLD);
const HEAVY = '"Montserrat", "Arial Black", Impact, sans-serif';
const heavy = (s) => `900 ${s}px ${HEAVY}`;
// Words at the biggest size from max down that fits maxW.
function heavyFit(ctx, text, x, y, maxW, max, min = 40) {
  let s = max;
  ctx.font = heavy(s);
  while (s > min && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = heavy(s); }
  ctx.fillText(text, x, y);
  return s;
}
const hookLines = (text) => {
  const t = String(text || "").toUpperCase().trim();
  if (!t) return [];
  return (t.includes("\n") ? t.split("\n") : t.split(/\s+/)).map((l) => l.trim()).filter(Boolean).slice(0, 4);
};
// The thumbnail's text pieces, each moved (dx, dy) and sized (s) by the
// admin — dragged on the preview, sized in the editor (bd.thumbLayout).
// By default they all fit the left half: he takes up the right.
export const THUMB_PIECES = {
  name: "Player name", info: "School logo + position", eyebrow: "Name eyebrow", hook: "Hook words", graphic: "Draft Breakdown graphic",
};
const TEXT_W = 860;
function drawTitle(ctx, bd, { logo, cutout, draft, wd }) {
  const g = ctx.createLinearGradient(0, 0, W * 0.7, H);
  g.addColorStop(0, BLUE);
  g.addColorStop(1, DEEP);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // The diagonal lines the other frames use (no school logo behind him).
  stripes(ctx, 0, 0, W, H);
  placeCutout(ctx, cutout, { ...DEFAULT_THUMB_POS, ...(bd.thumbPos || {}) }, THUMB_H);
  // The gold bar.
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, 0, 26, H);
  const x = 80;
  const maxW = TEXT_W;
  // A soft shadow under the words, so they lift off the dots.
  const shadowed = (fn) => {
    ctx.save();
    ctx.shadowColor = "rgba(0,10,30,0.55)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    fn();
    ctx.restore();
  };
  // A piece drawn at its default place (box: x, y, h), then moved and
  // sized about its top-left corner; fn returns its drawn width. Its box
  // (where it ended up) is kept on the canvas for dragging.
  const boxes = {};
  const piece = (key, box, fn) => {
    const L = { dx: 0, dy: 0, s: 1, ...(bd.thumbLayout?.[key] || {}) };
    ctx.save();
    ctx.translate(box.x + L.dx, box.y + L.dy);
    ctx.scale(L.s, L.s);
    ctx.translate(-box.x, -box.y);
    const w = fn() || maxW;
    ctx.restore();
    boxes[key] = { x: box.x + L.dx, y: box.y + L.dy, w: w * L.s, h: box.h * L.s };
  };
  // The draft graphic, as a logo (user, 2026-11-24): the pro day badge's
  // Combine-style shape (utils/proDayIcon.js SILHOUETTE) in site navy with
  // a white sticker edge — the class's draft logo (else DRAFT) in the dome,
  // BREAKDOWN on the gold band, the class year in the point. Sized to sit
  // under the words, not compete with them.
  const BADGE_K = 0.34;
  const badgeW = (913 - 87) * BADGE_K;
  const badgeH = (862 - 145) * BADGE_K;
  const graphic = (gy) => piece("graphic", { x, y: gy, h: badgeH }, () => {
    const k = BADGE_K;
    ctx.save();
    ctx.translate(x - 87 * k + 6, gy - 145 * k);
    ctx.scale(k, k);
    const shape = new Path2D(SILHOUETTE);
    // White sticker edge with a soft drop shadow.
    ctx.save();
    ctx.shadowColor = "rgba(0,10,30,0.5)";
    ctx.shadowBlur = 50;
    ctx.shadowOffsetY = 18;
    ctx.lineJoin = "round";
    ctx.lineWidth = 40;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke(shape);
    ctx.fillStyle = "#ffffff";
    ctx.fill(shape);
    ctx.restore();
    const sg = ctx.createLinearGradient(0, 145, 0, 862);
    sg.addColorStop(0, BLUE);
    sg.addColorStop(1, DEEP);
    ctx.fillStyle = sg;
    ctx.fill(shape);
    // The band: gold, white rules above and below, kept inside the shape.
    ctx.save();
    ctx.clip(shape);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, BAND.ruleTop, 1000, BAND.ruleBottom - BAND.ruleTop);
    ctx.fillStyle = GOLD;
    ctx.fillRect(0, BAND.top, 1000, BAND.bottom - BAND.top);
    ctx.restore();
    ctx.fillStyle = NAVY;
    ctx.letterSpacing = "6px";
    fit(ctx, reactionMode(bd) ? "REACTION" : "BREAKDOWN", 500, 583, 790, 200, 80, "center");
    // The dome: the draft logo, else DRAFT.
    if (draft) contain(ctx, draft, 250, 120, 500, 290);
    else { ctx.fillStyle = "#ffffff"; fit(ctx, "DRAFT", 500, 375, 560, 170, 60, "center"); }
    // The point: the class.
    if (bd.cls) { ctx.fillStyle = GOLD; fit(ctx, String(bd.cls), 500, 770, 380, 140, 60, "center"); }
    ctx.letterSpacing = "0px";
    ctx.restore();
    return badgeW;
  });
  const hook = bd.thumbMode === "hook" ? hookLines(bd.thumbHook) : [];
  if (hook.length) {
    // The eyebrow: his name, gold.
    piece("eyebrow", { x, y: 60, h: 100 }, () => {
      let w = 0;
      shadowed(() => { ctx.fillStyle = highlight(); const s = heavyFit(ctx, fullName(bd) || "PLAYER NAME", x, 146, maxW, 96, 36); ctx.font = heavy(s); w = ctx.measureText(fullName(bd) || "PLAYER NAME").width; });
      return w;
    });
    // The words: one size for all, as big as the longest line and the room allow.
    const top = 180;
    const bottom = 650;
    let s = Math.min(250, Math.floor((bottom - top) / (hook.length * 0.96)));
    ctx.font = heavy(s);
    while (s > 60 && hook.some((l) => ctx.measureText(l).width > maxW)) { s -= 4; ctx.font = heavy(s); }
    const lh = s * 0.96;
    piece("hook", { x, y: top, h: hook.length * lh }, () => {
      ctx.font = heavy(s);
      const w = Math.max(...hook.map((l) => ctx.measureText(l).width));
      shadowed(() => {
        ctx.fillStyle = "#ffffff";
        ctx.font = heavy(s);
        hook.forEach((l, i) => ctx.fillText(l, x - s * 0.03, top + s * 0.76 + i * lh));
      });
      return w;
    });
    graphic(top + hook.length * lh + 30);
  } else {
    // His name, big and tight: the last name right under the first (cap
    // heights, not font boxes, set the gap), a touch of negative tracking.
    const first = String(bd.first || "FIRST").toUpperCase();
    const last = String(bd.last || "LAST").toUpperCase();
    const CAP = 0.72;
    ctx.letterSpacing = "-3px";
    const sizeFor = (text, max, min) => { let s = max; ctx.font = heavy(s); while (s > min && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = heavy(s); } return s; };
    const s1 = sizeFor(first, 180, 60);
    const s2 = sizeFor(last, 260, 80);
    ctx.letterSpacing = "0px";
    const top = 84;
    const b1 = top + CAP * s1;
    const b2 = b1 + 20 + CAP * s2;
    piece("name", { x, y: top, h: b2 - top }, () => {
      let w = 0;
      shadowed(() => {
        ctx.letterSpacing = "-3px";
        ctx.fillStyle = highlight();
        ctx.font = heavy(s1);
        ctx.fillText(first, x - 4, b1);
        w = ctx.measureText(first).width;
        ctx.fillStyle = "#ffffff";
        ctx.font = heavy(s2);
        ctx.fillText(last, x - 8, b2);
        w = Math.max(w, ctx.measureText(last).width);
        ctx.letterSpacing = "0px";
      });
      return w;
    });
    // Position and the school's logo (its dark-background version).
    const iy = b2 + 34;
    const ih = 120;
    piece("info", { x, y: iy, h: ih }, () => {
      let ix = x;
      if (logo) {
        const lw = Math.min((logo.width / logo.height) * ih, 400);
        shadowed(() => contain(ctx, logo, ix, iy, lw, ih));
        ix += lw + 30;
      }
      // A reaction: the NFL team's logo and where he went.
      const info = (reactionMode(bd) ? [bd.pos, bd.pick && `PICK ${bd.pick}`] : [bd.pos]).filter(Boolean).join(" · ").toUpperCase();
      if (info) {
        if (logo) { ctx.fillStyle = alpha("#ffffff", 0.35); ctx.fillRect(ix - 16, iy + 16, 5, ih - 32); ix += 14; }
        let fs = 78;
        ctx.font = heavy(fs);
        while (fs > 36 && ctx.measureText(info).width > maxW - (ix - x)) { fs -= 2; ctx.font = heavy(fs); }
        ctx.fillStyle = "#ffffff";
        ctx.fillText(info, ix, iy + ih / 2 + fs * 0.36);
        ix += ctx.measureText(info).width;
      }
      return ix - x;
    });
    graphic(iy + ih + 40);
  }
  // We-Draft.com, anchored to the bottom.
  if (wd) {
    const lw = TEXT_W;
    const lh = (wd.height / wd.width) * lw;
    shadowed(() => ctx.drawImage(wd, x - 6, H - 34 - lh, lw, lh));
  }
  ctx.canvas.titleBoxes = boxes;
}

// ── Transfer portal ──
// The move as it stands: from his old school to his new one ("" while he's
// still in the portal).
const portalMode = (bd) => bd.mode === "portal";
const schoolLogo = (brand, dark) => (brand ? (dark ? brand.LogoDark || brand.Logo1 : brand.Logo1 || brand.LogoDark) : "") || "";
// Three gold chevrons pointing down, drawn in turn (p0…p2).
function chevrons(ctx, cx, y, ps, size = 18) {
  ps.forEach((p, k) => animIn(ctx, p, 0, -10, () => {
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(cx - size, y + k * size);
    ctx.lineTo(cx, y + k * size + size * 0.75);
    ctx.lineTo(cx + size, y + k * size);
    ctx.stroke();
  }));
}
// A school on a white disc (its main logo), or a "?" for a school to come.
function schoolDisc(ctx, cx, cy, d, logo, ring) {
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  if (ring) { ctx.lineWidth = 6; ctx.strokeStyle = GOLD; ctx.stroke(); }
  if (logo) contain(ctx, logo, cx - d * 0.34, cy - d * 0.34, d * 0.68, d * 0.68);
  else { ctx.fillStyle = NAVY; fit(ctx, "?", cx, cy + d * 0.2, d, Math.round(d * 0.6), 20, "center"); }
}

// Portal intro: THE MOVE — the old school (dimming once he's left), the
// arrow, the new school popping in with a gold burst; then the subscribe
// button. Animated in the intro's clip.
function panelMove(ctx, bd, { fromLogo, toLogo }, t) {
  const b = panelShell(ctx, "THE MOVE", GOLD, NAVY, DEEP, RIBBON_H, 40, phase(t, 0, 0.15));
  stripes(ctx, b.x, b.y, b.w, b.h, 0.05);
  const cx = b.x + b.w / 2;
  const label = (text, y) => { ctx.fillStyle = GOLD; ctx.letterSpacing = "3px"; fit(ctx, text, cx, y, b.w - 40, 22, 12, "center", (s) => body(s, 800)); ctx.letterSpacing = "0px"; };
  let y = b.y + 18;
  // From.
  const d1 = 96;
  const fy = y;
  animIn(ctx, phase(t, 0.04, 0.2), 0, -30, () => {
    ctx.save();
    ctx.globalAlpha *= 1 - 0.45 * phase(t, 0.3, 0.45);
    label("FROM", fy + 16);
    schoolDisc(ctx, cx, fy + 26 + d1 / 2, d1, fromLogo, false);
    ctx.fillStyle = "#ffffff";
    fit(ctx, String(bd.fromSchool || "").toUpperCase(), cx, fy + 26 + d1 + 34, b.w - 40, 32, 18, "center");
    ctx.restore();
  });
  y += 26 + d1 + 46;
  chevrons(ctx, cx, y, [phase(t, 0.3, 0.4), phase(t, 0.35, 0.45), phase(t, 0.4, 0.5)], 16);
  y += 58;
  // To.
  const d2 = 130;
  const dc = y + 26 + d2 / 2;
  const ty = y;
  animIn(ctx, phase(t, 0.46, 0.56), 0, 0, () => label(bd.toSchool ? "TO" : "NEXT STOP", ty + 16));
  const burst = t == null ? 0 : clamp01((t - 0.56) / 0.3);
  if (burst > 0 && burst < 1) {
    ctx.save();
    ctx.globalAlpha *= 1 - burst;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 8 * (1 - burst) + 2;
    ctx.beginPath();
    ctx.arc(cx, dc, d2 / 2 + 60 * burst, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  scaled(ctx, pop(t, 0.5, 0.68), cx, dc, () => schoolDisc(ctx, cx, dc, d2, bd.toSchool ? toLogo : null, true));
  const ny = dc + d2 / 2;
  animIn(ctx, phase(t, 0.6, 0.76), 0, 20, () => {
    ctx.fillStyle = "#ffffff";
    fit(ctx, String(bd.toSchool || "IN THE PORTAL").toUpperCase(), cx, ny + 40, b.w - 40, 38, 18, "center");
    if (bd.toSchool) label("COMMITTED", ny + 68);
  });
  // Subscribe.
  const bh = 76;
  const bw = b.w - 56;
  const bx = b.x + 28;
  const by = b.y + b.h - bh - 22;
  const beat = pulse(t, 0.86, 0.98);
  scaled(ctx, pop(t, 0.74, 0.86) * (1 + 0.06 * beat), cx, by + bh / 2, () => {
    ctx.save();
    ctx.shadowColor = `rgba(255,0,0,${0.35 + 0.45 * beat})`;
    ctx.shadowBlur = 20 + 26 * beat;
    ctx.shadowOffsetY = 5;
    rr(ctx, bx, by, bw, bh, 14);
    ctx.fillStyle = "#ff0000";
    ctx.fill();
    ctx.restore();
    const px = bx + 46;
    rr(ctx, px - 24, by + bh / 2 - 17, 48, 34, 10);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(px - 6, by + bh / 2 - 9);
    ctx.lineTo(px + 10, by + bh / 2);
    ctx.lineTo(px - 6, by + bh / 2 + 9);
    ctx.closePath();
    ctx.fillStyle = "#ff0000";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    fit(ctx, "SUBSCRIBE", px + 38, by + bh / 2 + 18, bw - 90, 54, 22);
    shine(ctx, { x: bx, y: by, w: bw, h: bh, r: 14 }, phase(t, 0.84, 1));
  });
}

// The portal thumbnail (its own vibe — user, 2026-11-24): he's changing
// teams. The top-left corner is the old school — its colors, its logo —
// cut off by a diagonal in the new school's accent with the portal's arrows
// on it; everything else is the new school (the theme): its colors, its
// logo behind him. TRANSFER PORTAL BREAKDOWN, the name, the move, We-Draft.com.
function drawTitlePortal(ctx, bd, { cutout, wd, portal, fromLogoDark, fromLogo, toLogoDark }) {
  backdrop(ctx, 0, 0, W, H, BLUE, DEEP);
  if (bd.toSchool) contain(ctx, toLogoDark, 940, 40, 940, 940, 0.16);
  // The old school's corner.
  const cw = 760;
  const ch = 520;
  const c1 = bd.fromBrand?.Color1;
  const c2 = bd.fromBrand?.Color2;
  const raw = isHex(c1) && lum(c1) < 0.6 ? c1 : isHex(c2) && lum(c2) < 0.6 ? c2 : "#3a4556";
  const fc = `#${String(raw).trim().replace("#", "")}`;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(cw, 0); ctx.lineTo(0, ch); ctx.closePath();
  ctx.clip();
  const g = ctx.createLinearGradient(0, 0, cw * 0.5, ch * 0.7);
  g.addColorStop(0, fc);
  g.addColorStop(1, darken(fc, 0.45));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);
  stripes(ctx, 0, 0, cw, ch, 0.06);
  contain(ctx, fromLogoDark || fromLogo, 40, 34, 330, 250);
  ctx.restore();
  // The cut: an accent band with a white edge, the portal's arrows on it.
  const cut = (off, color, lw) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(cw + off, -20);
    ctx.lineTo(-20, ch + off * (ch / cw) + 14);
    ctx.stroke();
  };
  cut(14, GOLD, 26);
  cut(34, alpha("#ffffff", 0.85), 6);
  const mx = cw / 2 + 12;
  const my = ch / 2 + 8;
  ctx.beginPath();
  ctx.arc(mx, my, 66, 0, Math.PI * 2);
  ctx.fillStyle = NAVY;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = GOLD;
  ctx.stroke();
  contain(ctx, portal, mx - 42, my - 42, 84, 84);
  placeCutout(ctx, cutout, { ...DEFAULT_THUMB_POS, ...(bd.thumbPos || {}) }, THUMB_H);
  // The words, under the corner.
  const x = 96;
  ctx.font = disp(46);
  const badge = "TRANSFER PORTAL BREAKDOWN";
  const bw = ctx.measureText(badge).width + 48;
  rr(ctx, x, 560, bw, 64, 32);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.fillStyle = NAVY;
  fit(ctx, badge, x + bw / 2, 607, bw - 30, 46, 20, "center");
  ctx.fillStyle = "#ffffff";
  fit(ctx, String(bd.first || "FIRST").toUpperCase(), x, 752, 860, 140, 60);
  ctx.fillStyle = GOLD;
  fit(ctx, String(bd.last || "LAST").toUpperCase(), x - 4, 930, 900, 210, 80);
  ctx.fillStyle = "#ffffff";
  ctx.letterSpacing = "2px";
  const move = bd.toSchool ? `${bd.fromSchool || "?"} → ${bd.toSchool}` : `${bd.fromSchool || bd.school} · IN THE PORTAL`;
  fit(ctx, [bd.pos, move].filter(Boolean).join("  ·  ").toUpperCase(), x + 4, 990, 860, 44, 18, "left", (sz) => body(sz, 800));
  ctx.letterSpacing = "0px";
  contain(ctx, wd, x, 1012, 420, 52, 1, true);
}

// The career path a portal breakdown shows: the new school (or "?" while
// he's still in the portal) is his newest stop, the old one no longer
// current. A draft breakdown's is the player page's as is.
function careerOf(bd, branding = {}) {
  const rows = (bd.career || []).filter((r) => !(bd.hideCareer || {})[r.key]).map((r) => ({ ...r }));
  // A reaction: the team that drafted him is his newest stop (user, 2026-11-24).
  if (reactionMode(bd)) {
    if (!bd.nflTeam) return rows;
    const b = branding?.[bd.nflTeam] || {};
    rows.forEach((r) => { if (r.current) { r.current = false; r.wasCurrent = true; } });
    return [{
      key: "nfl", name: nflTeamName(bd, branding), span: pickLine(bd) || `${bd.cls || ""} NFL DRAFT`.trim(), isNew: true, current: true, acc: [],
      logo: b.Logo1 || b.LogoDark || "",
    }, ...rows];
  }
  if (!portalMode(bd)) return rows;
  const to = bd.toSchool;
  const from = rows.find((r) => r.name === bd.fromSchool) || rows.find((r) => r.current) || null;
  if (from && from.name !== to) { from.current = false; from.wasCurrent = true; }
  if (to && rows[0]?.name === to) {
    rows[0] = { ...rows[0], isNew: true, current: true, span: "COMMITTED", acc: [] };
    return rows;
  }
  return [{
    key: "portal-to", name: to || "Transfer Portal", span: to ? "COMMITTED" : "NEXT STOP", isNew: true, current: true, acc: [],
    logo: to ? schoolLogo(bd.toBrand) : "", unknown: !to,
  }, ...rows];
}

// The states' outlines (utils/usStatesGeo — StateShape's), loaded once.
let statesP = null;
const stateOutlines = () => {
  statesP ||= import("../utils/usStatesGeo").then((m) => m.usStates()).catch(() => { statesP = null; return null; });
  return statesP;
};
// A state's silhouette, north up (its straightened outline), size across
// its long side, centered on (cx, cy) — StateShape's blue gradient, white edge.
function drawState(ctx, st, cx, cy, size) {
  const [x0, y0, x1, y1] = st.bboxS;
  const w = x1 - x0;
  const h = y1 - y0;
  const k = size / Math.max(w, h);
  ctx.save();
  ctx.translate(cx - (w * k) / 2, cy - (h * k) / 2);
  ctx.scale(k, k);
  ctx.translate(-x0, -y0);
  const path = new Path2D(st.ds);
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, "#5b9be6");
  g.addColorStop(1, "#0055a5");
  ctx.fillStyle = g;
  ctx.fill(path);
  ctx.lineWidth = Math.max(w, h) / 60;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke(path);
  ctx.restore();
}

// A portal breakdown's verdict: no grade, comp or fits (user, 2026-11-24) —
// a card celebrating the move, laid out like the portal thumbnail (user,
// 2026-11-24): the old school in the top-left corner (its colors, its
// logo), cut off by the accent stripe with the portal's arrows on it; the
// rest the new school — its logo behind him, his cutout (the thumbnail's,
// placed the same way, scaled into the window); WELCOME TO / the school /
// his name bottom left; confetti. Still in the portal: WHERE WILL HE LAND?
// and a "?" where the new logo goes.
// Animated: the card fills in, the corner slides in, the stripe cuts
// across, the portal disc spins in, the new logo rings in behind him as he
// rises, the words land, confetti falls.
const CONFETTI = Array.from({ length: 90 }, (_, i) => {
  const r = (k) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
  return { x: r(1), y0: -0.15 - r(2) * 0.5, v: 0.75 + r(3) * 0.6, w: 10 + r(4) * 14, h: 6 + r(5) * 8, spin: (r(6) - 0.5) * 9, drift: (r(7) - 0.5) * 0.08, c: Math.floor(r(8) * 3) };
});
function cardCelebrate(ctx, bd, { fromLogoDark, fromLogo, toLogoDark, toLogo, portal, cutout }, t) {
  const { x, y, w, h } = VID;
  const T = t == null ? 1 : t;
  const landed = !!bd.toSchool;
  // The ground: the new school, as on the thumbnail.
  ctx.save();
  rr(ctx, x, y, w, h, 12);
  ctx.clip();
  animIn(ctx, phase(t, 0, 0.18), 0, 0, () => backdrop(ctx, x, y, w, h, BLUE, DEEP));
  // The new school's logo behind him, ringing in.
  const lx = x + w * 0.7;
  const lyc = y + h * 0.46;
  const ring = t == null ? 0 : clamp01((t - 0.42) / 0.4);
  if (ring > 0 && ring < 1) {
    ctx.save();
    ctx.globalAlpha *= 1 - ring;
    ctx.strokeStyle = GOLD;
    [0, 0.3].forEach((lag) => {
      const q = clamp01(ring * 1.3 - lag);
      if (q <= 0) return;
      ctx.lineWidth = 14 * (1 - q) + 3;
      ctx.beginPath();
      ctx.arc(lx, lyc, 200 + 340 * q, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  }
  scaled(ctx, 0.85 + 0.15 * phase(t, 0.38, 0.62), lx, lyc, () => {
    if (landed) contain(ctx, toLogoDark || toLogo, lx - 340, lyc - 330, 680, 660, 0.2 * phase(t, 0.38, 0.6));
    else animIn(ctx, phase(t, 0.38, 0.6), 0, 0, () => schoolDisc(ctx, lx, lyc, 300, null, true));
  });
  // Him, placed as on the thumbnail, the frame scaled into the window.
  const k = w / W;
  const pos = { ...DEFAULT_THUMB_POS, ...(bd.thumbPos || {}) };
  animIn(ctx, phase(t, 0.45, 0.7), 0, 120, () => placeCutout(ctx, cutout, { x: x + pos.x * k, y: y + pos.y * k, s: pos.s }, THUMB_H * k));
  // The old school's corner, sliding in from the top left.
  const cw = 560;
  const ch = 380;
  const c1 = bd.fromBrand?.Color1;
  const c2 = bd.fromBrand?.Color2;
  const raw = isHex(c1) && lum(c1) < 0.6 ? c1 : isHex(c2) && lum(c2) < 0.6 ? c2 : "#3a4556";
  const fc = `#${String(raw).trim().replace("#", "")}`;
  const pc = phase(t, 0.05, 0.3);
  animIn(ctx, pc, -cw * 0.6, -ch * 0.6, () => {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + cw, y); ctx.lineTo(x, y + ch); ctx.closePath();
    ctx.clip();
    const g = ctx.createLinearGradient(x, y, x + cw * 0.5, y + ch * 0.7);
    g.addColorStop(0, fc);
    g.addColorStop(1, darken(fc, 0.45));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, cw, ch);
    stripes(ctx, x, y, cw, ch, 0.06);
    contain(ctx, fromLogoDark || fromLogo, x + 30, y + 26, 250, 180);
    ctx.restore();
  });
  // The cut: the accent band and its white edge, drawn across.
  const pl = phase(t, 0.22, 0.4);
  const cut = (off, color, lw) => {
    if (pl <= 0) return;
    const x0 = x + cw + off;
    const y0 = y - 20;
    const x1 = x - 20;
    const y1 = y + ch + off * (ch / cw) + 14;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + (x1 - x0) * pl, y0 + (y1 - y0) * pl);
    ctx.stroke();
  };
  cut(12, GOLD, 22);
  cut(30, alpha("#ffffff", 0.85), 5);
  const mx = x + cw / 2 + 10;
  const my = y + ch / 2 + 6;
  const spin = (1 - phase(t, 0.32, 0.5)) * Math.PI;
  scaled(ctx, pop(t, 0.32, 0.5), mx, my, () => {
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(-spin);
    ctx.translate(-mx, -my);
    ctx.beginPath();
    ctx.arc(mx, my, 54, 0, Math.PI * 2);
    ctx.fillStyle = NAVY;
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = GOLD;
    ctx.stroke();
    contain(ctx, portal, mx - 34, my - 34, 68, 68);
    ctx.restore();
  });
  // The words, under the corner.
  const tx = x + 56;
  animIn(ctx, phase(t, 0.52, 0.64), -60, 0, () => {
    const label = landed ? String(bd.celebrateTitle || "WELCOME TO").toUpperCase() : "WHERE WILL HE LAND?";
    ctx.font = disp(44);
    const bw = Math.min(ctx.measureText(label).width + 48, 700);
    rr(ctx, tx, y + 440, bw, 60, 30);
    ctx.fillStyle = GOLD;
    ctx.fill();
    ctx.fillStyle = NAVY;
    fit(ctx, label, tx + bw / 2, y + 485, bw - 30, 44, 20, "center");
  });
  scaled(ctx, pop(t, 0.6, 0.78), tx + 200, y + 600, () => {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = "#ffffff";
    const name = String(landed ? bd.toSchool : "IN THE PORTAL").toUpperCase();
    const { size, lines } = wrapFit(ctx, name, 700, 150, 60, 2);
    const lh = size * 0.9;
    drawLines(ctx, lines, tx - 2, y + 690 - lines.length * lh, size, lh);
    ctx.restore();
  });
  animIn(ctx, phase(t, 0.72, 0.86), 0, 24, () => {
    ctx.fillStyle = GOLD;
    ctx.letterSpacing = "2px";
    fit(ctx, [fullName(bd), bd.pos, landed ? `FROM ${bd.fromSchool || ""}` : "UNCOMMITTED"].filter(Boolean).join("  ·  ").toUpperCase(), tx, y + 750, 720, 38, 16, "left", (sz) => body(sz, 800));
    ctx.letterSpacing = "0px";
  });
  // Confetti in the new school's colors and white, from the logo's landing on.
  if (landed) {
    const ct = T < 0.55 ? 0 : (T - 0.55) / 0.45;
    const colors = [GOLD, "#ffffff", BLUE];
    CONFETTI.forEach((c) => {
      const py = y + (c.y0 + c.v * ct * 1.15) * h;
      if (ct <= 0 || py < y - 30 || py > y + h + 30) return;
      const px = x + (c.x + c.drift * ct) * w;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(c.spin * ct);
      ctx.scale(1, Math.max(0.15, Math.abs(Math.cos(c.spin * ct * 1.7))));
      ctx.fillStyle = colors[c.c];
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    });
  }
  ctx.restore();
}

// ── Draft reaction ──
// After he's drafted (user, 2026-11-24): the same show, but the verdict is
// a Pick Grade, the thumbnail is in the NFL team's colors, and the
// background's clip opens on the pick itself — the draft moment.
const ordinal = (n) => {
  const v = Number(n);
  if (!v) return "";
  const s = ["TH", "ST", "ND", "RD"];
  const m = v % 100;
  return `${v}${s[(m - 20) % 10] || s[m] || s[0]}`;
};
const nflTeamName = (bd, branding) => {
  const b = branding?.[bd.nflTeam] || {};
  return b.City && b.Team ? `${b.City} ${b.Team}` : teamNameFromAbbr(bd.nflTeam) || bd.nflTeam || "";
};
const pickLine = (bd) => (bd.pick ? `${bd.round ? `RD ${bd.round} · ` : ""}PICK ${bd.pick}` : "");
export const PICK_GRADES = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"];
const pickGradeColor = (g) => ({ A: "#1e9e57", B: "#2f86d6", C: "#e0a100", D: "#e8731f", F: RED }[String(g || "").charAt(0)] || "#5f6b7a");

// The draft moment: WITH THE 12TH PICK IN THE 2027 NFL DRAFT / THE NEW
// YORK JETS SELECT, spotlights sweeping, the team's logo bursting in, his
// name slamming down with a flash, confetti — in the team's colors. p: its
// own time (0…1); exit: it sliding off to the left (0…1) to show the
// background card under it.
function cardDraftMoment(ctx, bd, { pickLogo, draft, branding }, p, exit = 0) {
  const { x, y, w, h } = VID;
  const th = nflTheme(branding?.[bd.nflTeam]);
  const cx = x + w / 2;
  ctx.save();
  rr(ctx, x, y, w, h, 12);
  ctx.clip();
  ctx.translate(-w * exit, 0);
  // The ground.
  animIn(ctx, phase(p, 0, 0.1), 0, 0, () => backdrop(ctx, x, y, w, h, th.BLUE, th.DEEP));
  // Spotlights sweeping up from the floor.
  const sweep = Math.sin(p * Math.PI * 2.2) * 0.3;
  const beam = (bx, ang) => {
    ctx.save();
    ctx.translate(bx, y + h + 20);
    ctx.rotate(ang);
    const gr = ctx.createLinearGradient(0, 0, 0, -h * 1.4);
    gr.addColorStop(0, "rgba(255,255,255,0.3)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(-180, -h * 1.4);
    ctx.lineTo(180, -h * 1.4);
    ctx.lineTo(16, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  animIn(ctx, phase(p, 0.04, 0.24), 0, 0, () => { beam(x + w * 0.1, 0.5 + sweep); beam(x + w * 0.9, -0.5 - sweep); beam(cx, sweep * 0.5); });
  // The draft's logo, top left.
  animIn(ctx, phase(p, 0.06, 0.18), -30, 0, () => contain(ctx, draft, x + 28, y + 22, 130, 130));
  // The call.
  animIn(ctx, phase(p, 0.08, 0.2), 0, -30, () => {
    ctx.fillStyle = th.GOLD;
    ctx.letterSpacing = "4px";
    fit(ctx, `${bd.pick ? `WITH THE ${ordinal(bd.pick)} PICK ` : ""}IN THE ${bd.cls || ""} NFL DRAFT`.replace(/\s+/g, " "), cx, y + 92, w - 360, 46, 22, "center");
    ctx.letterSpacing = "0px";
  });
  animIn(ctx, phase(p, 0.18, 0.3), 0, -30, () => {
    ctx.fillStyle = "#ffffff";
    fit(ctx, `THE ${nflTeamName(bd, branding).toUpperCase()} SELECT`, cx, y + 168, w - 300, 66, 28, "center");
  });
  // The team's logo, with rings.
  const ly = y + 395;
  const ring = clamp01((p - 0.34) / 0.4);
  if (ring > 0 && ring < 1) {
    ctx.save();
    ctx.globalAlpha *= 1 - ring;
    ctx.strokeStyle = th.GOLD;
    [0, 0.3].forEach((lag) => {
      const q = clamp01(ring * 1.3 - lag);
      if (q <= 0) return;
      ctx.lineWidth = 14 * (1 - q) + 3;
      ctx.beginPath();
      ctx.arc(cx, ly, 150 + 360 * q, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  }
  scaled(ctx, pop(p, 0.3, 0.48), cx, ly, () => {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.4)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 10;
    contain(ctx, pickLogo, cx - 170, ly - 150, 340, 300);
    ctx.restore();
  });
  // His name, slamming down — and a flash as it lands.
  const slam = phase(p, 0.5, 0.62);
  if (slam > 0) {
    scaled(ctx, 1 + 0.9 * (1 - slam), cx, y + 620, () => {
      ctx.save();
      ctx.globalAlpha *= Math.min(1, slam * 3);
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 8;
      ctx.fillStyle = "#ffffff";
      fit(ctx, fullName(bd) || "PLAYER NAME", cx, y + 672, w - 160, 160, 60, "center");
      ctx.restore();
    });
  }
  const flash = pulse(p, 0.6, 0.72);
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${0.35 * flash})`; ctx.fillRect(x, y, w, h); }
  animIn(ctx, phase(p, 0.64, 0.76), 0, 24, () => {
    ctx.fillStyle = th.GOLD;
    ctx.letterSpacing = "3px";
    fit(ctx, [bd.pos, bd.school].filter(Boolean).join("  ·  ").toUpperCase(), cx, y + 738, w - 300, 40, 18, "center", (sz) => body(sz, 800));
    ctx.letterSpacing = "0px";
  });
  // Confetti.
  const ct = p < 0.55 ? 0 : (p - 0.55) / 0.45;
  if (ct > 0) {
    const colors = [th.GOLD, "#ffffff", th.BLUE === th.DEEP ? th.GOLD : "#ffffff"];
    CONFETTI.forEach((c) => {
      const py = y + (c.y0 + c.v * ct * 1.15) * h;
      if (py < y - 30 || py > y + h + 30) return;
      const px = x + (c.x + c.drift * ct) * w;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(c.spin * ct);
      ctx.scale(1, Math.max(0.15, Math.abs(Math.cos(c.spin * ct * 1.7))));
      ctx.fillStyle = colors[c.c];
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    });
  }
  // The edge it slides off on.
  if (exit > 0) { ctx.fillStyle = th.GOLD; ctx.fillRect(x + w - 12, y, 12, h); }
  ctx.restore();
}

// The Pick Grade: the team's card (logo, name, round and pick) beside the
// grade, which stamps down; the why under it. Animated: the card fills in,
// the team slides in, the grade stamps, glows, the note fades up.
function cardPickGrade(ctx, bd, { pickLogo, branding }, t) {
  cardShell(ctx, phase(t, 0, 0.2));
  const { x, y, w, h } = VID;
  cardTitle(ctx, "PICK GRADE", y + 96, phase(t, 0.08, 0.3));
  const th = nflTheme(branding?.[bd.nflTeam]);
  const pad = 44;
  const top = y + 150;
  const ch = h - 150 - pad;
  const lw = 620;
  const lx = x + pad;
  animIn(ctx, phase(t, 0.15, 0.42), -120, 0, () => {
    ctx.save();
    rr(ctx, lx, top, lw, ch, 22);
    ctx.clip();
    const g = ctx.createLinearGradient(lx, top, lx, top + ch);
    g.addColorStop(0, th.BLUE);
    g.addColorStop(1, th.DEEP);
    ctx.fillStyle = g;
    ctx.fillRect(lx, top, lw, ch);
    stripes(ctx, lx, top, lw, ch, 0.06);
    ctx.restore();
    rr(ctx, lx, top, lw, ch, 22);
    ctx.strokeStyle = th.GOLD;
    ctx.lineWidth = 4;
    ctx.stroke();
    contain(ctx, pickLogo, lx + lw / 2 - 160, top + 40, 320, 270);
    ctx.fillStyle = "#ffffff";
    fit(ctx, nflTeamName(bd, branding).toUpperCase() || "NFL TEAM", lx + lw / 2, top + 390, lw - 60, 74, 30, "center");
    ctx.fillStyle = th.GOLD;
    fit(ctx, bd.pick ? `ROUND ${bd.round || "?"}  ·  PICK ${bd.pick}` : "ROUND ? · PICK ?", lx + lw / 2, top + 460, lw - 60, 56, 24, "center");
    ctx.fillStyle = alpha("#ffffff", 0.7);
    ctx.letterSpacing = "3px";
    fit(ctx, `${bd.cls || ""} NFL DRAFT`.trim(), lx + lw / 2, top + 512, lw - 60, 28, 14, "center", (sz) => body(sz, 800));
    ctx.letterSpacing = "0px";
  });
  // The grade.
  const gx = lx + lw + 40;
  const gw = x + w - pad - gx;
  const mid = gx + gw / 2;
  animIn(ctx, phase(t, 0.28, 0.45), 0, 60, () => {
    rr(ctx, gx, top, gw, ch, 22);
    ctx.fillStyle = alpha("#ffffff", 0.06);
    ctx.fill();
    ctx.strokeStyle = alpha("#ffffff", 0.14);
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.letterSpacing = "2px";
    fit(ctx, "THE GRADE", mid, top + 64, gw - 40, 42, 18, "center");
    ctx.letterSpacing = "0px";
  });
  const grade = String(bd.pickGrade || "").trim();
  const note = bd.pickNote ? wrapLines(ctx, bd.pickNote, gw - 80, 30, 3, (s) => body(s, 600)) : [];
  const size = 320;
  const sy = top + 96 + (note.length ? 0 : 30);
  const sp = phase(t, 0.45, 0.6);
  if (sp > 0) {
    const color = grade ? pickGradeColor(grade) : alpha("#ffffff", 0.12);
    const glow = pulse(t, 0.6, 0.85);
    ctx.save();
    ctx.globalAlpha *= Math.min(1, sp * 3);
    ctx.translate(mid, sy + size / 2);
    ctx.rotate(-0.05 - 0.1 * (1 - sp));
    ctx.scale(1.9 - 0.9 * sp, 1.9 - 0.9 * sp);
    ctx.translate(-mid, -(sy + size / 2));
    ctx.save();
    ctx.shadowColor = grade ? color : "rgba(0,0,0,0)";
    ctx.shadowBlur = 30 + 50 * glow;
    rr(ctx, mid - size / 2, sy, size, size, 34);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    rr(ctx, mid - size / 2, sy, size, size, 34);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    fit(ctx, grade || "?", mid, sy + size * 0.8, size - 40, 290, 80, "center");
    ctx.restore();
  }
  if (note.length) {
    animIn(ctx, phase(t, 0.7, 0.9), 0, 20, () => {
      ctx.fillStyle = alpha("#ffffff", 0.9);
      drawLines(ctx, note, mid, sy + size + 34, 30, 38, "center", (s) => body(s, 600));
    });
  }
  ctx.restore();
}

// Where he went, from the draft order (draftOrder — Selection is his slug),
// else the draft history (2000–2026) by name and class. → { team, round, pick, src }
async function pickRecordOf(p) {
  if (p.Slug) {
    const snap = await getDocs(query(collection(db, "draftOrder"), where("Selection", "==", p.Slug), limit(1))).catch(() => null);
    const d = snap?.docs?.[0]?.data();
    if (d) return { team: d.Team || "", round: String(d.Round || ""), pick: String(d.Pick || ""), src: "the draft order" };
  }
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
  const name = norm(`${p.First} ${p.Last}`);
  const hits = (await draftHistory().catch(() => [])).filter((h) => norm(h.name) === name);
  const h = hits.find((x) => String(x.year) === String(p.Eligible)) || (hits.length === 1 ? hits[0] : null);
  if (h) return { team: h.team, round: String(h.round || ""), pick: String(h.pick || ""), src: `the ${h.year} draft history` };
  return { team: "", round: "", pick: "", src: "no pick found — set it below" };
}

// ── The files, in show order ──
// Each entry is a still (png) or a clip (mov — the animation into the
// still right after it, ending exactly on it). Numbered in this order, one
// number a file: Ousmane-Kromah-01-Intro-Animated.mov, -02-Intro.png… The
// title card is the thumbnail, downloaded on its own (…-Thumbnail.png).
const THUMB = { kind: "png", seg: "title", step: 0, label: "Thumbnail", thumb: true, id: "thumb" };
function sequenceOf(bd) {
  const out = [];
  const png = (seg, step, label) => out.push({ kind: "png", seg, step, label });
  const mov = (seg, step, anim, label) => out.push({ kind: "mov", seg, step, anim, label: `${label} Animated` });
  mov("intro", 0, "intro", portalMode(bd) ? "Intro The Move" : "Intro");
  png("intro", 0, portalMode(bd) ? "Intro The Move" : "Intro");
  mov("background", 0, "background", reactionMode(bd) ? "Background The Pick" : "Background");
  png("background", 0, "Background");
  mov("strengths", 0, "list", "Strengths");
  png("strengths", 0, "Strengths");
  mov("weaknesses", 0, "swap", "Weaknesses");
  png("weaknesses", 0, "Weaknesses");
  if (reactionMode(bd)) {
    // A reaction: the Pick Grade in the verdict's place.
    mov("pickgrade", 0, "pickgrade", "Pick Grade");
    png("pickgrade", 0, "Pick Grade");
  } else if (portalMode(bd)) {
    // The portal's verdict: one celebration of the move, no reveals.
    mov("verdict", 0, "celebrate", "Verdict The Move");
    png("verdict", 0, "Verdict The Move");
  } else mov("verdict", 0, "verdict", "Verdict");
  const draftMode = !portalMode(bd) && !reactionMode(bd);
  if (draftMode) png("verdict", 0, "Verdict");
  if (draftMode) verdictShown(bd).forEach((k, i) => {
    const name = { grade: "Grade", comp: "Player Comp", fits: "Team Fits" }[k];
    mov("verdict", i + 1, "reveal", `Verdict ${name}`);
    png("verdict", i + 1, `Verdict ${name}`);
  });
  mov("community", 0, "community", "Community Grade");
  png("community", 0, "Community Grade");
  return out.map((e, i) => ({ ...e, n: i + 1, id: `${e.kind}-${e.seg}-${e.step}` }));
}
const fileSafe = (s) => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const fileName = (bd, e) => `${fileSafe(bd.first)}-${fileSafe(bd.last)}-${e.thumb ? `${portalMode(bd) ? "Portal-" : reactionMode(bd) ? "Reaction-" : ""}Thumbnail` : `${String(e.n).padStart(2, "0")}-${fileSafe(e.label)}`}.${e.kind}`;

// ── Run sheet ──
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
function chaptersOf(bd) {
  const times = { ...DEFAULT_TIMES, ...(bd.times || {}) };
  const lines = [];
  let at = 0;
  segsOf(bd).forEach((s) => {
    const items = s.key === "strengths" || s.key === "weaknesses" ? traitList(bd, s.key) : [];
    const per = items.length ? times[s.key] / items.length : 0;
    // YouTube needs 10 s a chapter: a trait gets its own when it has that.
    if (bd.traitChapters && items.length && per >= 10) {
      const word = s.key === "strengths" ? "Strength" : "Weakness";
      items.forEach((it, i) => lines.push(`${clock(at + i * per)} ${word}: ${it.title}`));
    } else lines.push(`${clock(at)} ${(portalMode(bd) && PORTAL_CHAPTERS[s.key]) || s.chapter}`);
    at += Number(times[s.key]) || 0;
  });
  return { text: lines.join("\n"), total: at };
}

// ── Live data ──
const NFL_BY_NAME = Object.fromEntries(NFL_TEAM_ABBRS.map((a) => [teamNameFromAbbr(a), a]));
const EIGHTHS = ["", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"];
const inchParts = (n) => {
  let whole = Math.floor(n);
  let e = Math.round((n - whole) * 8);
  if (e === 8) { whole += 1; e = 0; }
  return `${whole}${EIGHTHS[e]}`;
};
// Height: stored as 6'4" (or a bulk import's 6'2.5"), now and then as plain inches.
export function heightText(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d+)'\s*(\d+(?:\.\d+)?)/);
  if (m) return `${m[1]}'${inchParts(parseFloat(m[2]))}"`;
  const n = parseFloat(s);
  if (n > 48 && n < 96) return `${Math.floor(n / 12)}'${inchParts(n - Math.floor(n / 12) * 12)}"`;
  return s;
}
const inchText = (raw) => {
  const s = String(raw ?? "").trim();
  if (!s || /["/]/.test(s)) return s;
  const n = parseFloat(s);
  return Number.isNaN(n) ? s : `${inchParts(n)}"`;
};
const broadText = (raw) => {
  const s = String(raw ?? "").trim();
  if (!s || s.includes("'")) return s;
  const n = parseFloat(s);
  return Number.isNaN(n) ? s : `${Math.floor(n / 12)}'${Math.round(n % 12)}"`;
};
const plain = (raw) => String(raw ?? "").trim();
// Size, then the Combine's numbers — the ones he has.
const measuresOf = (p) => [
  ["Height", heightText(p.Height)], ["Weight", p.Weight ? `${plain(p.Weight)} lbs` : ""],
  ["Arm", inchText(p["Arm Length"])], ["Hand", inchText(p["Hand Size"])], ["Wingspan", inchText(p.Wingspan)],
  ["40-Yard", plain(p["40 Yard"])], ["Vertical", p.Vertical ? `${plain(p.Vertical).replace(/"$/, "")}"` : ""], ["Broad", broadText(p.Broad)],
  ["3-Cone", plain(p["3-Cone"])], ["Shuttle", plain(p.Shuttle)], ["Bench", plain(p.Bench)],
].filter(([, v]) => v).map(([label, value]) => ({ label, value }));

// The community's evaluations, as the player page counts them.
async function communityOf(p) {
  const snap = await getDocs(collection(db, "players", p.id, "evaluations")).catch(() => null);
  const evals = snap ? snap.docs.map((d) => d.data()) : [];
  if (!evals.length) return { count: 0, avg: null, strengths: [], weaknesses: [], fits: [] };
  const sC = {};
  const wC = {};
  const fC = {};
  evals.forEach((e) => {
    (e.strengths || []).forEach((t) => { sC[t] = (sC[t] || 0) + 1; });
    (e.weaknesses || []).forEach((t) => { wC[t] = (wC[t] || 0) + 1; });
    if (e.nflFit && NFL_BY_NAME[e.nflFit]) fC[NFL_BY_NAME[e.nflFit]] = (fC[NFL_BY_NAME[e.nflFit]] || 0) + 1;
  });
  const total = evals.filter((e) => e.grade !== "Watchlist" || (e.strengths?.length || 0) + (e.weaknesses?.length || 0) > 0).length || 1;
  const top = (c, other, strict) => Object.entries(c).filter(([t, n]) => (strict ? n > (other[t] ?? -1) : n >= (other[t] ?? -1)))
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([term, n]) => ({ term, pct: (n / total) * 100 }));
  return {
    count: evals.length, avg: communityAverage(evals, p.Eligible, GRADE_SCALE),
    strengths: top(sC, wC, false), weaknesses: top(wC, sC, true),
    fits: Object.entries(fC).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a),
  };
}

// The draft history's picks, once: [{ name, year, round, pick, team, pos, school }].
let historyP = null;
const draftHistory = () => {
  historyP ||= import("../utils/draftSim/draftHistory.json").then((m) => {
    const h = m.default || m;
    return h.picks.map(([year, round, pick, t, pos, s, name]) => ({ name, year, round, pick, team: h.teams[t] || "", pos, school: h.schools[s] || "" }));
  });
  return historyP;
};

const DEFAULTS = {
  verdict: { grade: true, comp: true, fits: true }, lowerThirds: true, traitChapters: true, times: { ...DEFAULT_TIMES },
  subTitle: "MORE DRAFT BREAKDOWNS", subLine: "ALL WEEK", cta: "GRADE HIM YOURSELF",
  comp: null, compNote: "", celebrateTitle: "WELCOME TO",
};
// What edits may set outright (the rest: facts, verdict merge; lists by title).
const EDIT_KEYS = ["mode", "fromSchool", "toSchool", "first", "last", "pos", "school", "cls", "photo", "bgPhoto", "thumbPos", "bgPos", "statsTitle", "stats", "measures", "careerCat", "grade", "comp", "compNote", "fits",
  "lowerThirds", "traitChapters", "times", "subTitle", "subLine", "cta", "celebrateTitle", "thumbMode", "thumbHook", "thumbLayout", "nflTeam", "round", "pick", "pickGrade", "pickNote"];

// The breakdown: live data, then the edits on top. A trait list is its
// titles (the edited list, else the live one), each with its note and key
// flag. The mode is the tab's (Draft Breakdowns / Portal Breakdowns).
function mergeBreakdown(live, e = {}, mode = "draft") {
  if (!live) return null;
  const out = { ...DEFAULTS, ...live };
  if (mode === "reaction") out.subTitle = "MORE DRAFT REACTIONS";
  EDIT_KEYS.forEach((k) => { if (e[k] !== undefined) out[k] = e[k]; });
  out.mode = mode;
  out.facts = { ...live.facts, ...(e.facts || {}) };
  out.verdict = { ...DEFAULTS.verdict, ...(e.verdict || {}) };
  out.hideCareer = e.hideCareer || {};
  ["strengths", "weaknesses"].forEach((seg) => {
    const titles = e[seg] || live[seg] || [];
    const keyCount = seg === "strengths" ? 3 : 2;
    out[seg] = titles.map((title, i) => ({
      title, note: e.notes?.[title] || "", key: e.keys?.[title] ?? i < keyCount,
    }));
  });
  return out;
}

// A stop's years, never "Present": his current school runs to the last
// season played (the season before the class being drafted next) —
// "2024–2026", or just "2026" when it started then.
const yearsOnly = (span) => {
  const last = String(Number(currentDraftClass()) - 1);
  if (span === "Present") return last;
  return String(span).replace(/^(\d{4})–Present$/, (m, from) => (from === last ? from : `${from}–${last}`));
};

// Mounted for the open player: his Career Path rows (the player page's), handed up.
function CareerFeed({ player, espnId, onRows }) {
  const { rows } = useCareerPath(player, espnId, null);
  const mapped = rows
    .filter((r) => !String(r.key).startsWith("event-") && !String(r.key).startsWith("commit-") && r.key !== "portal")
    .map((r) => ({
      key: String(r.key), name: r.name, span: yearsOnly(r.span || r.label || ""), current: !!r.current,
      // White discs, so a team's main logo (Logo1), not its dark-background one.
      logo: r.brand?.Logo1 || r.brand?.LogoDark || "", fallback: r.fallback || "",
      // A high school with no logo: its state (drawn as the silhouette).
      state: r.state || "",
      // His top honor at the stop; a high school's recruiting line split in
      // two ("3-Star Recruit" / "No. 123 Nationally").
      acc: ((t) => (!t ? [] : r.key === "hs" ? t.split(" · ") : [t]))((r.accolades || []).map((a) => a.text).find(Boolean) || ""),
    }));
  const key = JSON.stringify(mapped);
  useEffect(() => { onRows(mapped); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// The move, from the portal records (user, 2026-11-24): the old school
// always; the new one when a record has him committed. First the player's
// own record (utils/portalMoves.js — PortalOriginalSchool while he's in,
// PriorSchool → School once resolved), then the admin's manual entry
// (config/portalManual), then the CFBD sync's match (transferPortal/{year}
// — this cycle's, then last). → { from, to, src }
async function portalRecordOf(p) {
  const committed = !!p.PortalCommittedAt && !p.InPortal;
  let from = p.InPortal ? p.PortalOriginalSchool || p.School || "" : committed ? p.PriorSchool || "" : "";
  let to = committed ? p.School || "" : "";
  let src = committed ? "his player record (committed)" : p.InPortal ? "his player record (in the portal)" : "";
  if (!to) {
    const manual = await fetchPortalManual({ fresh: true }).catch(() => ({}));
    const m = Object.values(manual || {}).find((e) => e.wd === p.id);
    if (m) {
      from ||= m.from || "";
      if (m.st === "c" && m.to) { to = m.to; src = "a manual portal entry"; } else src ||= "a manual portal entry (uncommitted)";
    }
  }
  if (!to) {
    const season = activePortalSeason();
    for (const year of [season, season - 1]) {
      // eslint-disable-next-line no-await-in-loop
      const meta = await getDoc(doc(db, "transferPortal", String(year))).then((x) => (x.exists() ? x.data() : null)).catch(() => null);
      const hit = (meta?.matches || []).find((x) => (x.playerIds || []).includes(p.id));
      if (!hit) continue;
      // eslint-disable-next-line no-await-in-loop
      const chunks = await Promise.all(Array.from({ length: meta.chunks || 0 }, (_, n) => getDoc(doc(db, "transferPortal", `${year}_${n}`)).then((x) => x.data()?.entries || []).catch(() => [])));
      const e = chunks.flat().find((x) => x.key === hit.key);
      if (!e) continue;
      from ||= e.originSchool || "";
      if (e.destSchool) { to = e.destSchool; src = `CFBD's ${year} portal`; } else src ||= `CFBD's ${year} portal (uncommitted)`;
      break;
    }
  }
  return { from: from || p.School || "", to, src: src || "no portal record — his current school" };
}

// ── The editor ──
const field = { padding: "6px 9px", border: "1px solid #d5dce6", borderRadius: "6px", fontSize: "13px", fontWeight: 700, width: "100%", boxSizing: "border-box" };
const lbl = { fontSize: "10px", fontWeight: 900, color: "#7a8597", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "3px" };
const btn = (primary) => ({
  padding: "7px 14px", fontWeight: 900, fontSize: "12px", borderRadius: "8px", cursor: "pointer",
  border: `2px solid ${UI_BLUE}`, background: primary ? UI_BLUE : "#fff", color: primary ? "#fff" : UI_BLUE,
});
const mini = { border: "none", background: "none", color: UI_BLUE, fontWeight: 900, fontSize: "13px", cursor: "pointer", padding: "0 4px" };
const section = { border: "1px solid #e3e8ef", borderRadius: "10px", padding: "12px", display: "grid", gap: "8px", background: "#fff" };
const head = { fontSize: "12px", fontWeight: 900, color: "#1b2230", letterSpacing: "0.06em", textTransform: "uppercase" };
const editedDot = <span title="Edited here — not live" style={{ color: UI_GOLD, fontWeight: 900 }}> •</span>;

// kind: "draft" (Videos → Graphics → Draft Breakdowns) or "portal" (its
// own tab, Portal Breakdowns — user, 2026-11-24). Each keeps its own saved
// edits: config/draftBreakdowns.players / .portal.
export default function AdminDraftBreakdowns({ kind = "draft" }) {
  const portalTab = kind === "portal";
  const reactionTab = kind === "reaction";
  const SAVE_KEY = portalTab ? "portal" : reactionTab ? "reaction" : "players";
  const [live, setLive] = useState(null);
  const [edits, setEdits] = useState({});
  const [player, setPlayer] = useState(null);
  const [espnId, setEspnId] = useState("");
  const [statOpts, setStatOpts] = useState([]);
  const [players, setPlayers] = useState(null);
  const [saved, setSaved] = useState({});
  const [traitWords, setTraitWords] = useState([]);
  const [search, setSearch] = useState("");
  const [compSearch, setCompSearch] = useState("");
  const [history, setHistory] = useState(null);
  const [branding, setBranding] = useState({});
  const [view, setView] = useState({ seg: "title", step: 0 });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  // Every college's branding by name (the portal's from / to schools).
  const [schools, setSchools] = useState({});
  // The download running: { i, n, name, status }.
  const [prog, setProg] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [fontsOk, setFontsOk] = useState(false);
  // Animated clips: frame rate, whether Download all makes them too, and the
  // preview playing one.
  const [fps, setFps] = useState(30);
  const [playing, setPlaying] = useState(false);
  // The thumbnail text piece last grabbed (its size slider is shown first).
  const [thumbPiece, setThumbPiece] = useState(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);

  // The breakdown, with the portal's two schools' branding put on it.
  const bd = useMemo(() => {
    const m = mergeBreakdown(live, edits, kind);
    return m && { ...m, fromBrand: schools[m.fromSchool] || null, toBrand: schools[m.toSchool] || null };
  }, [live, edits, schools, kind]);

  useEffect(() => {
    ensureFonts().then(() => setFontsOk(true));
    fetchNflBranding().then(setBranding).catch(() => {});
    getDocs(collection(db, "schools")).then((snap) => setSchools(Object.fromEntries(snap.docs.map((d) => d.data()).filter((x) => x.School)
      .map((x) => [x.School, { Logo1: x.Logo1 || "", LogoDark: x.LogoDark || "", Color1: x.Color1 || "", Color2: x.Color2 || "" }])))).catch(() => {});
    getDoc(BD_DOC).then((s) => setSaved((s.exists() && s.data()[SAVE_KEY]) || {})).catch(() => {});
    getDocs(collection(db, "players")).then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.First && p.Last).sort((a, b) => a.Last.localeCompare(b.Last) || a.First.localeCompare(b.First))))
      .catch((e) => setMsg(`Couldn't load players: ${e.message}`));
  }, [SAVE_KEY]);

  // Redraw on every change (off screen, then swapped in, so it never flickers).
  useEffect(() => {
    if (!bd || playing) return undefined;
    let live2 = true;
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    drawBreakdown(off, bd, view, branding).then(() => {
      if (!live2 || !canvasRef.current) return;
      const ctx = canvasRef.current.getContext("2d");
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(off, 0, 0);
      // The thumbnail's text pieces, where they landed (for dragging them).
      canvasRef.current.titleBoxes = off.titleBoxes || null;
    });
    return () => { live2 = false; };
  }, [bd, view, branding, fontsOk, playing]);

  const seq = useMemo(() => (bd ? sequenceOf(bd) : []), [bd]);
  const chapters = useMemo(() => (bd ? chaptersOf(bd) : { text: "", total: 0 }), [bd]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !players) return [];
    return players.filter((p) => `${p.First} ${p.Last}`.toLowerCase().includes(q)).slice(0, 12);
  }, [players, search]);
  const compMatches = useMemo(() => {
    const q = compSearch.trim().toLowerCase();
    if (q.length < 2 || !history) return [];
    return history.filter((h) => h.name.toLowerCase().includes(q)).sort((a, b) => b.year - a.year).slice(0, 12);
  }, [history, compSearch]);
  const savedList = useMemo(() => Object.entries(saved).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0)), [saved]);

  const edit = (patch) => { setEdits((e) => ({ ...e, ...(typeof patch === "function" ? patch(e) : patch) })); setDirty(true); };
  const editFact = (k, v) => edit((e) => ({ facts: { ...(e.facts || {}), [k]: v } }));
  const isEdited = (k) => edits[k] !== undefined;

  // Everything live for a player, read fresh.
  const loadLive = async (p) => {
    const read = (ref) => getDoc(ref).then((x) => (x.exists() ? x.data() : null)).catch(() => null);
    const [schoolSnap, photo, mine, traitPos, traitGen, community, cfbd, move, drafted] = await Promise.all([
      getDocs(query(collection(db, "schools"), where("School", "==", p.School || ""), limit(1))),
      read(doc(db, "playerPhotos", p.id)),
      read(doc(db, "users", KINGCOLD_UID, "evaluations", p.id)),
      read(doc(db, "traits", p.Position || "_")), read(doc(db, "traits", "Generic")),
      communityOf(p),
      getDocs(query(collection(db, "cfbdPlayers"), where("wedraftPlayerId", "==", p.id), limit(1))).catch(() => null),
      portalTab ? portalRecordOf(p) : null,
      reactionTab ? pickRecordOf(p) : null,
    ]);
    const ev = mine || (await read(doc(db, "players", p.id, "evaluations", KINGCOLD_UID))) || {};
    const s = schoolSnap.docs[0]?.data() || {};
    const ath = await espnIdFor(p, s.CFBDTeamId, photo).catch(() => null);
    const espn = ath ? await espnStats("college-football", ath.id).catch(() => null) : null;
    const season = espn?.years?.[espn.years.length - 1] || "";
    // His national ranks that season (CFBD's), on the stats that have one.
    const ranks = cfbd?.docs?.[0]?.data().seasonRanks?.[season] || null;
    const options = espn ? statOptions(espn, season, ranks) : [];
    const groups = careerGroups(espn, p.Position);
    const actions = (photo?.action || []).map((a) => a.url).filter(Boolean);
    setStatOpts(options);
    setEspnId(ath?.id ? String(ath.id) : "");
    setTraitWords([...new Set([...(traitPos?.traits || []), ...(traitGen?.traits || [])])].sort());
    return {
      ev,
      live: {
        // Portal: the move from the portal records (portalRecordOf).
        fromSchool: move?.from || "", toSchool: move?.to || "", portalSrc: move?.src || "",
        // Reaction: where he went (pickRecordOf).
        nflTeam: drafted?.team || "", round: drafted?.round || "", pick: drafted?.pick || "", pickSrc: drafted?.src || "",
        playerId: p.id, slug: p.Slug || "", first: p.First, last: p.Last, pos: p.Position || "", school: p.School || "", cls: String(p.Eligible || ""),
        c1: s.Color1 || UI_BLUE, c2: s.Color2 || UI_GOLD, logo: s.LogoDark || s.Logo1 || "", headshot: photo?.headshot?.url || ath?.headshot || "",
        actions, photo: actions[0] || "",
        facts: {
          height: heightText(p.Height), weight: p.Weight ? `${plain(p.Weight)} lbs` : "", hometown: p.Hometown || "",
          hs: p.HighSchool || "", stars: Number(p.RecruitStars) || 0, rank: p.RecruitRank || "",
        },
        measures: measuresOf(p),
        statsTitle: season ? `${season} SEASON` : "THE SEASON",
        stats: defaultStats(options, p.Position).slice(0, STAT_COUNT).map(({ label, value, rank }) => ({ label, value, rank: rank || "" })),
        careerTables: Object.fromEntries(groups.map((g) => [g, careerTable(espn, g, p.Position)])), careerGroups: groups, careerCat: groups[0] || "",
        career: [],
        strengths: (ev.strengths || []).slice(0, MAX_TRAITS), weaknesses: (ev.weaknesses || []).slice(0, MAX_TRAITS),
        grade: GRADE_SCALE[ev.grade] ? ev.grade : "",
        fits: ev.nflFit && NFL_BY_NAME[ev.nflFit] ? [NFL_BY_NAME[ev.nflFit]] : [],
        community,
      },
    };
  };

  const pick = async (p) => {
    if (dirty && bd && !window.confirm("Leave this breakdown without saving your edits?")) return;
    setSearch("");
    setMsg("Loading…");
    try {
      const [{ ev, live: l }, fresh] = await Promise.all([loadLive(p), getDoc(BD_DOC).then((x) => (x.exists() ? x.data()[SAVE_KEY] || {} : {})).catch(() => saved)]);
      setSaved(fresh);
      setPlayer(p);
      setLive(l);
      setEdits(fresh[p.id]?.edits || {});
      setDirty(false);
      setView({ seg: "title", step: 0 });
      setMsg(fresh[p.id]?.edits ? "Opened with your saved edits over live data." : Object.keys(ev).length ? "Live from King Cold's evaluation." : "No King Cold evaluation for him yet — add traits by hand, or grade him on his page and hit Refresh.");
    } catch (e) {
      setMsg(`Couldn't load him: ${e.message}`);
    }
  };
  const refresh = async () => {
    if (!player) return;
    setMsg("Refreshing…");
    const fresh = players?.find((x) => x.id === player.id);
    const p = (await getDoc(doc(db, "players", player.id)).then((x) => (x.exists() ? { id: x.id, ...x.data() } : null)).catch(() => null)) || fresh || player;
    const { live: l } = await loadLive(p);
    setPlayer(p);
    setLive((old) => ({ ...l, career: old?.career || [] }));
    setMsg("Live data refreshed.");
  };

  const save = async () => {
    if (!bd) return;
    setBusy("save");
    // A reset field is undefined in edits — Firestore won't take that, so it's left out.
    const kept = Object.fromEntries(Object.entries(edits).filter(([, v]) => v !== undefined));
    const value = { edits: kept, first: bd.first, last: bd.last, updatedAt: Date.now() };
    try {
      // The player's whole entry replaced (a dropped edit stays dropped).
      await updateDoc(BD_DOC, new FieldPath(SAVE_KEY, bd.playerId), value)
        .catch(() => setDoc(BD_DOC, { [SAVE_KEY]: { [bd.playerId]: value } }, { merge: true }));
      setSaved((s) => ({ ...s, [bd.playerId]: value }));
      setDirty(false);
      setMsg("Saved.");
    } catch (e) {
      setMsg(`Couldn't save: ${e.message}`);
    }
    setBusy("");
  };
  const backToLive = () => {
    if (!Object.keys(edits).length || !window.confirm("Drop every edit and go back to live data? (Save after to make it stick.)")) return;
    setEdits({});
    setDirty(true);
  };

  const save$ = (blob, name) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };
  // A still: its finished frame.
  const exportPng = async (e) => {
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    await drawBreakdown(out, bd, { seg: e.seg, step: e.step }, branding);
    const blob = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("an image blocked the export");
    save$(blob, fileName(bd, e));
  };
  // A clip: its animation, then its last frame held, as a transparent
  // ProRes 4444 .mov — it ends exactly on the still after it.
  const exportMov = async (e) => {
    const animFrames = Math.round(animSeconds(bd, e.anim) * fps);
    const count = animFrames + Math.round(ANIM_HOLD * fps);
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const blob = await encodeMov({
      count, fps, onStatus: (status) => setProg((pr) => (pr ? { ...pr, status } : pr)),
      frameAt: async (i) => {
        await drawBreakdown(out, bd, { seg: e.seg, step: e.step, anim: e.anim, t: i >= animFrames ? undefined : i / animFrames }, branding);
        return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("an image blocked the export"))), "image/png"));
      },
    });
    save$(blob, fileName(bd, e));
  };
  const exportEntry = (e) => (e.kind === "mov" ? exportMov(e) : exportPng(e));
  // The entry on the preview: the picked one, else the still for its frame.
  const chips = seq.length ? [THUMB, ...seq] : [];
  const current = () => (view.seg === "title" ? THUMB : seq.find((e) => e.seg === view.seg && e.step === view.step && e.kind === (view.kind || "png"))
    || seq.find((e) => e.seg === view.seg && e.step === view.step) || seq[0]);
  const downloadOne = async (e = current()) => {
    if (!e) return;
    setBusy("one");
    setMsg("");
    setProg({ i: 1, n: 1, name: fileName(bd, e), status: "" });
    try { await exportEntry(e); setMsg(`Downloaded ${fileName(bd, e)}.`); } catch (err) { setMsg(`Couldn't export: ${err.message}`); }
    setProg(null);
    setBusy("");
  };
  // A clip's animation played on the preview, in real time.
  const play = async () => {
    const e = current();
    if (e?.kind !== "mov" || playing) return;
    setPlaying(true);
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const start = performance.now();
    const dur = animSeconds(bd, e.anim) * 1000;
    let t = 0;
    while (t < 1 && canvasRef.current) {
      t = Math.min(1, (performance.now() - start) / dur);
      await drawBreakdown(off, bd, { seg: e.seg, step: e.step, anim: e.anim, t: t >= 1 ? undefined : t }, branding); // eslint-disable-line no-await-in-loop
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) { ctx.clearRect(0, 0, W, H); ctx.drawImage(off, 0, 0); }
      await new Promise((r) => requestAnimationFrame(r)); // eslint-disable-line no-await-in-loop
    }
    setPlaying(false);
  };
  // Every file, in show order (stills and clips), numbered.
  const downloadAll = async () => {
    setBusy("all");
    setMsg("");
    try {
      for (let i = 0; i < seq.length; i += 1) {
        const e = seq[i];
        setProg({ i: i + 1, n: seq.length, name: fileName(bd, e), status: e.kind === "mov" ? "Starting the clip…" : "" });
        await exportEntry(e).catch((err) => { throw new Error(`${fileName(bd, e)}: ${err.message}`); }); // eslint-disable-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 450)); // eslint-disable-line no-await-in-loop
      }
      setMsg(`Downloaded all ${seq.length} files (the thumbnail is its own download).`);
    } catch (err) {
      setMsg(`Couldn't export: ${err.message}`);
    }
    setProg(null);
    setBusy("");
  };
  const copy = (text, what) => navigator.clipboard?.writeText(text).then(() => setMsg(`${what} copied.`));

  // A trait list's editor. Renaming, adding, removing or reordering makes
  // the list an edit; a note or ★ alone leaves it following the evaluation.
  const traitEditor = (seg, color) => {
    const items = bd[seg] || [];
    const titles = items.map((x) => x.title);
    const setTitles = (fn) => edit({ [seg]: fn([...titles]) });
    const per = items.length ? Math.round(((bd.times?.[seg]) || DEFAULT_TIMES[seg]) / items.length) : 0;
    return (
      <div style={section}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ ...head, color, flex: 1 }}>{seg === "strengths" ? "Strengths" : "Weaknesses"}{isEdited(seg) && editedDot}</div>
          {per > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: "#7a8597" }}>~{per}s each</span>}
        </div>
        {items.map((it, i) => (
          <div key={`${it.title}-${i}`} style={{ display: "grid", gap: 4, paddingBottom: 8, borderBottom: "1px solid #edf0f5" }}>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <button type="button" title={it.key ? "Key trait (on the Verdict) — click to drop" : "Make it a key trait (on the Verdict)"} style={{ ...mini, color: it.key ? UI_GOLD : "#c3cad4", fontSize: 16 }}
                onClick={() => edit((e) => ({ keys: { ...(e.keys || {}), [it.title]: !it.key } }))}>★</button>
              <input value={it.title} list="bd-traits" placeholder="Trait" style={field}
                onChange={(e) => { const v = e.target.value; edit((ed) => ({ [seg]: titles.map((t, j) => (j === i ? v : t)), notes: it.note ? { ...(ed.notes || {}), [v]: it.note } : ed.notes })); }} />
              <button type="button" style={mini} disabled={!i} title="Up" onClick={() => setTitles((l) => { [l[i - 1], l[i]] = [l[i], l[i - 1]]; return l; })}>↑</button>
              <button type="button" style={mini} disabled={i === items.length - 1} title="Down" onClick={() => setTitles((l) => { [l[i + 1], l[i]] = [l[i], l[i + 1]]; return l; })}>↓</button>
              <button type="button" style={{ ...mini, color: RED }} title="Remove" onClick={() => setTitles((l) => l.filter((_, j) => j !== i))}>✕</button>
            </div>
          </div>
        ))}
        {items.length < MAX_TRAITS && <button type="button" style={{ ...btn(false), justifySelf: "start", padding: "4px 10px" }} onClick={() => setTitles((l) => [...l, ""])}>+ Add</button>}
      </div>
    );
  };

  const teamSelect = (value, onChange, blank = "—") => (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} style={field}>
      <option value="">{blank}</option>
      {NFL_TEAM_ABBRS.map((a) => <option key={a} value={a}>{teamNameFromAbbr(a)}</option>)}
    </select>
  );
  const viewerCopy = bd ? `Think we got ${bd.first} ${bd.last} wrong? Make your own scouting report — grade him, pick his strengths and weaknesses, and see how you stack up with the community: https://${playerUrl(bd)}` : "";
  const times = { ...DEFAULT_TIMES, ...(bd?.times || {}) };

  // Dragging the cutout on the preview: the title card's or the background's.
  const dragSeg = bd && (view.seg === "title" || view.seg === "background") ? view.seg : null;
  const toCanvas = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  };
  // On the thumbnail, a text piece under the pointer is dragged (its
  // thumbLayout offset); anywhere else, the player.
  const pieceAt = (at) => {
    const boxes = (view.seg === "title" && canvasRef.current?.titleBoxes) || {};
    return Object.keys(boxes).reverse().find((k) => { const b = boxes[k]; return at.x >= b.x - 10 && at.x <= b.x + b.w + 10 && at.y >= b.y - 10 && at.y <= b.y + b.h + 10; }) || null;
  };
  const dragStart = (e) => {
    if (!dragSeg) return;
    const from = toCanvas(e);
    const key = dragSeg === "title" ? pieceAt(from) : null;
    if (key) {
      dragRef.current = { piece: key, from, pos: { dx: 0, dy: 0, s: 1, ...(bd.thumbLayout?.[key] || {}) } };
      setThumbPiece(key);
    } else {
      const [posKey, def] = dragSeg === "title" ? ["thumbPos", DEFAULT_THUMB_POS] : ["bgPos", DEFAULT_BG_POS];
      dragRef.current = { posKey, from, pos: { ...def, ...(bd[posKey] || {}) } };
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const dragMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const at = toCanvas(e);
    if (d.piece) {
      const next = { ...d.pos, dx: Math.round(d.pos.dx + at.x - d.from.x), dy: Math.round(d.pos.dy + at.y - d.from.y) };
      edit((ed) => ({ thumbLayout: { ...(ed.thumbLayout || bd.thumbLayout || {}), [d.piece]: next } }));
      return;
    }
    edit({ [d.posKey]: { ...d.pos, x: Math.round(d.pos.x + at.x - d.from.x), y: Math.round(d.pos.y + at.y - d.from.y) } });
  };
  const dragEnd = () => { dragRef.current = null; };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 18, alignItems: "start" }}>
      <datalist id="bd-traits">{traitWords.map((t) => <option key={t} value={t} />)}</datalist>
      {player && <CareerFeed player={player} espnId={espnId} onRows={(rows) => setLive((l) => (l ? { ...l, career: rows } : l))} />}
      {/* ── Editor ── */}
      <div style={{ display: "grid", gap: 10 }}>
        <div style={section}>
          <div style={head}>{portalTab ? "Portal Breakdowns" : reactionTab ? "Draft Reactions" : "Draft Breakdowns"}</div>
          <div style={{ position: "relative" }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={players ? "Search a prospect…" : "Loading players…"} style={field} />
            {matches.length > 0 && (
              <div style={{ position: "absolute", zIndex: 5, top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #d5dce6", borderRadius: 8, boxShadow: "0 6px 18px rgba(0,0,0,0.12)", maxHeight: 300, overflowY: "auto" }}>
                {matches.map((p) => (
                  <button key={p.id} type="button" onClick={() => pick(p)} style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", border: "none", background: "none", cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
                    {p.First} {p.Last} <span style={{ color: "#7a8597", fontWeight: 700 }}>· {p.Position} · {p.School} {portalTab && p.InPortal ? "· in the portal" : portalTab && p.PortalCommittedAt ? "· transferred" : ""} {saved[p.id] ? "· saved" : ""}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {savedList.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {savedList.slice(0, 14).map(([id, s]) => {
                const p = players?.find((x) => x.id === id);
                return (
                  <button key={id} type="button" disabled={!p} onClick={() => p && pick(p)} style={{ fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "3px 9px", border: "1px solid #d5dce6", background: id === bd?.playerId ? "#eaf2fb" : "#f6f8fb", cursor: p ? "pointer" : "default" }}>
                    {s.first} {s.last}
                  </button>
                );
              })}
            </div>
          )}
          {bd && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" onClick={refresh} style={{ ...btn(false), padding: "4px 10px" }} title="Re-read his evaluation, player doc, photos, stats and community grades">↻ Refresh live data</button>
              <button type="button" onClick={backToLive} disabled={!Object.keys(edits).length} style={{ ...btn(false), padding: "4px 10px", opacity: Object.keys(edits).length ? 1 : 0.5 }}>Back to live</button>
            </div>
          )}
          {bd && <div style={{ fontSize: 11, fontWeight: 700, color: "#7a8597" }}>Everything follows the live data unless you change it here — changed fields get a <span style={{ color: UI_GOLD, fontWeight: 900 }}>•</span>.</div>}
        </div>

        {bd && (
          <>
            {portalTab && (
            <div style={section}>
              <div style={head}>The move</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#7a8597" }}>From {live?.portalSrc || "—"}. The whole video is themed in the new school's colors.</div>
              {(
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {[["fromSchool", "From (old school)"], ["toSchool", "To (new school)"]].map(([k, l]) => (
                    <div key={k}>
                      <div style={lbl}>{l}{isEdited(k) && editedDot}</div>
                      <input value={bd[k] || ""} list="bd-schools" placeholder={k === "toSchool" ? "Blank = still in the portal" : "School"} onChange={(e) => edit({ [k]: e.target.value })}
                        style={{ ...field, borderColor: bd[k] && !schools[bd[k]] ? "#e0a100" : "#d5dce6" }} />
                    </div>
                  ))}
                  <datalist id="bd-schools">{Object.keys(schools).sort().map((n) => <option key={n} value={n} />)}</datalist>
                  {[bd.fromSchool, bd.toSchool].some((n) => n && !schools[n]) && <div style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 700, color: "#b45309" }}>A school name doesn't match one we have — pick it from the list for its logo.</div>}
                </div>
              )}
              <div><div style={lbl}>Verdict headline{isEdited("celebrateTitle") && editedDot}</div><input value={bd.celebrateTitle || ""} onChange={(e) => edit({ celebrateTitle: e.target.value })} style={field} /></div>
            </div>
            )}

            {!portalTab && (
            <div style={section}>
              <div style={head}>Thumbnail{(isEdited("thumbMode") || isEdited("thumbHook")) && editedDot}</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[["name", "Player name"], ["hook", "Hook words"]].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => { edit({ thumbMode: k }); setView({ seg: "title", step: 0 }); }}
                    style={{ ...btn((bd.thumbMode || "name") === k), padding: "5px 12px" }}>{l}</button>
                ))}
              </div>
              {bd.thumbMode === "hook" && (
                <div>
                  <div style={lbl}>2–3 words (one line each; Enter to set your own lines) — his name goes above as the eyebrow</div>
                  <textarea value={bd.thumbHook || ""} rows={3} placeholder={"HE'S HOW OLD?!"} onChange={(e) => { edit({ thumbHook: e.target.value }); if (view.seg !== "title") setView({ seg: "title", step: 0 }); }}
                    style={{ ...field, resize: "vertical", textTransform: "uppercase" }} />
                </div>
              )}
              <div style={lbl}>Text sizes{isEdited("thumbLayout") && editedDot} — drag any of them on the preview to move it</div>
              {(bd.thumbMode === "hook" ? ["eyebrow", "hook", "graphic"] : ["name", "info", "graphic"]).map((k) => {
                const L = { dx: 0, dy: 0, s: 1, ...(bd.thumbLayout?.[k] || {}) };
                const setL = (patch) => { edit((ed) => ({ thumbLayout: { ...(ed.thumbLayout || bd.thumbLayout || {}), [k]: { ...L, ...patch } } })); if (view.seg !== "title") setView({ seg: "title", step: 0 }); };
                return (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: thumbPiece === k ? UI_BLUE : "#5f6b7a", width: 150 }}>{THUMB_PIECES[k]}</span>
                    <input type="range" min={0.4} max={2} step={0.02} value={L.s} style={{ flex: 1 }} onChange={(e) => setL({ s: Number(e.target.value) })} />
                    <span style={{ fontSize: 12, fontWeight: 800, width: 40 }}>{Math.round(L.s * 100)}%</span>
                    <button type="button" style={mini} onClick={() => edit((ed) => { const next = { ...(ed.thumbLayout || bd.thumbLayout || {}) }; delete next[k]; return { thumbLayout: Object.keys(next).length ? next : undefined }; })}>Reset</button>
                  </div>
                );
              })}
            </div>
            )}

            <div style={section}>
              <div style={head}>Player cutouts</div>
              {!bd.actions?.length && <div style={{ fontSize: 12, fontWeight: 700, color: "#b45309" }}>No action shots for him — add some in Content → Photos. Using his headshot.</div>}
              {[["photo", "thumbPos", "Thumbnail", "title", DEFAULT_THUMB_POS], ["bgPhoto", "bgPos", "Background", "background", DEFAULT_BG_POS]].map(([key, posKey, title, seg, def]) => {
                const current = bd[key] || (key === "bgPhoto" ? bd.photo : "") || bd.headshot;
                const pos = { ...def, ...(bd[posKey] || {}) };
                return (
                  <div key={key} style={{ display: "grid", gap: 6 }}>
                    <div style={lbl}>{title}{(isEdited(key) || isEdited(posKey)) && editedDot}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {[...(bd.actions || []), ...(bd.headshot ? [bd.headshot] : [])].map((u) => (
                        <button key={u} type="button" title={u === bd.headshot ? "Headshot" : "Action shot"} onClick={() => { edit({ [key]: u }); setView({ seg, step: 0 }); }}
                          style={{ padding: 0, border: `3px solid ${current === u ? UI_GOLD : "transparent"}`, borderRadius: 8, cursor: "pointer", background: "repeating-conic-gradient(#e9edf2 0% 25%, #fff 0% 50%) 50% / 12px 12px" }}>
                          <img src={u} alt="" style={{ width: 64, height: 64, objectFit: "contain", display: "block" }} />
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#5f6b7a", width: 34 }}>Size</span>
                      <input type="range" min={0.4} max={5} step={0.02} value={pos.s} style={{ flex: 1 }}
                        onChange={(e) => { edit({ [posKey]: { ...pos, s: Number(e.target.value) } }); if (view.seg !== seg) setView({ seg, step: 0 }); }} />
                      <span style={{ fontSize: 12, fontWeight: 800, width: 40 }}>{Math.round(pos.s * 100)}%</span>
                      <button type="button" style={mini} onClick={() => edit({ [posKey]: undefined })}>Reset</button>
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize: 11, fontWeight: 700, color: "#7a8597" }}>Drag the player on the preview (Thumbnail or Background) to move him.</div>
            </div>

            {!portalTab && (
            <div style={section}>
              <div style={head}>Intro · subscribe card</div>
              {[["subTitle", "Headline"], ["subLine", "Gold line"]].map(([k, l]) => (
                <div key={k}><div style={lbl}>{l}{isEdited(k) && editedDot}</div><input value={bd[k] || ""} onChange={(e) => edit({ [k]: e.target.value })} style={field} /></div>
              ))}
            </div>
            )}

            <div style={section}>
              <div style={head}>Background</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {[["first", "First"], ["last", "Last"], ["pos", "Position"], ["school", "School"], ["cls", "Draft class"]].map(([k, l]) => (
                  <div key={k}><div style={lbl}>{l}{isEdited(k) && editedDot}</div><input value={bd[k] || ""} onChange={(e) => edit({ [k]: e.target.value })} style={field} /></div>
                ))}
                {[["hometown", "Hometown"], ["hs", "High school"]].map(([k, l]) => (
                  <div key={k}><div style={lbl}>{l}{edits.facts?.[k] !== undefined && editedDot}</div><input value={bd.facts[k] || ""} onChange={(e) => editFact(k, e.target.value)} style={field} /></div>
                ))}
                <div><div style={lbl}>Recruit stars{edits.facts?.stars !== undefined && editedDot}</div>
                  <select value={bd.facts.stars || 0} onChange={(e) => editFact("stars", Number(e.target.value))} style={field}>
                    {[0, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n ? `${n}★` : "Hide"}</option>)}
                  </select>
                </div>
              </div>
              <div style={lbl}>Measurements{isEdited("measures") && editedDot}</div>
              {(bd.measures || []).map((m, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 24px", gap: 4 }}>
                  <input value={m.label} onChange={(e) => edit({ measures: bd.measures.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} style={field} />
                  <input value={m.value} onChange={(e) => edit({ measures: bd.measures.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} style={field} />
                  <button type="button" style={{ ...mini, color: RED }} onClick={() => edit({ measures: bd.measures.filter((_, j) => j !== i) })}>✕</button>
                </div>
              ))}
              {(bd.measures || []).length < 8 && <button type="button" style={{ ...btn(false), justifySelf: "start", padding: "4px 10px" }} onClick={() => edit({ measures: [...(bd.measures || []), { label: "", value: "" }] })}>+ Measurement</button>}
              {bd.careerGroups?.length > 1 && (
                <div><div style={lbl}>Career stats{isEdited("careerCat") && editedDot}</div>
                  <select value={bd.careerCat} onChange={(e) => edit({ careerCat: e.target.value })} style={field}>
                    {bd.careerGroups.map((g) => <option key={g} value={g}>{bd.careerTables[g]?.title || g}</option>)}
                  </select>
                </div>
              )}
              <div style={lbl}>Career path (oldest → newest on screen, up to 5)</div>
              {(bd.career || []).length === 0 && <div style={{ fontSize: 12, fontWeight: 700, color: "#9aa4b2" }}>Loading his career path…</div>}
              {(bd.career || []).map((r) => (
                <label key={r.key} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 700 }}>
                  <input type="checkbox" checked={!bd.hideCareer[r.key]} onChange={(e) => edit((ed) => ({ hideCareer: { ...(ed.hideCareer || {}), [r.key]: !e.target.checked } }))} />
                  {r.name} <span style={{ color: "#7a8597" }}>{r.span}</span>
                </label>
              ))}
              <div><div style={lbl}>Season panel title{isEdited("statsTitle") && editedDot}</div><input value={bd.statsTitle} onChange={(e) => edit({ statsTitle: e.target.value })} style={field} /></div>
              {Array.from({ length: STAT_COUNT }, (_, i) => {
                const s = bd.stats[i] || { label: "", value: "" };
                const setStat = (patch) => { const l = [...bd.stats]; while (l.length <= i) l.push({ label: "", value: "" }); l[i] = { ...l[i], ...patch }; edit({ stats: l }); };
                return (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px", gap: 4 }}>
                    <select value="" onChange={(e) => { const o = statOpts.find((x) => x.key === e.target.value); if (o) setStat({ label: o.label, value: o.value, rank: o.rank || "" }); }} style={{ ...field, color: "#7a8597" }}>
                      <option value="">{statOpts.length ? "ESPN stat…" : "No ESPN stats"}</option>
                      {statOpts.map((o) => <option key={o.key} value={o.key}>{o.label} — {o.value}</option>)}
                    </select>
                    <input value={s.label} placeholder="Label" onChange={(e) => setStat({ label: e.target.value })} style={field} />
                    <input value={s.value} placeholder="Value" onChange={(e) => setStat({ value: e.target.value })} style={field} />
                  </div>
                );
              })}
            </div>

            {traitEditor("strengths", GREEN)}
            {traitEditor("weaknesses", RED)}

            {reactionTab && (
            <div style={section}>
              <div style={head}>The pick</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#7a8597" }}>From {live?.pickSrc || "—"}. The thumbnail is in the team's colors; the background clip opens on the pick.</div>
              <div><div style={lbl}>NFL team{isEdited("nflTeam") && editedDot}</div>{teamSelect(bd.nflTeam, (v) => edit({ nflTeam: v }), "—")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {[["round", "Round"], ["pick", "Pick (overall)"]].map(([k, l]) => (
                  <div key={k}><div style={lbl}>{l}{isEdited(k) && editedDot}</div><input value={bd[k] || ""} inputMode="numeric" onChange={(e) => edit({ [k]: e.target.value.replace(/[^0-9]/g, "") })} style={field} /></div>
                ))}
              </div>
              <div><div style={lbl}>Pick grade{isEdited("pickGrade") && editedDot}</div>
                <select value={bd.pickGrade || ""} onChange={(e) => { edit({ pickGrade: e.target.value }); setView({ seg: "pickgrade", step: 0 }); }} style={field}>
                  <option value="">—</option>
                  {PICK_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div><div style={lbl}>Why (optional, under the grade){isEdited("pickNote") && editedDot}</div><input value={bd.pickNote || ""} onChange={(e) => edit({ pickNote: e.target.value })} style={field} /></div>
            </div>
            )}

            {kind === "draft" && (<div style={section}>
              <div style={head}>The Verdict</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {VERDICT_ITEMS.map(([k, l]) => (
                  <label key={k} style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 13, fontWeight: 800 }}>
                    <input type="checkbox" checked={bd.verdict[k] !== false} onChange={(e) => edit((ed) => ({ verdict: { ...(ed.verdict || {}), [k]: e.target.checked } }))} /> {l}
                  </label>
                ))}
              </div>
              <div><div style={lbl}>Draft grade{isEdited("grade") && editedDot}</div>
                <select value={bd.grade} onChange={(e) => edit({ grade: e.target.value })} style={field}>
                  <option value="">—</option>
                  {Object.keys(GRADE_SCALE).map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div style={lbl}>Player comp (draft history, 2000–2026)</div>
              {bd.comp?.name && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800 }}>
                  <span style={{ flex: 1 }}>{bd.comp.name} <span style={{ color: "#7a8597", fontWeight: 700 }}>· {bd.comp.pos} · {compLine(bd.comp).toLowerCase()} · {bd.comp.team}</span></span>
                  <button type="button" style={{ ...mini, color: RED }} onClick={() => edit({ comp: null })}>✕</button>
                </div>
              )}
              <div style={{ position: "relative" }}>
                <input value={compSearch} onFocus={() => { if (!history) draftHistory().then(setHistory); }} onChange={(e) => setCompSearch(e.target.value)} placeholder={history ? "Search drafted players…" : "Search drafted players (loads on click)…"} style={field} />
                {compMatches.length > 0 && (
                  <div style={{ position: "absolute", zIndex: 5, top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #d5dce6", borderRadius: 8, boxShadow: "0 6px 18px rgba(0,0,0,0.12)", maxHeight: 280, overflowY: "auto" }}>
                    {compMatches.map((h) => (
                      <button key={`${h.year}-${h.pick}-${h.name}`} type="button" onClick={() => { edit({ comp: h }); setCompSearch(""); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", border: "none", background: "none", cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
                        {h.name} <span style={{ color: "#7a8597", fontWeight: 700 }}>· {h.pos} · {h.year} Rd {h.round} #{h.pick} · {h.team} · {h.school}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div><div style={lbl}>Why the comp (optional)</div><input value={bd.compNote || ""} onChange={(e) => edit({ compNote: e.target.value })} style={field} /></div>
              <div style={lbl}>Team fits{isEdited("fits") && editedDot}</div>
              {Array.from({ length: MAX_FITS }, (_, i) => (
                <div key={i}>{teamSelect(bd.fits[i], (v) => { const l = [...(bd.fits || [])]; l[i] = v; edit({ fits: l.filter((x, j) => x || j < i) }); }, `Fit ${i + 1}`)}</div>
              ))}
            </div>)}

            <div style={section}>
              <div style={head}>Community</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#5f6b7a" }}>
                {bd.community?.count ? `${bd.community.count} evaluations · ${gradeLabel(bd.community.avg) || "no grade"} (live — ↻ to update)` : "No community evaluations yet — the card asks viewers to be first."}
              </div>
              <div><div style={lbl}>Call to action{isEdited("cta") && editedDot}</div><input value={bd.cta || ""} onChange={(e) => edit({ cta: e.target.value })} style={field} /></div>
              <div style={lbl}>Viewer copy (description / pinned comment)</div>
              <textarea readOnly value={viewerCopy} rows={3} style={{ ...field, fontWeight: 600, resize: "vertical" }} />
              <button type="button" style={{ ...btn(false), justifySelf: "start", padding: "4px 10px" }} onClick={() => copy(viewerCopy, "Viewer copy")}>Copy viewer copy</button>
            </div>

            <div style={section}>
              <div style={head}>Run sheet · {clock(chapters.total)}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                {segsOf(bd).map((s) => (
                  <div key={s.key}><div style={lbl}>{s.label.toLowerCase()} (s)</div>
                    <input type="number" min={0} value={times[s.key]} onChange={(e) => edit({ times: { ...times, [s.key]: Number(e.target.value) || 0 } })} style={field} />
                  </div>
                ))}
              </div>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, fontWeight: 700 }}>
                <input type="checkbox" checked={!!bd.traitChapters} onChange={(e) => edit({ traitChapters: e.target.checked })} /> A chapter for each trait
              </label>
              <textarea readOnly value={chapters.text} rows={Math.min(14, chapters.text.split("\n").length + 1)} style={{ ...field, fontFamily: "monospace", fontWeight: 600, resize: "vertical" }} />
              <button type="button" style={{ ...btn(false), justifySelf: "start", padding: "4px 10px" }} onClick={() => copy(chapters.text, "Chapters")}>Copy chapters</button>
            </div>
          </>
        )}
      </div>

      {/* ── Preview ── */}
      <div style={{ display: "grid", gap: 10, position: "sticky", top: 12 }}>
        {!bd && <div style={{ ...section, color: "#7a8597", fontWeight: 800, fontSize: 14 }}>Search a prospect to start his breakdown.</div>}
        {bd && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {chips.map((e) => {
                const on = e === current();
                const tint = e.seg === "strengths" ? GREEN : e.seg === "weaknesses" ? RED : "#1b2230";
                return (
                  <button key={`${e.n}-${e.id}`} type="button" onClick={() => setView({ seg: e.seg, step: e.step, kind: e.kind })} title={fileName(bd, e)}
                    style={{ fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "4px 10px", cursor: "pointer", maxWidth: 210, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      border: `1px solid ${on ? UI_BLUE : e.kind === "mov" ? UI_GOLD : "#d5dce6"}`, background: on ? UI_BLUE : e.kind === "mov" ? "#fff8ea" : "#fff", color: on ? "#fff" : tint }}>
                    {e.thumb ? "★ Thumbnail" : <>{String(e.n).padStart(2, "0")} {e.kind === "mov" ? "▶ " : ""}{e.label}</>}
                  </button>
                );
              })}
            </div>
            {/* A checkerboard behind, so the transparent windows show as such. */}
            <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid #d5dce6", background: "repeating-conic-gradient(#e9edf2 0% 25%, #fff 0% 50%) 50% / 24px 24px" }}>
              <canvas ref={canvasRef} width={W} height={H} onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd}
                style={{ width: "100%", display: "block", cursor: dragSeg ? "move" : "default", touchAction: dragSeg ? "none" : "auto" }} />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" onClick={save} disabled={!!busy} style={btn(true)}>{busy === "save" ? "Saving…" : dirty ? "Save edits •" : "Save edits"}</button>
              {current()?.kind === "mov" && <button type="button" onClick={play} disabled={playing || !!busy} style={btn(false)}>▶ Play</button>}
              <button type="button" onClick={downloadOne} disabled={!!busy} style={btn(false)}>{busy === "one" ? "Making it…" : `Download ${current()?.kind === "mov" ? "this clip" : "this still"}`}</button>
              <button type="button" onClick={downloadAll} disabled={!!busy} style={btn(false)}>Download all {seq.length} files</button>
              <button type="button" onClick={() => downloadOne(THUMB)} disabled={!!busy} style={btn(false)}>Download thumbnail</button>
              <select value={fps} onChange={(e) => setFps(Number(e.target.value))} style={{ ...field, width: "auto" }} title="The clips' frame rate">
                {[30, 60].map((n) => <option key={n} value={n}>{n} fps</option>)}
              </select>
              {msg && <span style={{ fontSize: 12, fontWeight: 800, color: "#5f6b7a" }}>{msg}</span>}
            </div>
            {prog && (
              <div style={{ border: `2px solid ${UI_BLUE}`, borderRadius: 10, padding: "10px 12px", background: "#f4f8fd", display: "grid", gap: 6 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 900, color: UI_BLUE }}>Downloading item {prog.i}/{prog.n}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#1b2230" }}>{prog.name}</span>
                  {prog.status && <span style={{ fontSize: 12, fontWeight: 700, color: "#5f6b7a" }}>{prog.status}</span>}
                </div>
                <div style={{ height: 8, borderRadius: 4, background: "#dbe5f1", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${((prog.i - 1) / prog.n) * 100}%`, background: UI_BLUE, transition: "width 0.3s" }} />
                </div>
              </div>
            )}
            <div style={{ fontSize: 12, fontWeight: 700, color: "#7a8597", lineHeight: 1.5 }}>
              {current() && <>This file: <b style={{ color: "#1b2230" }}>{fileName(bd, current())}</b>. </>}
              Files are numbered in show order — drop them into Premiere in that order. Each ▶ clip (.mov, ProRes 4444 with transparency) animates in and ends exactly on the still after it, which holds while you talk. Film window 1440×810 at x 36, y 150 (1080p footage at 75%); face cam 384×216 at x 1500, y 36 (a 1080p webcam at 20%).
            </div>
          </>
        )}
      </div>
    </div>
  );
}
