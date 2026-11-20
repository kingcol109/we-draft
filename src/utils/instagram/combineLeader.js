// src/utils/instagram/combineLeader.js
//
// The all-time best Combine performer graphics (Admin → Content → Combine,
// components/AdminCombine.jsx): one per position — the #1 by Combine score
// (combineData.js combineProfiles → performers) — a front and a back, each
// 1080×1350, Combine themed: a navy testing hall with a laser grid, a
// measuring wall and turf, the NFL Combine shield. His school shows only as
// its logo; We-Draft.com only as the address.
//   front  his full-body action shot standing on the turf; the shield and
//          "ALL-TIME BEST COMBINE PERFORMER"; his Combine score on a timer
//          readout; his name, school and class beside him.
//   back   his measurements first, then every drill — each with its
//          percentile among his position (what the score is made of) — the
//          score, and where he was drafted as a graphic: his team's logo,
//          the round and the pick (or "Undrafted").
// Plain data in, SVG out (posts.js kit).
import { kit } from "./posts.js";
import { formatCombine } from "../combineData.js";

const { PAD, up, r1, fitSize, text, fitLine, image, hasImage, placed, svgDoc } = kit;
const W = 1080;
const H = 1350;
// The Combine's colors: the hall's navy, its blue, a laser cyan.
const C = { deep: "#020c1c", navy: "#04203f", blue: "#0055a5", cyan: "#38bdf8", ice: "#cfeeff", turf: "#0f3b22" };
// The photo's box: a full-body shot, standing on the turf.
export const COMBINE_PHOTO = { x: 300, y: 200, w: 740, h: 1075 };
const FLOOR = 1090;

// Every metric the graphics know: the four measurements, then the six drills.
export const COMBINE_METRICS = [
  { key: "height", label: "Height", build: true },
  { key: "weight", label: "Weight", build: true },
  { key: "arm", label: "Arm Length", build: true },
  { key: "hand", label: "Hand Size", build: true },
  { key: "forty", label: "40-Yard Dash" },
  { key: "vertical", label: "Vertical Jump" },
  { key: "broad", label: "Broad Jump" },
  { key: "bench", label: "Bench Press" },
  { key: "threeCone", label: "3-Cone Drill" },
  { key: "shuttle", label: "20-Yard Shuttle" },
];
const POS_NAMES = { QB: "Quarterbacks", RB: "Running Backs", WR: "Wide Receivers", TE: "Tight Ends", OL: "Offensive Linemen", EDGE: "Edge Rushers", DL: "Defensive Linemen", LB: "Linebackers", DB: "Defensive Backs" };

// A value as it's written on the graphic: 4.21 · 6'2" · 38.5" · 24 · 250 LBS.
export const combineValueText = (key, v) => (v == null ? "—" : key === "weight" ? `${Math.round(v)} LBS` : formatCombine(key, v));
const ordinal = (n) => `${n}${["TH", "ST", "ND", "RD"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;

// The input. performer: the position's #1 (combineProfiles performers[pos][0]:
// { name, school, year, round, pick, team, undrafted, score, drills, build },
// drills/build: { [key]: { value, pct } }); pool: how many at his position;
// school: its schools doc (its logo); teamLogo: his NFL team's logo;
// combineLogo: the NFL Combine shield; photo: { url, adjust }; headline: the
// kicker's big line (default "COMBINE PERFORMER", under "ALL-TIME BEST").
export function combineLeaderInput({ pos, performer = {}, pool = 0, span = "", school = {}, teamLogo = "", combineLogo = "", photo = null, headline = "", brandLogo = "", address = "" }) {
  const [first, ...rest] = String(performer.name || "").trim().split(/\s+/);
  const all = { ...(performer.drills || {}), ...(performer.build || {}) };
  return {
    pos, posName: POS_NAMES[pos] || pos, score: Number(performer.score) || 0,
    first: first || "", last: rest.join(" "), school: performer.school || "", year: String(performer.year || ""),
    round: performer.round || null, pick: performer.pick || null, team: performer.team || "", undrafted: !!performer.undrafted,
    pool, span,
    results: Object.fromEntries(Object.entries(all).map(([k, x]) => [k, x.value])),
    pcts: Object.fromEntries(Object.entries(all).map(([k, x]) => [k, Math.round(x.pct)])),
    collegeLogo: school.LogoDark || school.Logo1 || "", teamLogo, combineLogo,
    photo: photo?.url || "", adjust: { x: Number(photo?.adjust?.x) || 0, y: Number(photo?.adjust?.y) || 0, scale: Number(photo?.adjust?.scale) || 1 },
    headline: headline || "",
    brandLogo, address: address || `WE-DRAFT.COM/EVENTS/COMBINE/${String(pos || "").toLowerCase()}`,
  };
}
export const combineLeaderImageUrls = (input) => [...new Set([input.photo, input.collegeLogo, input.teamLogo, input.combineLogo, input.brandLogo].filter(Boolean))];

// ── The hall: shared by both sides ──
const DEFS = `<linearGradient id="cxBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.navy}"/><stop offset="0.7" stop-color="${C.deep}"/><stop offset="1" stop-color="#01060f"/></linearGradient>`
  + `<radialGradient id="cxSpot" cx="0.62" cy="0.42" r="0.55"><stop offset="0" stop-color="${C.blue}" stop-opacity="0.75"/><stop offset="0.6" stop-color="${C.blue}" stop-opacity="0.12"/><stop offset="1" stop-color="${C.blue}" stop-opacity="0"/></radialGradient>`
  + `<linearGradient id="cxTurf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.turf}" stop-opacity="0.2"/><stop offset="0.35" stop-color="${C.turf}"/><stop offset="1" stop-color="#05170d"/></linearGradient>`
  + `<linearGradient id="cxBar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.blue}"/><stop offset="1" stop-color="${C.cyan}"/></linearGradient>`
  + '<filter id="cxGlow" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
  + '<filter id="cxSoft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>'
  + `<linearGradient id="cxNameFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${C.ice}"/></linearGradient>`
  + '<filter id="cxName" x="-10%" y="-20%" width="120%" height="150%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000000" flood-opacity="0.55"/></filter>'
  + '<filter id="cxShadow" x="-20%" y="-10%" width="140%" height="130%"><feDropShadow dx="0" dy="16" stdDeviation="16" flood-color="#000000" flood-opacity="0.6"/></filter>';
// The laser grid over the hall.
function grid(h) {
  let s = "";
  for (let x = 60; x < W; x += 60) s += `<rect x="${x}" y="0" width="1.5" height="${h}" fill="${C.cyan}" opacity="0.05"/>`;
  for (let y = 60; y < h; y += 60) s += `<rect x="0" y="${y}" width="${W}" height="1.5" fill="${C.cyan}" opacity="0.05"/>`;
  return s;
}
// A panel: dark glass, a cyan edge.
const panel = (x, y, w, h, { glow = false, rx = 14 } = {}) => (glow ? `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${rx}" fill="${C.cyan}" opacity="0.25" filter="url(#cxSoft)"/>` : "")
  + `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${rx}" fill="#000000" fill-opacity="0.5" stroke="${C.cyan}" stroke-opacity="${glow ? 0.9 : 0.28}" stroke-width="${glow ? 3 : 2}"/>`;
// Glowing timer digits.
const digits = (x, y, value, size, anchor = "start") => `<g filter="url(#cxGlow)">${text(x, y, value, size, "#ffffff", { anchor, spacing: 3 })}</g>`;
// The foot: We-Draft's logo and the address, small.
function foot(env, input, y) {
  const im = env.images?.[input.brandLogo];
  const lh = 30;
  const lw = im?.w && im?.h ? (im.w / im.h) * lh : lh * 3;
  return image(env, input.brandLogo, PAD, y - lh + 6, lw, lh, "xMinYMid meet", 0.85)
    + fitLine(env, W - PAD, y, up(input.address), 26, W - PAD * 2 - lw - 30, "#ffffff", { anchor: "end", spacing: 1, opacity: 0.6, min: 16 }).svg;
}

// ═══════════ Front ═══════════
export function combineLeaderFront(input, env) {
  let body = `<rect width="${W}" height="${H}" fill="url(#cxBg)"/>` + grid(FLOOR) + `<rect width="${W}" height="${H}" fill="url(#cxSpot)"/>`;

  // The measuring wall, right edge: inch ticks, a foot mark every 120.
  const rx = W - 44;
  body += `<rect x="${rx}" y="150" width="3" height="${FLOOR - 150}" fill="${C.ice}" opacity="0.35"/>`;
  for (let y = FLOOR, i = 0; y >= 160; y -= 10, i++) {
    const big = i % 12 === 0;
    const len = big ? 26 : i % 6 === 0 ? 16 : 9;
    body += `<rect x="${rx - len}" y="${y}" width="${len}" height="2" fill="${C.ice}" opacity="${big ? 0.6 : 0.3}"/>`;
    if (big && i) body += text(rx - 34, y + 9, `${i / 12}'`, 26, C.ice, { anchor: "end", opacity: 0.55 });
  }

  // The turf: a floor in perspective, yard lines running to the back.
  body += `<rect y="${FLOOR - 30}" width="${W}" height="${H - FLOOR + 30}" fill="url(#cxTurf)"/>`;
  const vx = 690;
  const vy = FLOOR - 420;
  for (let i = -6; i <= 6; i++) {
    const bx = vx + i * 230;
    const t = (FLOOR - vy) / (H - vy);
    body += `<line x1="${r1(vx + (bx - vx) * t)}" y1="${FLOOR}" x2="${r1(bx)}" y2="${H}" stroke="#ffffff" stroke-width="3" opacity="0.16"/>`;
  }
  [FLOOR + 40, FLOOR + 110, FLOOR + 210].forEach((y, i) => { body += `<rect y="${y}" width="${W}" height="${2 + i}" fill="#ffffff" opacity="${r1(0.1 + i * 0.04)}"/>`; });
  // The laser line across the floor.
  body += `<rect y="${FLOOR - 2}" width="${W}" height="4" fill="${C.cyan}" opacity="0.8" filter="url(#cxGlow)"/>`;

  // Him, full body, standing on it.
  if (hasImage(env, input.photo)) {
    const b = COMBINE_PHOTO;
    body += `<ellipse cx="${r1(b.x + b.w / 2 + input.adjust.x)}" cy="${r1(b.y + b.h - 6 + input.adjust.y)}" rx="230" ry="26" fill="#000000" opacity="0.5" filter="url(#cxSoft)"/>`
      + `<g filter="url(#cxShadow)">${placed(image(env, input.photo, b.x, b.y, b.w, b.h, "xMidYMax meet"), b.x, b.y, b.w, b.h, input.adjust)}</g>`;
  }

  // Top left: the shield, then "ALL-TIME BEST / COMBINE PERFORMER / #1 · DEFENSIVE LINEMEN".
  const hasShield = hasImage(env, input.combineLogo);
  if (hasShield) body += image(env, input.combineLogo, PAD - 14, 34, 150, 150, "xMidYMid meet");
  const kx = hasShield ? PAD + 156 : PAD;
  body += text(kx, 82, "ALL-TIME BEST", 34, C.cyan, { spacing: 4 })
    + fitLine(env, kx, 140, up(input.headline || "COMBINE PERFORMER"), 60, W - kx - 80, "#ffffff", { spacing: 2, min: 32 }).svg
    + text(kx, 180, `#1 · ${up(input.posName)}`, 30, "#ffffff", { spacing: 3, opacity: 0.7 });

  // Left: the score on a timer readout.
  const tx = PAD;
  const ty = 300;
  const tw = 330;
  body += panel(tx, ty, tw, 210, { glow: true })
    + text(tx + 24, ty + 46, "COMBINE SCORE", 30, C.cyan, { spacing: 3 })
    + digits(tx + 22, ty + 168, input.score.toFixed(1), 128)
    + text(tx + tw - 22, ty + 192, "/ 100", 26, "#ffffff", { anchor: "end", spacing: 2, opacity: 0.55 });

  // Left: his school's logo, then his name — a cyan bar beside it, the first
  // name small and spaced in cyan, the last name big — then school and class
  // in a pill.
  const ny = 570;
  const hasLogo = hasImage(env, input.collegeLogo);
  if (hasLogo) body += image(env, input.collegeLogo, PAD, ny, 110, 110, "xMinYMid meet");
  const firstY = hasLogo ? ny + 176 : ny + 60;
  const nx = PAD + 24;
  const colW = 370;
  const last = up(input.last || input.first);
  const lastS = fitSize(env, last, 150, colW, 56, 2);
  const lastY = firstY + 18 + lastS * 0.86;
  body += `<rect x="${PAD}" y="${r1(firstY - 36)}" width="7" height="${r1(lastY - firstY + 40)}" rx="3.5" fill="${C.cyan}" filter="url(#cxGlow)"/>`
    + fitLine(env, nx, firstY, up(input.first), 42, colW, C.cyan, { spacing: 6, min: 24 }).svg
    + `<g filter="url(#cxName)">${text(nx - 3, lastY, last, lastS, "url(#cxNameFill)", { spacing: 2 })}</g>`;
  const tag = [up(input.school), input.year ? `${input.year} COMBINE` : ""].filter(Boolean).join("  ·  ");
  if (tag) {
    const ts = fitSize(env, tag, 30, colW - 40, 18, 2);
    const tw = env.measure(tag, ts) + 2 * Math.max(0, tag.length - 1) + 40;
    const py = lastY + 30;
    body += `<rect x="${PAD}" y="${r1(py)}" width="${r1(tw)}" height="${r1(ts + 26)}" rx="${r1((ts + 26) / 2)}" fill="#000000" fill-opacity="0.45" stroke="${C.cyan}" stroke-opacity="0.5" stroke-width="2"/>`
      + text(PAD + 20, py + ts + 7, tag, ts, "#ffffff", { spacing: 2, opacity: 0.9 });
  }

  body += foot(env, input, H - 34);
  return svgDoc(env, DEFS, body, C.deep);
}

// ═══════════ Back ═══════════
export function combineLeaderBack(input, env) {
  let body = `<rect width="${W}" height="${H}" fill="url(#cxBg)"/>` + grid(H) + `<rect width="${W}" height="${H}" fill="url(#cxSpot)" opacity="0.6"/>`;

  // ── Header: his school's logo and name; the shield, right ──
  const hasLogo = hasImage(env, input.collegeLogo);
  if (hasLogo) body += image(env, input.collegeLogo, PAD, 46, 120, 120, "xMidYMid meet");
  if (hasImage(env, input.combineLogo)) body += image(env, input.combineLogo, W - PAD - 120, 40, 130, 130, "xMidYMid meet");
  const hx = hasLogo ? PAD + 142 : PAD;
  const hw = W - PAD - 140 - hx;
  body += fitLine(env, hx, 88, up(input.first), 46, hw, "#ffffff", { spacing: 3, opacity: 0.8, min: 26 }).svg;
  const last = up(input.last || input.first);
  body += text(hx - 3, 164, last, fitSize(env, last, 92, hw, 46, 2), "#ffffff", { spacing: 2 });
  body += fitLine(env, PAD, 212, [input.pos, up(input.school), input.year ? `${input.year} COMBINE` : ""].filter(Boolean).join("  ·  "), 32, W - PAD * 2, C.cyan, { spacing: 2, min: 20 }).svg;

  // ── The score ──
  const gx = PAD - 14;
  const gw = W - PAD * 2 + 28;
  const sy = 240;
  body += panel(gx, sy, gw, 104, { glow: true })
    + text(gx + 26, sy + 48, "#1 ALL-TIME COMBINE SCORE", 34, C.cyan, { spacing: 3 })
    + text(gx + 26, sy + 86, up(input.posName), 28, "#ffffff", { spacing: 2, opacity: 0.7 })
    + digits(gx + gw - 26, sy + 86, input.score.toFixed(1), 84, "end");

  // A tile: label, value, its percentile and bar.
  const tile = (m, x, y, w, h, valueSize) => {
    const v = input.results?.[m.key];
    const p = input.pcts?.[m.key];
    const elite = p != null && p >= 90;
    let s = `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${h}" rx="12" fill="#ffffff" fill-opacity="0.05" stroke="${elite ? C.cyan : "#ffffff"}" stroke-opacity="${elite ? 0.7 : 0.12}" stroke-width="2"/>`
      + text(x + 18, y + 34, up(m.label), 24, "#ffffff", { spacing: 2, opacity: 0.6 });
    if (v == null) return s + text(x + 18, y + h - 30, "DID NOT TEST", 36, "#ffffff", { spacing: 2, opacity: 0.25 });
    s += fitLine(env, x + 16, y + 34 + valueSize * 0.92, combineValueText(m.key, v), valueSize, w - 120, "#ffffff", { spacing: 1, min: 26 }).svg;
    if (p != null) {
      s += text(x + w - 18, y + 34, "PCT", 22, "#ffffff", { anchor: "end", spacing: 2, opacity: 0.45 })
        + text(x + w - 18, y + 34 + valueSize * 0.85, ordinal(p), valueSize * 0.78, elite ? C.cyan : "#ffffff", { anchor: "end", spacing: 1 });
      const bw = w - 36;
      s += `<rect x="${r1(x + 18)}" y="${y + h - 22}" width="${r1(bw)}" height="9" rx="4.5" fill="#ffffff" fill-opacity="0.12"/>`
        + `<rect x="${r1(x + 18)}" y="${y + h - 22}" width="${r1(Math.max(9, (bw * p) / 100))}" height="9" rx="4.5" fill="${elite ? C.cyan : "url(#cxBar)"}"/>`;
    }
    return s;
  };
  const section = (y, label, w = 200) => text(PAD - 12, y, label, 26, C.cyan, { spacing: 5 }) + `<rect x="${PAD - 12 + w}" y="${y - 10}" width="${W - PAD * 2 - w + 12}" height="2" fill="${C.cyan}" opacity="0.3"/>`;

  // ── Measurements first ──
  let y = 388;
  body += section(y, "MEASUREMENTS", 220);
  y += 16;
  const mw = (gw - 3 * 12) / 4;
  COMBINE_METRICS.filter((m) => m.build).forEach((m, i) => { body += tile(m, gx + i * (mw + 12), y, mw, 132, 46); });

  // ── Then the drills ──
  y += 132 + 44;
  body += section(y, "DRILLS", 120);
  y += 16;
  const dw = (gw - 12) / 2;
  const dh = 118;
  COMBINE_METRICS.filter((m) => !m.build).forEach((m, i) => { body += tile(m, gx + (i % 2) * (dw + 12), y + Math.floor(i / 2) * (dh + 12), dw, dh, 56); });

  // ── The draft: his team's logo, the round and the pick ──
  y += 3 * dh + 2 * 12 + 44;
  body += section(y, input.round ? `${input.year} NFL DRAFT` : "NFL DRAFT", 240);
  y += 16;
  const dhgt = 150;
  body += panel(gx, y, gw, dhgt);
  if (input.round) {
    const hasTeam = hasImage(env, input.teamLogo);
    if (hasTeam) body += image(env, input.teamLogo, gx + 22, y + 15, 120, 120, "xMidYMid meet");
    const bx = gx + (hasTeam ? 164 : 26);
    const box = (bx2, label, value) => `<rect x="${r1(bx2)}" y="${y + 22}" width="150" height="106" rx="10" fill="#ffffff" fill-opacity="0.07" stroke="${C.cyan}" stroke-opacity="0.45" stroke-width="2"/>`
      + text(bx2 + 75, y + 50, label, 22, C.cyan, { anchor: "middle", spacing: 3 })
      + digits(bx2 + 75, y + 116, String(value), 68, "middle");
    body += box(bx, "ROUND", input.round) + (input.pick ? box(bx + 166, "PICK", input.pick) : "");
    const tx = bx + (input.pick ? 166 : 0) + 172;
    body += fitLine(env, tx, y + 72, up(input.team), 40, gx + gw - 22 - tx, "#ffffff", { spacing: 2, min: 22 }).svg
      + (input.pick ? text(tx, y + 112, `#${input.pick} OVERALL`, 28, "#ffffff", { spacing: 2, opacity: 0.6 }) : "");
  } else {
    body += digits(gx + gw / 2, y + 96, input.undrafted ? "UNDRAFTED" : "DRAFT —", 76, "middle")
      + (input.undrafted ? text(gx + gw / 2, y + 132, `NOT SELECTED IN THE ${input.year} DRAFT`, 24, C.cyan, { anchor: "middle", spacing: 3, opacity: 0.8 }) : "");
  }

  // ── What the score is, and the foot ──
  const note = `COMBINE SCORE: HIS PERCENTILES AMONG ${input.pool ? `${input.pool.toLocaleString("en-US")} ` : ""}${up(input.posName)}${input.span ? ` (${input.span})` : ""}, AVERAGED`;
  body += fitLine(env, W / 2, H - 70, note, 22, W - PAD * 2, "#ffffff", { anchor: "middle", spacing: 2, opacity: 0.45, min: 14 }).svg;
  body += foot(env, input, H - 26);
  return svgDoc(env, DEFS, body, C.deep);
}
