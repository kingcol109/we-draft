const { getFirestore } = require("./firebaseAdmin");
(async () => {
  const db = getFirestore();
  const snap = await db.collection("historical").where("First", "==", "Jonathan").where("Last", "==", "Mingo").where("Year","==","2023").get();
  const docSnap = snap.docs[0];
  await docSnap.ref.update({ Bench: "22" });
  const after = await docSnap.ref.get();
  console.log("Updated:", JSON.stringify(after.data()));
})().catch((e) => { console.error(e); process.exit(1); });
