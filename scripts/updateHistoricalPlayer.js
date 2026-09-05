// scripts/updateHistoricalPlayer.js
//
// Reusable updater for one `historical` collection record (see
// AdminPanel.js's HistoricalSection) — built so filling in a prospect's
// combine numbers, Strengths/Weaknesses, and retro grade from an NFL.com
// prospect page never needs a new one-off script written per player.
//
// Usage:
//   node --env-file=.env scripts/updateHistoricalPlayer.js <path-to-payload.json>
//
// Payload shape (all fields optional except first/last — only what's
// present gets written, same partial-update semantics as Firestore's own
// .update()). Height/Broad/Arm Length/Hand Size accept EITHER the raw
// on-page text (e.g. "6'3 3/4\"", "34 3/8\"", "10\"") or an already-computed
// decimal — no need to do the eighths math by hand before calling this:
//   {
//     "first": "Jalyx", "last": "Hunt",
//     "height": "6'3 3/4\"", "weight": "252",
//     "armLength": "34 3/8\"", "handSize": "10\"",
//     "fortyYard": "4.64", "vertical": "37.5", "broad": "10'8\"",
//     "bench": "19", "threeCone": null, "shuttle": null,
//     "strengths": ["Frame", "Speed Rush", "Bend"],
//     "weaknesses": ["Lower Body Strength", "Hand Usage"],
//     "roundGrade": "Fourth Round",
//     "draftYear": "2024", "draftRound": "3", "draftPick": "94",
//     "nflTeam": "Philadelphia Eagles"
//   }
// A null/omitted combine field is left untouched on the doc (not cleared) —
// this mirrors "unofficial"/"--" page fields simply not being reported yet,
// not the player actually lacking that measurement.
//
// Looks the record up by exact First+Last match and refuses to guess if
// that's not exactly one document (0 = check spelling/hasn't been
// imported; 2+ = disambiguate manually, e.g. two players sharing a name).
// Strengths/Weaknesses are checked against that record's own
// traits/{Position} + traits/Generic option lists (the same source the
// admin panel's own picker reads from) and flagged — not blocked — if
// something doesn't match, since a typo here would otherwise just silently
// sit in the array as a string nothing else recognizes.

const fs = require("fs");
const { getFirestore } = require("./firebaseAdmin");

function parseFraction(str) {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(str.trim());
  return m ? Number(m[1]) / Number(m[2]) : 0;
}

// "6'3 3/4"" / "6'4"" / "10'8"" / a plain decimal already -> total inches.
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

// "34 3/8"" / "10"" / a plain decimal already -> inches as a decimal.
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

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    console.error("Usage: node --env-file=.env scripts/updateHistoricalPlayer.js <path-to-payload.json>");
    process.exit(1);
  }
  const input = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  if (!input.first || !input.last) {
    console.error("Payload must include \"first\" and \"last\".");
    process.exit(1);
  }

  const db = getFirestore();
  const snap = await db.collection("historical").where("First", "==", input.first).where("Last", "==", input.last).get();
  if (snap.size !== 1) {
    console.error(`Expected exactly 1 match for ${input.first} ${input.last}, found ${snap.size}.`);
    snap.forEach((d) => console.error(" -", d.id, JSON.stringify(d.data())));
    process.exit(1);
  }

  const docSnap = snap.docs[0];
  const before = docSnap.data();
  console.log("Before:", JSON.stringify(before, null, 2));

  const fields = {};

  const height = parseFeetInches(input.height);
  if (height != null) fields.Height = String(height);
  const broad = parseFeetInches(input.broad);
  if (broad != null) fields.Broad = String(broad);
  const armLength = parseInchesFraction(input.armLength);
  if (armLength != null) fields["Arm Length"] = String(armLength);
  const handSize = parseInchesFraction(input.handSize);
  if (handSize != null) fields["Hand Size"] = String(handSize);

  if (input.weight != null) fields.Weight = String(input.weight);
  if (input.fortyYard != null) fields["40 Yard "] = String(input.fortyYard);
  if (input.vertical != null) fields.Vertical = String(input.vertical);
  if (input.bench != null) fields.Bench = String(input.bench);
  if (input.threeCone != null) fields["3-Cone"] = String(input.threeCone);
  if (input.shuttle != null) fields.Shuttle = String(input.shuttle);

  if (input.draftYear != null) fields.Year = String(input.draftYear);
  if (input.draftRound != null) fields.Round = String(input.draftRound);
  if (input.draftPick != null) fields.Pick = String(input.draftPick);
  if (input.nflTeam != null) fields["NFL Team"] = input.nflTeam;

  if (input.roundGrade != null) {
    if (!VALID_ROUND_GRADES.includes(input.roundGrade)) {
      console.error(`"${input.roundGrade}" isn't a recognized RoundGrade. Valid values: ${VALID_ROUND_GRADES.join(", ")}`);
      process.exit(1);
    }
    fields.RoundGrade = input.roundGrade;
  }

  if (Array.isArray(input.strengths)) fields.Strengths = input.strengths;
  if (Array.isArray(input.weaknesses)) fields.Weaknesses = input.weaknesses;

  // Flag (not block) any Strength/Weakness that doesn't match this
  // player's own traits/{Position} + traits/Generic option lists, and any
  // trait that snuck into both lists at once.
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
      console.warn(`⚠ Not in traits/${position} or traits/Generic: ${unknown.join(", ")}`);
    }
    const overlap = (fields.Strengths || []).filter((t) => (fields.Weaknesses || []).includes(t));
    if (overlap.length > 0) {
      console.warn(`⚠ Listed as both a Strength and a Weakness: ${overlap.join(", ")}`);
    }
  }

  if (Object.keys(fields).length === 0) {
    console.log("Nothing to update — payload had no recognized fields.");
    process.exit(0);
  }

  await docSnap.ref.update(fields);
  const after = await docSnap.ref.get();
  console.log("\nAfter:", JSON.stringify(after.data(), null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
