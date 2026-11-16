const { getFirestore } = require('./firebaseAdmin');
const db = getFirestore();

const FIXES = [
  { pick: "86", strengths: ["Motor","Ball Skills","Route Running","RAC Ability"], weaknesses: ["Long Speed","Deep Routes","Run Blocking"] },
  { pick: "90", strengths: ["Frame","Balance","Lower Body Strength","Hand Usage","Run Defense"], weaknesses: ["Strength","Block Shedding","Power Rush"] },
  { pick: "89", strengths: ["Frame","Leg Drive","Hand Usage","Footwork","Lateral Agility"], weaknesses: ["Strength","Hand Placement","Instincts"], roundGrade: "Second Round" },
];

async function main() {
  const snap = await db.collection('historical').where('Year','==','2018').get();
  const docs = snap.docs;
  for (const f of FIXES) {
    const match = docs.find(d => d.data().Pick === f.pick);
    if (!match) { console.log(`NO MATCH for pick ${f.pick}`); continue; }
    const before = match.data();
    const [posSnap, genSnap] = await Promise.all([db.collection('traits').doc(before.Position).get(), db.collection('traits').doc('Generic').get()]);
    const valid = new Set([...(posSnap.exists ? posSnap.data().traits || [] : []), ...(genSnap.exists ? genSnap.data().traits || [] : [])]);
    const unknown = [...f.strengths, ...f.weaknesses].filter(t => !valid.has(t));
    const overlap = f.strengths.filter(s => f.weaknesses.includes(s));
    if (unknown.length) console.warn(`⚠ ${before.Player}: still invalid: ${unknown.join(', ')}`);
    if (overlap.length) console.warn(`⚠ ${before.Player}: overlap: ${overlap.join(', ')}`);
    const update = { Strengths: f.strengths, Weaknesses: f.weaknesses };
    if (f.roundGrade) update.RoundGrade = f.roundGrade;
    await match.ref.update(update);
    console.log(`FIXED ${before.Player} (pick ${before.Pick}, Pos:${before.Position})`);
  }
}
main();
