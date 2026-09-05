// scripts/backfillHistoricalHighSchools.js
//
// One-time (well, safely re-runnable) reconciliation: every `historical`
// draft-pick record that has a HighSchool value should have a matching doc
// in the shared `highSchools` collection (the same lazy-seeded collection
// AdminPanel.js's PlayerDataSection/RecruitsSection/HistoricalSection all
// write to on save — see this repo's own bugfix on those three, which is
// what made this backfill necessary in the first place: before that fix, a
// new school whose *name* collided with an already-seeded one in a
// different state was silently never created).
//
// Most `historical` rows predate HighSchool being tracked at all (only
// recent — 2024/2025 — draft classes reliably carry it), so this only ever
// touches the subset that actually has a value; that's expected, not a bug.
//
// Matched on Name + State together (case-insensitive), same as the
// admin-panel seed functions this mirrors — two schools can share a name
// in different states (e.g. "Aurora" in CA vs. CO), so Name alone isn't a
// safe key.
//
// Usage: node --env-file=.env scripts/backfillHistoricalHighSchools.js

const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

function keyFor(name, state) {
  return `${name.trim().toLowerCase()}|${(state || "").trim().toLowerCase()}`;
}

async function main() {
  const db = getFirestore();

  const [highSchoolsSnap, historicalSnap] = await Promise.all([
    db.collection("highSchools").get(),
    db.collection("historical").get(),
  ]);

  const existingKeys = new Set();
  highSchoolsSnap.forEach((d) => {
    const data = d.data();
    if (data.Name) existingKeys.add(keyFor(data.Name, data.State));
  });

  let withHighSchool = 0;
  const missing = new Map(); // key -> { Name, State }
  historicalSnap.forEach((d) => {
    const data = d.data();
    const name = (data.HighSchool || "").trim();
    if (!name) return;
    withHighSchool++;
    const key = keyFor(name, data.State);
    if (!existingKeys.has(key) && !missing.has(key)) {
      missing.set(key, { Name: name, State: (data.State || "").trim() });
    }
  });

  console.log(`historical docs with a HighSchool value: ${withHighSchool}`);
  console.log(`distinct (Name, State) high schools already in highSchools: ${existingKeys.size}`);
  console.log(`missing high schools to create: ${missing.size}`);

  for (const { Name, State } of missing.values()) {
    await db.collection("highSchools").add({
      Name, State,
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log(`created: "${Name}"${State ? ` (${State})` : ""}`);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
