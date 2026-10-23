// scripts/refreshDraftOrder.mjs
//
// Tuesday refresh of the next draft's order (draftOrders/{year}, see
// src/utils/draftOrder.js): pulls the season's results from ESPN's public
// scoreboard, sorts the 32 teams by the league's draft-order rule (reverse
// order of finish — a projection during the regular season, the real order
// once the playoffs settle it) and saves `order`. Trades are untouched —
// they're keyed to each pick's round + original team, so they follow their
// picks. Skips the year when its doc says auto: false (an admin locked it in
// Admin → Draft Order).
//
// Runs from .github/workflows/refresh-draft-order.yml (Tuesdays, after
// Monday Night Football; plus workflow_dispatch).
//
// Usage:
//   node --env-file=.env scripts/refreshDraftOrder.mjs            # write
//   node --env-file=.env scripts/refreshDraftOrder.mjs --dry-run  # print only
//   node --env-file=.env scripts/refreshDraftOrder.mjs --year 2027
import { createRequire } from "module";
import { fetchStandingsOrder, orderFromLegacyPicks, followsOrder, ORDER_YEAR } from "../src/utils/draftOrder.js";
import { NFL_TEAM_ABBRS } from "../src/utils/coachHistory.js";

const require = createRequire(import.meta.url);
const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

const DRY_RUN = process.argv.includes("--dry-run");
const yearArg = process.argv.indexOf("--year");
// The next draft: the season runs September–February, so from March on the
// upcoming draft is next year's; before March it's this year's.
const now = new Date();
const defaultYear = now.getUTCMonth() >= 2 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
const year = String(yearArg > -1 ? process.argv[yearArg + 1] : defaultYear);

async function main() {
  if (followsOrder(year)) {
    console.log(`The ${year} draft follows the ${ORDER_YEAR} order — nothing to refresh.`);
    return;
  }
  const db = getFirestore();
  const ref = db.collection("draftOrders").doc(year);
  const snap = await ref.get();
  if (snap.exists && snap.data().auto === false) {
    console.log(`draftOrders/${year} is set to manual (auto: false) — skipped.`);
    return;
  }
  const { order, phase, records } = await fetchStandingsOrder(year, NFL_TEAM_ABBRS);
  if (phase === "none") {
    console.log(`No ${Number(year) - 1} games played yet — draftOrders/${year} left as is.`);
    return;
  }
  if (order.length !== 32) throw new Error(`Expected 32 teams, got ${order.length}`);
  const before = snap.exists ? snap.data().order || [] : [];
  console.log(`${year} draft order (${phase}):`);
  order.forEach((t, i) => {
    const was = before.indexOf(t);
    const moved = was < 0 ? "" : was === i ? "" : ` (was ${was + 1})`;
    console.log(`  ${String(i + 1).padStart(2)}. ${t.padEnd(3)} ${records[t].pct.toFixed(3)}${moved}`);
  });
  // First time in the new format: carry over the trades already entered in
  // the old per-pick collection (draftOrder{year}, round 1).
  let seedTrades = null;
  if (!snap.exists) {
    const legacy = await db.collection(`draftOrder${year}`).get();
    seedTrades = orderFromLegacyPicks(legacy.docs.map((d) => d.data())).trades;
    console.log(`New doc — carrying over ${Object.keys(seedTrades).length} trade(s) from draftOrder${year}: ${JSON.stringify(seedTrades)}`);
  }
  if (DRY_RUN) { console.log("Dry run — nothing written."); return; }
  await ref.set({
    order, auto: true, source: "standings", asOf: now.toISOString().slice(0, 10), phase,
    updatedAt: FieldValue.serverTimestamp(),
    ...(seedTrades ? { trades: seedTrades } : {}),
  }, { merge: true });
  console.log(`Saved draftOrders/${year}.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
