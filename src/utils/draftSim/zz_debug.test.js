import { positionValue, earlyNudge, buildBoard, initSim, stepCpu } from "./engine";
test("dbg", () => {
  ["WR","OL","QB","EDGE","DB"].forEach((pos, i) => console.log(pos, "rank", i + 1, "value", positionValue(pos, i + 1).toFixed(2), "nudge@1", earlyNudge(pos, 1).toFixed(2)));
  const POS = ["QB", "WR", "EDGE", "OL", "DB", "RB", "LB", "DL", "TE"];
  const b = buildBoard([{ id: "wr", Position: "WR", cr: 1 }, { id: "ol", Position: "OL", cr: 2 }, { id: "qb", Position: "QB", cr: 3 },
    ...Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, Position: POS[i % POS.length], cr: 4 + i }))]);
  const c = {};
  for (let seed = 1; seed <= 200; seed++) { const s = initSim({ order: [{ Pick: 1, Round: 1, Team: "T1" }], board: b, rounds: 1, seed }); const id = stepCpu(s).state.picks[0].selection; c[id] = (c[id] || 0) + 1; }
  console.log(c);
});
