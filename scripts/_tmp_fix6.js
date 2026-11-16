const { getFirestore } = require("./firebaseAdmin");

const FIXES = [
  { first: "Titus", last: "Leo", strengths: ["Pass Rushing","Block Avoidance","Lateral Agility","Pursuit Angles","Closing Speed"], weaknesses: ["Balance","Stopping Power","Block Shedding"] },
  { first: "Jason", last: "Taylor II", strengths: ["Frame","Run Support","Position Versatility","Range","Ball Hawk"], weaknesses: ["Zone Instincts","Recovery","Tackling"] },
  { first: "Lew", last: "Nichols III", weaknesses: ["Elusiveness","Long Speed","Special Teams Value"] },
  { first: "Jalen", last: "Brooks", weaknesses: ["Release","Route Running","Separation"] },
  { first: "Desjuan", last: "Johnson", weaknesses: ["Frame","Lateral Agility","Pass Rush Plan"] },
];

async function main() {
  const db = getFirestore();
  for (const fx of FIXES) {
    const snap = await db.collection("historical").where("First", "==", fx.first).where("Last", "==", fx.last).where("Year", "==", "2023").get();
    const docSnap = snap.docs[0];
    const position = docSnap.data().Position;
    const [posSnap, genSnap] = await Promise.all([
      db.collection("traits").doc(position).get(),
      db.collection("traits").doc("Generic").get(),
    ]);
    const validTraits = new Set([
      ...(posSnap.exists ? posSnap.data().traits || [] : []),
      ...(genSnap.exists ? genSnap.data().traits || [] : []),
    ]);
    const update = {};
    if (fx.strengths) {
      const bad = fx.strengths.filter((t) => !validTraits.has(t));
      if (bad.length) { console.error(`STILL BAD strengths for ${fx.first} ${fx.last}: ${bad.join(", ")}`); continue; }
      update.Strengths = fx.strengths;
    }
    if (fx.weaknesses) {
      const bad = fx.weaknesses.filter((t) => !validTraits.has(t));
      if (bad.length) { console.error(`STILL BAD weaknesses for ${fx.first} ${fx.last}: ${bad.join(", ")}`); continue; }
      update.Weaknesses = fx.weaknesses;
    }
    await docSnap.ref.update(update);
    console.log(`Fixed ${fx.first} ${fx.last} (Pos:${position}) -> ${JSON.stringify(update)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
