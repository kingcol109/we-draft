// scripts/tag-april-2026-videos-as-draft.js
//
// One-off data fix: every video dated April 2026 (UTC) gets Tags set to
// exactly ["Draft"] — replacing whatever tags it had, not merging with
// them, since the ask was "make them just Draft". Month/year checked
// against the stored Timestamp's UTC components (getUTCFullYear/
// getUTCMonth), matching how Date is actually stored — this is a content-
// organization tag, not something that needs to account for a viewer's
// local timezone.
//
// Run once: `node scripts/tag-april-2026-videos-as-draft.js`
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4",
  authDomain: "we-draft.firebaseapp.com",
  projectId: "we-draft",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function isApril2026(ts) {
  const d = ts?.toDate?.();
  if (!d) return false;
  return d.getUTCFullYear() === 2026 && d.getUTCMonth() === 3; // April = index 3
}

async function run() {
  console.log("🔄 Fetching videos...");
  const snap = await getDocs(collection(db, "videos"));
  console.log(`✅ Found ${snap.docs.length} videos.`);

  let updated = 0, skipped = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (!isApril2026(data.Date)) { skipped++; continue; }
    await updateDoc(doc(db, "videos", docSnap.id), { Tags: ["Draft"] });
    updated++;
    console.log(`  tagged Draft: ${data.GenTitle || "(no gen title)"} — was [${(data.Tags || []).join(", ")}]`);
  }

  console.log(`\n✅ Done — set ${updated} April 2026 videos to Tags=["Draft"], skipped ${skipped} (not April 2026).`);
}

run().catch((err) => {
  console.error("❌ Fix failed:", err);
  process.exit(1);
});
