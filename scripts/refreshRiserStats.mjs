// scripts/refreshRiserStats.mjs
//
// The Draft Risers boards' fallback stat refresh (risers/{year} — utils/
// risers.js), run every Sunday by .github/workflows/sync-cfbd-player-stats.yml
// right after scripts/syncCfbdPlayerStats.js has written the week's season
// totals (cfbdPlayers/{id}.seasons.{STATS_SEASON}). So a board's stats stay
// current even in a week the admin doesn't touch it.
//
// For every riser on every class's board:
//   - the stats he shows (riser.stats keys — the admin's picks) get the
//     latest values from his linked CFBD season line (the same doc and the
//     same formatting as Admin → Content → Rising Page's "Refresh stat
//     values": utils/risers.js statValue / statLabel);
//   - a riser with no stats picked gets his position's defaults
//     (DEFAULT_STATS), those he has numbers for, up to MAX_STATS;
//   - a stat with no value this week keeps its last one.
// Nothing else on the board changes — not the order, labels, notes, shots,
// or updatedAt (the page's "Updated" date and the graphics' version stay
// the admin's last Save). The doc gets statsRefreshedAt. Each board is
// rewritten in a transaction, so an admin Save at the same moment isn't
// lost; a board with nothing new isn't written at all.
//
// Run with:
//   node --env-file=.env scripts/refreshRiserStats.mjs        refresh and write
//   node --env-file=.env scripts/refreshRiserStats.mjs --dry  report only, no writes
import { createRequire } from "module";
import {
  RISER_YEARS, STATS_SEASON, MAX_STATS, DEFAULT_STATS, statLabel, statValue,
} from "../src/utils/risers.js";

const require = createRequire(import.meta.url);
const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

const DRY = process.argv.slice(2).includes("--dry");
const db = getFirestore();

// His CFBD season line: the linked cfbdPlayers doc (not rejected) with this
// season, a verified link first — the admin picker's own rule.
async function seasonOf(playerId) {
  const snap = await db.collection("cfbdPlayers").where("wedraftPlayerId", "==", playerId).get();
  const docs = snap.docs.map((d) => d.data()).filter((d) => d.mappingStatus !== "rejected");
  const best = docs.find((d) => d.seasons?.[STATS_SEASON] && d.mappingStatus === "verified") || docs.find((d) => d.seasons?.[STATS_SEASON]);
  return best?.seasons?.[STATS_SEASON] || null;
}

// His stats with this week's values ({ key, label, value, season }).
function freshStats(riser, season) {
  if (!season) return riser.stats || [];
  const picked = (riser.stats || []).map((s) => s.key).filter(Boolean);
  const keys = picked.length ? picked : (DEFAULT_STATS[riser.pos] || []).filter((k) => statValue(season, k) !== "").slice(0, MAX_STATS);
  return keys.map((key) => {
    const value = statValue(season, key);
    const was = (riser.stats || []).find((s) => s.key === key);
    return { key, label: statLabel(key), value: value !== "" ? value : was?.value || "", season: STATS_SEASON };
  });
}
// Same stats shown (what the page shows: which, called what, how many).
const shown = (list) => JSON.stringify((list || []).map((x) => [x.key, x.label, String(x.value ?? "")]));
const same = (a, b) => shown(a) === shown(b);

let boards = 0;
let changed = 0;
for (const year of RISER_YEARS) {
  const ref = db.collection("risers").doc(year);
  const first = await ref.get();
  const players = first.exists ? first.data().players || [] : [];
  if (!players.length) { console.log(`${year}: no board`); continue; }
  boards += 1;
  // The season lines, read before the transaction (it only re-reads the board).
  const seasons = new Map(await Promise.all(players.map(async (r) => [r.id, await seasonOf(r.id).catch(() => null)])));

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data().players || [] : [];
    let n = 0;
    const out = current.map((r) => {
      const stats = freshStats(r, seasons.get(r.id) ?? null);
      if (same(stats, r.stats)) return r;
      n += 1;
      console.log(`  ${year} ${r.first} ${r.last}: ${(r.stats || []).map((s) => `${s.label} ${s.value}`).join(", ") || "(none)"}  →  ${stats.map((s) => `${s.label} ${s.value}`).join(", ")}`);
      return { ...r, stats };
    });
    if (n && !DRY) tx.update(ref, { players: out, statsRefreshedAt: FieldValue.serverTimestamp() });
    return n;
  });
  changed += result;
  const missing = players.filter((r) => !seasons.get(r.id)).map((r) => `${r.first} ${r.last}`);
  console.log(`${DRY ? "[dry] " : ""}${year}: ${players.length} risers, ${result} with new stats${missing.length ? ` · no ${STATS_SEASON} CFBD line: ${missing.join(", ")}` : ""}`);
}
console.log(`${DRY ? "[dry] " : ""}done — ${boards} board${boards === 1 ? "" : "s"}, ${changed} riser${changed === 1 ? "" : "s"} updated.`);
process.exit(0);
