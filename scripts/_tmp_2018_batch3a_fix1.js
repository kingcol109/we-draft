const { getFirestore } = require('./firebaseAdmin');
const db = getFirestore();

const FIXES = [
  { pick: "61", strengths: ["Frame","Release","Route Running","Ball Skills","Special Teams Value"], weaknesses: ["Press","Separation","Ball Tracking"], roundGrade: "Second Round" },
  { pick: "69", strengths: ["First Step","Instincts","Motor","Hand Usage","Run Defense"], weaknesses: ["Lower Body Strength","Balance","Power Rush"], roundGrade: "Third Round" },
  { pick: "64", strengths: ["First Step","Bend","Position Versatility","Hand Usage"], weaknesses: ["Balance","Lower Body Strength","Pass Rush Plan"] },
  { pick: "66", strengths: ["Closing Speed","Block Avoidance","Pursuit Angles","Lateral Agility","Pass Rushing"], weaknesses: ["Frame","Stopping Power","Block Shedding"] },
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
