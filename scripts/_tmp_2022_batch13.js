// One-off batch runner for 2022 historical batch 13 (picks 86-92).
const { getFirestore } = require("./firebaseAdmin");

const VALID_ROUND_GRADES = [
  "Watchlist", "Early First Round", "Middle First Round", "Late First Round",
  "Second Round", "Third Round", "Fourth Round", "Fifth Round", "Sixth Round",
  "Seventh Round", "UDFA",
];

const PLAYERS = [
  { first: "Malik", last: "Willis", strengths: ["Running Ability","Frame","Decision Making","Arm Strength","Progressions"], weaknesses: ["Pocket Presence","Throwing Motion","Ball Placement"], roundGrade: "Middle First Round" },
  { first: "Cameron", last: "Thomas", strengths: ["Position Versatility","Pass Rush Plan","Hand Usage","Bend","Closing Speed"], weaknesses: ["Lower Body Strength","Speed Rush","Balance"], roundGrade: "Fourth Round" },
  { first: "Jalen", last: "Tolbert", strengths: ["Release","Physicality","Route Running","Separation","Ball Tracking"], weaknesses: ["Hands","Deep Routes","Run Blocking"], roundGrade: "Second Round" },
  { first: "Terrel", last: "Bernard", strengths: ["Play Recognition","Pursuit Angles","Lateral Agility","Pass Rushing","Man Coverage"], weaknesses: ["Frame","Balance","Angle Tackling"], roundGrade: "Fifth Round" },
  { first: "Dylan", last: "Parham", strengths: ["Position Versatility","Balance","Leg Drive","Patience","Anchor"], weaknesses: ["Frame","Lateral Agility","Hand Placement"], roundGrade: "Third Round" },
  { first: "Rachaad", last: "White", strengths: ["Downhill","Patience","Contact Balance","Lateral Agility","Receiving Ability"], weaknesses: ["Elusiveness","Long Speed","Pass Protection"], roundGrade: "Fourth Round" },
  { first: "Sean", last: "Rhyan", strengths: ["Position Versatility","Frame","Pass Set","Lateral Agility","Hand Placement"], weaknesses: ["Penalties","Balance","Hand Timing"], roundGrade: "Fourth Round" },
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
