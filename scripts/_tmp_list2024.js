const { getFirestore } = require("./firebaseAdmin");
(async () => {
  const db = getFirestore();
  const snap = await db.collection("historical").where("Year", "==", "2024").get();
  const rows = [];
  snap.forEach((d) => {
    const v = d.data();
    rows.push({
      id: d.id,
      pick: Number(v.Pick) || 9999,
      round: v.Round,
      pos: v.Position,
      first: v.First,
      last: v.Last,
      hasCombine: !!(v.Height || v.Weight || v["40 Yard "] || v.Vertical || v.Bench || v["3-Cone"] || v.Shuttle || v.Broad),
      hasSW: !!(v.Strengths && v.Strengths.length) || !!(v.Weaknesses && v.Weaknesses.length),
      roundGrade: v.RoundGrade || null,
    });
  });
  rows.sort((a, b) => a.pick - b.pick);
  rows.forEach((r) => {
    console.log(`${String(r.pick).padStart(4)} R${r.round} ${String(r.pos).padEnd(4)} ${r.first} ${r.last} | combine:${r.hasCombine ? "Y" : "N"} S/W:${r.hasSW ? "Y" : "N"} grade:${r.roundGrade || "-"}`);
  });
  console.log(`\nTotal: ${rows.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
