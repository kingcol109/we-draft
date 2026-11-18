// scripts/buildPortalSimPreviewImages.mjs
//
// Draws the Transfer Portal Sim's link-preview images (og:image /
// twitter:image, 1200×630) into public/portalsim-og/: {slug}.png for each
// school's page (/portalsim/florida-state — the school's color, its logo on
// a white disc, "FLORIDA STATE / TRANSFER PORTAL SIMULATOR") and default.png
// for /portalsim. Same look as the Draft Sim's (buildDraftSimPreviewImages.mjs):
// SVG rendered with resvg and the bundled Bebas Neue.
//
// Inputs: compSnapshots/_cfbTeams (School, Color1, Logo1 / LogoDark),
// src/utils/portalSim/simTeams.js (which schools), public/logos/
// transfer-portal-white.svg and src/assets/Logo2.png. Re-run when a school's
// branding changes and commit the PNGs. The tags: utils/portalSim/meta.js.
// Usage:
//   node --env-file=.env scripts/buildPortalSimPreviewImages.mjs
import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { Resvg } from "@resvg/resvg-js";
import SIM_TEAMS from "../src/utils/portalSim/simTeams.js";

const require = createRequire(import.meta.url);
const { getFirestore } = require("./firebaseAdmin");

const OUT = "public/portalsim-og";
const W = 1200;
const H = 630;
const BAR = 96;
const GOLD = "#f6a21d";
const NAVY = "#070d18";
const FONT = "Bebas Neue";
const FONT_FILE = "server/stream-manager/assets/BebasNeue-Regular.ttf";
const WD_LOGO = readFileSync("src/assets/Logo2.png");
const MARK = readFileSync("public/logos/transfer-portal-white.svg");
const fontOpts = { font: { fontFiles: [FONT_FILE], loadSystemFonts: false, defaultFontFamily: FONT } };
const TITLE = "TRANSFER PORTAL SIMULATOR";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`;
const shade = (h, f) => toHex(rgb(h).map((x) => x * f));
const lum = (h) => { const [r, g, b] = rgb(h).map((x) => x / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const hex = (v) => (/^#?[0-9a-f]{6}$/i.test(String(v || "").trim()) ? `#${String(v).trim().replace("#", "").toLowerCase()}` : null);
const dataUri = (img) => `data:${img.type};base64,${img.buf.toString("base64")}`;

function measure(text, size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="400"><text x="0" y="300" font-family="${FONT}" font-size="${size}">${esc(text)}</text></svg>`;
  return new Resvg(svg, fontOpts).getBBox()?.width || 0;
}
const fit = (text, max, maxW) => Math.min(max, Math.floor((max * maxW) / Math.max(1, measure(text, max))));

const wdLogo = (x, y, h) => {
  const { w: lw, h: lh } = pngSize(WD_LOGO);
  const w = Math.round((lw / lh) * h);
  return { w, el: `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${WD_LOGO.toString("base64")}"/>` };
};

function bottomBar(url) {
  const logo = wdLogo(40, H - BAR + 20, BAR - 40);
  // Long school slugs shrink to fit beside the logo.
  const text = url.toUpperCase();
  const size = fit(text, 40, W - 40 - (40 + logo.w + 40));
  return `<rect x="0" y="${H - BAR}" width="${W}" height="${BAR}" fill="${NAVY}"/>
<rect x="0" y="${H - BAR}" width="${W}" height="5" fill="${GOLD}"/>
${logo.el}
<text x="${W - 40}" y="${H - BAR / 2 + Math.round(size * 0.37)}" text-anchor="end" font-family="${FONT}" font-size="${size}" fill="#ffffff" letter-spacing="1">${esc(text)}</text>`;
}

function teamSvg(slug, t, logo) {
  const c1 = hex(t.Color1) || "#0055a5";
  const bg = lum(c1) > 0.6 ? shade(c1, 0.45) : c1;
  const deep = shade(bg, 0.5);
  const cx = 300;
  const cy = (H - BAR) / 2;
  const r = 200;
  const box = 290;
  const textX = 560;
  const maxW = W - textX - 50;
  const name = String(t.School || SIM_TEAMS[slug]).toUpperCase();
  const nameSize = fit(name, 150, maxW);
  const subSize = fit(TITLE, 64, maxW);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${deep}"/></linearGradient>
  <filter id="lift" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000000" flood-opacity="0.35"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<image x="${W - 330}" y="-40" width="420" height="420" opacity="0.08" href="data:image/svg+xml;base64,${MARK.toString("base64")}"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" filter="url(#lift)"/>
${logo ? `<image x="${cx - box / 2}" y="${cy - box / 2}" width="${box}" height="${box}" preserveAspectRatio="xMidYMid meet" href="${dataUri(logo)}"/>` : ""}
<text x="${textX}" y="${Math.round(cy + nameSize / 2 - 10 - nameSize * 0.72 - 16)}" font-family="${FONT}" font-size="44" fill="${GOLD}" letter-spacing="3">${esc(`${new Date().getUTCMonth() >= 7 ? new Date().getUTCFullYear() + 1 : new Date().getUTCFullYear()} COLLEGE FOOTBALL`)}</text>
<text x="${textX}" y="${cy + nameSize / 2 - 10}" font-family="${FONT}" font-size="${nameSize}" fill="#ffffff">${esc(name)}</text>
<text x="${textX}" y="${cy + nameSize / 2 + subSize}" font-family="${FONT}" font-size="${subSize}" fill="#ffffff" fill-opacity="0.85" letter-spacing="2">${TITLE}</text>
${bottomBar(`we-draft.com/portalsim/${slug}`)}
</svg>`;
}

function defaultSvg() {
  const year = new Date().getUTCMonth() >= 7 ? new Date().getUTCFullYear() + 1 : new Date().getUTCFullYear();
  const title = `${year} ${TITLE}`;
  const titleSize = fit(title, 120, W - 120);
  const sub = "KEEP YOUR STARS  ·  MAKE NIL OFFERS  ·  GET GRADED";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><radialGradient id="bg" cx="0.2" cy="0.1" r="1.2"><stop offset="0" stop-color="#1b4f8f"/><stop offset="0.65" stop-color="#0a1430"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<image x="${W / 2 - 110}" y="50" width="220" height="220" href="data:image/svg+xml;base64,${MARK.toString("base64")}"/>
<text x="${W / 2}" y="${370}" text-anchor="middle" font-family="${FONT}" font-size="${titleSize}" fill="#ffffff">${esc(title)}</text>
<text x="${W / 2}" y="${450}" text-anchor="middle" font-family="${FONT}" font-size="${fit(sub, 52, W - 160)}" fill="${GOLD}" letter-spacing="2">${sub}</text>
${bottomBar("we-draft.com/portalsim")}
</svg>`;
}

// A logo as resvg can embed it: PNG, JPEG or SVG (WebP and others are skipped).
async function fetchLogo(url) {
  if (!url) return null;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (We-Draft preview images)" }, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.readUInt32BE(0) === 0x89504e47) return { buf, type: "image/png" };
  if (buf[0] === 0xff && buf[1] === 0xd8) return { buf, type: "image/jpeg" };
  if (/<svg[\s>]/i.test(buf.subarray(0, 2000).toString("utf8"))) return { buf, type: "image/svg+xml" };
  throw new Error(`not PNG/JPEG/SVG: ${url}`);
}

const render = (svg) => new Resvg(svg, { ...fontOpts, fitTo: { mode: "width", value: W } }).render().asPng();

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/default.png`, render(defaultSvg()));
const snap = (await getFirestore().collection("compSnapshots").doc("_cfbTeams").get()).data();
const brands = snap?.teams || {};
let failed = 0;
for (const slug of Object.keys(SIM_TEAMS)) {
  const t = brands[slug] || { School: SIM_TEAMS[slug] };
  let logo = null;
  for (const url of [t.Logo1, t.LogoDark]) {
    try { logo = await fetchLogo(url); if (logo) break; } catch (e) { /* next */ }
  }
  if (!logo) { failed += 1; console.warn(`${slug}: no usable logo`); }
  writeFileSync(`${OUT}/${slug}.png`, render(teamSvg(slug, t, logo)));
}
console.log(`Portal Sim preview images: default + ${Object.keys(SIM_TEAMS).length} schools in ${OUT}${failed ? ` (${failed} without a logo)` : ""}`);
