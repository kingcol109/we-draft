// scripts/syncSubPositions.mjs
//
// Splits OL and DB prospects into the sub-positions NFL team needs are kept
// by (scripts/nflTeamNeeds.js): OL → OT / G / C, DB → CB / S — so a Draft
// Sim team that needs a corner doesn't take a safety, or one that needs a
// center a tackle. From each player's PFF position (pffGrades, linked
// through cfbdPlayers.wedraftPlayerId): T → OT, G → G, C → C, CB → CB,
// S → S. A PFF position that crosses groups (a DB PFF lists as DI) is left
// alone. (Before guards and centers split, G and C were both "IOL" — a
// --write run replaces those.)
//
// Writes players/{id}.SubPosition — the label only, no PFF numbers, so it's
// public like Position. The admin's SubPositionOverride (Admin → Players →
// Data Management → Sub-positions) wins over it wherever it's set; this never touches it.
// The class snapshots (utils/snapshotBuilders.js) carry it to the sim on
// their next rebuild.
//
// Usage:
//   node --env-file=.env scripts/syncSubPositions.mjs [--write]
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { getFirestore } = require("./firebaseAdmin");
const write = process.argv.includes("--write");

const SUB = { OL: { T: "OT", G: "G", C: "C" }, DB: { CB: "CB", S: "S" } };

const db = getFirestore();
const [players, links, pff] = await Promise.all([
  db.collection("players").where("Position", "in", Object.keys(SUB)).get(),
  db.collection("cfbdPlayers").where("mappingStatus", "in", ["verified", "suggested"]).get(),
  db.collection("pffGrades").get(),
]);
const cfbdByPlayer = new Map();
links.docs.forEach((d) => { const w = d.data().wedraftPlayerId; if (w) cfbdByPlayer.set(w, d.id); });
const pffPos = new Map();
pff.docs.forEach((d) => Object.entries(d.data().players || {}).forEach(([id, r]) => pffPos.set(id, r.pos)));

const changes = [];
const tally = {};
let unlinked = 0;
players.docs.forEach((d) => {
  const p = d.data();
  const sub = SUB[p.Position]?.[pffPos.get(cfbdByPlayer.get(d.id))];
  if (!sub) { unlinked += 1; return; }
  tally[sub] = (tally[sub] || 0) + 1;
  if (p.SubPosition !== sub) changes.push({ ref: d.ref, sub, name: `${p.First} ${p.Last} (${p.Position}, ${p.Eligible})`, was: p.SubPosition || "—" });
});

console.log(`${players.size} OL/DB players: ${JSON.stringify(tally)}, ${unlinked} with no PFF sub-position.`);
changes.slice(0, 15).forEach((c) => console.log(`  ${c.name}: ${c.was} → ${c.sub}`));
if (changes.length > 15) console.log(`  … and ${changes.length - 15} more`);
if (!write) {
  console.log(`[dry] ${changes.length} to update — add --write to save.`);
  process.exit(0);
}
for (let i = 0; i < changes.length; i += 400) {
  const batch = db.batch();
  changes.slice(i, i + 400).forEach((c) => batch.update(c.ref, { SubPosition: c.sub }));
  await batch.commit();
}
console.log(`Updated ${changes.length} players.`);
process.exit(0);
