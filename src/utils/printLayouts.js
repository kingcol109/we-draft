// src/utils/printLayouts.js
//
// Print layouts — the printed evaluation page (one player per page) and,
// later, the We-Draft.com draft-class magazine. Edited in Admin → Print
// (components/AdminPrint.jsx), drawn by components/print/EvaluationPage.jsx.
//
// Page geometry: trim 8.5 × 11 in, bleed 0.125 in each side (8.75 × 11.25
// in). Drawn at 96 px/in, so the page with bleed is 840 × 1080 px and
// prints at exact size from @page { size: 8.75in 11.25in }.
//
// The layout lives in config/printLayouts (admin-written, rules: /config).
// Today it lays a page out from community grades; user-built evaluations
// will reuse the same page with the user's own data swapped in.
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { getSiteSnapshot } from "./siteSnapshots";
import { classSnapshotRanks } from "./classRanks";
import { gradeCounts } from "./gradeWindow";
import { GRADE_SCALE, GRADE_LABELS, gradeLabel } from "./gradeScale";
import { championSeasons, stopSpan } from "./careerStops";
import { fetchEspnCareer } from "../components/PlayerEspnStats";
import { fetchNflBranding } from "./draftProfileData";

// Profile → My Binder (components/profileHub/MyBinderTab.jsx) is for
// We-Draft Plus members — membership isn't built yet, so for now only the
// site's own account has it. When Plus exists, check membership here.
const BINDER_UIDS = [
  "pYSpX6IRyHdAlYpFP5NNbQ19ARI3", // King Cold Sports
];
export const canUseBinder = (uid) => !!uid && BINDER_UIDS.includes(uid);

export const PX_PER_IN = 96;
export const BLEED = 0.125 * PX_PER_IN; // 12
export const TRIM_W = 8.5 * PX_PER_IN; // 816
export const TRIM_H = 11 * PX_PER_IN; // 1056
export const PAGE_W = TRIM_W + BLEED * 2; // 840
export const PAGE_H = TRIM_H + BLEED * 2; // 1080
// Safe area, inside the trim: the outside/top/bottom margin and the gutter
// (binding side, a little wider so nothing disappears into the spine).
export const MARGIN = 0.5 * PX_PER_IN; // 48
export const GUTTER = 0.75 * PX_PER_IN; // 72

// The page's blocks. zone: where a block can sit — "side" (the narrow
// column), "main" (the wide one) or "off" (not shown).
export const BLOCKS = {
  grade: { label: "Community Grade" },
  ranks: { label: "Class Ranks" },
  measurables: { label: "Measurables" },
  bio: { label: "Bio" },
  career: { label: "Career Path" },
  traits: { label: "Strengths & Weaknesses" },
  stats: { label: "College Stats" },
  fits: { label: "NFL Fits" },
  reports: { label: "My Evaluation (user pages)" },
  notes: { label: "Notes (ruled lines)" },
};

export const DEFAULT_EVAL_LAYOUT = {
  version: 1,
  header: "clean", // "clean": white with a color rule · "band": a full color band
  accent: "school", // "school": the school's colors · "website": We-Draft.com's blue and gold
  bw: false, // the whole page in black and white (headshots and logos too)
  sidebar: "outside", // the narrow column on the page's outside edge or the gutter side
  headshot: "outside", // the headshot cutout on the outside edge or the gutter side
  blocks: [
    { key: "grade", zone: "side" },
    { key: "ranks", zone: "side" },
    { key: "measurables", zone: "side" },
    { key: "bio", zone: "side" },
    { key: "career", zone: "side" },
    { key: "traits", zone: "main" },
    { key: "stats", zone: "main" },
    { key: "fits", zone: "main" },
    { key: "reports", zone: "main" },
    { key: "notes", zone: "off" },
  ],
  reportsCount: 2,
  reportLines: 7, // each report clamps to this many lines
  notesLines: 6,
  folio: "We-Draft.com · Community Evaluation",
  starters: { left: "", right: "" },
};

// The personal page: a user printing their own evaluation at home. Letter
// size with no bleed, centered (equal side margins, wide enough for a
// 3-hole punch), no page numbers. Its own layout, same blocks.
export const DEFAULT_PERSONAL_LAYOUT = {
  ...DEFAULT_EVAL_LAYOUT,
  rankSource: "mine", // a user's own page's Ranks: "mine" (their grades) | "whiteboard"
  pageVersion: "mine", // which version pages start as in My Binder: "mine" | "community" | "blank"
  reportsCount: 1,
  reportLines: 60,
  folio: "We-Draft.com · My Scouting Report",
};

// The formats: where each layout is stored (config/printLayouts.{key}) and
// its paper.
export const FORMATS = {
  spread: { key: "evaluation", label: "Magazine spread", defaults: DEFAULT_EVAL_LAYOUT, w: PAGE_W, h: PAGE_H, pageSize: "8.75in 11.25in" },
  personal: { key: "personal", label: "Personal (centered)", defaults: DEFAULT_PERSONAL_LAYOUT, w: TRIM_W, h: TRIM_H, pageSize: "8.5in 11in" },
};
// Personal page margins: 0.75 in each side clears a 3-hole punch (holes
// sit ~0.4 in in from the edge) and keeps the page centered.
export const PERSONAL_SIDE = 0.75 * PX_PER_IN; // 72
export const PERSONAL_TOP = 0.55 * PX_PER_IN;
// The punch holes (screen-only guide): 0.28 in across, 0.4 in in, 4.25 in apart.
export const PUNCH_HOLES = { d: 0.28 * PX_PER_IN, x: 0.4 * PX_PER_IN, ys: [1.25, 5.5, 9.75].map((y) => y * PX_PER_IN) };

// A stored layout over the defaults. A block added since it was saved
// goes back where the defaults put it (after the block before it there).
export function normalizeLayout(raw, defaults = DEFAULT_EVAL_LAYOUT) {
  const l = { ...defaults, ...(raw || {}) };
  const seen = new Set();
  const blocks = (Array.isArray(l.blocks) ? l.blocks : defaults.blocks)
    .filter((b) => BLOCKS[b?.key] && !seen.has(b.key) && seen.add(b.key))
    .map((b) => ({ key: b.key, zone: ["side", "main", "off"].includes(b.zone) ? b.zone : "off" }));
  defaults.blocks.forEach((def, i) => {
    if (seen.has(def.key)) return;
    seen.add(def.key);
    const prev = defaults.blocks.slice(0, i).reverse().find((b) => blocks.some((x) => x.key === b.key));
    const at = prev ? blocks.findIndex((x) => x.key === prev.key) + 1 : 0;
    blocks.splice(at, 0, { ...def });
  });
  Object.keys(BLOCKS).forEach((k) => { if (!seen.has(k)) blocks.push({ key: k, zone: "off" }); });
  // The old "Black" colors option is now the page-wide black & white.
  if (l.accent === "mono") { l.accent = "school"; l.bw = true; }
  if (!["school", "website"].includes(l.accent)) l.accent = "school";
  l.bw = !!l.bw;
  return { ...l, blocks, starters: { ...DEFAULT_EVAL_LAYOUT.starters, ...(l.starters || {}) } };
}

const LAYOUT_DOC = () => doc(db, "config", "printLayouts");

// format: "spread" | "personal".
export async function loadLayout(format = "spread") {
  const f = FORMATS[format];
  const snap = await getDoc(LAYOUT_DOC());
  return normalizeLayout(snap.exists() ? snap.data()[f.key] : null, f.defaults);
}

export async function saveLayout(format, layout) {
  const f = FORMATS[format];
  await setDoc(LAYOUT_DOC(), { [f.key]: { ...normalizeLayout(layout, f.defaults), updatedAt: Date.now() } }, { merge: true });
}

// A user's own version of the personal layout (Profile → My Binder →
// Customize): users/{uid}/printSettings/evaluation { layout }. Null when
// they've never customized — the admin's personal layout applies then.
const USER_LAYOUT_DOC = (uid) => doc(db, "users", uid, "printSettings", "evaluation");
export async function loadUserLayout(uid) {
  const snap = await getDoc(USER_LAYOUT_DOC(uid));
  return snap.exists() && snap.data().layout ? normalizeLayout(snap.data().layout, DEFAULT_PERSONAL_LAYOUT) : null;
}
export async function saveUserLayout(uid, layout) {
  await setDoc(USER_LAYOUT_DOC(uid), { layout: normalizeLayout(layout, DEFAULT_PERSONAL_LAYOUT), updatedAt: Date.now() });
}
// Back to We-Draft.com's layout (and its future changes).
export async function resetUserLayout(uid) {
  await deleteDoc(USER_LAYOUT_DOC(uid));
}

// ── A user's own ranks for their pages ──
// The position groups (the Whiteboard's) and its rounds.
const WB_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB"];
const WB_ROUNDS = ["ROUND 1", "ROUND 2", "ROUND 3", "ROUND 4", "ROUND 5", "ROUND 6", "ROUND 7", "UDFA"];
const roundLabel = (r) => (r === "UDFA" ? "UDFA" : r ? `Round ${r.replace("ROUND ", "")}` : "");

/**
 * Ranks for each target player ({ id, Eligible, Position }) from the
 * user's side:
 *   mine — among everyone they've graded in that class, by their grade
 *     (ties: the community grade, then the class rank); the position rank
 *     among their graded players at his position.
 *   whiteboard — his place on their Whiteboard for that class
 *     (whiteboards/{uid}_{class}): overall (the Big Board order) and in his
 *     position group, with the round he's in.
 * → { [id]: { mine: {…} | null, whiteboard: {…} | null } }
 */
export async function loadMyRanks(uid, evals, targets) {
  const classes = [...new Set(targets.map((t) => String(t.Eligible || "")).filter(Boolean))];
  const gradeOf = Object.fromEntries(evals.filter((e) => GRADE_SCALE[e.grade]).map((e) => [e.id, GRADE_SCALE[e.grade]]));
  const out = Object.fromEntries(targets.map((t) => [t.id, { mine: null, whiteboard: null }]));
  await Promise.all(classes.map(async (cls) => {
    const [snaps, wb] = await Promise.all([
      Promise.all(WB_POSITIONS.map((pos) => getSiteSnapshot(`class_${cls}_${pos}`).catch(() => null))),
      getDoc(doc(db, "whiteboards", `${uid}_${cls}`)).then((x) => (x.exists() ? x.data() : null)).catch(() => null),
    ]);
    // Every player in the class: position group, community grade, class rank.
    const info = {};
    snaps.forEach((sd, i) => {
      (sd?.rows || []).forEach((r) => { info[r.i] = { pos: WB_POSITIONS[i], g: r.g ?? 99, cr: r.cr ?? 99999 }; });
      Object.entries(sd?.hidden || {}).forEach(([id, h]) => { info[id] = { pos: WB_POSITIONS[i], g: h.g ?? 99, cr: h.cr ?? 99999 }; });
    });
    const graded = Object.keys(gradeOf).filter((id) => info[id])
      .sort((a, b) => gradeOf[a] - gradeOf[b] || info[a].g - info[b].g || info[a].cr - info[b].cr);
    // Whiteboard order.
    const board = wb?.board || {};
    const overall = WB_ROUNDS.flatMap((r) => (wb?.bigBoard?.[r]?.length ? wb.bigBoard[r] : WB_POSITIONS.flatMap((pos) => board[r]?.[pos] || [])));
    targets.filter((t) => String(t.Eligible) === cls).forEach((t) => {
      const pos = info[t.id]?.pos || t.Position;
      if (gradeOf[t.id] && info[t.id]) {
        const atPos = graded.filter((id) => info[id].pos === pos);
        out[t.id].mine = { classRank: graded.indexOf(t.id) + 1, classOf: graded.length, positionRank: atPos.indexOf(t.id) + 1, positionOf: atPos.length, pos, cls };
      }
      const group = WB_POSITIONS.find((g) => WB_ROUNDS.some((r) => (board[r]?.[g] || []).includes(t.id)));
      if (group) {
        const groupOrder = WB_ROUNDS.flatMap((r) => board[r]?.[group] || []);
        const round = WB_ROUNDS.find((r) => (board[r]?.[group] || []).includes(t.id));
        out[t.id].whiteboard = { classRank: overall.indexOf(t.id) + 1 || null, classOf: overall.length, positionRank: groupOrder.indexOf(t.id) + 1, positionOf: groupOrder.length, pos: group, round: roundLabel(round), cls };
      }
    });
  }));
  return out;
}

// ── College stats (ESPN — the player page's Stats tab source) ──
// Which ESPN categories lead for a position; others with numbers follow.
const STAT_CATS = {
  QB: ["passing", "rushing"], RB: ["rushing", "receiving"], WR: ["receiving", "rushing"], TE: ["receiving"],
  EDGE: ["defensive"], DL: ["defensive"], LB: ["defensive", "interceptions"], DB: ["defensive", "interceptions"],
  CB: ["defensive", "interceptions"], S: ["defensive", "interceptions"], K: ["kicking"], P: ["punting"],
};
const SKIP_STAT_CATS = new Set(["scoring", "returning"]);
const zeroish = (arr) => (arr || []).every((v) => !v || /^-?0(\.0+)?%?$/.test(String(v).trim()) || v === "-" || v === "–");

// → [{ title, labels, rows: [{ year, team, stats }], totals }] — at most two
// tables, the position's own categories first.
// Also Admin → Go's Players desk (components/AdminGo.jsx).
export async function loadStats(espnId, position) {
  if (!espnId) return [];
  const j = await fetchEspnCareer(espnId).catch(() => null);
  const cats = (j?.categories || []).filter((c) => !SKIP_STAT_CATS.has(c.name) && c.statistics?.length && !zeroish(c.totals));
  if (!cats.length) return [];
  const want = STAT_CATS[String(position || "").toUpperCase()] || [];
  const ordered = [...want.map((k) => cats.find((c) => c.name === k)).filter(Boolean), ...cats.filter((c) => !want.includes(c.name))];
  const teamAbbr = (slug) => j.teams?.[slug]?.abbreviation || j.teams?.[slug]?.shortDisplayName || "";
  return ordered.slice(0, 2).map((c) => ({
    key: c.name, // "receiving", "passing", …
    title: c.displayName || c.name,
    labels: c.labels || [],
    rows: [...c.statistics].sort((a, b) => (a.season?.year || 0) - (b.season?.year || 0))
      .map((st) => ({ year: st.season?.year || "", team: teamAbbr(st.teamSlug), stats: st.stats || [] })),
    totals: c.totals || null,
  }));
}

// ── Formatting (same rules as the player page, PlayerProfile.js) ──
const EIGHTHS = { 0: "", 1: "1/8", 2: "1/4", 3: "3/8", 4: "1/2", 5: "5/8", 6: "3/4", 7: "7/8" };
function eighths(num) {
  let whole = Math.floor(num);
  let e = Math.round((num - whole) * 8);
  if (e === 8) { e = 0; whole += 1; }
  return `${whole}${EIGHTHS[e] ? ` ${EIGHTHS[e]}` : ""}`;
}
function fmtHeight(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  const m = s.match(/^(\d+)'(\d+(?:\.\d+)?)"?$/);
  if (!m || Number.isInteger(parseFloat(m[2]))) return s;
  return `${m[1]}'${eighths(parseFloat(m[2]))}"`;
}
function fmtInches(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  if (s.includes('"') || s.includes("/")) return s;
  const n = parseFloat(s);
  return isNaN(n) ? s : `${eighths(n)}"`;
}
function fmtVertical(raw) {
  if (raw == null || raw === "") return "";
  const n = parseFloat(String(raw).replace(/"/g, ""));
  return isNaN(n) ? String(raw) : `${Number(n.toFixed(1))}"`;
}
function fmtFeetInches(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  if (s.includes('"') || s.includes("'")) return s;
  const n = parseFloat(s);
  if (isNaN(n)) return s;
  const t = Math.round(n);
  return `${Math.floor(t / 12)}'${t % 12}"`;
}
const fmtWeight = (w) => (!w ? "" : /^\d+$/.test(String(w).trim()) ? `${String(w).trim()} lbs` : String(w));
export const fmtClass = (e) => {
  if (!e) return "";
  const m = String(e).match(/^(\d{4})s$/i);
  return m ? `${m[1]} (Supplemental)` : String(e);
};

function ageFrom(birthday) {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return "";
  const b = new Date(`${birthday}T12:00:00`);
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a -= 1;
  return a > 0 && a < 40 ? String(a) : "";
}

const fmtBirthday = (b) => (!b || !/^\d{4}-\d{2}-\d{2}$/.test(b) ? "" : new Date(`${b}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));

const BANNED = ["faggot", "nigger", "monkey", "nigga", "fuck"];
const clean = (t) => !BANNED.some((w) => String(t || "").toLowerCase().includes(w));
const toMs = (ts) => (ts?.toDate?.() ? ts.toDate().getTime() : typeof ts === "number" ? ts : Date.parse(ts) || 0);

/**
 * Everything the evaluation page shows for one player (a players doc with
 * its id): branding, headshot, measurables, bio, community grade, traits,
 * grade spread, NFL fits, ranks and public scouting reports.
 */
export async function loadPrintPlayer(p, { reports: withReports = true } = {}) {
  const espnIdOf = (ps) => (ps?.exists() && ps.data().headshot?.espnId ? String(ps.data().headshot.espnId) : "");
  const photoP = getDoc(doc(db, "playerPhotos", p.id)).catch(() => null);
  const statsP = photoP.then((ps) => loadStats(espnIdOf(ps), p.Position)).catch(() => []);
  const [photoSnap, schoolSnap, evalSnap, classSnap, stats, nfl] = await Promise.all([
    photoP,
    p.School ? getDocs(query(collection(db, "schools"), where("School", "==", p.School))).catch(() => null) : null,
    getDocs(collection(db, "players", p.id, "evaluations")).catch(() => null),
    p.Eligible && p.Position ? getSiteSnapshot(`class_${p.Eligible}_${p.Position}`).catch(() => null) : null,
    statsP,
    fetchNflBranding().catch(() => ({})),
  ]);
  const photo = photoSnap?.exists() ? photoSnap.data() : {};
  const s = schoolSnap && !schoolSnap.empty ? schoolSnap.docs[0].data() : {};

  // Community — same counting as the player page.
  const evals = evalSnap ? evalSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  const grades = [];
  const spread = Object.fromEntries(Object.keys(GRADE_SCALE).map((k) => [k, 0]));
  const sC = {}; const wC = {}; const fC = {};
  evals.forEach((e) => {
    if (e.grade && GRADE_SCALE[e.grade] && gradeCounts(e, p.Eligible)) { grades.push(GRADE_SCALE[e.grade]); spread[e.grade] += 1; }
    (Array.isArray(e.strengths) ? e.strengths : []).forEach((t) => { sC[t] = (sC[t] || 0) + 1; });
    (Array.isArray(e.weaknesses) ? e.weaknesses : []).forEach((t) => { wC[t] = (wC[t] || 0) + 1; });
    if (e.nflFit) fC[e.nflFit] = (fC[e.nflFit] || 0) + 1;
  });
  const reportsN = evals.filter((e) => e.grade !== "Watchlist" || (e.strengths?.length || 0) + (e.weaknesses?.length || 0) > 0).length || 1;
  const strengths = Object.entries(sC).filter(([t, c]) => c >= (wC[t] ?? -Infinity)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([term, c]) => ({ term, pct: (c / reportsN) * 100 }));
  const weaknesses = Object.entries(wC).filter(([t, c]) => c > (sC[t] ?? -Infinity)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([term, c]) => ({ term, pct: (c / reportsN) * 100 }));
  const fits = Object.entries(fC).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([team, count]) => ({ team, count }));
  const avg = grades.length ? grades.reduce((a, b) => a + b, 0) / grades.length : null;

  // Public written reports, verified scouts first, then newest.
  const pub = evals.filter((e) => e.visibility === "public" && String(e.evaluation || "").trim() && clean(e.evaluation));
  const uids = withReports ? [...new Set(pub.map((e) => e.uid).filter(Boolean))].slice(0, 40) : [];
  const users = Object.fromEntries(await Promise.all(uids.map((u) => getDoc(doc(db, "users", u)).then((x) => [u, x.exists() ? x.data() : null]).catch(() => [u, null]))));
  const reports = (withReports ? pub : [])
    .map((e) => ({ text: String(e.evaluation).trim(), grade: e.grade || "", by: users[e.uid]?.username || "Anonymous", verified: !!users[e.uid]?.verified, at: toMs(e.updatedAt), raw: e }))
    .sort((a, b) => (a.verified !== b.verified ? (a.verified ? -1 : 1) : b.at - a.at));

  const ranks = classSnap ? classSnapshotRanks(classSnap)[p.id] || null : null;

  const measurables = [
    ["Height", fmtHeight(p.Height)], ["Weight", fmtWeight(p.Weight)], ["Wingspan", fmtInches(p.Wingspan)],
    ["Arm", fmtInches(p["Arm Length"])], ["Hand", fmtInches(p["Hand Size"])], ["40 Yard", p["40 Yard"]],
    ["Vertical", fmtVertical(p.Vertical)], ["Broad", fmtFeetInches(p.Broad)], ["3-Cone", p["3-Cone"]],
    ["Shuttle", p.Shuttle], ["Bench", p.Bench],
  ].filter(([, v]) => v != null && String(v).trim() !== "").map(([label, value]) => ({ label, value: String(value) }));

  // (The high school is in the Career Path block.)
  const bio = [
    ["Class", fmtClass(p.Eligible)],
    ["Hometown", p.Hometown || ""],
    ["Born", fmtBirthday(p.Birthday)],
    ["Jersey", photo.jersey != null && String(photo.jersey).trim() ? `#${String(photo.jersey).trim()}` : ""],
    ["Age", ageFrom(p.Birthday)],
  ].filter(([, v]) => v).map(([label, value]) => ({ label, value }));

  // Career path, oldest first; the current school's stop runs to Present.
  const stops = Array.isArray(p.CareerStops) ? p.CareerStops : [];
  const career = stops.map((st, i) => ({
    school: st.School || "",
    level: st.Level || "",
    span: st.From ? stopSpan(st, { current: i === stops.length - 1 && st.School === p.School }) : "",
    titles: championSeasons(st),
  })).filter((st) => st.school);

  return {
    id: p.id,
    player: p, // the raw doc — the Career Path block reads it (PlayerEligibilityInfo useCareerPath)
    espnId: espnIdOf(photoSnap),
    stats,
    // NFL team name ("Cleveland Browns") → its logo, for the NFL Fit block.
    nflLogos: Object.fromEntries(Object.values(nfl || {}).flatMap((t) => {
      const logo = t.Logo1 || t.LogoDark || "";
      return logo ? [[`${t.City || ""} ${t.Team || ""}`.trim(), logo], [t.Team || "", logo]] : [];
    })),
    first: p.First || "",
    last: p.Last || "",
    position: p.Position || "",
    school: p.School || "",
    eligible: p.Eligible || "",
    slug: p.Slug || "",
    jersey: photo.jersey != null ? String(photo.jersey).trim() : "",
    headshot: photo.headshot?.url || "",
    color1: s.Color1 || "#0055a5",
    color2: s.Color2 || "#f6a21d",
    logo: s.Logo1 || s.LogoDark || "", // on white
    logoDark: s.LogoDark || s.Logo1 || "", // on the color band
    mascot: s.Mascot || "",
    height: fmtHeight(p.Height),
    weight: fmtWeight(p.Weight),
    measurables,
    bio,
    community: {
      avg,
      label: gradeLabel(avg),
      count: grades.length,
      evalCount: evals.length,
      spread: Object.entries(spread).map(([label, n]) => ({ label, n, value: GRADE_SCALE[label] })),
      strengths,
      weaknesses,
      fits,
    },
    ranks,
    reports,
    career,
    // A stand-in "my evaluation" for previewing the personal page in admin
    // (the top public report).
    sampleMine: reports[0] ? mineFrom(reports[0].raw, reports[0].by) : null,
  };
}

/**
 * A user's own evaluation (users/{uid}/evaluations/{playerId}) as the
 * personal page shows it.
 */
export function mineFrom(e, by) {
  return {
    grade: e?.grade || "",
    strengths: Array.isArray(e?.strengths) ? e.strengths : [],
    weaknesses: Array.isArray(e?.weaknesses) ? e.weaknesses : [],
    nflFit: e?.nflFit || "",
    text: String(e?.evaluation || "").trim(),
    by: by || "",
    at: toMs(e?.updatedAt),
  };
}

// Short round labels for the grade spread (1 … 10).
export const SPREAD_SHORT = { 1: "E1", 2: "M1", 3: "L1", 4: "2", 5: "3", 6: "4", 7: "5", 8: "6", 9: "7", 10: "UDFA" };
export { GRADE_LABELS, fmtHeight, fmtWeight };
