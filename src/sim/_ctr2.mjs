import { SimEngine } from "./engine.js";
const seed = +process.argv[2];
const e = new SimEngine({ formation: "spreadWeak", play: "counter", front: "4-3", coverage: "cover3", variance: true, readEnd: "sit" }); e.autoReset = false; e.reset(seed);
let res = null; e.onFinished = (r) => (res = r); e.snap(); const f = (v) => v.toFixed(1); const L = e.byId.C.home.y + 0.75;
const P = (id) => { const d = e.byId[id]; return `${id}(${f(d.x - 26.67)},${f(d.y - L)})`; };
for (let i = 0; i < 4000 && !res; i++) { const c = e.carrier(); if (c && c.team === "O") e.input.mouse = c.id === "RB" && c.y < L + 1 ? { x: 26.67 + e.zone.ps * 3.8, y: L + 5 } : { x: c.x, y: c.y + 10 }; e.step();
  if (i % 12 === 0 && e.sinceSnap > 0.3) console.log(f(e.sinceSnap), P("RB"), P("LG"), P("DE-R"), P("LT"), P("SLB"), P("RT"), P("DT-R"), P("MLB"), P("RG"), `ball:${e.ball.carrierId}`); }
console.log(res.detail, res.yards.toFixed(1));
console.log(e.events.filter(v => /Tackle|Missed|Shed|Beat|Slipped|Engaged|Kick/.test(v.label)).map(v => `${v.t.toFixed(2)} ${v.id} ${v.label}`).join("\n"));
