// scripts/publishRiserEditions.mjs
//
// Publishes each class's current Draft Risers list (risers/{year}) as an
// edition (riserEditions/{year}_{date} — utils/risers.js), exactly as the
// admin's Save does (AdminRisers.jsx): the list as saved, each riser with his
// recent line as ESPN has it now (utils/riserRecent.js). The edition is
// dated to the list's last Save (its updatedAt, Eastern time) — for lists
// saved before Save published editions. Same-day editions are replaced.
// Touches nothing else (not the lists themselves).
//
// Run with:
//   node --env-file=.env scripts/publishRiserEditions.mjs        publish
//   node --env-file=.env scripts/publishRiserEditions.mjs --dry  report only, no writes
import { createRequire } from "module";
import { RISER_YEARS, RISER_EDITIONS, editionId, editionDate } from "../src/utils/risers.js";
import { fetchRecentSummary } from "../src/utils/riserRecent.js";

const require = createRequire(import.meta.url);
const { getFirestore } = require("./firebaseAdmin");

const DRY = process.argv.slice(2).includes("--dry");
const db = getFirestore();

for (const year of RISER_YEARS) {
  const snap = await db.collection("risers").doc(year).get();
  const board = snap.exists ? snap.data() : null;
  const players = board?.players || [];
  if (!players.length) { console.log(`${year}: no list`); continue; }
  const saved = board.updatedAt?.toDate?.() || new Date();
  const date = editionDate(saved);
  const recents = await Promise.all(players.map(async (r) => {
    const ph = await db.collection("playerPhotos").doc(r.id).get().catch(() => null);
    return fetchRecentSummary(r.pos, ph?.exists ? ph.data().headshot?.espnId : null).catch(() => null);
  }));
  const id = editionId(year, date);
  const exists = (await db.collection(RISER_EDITIONS).doc(id).get()).exists;
  console.log(`${DRY ? "[dry] " : ""}${year}: ${id}${exists ? " (replacing)" : ""} — ${players.length} risers, ${recents.filter(Boolean).length} with a recent line`);
  players.forEach((r, i) => console.log(`    ${r.first} ${r.last}: ${recents[i] ? `${recents[i].kind === "last3" ? "last 3" : `last game ${recents[i].at} ${recents[i].opp}`} — ${recents[i].line || "(no stats)"}` : "(no recent line)"}`));
  if (DRY) continue;
  await db.collection(RISER_EDITIONS).doc(id).set({
    year, date, publishedAt: board.updatedAt || saved,
    players: players.map((r, i) => ({ ...r, recent: recents[i] || null })),
  });
}
console.log(DRY ? "[dry] nothing written." : "done.");
process.exit(0);
