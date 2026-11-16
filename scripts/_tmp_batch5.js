// One-off batch runner for 2025 historical batch (picks 206-256, minus Kobee Minor dup at 257).
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
  { first: "Chase", last: "Lundt", strengths: ["Hand Placement","Leg Drive","Balance","Anchor","Lateral Agility"], weaknesses: ["Frame","Pass Set","Hand Timing"], roundGrade: "Fourth Round",
    height: "6'7 1/2\"", weight: 304, armLength: "32 5/8\"", handSize: "9 5/8\"", bench: 20 },
  { first: "Cameron", last: "Williams", strengths: ["Frame","Pass Set","Anchor","Hand Timing","Leg Drive"], weaknesses: ["Lower Body Strength","Lateral Agility","Hand Placement"], roundGrade: "Fourth Round",
    height: "6'5 3/4\"", weight: 317, armLength: "34 1/2\"", handSize: "11 3/8\"" },
  { first: "Jimmy", last: "Horn Jr", strengths: ["Deep Routes","Route Running","Ball Skills","Hands","Special Teams Value"], weaknesses: ["Frame","Release","Body Control"], roundGrade: "Sixth Round",
    height: "5'9 1/8\"", weight: 174, armLength: "30 3/8\"", handSize: "8 3/4\"", fortyYard: 4.46, vertical: 38, broad: "10'8\"", shuttle: 4.41 },
  { first: "Antwaun", last: "Powell-Ryland", strengths: ["Pass Rush Plan","Power Rush","Pass Rush Moves","Bend","Hand Usage"], weaknesses: ["First Step","Frame","Lower Body Strength"], roundGrade: "Fifth Round",
    height: "6'2 5/8\"", weight: 258, armLength: "31 1/4\"", handSize: "9 5/8\"", fortyYard: 4.69, vertical: 36.5, broad: "10'4\"" },
  { first: "Aeneas", last: "Peebles", strengths: ["First Step","Lower Body Strength","Run Defense","Pass Rush Plan","Motor"], weaknesses: ["Frame","Hand Usage","Balance"], roundGrade: "Fifth Round",
    height: "6'0 1/2\"", weight: 262, armLength: "31 3/8\"", handSize: "9 5/8\"", fortyYard: 4.94, vertical: 32.5, broad: "9'1\"", shuttle: 4.7 },
  { first: "Hayden", last: "Conner", strengths: ["Frame","Leg Drive","Climb","Hand Usage","Lateral Agility"], weaknesses: ["Anchor","Hand Placement","Pass Set"], roundGrade: "Sixth Round",
    height: "6'6\"", weight: 314, armLength: "33 1/4\"", handSize: "9 5/8\"", threeCone: 7.9, shuttle: 4.88 },
  { first: "Robert", last: "Longerbeam", strengths: ["Experience","Ball Hawk","Recovery","Zone Instincts","Tackling"], weaknesses: ["Man Technique","Ball Skills","Block Shedding"], roundGrade: "Sixth Round",
    height: "5'11\"", weight: 175, armLength: "31 1/2\"", handSize: "8 1/2\"", fortyYard: 4.39, vertical: 36.5, broad: "11'2\"" },
  { first: "Tommy", last: "Mellott", strengths: ["Frame","Separation","Route Running","Deep Routes","Position Versatility"], weaknesses: ["Experience","RAC Ability","Ball Skills"], roundGrade: "Seventh Round",
    height: "5'11\"", weight: 200 },
  { first: "RJ", last: "Mickens", strengths: ["Zone Instincts","Ball Hawk","Transitions","Tackling","Run Support"], weaknesses: ["Range","Hip Fluidity","Man Technique"], roundGrade: "Fifth Round",
    height: "6'0\"", weight: 199, armLength: "32 1/4\"", handSize: "8 7/8\"", fortyYard: 4.49, vertical: 41.5, broad: "10'1\"" },
  { first: "Cam", last: "Miller", strengths: ["Timing","Decision Making","Touch","Off-Script","Running Ability"], weaknesses: ["Progressions","Anticipation","Arm Strength"], roundGrade: "UDFA",
    height: "6'1\"", weight: 210 },
  { first: "Jay", last: "Toia", strengths: ["Frame","Motor","Lower Body Strength","Power Rush","Hand Usage"], weaknesses: ["First Step","Block Shedding","Run Defense"], roundGrade: "Sixth Round",
    height: "6'2\"", weight: 342, armLength: "32 1/2\"", handSize: "10\"" },
  { first: "Jack", last: "Nelson", strengths: ["Lateral Agility","Climb","Run Blocking","Grip Strength","Patience"], weaknesses: ["Upper Body Strength","Hand Timing","Anchor"], roundGrade: "Fifth Round",
    height: "6'7\"", weight: 314, armLength: "33 1/2\"", handSize: "10\"" },
  { first: "Thomas", last: "Fidone II", strengths: ["Motor","Deep Routes","Route Running","Balance","RAC Ability"], weaknesses: ["Frame","Leg Drive","Lateral Agility"], roundGrade: "Fifth Round",
    height: "6'5\"", weight: 243, armLength: "34\"", handSize: "10 5/8\"", fortyYard: 4.7, vertical: 35.5, broad: "10'6\"", threeCone: 7.01, shuttle: 4.29 },
  { first: "Marcus", last: "Bryant", strengths: ["Frame","Upper Body Strength","Grip Strength","Pass Set","Hand Timing"], weaknesses: ["Leg Drive","Climb","Patience"], roundGrade: "Sixth Round",
    height: "6'7\"", weight: 320 },
  { first: "Jonah", last: "Monheim", strengths: ["Position Versatility","Run Blocking","Climb","Patience","Lateral Agility"], weaknesses: ["Frame","Anchor","Balance"], roundGrade: "UDFA",
    height: "6'4 1/8\"", weight: 302, armLength: "30 1/8\"", handSize: "9 1/4\"" },
  { first: "Cody", last: "Lindenberg", strengths: ["Play Recognition","Block Avoidance","Pursuit Angles","Block Shedding","Tackling"], weaknesses: ["Balance","Stopping Power","Closing Speed"], roundGrade: "UDFA",
    height: "6'2 3/8\"", weight: 236, armLength: "32 3/4\"", handSize: "9\"" },
  { first: "Damien", last: "Martinez", strengths: ["Downhill","Vision","Elusiveness","Lateral Agility","Contact Balance"], weaknesses: ["Patience","Long Speed","Pass Protection"], roundGrade: "Sixth Round",
    height: "5'11 5/8\"", weight: 217, armLength: "30 1/2\"", handSize: "9 1/2\"", fortyYard: 4.51, vertical: 35, broad: "10'4\"" },
  { first: "Kyonte", last: "Hamilton", strengths: ["Experience","Lateral Agility","Run Defense","Bend","Pass Rush Moves"], weaknesses: ["Hand Usage","Balance","Block Shedding"], roundGrade: "UDFA",
    height: "6'3\"", weight: 300 },
  { first: "Kitan", last: "Crawford", strengths: ["Hip Fluidity","Ball Skills","Run Support","Special Teams Value","Recovery"], weaknesses: ["Range","Pursuit Angles","Experience"], roundGrade: "Fourth Round",
    height: "5'10 5/8\"", weight: 202, armLength: "31\"", handSize: "9 1/2\"", fortyYard: 4.41, vertical: 41.5, broad: "10'8\"", threeCone: 6.81, shuttle: 4.03, bench: 18 },
  { first: "Carson", last: "Bruener", strengths: ["Tackling","Play Recognition","Pursuit Angles","Block Shedding","Special Teams Value"], weaknesses: ["Frame","Sideline to Sideline","Man Coverage"], roundGrade: "Sixth Round",
    height: "6'1 1/4\"", weight: 227, armLength: "31 3/4\"", handSize: "9 1/4\"", fortyYard: 4.58, vertical: 33.5, broad: "9'11\"" },
  { first: "Kurtis", last: "Rourke", strengths: ["Pocket Presence","Decision Making","Touch","Off-Script"], weaknesses: ["Timing","Ball Placement","Accuracy"], roundGrade: "Seventh Round",
    height: "6'4 1/4\"", weight: 220, armLength: "30 1/4\"", handSize: "9 3/8\"" },
  { first: "Brashard", last: "Smith", strengths: ["Elusiveness","Vision","Lateral Agility","Receiving Ability","Special Teams Value"], weaknesses: ["Frame","Patience","Contact Balance"], roundGrade: "Fourth Round",
    height: "5'9 7/8\"", weight: 194, armLength: "30 1/2\"", handSize: "8 3/4\"", fortyYard: 4.39, vertical: 32.5, broad: "9'9\"" },
  { first: "Donte", last: "Kent", strengths: ["Experience","Recovery","Man Technique","Zone Instincts","Run Support"], weaknesses: ["Ball Hawk","Transitions","Patience"], roundGrade: "Seventh Round",
    height: "5'10\"", weight: 189 },
  { first: "Dan", last: "Jackson", strengths: ["Range","Hip Fluidity","Transitions","Ball Skills","Run Support"], weaknesses: ["Frame","Recovery","Block Shedding"], roundGrade: "Fifth Round",
    height: "5'11\"", weight: 194 },
  { first: "Quinn", last: "Ewers", strengths: ["Timing","Arm Strength","Throwing Motion","Pocket Presence","Touch"], weaknesses: ["Coverage Manipulation","Decision Making","Lower Body Mechanics"], roundGrade: "Third Round",
    height: "6'2 1/8\"", weight: 214, armLength: "30 3/4\"", handSize: "9 3/8\"" },
  { first: "Hunter", last: "Wohler", strengths: ["Tackling","Pursuit Angles","Ball Skills","Man Technique","Angle Tackling"], weaknesses: ["Recovery","Transitions","Hip Fluidity"], roundGrade: "Sixth Round",
    height: "6'2\"", weight: 213, armLength: "30 5/8\"", handSize: "9 1/4\"", fortyYard: 4.57, vertical: 37, broad: "10'0\"", threeCone: 6.72, shuttle: 4.25 },
  { first: "Kyle", last: "Monangai", strengths: ["Downhill","Elusiveness","Lateral Agility","Vision"], weaknesses: ["Patience","Long Speed","Contact Balance"], roundGrade: "UDFA",
    height: "5'8 1/4\"", weight: 211, armLength: "28 3/4\"", handSize: "9\"", fortyYard: 4.6, vertical: 34.5, broad: "9'9\"" },
  { first: "Mason", last: "Richman", strengths: ["Experience","Lateral Agility","Patience"], weaknesses: ["Frame","Balance","Anchor"], roundGrade: null,
    height: "6'5\"", weight: 307 },
  { first: "Tez", last: "Johnson", strengths: ["Position Versatility","Separation","Route Running","Release","RAC Ability"], weaknesses: ["Frame","Press","Hands"], roundGrade: "Fifth Round",
    height: "5'9 7/8\"", weight: 154, armLength: "29 3/8\"", handSize: "9\"", fortyYard: 4.51, vertical: 37, broad: "10'11\"", threeCone: 6.65, shuttle: 4.15 },
  { first: "LeQuint", last: "Allen Jr", strengths: ["Vision","Lateral Agility","Patience","Receiving Ability","Pass Protection"], weaknesses: ["Downhill","Frame","Contact Balance"], roundGrade: "Fourth Round",
    height: "6'0 1/8\"", weight: 204, armLength: "32\"", handSize: "10 1/8\"" },
  { first: "Micah", last: "Robinson", strengths: ["Range","Ball Skills","Man Technique","Run Support"], weaknesses: ["Frame","Hip Fluidity","Recovery"], roundGrade: null,
    height: "5'11\"", weight: 184 },
  { first: "Ricky", last: "White III", strengths: ["Body Control","Zone Instincts","Route Running","Separation","Special Teams Value"], weaknesses: ["Frame","Release","Ball Skills"], roundGrade: "UDFA",
    height: "6'1 1/8\"", weight: 184, armLength: "31 3/4\"", handSize: "9 1/4\"", fortyYard: 4.61, vertical: 36, broad: "10'3\"" },
  { first: "Phil", last: "Mafah", strengths: ["Frame","Patience","Vision","Contact Balance","Downhill"], weaknesses: ["Elusiveness","Lateral Agility","Receiving Ability"], roundGrade: "UDFA",
    height: "6'0 5/8\"", weight: 234, armLength: "31 3/8\"", handSize: "9 1/2\"" },
  { first: "Kaden", last: "Prather", strengths: ["Frame","Deep Routes","Route Running","Separation","RAC Ability"], weaknesses: ["Release","Body Control","Ball Tracking"], roundGrade: "UDFA",
    height: "6'3 1/2\"", weight: 204, armLength: "31 7/8\"", handSize: "9 1/4\"", fortyYard: 4.46, vertical: 30, broad: "9'6\"" },
  { first: "Caleb", last: "Lohner", strengths: ["Motor","Ball Skills","Balance"], weaknesses: ["Experience","Frame","Run Blocking"], roundGrade: null,
    height: "6'7\"", weight: 256 },
  { first: "Konata", last: "Mumpfield", strengths: ["Route Running","Separation","Ball Tracking","Ball Skills","Hands"], weaknesses: ["Body Control","RAC Ability","Zone Instincts"], roundGrade: "UDFA",
    height: "5'11 3/8\"", weight: 186, armLength: "29 3/8\"", handSize: "8 1/2\"", fortyYard: 4.59, vertical: 36, broad: "10'4\"" },
  { first: "Garrett", last: "Dellinger", strengths: ["Experience","Leg Drive","Patience","Climb","Grip Strength"], weaknesses: ["Frame","Upper Body Strength","Anchor"], roundGrade: "Sixth Round",
    height: "6'4\"", weight: 325 },
  { first: "Dominic", last: "Lovett", strengths: ["Route Running","Separation","Physicality","Ball Skills","Deep Routes"], weaknesses: ["Hands","Press","RAC Ability"], roundGrade: "Fifth Round",
    height: "5'10\"", weight: 195, armLength: "31 3/8\"", handSize: "9 1/4\"", fortyYard: 4.4, vertical: 33.5, broad: "10'0\"", shuttle: 4.27 },
  { first: "Jacory", last: "Croskey-Merritt", strengths: ["Vision","Elusiveness","Patience","Contact Balance","Downhill"], weaknesses: ["Receiving Ability","Ball Security","Experience"], roundGrade: "Fifth Round",
    height: "5'10\"", weight: 206 },
  { first: "Korie", last: "Black", strengths: ["Range","Transitions","Ball Skills","Recovery","Ball Hawk"], weaknesses: ["Press","Man Technique","Penalties"], roundGrade: "Fifth Round",
    height: "6'0\"", weight: 192 },
  { first: "Tommy", last: "Akingbesote", strengths: ["Hand Usage","Block Shedding","Lateral Agility","Pass Rush Moves","Pass Rush Plan"], weaknesses: ["Run Defense","Balance","Lower Body Strength"], roundGrade: "UDFA",
    height: "6'3 3/4\"", weight: 306, armLength: "33 1/2\"", handSize: "10\"", fortyYard: 5.09, vertical: 28, broad: "8'7\"" },
  { first: "Moliki", last: "Matavao", strengths: ["Frame","Release","Lateral Agility","Ball Skills","RAC Ability"], weaknesses: ["Route Running","Hands","Leg Drive"], roundGrade: "Sixth Round",
    height: "6'5 5/8\"", weight: 260, armLength: "32 1/2\"", handSize: "9 1/2\"", fortyYard: 4.81, vertical: 32.5, broad: "9'6\"" },
  { first: "Connor", last: "Colby", strengths: ["Experience","Patience","Grip Strength","Climb","Pass Set"], weaknesses: ["Balance","Lateral Agility","Anchor"], roundGrade: "UDFA",
    height: "6'5 3/4\"", weight: 309, armLength: "32\"", handSize: "10\"", fortyYard: 5.11, vertical: 28.5, broad: "9'2\"", threeCone: 7.78, shuttle: 4.63 },
  { first: "John", last: "Williams", strengths: ["Frame","Lateral Agility","Leg Drive","Hand Timing","Pass Set"], weaknesses: ["Hand Usage","Upper Body Strength","Anchor"], roundGrade: "UDFA",
    height: "6'4 1/8\"", weight: 322, armLength: "33 7/8\"", handSize: "11\"", fortyYard: 5.17, threeCone: 7.93, shuttle: 4.72, bench: 29 },
  { first: "Junior", last: "Bergen", strengths: ["Position Versatility","Special Teams Value","RAC Ability"], weaknesses: ["Frame","Release","Ball Skills"], roundGrade: null,
    height: "5'9\"", weight: 184 },
  { first: "Zeek", last: "Biggers", strengths: ["Frame","Pass Rush Moves","Hand Usage"], weaknesses: ["First Step","Balance","Block Shedding"], roundGrade: "Sixth Round",
    height: "6'5 1/2\"", weight: 321, armLength: "34 7/8\"", handSize: "10 1/4\"", fortyYard: 5.14, vertical: 34.5, broad: "9'3\"" },
  { first: "Fadil", last: "Diggs", strengths: ["Frame","Position Versatility","Power Rush","Hand Usage","Pass Rush Moves"], weaknesses: ["Instincts","First Step","Bend"], roundGrade: "Fifth Round",
    height: "6'4 3/8\"", weight: 257, armLength: "33 3/8\"", handSize: "10 3/8\"", fortyYard: 4.57, vertical: 30.5, broad: "10'1\"" },
  { first: "Luke", last: "Lachey", strengths: ["Frame","Run Blocking","Hand Usage","Ball Skills","Hands"], weaknesses: ["Lateral Agility","Grip Strength","Pass Blocking"], roundGrade: "Sixth Round",
    height: "6'5 3/4\"", weight: 251, armLength: "32 1/8\"", handSize: "10\"", vertical: 35, broad: "10'0\"", threeCone: 7.18, shuttle: 4.47 },
  { first: "Trikweze", last: "Bridges", strengths: ["Frame","Position Versatility","Ball Skills","Zone Instincts"], weaknesses: ["Press","Hip Fluidity","Tackling"], roundGrade: "Seventh Round",
    height: "6'2\"", weight: 196 },
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
