// src/components/VideoSuggester.js
//
// Admin → Videos → "Suggest Video": ranks the players most worth a video
// right now, filtered by position(s) and school level, and explains each pick.
// The pool is every FBS roster player (cfbRosters/{teamId}, written weekly
// by scripts/syncCfbdRosters.js), not just We-Draft profiles — a player
// with no profile can be added to We-Draft straight from his card (the CFB
// Universe add, CfbUniverseSearch.js addRosterPlayer).
//
// Signals, each turned into a percentile within the filtered pool so a G5
// linebacker is compared against other G5 linebackers, not Heisman QBs:
//   Last game   production in his team's most recent final (last 10 days):
//               that game's box score, liveGames/{id}/box/players; the
//               games come from the slate (liveSlate/current + the week
//               before's liveSlate/week-* doc)
//   Breakout    that game vs his per-team-game average over the rest of the
//               season
//   Season      season production (the roster row's season totals, plus any
//               game played since the roster sync) and a bump for a top-50
//               national rank (cfbLeaders/current)
//   PFF grade   his PFF season grade, blended with his latest game's
//               (pffGrades/{teamId}, scripts/syncPffGrades.js) — only grades
//               with enough snaps to carry a national rank count. The PFF
//               focus swaps in one specific grade (pass rush, coverage…)
//               and keeps only players ranked in it. PFF data is back
//               office only: never display it on the public site.
//   Views       player-page views over the last 7 days (analytics/{slug},
//               scripts/syncGoogleAnalytics.js) — We-Draft players only
//   Momentum    those 7-day views vs the player's 30-day pace
// Each signal's weight is the admin's Strong / Medium / Weak pick (the
// Weights bar). A player not on We-Draft has no page, so his views and
// momentum are scored as average (NO_PAGE), and he's badged. A player with
// a video in the last 30 days is marked down (halved inside 14 days) so the list doesn't
// keep surfacing the same people.
//
// Shared data is read on the first Suggest and cached for the session; each
// school's roster and each game's box score are read the first time a
// filter needs them.
import { useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { POS_MAP, eligibleFor, addRosterPlayer } from "./CfbUniverseSearch";
import { groupOf, production, statLine } from "./seasonStats";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#0b1a2e";
const RED = "#c0392b";
const GREEN = "#2e9e4f";

// Player Flag values — same keys/colors as AdminPanel.js FLAG_COLORS (one
// flag per player; the stored value is the color).
const FLAGS = [
  { key: "red", hex: "#c0392b", label: "Video" },
  { key: "green", hex: "#2e7d32", label: "Watch" },
  { key: "blue", hex: "#1565c0", label: "Follow" },
];

const RESULT_COUNT = 10;
const LAST_GAME_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB", "K"];

// "Powerhouse" is a judgment call, not a conference — edit this list to
// change who counts. Everyone else in the P4 conferences is "Other P4"; the
// rest of FBS (incl. the rebuilt Pac 12 and UConn) is G5.
const POWERHOUSE = new Set([
  "Alabama", "Georgia", "Ohio State", "Michigan", "Texas", "LSU", "Oregon", "Notre Dame", "USC",
  "Penn State", "Clemson", "Oklahoma", "Florida State", "Tennessee", "Miami", "Texas A&M", "Florida", "Auburn",
]);
const P4_CONFS = new Set(["ACC", "Big 10", "Big 12", "SEC"]);
const G5_CONFS = new Set(["AAC", "CUSA", "MAC", "Mountain West", "Sun Belt", "Pac 12", "Independent"]);
const LEVELS = [
  { key: "powerhouse", label: "Powerhouse" },
  { key: "p4", label: "Other P4" },
  { key: "g5", label: "G5" },
];
const LEVEL_LABEL = { powerhouse: "Powerhouse", p4: "Other P4", g5: "G5" };

// Each signal's weight is set in the Weights bar (Strong / Medium / Weak),
// then normalized. A player not on We-Draft has no page, so his views and
// momentum are unknown — scored as average traffic (NO_PAGE), so a Strong
// Views weight favors players with proven traffic and a Weak one lets
// stat-only discoveries rise. One with no stats (OL, unlinked) is scored on
// views + momentum alone. A PFF grade (any position, OL included) adds the
// PFF signal; without one the rest are reweighted without it.
const NO_PAGE = 0.5;
const SIGNALS = ["last", "breakout", "season", "pff", "views", "momentum"];
const STAT_SIGNALS = ["last", "breakout", "season"];
const VIEW_SIGNALS = ["views", "momentum"];
const SIGNAL_LABEL = { last: "Last game", breakout: "Breakout", season: "Season", pff: "PFF grade", views: "Views (7d)", momentum: "Momentum" };
const SIGNAL_HELP = {
  last: "Production in his team's most recent game",
  breakout: "That game vs his average over the rest of the season",
  season: "Season production + top-50 national rank",
  pff: "PFF season grade blended with his last game's — or the PFF focus grade",
  views: "Player-page views, last 7 days (We-Draft players only)",
  momentum: "7-day views vs his 30-day pace (We-Draft players only)",
};
const STRENGTHS = [{ key: "max", label: "Max", value: 5 }, { key: "strong", label: "Strong", value: 3 }, { key: "medium", label: "Medium", value: 2 }, { key: "weak", label: "Weak", value: 1 }];
const STRENGTH_VALUE = Object.fromEntries(STRENGTHS.map((x) => [x.key, x.value]));
// PFF leads; box-score stats still count, lightly.
const DEFAULT_STRENGTH = { last: "weak", breakout: "weak", season: "weak", pff: "max", views: "medium", momentum: "weak" };

// PFF focus — "overall" is his position grade (blended with his latest
// game); the rest are the specific grades scripts/syncPffGrades.js SUBS
// writes (same keys). title: the noun for the title idea.
const PFF_FOCUS = [
  { key: "overall", label: "Overall" },
  { key: "pass", label: "Passing", title: "Passer" },
  { key: "run", label: "Rushing", title: "Runner" },
  { key: "route", label: "Route running", title: "Route Runner" },
  { key: "hands", label: "Hands", title: "Pair of Hands" },
  { key: "pblk", label: "Pass block", title: "Pass Blocker" },
  { key: "rblk", label: "Run block", title: "Run Blocker" },
  { key: "prush", label: "Pass rush", title: "Pass Rusher" },
  { key: "rdef", label: "Run defense", title: "Run Defender" },
  { key: "cov", label: "Coverage", title: "Cover Man" },
  { key: "tkl", label: "Tackling", title: "Tackler" },
];
const FOCUS_BY_KEY = Object.fromEntries(PFF_FOCUS.map((f) => [f.key, f]));
// His grade in a specific focus: [grade, snaps, rank, of] or undefined.
const focusGrade = (c, focus) => c.pff?.x?.[focus];

function normalizedWeights(strength, keys) {
  const total = keys.reduce((t, k) => t + STRENGTH_VALUE[strength[k]], 0);
  return Object.fromEntries(keys.map((k) => [k, STRENGTH_VALUE[strength[k]] / total]));
}

// Draft classes still in college (the draft is in April): this year's
// upcoming class and the three after it.
function collegeClasses() {
  const today = new Date();
  const first = today.getMonth() >= 4 ? today.getFullYear() + 1 : today.getFullYear();
  return [first, first + 1, first + 2, first + 3];
}

const n = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const fmt = (v) => Math.round(v).toLocaleString();
const msOf = (ts) => (ts?.toMillis ? ts.toMillis() : ts?.seconds ? ts.seconds * 1000 : new Date(ts || 0).getTime() || 0);
// "3-2" / "3-2-1" → games played.
const gamesInRecord = (rec) => (rec ? String(rec).split("-").reduce((t, x) => t + n(x), 0) : 0);

function tierOf(school, conf) {
  if (POWERHOUSE.has(school)) return "powerhouse";
  if (P4_CONFS.has(conf) || school === "Notre Dame") return "p4";
  if (G5_CONFS.has(conf)) return "g5";
  return null;
}

// cfbLeaders/current (top 50 per category) → athlete id → best rank.
function rankIndex(leaders) {
  const best = new Map();
  (leaders?.categories || []).forEach((cat) => {
    const rows = cat.rows || [];
    rows.forEach((r) => {
      const rank = 1 + rows.filter((x) => x.v > r.v).length;
      const tie = rows.some((x) => x !== r && x.v === r.v);
      const id = String(r.id);
      if (!best.has(id) || rank < best.get(id).rank) best.set(id, { rank, label: `${tie ? "T-" : "#"}${rank} in FBS — ${cat.title}` });
    });
  });
  return best;
}

// Percentile lookup over a fixed pool (ties counted half, 0..1). A pool of
// one has nothing to compare against, so it sits in the middle.
function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const bound = (v, strict) => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (strict ? sorted[mid] < v : sorted[mid] <= v) lo = mid + 1; else hi = mid; }
    return lo;
  };
  return (v) => {
    if (sorted.length <= 1) return 0.5;
    const below = bound(v, true), equal = bound(v, false) - below;
    return (below + Math.max(equal - 1, 0) / 2) / (sorted.length - 1);
  };
}

// Leads with whichever story the numbers actually back up.
function titleIdea(c) {
  const name = `${c.first} ${c.last}`;
  const opp = c.lastGame?.opponent;
  const possessive = name.endsWith("s") ? `${name}'` : `${name}'s`;
  if (opp && c.breakout >= 1.5) return `${possessive} Breakout Game vs ${opp}: Is He Rising Up Draft Boards?`;
  if (opp && c.lastProd > c.restAvg * 1.2 && c.signals.last >= 0.6) return `${name} Took Over vs ${opp} — Film Breakdown`;
  const fg = focusGrade(c, c.focus);
  if (fg && fg[2] <= 10) return `Is ${name} the Best ${FOCUS_BY_KEY[c.focus].title} in College Football?`;
  if (c.rank || c.signals.season >= 0.7 || (c.pff?.rk && c.pff.rk <= 10)) return `Is ${name} the Best ${c.position} in College Football?`;
  return `Why Everyone Is Talking About ${name}`;
}

export default function VideoSuggester({ players, videos, generateSlug, stateNames, onPlayerAdded, onPlayerUpdated, onCreate, onClose }) {
  // Selected positions; empty = All.
  const [positions, setPositions] = useState([]);
  const [levels, setLevels] = useState(["powerhouse", "p4", "g5"]);
  const [includeOutside, setIncludeOutside] = useState(true);
  const classOptions = useMemo(collegeClasses, []);
  const [classes, setClasses] = useState(classOptions);
  const [strength, setStrength] = useState(DEFAULT_STRENGTH);
  const [focus, setFocus] = useState("overall");
  const [showWeights, setShowWeights] = useState(false);
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);
  const [adding, setAdding] = useState(null);
  const [error, setError] = useState("");
  const [poolSize, setPoolSize] = useState(0);
  // Session cache: shared docs once, rosters / box scores as filters need them.
  const cache = useRef({ base: null, rosters: new Map(), pff: new Map(), boxes: new Map() });

  // playerId -> ms of their most recent video.
  const lastVideoMs = useMemo(() => {
    const map = new Map();
    (videos || []).forEach((v) => {
      const ms = msOf(v.Date);
      (v.playerIds || []).forEach((id) => { if (!map.has(id) || map.get(id) < ms) map.set(id, ms); });
    });
    return map;
  }, [videos]);

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const playersBySlug = useMemo(() => new Map(players.filter((p) => p.Slug).map((p) => [p.Slug, p])), [players]);

  const togglePosition = (pos) => setPositions((prev) => (prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]));
  const toggleLevel = (key) => setLevels((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const toggleClass = (cls) => setClasses((prev) => (prev.includes(cls) ? prev.filter((c) => c !== cls) : [...prev, cls]));

  const loadBase = async () => {
    if (cache.current.base) return cache.current.base;
    const [schoolsSnap, cfbdSnap, analyticsSnap, leadersSnap, slateSnap] = await Promise.all([
      getDocs(collection(db, "schools")),
      getDocs(query(collection(db, "cfbdPlayers"), where("mappingStatus", "in", ["verified", "suggested"]))),
      getDocs(collection(db, "analytics")),
      getDoc(doc(db, "cfbLeaders", "current")),
      getDoc(doc(db, "liveSlate", "current")),
    ]);
    const schools = schoolsSnap.docs.map((d) => ({ name: d.id, conf: d.data().Conference, teamId: d.data().CFBDTeamId }));
    const wdByCfbd = new Map();
    cfbdSnap.docs.forEach((d) => { if (d.data().wedraftPlayerId) wdByCfbd.set(d.id, d.data().wedraftPlayerId); });
    const viewsBySlug = new Map();
    analyticsSnap.docs.forEach((d) => { const x = d.data(); if (!x.type || x.type === "player") viewsBySlug.set(d.id, x.pageViews || {}); });

    // This week's and last week's finals from the last 10 days, by team.
    const slate = slateSnap.data() || {};
    const prevWeek = slate.week > 1
      ? (await getDoc(doc(db, "liveSlate", `week-${slate.season}-${slate.seasonType}-${slate.week - 1}`))).data()
      : null;
    const cutoff = Date.now() - LAST_GAME_WINDOW_MS;
    const finalsByTeam = new Map();
    [...(prevWeek?.games || []), ...(slate.games || [])]
      .filter((g) => g.status === "final" && msOf(g.startDate) >= cutoff)
      .forEach((g) => ["home", "away"].forEach((side) => {
        const team = g[side], opp = g[side === "home" ? "away" : "home"];
        if (team?.providerTeamId == null) return;
        const key = String(team.providerTeamId);
        if (!finalsByTeam.has(key)) finalsByTeam.set(key, []);
        finalsByTeam.get(key).push({
          id: String(g.id), startMs: msOf(g.startDate), opponent: opp?.school || opp?.name || "",
          teamPoints: team.points, opponentPoints: opp?.points, record: team.record,
        });
      }));
    finalsByTeam.forEach((list) => list.sort((a, b) => b.startMs - a.startMs));

    const base = { schools, wdByCfbd, viewsBySlug, ranks: rankIndex(leadersSnap.data()), finalsByTeam };
    cache.current.base = base;
    return base;
  };

  const loadRosters = async (teamIds) => {
    const { rosters } = cache.current;
    await Promise.all(teamIds.filter((id) => !rosters.has(id)).map(async (id) => {
      const snap = await getDoc(doc(db, "cfbRosters", id));
      rosters.set(id, snap.exists() ? { id, ...snap.data() } : null);
    }));
  };

  // PFF grades per team (admin-only docs). A failed read just means no PFF
  // signal for that team.
  const loadPff = async (teamIds) => {
    const { pff } = cache.current;
    await Promise.all(teamIds.filter((id) => !pff.has(id)).map(async (id) => {
      try {
        const snap = await getDoc(doc(db, "pffGrades", id));
        pff.set(id, snap.exists() ? snap.data().players || {} : {});
      } catch (e) {
        console.warn("PFF grades unavailable for team", id, e.code || e);
        pff.set(id, {});
      }
    }));
  };

  // Box score → athlete id → stats.
  const loadBoxes = async (gameIds) => {
    const { boxes } = cache.current;
    await Promise.all(gameIds.filter((id) => !boxes.has(id)).map(async (id) => {
      const snap = await getDoc(doc(db, "liveGames", id, "box", "players"));
      const lines = new Map();
      (snap.data()?.teams || []).forEach((t) => (t.players || []).forEach((p) => lines.set(String(p.id), p.stats)));
      boxes.set(id, lines);
    }));
  };

  const suggest = async () => {
    setRunning(true);
    setError("");
    setResults(null);
    try {
      const { schools, wdByCfbd, viewsBySlug, ranks, finalsByTeam } = await loadBase();
      const now = Date.now();
      const posOk = (pos) => !positions.length || positions.includes(pos);
      // Already-drafted classes are out; one past the last option (a
      // far-out Eligible) counts as the last option.
      const lastClass = classOptions[classOptions.length - 1];
      const classOk = (cls) => cls >= classOptions[0] && classes.includes(Math.min(cls, lastClass));
      // Weights over the signals a player has (stats? PFF grade?).
      const weightsCache = new Map();
      const weightsOf = (hasStats, hasPff) => {
        const keys = [...(hasStats ? STAT_SIGNALS : []), ...(hasPff ? ["pff"] : []), ...VIEW_SIGNALS];
        const k = keys.join();
        if (!weightsCache.has(k)) weightsCache.set(k, normalizedWeights(strength, keys));
        return weightsCache.get(k);
      };

      const teams = schools
        .map((s) => ({ ...s, tier: tierOf(s.name, s.conf) }))
        .filter((s) => s.tier && levels.includes(s.tier) && s.teamId != null);
      const teamIds = teams.map((t) => String(t.teamId));
      await Promise.all([loadRosters(teamIds), loadPff(teamIds)]);

      // Every final since each roster's season-total sync needs its box score
      // (the latest one for "last game", any others to bring the totals current).
      const needBoxes = new Set();
      teams.forEach((t) => {
        const roster = cache.current.rosters.get(String(t.teamId));
        const finals = finalsByTeam.get(String(t.teamId)) || [];
        finals.forEach((g, i) => { if (i === 0 || g.startMs > msOf(roster?.updatedAt)) needBoxes.add(g.id); });
      });
      await loadBoxes([...needBoxes]);
      const { boxes } = cache.current;

      const seen = new Set(); // We-Draft ids already in the pool
      const pool = [];
      teams.forEach((t) => {
        const roster = cache.current.rosters.get(String(t.teamId));
        if (!roster) return;
        const syncMs = msOf(roster.updatedAt);
        const finals = finalsByTeam.get(String(t.teamId)) || [];
        const latest = finals[0] || null;
        const pffPlayers = cache.current.pff.get(String(t.teamId)) || {};
        (roster.players || []).forEach((rp) => {
          const cfbdId = String(rp.id);
          const wd = playersById.get(wdByCfbd.get(cfbdId)) || (rp.slug ? playersBySlug.get(rp.slug) : null) || null;
          if (!wd && !includeOutside) return;
          const pos = wd ? (wd.Position || "").toUpperCase() : POS_MAP[(rp.pos || "").toUpperCase()] || (rp.pos || "").toUpperCase();
          if (!posOk(pos)) return;
          const cls = wd ? n(wd.Eligible) : n(eligibleFor(rp));
          if (!classOk(cls)) return;
          const group = groupOf(pos);
          const lastLine = latest ? boxes.get(latest.id)?.get(cfbdId) || null : null;
          const lastProd = production(group, lastLine);
          // Season production brought current: roster totals + any final
          // played after that roster's sync.
          const sinceSync = finals.filter((g) => g.startMs > syncMs).reduce((sum, g) => sum + production(group, boxes.get(g.id)?.get(cfbdId)), 0);
          const seasonProd = production(group, rp.s) + sinceSync;
          const pv = wd ? viewsBySlug.get(wd.Slug) || {} : {};
          if (!rp.s && !lastLine && !n(pv.last7Days)) return;
          if (wd) seen.add(wd.id);
          pool.push({
            key: `${t.teamId}-${cfbdId}`, first: rp.first, last: rp.last, position: pos, cls, school: roster.school || t.name,
            tier: t.tier, wd, rp, roster, group, stars: rp.stars,
            season: rp.s || null, syncMs, lastLine, lastProd, seasonProd,
            lastGame: lastLine ? latest : null, teamGames: latest ? gamesInRecord(latest.record) : 0,
            rank: ranks.get(cfbdId) || null, pff: pffPlayers[cfbdId] || null,
            views7: n(pv.last7Days), views30: n(pv.last30Days),
          });
        });
      });

      // We-Draft players with traffic but no roster row (unlinked, or a
      // school without a mapped roster): views only.
      const tierBySchool = new Map(teams.map((t) => [t.name, t.tier]));
      players.forEach((p) => {
        if (seen.has(p.id) || !p.Slug || !classOk(n(p.Eligible)) || !tierBySchool.has(p.School)) return;
        const pos = (p.Position || "").toUpperCase();
        const pv = viewsBySlug.get(p.Slug) || {};
        if (!posOk(pos) || !n(pv.last7Days)) return;
        pool.push({
          key: `wd-${p.id}`, first: p.First, last: p.Last, position: pos, cls: n(p.Eligible), school: p.School,
          tier: tierBySchool.get(p.School), wd: p, group: groupOf(pos), season: null, lastLine: null, lastProd: 0, seasonProd: 0,
          lastGame: null, teamGames: 0, rank: null, pff: null, views7: n(pv.last7Days), views30: n(pv.last30Days),
        });
      });

      const scored = pool.map((c) => {
        const restGp = c.lastGame ? c.teamGames - 1 : c.teamGames;
        const restAvg = restGp > 0 ? Math.max(c.seasonProd - c.lastProd, 0) / restGp : 0;
        const breakout = c.lastGame && c.lastProd > 0 && restGp > 0 ? c.lastProd / Math.max(restAvg, 1) : 0;
        const pace = c.views30 > 0 ? (c.views30 / 30) * 7 : 0;
        const momentum = pace > 0 ? c.views7 / pace : c.views7 > 0 ? 2 : 0;
        const hasStats = c.group !== "ol" && (c.seasonProd > 0 || c.lastProd > 0);
        // Only a grade on enough snaps carries a national rank (rk).
        const hasPff = focus === "overall" ? c.pff?.rk != null : !!focusGrade(c, focus);
        return { ...c, restAvg, breakout, momentum, hasStats, hasPff, focus };
      })
        // No stats at a position that produces them = not playing; only OL
        // (no box-score stats at all) can be scored on PFF / views alone.
        // A specific PFF focus keeps only players ranked in it.
        .filter((c) => (focus === "overall" ? c.hasStats || c.hasPff || c.group === "ol" : c.hasPff));

      const statPool = scored.filter((c) => c.hasStats);
      const viewPool = scored.filter((c) => c.wd && c.views7 > 0);
      const pffPool = scored.filter((c) => c.hasPff);
      const pct = {
        last: percentiles(statPool.filter((c) => c.lastGame).map((c) => c.lastProd)),
        breakout: percentiles(statPool.filter((c) => c.breakout > 0).map((c) => c.breakout)),
        season: percentiles(statPool.map((c) => c.seasonProd)),
        pff: percentiles(pffPool.map((c) => (focus === "overall" ? c.pff.g : focusGrade(c, focus)[0]))),
        pffGame: percentiles(pffPool.filter((c) => c.pff.w).map((c) => c.pff.w.g)),
        views: percentiles(viewPool.map((c) => c.views7)),
        momentum: percentiles(viewPool.map((c) => c.momentum)),
      };

      const ranked = scored.map((c) => {
        const rankBonus = c.rank ? (51 - c.rank.rank) / 50 : 0;
        const signals = {
          last: c.lastGame ? pct.last(c.lastProd) : 0,
          breakout: c.breakout > 0 ? pct.breakout(c.breakout) : 0,
          season: c.hasStats ? pct.season(c.seasonProd) * 0.8 + rankBonus * 0.2 : 0,
          pff: !c.hasPff ? 0
            : focus !== "overall" ? pct.pff(focusGrade(c, focus)[0])
            : c.pff.w ? pct.pff(c.pff.g) * 0.7 + pct.pffGame(c.pff.w.g) * 0.3 : pct.pff(c.pff.g),
          views: !c.wd ? NO_PAGE : c.views7 > 0 ? pct.views(c.views7) : 0,
          momentum: !c.wd ? NO_PAGE : c.views7 > 0 ? pct.momentum(c.momentum) : 0,
        };
        const weights = weightsOf(c.hasStats, c.hasPff);
        let score = Object.entries(weights).reduce((t, [k, w]) => t + w * signals[k], 0);
        const sinceVideo = c.wd && lastVideoMs.has(c.wd.id) ? now - lastVideoMs.get(c.wd.id) : null;
        const penalty = sinceVideo == null ? 1 : sinceVideo < 14 * DAY_MS ? 0.5 : sinceVideo < 30 * DAY_MS ? 0.8 : 1;
        score *= penalty;
        return { ...c, signals, weights, score: Math.round(score * 100), sinceVideo, penalty };
      });

      ranked.sort((a, b) => b.score - a.score);
      setPoolSize(scored.length);
      setResults(ranked.slice(0, RESULT_COUNT).map((c) => ({ ...c, title: titleIdea(c) })));
    } catch (e) {
      console.error("Video suggest error:", e);
      setError("Couldn't build suggestions — check console.");
    } finally {
      setRunning(false);
    }
  };

  // Not on We-Draft yet: add him (CFB Universe defaults — mapped position,
  // recruiting-class draft class, Live), then open the video form.
  // Swap a result's We-Draft player (just added, or re-flagged) in place.
  const updateResult = (key, wd) => setResults((prev) => prev && prev.map((r) => (r.key === key ? { ...r, wd } : r)));

  // Returns his We-Draft player, adding him first if he isn't on We-Draft
  // (after a confirm), or null if that's cancelled or fails.
  const ensureOnWeDraft = async (c) => {
    if (c.wd) return c.wd;
    const pos = POS_MAP[(c.rp.pos || "").toUpperCase()];
    if (!pos) { alert(`No We-Draft position for "${c.rp.pos || "?"}" — add ${c.first} ${c.last} from Players → CFB Universe instead.`); return null; }
    const eligible = eligibleFor(c.rp);
    if (!window.confirm(`Add ${c.first} ${c.last} (${pos}, ${c.school}, ${eligible} class) to We-Draft? This creates a live player page.`)) return null;
    try {
      const p = { ...c.rp, school: c.roster.school, team: c.roster.team, teamId: c.roster.teamId };
      const { player, rosterPlayers } = await addRosterPlayer(p, c.roster, { pos, eligible, live: true }, { allPlayers: players, generateSlug, stateNames });
      if (rosterPlayers) c.roster.players = rosterPlayers;
      cache.current.base?.wdByCfbd.set(String(c.rp.id), player.id);
      onPlayerAdded(player);
      updateResult(c.key, player);
      return player;
    } catch (e) {
      console.error("Suggest add-player error:", e);
      alert("Failed to add — check console.");
      return null;
    }
  };

  const addAndCreate = async (c) => {
    setAdding(c.key);
    try {
      const player = await ensureOnWeDraft(c);
      if (player) onCreate(player, c.title);
    } finally {
      setAdding(null);
    }
  };

  // The player's Flag (Video / Watch / Follow) — same field Player Data →
  // Flag and the Content Calendar's Player Bank write. Clicking his current
  // flag clears it.
  const setFlag = async (c, key) => {
    setAdding(c.key);
    try {
      const player = await ensureOnWeDraft(c);
      if (!player) return;
      const Flag = player.Flag === key ? "" : key;
      await updateDoc(doc(db, "players", player.id), { Flag });
      const next = { ...player, Flag };
      updateResult(c.key, next);
      onPlayerUpdated(next);
    } catch (e) {
      console.error("Suggest flag error:", e);
      alert("Failed to set flag — check console.");
    } finally {
      setAdding(null);
    }
  };

  const chip = (active) => ({
    padding: "5px 13px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em",
    border: "2px solid " + GOLD, borderRadius: "20px", cursor: "pointer",
    background: active ? BLUE : "#fff", color: active ? "#fff" : BLUE,
  });

  return (
    <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden", marginBottom: "18px" }}>
      <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Suggest a Video</div>
        <div style={{ color: "#cfe0f5", fontSize: "11px", fontWeight: 700 }}>Every FBS player · last game · season stats · PFF grades · page views</div>
        <button type="button" onClick={onClose} style={{ marginLeft: "auto", background: "transparent", color: "#fff", border: "2px solid #fff", borderRadius: "6px", padding: "4px 10px", fontWeight: 900, fontSize: "11px", cursor: "pointer" }}>
          Close
        </button>
      </div>

      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px", borderBottom: "1px solid #eee" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
          <span style={{ width: "80px", fontSize: "11px", fontWeight: 900, color: "#7a8597", textTransform: "uppercase" }}>Position</span>
          <button type="button" onClick={() => setPositions([])} style={chip(!positions.length)}>All</button>
          {POSITIONS.map((p) => (
            <button key={p} type="button" onClick={() => togglePosition(p)} style={chip(positions.includes(p))}>{p}</button>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
          <span style={{ width: "80px", fontSize: "11px", fontWeight: 900, color: "#7a8597", textTransform: "uppercase" }}>School</span>
          {LEVELS.map((l) => (
            <button key={l.key} type="button" onClick={() => toggleLevel(l.key)} style={chip(levels.includes(l.key))}>{l.label}</button>
          ))}
          <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginLeft: "10px", fontSize: "12px", fontWeight: 800, color: "#3b4756", cursor: "pointer" }}>
            <input type="checkbox" checked={includeOutside} onChange={(e) => setIncludeOutside(e.target.checked)} />
            Include players not on We-Draft
          </label>
          <button
            type="button"
            onClick={suggest}
            disabled={running || !levels.length || !classes.length}
            style={{
              marginLeft: "auto", background: GOLD, color: "#fff", border: "none", borderRadius: "6px", padding: "8px 18px",
              fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.04em",
              cursor: running || !levels.length || !classes.length ? "default" : "pointer", opacity: running || !levels.length || !classes.length ? 0.6 : 1,
            }}
          >
            {running ? "Crunching..." : "Suggest"}
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
          <span style={{ width: "80px", fontSize: "11px", fontWeight: 900, color: "#7a8597", textTransform: "uppercase" }}>Class</span>
          {classOptions.map((cls) => (
            <button key={cls} type="button" onClick={() => toggleClass(cls)} style={chip(classes.includes(cls))}>{cls}</button>
          ))}
          <button
            type="button"
            onClick={() => setShowWeights((s) => !s)}
            style={{ marginLeft: "auto", background: "transparent", color: BLUE, border: "none", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer" }}
          >
            ⚙ Weights {showWeights ? "▴" : "▾"}
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
          <span style={{ width: "80px", fontSize: "11px", fontWeight: 900, color: "#7a8597", textTransform: "uppercase" }}>PFF focus</span>
          {PFF_FOCUS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFocus(f.key)} style={chip(focus === f.key)}>{f.label}</button>
          ))}
        </div>
        {showWeights && (
          <div style={{ background: "#f5f7fa", borderRadius: "8px", padding: "10px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>
            {SIGNALS.map((k) => (
              <div key={k} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                <div style={{ width: "240px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 900, color: INK }}>{SIGNAL_LABEL[k]}</div>
                  <div style={{ fontSize: "10px", fontWeight: 700, color: "#7a8597" }}>{SIGNAL_HELP[k]}</div>
                </div>
                {STRENGTHS.map((x) => (
                  <button key={x.key} type="button" onClick={() => setStrength((prev) => ({ ...prev, [k]: x.key }))}
                    style={{ ...chip(strength[k] === x.key), padding: "3px 11px", fontSize: "11px" }}>
                    {x.label}
                  </button>
                ))}
                <span style={{ fontSize: "11px", fontWeight: 800, color: "#7a8597", marginLeft: "4px" }}>
                  {Math.round(normalizedWeights(strength, SIGNALS)[k] * 100)}%
                </span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "10px", fontWeight: 700, color: "#7a8597" }}>
                % = share of a We-Draft player's score. Changes apply on the next Suggest.
              </span>
              <button type="button" onClick={() => setStrength(DEFAULT_STRENGTH)}
                style={{ marginLeft: "auto", background: "transparent", color: BLUE, border: "none", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", cursor: "pointer" }}>
                Reset
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <div style={{ padding: "12px 14px", color: RED, fontWeight: 700, fontSize: "13px" }}>{error}</div>}
      {results && results.length === 0 && (
        <div style={{ padding: "24px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>No players with stats, PFF grades or page views match those filters.</div>
      )}
      {results && results.length > 0 && (
        <div>
          <div style={{ padding: "8px 14px", fontSize: "11px", fontWeight: 700, color: "#aaa" }}>
            Top {results.length} of {poolSize.toLocaleString()} players scored · signals are percentiles within this filter
          </div>
          {results.map((c, i) => (
            <SuggestionCard key={c.key} c={c} index={i} adding={adding === c.key}
              onCreate={() => (c.wd ? onCreate(c.wd, c.title) : addAndCreate(c))}
              onFlag={(key) => setFlag(c, key)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({ c, index, adding, onCreate, onFlag }) {
  const g = c.lastGame;
  const reasons = [];
  if (g) {
    const result = g.teamPoints != null && g.opponentPoints != null ? ` (${g.teamPoints > g.opponentPoints ? "W" : g.teamPoints < g.opponentPoints ? "L" : "T"} ${g.teamPoints}-${g.opponentPoints})` : "";
    const line = statLine(c.group, c.lastLine);
    if (line) reasons.push({ icon: "🔥", text: `Last game vs ${g.opponent}${result}: ${line}` });
  }
  if (c.breakout >= 1.5) reasons.push({ icon: "📈", text: `${c.breakout.toFixed(1)}× the per-game production of the rest of the season` });
  const seasonLine = statLine(c.group, c.season);
  if (seasonLine) {
    const thru = c.syncMs ? ` thru ${new Date(c.syncMs).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "";
    reasons.push({ icon: "📊", text: `Season${thru}: ${seasonLine}` });
  }
  if (c.rank) reasons.push({ icon: "🏅", text: c.rank.label });
  // Admin-only — PFF data never goes on the public site.
  const fg = focusGrade(c, c.focus);
  if (fg) reasons.push({ icon: "🎯", text: `PFF ${FOCUS_BY_KEY[c.focus].label.toLowerCase()} grade ${fg[0]} — #${fg[2]} of ${fg[3]} FBS (${fmt(fg[1])} snaps)` });
  if (c.pff?.rk != null) {
    const p = c.pff;
    const game = p.w ? ` · latest game ${p.w.g} (wk ${p.w.wk})` : "";
    reasons.push({ icon: "🎯", text: `PFF grade ${p.g} — #${p.rk} of ${p.of} FBS ${p.pos}s (${fmt(p.sn)} ${p.cat === "kicking" ? "FG att" : "snaps"})${game}` });
  }
  if (c.wd && c.views7 > 0) {
    const mom = c.momentum >= 1.3 ? ` — ↑ ${c.momentum.toFixed(1)}× the 30-day pace` : c.momentum > 0 && c.momentum < 0.8 ? ` — cooling (${c.momentum.toFixed(1)}× 30-day pace)` : "";
    reasons.push({ icon: "👀", text: `${fmt(c.views7)} page view${c.views7 === 1 ? "" : "s"} in the last 7 days (${fmt(c.views30)} in 30)${mom}` });
  }
  if (!c.wd) reasons.push({ icon: "➕", text: "Not on We-Draft yet — no page views, scored as average traffic" });
  else if (c.sinceVideo == null) reasons.push({ icon: "🆕", text: "No video on this player yet" });
  else reasons.push({ icon: c.penalty < 1 ? "⚠️" : "🎬", text: `Last video ${Math.round(c.sinceVideo / DAY_MS)} days ago${c.penalty < 1 ? " — score marked down" : ""}`, warn: c.penalty < 1 });

  return (
    <div style={{ display: "flex", gap: "14px", padding: "14px", borderTop: "1px solid #f0f0f0", alignItems: "flex-start" }}>
      <div style={{ flexShrink: 0, width: "56px", textAlign: "center" }}>
        <div style={{ fontSize: "11px", fontWeight: 900, color: "#aaa" }}>#{index + 1}</div>
        <div style={{ fontWeight: 900, fontSize: "26px", color: c.score >= 70 ? GREEN : c.score >= 45 ? BLUE : "#7a8597", lineHeight: 1.1 }}>{c.score}</div>
        <div style={{ fontSize: "9px", fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.06em" }}>Score</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "8px" }}>
          {c.wd ? (
            <a href={"/player/" + c.wd.Slug} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 900, fontSize: "16px", color: INK, textDecoration: "none" }}>
              {c.first} {c.last} <span style={{ color: BLUE }}>↗</span>
            </a>
          ) : (
            <span style={{ fontWeight: 900, fontSize: "16px", color: INK }}>{c.first} {c.last}</span>
          )}
          <span style={{ fontSize: "12px", fontWeight: 700, color: "#666" }}>
            {c.position} · {c.school} · {c.cls}{c.stars ? ` · ${c.stars}★ recruit` : ""}
          </span>
          <span style={{ fontSize: "10px", fontWeight: 900, color: "#8a5a00", background: "#fff3d9", borderRadius: "8px", padding: "1px 7px", textTransform: "uppercase" }}>{LEVEL_LABEL[c.tier]}</span>
          {!c.wd && (
            <span style={{ fontSize: "10px", fontWeight: 900, color: "#fff", background: "#7a8597", borderRadius: "8px", padding: "1px 7px", textTransform: "uppercase" }}>Not on We-Draft</span>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", margin: "8px 0" }}>
          {Object.keys(c.weights).map((k) => (
            <div key={k} title={`Weight ${Math.round(c.weights[k] * 100)}%`} style={{ minWidth: "92px", background: "#f5f7fa", borderRadius: "6px", padding: "4px 8px" }}>
              <div style={{ fontSize: "9px", fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.05em" }}>{SIGNAL_LABEL[k]}</div>
              <div style={{ height: "5px", background: "#e3e8ef", borderRadius: "3px", marginTop: "3px", overflow: "hidden" }}>
                <div style={{ width: Math.round(c.signals[k] * 100) + "%", height: "100%", background: BLUE }} />
              </div>
            </div>
          ))}
        </div>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "3px" }}>
          {reasons.map((r, i) => (
            <li key={i} style={{ fontSize: "12px", fontWeight: 700, color: r.warn ? RED : "#3b4756" }}>{r.icon} {r.text}</li>
          ))}
        </ul>
        <div style={{ marginTop: "8px", fontSize: "12px", fontWeight: 700, color: "#555" }}>
          <span style={{ fontWeight: 900, color: "#7a8597", textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.05em" }}>Title idea: </span>
          {c.title}
        </div>
      </div>
      <div style={{ flexShrink: 0, width: "150px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <button
          type="button"
          onClick={onCreate}
          disabled={adding}
          style={{ background: c.wd ? GOLD : BLUE, color: "#fff", border: "none", borderRadius: "6px", padding: "7px 12px", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em", cursor: adding ? "default" : "pointer", opacity: adding ? 0.6 : 1 }}
        >
          {adding ? "Saving..." : c.wd ? "+ Create Video" : "+ Add to We-Draft & Create Video"}
        </button>
        {/* Flag him — a player not on We-Draft is added first. */}
        <div style={{ display: "flex", gap: "4px" }} title={c.wd ? "Flag (click again to clear)" : "Adds him to We-Draft, then flags him"}>
          {FLAGS.map((f) => {
            const active = c.wd?.Flag === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => onFlag(f.key)}
                disabled={adding}
                style={{
                  flex: 1, padding: "4px 0", borderRadius: "12px", fontWeight: 900, fontSize: "10px",
                  textTransform: "uppercase", letterSpacing: "0.03em", border: "2px solid " + f.hex,
                  background: active ? f.hex : "#fff", color: active ? "#fff" : f.hex,
                  cursor: adding ? "default" : "pointer", opacity: adding ? 0.6 : 1,
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
