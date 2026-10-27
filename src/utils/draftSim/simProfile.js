// src/utils/draftSim/simProfile.js
//
// A signed-in user's Sim Profile — one per class (2027, 2028) — running
// totals over the Draft Sims they finish, saved or not, read by the Sim
// Profile page (components/draftSim/SimProfile.jsx) and the end screen's
// snapshot. Only finished single-team sims on the default settings count
// (onDefaults — speed and desk chatter don't matter), so the numbers
// compare like with like; the streak counts any finished sim.
// Owner-only docs (firestore.rules):
//   users/{uid}/simProfile/{year}
//     { sims (finished), picks,
//       teams: { [abbr]: sims }, positions: { [pos]: picks },
//       firsts: { [pos]: each team's first pick }, schools: { [school]: picks },
//       players: { [id]: picks }, playerInfo: { [id]: { name, slug, pos, school } },
//       grades: { [letter]: team grades },
//       best / worst: the biggest value pick and the biggest reach
//         ({ value, name, slug, pos, school, team, overall, round, year }),
//       bestDraft: the highest-graded team ({ score, letter, team, year, day }),
//       lastAt }
//   users/{uid}/simProfile/streak
//     { current, best, lastDay } — days in a row (Eastern time) with any
//     sim finished, any class or settings.
// Fire-and-forget, like stats.js: a failed write never touches the sim.
import { doc, getDoc, setDoc, increment, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebase";
import { SPECIALISTS, DEFAULT_VARIANCE } from "./engine";
import { statsDay } from "./stats";

// The Sim Profile page.
export const PROFILE_PATH = "/draftsim/profile";
export const simProfileRef = (uid, year) => doc(db, "users", uid, "simProfile", String(year));
export const streakRef = (uid) => doc(db, "users", uid, "simProfile", "streak");

// Whether a run counts toward the profile: a single-team Draft Sim on the
// community board, the real order, normal CPU trades and variance, the
// class's own player pool, and every round the class's board can fill (up
// to defaultRounds). cfg: DraftSim.jsx's run config; maxRounds: the class's
// (2028's board is thin); defaultExpanded: the class's default pool.
export function onDefaults(cfg, { maxRounds, defaultRounds, defaultExpanded }) {
  return cfg.mode !== "mock" && cfg.teams.length === 1 && cfg.board !== "mine"
    && (!cfg.orderMode || cfg.orderMode === "real")
    && (!cfg.cpuTrades || cfg.cpuTrades === "normal")
    && (!cfg.variance || cfg.variance === DEFAULT_VARIANCE)
    && !!cfg.expanded === defaultExpanded
    && Math.min(cfg.baseRounds ?? cfg.rounds, maxRounds) >= Math.min(defaultRounds, maxRounds);
}

const quietly = (p) => p.catch((e) => console.warn("Sim profile:", e?.code || e));
// { [key]: increment(times it appears) }.
const bump = (keys) => {
  const counts = {};
  keys.filter(Boolean).forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
  return Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, increment(n)]));
};

// A pick's value against the board: how many spots after his board rank he
// went (a reach is negative). Kickers and punters aren't measured.
export const pickValueOf = (overall, prospect) => (SPECIALISTS.includes(prospect.Position) ? null : overall - prospect.rank);

// "2026-10-27" → the day after / before.
const shiftDay = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// The streak as it stands today: 0 once a whole day's gone by without a sim.
export function liveStreak(s) {
  if (!s?.lastDay) return 0;
  const today = statsDay();
  return s.lastDay === today || s.lastDay === shiftDay(today, -1) ? s.current || 0 : 0;
}

// The last run's writes, so the end screen's snapshot reads the profile
// with that run in it.
let lastWrite = Promise.resolve();
export const profileWritten = () => lastWrite;
const track = (p) => { lastWrite = Promise.all([lastWrite, p.catch(() => {})]); };

// A finished run that counts (onDefaults). hauls: engine teamHaul for the
// user's team.
export function recordSimProfile(uid, run) {
  if (uid) track(writeProfile(uid, run));
}

// Any finished sim keeps the streak going — whatever its settings.
export function recordStreak(uid) {
  if (uid) track(writeStreak(uid));
}

async function writeStreak(uid) {
  const today = statsDay();
  let cur = {};
  try { cur = (await getDoc(streakRef(uid))).data() || {}; } catch (e) { /* start one */ }
  if (cur.lastDay === today) return undefined;
  const current = cur.lastDay === shiftDay(today, -1) ? (cur.current || 0) + 1 : 1;
  return quietly(setDoc(streakRef(uid), { current, best: Math.max(current, cur.best || 0), lastDay: today }));
}

async function writeProfile(uid, { year, hauls }) {
  const ref = simProfileRef(uid, year);
  const mine = hauls.filter((h) => h.rows.length);
  const rows = mine.flatMap((h) => h.rows.map((r) => ({ ...r, team: h.team })));
  if (!rows.length) return undefined;
  const pickOf = ({ pick, prospect, team }, value) => ({
    value, name: `${prospect.First} ${prospect.Last}`, slug: prospect.Slug || "", pos: prospect.Position, school: prospect.School || "",
    team, overall: pick.overall, round: pick.round, year: String(year),
  });
  let best = null;
  let worst = null;
  rows.forEach((r) => {
    const value = pickValueOf(r.pick.overall, r.prospect);
    if (value == null) return;
    if (!best || value > best.value) best = pickOf(r, value);
    if (!worst || value < worst.value) worst = pickOf(r, value);
  });
  const top = mine.reduce((a, h) => (!a || h.score > a.score ? h : a), null);
  const bestDraft = { score: top.score, letter: top.letter, team: top.team, year: String(year), day: statsDay() };
  const update = {
    sims: increment(1), picks: increment(rows.length), lastAt: serverTimestamp(),
    teams: bump(mine.map((h) => h.team)),
    positions: bump(rows.map((r) => r.prospect.Position)),
    firsts: bump(mine.map((h) => h.rows[0].prospect.Position)),
    schools: bump(rows.map((r) => r.prospect.School)),
    players: bump(rows.map((r) => r.prospect.id)),
    playerInfo: Object.fromEntries(rows.map(({ prospect: p }) => [p.id, { name: `${p.First} ${p.Last}`, slug: p.Slug || "", pos: p.Position, school: p.School || "" }])),
    grades: bump(mine.map((h) => h.letter)),
  };
  try {
    const cur = (await getDoc(ref)).data() || {};
    if (best && (!cur.best || best.value > cur.best.value)) update.best = best;
    if (worst && (!cur.worst || worst.value < cur.worst.value)) update.worst = worst;
    if (!cur.bestDraft || bestDraft.score > cur.bestDraft.score) update.bestDraft = bestDraft;
  } catch (e) { /* still count the run */ }
  return quietly(setDoc(ref, update, { merge: true }));
}

// A letter grade as points (A+ 4.3 … F- 0), and back.
const POINTS = { "A+": 4.3, A: 4, "A-": 3.7, "B+": 3.3, B: 3, "B-": 2.7, "C+": 2.3, C: 2, "C-": 1.7, "D+": 1.3, D: 1, "D-": 0.7, F: 0.3, "F-": 0 };
export function averageGrade(grades = {}) {
  let n = 0;
  let total = 0;
  Object.entries(grades).forEach(([l, c]) => { if (POINTS[l] != null) { n += c; total += POINTS[l] * c; } });
  if (!n) return null;
  const avg = total / n;
  return Object.entries(POINTS).reduce((a, b) => (Math.abs(b[1] - avg) < Math.abs(a[1] - avg) ? b : a))[0];
}
