// src/utils/draftSim/pffRanks.js
//
// PFF's positional rank for these players ({ [playerId]: { rk, of, sn,
// pos } }) — admin-only reads: their CFBD links (cfbdPlayers, 30 at a time),
// then every pffGrades team doc. Used for the Weekly Mock's pick notes
// (AdminWeeklyMock.jsx, and regenerating one in the mock editor); only the
// notes' credited top-of-list line (pickNotes.js PFF_TOP / PFF_MIN_SNAPS)
// ever reaches the public site.
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../firebase";

export async function loadPffRanks(ids) {
  const cfbdTo = {};
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await getDocs(query(collection(db, "cfbdPlayers"), where("wedraftPlayerId", "in", ids.slice(i, i + 30))));
    snap.docs.forEach((d) => { if (["verified", "suggested"].includes(d.data().mappingStatus)) cfbdTo[d.id] = d.data().wedraftPlayerId; });
  }
  const out = {};
  (await getDocs(collection(db, "pffGrades"))).docs.forEach((d) => Object.entries(d.data().players || {}).forEach(([id, r]) => {
    const who = cfbdTo[id];
    if (!who || r.rk == null || (out[who] && (out[who].sn || 0) >= (r.sn || 0))) return;
    out[who] = { rk: r.rk, of: r.of, sn: r.sn, pos: r.pos };
  }));
  return out;
}
