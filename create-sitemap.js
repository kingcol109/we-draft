// scripts/generate-sitemap.js
const fs = require("fs");
const admin = require("firebase-admin");

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function generateSitemap() {
  try {
    const playersSnap = await db.collection("players").get();

    const urls = playersSnap.docs.map((doc) => {
      const data = doc.data();
      const slug = data.Slug || doc.id;
      return `<url>
        <loc>https://we-draft.com/player/${slug}</loc>
        <changefreq>daily</changefreq>
        <priority>0.7</priority>
      </url>`;
    });

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://we-draft.com/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://we-draft.com/community</loc>
  </url>
  <url>
    <loc>https://we-draft.com/boards</loc>
  </url>
  <url>
    <loc>https://we-draft.com/profile</loc>
  </url>
  ${urls.join("\n")}
</urlset>`;

    fs.writeFileSync("./public/sitemap.xml", sitemap, "utf8");
    console.log("✅ Sitemap generated at public/sitemap.xml");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error generating sitemap:", err);
    process.exit(1);
  }
}

generateSitemap();
