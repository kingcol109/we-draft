// src/utils/instagram/spotlight.js
//
// Player Spotlight: a three- or four-slide Instagram post (1080×1350), drawn like
// posts.js — plain data in, SVG out — so a server can draw it too.
//   1. The cover: the player over his action shot (backdrop taken out — see
//      knockout.js) under a spotlight — light beams, his last name huge and
//      outlined behind him — trading-card framed. Two looks (input.look):
//      "wash", his school's color falling off to near black at the foot;
//      "spotlight", a stage light: a hard-edged cone of his school's color
//      from above the frame onto a pool of light at his feet, black
//      everywhere it doesn't reach. His name,
//      then school, position, height and weight. Top right, his class's
//      logo like a baseball card's rookie logo (input.classLogo: the NFL Draft
//      shield for the next draft, ADVANCE SCOUTING for 2028 and 2029; a class
//      with no logo falls back to the drawn ADVANCE SCOUTING badge).
//   2. The scouting report, as his player page shows it (PlayerProfile.js's
//      Community Scouting Report), turned into the back of the card: community
//      grade with its scale, class ranks (input.showRanks, on by default), top
//      strengths and weaknesses, NFL fits (input.showFits, off by default) and
//      measurements.
//   3. The stats (when ESPN has them for him): the newest season as the big
//      part, with national ranks when they're high; under it a running back's
//      career rushing totals, anyone else's season-by-season table (espnStats).
//   4. Your turn: an ad to grade him yourself on We-Draft.com, and the rest
//      of the site (big boards, mock drafts, the Draft Sim).
// spotlightFrame: not a slide — a transparent frame to edit his highlight
// clip under, so the video matches the carousel.
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
    // On the report's dark panels, the dark logos.
    .map((abbr) => ({ name: teamNames[abbr] || abbr, logo: branding[abbr]?.LogoDark || branding[abbr]?.Logo1 || "" }));
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
// advance: his class is past the next draft; showRanks / showFits: the
// report's class rank and NFL fits.
export function spotlightInput({ player, school = {}, photo = null, headshot = "", report = {}, advance = false, brandLogo = "", badgeLogo = "", address = "", look = "wash", accent = "", badge = "crest", showRanks = true, showFits = false, highlights = false, stats = null, showStats = true, classLogo = "", jersey = "" }) {
  return {
    first: player?.First || "", last: player?.Last || "", pos: player?.Position || "", school: player?.School || "", year: String(player?.Eligible || ""),
    height: heightText(player?.Height), weight: player?.Weight ? String(player.Weight) : "",
    measurements: measurementsOf(player || {}),
    color: school.Color1 || NAVY, color2: school.Color2 || GOLD,
    // On his school's color its dark logo; on the white report its own.
    logoDark: school.LogoDark || school.Logo1 || "", logo: school.Logo1 || school.LogoDark || "",
    photo: photo?.url || "", focus: photo?.orientation === "left" ? "right" : photo?.orientation === "right" ? "left" : "center",
    headshot, report, advance: !!advance, brandLogo, badgeLogo,
    // His class's logo for the cover's top right (the NFL Draft shield for the
    // next draft, ADVANCE SCOUTING for later classes) — the caller picks it.
    classLogo,
    // His jersey number (playerPhotos.jersey, from ESPN's roster) — the
    // highlight frame's top right beside his position ("WR #17").
    jersey: String(jersey ?? "").replace(/[^0-9]/g, "").slice(0, 2),
    // The cover's look ("wash" | "spotlight") and the accent (frame, bars,
    // glow, ring) — the school's second color unless the admin picks one.
    look: look === "spotlight" ? "spotlight" : "wash", accent: hex(accent) || "",
    // The ADVANCE SCOUTING badge's design: "crest" | "plate".
    badge: badge === "plate" ? "plate" : "crest",
    showRanks: showRanks !== false, showFits: !!showFits,
    // His college stats (espnStats) — their own slide after the report when
    // he has them and showStats isn't off.
    stats: showStats !== false && (stats?.hero || stats?.table || stats?.career) ? stats : null,
    // Highlight videos follow the cover (the cover's swipe line says so).
    highlights: !!highlights,
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
    + `<radialGradient id="rim" cx="0.5" cy="0.62" r="0.5"><stop offset="0" stop-color="${c2}" stop-opacity="0.22"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></radialGradient>`
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

  // PLAYER SPOTLIGHT, top left; his class's logo top right (the drawn
  // ADVANCE SCOUTING badge when there's no logo for his class).
  const k = "PLAYER SPOTLIGHT";
  const kw = widthOf(env, k, 36, 3) + 48;
  body += `<rect x="${PAD}" y="58" width="${r1(kw)}" height="62" rx="31" fill="${GOLD}"/>` + text(PAD + 24, 58 + 31 + 13, k, 36, NAVY, { spacing: 3 });
  if (hasImage(env, input.classLogo)) body += `<g filter="url(#badgeShadow)">${image(env, input.classLogo, W - PAD - 189, 34, 195, 195)}</g>`;
  else if (input.advance && input.year) body += advanceBadge(W - PAD - 110, input.badge === "plate" ? 150 : 172, input.year, input.badge === "plate" ? 0.92 : 0.95, input.badge);

  // The card's frame, in the school's second color.
  body += `<rect x="22" y="22" width="${W - 44}" height="${bottom - 44}" rx="30" fill="none" stroke="${c2}" stroke-width="6" stroke-opacity="0.9"/>`;
  body += footer(env, kit.themeOf("dark"), { logo: input.brandLogo, cta: total > 1 ? (input.highlights ? "SWIPE FOR HIS HIGHLIGHTS" : "SWIPE FOR HIS SCOUTING REPORT") : input.address, more: total > 1 });
  return svgDoc(env, defs, body, bg);
}

// ── Slide 2: the scouting report ──
// The cover's card turned over: his school's color falling off to black,
// speed stripes and the accent frame, the report on glass panels with the
// accent along their tops. Class rank (input.showRanks) and NFL fits
// (input.showFits) are the admin's to include.
const SOFT = "#9fb0c8";
const GLASS = "rgba(255,255,255,0.065)";
const EDGE = "rgba(255,255,255,0.13)";
const GREEN = "#22c55e";
const RED = "#ef4444";
// The grade scale's colors, 1st round to UDFA (gradeScale.js's looks).
const SCALE_STOPS = ["#3B6D11", "#0F6E56", "#185FA5", "#BA7517", "#993C1D", "#A32D2D"];

function panel(x, y, w, h, c2) {
  return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="22" fill="${GLASS}" stroke="${EDGE}" stroke-width="2"/>`
    + `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="6" rx="3" fill="${c2}"/>`;
}
const kicker = (x, y, label, opts = {}) => text(x, y, label, 28, opts.fill || SOFT, { spacing: 4, anchor: opts.anchor });

// The up / down arrows strengths and weaknesses are marked with (w wide,
// centered on cy).
const arrowUp = (x, cy, w = 22) => `M ${r1(x)} ${r1(cy + w * 0.4)} L ${r1(x + w / 2)} ${r1(cy - w * 0.4)} L ${r1(x + w)} ${r1(cy + w * 0.4)} Z`;
const arrowDown = (x, cy, w = 22) => `M ${r1(x)} ${r1(cy - w * 0.4)} L ${r1(x + w)} ${r1(cy - w * 0.4)} L ${r1(x + w / 2)} ${r1(cy + w * 0.4)} Z`;

// A trait list: a row a trait behind its arrow, a glowing bar under it (5+ evaluations).
function traitList(env, x, y, w, items, bar, color, rowH, arrow) {
  if (!items.length) return text(x, y + 44, "NONE YET", 30, SOFT, { spacing: 1 });
  return items.map((t, i) => {
    const ty = y + i * rowH;
    const pct = Math.max(6, Math.min(100, Math.pow((t.pct || 0) / 100, 0.3) * 100));
    // With bars, the term sits on its bar at the row's foot (the bars part the rows).
    const mid = ty + (bar ? rowH - 33 : rowH / 2 + 2);
    return `<path d="${arrow(x, mid, 18)}" fill="${color}"/>`
      + fitLine(env, x + 30, mid + 13, up(t.term), 36, w - 30, "#ffffff", { spacing: 1, min: 18 }).svg
      + (bar ? `<rect x="${r1(x + 30)}" y="${r1(ty + rowH - 13)}" width="${r1(w - 30)}" height="8" rx="4" fill="#ffffff" fill-opacity="0.1"/>`
        + `<rect x="${r1(x + 30)}" y="${r1(ty + rowH - 13)}" width="${r1(((w - 30) * pct) / 100)}" height="8" rx="4" fill="${color}" filter="url(#barGlow)"/>` : "")
      + (!bar && i < items.length - 1 ? `<rect x="${r1(x)}" y="${r1(ty + rowH - 3)}" width="${r1(w)}" height="2" fill="#ffffff" fill-opacity="0.07"/>` : "");
  }).join("");
}

// The grade: a slanted medallion in its color, glowing, the round big on it.
function gradeMedallion(x, y, w, h, g) {
  const plate = (extra) => `<rect x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="16" transform="skewX(-8)" ${extra}/>`;
  // skewX shears about the origin: move it back under its own box.
  const shift = r1((y + h / 2) * Math.tan((8 * Math.PI) / 180));
  return `<g transform="translate(${shift} 0)">${plate(`fill="${g.bg}" filter="url(#glow)" opacity="0.85"`)}`
    + plate(`fill="${g.bg}" stroke="#ffffff" stroke-width="5"`)
    + plate(`fill="url(#sheen)"`)
    + `</g>` + text(x + w / 2 - 6, y + h / 2 + 36, up(g.short), 104, "#ffffff", { anchor: "middle", spacing: 1 });
}

function reportSvg(env, input, i, total) {
  const bg = hex(input.color) || NAVY;
  const c2 = hex(input.accent) || hex(input.color2) || GOLD;
  // The accent where it's text or numbers on the dark: itself if it reads, else white.
  const hi = readableOn(c2, "#0b0f18", 3);
  const r = input.report || {};
  const bottom = H - FOOTER_H;
  const top = shade(bg, 0.62);
  const ink = textOn(top, c2);
  const defs = `<linearGradient id="rbase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="0.32" stop-color="${shade(bg, 0.3)}"/><stop offset="0.7" stop-color="#07090e"/><stop offset="1" stop-color="#05070b"/></linearGradient>`
    + `<radialGradient id="halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${c2}" stop-opacity="0.55"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></radialGradient>`
    + '<radialGradient id="rvig" cx="0.5" cy="0.4" r="0.8"><stop offset="0.6" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.55"/></radialGradient>'
    + '<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.32"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.04"/><stop offset="1" stop-color="#000000" stop-opacity="0.18"/></linearGradient>'
    + `<linearGradient id="scale" x1="0" y1="0" x2="1" y2="0">${SCALE_STOPS.map((c, j) => `<stop offset="${r1(j / (SCALE_STOPS.length - 1))}" stop-color="${c}"/>`).join("")}</linearGradient>`
    + '<filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="18"/></filter>'
    + '<filter id="barGlow" x="-10%" y="-200%" width="120%" height="500%"><feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#ffffff" flood-opacity="0.25"/></filter>'
    + '<filter id="faceShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000000" flood-opacity="0.5"/></filter>'
    + `<clipPath id="rcard"><rect width="${W}" height="${bottom}"/></clipPath>`;

  // The backdrop: color to black, his school's logo faint top right, speed stripes, vignette.
  const stripes = [0, 1, 2, 3, 4].map((j) => `<rect x="${640 + j * 74}" y="-60" width="${30 - j * 4}" height="520" fill="${c2}" fill-opacity="${r1(0.12 - j * 0.02)}" transform="skewX(-28)"/>`).join("");
  let body = `<g clip-path="url(#rcard)"><rect width="${W}" height="${bottom}" fill="url(#rbase)"/>${stripes}`
    + image(env, input.logoDark, W - 470, -50, 520, 420, "xMidYMid meet", 0.12)
    + `<rect width="${W}" height="${bottom}" fill="url(#rvig)"/></g>`;

  // The header: his headshot ringed in a halo, his name, position · school · class.
  const shot = hasImage(env, input.headshot);
  if (shot) {
    const cr = 124;
    const ccx = PAD + cr + 4;
    const ccy = 186;
    body += `<circle cx="${ccx}" cy="${ccy}" r="${cr + 60}" fill="url(#halo)"/>`
      + `<clipPath id="face"><circle cx="${ccx}" cy="${ccy}" r="${cr}"/></clipPath>`
      + `<g filter="url(#faceShadow)"><circle cx="${ccx}" cy="${ccy}" r="${cr}" fill="${shade(bg, 0.45)}"/></g>`
      // Sized so his head and shoulders fill it, standing on the ring's foot.
      + `<g clip-path="url(#face)">${image(env, input.headshot, ccx - cr * 1.6, ccy + cr - cr * 2.35, cr * 3.2, cr * 2.35, "xMidYMax meet")}</g>`
      + `<circle cx="${ccx}" cy="${ccy}" r="${cr}" fill="none" stroke="${c2}" stroke-width="8"/>`
      + `<circle cx="${ccx}" cy="${ccy}" r="${cr + 9}" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2"/>`;
  }
  const tx = shot ? PAD + 290 : PAD;
  const tw = W - PAD - 10 - tx;
  body += fitLine(env, tx, 132, up(input.first), 80, tw, ink, { spacing: 3, opacity: 0.9 }).svg
    + fitLine(env, tx - 4, 262, up(input.last), 164, tw, ink, { spacing: 2, min: 60 }).svg;
  const posW = widthOf(env, up(input.pos), 40, 1) + 38;
  body += `<rect x="${tx}" y="282" width="${r1(posW)}" height="54" rx="27" fill="${c2}"/>`
    + text(tx + posW / 2, 323, up(input.pos), 40, readableOn("#ffffff", c2), { anchor: "middle", spacing: 1 })
    + fitLine(env, tx + posW + 18, 324, up([input.school, input.year && `${input.year} CLASS`].filter(Boolean).join(DOT)), 44, tw - posW - 18, ink, { spacing: 1, opacity: 0.9 }).svg;

  // The panels, sized to what he has, centered in the room below the header.
  const x0 = 46;
  const cw = W - x0 * 2;
  const gap = 18;
  const halfW = (cw - gap) / 2;
  const strengths = (r.strengths || []).slice(0, 5);
  const weaknesses = (r.weaknesses || []).slice(0, 5);
  const traitRows = Math.max(3, strengths.length, weaknesses.length);
  const fits = input.showFits ? (r.fits || []).filter((f) => f.logo && hasImage(env, f.logo)).slice(0, 4) : [];
  const meas = (input.measurements || []).slice(0, 8);
  const ranks = input.showRanks ? [
    // (Bebas Neue is capitals only, so not the page's "2029 TEs".)
    r.posRank && { n: r.posRank, of: r.posOf, label: `${input.year} ${up(input.pos)}` },
    r.classRank && { n: r.classRank, of: r.classOf, label: `${input.year} CLASS` },
  ].filter(Boolean) : [];
  const roomTop = 360;
  // SCOUTING REPORT, over the grade row.
  const labelH = 54;
  const room = bottom - 36 - roomTop;
  const rowA = 236;
  let rowC = fits.length ? 140 : 0;
  const tileH = 88;
  const measH = (n) => (n ? Math.ceil(n / 4) * tileH + (Math.ceil(n / 4) - 1) * 14 : 0);
  const gaps = () => gap * [rowA, 1, rowC, meas.length].filter(Boolean).length - gap;
  // The trait rows give first (64 down to 44 a trait), then the measurements go to one row of four.
  const traitFor = () => (room - labelH - rowA - rowC - measH(meas.length) - gaps() - 90) / traitRows;
  if (traitFor() < 46 && meas.length > 4) meas.length = 4;
  // Still tight (NFL fits in): the fits row slims.
  if (traitFor() < 44 && rowC) rowC = 124;
  const traitH = Math.max(42, Math.min(64, traitFor()));
  const rowB = 94 + traitRows * traitH;
  const rowD = measH(meas.length);
  let y = roomTop + Math.max(0, (room - (labelH + rowA + rowB + rowC + rowD + gaps())) / 2);

  body += text(x0 + 2, y + 36, "SCOUTING REPORT", 44, GOLD, { spacing: 4 });
  y += labelH;

  // Row A: the community grade (the row to itself without ranks) | class rank.
  const g = r.grade || { label: "Watchlist", short: "W", bg: "#5F5E5A", border: "#444441" };
  const gw = ranks.length ? halfW : cw;
  body += panel(x0, y, gw, rowA, c2) + kicker(x0 + 30, y + 52, "COMMUNITY GRADE");
  const mw = 176;
  const mh = 120;
  body += gradeMedallion(x0 + 30, y + 72, mw, mh, g);
  // The label beside it, its first word over the rest when it's three ("LATE / FIRST ROUND").
  const lx = x0 + 30 + mw + 30;
  const words = up(g.label).split(" ");
  const [over, main] = words.length > 2 ? [words[0], words.slice(1).join(" ")] : ["", up(g.label)];
  const lw = gw - (lx - x0) - 30;
  if (over) body += text(lx, y + 118, over, 36, hi, { spacing: 2 });
  body += fitLine(env, lx, y + (over ? 168 : 150), main, ranks.length ? 52 : 64, lw, "#ffffff", { spacing: 1, min: 26 }).svg;
  if (g.avg != null) {
    // The scale, 1st round to UDFA, a pin where he grades.
    const sx = x0 + 30;
    const sw = gw - 60;
    const sy = y + rowA - 26;
    const at = sx + sw * Math.min(1, Math.max(0, (g.avg - 1) / 9));
    body += `<rect x="${r1(sx)}" y="${r1(sy - 5)}" width="${r1(sw)}" height="10" rx="5" fill="url(#scale)" opacity="0.9"/>`
      + `<circle cx="${r1(at)}" cy="${r1(sy)}" r="13" fill="#ffffff" stroke="${g.bg}" stroke-width="6"/>`;
  }
  if (ranks.length) {
    const rx0 = x0 + halfW + gap;
    body += panel(rx0, y, halfW, rowA, c2) + kicker(rx0 + 30, y + 52, "CLASS RANK");
    const colW = (halfW - 60) / ranks.length;
    ranks.forEach((k2, j) => {
      const kx = rx0 + 30 + j * colW;
      if (j) body += `<rect x="${r1(kx - 1)}" y="${r1(y + 84)}" width="2" height="${rowA - 118}" fill="#ffffff" fill-opacity="0.1"/>`;
      const cx2 = kx + colW / 2;
      const big = `#${k2.n}`;
      const s = fitSize(env, big, ranks.length === 1 ? 128 : 104, colW - 24, 50, 1);
      body += text(cx2, y + 168, big, s, "#ffffff", { anchor: "middle", spacing: 1 })
        + fitLine(env, cx2, y + 200, k2.label, 28, colW - 20, "#ffffff", { anchor: "middle", spacing: 1.5, min: 18 }).svg
        + (k2.of ? text(cx2, y + 224, `OF ${k2.of}`, 22, SOFT, { anchor: "middle", spacing: 2 }) : "");
    });
  }
  y += rowA + gap;

  // Row B: top strengths | top weaknesses.
  // Each column's header bigger than its traits, in its color, so it reads as the label.
  const side = (sx, label, items, color, arrow) => panel(sx, y, halfW, rowB, c2)
    + `<path d="${arrow(sx + 30, y + 42, 28)}" fill="${color}"/>`
    + fitLine(env, sx + 70, y + 58, label, 46, halfW - 100, color, { spacing: 3, min: 28 }).svg
    + traitList(env, sx + 30, y + 78, halfW - 60, items, r.bars, color, traitH, arrow);
  body += side(x0, "TOP STRENGTHS", strengths, GREEN, arrowUp)
    + side(x0 + halfW + gap, "TOP WEAKNESSES", weaknesses, RED, arrowDown);
  y += rowB + gap;

  // Row C: NFL fits, the logos on light discs.
  if (rowC) {
    body += panel(x0, y, cw, rowC, c2) + kicker(x0 + cw / 2, y + rowC / 2 - 26, "NFL FITS", { anchor: "middle" });
    const d = rowC < 140 ? 64 : 76;
    const g2 = 48;
    const fx = x0 + (cw - (fits.length * d + (fits.length - 1) * g2)) / 2;
    fits.forEach((f, j) => {
      const fcx = fx + j * (d + g2) + d / 2;
      body += `<circle cx="${r1(fcx)}" cy="${r1(y + rowC / 2 + 16)}" r="${d / 2 + 4}" fill="#ffffff" fill-opacity="0.08" stroke="${EDGE}" stroke-width="2"/>`
        + image(env, f.logo, fcx - d / 2 + 8, y + rowC / 2 + 16 - d / 2 + 8, d - 16, d - 16);
    });
    y += rowC + gap;
  }

  // Row D: measurements, as the cover's strip — glass tiles under the accent.
  if (rowD) {
    const per = Math.min(4, meas.length);
    const tg = 14;
    const pw = (cw - tg * (per - 1)) / per;
    meas.forEach((m, j) => {
      const row = Math.floor(j / per);
      const inRow = Math.min(per, meas.length - row * per);
      const px = x0 + (cw - (inRow * pw + (inRow - 1) * tg)) / 2 + (j % per) * (pw + tg);
      const py = y + row * (tileH + tg);
      body += panel(px, py, pw, tileH, c2)
        + text(px + 22, py + 36, m.label, 22, SOFT, { spacing: 2 })
        + fitLine(env, px + 22, py + 75, m.val, 42, pw - 44, "#ffffff", { spacing: 1, min: 20 }).svg;
    });
  }

  // The card's frame, as the cover's.
  body += `<rect x="22" y="22" width="${W - 44}" height="${bottom - 44}" rx="30" fill="none" stroke="${c2}" stroke-width="6" stroke-opacity="0.9"/>`;
  const more = i < total - 1;
  body += footer(env, kit.themeOf("dark"), { logo: input.brandLogo, cta: more ? "SWIPE FOR MORE" : input.address, more });
  return svgDoc(env, defs, body, "#05070b");
}

// ── Slide 3: the stats ──
// His college numbers from ESPN's career endpoint (the player page's Stats
// tab, PlayerEspnStats.js), cut down for a slide. The newest season is the
// slide: big numbers in a 2×2, each with his national (FBS) rank when it's
// in the top RANK_SHOWN (cfbdPlayers.seasonRanks — scripts/syncCfbdPlayerStats.js).
// Under it, smaller: a running back's career rushing totals, anyone else's
// season-by-season table for his position with a career row.
// STAT_PLAN: the ESPN category and its table columns; HERO: the newest
// season's big numbers [category, ESPN label]; RANK_KEY: where that number's
// rank lives in seasonRanks ([category, statType]).
const STAT_PLAN = {
  qb: ["passing", ["CMP", "ATT", "CMP%", "YDS", "TD", "INT", "RTG"]],
  rb: ["rushing", ["CAR", "YDS", "AVG", "TD", "LNG"]],
  rec: ["receiving", ["REC", "YDS", "AVG", "TD", "LNG"]],
  k: ["kicking", ["FGM", "FGA", "FG%", "LNG", "XP", "PTS"]],
  p: ["punting", null],
  def: ["defensive", ["TOT", "SOLO", "SACK", "PD", "INT", "FF"]],
};
const HERO = {
  qb: [["passing", "YDS"], ["passing", "TD"], ["passing", "INT"], ["passing", "CMP%"]],
  rb: [["rushing", "YDS"], ["rushing", "TD"], ["rushing", "AVG"], ["rushing", "CAR"]],
  rec: [["receiving", "YDS"], ["receiving", "REC"], ["receiving", "TD"], ["receiving", "AVG"]],
  k: [["kicking", "FGM"], ["kicking", "FG%"], ["kicking", "LNG"], ["kicking", "PTS"]],
  p: [],
  def: [["defensive", "TOT"], ["defensive", "SACK"], ["defensive", "INT"], ["defensive", "PD"]],
};
const RANK_KEY = {
  "passing:YDS": ["passing", "YDS"], "passing:TD": ["passing", "TD"],
  "rushing:YDS": ["rushing", "YDS"], "rushing:TD": ["rushing", "TD"],
  "receiving:REC": ["receiving", "REC"], "receiving:YDS": ["receiving", "YDS"], "receiving:TD": ["receiving", "TD"],
  "defensive:TOT": ["defensive", "TOT"], "defensive:SACK": ["defensive", "SACKS"], "defensive:PD": ["defensive", "PD"], "defensive:INT": ["interceptions", "INT"],
  "kicking:FGM": ["kicking", "FGM"], "kicking:LNG": ["kicking", "LONG"], "kicking:PTS": ["kicking", "PTS"],
};
// A rank shows when it's this high or better.
export const RANK_SHOWN = 25;
// What a big number is called on the slide ("category:label", then label).
const HERO_LABEL = {
  "rushing:AVG": "YARDS / CARRY", "receiving:AVG": "YARDS / CATCH", "passing:YDS": "PASSING YARDS", "rushing:YDS": "RUSHING YARDS", "receiving:YDS": "RECEIVING YARDS",
  TD: "TOUCHDOWNS", INT: "INTERCEPTIONS", "CMP%": "COMPLETION %", CAR: "CARRIES", REC: "RECEPTIONS", FGM: "FIELD GOALS", "FG%": "FG %", LNG: "LONG", PTS: "POINTS", TOT: "TACKLES", SACK: "SACKS", PD: "PASSES DEFENDED",
};
const CAREER_LABEL = { CAR: "CARRIES", YDS: "YARDS", AVG: "YDS / CARRY", TD: "TOUCHDOWNS", LNG: "LONG" };
const TITLES = { passing: "PASSING", rushing: "RUSHING", receiving: "RECEIVING", kicking: "KICKING", punting: "PUNTING", defensive: "DEFENSE" };
const MAX_SEASONS = 4;

export function statGroupOf(pos) {
  const p = String(pos || "").toUpperCase();
  if (p === "QB") return "qb";
  if (p === "RB" || p === "FB") return "rb";
  if (p === "WR" || p === "TE") return "rec";
  if (p === "K" || p === "PK") return "k";
  if (p === "P") return "p";
  if (["OL", "OT", "OG", "C", "IOL", "LS"].includes(p)) return "";
  return "def";
}

// "6" / "T-12" → 6 / 12.
const rankNum = (r) => Number(String(r || "").replace(/^T-/, "")) || 0;

// ESPN's career stats json + his position (+ his cfbdPlayers.seasonRanks) →
// { hero: { year, team, tiles: [{ label, value, rank }] },
//   table: { title, cols, rows: [{ year, team, vals }], career } (not for RBs),
//   career: { title, seasons, tiles: [{ label, value }] } (RBs) },
// or null when there's nothing to show (no stats, an O-lineman).
export function espnStats(json, pos, seasonRanks = null) {
  const group = statGroupOf(pos);
  if (!group || !json?.categories?.length) return null;
  const teams = json.teams || {};
  const teamOf = (s) => {
    const t = teams[s.teamSlug] || Object.values(teams).find((x) => String(x.id) === String(s.teamId));
    return t?.abbreviation || "";
  };
  const cats = Object.fromEntries(json.categories.filter((c) => c.statistics?.length).map((c) => [c.name, c]));
  const pick = (c, label) => (c.labels || []).findIndex((l) => String(l).trim() === label);
  const [name, want] = STAT_PLAN[group];
  const c = cats[name];
  if (!c) return null;
  const labels = (c.labels || []).map((l) => String(l).trim());
  const idx = want ? want.map((l) => pick(c, l)).filter((i) => i >= 0) : labels.map((_, i) => i).slice(0, 6);
  if (!idx.length) return null;
  const all = [...c.statistics].filter((s) => s.season?.year).sort((a, b) => a.season.year - b.season.year);

  // The newest season, with its ranks.
  const newest = Math.max(...all.map((s) => Number(s.season.year)));
  const ranks = seasonRanks?.[String(newest)] || {};
  let team = "";
  const tiles = HERO[group].map(([cat, label]) => {
    const cc = cats[cat];
    const s = cc?.statistics.find((x) => Number(x.season?.year) === newest);
    const i = cc ? pick(cc, label) : -1;
    if (!s || i < 0 || s.stats?.[i] == null || s.stats[i] === "") return null;
    team = team || teamOf(s);
    const rk = RANK_KEY[`${cat}:${label}`];
    const r = rk ? ranks[rk[0]]?.[rk[1]] : "";
    return { label: HERO_LABEL[`${cat}:${label}`] || HERO_LABEL[label] || label, value: String(s.stats[i]), rank: r && rankNum(r) <= RANK_SHOWN ? String(r) : "" };
  }).filter(Boolean);
  const out = { hero: tiles.length ? { year: String(newest), team, tiles } : null };

  if (group === "rb") {
    // Running backs: just the career rushing totals.
    if (c.totals) {
      out.career = {
        title: "CAREER RUSHING", seasons: all.length,
        tiles: ["CAR", "YDS", "AVG", "TD"].map((l) => [l, pick(c, l)]).filter(([, i]) => i >= 0).map(([l, i]) => ({ label: CAREER_LABEL[l] || l, value: String(c.totals[i] ?? "") })),
      };
    }
  } else {
    out.table = {
      title: TITLES[name] || up(c.displayName || name), cols: idx.map((i) => labels[i]),
      rows: all.slice(-MAX_SEASONS).map((s) => ({ year: String(s.season.year), team: teamOf(s), vals: idx.map((i) => String(s.stats?.[i] ?? "")) })),
      career: all.length > 1 && c.totals ? idx.map((i) => String(c.totals[i] ?? "")) : null,
    };
  }
  return out.hero || out.table || out.career ? out : null;
}

// The admin's stats (Instagram → Spotlight's Stats editor), over or instead
// of ESPN's. espn: espnStats' result or null. edit: null (ESPN's as they
// are) or { year, team, tiles: [{ label, value, rank }], lead (the tile
// drawn huge), table (keep ESPN's season table / career row) }. → the
// stats the slide draws, or null.
export const MAX_STAT_TILES = 5; // the lead and four cards
export function statsSeed(espn) {
  const h = espn?.hero;
  return { year: h?.year || "", team: h?.team || "", tiles: (h?.tiles || []).map((t) => ({ label: t.label, value: t.value, rank: t.rank || "" })), lead: 0, table: true };
}
export function editedStats(espn, edit) {
  if (!edit) return espn || null;
  const clean = (v) => String(v ?? "").trim();
  const tiles = (edit.tiles || []).map((t, k) => ({ k, label: clean(t.label).toUpperCase(), value: clean(t.value), rank: clean(t.rank).replace(/^#/, "") }))
    .filter((t) => t.value || t.label);
  const lead = tiles.findIndex((t) => t.k === edit.lead);
  if (lead > 0) tiles.unshift(...tiles.splice(lead, 1));
  const hero = tiles.length ? { year: clean(edit.year), team: clean(edit.team).toUpperCase(), tiles: tiles.slice(0, MAX_STAT_TILES).map(({ label, value, rank }) => ({ label, value, rank })) } : null;
  const keep = edit.table !== false && espn ? { table: espn.table || undefined, career: espn.career || undefined } : {};
  const out = { hero, ...keep };
  return out.hero || out.table || out.career ? out : null;
}

// A national rank as its own badge: a gold-framed navy card, NATIONAL RANK
// across its gold header, the rank big in the middle, IN FBS under it.
function rankBadge(env, x, y, w, h, rank) {
  const head = Math.round(Math.min(64, h * 0.22));
  const body = h - head;
  const big = `#${rank}`;
  return `<rect x="${r1(x)}" y="${r1(y + 8)}" width="${r1(w)}" height="${r1(h)}" rx="22" fill="#000000" fill-opacity="0.4"/>`
    + `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="22" fill="${GOLD}"/>`
    + `<rect x="${r1(x + 7)}" y="${r1(y + head)}" width="${r1(w - 14)}" height="${r1(body - 7)}" rx="16" fill="${NAVY}"/>`
    + fitLine(env, x + w / 2, y + head / 2 + head * 0.22, "NATIONAL RANK", Math.round(head * 0.56), w - 30, NAVY, { anchor: "middle", spacing: 3, min: 16 }).svg
    + fitLine(env, x + w / 2, y + head + body * 0.62, big, Math.round(body * 0.6), w - 44, "#ffffff", { anchor: "middle", spacing: 1, min: 40 }).svg
    + text(x + w / 2, y + head + body * 0.86, "IN FBS", Math.round(Math.min(34, body * 0.13)), GOLD, { anchor: "middle", spacing: 4 });
}

function statsSvg(env, input, i, total) {
  const st = input.stats;
  const bg = hex(input.color) || NAVY;
  const c2 = hex(input.accent) || hex(input.color2) || GOLD;
  const bottom = H - FOOTER_H;
  const top = shade(bg, 0.62);
  const ink = textOn(top, c2);
  const defs = `<linearGradient id="sbase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="0.3" stop-color="${shade(bg, 0.3)}"/><stop offset="0.7" stop-color="#07090e"/><stop offset="1" stop-color="#05070b"/></linearGradient>`
    + '<radialGradient id="svig" cx="0.5" cy="0.4" r="0.8"><stop offset="0.6" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.55"/></radialGradient>'
    + `<radialGradient id="shalo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${c2}" stop-opacity="0.22"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></radialGradient>`
    + `<clipPath id="scard"><rect width="${W}" height="${bottom}"/></clipPath>`;
  const stripes = [0, 1, 2, 3, 4].map((j) => `<rect x="${640 + j * 74}" y="-60" width="${30 - j * 4}" height="520" fill="${c2}" fill-opacity="${r1(0.12 - j * 0.02)}" transform="skewX(-28)"/>`).join("");
  let body = `<g clip-path="url(#scard)"><rect width="${W}" height="${bottom}" fill="url(#sbase)"/>${stripes}`
    + image(env, input.logoDark, W - 470, -50, 520, 420, "xMidYMid meet", 0.12)
    + `<rect width="${W}" height="${bottom}" fill="url(#svig)"/></g>`;

  // The header: BY THE NUMBERS, his name, position · school; his headshot
  // top right in a ring.
  const W2 = W - PAD * 2;
  const shot = hasImage(env, input.headshot);
  const fr = shot ? 124 : 0;
  const nameW = W2 - (shot ? fr * 2 + 30 : 0);
  if (shot) {
    const fx = W - PAD - fr + 6;
    const fy = 186;
    body += `<circle cx="${fx}" cy="${fy + 8}" r="${fr}" fill="#000000" fill-opacity="0.35"/>`
      + `<circle cx="${fx}" cy="${fy}" r="${fr}" fill="${shade(bg, 0.45)}"/>`
      + `<clipPath id="sface"><circle cx="${fx}" cy="${fy}" r="${fr}"/></clipPath>`
      + `<g clip-path="url(#sface)">${image(env, input.headshot, fx - fr * 1.6, fy + fr - fr * 2.35, fr * 3.2, fr * 2.35, "xMidYMax meet")}</g>`
      + `<circle cx="${fx}" cy="${fy}" r="${fr}" fill="none" stroke="${c2}" stroke-width="8"/>`
      + `<circle cx="${fx}" cy="${fy}" r="${fr + 10}" fill="none" stroke="#ffffff" stroke-opacity="0.3" stroke-width="2"/>`;
  }
  const k = "BY THE NUMBERS";
  const kw = widthOf(env, k, 32, 3) + 44;
  body += `<rect x="${PAD}" y="58" width="${r1(kw)}" height="54" rx="27" fill="${GOLD}"/>` + text(PAD + 22, 58 + 27 + 12, k, 32, NAVY, { spacing: 3 });
  body += fitLine(env, PAD - 3, 232, up(`${input.first} ${input.last}`), 120, nameW, ink, { spacing: 2, min: 54 }).svg;
  const posW = widthOf(env, up(input.pos), 36, 1) + 34;
  body += `<rect x="${PAD}" y="254" width="${r1(posW)}" height="50" rx="25" fill="${c2}"/>`
    + text(PAD + posW / 2, 292, up(input.pos), 36, readableOn("#ffffff", c2), { anchor: "middle", spacing: 1 })
    + fitLine(env, PAD + posW + 16, 293, up(input.school), 40, nameW - posW - 16, ink, { spacing: 1, opacity: 0.9 }).svg;

  const x0 = 46;
  const cw = W - x0 * 2;
  const gap = 18;
  const roomTop = 330;
  const roomBottom = bottom - 40;
  // The small part first (it keeps its size); the season takes the rest.
  const t = st.table;
  const tRows = t ? t.rows.length + (t.career ? 1 : 0) : 0;
  const rh = 42;
  const tableH = t ? 102 + tRows * rh : 0;
  const careerH = st.career ? 186 : 0;
  const lowH = tableH || careerH;
  const heroH = st.hero ? Math.min(640, roomBottom - roomTop - (lowH ? lowH + gap : 0)) : 0;
  let y = roomTop + Math.max(0, (roomBottom - roomTop - heroH - (lowH ? lowH + (heroH ? gap : 0) : 0)) / 2);

  // The newest season: the slide's main event. A slanted SEASON tag, then his
  // lead number huge on the page (its rank on a gold medallion beside it), then
  // the other numbers on cards in a row.
  if (st.hero) {
    const h = heroH;
    const [lead, ...rest] = st.hero.tiles;
    const tag = st.hero.year ? `${st.hero.year} SEASON` : "SEASON";
    const tagW = widthOf(env, tag, 38, 3) + 56;
    const tagH = 58;
    // skewX shears about the origin: shift it back under its own box.
    const shift = r1((y + tagH / 2) * Math.tan((12 * Math.PI) / 180));
    body += `<g transform="translate(${shift} 0)"><rect x="${x0}" y="${r1(y)}" width="${r1(tagW)}" height="${tagH}" fill="${c2}" transform="skewX(-12)"/></g>`
      + text(x0 + 28, y + tagH / 2 + 14, tag, 38, readableOn("#ffffff", c2), { spacing: 3 })
      + (st.hero.team ? text(x0 + tagW + 22, y + tagH / 2 + 13, st.hero.team, 34, SOFT, { spacing: 3 }) : "");

    const restH = rest.length ? Math.round(Math.min(220, h * 0.36)) : 0;
    const leadTop = y + tagH + 14;
    const leadH = h - tagH - 14 - (restH ? restH + gap : 0);
    // The lead: an accent rule down its left, the number and its label; its
    // national rank, when it's high, on its own badge to the right — the
    // row's full height, so the two sit even.
    const badgeH = lead.rank ? Math.min(320, leadH - 12) : 0;
    const badgeW = badgeH ? Math.round(Math.min(300, badgeH * 0.95)) : 0;
    const numW = cw - 60 - (badgeW ? badgeW + 36 : 0);
    // The gap under the number clears a comma's tail.
    const numSize = Math.max(90, Math.min(260, (leadH - 44 - 24) / 0.92));
    const gapL = Math.max(16, numSize * 0.14);
    const base = leadTop + (leadH - (numSize * 0.78 + gapL + 44)) / 2 + numSize * 0.78;
    body += `<ellipse cx="${r1(x0 + 260)}" cy="${r1(leadTop + leadH / 2)}" rx="380" ry="${r1(leadH * 0.6)}" fill="url(#shalo)"/>`
      + `<rect x="${x0 + 2}" y="${r1(leadTop + 18)}" width="10" height="${r1(leadH - 36)}" rx="5" fill="${c2}"/>`
      + fitLine(env, x0 + 40, base, lead.value, numSize, numW, "#ffffff", { spacing: 2, min: 70 }).svg
      + fitLine(env, x0 + 44, base + gapL + 38, lead.label, 44, numW, "#ffffff", { spacing: 3, opacity: 0.92, min: 22 }).svg;
    if (badgeW) body += rankBadge(env, x0 + cw - badgeW, leadTop + (leadH - badgeH) / 2, badgeW, badgeH, lead.rank);

    // The rest: a card each.
    if (restH) {
      const ry = leadTop + leadH + gap;
      const n = rest.length;
      const tw = (cw - gap * (n - 1)) / n;
      const anyRank = rest.some((tl) => tl.rank);
      rest.forEach((tl, j) => {
        const tx = x0 + j * (tw + gap);
        const cx = tx + tw / 2;
        const below = 12 + 28 + (anyRank ? 14 + 40 : 0);
        const vs = Math.max(56, Math.min(110, (restH - below - 40) / 0.78));
        const vb = ry + (restH - (vs * 0.78 + below)) / 2 + vs * 0.78;
        body += panel(tx, ry, tw, restH, c2)
          + fitLine(env, cx, vb, tl.value, vs, tw - 30, "#ffffff", { anchor: "middle", spacing: 1, min: 40 }).svg
          + fitLine(env, cx, vb + 12 + 26, tl.label, 28, tw - 24, SOFT, { anchor: "middle", spacing: 2, min: 14 }).svg;
        if (tl.rank) {
          const rt = `#${tl.rank} IN FBS`;
          const rw = Math.min(tw - 24, widthOf(env, rt, 26, 2) + 30);
          const py = vb + 12 + 28 + 14;
          body += `<rect x="${r1(cx - rw / 2)}" y="${r1(py)}" width="${r1(rw)}" height="40" rx="20" fill="${GOLD}"/>`
            + fitLine(env, cx, py + 29, rt, 26, rw - 20, NAVY, { anchor: "middle", spacing: 2, min: 14 }).svg;
        }
      });
    }
    y += h + gap;
  }

  // Under it, smaller. A running back: his career rushing totals in a row.
  if (st.career) {
    const h = careerH;
    const ct = st.career;
    body += panel(x0, y, cw, h, c2) + kicker(x0 + 30, y + 50, `${ct.title}${ct.seasons > 1 ? `${DOT}${ct.seasons} SEASONS` : ""}`);
    const colW = (cw - 60) / ct.tiles.length;
    ct.tiles.forEach((tl, j) => {
      const cx = x0 + 30 + j * colW + colW / 2;
      if (j) body += `<rect x="${r1(x0 + 30 + j * colW - 1)}" y="${y + 74}" width="2" height="${h - 98}" fill="#ffffff" fill-opacity="0.1"/>`;
      body += fitLine(env, cx, y + 136, tl.value, 72, colW - 24, "#ffffff", { anchor: "middle", spacing: 1, min: 30 }).svg
        + fitLine(env, cx, y + 166, tl.label, 24, colW - 16, SOFT, { anchor: "middle", spacing: 2, min: 14 }).svg;
    });
  }
  // Anyone else: the season-by-season table, a career row at its foot.
  if (t) {
    const h = tableH;
    const hy = y + 82;
    body += panel(x0, y, cw, h, c2) + text(x0 + 30, y + 46, t.title, 32, "#ffffff", { spacing: 3 });
    const yearX = x0 + 30;
    const teamX = x0 + 140;
    const statL = x0 + 270;
    const colW = (x0 + cw - 30 - statL) / t.cols.length;
    const colR = (j) => statL + (j + 1) * colW;
    const fs = 28;
    body += text(yearX, hy, "YEAR", 22, SOFT, { spacing: 2 }) + text(teamX, hy, "TEAM", 22, SOFT, { spacing: 2 })
      + t.cols.map((c, j) => text(colR(j), hy, up(c), 22, SOFT, { anchor: "end", spacing: 1.5 })).join("")
      + `<rect x="${x0 + 30}" y="${hy + 10}" width="${cw - 60}" height="2" fill="#ffffff" fill-opacity="0.15"/>`;
    const rowTop = hy + 14;
    const line = (ry, a, b, vals) => text(yearX, ry, a, fs, "#ffffff", { spacing: 1 })
      + fitLine(env, teamX, ry, b, fs, statL - teamX - 16, "#ffffff", { spacing: 1, opacity: 0.85, min: 16 }).svg
      + vals.map((v, j) => fitLine(env, colR(j), ry, v, fs, colW - 10, "#ffffff", { anchor: "end", spacing: 1, min: 16 }).svg).join("");
    t.rows.forEach((r, j) => { body += line(rowTop + j * rh + rh / 2 + fs * 0.36, r.year, r.team, r.vals); });
    if (t.career) {
      const cy = rowTop + t.rows.length * rh;
      body += `<rect x="${x0 + 18}" y="${r1(cy + 3)}" width="${cw - 36}" height="${r1(rh - 6)}" rx="10" fill="${c2}" fill-opacity="0.22"/>`
        + `<rect x="${x0 + 18}" y="${r1(cy + 3)}" width="6" height="${r1(rh - 6)}" rx="3" fill="${c2}"/>`
        + line(cy + rh / 2 + fs * 0.36, "CAREER", "", t.career);
    }
  }

  body += `<rect x="22" y="22" width="${W - 44}" height="${bottom - 44}" rx="30" fill="none" stroke="${c2}" stroke-width="6" stroke-opacity="0.9"/>`;
  const more = i < total - 1;
  body += footer(env, kit.themeOf("dark"), { logo: input.brandLogo, cta: more ? "SWIPE FOR MORE" : input.address, more });
  return svgDoc(env, defs, body, "#05070b");
}

// ── The last slide: your turn ──
// The ad: grade him yourself — a grade picker in the rounds' colors, what
// else an evaluation takes — then the rest of the site, and his page's
// address on a gold button.
const PICKER = ["Early First Round", "Second Round", "Third Round", "Fourth Round", "Fifth Round", "Sixth Round", "Seventh Round", "UDFA"];
const MORE = [["BIG BOARDS", "RANK THE CLASS"], ["MOCK DRAFTS", "BUILD YOUR OWN"], ["DRAFT SIM", "MAKE THE PICKS"]];

function evaluateSvg(env, input, i, total) {
  const bg = hex(input.color) || NAVY;
  const c2 = hex(input.accent) || hex(input.color2) || GOLD;
  const bottom = H - FOOTER_H;
  const W2 = W - PAD * 2;
  const top = shade(bg, 0.62);
  const ink = textOn(top, c2);
  const defs = `<linearGradient id="ebase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="0.4" stop-color="${shade(bg, 0.3)}"/><stop offset="0.75" stop-color="#07090e"/><stop offset="1" stop-color="#05070b"/></linearGradient>`
    + '<radialGradient id="evig" cx="0.5" cy="0.4" r="0.8"><stop offset="0.6" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.55"/></radialGradient>'
    + '<filter id="chipShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#000000" flood-opacity="0.45"/></filter>'
    + `<clipPath id="ecard"><rect width="${W}" height="${bottom}"/></clipPath>`;
  const stripes = [0, 1, 2, 3, 4].map((j) => `<rect x="${640 + j * 74}" y="-60" width="${30 - j * 4}" height="560" fill="${c2}" fill-opacity="${r1(0.12 - j * 0.02)}" transform="skewX(-28)"/>`).join("");
  let body = `<g clip-path="url(#ecard)"><rect width="${W}" height="${bottom}" fill="url(#ebase)"/>${stripes}`
    + image(env, input.logoDark, W - 470, -50, 520, 420, "xMidYMid meet", 0.12)
    + `<rect width="${W}" height="${bottom}" fill="url(#evig)"/></g>`;

  // YOUR TURN, then THINK YOU KNOW / HIS NAME? / GRADE HIM YOURSELF.
  const k = "YOUR TURN";
  const kw = widthOf(env, k, 32, 3) + 44;
  body += `<rect x="${PAD}" y="64" width="${r1(kw)}" height="54" rx="27" fill="${GOLD}"/>` + text(PAD + 22, 64 + 27 + 12, k, 32, NAVY, { spacing: 3 })
    + fitLine(env, PAD, 226, "THINK YOU KNOW", 100, W2, ink, { spacing: 2 }).svg
    + fitLine(env, PAD - 4, 376, `${up(`${input.first} ${input.last}`.trim())}?`, 150, W2, ink, { spacing: 2, min: 60 }).svg
    + fitLine(env, PAD, 470, "GRADE HIM YOURSELF.", 84, W2, GOLD, { spacing: 2 }).svg;

  // The picker: a panel with YOUR GRADE and the rounds as chips, then what else goes in.
  const px = 46;
  const pw = W - px * 2;
  const py = 524;
  const ph = 262;
  body += panel(px, py, pw, ph, c2) + kicker(px + 30, py + 52, "YOUR GRADE");
  const cg = 10;
  const chipW = (pw - 60 - cg * (PICKER.length - 1)) / PICKER.length;
  PICKER.forEach((label, j) => {
    const g = gradeLook(label);
    const cx = px + 30 + j * (chipW + cg);
    const name = label === "UDFA" ? "UDFA" : up(g.short);
    body += `<rect x="${r1(cx)}" y="${py + 76}" width="${r1(chipW)}" height="84" rx="14" fill="${g.bg}" stroke="#ffffff" stroke-opacity="0.85" stroke-width="3" filter="url(#chipShadow)"/>`
      + fitLine(env, cx + chipW / 2, py + 76 + 58, name, 44, chipW - 12, "#ffffff", { anchor: "middle", spacing: 1, min: 20 }).svg;
  });
  const also = ["STRENGTHS", "WEAKNESSES", "NFL FIT"];
  const ag = 14;
  const aw = (pw - 60 - ag * (also.length - 1)) / also.length;
  also.forEach((t, j) => {
    const ax = px + 30 + j * (aw + ag);
    body += `<rect x="${r1(ax)}" y="${py + 182}" width="${r1(aw)}" height="54" rx="27" fill="none" stroke="#ffffff" stroke-opacity="0.45" stroke-width="2.5" stroke-dasharray="8 7"/>`
      + text(ax + aw / 2, py + 182 + 39, `+ ${t}`, 30, "#ffffff", { anchor: "middle", spacing: 2, opacity: 0.9 });
  });

  // And more: three glass tiles.
  const my = 846;
  body += text(W / 2, my, "AND MORE ON WE-DRAFT.COM", 34, SOFT, { anchor: "middle", spacing: 4 });
  const tg = 18;
  const tw = (pw - tg * 2) / 3;
  MORE.forEach(([t, sub], j) => {
    const tx = px + j * (tw + tg);
    body += panel(tx, my + 30, tw, 128, c2)
      + fitLine(env, tx + tw / 2, my + 30 + 70, t, 46, tw - 30, "#ffffff", { anchor: "middle", spacing: 2 }).svg
      + text(tx + tw / 2, my + 30 + 106, sub, 24, SOFT, { anchor: "middle", spacing: 2 });
  });

  // His page, on the gold button.
  const by = 1056;
  const bh = 96;
  const cta = up(input.address);
  const bs = fitSize(env, cta, 48, W2 - 80, 24, 2);
  const bw = Math.min(W2, widthOf(env, cta, bs, 2) + 90);
  body += `<rect x="${r1((W - bw) / 2)}" y="${by}" width="${r1(bw)}" height="${bh}" rx="${bh / 2}" fill="${GOLD}" filter="url(#chipShadow)"/>`
    + text(W / 2, by + bh / 2 + bs * 0.36, cta, bs, NAVY, { anchor: "middle", spacing: 2 });

  body += `<rect x="22" y="22" width="${W - 44}" height="${bottom - 44}" rx="30" fill="none" stroke="${c2}" stroke-width="6" stroke-opacity="0.9"/>`;
  const more = i < total - 1;
  body += footer(env, kit.themeOf("dark"), { logo: input.brandLogo, cta: more ? "SWIPE FOR MORE" : "LINK IN BIO", more });
  return svgDoc(env, defs, body, "#05070b");
}

// ── The highlight video's frame ──
// Not a slide: a 1080×1350 overlay to cut his highlight clip under in a
// video editor, so the clip looks like the rest of the carousel. Everything
// but the window is drawn — his school's color falling off to black, speed
// stripes, FILM and his school, his position and number top right
// ("WR #17"), his name bar,
// the footer ("GRADE HIM ON WE-DRAFT.COM") — and
// the window is left clear (a PNG keeps it transparent), outlined in the
// accent with viewfinder corners.
// The round WD badge (input.badgeLogo), right-aligned at `right`, centered
// on `cy`, with a soft shadow → { svg, w }.
export function badgeMark(env, url, right, cy, size = 112) {
  if (!hasImage(env, url)) return { svg: "", w: 0 };
  return {
    svg: `<circle cx="${r1(right - size / 2)}" cy="${r1(cy + 4)}" r="${r1(size / 2)}" fill="#000000" fill-opacity="0.35"/>`
      + image(env, url, right - size, cy - size / 2, size, size),
    w: size,
  };
}

// His position and number, top right ("WR #17", or just "WR" with no number
// on file): a big pill centered on the FILM pill's line, in the accent →
// { svg, w }.
function idTag(env, pos, number, right, color) {
  const label = [up(pos), number ? `#${number}` : ""].filter(Boolean).join(" ");
  if (!label) return { svg: "", w: 0 };
  const h = 100;
  const fs = 68;
  const y = 87 - h / 2;
  const w = r1(widthOf(env, label, fs, 3) + 64);
  return {
    svg: `<rect x="${r1(right - w)}" y="${y + 5}" width="${w}" height="${h}" rx="${h / 2}" fill="#000000" fill-opacity="0.35"/>`
      + `<rect x="${r1(right - w)}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${color}"/>`
      + `<rect x="${r1(right - w + 5)}" y="${y + 5}" width="${r1(w - 10)}" height="${h - 10}" rx="${h / 2 - 5}" fill="none" stroke="#ffffff" stroke-opacity="0.6" stroke-width="2.5"/>`
      + text(r1(right - w / 2), r1(87 + fs * 0.35), label, fs, readableOn("#ffffff", color), { anchor: "middle", spacing: 3 }),
    w,
  };
}

export const FRAME_WINDOW = { x: 36, y: 170, w: 1008, h: 860, r: 28 };

export function spotlightFrame(input, env) {
  const bg = hex(input.color) || NAVY;
  const c2 = hex(input.accent) || hex(input.color2) || GOLD;
  const top = shade(bg, 0.62);
  const ink = textOn(top, c2);
  const { x: wx, y: wy, w: ww, h: wh, r: wr } = FRAME_WINDOW;
  const bottom = H - FOOTER_H;
  const style = env.fontCss ? `<style>${env.fontCss}</style>` : "";
  const defs = style
    + `<linearGradient id="fbase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="0.5" stop-color="${shade(bg, 0.32)}"/><stop offset="0.8" stop-color="#07090e"/><stop offset="1" stop-color="#05070b"/></linearGradient>`
    + `<mask id="window"><rect width="${W}" height="${H}" fill="#ffffff"/><rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" rx="${wr}" fill="#000000"/></mask>`
    + '<filter id="fshadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="0" stdDeviation="10" flood-color="#000000" flood-opacity="0.6"/></filter>';

  // Everything outside the window.
  const stripes = [0, 1, 2, 3, 4].map((j) => `<rect x="${640 + j * 74}" y="-60" width="${30 - j * 4}" height="1500" fill="${c2}" fill-opacity="${r1(0.12 - j * 0.02)}" transform="skewX(-28)"/>`).join("");
  let body = `<g mask="url(#window)"><rect width="${W}" height="${H}" fill="url(#fbase)"/>${stripes}`
    + image(env, input.logoDark, W - 470, 900, 520, 420, "xMidYMid meet", 0.1) + "</g>";

  // The top: FILM, his school, the WD badge.
  const k = "FILM";
  // The play mark, the word, room after it.
  const kw = 60 + widthOf(env, k, 40, 4) + 26;
  body += `<rect x="${PAD}" y="54" width="${r1(kw)}" height="66" rx="33" fill="${GOLD}"/>`
    + `<path d="M ${PAD + 26} 73 L ${PAD + 26} 101 L ${PAD + 48} 87 Z" fill="${NAVY}"/>`
    + text(PAD + 60, 54 + 33 + 14, k, 40, NAVY, { spacing: 4 });
  const brand = idTag(env, input.pos, input.jersey, W - PAD, c2);
  body += fitLine(env, PAD + kw + 22, 102, up(input.school), 40, W - PAD - brand.w - (brand.w ? 26 : 0) - (PAD + kw + 22), ink, { spacing: 2, opacity: 0.9 }).svg
    + brand.svg;

  // The window: the accent, a fine white line inside it, viewfinder corners.
  const cl = 74;
  const ci = 26;
  const corner = (x, y, dx, dy) => `<path d="M ${x} ${y + dy * cl} L ${x} ${y} L ${x + dx * cl} ${y}" fill="none" stroke="${GOLD}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`;
  body += `<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" rx="${wr}" fill="none" stroke="${c2}" stroke-width="8"/>`
    + `<rect x="${wx + 10}" y="${wy + 10}" width="${ww - 20}" height="${wh - 20}" rx="${wr - 8}" fill="none" stroke="#ffffff" stroke-opacity="0.45" stroke-width="2"/>`
    + `<g filter="url(#fshadow)">${corner(wx + ci, wy + ci, 1, 1)}${corner(wx + ww - ci, wy + ci, -1, 1)}${corner(wx + ci, wy + wh - ci, 1, -1)}${corner(wx + ww - ci, wy + wh - ci, -1, -1)}</g>`;

  // The name bar: his name on the left, class and size on the right (his
  // position is up top with his number).
  const right = [input.year && `${input.year} CLASS`, input.height && input.weight ? `${input.height}${DOT}${input.weight} LBS` : input.height].filter(Boolean);
  // Big now that the position's moved up top: 50px, two lines.
  const RS = 50;
  const rw = Math.max(0, ...right.map((t) => widthOf(env, t, RS, 2)));
  const nw = W - PAD * 2 - rw - 30;
  body += fitLine(env, PAD, 1094, up(input.first), 56, nw, "#ffffff", { spacing: 3, opacity: 0.9 }).svg
    + fitLine(env, PAD - 3, 1212, up(input.last), 128, nw, "#ffffff", { spacing: 2, min: 50 }).svg;
  // Bottom-aligned with his last name.
  right.forEach((t, j) => { body += text(W - PAD, 1208 - (right.length - 1 - j) * 62, t, RS, "#ffffff", { anchor: "end", spacing: 2, opacity: 0.9 }); });
  body += `<rect x="${PAD}" y="${bottom - 22}" width="${W - PAD * 2}" height="4" rx="2" fill="${c2}" fill-opacity="0.8"/>`;

  body += footer(env, kit.themeOf("dark"), { logo: input.brandLogo, cta: "GRADE HIM ON WE-DRAFT.COM", more: false });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`;
}

// The post → [{ name, svg }]: the cover, the scouting report, his stats
// (when he has them), then the ad to evaluate him.
export function spotlightSlides(input, env) {
  const total = input.stats ? 4 : 3;
  const out = [
    { name: "cover", svg: coverSvg(env, input, total) },
    { name: "scouting-report", svg: reportSvg(env, input, 1, total) },
  ];
  if (input.stats) out.push({ name: "stats", svg: statsSvg(env, input, 2, total) });
  out.push({ name: "evaluate", svg: evaluateSvg(env, input, total - 1, total) });
  return out;
}

// The caption: the headline, then (a blank line either side) the spot for
// the bio the admin writes, then the grade block, the link, the hashtags.
export function spotlightCaption(input) {
  const name = `${input.first} ${input.last}`.trim();
  const tag = (s) => String(s || "").replace(/[^A-Za-z0-9]/g, "");
  const g = input.report?.grade;
  const traits = (list) => (list || []).slice(0, 3).map((t) => t.term).join(", ");
  const grade = [
    g?.avg != null ? `We-Draft.com Community Grade: ${g.label}.` : "",
    input.report?.strengths?.length ? `Top strengths: ${traits(input.report.strengths)}.` : "",
    input.report?.weaknesses?.length ? `Top weaknesses: ${traits(input.report.weaknesses)}.` : "",
  ].filter(Boolean).join("\n");
  return [
    `Today's Player Spotlight: ${name}, ${[input.pos, input.school].filter(Boolean).join(", ")}`,
    grade,
    `Grade him yourself: ${input.address.toLowerCase()}`,
    ["#NFLDraft", "#CollegeFootball", input.year && `#${input.year}NFLDraft`, input.school && `#${tag(input.school)}`, `#${tag(input.first)}${tag(input.last)}`].filter(Boolean).join(" "),
  ].filter(Boolean).join("\n\n");
}

// Every image the post draws.
export function spotlightImageUrls(input) {
  return [...new Set([input.brandLogo, input.badgeLogo, input.classLogo, input.photo, input.logo, input.logoDark, input.headshot, ...(input.showFits ? input.report?.fits || [] : []).map((f) => f.logo)].filter(Boolean))];
}
