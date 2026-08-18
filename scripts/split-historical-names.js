// scripts/split-historical-names.js
//
// One-off data fix: the `historical` collection only ever stored a single
// "Player" full-name string (e.g. "Kelvin Banks Jr."). Every other player-
// shaped collection in this app (players, recruits) stores First/Last
// separately, so this splits Player the same way admin now enters it in
// AdminPanel.js's Historical tab: First = the first word, Last = everything
// else. That's a deliberately simple rule — it gets "T. J. Sanders" wrong
// (First="T.", Last="J. Sanders") — but it's the exact rule asked for, and
// Player itself is left untouched (TeamPage.js's own historical-picks row
// still reads it directly), so nothing here is destructive or hard to
// revisit for the handful of names it splits oddly.
//
// Run once: `node scripts/split-historical-names.js`
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4",
  authDomain: "we-draft.firebaseapp.com",
  projectId: "we-draft",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] || "";
  const last = parts.slice(1).join(" ");
  return { first, last };
}

async function run() {
  console.log("🔄 Fetching historical...");
  const snap = await getDocs(collection(db, "historical"));
  console.log(`✅ Found ${snap.docs.length} records.`);

  let updated = 0, skipped = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (data.First) { skipped++; continue; } // already split, don't overwrite
    const player = (data.Player || "").trim();
    if (!player) { skipped++; continue; }
    const { first, last } = splitName(player);
    await updateDoc(doc(db, "historical", docSnap.id), { First: first, Last: last });
    updated++;
    if (updated % 500 === 0) console.log(`  ...${updated} done`);
  }

  console.log(`\n✅ Done — split ${updated} records, skipped ${skipped} (already split or no name).`);
}

run().catch((err) => {
  console.error("❌ Fix failed:", err);
  process.exit(1);
});
