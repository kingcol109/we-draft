import fs from "fs";
import { suggestNeeds, suggestionReason } from "./teamNeedSuggestions";
test("live", () => {
  const { teams, espn } = JSON.parse(fs.readFileSync("C:/Users/wdalp/AppData/Local/Temp/claude/c--Users-wdalp-OneDrive-Desktop-we-draft/b66ff620-d8f1-4421-b4fd-d7d227f7f80a/scratchpad/live.json", "utf8"));
  const s = suggestNeeds(teams, espn);
  const tally = {};
  Object.values(s).forEach((t) => Object.values(t).forEach((x) => { tally[x.label] = (tally[x.label] || 0) + 1; }));
  console.log("TALLY", JSON.stringify(tally));
  console.log("PHI QB", s.PHI.QB.label, "|", suggestionReason(s.PHI.QB), "| without:", s.PHI.QB.without && s.PHI.QB.without.label);
  const inj = [];
  Object.entries(s).forEach(([a, t]) => Object.entries(t).forEach(([k, x]) => { if (x.injured.length) inj.push(a + " " + k + ": " + x.injured.map((i) => i.name + " (" + i.status + ")").join(", ") + " → " + x.label + " (without: " + x.without.label + ")"); }));
  console.log("INJURED\n" + inj.join("\n"));
});
