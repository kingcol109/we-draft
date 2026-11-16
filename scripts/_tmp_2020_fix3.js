const { getFirestore } = require('./firebaseAdmin');
const db = getFirestore();
const VALID_ROUND_GRADES = ["Watchlist","Early First Round","Middle First Round","Late First Round","Second Round","Third Round","Fourth Round","Fifth Round","Sixth Round","Seventh Round","UDFA"];

const FIXES = [
  { pick: "97", strengths: ["Instincts","Play Recognition","Special Teams Value","Tackling","Zone Instincts"] }, // Jacob Phillips
  { pick: "100", strengths: ["Zone Instincts","Pursuit Angles","Tackling","Play Recognition","Special Teams Value"], weaknesses: ["Balance","Man Coverage","Block Avoidance"] }, // Tanner Muse
  { pick: "102", strengths: ["Motor","Lateral Agility","Closing Speed","Pass Rushing","Play Recognition"], weaknesses: ["Frame","Block Avoidance","Stopping Power"] }, // Alex Highsmith
  { pick: "106", weaknesses: ["Footwork","Pad Level","Pass Set"] }, // Tyre Phillips
  { pick: "109", weaknesses: ["Explosiveness","Penalties","Footwork"] }, // John Simpson
  { pick: "117", strengths: ["Motor","First Step","Pass Dropping","Lateral Agility","Pass Rush Moves"], weaknesses: ["Lower Body Strength","Speed to Power","Bend"], roundGrade: "Fourth Round" }, // D. J. Wonnum
];

async function main() {
  const snap = await db.collection('historical').where('Year','==','2020').get();
  for (const f of FIXES) {
    const match = snap.docs.find(d => (d.data().Pick||'').toString() === f.pick);
    if (!match) { console.log(`SKIP no match pick ${f.pick}`); continue; }
    const before = match.data();
    const strengths = f.strengths || before.Strengths;
    const weaknesses = f.weaknesses || before.Weaknesses;
    const overlap = strengths.filter(s => weaknesses.includes(s));
    if (overlap.length) { console.error(`OVERLAP for ${before.Player}:`, overlap); continue; }
    const [posSnap, genSnap] = await Promise.all([db.collection('traits').doc(before.Position).get(), db.collection('traits').doc('Generic').get()]);
    const valid = new Set([...(posSnap.exists ? posSnap.data().traits || [] : []), ...(genSnap.exists ? genSnap.data().traits || [] : [])]);
    const unknown = [...strengths, ...weaknesses].filter(t => !valid.has(t));
    if (unknown.length) { console.error(`STILL BAD for ${before.Player} (Pos:${before.Position}):`, unknown); continue; }
    const update = { Strengths: strengths, Weaknesses: weaknesses };
    if (f.roundGrade) {
      if (!VALID_ROUND_GRADES.includes(f.roundGrade)) { console.error(`BAD ROUND GRADE for ${before.Player}`); continue; }
      update.RoundGrade = f.roundGrade;
    }
    await match.ref.update(update);
    console.log(`OK ${before.Player} (pick ${before.Pick}, Pos:${before.Position}) fixed`);
  }
}
main();
