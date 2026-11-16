const { getFirestore } = require('./firebaseAdmin');

async function main() {
  const db = getFirestore();
  const doc = await db.collection('traits').doc('DL').get();
  console.log(doc.exists ? JSON.stringify(doc.data(), null, 2) : 'NO DOC');
  const all = await db.collection('traits').listDocuments();
  console.log('all trait doc ids:', all.map(d=>d.id));
}
main();
