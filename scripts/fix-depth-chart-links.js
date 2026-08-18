// scripts/fix-depth-chart-links.js
//
// One-off data fix: cfbdepth.com dropped the trailing slash from every one
// of their team URLs (https://www.cfbdepth.com/alabama/ is now
// https://www.cfbdepth.com/alabama). Every school's DepthChart field
// (schools/{doc}.DepthChart, entered per-school in AdminPanel.js's
// TeamBrandingPane, read by TeamPage.js's depthChartHref) is stored data,
// not a code-generated URL, so this walks every school doc and strips the
// trailing slash from any DepthChart URL whose host is cfbdepth.com —
// scoped to that one domain specifically, so it can't touch some other
// site's depth-chart link that might legitimately need one.
//
// Run once: `node scripts/fix-depth-chart-links.js`
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4",
  authDomain: "we-draft.firebaseapp.com",
  projectId: "we-draft",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function fixedDepthChartUrl(url) {
  if (!url || typeof url !== "string") return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null; // not a valid absolute URL — leave it alone
  }
  if (!/(^|\.)cfbdepth\.com$/i.test(parsed.hostname)) return null; // different site
  if (parsed.pathname.length <= 1 || !parsed.pathname.endsWith("/")) return null; // already fixed, or root
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString();
}

async function run() {
  console.log("🔄 Fetching schools...");
  const snap = await getDocs(collection(db, "schools"));
  console.log(`✅ Found ${snap.docs.length} schools.`);

  let checked = 0, fixed = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (!data.DepthChart) continue;
    checked++;
    const next = fixedDepthChartUrl(data.DepthChart);
    if (!next) continue;
    await updateDoc(doc(db, "schools", docSnap.id), { DepthChart: next });
    console.log(`  ${data.School || docSnap.id}: ${data.DepthChart} -> ${next}`);
    fixed++;
  }

  console.log(`\n✅ Done — checked ${checked} schools with a DepthChart link, fixed ${fixed}.`);
}

run().catch((err) => {
  console.error("❌ Fix failed:", err);
  process.exit(1);
});
