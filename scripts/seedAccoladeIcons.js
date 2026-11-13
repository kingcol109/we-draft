// scripts/seedAccoladeIcons.js
//
// Preloads accoladeIcons (utils/accoladeIcons.js) with every conference and
// award the player page's Career Path can show, so Admin → Branding → Misc
// only needs icons pasted in. Name = the spelling the accolade lines use
// (honors labels: "All-SEC"; ESPN award names: "Heisman Memorial Trophy");
// Aliases = other spellings (schools.Conference, common short names).
// Safe to re-run: an existing row keeps its icons and aliases — only rows
// that don't exist yet are created. Coach / contribution awards are left out
// (no prospect wins them).
//
//   node --env-file=.env scripts/seedAccoladeIcons.js          dry run
//   node --env-file=.env scripts/seedAccoladeIcons.js --write

const { FieldValue } = require("firebase-admin/firestore");
const { getFirestore } = require("./firebaseAdmin");

const WRITE = process.argv.includes("--write");
const slug = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const CONFERENCES = [
  ["AAC", ["American Athletic", "The American"]],
  ["ACC", ["Atlantic Coast"]],
  ["Big 12", []],
  ["Big Ten", ["Big 10"]],
  ["C-USA", ["CUSA", "Conference USA"]],
  ["MAC", ["Mid-American"]],
  ["Mountain West", ["MWC"]],
  ["Pac-12", ["Pac 12"]],
  ["SEC", ["Southeastern"]],
  ["Sun Belt", []],
];

const AWARDS = [
  ["All-American", ["All-America"]],
  ["National Champion", []],
  // The high school's "4-Star Recruit · No. 45 Nationally" line.
  ["5-Star Recruit", []],
  ["4-Star Recruit", []],
  ["3-Star Recruit", []],
  // Any accolade line with no icon of its own (utils/accoladeIcons.js).
  ["Fallback", []],
  ["Heisman Memorial Trophy", ["Heisman Trophy", "Heisman"]],
  ["Maxwell Award", []],
  ["Walter Camp Award", []],
  ["Davey O'Brien Award", []],
  ["Johnny Unitas Golden Arm Award", []],
  ["Doak Walker Award", []],
  ["Fred Biletnikoff Award", ["Biletnikoff Award"]],
  ["John Mackey Award", ["Mackey Award"]],
  ["Outland Trophy", []],
  ["Rimington Trophy", []],
  ["Lombardi Award", []],
  ["Chuck Bednarik Award", ["Bednarik Award"]],
  ["Bronko Nagurski Award", ["Nagurski Trophy"]],
  ["Ted Hendricks Award", []],
  ["Dick Butkus Award", ["Butkus Award"]],
  ["Jim Thorpe Award", ["Thorpe Award"]],
  ["Lou Groza Award", []],
  ["Ray Guy Award", []],
  ["Paul Hornung Award", []],
  ["Lott IMPACT Trophy", []],
  ["Burlsworth Trophy", []],
  ["Wuerffel Trophy", []],
  ["Campbell Trophy", []],
  ["Disney Spirit Award", []],
  ["Walter Payton Award", []],
  ["Buck Buchanan Award", []],
  ["Harlon Hill Trophy", []],
  ["Gagliardi Trophy", []],
];

async function run() {
  const db = getFirestore();
  const rows = [
    ...CONFERENCES.map(([Name, Aliases]) => ({ Kind: "conference", Name, Aliases })),
    ...AWARDS.map(([Name, Aliases]) => ({ Kind: "award", Name, Aliases })),
  ];
  const refs = rows.map((r) => db.collection("accoladeIcons").doc(`${r.Kind}-${slug(r.Name)}`));
  const snaps = await db.getAll(...refs);
  const batch = db.batch();
  let created = 0;
  snaps.forEach((snap, i) => {
    if (snap.exists) return;
    created++;
    console.log(`+ ${rows[i].Kind.padEnd(10)} ${rows[i].Name}${rows[i].Aliases.length ? `  (${rows[i].Aliases.join(", ")})` : ""}`);
    batch.set(refs[i], { ...rows[i], Logo: "", LogoDark: "", updatedAt: FieldValue.serverTimestamp() });
  });
  console.log(`${created} new, ${rows.length - created} already there.${WRITE ? "" : " Dry run — pass --write to save."}`);
  if (WRITE && created) await batch.commit();
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
