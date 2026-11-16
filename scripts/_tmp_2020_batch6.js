const { getFirestore } = require('./firebaseAdmin');
const db = getFirestore();
const VALID_ROUND_GRADES = ["Watchlist","Early First Round","Middle First Round","Late First Round","Second Round","Third Round","Fourth Round","Fifth Round","Sixth Round","Seventh Round","UDFA"];

const PLAYERS = [
  { first: "Colton", last: "McKivitz", strengths: ["Experience","Physicality","Lateral Agility","Hand Usage","Pass Set"], weaknesses: ["Frame","Leg Drive","Anchor"], roundGrade: "Sixth Round" },
  { first: "Jason", last: "Strowbridge", strengths: ["Frame","First Step","Physicality","Hand Usage","Power Rush"], weaknesses: ["Position Versatility","Balance","Pass Rush Plan"], roundGrade: "Third Round" },
  { first: "Trevis", last: "Gipson", strengths: ["Frame","First Step","Lateral Agility","Power Rush","Hand Usage"], weaknesses: ["Experience","Balance","Pass Rush Plan"], roundGrade: "Fifth Round" },
  { first: "Keith", last: "Ismael", strengths: ["Position Versatility","Lateral Agility","Run Blocking","Hand Usage"], weaknesses: ["Frame","Injury History","Balance"], roundGrade: "Fifth Round" },
  { first: "Daniel", last: "Thomas", strengths: ["Frame","Zone Instincts","Range","Run Support","Special Teams Value"], weaknesses: ["Transitions","Man Technique","Block Avoidance"], roundGrade: "Sixth Round" },
  { first: "Bryce", last: "Hall", strengths: ["Frame","Press","Man Technique","Zone Instincts","Ball Skills"], weaknesses: ["Injury History","Hip Fluidity","Ball Hawk"], roundGrade: "Fourth Round" },
  { first: "Nick", last: "Harris", strengths: ["Physicality","Lateral Agility","Hand Usage","Balance","Pass Set"], weaknesses: ["Frame","Leg Drive","Pad Level"], roundGrade: "Fifth Round" },
  { first: "Tyler", last: "Johnson", strengths: ["Experience","Body Control","Ball Skills","Route Running"], weaknesses: ["Press","Long Speed","Separation"], roundGrade: "Fifth Round" },
  { first: "Khaleke", last: "Hudson", strengths: ["Motor","Physicality","Play Recognition","Lateral Agility","Special Teams Value"], weaknesses: ["Balance","Block Avoidance","Man Coverage"], roundGrade: "UDFA" },
  { first: "Kindle", last: "Vildor", strengths: ["Position Versatility","Transitions","Zone Instincts","Frame","Ball Skills"], weaknesses: ["Range","Man Technique","Run Support"], roundGrade: "Fifth Round" },
  { first: "Curtis", last: "Weaver", strengths: ["Motor","Lateral Agility","Hand Usage","Pass Rush Moves","Power Rush"], weaknesses: ["Frame","Closing Speed","Edge Setting"], roundGrade: "Fifth Round" },
  { first: "Collin", last: "Johnson", strengths: ["Frame","Press","Route Running","Ball Skills","Run Blocking"], weaknesses: ["Release","Body Control","Separation"], roundGrade: "Sixth Round" },
  { first: "Quintez", last: "Cephus", strengths: ["Frame","Ball Skills","Press","RAC Ability","Run Blocking"], weaknesses: ["Release","Route Running","Separation"], roundGrade: "Sixth Round" },
  { first: "Jake", last: "Fromm", strengths: ["Pocket Presence","Decision Making","Timing","Accuracy","Running Ability"], weaknesses: ["Arm Strength","Throwing Motion","Deep Accuracy"], roundGrade: "Third Round" },
  { first: "John", last: "Hightower", strengths: ["Route Running","Long Speed","Separation","Ball Tracking","RAC Ability"], weaknesses: ["Press","Experience","Ball Skills"], roundGrade: "Fifth Round" },
  { first: "Harrison", last: "Hand", strengths: ["Frame","Press","Zone Instincts","Man Technique","Tackling"], weaknesses: ["Transitions","Recovery","Angle Tackling"], roundGrade: "Fifth Round" },
  { first: "Broderick", last: "Washington", strengths: ["Motor","Lower Body Strength","Hand Usage","Run Defense","Power Rush"], weaknesses: ["Bend","Pass Rush Plan","Lateral Agility"], roundGrade: "Sixth Round" },
  { first: "Isaiah", last: "Coulter", strengths: ["Frame","Release","Body Control","Ball Skills","RAC Ability"], weaknesses: ["Experience","Route Running","Deep Routes"], roundGrade: "Fifth Round" },
  { first: "Jason", last: "Huntley", strengths: ["Position Versatility","Vision","Elusiveness","Receiving Ability"], weaknesses: ["Frame","Downhill","Ball Security"], roundGrade: "Seventh Round" },
  { first: "Darnell", last: "Mooney", strengths: ["Position Versatility","Release","Separation","Long Speed","Ball Tracking"], weaknesses: ["Frame","Route Running","Hands"], roundGrade: "Seventh Round" },
  { first: "Larrell", last: "Murchison", strengths: ["Motor","Lateral Agility","Pass Rush Moves","Run Defense","Pad Level"], weaknesses: ["Bend","Closing Speed","Hand Usage"], roundGrade: "Fifth Round" },
  { first: "Kamal", last: "Martin", strengths: ["Block Avoidance","Closing Speed","Play Recognition","Tackling","Special Teams Value"], weaknesses: ["Zone Instincts","Balance","Lateral Agility"], roundGrade: "UDFA" },
  { first: "K.J.", last: "Osborn", strengths: ["Physicality","Zone Instincts","Special Teams Value"], weaknesses: ["Press","Long Speed","Separation"], roundGrade: "UDFA" },
  { first: "Michael", last: "Danna", strengths: ["Frame","Bend","Edge Setting","Pass Rush Plan"], weaknesses: ["Experience","Explosiveness","Speed to Power"], roundGrade: "Fifth Round" },
  { first: "Justin", last: "Strnad", strengths: ["Sideline to Sideline","Lateral Agility","Block Avoidance","Closing Speed","Special Teams Value"], weaknesses: ["Frame","Injury History","Zone Instincts"], roundGrade: "Fourth Round" },
  { first: "Bradlee", last: "Anae", strengths: ["First Step","Edge Setting","Position Versatility","Hand Usage","Motor"], weaknesses: ["Lateral Agility","Closing Speed","Bend"], roundGrade: "Third Round" },
  { first: "Hakeem", last: "Adeniji", strengths: ["Position Versatility","Hand Usage","Lateral Agility","Leg Drive","Pass Set"], weaknesses: ["Footwork","Balance","Anchor"], roundGrade: "Sixth Round" },
  { first: "Netane", last: "Muti", strengths: ["Frame","Leg Drive","Hand Usage","Grip Strength","Anchor"], weaknesses: ["Injury History","Footwork","Balance"], roundGrade: "Seventh Round" },
  { first: "Mike", last: "Onwenu", strengths: ["Frame","Upper Body Strength","Anchor","Balance","Hand Usage"], weaknesses: ["Explosiveness","Lateral Agility","Pad Level"], roundGrade: "Sixth Round" },
  { first: "Cameron", last: "Brown", strengths: ["Sideline to Sideline","Play Recognition","Tackling","Block Avoidance","Pass Rushing"], weaknesses: ["Frame","Balance","Zone Instincts"], roundGrade: "Fifth Round" },
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
