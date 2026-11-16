import { nextSituation } from "./src/utils/live.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { getFirestore } = require("./scripts/firebaseAdmin.js");
const { comparePlays } = require("./server/live/provider.js");
const db = getFirestore();
const slate = (await db.collection("liveSlate").doc("current").get()).data();
let n = 0, ok = 0, okSpot = 0, spotN = 0, skip = 0; const bad = [];
for (const sg of slate.games.filter((g) => g.status !== "scheduled").slice(0, 25)) {
  const game = (await db.collection("liveGames").doc(sg.id).get()).data();
  const plays = (await db.collection("liveGames").doc(sg.id).collection("plays").get()).docs.map((d) => d.data()).filter((p) => !p.removed).sort(comparePlays);
  const scrim = (p) => ["rush", "pass", "incomplete", "sack", "fumble", "interception", "punt", "field_goal"].includes(p.presentation?.type) && p.down && !p.presentation?.nullified;
  for (let i = 1; i < plays.length; i++) {
    const actual = plays[i];
    if (!scrim(actual)) continue;
    const before = plays.slice(0, i).reverse();
    const pred = nextSituation(before, { ...game, status: "in_progress", possession: actual.offense, down: actual.down, distance: actual.distance, yardsToGoal: actual.yardsToGoal, clock: actual.clock, period: actual.period });
    if (!pred || !pred.down || pred.approx) { skip++; continue; }
    n++;
    const dist = actual.distance >= actual.yardsToGoal ? "Goal" : actual.distance;
    const good = pred.offense === actual.offense && pred.down === actual.down && pred.distance === dist;
    if (good) ok++; else if (bad.length < 8) bad.push(`pred ${pred.offense} ${pred.down}&${pred.distance} ytg${pred.ytg} | actual ${actual.offense} ${actual.down}&${dist} ytg${actual.yardsToGoal} | prev: ${before[0].presentation?.headline} ${before[0].presentation?.detail} [${before[0].text.slice(0, 90)}]`);
    if (good) { spotN++; if (pred.ytg === actual.yardsToGoal) okSpot++; }
  }
}
console.log(`inferred ${n} snaps: down & distance & offense correct ${ok} (${(100 * ok / n).toFixed(1)}%), spot exact ${okSpot}/${spotN}; ${skip} used CFBD live state instead`);
bad.forEach((b) => console.log("  ✗", b));
process.exit(0);
