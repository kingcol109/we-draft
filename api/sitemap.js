import { db } from "../src/firebase";
import { collection, getDocs } from "firebase/firestore";

export default async function handler(req, res) {
  try {
    const snapshot = await getDocs(collection(db, "players"));
    const slugs = snapshot.docs.map((doc) => doc.data().Slug);

    const baseUrl = "we-draft.com"; // change to your domain
    const urls = slugs
      .map(
        (slug) => `
        <url>
          <loc>${baseUrl}/player/${slug}</loc>
          <changefreq>daily</changefreq>
          <priority>0.8</priority>
        </url>
      `
      )
      .join("");

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url>
          <loc>${baseUrl}</loc>
          <changefreq>daily</changefreq>
          <priority>1.0</priority>
        </url>
        <url>
          <loc>${baseUrl}/community</loc>
          <changefreq>daily</changefreq>
          <priority>0.7</priority>
        </url>
        ${urls}
      </urlset>`;

    res.setHeader("Content-Type", "application/xml");
    res.status(200).send(sitemap);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate sitemap" });
  }
}
