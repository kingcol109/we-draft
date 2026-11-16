const { getFirestore } = require('./firebaseAdmin');
const db = getFirestore();
const VALID_ROUND_GRADES = ["Watchlist","Early First Round","Middle First Round","Late First Round","Second Round","Third Round","Fourth Round","Fifth Round","Sixth Round","Seventh Round","UDFA"];

const PLAYERS = [
  { first: "Bravvion", last: "Roy", strengths: ["Balance","First Step","Pad Level","Upper Body Strength","Power Rush"], weaknesses: ["Frame","Run Defense","Lateral Agility"], roundGrade: "Seventh Round" },
  { first: "Alohi", last: "Gilman", strengths: ["Physicality","Range","Block Avoidance","Ball Hawk","Special Teams Value"], weaknesses: ["Zone Instincts","Frame","Angle Tackling"], roundGrade: "Fifth Round" },
  { first: "Donovan", last: "Peoples-Jones", strengths: ["Frame","Route Running","Ball Tracking","RAC Ability","Hands"], weaknesses: ["Release","Long Speed","Separation"], roundGrade: "Third Round" },
  { first: "Jake", last: "Luton", strengths: ["Frame","Ball Security","Deep Accuracy","Throwing Motion","Anticipation"], weaknesses: ["Ball Placement","Progressions","Pocket Presence"], roundGrade: "Sixth Round" },
  { first: "Charlie", last: "Woerner", strengths: ["Physicality","Run Blocking","Balance","Route Running","Long Speed"], weaknesses: ["Frame","Ball Skills","Release"], roundGrade: "UDFA" },
  { first: "Jon", last: "Runyan", strengths: ["Experience","Instincts","Position Versatility","Hand Usage","Lateral Agility"], weaknesses: ["Hand Timing","Pad Level","Leg Drive"], roundGrade: "Sixth Round" },
  { first: "Rob", last: "Windsor", strengths: ["Motor","Block Shedding","Lateral Agility","Hand Usage"], weaknesses: ["Experience","Lower Body Strength","Run Defense"], roundGrade: "Seventh Round" },
  { first: "Khalil", last: "Davis", strengths: ["Pad Level","Hand Usage","Lateral Agility","Closing Speed","Pass Rush Moves"], weaknesses: ["Frame","Upper Body Strength","Balance"], roundGrade: "Fifth Round" },
  { first: "Justin", last: "Herron", strengths: ["Experience","Lateral Agility","Leg Drive","Pad Level","Balance"], weaknesses: ["Hand Placement","Lower Body Strength","Pass Set"], roundGrade: "Sixth Round" },
  { first: "Shaun", last: "Bradley", strengths: ["Experience","Play Recognition","Tackling","Block Avoidance","Special Teams Value"], weaknesses: ["Frame","Block Shedding","Closing Speed"], roundGrade: "Sixth Round" },
  { first: "John", last: "Penisini", strengths: ["Frame","Run Defense","Pad Level","Hand Usage"], weaknesses: ["Experience","Balance","Pass Rush Plan"], roundGrade: "Seventh Round" },
  { first: "Antoine", last: "Brooks", strengths: ["Physicality","Zone Instincts","Tackling","Transitions","Special Teams Value"], weaknesses: ["Patience","Position Versatility","Hip Fluidity"], roundGrade: "Fifth Round" },
  { first: "Jordan", last: "Fuller", strengths: ["Position Versatility","Run Support","Zone Instincts","Ball Hawk","Physicality"], weaknesses: ["Frame","Range","Man Technique"], roundGrade: "Seventh Round" },
  { first: "Quez", last: "Watkins", strengths: ["Frame","Body Control","Ball Skills","Separation","RAC Ability"], weaknesses: ["Experience","Release","Route Running"], roundGrade: "Fourth Round" },
  { first: "James", last: "Proche", strengths: ["Experience","Press","Ball Skills","Ball Tracking","Special Teams Value"], weaknesses: ["Release","Route Running","Long Speed"], roundGrade: "Seventh Round" },
  { first: "Evan", last: "Weaver", strengths: ["Motor","Play Recognition","Block Avoidance","Zone Instincts"], weaknesses: ["Frame","Closing Speed","Balance"], roundGrade: "Sixth Round" },
  { first: "Blake", last: "Brandel", strengths: ["Experience","Footwork","Leg Drive","Hand Usage","Physicality"], weaknesses: ["Frame","Lower Body Strength","Balance"], roundGrade: "UDFA" },
  { first: "Cassh", last: "Maluia", strengths: ["Experience","Play Recognition","Lateral Agility","Closing Speed","Special Teams Value"], weaknesses: ["Penalties","Block Avoidance","Angle Tackling"], roundGrade: "UDFA" },
  { first: "Josh", last: "Metellus", strengths: ["Run Support","Tackling","Position Versatility","Transitions","Ball Skills"], weaknesses: ["Experience","Range","Frame"], roundGrade: "Fifth Round" },
  { first: "Tyler", last: "Davis", strengths: ["Physicality","Long Speed","Separation","Route Running","Run Blocking"], weaknesses: ["Release","Ball Skills","Hand Usage"], roundGrade: "Sixth Round" },
  { first: "Isaiah", last: "Hodgins", strengths: ["Frame","Route Running","Ball Skills","Ball Tracking","Separation"], weaknesses: ["Press","Long Speed","Body Control"], roundGrade: "Fourth Round" },
  { first: "Jake", last: "Hanson", strengths: ["Experience","Motor","Physicality","Hand Usage","Lateral Agility"], weaknesses: ["Lower Body Strength","Footwork","Hand Timing"], roundGrade: "Sixth Round" },
  { first: "Simon", last: "Stepaniak", strengths: ["Frame","Pad Level","Upper Body Strength","Hand Usage","Lateral Agility"], weaknesses: ["Pass Set","Lower Body Strength","Balance"], roundGrade: "Sixth Round" },
  { first: "Prince", last: "Wanogho", strengths: ["Leg Drive","Lateral Agility","Hand Usage","Anchor"], weaknesses: ["Footwork","Hand Placement","Frame"], roundGrade: "Third Round" },
  { first: "Isaiah", last: "Rodgers", strengths: ["Ball Hawk","Range","Zone Instincts","Ball Skills","Special Teams Value"], weaknesses: ["Frame","Recovery","Run Support"], roundGrade: "Sixth Round" },
  { first: "Dezmon", last: "Patmon", strengths: ["Frame","Route Running","Long Speed","Ball Skills","RAC Ability"], weaknesses: ["Release","Separation","Physicality"], roundGrade: "Seventh Round" },
  { first: "Jordan", last: "Glasgow", strengths: ["Special Teams Value","Physicality","Play Recognition","Block Avoidance","Tackling"], weaknesses: ["Frame","Sideline to Sideline","Man Coverage"], roundGrade: "UDFA" },
  { first: "Freddie", last: "Swain", strengths: ["Frame","RAC Ability","Hands","Long Speed","Special Teams Value"], weaknesses: ["Ball Skills","Press","Route Running"], roundGrade: "Seventh Round" },
  { first: "Markus", last: "Bailey", strengths: ["Motor","Physicality","Play Recognition","Block Avoidance","Tackling"], weaknesses: ["Injury History","Zone Instincts","Balance"], roundGrade: "Sixth Round" },
];

async function main() {
  const snap = await db.collection('historical').where('Year','==','2020').get();
  const docs = snap.docs;
  let updated = 0, skipped = 0;
  for (const p of PLAYERS) {
    const match = docs.find(d => {
      const name = (d.data().Player||'').toLowerCase();
      return name.includes(p.first.toLowerCase()) && name.includes(p.last.toLowerCase());
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
    await match.ref.update(update);
    console.log(`OK ${before.Player} (pick ${before.Pick}, Pos:${before.Position})`);
    updated++;
  }
  console.log(`\nDone. ${updated} updated, ${skipped} skipped.`);
}
main();
