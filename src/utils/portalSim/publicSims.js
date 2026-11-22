// src/utils/portalSim/publicSims.js
//
// Saved Transfer Portal Sim classes and the public ones — the Draft Sim's
// (utils/draftSim/publicSims.js), for the portal (user, 2026-11-18). Saving
// from the Final screen writes the user's own copy, users/{uid}/portalSims/
// {id}, public by default, and a public copy at the same id,
// publicPortalSims/{id} (+ uid, username). Every portal run is one team, so
// every class can be public. Making one private takes the public copy down;
// public again puts it back. Community (components/portalSim/PortalCommunity.jsx)
// lists the public ones (Recent Classes). Insights come from EVERY finished
// run, shared or not (portalSimResults, below).
//
// A class (classRecord):
//   { season, team (slug), school, frequency, live,
//     grade, rank, of (classes ranked), eff (money-efficiency grade), spent,
//     verdict, pct (roster strength change, %), lost, toNfl, kept,
//     signings: [{ id, name, pos, stars, from (slug), fromSchool, nil, w }] }
import { addDoc, collection, count, doc, getAggregateFromServer, getDocs, limit, orderBy, query, serverTimestamp, sum, Timestamp, where, writeBatch } from "firebase/firestore";
import { db } from "../../firebase";
import { countPortalSim } from "./usage";

export const SIM_PATH = "/portalsim";
export const CLASSES_PATH = "/portalsim/classes";
export const COMMUNITY_PATH = "/portalsim/community";
export const RECENT_PATH = "/portalsim/recent";
const PUBLIC = "publicPortalSims";
const MINE = "portalSims";
const mineRef = (uid, id) => doc(db, "users", uid, MINE, id);
const publicRef = (id) => doc(db, PUBLIC, id);

// The fields a class keeps — no more than these reach Firestore.
const KEYS = ["season", "team", "school", "frequency", "live", "grade", "rank", "of", "eff", "spent", "verdict", "pct", "lost", "toNfl", "kept", "signings"];
const pickRec = (rec) => Object.fromEntries(KEYS.filter((k) => rec[k] !== undefined).map((k) => [k, rec[k]]));
const publicCopy = (uid, username, sim) => ({ ...pickRec(sim), uid, username: username || "", createdAt: sim.createdAt || serverTimestamp() });

// rec: classRecord's shape → the new class's id.
export async function savePortalSim(uid, username, rec) {
  const ref = doc(collection(db, "users", uid, MINE));
  const sim = { ...pickRec(rec), visibility: "public", createdAt: serverTimestamp() };
  const batch = writeBatch(db);
  batch.set(ref, sim);
  batch.set(publicRef(ref.id), publicCopy(uid, username, sim));
  await batch.commit();
  return ref.id;
}

export async function setPortalSimVisibility(uid, username, sim, visibility) {
  const batch = writeBatch(db);
  batch.update(mineRef(uid, sim.id), { visibility });
  if (visibility === "public") batch.set(publicRef(sim.id), publicCopy(uid, username, sim));
  else batch.delete(publicRef(sim.id));
  await batch.commit();
}

export async function deletePortalSim(uid, id) {
  const batch = writeBatch(db);
  batch.delete(mineRef(uid, id));
  batch.delete(publicRef(id));
  await batch.commit();
}

export async function loadMyPortalSims(uid) {
  const snap = await getDocs(query(collection(db, "users", uid, MINE), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// The newest public classes, every school or one.
export async function loadRecentPortalSims({ team = "", max = 60 } = {}) {
  const q = team
    ? query(collection(db, PUBLIC), where("team", "==", team), orderBy("createdAt", "desc"), limit(max))
    : query(collection(db, PUBLIC), orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ── Results: EVERY finished run (user, 2026-11-18: "every user transfer
// class is used for these stats regardless if they share the class") —
// portalSimResults/{auto id}, written once as the portal closes (signed in
// or not, saved or not). No user on them: { season, team, school, live,
// frequency, grade, verdict, pct, n (signings), spent, signings, createdAt }.
// Community → Insights reads them: totals by server-side count / sum, the
// lists from the newest INSIGHTS_SAMPLE.
const RESULTS = "portalSimResults";
// Class grades best → worst, for sorting (My Classes' best class).
const GRADE_ORDER = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"];
export const gradeIndex = (g) => { const i = GRADE_ORDER.indexOf(g); return i < 0 ? GRADE_ORDER.length : i; };
export const INSIGHTS_SAMPLE = 500;
export const WEEK_MS = 7 * 86400000;
const recorded = new Set(); // runs already recorded this session (key: team-seed)
export async function recordPortalResult(key, rec) {
  if (recorded.has(key)) return;
  recorded.add(key);
  countPortalSim("finished", String(rec.team || "")); // the day's counter (utils/portalSim/usage.js)
  const signings = (rec.signings || []).slice(0, 80).map((p) => ({
    id: String(p.id), name: String(p.name || ""), pos: String(p.pos || ""), stars: Number(p.stars) || 0,
    from: String(p.from || ""), fromSchool: String(p.fromSchool || ""), nil: Math.round(Number(p.nil) || 0),
  }));
  await addDoc(collection(db, RESULTS), {
    season: Number(rec.season) || 0, team: String(rec.team), school: String(rec.school || ""), live: !!rec.live, frequency: String(rec.frequency || "default"),
    grade: rec.grade || null, verdict: rec.verdict || null, pct: Number(rec.pct) || 0,
    n: signings.length, spent: Math.round(Number(rec.spent) || 0), signings, createdAt: serverTimestamp(),
  }).catch((e) => { recorded.delete(key); throw e; });
}

// Totals over every run (since: ms, or 0 for all time): runs finished,
// transfers signed, NIL spent.
export async function portalTotals(since = 0) {
  const base = collection(db, RESULTS);
  const q = since ? query(base, where("createdAt", ">=", Timestamp.fromMillis(since))) : base;
  // The count needs no index; the two sums do (firestore.indexes.json:
  // portalSimResults n + spent). Without them, signings / spent come back
  // null and the page adds up the runs it loaded instead.
  const [c, sums] = await Promise.all([
    getAggregateFromServer(q, { runs: count() }),
    getAggregateFromServer(q, { signings: sum("n"), spent: sum("spent") }).catch((e) => { console.warn("Portal insights sums:", e?.code || e); return null; }),
  ]);
  const d = sums ? sums.data() : null;
  return { runs: c.data().runs || 0, signings: d ? d.signings || 0 : null, spent: d ? d.spent || 0 : null };
}
// The newest runs, for the lists.
export async function loadPortalResults({ since = 0, max = INSIGHTS_SAMPLE } = {}) {
  const base = collection(db, RESULTS);
  const q = since
    ? query(base, where("createdAt", ">=", Timestamp.fromMillis(since)), orderBy("createdAt", "desc"), limit(max))
    : query(base, orderBy("createdAt", "desc"), limit(max));
  return (await getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Positions as Insights groups them: OT / IOL → OL, CB / S → DB, K and P together.
const POS_GROUP = { OT: "OL", IOL: "OL", OG: "OL", C: "OL", CB: "DB", S: "DB", K: "K/P", P: "K/P" };
export const POS_ORDER = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB", "K/P"];
const groupOf = (pos) => POS_GROUP[pos] || pos;

// runs: portalSimResults docs → the lists.
//   topTeams     the schools users run, most first
//   topPlayers   the transfers signed most (total times) and the 3
//                schools users take each to most (dests)
//   mostValued   the transfer users pay the most NIL on average
//                (signed 2+ times when anyone has been)
//   positions    how users value each position: average NIL per signing
//                and its share of all NIL spent
export function portalInsights(runs) {
  const teams = {};
  const players = {};
  const pos = {};
  let nilAll = 0;
  runs.forEach((s) => {
    teams[s.team] = teams[s.team] || { t: s.team, school: s.school, n: 0 };
    teams[s.team].n += 1;
    (s.signings || []).forEach((p) => {
      const k = String(p.id);
      const e = (players[k] = players[k] || { ...p, n: 0, to: {}, nil: 0 });
      e.n += 1;
      e.nil += p.nil || 0;
      e.to[s.team] = (e.to[s.team] || 0) + 1;
      const g = groupOf(p.pos);
      const x = (pos[g] = pos[g] || { pos: g, n: 0, nil: 0 });
      x.n += 1;
      x.nil += p.nil || 0;
      nilAll += p.nil || 0;
    });
  });
  const all = Object.values(players).map((p) => {
    // Where users take him, most often first (user, 2026-11-22: show the
    // top 3) — dests [{ t, n }]; dest / destN stay for older readers.
    const dests = Object.entries(p.to).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => ({ t, n }));
    return { ...p, avgNil: p.nil / p.n, dest: dests[0].t, destN: dests[0].n, dests };
  });
  const topTeams = Object.values(teams).sort((a, b) => b.n - a.n);
  const topPlayers = [...all].sort((a, b) => b.n - a.n || b.stars - a.stars || b.avgNil - a.avgNil).slice(0, 10);
  const repeat = all.some((p) => p.n >= 2) ? all.filter((p) => p.n >= 2) : all;
  const mostValued = [...repeat].sort((a, b) => b.avgNil - a.avgNil)[0] || null;
  const positions = POS_ORDER.filter((g) => pos[g]).map((g) => ({ ...pos[g], avg: pos[g].nil / pos[g].n, share: nilAll ? pos[g].nil / nilAll : 0 }));
  return { runs: runs.length, topTeams, topPlayers, mostValued, positions };
}
