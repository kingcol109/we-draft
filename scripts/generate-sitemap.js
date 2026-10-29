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
  doc,
  getDoc,
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

async function getAllArticles() {
  const colRef = collection(db, "articles");
  const q = query(colRef, where("status", "==", "published"));
  const snapshot = await getDocs(q);
  return snapshot.docs;
}
async function getAllTeams() {
  const colRef = collection(db, "schools");
  const snapshot = await getDocs(colRef);
  return snapshot.docs;
}
// Current head coaches / GMs — the ones with /staff/ pages.
async function getCurrentStaff() {
  const q = query(collection(db, "coaches"), where("Status", "==", "current"));
  const snapshot = await getDocs(q);
  return snapshot.docs;
}
// A class's published Weekly Mock summary (written on Publish in
// AdminWeeklyMock.jsx; null before the first). Ids and URLs as in
// src/utils/weeklyMockNews.js: the main class at /mocks/{abbr}, the next at
// /mocks/{abbr}/{year}. A class with teamPages: false is only its whole
// mock — 2029's, when it's turned on: { year: "2029", doc: "weeklyMock2029",
// suffix: "/2029", teamPages: false }.
const WEEKLY_CLASSES = [
  { year: "2027", doc: "weeklyMock", suffix: "" },
  { year: "2028", doc: "weeklyMock2028", suffix: "/2028" },
];
async function getWeeklyMockSummary(docId) {
  const snap = await getDoc(doc(db, "config", docId));
  return snap.exists() ? snap.data() : null;
}
async function getAllGames() {
  const colRef = collection(db, "schedule26");
  const snapshot = await getDocs(colRef);
  return snapshot.docs;
}
async function generateSitemap() {
  const { CFB_STAT_PATHS: cfbStatPaths } = await import("../src/utils/cfbSeo.mjs");
  const baseUrl = "https://we-draft.com";
  const today = new Date().toISOString().split("T")[0];

  /* =========================
     PLAYERS
  ========================= */
  console.log("🔄 Fetching player data from Firestore...");
  const allPlayers = await getAllDocs("players");
  console.log(`✅ Found ${allPlayers.length} players.`);
  // An empty read means something went wrong, not that the site has no
  // players — keep the sitemap that's there rather than shrink it.
  if (!allPlayers.length) throw new Error("No players read; keeping the existing sitemap.");

  const playerPages = [];
  // Every player also has a Find Comparison page (/comparison/<Slug>, see
  // Comparison.js) — same slug, same lastmod.
  const comparisonPages = [];

  for (const doc of allPlayers) {
    const data = doc.data();
    const slug = data?.Slug;

    if (!isValidSlug(slug)) {
      console.warn("⚠️ Skipping invalid player slug:", slug);
      continue;
    }

    // AdminPanel.js's player editor now stamps updatedAt on every save
    // (both create and edit) — falls back to today for any player last
    // touched before that started, which won't have the field at all.
    const lastmod = data.updatedAt?.toDate?.()
      ? data.updatedAt.toDate().toISOString().split("T")[0]
      : today;

    playerPages.push({
      path: `/player/${slug}`,
      priority: 0.7,
      lastmod,
    });
    comparisonPages.push({
      path: `/comparison/${slug}`,
      priority: 0.6,
      lastmod,
    });
  }

  /* =========================
     NEWS ARTICLES
  ========================= */
console.log("🔄 Fetching news articles from Firestore...");
  const allNews = await getAllNews();
  const allArticles = await getAllArticles();
  console.log(`✅ Found ${allNews.length} news + ${allArticles.length} articles.`);

  const newsPages = [];

  for (const doc of [...allNews, ...allArticles]) {
    const data = doc.data();
    const slug = data?.slug;

    if (!isValidSlug(slug)) {
      console.warn("⚠️ Skipping invalid article slug:", slug);
      continue;
    }

    const lastmod =
      data.updatedAt?.toDate?.()
        ? data.updatedAt.toDate().toISOString().split("T")[0]
        : data.publishedAt?.toDate?.()
        ? data.publishedAt.toDate().toISOString().split("T")[0]
        : today;

    // avoid duplicates if same slug exists in both collections
    if (!newsPages.find(p => p.path === `/news/${slug}`)) {
      newsPages.push({
        path: `/news/${slug}`,
        priority: 0.8, // bumped up — articles are high value SEO
        lastmod,
      });
    }
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

  // Prefer the manually-set Slug field from Firestore (e.g. "lt").
  // Fall back to the auto-generated long-form slug only if it's missing.
  const manualSlug = data?.Slug;
  const slug = isValidSlug(manualSlug) ? manualSlug : toTeamSlug(school);

  if (!isValidSlug(slug)) {
    console.warn("⚠️ Skipping invalid team slug:", school);
    continue;
  }

  // AdminPanel.js's branding manager (TeamBrandingPane) already stamps
  // updatedAt on every school save — falls back to today for any school
  // that predates that field existing.
  const lastmod = data.updatedAt?.toDate?.()
    ? data.updatedAt.toDate().toISOString().split("T")[0]
    : today;

  teamPages.push({
    path: `/team/${slug}`,
    priority: 0.65,
    lastmod,
  });
}

  /* =========================
     GAME PAGES
  ========================= */
  console.log("🔄 Fetching games from Firestore...");
  const allGames = await getAllGames();
  console.log(`✅ Found ${allGames.length} games.`);

  const gamePages = [];

  for (const doc of allGames) {
    const data = doc.data();
    // Field is capitalized `Slug` here (schedule26's own convention),
    // unlike players/news/articles' lowercase `slug`.
    const slug = data?.Slug;

    if (!isValidSlug(slug)) {
      console.warn("⚠️ Skipping invalid game slug:", slug);
      continue;
    }

    const lastmod =
      data.updatedAt?.toDate?.()
        ? data.updatedAt.toDate().toISOString().split("T")[0]
        : today;

    // A game's page is its We-Draft Live page (/live/{slug}) once it's
    // matched to a CFBD game — every real game; a "TBD vs …" placeholder
    // with no match keeps its old /game/{slug} page.
    gamePages.push({
      path: data.CFBDGameId != null ? `/live/${slug}` : `/game/${slug}`,
      priority: 0.6,
      lastmod,
    });
  }

  /* =========================
     STATIC PAGES
  ========================= */
  const staticPages = [
    { path: "/", priority: 1.0, lastmod: today },
    { path: "/news", priority: 0.8, lastmod: today },
    { path: "/videos", priority: 0.8, lastmod: today },
    { path: "/cfb", priority: 0.7, lastmod: today },
    { path: "/cfb/schedule", priority: 0.65, lastmod: today },
    // Every /cfb/stats view — overview, player stat groups, leader
    // categories, team offense / defense (src/utils/cfbSeo.mjs).
    ...cfbStatPaths.map((path) => ({ path, priority: path === "/cfb/stats" ? 0.65 : 0.6, lastmod: today })),
    { path: "/live", priority: 0.75, lastmod: today },
    { path: "/community", priority: 0.8, lastmod: today },
    { path: "/boards", priority: 0.8, lastmod: today },
    { path: "/comparison", priority: 0.7, lastmod: today },
    { path: "/draftorder", priority: 0.8, lastmod: today },
    // Draft Sim, both classes (the team pages are with each team below).
    { path: "/draftsim", priority: 0.8, lastmod: today },
    { path: "/draftsim/2028", priority: 0.65, lastmod: today },
    { path: "/mocks", priority: 0.7, lastmod: today },
    { path: "/profile", priority: 0.6, lastmod: today },
    // We-Pick lives inside We-Draft Live now (/live/we-pick…); the old
    // /we-pick URLs just redirect there, so only the new ones are listed.
    { path: "/live/we-pick", priority: 0.8, lastmod: today },
    { path: "/live/we-pick/standings", priority: 0.7, lastmod: today },
    { path: "/live/we-pick/stats", priority: 0.6, lastmod: today },
    // Legal — low priority (utility pages, not content anyone searches for)
    // but still worth Google actually crawling/indexing, same reasoning as
    // every other static page here.
    { path: "/terms", priority: 0.3, lastmod: today },
    { path: "/privacy", priority: 0.3, lastmod: today },
    { path: "/guidelines", priority: 0.3, lastmod: today },
    { path: "/cookies", priority: 0.3, lastmod: today },
  ];

  /* =========================
     COMMUNITY BOARD — year + position variants
     (/community/:year and /community/:year/:position, e.g.
     /community/2027/qb — CommunityBoard.js's own route). These were never
     enumerated here before, so Google had no sitemap entry — and no real
     <a>/<Link> anywhere on the site points at a position variant either,
     they're only reachable by clicking a filter chip that does a
     client-side navigate() — so they had no crawlable path to them at all.
     ACTIVE_YEARS/ARCHIVE_YEARS/POSITION_LABELS below must be kept in sync
     with the same constants in src/pages/CommunityBoard.js by hand — this
     plain Node script can't import that file (it drags in React/JSX this
     script isn't set up to run).
  ========================= */
  const COMMUNITY_ARCHIVE_YEARS = ["2026"];
  const COMMUNITY_ACTIVE_YEARS = ["2027", "2028", "2029"];
  const COMMUNITY_POSITIONS = [
    "QB", "RB", "WR", "TE", "OL", "OT", "OG", "C",
    "EDGE", "DL", "DT", "DE", "LB", "DB", "CB", "S", "K", "P", "LS",
  ];
  const communityYears = [...COMMUNITY_ACTIVE_YEARS, ...COMMUNITY_ARCHIVE_YEARS];

  const communityBoardPages = [];
  for (const yr of communityYears) {
    // CommunityBoard.js's own yearPath() collapses the no-position 2027
    // URL down to the bare "/community" (already in staticPages above) —
    // every other year still gets its own year-only page.
    if (yr !== "2027") {
      communityBoardPages.push({ path: `/community/${yr}`, priority: 0.7, lastmod: today });
    }
    for (const pos of COMMUNITY_POSITIONS) {
      communityBoardPages.push({ path: `/community/${yr}/${pos.toLowerCase()}`, priority: 0.55, lastmod: today });
    }
  }

  /* =========================
     NFL TEAM + STAFF PAGES
     /nfl/{abbr} (Targets) with its Projected Picks / Staff / Depth Chart /
     Draft History tabs
     (NFLTeamPage.jsx), and /staff/{slug} with its tabs (StaffPage.jsx) for
     every current head coach and GM. NFL_TEAM_ABBRS must match
     src/utils/coachHistory.js by hand (same reason as the community lists
     above).
  ========================= */
  const NFL_TEAM_ABBRS = [
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
    "LV", "LAC", "LAR", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SF", "SEA", "TB", "TEN", "WAS",
  ];
  const nflPages = NFL_TEAM_ABBRS.flatMap((abbr) => {
    const base = `/nfl/${abbr.toLowerCase()}`;
    return [
      { path: base, priority: 0.7, lastmod: today },
      { path: `${base}/picks`, priority: 0.6, lastmod: today },
      { path: `${base}/staff`, priority: 0.55, lastmod: today },
      { path: `${base}/depth`, priority: 0.55, lastmod: today },
      { path: `${base}/history`, priority: 0.5, lastmod: today },
      // That team's Draft Sim, both classes.
      { path: `/draftsim/${abbr.toLowerCase()}`, priority: 0.65, lastmod: today },
      { path: `/draftsim/2028/${abbr.toLowerCase()}`, priority: 0.5, lastmod: today },
    ];
  });

  /* =========================
     WEEKLY MOCK
     Each team's page (/mocks/{abbr}, WeeklyTeamMock.jsx — the permanent
     URLs) and the class's full mock (/mocks/{year}, its current week),
     dated by when that week was published (Eastern time, the date the
     pages show) — not by this run. None before the first Weekly Mock is
     published. A week's /view URL redirects there (the current week) or is
     noindexed (past weeks, ViewMock.js), so they're left out.
  ========================= */
  console.log("🔄 Fetching the Weekly Mock summaries from Firestore...");
  const weeklyMockPages = [];
  for (const cls of WEEKLY_CLASSES) {
    const weekly = await getWeeklyMockSummary(cls.doc);
    const weeklyDate = weekly?.publishedAt?.toDate?.()?.toLocaleDateString("en-CA", { timeZone: "America/New_York" }) || null;
    if (!weekly || !weeklyDate) continue;
    const priority = cls.suffix ? 0.6 : 0.7;
    weeklyMockPages.push(
      ...(cls.teamPages === false ? [] : NFL_TEAM_ABBRS.map((abbr) => ({ path: `/mocks/${abbr.toLowerCase()}${cls.suffix}`, priority, lastmod: weeklyDate }))),
      { path: `/mocks/${cls.year}`, priority: priority + 0.05, lastmod: weeklyDate },
    );
    console.log(`✅ ${cls.year} Weekly Mock published ${weeklyDate}.`);
  }
  console.log(`✅ ${weeklyMockPages.length} Weekly Mock pages.`);

  console.log("🔄 Fetching current staff from Firestore...");
  const staffDocs = await getCurrentStaff();
  const staffPages = [];
  for (const docSnap of staffDocs) {
    const data = docSnap.data();
    const slug = docSnap.id;
    const hasPage = (data.Current || []).some((c) => ["HC", "IHC", "GM"].includes(c.Role));
    if (!hasPage) continue;
    if (!isValidSlug(slug)) {
      console.warn("⚠️ Skipping invalid staff slug:", slug);
      continue;
    }
    const lastmod = typeof data.updatedAt === "string" ? data.updatedAt.split("T")[0] : today;
    staffPages.push(
      { path: `/staff/${slug}`, priority: 0.65, lastmod },
      { path: `/staff/${slug}/targets`, priority: 0.55, lastmod },
      { path: `/staff/${slug}/record`, priority: 0.5, lastmod },
      { path: `/staff/${slug}/career`, priority: 0.45, lastmod },
    );
  }
  console.log(`✅ Found ${staffPages.length / 4} staff pages.`);

  /* =========================
     WRITE FILE
  ========================= */
// Split into chunks of 1000
  const chunkSize = 1000;
  // Everything — the NFL team, staff and Weekly Mock pages too (they were
  // built but left out of this list until 2026-10-26).
  const allUrls = [...staticPages, ...communityBoardPages, ...teamPages, ...nflPages, ...weeklyMockPages, ...staffPages, ...playerPages, ...comparisonPages, ...newsPages, ...gamePages];
  const chunks = [];
  
  for (let i = 0; i < allUrls.length; i += chunkSize) {
    chunks.push(allUrls.slice(i, i + chunkSize));
  }

  chunks.forEach((chunk, idx) => {
    const chunkXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${chunk.map(u => `
  <url>
    <loc>${baseUrl}${u.path}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <priority>${u.priority}</priority>
  </url>`).join("")}
</urlset>`;
    fs.writeFileSync(`public/sitemap-${idx + 1}.xml`, chunkXml);
  });

  // Write sitemap index
  const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${chunks.map((_, idx) => `
  <sitemap>
    <loc>${baseUrl}/sitemap-${idx + 1}.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>`).join("")}
</sitemapindex>`;

  fs.writeFileSync("public/sitemap.xml", sitemapIndex);

console.log(
  `✅ sitemap.xml generated
  - ${staticPages.length} static pages
  - ${communityBoardPages.length} community board pages
  - ${teamPages.length} team pages
  - ${nflPages.length} NFL team pages
  - ${weeklyMockPages.length} Weekly Mock pages
  - ${staffPages.length} staff pages
  - ${playerPages.length} player pages
  - ${comparisonPages.length} comparison pages
  - ${newsPages.length} news articles
  - ${gamePages.length} games`
);
}

// Run
generateSitemap().catch((err) =>
  console.error("❌ Sitemap generation failed:", err)
);