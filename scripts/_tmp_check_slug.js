const { getFirestore } = require('./firebaseAdmin');
async function main() {
  const db = getFirestore();
  const snap = await db.collection('players').where('Eligible','in',["2027","2028","2029"]).limit(5).get();
  snap.docs.forEach(d => console.log(d.id, JSON.stringify({ Slug: d.data().Slug, First: d.data().First, Last: d.data().Last, Position: d.data().Position, Eligible: d.data().Eligible })));
}
main();
