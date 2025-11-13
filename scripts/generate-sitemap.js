// scripts/generate-sitemap.js
/**
 * Dynamically generates sitemap.xml for all player pages in Firestore.
 * Run with:  npm run generate-sitemap
 */

const fs = require("fs");
const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs } = require("firebase/firestore");

// ✅ Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4",
  authDomain: "we-draft.firebaseapp.com",
  projectId: "we-draft",
};

// Init Firestore
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function generateSitemap() {
  const baseUrl = "https://we-draft.com";
  const today = new Date().toISOString().split("T")[0];

  // --- Static pages ---
  const staticPages = [
    { path: "/", priority: 1.0 },
    { path: "/community", priority: 0.8 },
    { path: "/boards", priority: 0.8 },
    { path: "/profile", priority: 0.6 },
  ];

  // --- Fetch all players ---
  const snapshot = await getDocs(collection(db, "players"));
  const playerPages = [];

  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data?.Slug) {
      playerPages.push({
        path: `/player/${data.Slug}`,
        priority: 0.7,
      });
    }
  });

  // --- Build XML ---
  const urls = [...staticPages, ...playerPages]
    .map(
      (u) => `
  <url>
    <loc>${baseUrl}${u.path}</loc>
    <lastmod>${today}</lastmod>
    <priority>${u.priority}</priority>
  </url>`
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  // --- Write file ---
  fs.writeFileSync("public/sitemap.xml", xml);
  console.log(`✅ Generated sitemap with ${playerPages.length} player pages.`);
}

// --- Execute ---
generateSitemap().catch((e) => console.error("❌ Sitemap generation failed:", e));
