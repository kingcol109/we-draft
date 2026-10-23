// scripts/importPlayingHistory.mjs
//
// Adds playing days to `coaches/{slug}` as PLAYER stints (Title = position),
// from a JSON map like scripts/playingHistory.json:
//   { "<slug>": [[Level, Org, Position, StartYear, EndYear, Notes], ...] }
// Each person's existing PLAYER stints are replaced, not appended, so it's
// safe to re-run after editing the file. Everything else on the doc is kept,
// and the result runs through normalizeCoach like any other save.
//
// Usage:
//   node --env-file=.env scripts/importPlayingHistory.mjs scripts/playingHistory.json [--write]
//
// Without --write it's a dry run: prints what each person gets plus any
// warnings beyond the expected undated-stint ones.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { normalizeCoach, isPlayerStint } from "../src/utils/coachHistory.js";

const require = createRequire(import.meta.url);

const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node --env-file=.env scripts/importPlayingHistory.mjs <file.json> [--write]");
  process.exit(1);
}
const write = flag === "--write";

const map = JSON.parse(readFileSync(file, "utf8"));
const toStint = ([Level, Org, Title, StartYear, EndYear, Notes]) => ({
  Level, Org, Title, Roles: ["PLAYER"],
  StartYear: StartYear ?? null, StartMonth: null,
  EndYear: EndYear ?? null, EndMonth: null,
  // A playing stint with no end year has ended — never "still there".
  EndUnknown: EndYear == null,
  Notes: Notes || "",
});
// Undated playing days are normal ("Harvard, four-year starter").
const EXPECTED = /no start year|end year unknown/;

const { getFirestore } = require("./firebaseAdmin");
const db = getFirestore();

let people = 0, stints = 0, warnCount = 0;
const updates = [];
for (const [slug, rows] of Object.entries(map)) {
  if (slug.startsWith("_")) continue;
  const snap = await db.collection("coaches").doc(slug).get();
  if (!snap.exists) { console.log(`✗ coaches/${slug} not found — skipped`); warnCount += 1; continue; }
  const existing = snap.data();
  const playing = rows.map(toStint);
  const { doc, warnings } = normalizeCoach({
    ...existing,
    Slug: slug,
    Stints: [...playing, ...(existing.Stints || []).filter((s) => !isPlayerStint(s))],
  });
  const before = JSON.stringify(existing.Current || []);
  const after = JSON.stringify(doc.Current);
  const extra = warnings.filter((w) => !EXPECTED.test(w));
  console.log(`${doc.Name} → ${playing.length} playing stint${playing.length === 1 ? "" : "s"}: ${playing.map((s) => `${s.Org}${s.StartYear ? ` ${s.StartYear}` : ""}`).join(", ")}`);
  if (before !== after) { console.log(`   ⚠ current jobs would change: ${before} → ${after}`); warnCount += 1; }
  extra.forEach((w) => console.log(`   ⚠ ${w}`));
  warnCount += extra.length;
  people += 1;
  stints += playing.length;
  updates.push({ slug, doc, createdAt: existing.createdAt });
}
console.log(`\n${people} people, ${stints} playing stints, ${warnCount} warnings.`);

if (!write) {
  console.log("Dry run — re-run with --write to save.");
  process.exit(0);
}

const now = new Date().toISOString();
for (const { slug, doc, createdAt } of updates) {
  await db.collection("coaches").doc(slug).set({ ...doc, createdAt: createdAt || now, updatedAt: now });
}
console.log(`Saved ${updates.length} people.`);
