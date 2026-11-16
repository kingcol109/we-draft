// One-off batch runner for 2022 historical batch 14 (picks 93-98).
const { getFirestore } = require("./firebaseAdmin");

const VALID_ROUND_GRADES = [
  "Watchlist", "Early First Round", "Middle First Round", "Late First Round",
  "Second Round", "Third Round", "Fourth Round", "Fifth Round", "Sixth Round",
  "Seventh Round", "UDFA",
];

const PLAYERS = [
  { first: "Tyrion", last: "Davis-Price", strengths: ["Frame","Elusiveness","Lateral Agility","Patience","Contact Balance"], weaknesses: ["Vision","Ball Security","Receiving Ability"], roundGrade: "Fourth Round" },
  { first: "Matt", last: "Corral", strengths: ["Decision Making","Timing","Touch","Anticipation","Arm Strength"], weaknesses: ["Frame","Progressions","Ball Placement"], roundGrade: "Middle First Round" },
  { first: "Zachary", last: "Carter", strengths: ["Frame","Pass Rush Plan","Hand Usage","Lateral Agility","Upper Body Strength"], weaknesses: ["Balance","Motor","First Step"], roundGrade: "Fourth Round" },
  { first: "Nick", last: "Cross", strengths: ["Frame","Physicality","Closing Speed","Ball Skills","Man Technique"], weaknesses: ["Run Support","Tackling","Hip Fluidity"], roundGrade: "Second Round" },
  { first: "Kerby", last: "Joseph", strengths: ["Transitions","Zone Instincts","Range","Ball Skills","Tackling"], weaknesses: ["Patience","Pursuit Angles","Man Technique"], roundGrade: "Fifth Round" },
  { first: "Brian", last: "Robinson Jr", strengths: ["Frame","Downhill","Elusiveness","Contact Balance","Long Speed"], weaknesses: ["Patience","Vision","Receiving Ability"], roundGrade: "Third Round" },
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
