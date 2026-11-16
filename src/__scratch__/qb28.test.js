/** @jest-environment node */
// Temporary: QB picks in the real 2028 weekly mock, run the way the admin does.
import "./fetchShim";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { loadSimData } from "../utils/draftSim/data";
import { runWeeklyMock, nextYearNeeds, qbEligibleTeams, WEEKLY_TRADES_BY_YEAR } from "../utils/draftSim/weeklyMock";
jest.setTimeout(300000);
const NL = "\n";
test("qbs", async () => {
  const base = (await getDoc(doc(db, "weeklyMocks", "tMHXkPZm2xBikpgJBk9o"))).data();
  const [d27, d28] = await Promise.all([loadSimData("2027"), loadSimData("2028")]);
  const qbTeams = qbEligibleTeams(d28.needs, base.picks);
  const data = { ...d28, needs: nextYearNeeds(d28.needs, base.picks, d27.board).needs };
  const taken = {};
  for (let s = 1; s <= 20; s++) {
    const sim = runWeeklyMock(data, { seed: s * 7919, rounds: 3, trades: WEEKLY_TRADES_BY_YEAR[2028], qbTeams });
    sim.picks.forEach((p) => {
      const pl = sim.byId[p.selection];
      if (pl.Position === "QB") { const k = `${p.owner} R${p.round} #${p.overall} ${pl.First} ${pl.Last}`; taken[k] = (taken[k] || 0) + 1; }
    });
  }
  console.log("QBs taken in 20 runs:" + NL + Object.entries(taken).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(NL));
});
