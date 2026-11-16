const { getFirestore } = require('./firebaseAdmin');
const db = getFirestore();
const VALID_ROUND_GRADES = ["Watchlist","Early First Round","Middle First Round","Late First Round","Second Round","Third Round","Fourth Round","Fifth Round","Sixth Round","Seventh Round","UDFA"];

const PLAYERS = [
  { first: "Avery", last: "Williams", strengths: ["Range","Transitions","Special Teams Value","Recovery","Zone Instincts"], weaknesses: ["Frame","Ball Skills","Tackling"], roundGrade: "Sixth Round" },
  { first: "Ben", last: "Mason", strengths: ["Physicality","Downhill","Receiving Ability","Patience","Special Teams Value"], weaknesses: ["Contact Balance","Experience","Pass Protection"], roundGrade: "Seventh Round" },
  { first: "Nick", last: "Niemann", strengths: ["Explosiveness","Balance","Block Shedding","Tackling","Stopping Power"], weaknesses: ["Frame","Play Recognition","Man Coverage"], roundGrade: "Sixth Round" },
  { first: "Hamsah", last: "Nasirildeen", strengths: ["Tackling","Run Support","Block Avoidance","Man Technique","Special Teams Value"], weaknesses: ["Injury History","Angle Tackling","Zone Instincts"], roundGrade: "Fifth Round" },
  { first: "Frank", last: "Darby", strengths: ["Deep Routes","Long Speed","Route Running","Ball Tracking","RAC Ability"], weaknesses: ["Zone Instincts","Hands","Body Control"], roundGrade: "Fifth Round" },
  { first: "Joshuah", last: "Bledsoe", strengths: ["Physicality","Press","Man Technique","Run Support","Block Avoidance"], weaknesses: ["Transitions","Range","Tackling"], roundGrade: "Sixth Round" },
  { first: "Marlon", last: "Tuipulotu", strengths: ["Frame","Balance","Hand Usage","Upper Body Strength","Block Shedding"], weaknesses: ["Motor","Run Defense","Pass Rush Moves"], roundGrade: "Fifth Round" },
  { first: "Trey", last: "Hill", strengths: ["Position Versatility","Upper Body Strength","Lateral Agility","Run Blocking","Pass Set"], weaknesses: ["Injury History","Hand Placement","Pad Level"], roundGrade: "UDFA" },
  { first: "Tarron", last: "Jackson", strengths: ["Upper Body Strength","Motor","Pass Rush Moves","First Step","Lateral Agility"], weaknesses: ["Bend","Hand Usage","Pass Rush Plan"], roundGrade: "Sixth Round" },
  { first: "Quinton", last: "Bohanna", strengths: ["Frame","First Step","Balance","Power Rush","Physicality"], weaknesses: ["Run Defense","Closing Speed","Lateral Agility"], roundGrade: "Sixth Round" },
  { first: "Deonte", last: "Brown", strengths: ["Upper Body Strength","Leg Drive","Balance","Pass Set","Hand Usage"], weaknesses: ["Frame","Lateral Agility","Pass Protection"], roundGrade: "Fourth Round" },
  { first: "Elijah", last: "Mitchell", strengths: ["Contact Balance","Downhill","Receiving Ability","Pass Protection","Patience"], weaknesses: ["Lateral Agility","Vision","Special Teams Value"], roundGrade: "Sixth Round" },
  { first: "Roy", last: "Lopez", strengths: ["Balance","Hand Usage","Run Defense","Lateral Agility","Frame"], weaknesses: ["Closing Speed","Pass Rush Plan","Instincts"], roundGrade: "Seventh Round" },
  { first: "Gary", last: "Brightwell", strengths: ["Frame","Downhill","Lateral Agility","Elusiveness"], weaknesses: ["Patience","Vision","Contact Balance"], roundGrade: "UDFA" },
  { first: "Will", last: "Sherman", strengths: ["Lateral Agility","Leg Drive","Run Blocking","Hand Usage"], weaknesses: ["Pass Set","Upper Body Strength","Balance"], roundGrade: "Fifth Round" },
  { first: "Larry", last: "Rountree", strengths: ["Frame","Lateral Agility","Acceleration","Contact Balance","Pass Protection"], weaknesses: ["Patience","Vision","Elusiveness"], roundGrade: "Fifth Round" },
  { first: "Jaylen", last: "Twyman", strengths: ["Frame","First Step","Upper Body Strength","Hand Usage","Pass Rush Moves"], weaknesses: ["Lower Body Strength","Explosiveness","Bend"], roundGrade: "Fourth Round" },
  { first: "Brandin", last: "Echols", strengths: ["Range","Zone Instincts","Transitions","Ball Skills","Tackling"], weaknesses: ["Frame","Ball Hawk","Hip Fluidity"], roundGrade: "Sixth Round" },
  { first: "Rodarius", last: "Williams", strengths: ["Press","Zone Instincts","Ball Skills","Tackling","Run Support"], weaknesses: ["Hip Fluidity","Man Technique","Ball Hawk"], roundGrade: "Fifth Round" },
  { first: "Chris", last: "Evans", strengths: ["Contact Balance","Vision","Lateral Agility","Pass Protection","Receiving Ability"], weaknesses: ["Experience","Ball Security","Elusiveness"], roundGrade: "Fifth Round" },
  { first: "Marquez", last: "Stevenson", strengths: ["Long Speed","Separation","Frame","RAC Ability","Special Teams Value"], weaknesses: ["Injury History","Route Running","Ball Tracking"], roundGrade: "Sixth Round" },
  { first: "Shi", last: "Smith", strengths: ["RAC Ability","Press","Route Running","Deep Routes","Body Control"], weaknesses: ["Frame","Injury History","Ball Skills"], roundGrade: "Fifth Round" },
  { first: "Racey", last: "McMath", strengths: ["Frame","Body Control","Ball Skills","Deep Routes","Special Teams Value"], weaknesses: ["Experience","Press","Route Running"], roundGrade: "Fifth Round" },
  { first: "Landon", last: "Young", strengths: ["Frame","Lower Body Strength","Lateral Agility","Hand Usage","Physicality"], weaknesses: ["Pad Level","Hand Placement","Balance"], roundGrade: "Sixth Round" },
  { first: "Jonathan", last: "Marshall", strengths: ["First Step","Explosiveness","Lateral Agility","Pass Rush Moves","Hand Usage"], weaknesses: ["Experience","Balance","Pass Rush Plan"], roundGrade: "Sixth Round" },
  { first: "Stone", last: "Forsythe", strengths: ["Frame","Pass Set","Hand Usage","Anchor","Run Blocking"], weaknesses: ["Balance","Pad Level","Hand Timing"], roundGrade: "Third Round" },
  { first: "Jalen", last: "Camp", strengths: ["Frame","Hands","Body Control","Deep Routes","Run Blocking"], weaknesses: ["Experience","Press","Route Running"], roundGrade: "Sixth Round" },
  { first: "Victor", last: "Dimukeje", strengths: ["Frame","Edge Setting","Closing Speed","Hand Usage","Bend"], weaknesses: ["First Step","Pass Rush Plan","Lower Body Strength"], roundGrade: "Sixth Round" },
  { first: "Demetric", last: "Felton", strengths: ["Lateral Agility","Downhill","Receiving Ability","Contact Balance","Special Teams Value"], weaknesses: ["Patience","Vision","Elusiveness"], roundGrade: "Fifth Round" },
  { first: "Damar", last: "Hamlin", strengths: ["Frame","Zone Instincts","Ball Hawk","Ball Skills","Run Support"], weaknesses: ["Injury History","Range","Tackling"], roundGrade: "Fifth Round" },
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
