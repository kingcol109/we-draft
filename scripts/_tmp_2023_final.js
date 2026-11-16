const { getFirestore } = require("./firebaseAdmin");
(async () => {
  const db = getFirestore();
  const snap = await db.collection("historical").where("Year", "==", "2023").get();
  const rows = [];
  snap.forEach((d) => {
    const v = d.data();
    rows.push({ pick: Number(v.Pick) || 9999, pos: v.Position, first: v.First, last: v.Last, hasSW: !!(v.Strengths && v.Strengths.length) });
  });
  rows.sort((a, b) => a.pick - b.pick);
  const notDone = rows.filter(r => !r.hasSW);
  console.log(`Total: ${rows.length}, not done: ${notDone.length}`);
  notDone.forEach(r => console.log(`  ${r.pick} ${r.pos} ${r.first} ${r.last}`));
})().catch((e) => { console.error(e); process.exit(1); });
