// src/utils/risers.js
//
// Draft Risers: /risers/{year} (pages/Risers.jsx), the prospects in a class
// on the rise, set in Admin → Content → Rising Page (components/AdminRisers.jsx).
// One ranked list per class — On Fire, Trending Up and Breakout are labels
// the admin puts on each player, not separate lists; they rank together.
// One doc per class:
//   risers/{year} {
//     players: [Riser], updatedAt
//   }
//   Riser = {
//     id (players doc id), slug, first, last, pos, school,   — copied from
//                                     the players doc on every admin save
//     type: "onFire" | "up" | "breakout",
//     order: 0…  (within its type — the page lists each type in order),
//     stats: [{ key: "passing.YDS", label, value, season }] — the admin's
//            picks from his CFBD season line (cfbdPlayers.seasons; public
//            numbers — never PFF), the values copied in at save / refresh,
//     note: "", noteUpdatedAt — the admin's write-up, shown in his row,
//     shot: url — the placed action shot his graphic uses, chosen once on
//            the admin's Save (riserShot),
//     addedAt (ms),
//   }
// A riser's graphic (utils/instagram/riser.js) uses one of his action shots
// placed for the First Pick graphic (playerPhotos action[i].firstPick) —
// same size, same photo box — the one saved on him (riser.shot).
export const RISER_YEARS = ["2027", "2028", "2029"];
// Each class's intro, under the page's header (pages/Risers.jsx).
export const RISER_INTROS = {
  2027: "The 2027 NFL Draft environment is in constant flux throughout the fall with every Saturday providing an opportunity for players across the country to rise up draft boards. Here are some players who have taken advantage of those opportunities and should be on your radar now and leading up to April’s draft.",
  2028: "The 2028 NFL Draft only consists of true sophomores at this point in time, but that isn’t a reason to not stay updated on their development. Here are some names you should know and keep track of over the next year.",
  2029: "The 2029 NFL Draft may feel like a long way off but it will be here before you know it. It is only made up of true freshmen right now and they will have plenty of time to put more film out there, but here are some players you should get in early on.",
};
export const RISER_DOC = (year) => ["risers", String(year)];
export const STATS_SEASON = 2026;
export const MAX_STATS = 4;

// The labels.
export const RISER_TYPES = {
  onFire: {
    key: "onFire", label: "On Fire", plural: "On Fire", short: "ON FIRE", emoji: "🔥",
    blurb: "Stacking up strong weeks.",
    c1: "#ff5a1f", c2: "#ffc53d", deep: "#1a0500", ink: "#c2410c", tint: "#fff3ec",
    top: ["#3a0700", "#8f1600", "#e2400c"],
  },
  up: {
    key: "up", label: "Trending Up", plural: "Trending Up", short: "TRENDING UP", emoji: "📈",
    blurb: "Rising draft boards through consistent good play.",
    c1: "#22c55e", c2: "#a3f7bf", deep: "#03150d", ink: "#15803d", tint: "#ecfbf1",
    top: ["#04140e", "#0a3d27", "#119455"],
  },
  breakout: {
    key: "breakout", label: "Breakout", plural: "Breakouts", short: "BREAKOUT", emoji: "⚡",
    blurb: "New names forcing their way into the conversation.",
    c1: "#a855f7", c2: "#ffd23f", deep: "#0d0420", ink: "#7e22ce", tint: "#f6efff",
    top: ["#0d0326", "#3a0f86", "#7c3aed"],
  },
};
export const RISER_TYPE_KEYS = Object.keys(RISER_TYPES);
// The Trends suggester's labels (TrendSuggester.js) → riser types.
export const TREND_TO_RISER = { "On Fire": "onFire", Up: "up", Breakout: "breakout" };

// The CFBD season-line stats the admin can show: category → { stat: label }.
export const STAT_LABELS = {
  passing: { YDS: "Pass Yds", TD: "Pass TD", INT: "INT Thrown", PCT: "Comp %", COMPLETIONS: "Completions", ATT: "Attempts", YPA: "Yds / Att" },
  rushing: { YDS: "Rush Yds", TD: "Rush TD", CAR: "Carries", YPC: "Yds / Carry", LONG: "Long Rush" },
  receiving: { REC: "Receptions", YDS: "Rec Yds", TD: "Rec TD", YPR: "Yds / Rec", LONG: "Long Rec" },
  defensive: { TOT: "Tackles", SOLO: "Solo Tackles", TFL: "TFL", SACKS: "Sacks", "QB HUR": "QB Hurries", PD: "PBU", TD: "Def TD" },
  interceptions: { INT: "INT", YDS: "INT Ret Yds", TD: "Pick-Six" },
  fumbles: { FUM: "Fumbles", LOST: "Fumbles Lost", REC: "Fumble Rec" },
  kicking: { FGM: "FG Made", FGA: "FG Att", PCT: "FG %", LONG: "Long FG", XPM: "XP Made", PTS: "Points" },
  punting: { NO: "Punts", YPP: "Punt Avg", "In 20": "Inside 20", LONG: "Long Punt", TB: "Touchbacks" },
  kickReturns: { YDS: "KR Yds", TD: "KR TD", AVG: "KR Avg", NO: "Kick Returns" },
  puntReturns: { YDS: "PR Yds", TD: "PR TD", AVG: "PR Avg", NO: "Punt Returns" },
};
export const STAT_CATEGORY_NAMES = {
  passing: "Passing", rushing: "Rushing", receiving: "Receiving", defensive: "Defense", interceptions: "Interceptions",
  fumbles: "Fumbles", kicking: "Kicking", punting: "Punting", kickReturns: "Kick Returns", puntReturns: "Punt Returns",
};
// The picks a riser starts with, by position.
export const DEFAULT_STATS = {
  QB: ["passing.YDS", "passing.TD", "passing.PCT"],
  RB: ["rushing.YDS", "rushing.TD", "rushing.YPC"],
  WR: ["receiving.REC", "receiving.YDS", "receiving.TD"],
  TE: ["receiving.REC", "receiving.YDS", "receiving.TD"],
  EDGE: ["defensive.SACKS", "defensive.TFL", "defensive.QB HUR"],
  DL: ["defensive.SACKS", "defensive.TFL", "defensive.TOT"],
  LB: ["defensive.TOT", "defensive.TFL", "defensive.SACKS"],
  DB: ["defensive.TOT", "defensive.PD", "interceptions.INT"],
  K: ["kicking.FGM", "kicking.PCT", "kicking.LONG"],
  P: ["punting.YPP", "punting.In 20", "punting.LONG"],
};

const RATE = new Set(["YPA", "YPC", "YPR", "YPP", "AVG"]);
// "passing.YDS" → [category, stat] (a stat name can hold a space: "QB HUR").
export const splitStatKey = (key) => { const i = String(key).indexOf("."); return [key.slice(0, i), key.slice(i + 1)]; };
export const statLabel = (key) => { const [c, s] = splitStatKey(key); return STAT_LABELS[c]?.[s] || `${c} ${s}`; };
// A season line's value for a key, as shown: "2,996", "69.6%", "9.4".
export function statValue(season, key) {
  const [c, s] = splitStatKey(key);
  const v = season?.[c]?.[s];
  if (v == null || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (s === "PCT") return `${(n <= 1 ? n * 100 : n).toFixed(1)}%`;
  if (RATE.has(s)) return n.toFixed(1);
  return Math.round(n).toLocaleString("en-US");
}
// The keys a season line has, by category (for the admin's picker).
export const seasonKeys = (season) => Object.entries(season || {})
  .filter(([c]) => STAT_LABELS[c])
  .map(([c, o]) => [c, Object.keys(STAT_LABELS[c]).filter((s) => o?.[s] != null && o[s] !== "")])
  .filter(([, ks]) => ks.length);

// A class's risers, ranked: the board's one order, every label together.
export function risersRanked(players) {
  return [...(players || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.addedAt ?? 0) - (b.addedAt ?? 0));
}
// How many of each label — [[type, count]…] in RISER_TYPE_KEYS order.
export const labelCounts = (players) => RISER_TYPE_KEYS.map((t) => [t, (players || []).filter((r) => r.type === t).length]);

const SITE = "https://we-draft.com";
// A riser's graphic, at a descriptive filename (api/risers/[year]/[file].js
// → api/riser-graphic.js): /api/risers/2027/dante-moore-2027-qb-nfl-draft-riser.webp.
// small: the 600px copy; fmt: "webp" (the page) or "png" (social previews,
// structured data); v: the board's last save (ms) — the same image until the
// admin saves again, so the CDN keeps it instead of drawing it every visit.
// ed: a past edition's date ("2026-11-17") — its graphic as it was then.
export const riserImageUrl = (slug, year, small = false, v = "", fmt = "png", ed = "") => {
  const q = [v && `v=${v}`, ed && `ed=${ed}`].filter(Boolean).join("&");
  return `${SITE}/api/risers/${year}/${encodeURIComponent(slug)}-nfl-draft-riser${small ? "-600" : ""}.${fmt === "webp" ? "webp" : "png"}${q ? `?${q}` : ""}`;
};
// The action shot his graphic uses: the one saved on him (riser.shot — set
// on the admin's Save), else his first placed shot.
export const riserShot = (riser, shots) => (shots || []).find((s) => s.url === riser?.shot) || (shots || [])[0] || null;
export const risersPath = (year) => `/risers/${year}`;

// A class's saved board (risers/{year}), or null — cached per class for the
// visit (player pages read it for In The News and the sidebar's top 5).
const boardCache = new Map();
export function loadRiserBoard(year) {
  const y = String(year || "");
  if (!RISER_YEARS.includes(y)) return Promise.resolve(null);
  // Tests: the same stand-in board pages/Risers.jsx takes.
  if (typeof window !== "undefined" && window.__RISERS_TEST__) return Promise.resolve(window.__RISERS_TEST__);
  if (!boardCache.has(y)) {
    boardCache.set(y, (async () => {
      const [{ doc, getDoc }, { db }] = await Promise.all([import("firebase/firestore"), import("../firebase")]);
      const s = await getDoc(doc(db, "risers", y));
      return s.exists() ? s.data() : null;
    })().catch(() => null));
  }
  return boardCache.get(y);
}

// A player's In The News item for his class's risers board (player pages,
// like the weekly mocks): null when he isn't on it.
export async function riserNewsItem(player) {
  const year = String(player?.Eligible || "");
  if (!RISER_YEARS.includes(year) || !player?.id) return null;
  const board = await loadRiserBoard(year);
  const ranked = risersRanked(board?.players);
  const i = ranked.findIndex((r) => r.id === player.id);
  if (i < 0 || !board?.updatedAt) return null;
  const r = ranked[i];
  const label = RISER_TYPES[r.type]?.label || "Riser";
  const last = player.Last || r.last || "";
  return {
    id: `risers${year}`, type: "risers", aboutPlayer: true, publishedAt: board.updatedAt,
    href: risersPath(year), title: `${year} Draft Risers: ${last} ${label}`,
  };
}

// ── Editions ──
// Every admin Save also publishes the class's list as a dated edition, the
// way the Weekly Mock keeps each week (AdminRisers.jsx): riserEditions/
// {year}_{YYYY-MM-DD} — { year, date, publishedAt, players: [Riser + recent] }
// (recent: his recent line as it read that day — riserRecent.js), one a
// class a day (a second Save that day replaces it). /risers/{year} is
// always the latest; a past one is /risers/{year}/{date} (Risers.jsx), and
// each is a news item (loadRiserNews — the News page, the home pages).
export const RISER_EDITIONS = "riserEditions";
export const EDITION_TIME_ZONE = "America/New_York";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isEditionDate = (d) => DATE_RE.test(String(d || ""));
// The edition a moment belongs to: its date in Eastern time, "2026-11-17".
export const editionDate = (when = new Date()) => when.toLocaleDateString("en-CA", { timeZone: EDITION_TIME_ZONE });
export const editionId = (year, date) => `${year}_${date}`;
export const editionPath = (year, date) => `/risers/${year}/${date}`;
// "Nov 17, 2026" (opts: other toLocaleDateString fields).
export const editionLabel = (date, opts = { month: "short", day: "numeric", year: "numeric" }) =>
  (isEditionDate(date) ? new Date(`${date}T12:00:00`).toLocaleDateString("en-US", opts) : "");

// The published editions as news items — { id, type: "risers", title,
// summary, publishedAt, href }, newest first: a class's newest links to
// /risers/{year}, older ones to their own page. max: how many (all
// without). [] if the read fails.
export async function loadRiserNews(max) {
  try {
    const [{ collection, getDocs, limit, orderBy, query }, { db }] = await Promise.all([import("firebase/firestore"), import("../firebase")]);
    const snap = await getDocs(query(collection(db, RISER_EDITIONS), orderBy("publishedAt", "desc"), ...(max ? [limit(max)] : [])));
    const seen = new Set();
    return snap.docs.map((d) => {
      const e = d.data();
      const year = String(e.year);
      const latest = !seen.has(year);
      seen.add(year);
      const top = risersRanked(e.players).slice(0, 3).map((r) => `${r.first} ${r.last}`);
      return {
        id: `risers-${d.id}`, type: "risers", publishedAt: e.publishedAt,
        title: `${year} NFL Draft Risers — ${editionLabel(e.date, { month: "long", day: "numeric" })}`,
        summary: top.length ? `Leading the list: ${top.length > 1 ? `${top.slice(0, -1).join(", ")} and ${top[top.length - 1]}` : top[0]}` : "",
        href: latest ? risersPath(year) : editionPath(year, e.date),
      };
    });
  } catch {
    return [];
  }
}
