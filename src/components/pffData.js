// src/components/pffData.js
//
// Shared reads of PFF grades for the Admin Panel's suggesters (Suggest
// Trends, CFB Universe's Suggest Players to Add). pffGrades/{CFBDTeamId} is
// written by scripts/syncPffGrades.js and is admin-only — PFF data is back
// office only and must NEVER be displayed on the public site (nor written
// into public fields like a trend's Notes).
//
// A player's record (keyed by CFBD athlete id): pos PFF position, cat, g
// season grade, sn snaps, rk/of national rank among qualified FBS players
// at his position (only set with enough snaps), w latest game { wk, g, sn },
// rg recent games [{ wk, g, sn }] newest first, x specific grades.
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";

// PFF position → We-Draft position.
export const PFF_TO_WD = {
  QB: "QB", HB: "RB", FB: "RB", WR: "WR", TE: "TE", T: "OL", G: "OL", C: "OL",
  DI: "DL", ED: "EDGE", LB: "LB", CB: "DB", S: "DB", K: "K", P: "P",
};

let cached = null;
// CFBD athlete id → PFF record, every team in one read (~230 small docs),
// cached for the session. Fails soft: no PFF data, not an error.
export async function loadPffByCfbdId() {
  if (cached) return cached;
  const map = new Map();
  try {
    const snap = await getDocs(collection(db, "pffGrades"));
    snap.docs.forEach((d) => Object.entries(d.data().players || {}).forEach(([id, rec]) => map.set(id, rec)));
  } catch (e) {
    console.warn("PFF grades unavailable:", e.code || e);
  }
  cached = map;
  return map;
}

// 0..1 — his national rank as a percentile (1 = #1).
export const rankPct = (rec) => (rec?.rk != null && rec.of > 1 ? 1 - (rec.rk - 1) / (rec.of - 1) : rec?.rk != null ? 1 : 0);

// "PFF 84.2 — #12 of 170 FBS QBs" (admin-only text).
export const pffLine = (rec) => `PFF ${rec.g} — #${rec.rk} of ${rec.of} FBS ${rec.pos}s`;
