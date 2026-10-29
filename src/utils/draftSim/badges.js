// src/utils/draftSim/badges.js
//
// Draft Sim badges — one-time achievements, earned once each, that pop up
// in the sim when they're earned (like Xbox achievements) and go on a
// signed-in user's Sim Profile (signed out, they still pop up, and the end
// screen asks them to make an account to keep them). Written in Admin →
// Mock Draft → Badges (AdminSimBadges.jsx); what earns each one is wired in
// badgeRules.js. Every badge shows the circle We-Draft logo (BADGE_LOGO),
// ringed in its rarity's color.
//   simBadges/{id} { title, description, rarity, active, createdAt, updatedAt }
//   users/{uid}/simProfile/badges
//     { earned: { [badgeId]: { at, year, team } },
//       sims (finished, any settings), teams: { [abbr]: sims drafted as },
//       drafted: { [playerId]: times drafted } } — the totals the profile
//     badges (badgeRules.js scope "profile") read; first written with the
//     Sim Profile's own totals so far (simProfile.js) folded in.
// A badge is awarded only when it's wired and active — an admin also earns
// wired badges that aren't active yet, to try them out first. Admins read
// and write simBadges; anyone else reads only active ones (firestore.rules).
import { collection, doc, getDoc, getDocs, query, where, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebase";
import { streakRef, simProfileRef, profileWritten, liveStreak } from "./simProfile";
import { SIM_YEARS } from "./years";
import { isWired, profileBadges, classOf } from "./badgeRules";

export const badgesCol = () => collection(db, "simBadges");
export const badgeRef = (id) => doc(db, "simBadges", id);
export const earnedRef = (uid) => doc(db, "users", uid, "simProfile", "badges");
export const BADGE_LOGO = "/wd-icon.png";

// Rarest last. color: the badge's accent.
export const RARITIES = [
  { key: "common", label: "Common", color: "#9fb0c8" },
  { key: "uncommon", label: "Uncommon", color: "#4ade80" },
  { key: "rare", label: "Rare", color: "#58a6ff" },
  { key: "elite", label: "Elite", color: "#f6a21d" },
];
export const rarityOf = (key) => RARITIES.find((r) => r.key === key) || RARITIES[0];
const rarityIndex = (key) => Math.max(0, RARITIES.findIndex((r) => r.key === key));

// The badges that can be earned, commonest first → { [id]: badge }: the
// active, wired ones (admin: every wired one).
export async function loadBadges(admin = false) {
  const snap = await getDocs(admin ? badgesCol() : query(badgesCol(), where("active", "==", true)));
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((b) => isWired(b.id))
    .sort((a, b) => rarityIndex(a.rarity) - rarityIndex(b.rarity) || (a.title || "").localeCompare(b.title || ""));
  return Object.fromEntries(list.map((b) => [b.id, b]));
}

// The user's earned badges ({ [id]: { at, year, team } }); none → {}.
export async function loadEarned(uid) {
  const s = await getDoc(earnedRef(uid));
  return (s.exists() && s.data().earned) || {};
}

// The player ids the user's evaluated (Armchair Scout).
export async function loadEvaluated(uid) {
  const snap = await getDocs(collection(db, "users", uid, "evaluations"));
  return new Set(snap.docs.map((d) => d.data().playerId || d.id));
}

const add = (m, keys) => {
  const out = { ...m };
  keys.filter(Boolean).forEach((k) => { out[k] = (out[k] || 0) + 1; });
  return out;
};

// The last award's write, so the Sim Profile reads its badges with it in.
let lastWrite = Promise.resolve();
export const badgesWritten = () => lastWrite;

// A finished sim, signed in: its totals onto the badges doc, and every
// badge it's earned that they hadn't (runIds: badgeRules runBadges, plus
// the profile badges the new totals earn) → the ids newly earned. badges:
// loadBadges' — only those can be earned. Never throws.
export function awardBadges(uid, { state, year, runIds, badges }) {
  const p = writeAward(uid, { state, year, runIds, badges }).catch((e) => { console.warn("Sim badges:", e?.code || e); return []; });
  lastWrite = Promise.all([lastWrite, p]);
  return p;
}

async function writeAward(uid, { state, year, runIds, badges }) {
  // After the run's streak write (simProfile.js recordStreak).
  await profileWritten();
  const [cur, streak] = await Promise.all([getDoc(earnedRef(uid)), getDoc(streakRef(uid))]);
  let base = cur.exists() ? cur.data() : null;
  // The first time: start from the Sim Profile's totals so far.
  if (!base) {
    const profs = await Promise.all(SIM_YEARS.map((y) => getDoc(simProfileRef(uid, y)).then((s) => (s.exists() ? s.data() : {})).catch(() => ({}))));
    const sum = (key) => profs.reduce((m, p) => { Object.entries(p[key] || {}).forEach(([k, n]) => { m[k] = (m[k] || 0) + n; }); return m; }, {});
    base = { earned: {}, sims: profs.reduce((t, p) => t + (p.sims || 0), 0), teams: sum("teams"), drafted: sum("players") };
  }
  const mine = state.userTeams.map((t) => classOf(state, t));
  const totals = {
    sims: (base.sims || 0) + 1,
    teams: add(base.teams || {}, state.userTeams),
    drafted: add(base.drafted || {}, mine.flatMap((c) => c.rows.map((r) => r.prospect.id))),
  };
  const s = streak.exists() ? streak.data() : {};
  const fresh = [...new Set([...runIds, ...profileBadges({ ...totals, streak: Math.max(liveStreak(s), s.best || 0) })])]
    .filter((id) => badges[id] && !base.earned?.[id]);
  const team = state.userTeams.length === 1 ? state.userTeams[0] : null;
  await setDoc(earnedRef(uid), {
    ...totals,
    earned: { ...(base.earned || {}), ...Object.fromEntries(fresh.map((id) => [id, { at: serverTimestamp(), year: String(year), team }])) },
  }, { merge: true });
  return fresh;
}
