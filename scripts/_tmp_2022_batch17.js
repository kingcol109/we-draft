// One-off batch runner for 2022 historical batch 17 (picks 112-118).
const { getFirestore } = require("./firebaseAdmin");

const VALID_ROUND_GRADES = [
  "Watchlist", "Early First Round", "Middle First Round", "Late First Round",
  "Second Round", "Third Round", "Fourth Round", "Fifth Round", "Sixth Round",
  "Seventh Round", "UDFA",
];

const PLAYERS = [
  { first: "Daniel", last: "Bellinger", strengths: ["Frame","Balance","Pass Blocking","Route Running","RAC Ability"], weaknesses: ["Run Blocking","Deep Routes","Short Routes"], roundGrade: "Fourth Round" },
  { first: "Percy", last: "Butler", strengths: ["Special Teams Value","Recovery","Run Support","Range","Zone Instincts"], weaknesses: ["Frame","Pursuit Angles","Tackling"], roundGrade: "Fifth Round" },
  { first: "Dane", last: "Belton", strengths: ["Physicality","Man Technique","Zone Instincts","Ball Hawk","Ball Skills"], weaknesses: ["Range","Pursuit Angles","Block Shedding"], roundGrade: "Sixth Round" },
  { first: "Damarri", last: "Mathis", strengths: ["Frame","Press","Man Technique","Zone Instincts","Tackling"], weaknesses: ["Transitions","Recovery","Penalties"], roundGrade: "Third Round" },
  { first: "Eyioma", last: "Uwazurike", strengths: ["Experience","Frame","Position Versatility","Run Defense","Pass Rush Moves"], weaknesses: ["First Step","Lateral Agility","Balance"], roundGrade: "Fourth Round" },
  { first: "Micheal", last: "Clemons", strengths: ["Motor","Frame","Hand Usage","Lateral Agility","Pass Rush Moves"], weaknesses: ["Lower Body Strength","Bend","Pass Rush Plan"], roundGrade: "Third Round" },
  { first: "Akayleb", last: "Evans", strengths: ["Frame","Position Versatility","Press","Zone Instincts","Ball Skills"], weaknesses: ["Injury History","Man Technique","Hip Fluidity"], roundGrade: "Sixth Round" },
];

async function main() {
  const db = getFirestore();
  let ok = 0, failed = 0;
  for (const p of PLAYERS) {
    const snap = await db.collection("historical").where("First", "==", p.first).where("Last", "==", p.last).where("Year", "==", "2022").get();
    if (snap.size !== 1) {
      console.error(`SKIP ${p.first} ${p.last}: found ${snap.size} matches`);
      failed++;
      continue;
    }
    const docSnap = snap.docs[0];
    const before = docSnap.data();
    const fields = {};

    if (p.roundGrade != null) {
      if (!VALID_ROUND_GRADES.includes(p.roundGrade)) {
        console.error(`BAD ROUND GRADE for ${p.first} ${p.last}: ${p.roundGrade}`);
        failed++;
        continue;
      }
      fields.RoundGrade = p.roundGrade;
    }
    if (Array.isArray(p.strengths)) fields.Strengths = p.strengths;
    if (Array.isArray(p.weaknesses)) fields.Weaknesses = p.weaknesses;

    const position = before.Position;
    if ((fields.Strengths || fields.Weaknesses) && position) {
      const [posSnap, genSnap] = await Promise.all([
        db.collection("traits").doc(position).get(),
        db.collection("traits").doc("Generic").get(),
      ]);
      const validTraits = new Set([
        ...(posSnap.exists ? posSnap.data().traits || [] : []),
        ...(genSnap.exists ? genSnap.data().traits || [] : []),
      ]);
      const allPicked = [...(fields.Strengths || []), ...(fields.Weaknesses || [])];
      const unknown = allPicked.filter((t) => !validTraits.has(t));
      if (unknown.length > 0) {
        console.warn(`WARN ${p.first} ${p.last} (Pos:${position}): not in traits/${position} or Generic: ${unknown.join(", ")}`);
      }
      const overlap = (fields.Strengths || []).filter((t) => (fields.Weaknesses || []).includes(t));
      if (overlap.length > 0) {
        console.warn(`WARN ${p.first} ${p.last}: overlap S/W: ${overlap.join(", ")}`);
      }
      const dupS = fields.Strengths && new Set(fields.Strengths).size !== fields.Strengths.length;
      const dupW = fields.Weaknesses && new Set(fields.Weaknesses).size !== fields.Weaknesses.length;
      if (dupS) console.warn(`WARN ${p.first} ${p.last}: duplicate within Strengths`);
      if (dupW) console.warn(`WARN ${p.first} ${p.last}: duplicate within Weaknesses`);
    }
    if (fields.Strengths && (fields.Strengths.length < 3 || fields.Strengths.length > 5)) {
      console.warn(`WARN ${p.first} ${p.last}: strengths count = ${fields.Strengths.length}`);
    }
    if (fields.Weaknesses && fields.Weaknesses.length !== 3) {
      console.warn(`WARN ${p.first} ${p.last}: weaknesses count = ${fields.Weaknesses.length}`);
    }

    await docSnap.ref.update(fields);
    console.log(`OK ${p.first} ${p.last} (pick ${before.Pick}, Pos:${position}) -> ${JSON.stringify(fields)}`);
    ok++;
  }
  console.log(`\nDone. ${ok} updated, ${failed} skipped.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
