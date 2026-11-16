const { getFirestore } = require('./firebaseAdmin');
async function main() {
  const db = getFirestore();
  const snap = await db.collection('historical').where('Year','==','2022').get();
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  docs.sort((a,b) => (parseInt(a.Pick)||0) - (parseInt(b.Pick)||0));
  const range = docs.filter(d => parseInt(d.Pick) >= 240 && parseInt(d.Pick) <= 245);
  for (const m of range) {
    const missing = ["Height","Weight","Arm Length","Hand Size","40 Yard ","Vertical","Broad","Bench","3-Cone","Shuttle"].filter(f => m[f] === undefined || m[f] === null || m[f] === "");
    console.log(`pick ${m.Pick} | ${m.Player} | Pos:${m.Position} | School:${m.School} | S:${(m.Strengths||[]).length} W:${(m.Weaknesses||[]).length} | RG:${m.RoundGrade} | missing: ${missing.join(', ')||'none'}`);
  }
}
main();
