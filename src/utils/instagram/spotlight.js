// src/utils/instagram/spotlight.js
//
// Player Spotlight: a two-slide Instagram post (1080×1350), drawn like
// posts.js — plain data in, SVG out — so a server can draw it too.
//   1. The cover: the player over his action shot (backdrop taken out — see
//      knockout.js) under a spotlight — light beams, his last name huge and
//      outlined behind him — trading-card framed. Two looks (input.look):
//      "wash", his school's color falling off to near black at the foot;
//      "spotlight", a stage light: a hard-edged cone of his school's color
//      from above the frame onto a pool of light at his feet, black
//      everywhere it doesn't reach. His name,
//      then school, position, height and weight. A prospect in a class past
//      the next draft (2028, 2029 — the caller says: advance) carries an
//      ADVANCE SCOUTING badge with his class, like a baseball card's rookie
//      logo.
//   2. The scouting report, as his player page shows it (PlayerProfile.js's
//      Community Scouting Report): community grade with its scale, class
//      ranks, top strengths and weaknesses, NFL fits and measurements.
// spotlightInput assembles the input from what the page reads (the
// caller computes the report — it needs Firestore).
import { kit } from "./posts.js";
import { textOn, readableOn } from "../teamColors.js";
import { GRADE_SCALE, GRADE_LABELS, gradeLook } from "../gradeScale.js";
import { gradeCounts } from "../gradeWindow.js";
import { classSnapshotRanks } from "../classRanks.js";

const { GOLD, NAVY, PAD, FOOTER_H, DOT, FOCUS_X, hex, up, r1, widthOf, fitSize, text, fitLine, image, hasImage, placed, svgDoc, footer } = kit;
const W = 1080;
const H = 1350;
// A color darker by f (0–1 of its brightness kept).
const shade = (h, f) => `#${[1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * f))).toString(16).padStart(2, "0")).join("")}`;

// ── Measurements, as the player page shows them ──
// (PlayerProfile.js has its own copies: feet / inches / eighths.)
const EIGHTHS = { 0: "", 1: "1/8", 2: "1/4", 3: "3/8", 4: "1/2", 5: "5/8", 6: "3/4", 7: "7/8" };
function eighths(num) {
  let whole = Math.floor(num);
  let e = Math.round((num - whole) * 8);
  if (e === 8) { e = 0; whole += 1; }
  return `${whole}${EIGHTHS[e] ? ` ${EIGHTHS[e]}` : ""}`;
}
export function heightText(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  const m = s.match(/^(\d+)'(\d+(?:\.\d+)?)"?$/);
  if (!m) return s;
  return `${m[1]}'${eighths(parseFloat(m[2]))}"`;
}
export function inchesText(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  if (s.includes('"') || s.includes("/")) return s;
  const num = parseFloat(s);
  return Number.isNaN(num) ? s : `${eighths(num)}"`;
}
const verticalText = (raw) => {
  const num = parseFloat(String(raw ?? "").replace(/"/g, ""));
  return Number.isNaN(num) ? String(raw ?? "") : `${Number(num.toFixed(1))}"`;
};
const feetText = (raw) => {
  const s = String(raw ?? "").trim();
  if (!s || s.includes('"') || s.includes("'")) return s;
  const n = Math.round(parseFloat(s));
  return Number.isNaN(n) ? s : `${Math.floor(n / 12)}'${n % 12}"`;
};
// A player doc's measurements → [{ label, val }] (the page's order: body, then testing).
export function measurementsOf(p) {
  return [
    ["HEIGHT", heightText(p.Height)], ["WEIGHT", p.Weight ? `${p.Weight} LBS` : ""], ["WING", inchesText(p.Wingspan)],
    ["ARM", inchesText(p["Arm Length"])], ["HAND", inchesText(p["Hand Size"])],
    ["40 YD", p["40 Yard"] || ""], ["VERT", p.Vertical ? verticalText(p.Vertical) : ""], ["BROAD", feetText(p.Broad)],
    ["3-CONE", p["3-Cone"] || ""], ["SHUTTLE", p.Shuttle || ""], ["BENCH", p.Bench || ""],
  ].filter(([, v]) => v).map(([label, val]) => ({ label, val: String(val) }));
}

// His scouting report, as his player page works it out (PlayerProfile.js):
// the community grade from the grades that count for his class
// (gradeWindow.js), the top five strengths and weaknesses (a trait counts
// on the side more evaluations put it), class ranks from the class
// snapshot (classRanks.js), NFL fits — We-Draft.com's (compSnapshots/
// _nflFits rows: [{ t }]) then the community's top three, by team name.
// evaluations: the players/{id}/evaluations docs' data; branding: the nfl
// docs by abbr; teamNames: { [abbr]: "New York Jets" }.
export function scoutingReport({ player, evaluations = [], classSnap = null, nflFits = [], branding = {}, teamNames = {} }) {
  const grades = evaluations.filter((e) => GRADE_SCALE[e.grade] && gradeCounts(e, player.Eligible)).map((e) => GRADE_SCALE[e.grade]);
  const avg = grades.length ? grades.reduce((a, b) => a + b, 0) / grades.length : null;
  const label = avg == null ? "Watchlist" : GRADE_LABELS[Math.round(avg)];
  const count = (key) => {
    const c = {};
    evaluations.forEach((e) => (Array.isArray(e[key]) ? e[key] : []).forEach((t) => { c[t] = (c[t] || 0) + 1; }));
    return c;
  };
  const sC = count("strengths");
  const wC = count("weaknesses");
  // A Watchlist evaluation with no traits is a bookmark: not in the bars' denominator.
  const reports = evaluations.filter((e) => e.grade !== "Watchlist" || (e.strengths?.length || 0) + (e.weaknesses?.length || 0) > 0).length || 1;
  const top = (c, other, wins) => Object.entries(c).filter(([t, n]) => wins(n, other[t])).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([term, n]) => ({ term, pct: (n / reports) * 100 }));
  const fC = {};
  evaluations.forEach((e) => { if (e.nflFit) fC[e.nflFit] = (fC[e.nflFit] || 0) + 1; });
  const communityFits = Object.entries(fC).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
  const abbrOf = Object.fromEntries(Object.entries(teamNames).map(([abbr, name]) => [name, abbr]));
  const wd = (nflFits || []).map((f) => f.t).filter(Boolean).slice(0, communityFits.length >= 2 ? 1 : communityFits.length === 1 ? 2 : 3);
  const fits = [...new Set([...wd, ...communityFits.map((n) => abbrOf[n]).filter(Boolean)])]
    .map((abbr) => ({ name: teamNames[abbr] || abbr, logo: branding[abbr]?.Logo1 || branding[abbr]?.LogoDark || "" }));
  const ranks = classSnap ? classSnapshotRanks(classSnap)[player.id] || {} : {};
  const hidden = !!classSnap?.hidden?.[player.id];
  return {
    grade: { ...gradeLook(label), label, avg },
    evals: evaluations.length,
    bars: evaluations.length >= 5,
    strengths: top(sC, wC, (n, o) => n >= (o ?? -Infinity)),
    weaknesses: top(wC, sC, (n, o) => n > (o ?? -Infinity)),
    posRank: ranks.positionRank ?? null, posOf: (classSnap?.rows?.length || 0) + (hidden ? 1 : 0) || null,
    classRank: ranks.classRank ?? null, classOf: (classSnap?.classSize || 0) + (hidden ? 1 : 0) || null,
    fits,
  };
}

// The input. player: the players doc; school: its schools doc ({ Color1,
// Color2, Logo1, LogoDark }); photo: { url, orientation } (an action shot);
// report: { grade: { label, short, bg, border, avg (1–10) | null }, evals,
// posRank, posOf, classRank, classOf, strengths / weaknesses: [{ term, pct }],
// bars (show the trait bars — 5+ evaluations), fits: [{ name, logo }] };
// advance: his class is past the next draft.
export function spotlightInput({ player, school = {}, photo = null, headshot = "", report = {}, advance = false, brandLogo = "", address = "", look = "wash", accent = "", badge = "crest" }) {
  return {
    first: player?.First || "", last: player?.Last || "", pos: player?.Position || "", school: player?.School || "", year: String(player?.Eligible || ""),
    height: heightText(player?.Height), weight: player?.Weight ? String(player.Weight) : "",
    measurements: measurementsOf(player || {}),
    color: school.Color1 || NAVY, color2: school.Color2 || GOLD,
    // On his school's color its dark logo; on the white report its own.
    logoDark: school.LogoDark || school.Logo1 || "", logo: school.Logo1 || school.LogoDark || "",
    photo: photo?.url || "", focus: photo?.orientation === "left" ? "right" : photo?.orientation === "right" ? "left" : "center",
    headshot, report, advance: !!advance, brandLogo,
    // The cover's look ("wash" | "spotlight") and the accent (frame, bars,
    // glow, ring) — the school's second color unless the admin picks one.
    look: look === "spotlight" ? "spotlight" : "wash", accent: hex(accent) || "",
    // The ADVANCE SCOUTING badge's design: "crest" | "plate".
    badge: badge === "plate" ? "plate" : "crest",
    address: address || (player?.Slug ? `WE-DRAFT.COM/PLAYER/${player.Slug}` : "WE-DRAFT.COM"),
  };
}

// The ADVANCE SCOUTING badge, a sports card's rookie logo, in one of two
// designs — both slanted like a jersey's lettering, with speed stripes:
//   crest  an angular varsity crest: a gold ADVANCE band across its top,
//          his class big and outlined, SCOUTING under it
//   plate  a slanted gold nameplate: ADVANCE SCOUTING on a navy band, his
//          class big, speed stripes trailing off its right side
const SLANT = -12;
// Text in a jersey's slant (Bebas Neue has no italic), outlined first when asked.
function slanted(x, y, value, size, fill, { outline = "", width = 0, spacing = 0 } = {}) {
  const t = (paint) => `<text x="${x}" y="${y}" text-anchor="middle" font-family="Bebas Neue" font-size="${size}" letter-spacing="${spacing}" ${paint}>${kit.esc(value)}</text>`;
  return `<g transform="skewX(${SLANT})">`
    + (outline ? t(`fill="${outline}" stroke="${outline}" stroke-width="${width}" stroke-linejoin="round"`) : "")
    + t(`fill="${fill}"`) + "</g>";
}

function advanceBadge(cx, cy, year, s = 1, design = "crest") {
  return `<g transform="translate(${cx} ${cy}) rotate(-6) scale(${s})" filter="url(#badgeShadow)">`
    + (design === "plate" ? advancePlate(year) : advanceCrest(year)) + "</g>";
}

function advanceCrest(year) {
  const crest = (k) => `M ${-90 * k} ${-118 * k} L ${90 * k} ${-118 * k} L ${116 * k} ${-90 * k} L ${116 * k} ${30 * k} L 0 ${126 * k} L ${-116 * k} ${30 * k} L ${-116 * k} ${-90 * k} Z`;
  // Speed stripes, slanted, faint gold across the crest.
  const stripes = [-150, -105, -60, 60, 105, 150].map((x) => `<rect x="${x}" y="-140" width="14" height="300" fill="${GOLD}" fill-opacity="0.13" transform="skewX(-28)"/>`).join("");
  return `<clipPath id="crestClip"><path d="${crest(0.95)}"/></clipPath>`
    + `<path d="${crest(1)}" fill="${NAVY}" stroke="#ffffff" stroke-width="16" stroke-linejoin="round"/>`
    + `<path d="${crest(1)}" fill="${NAVY}" stroke="${GOLD}" stroke-width="6" stroke-linejoin="round"/>`
    + `<g clip-path="url(#crestClip)">${stripes}<rect x="-130" y="-104" width="260" height="42" fill="${GOLD}" transform="skewX(${SLANT})"/></g>`
    + slanted(0, -71, "ADVANCE", 34, NAVY, { spacing: 4 })
    + slanted(0, 32, year, 100, GOLD, { outline: "#ffffff", width: 8, spacing: 1 })
    + slanted(0, 74, "SCOUTING", 28, "#ffffff", { spacing: 4 });
}

function advancePlate(year) {
  const w = 270;
  const h = 150;
  const band = 44;
  return `<clipPath id="plateClip"><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="12" transform="skewX(${SLANT})"/></clipPath>`
    + `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="12" fill="${GOLD}" stroke="#ffffff" stroke-width="9" transform="skewX(${SLANT})"/>`
    + `<g clip-path="url(#plateClip)"><rect x="${-w / 2 - 30}" y="${-h / 2}" width="${w + 60}" height="${band}" fill="${NAVY}"/>`
    // Speed stripes trailing off the right side, and a navy rule along the foot.
    + [0, 1, 2].map((i) => `<rect x="${88 + i * 18}" y="${-h / 2 + band + 12}" width="${9 - i * 2}" height="${h - band - 24}" fill="${NAVY}" transform="skewX(-24)"/>`).join("")
    + `<rect x="${-w / 2 - 30}" y="${h / 2 - 12}" width="${w + 60}" height="12" fill="${NAVY}"/></g>`
    + slanted(0, -h / 2 + 33, "ADVANCE SCOUTING", 30, GOLD, { spacing: 3 })
    + slanted(-14, h / 2 - 22, year, 98, NAVY, { spacing: 2 });
}

// ── Slide 1: the cover ──
function coverSvg(env, input, total) {
  const bg = hex(input.color) || NAVY;
  const c2 = hex(input.accent) || hex(input.color2) || GOLD;
  const W2 = W - PAD * 2;
  const bottom = H - FOOTER_H;
  // The school's color at the top, falling off to near black at the foot,
  // where the name block sits (so its text is always white).
  const lit = input.look === "spotlight";
  // Spotlight: black where the light doesn't reach. Wash: the color, falling off.
  const deep = lit ? "#050608" : shade(bg, 0.22);
  const ink = "#ffffff";
  const onDark = true;
  // The light: white over the wash; the school's color itself on black
  // (a touch brighter at its heart).
  const light = lit ? bg : "#ffffff";
  const beam = (id, o) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}" stop-opacity="${o}"/><stop offset="0.78" stop-color="${light}" stop-opacity="0"/></linearGradient>`;
  const defs = (lit
    ? `<linearGradient id="base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${deep}"/><stop offset="1" stop-color="${deep}"/></linearGradient>`
      + `<linearGradient id="cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(bg, 1.4)}" stop-opacity="0.95"/><stop offset="0.55" stop-color="${bg}" stop-opacity="0.82"/><stop offset="1" stop-color="${shade(bg, 0.8)}" stop-opacity="0.75"/></linearGradient>`
      + '<linearGradient id="core" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.42"/><stop offset="0.7" stop-color="#ffffff" stop-opacity="0.08"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>'
      + `<radialGradient id="pool" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${shade(bg, 1.35)}"/><stop offset="0.85" stop-color="${bg}"/><stop offset="1" stop-color="${shade(bg, 0.85)}"/></radialGradient>`
      + '<radialGradient id="spot" cx="0.5" cy="0" r="0.6"><stop offset="0" stop-color="#ffffff" stop-opacity="0.3"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>'
    : `<linearGradient id="base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(bg, 1.08)}"/><stop offset="0.5" stop-color="${shade(bg, 0.72)}"/><stop offset="0.78" stop-color="${deep}"/><stop offset="1" stop-color="${deep}"/></linearGradient>`
      + '<radialGradient id="spot" cx="0.5" cy="0.32" r="0.5"><stop offset="0" stop-color="#ffffff" stop-opacity="0.34"/><stop offset="0.55" stop-color="#ffffff" stop-opacity="0.08"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>')
    + `<radialGradient id="rim" cx="0.5" cy="0.62" r="0.5"><stop offset="0" stop-color="${c2}" stop-opacity="0.28"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></radialGradient>`
    + '<radialGradient id="vignette" cx="0.5" cy="0.42" r="0.78"><stop offset="0.55" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.62"/></radialGradient>'
    // The top corners, darker still.
    + '<radialGradient id="cornerL" cx="0" cy="0" r="1"><stop offset="0" stop-color="#000000" stop-opacity="0.78"/><stop offset="0.55" stop-color="#000000" stop-opacity="0.3"/><stop offset="1" stop-color="#000000" stop-opacity="0"/></radialGradient>'
    + '<radialGradient id="cornerR" cx="1" cy="0" r="1"><stop offset="0" stop-color="#000000" stop-opacity="0.78"/><stop offset="0.55" stop-color="#000000" stop-opacity="0.3"/><stop offset="1" stop-color="#000000" stop-opacity="0"/></radialGradient>'
    + (lit ? beam("beamA", 0.62) + beam("beamB", 0.4) : beam("beamA", 0.2) + beam("beamB", 0.12))
    + `<linearGradient id="foot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${deep}" stop-opacity="0"/><stop offset="1" stop-color="${deep}" stop-opacity="1"/></linearGradient>`
    + '<filter id="badgeShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="8" stdDeviation="9" flood-color="#000000" flood-opacity="0.45"/></filter>'
    + '<filter id="playerShadow" x="-20%" y="-10%" width="140%" height="130%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000000" flood-opacity="0.55"/></filter>'
    + `<clipPath id="card"><rect x="0" y="0" width="${W}" height="${bottom}"/></clipPath>`;
  // Light beams from above, fanning out behind him.
  // On black, the stage light: a cone from just above the frame (hard
  // edges — lit inside, black outside), a brighter core down its middle,
  // and the pool it throws on the floor at his feet.
  const cx0 = W / 2;
  const floor = 1000;
  const cone = (top, base) => `M ${cx0 - top} -40 L ${cx0 + top} -40 L ${cx0 + base} ${floor} L ${cx0 - base} ${floor} Z`;
  const stage = `<path d="${cone(80, 640)}" fill="url(#cone)"/>`
    + `<ellipse cx="${cx0}" cy="${floor}" rx="640" ry="96" fill="url(#pool)"/>`
    + `<path d="${cone(34, 340)}" fill="url(#core)"/>`
    + `<path d="${cone(80, 640)}" fill="url(#spot)"/>`;
  const beams = [[-26, 250, "beamA"], [-9, 150, "beamB"], [8, 190, "beamA"], [24, 130, "beamB"]]
    .map(([deg, w, id]) => `<rect x="${W / 2 - w / 2}" y="-200" width="${w}" height="1400" fill="url(#${id})" transform="rotate(${deg} ${W / 2} -200)"/>`).join("");
  // His last name, huge and outlined, behind him.
  const ghost = up(input.last);
  const ghostS = ghost ? Math.min(560, (W * 1.18) / Math.max(1, widthOf(env, ghost, 100, 4) / 100)) : 0;
  let body = `<g clip-path="url(#card)"><rect width="${W}" height="${bottom}" fill="url(#base)"/>`
    + (lit ? stage : `<rect width="${W}" height="${bottom}" fill="url(#rim)"/>${beams}<rect width="${W}" height="${bottom}" fill="url(#spot)"/>`)
    + image(env, input.logoDark, 150, 170, W - 300, 620, "xMidYMid meet", 0.06)
    + (ghost ? `<text x="${W / 2}" y="${r1(560 + ghostS * 0.36)}" text-anchor="middle" font-family="Bebas Neue" font-size="${r1(ghostS)}" letter-spacing="4" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="3">${kit.esc(ghost)}</text>` : "")
    + `<rect width="${W}" height="${bottom}" fill="url(#vignette)"/>`
    + `<rect width="${W * 0.55}" height="620" fill="url(#cornerL)"/><rect x="${W * 0.45}" width="${W * 0.55}" height="620" fill="url(#cornerR)"/>`;
  // The photo: kept whole, fading out behind the name block.
  if (hasImage(env, input.photo)) {
    body += `<g filter="url(#playerShadow)">${placed(image(env, input.photo, 40, 96, W - 80, 930, `${FOCUS_X[input.focus] || "xMid"}YMax meet`), 40, 96, W - 80, 930, input.adjust)}</g>`
      + `<rect y="760" width="${W}" height="268" fill="url(#foot)"/><rect y="1026" width="${W}" height="${bottom - 1026}" fill="${deep}"/>`;
  }
  body += "</g>";

  // From the footer up: the strip (school, position, height, weight), last name, first name.
  const stripH = 116;
  const stripTop = bottom - 44 - stripH;
  const cells = [
    { label: "SCHOOL", value: up(input.school), logo: input.logoDark, wide: true },
    { label: "POSITION", value: up(input.pos) },
    input.height && { label: "HEIGHT", value: input.height },
    input.weight && { label: "WEIGHT", value: `${input.weight} LBS` },
  ].filter((c) => c && c.value);
  const gap = 12;
  const units = cells.reduce((n, c) => n + (c.wide ? 1.9 : 1), 0);
  const unitW = (W2 - gap * (cells.length - 1)) / units;
  // On the black of the spotlight look, a faint light box; on the wash, a dark one.
  const fill = lit ? "rgba(255,255,255,0.07)" : onDark ? "rgba(0,0,0,0.32)" : "rgba(255,255,255,0.45)";
  let cx = PAD;
  cells.forEach((c) => {
    const cw = unitW * (c.wide ? 1.9 : 1);
    const lg = c.logo && hasImage(env, c.logo) ? 66 : 0;
    const tx = cx + 22 + (lg ? lg + 14 : 0);
    const tw = cw - 44 - (lg ? lg + 14 : 0);
    body += `<rect x="${r1(cx)}" y="${stripTop}" width="${r1(cw)}" height="${stripH}" rx="18" fill="${fill}"/>`
      + `<rect x="${r1(cx)}" y="${stripTop}" width="${r1(cw)}" height="6" rx="3" fill="${c2}"/>`
      + (lg ? image(env, c.logo, cx + 20, stripTop + (stripH - lg) / 2 + 3, lg, lg) : "")
      + text(tx, stripTop + 44, c.label, 24, ink, { spacing: 2, opacity: 0.75 })
      + fitLine(env, tx, stripTop + 96, c.value, 50, tw, ink, { spacing: 1, min: 22 }).svg;
    cx += cw + gap;
  });
  const last = up(input.last);
  const lastS = fitSize(env, last, 200, W2, 80, 2);
  const lastBase = stripTop - 30;
  body += text(PAD - 4, lastBase, last, lastS, ink, { spacing: 2 });
  body += fitLine(env, PAD, lastBase - lastS * 0.78 - 14, up(input.first), 86, W2, ink, { spacing: 3 }).svg;

  // PLAYER SPOTLIGHT, top left; the advance badge top right.
  const k = "PLAYER SPOTLIGHT";
  const kw = widthOf(env, k, 36, 3) + 48;
  body += `<rect x="${PAD}" y="58" width="${r1(kw)}" height="62" rx="31" fill="${GOLD}"/>` + text(PAD + 24, 58 + 31 + 13, k, 36, NAVY, { spacing: 3 });
  if (input.year && !input.advance) body += text(PAD + 4, 168, `${input.year} NFL DRAFT PROSPECT`, 34, ink, { spacing: 2, opacity: 0.85 });
  if (input.advance && input.year) body += advanceBadge(W - PAD - 110, input.badge === "plate" ? 150 : 172, input.year, input.badge === "plate" ? 0.92 : 0.95, input.badge);

  // The card's frame, in the school's second color.
  body += `<rect x="22" y="22" width="${W - 44}" height="${bottom - 44}" rx="30" fill="none" stroke="${c2}" stroke-width="6" stroke-opacity="0.9"/>`;
  body += footer(env, kit.themeOf("dark"), { logo: input.brandLogo, cta: total > 1 ? "SWIPE FOR HIS SCOUTING REPORT" : input.address, more: total > 1 });
  return svgDoc(env, defs, body, bg);
}

// ── Slide 2: the scouting report ──
const INK = "#1d2433";
const SOFT = "#8a95a6";
const LINE = "#e5e7eb";

function heading(env, x, y, w, label, color, center = false) {
  return text(center ? x + w / 2 : x, y, label, 34, color, { anchor: center ? "middle" : "start", spacing: 3 })
    + `<rect x="${r1(x)}" y="${r1(y + 12)}" width="${r1(w)}" height="5" fill="${color}"/>`;
}

function traitList(env, x, y, w, items, bar, color, rowH) {
  if (!items.length) return text(x, y + 40, "NONE YET", 28, SOFT, { spacing: 1 });
  return items.map((t, i) => {
    const ty = y + i * rowH;
    const pct = Math.max(6, Math.min(100, Math.pow((t.pct || 0) / 100, 0.3) * 100));
    return fitLine(env, x, ty + 38, up(t.term), 34, w, INK, { spacing: 1, min: 18 }).svg
      + (bar ? `<rect x="${r1(x)}" y="${r1(ty + 50)}" width="${r1(w)}" height="7" rx="3.5" fill="#eeeeee"/><rect x="${r1(x)}" y="${r1(ty + 50)}" width="${r1((w * pct) / 100)}" height="7" rx="3.5" fill="${color}"/>` : "")
      + (i < items.length - 1 ? `<rect x="${r1(x)}" y="${r1(ty + rowH - 4)}" width="${r1(w)}" height="2" fill="#f0f0f0"/>` : "");
  }).join("");
}

function reportSvg(env, input, i, total) {
  const bg = hex(input.color) || NAVY;
  const c2 = hex(input.accent) || hex(input.color2) || GOLD;
  const head = readableOn(bg, "#ffffff");
  const r = input.report || {};
  const W2 = W - PAD * 2;
  const bottom = H - FOOTER_H;
  const defs = `<linearGradient id="hero" x1="0" y1="0" x2="1" y2="0.3"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${bg}" stop-opacity="0.82"/></linearGradient>`
    + '<clipPath id="heroClip"><rect width="1080" height="300"/></clipPath>';

  // The hero band: his headshot, name, position pill, school · class, logo.
  const heroH = 300;
  const shot = hasImage(env, input.headshot);
  let body = `<rect width="${W}" height="${bottom}" fill="#eef2f7"/>`
    + `<g clip-path="url(#heroClip)"><rect width="${W}" height="${heroH}" fill="${NAVY}"/><rect width="${W}" height="${heroH}" fill="url(#hero)"/>`
    + image(env, input.logoDark, W - 420, -40, 460, 380, "xMidYMid meet", 0.16)
    + `</g><rect y="${heroH}" width="${W}" height="6" fill="${c2}"/>`;
  if (shot) {
    // His headshot in a ringed circle, centered in the band.
    const cr = 112;
    const ccx = PAD + cr + 6;
    const ccy = heroH / 2 + 6;
    body += `<clipPath id="face"><circle cx="${ccx}" cy="${ccy}" r="${cr}"/></clipPath>`
      + `<circle cx="${ccx}" cy="${ccy}" r="${cr}" fill="${shade(bg, 0.55)}"/>`
      // Sized so his head and shoulders fill it, standing on the ring's foot.
      + `<g clip-path="url(#face)">${image(env, input.headshot, ccx - cr * 1.6, ccy + cr - cr * 2.35, cr * 3.2, cr * 2.35, "xMidYMax meet")}</g>`
      + `<circle cx="${ccx}" cy="${ccy}" r="${cr}" fill="none" stroke="${c2}" stroke-width="8"/>`;
  }
  const ink = textOn(bg, c2);
  const tx = shot ? PAD + 260 : PAD;
  const tw = W - PAD - tx;
  body += text(tx, 72, "COMMUNITY SCOUTING REPORT", 30, GOLD, { spacing: 3 })
    + fitLine(env, tx, 146, up(input.first), 64, tw, ink, { spacing: 2 }).svg
    + fitLine(env, tx, 222, up(input.last), 96, tw, ink, { spacing: 2, min: 40 }).svg;
  const posW = widthOf(env, up(input.pos), 30, 1) + 30;
  body += `<rect x="${tx}" y="240" width="${r1(posW)}" height="40" rx="20" fill="none" stroke="${ink}" stroke-width="3"/>`
    + text(tx + posW / 2, 270, up(input.pos), 30, ink, { anchor: "middle", spacing: 1 })
    + fitLine(env, tx + posW + 16, 270, up([input.school, input.year && `${input.year} CLASS`].filter(Boolean).join(DOT)), 32, tw - posW - 16, ink, { spacing: 1, opacity: 0.9 }).svg;

  // The card: rows sized to what he has, the whole centered in the room below.
  const strengths = (r.strengths || []).slice(0, 5);
  const weaknesses = (r.weaknesses || []).slice(0, 5);
  const traitRows = Math.max(3, strengths.length, weaknesses.length);
  const fits = (r.fits || []).filter((f) => f.logo && hasImage(env, f.logo)).slice(0, 4);
  const meas = (input.measurements || []).slice(0, 8);
  // The rows fit the room: the trait rows give first (62 down to 46 a
  // trait), then the measurements go to one row of four.
  const room = bottom - heroH - 6 - 48;
  const rowA = 270;
  const rowC = fits.length ? 164 : 0;
  let rowD = meas.length ? (meas.length > 4 ? 226 : 140) : 0;
  const traitFor = () => (room - rowA - rowC - rowD - 20 - 66) / traitRows;
  if (traitFor() < 46 && meas.length > 4) { meas.length = 4; rowD = 140; }
  const traitH = Math.max(46, Math.min(62, traitFor()));
  const rowB = 66 + traitRows * traitH;
  const cardH = rowA + rowB + rowC + rowD + 20;
  const cardTop = heroH + 6 + 24 + Math.max(0, (room - cardH) / 2);
  const cx = PAD - 20;
  const cw = W2 + 40;
  body += `<rect x="${cx}" y="${r1(cardTop)}" width="${cw}" height="${r1(cardH)}" rx="20" fill="#ffffff" stroke="${head}" stroke-width="4"/>`;
  const half = cw / 2;
  const inner = (x) => x + 36;
  let y = cardTop;

  // Row A: Community Grade | Class Rank.
  const g = r.grade || { label: "Watchlist", short: "W", bg: "#5F5E5A", border: "#444441" };
  const gx = inner(cx);
  const gw = half - 72;
  body += heading(env, gx, y + 56, gw, "COMMUNITY GRADE", head, true);
  const bw = 250;
  const bh = 126;
  const bx = gx + (gw - bw) / 2;
  body += `<rect x="${r1(bx)}" y="${r1(y + 84)}" width="${bw}" height="${bh}" rx="12" fill="${g.bg}" stroke="${g.border}" stroke-width="5"/>`
    + text(bx + bw / 2, y + 84 + 84, g.short, 86, "#ffffff", { anchor: "middle", spacing: 1 })
    + fitLine(env, bx + bw / 2, y + 84 + 116, up(g.label), 24, bw - 20, "#ffffff", { anchor: "middle", spacing: 1.5, opacity: 0.85 }).svg;
  if (g.avg != null) {
    const sy = y + 228;
    const at = ((g.avg - 1) / 9) * 0.92;
    body += `<rect x="${r1(gx)}" y="${r1(sy)}" width="${r1(gw)}" height="10" rx="5" fill="#eeeeee"/><rect x="${r1(gx + gw * at)}" y="${r1(sy)}" width="${r1(gw * 0.08)}" height="10" rx="5" fill="${g.bg}"/>`
      + text(gx, sy + 36, "1ST RD", 22, SOFT, { spacing: 1 }) + text(gx + gw, sy + 36, "UDFA", 22, SOFT, { anchor: "end", spacing: 1 });
  }
  const rx = inner(cx + half);
  const rw = half - 72;
  body += `<rect x="${r1(cx + half)}" y="${r1(y + 28)}" width="2" height="${rowA - 50}" fill="${LINE}"/>`
    + heading(env, rx, y + 56, rw, "CLASS RANK", head, true);
  const ranks = [
    // (Bebas Neue is capitals only, so not the page's "2029 TEs".)
    r.posRank && { n: r.posRank, of: r.posOf, label: `${input.year} ${up(input.pos)}` },
    r.classRank && { n: r.classRank, of: r.classOf, label: `${input.year} CLASS` },
  ].filter(Boolean);
  if (!ranks.length) body += text(rx + rw / 2, y + 160, "NOT RANKED", 32, SOFT, { anchor: "middle", spacing: 1 });
  ranks.forEach((k, j) => {
    const ky = y + (ranks.length === 1 ? 180 : 146 + j * 92);
    const big = `#${k.n}`;
    const bigW = widthOf(env, big, 84, 1);
    const ofTxt = k.of ? `OF ${k.of}` : "";
    const lw = Math.max(widthOf(env, ofTxt, 28, 1), widthOf(env, k.label, 28, 1));
    const left = rx + (rw - (bigW + 18 + lw)) / 2;
    body += text(left, ky, big, 84, head, { spacing: 1 })
      + text(left + bigW + 18, ky - 34, ofTxt, 28, SOFT, { spacing: 1 })
      + text(left + bigW + 18, ky, k.label, 28, INK, { spacing: 1 });
  });
  y += rowA;

  // Row B: Top Strengths | Top Weaknesses.
  body += `<rect x="${cx}" y="${r1(y)}" width="${cw}" height="2" fill="${LINE}"/><rect x="${r1(cx + half)}" y="${r1(y + 22)}" width="2" height="${rowB - 40}" fill="${LINE}"/>`
    + heading(env, inner(cx), y + 56, half - 72, "TOP STRENGTHS", head)
    + heading(env, inner(cx + half), y + 56, half - 72, "TOP WEAKNESSES", head)
    + traitList(env, inner(cx), y + 72, half - 72, strengths, r.bars, "#16a34a", traitH)
    + traitList(env, inner(cx + half), y + 72, half - 72, weaknesses, r.bars, "#dc2626", traitH);
  y += rowB;

  // Row C: NFL Fits.
  if (rowC) {
    body += `<rect x="${cx}" y="${r1(y)}" width="${cw}" height="2" fill="${LINE}"/>` + heading(env, inner(cx), y + 56, cw - 72, "NFL FITS", head, true);
    const lg = 100;
    const gap2 = 56;
    const fx = cx + (cw - (fits.length * lg + (fits.length - 1) * gap2)) / 2;
    fits.forEach((f, j) => { body += image(env, f.logo, fx + j * (lg + gap2), y + 78, lg, lg); });
    y += rowC;
  }

  // Row D: Measurements, as pills.
  if (rowD) {
    body += `<rect x="${cx}" y="${r1(y)}" width="${cw}" height="2" fill="${LINE}"/>` + heading(env, inner(cx), y + 56, cw - 72, "MEASUREMENTS", head, true);
    const per = Math.min(4, meas.length);
    const pg = 14;
    const pw = (cw - 72 - pg * (per - 1)) / per;
    meas.forEach((m, j) => {
      const row = Math.floor(j / per);
      const inRow = Math.min(per, meas.length - row * per);
      const px = inner(cx) + (cw - 72 - (inRow * pw + (inRow - 1) * pg)) / 2 + (j % per) * (pw + pg);
      const py = y + 80 + row * 86;
      body += `<rect x="${r1(px)}" y="${r1(py)}" width="${r1(pw)}" height="72" rx="14" fill="#f3f5f8" stroke="${LINE}" stroke-width="2"/>`
        + text(px + 18, py + 47, m.label, 22, SOFT, { spacing: 1.5 })
        + fitLine(env, px + pw - 18, py + 50, m.val, 40, pw - 36 - widthOf(env, m.label, 22, 1.5) - 10, INK, { anchor: "end", spacing: 1, min: 18 }).svg;
    });
  }

  const more = i < total - 1;
  body += footer(env, kit.themeOf("dark"), { logo: input.brandLogo, cta: more ? "SWIPE FOR MORE" : input.address, more });
  return svgDoc(env, defs, body, "#eef2f7");
}

// The post → [{ name, svg }]: the cover, then the scouting report.
export function spotlightSlides(input, env) {
  return [
    { name: "cover", svg: coverSvg(env, input, 2) },
    { name: "scouting-report", svg: reportSvg(env, input, 1, 2) },
  ];
}

export function spotlightCaption(input) {
  const name = `${input.first} ${input.last}`.trim();
  const tag = (s) => String(s || "").replace(/[^A-Za-z0-9]/g, "");
  const g = input.report?.grade;
  const lines = [
    `Player Spotlight: ${name}, ${[input.pos, input.school].filter(Boolean).join(", ")}${input.year ? ` (${input.year} class)` : ""}.`,
    [input.height, input.weight && `${input.weight} lbs`].filter(Boolean).join(", "),
    g?.avg != null ? `Community grade: ${g.label}.` : "",
    input.report?.strengths?.length ? `Top strengths: ${input.report.strengths.slice(0, 3).map((s) => s.term).join(", ")}.` : "",
    "",
    `Grade him yourself: ${input.address.toLowerCase()}`,
    "",
    ["#NFLDraft", "#CollegeFootball", input.year && `#${input.year}NFLDraft`, input.school && `#${tag(input.school)}`, `#${tag(input.first)}${tag(input.last)}`].filter(Boolean).join(" "),
  ];
  return lines.filter((l, i) => l || (i > 0 && lines[i - 1])).join("\n").replace(/\n{3,}/g, "\n\n");
}

// Every image the post draws.
export function spotlightImageUrls(input) {
  return [...new Set([input.brandLogo, input.photo, input.logo, input.logoDark, input.headshot, ...(input.report?.fits || []).map((f) => f.logo)].filter(Boolean))];
}
