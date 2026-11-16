/** @jest-environment node */
// Temporary: the real 2028 weekly pipeline, to see who goes where.
import "./fetchShim";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { loadSimData } from "../utils/draftSim/data";
import { runWeeklyMock, orderAfterTrades, nextYearNeeds, WEEKLY_TRADES_BY_YEAR } from "../utils/draftSim/weeklyMock";
jest.setTimeout(300000);
const NL = "\n";
test("reaches", async () => {
  const base = (await getDoc(doc(db, "weeklyMocks", "tMHXkPZm2xBikpgJBk9o"))).data();
  const [d27, d28] = await Promise.all([loadSimData("2027"), loadSimData("2028")]);
  const next = nextYearNeeds(d28.needs, base.picks, d27.board);
  const data = { ...d28, order: orderAfterTrades(d28.order, base.trades, "2028"), needs: next.needs };
  const flag = [];
  for (let s = 1; s <= 20; s++) {
    const sim = runWeeklyMock(data, { seed: s * 7919, rounds: 3, trades: WEEKLY_TRADES_BY_YEAR[2028] });
    sim.picks.forEach((p) => {
      const pl = sim.byId[p.selection];
      if (p.round <= 2 && (pl.avg == null || pl.avg >= 6)) flag.push(`2028 seed ${s} R${p.round} #${p.overall} ${p.owner} ${pl.Position} rank ${pl.rank} avg ${pl.avg ?? "ungraded"} fit ${pl.fits?.[p.owner]?.s ?? "-"} ${pl.First} ${pl.Last}`);
    });
  }
  console.log(`2028 reaches (20 runs x 96 picks): ${flag.length}` + NL + flag.slice(0, 30).join(NL));
  const by27 = Object.fromEntries(d27.board.map((p) => [p.id, p]));
  const f27 = base.picks.filter((p) => p.player).map((p) => ({ p, b: by27[p.player.id] }))
    .filter(({ p, b }) => b && p.round <= 2 && (b.avg == null || b.avg >= 6));
  console.log(`2027 published reaches: ${f27.length}` + NL + f27.map(({ p, b }) => `R${p.round} #${p.overall} ${p.owner} ${b.Position} rank ${b.rank} avg ${b.avg ?? "ungraded"} (${b.count}) fit ${b.fits?.[p.owner]?.s ?? "-"} ${b.First} ${b.Last}`).join(NL));
  const dist = {};
  for (let s = 1; s <= 20; s++) {
    const sim = runWeeklyMock(data, { seed: s * 7919, rounds: 3, trades: WEEKLY_TRADES_BY_YEAR[2028] });
    sim.picks.forEach((p) => { const a = sim.byId[p.selection].avg; const k = `R${p.round} ${a == null ? "ungraded" : "grade " + Math.round(a)}`; dist[k] = (dist[k] || 0) + 1; });
  }
  console.log(Object.entries(dist).sort().map(([k, v]) => `${k}: ${v}`).join(NL));
  let late27 = 0, total27 = 0;
  for (let s = 1; s <= 3; s++) {
    const sim = runWeeklyMock(d27, { seed: s * 104729, rounds: 7 });
    sim.picks.forEach((p) => { const a = sim.byId[p.selection]?.avg; total27++; if (a != null && Math.round(a) > p.round + 3) late27++; });
  }
  console.log(`2027 (3 runs): picks graded 4+ rounds later than taken: ${late27} of ${total27}`);
  console.log(`2028 board: ${d28.board.length} players, ${d28.board.filter((p) => p.avg != null).length} graded`);
});
