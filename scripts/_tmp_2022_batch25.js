const { getFirestore } = require('./firebaseAdmin');

const db = getFirestore();

const VALID_ROUND_GRADES = [
  "Watchlist", "Early First Round", "Middle First Round", "Late First Round",
  "Second Round", "Third Round", "Fourth Round", "Fifth Round", "Sixth Round",
  "Seventh Round", "UDFA",
];

const PLAYERS = [
  { first: "Marcus", last: "McKethan", strengths: ["Frame","Run Blocking","Anchor","Pass Protection","Lateral Agility"], weaknesses: ["Balance","Hand Usage","Reaction Time"], roundGrade: "Sixth Round" },
  { first: "Dominique", last: "Robinson", strengths: ["Explosiveness","First Step","Hand Usage","Lateral Agility","Bend"], weaknesses: ["Experience","Power Rush","Pass Rush Plan"], roundGrade: "Third Round" },
  { first: "Matthew", last: "Butler", strengths: ["Bend","Block Shedding","Motor","Lateral Agility","Pass Rush Moves"], weaknesses: ["Lower Body Strength","Balance","Pass Rush Plan"], roundGrade: "Fourth Round" },
  { first: "Damone", last: "Clark", strengths: ["Physicality","Block Avoidance","Stopping Power","Play Recognition","Tackling"], weaknesses: ["Zone Instincts","Closing Speed","Block Shedding"], roundGrade: "Fourth Round" },
  { first: "James", last: "Mitchell", strengths: ["Run Blocking","Hand Usage","Route Running","Ball Skills","Ball Tracking"], weaknesses: ["Injury History","Lower Body Strength","Balance"], roundGrade: "Fifth Round" },
  { first: "John", last: "Ridgeway", strengths: ["Frame","Lower Body Strength","Pad Level","Run Defense","First Step"], weaknesses: ["Speed Rush","Pass Rush Moves","Hand Usage"], roundGrade: "Fourth Round" },
  { first: "Kingsley", last: "Enagbare", strengths: ["Upper Body Strength","Power Rush","Edge Setting","Hand Usage","Physicality"], weaknesses: ["Lateral Agility","Pass Rush Plan","Explosiveness"], roundGrade: "Fourth Round" },
  { first: "Kyron", last: "Johnson", strengths: ["Lower Body Strength","Balance","Hand Usage","Power Rush","Closing Speed"], weaknesses: ["Experience","Lateral Agility","Frame"], roundGrade: "Fifth Round" },
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
