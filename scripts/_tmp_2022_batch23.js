const { getFirestore } = require('./firebaseAdmin');

const db = getFirestore();

const VALID_ROUND_GRADES = [
  "Watchlist", "Early First Round", "Middle First Round", "Late First Round",
  "Second Round", "Third Round", "Fourth Round", "Fifth Round", "Sixth Round",
  "Seventh Round", "UDFA",
];

const PLAYERS = [
  { first: "Eric", last: "Johnson", strengths: ["Frame","Run Defense","Lower Body Strength","Pad Level","Hand Usage"], weaknesses: ["Motor","Pass Rush Plan","First Step"], roundGrade: "Sixth Round" },
  { first: "Otito", last: "Ogbonnia", strengths: ["Frame","Explosiveness","Run Defense","Hand Usage","Pass Rush Moves"], weaknesses: ["Experience","Pad Level","Lateral Agility"], roundGrade: "Fifth Round" },
  { first: "D'Marco", last: "Jackson", strengths: ["Block Avoidance","Sideline to Sideline","Tackling","Man Coverage","Special Teams Value"], weaknesses: ["Stopping Power","Block Shedding","Play Recognition"], roundGrade: "Sixth Round" },
  { first: "Montrell", last: "Washington", strengths: ["Separation","Ball Tracking","Route Running","Ball Skills","Special Teams Value"], weaknesses: ["Frame","Hands","Release"], roundGrade: "Fifth Round" },
  { first: "Kyle", last: "Philips", strengths: ["Release","Route Running","Separation","Short Routes","Special Teams Value"], weaknesses: ["Zone Instincts","Deep Routes","Hands"], roundGrade: "Sixth Round" },
  { first: "Kyren", last: "Williams", strengths: ["Lateral Agility","Elusiveness","Patience","Receiving Ability","Pass Protection"], weaknesses: ["Explosiveness","Vision","Ball Security"], roundGrade: "Sixth Round" },
  { first: "Esezi", last: "Otomewo", strengths: ["Motor","Pass Rush Plan","Pass Rush Moves","Power Rush","Edge Setting"], weaknesses: ["Bend","Change of Direction","Balance"], roundGrade: "Sixth Round" },
];

async function main() {
  const snap = await db.collection('historical').where('Year','==','2022').get();
  const docs = snap.docs;
  let updated = 0, skipped = 0;
  for (const p of PLAYERS) {
    const match = docs.find(d => {
      const data = d.data();
      return (data.Player||'').toLowerCase().includes(p.first.toLowerCase()) && (data.Player||'').toLowerCase().includes(p.last.toLowerCase());
    });
    if (!match) { console.log(`SKIP (no match): ${p.first} ${p.last}`); skipped++; continue; }
    const before = match.data();

    if (!VALID_ROUND_GRADES.includes(p.roundGrade)) {
      console.error(`BAD ROUND GRADE for ${p.first} ${p.last}: ${p.roundGrade}`);
      skipped++; continue;
    }

    const overlap = p.strengths.filter(s => p.weaknesses.includes(s));
    if (overlap.length) console.warn(`⚠ ${before.Player}: overlap between strengths/weaknesses: ${overlap.join(', ')}`);

    const [posSnap, genSnap] = await Promise.all([
      db.collection('traits').doc(before.Position).get(),
      db.collection('traits').doc('Generic').get(),
    ]);
    const valid = new Set([
      ...(posSnap.exists ? posSnap.data().traits || [] : []),
      ...(genSnap.exists ? genSnap.data().traits || [] : []),
    ]);
    const unknown = [...p.strengths, ...p.weaknesses].filter(t => !valid.has(t));
    if (unknown.length) console.warn(`⚠ ${before.Player}: not in traits/${before.Position} or traits/Generic: ${unknown.join(', ')}`);

    const update = { RoundGrade: p.roundGrade, Strengths: p.strengths, Weaknesses: p.weaknesses };

    await match.ref.update(update);
    console.log(`OK ${before.Player} (pick ${before.Pick}, Pos:${before.Position}) -> ${JSON.stringify(update)}`);
    updated++;
  }
  console.log(`\nDone. ${updated} updated, ${skipped} skipped.`);
}
main();
