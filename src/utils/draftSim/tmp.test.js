import { buildBoard, initSim, stepCpu } from "./engine";
const POS = ["QB", "WR", "EDGE", "OL", "DB", "RB", "LB", "DL", "TE"];
test("tiers", () => {
  const teams = Array.from({ length: 32 }, (_, i) => `T${String(i).padStart(2, "0")}`);
  const full = Array.from({ length: 7 * 32 }, (_, i) => ({ Pick: i + 1, Round: Math.floor(i / 32) + 1, Team: teams[i % 32] }));
  const b = buildBoard(Array.from({ length: 400 }, (_, i) => ({ id: `n${i}`, Position: POS[i % POS.length], cr: i + 1 })));
  const tiers = [[1, 15], [16, 50], [51, 100], [101, 150], [151, 224]];
  for (const off of [true, false]) {
    const sum = tiers.map(() => [0, 0]);
    for (let seed = 1; seed <= 30; seed++) {
      let s = initSim({ order: full, board: b, rounds: 7, seed });
      if (off) s = { ...s, teamBoards: {} };
      while (!s.done) s = stepCpu(s).state;
      s.picks.forEach((p) => { const t = tiers.findIndex(([a, z]) => p.overall >= a && p.overall <= z); const r = s.byId[p.selection].rank; sum[t][0] += Math.abs(p.overall - r); sum[t][1]++; });
    }
    console.log(off ? "before" : "after ", tiers.map(([a, z], i) => `${a}-${z}: ${(sum[i][0] / sum[i][1]).toFixed(1)}`).join("  "));
  }
});
