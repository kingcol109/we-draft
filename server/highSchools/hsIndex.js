// server/highSchools/hsIndex.js
//
// Everything the high school pages read, precomputed so a page view is a
// couple of document reads (pages/HighSchoolTeamPage.js,
// pages/HighSchoolRankings.jsx). Built from data already in Firestore, no
// CFBD calls:
//   cfbRosters    current college players (scripts/syncCfbdRosters.js), each
//                 row with CFBD's high school (hs, hss state)
//   historical    drafted players 2000–last year (HighSchool, State)
//   players +     this year's drafted class, still in players (Eligible =
//   draftOrder    the latest draft), matched to its pick by slug
//   cfbdPlayers   CFBD athlete → We-Draft player links
//
// Every US high school counts toward the rankings, page or not: a CFBD school
// that matches one of ours (utils/highSchoolMatch.js — alias / exact in the
// same state; a loose match is another school) counts as ours, otherwise
// under CFBD's own name. Ranks are competition ranks among schools with at
// least one player (ties share a rank: T-3).
//
// Position groups (POS_GROUP): QB RB WR TE OL DL LB DB ST — EDGE counts as
// DL, CB/S as DB, K/P/LS as ST; ATH only in the overall count.
//
// Also sets highSchools.Slug where it's missing or stale (see below).
//
// Writes, all in hsAlumni (public read):
//   hsAlumni/{highSchools id} — one per school with a logo (a page):
//     { school, state, season, draftFrom, draftTo, builtAt,
//       players: [{ c, n, pos, yr, rc, st, s, t, id?, slug? }]  in college
//       drafted: [{ Year, Round, Pick, PickInRound?, Player, Position,
//                   School, "NFL Team" | nflAbbr, Slug? }]
//       stats: { cfb | nfl: { ALL | QB | …: { v, n, nt, s, st } } }
//              v count, n / s national / state rank, nt / st tie flags
//       totals: { nat, state }  schools ranked (with ≥1 college player) }
//   hsAlumni/_rankings_US, hsAlumni/_rankings_{state abbr} — leaderboards:
//     { scope, season, draftFrom, draftTo, builtAt,
//       lists: { cfb | nfl: { ALL | QB | …: [{ k name, st abbr, v, r, t,
//                                               id?, slug?, logo? }] } } }
//
// Runs at the end of scripts/syncCfbdRosters.js, or on its own:
// scripts/buildHsAlumni.js.

const { FieldValue } = require("firebase-admin/firestore");

const FIRST_DRAFT = 2000;
const NATIONAL_TOP = 25;
const STATE_TOP = 15;
const GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "DB", "ST"];
const POS_GROUP = {
  QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE",
  OL: "OL", OT: "OL", OG: "OL", G: "OL", T: "OL", C: "OL", IOL: "OL",
  DL: "DL", DE: "DL", DT: "DL", NT: "DL", EDGE: "DL",
  LB: "LB", OLB: "LB", ILB: "LB", MLB: "LB",
  DB: "DB", CB: "DB", S: "DB", FS: "DB", SS: "DB",
  K: "ST", PK: "ST", P: "ST", LS: "ST",
};

// Same slug math as the admin / page (toHsSlug).
function hsSlug(name, abbr) {
  return `${name || ""} ${abbr || ""}`.replace(/['’`.]/g, "").replace(/[^a-zA-Z0-9\- ]/g, "").trim()
    .replace(/\s+/g, "-").toLowerCase().replace(/-+/g, "-");
}

// Competition ranks for [key, value] pairs (value > 0), best first.
function rankOf(pairs) {
  const sorted = pairs.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const out = new Map();
  const ties = new Map();
  sorted.forEach(([, v]) => ties.set(v, (ties.get(v) || 0) + 1));
  let rank = 0;
  sorted.forEach(([k, v], i) => {
    if (i === 0 || v !== sorted[i - 1][1]) rank = i + 1;
    out.set(k, { r: rank, t: ties.get(v) > 1 });
  });
  return { ranks: out, sorted };
}

async function buildHsIndex(db) {
  const { matchHighSchool, stateName, hsKey, NATIONAL_SCHOOLS, STATE_ABBR } = await import("../../src/utils/highSchoolMatch.js");

  // Our schools, by state (for matching) and by key.
  const docs = (await db.collection("highSchools").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const byState = new Map();
  docs.forEach((x) => { if (!byState.has(x.State)) byState.set(x.State, []); byState.get(x.State).push(x); });
  const docKey = (x) => `${x.Name}|${x.State}`;
  const docByKey = new Map(docs.map((x) => [docKey(x), x]));
  // A school name + state → our school's key, or the raw name's own.
  // Only US high schools are ranked (CFBD also lists academies abroad, like
  // ProKick Australia, with no state).
  const keyFor = (name, state) => {
    if (!name) return null;
    const st = stateName(state);
    if (!STATE_ABBR[st] && !NATIONAL_SCHOOLS[hsKey(name)]) return null;
    const pool = NATIONAL_SCHOOLS[hsKey(name)] ? docs : byState.get(st) || [];
    const m = matchHighSchool(name, st, pool);
    return m && m.how !== "close" ? docKey(m.doc) : `${String(name).trim()}|${st}`;
  };

  // key → { cfb: { ALL, QB… }, nfl: {…} } counts, plus page rows.
  const counts = new Map();
  const bump = (key, metric, pos) => {
    if (!counts.has(key)) counts.set(key, { cfb: {}, nfl: {} });
    const c = counts.get(key)[metric];
    c.ALL = (c.ALL || 0) + 1;
    const g = POS_GROUP[String(pos || "").toUpperCase()];
    if (g) c[g] = (c[g] || 0) + 1;
  };
  const pageRows = new Map(); // key → { players: [], drafted: [] } (pages only)
  const pages = docs.filter((x) => x.Logo1);
  pages.forEach((x) => pageRows.set(docKey(x), { players: [], drafted: [] }));

  // ── In college: every CFBD roster row. ──
  const links = new Map();
  (await db.collection("cfbdPlayers").where("mappingStatus", "in", ["suggested", "verified"]).select("wedraftPlayerId", "wedraftSlug").get())
    .docs.forEach((d) => { const x = d.data(); if (x.wedraftPlayerId) links.set(d.id, { id: x.wedraftPlayerId, slug: x.wedraftSlug || null }); });
  let season = null;
  let collegePlayers = 0;
  (await db.collection("cfbRosters").get()).docs.forEach((d) => {
    const t = d.data();
    if (t.season && (!season || t.season > season)) season = t.season;
    (t.players || []).forEach((p) => {
      const key = keyFor(p.hs, p.hss);
      if (!key) return;
      collegePlayers += 1;
      bump(key, "cfb", p.pos);
      const page = pageRows.get(key);
      if (!page) return;
      const wd = links.get(String(p.id));
      page.players.push({
        c: String(p.id), n: `${p.first || ""} ${p.last || ""}`.trim(), pos: p.pos || null, yr: p.yr ?? null, rc: p.rc ?? null,
        st: p.stars ?? null, s: t.school || t.team || null, t: t.teamId ?? null, ...(wd ? { id: wd.id, slug: wd.slug } : {}),
      });
    });
  });

  // ── Drafted: historical, then the latest class (still in players). ──
  let draftTo = FIRST_DRAFT;
  (await db.collection("historical").get()).docs.forEach((d) => {
    const h = d.data();
    const y = Number(h.Year);
    if (!h.HighSchool || !y || y < FIRST_DRAFT) return;
    draftTo = Math.max(draftTo, y);
    const key = keyFor(h.HighSchool, h.State);
    if (!key) return;
    bump(key, "nfl", h.Position);
    const page = pageRows.get(key);
    if (page) {
      page.drafted.push({
        Year: String(h.Year), Round: h.Round ?? null, Pick: h.Pick ?? null,
        Player: h.Player || [h.First, h.Last].filter(Boolean).join(" "), Position: h.Position || null,
        School: h.School || null, "NFL Team": h["NFL Team"] || null,
      });
    }
  });
  const picks = new Map();
  (await db.collection("draftOrder").get()).docs.forEach((d) => {
    const x = d.data();
    if (x.Selection) picks.set(x.Selection, x);
  });
  const latest = String(draftTo + 1);
  const latestClass = (await db.collection("players").where("Eligible", "==", latest).get()).docs.map((d) => d.data());
  let latestDrafted = 0;
  latestClass.forEach((p) => {
    const pick = picks.get(p.Slug);
    if (!pick || !p.HighSchool) return;
    latestDrafted += 1;
    const key = keyFor(p.HighSchool, p.State);
    if (!key) return;
    bump(key, "nfl", p.Position);
    const page = pageRows.get(key);
    if (page) {
      page.drafted.push({
        Year: latest, Round: pick.Round ?? null, Pick: pick.Pick ?? null, PickInRound: true,
        Player: `${p.First || ""} ${p.Last || ""}`.trim(), Position: p.Position || null,
        School: p.School || null, nflAbbr: pick.Team || null, Slug: p.Slug || null,
      });
    }
  });
  if (latestDrafted) draftTo = Number(latest);

  // ── Ranks: national and within each state, per metric and group. ──
  const stateOf = (key) => key.split("|")[1] || "";
  const keys = [...counts.keys()];
  const states = [...new Set(keys.map(stateOf))].filter((s) => STATE_ABBR[s]);
  const rank = { nat: {}, state: {} }; // [metric][group] → { ranks, sorted } ; state: [st][metric][group]
  for (const metric of ["cfb", "nfl"]) {
    rank.nat[metric] = {};
    for (const g of ["ALL", ...GROUPS]) rank.nat[metric][g] = rankOf(keys.map((k) => [k, counts.get(k)[metric][g] || 0]));
  }
  for (const st of states) {
    const inState = keys.filter((k) => stateOf(k) === st);
    rank.state[st] = {};
    for (const metric of ["cfb", "nfl"]) {
      rank.state[st][metric] = {};
      for (const g of ["ALL", ...GROUPS]) rank.state[st][metric][g] = rankOf(inState.map((k) => [k, counts.get(k)[metric][g] || 0]));
    }
  }

  const batchOps = [];
  const now = FieldValue.serverTimestamp();
  const base = { season, draftFrom: FIRST_DRAFT, draftTo, builtAt: now };

  // Leaderboard rows link to a page when the school has one.
  const row = (key, v, rk) => {
    const [name, st] = key.split("|");
    const d = docByKey.get(key);
    return {
      k: name, st: STATE_ABBR[st] || st, v, r: rk.r, t: rk.t,
      ...(d?.Logo1 ? { id: d.id, slug: hsSlug(d.Name, STATE_ABBR[d.State] || d.State), logo: d.Logo1 } : {}),
    };
  };
  const board = (r, top) => r.sorted.slice(0, top).map(([k, v]) => row(k, v, r.ranks.get(k)));
  const lists = (src, top) => Object.fromEntries(["cfb", "nfl"].map((m) => [m, Object.fromEntries(["ALL", ...GROUPS].map((g) => [g, board(src[m][g], top)]))]));
  batchOps.push(["_rankings_US", { scope: "US", ...base, lists: lists(rank.nat, NATIONAL_TOP) }]);
  states.forEach((st) => batchOps.push([`_rankings_${STATE_ABBR[st]}`, { scope: STATE_ABBR[st], state: st, ...base, lists: lists(rank.state[st], STATE_TOP) }]));

  // Each page's own doc.
  const natRanked = rank.nat.cfb.ALL.sorted.length;
  pages.forEach((x) => {
    const key = docKey(x);
    const c = counts.get(key) || { cfb: {}, nfl: {} };
    const st = x.State;
    const stats = {};
    for (const metric of ["cfb", "nfl"]) {
      stats[metric] = {};
      for (const g of ["ALL", ...GROUPS]) {
        const v = c[metric][g] || 0;
        if (!v && g !== "ALL") continue;
        const n = rank.nat[metric][g].ranks.get(key);
        const s = rank.state[st]?.[metric]?.[g]?.ranks.get(key);
        stats[metric][g] = { v, ...(n ? { n: n.r, nt: n.t } : {}), ...(s ? { s: s.r, st: s.t } : {}) };
      }
    }
    const rows = pageRows.get(key);
    rows.drafted.sort((a, b) => Number(b.Year) - Number(a.Year) || (Number(a.Round) || 99) - (Number(b.Round) || 99) || (Number(a.Pick) || 999) - (Number(b.Pick) || 999));
    batchOps.push([x.id, {
      school: x.Name, state: st, ...base, players: rows.players, drafted: rows.drafted, stats,
      totals: { nat: natRanked, state: rank.state[st]?.cfb.ALL.sorted.length || 0 },
    }]);
  });

  // highSchools.Slug — what the page looks its school up by (one indexed
  // query). The admin writes it on save; this fills in schools added any
  // other way, and fixes a stale one.
  let slugsFixed = 0;
  const slugOps = docs.filter((x) => x.Name && x.Slug !== hsSlug(x.Name, STATE_ABBR[x.State] || x.State));
  for (let i = 0; i < slugOps.length; i += 400) {
    const b = db.batch();
    slugOps.slice(i, i + 400).forEach((x) => b.update(db.collection("highSchools").doc(x.id), { Slug: hsSlug(x.Name, STATE_ABBR[x.State] || x.State) }));
    await b.commit();
    slugsFixed += Math.min(400, slugOps.length - i);
  }

  for (let i = 0; i < batchOps.length; i += 100) {
    const b = db.batch();
    batchOps.slice(i, i + 100).forEach(([id, data]) => b.set(db.collection("hsAlumni").doc(id), data));
    await b.commit();
  }
  return {
    pages: pages.length, leaderboards: states.length + 1, schoolsRanked: natRanked,
    slugsFixed, collegePlayers, drafted: keys.reduce((n, k) => n + (counts.get(k).nfl.ALL || 0), 0), draftTo,
  };
}

module.exports = { buildHsIndex, hsSlug };
