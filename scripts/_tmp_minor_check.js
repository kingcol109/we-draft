const { getFirestore } = require("./firebaseAdmin");
(async () => {
  const db = getFirestore();
  const snap = await db.collection("historical").where("First", "==", "Kobee").where("Last", "==", "Minor").where("Year","==","2025").get();
  snap.forEach((d) => console.log(JSON.stringify(d.data(), null, 2)));
})().catch((e) => { console.error(e); process.exit(1); });
