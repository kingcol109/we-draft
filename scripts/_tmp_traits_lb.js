const { getFirestore } = require('./firebaseAdmin');
async function main() {
  const db = getFirestore();
  const doc = await db.collection('traits').doc('LB').get();
  console.log(JSON.stringify(doc.data().traits));
}
main();
