const { getFirestore } = require('./firebaseAdmin');
const db = getFirestore();
const VALID_ROUND_GRADES = ["Watchlist","Early First Round","Middle First Round","Late First Round","Second Round","Third Round","Fourth Round","Fifth Round","Sixth Round","Seventh Round","UDFA"];

const FIXES = [
  // C. J. Gardner-Johnson (pick 105) - missed by period-spacing, apply intended DB data
  { pick: "105", strengths: ["Frame","Position Versatility","Zone Instincts","Man Technique","Tackling"], weaknesses: ["Transitions","Hip Fluidity","Ball Hawk"], roundGrade: "Second Round" },
  // Anthony Nelson (pick 107) - stored EDGE; revert to Edge Setting (my earlier DL-based fix was wrong)
  { pick: "107", weaknesses: ["Pass Rush Plan","Speed to Power","Edge Setting"] },
  // Austin Bryant (pick 117) - stored EDGE, not DL; Run Defense isn't valid EDGE vocab
  { pick: "117", weaknesses: ["Balance","First Step","Edge Setting"] },
  // Christian Miller (pick 115) - stored LB, not EDGE
  { pick: "115", strengths: ["Frame","Closing Speed","Pass Rushing","Block Avoidance","Lateral Agility"], weaknesses: ["Stopping Power","Balance","Block Shedding"] },
];

async function main() {
  const snap = await db.collection('historical').where('Year','==','2019').get();
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
