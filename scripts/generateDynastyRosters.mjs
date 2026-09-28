// scripts/generateDynastyRosters.mjs
//
// Builds the default Dynasty-mode rosters: 32 NFL teams × 53 generated
// players, written to src/sim/dynasty/defaultRosters.json (committed — that
// file IS the default league; re-running with the same seed and the same
// name databases reproduces it).
//
// Reads Firestore only (never writes): team ids from `nfl`, first/last name
// pools from `players` + `historical`, and height/weight by position from
// the combine numbers in `historical`.
//
//   node scripts/generateDynastyRosters.mjs [--seed 2026]
//
// Needs GOOGLE_SERVICE_ACCOUNT_KEY (read from .env if not already set).

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { generateLeague, namePools, DEFAULT_MEASURABLES } from "../src/sim/dynasty/generate.js";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY && fs.existsSync(path.join(root, ".env"))) {
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}
const { getFirestore } = require("./firebaseAdmin.js");

const argSeed = process.argv.indexOf("--seed");
const seed = argSeed > 0 ? Number(process.argv[argSeed + 1]) : 2026;

const db = getFirestore();
const [nfl, players, historical] = await Promise.all([
  db.collection("nfl").get(),
  db.collection("players").get(),
  db.collection("historical").get(),
]);

const teams = nfl.docs.map((d) => d.id).sort();
if (teams.length !== 32) console.warn(`Expected 32 teams in nfl, found ${teams.length}`);

const people = [...players.docs, ...historical.docs].map((d) => ({ first: d.get("First"), last: d.get("Last") }));
const names = namePools(people);
console.log(`Name pools: ${names.firsts.length} first, ${names.lasts.length} last`);

// Height / weight by position from the combine data, where there's enough.
const SRC = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", EDGE: "EDGE", DL: "DL", LB: "LB", K: "K", P: "P" };
const measurables = JSON.parse(JSON.stringify(DEFAULT_MEASURABLES));
for (const [pos, src] of Object.entries(SRC)) {
  const rows = historical.docs.filter((d) => d.get("Position") === src);
  const h = rows.map((d) => parseFloat(d.get("Height"))).filter((v) => v > 60 && v < 85);
  const w = rows.map((d) => parseFloat(d.get("Weight"))).filter((v) => v > 150 && v < 400);
  if (h.length < 30 || w.length < 30) continue;
  const st = (a) => {
    const m = a.reduce((s, v) => s + v, 0) / a.length;
    return [+m.toFixed(1), +Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length).toFixed(1)];
  };
  measurables[pos] = { h: st(h), w: st(w) };
}

const league = generateLeague({ teams, names, measurables, seed });
const file = path.join(root, "src/sim/dynasty/defaultRosters.json");
fs.writeFileSync(file, JSON.stringify(league));
const count = Object.values(league.teams).reduce((s, t) => s + t.players.length, 0);
console.log(`Wrote ${count} players on ${teams.length} teams → ${path.relative(root, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
process.exit(0);
