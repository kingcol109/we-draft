// scripts/importCombineInvites.mjs
//
// Every NFL Combine invite since 2000, drafted or not, into Firestore
// combineInvites/{year} { year, rows: [InviteRow], source, importedAt }.
// Source: the nflverse Combine file (originally Pro Football Reference) —
// height, weight and the six drills; no arm or hand measurements.
// The site snapshot build merges these with our drafted rows
// (src/utils/combineData.js mergeCombineInvites) for /events/combine.
//
//   node --env-file=.env scripts/importCombineInvites.mjs --dry-run     # parse + report, no writes
//   node --env-file=.env scripts/importCombineInvites.mjs               # write
//   node --env-file=.env scripts/importCombineInvites.mjs --file path   # a local copy instead of downloading
//
// Writes only combineInvites/* (replacing each year's doc). Nothing reaches
// the site until the snapshots are rebuilt.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { pathToFileURL } from "url";

const require = createRequire(import.meta.url);
const SOURCE = "https://github.com/nflverse/nflverse-data/releases/download/combine/combine.csv";
const DRY_RUN = process.argv.includes("--dry-run");
const fileArg = process.argv.indexOf("--file");
const FILE = fileArg > 0 ? process.argv[fileArg + 1] : null;

// RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const num = (v) => { const n = Number(v); return v === "" || v == null || !Number.isFinite(n) ? null : n; };
// "6-2" → 74
const inches = (v) => { const m = String(v || "").match(/^(\d+)-(\d+)$/); return m ? Number(m[1]) * 12 + Number(m[2]) : null; };

function toInvite(r) {
  const out = {
    name: r.player_name.trim(), pos: r.pos, school: r.school, pfr: r.pfr_id || "",
    round: num(r.draft_round), pick: num(r.draft_ovr), team: r.draft_team || "",
    height: inches(r.ht), weight: num(r.wt), forty: num(r.forty), bench: num(r.bench),
    vertical: num(r.vertical), broad: num(r.broad_jump), threeCone: num(r.cone), shuttle: num(r.shuttle),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null && v !== ""));
}

async function main() {
  const text = FILE ? readFileSync(FILE, "utf8") : await (await fetch(SOURCE)).text();
  const rows = parseCsv(text).filter((r) => r.player_name && /^\d{4}$/.test(r.season));
  const byYear = {};
  rows.forEach((r) => (byYear[r.season] = byYear[r.season] || []).push(toInvite(r)));
  const years = Object.keys(byYear).sort();
  console.log(`Parsed ${rows.length} invites, ${years[0]}–${years[years.length - 1]} (${years.length} years)`);
  years.forEach((y) => console.log(`  ${y}: ${byYear[y].length} invites, ${byYear[y].filter((x) => !x.round).length} undrafted`));
  if (DRY_RUN) { console.log("Dry run — nothing written."); return; }

  const { getFirestore } = require("./firebaseAdmin");
  const { FieldValue } = require("firebase-admin/firestore");
  const db = getFirestore();
  const batch = db.batch();
  years.forEach((y) => batch.set(db.collection("combineInvites").doc(y), {
    year: Number(y), rows: byYear[y], source: SOURCE, importedAt: FieldValue.serverTimestamp(),
  }));
  await batch.commit();
  console.log(`✅ Wrote combineInvites/{year} for ${years.length} years.`);
}

export { parseCsv, toInvite };
// Run only when called directly (tests import the parser).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error("❌ Import failed:", e); process.exit(1); });
}
