// scripts/tag-untagged-videos-as-cfb.js
//
// One-off data fix: every video created before AdminPanel.js's Videos tab
// grew a Tags field has no Tags array at all. VideosPage.js/CommunityBoard.js
// already treat that as an implicit CFB at read time, but the user wants it
// written explicitly instead, so it shows up in AdminPanel.js's own Tags
// picker ready to review/adjust rather than looking untagged forever. Only
// touches docs with no Tags or an empty Tags array — anything already
// tagged (Draft/Recruiting/CFB, in any combination) is left exactly as-is.
//
// Run once: `node scripts/tag-untagged-videos-as-cfb.js`
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4",
  authDomain: "we-draft.firebaseapp.com",
  projectId: "we-draft",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  console.log("🔄 Fetching videos...");
  const snap = await getDocs(collection(db, "videos"));
  console.log(`✅ Found ${snap.docs.length} videos.`);

  let updated = 0, skipped = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const tags = Array.isArray(data.Tags) ? data.Tags : [];
    if (tags.length > 0) { skipped++; continue; }
    await updateDoc(doc(db, "videos", docSnap.id), { Tags: ["CFB"] });
    updated++;
  }

  console.log(`\n✅ Done — tagged ${updated} videos as CFB, skipped ${skipped} (already tagged).`);
}

run().catch((err) => {
  console.error("❌ Fix failed:", err);
  process.exit(1);
});
