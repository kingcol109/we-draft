// One-off batch runner for 2023 historical batch 1 (picks 1-40, minus Myles Murphy pick 28 - wrong/mismatched page).
const { getFirestore } = require("./firebaseAdmin");

function parseFraction(str) {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(str.trim());
  return m ? Number(m[1]) / Number(m[2]) : 0;
}
function parseFeetInches(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^(\d+)'\s*(\d+)?\s*(\d+\s*\/\s*\d+)?"?$/.exec(s);
  if (!m) return null;
  const feet = Number(m[1]);
  const inches = m[2] ? Number(m[2]) : 0;
  const frac = m[3] ? parseFraction(m[3]) : 0;
  return feet * 12 + inches + frac;
}
function parseInchesFraction(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().replace(/"$/, "").trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^(\d+)\s*(\d+\s*\/\s*\d+)?$/.exec(s);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = m[2] ? parseFraction(m[2]) : 0;
  return whole + frac;
}
const VALID_ROUND_GRADES = [
  "Watchlist", "Early First Round", "Middle First Round", "Late First Round",
  "Second Round", "Third Round", "Fourth Round", "Fifth Round", "Sixth Round",
  "Seventh Round", "UDFA",
];

const PLAYERS = [
  { first: "Bryce", last: "Young", strengths: ["Pocket Presence","Progressions","Decision Making","Coverage Manipulation","Anticipation"], weaknesses: ["Frame","Lower Body Mechanics","Deep Accuracy"], roundGrade: "Middle First Round" },
  { first: "CJ", last: "Stroud", strengths: ["Decision Making","Arm Strength","Off-Script","Progressions","Accuracy"], weaknesses: ["Running Ability","Lower Body Mechanics","Pocket Presence"], roundGrade: "Middle First Round" },
  { first: "Will", last: "Anderson Jr.", strengths: ["Frame","Pass Rushing","Block Avoidance","Block Shedding","Pursuit Angles"], weaknesses: ["Motor","Lateral Agility","Stopping Power"], roundGrade: "Middle First Round" },
  { first: "Anthony", last: "Richardson", strengths: ["Frame","Running Ability","Arm Strength","Accuracy","Pocket Presence"], weaknesses: ["Ball Placement","Progressions","Coverage Manipulation"], roundGrade: "Middle First Round" },
  { first: "Devon", last: "Witherspoon", strengths: ["Ball Skills","Zone Instincts","Patience","Ball Hawk","Pursuit Angles"], weaknesses: ["Press","Transitions","Hip Fluidity"], roundGrade: "Middle First Round" },
  { first: "Paris", last: "Johnson Jr.", strengths: ["Position Versatility","Pass Set","Lateral Agility","Hand Placement","Anchor"], weaknesses: ["Leg Drive","Run Blocking","Hand Timing"], roundGrade: "Middle First Round" },
  { first: "Tyree", last: "Wilson", strengths: ["Frame","Motor","Edge Setting","Pass Rush Moves","Pass Rush Plan"], weaknesses: ["Bend","Hand Usage","Balance"], roundGrade: "Middle First Round" },
  { first: "Bijan", last: "Robinson", strengths: ["Position Versatility","Lateral Agility","Vision","Elusiveness","Contact Balance"], weaknesses: ["Patience","Downhill","Pass Protection"], roundGrade: "Middle First Round" },
  { first: "Jalen", last: "Carter", strengths: ["Frame","First Step","Pass Rush Moves","Hand Usage","Power Rush"], weaknesses: ["Balance","Upper Body Strength","Motor"], roundGrade: "Middle First Round" },
  { first: "Darnell", last: "Wright", strengths: ["Frame","Run Blocking","Anchor","Leg Drive","Lateral Agility"], weaknesses: ["Balance","Hand Placement","Pass Set"], roundGrade: "Middle First Round" },
  { first: "Peter", last: "Skoronski", strengths: ["Pass Set","Hand Usage","Patience","Anchor","Leg Drive"], weaknesses: ["Hand Timing","Hand Placement","Upper Body Strength"], roundGrade: "Middle First Round" },
  { first: "Jahmyr", last: "Gibbs", strengths: ["Downhill","Elusiveness","Lateral Agility","Patience","Receiving Ability"], weaknesses: ["Vision","Pass Protection","Contact Balance"], roundGrade: "Second Round" },
  { first: "Lukas", last: "Van Ness", strengths: ["Frame","First Step","Lower Body Strength","Power Rush","Pass Rush Moves"], weaknesses: ["Balance","Hand Usage","Pass Rush Plan"], roundGrade: "Middle First Round" },
  { first: "Broderick", last: "Jones", strengths: ["Lateral Agility","Hand Usage","Run Blocking","Position Versatility","Balance"], weaknesses: ["Experience","Pass Set","Anchor"], roundGrade: "Middle First Round" },
  { first: "Will", last: "McDonald IV", strengths: ["Hand Usage","Lateral Agility","First Step","Bend","Pass Rush Moves"], weaknesses: ["Frame","Lower Body Strength","Speed to Power"], roundGrade: "Second Round" },
  { first: "Emmanuel", last: "Forbes", strengths: ["Press","Zone Instincts","Ball Hawk","Ball Skills","Recovery"], weaknesses: ["Hip Fluidity","Patience","Tackling"], roundGrade: "Second Round" },
  { first: "Christian", last: "Gonzalez", strengths: ["Frame","Hip Fluidity","Press","Transitions","Range"], weaknesses: ["Zone Instincts","Ball Hawk","Man Technique"], roundGrade: "Middle First Round" },
  { first: "Jack", last: "Campbell", strengths: ["Frame","Play Recognition","Stopping Power","Pursuit Angles","Tackling"], weaknesses: ["Zone Instincts","Block Shedding","Man Coverage"], roundGrade: "Second Round" },
  { first: "Calijah", last: "Kancey", strengths: ["Motor","First Step","Balance","Lateral Agility","Pass Rush Moves"], weaknesses: ["Frame","Upper Body Strength","Run Defense"], roundGrade: "Second Round" },
  { first: "Jaxon", last: "Smith-Njigba", strengths: ["Zone Instincts","Ball Skills","Intermediate Routes","Hands","Ball Tracking"], weaknesses: ["Body Control","Separation","Deep Routes"], roundGrade: "Middle First Round" },
  { first: "Quentin", last: "Johnston", strengths: ["Frame","Route Running","Separation","Release","Ball Tracking"], weaknesses: ["Body Control","Deep Routes","Ball Skills"], roundGrade: "Second Round" },
  { first: "Zay", last: "Flowers", strengths: ["Release","Route Running","Separation","Ball Skills","Ball Tracking"], weaknesses: ["Body Control","Zone Instincts","Hands"], roundGrade: "Middle First Round" },
  { first: "Jordan", last: "Addison", strengths: ["Position Versatility","Separation","Route Running","Deep Routes","Body Control"], weaknesses: ["Press","Ball Tracking","Hands"], roundGrade: "Middle First Round" },
  { first: "Deonte", last: "Banks", strengths: ["Position Versatility","Frame","Press","Transitions","Man Technique"], weaknesses: ["Recovery","Ball Skills","Run Support"], roundGrade: "Middle First Round" },
  { first: "Dalton", last: "Kincaid", strengths: ["Route Running","Release","Deep Routes","Ball Tracking","Ball Skills"], weaknesses: ["Run Blocking","Balance","Grip Strength"], roundGrade: "Middle First Round" },
  { first: "Mazi", last: "Smith", strengths: ["Frame","Bend","Power Rush","Lateral Agility","Pass Rush Moves"], weaknesses: ["Motor","Run Defense","Balance"], roundGrade: "Second Round" },
  { first: "Anton", last: "Harrison", strengths: ["Hand Usage","Patience","Hand Timing","Anchor","Run Blocking"], weaknesses: ["Hand Placement","Leg Drive","Lateral Agility"], roundGrade: "Second Round" },
  { first: "Bryan", last: "Bresee", strengths: ["Frame","Run Defense","Hand Usage","Lateral Agility","Lower Body Strength"], weaknesses: ["Closing Speed","Pass Rush Plan","Injury History"], roundGrade: "Second Round" },
  { first: "Nolan", last: "Smith", strengths: ["Physicality","Block Avoidance","Stopping Power","Pursuit Angles","Pass Rushing"], weaknesses: ["Frame","Balance","Block Shedding"], roundGrade: "Middle First Round" },
  { first: "Felix", last: "Anudike-Uzomah", strengths: ["Motor","Pass Rush Plan","Pass Rush Moves","Power Rush","Hand Usage"], weaknesses: ["Bend","Lateral Agility","Instincts"], roundGrade: "Second Round" },
  { first: "Joey", last: "Porter Jr.", strengths: ["Experience","Physicality","Press","Recovery","Ball Skills"], weaknesses: ["Transitions","Penalties","Tackling"], roundGrade: "Middle First Round" },
  { first: "Will", last: "Levis", strengths: ["Frame","Progressions","Off-Script","Throwing Motion","Arm Strength"], weaknesses: ["Timing","Lower Body Mechanics","Ball Placement"], roundGrade: "Middle First Round" },
  { first: "Sam", last: "LaPorta", strengths: ["Position Versatility","Route Running","Release","RAC Ability","Balance"], weaknesses: ["Run Blocking","Ball Tracking","Hands"], roundGrade: "Third Round" },
  { first: "Michael", last: "Mayer", strengths: ["Frame","Run Blocking","Lateral Agility","Leg Drive","Route Running"], weaknesses: ["Hand Usage","Release","RAC Ability"], roundGrade: "Middle First Round" },
  { first: "Steve", last: "Avila", strengths: ["Position Versatility","Balance","Leg Drive","Run Blocking","Pass Set"], weaknesses: ["Patience","Hand Timing","Climb"], roundGrade: "Second Round" },
  { first: "Derick", last: "Hall", strengths: ["Experience","Physicality","Stopping Power","Closing Speed","Pass Rushing"], weaknesses: ["Balance","Play Recognition","Man Coverage"], roundGrade: "Second Round" },
  { first: "Matthew", last: "Bergeron", strengths: ["Position Versatility","Run Blocking","Leg Drive","Climb","Balance"], weaknesses: ["Hand Placement","Pass Set","Anchor"], roundGrade: "Second Round" },
  { first: "Jonathan", last: "Mingo", strengths: ["Frame","Release","Deep Routes","Route Running","Zone Instincts"], weaknesses: ["Separation","Body Control","Ball Tracking"], roundGrade: "Second Round" },
  { first: "Isaiah", last: "Foskey", strengths: ["Motor","Lateral Agility","Closing Speed","Edge Setting","Pass Rush Moves"], weaknesses: ["Balance","Hand Usage","Bend"], roundGrade: "Second Round" },
];

async function main() {
  const db = getFirestore();
  let ok = 0, failed = 0;
  for (const p of PLAYERS) {
    const snap = await db.collection("historical").where("First", "==", p.first).where("Last", "==", p.last).where("Year", "==", "2023").get();
    if (snap.size !== 1) {
      console.error(`SKIP ${p.first} ${p.last}: found ${snap.size} matches`);
      failed++;
      continue;
    }
    const docSnap = snap.docs[0];
    const before = docSnap.data();
    const fields = {};

    const height = parseFeetInches(p.height);
    if (height != null) fields.Height = String(height);
    const broad = parseFeetInches(p.broad);
    if (broad != null) fields.Broad = String(broad);
    const armLength = parseInchesFraction(p.armLength);
    if (armLength != null) fields["Arm Length"] = String(armLength);
    const handSize = parseInchesFraction(p.handSize);
    if (handSize != null) fields["Hand Size"] = String(handSize);
    if (p.weight != null) fields.Weight = String(p.weight);
    if (p.fortyYard != null) fields["40 Yard "] = String(p.fortyYard);
    if (p.vertical != null) fields.Vertical = String(p.vertical);
    if (p.bench != null) fields.Bench = String(p.bench);
    if (p.threeCone != null) fields["3-Cone"] = String(p.threeCone);
    if (p.shuttle != null) fields.Shuttle = String(p.shuttle);

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
    }
    if (fields.Strengths && (fields.Strengths.length < 3 || fields.Strengths.length > 5)) {
      console.warn(`WARN ${p.first} ${p.last}: strengths count = ${fields.Strengths.length}`);
    }
    if (fields.Weaknesses && fields.Weaknesses.length !== 3) {
      console.warn(`WARN ${p.first} ${p.last}: weaknesses count = ${fields.Weaknesses.length}`);
    }

    await docSnap.ref.update(fields);
    console.log(`OK ${p.first} ${p.last} (pick ${before.Pick}) -> ${JSON.stringify(fields)}`);
    ok++;
  }
  console.log(`\nDone. ${ok} updated, ${failed} skipped.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
