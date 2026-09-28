// src/sim/dynasty/lineup.js
// ── Depth charts and who plays where. A team's depth chart is each
// position's players, best first (the roster's `depth`). A lineup puts the
// starters into the sim's slots for this snap's formation and front:
//
//   OL: LT/RT = OT1/OT2, LG/RG = OG1/OG2, C = C1
//   QB1, RB1 · X = WR1, Z = WR2, Y = WR3, H = TE1 (slot or fullback)
//   4-3 / mug: DE = EDGE1/2, DT = DL1/2, WLB/MLB/SLB = LB1–3
//   3-4 / tite: DE = DL1/2, NT = DL3, OLB = EDGE1/2, ILB = LB1/2
//   nickel:    DE = EDGE1/2, DT = DL1/2, MLB/WLB = LB1/2, NB = CB3
//   bear:      DE = EDGE1, SAM on the line = EDGE2, DT = DL1/2, NT = DL3,
//              MLB/WLB = LB1/2
//   CB = CB1/2, FS/SS = S1/S2 ──

export function depthChart(team) {
  const by = {};
  for (const p of team.players) (by[p.pos] = by[p.pos] || []).push(p);
  for (const k of Object.keys(by)) by[k].sort((a, b) => a.depth - b.depth);
  return by;
}

export function offenseLineup(team) {
  const d = depthChart(team);
  const g = (pos, i) => (d[pos] || [])[i] || null;
  return {
    LT: g("OT", 0), RT: g("OT", 1), LG: g("OG", 0), RG: g("OG", 1), C: g("C", 0),
    QB: g("QB", 0), RB: g("RB", 0),
    X: g("WR", 0), Z: g("WR", 1), Y: g("WR", 2), H: g("TE", 0) || g("WR", 3),
  };
}

export function defenseLineup(team, front) {
  const d = depthChart(team);
  const g = (pos, i) => (d[pos] || [])[i] || null;
  const back = { "CB-L": g("CB", 0), "CB-R": g("CB", 1), "S-L": g("S", 0), "S-R": g("S", 1) };
  if (front === "nickel")
    return {
      "DE-L": g("EDGE", 1), "DE-R": g("EDGE", 0), "DT-L": g("DL", 0), "DT-R": g("DL", 1),
      MLB: g("LB", 0), WLB: g("LB", 1), NB: g("CB", 2),
      ...back,
    };
  if (front === "bear")
    return {
      "DE-R": g("EDGE", 0), SLB: g("EDGE", 1), "DT-L": g("DL", 0), "DT-R": g("DL", 1), NT: g("DL", 2),
      MLB: g("LB", 0), WLB: g("LB", 1),
      ...back,
    };
  if (front === "3-4" || front === "tite")
    return {
      "DE-L": g("DL", 0), NT: g("DL", 2), "DE-R": g("DL", 1),
      "OLB-L": g("EDGE", 1), "OLB-R": g("EDGE", 0), "ILB-L": g("LB", 0), "ILB-R": g("LB", 1),
      ...back,
    };
  return {
    "DE-L": g("EDGE", 1), "DE-R": g("EDGE", 0), "DT-L": g("DL", 0), "DT-R": g("DL", 1),
    MLB: g("LB", 0), WLB: g("LB", 1), SLB: g("LB", 2),
    ...back,
  };
}

// Starters' average OVR on each side, for team cards.
export function teamRatings(team) {
  const avg = (ps) => Math.round(ps.filter(Boolean).reduce((s, p) => s + p.ovr, 0) / Math.max(1, ps.filter(Boolean).length));
  const off = Object.values(offenseLineup(team));
  const def = Object.values(defenseLineup(team, "4-3"));
  return { off: avg(off), def: avg(def), ovr: avg([...off, ...def]) };
}

export const fullName = (p) => (p ? `${p.first} ${p.last}` : "");
