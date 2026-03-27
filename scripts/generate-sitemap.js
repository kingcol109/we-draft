// scripts/generate-sitemap.js
import fs from "fs";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
} from "firebase/firestore";

// --- Firebase config ---
const firebaseConfig = {
  apiKey: "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4",
  authDomain: "we-draft.firebaseapp.com",
  projectId: "we-draft",
};

// --- Initialize Firebase ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/**
 * SAFETY:
 * Slug must be lowercase, hyphenated, ascii only
 * Prevents sitemap corruption
 */
function isValidSlug(slug) {
  return (
    typeof slug === "string" &&
    slug.length > 0 &&
    /^[a-z0-9-]+$/.test(slug)
  );
}
function toTeamSlug(school) {
  if (!school) return "";

  const map = {
    "Army West Point": "army",
    "NC State": "nc-state",
    "UConn": "uconn",
  };

  if (map[school]) return map[school];

  return school
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}
/**
 * Fetch all docs from a collection that uses `Slug` (players)
 */
async function getAllDocs(colName) {
  const colRef = collection(db, colName);
  const allDocs = [];
  let lastDoc = null;

  while (true) {
    const q = lastDoc
      ? query(colRef, orderBy("Slug"), startAfter(lastDoc), limit(100))
      : query(colRef, orderBy("Slug"), limit(100));

    const snapshot = await getDocs(q);
    if (snapshot.empty) break;

    allDocs.push(...snapshot.docs);
    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    if (snapshot.size < 100) break;
  }

  return allDocs;
}

/**
 * Fetch all ACTIVE news articles (uses `slug`)
 */
async function getAllNews() {
  const colRef = collection(db, "news");
  const q = query(colRef, where("active", "==", true));
  const snapshot = await getDocs(q);
  return snapshot.docs;
}
async function getAllTeams() {
  const colRef = collection(db, "schools");
  const snapshot = await getDocs(colRef);
  return snapshot.docs;
}
async function generateSitemap() {
  const baseUrl = "https://we-draft.com";
  const today = new Date().toISOString().split("T")[0];

  /* =========================
     PLAYERS
  ========================= */
  console.log("🔄 Fetching player data from Firestore...");
  const allPlayers = await getAllDocs("players");
  console.log(`✅ Found ${allPlayers.length} players.`);

  const playerPages = [];

  for (const doc of allPlayers) {
    const data = doc.data();
    const slug = data?.Slug;

    if (!isValidSlug(slug)) {
      console.warn("⚠️ Skipping invalid player slug:", slug);
      continue;
    }

    playerPages.push({
      path: `/player/${slug}`,
      priority: 0.7,
      lastmod: today,
    });
  }

  /* =========================
     NEWS ARTICLES
  ========================= */
  console.log("🔄 Fetching news articles from Firestore...");
  const allNews = await getAllNews();
  console.log(`✅ Found ${allNews.length} articles.`);

  const newsPages = [];

  for (const doc of allNews) {
    const data = doc.data();
    const slug = data?.slug;

    if (!isValidSlug(slug)) {
      console.warn("⚠️ Skipping invalid article slug:", slug);
      continue;
    }

    const lastmod =
      data.publishedAt?.toDate?.()
        ? data.publishedAt.toDate().toISOString().split("T")[0]
        : today;

    newsPages.push({
      path: `/news/${slug}`,
      priority: 0.6,
      lastmod,
    });
  }
/* =========================
   TEAM PAGES
========================= */
console.log("🔄 Fetching team data from Firestore...");
const allTeams = await getAllTeams();
console.log(`✅ Found ${allTeams.length} teams.`);

const teamPages = [];

for (const doc of allTeams) {
  const data = doc.data();
  const school = data?.School;

  const slug = toTeamSlug(school);

  if (!isValidSlug(slug)) {
    console.warn("⚠️ Skipping invalid team slug:", slug);
    continue;
  }

  teamPages.push({
    path: `/team/${slug}`,
    priority: 0.65,
    lastmod: today,
  });
}
  /* =========================
     STATIC PAGES
  ========================= */
  const staticPages = [
    { path: "/", priority: 1.0, lastmod: today },
    { path: "/news", priority: 0.8, lastmod: today },
    { path: "/community", priority: 0.8, lastmod: today },
    { path: "/boards", priority: 0.8, lastmod: today },
    { path: "/profile", priority: 0.6, lastmod: today },
  ];

  /* =========================
     BUILD XML
  ========================= */
const urls = [...staticPages, ...teamPages, ...playerPages, ...newsPages]
    .map(
      (u) => `
  <url>
    <loc>${baseUrl}${u.path}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <priority>${u.priority}</priority>
  </url>`
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  /* =========================
     WRITE FILE
  ========================= */
  fs.writeFileSync("public/sitemap.xml", xml);

console.log(
  `✅ sitemap.xml generated
  - ${staticPages.length} static pages
  - ${teamPages.length} team pages
  - ${playerPages.length} player pages
  - ${newsPages.length} news articles`
);
}

// Run
generateSitemap().catch((err) =>
  console.error("❌ Sitemap generation failed:", err)
);
