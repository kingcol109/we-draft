const { getFirestore } = require("./firebaseAdmin");
(async () => {
  const db = getFirestore();
  const snap = await db.collection("historical").where("Year", "==", "2023").get();
  snap.forEach((d) => {
    const v = d.data();
    const full = `${v.First} ${v.Last}`;
    if (/Beal|McClendon|Perry|Aumavae/i.test(full)) {
      console.log(JSON.stringify({First: v.First, Last: v.Last, Pick: v.Pick, Position: v.Position}));
    }
  });
})().catch((e) => { console.error(e); process.exit(1); });
