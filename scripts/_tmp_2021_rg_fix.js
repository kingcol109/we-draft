const { getFirestore } = require('./firebaseAdmin');
const db = getFirestore();

// New standing rule: when a page has no Draft Projection, RoundGrade
// falls back to the round they were actually drafted in. Round 1 splits
// into thirds (1-10 Early, 11-21 Middle, 22-32 Late); rounds 2-7 map
// directly to their own grade.
function gradeForRound(round, pick) {
  const r = parseInt(round, 10);
  const p = parseInt(pick, 10);
  if (r === 1) {
    if (p <= 10) return "Early First Round";
    if (p <= 21) return "Middle First Round";
    return "Late First Round";
  }
  const names = { 2: "Second Round", 3: "Third Round", 4: "Fourth Round", 5: "Fifth Round", 6: "Sixth Round", 7: "Seventh Round" };
  return names[r] || null;
}

const FIXES = [
  { first: "Micah", last: "Parsons" },
  { first: "Zaven", last: "Collins" },
  { first: "Jamin", last: "Davis" },
  { first: "Jeremiah", last: "Owusu-Koramoah" },
  { first: "Nick", last: "Bolton" },
  { first: "Pete", last: "Werner" },
  { first: "Chazz", last: "Surratt" },
];

async function main() {
  const snap = await db.collection('historical').where('Year','==','2021').get();
  const docs = snap.docs;
  for (const p of FIXES) {
    const match = docs.find(d => {
      const data = d.data();
      return (data.Player||'').toLowerCase().includes(p.first.toLowerCase()) && (data.Player||'').toLowerCase().includes(p.last.toLowerCase());
    });
    if (!match) { console.log(`SKIP (no match): ${p.first} ${p.last}`); continue; }
    const before = match.data();
    const grade = gradeForRound(before.Round, before.Pick);
    if (!grade) { console.log(`SKIP (no round grade mapping): ${before.Player} R${before.Round}`); continue; }
    await match.ref.update({ RoundGrade: grade });
    console.log(`OK ${before.Player} (pick ${before.Pick}, Round ${before.Round}) -> RoundGrade: ${grade}`);
  }
}
main();
