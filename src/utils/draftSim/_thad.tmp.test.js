import history from "./draftHistory.json";
import { thadFacts, THAD_LINES, ANALYSTS } from "./analysts";
const nick = { NYJ: "Jets", TEN: "Titans", LV: "Raiders", DEN: "Broncos", LAC: "Chargers", TEX: "Texans", NYG: "Giants", ARI: "Cardinals", TB: "Buccaneers" };
const ctx = { nickname: (t) => nick[t] || t, teamName: (t) => `X ${nick[t] || t}`, city: () => "X", year: "2027", history, memory: {}, rand: Math.random,
  staff: { NYJ: { GM: { n: "Darren Mougey", id: "darren-mougey" }, HC: { n: "Aaron Glenn", id: "aaron-glenn" } } } };
const ev = (First, Last, Position, School, team, overall, round) => ({ type: "pick", team, value: 0, pick: { overall, round }, prospect: { First, Last, Position, School, rank: overall, positionRank: 1, strengths: [], weaknesses: [] } });
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? `{${k}}`);
test("thad", () => {
  for (const e of [ev("Dante", "Moore", "QB", "Oregon", "TEN", 3, 1), ev("Tre", "Wisner", "RB", "Florida State", "NYJ", 40, 2), ev("Some", "Guy", "DB", "Texas A&M", "NYJ", 2, 1), ev("Big", "Man", "OL", "Georgia", "NYJ", 16, 1)]) {
    console.log(`\n== ${e.prospect.First} ${e.prospect.Last} ${e.prospect.School} ${e.prospect.Position} → ${e.team} #${e.pick.overall}  weight ${ANALYSTS.find((a) => a.id === "thad").weight(e, ctx)}\n` +
      thadFacts(e, ctx).map((f) => `  [${f.weight.toFixed(1)}] ${fill(THAD_LINES[f.cat].lines[0], f.vars)}`).join("\n"));
  }
});
