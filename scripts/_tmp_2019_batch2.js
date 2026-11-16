const { getFirestore } = require('./firebaseAdmin');
const db = getFirestore();
const VALID_ROUND_GRADES = ["Watchlist","Early First Round","Middle First Round","Late First Round","Second Round","Third Round","Fourth Round","Fifth Round","Sixth Round","Seventh Round","UDFA"];

const PLAYERS = [
  { first: "Kaleb", last: "McGary", strengths: ["Physicality","Hand Usage","Leg Drive","Lateral Agility","Anchor"], weaknesses: ["Balance","Footwork","Injury History"], roundGrade: "Early First Round" },
  { first: "N'Keal", last: "Harry", strengths: ["Physicality","Press","Body Control","RAC Ability","Run Blocking"], weaknesses: ["Release","Long Speed","Route Running"], roundGrade: "Second Round" },
  { first: "Byron", last: "Murphy", strengths: ["Instincts","Man Technique","Ball Skills","Ball Hawk","Transitions"], weaknesses: ["Frame","Experience","Press"], roundGrade: "Early First Round" },
  { first: "Rock", last: "Ya-Sin", strengths: ["Frame","Experience","Transitions","Ball Skills","Man Technique"], weaknesses: ["Press","Hip Fluidity","Tackling"], roundGrade: "Early First Round" },
  { first: "Jawaan", last: "Taylor", strengths: ["Frame","Run Blocking","Grip Strength","Lateral Agility","Hand Usage"], weaknesses: ["Penalties","Pad Level","Hand Placement"], roundGrade: "Early First Round" },
  { first: "Deebo", last: "Samuel", strengths: ["Physicality","Route Running","Body Control","Ball Skills","RAC Ability"], weaknesses: ["Frame","Press","Injury History"], roundGrade: "Second Round" },
  { first: "Greg", last: "Little", strengths: ["Experience","Leg Drive","Lateral Agility","Hand Usage"], weaknesses: ["Upper Body Strength","Balance","Pass Set"], roundGrade: "Second Round" },
  { first: "Cody", last: "Ford", strengths: ["Frame","Position Versatility","Leg Drive","Lateral Agility","Motor"], weaknesses: ["Pass Set","Hand Placement","Balance"], roundGrade: "Early First Round" },
  { first: "Sean", last: "Murphy-Bunting", strengths: ["Ball Skills","Transitions","Zone Instincts","Tackling"], weaknesses: ["Frame","Press","Recovery"], roundGrade: "Second Round" },
  { first: "Trayvon", last: "Mullen", strengths: ["Frame","Position Versatility","Ball Hawk","Press","Transitions"], weaknesses: ["Ball Skills","Hip Fluidity","Tackling"], roundGrade: "Second Round" },
  { first: "Dalton", last: "Risner", strengths: ["Instincts","Balance","Leg Drive","Lateral Agility","Hand Usage"], weaknesses: ["Explosiveness","Footwork","Hand Placement"], roundGrade: "Second Round" },
  { first: "Drew", last: "Lock", strengths: ["Frame","Progressions","Pocket Presence","Throwing Motion","Anticipation"], weaknesses: ["Touch","Ball Placement","Decision Making"], roundGrade: "Early First Round" },
  { first: "Jahlani", last: "Tavai", strengths: ["Physicality","Stopping Power","Block Avoidance","Play Recognition","Tackling"], weaknesses: ["Injury History","Closing Speed","Angle Tackling"], roundGrade: "Fourth Round" },
  { first: "Elgton", last: "Jenkins", strengths: ["Lateral Agility","Frame","Pad Level","Hand Usage","Position Versatility"], weaknesses: ["Leg Drive","Pass Set","Penalties"], roundGrade: "Second Round" },
  { first: "Joejuan", last: "Williams", strengths: ["Frame","Experience","Press","Man Technique","Ball Skills"], weaknesses: ["Zone Instincts","Hip Fluidity","Penalties"], roundGrade: "Third Round" },
  { first: "Greedy", last: "Williams", strengths: ["Frame","Man Technique","Recovery","Zone Instincts","Ball Skills"], weaknesses: ["Physicality","Hip Fluidity","Tackling"], roundGrade: "Early First Round" },
  { first: "Marquise", last: "Blair", strengths: ["Position Versatility","Physicality","Run Support","Block Avoidance","Range"], weaknesses: ["Frame","Penalties","Angle Tackling"], roundGrade: "Third Round" },
  { first: "Erik", last: "McCoy", strengths: ["Frame","Experience","Lateral Agility","Hand Usage","Anchor"], weaknesses: ["Pass Set","Patience","Footwork"], roundGrade: "Second Round" },
  { first: "Ben", last: "Banogu", strengths: ["Motor","Lateral Agility","Closing Speed","Play Recognition","Man Coverage"], weaknesses: ["Pass Rushing","Block Avoidance","Balance"], roundGrade: "Fourth Round" },
  { first: "Irv", last: "Smith", strengths: ["Hand Usage","Run Blocking","Deep Routes","Route Running","Ball Skills"], weaknesses: ["Lower Body Strength","Leg Drive","Hands"], roundGrade: "Second Round" },
  { first: "Drew", last: "Sample", strengths: ["Frame","Grip Strength","Run Blocking","Route Running","Hands"], weaknesses: ["Release","Ball Skills","Upper Body Strength"], roundGrade: "Fourth Round" },
  { first: "Miles", last: "Sanders", strengths: ["Frame","Patience","Vision","Lateral Agility","Contact Balance"], weaknesses: ["Downhill","Long Speed","Ball Security"], roundGrade: "Second Round" },
  { first: "Lonnie", last: "Johnson", strengths: ["Frame","Press","Transitions","Zone Instincts","Ball Skills"], weaknesses: ["Motor","Ball Hawk","Recovery"], roundGrade: "Second Round" },
  { first: "Max", last: "Scharping", strengths: ["Position Versatility","Frame","Lateral Agility","Hand Usage","Leg Drive"], weaknesses: ["Pass Set","Hand Timing","Balance"], roundGrade: "Second Round" },
  { first: "Mecole", last: "Hardman", strengths: ["Experience","Release","Route Running","RAC Ability","Special Teams Value"], weaknesses: ["Body Control","Separation","Deep Routes"], roundGrade: "Third Round" },
  { first: "J.J.", last: "Arcega-Whiteside", strengths: ["Frame","Press","Body Control","Ball Tracking","Ball Skills"], weaknesses: ["Release","Separation","Long Speed"], roundGrade: "Third Round" },
  { first: "Trysten", last: "Hill", strengths: ["First Step","Lateral Agility","Hand Usage","Pass Rush Moves","Motor"], weaknesses: ["Experience","Balance","Run Defense"], roundGrade: "Second Round" },
  { first: "Parris", last: "Campbell", strengths: ["Long Speed","Body Control","Route Running","Hands","RAC Ability"], weaknesses: ["Position Versatility","Deep Routes","Separation"], roundGrade: "Second Round" },
  { first: "Nasir", last: "Adderley", strengths: ["Position Versatility","Range","Transitions","Tackling","Ball Hawk"], weaknesses: ["Zone Instincts","Angle Tackling","Run Support"], roundGrade: "Second Round" },
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

  // A. J. Brown — matched by pick number (period/spacing makes name-matching unsafe,
  // and "Marquise Brown" already exists in this Year, so a loose last-name-only match would be wrong)
  const ajBrownFix = {
    pick: "51",
    strengths: ["Frame","Physicality","Route Running","Ball Skills","RAC Ability"],
    weaknesses: ["Experience","Long Speed","Separation"],
    roundGrade: "Early First Round",
  };
  const ajMatch = docs.find(d => (d.data().Pick||'').toString() === ajBrownFix.pick);
  if (!ajMatch) { console.log('SKIP (no match): A.J. Brown by pick'); skipped++; }
  else {
    const before = ajMatch.data();
    const overlap = ajBrownFix.strengths.filter(s => ajBrownFix.weaknesses.includes(s));
    if (overlap.length) console.warn(`⚠ ${before.Player}: overlap: ${overlap.join(', ')}`);
    const [posSnap, genSnap] = await Promise.all([db.collection('traits').doc(before.Position).get(), db.collection('traits').doc('Generic').get()]);
    const valid = new Set([...(posSnap.exists ? posSnap.data().traits || [] : []), ...(genSnap.exists ? genSnap.data().traits || [] : [])]);
    const unknown = [...ajBrownFix.strengths, ...ajBrownFix.weaknesses].filter(t => !valid.has(t));
    if (unknown.length) console.warn(`⚠ ${before.Player}: not in traits/${before.Position} or traits/Generic: ${unknown.join(', ')}`);
    await ajMatch.ref.update({ Strengths: ajBrownFix.strengths, Weaknesses: ajBrownFix.weaknesses, RoundGrade: ajBrownFix.roundGrade });
    console.log(`OK ${before.Player} (pick ${before.Pick}, Pos:${before.Position})`);
    updated++;
  }

  console.log(`\nDone. ${updated} updated, ${skipped} skipped.`);
}
main();
