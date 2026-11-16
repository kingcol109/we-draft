require("dotenv").config();
const { getFirestore } = require("./firebaseAdmin");
(async () => {
  const db = getFirestore();
  const uid = "pYSpX6IRyHdAlYpFP5NNbQ19ARI3"; // King Cold Sports
  const ref = db.collection("users").doc(uid).collection("wePickStats").doc("season2026");
  const before = await ref.get();
  console.log("Before delete, exists:", before.exists, before.exists ? JSON.stringify(before.data()) : "");
  await ref.delete();
  const after = await ref.get();
  console.log("After delete, exists:", after.exists);
})().catch((e) => { console.error(e); process.exit(1); });
