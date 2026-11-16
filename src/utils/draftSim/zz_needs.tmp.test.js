import fs from "fs";
import { buildBoard, initSim, stepCpu, resolveNeeds, needKeysFor } from "./engine";
import { picksFromOrder } from "../draftOrder";
const D = JSON.parse(fs.readFileSync(process.env.SIMDATA, "utf8"));
const prospects = Object.entries(D.classes).flatMap(([pos, rows]) => rows.map((r) => ({ id: r.i, First: r.F, Last: r.L, Position: pos, School: r.s, Slug: r.sl, cr: r.cr ?? null, subPosition: r.sp || null, roles: r.ro || [] })));
const fits = Object.assign({}, ...Object.values(D.fits));
const board = buildBoard(prospects, D.grades, fits);
const order = picksFromOrder(D.order);
const needs = Object.fromEntries(Object.entries(D.needs).map(([t, n]) => [t, resolveNeeds(n)]));
const URG = ["Upgrade Needed", "Upgrade Wanted", "Expiring Contract", "Aging Talent"];
test("needs calibration (real 2027)", () => {
  const RUNS = Number(process.env.RUNS || 30);
  const posR = {}; const needHit = Array(7).fill(0); const roundPicks = Array(7).fill(0);
  const qbNeedTeams = Object.keys(needs).filter((t) => needs[t].QB?.labels.includes("Upgrade Needed"));
  let qbNeedR1 = 0, qbNeedR12 = 0, qbNeedTradeUp = 0, noNeedQbR13 = 0, qbReach = [];
  const tierHit = {}; const otherQb = {}; const trades = Array(7).fill(0);
  for (let seed = 1; seed <= RUNS; seed++) {
    let s = initSim({ order, board, chart: D.chart, needs, rounds: 7, seed });
    const tradedUpFor = []; 
    while (!s.done) {
      const out = stepCpu(s);
      out.events.forEach((e) => {
        if (e.type === "trade") trades[e.pick.round - 1]++;
        if (e.type === "trade" && e.target?.Position === "QB" && qbNeedTeams.includes(e.to)) tradedUpFor.push(e.to);
        if (e.type !== "pick") return;
        const r = e.pick.round - 1; roundPicks[r]++;
        const pos = e.prospect.Position; posR[`${pos}`] = posR[pos] || Array(7).fill(0); posR[pos][r]++;
        const n = e.pick.need || e.need;
        if (n && URG.includes(n.label)) { needHit[r]++; const k = needKeysFor(e.prospect)[0]?.key; tierHit[k] = tierHit[k] || Array(7).fill(0); tierHit[k][r]++; }
        if (pos === "QB") {
          if (qbNeedTeams.includes(e.team)) { if (r === 0) { qbNeedR1++; qbReach.push(e.pick.overall - e.prospect.rank); } if (r <= 1) qbNeedR12++; }
          else if (r <= 2) { noNeedQbR13++; const l = (needs[e.team]?.QB?.labels || ['none']).join('+'); otherQb[l] = (otherQb[l] || 0) + 1; }
        }
      });
      s = out.state;
    }
    qbNeedTradeUp += new Set(tradedUpFor).size;
  }
  const f = (x) => (x / RUNS).toFixed(2);
  const lines = [];
  lines.push(`QB Upgrade Needed teams (${qbNeedTeams.length}): ${qbNeedTeams.join(",")}`);
  lines.push(`  QBs they take R1/draft: ${f(qbNeedR1)}  R1-2: ${f(qbNeedR12)}  teams trading up for a QB/draft: ${f(qbNeedTradeUp)}  avg R1 QB reach (pick-rank): ${(qbReach.reduce((a, b) => a + b, 0) / (qbReach.length || 1)).toFixed(1)}`);
  lines.push(`  QBs by teams w/o QB need, R1-3/draft: ${f(noNeedQbR13)}  by their QB label: ${Object.entries(otherQb).map(([k, v]) => k + ' ' + f(v)).join(', ')}`);
  lines.push(`Urgent-need picks share by round: ${needHit.map((n, i) => (n / roundPicks[i] * 100).toFixed(0) + "%").join(" ")}`);
  lines.push(`Trades per draft by round: ${trades.map(f).join(' / ')}  total ${f(trades.reduce((a, b) => a + b, 0))}`);
  lines.push("Picks per draft by position, R1..R7:");
  Object.entries(posR).forEach(([p, a]) => lines.push(`  ${p.padEnd(5)} ${a.map((n) => f(n).padStart(5)).join(" ")}`));
  lines.push("Urgent-need fills per draft by key, R1..R7:");
  Object.entries(tierHit).sort().forEach(([k, a]) => lines.push(`  ${String(k).padEnd(5)} ${a.map((n) => f(n).padStart(5)).join(" ")}`));
  fs.writeFileSync(process.env.SIMOUT, lines.join("\n"));
});
