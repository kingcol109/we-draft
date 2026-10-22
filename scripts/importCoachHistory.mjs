// scripts/importCoachHistory.mjs
//
// Bulk writer for `coaches/{slug}` — the same import Admin → Coach History's
// Import view does, for when a batch of bios has been turned into a JSON file.
// Every record runs through normalizeCoach (src/utils/coachHistory.js), so
// the docs match what the admin editor would save.
//
// Usage:
//   node --env-file=.env scripts/importCoachHistory.mjs <file.json> [--write]
//
// The file holds one person or an array (shape in utils/coachHistory.js).
// Without --write it's a dry run: prints each person, their current jobs,
// and any warnings. With --write, existing docs are replaced (createdAt is
// kept), not merged.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { normalizeCoach } from "../src/utils/coachHistory.js";

const require = createRequire(import.meta.url);

const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node --env-file=.env scripts/importCoachHistory.mjs <file.json> [--write]");
  process.exit(1);
}
const write = flag === "--write";

const raw = JSON.parse(readFileSync(file, "utf8"));
const rows = (Array.isArray(raw) ? raw : [raw]).map(normalizeCoach);

let warnCount = 0;
for (const { doc, warnings } of rows) {
  const current = doc.Current.map((c) => `${c.Team} ${c.Role}`).join(", ") || "former";
  console.log(`${doc.Name || "(no name)"} → coaches/${doc.Slug}  [${current}]  ${doc.Stints.length} stints`);
  warnings.forEach((w) => console.log(`   ⚠ ${w}`));
  warnCount += warnings.length;
}
const valid = rows.filter((r) => r.doc.Name);
console.log(`\n${valid.length} people, ${warnCount} warnings${rows.length > valid.length ? `, ${rows.length - valid.length} skipped (no name)` : ""}.`);

if (!write) {
  console.log("Dry run — re-run with --write to save.");
  process.exit(0);
}

const { getFirestore } = require("./firebaseAdmin");
const db = getFirestore();
const now = new Date().toISOString();
for (const { doc } of valid) {
  const ref = db.collection("coaches").doc(doc.Slug);
  const existing = await ref.get();
  await ref.set({ ...doc, createdAt: existing.exists ? existing.data().createdAt || now : now, updatedAt: now });
  console.log(`${existing.exists ? "Replaced" : "Created"} coaches/${doc.Slug}`);
}
