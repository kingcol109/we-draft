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
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { Helmet } from "react-helmet-async";
import LoadingSpinner from "../components/LoadingSpinner";
import { useCurrentRankMap } from "../utils/rankings";

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

const ACTIVE_YEARS = ["2027", "2028", "2029"];
const NEWS_LIMIT = 8;

// Same grade scale/labels/display map TeamPage.js's own Prospects list
// uses — duplicated here per this codebase's per-file convention.
const gradeScale = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3,
  "Second Round": 4, "Third Round": 5, "Fourth Round": 6,
  "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, UDFA: 10,
};
const gradeLabels = {
  1: "Early First Round", 2: "Middle First Round", 3: "Late First Round",
  4: "Second Round", 5: "Third Round", 6: "Fourth Round",
  7: "Fifth Round", 8: "Sixth Round", 9: "Seventh Round", 10: "UDFA",
};
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
const TABS = [
  { key: "prospects", label: "Prospects" },
  { key: "archive", label: "Archive" },
];

export default function HighSchoolTeamPage() {
  const { slug } = useParams();
  const [school, setSchool] = useState(null); // null = loading, false = not available
  const [prospects, setProspects] = useState([]);
  const [archive, setArchive] = useState([]);
  const [news, setNews] = useState([]);
  const [contentLoading, setContentLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("prospects");
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
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

  // Prospects (players still 2027-2029 eligible), Archive (historical
  // picks), and the alumni pool the News feed is built from — all keyed by
  // this school's exact Name, same denormalized-string matching every
  // other HighSchool reference in the app uses.
  useEffect(() => {
    if (!school) { setContentLoading(false); return; }
    let cancelled = false;
    const loadContent = async () => {
      setContentLoading(true);
      try {
        const [allPlayersSnap, historicalSnap] = await Promise.all([
          getDocs(query(collection(db, "players"), where("HighSchool", "==", school.Name))),
          getDocs(query(collection(db, "historical"), where("HighSchool", "==", school.Name))),
        ]);
        const allAlumni = allPlayersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (cancelled) return;

        const activeProspects = allAlumni
          .filter((p) => ACTIVE_YEARS.includes(p.Eligible))
          .sort((a, b) => (a.Eligible || "").localeCompare(b.Eligible || "") || (a.Last || "").localeCompare(b.Last || ""));

        // Community grade per prospect — same average-and-round-to-nearest-
        // label math as TeamPage.js's own Prospects list.
        const evalSnaps = await Promise.all(
          activeProspects.map((p) => getDocs(collection(db, "players", p.id, "evaluations")))
        );
        activeProspects.forEach((p, i) => {
          const grades = [];
          evalSnaps[i].forEach((d) => {
            const g = d.data().grade;
            if (g && gradeScale[g]) grades.push(gradeScale[g]);
          });
          p.commGrade = grades.length > 0 ? gradeLabels[Math.round(grades.reduce((a, b) => a + b, 0) / grades.length)] : null;
        });
        if (cancelled) return;
        setProspects(activeProspects);

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
            Round: draftBySlug[p.Slug].Round, Pick: draftBySlug[p.Slug].Pick,
            Player: `${p.First || ""} ${p.Last || ""}`.trim(), School: p.School,
            "NFL Team": draftBySlug[p.Slug].Team,
          }));

        const historicalRows = historicalSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const combinedArchive = [...archived2026Rows, ...historicalRows]
          .sort((a, b) => (Number(b.Year) || 0) - (Number(a.Year) || 0) || (Number(a.Pick) || 9999) - (Number(b.Pick) || 9999));
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
        if (!cancelled) { setProspects([]); setArchive([]); setNews([]); }
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
    return <LoadingSpinner label="Loading" size={56} minHeight="60vh" />;
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
            <TabbedContent activeTab={activeTab} setActiveTab={setActiveTab} contentLoading={contentLoading} prospects={prospects} archive={archive} color1={color1} color2={color2} />
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 900, fontSize: "13px", color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>
                🏆 Current Top 25
              </summary>
              <Top25Sidebar schools={top25Schools} />
            </details>
            <NewsSidebar news={news} />
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "240px minmax(0, 1fr) 240px", gap: "20px", alignItems: "start" }}>
            <div style={{ position: "sticky", top: "20px" }}>
              <Top25Sidebar schools={top25Schools} />
            </div>
            <div>
              <HeroCard school={school} color1={color1} color2={color2} isMobile={isMobile} heroLogo={heroLogo} cityState={cityState} />
              <TabbedContent activeTab={activeTab} setActiveTab={setActiveTab} contentLoading={contentLoading} prospects={prospects} archive={archive} color1={color1} color2={color2} />
            </div>
            <div style={{ position: "sticky", top: "20px" }}>
              <NewsSidebar news={news} />
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

function Top25Sidebar({ schools }) {
  return (
    <SidebarCard title="🏆 Current Top 25" color1={BLUE} color2={GOLD}>
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

function TabbedContent({ activeTab, setActiveTab, contentLoading, prospects, archive, color1, color2 }) {
  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", borderBottom: "2px solid #eee" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: "10px 18px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em",
              background: "none", border: "none", cursor: "pointer",
              color: activeTab === t.key ? color1 : "#999",
              borderBottom: activeTab === t.key ? `3px solid ${color2}` : "3px solid transparent",
              marginBottom: "-2px",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {contentLoading ? (
        <LoadingSpinner label="Loading" size={32} minHeight="200px" />
      ) : activeTab === "prospects" ? (
        <ProspectsTab prospects={prospects} color1={color1} color2={color2} />
      ) : (
        <ArchiveTab archive={archive} />
      )}
    </div>
  );
}

// Same row-list format as TeamPage.js's own Prospects tab (PlayerRow) —
// class year, position badge, name, community grade badge — instead of a
// card grid, plus the same sticky column header above the rows.
const HS_COL = { year: "52px", pos: "52px", grade: "58px" };

function ProspectsTab({ prospects, color1, color2 }) {
  if (prospects.length === 0) {
    return <div style={{ padding: "40px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "14px" }}>No current 2027–2029 prospects on file yet.</div>;
  }
  return (
    <div style={{ border: `2px solid ${color1}`, borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 18px", background: `${color1}f5` }}>
        <div style={{ flexShrink: 0, width: HS_COL.year, fontSize: "10px", fontWeight: 900, color: "rgba(255,255,255,0.8)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center" }}>Class</div>
        <div style={{ flexShrink: 0, width: HS_COL.pos, fontSize: "10px", fontWeight: 900, color: "rgba(255,255,255,0.8)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center" }}>Pos</div>
        <div style={{ flex: 1, fontSize: "10px", fontWeight: 900, color: "rgba(255,255,255,0.8)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Player</div>
        <div style={{ flexShrink: 0, width: HS_COL.grade, fontSize: "10px", fontWeight: 900, color: "rgba(255,255,255,0.8)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center" }}>Grade</div>
      </div>
      <div style={{ height: "3px", background: color2 }} />
      {prospects.map((p, i) => (
        <Link
          key={p.id}
          to={p.Slug ? `/player/${p.Slug}` : "#"}
          style={{
            display: "flex", alignItems: "center", gap: "10px", padding: "12px 18px", textDecoration: "none",
            background: "#fff", borderBottom: i < prospects.length - 1 ? "1px solid #f0f0f0" : "none",
            pointerEvents: p.Slug ? "auto" : "none",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
        >
          <div style={{ flexShrink: 0, width: HS_COL.year, textAlign: "center", fontSize: "15px", fontWeight: 900, color: "#444" }}>
            {p.Eligible || "—"}
          </div>
          <div style={{ flexShrink: 0, width: HS_COL.pos, textAlign: "center" }}>
            {p.Position ? (
              <span style={{ display: "block", background: color1, color: "#fff", fontSize: "11px", fontWeight: 900, padding: "4px 6px", borderRadius: "4px", textTransform: "uppercase" }}>
                {p.Position}
              </span>
            ) : <span style={{ color: "#ddd", fontSize: "12px" }}>—</span>}
          </div>
          <div style={{ flex: 1, minWidth: 0, fontWeight: 900, fontSize: "18px", color: color1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {p.First} {p.Last}
          </div>
          <div style={{ flexShrink: 0, width: HS_COL.grade, display: "flex", justifyContent: "center" }}>
            {p.commGrade ? <GradeBadge grade={p.commGrade} /> : null}
          </div>
        </Link>
      ))}
    </div>
  );
}

function ArchiveTab({ archive }) {
  if (archive.length === 0) {
    return <div style={{ padding: "40px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "14px" }}>No draft history on file for this school yet.</div>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#999", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            <th style={{ padding: "8px" }}>Year</th>
            <th style={{ padding: "8px" }}>Rd / Pick</th>
            <th style={{ padding: "8px" }}>Player</th>
            <th style={{ padding: "8px" }}>College</th>
            <th style={{ padding: "8px" }}>NFL Team</th>
          </tr>
        </thead>
        <tbody>
          {archive.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid #f0f0f0" }}>
              <td style={{ padding: "8px", fontWeight: 900 }}>{r.Year || "—"}</td>
              <td style={{ padding: "8px", color: "#888" }}>{[r.Round, r.Pick].filter(Boolean).join(" / ") || "—"}</td>
              <td style={{ padding: "8px", fontWeight: 800 }}>
                {r.Slug ? (
                  <Link to={`/player/${r.Slug}`} style={{ color: "inherit", textDecoration: "none" }}
                    onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                  >
                    {r.Player || [r.First, r.Last].filter(Boolean).join(" ") || "—"}
                  </Link>
                ) : (
                  r.Player || [r.First, r.Last].filter(Boolean).join(" ") || "—"
                )}
              </td>
              <td style={{ padding: "8px", color: "#888" }}>{r.School || "—"}</td>
              <td style={{ padding: "8px", color: "#888" }}>{r["NFL Team"] || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Same "In The News" sidebar format as TeamPage.js's own NewsSidebar — a
// small date chip (month/day) per row instead of a thumbnail, capped at
// NEWS_LIMIT with a "Show More" button, hardcoded site blue/gold rather
// than the school's own colors (matching TeamPage.js's own choice there).
function NewsSidebar({ news }) {
  const [visibleCount, setVisibleCount] = useState(3);
  const shown = news.slice(0, Math.min(news.length, NEWS_LIMIT));
  return (
    <SidebarCard title="In The News" color1={BLUE} color2={GOLD}>
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
