// scripts/fix-historical-combine-decimals.js
//
// One-off data fix: Height/Arm Length/Hand Size on the `historical`
// collection are measured in eighths of an inch (.125/.25/.375/.5/.625/
// .75/.875) — some rows got rounded to two decimal places somewhere in the
// import pipeline (.375 -> .38, .625 -> .63, etc.), and a few carry a tiny
// floating-point artifact (9.626 instead of 9.625). This snaps any value
// within TOLERANCE of a valid eighth back to that exact eighth. Values that
// AREN'T close to any eighth (a cluster of ~90 rows in the 2020 class
// stored in tenths instead, plus a handful of clearly-wrong outliers like a
// 4-something "Hand Size") are deliberately left untouched — those aren't
// a rounding artifact of a known-correct value, converting them would be
// guessing, not fixing.
//
// Run once: `node scripts/fix-historical-combine-decimals.js`
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4",
  authDomain: "we-draft.firebaseapp.com",
  projectId: "we-draft",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const FIELDS = ["Height", "Arm Length", "Hand Size"];
const EIGHTHS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
const TOLERANCE = 0.006;

function nearestEighthFix(raw) {
  if (raw == null || raw === "") return null;
  const num = parseFloat(raw);
  if (isNaN(num)) return null;
  const whole = Math.floor(num);
  const dec = num - whole;
  let nearest = null, nearestDiff = Infinity;
  EIGHTHS.forEach((e) => {
    const diff = Math.abs(dec - e);
    if (diff < nearestDiff) { nearestDiff = diff; nearest = e; }
  });
  if (nearestDiff === 0 || nearestDiff > TOLERANCE) return null; // already exact, or too far to be this bug
  return (whole + nearest).toString();
}

async function run() {
  console.log("🔄 Fetching historical...");
  const snap = await getDocs(collection(db, "historical"));
  console.log(`✅ Found ${snap.docs.length} records.`);

  let fixed = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const updates = {};
    FIELDS.forEach((f) => {
      const corrected = nearestEighthFix(data[f]);
      if (corrected && corrected !== data[f]) updates[f] = corrected;
    });
    if (Object.keys(updates).length === 0) continue;
    await updateDoc(doc(db, "historical", docSnap.id), updates);
    console.log(`  ${data.Player || docSnap.id} (${data.Year}): ${JSON.stringify(updates)}`);
    fixed++;
  }

  console.log(`\n✅ Done — corrected ${fixed} records.`);
}

run().catch((err) => {
  console.error("❌ Fix failed:", err);
  process.exit(1);
});
