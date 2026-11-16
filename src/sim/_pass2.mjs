import { SimEngine } from "./engine.js";
const tests = [["stick","tripsRight","Y",1.75],["curlFlat","pistol","X",2.35],["snag","bunchRight","Y",1.7],["smash","spreadWeak","X",1.6]];
for (const [pk, form, tgt, t] of tests) { let n = 0, c = 0, int = 0, yds = 0;
  for (const [front, cov] of [["4-3","cover3"],["nickel","cover4"],["4-3","tampa2"],["nickel","cover1robber"],["3-4","cover3"],["tite","cover4"]]) for (let seed = 1; seed <= 6; seed++) {
    const e = new SimEngine({ formation: form, play: pk, front, coverage: cov, variance: true }); e.autoReset = false; e.reset(seed * 5);
    let res = null; e.onFinished = (r) => (res = r); e.snap(); let thrown = false;
    for (let i = 0; i < 4000 && !res; i++) { const cr = e.carrier(); if (cr && cr.team === "O" && cr.id !== "QB") e.input.mouse = { x: cr.x, y: cr.y + 20 }; e.step();
      if (!thrown && e.sinceSnap >= t && e.canThrow()) { const r = e.byId[tgt]; e.throwBall(0.25, r.x + r.vx * 0.3, r.y + r.vy * 0.3); thrown = true; } }
    if (!thrown) continue; n++; if (e.stats.catch) { c++; yds += res.yards; } if (res.type === "INTERCEPTION") int++;
  }
  console.log(`${pk.padEnd(9)} → ${tgt}: comp ${Math.round(100 * c / n)}%  yds/comp ${(yds / Math.max(1, c)).toFixed(1)}  int ${Math.round(100 * int / n)}%  (n ${n})`);
}
