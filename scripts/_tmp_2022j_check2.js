const { getFirestore } = require("./firebaseAdmin");
(async () => {
  const db = getFirestore();
  const snap = await db.collection("historical").where("Year", "==", "2022").get();
  snap.forEach((d) => {
    const v = d.data();
    if (/Asamoah/i.test(v.Last)) console.log(JSON.stringify({First: v.First, Last: v.Last, Pick: v.Pick, Position: v.Position}));
  });
})().catch((e) => { console.error(e); process.exit(1); });
