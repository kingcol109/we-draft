import { buildBoard, initSim, stepCpu, resolveNeeds, NEED_KEYS, NEED_LABELS } from "./engine";
test("trade calibration", () => {
  const POS = ["QB", "RB", "WR", "WR", "TE", "OL", "OL", "DL", "EDGE", "EDGE", "LB", "DB", "DB"];
  const teams = Array.from({ length: 32 }, (_, i) => `T${String(i).padStart(2, "0")}`);
  const chart = Object.fromEntries(Array.from({ length: 260 }, (_, i) => [String(i + 1), Math.round(3000 * Math.exp(-0.035 * i) + 20)]));
  let rng = 7; const r = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
  const fits = {};
  const prospects = Array.from({ length: 400 }, (_, i) => ({ id: `p${i}`, Position: POS[i % POS.length], subPosition: i % 2 ? "CB" : "S", cr: i + 1 }));
  prospects.forEach((p) => { fits[p.id] = teams.filter(() => r() < 0.05).map((t) => ({ a: t, s: 70 + r() * 25, HC: 70 + r() * 25 })); });
  const board = buildBoard(prospects, {}, fits);
  const labels = ["Upgrade Needed", "Upgrade Wanted", "Aging Talent", "Depth Needed", "Set", "Set", "Set", "Crowded Room"];
  const needs = Object.fromEntries(teams.map((t) => [t, resolveNeeds(Object.fromEntries(NEED_KEYS.map((k) => [k, { labels: [labels[Math.floor(r() * labels.length)]] }])))]));
  const order = Array.from({ length: 224 }, (_, i) => ({ Pick: i + 1, Round: Math.floor(i / 32) + 1, Team: teams[i % 32] }));
  const byRound = [0, 0, 0, 0, 0, 0, 0]; const runs = 20;
  for (let seed = 1; seed <= runs; seed++) {
    let s = initSim({ order, board, chart, needs, rounds: 7, seed });
    while (!s.done) { const out = stepCpu(s); out.events.filter((e) => e.type === "trade").forEach((e) => byRound[e.pick.round - 1]++); s = out.state; }
  }
  console.log("TRADES per draft by round:", byRound.map((n) => (n / runs).toFixed(1)).join(" / "), "| total", (byRound.reduce((a, b) => a + b, 0) / runs).toFixed(1));
});
