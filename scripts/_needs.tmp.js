const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");
(async () => {
  const db = getFirestore();
  const { COMP_SNAPSHOT_VERSION } = await import("../src/utils/historicalStats.js");
  const snap = await db.collection("nflTeamNeeds").get();
  const needs = Object.fromEntries(snap.docs.map((d) => [d.id, d.data().needs || {}]));
  await db.collection("compSnapshots").doc("_teamNeeds").set({ version: COMP_SNAPSHOT_VERSION, needs, updatedAt: FieldValue.serverTimestamp() });
  const back = (await db.collection("compSnapshots").doc("_teamNeeds").get()).data();
  const same = Object.keys(needs).every((t) => JSON.stringify(back.needs[t]) === JSON.stringify(needs[t]));
  console.log(`_teamNeeds: ${Object.keys(back.needs).length} teams, version ${back.version}, matches nflTeamNeeds: ${same}, ${Math.round(Buffer.byteLength(JSON.stringify(back.needs)) / 1024)} KB`);
})().catch((e) => { console.error(e); process.exit(1); });
