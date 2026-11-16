const { getFirestore } = require('./firebaseAdmin');
const db = getFirestore();
const VALID_ROUND_GRADES = ["Watchlist","Early First Round","Middle First Round","Late First Round","Second Round","Third Round","Fourth Round","Fifth Round","Sixth Round","Seventh Round","UDFA"];

const PLAYERS = [
  { first: "Ben", last: "Powers", strengths: ["Frame","Physicality","Anchor","Balance","Hand Usage"], weaknesses: ["Leg Drive","Lateral Agility","Upper Body Strength"], roundGrade: "Fifth Round" },
  { first: "Phil", last: "Haynes", strengths: ["Frame","Pad Level","Hand Usage","Leg Drive","Physicality"], weaknesses: ["Experience","Lateral Agility","Pass Set"], roundGrade: "Fourth Round" },
  { first: "Renell", last: "Wren", strengths: ["Frame","Upper Body Strength","Position Versatility","First Step","Pass Rush Moves"], weaknesses: ["Motor","Balance","Run Defense"], roundGrade: "Third Round" },
  { first: "Riley", last: "Ridley", strengths: ["Physicality","Press","Route Running","Hands","Run Blocking"], weaknesses: ["Release","Long Speed","Separation"], roundGrade: "Second Round" },
  { first: "Iman", last: "Marshall", strengths: ["Experience","Press","Man Technique","Ball Skills","Tackling"], weaknesses: ["Hip Fluidity","Penalties","Ball Hawk"], roundGrade: "Fourth Round" },
  { first: "Tony", last: "Pollard", strengths: ["Frame","Special Teams Value","Position Versatility","Contact Balance","Receiving Ability"], weaknesses: ["Patience","Elusiveness","Lateral Agility"], roundGrade: "Sixth Round" },
  { first: "Isaiah", last: "Johnson", strengths: ["Frame","Press","Transitions","Recovery","Ball Skills"], weaknesses: ["Experience","Hip Fluidity","Tackling"], roundGrade: "Fourth Round" },
  { first: "Drue", last: "Tranquill", strengths: ["Frame","Play Recognition","Motor","Block Avoidance","Sideline to Sideline"], weaknesses: ["Balance","Angle Tackling","Injury History"], roundGrade: "Fifth Round" },
  { first: "Wes", last: "Martin", strengths: ["Upper Body Strength","Balance","Lateral Agility","Grip Strength","Hand Usage"], weaknesses: ["Pad Level","Footwork","Anchor"], roundGrade: "Fourth Round" },
  { first: "Ugo", last: "Amadi", strengths: ["Physicality","Frame","Zone Instincts","Position Versatility","Ball Skills"], weaknesses: ["Range","Hip Fluidity","Man Technique"], roundGrade: "Sixth Round" },
  { first: "Jarrett", last: "Stidham", strengths: ["Progressions","Arm Strength","Ball Placement","Throwing Motion","Touch"], weaknesses: ["Experience","Pocket Presence","Deep Accuracy"], roundGrade: "Fourth Round" },
  { first: "Greg", last: "Gaines", strengths: ["Run Defense","Motor","Block Shedding","Hand Usage","First Step"], weaknesses: ["Balance","Frame","Pass Rush Plan"], roundGrade: "Sixth Round" },
  { first: "John", last: "Cominsky", strengths: ["Frame","Motor","Run Defense","First Step","Closing Speed"], weaknesses: ["Pass Rush Plan","Hand Usage","Experience"], roundGrade: "Fourth Round" },
  { first: "Mike", last: "Jordan", strengths: ["Frame","Position Versatility","Instincts","Lateral Agility","Hand Usage"], weaknesses: ["Explosiveness","Balance","Hand Timing"], roundGrade: "Fourth Round" },
  { first: "Foster", last: "Moreau", strengths: ["Lower Body Strength","Leg Drive","Run Blocking","Hand Usage","Ball Skills"], weaknesses: ["Route Running","Release","Lateral Agility"], roundGrade: "Fifth Round" },
  { first: "Shareef", last: "Miller", strengths: ["Position Versatility","First Step","Lateral Agility","Hand Usage","Edge Setting"], weaknesses: ["Pass Rush Plan","Bend","Lower Body Strength"], roundGrade: "Fifth Round" },
  { first: "Deionte", last: "Thompson", strengths: ["Physicality","Ball Hawk","Range","Tackling"], weaknesses: ["Frame","Zone Instincts","Recovery"], roundGrade: "Third Round" },
  { first: "Ryquell", last: "Armstead", strengths: ["Frame","Downhill","Vision","Contact Balance","Pass Protection"], weaknesses: ["Patience","Lateral Agility","Receiving Ability"], roundGrade: "Fourth Round" },
  { first: "Zach", last: "Gentry", strengths: ["Frame","Run Blocking","Route Running","Ball Skills"], weaknesses: ["Upper Body Strength","Balance","Hands"], roundGrade: "UDFA" },
  { first: "Ben", last: "Burr-Kirven", strengths: ["Motor","Tackling","Play Recognition","Closing Speed","Balance"], weaknesses: ["Frame","Angle Tackling","Block Avoidance"], roundGrade: "Sixth Round" },
  { first: "Ryan", last: "Connelly", strengths: ["Physicality","Closing Speed","Play Recognition","Zone Instincts"], weaknesses: ["Balance","Injury History","Sideline to Sideline"], roundGrade: "Sixth Round" },
  { first: "Marvell", last: "Tell", strengths: ["Frame","Position Versatility","Transitions","Zone Instincts","Ball Skills"], weaknesses: ["Tackling","Range","Motor"], roundGrade: "Fourth Round" },
  { first: "Amani", last: "Oruwariye", strengths: ["Frame","Press","Zone Instincts","Ball Hawk","Ball Skills"], weaknesses: ["Experience","Hip Fluidity","Recovery"], roundGrade: "Third Round" },
  { first: "Vosean", last: "Joseph", strengths: ["Motor","Closing Speed","Play Recognition","Pass Rushing","Man Coverage"], weaknesses: ["Frame","Zone Instincts","Block Shedding"], roundGrade: "Third Round" },
  { first: "Dre", last: "Greenlaw", strengths: ["Experience","Lateral Agility","Play Recognition","Sideline to Sideline","Tackling"], weaknesses: ["Frame","Block Avoidance","Zone Instincts"], roundGrade: "Seventh Round" },
  { first: "Hunter", last: "Renfrow", strengths: ["Physicality","Zone Instincts","Route Running","Hands","RAC Ability"], weaknesses: ["Frame","Long Speed","Separation"], roundGrade: "Fifth Round" },
  { first: "Kingsley", last: "Keke", strengths: ["Position Versatility","Lateral Agility","Balance","Pass Rush Moves","Run Defense"], weaknesses: ["Lower Body Strength","Block Shedding","Pass Rush Plan"], roundGrade: "Third Round" },
  { first: "Andrew", last: "Van Ginkel", strengths: ["Motor","Special Teams Value","Lateral Agility","Pass Rushing","Block Avoidance"], weaknesses: ["Frame","Block Shedding","Pursuit Angles"], roundGrade: "Seventh Round" },
  { first: "Qadree", last: "Ollison", strengths: ["Frame","Motor","Long Speed","Contact Balance","Ball Security"], weaknesses: ["Lateral Agility","Vision","Pass Protection"], roundGrade: "UDFA" },
  { first: "Ross", last: "Pierschbacher", strengths: ["Frame","Lateral Agility","Instincts","Patience","Hand Usage"], weaknesses: ["Leg Drive","Balance","Anchor"], roundGrade: "Fifth Round" },
];

async function main() {
  const snap = await db.collection('historical').where('Year','==','2019').get();
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
