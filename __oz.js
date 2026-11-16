import { SimEngine } from "./src/sim/engine.js";
import { TUNING } from "./src/sim/config.js";
import { coveragesFor } from "./src/sim/playbook.js";
import { CX } from "./src/sim/field.js";
function rep(setup, run, seed) { const e = new SimEngine({ variance: false, ballOn: 85, ...setup, seed }); e.autoReset = false; e.autopilot = { run }; for (let t = 0; t < 2.2; t += TUNING.dt) e.step(TUNING.dt); let r = null; e.onFinished = (x) => { r = x; }; e.snap(); let xAt = null; for (let i = 0; i < 25 / TUNING.dt && !r; i++) { e.step(TUNING.dt); const c = e.carrier(); if (xAt == null && c && c.y > 87) xAt = c.x; } const ps = e.zone ? e.zone.ps : 1; return { yds: r ? +(r.yards || 0).toFixed(1) : -9, off: xAt == null ? null : +(ps * (xAt - CX)).toFixed(1) }; }
const OZ = { play: "outsideZone", formation: "pistol" };
console.log("-- blocking (read run)"); for (const front of ["over", "under", "bear", "tite", "3-4"]) for (const coverage of ["cover3", "cover4"].filter((c) => coveragesFor(front).includes(c))) { const good = []; for (let seed = 1; seed <= 25; seed++) { const r = rep({ ...OZ, front, coverage }, "read", seed); if (r.yds >= 4) good.push(seed + ":" + r.yds + "@" + r.off); } console.log(front.padEnd(6), coverage, good.length, good.slice(0, 6).join(" ")); }
const FITS = {
  bang1: ["bang", { MLB: "A-play", WLB: "A-back", SLB: "B-play", "DE-R": "B-play", "S-R": "B-play" }],
  bang2: ["bang", { MLB: "B-play", WLB: "A-back", SLB: "C-play", "DE-R": "C-play", "DT-R": "A-play", "S-R": "C-play" }],
  bend1: ["bend", { MLB: "D-play", WLB: "C-play", SLB: "force-play", "DT-L": "B-play", "DT-R": "C-play", "DE-R": "D-play", "S-R": "force-play", "S-L": "alley-play" }],
  bend2: ["bend", { MLB: "C-play", WLB: "B-play", SLB: "force-play", "DT-L": "A-play", "DT-R": "C-play", "DE-R": "D-play", "S-R": "force-play" }],
};
console.log("-- scripted"); for (const [n, [run, fits]] of Object.entries(FITS)) for (const [front, coverage] of [["over","cover3"],["under","cover3"]]) { const out = []; for (let seed = 1; seed <= 10; seed++) { const r = rep({ ...OZ, front, coverage, fits }, run, seed); out.push(r.yds + "@" + r.off); } console.log(n, front, out.join(" ")); }
