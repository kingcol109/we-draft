// One-off batch runner for 2022 historical batch 8 (picks 50-56).
const { getFirestore } = require("./firebaseAdmin");

const VALID_ROUND_GRADES = [
  "Watchlist", "Early First Round", "Middle First Round", "Late First Round",
  "Second Round", "Third Round", "Fourth Round", "Fifth Round", "Sixth Round",
  "Seventh Round", "UDFA",
];

const PLAYERS = [
  { first: "Tyquan", last: "Thornton", strengths: ["Deep Routes","Separation","Ball Skills","Zone Instincts","Body Control"], weaknesses: ["Frame","Press","Route Running"], roundGrade: "Third Round" },
  { first: "Cam", last: "Jurgens", strengths: ["Patience","Leg Drive","Lateral Agility","Grip Strength","Hand Usage"], weaknesses: ["Frame","Balance","Pass Set"], roundGrade: "Second Round" },
  { first: "George", last: "Pickens", strengths: ["Release","Route Running","Zone Instincts","Ball Skills","Hands"], weaknesses: ["Frame","Physicality","Injury History"], roundGrade: "Second Round" },
  { first: "Alec", last: "Pierce", strengths: ["Frame","Zone Instincts","Physicality","Separation","Ball Skills"], weaknesses: ["Release","Route Running","Ball Tracking"], roundGrade: "Third Round" },
  { first: "Skyy", last: "Moore", strengths: ["Physicality","Release","Route Running","Zone Instincts","Ball Skills"], weaknesses: ["Special Teams Value","Separation","RAC Ability"], roundGrade: "Second Round" },
  { first: "Trey", last: "McBride", strengths: ["Frame","Run Blocking","Pass Blocking","Short Routes","Hands"], weaknesses: ["Leg Drive","Deep Routes","Ball Skills"], roundGrade: "Second Round" },
  { first: "Sam", last: "Williams", strengths: ["First Step","Lateral Agility","Bend","Pass Rush Plan","Hand Usage"], weaknesses: ["Balance","Edge Setting","Lower Body Strength"], roundGrade: "Third Round" },
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
