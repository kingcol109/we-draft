// src/components/AdminVideoAssets.jsx
//
// Admin → Videos → Graphics → Assets: small graphics and clips for the
// player videos (Draft / Portal Breakdowns, Draft Reactions), made when
// asked (user, 2026-11-25). Each asset set is a SETS entry; the first:
//
//   Player Identification — a clip (2 s by default; the admin sets 1–6 s)
//   that circles a player on the film: a perfect circle draws on around
//   him, then a name tag (name, position · school, and — optional — his
//   season stats and/or his We-Draft rank) pops in by it; it fades out at
//   the end. The intro and fade keep their timing; a longer clip holds
//   longer. The admin drags the circle and the tag. 1920×1080,
//   transparent ProRes 4444 .mov (utils/movEncoder.js), like the breakdown
//   clips, so it drops onto the film in Premiere. Two versions:
//     We-Draft  site gold ring, navy tag, the round WD badge (assets/wd-badge.png)
//     Team      the team's colors and logo (his school, a portal move's new
//               school, or any NFL team)
//   The ring is NEVER green (user): a green team color is skipped for the
//   ring (white when nothing else is left); the tag may still use it.
//
//   Scouting Card — the Draft Breakdowns' opener over his top play: a
//   circle on him and a modern scouting card in the middle third (name,
//   school, height, weight, class) with the verdict locked behind question
//   marks. See videoAssets/scoutCard.js.
//
// Reads (user, 2026-11-25: keep Firestore reads near zero): the player
// search is the site snapshot _search (the active classes), the college
// teams are _cfbTeams (FBS, with colors and logos) — one doc read each — and
// a player's own doc is read only when he's picked. The video's player is
// read directly when he isn't in _search (a drafted class, say), and his
// school's branding comes with him (so an FCS school still has its look).
//
//   Play Results — a short stamp at the end of a play (TOUCHDOWN, SACK,
//   DROP…), good or miss tone, optional detail / name tag. See
//   videoAssets/playResult.js.
//
// The player defaults to the one the video is about — the last one opened
// in a breakdown tab (AdminDraftBreakdowns VIDEO_PLAYER_KEY, with its team:
// a reaction's NFL team, a portal move's new school) — and any other player
// can be picked. Where the ring sits: drag it on the preview; load a frame
// of the film behind the preview (never exported) to line it up.
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { fetchNflBranding } from "../utils/draftProfileData";
import { getSiteSnapshot } from "../utils/siteSnapshots";
import { classSnapshotRanks } from "../utils/classRanks";
import { defaultStats, espnIdFor, espnStats, loadImage, statOptions } from "./AdminSideGraphics";
import { ensureFonts, heightText, VIDEO_PLAYER_KEY } from "./AdminDraftBreakdowns";
import { drawRing, ringWidth } from "./videoAssets/ring";
import { CARD_DEFAULT_SECONDS, CARD_SECONDS, DEFAULT_CARD, drawScoutCard } from "./videoAssets/scoutCard";
import { DEFAULT_RESULT, drawPlayResult, RESULT_DEFAULT_SECONDS, RESULT_PRESETS, RESULT_SECONDS, resultTone, resultWords } from "./videoAssets/playResult";
import { encodeMov } from "../utils/movEncoder";
import WeDraftBadge from "../assets/wd-badge.png";

const W = 1920;
const H = 1080;
const DEFAULT_SECONDS = 2;
export const SECONDS_CHOICES = [1, 1.5, 2, 2.5, 3, 4, 5, 6];
const SITE = { BLUE: "#0055a5", NAVY: "#00264d", GOLD: "#f6a21d" };
const DISP = '"Bebas Neue", Impact, "Arial Narrow", sans-serif';
const BODY = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';
const disp = (s) => `${s}px ${DISP}`;
const body = (s, w = 700) => `${w} ${s}px ${BODY}`;
const MAX_STATS = 3;

// The asset sets (more to come).
const SETS = [
  { key: "playerid", label: "Player Identification", file: "ID" },
  // The draft video opener (user, 2026-11-25).
  { key: "scoutcard", label: "Scouting Card", file: "ScoutCard" },
  // At the end of a play (user, 2026-11-25).
  { key: "result", label: "Play Results", file: "Result" },
];
const DRAW = { playerid: drawPlayerId, scoutcard: drawScoutCard, result: drawPlayResult };
const DEFAULT_LENGTH = { playerid: DEFAULT_SECONDS, scoutcard: CARD_DEFAULT_SECONDS, result: RESULT_DEFAULT_SECONDS };

// ── Colors ──
const hexOf = (v) => {
  const s = String(v || "").trim().replace("#", "");
  return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toLowerCase()}` : "";
};
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const lum = (hex) => {
  const [r, g, b] = rgbOf(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
// Green (any shade that reads as green): never a ring color.
export function isGreen(hex) {
  if (!hexOf(hex)) return false;
  const [r, g, b] = rgbOf(hexOf(hex));
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  if (d < 0.08 || l < 0.08 || l > 0.94) return false; // gray, black, white
  const s = d / (1 - Math.abs(2 * l - 1));
  if (s < 0.2) return false;
  let h;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  return h >= 70 && h <= 170;
}
const darken = (hex, k) => {
  const [r, g, b] = rgbOf(hex).map((c) => Math.round(c * 255 * (1 - k)));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
};

// WCAG contrast ratio, 1–21.
export const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// A version's look: ring, tag fill, accent, logo. team: { name, short, Color1, Color2, logo }.
// ringPick: the admin's ring color (never green), else the first usable.
export function lookOf(version, team, ringPick) {
  if (version !== "team" || !team) {
    return { ring: SITE.GOLD, fill: SITE.NAVY, fill2: SITE.BLUE, accent: SITE.GOLD, ink: SITE.NAVY, logo: WeDraftBadge, rings: [SITE.GOLD] };
  }
  const c1 = hexOf(team.Color1);
  const c2 = hexOf(team.Color2);
  // The ring: a team color that isn't green and shows on film, else white.
  const rings = [...new Set([c1, c2, "#ffffff", SITE.GOLD].filter((c) => c && !isGreen(c) && lum(c) >= 0.04))];
  const ring = ringPick && rings.includes(ringPick) ? ringPick : rings.find((c) => lum(c) >= 0.08) || "#ffffff";
  // The tag: the team's dark color (a light primary trades for a dark second).
  let fill = c1 || SITE.NAVY;
  if (lum(fill) > 0.45) fill = c2 && lum(c2) < 0.3 ? c2 : darken(fill, 0.7);
  // The tag's accent (its edge, the position · school line, the chips): never
  // the tag's own color — red on red (user, 2026-11-25). The first of the
  // circle's color, the team's colors, white, gold that stands off the tag.
  const accent = [ring, c2, c1, "#ffffff", SITE.GOLD].find((c) => c && contrast(c, fill) >= 3) || "#ffffff";
  return { ring, fill, fill2: darken(fill, 0.35), accent, ink: lum(accent) > 0.5 ? "#0b1f3a" : "#ffffff", logo: team.logo || "", rings };
}

// ── Drawing ──
const ease = (p) => 1 - (1 - p) ** 3;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const phase = (t, a, b) => (t == null ? 1 : ease(clamp01((t - a) / (b - a))));
// The intro's beats as fractions of a 2 s clip, in seconds: a longer clip
// just holds longer; a shorter one plays the intro faster to fit.
const beatOf = (dur) => (a) => a * Math.min(2, dur);
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function fitText(ctx, text, maxW, size, min, f) {
  let s = size;
  ctx.font = f(s);
  while (s > min && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = f(s); }
  return s;
}

// The recruiting row's chips. r: { stars, rank, hs, year } (any may be missing).
export function recruitChips(r) {
  if (!r) return [];
  return [
    r.stars ? "★".repeat(r.stars) : "",
    r.rank ? `#${r.rank} NATIONAL` : "",
    r.hs ? String(r.hs).toUpperCase() : "",
    r.year ? `CLASS OF ${r.year}` : "",
  ].filter(Boolean);
}

// The name tag's lines: name, "POS · SCHOOL", then the extras (each a { label, value } chip row).
export function tagLines(a) {
  const rows = [];
  if (a.showStats && a.stats?.length) rows.push({ title: a.statsTitle || "SEASON", chips: a.stats.map((s) => `${s.value} ${String(s.label).toUpperCase()}`) });
  if (a.showRank && a.rank) {
    const chips = [a.rank.classRank ? `#${a.rank.classRank} OVERALL` : "", a.rank.positionRank ? `#${a.rank.positionRank} ${a.pos}` : ""].filter(Boolean);
    if (chips.length) rows.push({ title: "WE-DRAFT RANK", chips });
  }
  // Recruiting (user, 2026-11-25): stars, national rank, high school, class.
  if (a.showRecruit && a.recruit) rows.push({ title: "RECRUIT", chips: recruitChips(a.recruit) });
  return { name: `${a.first} ${a.last}`.trim().toUpperCase(), info: [a.pos, a.school].filter(Boolean).join(" · ").toUpperCase(), rows };
}

// One frame. a: the asset (player, version, look, place, seconds); t: 0–1
// through the clip, undefined for the finished still; bg: a film frame behind
// (preview only). Leaves canvas.tagBox (where the tag landed, for dragging it).
export async function drawPlayerId(canvas, a, t, bg = null) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  if (bg) {
    const s = Math.max(W / bg.width, H / bg.height);
    ctx.drawImage(bg, (W - bg.width * s) / 2, (H - bg.height * s) / 2, bg.width * s, bg.height * s);
  }
  const look = a.look;
  const logo = look.logo ? await loadImage(look.logo) : null;
  const dur = a.seconds || DEFAULT_SECONDS;
  // Seconds in; the fade is the clip's last 0.24 s.
  const sec = t == null ? null : t * dur;
  const beat = beatOf(dur);
  const at = (x, y) => phase(sec, beat(x), beat(y));
  const out = a.fadeOut && sec != null ? 1 - phase(sec, dur - 0.24, dur) : 1;
  ctx.save();
  ctx.globalAlpha = out;

  // The ring: sweeps on clockwise from the top, settling from a touch larger.
  const { cx, cy } = a.place;
  // A perfect circle (user, 2026-11-25).
  const rx = a.place.size;
  const ry = rx;
  const lw = ringWidth(rx);
  drawRing(ctx, { cx, cy, r: rx }, look.ring, {
    sweep: at(0, 0.22), grow: 1 + 0.14 * (1 - at(0, 0.3)), out,
    // One pulse ring out once it closes.
    pulse: sec != null && sec > beat(0.22) && sec < beat(0.55) ? (sec - beat(0.22)) / beat(0.33) : null,
  });

  // The tag: measured, then placed under the ring (over it near the bottom).
  const L = tagLines(a);
  const PAD = 22;
  const LOGO = 96;
  const maxText = 760;
  ctx.font = disp(66);
  const nameSize = fitText(ctx, L.name, maxText, 66, 36, disp);
  const nameW = ctx.measureText(L.name).width;
  ctx.font = body(30, 700);
  const infoW = ctx.measureText(L.info).width;
  const rowW = L.rows.map((r) => {
    ctx.font = body(20, 800);
    const tw = ctx.measureText(r.title).width + 22;
    ctx.font = body(26, 800);
    return tw + 12 + r.chips.reduce((s, c) => s + ctx.measureText(c).width + 26 + 8, 0);
  });
  const textW = Math.max(nameW, infoW, 260);
  const topH = Math.max(LOGO, nameSize + 44);
  const rowsH = L.rows.length * 46;
  const tagW = Math.min(W - 48, Math.max(PAD + LOGO + 20 + textW + PAD, ...rowW.map((w) => w + PAD * 2)));
  const tagH = PAD + topH + (rowsH ? 12 + rowsH : 0) + PAD - 6;
  const gap = 34;
  const below = a.place.tag === "below" || (a.place.tag !== "above" && cy + ry + gap + tagH <= H - 24);
  // Under / over the circle, then moved by the admin's drag (dx, dy), kept in frame.
  const tagY = Math.max(16, Math.min(H - 16 - tagH, (below ? cy + ry + gap : cy - ry - gap - tagH) + (a.place.dy || 0)));
  const tagX = Math.max(16, Math.min(W - 16 - tagW, cx - tagW / 2 + (a.place.dx || 0)));
  canvas.tagBox = { x: tagX, y: tagY, w: tagW, h: tagH };
  // Which side the tag ended up on (its accent edge and slide face the circle).
  const tagBelow = tagY + tagH / 2 >= cy;

  // The connector: the circle's edge to the nearest point of the tag.
  const pc = at(0.16, 0.28);
  const nx = Math.max(tagX, Math.min(tagX + tagW, cx));
  const ny = Math.max(tagY, Math.min(tagY + tagH, cy));
  const dist = Math.hypot(nx - cx, ny - cy);
  const edge = rx + lw / 2 + 2;
  if (pc > 0 && dist > edge + 6) {
    const ux = (nx - cx) / dist;
    const uy = (ny - cy) / dist;
    const x0 = cx + ux * edge;
    const y0 = cy + uy * edge;
    ctx.save();
    ctx.strokeStyle = look.ring;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + (nx - x0) * pc, y0 + (ny - y0) * pc);
    ctx.stroke();
    ctx.restore();
  }

  const pt = at(0.22, 0.4);
  if (pt > 0) {
    ctx.save();
    ctx.globalAlpha = out * pt;
    ctx.translate(0, (tagBelow ? 1 : -1) * 26 * (1 - pt));
    // Wiped open from the ring's side.
    ctx.beginPath();
    const ox = Math.max(tagX, Math.min(tagX + tagW, cx));
    ctx.rect(ox - (ox - tagX) * pt - 2, tagY - 4, (tagW) * pt + 4, tagH + 8);
    ctx.clip();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
    const g = ctx.createLinearGradient(tagX, tagY, tagX, tagY + tagH);
    g.addColorStop(0, look.fill);
    g.addColorStop(1, look.fill2);
    ctx.fillStyle = g;
    rr(ctx, tagX, tagY, tagW, tagH, 14);
    ctx.fill();
    ctx.shadowColor = "transparent";
    // Accent edge on the ring's side of the tag (top when under, bottom when over).
    ctx.fillStyle = look.accent;
    ctx.save();
    rr(ctx, tagX, tagY, tagW, tagH, 14);
    ctx.clip();
    ctx.fillRect(tagX, tagBelow ? tagY : tagY + tagH - 7, tagW, 7);
    ctx.restore();
    // Logo.
    const lx = tagX + PAD;
    const ly = tagY + PAD + (topH - LOGO) / 2;
    if (logo) {
      const s = Math.min(LOGO / logo.width, LOGO / logo.height);
      ctx.drawImage(logo, lx + (LOGO - logo.width * s) / 2, ly + (LOGO - logo.height * s) / 2, logo.width * s, logo.height * s);
    }
    // Name + info.
    const tx = lx + LOGO + 20;
    const midY = tagY + PAD + topH / 2;
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "alphabetic";
    ctx.font = disp(nameSize);
    ctx.fillText(L.name, tx, midY + nameSize * 0.18);
    ctx.fillStyle = look.accent === "#ffffff" ? "rgba(255,255,255,0.8)" : look.accent;
    ctx.font = body(30, 700);
    ctx.fillText(L.info, tx, midY + nameSize * 0.18 + 36);
    // The extras: a small title, then chips.
    let ry2 = tagY + PAD + topH + 12;
    L.rows.forEach((r, i) => {
      const pr2 = at(0.32 + i * 0.06, 0.48 + i * 0.06);
      ctx.save();
      ctx.globalAlpha = out * pt * pr2;
      let x = tagX + PAD;
      ctx.font = body(20, 800);
      const tw = ctx.measureText(r.title).width;
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.fillText(r.title, x, ry2 + 27);
      x += tw + 22;
      ctx.font = body(26, 800);
      r.chips.forEach((c) => {
        const cw = ctx.measureText(c).width + 26;
        ctx.fillStyle = look.accent;
        rr(ctx, x, ry2 + 2, cw, 36, 8);
        ctx.fill();
        ctx.fillStyle = look.ink;
        ctx.fillText(c, x + 13, ry2 + 29);
        x += cw + 8;
      });
      ctx.restore();
      ry2 += 46;
    });
    ctx.restore();
  }
  ctx.restore();
}

// ── Loading a player ──
// His recruiting: players.RecruitStars / RecruitRank / HighSchool / RecruitYear. null when none of it is known.
const recruitOf = (p) => {
  const stars = Math.max(0, Math.min(5, Math.round(Number(p.RecruitStars) || 0)));
  const rank = String(p.RecruitRank || "").replace(/^#/, "").trim();
  const r = { stars, rank: /^\d+$/.test(rank) && rank !== "0" ? rank : "", hs: String(p.HighSchool || "").trim(), year: /^\d{4}$/.test(String(p.RecruitYear || "")) ? String(p.RecruitYear) : "" };
  return r.stars || r.rank || r.hs || r.year ? r : null;
};
async function loadAsset(p) {
  const read = (ref) => getDoc(ref).then((x) => (x.exists() ? x.data() : null)).catch(() => null);
  const [schoolSnap, photo, classSnap] = await Promise.all([
    getDocs(query(collection(db, "schools"), where("School", "==", p.School || ""), limit(1))).catch(() => null),
    read(doc(db, "playerPhotos", p.id)),
    p.Eligible && p.Position ? getSiteSnapshot(`class_${p.Eligible}_${p.Position}`).catch(() => null) : null,
  ]);
  const s = schoolSnap?.docs?.[0]?.data() || {};
  const ath = await espnIdFor(p, s.CFBDTeamId, photo).catch(() => null);
  const espn = ath ? await espnStats("college-football", ath.id).catch(() => null) : null;
  const season = espn?.years?.[espn.years.length - 1] || "";
  const options = espn && season ? statOptions(espn, season) : [];
  const rank = classSnap ? classSnapshotRanks(classSnap)[p.id] || null : null;
  return {
    playerId: p.id, first: p.First || "", last: p.Last || "", pos: p.Position || "", school: p.School || "", cls: String(p.Eligible || ""),
    statOptions: options, statsTitle: season ? `${season} SEASON` : "SEASON",
    stats: defaultStats(options, p.Position).slice(0, MAX_STATS).map(({ key, label, value }) => ({ key, label, value })),
    rank: rank && (rank.classRank || rank.positionRank) ? rank : null,
    recruit: recruitOf(p),
    // The scouting card's facts.
    height: heightText(p.Height), weight: String(p.Weight || "").replace(/\s*lbs?\.?$/i, "").trim(),
    headshot: photo?.headshot?.url || ath?.headshot || "", schoolLogo: s.Logo1 || s.LogoDark || "",
    // His school's branding (for the Team version's picker, FCS included).
    schoolBrand: s.School ? { Logo1: s.Logo1 || "", LogoDark: s.LogoDark || "", Color1: s.Color1 || "", Color2: s.Color2 || "" } : null,
  };
}

const fileSafe = (s) => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const ui = { BLUE: "#0055a5", GOLD: "#f6a21d" };
const btn = (primary) => ({
  border: `1px solid ${primary ? ui.BLUE : "#cfd7e3"}`, background: primary ? ui.BLUE : "#fff", color: primary ? "#fff" : "#1d2433",
  borderRadius: 8, padding: "7px 14px", fontWeight: 800, fontSize: 13, cursor: "pointer",
});
const field = { border: "1px solid #cfd7e3", borderRadius: 8, padding: "6px 9px", fontSize: 13, width: "100%", boxSizing: "border-box" };
const head = { fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.5, color: "#5b6b84" };
const section = { display: "grid", gap: 8, padding: 12, border: "1px solid #e3e8ef", borderRadius: 10, background: "#fff" };
const chip = (on) => ({ ...btn(on), padding: "5px 12px", fontSize: 12 });

const DEFAULT_PLACE = { cx: 960, cy: 430, size: 110, tag: "auto", dx: 0, dy: 0 };

export default function AdminVideoAssets() {
  const [set, setSet] = useState("playerid");
  const [players, setPlayers] = useState(null);
  const [schools, setSchools] = useState({});
  const [nfl, setNfl] = useState({});
  const [search, setSearch] = useState("");
  const [video, setVideo] = useState(null); // { id, team, row } — the video's player
  const [asset, setAsset] = useState(null);
  const [version, setVersion] = useState("wd");
  const [teamKey, setTeamKey] = useState("");
  const [ringPick, setRingPick] = useState("");
  const [showStats, setShowStats] = useState(false);
  const [showRank, setShowRank] = useState(false);
  const [showRecruit, setShowRecruit] = useState(false);
  const [place, setPlace] = useState(DEFAULT_PLACE);
  const [fadeOut, setFadeOut] = useState(true);
  // Each set's length (s) and the card's settings.
  const [lengths, setLengths] = useState(DEFAULT_LENGTH);
  const seconds = lengths[set];
  const setSeconds = (n) => setLengths((l) => ({ ...l, [set]: n }));
  const [card, setCard] = useState(DEFAULT_CARD);
  const [result, setResult] = useState(DEFAULT_RESULT);
  const editResult = (patch) => setResult((r) => ({ ...r, ...patch }));
  const setTeaser = (k, v) => setCard((c) => ({ ...c, teaser: { ...c.teaser, [k]: v } }));
  const [fps, setFps] = useState(30);
  const [bg, setBg] = useState(null);
  const [fontsOk, setFontsOk] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const canvasRef = useRef(null);
  // A drag: { what: "circle" } or { what: "tag", x, y, dx, dy } (where it started).
  const dragRef = useRef(null);

  useEffect(() => {
    ensureFonts().then(() => setFontsOk(true));
    fetchNflBranding().then((b) => setNfl(b || {})).catch(() => {});
    // The college teams: the _cfbTeams snapshot (one read).
    getSiteSnapshot("_cfbTeams").then((d) => setSchools((old) => ({
      ...Object.fromEntries(Object.values(d?.teams || {}).filter((x) => x.School)
        .map((x) => [x.School, { Logo1: x.Logo1 || "", LogoDark: x.LogoDark || "", Color1: x.Color1 || "", Color2: x.Color2 || "" }])),
      ...old,
    }))).catch(() => {});
    // The player search: the _search snapshot (one read).
    getSiteSnapshot("_search").then(async (d) => {
      const list = (d?.rows || []).filter((r) => r.i && r.F && r.L)
        .map((r) => ({ id: r.i, First: r.F, Last: r.L, Position: r.P || "", School: r.S || "", Eligible: String(r.E || "") }));
      setPlayers(list);
      // The video's player: the one last opened in a breakdown tab — read
      // directly when he isn't in the snapshot.
      let v = null;
      try { v = JSON.parse(localStorage.getItem(VIDEO_PLAYER_KEY) || "null"); } catch { v = null; }
      let row = v?.id ? list.find((x) => x.id === v.id) : null;
      if (v?.id && !row) {
        const x = await getDoc(doc(db, "players", v.id)).catch(() => null);
        if (x?.exists()) row = { id: x.id, ...x.data() };
      }
      if (row) { setVideo({ id: row.id, team: v.team || null, row }); pick(row, v.team || null); } else setMsg("Pick a player. (Open one in Draft Breakdowns, Portal Breakdowns or Draft Reactions and he'll be the default here.)");
    }).catch((e) => setMsg(`Couldn't load players: ${e.message}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A player: his own doc (one read; a search row only has his name), then his asset.
  const pick = async (row, team = null) => {
    setSearch("");
    setMsg(`Loading ${row.First} ${row.Last}…`);
    try {
      const x = row.Height !== undefined || row.Weight !== undefined ? null : await getDoc(doc(db, "players", row.id)).catch(() => null);
      const p = x?.exists() ? { id: x.id, ...x.data() } : row;
      const a = await loadAsset(p);
      if (a.schoolBrand) setSchools((m) => ({ ...m, [a.school]: m[a.school] || a.schoolBrand }));
      setAsset(a);
      setTeamKey(team?.nfl ? `nfl:${team.nfl}` : team?.school ? `school:${team.school}` : `school:${p.School || ""}`);
      setRingPick("");
      setMsg(a.statOptions.length ? "" : "No ESPN stats found for him — the stats option is off.");
    } catch (e) {
      setMsg(`Couldn't load him: ${e.message}`);
    }
  };

  // The team options: his school (and a portal move's new school), then the NFL.
  const teamOf = (key) => {
    if (key.startsWith("nfl:")) {
      const ab = key.slice(4);
      const b = nfl[ab];
      if (!b) return null;
      return { name: b.City && b.Team ? `${b.City} ${b.Team}` : ab, short: b.Team || ab, Color1: b.Color1, Color2: b.Color2, logo: b.LogoDark || b.Logo1 || "" };
    }
    const name = key.slice(7);
    const b = schools[name];
    return b ? { name, short: name, Color1: b.Color1, Color2: b.Color2, logo: b.LogoDark || b.Logo1 || "" } : null;
  };
  const team = teamKey ? teamOf(teamKey) : null;
  const look = useMemo(() => lookOf(version, team, ringPick), [version, team?.name, team?.Color1, team?.Color2, team?.logo, ringPick]); // eslint-disable-line react-hooks/exhaustive-deps
  const full = asset && { ...asset, look, place, card, result, fadeOut, seconds, showStats: showStats && asset.stats.length > 0, showRank: showRank && !!asset.rank, showRecruit: showRecruit && !!asset.recruit };
  const draw = DRAW[set];
  const collegeKeys = [...new Set([asset?.school, video?.id === asset?.playerId ? video?.team?.school : ""].filter(Boolean))];

  // The still on the preview (redrawn off screen, then swapped in).
  useEffect(() => {
    if (!full || playing) return undefined;
    let on = true;
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    draw(off, full, undefined, bg).then(() => {
      if (!on || !canvasRef.current) return;
      const ctx = canvasRef.current.getContext("2d");
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(off, 0, 0);
      canvasRef.current.tagBox = off.tagBox || null;
      canvasRef.current.cardBox = off.cardBox || null;
      canvasRef.current.resultBox = off.resultBox || null;
    });
    return () => { on = false; };
  }); // every render — cheap, and follows every control

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !players) return [];
    return players.filter((p) => `${p.First} ${p.Last}`.toLowerCase().includes(q)).slice(0, 12);
  }, [players, search]);

  // Dragging the ring on the preview.
  const ptAt = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * W), y: Math.round(((e.clientY - r.top) / r.height) * H) };
  };
  const inBox = (b, p) => !!b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  const onTag = (p) => inBox(canvasRef.current?.tagBox, p);
  const onCard = (p) => inBox(canvasRef.current?.cardBox, p);
  const onResult = (p) => inBox(canvasRef.current?.resultBox, p);
  // Grabbing the tag moves the tag; anywhere else places the circle.
  const onDown = (e) => {
    if (!full || playing) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = ptAt(e);
    // The scouting card: grab it anywhere on it to move it.
    // A play result: grab it to move it.
    if (set === "result") {
      if (onResult(p)) dragRef.current = { what: "result", x: p.x, y: p.y, cx: result.x, cy: result.y };
      return;
    }
    if (set === "scoutcard") {
      if (onCard(p)) { dragRef.current = { what: "card", x: p.x, y: p.y, cx: card.x, cy: card.y }; return; }
      if (!card.focus) return;
      dragRef.current = { what: "cardfocus" };
      setCard((c) => ({ ...c, cx: p.x, cy: p.y }));
      return;
    }
    if (onTag(p)) { dragRef.current = { what: "tag", x: p.x, y: p.y, dx: place.dx || 0, dy: place.dy || 0 }; return; }
    dragRef.current = { what: "circle" };
    setPlace((s) => ({ ...s, cx: p.x, cy: p.y }));
  };
  const onMove = (e) => {
    const d = dragRef.current;
    const p = ptAt(e);
    if (!d) {
      if (canvasRef.current) canvasRef.current.style.cursor = !full ? "default" : set === "result" ? (onResult(p) ? "move" : "default") : set === "scoutcard" ? (onCard(p) ? "move" : card.focus ? "crosshair" : "default") : onTag(p) ? "move" : "crosshair";
      return;
    }
    if (d.what === "result") setResult((r) => ({ ...r, x: d.cx + p.x - d.x, y: d.cy + p.y - d.y }));
    else if (d.what === "card") setCard((c) => ({ ...c, x: d.cx + p.x - d.x, y: d.cy + p.y - d.y }));
    else if (d.what === "cardfocus") setCard((c) => ({ ...c, cx: p.x, cy: p.y }));
    else if (d.what === "tag") setPlace((s) => ({ ...s, dx: d.dx + p.x - d.x, dy: d.dy + p.y - d.y }));
    else setPlace((s) => ({ ...s, cx: p.x, cy: p.y }));
  };
  const onUp = () => { dragRef.current = null; };

  const play = async () => {
    if (!full || playing) return;
    setPlaying(true);
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const start = performance.now();
    let t = 0;
    while (t < 1 && canvasRef.current) {
      t = Math.min(1, (performance.now() - start) / (seconds * 1000));
      await draw(off, full, t, bg); // eslint-disable-line no-await-in-loop
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) { ctx.clearRect(0, 0, W, H); ctx.drawImage(off, 0, 0); }
      await new Promise((r) => requestAnimationFrame(r)); // eslint-disable-line no-await-in-loop
    }
    setPlaying(false);
  };

  const baseName = () => `${fileSafe(asset.first)}-${fileSafe(asset.last)}-${SETS.find((x) => x.key === set).file}-${set === "result" ? `${fileSafe(resultWords({ result }).main)}-` : ""}${version === "team" && team ? fileSafe(team.short) : "WeDraft"}`;
  const save$ = (blob, name) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };
  const downloadClip = async () => {
    if (!full) return;
    setBusy("mov");
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const count = Math.round(seconds * fps);
    try {
      const blob = await encodeMov({
        count, fps, onStatus: setMsg,
        frameAt: async (i) => {
          await draw(out, full, i / (count - 1));
          return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("an image blocked the export"))), "image/png"));
        },
      });
      save$(blob, `${baseName()}.mov`);
      setMsg(`Downloaded ${baseName()}.mov (${seconds} s, ${fps} fps, transparent).`);
    } catch (e) {
      setMsg(`Couldn't make the clip: ${e.message}`);
    }
    setBusy("");
  };
  const downloadStill = async () => {
    if (!full) return;
    setBusy("png");
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    try {
      await draw(out, full, undefined);
      const blob = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("an image blocked the export");
      save$(blob, `${baseName()}.png`);
      setMsg(`Downloaded ${baseName()}.png.`);
    } catch (e) {
      setMsg(`Couldn't export: ${e.message}`);
    }
    setBusy("");
  };

  const loadBg = (file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setBg(img);
    img.src = url;
  };
  const isVideoPlayer = video && asset && video.id === asset.playerId;
  const videoPlayer = video?.row || null;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={head}>Asset set</span>
        {SETS.map((s) => <button key={s.key} type="button" style={chip(set === s.key)} onClick={() => { setSet(s.key); dragRef.current = null; }}>{s.label}</button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 18, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={section}>
            <div style={head}>Player</div>
            {asset && (
              <div style={{ fontSize: 14, fontWeight: 900, color: "#1d2433" }}>
                {asset.first} {asset.last} <span style={{ fontWeight: 700, color: "#7a8597" }}>· {asset.pos} · {asset.school}</span>
                {isVideoPlayer && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 900, color: ui.GOLD, textTransform: "uppercase" }}>The video&apos;s player</span>}
              </div>
            )}
            {videoPlayer && !isVideoPlayer && (
              <button type="button" style={{ ...btn(false), justifySelf: "start" }} onClick={() => pick(videoPlayer, video.team)}>Back to {videoPlayer.First} {videoPlayer.Last} (the video&apos;s player)</button>
            )}
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={players ? "Pick another player…" : "Loading players…"} style={field} />
            {matches.length > 0 && (
              <div style={{ display: "grid", border: "1px solid #e3e8ef", borderRadius: 8, maxHeight: 260, overflowY: "auto" }}>
                {matches.map((p) => (
                  <button key={p.id} type="button" onClick={() => pick(p)} style={{ textAlign: "left", border: "none", borderBottom: "1px solid #edf0f5", background: "#fff", padding: "7px 10px", cursor: "pointer", fontSize: 13, fontWeight: 800 }}>
                    {p.First} {p.Last} <span style={{ color: "#7a8597", fontWeight: 700 }}>· {p.Position} · {p.School} · {p.Eligible}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {asset && (<>
            <div style={section}>
              <div style={head}>Version</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" style={chip(version === "wd")} onClick={() => setVersion("wd")}>We-Draft</button>
                <button type="button" style={chip(version === "team")} onClick={() => setVersion("team")}>Team</button>
              </div>
              {version === "team" && (<>
                <select value={teamKey} onChange={(e) => { setTeamKey(e.target.value); setRingPick(""); }} style={field}>
                  <optgroup label="His school">
                    {collegeKeys.map((s) => <option key={s} value={`school:${s}`}>{s}</option>)}
                  </optgroup>
                  {/* Any college (user, 2026-11-25): a past school, an opponent… */}
                  <optgroup label="All colleges">
                    {Object.keys(schools).filter((s) => !collegeKeys.includes(s)).sort().map((s) => <option key={s} value={`school:${s}`}>{s}</option>)}
                  </optgroup>
                  <optgroup label="NFL">
                    {Object.keys(nfl).sort().map((ab) => <option key={ab} value={`nfl:${ab}`}>{nfl[ab].City && nfl[ab].Team ? `${nfl[ab].City} ${nfl[ab].Team}` : ab}</option>)}
                  </optgroup>
                </select>
                {!team && <div style={{ fontSize: 12, fontWeight: 700, color: "#a52a1e" }}>No branding for that team — it draws in We-Draft colors.</div>}
                {team && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#5b6b84" }}>Circle</span>
                    {look.rings.map((c) => (
                      <button key={c} type="button" title={c} onClick={() => setRingPick(c)} style={{ width: 26, height: 26, borderRadius: "50%", background: c, cursor: "pointer", border: `3px solid ${look.ring === c ? ui.BLUE : "#d5dce6"}` }} />
                    ))}
                    {[hexOf(team.Color1), hexOf(team.Color2)].some(isGreen) && <span style={{ fontSize: 11, fontWeight: 700, color: "#7a8597" }}>Green is never used for the circle.</span>}
                  </div>
                )}
              </>)}
            </div>

            {set === "playerid" && (<>
            <div style={section}>
              <div style={head}>On the tag</div>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 800, opacity: asset.stats.length ? 1 : 0.5 }}>
                <input type="checkbox" checked={showStats && asset.stats.length > 0} disabled={!asset.stats.length} onChange={(e) => setShowStats(e.target.checked)} />
                {asset.statsTitle.toLowerCase().replace(/^./, (c) => c.toUpperCase())} stats{asset.stats.length ? "" : " (none found)"}
              </label>
              {showStats && asset.stats.length > 0 && (
                <div style={{ display: "grid", gap: 4, paddingLeft: 24 }}>
                  {asset.stats.map((s, i) => (
                    <select key={i} value={s.key} style={{ ...field, padding: "4px 7px" }}
                      onChange={(e) => { const o = asset.statOptions.find((x) => x.key === e.target.value); if (o) setAsset((a) => ({ ...a, stats: a.stats.map((x, j) => (j === i ? { key: o.key, label: o.label, value: o.value } : x)) })); }}>
                      {asset.statOptions.map((o) => <option key={o.key} value={o.key}>{o.value} {o.label}</option>)}
                    </select>
                  ))}
                  <div style={{ display: "flex", gap: 6 }}>
                    {asset.stats.length < MAX_STATS && <button type="button" style={chip(false)} onClick={() => { const o = asset.statOptions.find((x) => !asset.stats.some((s) => s.key === x.key)); if (o) setAsset((a) => ({ ...a, stats: [...a.stats, { key: o.key, label: o.label, value: o.value }] })); }}>+ Stat</button>}
                    {asset.stats.length > 1 && <button type="button" style={chip(false)} onClick={() => setAsset((a) => ({ ...a, stats: a.stats.slice(0, -1) }))}>− Stat</button>}
                  </div>
                </div>
              )}
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 800, opacity: asset.rank ? 1 : 0.5 }}>
                <input type="checkbox" checked={showRank && !!asset.rank} disabled={!asset.rank} onChange={(e) => setShowRank(e.target.checked)} />
                We-Draft rank{asset.rank ? ` (#${asset.rank.classRank} overall · #${asset.rank.positionRank} ${asset.pos}, ${asset.cls} class)` : " (not ranked)"}
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 800, opacity: asset.recruit ? 1 : 0.5 }}>
                <input type="checkbox" checked={showRecruit && !!asset.recruit} disabled={!asset.recruit} onChange={(e) => setShowRecruit(e.target.checked)} />
                Recruiting{asset.recruit ? ` (${recruitChips(asset.recruit).join(" · ")})` : " (none on file)"}
              </label>
            </div>

            <div style={section}>
              <div style={head}>Circle</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#7a8597" }}>Drag on the preview to place the circle; drag the tag to move it.</div>
              <label style={{ fontSize: 12, fontWeight: 800 }}>Size
                <input type="range" min={40} max={280} value={place.size} onChange={(e) => setPlace((s) => ({ ...s, size: Number(e.target.value) }))} style={{ width: "100%" }} />
              </label>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 800 }}>Tag</span>
                {[["auto", "Auto"], ["below", "Below"], ["above", "Above"]].map(([k, l]) => <button key={k} type="button" style={chip(place.tag === k && !place.dx && !place.dy)} onClick={() => setPlace((s) => ({ ...s, tag: k, dx: 0, dy: 0 }))}>{l}</button>)}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 800 }}>Length</span>
                <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} style={{ ...field, width: "auto", padding: "4px 7px" }}>
                  {SECONDS_CHOICES.map((n) => <option key={n} value={n}>{n} sec{n === DEFAULT_SECONDS ? " (default)" : ""}</option>)}
                </select>
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 800 }}>
                <input type="checkbox" checked={fadeOut} onChange={(e) => setFadeOut(e.target.checked)} /> Fade out at the end
              </label>
              <button type="button" style={{ ...chip(false), justifySelf: "start" }} onClick={() => setPlace(DEFAULT_PLACE)}>Reset circle &amp; tag</button>
            </div>
            </>)}

            {set === "scoutcard" && (<>
            <div style={section}>
              <div style={head}>On the card</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#5b6b84" }}>
                {[asset.pos, asset.school, asset.height || "no height", asset.weight ? `${asset.weight} lbs` : "no weight", asset.cls ? `${asset.cls} class` : ""].filter(Boolean).join(" · ")}
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 800, opacity: asset.headshot ? 1 : 0.5 }}>
                <input type="checkbox" checked={card.photo && !!asset.headshot} disabled={!asset.headshot} onChange={(e) => setCard((c) => ({ ...c, photo: e.target.checked }))} />
                Photo{asset.headshot ? "" : " (no headshot)"}
              </label>
              <div style={{ fontSize: 12, fontWeight: 800 }}>Question marks (nothing given away)</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[["grade", "Grade"], ["strengths", "Strengths"], ["weaknesses", "Weaknesses"], ["comp", "Comp"]].map(([k, l]) => (
                  <button key={k} type="button" style={chip(!!card.teaser[k])} onClick={() => setTeaser(k, !card.teaser[k])}>{l}</button>
                ))}
              </div>
              <label style={{ fontSize: 12, fontWeight: 800 }}>Bottom bar (blank for none)
                <input value={card.stamp} onChange={(e) => setCard((c) => ({ ...c, stamp: e.target.value }))} maxLength={24} style={field} />
              </label>
            </div>

            <div style={section}>
              <div style={head}>Card</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#7a8597" }}>Drag the card to move it; drag anywhere else on the preview to put the focus on the player. The card starts in the middle third; the focus dims the whole screen.</div>
              <label style={{ fontSize: 12, fontWeight: 800 }}>Card size
                <input type="range" min={0.7} max={1.3} step={0.05} value={card.s} onChange={(e) => setCard((c) => ({ ...c, s: Number(e.target.value) }))} style={{ width: "100%" }} />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 800 }}>
                <input type="checkbox" checked={card.focus} onChange={(e) => setCard((c) => ({ ...c, focus: e.target.checked }))} /> Focus on the player
              </label>
              {card.focus && (<>
                <label style={{ fontSize: 12, fontWeight: 800 }}>Focus size
                  <input type="range" min={50} max={320} value={card.r} onChange={(e) => setCard((c) => ({ ...c, r: Number(e.target.value) }))} style={{ width: "100%" }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 800 }}>Dim the rest
                  <input type="range" min={0.3} max={0.9} step={0.05} value={card.dim} onChange={(e) => setCard((c) => ({ ...c, dim: Number(e.target.value) }))} style={{ width: "100%" }} />
                </label>
              </>)}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 800 }}>Length</span>
                <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} style={{ ...field, width: "auto", padding: "4px 7px" }}>
                  {CARD_SECONDS.map((n) => <option key={n} value={n}>{n} sec{n === CARD_DEFAULT_SECONDS ? " (default)" : ""}</option>)}
                </select>
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 800 }}>
                <input type="checkbox" checked={card.exit} onChange={(e) => setCard((c) => ({ ...c, exit: e.target.checked }))} /> Slide out at the end
              </label>
              <button type="button" style={{ ...chip(false), justifySelf: "start" }} onClick={() => setCard((c) => ({ ...c, x: DEFAULT_CARD.x, y: DEFAULT_CARD.y, s: DEFAULT_CARD.s, cx: DEFAULT_CARD.cx, cy: DEFAULT_CARD.cy, r: DEFAULT_CARD.r }))}>Reset card &amp; focus</button>
            </div>
            </>)}

            {set === "result" && (<>
            <div style={section}>
              <div style={head}>Result</div>
              {RESULT_PRESETS.map(([group, list]) => (
                <div key={group} style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", textTransform: "uppercase" }}>{group}</div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {list.map((r) => (
                      <button key={r} type="button" style={{ ...chip(!result.text.trim() && result.preset === r), padding: "4px 9px", fontSize: 11 }} onClick={() => editResult({ preset: r, text: "" })}>{r}</button>
                    ))}
                  </div>
                </div>
              ))}
              <label style={{ fontSize: 12, fontWeight: 800 }}>Or type your own
                <input value={result.text} onChange={(e) => editResult({ text: e.target.value })} maxLength={22} placeholder="e.g. WHAT A CATCH" style={field} />
              </label>
              <label style={{ fontSize: 12, fontWeight: 800 }}>Detail tag (optional)
                <input value={result.detail} onChange={(e) => editResult({ detail: e.target.value })} maxLength={28} placeholder="e.g. +45 YDS · 3RD & 8" style={field} />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 800 }}>
                <input type="checkbox" checked={result.name} onChange={(e) => editResult({ name: e.target.checked })} /> {asset.first} {asset.last}&apos;s name on the tag
              </label>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 800 }}>Tone</span>
                {[["auto", `Auto (${resultTone({ ...result, tone: "auto" }) === "miss" ? "miss" : "good"})`], ["good", "Good play"], ["miss", "Miss"]].map(([k, l]) => (
                  <button key={k} type="button" style={chip(result.tone === k)} onClick={() => editResult({ tone: k })}>{l}</button>
                ))}
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 800 }}>
                <input type="checkbox" checked={result.logo} onChange={(e) => editResult({ logo: e.target.checked })} /> Logo on the bar
              </label>
            </div>

            <div style={section}>
              <div style={head}>Placement</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#7a8597" }}>Drag it on the preview to move it.</div>
              <label style={{ fontSize: 12, fontWeight: 800 }}>Size
                <input type="range" min={0.4} max={1.3} step={0.05} value={result.s} onChange={(e) => editResult({ s: Number(e.target.value) })} style={{ width: "100%" }} />
              </label>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 800 }}>Spot</span>
                {[["Center", 540], ["Lower", 860], ["Upper", 220]].map(([l, y]) => <button key={l} type="button" style={chip(result.x === 960 && result.y === y)} onClick={() => editResult({ x: 960, y })}>{l}</button>)}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 800 }}>Length</span>
                <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} style={{ ...field, width: "auto", padding: "4px 7px" }}>
                  {RESULT_SECONDS.map((n) => <option key={n} value={n}>{n} sec{n === RESULT_DEFAULT_SECONDS ? " (default)" : ""}</option>)}
                </select>
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 800 }}>
                <input type="checkbox" checked={result.exit} onChange={(e) => editResult({ exit: e.target.checked })} /> Wipe off at the end
              </label>
            </div>
            </>)}
          </>)}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <canvas ref={canvasRef} width={W} height={H} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
            style={{ width: "100%", aspectRatio: "16 / 9", borderRadius: 10, touchAction: "none",
              background: "repeating-conic-gradient(#2a3446 0% 25%, #222b3a 0% 50%) 0 / 32px 32px" }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={play} disabled={!full || playing || !!busy} style={btn(false)}>▶ Play</button>
            <button type="button" onClick={downloadClip} disabled={!full || !!busy} style={btn(true)}>{busy === "mov" ? "Making the clip…" : "Download clip (.mov)"}</button>
            <button type="button" onClick={downloadStill} disabled={!full || !!busy} style={btn(false)}>{busy === "png" ? "Exporting…" : "Download still (.png)"}</button>
            <select value={fps} onChange={(e) => setFps(Number(e.target.value))} style={{ ...field, width: "auto" }}>
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
            <label style={{ ...btn(false), display: "inline-block" }}>
              {bg ? "Change film frame" : "Load a film frame"}
              <input type="file" accept="image/*" onChange={(e) => loadBg(e.target.files?.[0])} style={{ display: "none" }} />
            </label>
            {bg && <button type="button" onClick={() => setBg(null)} style={btn(false)}>Clear frame</button>}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#7a8597" }}>
            {seconds}-second transparent clip (ProRes 4444) for Premiere. A film frame only helps you place it; it&apos;s never in the download.
          </div>
          {msg && <div style={{ fontSize: 13, fontWeight: 800, color: "#1d2433" }}>{msg}</div>}
          {!fontsOk && <div style={{ fontSize: 12, fontWeight: 700, color: "#7a8597" }}>Loading fonts…</div>}
        </div>
      </div>
    </div>
  );
}
