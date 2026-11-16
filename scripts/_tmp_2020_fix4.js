const { getFirestore } = require('./firebaseAdmin');
const db = getFirestore();
const VALID_ROUND_GRADES = ["Watchlist","Early First Round","Middle First Round","Late First Round","Second Round","Third Round","Fourth Round","Fifth Round","Sixth Round","Seventh Round","UDFA"];

const PLAYERS = [
  { pick: "155", strengths: ["Frame","Lateral Agility","Closing Speed","Pass Rushing","Block Avoidance"], weaknesses: ["Experience","Balance","Stopping Power"] }, // Trevis Gipson (LB)
  { pick: "176", strengths: ["Physicality","Zone Instincts","Special Teams Value"], weaknesses: ["Press","Long Speed","Separation"], roundGrade: "UDFA" }, // K. J. Osborn
  { pick: "177", strengths: ["Frame","Bend","Edge Setting","Pass Rush Plan"], weaknesses: ["Experience","Explosiveness","Speed to Power"], roundGrade: "Fifth Round" }, // Mike Danna
  { pick: "182", strengths: ["Frame","Upper Body Strength","Anchor","Balance","Hand Usage"], weaknesses: ["Explosiveness","Lateral Agility","Pad Level"], roundGrade: "Sixth Round" }, // Michael Onwenu
  { pick: "183", strengths: ["Sideline to Sideline","Play Recognition","Tackling","Block Avoidance","Pass Rushing"], weaknesses: ["Frame","Balance","Zone Instincts"], roundGrade: "Fifth Round" }, // Cam Brown
];

async function main() {
  const snap = await db.collection('historical').where('Year','==','2020').get();
  for (const p of PLAYERS) {
    const match = snap.docs.find(d => (d.data().Pick||'').toString() === p.pick);
    if (!match) { console.log(`SKIP no match pick ${p.pick}`); continue; }
    const before = match.data();
    const overlap = p.strengths.filter(s => p.weaknesses.includes(s));
    if (overlap.length) { console.error(`OVERLAP for ${before.Player}:`, overlap); continue; }
    if (p.roundGrade && !VALID_ROUND_GRADES.includes(p.roundGrade)) { console.error(`BAD ROUND GRADE for ${before.Player}`); continue; }
    const [posSnap, genSnap] = await Promise.all([db.collection('traits').doc(before.Position).get(), db.collection('traits').doc('Generic').get()]);
    const valid = new Set([...(posSnap.exists ? posSnap.data().traits || [] : []), ...(genSnap.exists ? genSnap.data().traits || [] : [])]);
    const unknown = [...p.strengths, ...p.weaknesses].filter(t => !valid.has(t));
    if (unknown.length) { console.error(`STILL BAD for ${before.Player} (Pos:${before.Position}):`, unknown); continue; }
    const update = { Strengths: p.strengths, Weaknesses: p.weaknesses };
    if (p.roundGrade) update.RoundGrade = p.roundGrade;
    await match.ref.update(update);
    console.log(`OK ${before.Player} (pick ${before.Pick}, Pos:${before.Position}) fixed`);
  }
}
main();
