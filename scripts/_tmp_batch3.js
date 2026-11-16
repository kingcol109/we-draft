// One-off batch runner for 2025 historical batch (picks 124-163, minus pick 162 - wrong player in PDF).
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
  { first: "Barryn", last: "Sorrell", strengths: ["Upper Body Strength","Pass Rush Plan","Bend","Pass Rush Moves","Motor"], weaknesses: ["Edge Setting","Closing Speed","Power Rush"], roundGrade: "Third Round" },
  { first: "Kyle", last: "Kennard", strengths: ["Frame","Hand Usage","Lateral Agility","Pass Rush Moves","Pass Rush Plan"], weaknesses: ["Balance","Edge Setting","Bend"], roundGrade: "Fourth Round" },
  { first: "Dylan", last: "Sampson", strengths: ["Elusiveness","Vision","Patience","Lateral Agility","Downhill"], weaknesses: ["Frame","Ball Security","Pass Protection"], roundGrade: "Second Round" },
  { first: "Jalen", last: "Travis", strengths: ["Hand Usage","Hand Placement","Leg Drive","Grip Strength"], weaknesses: ["Pass Set","Patience","Lateral Agility"], roundGrade: "Fifth Round", bench: 26 },
  { first: "Jaylin", last: "Lane", strengths: ["Deep Routes","Separation","Body Control","RAC Ability","Special Teams Value"], weaknesses: ["Release","Hands","Ball Tracking"], roundGrade: "Fourth Round" },
  { first: "Teddye", last: "Buchanan", strengths: ["Frame","Sideline to Sideline","Balance","Lateral Agility","Man Coverage"], weaknesses: ["Tackling","Block Shedding","Stopping Power"], roundGrade: "Fifth Round" },
  { first: "Malachi", last: "Moore", strengths: ["Experience","Position Versatility","Man Technique","Ball Skills","Run Support"], weaknesses: ["Frame","Block Shedding","Zone Instincts"], roundGrade: "Fifth Round",
    height: "5'11 1/4\"", weight: 196, armLength: "29 5/8\"", handSize: "9\"" },
  { first: "Quincy", last: "Riley", strengths: ["Transitions","Press","Zone Instincts","Ball Skills","Recovery"], weaknesses: ["Physicality","Man Technique","Ball Hawk"], roundGrade: "Third Round" },
  { first: "Ruben", last: "Hyppolite II", strengths: ["Experience","Closing Speed","Play Recognition","Lateral Agility","Man Coverage"], weaknesses: ["Block Shedding","Tackling","Zone Instincts"], roundGrade: "Fifth Round",
    height: "5'11\"", weight: 236 },
  { first: "Jalen", last: "Royals", strengths: ["Zone Instincts","Route Running","Ball Skills","Ball Tracking","Body Control"], weaknesses: ["Experience","Release","Deep Routes"], roundGrade: "Second Round" },
  { first: "Que", last: "Robinson", strengths: ["Block Avoidance","Pass Rushing","Lateral Agility","Sideline to Sideline","Special Teams Value"], weaknesses: ["Experience","Play Recognition","Block Shedding"], roundGrade: "Fifth Round" },
  { first: "Tonka", last: "Hemingway", strengths: ["Lateral Agility","First Step","Pass Rush Moves","Bend","Run Defense"], weaknesses: ["Balance","Block Shedding","Hand Usage"], roundGrade: "Third Round" },
  { first: "Elic", last: "Ayomanor", strengths: ["Frame","Release","Route Running","Ball Skills","Run Blocking"], weaknesses: ["Separation","Body Control","Ball Tracking"], roundGrade: "Third Round" },
  { first: "Joshua", last: "Farmer", strengths: ["Frame","Lower Body Strength","Run Defense","Position Versatility","Power Rush"], weaknesses: ["First Step","Balance","Block Shedding"], roundGrade: "Third Round" },
  { first: "Jordan", last: "Watkins", strengths: ["Frame","Physicality","Ball Skills","Separation","Special Teams Value"], weaknesses: ["Release","Body Control","Hands"], roundGrade: "Sixth Round" },
  { first: "Tyrion", last: "Ingram-Dawkins", strengths: ["First Step","Bend","Run Defense","Pass Rush Plan","Lateral Agility"], weaknesses: ["Instincts","Block Shedding","Balance"], roundGrade: "Fourth Round" },
  { first: "Cam", last: "Jackson", strengths: ["Frame","Upper Body Strength","Bend","Pass Rush Moves","Power Rush"], weaknesses: ["Run Defense","Pass Rush Plan","First Step"], roundGrade: "Fifth Round" },
  { first: "Carson", last: "Vinson", strengths: ["Climb","Lateral Agility","Hand Usage","Hand Timing"], weaknesses: ["Pass Set","Balance","Anchor"], roundGrade: "Sixth Round" },
  { first: "Rylie", last: "Mills", strengths: ["Frame","Hand Usage","Lower Body Strength","Upper Body Strength","Power Rush"], weaknesses: ["Run Defense","Balance","First Step"], roundGrade: "Sixth Round",
    height: "6'5 3/8\"", weight: 291, armLength: "32 5/8\"", handSize: "9 7/8\"" },
  { first: "Jordan", last: "Phillips", strengths: ["Upper Body Strength","Power Rush","First Step","Pass Rush Moves","Run Defense"], weaknesses: ["Hand Usage","Balance","Block Shedding"], roundGrade: "Sixth Round" },
  { first: "Shedeur", last: "Sanders", strengths: ["Pocket Presence","Anticipation","Off-Script","Ball Placement","Timing"], weaknesses: ["Lower Body Mechanics","Throwing Motion","Decision Making"], roundGrade: "Middle First Round" },
  { first: "Mac", last: "McWilliams", strengths: ["Hip Fluidity","Man Technique","Transitions","Zone Instincts","Tackling"], weaknesses: ["Frame","Press","Ball Skills"], roundGrade: "Fifth Round" },
  { first: "Bradyn", last: "Swinson", strengths: ["Hand Usage","Edge Setting","Bend","Closing Speed","Lateral Agility"], weaknesses: ["Pad Level","Upper Body Strength","Pass Rush Plan"], roundGrade: "Third Round" },
  { first: "Jordan", last: "James", strengths: ["Elusiveness","Lateral Agility","Contact Balance","Receiving Ability","Pass Protection"], weaknesses: ["Vision","Patience","Long Speed"], roundGrade: "Fourth Round" },
  { first: "Ty", last: "Hamilton", strengths: ["Lateral Agility","Hand Usage","Block Shedding","First Step","Closing Speed"], weaknesses: ["Frame","Run Defense","Power Rush"], roundGrade: "Fourth Round" },
  { first: "Jaydon", last: "Blue", strengths: ["Lateral Agility","Elusiveness","Downhill","Receiving Ability"], weaknesses: ["Vision","Contact Balance","Ball Security"], roundGrade: "Third Round" },
  { first: "Jason", last: "Marshall Jr.", strengths: ["Frame","Press","Transitions","Hip Fluidity","Ball Skills"], weaknesses: ["Zone Instincts","Ball Hawk","Recovery"], roundGrade: "Sixth Round" },
  { first: "DJ", last: "Giddens", strengths: ["Downhill","Patience","Vision","Elusiveness","Ball Security"], weaknesses: ["Long Speed","Contact Balance","Pass Protection"], roundGrade: "Fifth Round" },
  { first: "Shemar", last: "James", strengths: ["Lateral Agility","Pursuit Angles","Stopping Power","Block Avoidance","Pass Rushing"], weaknesses: ["Tackling","Play Recognition","Block Shedding"], roundGrade: "Sixth Round" },
  { first: "Jalen", last: "Rivers", strengths: ["Anchor","Lower Body Strength","Climb","Grip Strength","Hand Timing"], weaknesses: ["Balance","Run Blocking","Pass Set"], roundGrade: "Fourth Round",
    height: "6'5 3/4\"", weight: 319, armLength: "34 7/8\"", handSize: "10\"", fortyYard: 5.29, broad: "9'0\"", bench: 23 },
  { first: "Marcus", last: "Mbow", strengths: ["Leg Drive","Patience","Climb","Balance","Lateral Agility"], weaknesses: ["Upper Body Strength","Grip Strength","Anchor"], roundGrade: "Third Round",
    height: "6'4 1/8\"", weight: 303, armLength: "32\"", handSize: "10 1/2\"", shuttle: 4.67 },
  { first: "Dante", last: "Trader Jr.", strengths: ["Frame","Run Support","Zone Instincts","Ball Hawk","Tackling"], weaknesses: ["Man Technique","Patience","Hip Fluidity"], roundGrade: "Seventh Round",
    height: "5'10 7/8\"", weight: 196, armLength: "31 1/4\"", handSize: "8 7/8\"", vertical: 31, broad: "9'9\"", threeCone: 7.09, shuttle: 4.32, bench: 12 },
  { first: "Jeffrey", last: "Bassa", strengths: ["Play Recognition","Pursuit Angles","Closing Speed","Tackling","Man Coverage"], weaknesses: ["Frame","Block Shedding","Sideline to Sideline"], roundGrade: "Fourth Round",
    height: "6'1 1/8\"", weight: 232, armLength: "31 3/8\"", handSize: "9 1/4\"", fortyYard: 4.63, vertical: 38.5, broad: "9'10\"", threeCone: 7.34, bench: 21 },
  { first: "Elijah", last: "Roberts", strengths: ["Motor","Pass Rush Plan","Speed to Power","Pass Rush Moves","Edge Setting"], weaknesses: ["Instincts","Lateral Agility","Bend"], roundGrade: "Fifth Round",
    height: "6'3 5/8\"", weight: 295, armLength: "33 5/8\"", handSize: "10 1/4\"", fortyYard: 4.78, vertical: 31.5, broad: "9'8\"" },
  { first: "KeAndre", last: "Lambert-Smith", strengths: ["Zone Instincts","Ball Skills","Ball Tracking","Body Control","RAC Ability"], weaknesses: ["Separation","Route Running","Special Teams Value"], roundGrade: "Fifth Round" },
  { first: "Collin", last: "Oliver", strengths: ["Lateral Agility","Pass Rushing","Play Recognition","Block Avoidance","Man Coverage"], weaknesses: ["Frame","Block Shedding","Tackling"], roundGrade: "Sixth Round",
    height: "6'1 3/4\"", weight: 240, armLength: "30 3/4\"", handSize: "9 1/2\"", fortyYard: 4.56, vertical: 39, broad: "10'6\"" },
  { first: "Marques", last: "Sigle", strengths: ["Experience","Press","Ball Skills","Run Support","Tackling"], weaknesses: ["Range","Zone Instincts","Man Technique"], roundGrade: "Fifth Round",
    height: "5'11 3/8\"", weight: 199, armLength: "30 3/4\"", handSize: "9 1/4\"", fortyYard: 4.37, vertical: 38, broad: "10'10\"" },
  { first: "Smael", last: "Mondon Jr.", strengths: ["Block Avoidance","Pursuit Angles","Tackling","Sideline to Sideline","Man Coverage"], weaknesses: ["Injury History","Play Recognition","Zone Instincts"], roundGrade: "Third Round",
    height: "6'2 1/4\"", weight: 224, armLength: "31 3/4\"", handSize: "9 3/4\"", fortyYard: 4.58, broad: "10'10\"" },
  { first: "Mitchell", last: "Evans", strengths: ["Route Running","Release","Ball Skills","Hands","Run Blocking"], weaknesses: ["Lateral Agility","RAC Ability","Injury History"], roundGrade: "Fourth Round",
    height: "6'5 3/8\"", weight: 258, armLength: "31 7/8\"", handSize: "9 1/2\"", fortyYard: 4.74, vertical: 31, broad: "9'7\"", threeCone: 7.25, shuttle: 4.4 },
];

async function main() {
  const db = getFirestore();
  let ok = 0, failed = 0;
  for (const p of PLAYERS) {
    const snap = await db.collection("historical").where("First", "==", p.first).where("Last", "==", p.last).where("Year", "==", "2025").get();
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
        console.warn(`WARN ${p.first} ${p.last}: not in traits/${position} or Generic: ${unknown.join(", ")}`);
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
