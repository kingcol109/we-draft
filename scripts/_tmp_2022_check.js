const { getFirestore } = require("./firebaseAdmin");
(async () => {
  const db = getFirestore();
  const snap = await db.collection("historical").where("Year", "==", "2022").get();
  const rows = [];
  snap.forEach((d) => {
    const v = d.data();
    rows.push({ pick: Number(v.Pick) || 9999, round: v.Round, pos: v.Position, first: v.First, last: v.Last, hasSW: !!(v.Strengths && v.Strengths.length) });
  });
  rows.sort((a, b) => a.pick - b.pick);
  console.log(`Total 2022 records: ${rows.length}`);
  const notDone = rows.filter(r => !r.hasSW);
  console.log(`Not done: ${notDone.length}`);
  console.log(`First 10 picks:`);
  rows.slice(0, 10).forEach(r => console.log(`  ${r.pick} R${r.round} ${r.pos} ${r.first} ${r.last} | done:${r.hasSW?"Y":"N"}`));
})().catch((e) => { console.error(e); process.exit(1); });
