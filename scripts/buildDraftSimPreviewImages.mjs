// scripts/buildDraftSimPreviewImages.mjs
//
// Draws the Draft Sim's link-preview images (og:image / twitter:image,
// 1200×630) into public/draftsim-og/: {TEAM}.png for each team page
// (/draftsim/nyj — the team's color, its logo on a white disc, "JETS MOCK
// DRAFT SIMULATOR") and default.png for /draftsim. No year on them, so the
// 2027 and 2028 pages share them. SVG rendered with resvg and the bundled
// Bebas Neue, as the broadcast thumbnails are (server/stream-manager/
// thumbnail.js) — the same inputs always give the same image.
//
// Inputs: the `nfl` collection's City / Team / Color1 / Color2 / Logo1,
// and src/assets/Logo2.png. Re-run when a team's branding changes and
// commit the PNGs. The tags pointing at them: utils/draftSim/meta.js.
// Usage:
//   node --env-file=.env scripts/buildDraftSimPreviewImages.mjs
import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { Resvg } from "@resvg/resvg-js";

const require = createRequire(import.meta.url);
const { getFirestore } = require("./firebaseAdmin");

const OUT = "public/draftsim-og";
const W = 1200;
const H = 630;
const BAR = 96;
const GOLD = "#f6a21d";
const NAVY = "#070d18";
const FONT = "Bebas Neue";
const FONT_FILE = "server/stream-manager/assets/BebasNeue-Regular.ttf";
const WD_LOGO = readFileSync("src/assets/Logo2.png");
const fontOpts = { font: { fontFiles: [FONT_FILE], loadSystemFonts: false, defaultFontFamily: FONT } };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`;
const shade = (h, f) => toHex(rgb(h).map((x) => x * f));
const lum = (h) => { const [r, g, b] = rgb(h).map((x) => x / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const hex = (v) => (/^#?[0-9a-f]{6}$/i.test(String(v || "").trim()) ? `#${String(v).trim().replace("#", "").toLowerCase()}` : null);

// Text width at a size, from resvg's own layout of the bundled font.
function measure(text, size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="400"><text x="0" y="300" font-family="${FONT}" font-size="${size}">${esc(text)}</text></svg>`;
  return new Resvg(svg, fontOpts).getBBox()?.width || 0;
}
// The largest size ≤ max at which text fits maxW.
const fit = (text, max, maxW) => Math.min(max, Math.floor((max * maxW) / Math.max(1, measure(text, max))));

const wdLogo = (x, y, h) => {
  const { w: lw, h: lh } = pngSize(WD_LOGO);
  const w = Math.round((lw / lh) * h);
  return { w, el: `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${WD_LOGO.toString("base64")}"/>` };
};

function bottomBar(url) {
  const logo = wdLogo(40, H - BAR + 20, BAR - 40);
  return `<rect x="0" y="${H - BAR}" width="${W}" height="${BAR}" fill="${NAVY}"/>
<rect x="0" y="${H - BAR}" width="${W}" height="5" fill="${GOLD}"/>
${logo.el}
<text x="${W - 40}" y="${H - BAR / 2 + 15}" text-anchor="end" font-family="${FONT}" font-size="40" fill="#ffffff" letter-spacing="1">${esc(url.toUpperCase())}</text>`;
}

function teamSvg(t, logo) {
  const c1 = hex(t.Color1) || "#0055a5";
  const bg = lum(c1) > 0.6 ? shade(c1, 0.45) : c1;
  const deep = shade(bg, 0.55);
  const cx = 300;
  const cy = (H - BAR) / 2;
  const r = 200;
  const box = 290;
  const textX = 560;
  const maxW = W - textX - 50;
  const nick = String(t.Team || "").toUpperCase();
  const city = String(t.City || "").toUpperCase();
  const nickSize = fit(nick, 170, maxW);
  const subSize = fit("MOCK DRAFT SIMULATOR", 70, maxW);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${deep}"/></linearGradient>
  <filter id="lift" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000000" flood-opacity="0.35"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" filter="url(#lift)"/>
${logo ? `<image x="${cx - box / 2}" y="${cy - box / 2}" width="${box}" height="${box}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${logo.toString("base64")}"/>` : ""}
<text x="${textX}" y="${cy - nickSize / 2 - 6}" font-family="${FONT}" font-size="56" fill="#ffffff" fill-opacity="0.82" letter-spacing="3">${esc(city)}</text>
<text x="${textX}" y="${cy + nickSize / 2 - 22}" font-family="${FONT}" font-size="${nickSize}" fill="#ffffff">${esc(nick)}</text>
<text x="${textX}" y="${cy + nickSize / 2 + subSize - 18}" font-family="${FONT}" font-size="${subSize}" fill="${GOLD}" letter-spacing="2">MOCK DRAFT SIMULATOR</text>
${bottomBar(`we-draft.com/draftsim/${t.id.toLowerCase()}`)}
</svg>`;
}

function defaultSvg() {
  // The logo's a wide wordmark: sized by width, not height.
  const { w: lw, h: lh } = pngSize(WD_LOGO);
  const logo = wdLogo(0, 0, Math.round((560 * lh) / lw));
  const title = "MOCK DRAFT SIMULATOR";
  const titleSize = fit(title, 150, W - 120);
  const sub = "MAKE EVERY PICK  ·  TRADE UP OR DOWN  ·  GET GRADED";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><radialGradient id="bg" cx="0.5" cy="-0.1" r="1.1"><stop offset="0" stop-color="#12305c"/><stop offset="0.6" stop-color="${NAVY}"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<g transform="translate(${Math.round((W - logo.w) / 2)}, 90)">${logo.el}</g>
<text x="${W / 2}" y="${330}" text-anchor="middle" font-family="${FONT}" font-size="${titleSize}" fill="#ffffff">${title}</text>
<text x="${W / 2}" y="${410}" text-anchor="middle" font-family="${FONT}" font-size="${fit(sub, 52, W - 160)}" fill="${GOLD}" letter-spacing="2">${sub}</text>
${bottomBar("we-draft.com/draftsim")}
</svg>`;
}

async function fetchPng(url) {
  if (!url) return null;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (We-Draft preview images)" }, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG: ${url}`);
  return buf;
}

const render = (svg) => new Resvg(svg, { ...fontOpts, fitTo: { mode: "width", value: W } }).render().asPng();

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/default.png`, render(defaultSvg()));
const teams = (await getFirestore().collection("nfl").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
let failed = 0;
for (const t of teams) {
  let logo = null;
  try { logo = await fetchPng(t.Logo1); } catch (e) { failed += 1; console.warn(`${t.id}: no logo (${e.message})`); }
  writeFileSync(`${OUT}/${t.id}.png`, render(teamSvg(t, logo)));
}
console.log(`Draft Sim preview images: default + ${teams.length} teams in ${OUT}${failed ? ` (${failed} without a logo)` : ""}`);
