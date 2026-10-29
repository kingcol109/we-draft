// src/utils/draftSim/publicSims.js
//
// Saved Draft Sims and the public ones. Saving (SimResults.jsx) writes the
// user's own copy — users/{uid}/draftSims/{id}, with visibility "public" by
// default — and, for a one-team sim (however it was started: a /draftsim/nyj
// link or one team picked on the setup screen), a public copy at the same
// id: publicDraftSims/{id} { uid, username, year, rounds, team, grade,
// picks (share.js haulRecords' shape), createdAt }. The Recent Drafts page
// (components/draftSim/RecentSims.jsx) lists those. Making one private
// takes the public copy down; making it public again puts it back.
// Multi-team sims are never listed — there's no one team to file them under.
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { db } from "../../firebase";

// The Community tab (insights), and Recent Drafts under it.
export const COMMUNITY_PATH = "/draftsim/community";
export const RECENT_PATH = "/draftsim/recent";
const PUBLIC = "publicDraftSims";
const mineRef = (uid, id) => doc(db, "users", uid, "draftSims", id);
const publicRef = (id) => doc(db, PUBLIC, id);

// Listed on Recent Drafts when public: exactly one team, with picks.
export const listable = (sim) => (sim.teams || []).length === 1;
const publicCopy = (uid, username, sim) => ({
  uid, username: username || "", year: String(sim.year), rounds: sim.rounds || null,
  team: sim.teams[0].team, grade: sim.teams[0].grade, picks: sim.teams[0].picks || [],
  createdAt: sim.createdAt || serverTimestamp(),
});

// rec: { year, rounds, speed, teams } → the new sim's id.
export async function saveSim(uid, username, rec) {
  const ref = doc(collection(db, "users", uid, "draftSims"));
  const sim = { ...rec, visibility: "public", createdAt: serverTimestamp() };
  const batch = writeBatch(db);
  batch.set(ref, sim);
  if (listable(sim)) batch.set(publicRef(ref.id), publicCopy(uid, username, sim));
  await batch.commit();
  return ref.id;
}

// sim: the saved doc ({ id, year, rounds, teams, createdAt }).
export async function setSimVisibility(uid, username, sim, visibility) {
  const batch = writeBatch(db);
  batch.update(mineRef(uid, sim.id), { visibility });
  if (visibility === "public" && listable(sim)) batch.set(publicRef(sim.id), publicCopy(uid, username, sim));
  else batch.delete(publicRef(sim.id));
  await batch.commit();
}

export async function deleteSim(uid, id) {
  const batch = writeBatch(db);
  batch.delete(mineRef(uid, id));
  batch.delete(publicRef(id));
  await batch.commit();
}

// The newest public sims, all teams or one.
export async function loadRecentSims({ team = "", max = 60 } = {}) {
  const q = team
    ? query(collection(db, PUBLIC), where("team", "==", team), orderBy("createdAt", "desc"), limit(max))
    : query(collection(db, PUBLIC), orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
