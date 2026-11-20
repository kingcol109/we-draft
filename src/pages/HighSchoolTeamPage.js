// src/pages/HighSchoolTeamPage.js
//
// A high school's own team page (/hs/{st}/{school}, e.g. /hs/nj/hun-school) — branded like TeamPage.js
// (college team pages). Every school with a logo uploaded (highSchools
// Logo1) has one. Indexed and in the sitemap since 2026-11-20 (with the /hs
// hub and state pages, which link here); title/description/canonical below.
//
// Reads (a page view): the school (highSchools where Slug == slug — one
// indexed query), its precomputed doc hsAlumni/{id} (current college
// players, drafted alumni, national/state ranks — server/highSchools/
// hsIndex.js), its state's leaderboard (hsAlumni/_rankings_{ST}) for the
// left sidebar, plus the We-Draft players from the school (links, community
// grades, the News feed).
//
// Tabs: Current Players | Drafted | Rankings (position by position).
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { averageGradesFor, gradeLabel } from "../utils/communityGrades";
import { Helmet } from "react-helmet-async";
import LoadingSpinner from "../components/LoadingSpinner";
import { useMobileStuckPageWatchdog } from "../hooks/useMobileStuckPageWatchdog";
import { useSchools } from "../components/DraftArchiveList";
import { currentDraftClass } from "../utils/eligibility";
import { POS_GROUPS, rankText, stateAbbr, hsPath } from "../utils/hsRanks";
import { isUnreleasedYear, isUnreleasedSlug, useIsAdmin } from "../utils/prospectYears";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// Same drifting-texture + breathing-spotlight recipe as TeamPage.js's own
// hero (HERO_STYLE there) — renamed per-page since this file doesn't
// import from TeamPage.js.
const HERO_STYLE = `
  @keyframes wdHsHeroDrift {
    0%   { transform: translate(0, 0); }
    100% { transform: translate(-80px, -46px); }
  }
  @keyframes wdHsHeroSpotlight {
    0%, 100% { opacity: 0.7; }
    50%      { opacity: 1; }
  }
  @keyframes wdHsPickIn {
    0%   { opacity: 0; transform: translateY(14px) scale(0.97); }
    100% { opacity: 1; transform: none; }
  }
  .wd-hs-pick { transition: transform .18s ease, box-shadow .18s ease; }
  .wd-hs-pick:hover { transform: translateY(-4px); box-shadow: 0 14px 30px rgba(0,0,0,0.3) !important; }
  @keyframes wdHsLogoGlow {
    0%, 100% { opacity: 0.82; transform: scale(0.96); }
    50%      { opacity: 1;    transform: scale(1.04); }
  }
  @media (prefers-reduced-motion: reduce) {
    .wd-hs-glow { animation: none !important; }
  }
`;

// Full state name -> 2-letter code, same table AdminPanel.js keeps (not
// exported from there, duplicated here per this codebase's own
// per-file-helper convention).
const STATE_ABBR = {
  "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
  "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC",
  "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL",
  "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
  "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
  "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR",
  "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
  "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA",
  "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
};

// Same slug math as AdminPanel.js's own toHsSlug — deterministic from
// Name + State rather than a stored field, so it always matches a school's
// *current* Name/State even right after an admin renames one.
function toHsSlug(name, state) {
  const abbr = STATE_ABBR[state] || state || "";
  const raw = `${name || ""} ${abbr}`;
  return raw
    .replace(/['’`.]/g, "")
    .replace(/[^a-zA-Z0-9\- ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/-+/g, "-");
}

function sanitizeUrl(url) {
  const u = (url || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

// imgur.com/x.png answers with a 302 to i.imgur.com/x.png — crawlers get
// the direct image (og:image, JSON-LD).
const directImage = (url) => sanitizeUrl(url).replace(/^https?:\/\/(www\.)?imgur\.com\//i, "https://i.imgur.com/");

const NEWS_LIMIT = 8;
// Players tab order: graded We-Draft players first, best grade first.
const GRADE_ORDER = ["Early First Round", "Middle First Round", "Late First Round", "Second Round", "Third Round", "Fourth Round", "Fifth Round", "Sixth Round", "Seventh Round", "UDFA"];

// Same grade scale/labels/display map TeamPage.js's own Prospects list
// uses — duplicated here per this codebase's per-file convention.
const gradeDisplay = (g) => {
  const map = {
    "Early First Round":  { short: "1st", bg: "#3B6D11", border: "#27500A" },
    "Middle First Round": { short: "1st", bg: "#3B6D11", border: "#27500A" },
    "Late First Round":   { short: "1st", bg: "#3B6D11", border: "#27500A" },
    "Second Round":       { short: "2nd", bg: "#0F6E56", border: "#085041" },
    "Third Round":        { short: "3rd", bg: "#185FA5", border: "#0C447C" },
    "Fourth Round":       { short: "4th", bg: "#BA7517", border: "#854F0B" },
    "Fifth Round":        { short: "5th", bg: "#BA7517", border: "#854F0B" },
    "Sixth Round":        { short: "6th", bg: "#993C1D", border: "#712B13" },
    "Seventh Round":      { short: "7th", bg: "#993C1D", border: "#712B13" },
    "UDFA":                { short: "U",   bg: "#A32D2D", border: "#791F1F" },
  };
  return map[g] || null;
};

function GradeBadge({ grade }) {
  const gd = gradeDisplay(grade);
  if (!gd) return null;
  return (
    <div style={{
      width: "58px", height: "42px", borderRadius: "5px",
      backgroundColor: gd.bg, border: `2px solid ${gd.border}`,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    }}>
      <span style={{ fontSize: "15px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{gd.short}</span>
      <span style={{ fontSize: "6px", fontWeight: 800, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {grade === "UDFA" ? "UDFA" : "ROUND"}
      </span>
    </div>
  );
}

// ── Shared sidebar card shell — TeamPage.js's SidebarCard: hairline
// border, rounded, a solid team-color header. ──
function SidebarCard({ title, color1, children, headerRight }) {
  return (
    <div style={{ border: `1px solid ${SIDE_LINE}`, borderRadius: "14px", overflow: "hidden", background: "#fff" }}>
      <div style={{ backgroundColor: color1, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", letterSpacing: "0.14em", textTransform: "uppercase" }}>
          {title}
        </div>
        {headerRight}
      </div>
      <div>{children}</div>
    </div>
  );
}

// News isn't a tab — it's its own right-column sidebar (NewsSidebar below),
// same as TeamPage.js's own layout.
// Current Players: every current college player from the school (CFBD
// rosters, hsAlumni) plus any We-Draft player not on one; only We-Draft
// players link. Drafted: alumni drafted into the NFL since 2000. Rankings:
// the school's national and state rank, overall and by position.
const TABS = [
  { key: "players", label: "Current Players" },
  { key: "archive", label: "Drafted" },
  { key: "rankings", label: "Rankings" },
];

// Perceived brightness of a #rgb / #rrggbb color (0–1) — TeamPage.js's.
function colorLightness(c) {
  let h = (c || "").trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return 0;
  const n = parseInt(h, 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
// Sidebar tokens — the college team page's (TeamPage.js SIDE_*).
const SIDE_LINE = "#e3e8ef";
const SIDE_LINE_2 = "#eef1f5";
const SIDE_SOFT = "#f7f9fc";
const SIDE_INK = "#0f1b2d";

export default function HighSchoolTeamPage() {
  const { isAdmin } = useIsAdmin();
  // /hs/{st}/{school} → the stored Slug "{school}-{st}".
  const { st: stParam, school: schoolParam } = useParams();
  const slug = `${schoolParam || ""}-${stParam || ""}`.toLowerCase();
  // Open at the top, not wherever the last page was scrolled.
  useEffect(() => { window.scrollTo(0, 0); }, [slug]);
  const [school, setSchool] = useState(null); // null = loading, false = not available
  const [players, setPlayers] = useState([]);
  const [archive, setArchive] = useState([]);
  const [stats, setStats] = useState(null); // hsAlumni stats / totals / draft years
  const [stateBoard, setStateBoard] = useState(null); // hsAlumni/_rankings_{ST}
  const [news, setNews] = useState([]);
  const [contentLoading, setContentLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("players");
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  // Mobile "stuck loading forever" watchdog — see the hook's own comment.
  // school === null is specifically "still loading" here (false is a
  // resolved "not available," not stuck).
  useMobileStuckPageWatchdog(school === null, slug, { enabled: isMobile });

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // The school whose stored Slug matches the URL (one indexed query — the
  // admin and server/highSchools/hsIndex.js keep Slug current). Only a
  // school with a logo has a page; removing it takes the page down.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const snap = await getDocs(query(collection(db, "highSchools"), where("Slug", "==", slug)));
        const match = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .find((h) => h.Logo1 && toHsSlug(h.Name, h.State) === slug);
        if (cancelled) return;
        setSchool(match || false);
      } catch (e) {
        console.error("High school team page load error:", e);
        if (!cancelled) setSchool(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [slug]);

  // Players (CFBD's rosters + We-Draft), Archive (historical picks + this
  // year's class), and the We-Draft alumni the News feed is built from —
  // matched on the school's Name AND State (two states can share a name:
  // Mater Dei in Santa Ana vs. Freehold, NJ).
  useEffect(() => {
    if (!school) { setContentLoading(false); return; }
    let cancelled = false;
    const loadContent = async () => {
      setContentLoading(true);
      try {
        const sameState = (x) => !x.State || x.State === school.State;
        const chunk = (arr, n = 10) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
        const [allPlayersSnap, alumniSnap, boardSnap] = await Promise.all([
          getDocs(query(collection(db, "players"), where("HighSchool", "==", school.Name))),
          getDoc(doc(db, "hsAlumni", school.id)).catch(() => null),
          getDoc(doc(db, "hsAlumni", `_rankings_${stateAbbr(school.State)}`)).catch(() => null),
        ]);
        // An unreleased class (utils/prospectYears.js) only shows to admins.
        const allAlumni = allPlayersSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(sameState)
          .filter((p) => isAdmin || !isUnreleasedYear(p.Eligible));
        if (cancelled) return;
        const idx = alumniSnap?.data() || {};
        setStats(idx.stats ? { stats: idx.stats, totals: idx.totals || {}, draftFrom: idx.draftFrom, draftTo: idx.draftTo } : null);
        setStateBoard(boardSnap?.data() || null);

        // Everyone in college now: CFBD's rows (a We-Draft link when there
        // is one), then We-Draft players still in school that CFBD lacks.
        const byId = Object.fromEntries(allAlumni.map((p) => [p.id, p]));
        const cfbd = idx.players || [];
        const C = Number(currentDraftClass());
        const rows = cfbd.map((r) => {
          const wd = r.id ? byId[r.id] : null;
          return { key: `c${r.c}`, name: r.n, pos: wd?.Position || r.pos, college: wd?.School || r.s, hsClass: r.rc || Number(wd?.RecruitYear) || null, stars: r.st, id: wd?.id || null, slug: wd?.Slug || (r.slug && (isAdmin || !isUnreleasedSlug(r.slug)) ? r.slug : null) };
        });
        const inList = new Set(rows.map((r) => r.id).filter(Boolean));
        allAlumni.filter((p) => !inList.has(p.id) && Number(p.Eligible) >= C).forEach((p) => rows.push({
          key: p.id, name: `${p.First || ""} ${p.Last || ""}`.trim(), pos: p.Position, college: p.School,
          hsClass: Number(p.RecruitYear) || null, stars: p.RecruitStars || null, id: p.id, slug: p.Slug,
        }));
        // Community grade per We-Draft player — one snapshot read
        // (utils/communityGrades.js), not a query per player.
        const avgs = await averageGradesFor(rows.map((r) => r.id).filter(Boolean));
        rows.forEach((r) => { r.grade = r.id ? gradeLabel(avgs[r.id]) : null; });
        const gi = (g) => (g ? GRADE_ORDER.indexOf(g) : 99);
        rows.sort((a, b) => gi(a.grade) - gi(b.grade) || (a.hsClass || 9999) - (b.hsClass || 9999) || a.name.localeCompare(b.name));
        if (cancelled) return;
        setPlayers(rows);

        // Drafted: precomputed with the rest (historical + the latest class's
        // picks), newest first.
        setArchive((idx.drafted || []).map((r, i) => ({ id: `d${i}`, ...r })));

        // "All alumni" — every player (any Eligible year, not just active
        // prospects) who came through this high school — is the pool the
        // News feed is built from.
        const alumniIds = allAlumni.map((p) => p.id).filter(Boolean);
        const alumniSlugs = allAlumni.map((p) => p.Slug).filter(Boolean);
        const [articleSnaps, newsSnaps] = await Promise.all([
          Promise.all(chunk(alumniIds).map((c) => getDocs(query(collection(db, "articles"), where("status", "==", "published"), where("playerIds", "array-contains-any", c))))),
          Promise.all(chunk(alumniSlugs).map((c) => getDocs(query(collection(db, "news"), where("active", "==", true), where("slugs", "array-contains-any", c))))),
        ]);
        const toMs = (ts) => ts?.toMillis?.() ?? (ts?.toDate ? ts.toDate().getTime() : 0);
        const seen = new Set();
        const feed = [];
        articleSnaps.forEach((snap) => snap.docs.forEach((d) => {
          if (seen.has(d.id)) return;
          seen.add(d.id);
          feed.push({ id: d.id, type: "article", ...d.data() });
        }));
        newsSnaps.forEach((snap) => snap.docs.forEach((d) => {
          if (seen.has(d.id)) return;
          seen.add(d.id);
          feed.push({ id: d.id, type: "news", ...d.data() });
        }));
        feed.sort((a, b) => toMs(b.publishedAt) - toMs(a.publishedAt));
        if (!cancelled) setNews(feed.slice(0, 20));
      } catch (e) {
        console.error("High school team page content error:", e);
        if (!cancelled) { setPlayers([]); setArchive([]); setNews([]); setStats(null); setStateBoard(null); }
      } finally {
        if (!cancelled) setContentLoading(false);
      }
    };
    loadContent();
    return () => { cancelled = true; };
  }, [school, isAdmin]);

  if (school === null) {
    return <LoadingSpinner label="Loading" size={56} minHeight="calc(60vh / var(--pz, 1))" />;
  }

  if (school === false) {
    return (
      <>
        <Helmet><meta name="robots" content="noindex, nofollow" /></Helmet>
        <div style={{ textAlign: "center", padding: "80px 20px", color: "#999", fontWeight: 700, fontFamily: "'Arial Black', Arial, sans-serif" }}>
          This page isn't available.
        </div>
      </>
    );
  }

  const color1 = school.Color1 || BLUE;
  const color2 = school.Color2 || GOLD;
  const heroLogo = school.LogoDark || school.Logo1 || "";
  // Sidebar header color: the team color that holds white text (else the
  // other, else site blue) — TeamPage.js's sideC1.
  const sideC1 = colorLightness(color1) < 0.75 ? color1 : colorLightness(color2) < 0.75 ? color2 : BLUE;
  const cityState = [school.City, school.State ? (STATE_ABBR[school.State] || school.State) : ""].filter(Boolean).join(", ");
  // SEO: "Buford Football: College Players & NFL Draft Picks", with the
  // school's own numbers in the description once they've loaded.
  const nCfb = stats?.stats?.cfb?.ALL?.v;
  const nNfl = stats?.stats?.nfl?.ALL?.v;
  const seo = {
    title: `${school.Name} Football: College Players & NFL Draft Picks | We-Draft.com`,
    description: nCfb != null
      ? `${school.Name} (${stateAbbr(school.State)}) has ${nCfb} player${nCfb === 1 ? "" : "s"} in college football and ${nNfl || 0} NFL draft pick${nNfl === 1 ? "" : "s"}. See every current player, draft history, and state rankings.`
      : `${school.Name}${cityState ? ` (${cityState})` : ""} high school football: current college players, NFL draft picks, and state rankings.`,
    url: `https://we-draft.com${hsPath(slug)}`,
  };
  // Structured data: the team (name, sport, logo, place) and the breadcrumb
  // trail We-Draft.com › High Schools › {State} › {School}.
  const teamName = `${school.Name}${school.Mascot ? ` ${school.Mascot}` : ""}`;
  const logoUrl = school.Logo1 ? directImage(school.Logo1) : "";
  const stAbbr = stateAbbr(school.State);
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "SportsTeam",
      name: teamName,
      alternateName: school.Name,
      sport: "American Football",
      url: seo.url,
      description: seo.description,
      ...(logoUrl ? { logo: logoUrl, image: logoUrl } : {}),
      location: {
        "@type": "Place",
        address: {
          "@type": "PostalAddress",
          ...(school.City ? { addressLocality: school.City } : {}),
          ...(stAbbr ? { addressRegion: stAbbr } : {}),
          addressCountry: "US",
        },
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "We-Draft.com", item: "https://we-draft.com/" },
        { "@type": "ListItem", position: 2, name: "High Schools", item: "https://we-draft.com/hs" },
        ...(stAbbr ? [{ "@type": "ListItem", position: 3, name: school.State, item: `https://we-draft.com/hs/${stAbbr.toLowerCase()}` }] : []),
        { "@type": "ListItem", position: stAbbr ? 4 : 3, name: school.Name, item: seo.url },
      ],
    },
  ];

  return (
    <>
      <style>{HERO_STYLE}</style>
      <Helmet>
        {/* Indexed since 2026-11-20 (user), with the /hs pages; in the sitemap. */}
        <title>{seo.title}</title>
        <meta name="description" content={seo.description} />
        <link rel="canonical" href={seo.url} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta property="og:title" content={seo.title} />
        <meta property="og:description" content={seo.description} />
        <meta property="og:url" content={seo.url} />
        {logoUrl ? <meta property="og:image" content={logoUrl} /> : null}
        {logoUrl ? <meta property="og:image:alt" content={`${teamName} logo`} /> : null}
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={seo.title} />
        <meta name="twitter:description" content={seo.description} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
        {/* Google Fonts — the varsity/team-branding-style face used as a
            manually-made stand-in for a real wordmark image below, since
            most high schools here won't have one on file. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Anton&display=swap" rel="stylesheet" />
      </Helmet>

      <div style={{ maxWidth: "1600px", margin: "0 auto", padding: isMobile ? "10px 10px 60px" : "24px 40px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* ===== Body — same 3-column shape as TeamPage.js: left = the
            state's top programs (its Conference slot), center = hero, rank
            strip + tabbed content, right =
            News (its own sidebar there too, not a tab). The hero lives
            *inside* the center column (not spanning full width above the
            grid), so the sidebars run alongside it too, starting from the
            very top of the page — same as TeamPage.js's own layout, not a
            full-width header with sidebars only appearing below it. ===== */}
        {isMobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <HeroCard school={school} color1={color1} color2={color2} isMobile={isMobile} heroLogo={heroLogo} cityState={cityState} />
            <RankStrip stats={stats} state={school.State} color1={color1} isMobile={isMobile} loading={contentLoading} />
            <TopPicks archive={archive} color1={color1} color2={color2} isMobile={isMobile} loading={contentLoading} />
            <TabbedContent activeTab={activeTab} setActiveTab={setActiveTab} contentLoading={contentLoading} players={players} archive={archive} stats={stats} school={school} color1={color1} color2={color2} isMobile={isMobile} />
            <StateBoardSidebar board={stateBoard} school={school} sideC1={sideC1} />
            <NewsSidebar news={news} sideC1={sideC1} />
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "250px minmax(0, 1fr) 250px", gap: "20px", alignItems: "start" }}>
            <div style={{ position: "sticky", top: "20px" }}>
              <StateBoardSidebar board={stateBoard} school={school} sideC1={sideC1} />
            </div>
            <div>
              <HeroCard school={school} color1={color1} color2={color2} isMobile={isMobile} heroLogo={heroLogo} cityState={cityState} />
              <RankStrip stats={stats} state={school.State} color1={color1} isMobile={isMobile} loading={contentLoading} />
              <TopPicks archive={archive} color1={color1} color2={color2} isMobile={isMobile} loading={contentLoading} />
              <TabbedContent activeTab={activeTab} setActiveTab={setActiveTab} contentLoading={contentLoading} players={players} archive={archive} stats={stats} school={school} color1={color1} color2={color2} isMobile={isMobile} />
            </div>
            <div style={{ position: "sticky", top: "20px" }}>
              <NewsSidebar news={news} sideC1={sideC1} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ===== Hero — same visual recipe as TeamPage.js's own HeroCard, and
// (per that file's own layout) lives inside the center grid column
// alongside the sidebars, not spanning full width above them. =====
function HeroCard({ school, color1, color2, isMobile, heroLogo, cityState }) {
  return (
    <div style={{
      position: "relative", overflow: "hidden", borderRadius: "14px",
      border: `2px solid ${color2}`, marginBottom: isMobile ? 0 : "14px",
      boxShadow: "0 10px 28px rgba(0,0,0,0.22)",
      background: [
        "linear-gradient(rgba(0,0,0,0.38), rgba(0,0,0,0.38))",
        `linear-gradient(120deg, ${color1} 0%, ${color1} 40%, ${color2} 100%)`,
      ].join(", "),
      padding: isMobile ? "20px 16px" : "30px 32px",
    }}>
      <div aria-hidden="true" style={{
        position: "absolute", inset: "-20%", zIndex: 0, pointerEvents: "none",
        background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 2px, transparent 2px, transparent 40px)",
        animation: "wdHsHeroDrift 18s linear infinite",
      }} />
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
        background: "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.18), transparent 55%)",
        animation: "wdHsHeroSpotlight 5s ease-in-out infinite",
      }} />
      {/* Big faded background wordmark — same treatment TeamPage.js's hero
          gives a college team's real Wordmark image, every high school
          page gets *something* here even without one: a real image when a
          school has one on file, otherwise the school's own name rendered
          huge in the same Anton "manual wordmark" face used up front,
          faded the same way. */}
      {!isMobile && (
        (school.WordmarkDark || school.Wordmark) ? (
          <img
            src={sanitizeUrl(school.WordmarkDark || school.Wordmark)} alt="" aria-hidden="true"
            style={{
              position: "absolute", top: "50%", right: "-4%", transform: "translateY(-50%)",
              width: "65%", maxWidth: "620px", height: "auto", objectFit: "contain",
              opacity: 0.14, zIndex: 0, pointerEvents: "none",
            }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : (
          <div aria-hidden="true" style={{
            position: "absolute", top: "50%", right: "-3%", transform: "translateY(-50%)",
            fontFamily: "'Anton', 'Arial Black', Arial, sans-serif",
            fontSize: "clamp(70px, 11vw, 200px)", lineHeight: 0.9,
            color: "rgba(255,255,255,0.14)", textTransform: "uppercase",
            whiteSpace: "nowrap", zIndex: 0, pointerEvents: "none",
          }}>
            {school.Name}
          </div>
        )
      )}

      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: isMobile ? "16px" : "28px" }}>
        {heroLogo && <HeroLogo src={sanitizeUrl(heroLogo)} alt={`${school.Name}${school.Mascot ? ` ${school.Mascot}` : ""} logo`} glow={!school.LogoDark} size={isMobile ? 84 : 150} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* The page's <h1>: "Buford Wolves Football" — the name and mascot
              look as before; "Football" rides small after the mascot. */}
          <h1 style={{ margin: 0, fontWeight: 400 }}>
            <span style={{
              display: "block", fontFamily: "'Anton', 'Arial Black', Arial, sans-serif",
              fontSize: isMobile ? "clamp(22px, 7vw, 30px)" : "clamp(38px, 4.2vw, 56px)", color: "#fff",
              lineHeight: 1.05, letterSpacing: "0.02em",
              textTransform: "uppercase", wordBreak: "break-word", textShadow: "0 2px 8px rgba(0,0,0,0.4)",
            }}>
              {school.Name}
            </span>
            <span style={{
              display: "block", fontFamily: "'Anton', 'Arial Black', Arial, sans-serif",
              fontSize: isMobile ? "clamp(16px, 5vw, 22px)" : "clamp(24px, 3vw, 36px)",
              color: "rgba(255,255,255,0.88)", lineHeight: 1.05, letterSpacing: "0.02em",
              textTransform: "uppercase", wordBreak: "break-word", textShadow: "0 2px 8px rgba(0,0,0,0.4)",
            }}>
              {school.Mascot ? `${school.Mascot} ` : ""}
              <span style={{ fontSize: "0.5em", letterSpacing: "0.12em", color: "rgba(255,255,255,0.7)", verticalAlign: "middle" }}>Football</span>
            </span>
          </h1>
          {cityState && (
            <div style={{
              display: "inline-block", background: "rgba(0,0,0,0.3)", color: "rgba(255,255,255,0.85)",
              fontSize: "11px", fontWeight: 800, padding: "3px 10px", borderRadius: "20px",
              textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "8px",
            }}>
              🏫 High School in {cityState}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// The hero logo. A school with a dark-background logo (LogoDark) shows it
// as is; most only have their regular one, often dark-on-transparent, which
// would sink into the team color — so it sits on a soft white glow that
// breathes slowly, with a thin white edge on the art itself.
function HeroLogo({ src, alt, glow, size }) {
  return (
    <div style={{ position: "relative", flexShrink: 0, width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {glow && (
        <div aria-hidden="true" className="wd-hs-glow" style={{
          position: "absolute", inset: "-14%", borderRadius: "50%", pointerEvents: "none",
          background: "radial-gradient(circle, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.78) 34%, rgba(255,255,255,0.28) 56%, rgba(255,255,255,0) 70%)",
          animation: "wdHsLogoGlow 4.5s ease-in-out infinite",
        }} />
      )}
      <img
        src={src}
        alt={alt}
        style={{
          position: "relative", width: glow ? "84%" : "100%", height: glow ? "84%" : "100%", objectFit: "contain",
          filter: glow ? "drop-shadow(0 0 1px rgba(255,255,255,0.9)) drop-shadow(0 2px 6px rgba(0,0,0,0.18))" : "drop-shadow(0 4px 10px rgba(0,0,0,0.45))",
        }}
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
    </div>
  );
}

// Under the hero: players in college and drafted, each with its national
// and state rank.
function RankStrip({ stats, state, color1, isMobile, loading }) {
  if (loading || !stats) return null;
  const abbr = stateAbbr(state);
  const tiles = [
    { key: "cfb", label: "In College Football", note: "Current players" },
    { key: "nfl", label: "NFL Draft Picks", note: stats.draftFrom ? `Since ${stats.draftFrom}` : "" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: isMobile ? "10px" : "14px", marginBottom: isMobile ? 0 : "20px" }}>
      {tiles.map((t) => {
        const x = stats.stats?.[t.key]?.ALL || { v: 0 };
        return (
          <div key={t.key} style={{ background: "#fff", border: `1px solid ${SIDE_LINE}`, borderRadius: "14px", padding: isMobile ? "12px" : "14px 18px", display: "flex", alignItems: "center", gap: isMobile ? "10px" : "16px", minWidth: 0 }}>
            <div style={{ fontSize: isMobile ? "30px" : "40px", fontWeight: 900, color: color1, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{x.v}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: isMobile ? "11px" : "12px", fontWeight: 900, color: SIDE_INK, textTransform: "uppercase", letterSpacing: "0.08em" }}>{t.label}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: "4px", fontSize: isMobile ? "12px" : "13px", fontWeight: 800, color: "#5b6676" }}>
                {x.v ? (
                  <>
                    <span><b style={{ color: SIDE_INK }}>{rankText(x.n, x.nt)}</b> National</span>
                    <span><b style={{ color: SIDE_INK }}>{rankText(x.s, x.st)}</b> in {abbr}</span>
                  </>
                ) : <span>{t.note}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// The school's five highest NFL draft picks (lowest overall pick; `Pick`
// is the overall number in both historical and the latest class).
function TopPicks({ archive, color1, color2, isMobile, loading }) {
  const colleges = useSchools(archive.map((r) => r.School));
  const nfl = useNflTeams();
  if (loading) return null;
  const top = archive.filter((r) => Number(r.Pick) > 0)
    .sort((a, b) => Number(a.Pick) - Number(b.Pick) || Number(b.Year) - Number(a.Year)).slice(0, 5);
  if (!top.length) return null;
  return (
    <div style={{ marginBottom: isMobile ? 0 : "20px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "10px" }}>
        <span style={{ fontFamily: "'Anton', 'Arial Black', Arial, sans-serif", fontSize: isMobile ? "20px" : "24px", color: SIDE_INK, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          Highest Draft Picks
        </span>
        <span style={{ fontSize: "11px", fontWeight: 900, color: "#8a94a3", textTransform: "uppercase", letterSpacing: "0.1em" }}>Top {top.length}</span>
      </div>
      <div style={{
        display: isMobile ? "flex" : "grid", gridTemplateColumns: `repeat(${top.length}, minmax(0, 1fr))`, gap: isMobile ? "10px" : "12px",
        overflowX: isMobile ? "auto" : "visible", paddingBottom: isMobile ? "6px" : 0, scrollSnapType: isMobile ? "x mandatory" : undefined,
      }}>
        {top.map((r, i) => {
          const team = r.nflAbbr ? nfl.byAbbr[r.nflAbbr] : nfl.byName[r["NFL Team"]];
          const c = colleges[r.School];
          const name = r.Player || "—";
          const card = (
            <div className="wd-hs-pick" style={{
              position: "relative", overflow: "hidden", borderRadius: "14px", height: "100%", boxSizing: "border-box",
              padding: isMobile ? "14px 14px 12px" : "16px 16px 14px", color: "#fff",
              border: `2px solid ${i === 0 ? GOLD : color2}`, boxShadow: "0 8px 20px rgba(0,0,0,0.2)",
              background: `linear-gradient(rgba(0,0,0,${i === 0 ? 0.28 : 0.42}), rgba(0,0,0,0.55)), linear-gradient(150deg, ${color1} 0%, ${color1} 45%, ${color2} 100%)`,
              animation: `wdHsPickIn .45s ease-out ${i * 0.07}s both`,
            }}>
              {team?.LogoDark || team?.Logo1 ? (
                <img src={team.LogoDark || team.Logo1} alt="" aria-hidden="true" style={{ position: "absolute", right: "-18%", bottom: "-14%", width: "78%", opacity: 0.16, pointerEvents: "none" }} />
              ) : null}
              <div style={{ position: "relative", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "6px" }}>
                <div>
                  <div style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: i === 0 ? GOLD : "rgba(255,255,255,0.7)" }}>
                    {r.Year} Draft
                  </div>
                  {/* Round first ("R1"), the overall pick under it. */}
                  <div style={{ fontFamily: "'Anton', 'Arial Black', Arial, sans-serif", fontSize: isMobile ? "40px" : "46px", lineHeight: 1, textShadow: "0 3px 10px rgba(0,0,0,0.35)" }}>
                    {r.Round ? `R${r.Round}` : "—"}
                  </div>
                  <div style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)" }}>Pick {Number(r.Pick)}</div>
                </div>
                {team?.LogoDark || team?.Logo1 ? (
                  <img src={team.LogoDark || team.Logo1} alt={team.Team || ""} title={`${team.City || ""} ${team.Team || ""}`.trim()} style={{ width: isMobile ? "34px" : "38px", height: isMobile ? "34px" : "38px", objectFit: "contain", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.4))" }} />
                ) : null}
              </div>
              <div style={{ position: "relative", marginTop: "12px", fontSize: isMobile ? "15px" : "16px", fontWeight: 900, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "6px", marginTop: "6px", minWidth: 0 }}>
                {r.Position && <span style={{ flexShrink: 0, background: "rgba(255,255,255,0.18)", borderRadius: "4px", padding: "2px 6px", fontSize: "10px", fontWeight: 900 }}>{r.Position}</span>}
                {(c?.logoDark || c?.Logo1) && <img src={c.logoDark || c.Logo1} alt="" style={{ width: "16px", height: "16px", objectFit: "contain", flexShrink: 0 }} />}
                <span style={{ fontSize: "11px", fontWeight: 800, color: "rgba(255,255,255,0.8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.School}</span>
              </div>
            </div>
          );
          const wrap = { display: "block", textDecoration: "none", flex: isMobile ? "0 0 64%" : undefined, scrollSnapAlign: "start", minWidth: 0 };
          return r.Slug && !isUnreleasedSlug(r.Slug)
            ? <Link key={r.id} to={`/player/${r.Slug}`} style={wrap}>{card}</Link>
            : <div key={r.id} style={wrap}>{card}</div>;
        })}
      </div>
    </div>
  );
}

// Left column: the state's top programs by players in college — this school
// highlighted — with a link to the full leaderboards.
function StateBoardSidebar({ board, school, sideC1 }) {
  const abbr = stateAbbr(school.State);
  const rows = (board?.lists?.cfb?.ALL || []).slice(0, 10);
  const mine = (r) => r.id === school.id || (r.k === school.Name && r.st === abbr);
  const tint = `color-mix(in srgb, ${sideC1} 9%, #fff)`;
  return (
    <SidebarCard
      title={`Top ${abbr} Programs`}
      color1={sideC1}
      headerRight={<Link to={`/hs/rankings?scope=${abbr}`} style={sideHeaderLinkStyle}>All</Link>}
    >
      <div style={{ padding: "8px 14px 6px", fontSize: "10px", fontWeight: 900, color: "#7a8594", textTransform: "uppercase", letterSpacing: "0.1em", borderBottom: `1px solid ${SIDE_LINE_2}` }}>
        Most players in college football
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: "16px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "13px" }}>No rankings yet.</div>
      ) : rows.map((r, i) => {
        const inner = (
          <>
            <div style={{ flexShrink: 0, width: "26px", textAlign: "right", fontSize: "12px", fontWeight: 900, color: "#8a94a3", fontVariantNumeric: "tabular-nums" }}>{rankText(r.r, r.t)}</div>
            {r.logo
              ? <img src={r.logo} alt="" style={{ width: "22px", height: "22px", objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
              : <div style={{ width: "22px", height: "22px", flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0, fontSize: "13px", fontWeight: 800, color: SIDE_INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.k}</div>
            <div style={{ flexShrink: 0, fontSize: "13px", fontWeight: 900, color: sideC1, fontVariantNumeric: "tabular-nums" }}>{r.v}</div>
          </>
        );
        const style = {
          display: "flex", alignItems: "center", gap: "8px", padding: "8px 14px", textDecoration: "none",
          background: mine(r) ? tint : "#fff", borderBottom: i < rows.length - 1 ? `1px solid ${SIDE_LINE_2}` : "none",
        };
        return r.slug && !mine(r)
          ? <Link key={`${r.k}${i}`} to={hsPath(r.slug)} style={style}
              onMouseEnter={(e) => { e.currentTarget.style.background = SIDE_SOFT; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}>{inner}</Link>
          : <div key={`${r.k}${i}`} style={style}>{inner}</div>;
      })}
    </SidebarCard>
  );
}

// Clickable sidebar-header link — TeamPage.js's sideHeaderLinkStyle.
const sideHeaderLinkStyle = {
  color: "#fff", fontSize: "11px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap",
  textDecoration: "underline", textUnderlineOffset: "4px", textDecorationThickness: "2px", textDecorationColor: "rgba(255,255,255,0.55)",
};

function TabbedContent({ activeTab, setActiveTab, contentLoading, players, archive, stats, school, color1, color2, isMobile }) {
  const schoolName = school.Name;
  const counts = { players: players.length, archive: archive.length };
  return (
    <div>
      {/* Same pill tabs as TeamPage.js, counts and all. */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: isMobile ? "7px 18px" : "8px 24px", fontWeight: 900,
              fontSize: isMobile ? "13px" : "14px", textTransform: "uppercase", letterSpacing: "0.06em",
              border: `2px solid ${color2}`, borderRadius: "8px", cursor: "pointer",
              background: activeTab === t.key ? color1 : "#fff",
              color: activeTab === t.key ? "#fff" : color1,
            }}
          >
            {t.label}{contentLoading || counts[t.key] == null ? "" : ` (${counts[t.key]})`}
          </button>
        ))}
      </div>

      {contentLoading ? (
        <LoadingSpinner label="Loading" size={32} minHeight="200px" />
      ) : activeTab === "players" ? (
        <PlayersTab players={players} schoolName={schoolName} color1={color1} color2={color2} isMobile={isMobile} />
      ) : activeTab === "archive" ? (
        <ArchiveTab archive={archive} schoolName={schoolName} color1={color1} color2={color2} isMobile={isMobile} />
      ) : (
        <RankingsTab stats={stats} school={school} color1={color1} color2={color2} isMobile={isMobile} />
      )}
    </div>
  );
}

// The team-color card every list sits in — TeamPage.js's titled bar + stripe.
function ListCard({ title, color1, color2, isMobile, children }) {
  return (
    <div style={{ border: `2px solid ${color1}`, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
      <div style={{ background: color1, padding: "10px 16px" }}>
        <div style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? "13px" : "15px", letterSpacing: "0.08em", textTransform: "uppercase" }}>{title}</div>
      </div>
      <div style={{ height: "3px", background: color2 }} />
      {children}
    </div>
  );
}

function ColHead({ cols, color1 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 16px", background: `${color1}f0` }}>
      {cols.map(([label, style], i) => (
        <div key={i} style={{ fontSize: "10px", fontWeight: 900, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.06em", ...style }}>{label}</div>
      ))}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ padding: "40px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "14px" }}>{children}</div>;
}

// A college (or NFL team) with its logo; linked to its team page.
function TeamCell({ name, logo, to, color }) {
  const inner = (
    <>
      {logo ? <img src={logo} alt="" style={{ width: "22px", height: "22px", objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : <span style={{ width: "22px", flexShrink: 0 }} />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name || ""}</span>
    </>
  );
  const style = { display: "flex", alignItems: "center", gap: "8px", minWidth: 0, fontSize: "13px", fontWeight: 800, color: color || "#444", textDecoration: "none" };
  return to ? <Link to={to} style={style}>{inner}</Link> : <div style={style}>{inner}</div>;
}

const collegeSlug = (school) => String(school || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-");
const COL_D = { cls: "52px", pos: "52px", grade: "58px" };

// Everyone from the school in college now (CFBD + We-Draft). Only We-Draft
// players link (and carry a community grade).
function PlayersTab({ players, schoolName, color1, color2, isMobile }) {
  const colleges = useSchools(players.map((p) => p.college));
  if (players.length === 0) return <Empty>No college players from {schoolName} on file yet.</Empty>;
  const collegeW = isMobile ? "24px" : "200px";
  const COL = isMobile ? { cls: "38px", pos: "42px", grade: "46px" } : COL_D;
  return (
    <ListCard title={`${schoolName} in College (${players.length})`} color1={color1} color2={color2} isMobile={isMobile}>
      <ColHead color1={color1} cols={[
        ["Class", { width: COL.cls, flexShrink: 0, textAlign: "center" }], ["Pos", { width: COL.pos, flexShrink: 0, textAlign: "center" }],
        ["Player", { flex: 1 }], [isMobile ? "" : "College", { width: collegeW, flexShrink: 0 }], ["Grade", { width: COL.grade, flexShrink: 0, textAlign: "center" }],
      ]} />
      {players.map((p, i) => {
        const c = colleges[p.college];
        const row = (
          <>
            <div style={{ flexShrink: 0, width: COL.cls, textAlign: "center", fontSize: isMobile ? "13px" : "15px", fontWeight: 900, color: "#444" }}>{p.hsClass || "—"}</div>
            <div style={{ flexShrink: 0, width: COL.pos, textAlign: "center" }}>
              {p.pos ? <span style={{ display: "block", background: color1, color: "#fff", fontSize: isMobile ? "10px" : "11px", fontWeight: 900, padding: isMobile ? "3px 2px" : "4px 6px", borderRadius: "4px", textTransform: "uppercase" }}>{p.pos}</span> : <span style={{ color: "#ddd" }}>—</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0, fontWeight: 900, fontSize: isMobile ? "15px" : "18px", color: p.slug ? color1 : "#333", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {p.name}
            </div>
            <div style={{ flexShrink: 0, width: collegeW, minWidth: 0 }}>
              <TeamCell name={isMobile ? "" : p.college} logo={c?.Logo1} />
            </div>
            <div style={{ flexShrink: 0, width: COL.grade, display: "flex", justifyContent: "center" }}>{p.grade ? <GradeBadge grade={p.grade} /> : null}</div>
          </>
        );
        const style = { display: "flex", alignItems: "center", gap: isMobile ? "8px" : "10px", padding: isMobile ? "10px 8px" : "12px 16px", background: "#fff", textDecoration: "none", borderBottom: i < players.length - 1 ? "1px solid #f0f0f0" : "none" };
        return p.slug ? (
          <Link key={p.key} to={`/player/${p.slug}`} style={style}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
          >{row}</Link>
        ) : <div key={p.key} style={style}>{row}</div>;
      })}
    </ListCard>
  );
}

// Position by position: how many are in college and drafted, and where that
// ranks nationally and in the state.
function RankingsTab({ stats, school, color1, color2, isMobile }) {
  if (!stats) return <Empty>No rankings for {school.Name} yet.</Empty>;
  const abbr = stateAbbr(school.State);
  const rows = [["ALL", "All Positions"], ...POS_GROUPS];
  const cell = (x, key) => (x?.[key] ? rankText(x[key], x[key === "n" ? "nt" : "st"]) : "—");
  const numW = isMobile ? "34px" : "64px";
  const rankW = isMobile ? "42px" : "70px";
  const head = (label) => ({ fontSize: "10px", fontWeight: 900, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center" });
  return (
    <ListCard title={`${school.Name} Rankings`} color1={color1} color2={color2} isMobile={isMobile}>
      {/* Two groups of three columns: In College, NFL Draft. */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: isMobile ? "4px" : "8px", padding: isMobile ? "8px 8px 2px" : "10px 16px 2px", background: `${color1}f0` }}>
        <div style={{ flex: 1 }} />
        {[["In College", "cfb"], [`Drafted${stats.draftFrom ? ` (${stats.draftFrom}–)` : ""}`, "nfl"]].map(([label]) => (
          <div key={label} style={{ width: `calc(${numW} + ${rankW} * 2 + ${isMobile ? 8 : 16}px)`, textAlign: "center", fontSize: isMobile ? "10px" : "11px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "2px solid rgba(255,255,255,0.35)", paddingBottom: "4px" }}>{label}</div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "4px" : "8px", padding: isMobile ? "6px 8px" : "6px 16px 8px", background: `${color1}f0` }}>
        <div style={{ flex: 1, ...head(), textAlign: "left" }}>Position</div>
        {["cfb", "nfl"].map((m) => (
          <div key={m} style={{ display: "flex", gap: isMobile ? "4px" : "8px" }}>
            <div style={{ width: numW, ...head() }}>{isMobile ? "#" : "Players"}</div>
            <div style={{ width: rankW, ...head() }}>{isMobile ? "Nat" : "National"}</div>
            <div style={{ width: rankW, ...head() }}>{abbr}</div>
          </div>
        ))}
      </div>
      {rows.map(([g, label], i) => {
        const all = g === "ALL";
        return (
          <div key={g} style={{ display: "flex", alignItems: "center", gap: isMobile ? "4px" : "8px", padding: isMobile ? "10px 8px" : "11px 16px", background: all ? `color-mix(in srgb, ${color1} 6%, #fff)` : "#fff", borderBottom: i < rows.length - 1 ? "1px solid #f0f0f0" : "none" }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "8px" }}>
              {!all && <span style={{ flexShrink: 0, background: color1, color: "#fff", fontSize: "11px", fontWeight: 900, padding: "3px 0", width: "34px", textAlign: "center", borderRadius: "4px" }}>{g}</span>}
              <span style={{ fontSize: isMobile ? "12px" : "14px", fontWeight: 900, color: SIDE_INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textTransform: all ? "uppercase" : "none", letterSpacing: all ? "0.04em" : 0 }}>
                {isMobile ? (all ? "All" : "") : label}
              </span>
            </div>
            {["cfb", "nfl"].map((m) => {
              const x = stats.stats?.[m]?.[g];
              return (
                <div key={m} style={{ display: "flex", gap: isMobile ? "4px" : "8px", fontVariantNumeric: "tabular-nums" }}>
                  <div style={{ width: numW, textAlign: "center", fontSize: isMobile ? "14px" : "16px", fontWeight: 900, color: x?.v ? color1 : "#c3cad4" }}>{x?.v || 0}</div>
                  <div style={{ width: rankW, textAlign: "center", fontSize: isMobile ? "12px" : "14px", fontWeight: 900, color: x?.n ? SIDE_INK : "#c3cad4" }}>{cell(x, "n")}</div>
                  <div style={{ width: rankW, textAlign: "center", fontSize: isMobile ? "12px" : "14px", fontWeight: 900, color: x?.s ? SIDE_INK : "#c3cad4" }}>{cell(x, "s")}</div>
                </div>
              );
            })}
          </div>
        );
      })}
      <div style={{ padding: "10px 16px", borderTop: `1px solid ${SIDE_LINE_2}`, background: SIDE_SOFT, display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", fontSize: "12px", fontWeight: 700, color: "#7a8594" }}>
        <span>Ranked among {Number(stats.totals?.nat || 0).toLocaleString()} high schools nationally, {Number(stats.totals?.state || 0).toLocaleString()} in {abbr}.</span>
        <Link to={`/hs/rankings?scope=${abbr}`} style={{ color: color1, fontWeight: 900, textDecoration: "none" }}>Full rankings →</Link>
      </div>
    </ListCard>
  );
}

// NFL teams, for the Archive's logos: by abbreviation and by full name
// ("Detroit Lions" — how `historical` stores them).
function useNflTeams() {
  const [teams, setTeams] = useState({ byAbbr: {}, byName: {} });
  useEffect(() => {
    let cancelled = false;
    getDocs(collection(db, "nfl")).then((snap) => {
      const byAbbr = {}; const byName = {};
      snap.docs.forEach((d) => { const t = { abbr: d.id, ...d.data() }; byAbbr[d.id] = t; byName[`${t.City || ""} ${t.Team || ""}`.trim()] = t; });
      if (!cancelled) setTeams({ byAbbr, byName });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return teams;
}

// Alumni drafted into the NFL: year, round and pick, college, NFL team.
// Only this year's class (still We-Draft players) links to a player page.
function ArchiveTab({ archive, schoolName, color1, color2, isMobile }) {
  const colleges = useSchools(archive.map((r) => r.School));
  const nfl = useNflTeams();
  if (archive.length === 0) return <Empty>No draft history on file for {schoolName} yet.</Empty>;
  const w = isMobile ? { yr: "40px", pick: "58px", team: "28px" } : { yr: "52px", pick: "110px", team: "190px" };
  return (
    <ListCard title={`${schoolName} in the NFL Draft (${archive.length})`} color1={color1} color2={color2} isMobile={isMobile}>
      <ColHead color1={color1} cols={[
        ["Year", { width: w.yr, flexShrink: 0, textAlign: "center" }], ["Pick", { width: w.pick, flexShrink: 0 }],
        ["Player", { flex: 1 }], [isMobile ? "" : "College", { width: w.team, flexShrink: 0 }], [isMobile ? "" : "NFL Team", { width: w.team, flexShrink: 0 }],
      ]} />
      {archive.map((r, i) => {
        const team = r.nflAbbr ? nfl.byAbbr[r.nflAbbr] : nfl.byName[r["NFL Team"]];
        const teamName = team ? `${team.City} ${team.Team}` : r["NFL Team"] || r.nflAbbr;
        const c = colleges[r.School];
        const name = r.Player || [r.First, r.Last].filter(Boolean).join(" ") || "—";
        const pick = r.Round ? (isMobile ? `R${r.Round} · ${r.Pick}` : `Rd ${r.Round} · Pick ${r.Pick}`) : "—";
        return (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: isMobile ? "10px 12px" : "12px 16px", borderBottom: i < archive.length - 1 ? "1px solid #f0f0f0" : "none" }}>
            <div style={{ flexShrink: 0, width: w.yr, textAlign: "center", fontSize: "15px", fontWeight: 900, color: "#444" }}>{r.Year || "—"}</div>
            <div style={{ flexShrink: 0, width: w.pick, fontSize: "12px", fontWeight: 900, color: "#666", whiteSpace: "nowrap" }}>{pick}</div>
            <div style={{ flex: 1, minWidth: 0, fontWeight: 900, fontSize: isMobile ? "15px" : "17px", color: r.Slug ? color1 : "#333", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {r.Slug ? <Link to={`/player/${r.Slug}`} style={{ color: "inherit", textDecoration: "none" }}>{name}</Link> : name}
              {r.Position ? <span style={{ marginLeft: "8px", fontSize: "11px", fontWeight: 900, color: "#999" }}>{r.Position}</span> : null}
            </div>
            <div style={{ flexShrink: 0, width: w.team, minWidth: 0 }}>
              <TeamCell name={isMobile ? "" : r.School} logo={c?.Logo1} to={c ? `/team/${c.Slug || collegeSlug(r.School)}` : null} />
            </div>
            <div style={{ flexShrink: 0, width: w.team, minWidth: 0 }}>
              <TeamCell name={isMobile ? "" : teamName} logo={team?.Logo1} to={team ? `/nfl/${team.abbr.toLowerCase()}` : null} />
            </div>
          </div>
        );
      })}
    </ListCard>
  );
}

// In The News — the college team page's sidebar (TeamPage.js NewsSidebar):
// a date tile in the team color and the headline, three at a time up to
// NEWS_LIMIT.
function NewsSidebar({ news, sideC1 = BLUE }) {
  const [visibleCount, setVisibleCount] = useState(3);
  const shown = news.slice(0, Math.min(news.length, NEWS_LIMIT));
  const tint = `color-mix(in srgb, ${sideC1} 7%, #fff)`;
  return (
    <SidebarCard title="In The News" color1={sideC1}>
      {shown.length === 0 ? (
        <div style={{ padding: "16px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "13px" }}>No recent news.</div>
      ) : (
        <>
          {shown.slice(0, visibleCount).map((n, i, arr) => {
            const d = n.publishedAt?.toDate?.();
            return (
              <Link
                key={n.id}
                to={`/news/${n.slug}`}
                style={{
                  display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", textDecoration: "none", background: "#fff",
                  borderBottom: i < arr.length - 1 ? `1px solid ${SIDE_LINE_2}` : "none", transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = tint; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
              >
                <div style={{ flexShrink: 0, width: 38, border: `1px solid ${SIDE_LINE}`, borderRadius: "8px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                  <div style={{ background: sideC1, padding: "2px 0", textAlign: "center", fontSize: "10px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    {d ? d.toLocaleDateString(undefined, { month: "short" }) : "—"}
                  </div>
                  <div style={{ padding: "2px 0", background: "#fff", textAlign: "center", fontSize: "15px", fontWeight: 900, color: SIDE_INK, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
                    {d ? d.toLocaleDateString(undefined, { day: "numeric" }) : "—"}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: "14px", color: SIDE_INK, lineHeight: 1.35 }}>{n.titleShort || n.title}</div>
              </Link>
            );
          })}
          {visibleCount < shown.length && (
            <button
              onClick={() => setVisibleCount((c) => c + 3)}
              style={{
                display: "block", width: "100%", padding: "10px 14px", background: SIDE_SOFT, color: sideC1,
                border: "none", borderTop: `1px solid ${SIDE_LINE_2}`, cursor: "pointer",
                fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.1em",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = tint; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = SIDE_SOFT; }}
            >
              Show More News ▾
            </button>
          )}
        </>
      )}
    </SidebarCard>
  );
}
