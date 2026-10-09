// server/stream-manager/thumbnail.js
//
// YouTube thumbnails for game broadcasts, drawn from a fixed template — no
// AI, no image service. A 1280×720 SVG (the two teams' angled color panels,
// their logos and names, a central VS, the We-Draft logo and kickoff on a
// blue bar) rendered to PNG with resvg (@resvg/resvg-js), using only the
// bundled font (assets/BebasNeue-Regular.ttf, SIL OFL — assets/OFL-BebasNeue.txt)
// and never the machine's fonts, so the same inputs give the same image.
//
// Inputs, all existing data:
//   schedule26/{scheduleId}      the matchup and orientation: Away on the
//                                left, Home on the right, KickoffAt
//   schools (School == name)     Color1 / Color2 and logos (see logoCandidates)
//   liveGames/{CFBDGameId}       each side's CFBD team id, when the school
//                                doc lacks one (ESPN's logo set is keyed by it)
//   src/assets/Logo2.png         the We-Draft logo, embedded as-is
//
// Stored (metadata.js saveThumbnail) in broadcastThumbnails/{CFBDGameId}.
// Generating or saving one never calls YouTube; uploading it to a created
// broadcast is its own admin action (broadcasts.js youtubeThumbnail).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const W = 1280;
const H = 720;
const TEMPLATE_VERSION = 1;
const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const NAVY = "#0b1426";
const FONT_FILE = path.join(__dirname, "assets", "BebasNeue-Regular.ttf");
const WD_LOGO_FILE = path.join(__dirname, "..", "..", "src", "assets", "Logo2.png");
const FONT = "Bebas Neue";

// Layout: the panels meet on a diagonal from (SEAM_TOP, 0) to (SEAM_BOTTOM, BAR_Y).
const BAR_Y = 610;
const SEAM_TOP = 700;
const SEAM_BOTTOM = 580;
const PANEL_X = { away: 320, home: 960 };
const LOGO_BOX = { w: 360, h: 320, cy: 250 };
const NAME = { y: 545, maxW: 470, size: 84, minSize: 34, shortBelow: 50 };

// ── Assets ──
let assets = null;
function loadAssets() {
  if (assets) return assets;
  const wd = fs.readFileSync(WD_LOGO_FILE);
  assets = {
    fontFile: FONT_FILE,
    wdLogo: { b64: wd.toString("base64"), ...pngSize(wd) },
  };
  return assets;
}

// A PNG's own width / height (IHDR), for keeping its aspect ratio.
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// ── Colors ──
const HEX_RE = /^#?([0-9a-f]{6})$/i;
const hex = (v) => { const m = HEX_RE.exec(String(v || "").trim()); return m ? `#${m[1].toLowerCase()}` : null; };
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`;
const shade = (h, f) => toHex(rgb(h).map((x) => x * f));
const dist = (a, b) => Math.sqrt(rgb(a).reduce((t, x, i) => t + (x - rgb(b)[i]) ** 2, 0));
const lum = (h) => { const [r, g, b] = rgb(h).map((x) => x / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const FALLBACK = { away: BLUE, home: "#26334d" };

// Each side's panel color: its primary (Color1), else its second color,
// else a neutral. A near-white primary (white text would vanish) gives way
// to the second color, else is darkened. Two teams that look alike: the home
// side switches to its second color, else is darkened, so the panels part.
function panelColors(away, home) {
  const pick = (t, side) => {
    const c1 = hex(t.color);
    const c2 = hex(t.color2);
    if (c1 && lum(c1) < 0.75) return c1;
    if (c2 && lum(c2) < 0.75) return c2;
    return c1 ? shade(c1, 0.45) : FALLBACK[side];
  };
  const a = pick(away, "away");
  let h = pick(home, "home");
  if (dist(a, h) < 90) {
    const c2 = hex(home.color2);
    h = c2 && lum(c2) < 0.75 && dist(a, c2) >= 90 ? c2 : lum(h) > 0.12 ? shade(h, 0.45) : FALLBACK.home === a ? BLUE : FALLBACK.home;
  }
  return { away: a, home: h };
}

// ── Logos ──
const ESPN = "https://a.espncdn.com/i/teamlogos/ncaa";
// The order logos are tried for a team panel (saturated team color): the
// dark-background versions first (they carry the outlines that keep them
// off the panel color), then the primary, then ESPN's dark and regular
// sets by CFBD team id. Duplicates are dropped.
function logoCandidates(school = {}, teamId = null) {
  const id = school.CFBDTeamId ?? teamId;
  const list = [
    ["LogoDark", school.LogoDark],
    ["LogoBlack", school.LogoBlack],
    ["Logo1", school.Logo1],
    ["espn-dark", id != null && /^\d{1,10}$/.test(String(id)) ? `${ESPN}/500-dark/${id}.png` : null],
    ["espn", id != null && /^\d{1,10}$/.test(String(id)) ? `${ESPN}/500/${id}.png` : null],
  ];
  const seen = new Set();
  return list.filter(([, url]) => url && !seen.has(url) && seen.add(url)).map(([source, url]) => ({ source, url }));
}

// Only https, never an address on this machine or a private network.
function safeLogoUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^[\d.]+$/.test(host) || host.includes(":")) return false; // IP literals
  return true;
}

// The image's type from its first bytes — what resvg can draw (not WebP).
function imageType(buf) {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 6 && buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  const head = buf.toString("utf8", 0, Math.min(buf.length, 512)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}

const MAX_LOGO_BYTES = 3 * 1024 * 1024;
const LOGO_TIMEOUT_MS = 6000;
async function fetchLogo(url, fetchImpl = fetch) {
  if (!safeLogoUrl(url)) return { error: "not an https address" };
  try {
    const r = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(LOGO_TIMEOUT_MS) });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const len = Number(r.headers?.get?.("content-length") || 0);
    if (len > MAX_LOGO_BYTES) return { error: "too large" };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_LOGO_BYTES) return { error: "too large" };
    const mime = imageType(buf);
    if (!mime) return { error: "not a PNG, JPEG, GIF or SVG" };
    return { mime, data: buf };
  } catch (e) {
    return { error: e.name === "TimeoutError" ? "timed out" : "unreachable" };
  }
}

// The first candidate that loads as a drawable image, or null.
async function firstLogo(cands, fetchImpl) {
  const tried = [];
  for (const c of cands) {
    const r = await fetchLogo(c.url, fetchImpl);
    if (r.data) return { logo: { source: c.source, url: c.url, mime: r.mime, b64: r.data.toString("base64") }, tried };
    tried.push(`${c.source}: ${r.error}`);
  }
  return { logo: null, tried };
}

// ── Text ──
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const initials = (name) => {
  const words = String(name || "").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !/^(of|the|at)$/i.test(w));
  return (words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] || "?").slice(0, 3)).slice(0, 4).toUpperCase();
};

// Width of text in the bundled font (resvg's own layout), memoized.
const widths = new Map();
function measure(text, size) {
  const key = `${size}|${text}`;
  if (widths.has(key)) return widths.get(key);
  const { Resvg } = require("@resvg/resvg-js");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="${size * 2}"><text x="0" y="${size * 1.5}" font-family="${FONT}" font-size="${size}">${esc(text)}</text></svg>`;
  const b = new Resvg(svg, fontOpts()).getBBox();
  const w = b ? b.width : 0;
  widths.set(key, w);
  return w;
}
const fontOpts = () => ({ font: { fontFiles: [loadAssets().fontFile], loadSystemFonts: false, defaultFontFamily: FONT } });

// The largest size (≤ max) at which text fits maxW; a long name that would
// end up smaller than shortBelow uses the short name instead; anything still
// too wide at minSize is cut with an ellipsis.
function fitText(full, short, { maxW, size, minSize, shortBelow }, measureFn = measure) {
  const sizeFor = (t) => Math.min(size, Math.floor((size * maxW) / Math.max(1, measureFn(t, size))));
  let text = String(full || short || "TBD").toUpperCase();
  let s = sizeFor(text);
  if (s < shortBelow && short && String(short).toUpperCase() !== text) {
    const st = String(short).toUpperCase();
    const ss = sizeFor(st);
    if (ss > s) { text = st; s = ss; }
  }
  if (s < minSize) {
    s = minSize;
    while (text.length > 1 && measureFn(`${text}…`, s) > maxW) text = text.slice(0, -1).trimEnd();
    text = `${text}…`;
  }
  return { text, size: s };
}

// "SATURDAY, OCT 17 · 3:30 PM ET"
function kickoffLabel(ms, timeTbd = false) {
  if (!ms) return "KICKOFF TBA";
  const d = new Date(ms);
  const day = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" });
  if (timeTbd) return `${day} · TIME TBA`.toUpperCase();
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  return `${day} · ${t} ET`.toUpperCase();
}

// ── Template ──
// spec: { away, home: { name, short, color, color2, logo: { mime, b64 } | null },
//         kickoffAt, timeTbd }
function buildSvg(spec, measureFn = measure) {
  const a = loadAssets();
  const colors = panelColors(spec.away, spec.home);
  const kick = kickoffLabel(spec.kickoffAt, spec.timeTbd);
  const kickFit = fitText(kick, null, { maxW: 560, size: 46, minSize: 26, shortBelow: 0 }, measureFn);
  const kickW = Math.min(560, measureFn(kickFit.text, kickFit.size));
  const live = { w: 108, h: 50 };
  const liveX = W - 40 - kickW - 22 - live.w;
  const wdH = 52;
  const wdW = Math.round((a.wdLogo.w * wdH) / a.wdLogo.h);

  const panel = (side) => {
    const t = spec[side];
    const cx = PANEL_X[side];
    const name = fitText(t.name, t.short, NAME, measureFn);
    const box = { x: cx - LOGO_BOX.w / 2, y: LOGO_BOX.cy - LOGO_BOX.h / 2 };
    const logo = t.logo
      ? `<image x="${box.x}" y="${box.y}" width="${LOGO_BOX.w}" height="${LOGO_BOX.h}" preserveAspectRatio="xMidYMid meet" filter="url(#lift)" href="data:${t.logo.mime};base64,${t.logo.b64}"/>`
      // No logo: the team's initials in a ring.
      : `<circle cx="${cx}" cy="${LOGO_BOX.cy}" r="138" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="10"/>`
        + `<text x="${cx}" y="${LOGO_BOX.cy + 42}" text-anchor="middle" font-family="${FONT}" font-size="${initials(t.name).length > 3 ? 92 : 120}" fill="#ffffff" filter="url(#shadow)">${esc(initials(t.name))}</text>`;
    // A dark pool under the logo keeps one in the team's own color (gold on
    // gold) readable on its panel.
    return `<circle cx="${cx}" cy="${LOGO_BOX.cy}" r="215" fill="url(#glow)"/>${logo}`
      + `<text x="${cx}" y="${NAME.y}" text-anchor="middle" font-family="${FONT}" font-size="${name.size}" fill="#ffffff" filter="url(#shadow)">${esc(name.text)}</text>`;
  };

  const seamAt = (y) => SEAM_TOP + ((SEAM_BOTTOM - SEAM_TOP) * y) / BAR_Y;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="ga" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${colors.away}"/><stop offset="1" stop-color="${shade(colors.away, 0.55)}"/></linearGradient>
  <linearGradient id="gh" x1="1" y1="0" x2="0.65" y2="1"><stop offset="0" stop-color="${colors.home}"/><stop offset="1" stop-color="${shade(colors.home, 0.55)}"/></linearGradient>
  <radialGradient id="glow"><stop offset="0" stop-color="#000000" stop-opacity="0.42"/><stop offset="0.6" stop-color="#000000" stop-opacity="0.25"/><stop offset="1" stop-color="#000000" stop-opacity="0"/></radialGradient>
  <filter id="shadow" x="-10%" y="-30%" width="120%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000000" flood-opacity="0.55"/></filter>
  <filter id="lift" x="-15%" y="-15%" width="130%" height="130%"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000000" flood-opacity="0.45"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="${NAVY}"/>
<polygon points="0,0 ${SEAM_TOP},0 ${SEAM_BOTTOM},${BAR_Y} 0,${BAR_Y}" fill="url(#ga)"/>
<polygon points="${SEAM_TOP},0 ${W},0 ${W},${BAR_Y} ${SEAM_BOTTOM},${BAR_Y}" fill="url(#gh)"/>
<polygon points="${SEAM_TOP - 13},0 ${SEAM_TOP + 13},0 ${SEAM_BOTTOM + 13},${BAR_Y} ${SEAM_BOTTOM - 13},${BAR_Y}" fill="${GOLD}"/>
${panel("away")}
${panel("home")}
<circle cx="${seamAt(305)}" cy="305" r="84" fill="${NAVY}" stroke="${GOLD}" stroke-width="9"/>
<text x="${seamAt(305)}" y="338" text-anchor="middle" font-family="${FONT}" font-size="96" fill="#ffffff">VS</text>
<rect x="0" y="${BAR_Y}" width="${W}" height="${H - BAR_Y}" fill="${BLUE}"/>
<rect x="0" y="${BAR_Y}" width="${W}" height="7" fill="${GOLD}"/>
<image x="40" y="${BAR_Y + 7 + Math.round((H - BAR_Y - 7 - wdH) / 2)}" width="${wdW}" height="${wdH}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${a.wdLogo.b64}"/>
<rect x="${liveX}" y="${BAR_Y + 33}" width="${live.w}" height="${live.h}" rx="8" fill="${GOLD}"/>
<text x="${liveX + live.w / 2}" y="${BAR_Y + 33 + 41}" text-anchor="middle" font-family="${FONT}" font-size="44" fill="${NAVY}">LIVE</text>
<text x="${W - 40}" y="${BAR_Y + 33 + 42}" text-anchor="end" font-family="${FONT}" font-size="${kickFit.size}" fill="#ffffff">${esc(kickFit.text)}</text>
</svg>`;
}

function renderPng(svg) {
  const { Resvg } = require("@resvg/resvg-js");
  const img = new Resvg(svg, { ...fontOpts(), fitTo: { mode: "original" }, background: NAVY }).render();
  const png = img.asPng();
  return { png, width: img.width, height: img.height, sha256: crypto.createHash("sha256").update(png).digest("hex") };
}

// ── The game's inputs ──

async function schoolDoc(db, name) {
  if (!name) return null;
  const snap = await db.collection("schools").where("School", "==", String(name)).limit(1).get();
  return snap.docs[0]?.data() || null;
}

// Everything the template needs for one schedule26 game, plus notes on
// anything missing (shown in the editor). fetchImpl: the logo fetch (tests).
async function gameSpec(db, scheduleId, { fetchImpl } = {}) {
  const { scheduleGame } = require("./metadata");
  const g = await scheduleGame(db, scheduleId);
  const sched = (await db.collection("schedule26").doc(g.scheduleId).get()).data() || {};
  const live = (await db.collection("liveGames").doc(g.gameId).get()).data() || {};
  const notes = [];
  const side = async (k, name) => {
    const s = await schoolDoc(db, name);
    if (!s) notes.push(`${name || k}: no school branding found — default colors.`);
    else if (!hex(s.Color1)) notes.push(`${name}: no school color saved — default color.`);
    const { logo, tried } = await firstLogo(logoCandidates(s || {}, live[k]?.providerTeamId ?? null), fetchImpl);
    if (!logo) notes.push(`${name || k}: no logo could be loaded${tried.length ? ` (${tried.join("; ")})` : ""} — showing initials.`);
    return { name: s?.School || name || "TBD", short: s?.Short || live[k]?.short || null, color: s?.Color1 || null, color2: s?.Color2 || null, logo };
  };
  const away = await side("away", g.away);
  const home = await side("home", g.home);
  const timeTbd = /tba|tbd/i.test(String(sched.Time || "")) || live.startTimeTBD === true;
  return { game: g, spec: { away, home, kickoffAt: g.kickoffAt, timeTbd }, notes };
}

// Generate (nothing stored): the PNG plus what it was made from.
async function generate(db, scheduleId, opts = {}) {
  const { game, spec, notes } = await gameSpec(db, scheduleId, opts);
  const out = renderPng(buildSvg(spec));
  const summary = (t) => ({ name: t.name, color: t.color, logo: t.logo ? { source: t.logo.source, url: t.logo.url } : null });
  return { game, ...out, notes, inputs: { away: summary(spec.away), home: summary(spec.home), kickoffAt: spec.kickoffAt, templateVersion: TEMPLATE_VERSION } };
}

module.exports = {
  W, H, TEMPLATE_VERSION, BLUE, GOLD,
  logoCandidates, safeLogoUrl, imageType, fetchLogo, firstLogo, panelColors, fitText, kickoffLabel, initials,
  buildSvg, renderPng, gameSpec, generate, pngSize, measure,
};
