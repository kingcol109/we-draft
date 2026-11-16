const { getFirestore } = require('./firebaseAdmin');
async function main() {
  const db = getFirestore();
  const snap = await db.collection('historical').where('Year','==','2021').get();
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const names = [
    ["Anthony","Schwartz"],["Monty","Rice"],["Spencer","Brown"],["Ben","Cleveland"],
    ["Robert","Hainsey"],["Ronnie","Perkins"],["Tre'","McKitty"],["Quinn","Meinerz"],
    ["Nahshon","Wright"],["Elijah","Molden"],["Ifeatu","Melifonwu"],["Ambry","Thomas"],
    ["Ernest","Jones"],["Brandon","Stephens"],["Baron","Browning"],["Jay","Tufele"],
    ["Michael","Carter"],["Darren","Hall"],["James","Hudson"],["Cameron","Sample"],
    ["Amon-Ra","St."],["Derrick","Barnes"],["Drew","Dalman"],["Jabril","Cox"],
    ["Elerson","Smith"],["Bobby","Brown"],["Chris","Rumph"],["Kene","Nwangwu"],
    ["Rhamondre","Stevenson"],["Jordan","Smith"]
  ];
  for (const [first,last] of names) {
    const m = docs.find(d => (d.Player||'').toLowerCase().includes(first.toLowerCase()) && (d.Player||'').toLowerCase().includes(last.toLowerCase()));
    if (!m) { console.log(`NO MATCH: ${first} ${last}`); continue; }
    console.log(`pick ${m.Pick} | ${m.Player} | Pos:${m.Position} | School:${m.School} | S:${(m.Strengths||[]).length} W:${(m.Weaknesses||[]).length} | RG:${m.RoundGrade}`);
  }
}
main();
