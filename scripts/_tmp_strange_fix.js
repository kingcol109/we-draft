const { getFirestore } = require("./firebaseAdmin");
(async () => {
  const db = getFirestore();
  const snap = await db.collection("historical").where("First", "==", "Brenton").where("Last", "==", "Strange").where("Year","==","2023").get();
  const docSnap = snap.docs[0];
  await docSnap.ref.update({ Weaknesses: ["Lateral Agility", "Hand Usage", "Balance"] });
  const after = await docSnap.ref.get();
  console.log("Fixed:", JSON.stringify(after.data().Weaknesses));
})().catch((e) => { console.error(e); process.exit(1); });
