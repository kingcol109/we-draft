// src/components/AdminSideGraphics.jsx
//
// Admin → Videos → Graphics → Side Graphics: the YouTube videos' side cards — a
// 1920×1080 PNG, transparent but for one card at the frame's edge, to drop
// onto a timeline in Premiere. Drawn in the browser on a canvas, in Eras
// Bold ITC from this computer's own fonts (it ships with Office; never
// uploaded — its license wouldn't allow it), falling back to Arial Black.
//
// Templates (config/sideGraphics.presets — named, saved and renamed here):
// each is a kind and its layout (footer, stats title, style, side, sizes,
// what's shown). Kinds:
//   season  a player and his current season: up to STATS stats picked from
//           his ESPN line (✎ to edit one; a custom one typed in), each with
//           his national rank in it (CFBD's seasonRanks) and a note.
//   career  a player and his career table: a row a season (with the team's
//           logo) and the career totals, in his position's columns
//           (CAREER_COLS — QB CMP% / YDS / TD / INT…); another of his stat
//           groups can be picked.
//   class   a class's top players at a position: the class board (compSnapshots
//           class_{year}_{pos}, by board rank) top N, reordered, removed or
//           added to by hand.
//   list    a list of the admin's own (a watchlist): titled anything, any
//           prospects added, reordered and removed; numbered or not.
//   ad      an Homage ad: a team's (ads — NFL, cfbAds — schools, edited in
//           Admin → Ads; fetchAds / fetchCfbAds) product, one of its three
//           photos or any image, in the team's colors over the Homage logo;
//           the team's nickname (a school's name) fills the top. Every NFL
//           team's, or every school's, at once with Download all.
// Players: College (any prospect — his school's colors and logo, his
// headshot from playerPhotos or ESPN, his stats from ESPN: the athlete
// matched on his school's ESPN roster) or NFL (a team's ESPN roster). ESPN's
// athlete stats (site.web.api.espn.com — the one ESPN host a browser may
// read) carry each season with its team and the career totals.
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, documentId, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { sanitizeImgur, NFL_TEAM_ABBRS, teamNameFromAbbr } from "./MarginAds";
import { fetchNflBranding } from "../utils/draftProfileData";
import { fetchEspnRoster } from "../utils/nflRoster";
import { getSiteSnapshot, fetchAds, fetchCfbAds } from "../utils/siteSnapshots";
import HomageLogo from "../assets/homagelogo.png";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const W = 1920;
const H = 1080;
// The card: its size and its gap from the frame's edges (as the example).
const CARD_W = 425;
const CARD_H = 720;
const EDGE = 15;
// Browsers know Eras Bold ITC as the bold weight of "Eras ITC" (its
// DirectWrite family), not by its Windows name; every font string is bold.
const FONT = '"Eras ITC", "Eras Bold ITC", "Arial Black", sans-serif';
const font = (size) => `bold ${size}px ${FONT}`;
const STATS = 4;
const CAREER_ROWS = 5;
const CLASS_YEARS = ["2027", "2028", "2029"];
const CLASS_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB"];
const SETTINGS_DOC = doc(db, "config", "sideGraphics");
const ESPN = "https://site.web.api.espn.com/apis";

// ── Stats (ESPN) ──
// A stat's name on the card, by "{category}.{ESPN stat name}", in the order
// they're offered; others get their category's short name and ESPN's label.
const STAT_NAMES = {
  "passing.passingYards": "Pass Yds", "passing.passingTouchdowns": "Pass TD", "passing.interceptions": "INT Thrown", "passing.completionPct": "Comp %",
  "passing.yardsPerPassAttempt": "Yds / Att", "passing.QBRating": "Rating", "passing.completions": "Completions", "passing.passingAttempts": "Attempts", "passing.longPassing": "Long Pass",
  "rushing.rushingYards": "Rush Yds", "rushing.rushingTouchdowns": "Rush TD", "rushing.rushingAttempts": "Carries", "rushing.yardsPerRushAttempt": "Yds / Carry", "rushing.longRushing": "Long Run",
  "receiving.receptions": "Catches", "receiving.receivingYards": "Rec Yds", "receiving.receivingTouchdowns": "Rec TD", "receiving.yardsPerReception": "Yds / Catch",
  "receiving.receivingTargets": "Targets", "receiving.longReception": "Long Catch",
  "defensive.totalTackles": "Tackles", "defensive.sacks": "Sacks", "defensive.interceptions": "INT", "defensive.passesDefended": "Passes Def",
  "defensive.fumblesForced": "Forced Fumbles", "defensive.soloTackles": "Solo Tackles", "defensive.assistTackles": "Assists", "defensive.interceptionYards": "INT Yds",
  "defensive.interceptionTouchdowns": "Pick Sixes", "defensive.fumblesRecovered": "Fumble Rec", "defensive.stuffs": "Stuffs",
};
const CAT_SHORT = { passing: "Pass", rushing: "Rush", receiving: "Rec", defensive: "Def", returning: "Ret", kicking: "Kick", punting: "Punt", scoring: "Scoring" };
const CAT_TITLE = { passing: "Passing", rushing: "Rushing", receiving: "Receiving", defensive: "Defense", returning: "Returns", kicking: "Kicking", punting: "Punting", scoring: "Scoring" };
// ESPN's stat → CFBD's (seasonRanks' "{category}.{stat}"), for the national rank.
const RANK_KEY = {
  "passing.passingYards": "passing.YDS", "passing.passingTouchdowns": "passing.TD", "passing.interceptions": "passing.INT", "passing.completionPct": "passing.PCT",
  "rushing.rushingYards": "rushing.YDS", "rushing.rushingTouchdowns": "rushing.TD", "rushing.yardsPerRushAttempt": "rushing.YPC",
  "receiving.receptions": "receiving.REC", "receiving.receivingYards": "receiving.YDS", "receiving.receivingTouchdowns": "receiving.TD", "receiving.yardsPerReception": "receiving.YPR",
  "defensive.totalTackles": "defensive.TOT", "defensive.soloTackles": "defensive.SOLO", "defensive.sacks": "defensive.SACKS", "defensive.passesDefended": "defensive.PD",
  "defensive.interceptions": "interceptions.INT",
};
// A position, ours or ESPN's, → the group its stats follow.
const POS_GROUP = {
  QB: "QB", RB: "RB", HB: "RB", FB: "RB", WR: "WR", TE: "TE",
  OL: "OL", OT: "OL", T: "OL", G: "OL", OG: "OL", C: "OL", IOL: "OL",
  DL: "DL", DT: "DL", NT: "DL", IDL: "DL", EDGE: "EDGE", DE: "EDGE",
  LB: "LB", ILB: "LB", MLB: "LB", OLB: "LB", DB: "DB", CB: "DB", S: "DB", FS: "DB", SS: "DB", NB: "DB",
};
export const posGroup = (pos) => POS_GROUP[String(pos || "").toUpperCase()] || "";
// The four a position's season card starts with (those he has).
const POS_STATS = {
  QB: ["passing.passingYards", "passing.passingTouchdowns", "passing.interceptions", "passing.completionPct"],
  RB: ["rushing.rushingYards", "rushing.rushingTouchdowns", "rushing.yardsPerRushAttempt", "receiving.receivingYards"],
  WR: ["receiving.receptions", "receiving.receivingYards", "receiving.receivingTouchdowns", "receiving.yardsPerReception"],
  TE: ["receiving.receptions", "receiving.receivingYards", "receiving.receivingTouchdowns", "receiving.yardsPerReception"],
  DL: ["defensive.totalTackles", "defensive.sacks", "defensive.fumblesForced", "defensive.passesDefended"],
  EDGE: ["defensive.totalTackles", "defensive.sacks", "defensive.fumblesForced", "defensive.passesDefended"],
  LB: ["defensive.totalTackles", "defensive.sacks", "defensive.interceptions", "defensive.passesDefended"],
  DB: ["defensive.totalTackles", "defensive.interceptions", "defensive.passesDefended", "defensive.fumblesForced"],
};
// The career table's columns: [ESPN stat name, header], by stat group; a
// position's own group and columns (CAREER_BY_POS) first.
const CAREER_COLS = {
  passing: [["completionPct", "CMP%"], ["passingYards", "YDS"], ["passingTouchdowns", "TD"], ["interceptions", "INT"]],
  rushing: [["rushingAttempts", "CAR"], ["rushingYards", "YDS"], ["yardsPerRushAttempt", "AVG"], ["rushingTouchdowns", "TD"]],
  receiving: [["receptions", "REC"], ["receivingYards", "YDS"], ["yardsPerReception", "AVG"], ["receivingTouchdowns", "TD"]],
  defensive: [["totalTackles", "TCK"], ["sacks", "SACK"], ["interceptions", "INT"], ["passesDefended", "PD"]],
};
const CAREER_BY_POS = {
  QB: ["passing"], RB: ["rushing"], WR: ["receiving"], TE: ["receiving"],
  DL: ["defensive", [["totalTackles", "TCK"], ["sacks", "SACK"], ["fumblesForced", "FF"], ["passesDefended", "PD"]]],
  EDGE: ["defensive", [["totalTackles", "TCK"], ["sacks", "SACK"], ["fumblesForced", "FF"], ["passesDefended", "PD"]]],
  LB: ["defensive"],
  DB: ["defensive", [["totalTackles", "TCK"], ["interceptions", "INT"], ["passesDefended", "PD"], ["fumblesForced", "FF"]]],
};
const statNumber = (v) => Number(String(v ?? "").replace(/,/g, ""));
// CMP% as a whole number, the way the career sheet shows it.
const pct = (v) => (v === "" || v == null ? "" : `${Math.round(statNumber(v))}%`);

// An athlete's ESPN stats → { years (newest last), cats: { [category]: { labels:
// { [name]: label }, seasons: { [year]: { team, stats: { [name]: "3,454" } } },
// total: { [name]: value } } }, teams: { [slug]: { logo, abbr } } }.
const statsCache = {};
export function espnStats(league, athleteId) {
  const key = `${league}/${athleteId}`;
  if (!statsCache[key]) {
    statsCache[key] = fetch(`${ESPN}/common/v3/sports/football/${league}/athletes/${athleteId}/stats`).then((r) => r.json()).then((j) => {
      const cats = {};
      const years = new Set();
      (j.categories || []).forEach((c) => {
        const names = c.names || [];
        const pick = (arr) => Object.fromEntries(names.map((n, i) => [n, arr?.[i] ?? ""]));
        const seasons = {};
        (c.statistics || []).forEach((s) => {
          const y = String(s.season?.year || "");
          if (!y) return;
          years.add(y);
          seasons[y] = { team: s.teamSlug || "", stats: pick(s.stats) };
        });
        cats[c.name] = { labels: Object.fromEntries(names.map((n, i) => [n, c.labels?.[i] || n])), seasons, total: pick(c.totals) };
      });
      const teams = Object.fromEntries(Object.entries(j.teams || {}).map(([slug, t]) => [slug, { logo: t.logos?.[0]?.href || "", abbr: t.abbreviation || "" }]));
      return { years: [...years].sort(), cats, teams };
    });
    statsCache[key].catch(() => { delete statsCache[key]; });
  }
  return statsCache[key];
}

// A season's stats → [{ key, label, value, rank? }]: the named ones in
// STAT_NAMES order, then the rest; zeros (and games played) last.
// ranks: CFBD's seasonRanks for that season ({ [category]: { [stat]: "12" | "T-12" } }).
function statOptions(espn, year, ranks = null) {
  const order = Object.keys(STAT_NAMES);
  const rank = (o) => (order.includes(o.key) ? order.indexOf(o.key) : order.length);
  const all = Object.entries(espn?.cats || {}).filter(([cat]) => cat !== "scoring").flatMap(([cat, c]) => {
    const line = c.seasons[year]?.stats;
    if (!line) return [];
    return Object.entries(line).filter(([name]) => name !== "gamesPlayed").map(([name, v]) => {
      const key = `${cat}.${name}`;
      const [rc, rs] = (RANK_KEY[key] || "").split(".");
      const r = ranks?.[rc]?.[rs] || "";
      return {
        key, label: STAT_NAMES[key] || `${CAT_SHORT[cat] || cat} ${c.labels[name] || name}`,
        value: name === "completionPct" ? `${v}%` : String(v), zero: !statNumber(v), ...(r ? { rank: r } : {}),
      };
    });
  });
  return all.sort((a, b) => a.zero - b.zero || rank(a) - rank(b) || a.key.localeCompare(b.key)).map(({ zero, ...o }) => o);
}
// His position's four, then the first others he has, up to STATS.
function defaultStats(options, pos) {
  const picks = (POS_STATS[posGroup(pos)] || []).map((k) => options.find((o) => o.key === k)).filter(Boolean);
  options.forEach((o) => { if (picks.length < STATS && !picks.includes(o)) picks.push(o); });
  return picks.slice(0, STATS).map((o) => ({ ...o }));
}
// The groups a career table can show (those he has rows in), his position's first.
export function careerGroups(espn, pos) {
  const own = CAREER_BY_POS[posGroup(pos)]?.[0];
  const have = Object.keys(espn?.cats || {}).filter((c) => c !== "scoring" && Object.keys(espn.cats[c].seasons).length);
  return [...new Set([own, ...have].filter((c) => c && have.includes(c)))];
}
function careerColumns(espn, cat, pos) {
  const mine = CAREER_BY_POS[posGroup(pos)];
  if (mine && mine[0] === cat && mine[1]) return mine[1];
  if (CAREER_COLS[cat]) return CAREER_COLS[cat];
  const labels = espn?.cats?.[cat]?.labels || {};
  return Object.keys(labels).filter((n) => n !== "gamesPlayed").slice(0, 4).map((n) => [n, labels[n]]);
}
// The career table: { title, cols, rows: [{ year, logo, vals }], total }.
export function careerTable(espn, cat, pos) {
  const c = espn?.cats?.[cat];
  if (!c) return null;
  const cols = careerColumns(espn, cat, pos);
  const show = (line) => cols.map(([n]) => (n === "completionPct" ? pct(line?.[n]) : String(line?.[n] ?? "")));
  const rows = Object.keys(c.seasons).sort().slice(-CAREER_ROWS).map((y) => ({ year: y, logo: espn.teams[c.seasons[y].team]?.logo || "", vals: show(c.seasons[y].stats) }));
  return { title: (CAT_TITLE[cat] || cat).toUpperCase(), cols: cols.map(([, h]) => h), rows, total: show(c.total) };
}

// A prospect's ESPN athlete id: the one his headshot came from, else his
// name on his school's ESPN roster (the school's CFBD id is its ESPN id).
const nameKey = (n) => String(n || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");
export async function espnIdFor(p, teamId, photo) {
  if (photo?.headshot?.espnId) return { id: String(photo.headshot.espnId), headshot: "" };
  if (!teamId) return null;
  const r = await fetch(`${ESPN}/site/v2/sports/football/college-football/teams/${teamId}/roster`).then((x) => x.json()).catch(() => ({}));
  const all = (r.athletes || []).flatMap((g) => g.items || []);
  const full = nameKey(`${p.First} ${p.Last}`);
  const last = nameKey(p.Last);
  const hit = all.find((a) => nameKey(a.fullName) === full)
    || all.filter((a) => nameKey(a.lastName) === last).find((a, _, list) => list.length === 1 || posGroup(a.position?.abbreviation) === posGroup(p.Position));
  return hit ? { id: String(hit.id), headshot: hit.headshot?.href || "" } : null;
}

// ── Drawing ──
// The layout a template keeps; 1 = the default size.
const BASE = {
  footer: "SUBSCRIBE FOR MORE", statsTitle: "{season} STATS", style: "light", side: "right", vertical: "bottom",
  showHeadshot: true, showLogo: true, showStats: true, showSub: true,
  // Sizes, 1 = the default: the whole card, the stats or list, and each
  // line of text on its own (set beside its field).
  scale: 1, statSize: 1, line1Size: 1, line2Size: 1, subSize: 1, ribbonSize: 1, footerSize: 1,
  // A list's rows numbered (class, list), with each player's position by his school.
  numbered: true, showPos: true,
  // Each element moved from where the layout puts it: { [element]: [x, y] }
  // in card pixels (OFFSET_ELEMENTS).
  offsets: {},
};
const OFFSET_ELEMENTS = { line1: "Line 1", line2: "Line 2", sub: "Sub line", picture: "Picture", ribbon: "Ribbon / stats title", body: "Stats / table / list", footer: "Footer" };
const OFFSET_STEP = 5;
// The biggest an ad's team name gets (at 100%).
const AD_NAME_MAX = 120;
const LAYOUT_KEYS = Object.keys(BASE);
const KINDS = { season: "Player · current season", career: "Player · career", class: "Class list", list: "Custom list", ad: "Homage ad" };
const isList = (kind) => kind === "class" || kind === "list";
// The templates a new setup starts with (the old single default becomes the first).
const STARTERS = (old = {}) => [
  { id: "season", name: "Player / Current Season", kind: "season", settings: { ...BASE, ...old } },
  { id: "career", name: "Player / Career", kind: "career", settings: { ...BASE, statsTitle: "CAREER STATS" } },
  { id: "class", name: "Class", kind: "class", settings: { ...BASE, statsTitle: "", showSub: true } },
  WATCHLIST,
  HOMAGE,
];
const WATCHLIST = { id: "watchlist", name: "Watchlist", kind: "list", settings: { ...BASE, statsTitle: "", numbered: false } };
const HOMAGE = { id: "homage", name: "Homage Ad", kind: "ad", settings: { ...BASE, statsTitle: "", footer: "LINK IN DESCRIPTION" } };
// An ad's key in the team picker: an NFL abbr, or "cfb:{School}".
const adKey = (ad) => (ad.School ? `cfb:${ad.School}` : ad.Team);
// The card for a team's ad: its name, colors and logo, the product in slot
// `slot` (0–2). brand: { Color1, Color2, Logo1, LogoDark }.
const adCard = (ad, brand = {}, slot = 0) => ({
  // The nickname alone ("COLTS"); a school's name.
  line1: ad.School || teamNameFromAbbr(ad.Team).split(" ").pop(), line2: "THROWBACK GEAR", sub: "FROM HOMAGE",
  c1: brand.Color1 || BLUE, c2: brand.Color2 || GOLD, logo: brand.Logo1 || brand.LogoDark || "",
  product: (ad.Images || [ad.Image1, ad.Image2, ad.Image3]).filter(Boolean)[slot] || ad.Image1 || "", adSlot: slot,
});
// The sliders: [key, label, max]. The card's max keeps it inside the frame.
const SIZES = [["scale", "Card", 1.45], ["statSize", "Stats / list", 1.4]];
// Each line's own size (beside its field): 50%–250%, 10% a step.
const TEXT_SIZES = ["line1Size", "line2Size", "subSize", "ribbonSize", "footerSize"];
const SIZE_MIN = 0.5;
const SIZE_MAX = 2.5;
// A template saved with one Name size has it on both title lines.
const migrateSizes = (settings = {}) => (settings.nameSize && settings.line1Size == null
  ? { ...settings, line1Size: settings.nameSize, line2Size: settings.nameSize }
  : settings);

const field = { padding: "6px 9px", border: "1px solid #d5dce6", borderRadius: "6px", fontSize: "13px", fontWeight: 700, width: "100%", boxSizing: "border-box" };
const label = { fontSize: "10px", fontWeight: 900, color: "#7a8597", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "3px" };
const btn = (primary) => ({
  border: primary ? "none" : "1px solid #d5dce6", borderRadius: "999px", padding: "7px 16px", fontWeight: 900, fontSize: "12px",
  background: primary ? BLUE : "#fff", color: primary ? "#fff" : "#33415a", cursor: "pointer",
});
const linkBtn = { border: "none", background: "none", color: BLUE, fontWeight: 900, fontSize: "11px", cursor: "pointer", padding: "0 4px" };

// An image the canvas can draw (and still export): CORS-enabled, imgur's
// links pointed straight at its CDN. null when it won't load.
const imageCache = {};
function loadImage(url) {
  const src = sanitizeImgur(url || "") || url;
  if (!src) return Promise.resolve(null);
  if (!imageCache[src]) {
    imageCache[src] = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  return imageCache[src];
}

// Is Eras Bold ITC on this computer? (A missing font measures like its fallback.)
function hasEras() {
  const c = document.createElement("canvas").getContext("2d");
  const t = "SUBSCRIBE FOR MORE 0123";
  c.font = "bold 40px monospace";
  const mono = c.measureText(t).width;
  c.font = 'bold 40px "Eras ITC", monospace';
  return Math.abs(c.measureText(t).width - mono) > 0.5;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Text at the biggest size from max down to min that fits maxW, at x (its
// center, or its left edge with align "left").
function fitText(ctx, text, x, y, maxW, max, min = 12, align = "center") {
  let size = max;
  ctx.font = font(size);
  while (size > min && ctx.measureText(text).width > maxW) {
    size -= 1;
    ctx.font = font(size);
  }
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  ctx.textAlign = "center";
  return size;
}

// An image scaled to fit the box, centered across and sitting on its bottom.
function drawContain(ctx, img, x, y, w, h, alpha = 1, middle = false) {
  const s = Math.min(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x + (w - dw) / 2, middle ? y + (h - dh) / 2 : y + h - dh, dw, dh);
  ctx.restore();
}

// A stat's lines under its label: his rank (when shown) and the note.
const rankText = (rank) => (rank ? `${rank.startsWith("T-") ? "T-" : ""}#${rank.replace(/^T-/, "")} IN FBS` : "");
const statExtras = (st) => [st.showRank && rankText(st.rank), st.note].filter(Boolean);

// A color with an alpha, for the tiles and rows.
const tint = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return `rgba(0,0,0,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

// The ribbon over a stats section: the title on the second color.
function ribbon(ctx, card, left, top, width, h, size) {
  roundRect(ctx, left, top, width, h, h / 2);
  ctx.fillStyle = card.c2;
  ctx.fill();
  ctx.fillStyle = card.c1;
  fitText(ctx, card.statsTitle.toUpperCase(), left + width / 2, top + h / 2 + size * 0.37, width - 30, size, 9);
}

// The whole frame: transparent, the card at its edge. kind: the template's.
async function drawFrame(canvas, card, kind) {
  const ctx = canvas.getContext("2d");
  // A local font isn't ready for a canvas until something asks for it.
  await document.fonts?.load(font(40)).catch(() => {});
  ctx.clearRect(0, 0, W, H);
  const table = kind === "career" && card.showStats ? card.career : null;
  const list = isList(kind) ? card.classList || [] : [];
  const ad = kind === "ad";
  const [logo, shot, tableLogos, listImgs, homage] = await Promise.all([
    card.showLogo && !isList(kind) ? loadImage(card.logo) : null,
    // An ad's picture is its product.
    ad ? loadImage(card.product) : card.showHeadshot && !isList(kind) ? loadImage(card.headshot) : null,
    Promise.all((table?.rows || []).map((r) => loadImage(r.logo))),
    Promise.all(list.map((r) => Promise.all([card.showLogo ? loadImage(r.logo) : null, card.showHeadshot ? loadImage(r.headshot) : null]))),
    ad ? loadImage(HomageLogo) : null,
  ]);

  // The card is drawn in its own units (CARD_W × CARD_H), scaled up into place.
  const k = Math.min(card.scale || 1, (H - 2 * EDGE) / CARD_H);
  const ox = card.side === "left" ? EDGE : W - EDGE - CARD_W * k;
  const oy = card.vertical === "top" ? EDGE : card.vertical === "center" ? (H - CARD_H * k) / 2 : H - EDGE - CARD_H * k;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(k, k);
  const x = 0;
  const y = 0;
  const l1 = card.line1Size || 1;
  const l2 = card.line2Size || 1;
  const ss = card.subSize || 1;
  const rb = card.ribbonSize || 1;
  const st1 = card.statSize || 1;
  const fs = card.footerSize || 1;
  const dark = card.style === "dark";
  const fill = dark ? card.c1 : "#ffffff";
  const ink = dark ? "#ffffff" : card.c1;
  const soft = dark ? "rgba(255,255,255,0.75)" : "#4a4a4a";
  const tileFill = dark ? "rgba(255,255,255,0.12)" : tint(card.c1, 0.08);
  const cx = x + CARD_W / 2;
  const inner = CARD_W - 50;
  const left = x + 28;
  const width = CARD_W - 56;

  // The card: fill, then its border in the second color.
  roundRect(ctx, x + 5, y + 5, CARD_W - 10, CARD_H - 10, 46);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = card.c2;
  ctx.stroke();
  ctx.save();
  roundRect(ctx, x + 10, y + 10, CARD_W - 20, CARD_H - 20, 41);
  ctx.clip();

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = ink;
  // An element moved by its offset: shift before it, ctx.restore() after.
  const shift = (el) => {
    const [dx, dy] = card.offsets?.[el] || [0, 0];
    ctx.save();
    ctx.translate(dx || 0, dy || 0);
  };
  // The names and sub line from the top, each line's room growing with its size.
  let cy = y + 44;
  if (card.line1 && kind === "ad") {
    // An ad's team name fills the card's width at the top (as big as fits,
    // up to AD_NAME_MAX; its size control scales that cap).
    const text = card.line1.toUpperCase();
    ctx.font = font(100);
    const size = Math.min(AD_NAME_MAX * l1, (100 * inner) / Math.max(1, ctx.measureText(text).width));
    cy = y + 30 + size * 0.86;
    shift("line1");
    fitText(ctx, text, cx, cy, inner, size, 12);
    ctx.restore();
  } else if (card.line1) { cy += 44 * l1; shift("line1"); fitText(ctx, card.line1.toUpperCase(), cx, cy, inner, 44 * l1); ctx.restore(); }
  if (card.line2) { cy += (card.line1 ? 0.94 : 1) * 62 * l2; shift("line2"); fitText(ctx, card.line2.toUpperCase(), cx, cy, inner, 62 * l2); ctx.restore(); }
  if (card.showSub && card.sub) {
    cy += 16 + 24 * ss;
    ctx.fillStyle = soft;
    shift("sub");
    fitText(ctx, card.sub.toUpperCase(), cx, cy, inner, 24 * ss);
    ctx.restore();
    ctx.fillStyle = ink;
  }
  const bodyTop = Math.max(y + (isList(kind) ? 150 : 205), cy + 19);
  const footerBase = y + CARD_H - 34;
  const footerTop = card.footer ? footerBase - 34 * fs - 6 : y + CARD_H - 26;
  const GAP = 10;
  const RIBBON = card.statsTitle ? 32 * st1 * rb : 0;

  if (isList(kind)) {
    // The list fills the body: a row a player — his spot, school logo, name
    // and school, his headshot at the right.
    let top = bodyTop;
    if (RIBBON) { shift("ribbon"); ribbon(ctx, card, left, top, width, RIBBON, 19 * st1 * rb); ctx.restore(); top += RIBBON + GAP; }
    const n = list.length;
    const rowGap = 8;
    const rowH = n ? Math.min(78 * st1, (footerTop - 10 - top - rowGap * (n - 1)) / n) : 0;
    // A short list sits in the middle of the room it has.
    if (n) top += Math.max(0, (footerTop - 10 - top - (n * rowH + (n - 1) * rowGap)) / 2);
    shift("body");
    list.forEach((r, i) => {
      const ry = top + i * (rowH + rowGap);
      roundRect(ctx, left, ry, width, rowH, Math.min(16, rowH / 3));
      ctx.fillStyle = tileFill;
      ctx.fill();
      // The spot on a disc in the second color (a numbered list).
      let tx = left + 12;
      if (card.numbered) {
        const rad = rowH * 0.3;
        const dx = left + 10 + rad;
        ctx.beginPath();
        ctx.arc(dx, ry + rowH / 2, rad, 0, Math.PI * 2);
        ctx.fillStyle = card.c2;
        ctx.fill();
        ctx.fillStyle = card.c1;
        fitText(ctx, String(i + 1), dx, ry + rowH / 2 + rad * 0.45, rad * 1.6, rad * 1.25, 8);
        tx = dx + rad + 10;
      }
      const [lg, hs] = listImgs[i] || [];
      if (lg) { drawContain(ctx, lg, tx, ry + rowH * 0.15, rowH * 0.7, rowH * 0.7, 1, true); tx += rowH * 0.7 + 10; }
      const hsW = hs ? rowH * 1.25 : 0;
      if (hs) {
        ctx.save();
        roundRect(ctx, left, ry, width, rowH, Math.min(16, rowH / 3));
        ctx.clip();
        drawContain(ctx, hs, left + width - hsW - 4, ry + 3, hsW, rowH - 3);
        ctx.restore();
      }
      const maxW = left + width - hsW - 8 - tx;
      ctx.fillStyle = ink;
      fitText(ctx, String(r.name || "").toUpperCase(), tx, ry + rowH * 0.52, maxW, rowH * 0.34, 9, "left");
      ctx.fillStyle = soft;
      // His position by his school (a list's own setting).
      const line = [card.showPos && r.pos, r.school].filter(Boolean).join(" · ");
      fitText(ctx, line.toUpperCase(), tx, ry + rowH * 0.8, maxW, rowH * 0.2, 7, "left");
    });
    ctx.restore();
  } else if (ad) {
    // The product fills the body over the team's logo, faded; the Homage
    // logo on a white pill under it.
    const pillH = 58 * st1;
    const pillTop = footerTop - 10 - pillH;
    const picH = Math.max(110, pillTop - 12 - bodyTop);
    shift("picture");
    if (logo) drawContain(ctx, logo, x + 50, bodyTop + 10, CARD_W - 100, picH - 20, shot ? 0.14 : 1, true);
    if (shot) drawContain(ctx, shot, x + 24, bodyTop, CARD_W - 48, picH, 1, true);
    ctx.restore();
    if (homage) {
      shift("body");
      const pillW = Math.min(width, pillH * (homage.width / homage.height) * 0.62 + 40);
      roundRect(ctx, cx - pillW / 2, pillTop, pillW, pillH, pillH / 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      drawContain(ctx, homage, cx - pillW / 2 + 20, pillTop + pillH * 0.19, pillW - 40, pillH * 0.62, 1, true);
      ctx.restore();
    }
  } else {
    // Laid out from the bottom up: the footer, the stats above it, and the
    // picture takes what's left under the names.
    const stats = kind === "season" && card.showStats ? card.stats.filter((s) => s.label || s.value).slice(0, STATS) : [];
    let statsH = 0;
    let perRow = 1;
    let TILE_H = 0;
    let rows = 0;
    const ROW = 30 * st1;
    const SUBHEAD = 24 * st1;
    if (stats.length) {
      // Stat tiles: one row of up to three, or two rows of two; every tile as
      // tall as the one with the most lines under its label.
      perRow = stats.length === 4 ? 2 : Math.max(1, stats.length);
      rows = Math.ceil(stats.length / perRow);
      const extra = Math.max(0, ...stats.map((st) => statExtras(st).length));
      TILE_H = (74 + extra * 17) * st1;
      statsH = RIBBON + (RIBBON ? GAP : 0) + rows * TILE_H + (rows - 1) * GAP;
    } else if (table?.rows?.length) {
      statsH = RIBBON + (RIBBON ? GAP : 0) + ROW + SUBHEAD + (table.rows.length + 1) * ROW;
    }
    const statsTop = footerTop - statsH - (statsH ? 10 : 0);
    const picH = Math.max(110, statsTop - 10 - bodyTop);

    // The picture: the logo faded behind the headshot (or the logo alone).
    shift("picture");
    if (logo) drawContain(ctx, logo, x + 40, bodyTop + 10, CARD_W - 80, picH - 20, shot ? 0.18 : 1);
    if (shot) drawContain(ctx, shot, x + 20, bodyTop, CARD_W - 40, picH);
    ctx.restore();

    let sy = statsTop;
    if (statsH && RIBBON) { shift("ribbon"); ribbon(ctx, card, left, sy, width, RIBBON, 19 * st1 * rb); ctx.restore(); sy += RIBBON + GAP; }
    shift("body");
    if (stats.length) {
      // Each stat on a tile tinted in the main color: the number, its label under it.
      const tileW = (width - (perRow - 1) * GAP) / perRow;
      stats.forEach((st, i) => {
        const col = i % perRow;
        const row = Math.floor(i / perRow);
        // A short last row is centered.
        const inRow = Math.min(perRow, stats.length - row * perRow);
        const rowLeft = left + (width - (inRow * tileW + (inRow - 1) * GAP)) / 2;
        const tx = rowLeft + col * (tileW + GAP);
        const ty = sy + row * (TILE_H + GAP);
        roundRect(ctx, tx, ty, tileW, TILE_H, 14);
        ctx.fillStyle = tileFill;
        ctx.fill();
        const mid = tx + tileW / 2;
        ctx.fillStyle = ink;
        fitText(ctx, String(st.value || "").toUpperCase(), mid, ty + 42 * st1, tileW - 14, 38 * st1, 16);
        ctx.fillStyle = soft;
        fitText(ctx, String(st.label || "").toUpperCase(), mid, ty + 63 * st1, tileW - 12, 14 * st1, 9);
        // His rank, then the note: smaller, under the label.
        statExtras(st).forEach((line, n) => {
          ctx.fillStyle = n === 0 && st.showRank && st.rank ? ink : soft;
          fitText(ctx, String(line).toUpperCase(), mid, ty + (63 + 17 * (n + 1)) * st1, tileW - 12, 12 * st1, 7);
        });
      });
    } else if (table?.rows?.length) {
      // The career table: INFO + the group over SZN / TM and the columns, a
      // row a season, then the career totals.
      const szW = 62 * Math.min(st1, 1.2);
      const tmW = 46 * Math.min(st1, 1.2);
      const colW = (width - szW - tmW) / table.cols.length;
      const tableH = ROW + SUBHEAD + (table.rows.length + 1) * ROW;
      ctx.save();
      roundRect(ctx, left, sy, width, tableH, 12);
      ctx.clip();
      ctx.fillStyle = tileFill;
      ctx.fillRect(left, sy, width, tableH);
      // The group header in the main color (the second on a dark card).
      ctx.fillStyle = dark ? card.c2 : card.c1;
      ctx.fillRect(left, sy, width, ROW);
      ctx.fillStyle = dark ? card.c1 : "#ffffff";
      fitText(ctx, "INFO", left + (szW + tmW) / 2, sy + ROW * 0.72, szW + tmW - 8, 18 * st1, 9);
      fitText(ctx, table.title, left + szW + tmW + (width - szW - tmW) / 2, sy + ROW * 0.72, width - szW - tmW - 8, 18 * st1, 9);
      let ry = sy + ROW;
      // The columns' headers.
      ctx.fillStyle = dark ? "rgba(255,255,255,0.18)" : tint(card.c1, 0.16);
      ctx.fillRect(left, ry, width, SUBHEAD);
      ctx.fillStyle = ink;
      const colX = (i) => left + szW + tmW + colW * i + colW / 2;
      fitText(ctx, "SZN", left + szW / 2, ry + SUBHEAD * 0.7, szW - 6, 13 * st1, 7);
      fitText(ctx, "TM", left + szW + tmW / 2, ry + SUBHEAD * 0.7, tmW - 6, 13 * st1, 7);
      table.cols.forEach((h, i) => fitText(ctx, h, colX(i), ry + SUBHEAD * 0.7, colW - 6, 13 * st1, 7));
      ry += SUBHEAD;
      table.rows.forEach((r, i) => {
        if (i % 2) { ctx.fillStyle = dark ? "rgba(255,255,255,0.06)" : tint(card.c1, 0.05); ctx.fillRect(left, ry, width, ROW); }
        ctx.fillStyle = ink;
        fitText(ctx, r.year, left + szW / 2, ry + ROW * 0.68, szW - 6, 16 * st1, 8);
        if (tableLogos[i]) drawContain(ctx, tableLogos[i], left + szW + 6, ry + 3, tmW - 12, ROW - 6, 1, true);
        r.vals.forEach((v, j) => fitText(ctx, v, colX(j), ry + ROW * 0.68, colW - 6, 16 * st1, 8));
        ry += ROW;
      });
      // The career row, on a stronger tint.
      ctx.fillStyle = dark ? "rgba(255,255,255,0.18)" : tint(card.c1, 0.16);
      ctx.fillRect(left, ry, width, ROW);
      ctx.fillStyle = ink;
      fitText(ctx, "CAREER", left + (szW + tmW) / 2, ry + ROW * 0.68, szW + tmW - 8, 16 * st1, 8);
      table.total.forEach((v, j) => fitText(ctx, v, colX(j), ry + ROW * 0.68, colW - 6, 16 * st1, 8));
      // Column rules: INFO's edge from the top, the rest under the group header.
      ctx.strokeStyle = dark ? "rgba(255,255,255,0.2)" : tint(card.c1, 0.22);
      ctx.lineWidth = 1;
      [[szW, ROW], [szW + tmW, 0], ...table.cols.slice(1).map((_, i) => [szW + tmW + colW * (i + 1), ROW])].forEach(([dx, from]) => {
        ctx.beginPath();
        ctx.moveTo(left + dx, sy + from);
        ctx.lineTo(left + dx, sy + tableH);
        ctx.stroke();
      });
      ctx.restore();
    }
    ctx.restore();
  }

  if (card.footer) {
    ctx.fillStyle = ink;
    shift("footer");
    fitText(ctx, card.footer.toUpperCase(), cx, footerBase, inner, 34 * fs);
    ctx.restore();
  }
  ctx.restore();
  ctx.restore();
}

// ── The page ──
export default function AdminSideGraphics() {
  const [presets, setPresets] = useState(null);
  const [presetId, setPresetId] = useState("season");
  const [card, setCard] = useState({
    ...BASE, line1: "FIRST", line2: "LAST NAME", sub: "POS · TEAM", c1: BLUE, c2: GOLD, logo: "", headshot: "",
    stats: [], statOptions: [], season: "", espn: null, pos: "", careerCat: "", career: null, classList: [],
  });
  const [league, setLeague] = useState("college");
  const [players, setPlayers] = useState(null);
  const [search, setSearch] = useState("");
  const [nflTeam, setNflTeam] = useState("NYJ");
  const [roster, setRoster] = useState([]);
  const [branding, setBranding] = useState({});
  const [msg, setMsg] = useState("");
  const [eras, setEras] = useState(true);
  // The picked stats open for editing ({ [key]: true }).
  const [editing, setEditing] = useState({});
  // The class list's setup.
  const [classYear, setClassYear] = useState("2028");
  const [classPos, setClassPos] = useState("RB");
  const [classCount, setClassCount] = useState(5);
  const [classSearch, setClassSearch] = useState("");
  const [dragFrom, setDragFrom] = useState(null);
  // Homage ads: every team's (NFL, then schools), the one picked, and a batch's progress.
  const [ads, setAds] = useState(null);
  const [adTeam, setAdTeam] = useState("");
  const [batch, setBatch] = useState("");
  // The elements whose X / Y are open beside their fields ({ [element]: true }).
  const [moving, setMoving] = useState({});
  const canvasRef = useRef(null);

  const preset = (presets || []).find((p) => p.id === presetId) || null;
  const kind = preset?.kind || "season";

  useEffect(() => {
    getDoc(SETTINGS_DOC).then((s) => {
      const d = s.exists() ? s.data() : {};
      const saved = (d.presets?.length ? d.presets : STARTERS(d.defaults || {})).map((p) => ({ ...p, settings: migrateSizes(p.settings) }));
      // Templates added since the set was saved join it.
      const list = [...saved, ...[WATCHLIST, HOMAGE].filter((t) => !saved.some((p) => p.kind === t.kind))];
      setPresets(list);
      setPresetId(list[0].id);
      setCard((c) => ({ ...c, ...list[0].settings }));
    }).catch(() => setPresets(STARTERS()));
    fetchNflBranding().then(setBranding).catch(() => {});
    document.fonts?.load(font(40)).then(() => setEras(hasEras())).catch(() => setEras(hasEras()));
  }, []);

  // The prospects (the college search and the class list's adds).
  useEffect(() => {
    if (players) return;
    getDocs(collection(db, "players")).then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.First && p.Last).sort((a, b) => a.Last.localeCompare(b.Last) || a.First.localeCompare(b.First))))
      .catch((e) => setMsg(`Couldn't load players: ${e.message}`));
  }, [players]);
  // The ads, once an ad template is picked.
  useEffect(() => {
    if (kind !== "ad" || ads) return;
    Promise.all([fetchAds(), fetchCfbAds()]).then(([nfl, cfb]) => setAds([
      ...nfl.filter((a) => a.Team).sort((a, b) => teamNameFromAbbr(a.Team).localeCompare(teamNameFromAbbr(b.Team))),
      ...cfb.filter((a) => a.School).sort((a, b) => a.School.localeCompare(b.School)),
    ])).catch((e) => setMsg(`Couldn't load the ads: ${e.message}`));
  }, [kind, ads]);

  useEffect(() => {
    if (league !== "nfl") return;
    setRoster([]);
    fetchEspnRoster(nflTeam).then(setRoster).catch((e) => setMsg(`Couldn't load the roster: ${e.message}`));
  }, [league, nflTeam]);

  // Redraw on every change.
  useEffect(() => {
    let live = true;
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    drawFrame(off, card, kind).then(() => {
      if (!live || !canvasRef.current) return;
      const ctx = canvasRef.current.getContext("2d");
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(off, 0, 0);
    });
    return () => { live = false; };
  }, [card, kind]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !players) return [];
    return players.filter((p) => `${p.First} ${p.Last}`.toLowerCase().includes(q)).slice(0, 12);
  }, [players, search]);
  const classMatches = useMemo(() => {
    const q = classSearch.trim().toLowerCase();
    if (!q || !players) return [];
    return players.filter((p) => `${p.First} ${p.Last}`.toLowerCase().includes(q)).slice(0, 10);
  }, [players, classSearch]);

  const set = (key, v) => setCard((c) => ({ ...c, [key]: v }));
  const setStat = (key, f, v) => setCard((c) => ({ ...c, stats: c.stats.map((s) => (s.key === key ? { ...s, [f]: v } : s)) }));
  // Pick or drop a stat from the season line (up to STATS, in the order picked).
  const toggleStat = (o) => setCard((c) => (c.stats.some((s) => s.key === o.key)
    ? { ...c, stats: c.stats.filter((s) => s.key !== o.key) }
    : c.stats.length < STATS ? { ...c, stats: [...c.stats, { ...o }] } : c));
  const dropStat = (key) => setCard((c) => ({ ...c, stats: c.stats.filter((s) => s.key !== key) }));
  const addCustom = () => {
    const key = `custom-${Date.now()}`;
    setCard((c) => (c.stats.length < STATS ? { ...c, stats: [...c.stats, { key, label: "", value: "", custom: true }] } : c));
    setEditing((e) => ({ ...e, [key]: true }));
  };

  // A template: its kind and layout; the player or list on the card stays.
  const applyPreset = (id, list = presets) => {
    const p = list.find((x) => x.id === id);
    if (!p) return;
    setPresetId(id);
    setCard((c) => ({
      ...c, ...BASE, ...p.settings, statsTitle: (p.settings.statsTitle || "").replace("{season}", c.season || ""),
      // Into a custom list from anything else: a fresh one to title and fill.
      ...(p.kind === "list" && kind !== "list" ? { line1: "2029", line2: "WATCHLIST", sub: "", c1: BLUE, c2: GOLD, classList: [] } : {}),
    }));
  };
  const layoutNow = () => {
    const d = Object.fromEntries(LAYOUT_KEYS.map((key) => [key, card[key]]));
    // The stats title keeps its {season} placeholder when it's the season's.
    if (card.season && typeof d.statsTitle === "string") d.statsTitle = d.statsTitle.replace(card.season, "{season}");
    return d;
  };
  const savePresets = async (list, note) => {
    await setDoc(SETTINGS_DOC, { presets: list, updatedAt: serverTimestamp() }, { merge: true });
    setPresets(list);
    setMsg(note);
  };
  const savePreset = () => savePresets(presets.map((p) => (p.id === presetId ? { ...p, settings: layoutNow() } : p)), `Saved "${preset.name}".`);
  const saveAsNew = () => {
    const name = window.prompt(`Name the new template (${KINDS[kind]}):`, `${preset?.name || "Template"} copy`);
    if (!name?.trim()) return;
    const id = `t${Date.now()}`;
    savePresets([...presets, { id, name: name.trim(), kind, settings: layoutNow() }], `Saved "${name.trim()}".`).then(() => setPresetId(id));
  };
  const renamePreset = () => {
    const name = window.prompt("Rename the template:", preset?.name || "");
    if (!name?.trim()) return;
    savePresets(presets.map((p) => (p.id === presetId ? { ...p, name: name.trim() } : p)), `Renamed to "${name.trim()}".`);
  };
  const deletePreset = () => {
    if (presets.length < 2 || !window.confirm(`Delete the template "${preset.name}"?`)) return;
    const list = presets.filter((p) => p.id !== presetId);
    savePresets(list, `Deleted "${preset.name}".`).then(() => applyPreset(list[0].id, list));
  };

  // A player's ESPN stats onto the card: the season's options and picks, and
  // the career table in his position's group.
  const withStats = (espn, pos, ranks, rankYear) => {
    const year = espn?.years?.[espn.years.length - 1] || "";
    const options = espn ? statOptions(espn, year, year === rankYear ? ranks : null) : [];
    const groups = careerGroups(espn, pos);
    return {
      espn, pos, season: year, statOptions: options, stats: defaultStats(options, pos),
      careerCat: groups[0] || "", career: groups[0] ? careerTable(espn, groups[0], pos) : null,
      statsTitle: (preset?.settings.statsTitle || BASE.statsTitle).replace("{season}", year),
    };
  };

  // A prospect: his school's colors and logo, his headshot, his ESPN stats.
  const pickCollege = async (p) => {
    setSearch("");
    setMsg("Loading…");
    try {
      const [schoolSnap, photoSnap, cfbd] = await Promise.all([
        getDocs(query(collection(db, "schools"), where("School", "==", p.School || ""), limit(1))),
        getDoc(doc(db, "playerPhotos", p.id)),
        getDocs(query(collection(db, "cfbdPlayers"), where("wedraftPlayerId", "==", p.id), limit(1))),
      ]);
      const s = schoolSnap.docs[0]?.data() || {};
      const photo = photoSnap.exists() ? photoSnap.data() : null;
      const ath = await espnIdFor(p, s.CFBDTeamId, photo);
      const espn = ath ? await espnStats("college-football", ath.id).catch(() => null) : null;
      const ranks = cfbd.docs[0]?.data().seasonRanks || {};
      const rankYear = Object.keys(ranks).sort().pop() || "";
      setCard((c) => ({
        ...c, ...BASE, ...(preset?.settings || {}),
        line1: p.First, line2: p.Last, sub: [p.Position, p.School].filter(Boolean).join(" · "),
        c1: s.Color1 || BLUE, c2: s.Color2 || GOLD, logo: s.Logo1 || s.LogoDark || "", headshot: photo?.headshot?.url || ath?.headshot || "",
        ...withStats(espn, p.Position, ranks[rankYear], rankYear),
      }));
      setEditing({});
      setMsg(!ath ? "Couldn't find him on his school's ESPN roster — add custom stats." : espn?.years?.length ? "" : "ESPN has no stats for him yet — add custom stats.");
    } catch (e) {
      setMsg(`Couldn't load him: ${e.message}`);
    }
  };

  // An NFL player: his team's branding, his ESPN headshot and stats.
  const pickNfl = async (a) => {
    const b = branding[nflTeam] || {};
    setMsg("Loading…");
    const espn = await espnStats("nfl", a.id).catch(() => null);
    setCard((c) => ({
      ...c, ...BASE, ...(preset?.settings || {}),
      line1: a.firstName, line2: a.lastName, sub: [a.position, teamNameFromAbbr(nflTeam)].filter(Boolean).join(" · "),
      c1: b.Color1 || BLUE, c2: b.Color2 || GOLD, logo: b.Logo1 || b.LogoDark || "", headshot: a.headshot || "",
      ...withStats(espn, a.position, null, ""),
    }));
    setEditing({});
    setMsg(espn?.years?.length ? "" : "ESPN has no stats for him yet — add custom stats.");
  };

  const setCareerCat = (cat) => setCard((c) => ({ ...c, careerCat: cat, career: careerTable(c.espn, cat, c.pos) }));

  // The class board's top classCount at classPos, by board rank, with their headshots.
  const loadClass = async () => {
    setMsg("Loading…");
    try {
      const snap = await getSiteSnapshot(`class_${classYear}_${classPos}`);
      const rows = [...(snap?.rows || [])].sort((a, b) => (a.cr ?? Infinity) - (b.cr ?? Infinity)).slice(0, classCount);
      const shots = await headshotsFor(rows.map((r) => r.i));
      const plural = ["OL", "DL"].includes(classPos) ? classPos : `${classPos}s`;
      setCard((c) => ({
        ...c, ...BASE, ...(preset?.settings || {}),
        line1: `TOP ${rows.length}`, line2: `${classYear} ${plural}`, sub: "WE-DRAFT BOARD", c1: BLUE, c2: GOLD,
        statsTitle: (preset?.settings.statsTitle || "").replace("{season}", ""),
        classList: rows.map((r) => ({ id: r.i, name: `${r.F} ${r.L}`, school: r.s || "", pos: classPos, logo: r.lg || r.ld || "", headshot: shots[r.i] || "" })),
      }));
      setMsg(rows.length ? "" : "No players on that class board.");
    } catch (e) {
      setMsg(`Couldn't load the class: ${e.message}`);
    }
  };
  const moveRow = (from, to) => setCard((c) => {
    if (to < 0 || to >= c.classList.length || from === to) return c;
    const next = [...c.classList];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return { ...c, classList: next };
  });
  const dropRow = (i) => setCard((c) => ({ ...c, classList: c.classList.filter((_, j) => j !== i) }));
  const addRow = async (p) => {
    setClassSearch("");
    const [schoolSnap, shots] = await Promise.all([
      getDocs(query(collection(db, "schools"), where("School", "==", p.School || ""), limit(1))).catch(() => null),
      headshotsFor([p.id]),
    ]);
    const s = schoolSnap?.docs[0]?.data() || {};
    setCard((c) => ({ ...c, classList: [...c.classList, { id: p.id, name: `${p.First} ${p.Last}`, school: p.School || "", pos: p.Position || "", logo: s.Logo1 || s.LogoDark || "", headshot: shots[p.id] || "" }] }));
  };

  // A team's ad onto the card (its brand: NFL branding, or the school's doc).
  const brandFor = async (a) => {
    if (!a.School) return branding[a.Team] || {};
    const snap = await getDocs(query(collection(db, "schools"), where("School", "==", a.School), limit(1))).catch(() => null);
    return snap?.docs[0]?.data() || {};
  };
  const pickAd = async (key, slot = 0) => {
    const a = (ads || []).find((x) => adKey(x) === key);
    setAdTeam(key);
    if (!a) return;
    const brand = await brandFor(a);
    setCard((c) => ({ ...c, ...BASE, ...(preset?.settings || {}), ...adCard(a, brand, slot) }));
  };
  // Every NFL team's (or every school's) ad in this layout, product slot
  // card.adSlot, one PNG each.
  const downloadAll = async (college) => {
    const teams = (ads || []).filter((a) => !!a.School === college);
    for (let i = 0; i < teams.length; i++) {
      const a = teams[i];
      const who = a.School || a.Team;
      setBatch(`${i + 1} / ${teams.length} — ${who}`);
      const out = document.createElement("canvas");
      out.width = W;
      out.height = H;
      await drawFrame(out, { ...card, ...adCard(a, await brandFor(a), card.adSlot || 0) }, "ad");
      const blob = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
      if (blob) {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `homage-${who.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-side.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 5000);
      }
      // A beat between files, so the browser takes each download.
      await new Promise((r) => setTimeout(r, 350));
    }
    setBatch("");
    setMsg(`Downloaded ${teams.length} Homage ads.`);
  };

  const download = async () => {
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    await drawFrame(out, card, kind);
    out.toBlob((blob) => {
      if (!blob) { setMsg("Couldn't export — an image may have blocked it."); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const base = [card.line1, card.line2].filter(Boolean).join("-").toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "side-graphic";
      a.download = `${base}-${kind}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  };

  // A field's label with its size beside it: − / + (10% a step), the % resets it.
  const sizeCtl = (key) => {
    const v = card[key] || 1;
    const step = (d) => set(key, Math.round(Math.min(SIZE_MAX, Math.max(SIZE_MIN, v + d)) * 100) / 100);
    const b = { border: "1px solid #d5dce6", background: "#fff", borderRadius: "5px", width: "20px", height: "18px", lineHeight: "14px", padding: 0, fontSize: "13px", fontWeight: 900, color: "#33415a", cursor: "pointer" };
    return (
      <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "3px" }}>
        <button onClick={() => step(-0.1)} disabled={v <= SIZE_MIN} style={b} aria-label="Smaller">−</button>
        <button onClick={() => set(key, 1)} title="Back to 100%" style={{ border: "none", background: "none", padding: 0, width: "36px", fontSize: "11px", fontWeight: 900, color: v === 1 ? "#8a97ab" : BLUE, cursor: "pointer" }}>{Math.round(v * 100)}%</button>
        <button onClick={() => step(0.1)} disabled={v >= SIZE_MAX} style={b} aria-label="Bigger">+</button>
      </span>
    );
  };
  // An element's X / Y: − / + (OFFSET_STEP px), or typed.
  const setOffset = (el, i, v) => setCard((c) => {
    const cur = c.offsets?.[el] || [0, 0];
    const next = i === 0 ? [v, cur[1]] : [cur[0], v];
    return { ...c, offsets: { ...(c.offsets || {}), [el]: next } };
  });
  const posCtl = (el) => {
    const cur = card.offsets?.[el] || [0, 0];
    const b = { border: "1px solid #d5dce6", background: "#fff", borderRadius: "5px", width: "20px", height: "20px", padding: 0, fontSize: "13px", fontWeight: 900, color: "#33415a", cursor: "pointer" };
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "10px", fontSize: "11px", fontWeight: 800, color: "#5b6b84" }}>
        {["X", "Y"].map((axis, i) => (
          <span key={axis} style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
            {axis}
            <button onClick={() => setOffset(el, i, (cur[i] || 0) - OFFSET_STEP)} style={b} aria-label={`${axis} −`}>−</button>
            <input type="number" value={cur[i] || 0} onChange={(e) => setOffset(el, i, Number(e.target.value) || 0)} style={{ ...field, width: "56px", padding: "2px 4px", fontSize: "12px" }} />
            <button onClick={() => setOffset(el, i, (cur[i] || 0) + OFFSET_STEP)} style={b} aria-label={`${axis} +`}>+</button>
          </span>
        ))}
        {(cur[0] || cur[1]) ? <button onClick={() => setCard((c) => ({ ...c, offsets: { ...(c.offsets || {}), [el]: [0, 0] } }))} style={{ ...linkBtn, fontSize: "10px" }}>RESET</button> : null}
      </span>
    );
  };
  const moved = (el) => !!(card.offsets?.[el]?.[0] || card.offsets?.[el]?.[1]);
  const fieldHead = (text, key, el) => (
    <>
      <div style={{ ...label, display: "flex", alignItems: "center", gap: "6px" }}>
        {text}
        {key && sizeCtl(key)}
        {el && (
          <button onClick={() => setMoving((m) => ({ ...m, [el]: !m[el] }))} title="Move it (X / Y)" style={{
            border: `1px solid ${moving[el] || moved(el) ? BLUE : "#d5dce6"}`, background: moved(el) ? "#e8f0fb" : "#fff", color: moving[el] || moved(el) ? BLUE : "#8a97ab",
            borderRadius: "5px", height: "18px", padding: "0 5px", fontSize: "11px", fontWeight: 900, cursor: "pointer",
          }}>↕↔</button>
        )}
      </div>
      {el && moving[el] && <div style={{ margin: "2px 0 5px" }}>{posCtl(el)}</div>}
    </>
  );

  const toggle = (key, text) => (
    <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 800, color: "#33415a", marginRight: "12px" }}>
      <input type="checkbox" checked={!!card[key]} onChange={(e) => set(key, e.target.checked)} /> {text}
    </label>
  );
  const choice = (key, opts) => (
    <div style={{ display: "flex", gap: "4px" }}>
      {opts.map(([v, t]) => <button key={v} onClick={() => set(key, v)} style={{ ...btn(card[key] === v), padding: "5px 12px" }}>{t}</button>)}
    </div>
  );

  if (!presets) return <div style={{ fontSize: "13px", fontWeight: 700, color: "#8a97ab" }}>Loading…</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 390px) 1fr", gap: "18px", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {!eras && <div style={{ fontSize: "12px", fontWeight: 800, color: "#a52a1e" }}>Eras Bold ITC isn&apos;t installed on this computer — the card uses Arial Black instead.</div>}

        <div style={{ border: "1px solid #e3e8ef", borderRadius: "8px", padding: "8px 10px", background: "#f8fafc" }}>
          <div style={label}>Template</div>
          <select value={presetId} onChange={(e) => applyPreset(e.target.value)} style={field}>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.name} — {KINDS[p.kind]}</option>)}
          </select>
          <div style={{ display: "flex", gap: "2px", marginTop: "6px", flexWrap: "wrap" }}>
            <button onClick={savePreset} style={linkBtn} title="Save the layout (footer, stats title, style, side, sizes, what's shown) into this template">Save</button>
            <button onClick={saveAsNew} style={linkBtn}>Save as new…</button>
            <button onClick={renamePreset} style={linkBtn}>Rename</button>
            {presets.length > 1 && <button onClick={deletePreset} style={{ ...linkBtn, color: "#a52a1e" }}>Delete</button>}
          </div>
        </div>

        {kind === "ad" ? (
          <div>
            <div style={label}>Homage ad</div>
            <select value={adTeam} onChange={(e) => pickAd(e.target.value)} style={field}>
              <option value="">{ads ? "Pick a team…" : "Loading ads…"}</option>
              <optgroup label="NFL">
                {(ads || []).filter((a) => !a.School).map((a) => <option key={adKey(a)} value={adKey(a)}>{teamNameFromAbbr(a.Team)}</option>)}
              </optgroup>
              {(ads || []).some((a) => a.School) && (
                <optgroup label="College">
                  {(ads || []).filter((a) => a.School).map((a) => <option key={adKey(a)} value={adKey(a)}>{a.School}</option>)}
                </optgroup>
              )}
            </select>
            {(() => {
              const a = (ads || []).find((x) => adKey(x) === adTeam);
              const imgs = a ? (a.Images || [a.Image1, a.Image2, a.Image3]).filter(Boolean) : [];
              return imgs.length > 0 && (
                <>
                  <div style={{ ...label, marginTop: "8px" }}>Product · click to use</div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {imgs.map((u, i) => (
                      <button key={u} onClick={() => setCard((c) => ({ ...c, product: u, adSlot: i }))} style={{
                        border: `2px solid ${card.product === u ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", padding: "3px", cursor: "pointer", width: "84px", height: "84px",
                      }}>
                        <img src={sanitizeImgur(u) || u} alt={`Product ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      </button>
                    ))}
                  </div>
                </>
              );
            })()}
            <div style={{ ...label, marginTop: "8px" }}>Or any image URL</div>
            <input value={card.product || ""} onChange={(e) => set("product", e.target.value)} placeholder="https://…" style={field} />
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
              {[[false, "NFL teams"], [true, "college teams"]].filter(([college]) => (ads || []).some((a) => !!a.School === college)).map(([college, text]) => (
                <button key={text} onClick={() => downloadAll(college)} disabled={!ads || !!batch} style={{ ...btn(false), padding: "5px 12px" }}
                  title="Every one in this layout, each with its own product in the slot picked above">
                  Download all {text} ({(ads || []).filter((a) => !!a.School === college).length})
                </button>
              ))}
            </div>
            {batch && <div style={{ fontSize: "12px", fontWeight: 800, color: BLUE, marginTop: "4px" }}>Downloading {batch}… · product {(card.adSlot || 0) + 1}</div>}
          </div>
        ) : isList(kind) ? (
          <div>
            <div style={label}>{kind === "class" ? "Class list" : "List · add anyone"}</div>
            {kind === "class" && <div style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
              <select value={classYear} onChange={(e) => setClassYear(e.target.value)} style={{ ...field, width: "90px" }}>{CLASS_YEARS.map((y) => <option key={y}>{y}</option>)}</select>
              <select value={classPos} onChange={(e) => setClassPos(e.target.value)} style={{ ...field, width: "90px" }}>{CLASS_POSITIONS.map((p) => <option key={p}>{p}</option>)}</select>
              <input type="number" min={1} max={10} value={classCount} onChange={(e) => setClassCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} style={{ ...field, width: "64px" }} title="How many" />
              <button onClick={loadClass} style={{ ...btn(true), padding: "5px 12px", whiteSpace: "nowrap" }}>Load top {classCount}</button>
            </div>}
            {kind === "list" && !card.classList.length && <div style={{ fontSize: "12px", color: "#8a97ab", fontWeight: 700, marginBottom: "6px" }}>Empty — add prospects below.</div>}
            {card.classList.map((r, i) => (
              <div key={`${r.id}-${i}`} draggable onDragStart={() => setDragFrom(i)} onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (dragFrom != null) moveRow(dragFrom, i); setDragFrom(null); }} onDragEnd={() => setDragFrom(null)}
                style={{ display: "flex", alignItems: "center", gap: "8px", border: "1px solid #e3e8ef", borderRadius: "8px", padding: "5px 8px", marginBottom: "4px", background: dragFrom === i ? "#e8f0fb" : "#fff", cursor: "grab" }}>
                <b style={{ width: "16px", color: "#8a97ab", fontSize: "12px" }}>{i + 1}</b>
                <span style={{ flex: 1, minWidth: 0, fontSize: "13px", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name} <span style={{ color: "#8a97ab", fontWeight: 700 }}>{r.school}</span></span>
                <button onClick={() => moveRow(i, i - 1)} disabled={i === 0} style={{ ...linkBtn, color: i === 0 ? "#c9d2de" : BLUE }}>↑</button>
                <button onClick={() => moveRow(i, i + 1)} disabled={i === card.classList.length - 1} style={{ ...linkBtn, color: i === card.classList.length - 1 ? "#c9d2de" : BLUE }}>↓</button>
                <button onClick={() => dropRow(i)} style={{ ...linkBtn, color: "#8a97ab" }}>✕</button>
              </div>
            ))}
            <div style={{ position: "relative", marginTop: "4px" }}>
              <input value={classSearch} onChange={(e) => setClassSearch(e.target.value)} placeholder="Add a prospect…" style={field} />
              {classMatches.length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #d5dce6", borderRadius: "6px", zIndex: 5, maxHeight: "240px", overflowY: "auto" }}>
                  {classMatches.map((p) => (
                    <button key={p.id} onClick={() => addRow(p)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "#fff", padding: "6px 9px", fontSize: "13px", fontWeight: 800, cursor: "pointer" }}>
                      {p.First} {p.Last} <span style={{ color: "#8a97ab", fontWeight: 700 }}>{p.Position} · {p.School} · {p.Eligible}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div>
            <div style={label}>Player</div>
            <div style={{ display: "flex", gap: "4px", marginBottom: "6px" }}>
              {[["college", "College"], ["nfl", "NFL"]].map(([v, t]) => <button key={v} onClick={() => setLeague(v)} style={{ ...btn(league === v), padding: "5px 12px" }}>{t}</button>)}
            </div>
            {league === "college" ? (
              <div style={{ position: "relative" }}>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={players ? "Search a prospect…" : "Loading players…"} style={field} />
                {matches.length > 0 && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #d5dce6", borderRadius: "6px", zIndex: 5, maxHeight: "260px", overflowY: "auto" }}>
                    {matches.map((p) => (
                      <button key={p.id} onClick={() => pickCollege(p)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "#fff", padding: "6px 9px", fontSize: "13px", fontWeight: 800, cursor: "pointer" }}>
                        {p.First} {p.Last} <span style={{ color: "#8a97ab", fontWeight: 700 }}>{p.Position} · {p.School} · {p.Eligible}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", gap: "6px" }}>
                <select value={nflTeam} onChange={(e) => setNflTeam(e.target.value)} style={{ ...field, width: "110px" }}>
                  {NFL_TEAM_ABBRS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select value="" onChange={(e) => { const a = roster.find((r) => String(r.id) === e.target.value); if (a) pickNfl(a); }} style={field}>
                  <option value="">{roster.length ? "Pick a player…" : "Loading roster…"}</option>
                  {roster.map((a) => <option key={a.id} value={a.id}>{a.fullName} · {a.position}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <div>{fieldHead(isList(kind) ? "Title 1" : "Line 1", "line1Size", "line1")}<input value={card.line1} onChange={(e) => set("line1", e.target.value)} style={field} /></div>
          <div>{fieldHead(isList(kind) ? "Title 2" : "Line 2", "line2Size", "line2")}<input value={card.line2} onChange={(e) => set("line2", e.target.value)} style={field} /></div>
        </div>
        <div>{fieldHead("Sub line", "subSize", "sub")}<input value={card.sub} onChange={(e) => set("sub", e.target.value)} style={field} /></div>
        <div>
          {fieldHead(isList(kind) ? "Ribbon (blank for none)" : "Stats title", "ribbonSize", "ribbon")}
          <input value={card.statsTitle} onChange={(e) => set("statsTitle", e.target.value)} style={field} />
        </div>

        {kind === "season" && (
          <div>
            <div style={label}>Stats on the card · {card.stats.length}/{STATS}</div>
            {card.stats.length === 0 && <div style={{ fontSize: "12px", color: "#8a97ab", fontWeight: 700, marginBottom: "6px" }}>None picked — choose from his season below{card.statOptions.length ? "" : ", or add a custom stat"}.</div>}
            {card.stats.map((st, i) => (
              <div key={st.key} style={{ border: "1px solid #e3e8ef", borderRadius: "8px", padding: "6px 8px", marginBottom: "5px", background: "#f8fafc" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "10px", fontWeight: 900, color: "#8a97ab", width: "14px" }}>{i + 1}</span>
                  <span style={{ fontSize: "15px", fontWeight: 900, color: card.c1 }}>{st.value || "—"}</span>
                  <span style={{ fontSize: "11px", fontWeight: 800, color: "#5b6b84", textTransform: "uppercase", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{st.label || "(no label)"}</span>
                  {st.rank && (
                    <button onClick={() => setStat(st.key, "showRank", !st.showRank)} title={`Show his national rank (${rankText(st.rank)}) under it`} style={{
                      border: `1px solid ${st.showRank ? BLUE : "#d5dce6"}`, background: st.showRank ? BLUE : "#fff", color: st.showRank ? "#fff" : "#5b6b84",
                      borderRadius: "999px", padding: "2px 8px", fontSize: "10px", fontWeight: 900, cursor: "pointer", whiteSpace: "nowrap",
                    }}>{st.rank.startsWith("T-") ? "T-" : ""}#{st.rank.replace(/^T-/, "")} FBS</button>
                  )}
                  <button onClick={() => setEditing((e) => ({ ...e, [st.key]: !e[st.key] }))} title="Edit / add a note" style={{ border: "none", background: "none", cursor: "pointer", fontSize: "13px", color: editing[st.key] ? BLUE : "#8a97ab" }}>✎</button>
                  <button onClick={() => dropStat(st.key)} title="Remove" style={{ border: "none", background: "none", cursor: "pointer", fontSize: "13px", color: "#8a97ab" }}>✕</button>
                </div>
                {editing[st.key] && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "6px" }}>
                    <input value={st.value} onChange={(e) => setStat(st.key, "value", e.target.value)} placeholder="Value" style={field} />
                    <input value={st.label} onChange={(e) => setStat(st.key, "label", e.target.value)} placeholder="Label" style={field} />
                    <input value={st.note || ""} onChange={(e) => setStat(st.key, "note", e.target.value)} placeholder="Note — e.g. 1st among true freshmen" style={{ ...field, gridColumn: "1 / -1" }} />
                  </div>
                )}
                {!editing[st.key] && (st.note || (st.showRank && st.rank)) && (
                  <div style={{ fontSize: "10px", fontWeight: 800, color: "#8a97ab", textTransform: "uppercase", marginTop: "3px", paddingLeft: "22px" }}>{statExtras(st).join(" · ")}</div>
                )}
              </div>
            ))}
            {card.statOptions.length > 0 && (
              <>
                <div style={{ ...label, marginTop: "8px" }}>His {card.season} season (ESPN) · click to pick</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", maxHeight: "170px", overflowY: "auto" }}>
                  {card.statOptions.map((o) => {
                    const on = card.stats.some((st) => st.key === o.key);
                    const full = !on && card.stats.length >= STATS;
                    return (
                      <button key={o.key} onClick={() => toggleStat(o)} disabled={full} style={{
                        border: `1px solid ${on ? BLUE : "#d5dce6"}`, background: on ? "#e8f0fb" : "#fff", borderRadius: "999px", padding: "4px 9px",
                        fontSize: "11px", fontWeight: 800, color: full ? "#c3ccd8" : "#33415a", cursor: full ? "default" : "pointer",
                      }}>
                        {o.label} <b style={{ color: full ? "#c3ccd8" : BLUE }}>{o.value}</b>{o.rank && <span style={{ color: full ? "#c3ccd8" : "#8a97ab" }}> · #{o.rank.replace(/^T-/, "")}</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <button onClick={addCustom} disabled={card.stats.length >= STATS} style={{ ...btn(false), marginTop: "8px", padding: "5px 12px", opacity: card.stats.length >= STATS ? 0.5 : 1 }}>+ Custom stat</button>
          </div>
        )}

        {kind === "career" && (
          <div>
            <div style={label}>Career table (ESPN)</div>
            {card.espn ? (
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                {careerGroups(card.espn, card.pos).map((cat) => (
                  <button key={cat} onClick={() => setCareerCat(cat)} style={{ ...btn(card.careerCat === cat), padding: "5px 12px" }}>{CAT_TITLE[cat] || cat}</button>
                ))}
              </div>
            ) : <div style={{ fontSize: "12px", color: "#8a97ab", fontWeight: 700 }}>Pick a player.</div>}
            {card.career && <div style={{ fontSize: "11px", color: "#8a97ab", fontWeight: 700, marginTop: "4px" }}>{card.career.rows.length} season{card.career.rows.length === 1 ? "" : "s"} · {card.career.cols.join(" · ")}</div>}
          </div>
        )}

        <div>{fieldHead("Footer", "footerSize", "footer")}<input value={card.footer} onChange={(e) => set("footer", e.target.value)} style={field} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <div><div style={label}>Main color</div><input type="color" value={card.c1} onChange={(e) => set("c1", e.target.value)} style={{ ...field, padding: "2px", height: "34px" }} /></div>
          <div><div style={label}>Border color</div><input type="color" value={card.c2} onChange={(e) => set("c2", e.target.value)} style={{ ...field, padding: "2px", height: "34px" }} /></div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {choice("style", [["light", "Light"], ["dark", "Dark"]])}
          {choice("side", [["left", "Left"], ["right", "Right"]])}
          {choice("vertical", [["top", "Top"], ["center", "Middle"], ["bottom", "Bottom"]])}
        </div>
        <div>
          <div style={{ ...label, display: "flex", alignItems: "center" }}>
            Sizes
            <button onClick={() => setCard((c) => ({ ...c, ...Object.fromEntries([...SIZES.map(([key]) => key), ...TEXT_SIZES].map((key) => [key, 1])) }))} style={{ ...linkBtn, marginLeft: "auto", fontSize: "10px" }} title="Every size back to 100%, the text lines' too">RESET ALL</button>
          </div>
          {SIZES.map(([key, text, max]) => (
            <div key={key} style={{ display: "grid", gridTemplateColumns: "80px 1fr 42px", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
              <span style={{ fontSize: "12px", fontWeight: 800, color: "#33415a" }}>{text}</span>
              <input type="range" min={1} max={max} step={0.05} value={card[key] || 1} onChange={(e) => set(key, Number(e.target.value))} />
              <span style={{ fontSize: "11px", fontWeight: 800, color: "#5b6b84", textAlign: "right" }}>{Math.round((card[key] || 1) * 100)}%</span>
            </div>
          ))}
        </div>
        <div>
          <div style={{ ...label, display: "flex", alignItems: "center" }}>
            Positions
            <button onClick={() => set("offsets", {})} style={{ ...linkBtn, marginLeft: "auto", fontSize: "10px" }} title="Every element back where the layout puts it">RESET ALL</button>
          </div>
          {[...(isList(kind) ? [] : ["picture"]), "body"].map((el) => (
            <div key={el} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "12px", fontWeight: 800, color: "#33415a", width: "120px" }}>{el === "body" ? (kind === "career" ? "Table" : isList(kind) ? "List" : kind === "ad" ? "Homage logo" : "Stats") : kind === "ad" ? "Product" : OFFSET_ELEMENTS[el]}</span>
              {posCtl(el)}
            </div>
          ))}
          <div style={{ fontSize: "11px", color: "#8a97ab", fontWeight: 700 }}>Text lines move with ↕↔ beside their fields. + X is right, + Y is down.</div>
        </div>
        <div>{kind !== "ad" && toggle("showHeadshot", "Headshot")}{toggle("showLogo", kind === "ad" ? "Team logo" : "Logo")}{!isList(kind) && kind !== "ad" && toggle("showStats", kind === "career" ? "Table" : "Stats")}{isList(kind) && toggle("numbered", "Numbers")}{isList(kind) && toggle("showPos", "Position")}{toggle("showSub", "Sub line")}</div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={download} style={btn(true)}>Download PNG</button>
        </div>
        {msg && <div style={{ fontSize: "12px", fontWeight: 800, color: msg.startsWith("Couldn't") ? "#a52a1e" : "#15803d" }}>{msg}</div>}
      </div>

      <div>
        <div style={label}>Preview · 1920×1080, transparent</div>
        <canvas ref={canvasRef} width={W} height={H} style={{
          width: "100%", height: "auto", borderRadius: "8px", border: "1px solid #d5dce6",
          // A checkerboard behind it, so the transparent frame reads as such.
          background: "repeating-conic-gradient(#e9edf2 0% 25%, #fff 0% 50%) 50% / 24px 24px",
        }} />
      </div>
    </div>
  );
}

// Headshots by player id (playerPhotos), 30 ids a query.
export async function headshotsFor(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    if (!chunk.length) continue;
    const snap = await getDocs(query(collection(db, "playerPhotos"), where(documentId(), "in", chunk))).catch(() => null);
    (snap?.docs || []).forEach((d) => { if (d.data().headshot?.url) out[d.id] = d.data().headshot.url; });
  }
  return out;
}
