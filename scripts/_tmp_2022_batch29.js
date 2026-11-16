const { getFirestore } = require('./firebaseAdmin');

const db = getFirestore();

const VALID_ROUND_GRADES = [
  "Watchlist", "Early First Round", "Middle First Round", "Late First Round",
  "Second Round", "Third Round", "Fourth Round", "Fifth Round", "Sixth Round",
  "Seventh Round", "UDFA",
];

const PLAYERS = [
  { first: "Austin", last: "Deculus", strengths: ["Experience","Pass Protection","Hand Usage","Upper Body Strength","Patience"], weaknesses: ["Flexibility","Balance","Lower Body Strength"], roundGrade: "UDFA" },
  { first: "Matt", last: "Henningsen", strengths: ["Lower Body Strength","Physicality","Hand Usage","Block Shedding","Power Rush"], weaknesses: ["Balance","Pass Rush Moves","First Step"], roundGrade: null },
  { first: "Doug", last: "Kramer", strengths: ["Experience","Run Blocking","Leg Drive","Lateral Agility"], weaknesses: ["Frame","Upper Body Strength","Balance"], roundGrade: null },
  { first: "Connor", last: "Heyward", strengths: ["Position Versatility","Route Running","Hands","Ball Skills","RAC Ability"], weaknesses: ["Frame","Lateral Agility","Run Blocking"], roundGrade: null },
  { first: "Luke", last: "Tenuta", strengths: ["Position Versatility","Lateral Agility","Run Blocking","Hand Usage","Pass Protection"], weaknesses: ["Pad Level","Leg Drive","Upper Body Strength"], roundGrade: "UDFA", combine: { "Shuttle": "4.77" } },
  { first: "Chasen", last: "Hines", strengths: ["Frame","Leg Drive","Run Blocking","Anchor","Hand Usage"], weaknesses: ["Hand Placement","Pass Protection","Reaction Time"], roundGrade: "Sixth Round" },
  { first: "Quentin", last: "Lake", strengths: ["Frame","Zone Instincts","Ball Hawk","Ball Skills","Run Support"], weaknesses: ["Recovery","Man Technique","Range"], roundGrade: "Sixth Round" },
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

    if (p.roundGrade && !VALID_ROUND_GRADES.includes(p.roundGrade)) {
      console.error(`BAD ROUND GRADE for ${p.first} ${p.last}: ${p.roundGrade}`);
      skipped++; continue;
    }
    if (p.weaknesses.length !== 3) { console.error(`BAD WEAKNESS COUNT for ${p.first} ${p.last}: ${p.weaknesses.length}`); skipped++; continue; }
    if (p.strengths.length < 3 || p.strengths.length > 5) { console.error(`BAD STRENGTH COUNT for ${p.first} ${p.last}: ${p.strengths.length}`); skipped++; continue; }

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

    const update = { Strengths: p.strengths, Weaknesses: p.weaknesses };
    if (p.roundGrade) update.RoundGrade = p.roundGrade;
    else console.log(`NOTE ${before.Player}: no Draft Projection on page — RoundGrade left untouched`);
    if (p.combine) Object.assign(update, p.combine);

    await match.ref.update(update);
    console.log(`OK ${before.Player} (pick ${before.Pick}, Pos:${before.Position}) -> ${JSON.stringify(update)}`);
    updated++;
  }
  console.log(`\nDone. ${updated} updated, ${skipped} skipped.`);
}
main();
