import { SimEngine } from "./src/sim/engine.js";
import { TUNING } from "./src/sim/config.js";
import { CX } from "./src/sim/field.js";
const FITS = {
  bang: { MLB: "C-play", WLB: "B-back", "DT-R": "C-play", "DT-L": "B-back", SLB: "force-play" },
  bend: { WLB: "A-play", MLB: "C-play", SLB: "force-play", "DT-L": "A-play", "DT-R": "B-play", "S-L": "alley-play", "S-R": "force-play" },
  bounce: { MLB: "A-play", WLB: "A-back", SLB: "B-play", "DE-R": "B-play", "DT-R": "A-play", "S-R": "B-play" },
};
function rep(setup, run, seed) { const e = new SimEngine({ variance: false, ballOn: 85, ...setup, seed }); e.autoReset = false; e.autopilot = { run }; for (let t = 0; t < 2.2; t += TUNING.dt) e.step(TUNING.dt); let r = null; e.onFinished = (x) => { r = x; }; e.snap(); let xAt = null; for (let i = 0; i < 25 / TUNING.dt && !r; i++) { e.step(TUNING.dt); const c = e.carrier(); if (xAt == null && c && c.y > 87) xAt = c.x; } return { yds: r ? +(r.yards || 0).toFixed(1) : -9, off: xAt == null ? null : +((xAt - CX)).toFixed(1) }; }
for (const [mode, fits] of Object.entries(FITS)) for (const run of [mode, "read"]) { const out = []; for (let seed = 1; seed <= 12; seed++) { const r = rep({ play: "insideZone", formation: "spreadWeak", front: "over", coverage: "cover3", readEnd: "sit", fits }, run, seed); out.push(r.yds + "@" + r.off); } console.log((mode + " fits / run " + run).padEnd(28), out.join(" ")); }
