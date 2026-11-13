// src/pages/HighSchoolTeamPage.js
//
// A high school's own team page — built to look like TeamPage.js (college
// team pages) from a branding standpoint, but far simpler: just Prospects/
// Archive/News tabs and a Top 25 sidebar instead of Conference/Schedule/
// full roster machinery. Deliberately in development and unlisted — see
// the noindex Helmet below — reachable only via a direct URL (this page's
// own route, or the "View Page ↗" link in AdminPanel.js's Branding > High
// School > Schools panel), never linked from anywhere else on the site yet.
//
// Only ever renders real content for a school with Ranking === 3 — 1 and 2
// are "not built yet" tiers an admin can bump a school into as pages get
// made. Everything else (unranked/2/1, or a slug matching no Ranking-3
// school) shows the same "not available" state rather than a real 404,
// since none of this is meant to be discoverable yet either way.
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { averageGradesFor, gradeLabel } from "../utils/communityGrades";
import { Helmet } from "react-helmet-async";
import LoadingSpinner from "../components/LoadingSpinner";
import { useMobileStuckPageWatchdog } from "../hooks/useMobileStuckPageWatchdog";
import { useCurrentRankMap } from "../utils/rankings";
import { useSchools } from "../components/DraftArchiveList";
import { currentDraftClass } from "../utils/eligibility";

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

// ── Shared sidebar card shell — same shape as TeamPage.js's own
// SidebarCard. ──
function SidebarCard({ title, color1, color2, children }) {
  return (
    <div style={{ border: `2px solid ${color1}`, borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ backgroundColor: color1, padding: "10px 14px" }}>
        <div style={{ color: "#fff", fontWeight: 900, fontSize: "14px", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {title}
        </div>
      </div>
      <div style={{ height: "4px", backgroundColor: color2 }} />
      <div style={{ background: "#fff" }}>{children}</div>
    </div>
  );
}

// News isn't a tab — it's its own right-column sidebar (NewsSidebar below),
// same as TeamPage.js's own layout.
// Players: every current college player from the school (CFBD rosters,
// hsAlumni — server/highSchools/alumniIndex.js) plus any We-Draft player not
// on one; only We-Draft players link. Archive: alumni drafted into the NFL.
const TABS = [
  { key: "players", label: "Players" },
  { key: "archive", label: "Archive" },
];

export default function HighSchoolTeamPage() {
  const { slug } = useParams();
  const [school, setSchool] = useState(null); // null = loading, false = not available
  const [players, setPlayers] = useState([]);
  const [archive, setArchive] = useState([]);
  const [news, setNews] = useState([]);
  const [contentLoading, setContentLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("players");
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  // Mobile "stuck loading forever" watchdog — see the hook's own comment.
  // school === null is specifically "still loading" here (false is a
  // resolved "not available," not stuck).
  useMobileStuckPageWatchdog(school === null, slug, { enabled: isMobile });
  const currentRankMap = useCurrentRankMap();
  const [top25Schools, setTop25Schools] = useState([]); // sorted [{Rank, School, Logo1, Slug}]

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Find the Ranking-3 school whose computed slug matches the URL — only
  // ever fetches Ranking-3 docs, so an admin bumping a school back down to
  // 1/2 makes its page stop resolving immediately, no separate unpublish
  // step needed.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const snap = await getDocs(query(collection(db, "highSchools"), where("Ranking", "==", 3)));
        const match = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .find((h) => toHsSlug(h.Name, h.State) === slug);
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
        const [allPlayersSnap, historicalSnap, alumniSnap] = await Promise.all([
          getDocs(query(collection(db, "players"), where("HighSchool", "==", school.Name))),
          getDocs(query(collection(db, "historical"), where("HighSchool", "==", school.Name))),
          getDoc(doc(db, "hsAlumni", school.id)).catch(() => null),
        ]);
        const allAlumni = allPlayersSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(sameState);
        if (cancelled) return;

        // Everyone in college now: CFBD's rows (a We-Draft link when there
        // is one), then We-Draft players still in school that CFBD lacks.
        const byId = Object.fromEntries(allAlumni.map((p) => [p.id, p]));
        const cfbd = alumniSnap?.data()?.players || [];
        const C = Number(currentDraftClass());
        const rows = cfbd.map((r) => {
          const wd = r.id ? byId[r.id] : null;
          return { key: `c${r.c}`, name: r.n, pos: wd?.Position || r.pos, college: wd?.School || r.s, hsClass: r.rc || Number(wd?.RecruitYear) || null, stars: r.st, id: wd?.id || null, slug: wd?.Slug || r.slug || null };
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

        // Archive = the older historical collection PLUS the just-completed
        // 2026 class — same two-source combo TeamPage.js's own Archive tab
        // pulls from (historicalPlayers + archivePlayers there). 2026
        // hasn't been migrated into `historical` yet, so it still lives in
        // `players` and needs its own Round/Pick/NFL Team cross-referenced
        // from draftOrder (Selection == Slug) — a 2026 alum with no
        // draftOrder entry wasn't actually drafted, so it's left out here
        // the same way TeamPage.js's own archivePlayers query filters it.
        const archived2026 = allAlumni.filter((p) => p.Eligible === "2026");
        const draftOrderSnap = await getDocs(collection(db, "draftOrder"));
        const draftBySlug = {};
        draftOrderSnap.forEach((d) => {
          const data = d.data();
          if (data.Selection) draftBySlug[data.Selection] = { Team: data.Team, Round: data.Round, Pick: data.Pick };
        });
        const archived2026Rows = archived2026
          .filter((p) => draftBySlug[p.Slug])
          .map((p) => ({
            id: p.id, Year: "2026", Slug: p.Slug,
            Round: draftBySlug[p.Slug].Round, Pick: draftBySlug[p.Slug].Pick, PickInRound: true,
            Player: `${p.First || ""} ${p.Last || ""}`.trim(), School: p.School,
            nflAbbr: draftBySlug[p.Slug].Team,
          }));

        const historicalRows = historicalSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(sameState);
        const combinedArchive = [...archived2026Rows, ...historicalRows]
          .sort((a, b) => (Number(b.Year) || 0) - (Number(a.Year) || 0) || (Number(a.Round) || 99) - (Number(b.Round) || 99) || (Number(a.Pick) || 9999) - (Number(b.Pick) || 9999));
        setArchive(combinedArchive);

        // "All alumni" — every player (any Eligible year, not just active
        // prospects) who came through this high school — is the pool the
        // News feed is built from.
        const alumniIds = allAlumni.map((p) => p.id).filter(Boolean);
        const alumniSlugs = allAlumni.map((p) => p.Slug).filter(Boolean);
        const chunk = (arr) => { const out = []; for (let i = 0; i < arr.length; i += 10) out.push(arr.slice(i, i + 10)); return out; };
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
        if (!cancelled) { setPlayers([]); setArchive([]); setNews([]); }
      } finally {
        if (!cancelled) setContentLoading(false);
      }
    };
    loadContent();
    return () => { cancelled = true; };
  }, [school]);

  // Top 25 sidebar — the current published poll, resolved to real school
  // docs for logos/slugs. Only fetched once currentRankMap actually has
  // entries, so this doesn't run against an empty {} on first render.
  useEffect(() => {
    const entries = Object.entries(currentRankMap || {});
    if (entries.length === 0) { setTop25Schools([]); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const snap = await getDocs(collection(db, "schools"));
        const byName = {};
        snap.docs.forEach((d) => { const data = d.data(); if (data.School) byName[data.School] = data; });
        if (cancelled) return;
        const list = entries
          .map(([School, Rank]) => ({ School, Rank, Logo1: byName[School]?.Logo1 || "", Slug: byName[School]?.Slug || "" }))
          .sort((a, b) => a.Rank - b.Rank)
          .slice(0, 25);
        setTop25Schools(list);
      } catch (e) {
        console.error("High school team page Top 25 error:", e);
        if (!cancelled) setTop25Schools([]);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [currentRankMap]);

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
  const cityState = [school.City, school.State ? (STATE_ABBR[school.State] || school.State) : ""].filter(Boolean).join(", ");

  return (
    <>
      <style>{HERO_STYLE}</style>
      <Helmet>
        <title>{school.Name} | We-Draft.com</title>
        {/* In development and deliberately unlisted — see this file's own
            top comment. */}
        <meta name="robots" content="noindex, nofollow" />
        {/* Google Fonts — the varsity/team-branding-style face used as a
            manually-made stand-in for a real wordmark image below, since
            most high schools here won't have one on file. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Anton&display=swap" rel="stylesheet" />
      </Helmet>

      <div style={{ maxWidth: "1600px", margin: "0 auto", padding: isMobile ? "10px 10px 60px" : "24px 40px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* ===== Body — same 3-column shape as TeamPage.js: left = Top 25
            (its Conference slot), center = hero + tabbed content, right =
            News (its own sidebar there too, not a tab). The hero lives
            *inside* the center column (not spanning full width above the
            grid), so the sidebars run alongside it too, starting from the
            very top of the page — same as TeamPage.js's own layout, not a
            full-width header with sidebars only appearing below it. ===== */}
        {isMobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <HeroCard school={school} color1={color1} color2={color2} isMobile={isMobile} heroLogo={heroLogo} cityState={cityState} />
            <TabbedContent activeTab={activeTab} setActiveTab={setActiveTab} contentLoading={contentLoading} players={players} archive={archive} schoolName={school.Name} color1={color1} color2={color2} isMobile={isMobile} />
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 900, fontSize: "13px", color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>
                🏆 Current Top 25
              </summary>
              <Top25Sidebar schools={top25Schools} color1={color1} color2={color2} />
            </details>
            <NewsSidebar news={news} color1={color1} color2={color2} />
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "240px minmax(0, 1fr) 240px", gap: "20px", alignItems: "start" }}>
            <div style={{ position: "sticky", top: "20px" }}>
              <Top25Sidebar schools={top25Schools} color1={color1} color2={color2} />
            </div>
            <div>
              <HeroCard school={school} color1={color1} color2={color2} isMobile={isMobile} heroLogo={heroLogo} cityState={cityState} />
              <TabbedContent activeTab={activeTab} setActiveTab={setActiveTab} contentLoading={contentLoading} players={players} archive={archive} schoolName={school.Name} color1={color1} color2={color2} isMobile={isMobile} />
            </div>
            <div style={{ position: "sticky", top: "20px" }}>
              <NewsSidebar news={news} color1={color1} color2={color2} />
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
      border: `2px solid ${color2}`, marginBottom: "20px",
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
        {heroLogo && (
          <img
            src={sanitizeUrl(heroLogo)}
            alt={school.Name}
            style={{ flexShrink: 0, width: isMobile ? "84px" : "150px", height: isMobile ? "84px" : "150px", objectFit: "contain", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.45))" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "'Anton', 'Arial Black', Arial, sans-serif",
            fontSize: isMobile ? "clamp(22px, 7vw, 30px)" : "clamp(38px, 4.2vw, 56px)", color: "#fff",
            lineHeight: 1.05, letterSpacing: "0.02em",
            textTransform: "uppercase", wordBreak: "break-word", textShadow: "0 2px 8px rgba(0,0,0,0.4)",
          }}>
            {school.Name}
          </div>
          {school.Mascot && (
            <div style={{
              fontFamily: "'Anton', 'Arial Black', Arial, sans-serif",
              fontSize: isMobile ? "clamp(16px, 5vw, 22px)" : "clamp(24px, 3vw, 36px)",
              color: "rgba(255,255,255,0.88)", lineHeight: 1.05, letterSpacing: "0.02em",
              textTransform: "uppercase", wordBreak: "break-word", textShadow: "0 2px 8px rgba(0,0,0,0.4)",
            }}>
              {school.Mascot}
            </div>
          )}
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

function Top25Sidebar({ schools, color1, color2 }) {
  return (
    <SidebarCard title="🏆 Current Top 25" color1={color1} color2={color2}>
      {schools.length === 0 ? (
        <div style={{ padding: "16px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "12px" }}>No poll published yet.</div>
      ) : (
        schools.map((s, i) => (
          <Link
            key={s.School}
            to={s.Slug ? `/team/${s.Slug}` : "#"}
            style={{
              display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px",
              textDecoration: "none", borderBottom: i < schools.length - 1 ? "1px solid #f0f0f0" : "none",
              pointerEvents: s.Slug ? "auto" : "none",
            }}
          >
            <div style={{ flexShrink: 0, width: "20px", textAlign: "right", fontSize: "12px", fontWeight: 900, color: "#aaa" }}>{s.Rank}</div>
            {s.Logo1 ? (
              <img src={s.Logo1} alt="" style={{ width: "22px", height: "22px", objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
            ) : (
              <div style={{ width: "22px", height: "22px", flexShrink: 0 }} />
            )}
            <div style={{ fontSize: "12px", fontWeight: 800, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.School}</div>
          </Link>
        ))
      )}
    </SidebarCard>
  );
}

function TabbedContent({ activeTab, setActiveTab, contentLoading, players, archive, schoolName, color1, color2, isMobile }) {
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
            {t.label}{contentLoading ? "" : ` (${counts[t.key]})`}
          </button>
        ))}
      </div>

      {contentLoading ? (
        <LoadingSpinner label="Loading" size={32} minHeight="200px" />
      ) : activeTab === "players" ? (
        <PlayersTab players={players} schoolName={schoolName} color1={color1} color2={color2} isMobile={isMobile} />
      ) : (
        <ArchiveTab archive={archive} schoolName={schoolName} color1={color1} color2={color2} isMobile={isMobile} />
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
      {cols.map(([label, style]) => (
        <div key={label} style={{ fontSize: "10px", fontWeight: 900, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.06em", ...style }}>{label}</div>
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

// Same "In The News" sidebar format as TeamPage.js's own NewsSidebar — a
// small date chip (month/day) per row instead of a thumbnail, capped at
// NEWS_LIMIT with a "Show More" button, hardcoded site blue/gold rather
// than the school's own colors (matching TeamPage.js's own choice there).
function NewsSidebar({ news, color1 = BLUE, color2 = GOLD }) {
  const [visibleCount, setVisibleCount] = useState(3);
  const shown = news.slice(0, Math.min(news.length, NEWS_LIMIT));
  return (
    <SidebarCard title="In The News" color1={color1} color2={color2}>
      {shown.length === 0 ? (
        <div style={{ padding: "16px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "12px" }}>No recent news.</div>
      ) : (
        <>
          {shown.slice(0, visibleCount).map((n, i, arr) => {
            const d = n.publishedAt?.toDate?.();
            return (
              <Link
                key={n.id}
                to={`/news/${n.slug}`}
                style={{
                  display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", textDecoration: "none",
                  borderBottom: i < arr.length - 1 ? "1px solid #f0f0f0" : "none",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#f7f9fc"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
              >
                <div style={{ flexShrink: 0, width: "36px", borderRadius: "4px", border: `2px solid ${BLUE}`, overflow: "hidden", textAlign: "center" }}>
                  <div style={{ background: GOLD, color: "#fff", fontSize: "8px", fontWeight: 900, padding: "1px 0" }}>
                    {d ? d.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" }) : "—"}
                  </div>
                  <div style={{ background: "#fff", color: BLUE, fontSize: "15px", fontWeight: 900, padding: "1px 0" }}>
                    {d ? d.toLocaleDateString(undefined, { day: "numeric", timeZone: "UTC" }) : "—"}
                  </div>
                </div>
                <div style={{ fontWeight: 900, fontSize: "12px", color: "#222" }}>{n.titleShort || n.title}</div>
              </Link>
            );
          })}
          {visibleCount < shown.length && (
            <button
              onClick={() => setVisibleCount((c) => c + 3)}
              style={{ display: "block", width: "100%", padding: "10px 14px", background: BLUE, color: GOLD, border: "none", cursor: "pointer", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.1em" }}
            >
              Show More News ▾
            </button>
          )}
        </>
      )}
    </SidebarCard>
  );
}
