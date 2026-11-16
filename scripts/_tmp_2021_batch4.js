const { getFirestore } = require('./firebaseAdmin');
const db = getFirestore();
const VALID_ROUND_GRADES = ["Watchlist","Early First Round","Middle First Round","Late First Round","Second Round","Third Round","Fourth Round","Fifth Round","Sixth Round","Seventh Round","UDFA"];

const PLAYERS = [
  { first: "Anthony", last: "Schwartz", strengths: ["Long Speed","Separation","RAC Ability","Route Running","Special Teams Value"], weaknesses: ["Zone Instincts","Ball Tracking","Hands"], roundGrade: "Fourth Round" },
  { first: "Monty", last: "Rice", strengths: ["Play Recognition","Block Avoidance","Pursuit Angles","Sideline to Sideline","Angle Tackling"], weaknesses: ["Aggressiveness","Injury History","Man Coverage"], roundGrade: "Third Round" },
  { first: "Spencer", last: "Brown", strengths: ["Balance","Lateral Agility","Pad Level","Leg Drive","Hand Usage"], weaknesses: ["Footwork","Pass Set","Lower Body Strength"], roundGrade: "Second Round" },
  { first: "Ben", last: "Cleveland", strengths: ["Upper Body Strength","Leg Drive","Balance","Run Blocking","Anchor"], weaknesses: ["Lateral Agility","Reaction Time","Hand Timing"], roundGrade: "Fourth Round" },
  { first: "Robert", last: "Hainsey", strengths: ["Leg Drive","Run Blocking","Hand Usage","Anchor","Pass Set"], weaknesses: ["Frame","Lateral Agility","Balance"], roundGrade: "Fourth Round" },
  { first: "Ronnie", last: "Perkins", strengths: ["Motor","Lateral Agility","Hand Usage","Closing Speed","Pass Rush Moves"], weaknesses: ["Frame","Edge Setting","Speed to Power"], roundGrade: "Third Round" },
  { first: "Tre'", last: "McKitty", strengths: ["Route Running","Hands","RAC Ability","Lateral Agility","Pass Blocking"], weaknesses: ["Run Blocking","Release","Ball Skills"], roundGrade: "Sixth Round" },
  { first: "Quinn", last: "Meinerz", strengths: ["Grip Strength","Balance","Leg Drive","Run Blocking","Hand Usage"], weaknesses: ["Footwork","Pad Level","Lateral Agility"], roundGrade: "Second Round" },
  { first: "Nahshon", last: "Wright", strengths: ["Zone Instincts","Range","Ball Hawk","Ball Skills"], weaknesses: ["Frame","Transitions","Run Support"], roundGrade: "Seventh Round" },
  { first: "Elijah", last: "Molden", strengths: ["Position Versatility","Run Support","Press","Transitions","Man Technique"], weaknesses: ["Frame","Hip Fluidity","Recovery"], roundGrade: "Third Round" },
  { first: "Ifeatu", last: "Melifonwu", strengths: ["Range","Transitions","Zone Instincts","Tackling","Man Technique"], weaknesses: ["Press","Recovery","Injury History"], roundGrade: "Second Round" },
  { first: "Ambry", last: "Thomas", strengths: ["Press","Man Technique","Ball Hawk","Zone Instincts","Tackling"], weaknesses: ["Hip Fluidity","Penalties","Ball Skills"], roundGrade: "Fourth Round" },
  { first: "Ernest", last: "Jones", strengths: ["Physicality","Play Recognition","Pad Level","Block Shedding","Tackling"], weaknesses: ["Lateral Agility","Sideline to Sideline","Block Avoidance"], roundGrade: "Third Round" },
  { first: "Brandon", last: "Stephens", strengths: ["Frame","Hip Fluidity","Ball Skills","Tackling","Special Teams Value"], weaknesses: ["Experience","Press","Zone Instincts"], roundGrade: "Fifth Round" },
  { first: "Baron", last: "Browning", strengths: ["Position Versatility","Lateral Agility","Motor","Tackling","Block Avoidance"], weaknesses: ["Instincts","Stopping Power","Play Recognition"], roundGrade: "Third Round" },
  { first: "Jay", last: "Tufele", strengths: ["Motor","Power Rush","Block Shedding","Closing Speed","Hand Usage"], weaknesses: ["Run Defense","Balance","Pass Rush Plan"], roundGrade: "Fourth Round" },
  { first: "Michael", last: "Carter", strengths: ["Ball Security","Vision","Lateral Agility","Contact Balance","Pass Protection"], weaknesses: ["Patience","Elusiveness","Acceleration"], roundGrade: "Third Round" },
  { first: "Darren", last: "Hall", strengths: ["Man Technique","Zone Instincts","Ball Hawk","Press","Run Support"], weaknesses: ["Instincts","Hip Fluidity","Recovery"], roundGrade: "Fifth Round" },
  { first: "James", last: "Hudson", strengths: ["Lateral Agility","Run Blocking","Hand Usage","Leg Drive","Pass Protection"], weaknesses: ["Experience","Pass Set","Balance"], roundGrade: "Fourth Round" },
  { first: "Cameron", last: "Sample", strengths: ["Position Versatility","Hand Usage","Lateral Agility","Pass Rush Moves","Motor"], weaknesses: ["Closing Speed","Balance","Lower Body Strength"], roundGrade: "Sixth Round" },
  { first: "Amon-Ra", last: "Brown", strengths: ["Release","Body Control","Route Running","Ball Tracking","RAC Ability"], weaknesses: ["Press","Hands","Separation"], roundGrade: "Second Round" },
  { first: "Derrick", last: "Barnes", strengths: ["Position Versatility","Stopping Power","Block Avoidance","Tackling","Special Teams Value"], weaknesses: ["Play Recognition","Lateral Agility","Block Shedding"], roundGrade: "Fourth Round" },
  { first: "Drew", last: "Dalman", strengths: ["Hand Usage","Leg Drive","Lateral Agility","Balance","Anchor"], weaknesses: ["Frame","Explosiveness","Lower Body Strength"], roundGrade: "Fifth Round" },
  { first: "Jabril", last: "Cox", strengths: ["Sideline to Sideline","Lateral Agility","Block Shedding","Man Coverage","Zone Instincts"], weaknesses: ["Balance","Play Recognition","Pursuit Angles"], roundGrade: "Fourth Round" },
  { first: "Elerson", last: "Smith", strengths: ["Frame","First Step","Closing Speed","Hand Usage","Motor"], weaknesses: ["Lower Body Strength","Balance","Power Rush"], roundGrade: "Fourth Round" },
  { first: "Bobby", last: "Brown", strengths: ["Position Versatility","Pad Level","Balance","Closing Speed","Hand Usage"], weaknesses: ["First Step","Pass Rush Plan","Lateral Agility"], roundGrade: "Third Round" },
  { first: "Chris", last: "Rumph", strengths: ["Bend","Lateral Agility","Motor","Hand Usage","Closing Speed"], weaknesses: ["Frame","Balance","Penalties"], roundGrade: "Third Round" },
  { first: "Kene", last: "Nwangwu", strengths: ["Contact Balance","Acceleration","Ball Security","Special Teams Value","Pass Protection"], weaknesses: ["Lateral Agility","Vision","Receiving Ability"], roundGrade: "Seventh Round" },
  { first: "Rhamondre", last: "Stevenson", strengths: ["Contact Balance","Lateral Agility","Receiving Ability","Pass Protection","Special Teams Value"], weaknesses: ["Ball Security","Vision","Downhill"], roundGrade: "Fourth Round" },
  { first: "Jordan", last: "Smith", strengths: ["Motor","Bend","Closing Speed","Lateral Agility","Hand Usage"], weaknesses: ["Lower Body Strength","Balance","Pass Rush Plan"], roundGrade: "Fourth Round" },
];

async function main() {
  const snap = await db.collection('historical').where('Year','==','2021').get();
  const docs = snap.docs;
  let updated = 0, skipped = 0;
  for (const p of PLAYERS) {
    const match = docs.find(d => {
      const data = d.data();
      return (data.Player||'').toLowerCase().includes(p.first.toLowerCase()) && (data.Player||'').toLowerCase().includes(p.last.toLowerCase());
    });
    if (!match) { console.log(`SKIP (no match): ${p.first} ${p.last}`); skipped++; continue; }
    const before = match.data();
    if (p.roundGrade && !VALID_ROUND_GRADES.includes(p.roundGrade)) { console.error(`BAD ROUND GRADE for ${p.first} ${p.last}: ${p.roundGrade}`); skipped++; continue; }
    if (p.weaknesses.length !== 3) { console.error(`BAD WEAKNESS COUNT for ${p.first} ${p.last}: ${p.weaknesses.length}`); skipped++; continue; }
    if (p.strengths.length < 3 || p.strengths.length > 5) { console.error(`BAD STRENGTH COUNT for ${p.first} ${p.last}: ${p.strengths.length}`); skipped++; continue; }
    const overlap = p.strengths.filter(s => p.weaknesses.includes(s));
    if (overlap.length) console.warn(`⚠ ${before.Player}: overlap: ${overlap.join(', ')}`);
    const [posSnap, genSnap] = await Promise.all([db.collection('traits').doc(before.Position).get(), db.collection('traits').doc('Generic').get()]);
    const valid = new Set([...(posSnap.exists ? posSnap.data().traits || [] : []), ...(genSnap.exists ? genSnap.data().traits || [] : [])]);
    const unknown = [...p.strengths, ...p.weaknesses].filter(t => !valid.has(t));
    if (unknown.length) console.warn(`⚠ ${before.Player}: not in traits/${before.Position} or traits/Generic: ${unknown.join(', ')}`);
    const update = { Strengths: p.strengths, Weaknesses: p.weaknesses };
    if (p.roundGrade) update.RoundGrade = p.roundGrade;
    else console.log(`NOTE ${before.Player}: no Draft Projection on page — RoundGrade left untouched`);
    await match.ref.update(update);
    console.log(`OK ${before.Player} (pick ${before.Pick}, Pos:${before.Position})`);
    updated++;
  }
  console.log(`\nDone. ${updated} updated, ${skipped} skipped.`);
}
main();
