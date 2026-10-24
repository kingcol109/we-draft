// scripts/buildPositionHistory.mjs
//
// Builds src/utils/draftSim/positionHistory.json — how NFL teams have
// actually valued each position, from the last YEARS drafts in the
// `historical` collection — for the Draft Sim's CPU teams (engine.js):
//
//   picks        every pick number each position went at, sorted — how
//                early a position realistically goes ("unusually early").
//   value        at the SAME pre-draft grade (RoundGrade), how much earlier
//                (<1) or later (>1) each position went than the grade's
//                median pick, per grade tier: [{ at, ratio, n }], `at` the
//                tier's median pick. Round 1 is where positions split (QBs
//                and EDGEs jump, LBs and TEs slide); later it washes out.
//   specialists  for K and P: the median pick of the 1st, 2nd … one taken
//                in a draft (only while at least half the drafts took that
//                many), and the earliest one went.
//
// No Firestore writes — re-run after each draft and commit the JSON.
// Usage:
//   node --env-file=.env scripts/buildPositionHistory.mjs
import { createRequire } from "module";
import { writeFileSync } from "fs";

const require = createRequire(import.meta.url);
const { getFirestore } = require("./firebaseAdmin");

const YEARS = 10;
const OUT = "src/utils/draftSim/positionHistory.json";
const GRADES = ["Early First Round", "Middle First Round", "Late First Round", "Second Round", "Third Round", "Fourth Round", "Fifth Round", "Sixth Round", "Seventh Round"];
const TIERS = [GRADES.slice(0, 3), GRADES.slice(3, 5), GRADES.slice(5)];
const SPECIALISTS = ["K", "P"];

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const round2 = (x) => Math.round(x * 100) / 100;

const rows = (await getFirestore().collection("historical").get()).docs
  .map((d) => d.data())
  .map((d) => ({ year: +d.Year, pick: +d.Pick, pos: d.Position, grade: d.RoundGrade }))
  .filter((d) => d.year && d.pick > 0 && d.pos);
const last = Math.max(...rows.map((d) => d.year));
const recent = rows.filter((d) => d.year > last - YEARS);
const years = [...new Set(recent.map((d) => d.year))].sort();

const picks = {};
recent.forEach((d) => { (picks[d.pos] = picks[d.pos] || []).push(d.pick); });
Object.values(picks).forEach((a) => a.sort((x, y) => x - y));

const graded = recent.filter((d) => GRADES.includes(d.grade));
const gradeMedian = Object.fromEntries(GRADES.map((g) => [g, median(graded.filter((d) => d.grade === g).map((d) => d.pick))]));
const value = {};
Object.keys(picks).filter((pos) => !SPECIALISTS.includes(pos)).forEach((pos) => {
  value[pos] = TIERS.map((tier) => {
    const inTier = graded.filter((d) => tier.includes(d.grade));
    const mine = inTier.filter((d) => d.pos === pos);
    // Geometric mean of pick ÷ the grade's median pick.
    const ratio = mine.length ? Math.exp(mine.reduce((t, d) => t + Math.log(d.pick / gradeMedian[d.grade]), 0) / mine.length) : 1;
    return { at: median(inTier.map((d) => d.pick)), ratio: round2(ratio), n: mine.length };
  }).filter((t) => t.n > 0);
});

const specialists = {};
SPECIALISTS.forEach((pos) => {
  const perYear = years.map((y) => recent.filter((d) => d.year === y && d.pos === pos).map((d) => d.pick).sort((a, b) => a - b));
  const slots = [];
  for (let i = 0; perYear.filter((a) => a.length > i).length >= years.length / 2; i++) {
    slots.push(median(perYear.filter((a) => a.length > i).map((a) => a[i])));
  }
  specialists[pos] = { slots, earliest: picks[pos]?.[0] ?? null };
});

const out = { years: [years[0], years[years.length - 1]], draftSize: Math.round(recent.length / years.length), picks, value, specialists };
writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`Wrote ${OUT}: ${years[0]}–${last}, ${recent.length} picks, ${graded.length} graded.`);
Object.entries(value).forEach(([pos, t]) => console.log(pos.padEnd(5), t.map((x) => `@${x.at} ×${x.ratio} (n=${x.n})`).join("  ")));
console.log("specialists", JSON.stringify(specialists));
