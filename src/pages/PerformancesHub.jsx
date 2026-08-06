// src/pages/PerformancesHub.jsx
//
// Public "browse all performances" page. Defaults to the current CFB week —
// computed from schedule26's game dates, not just picked arbitrarily — with
// a dropdown to browse past weeks, and a grade checklist to filter what
// shows (defaults to Dominant/Great/Good, the three tiers with a glow
// effect). If a week has no performances entered yet, falls back to showing
// that week's schedule so the page never looks broken/empty.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Helmet } from "react-helmet-async";
import Logo1 from "../assets/Logo1.png";
import LoadingSpinner from "../components/LoadingSpinner";
import MarginSidebars from "../components/MarginSidebars";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const GRADE_ORDER = ["Dominant", "Great", "Good", "Productive", "Average", "Bad"];
const DEFAULT_GRADES = ["Dominant", "Great", "Good"];

// Draft-eligible years still ahead of them — i.e. "live" prospects, as
// opposed to players whose class already went through a draft (2026 and
// earlier). Mirrors AdminPanel.js's ACTIVE_YEARS.
const ACTIVE_YEARS = ["2027", "2028", "2029"];

const gradeStyles = {
  Dominant: { background: "#e6f4ea", color: "#1a7f37" },
  Great: { background: "#eaf6ec", color: "#2e7d32" },
  Good: { background: "#eaf1ff", color: BLUE },
  Productive: { background: "#fff8e1", color: "#9c7a00" },
  Average: { background: "#f0f0f0", color: "#666" },
  Bad: { background: "#fdeaea", color: "#c0392b" },
};

// Same trend styling MarginSidebars.js's "Top 5 Trending" widget uses —
// duplicated rather than shared since that widget's version is entangled
// with its own gutter-measurement code.
const TREND_STYLE = {
  up: { icon: "▲", label: "Trending Up", badgeBg: "#16a34a", badgeBorder: "#0f6e33" },
  breakout: { icon: "⚡", label: "Breakout", badgeBg: "#4a535e", badgeBorder: "#2c333b" },
  "on fire": { icon: "🔥", label: "On Fire", badgeBg: "#ffcc00", badgeBorder: "#b38600" },
};
// Brighter versions of the same three trend colors (same hues as the
// margin widget's soft-glow effect) for use as text/accents against the
// terminal's near-black background, where TREND_STYLE's own badgeBg
// ("breakout" especially) would be too close to the background to read.
const TREND_ACCENT = { up: "#4ade80", breakout: "#8fd8ff", "on fire": "#ffd23d" };

// Terminal-panel palette — a dark data readout distinct from the rest of
// the site's light chrome, so the performance list itself feels like a
// dense feed of real data rather than another row of pretty cards. Gold
// stays gold (Dominant already means "pop" everywhere else on the site);
// the rest maps loosely onto a ticker's green/blue/gray/red scale.
// Every one of these needs to read clearly as *text* against TERMINAL_BG,
// not just as a color swatch — Productive/Average were originally too dark
// (close to the background itself) to actually read as stat-line text.
const TERMINAL_GRADE_COLOR = {
  Dominant: "#f6a21d",
  Great: "#2ecc71",
  Good: "#4da6ff",
  Productive: "#b7c2d0",
  Average: "#9aa5b5",
  Bad: "#ff6b5b",
};
const TERMINAL_GRADE_COLOR_FALLBACK = "#8b98a8";
const TERMINAL_BG = "#0a1420";
const TERMINAL_MONO = "'Courier New', Courier, monospace";

const gradeGlowClass = (grade) => {
  if (grade === "Dominant") return "wd-perf-glow-dominant";
  if (grade === "Great") return "wd-perf-glow-great";
  if (grade === "Good") return "wd-perf-glow-good";
  return "";
};

const GRADE_GLOW_STYLE = `
  @keyframes wdPerfGlowDominant {
    0%, 100% { box-shadow: 0 0 0 1px rgba(246,162,29,0.45), 0 0 10px 3px rgba(246,162,29,0.55); }
    50%      { box-shadow: 0 0 0 1px rgba(246,162,29,0.7), 0 0 20px 7px rgba(246,162,29,0.9); }
  }
  .wd-perf-glow-dominant { animation: wdPerfGlowDominant 1.6s ease-in-out infinite; }
  @keyframes wdPerfGlowGreat {
    0%, 100% { box-shadow: 0 0 0 1px rgba(246,162,29,0.2), 0 0 5px 1px rgba(246,162,29,0.22); }
    50%      { box-shadow: 0 0 0 1px rgba(246,162,29,0.32), 0 0 9px 2px rgba(246,162,29,0.38); }
  }
  .wd-perf-glow-great { animation: wdPerfGlowGreat 2.6s ease-in-out infinite; }
  .wd-perf-glow-good { box-shadow: 0 0 0 1px rgba(246,162,29,0.18); }
  @keyframes wdLiveDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  .wd-live-dot { animation: wdLiveDot 1.1s ease-in-out infinite; }
  @keyframes wdFeaturedRowGlow {
    0%, 100% { box-shadow: inset 0 0 0 2px rgba(246,162,29,0.35); }
    50%      { box-shadow: inset 0 0 0 2px rgba(246,162,29,0.75); }
  }
  .wd-schedule-row-featured { animation: wdFeaturedRowGlow 2.2s ease-in-out infinite; }
  /* Game of the Week — same higher tier as the individual game page's
     ribbon (GamePage.js), shown instead of the Featured glow rather than
     alongside it. */
  @keyframes wdGotwRowGlow {
    0%, 100% { box-shadow: inset 0 0 0 2px rgba(255,69,0,0.35); }
    50%      { box-shadow: inset 0 0 0 2px rgba(255,69,0,0.7); }
  }
  .wd-schedule-row-gotw { animation: wdGotwRowGlow 3.4s ease-in-out infinite; }
  .wd-terminal-row { transition: background 0.15s ease; }
  .wd-terminal-row:hover { background: rgba(255,255,255,0.05) !important; }
`;

const weekNumber = (w) => {
  const m = /(\d+)/.exec(w || "");
  return m ? Number(m[1]) : 999;
};

const gradePriority = (grade) => {
  const i = GRADE_ORDER.indexOf(grade);
  return i === -1 ? GRADE_ORDER.length : i;
};

const toMs = (ts) => {
  if (!ts) return 0;
  if (ts?.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? 0 : parsed;
};

// Which logo a team should show, in order of preference: an admin-uploaded
// black version (Branding manager's "Logo (Black)" field) if one's been
// set, else the dark logo, else the plain primary logo.
const preferredLogo = (schoolData) => schoolData?.LogoBlack || schoolData?.LogoDark || schoolData?.Logo1 || "";

// Same admin-entered kickoff Time layered on top of the game's Date as
// AdminPanel.js's CFBScheduleSection — games without a Time just sort to
// the start of their day.
const timeToMinutes = (t) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
};
const formatTime12h = (t) => {
  const mins = timeToMinutes(t);
  if (mins == null) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
};
const gameSortMs = (g) => {
  const mins = timeToMinutes(g.Time);
  return toMs(g.Date) + (mins != null ? mins * 60000 : 0);
};

// Click-to-open checklist — same interaction pattern as AdminPanel.js's
// DropdownChecklist (click-outside closes). Generic over its option list so
// both the Grade and Draft Year filters share one implementation; grade
// pills get their tier color via styleFor, year pills just render plain.
function Checklist({ options, selected, setSelected, noun, styleFor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (v) => setSelected((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  const label = selected.length === options.length ? `All ${noun}` : selected.length === 0 ? `No ${noun}` : `${selected.length} ${noun}`;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: "8px",
          border: "1px solid rgba(255,255,255,0.25)", borderRadius: "6px", padding: "9px 14px",
          fontFamily: TERMINAL_MONO, fontWeight: 700, fontSize: "12px", color: "rgba(255,255,255,0.85)", background: "rgba(255,255,255,0.06)",
          outline: "none", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.03em",
        }}
      >
        {label} <span style={{ fontSize: "10px", color: GOLD }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 30,
          background: "#0f1e30", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "10px",
          boxShadow: "0 8px 22px rgba(0,0,0,0.5)", padding: "10px", minWidth: "180px",
        }}>
          {options.map((opt) => {
            const st = styleFor ? styleFor(opt) : null;
            const checked = selected.includes(opt);
            return (
              <label
                key={opt}
                style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 6px", cursor: "pointer", borderRadius: "6px" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(opt)} style={{ width: "15px", height: "15px", accentColor: GOLD, cursor: "pointer" }} />
                <span style={{
                  fontSize: "11px", fontWeight: 900, padding: "2px 8px", borderRadius: "20px",
                  background: st ? st.background : "#f0f0f0", color: st ? st.color : "#333",
                  textTransform: "uppercase", letterSpacing: "0.03em",
                }}>
                  {opt}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Full-page version of the margin widget's "Top 5 Trending" — every shown
// trend, not just the first 5, with room to actually show the admin's
// Notes rather than just a name and school.
function TrendsTab({ trends, loading }) {
  if (loading) return <LoadingSpinner label="Loading" size={28} minHeight="200px" />;

  return (
    <div style={{ background: TERMINAL_BG, border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: trends.length === 0 ? 0 : "18px", boxShadow: "0 8px 26px rgba(0,0,0,0.28)" }}>
      {trends.length === 0 ? (
        <div style={{ padding: "60px", textAlign: "center", color: "rgba(255,255,255,0.5)", fontStyle: "italic", fontSize: "14px" }}>
          No trends have been marked yet — check back soon.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "14px" }}>
          {trends.map((t) => {
            const key = (t.Trend || "").toString().trim().toLowerCase();
            const style = TREND_STYLE[key];
            const accent = TREND_ACCENT[key] || TERMINAL_GRADE_COLOR_FALLBACK;
            return (
              <Link
                key={t.slug}
                to={`/player/${t.slug}`}
                className="wd-terminal-row"
                style={{
                  display: "block", background: "rgba(255,255,255,0.03)", borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.12)", borderLeft: `4px solid ${accent}`,
                  overflow: "hidden", textDecoration: "none", padding: "14px 16px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                  <span style={{ fontSize: "13px" }}>{style ? style.icon : "•"}</span>
                  <span style={{ fontFamily: TERMINAL_MONO, color: accent, fontWeight: 900, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    {style ? style.label : (t.Trend || "Trending")}
                  </span>
                </div>
                <div style={{ color: "#fff", fontWeight: 900, fontSize: "16px", textTransform: "uppercase", letterSpacing: "0.02em", marginBottom: "4px" }}>
                  {t.First} {t.Last}
                </div>
                <div style={{ fontFamily: TERMINAL_MONO, fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.6)", marginBottom: t.Notes ? "10px" : 0 }}>
                  {t.School || "—"}
                </div>
                {t.Notes && (
                  <div style={{ fontSize: "12.5px", fontWeight: 500, color: "rgba(255,255,255,0.82)", lineHeight: 1.5 }}>
                    {t.Notes}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function PerformancesHub() {
  // Optional — present when reached via /performances/:week (e.g. from a
  // game page's "back to this week's slate" link), absent on the bare
  // /performances hub, which still falls back to auto-detecting "current".
  const { week: weekParam } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Trends is a literal path (see App.js), ranked ahead of :week for that
  // exact segment — anything else is the "This Week" tab.
  const activeTab = location.pathname === "/performances/trends" ? "trends" : "week";
  const [performances, setPerformances] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentWeek, setCurrentWeek] = useState("");
  const [selectedWeek, setSelectedWeek] = useState("");
  const [selectedGrades, setSelectedGrades] = useState(DEFAULT_GRADES);
  const [selectedYears, setSelectedYears] = useState(ACTIVE_YEARS);
  const [prospectsOnly, setProspectsOnly] = useState(false);
  const [playersById, setPlayersById] = useState({});
  const [schoolsByName, setSchoolsByName] = useState({});
  const [trends, setTrends] = useState([]);
  const [trendsLoading, setTrendsLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const contentRef = useRef(null);

  // Trends tab's data — every shown trend (not capped at 5 like the margin
  // widget), ordered the same way.
  useEffect(() => {
    const fetch = async () => {
      setTrendsLoading(true);
      try {
        const snap = await getDocs(collection(db, "trends"));
        const shown = snap.docs
          .map((d) => ({ slug: d.id, ...d.data() }))
          .filter((t) => t.Shown === true)
          .sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0));
        setTrends(shown);
      } catch (e) {
        console.error("Trends fetch error:", e);
        setTrends([]);
      } finally {
        setTrendsLoading(false);
      }
    };
    fetch();
  }, []);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const fetch = async () => {
      try {
        const [perfSnap, gamesSnap, schoolsSnap] = await Promise.all([
          getDocs(query(collection(db, "performances"), where("status", "==", "published"))),
          getDocs(collection(db, "schedule26")),
          getDocs(collection(db, "schools")),
        ]);
        const perfs = perfSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const gameDocs = gamesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPerformances(perfs);
        setGames(gameDocs);
        const schoolsMap = {};
        schoolsSnap.docs.forEach((d) => { const data = d.data(); if (data.School) schoolsMap[data.School] = data; });
        setSchoolsByName(schoolsMap);

        // Current week = the latest week whose earliest game has already
        // kicked off — so a week stays "current" through the whole
        // following stretch until the next week's games start (whatever
        // day that lands on), rather than flipping on a fixed weekday.
        const startMs = {};
        gameDocs.forEach((g) => {
          if (!g.Week || !g.Date) return;
          const ms = toMs(g.Date);
          if (!startMs[g.Week] || ms < startMs[g.Week]) startMs[g.Week] = ms;
        });
        const allWeeks = Object.keys(startMs).sort((a, b) => weekNumber(a) - weekNumber(b));
        const now = Date.now();
        let dateBasedWeek = allWeeks[0] || "";
        for (const w of allWeeks) {
          if (startMs[w] <= now) dateBasedWeek = w;
          else break;
        }
        // Override: if the *next* week's performances are already up
        // (published ahead of schedule), jump the default forward early
        // instead of waiting on the calendar.
        const weeksWithPerf = new Set(perfs.map((p) => p.week).filter(Boolean));
        const idx = allWeeks.indexOf(dateBasedWeek);
        const nextWeek = allWeeks[idx + 1];
        const current = (nextWeek && weeksWithPerf.has(nextWeek)) ? nextWeek : dateBasedWeek;

        setCurrentWeek(current);
        // A week named in the URL (deep-linked from a game page) wins over
        // the auto-detected "current" week — decodeURIComponent defensively
        // even though react-router already decodes path params, since a
        // raw already-decoded string just passes through unchanged.
        let initialWeek = current;
        if (weekParam) {
          try { initialWeek = decodeURIComponent(weekParam); } catch { initialWeek = weekParam; }
        }
        setSelectedWeek(initialWeek);
      } catch (err) {
        console.error("Error fetching performances:", err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  // Draft-year / prospect-status filters need each performance's *player*
  // data (Eligible year) — not denormalized on the performance doc itself,
  // so this joins in the primary subject's player record for every
  // performance once they're loaded.
  useEffect(() => {
    if (performances.length === 0) return;
    const ids = Array.from(new Set(performances.map((p) => p.playerId).filter(Boolean)));
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const snaps = await Promise.all(ids.map((id) => getDoc(doc(db, "players", id))));
        if (cancelled) return;
        const map = {};
        snaps.forEach((s) => { if (s.exists()) map[s.id] = s.data(); });
        setPlayersById(map);
      } catch (e) { /* filters are non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [performances]);

  // Every week with either games or performances is selectable — including
  // future ones, which will naturally fall into the schedule-fallback view
  // below since they won't have any performances yet.
  const weekOptions = useMemo(() => {
    const gameWeeks = new Set(games.map((g) => g.Week).filter(Boolean));
    const perfWeeks = new Set(performances.map((p) => p.week).filter(Boolean));
    return Array.from(new Set([...gameWeeks, ...perfWeeks])).sort((a, b) => weekNumber(a) - weekNumber(b));
  }, [games, performances]);

  const performancesForWeek = useMemo(
    () => performances.filter((p) => p.week === selectedWeek),
    [performances, selectedWeek]
  );

  const filteredItems = useMemo(() => {
    return performancesForWeek
      .filter((p) => selectedGrades.includes(p.grade))
      .filter((p) => {
        const eligible = playersById[p.playerId]?.Eligible;
        // All years checked = no-op (still shows players outside 2027-2029,
        // e.g. an already-drafted 2026 class) — only once the set is
        // actually narrowed does it become a strict membership test.
        const yearOk = selectedYears.length === ACTIVE_YEARS.length || selectedYears.includes(eligible);
        const prospectOk = !prospectsOnly || ACTIVE_YEARS.includes(eligible);
        return yearOk && prospectOk;
      })
      .sort((a, b) => {
        const gp = gradePriority(a.grade) - gradePriority(b.grade);
        if (gp !== 0) return gp;
        return toMs(b.gameDate) - toMs(a.gameDate);
      });
  }, [performancesForWeek, selectedGrades, selectedYears, prospectsOnly, playersById]);

  const gamesForWeek = useMemo(
    () => games.filter((g) => g.Week === selectedWeek).sort((a, b) => gameSortMs(a) - gameSortMs(b)),
    [games, selectedWeek]
  );

  // Grade counts across every performance entered for this week — computed
  // before the grade/year filters apply, so the ticker always reflects the
  // week's real total supply of data, not just whatever the user currently
  // has checked.
  const weekGradeCounts = useMemo(() => {
    const counts = {};
    GRADE_ORDER.forEach((g) => { counts[g] = 0; });
    performancesForWeek.forEach((p) => { if (counts[p.grade] !== undefined) counts[p.grade]++; });
    return counts;
  }, [performancesForWeek]);

  const isSaturday = new Date().getDay() === 6;
  const showLive = isSaturday && selectedWeek === currentWeek;

  return (
    <>
      <style>{GRADE_GLOW_STYLE}</style>
      <Helmet>
        <title>Performances | We-Draft</title>
      </Helmet>

      <div ref={contentRef} style={{ maxWidth: "1000px", margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* ===== Header ===== */}
        <div style={{ marginBottom: "24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "14px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <img src={Logo1} alt="We-Draft" style={{ height: isMobile ? "22px" : "28px", objectFit: "contain" }} />
              <div style={{ fontSize: isMobile ? "20px" : "28px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE }}>
                Performances
              </div>
            </div>
            <div style={{ height: "3px", width: "160px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
            <div style={{ height: "3px", width: "160px", background: GOLD, borderRadius: "2px" }} />
          </div>
          <Link
            to="/news"
            style={{
              display: "inline-flex", alignItems: "center", gap: "8px",
              background: BLUE, color: "#fff", border: `2px solid ${GOLD}`,
              borderRadius: "24px", padding: "10px 20px", textDecoration: "none",
              fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em",
            }}
          >
            View News →
          </Link>
        </div>

        {/* ===== Tab toggle ===== */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
          {[
            { key: "week", label: "This Week", to: "/performances" },
            { key: "trends", label: "🔥 Trends", to: "/performances/trends" },
          ].map((tab) => (
            <Link
              key={tab.key}
              to={tab.to}
              style={{
                border: `2px solid ${BLUE}`, borderRadius: "8px", padding: "10px 20px",
                fontWeight: 900, fontSize: isMobile ? "12px" : "13px", textTransform: "uppercase", letterSpacing: "0.04em",
                background: activeTab === tab.key ? BLUE : "#fff", color: activeTab === tab.key ? "#fff" : BLUE,
                cursor: "pointer", textDecoration: "none", display: "inline-block",
              }}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        {activeTab === "trends" ? (
          <TrendsTab trends={trends} loading={trendsLoading} />
        ) : loading ? (
          <LoadingSpinner label="Loading" size={28} minHeight="200px" />
        ) : !currentWeek ? (
          <div style={{ padding: "60px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "14px" }}>
            No schedule data available yet.
          </div>
        ) : (
          <>
            {/* ===== Controls — same dark terminal readout as the data
                below, so the filters read as part of the instrument rather
                than a separate light toolbar bolted on top of it. ===== */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px",
              marginBottom: "20px", background: TERMINAL_BG, border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "10px", padding: "14px 16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <select
                  value={selectedWeek}
                  onChange={(e) => {
                    setSelectedWeek(e.target.value);
                    navigate(`/performances/${encodeURIComponent(e.target.value)}`, { replace: true });
                  }}
                  style={{
                    border: "1px solid rgba(255,255,255,0.25)", borderRadius: "6px", padding: "9px 14px",
                    fontFamily: TERMINAL_MONO, fontWeight: 700, fontSize: "13px", color: "#fff", background: "rgba(255,255,255,0.06)",
                    outline: "none", cursor: "pointer",
                  }}
                >
                  {/* Most browsers render the open dropdown list using the
                      OS's default white background regardless of the
                      <select>'s own dark styling, but DO respect color/
                      background set on each <option> directly — without
                      this, the <select>'s white text becomes invisible
                      white-on-white once the list opens. */}
                  {weekOptions.map((w) => (
                    <option key={w} value={w} style={{ background: "#0f1e30", color: "#fff" }}>
                      {w}{w === currentWeek ? " (Current)" : ""}
                    </option>
                  ))}
                </select>
                {showLive && (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: "6px",
                    background: "#c0392b", color: "#fff", borderRadius: "20px",
                    padding: "6px 12px", fontSize: "11px", fontWeight: 900,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                  }}>
                    <span className="wd-live-dot" style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#fff", display: "inline-block" }} />
                    Live
                  </span>
                )}
              </div>
              {/* Filters only make sense once there's something to filter —
                  hidden entirely on the schedule-fallback view below. */}
              {performancesForWeek.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <Checklist options={GRADE_ORDER} selected={selectedGrades} setSelected={setSelectedGrades} noun="Grades" styleFor={(g) => gradeStyles[g]} />
                  <Checklist options={ACTIVE_YEARS} selected={selectedYears} setSelected={setSelectedYears} noun="Years" />
                  <button
                    type="button"
                    onClick={() => setProspectsOnly((v) => !v)}
                    style={{
                      border: "1px solid rgba(255,255,255,0.25)", borderRadius: "6px", padding: "9px 14px",
                      fontFamily: TERMINAL_MONO, fontWeight: 700, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.03em",
                      background: prospectsOnly ? GOLD : "rgba(255,255,255,0.06)", color: prospectsOnly ? "#3a2900" : "rgba(255,255,255,0.85)",
                      cursor: "pointer", outline: "none",
                    }}
                  >
                    {prospectsOnly ? "Prospects Only" : "All Players"}
                  </button>
                </div>
              )}
            </div>

            {/* ===== Content ===== */}
            {performancesForWeek.length === 0 ? (
              // No performances entered for this week yet — show the
              // schedule instead, same dark terminal readout as the
              // performance rows below rather than a separate light panel.
              <div style={{ borderRadius: "10px", overflow: "hidden", boxShadow: "0 8px 26px rgba(0,0,0,0.28)" }}>
                <div style={{ background: TERMINAL_BG, padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                  <span style={{ fontFamily: TERMINAL_MONO, fontSize: "10px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    {selectedWeek} ▸ NO PERFORMANCES YET — SCHEDULE
                  </span>
                </div>
                {gamesForWeek.length === 0 ? (
                  <div style={{ background: TERMINAL_BG, padding: "50px", textAlign: "center", color: "rgba(255,255,255,0.6)", fontStyle: "italic", fontSize: "14px" }}>
                    No games found for {selectedWeek}.
                  </div>
                ) : (
                  <div style={{ background: TERMINAL_BG }}>
                    {gamesForWeek.map((g, i) => {
                      const d = g.Date?.toDate?.();
                      const timeStr = formatTime12h(g.Time);
                      const played = g.Final && g.HomeScore != null && g.AwayScore != null;
                      const away = schoolsByName[g.Away];
                      const home = schoolsByName[g.Home];
                      const awayWon = played && g.AwayScore > g.HomeScore;
                      const homeWon = played && g.HomeScore > g.AwayScore;

                      const awayColor = away?.Color1 || "rgba(255,255,255,0.15)";
                      const homeColor = home?.Color1 || "rgba(255,255,255,0.15)";

                      const TeamRow = ({ school, data, score, won }) => {
                        const logoSrc = preferredLogo(data);
                        return (
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            {logoSrc ? (
                              <img src={logoSrc} alt="" style={{ width: "36px", height: "36px", objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                            ) : (
                              <div style={{ width: "36px", height: "36px", flexShrink: 0, borderRadius: "6px", background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.4)", fontSize: "13px", fontWeight: 900 }}>
                                {(school || "?").charAt(0)}
                              </div>
                            )}
                            <span style={{ fontFamily: TERMINAL_MONO, fontWeight: 900, fontSize: "14px", color: played ? (won ? "#fff" : "rgba(255,255,255,0.45)") : "#fff" }}>
                              {school}
                            </span>
                            {played && (
                              <span style={{ marginLeft: "auto", fontFamily: TERMINAL_MONO, fontWeight: 900, fontSize: "18px", color: won ? GOLD : "rgba(255,255,255,0.35)" }}>{score}</span>
                            )}
                          </div>
                        );
                      };

                      return (
                        <Link
                          key={g.id}
                          to={g.Slug ? `/game/${g.Slug}` : "#"}
                          className={`wd-terminal-row${g.GameOfWeek ? " wd-schedule-row-gotw" : g.Featured ? " wd-schedule-row-featured" : ""}`}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px",
                            padding: "14px 16px 14px 20px",
                            // Same team-color sliver GamePage.js's hero and
                            // CFBPage.js's schedule rows use, compressed to a
                            // 4px accent at the row's left edge.
                            background: `linear-gradient(to bottom, ${awayColor} 50%, ${homeColor} 50%) left / 4px 100% no-repeat`,
                            textDecoration: "none",
                            borderBottom: i < gamesForWeek.length - 1 ? "1px solid rgba(255,255,255,0.07)" : "none",
                            pointerEvents: g.Slug ? "auto" : "none",
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
                            <TeamRow school={g.Away} data={away} score={g.AwayScore} won={awayWon} />
                            <TeamRow school={g.Home} data={home} score={g.HomeScore} won={homeWon} />
                          </div>
                          <div style={{ fontFamily: TERMINAL_MONO, fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.5)", flexShrink: 0, textAlign: "right" }}>
                            {g.GameOfWeek ? (
                              <span style={{
                                display: "inline-flex", alignItems: "center", gap: "3px", marginBottom: "5px",
                                background: "linear-gradient(90deg, #ff4500, #ffb347)", color: "#3a0f00",
                                fontWeight: 900, fontSize: "10px", padding: "3px 9px", borderRadius: "20px",
                                textTransform: "uppercase", letterSpacing: "0.05em",
                              }}>
                                🔥 Game of the Week
                              </span>
                            ) : g.Featured && (
                              <span style={{
                                display: "inline-flex", alignItems: "center", gap: "3px", marginBottom: "5px",
                                background: "linear-gradient(90deg, #f6a21d, #ffd35c)", color: "#3a2900",
                                fontWeight: 900, fontSize: "10px", padding: "3px 9px", borderRadius: "20px",
                                textTransform: "uppercase", letterSpacing: "0.05em",
                              }}>
                                ⭐ Featured
                              </span>
                            )}
                            <div>
                              {d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) : "TBD"}
                              {timeStr && <div>{timeStr}</div>}
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ borderRadius: "10px", overflow: "hidden", boxShadow: "0 8px 26px rgba(0,0,0,0.28)" }}>
                {/* ===== Ticker — grade counts for the whole week, ahead of
                    any filtering, so it always reads as the week's real
                    total data supply. ===== */}
                <div style={{
                  background: TERMINAL_BG, padding: "10px 16px",
                  display: "flex", gap: "18px", flexWrap: "wrap", alignItems: "center",
                  borderBottom: "1px solid rgba(255,255,255,0.1)",
                }}>
                  <span style={{ fontFamily: TERMINAL_MONO, fontSize: "10px", fontWeight: 900, color: "rgba(255,255,255,0.65)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    {selectedWeek} ▸
                  </span>
                  {GRADE_ORDER.map((g) => (
                    <div key={g} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: TERMINAL_GRADE_COLOR[g], flexShrink: 0 }} />
                      <span style={{ fontFamily: TERMINAL_MONO, fontSize: "10.5px", fontWeight: 700, color: "rgba(255,255,255,0.75)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {g}
                      </span>
                      <span style={{ fontFamily: TERMINAL_MONO, fontSize: "13px", fontWeight: 900, color: "#fff" }}>
                        {weekGradeCounts[g]}
                      </span>
                    </div>
                  ))}
                </div>

                {/* ===== Data rows ===== */}
                {filteredItems.length === 0 ? (
                  <div style={{ background: TERMINAL_BG, padding: "50px", textAlign: "center", color: "rgba(255,255,255,0.6)", fontStyle: "italic", fontSize: "14px" }}>
                    No performances match the selected filters for {selectedWeek}.
                  </div>
                ) : (
                  <div style={{ background: TERMINAL_BG }}>
                    {filteredItems.map((p, i) => {
                      const date = p.gameDate?.toDate?.();
                      const dateStr = date?.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
                      const game = games.find((g) => g.id === p.gameId);
                      const played = game?.HomeScore != null && game?.AwayScore != null;
                      const logo = preferredLogo(schoolsByName[p.school]);
                      const tickColor = TERMINAL_GRADE_COLOR[p.grade] || TERMINAL_GRADE_COLOR_FALLBACK;

                      return (
                        <Link
                          key={p.id}
                          to={`/performance/${p.slug || p.id}`}
                          className={`wd-terminal-row ${gradeGlowClass(p.grade)}`}
                          style={{
                            display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px",
                            textDecoration: "none", borderBottom: i < filteredItems.length - 1 ? "1px solid rgba(255,255,255,0.07)" : "none",
                          }}
                        >
                          <span style={{ width: "4px", height: "34px", borderRadius: "2px", background: tickColor, flexShrink: 0 }} />
                          {logo ? (
                            <img src={logo} alt="" style={{ width: "24px", height: "24px", objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                          ) : (
                            <span style={{ width: "24px", height: "24px", flexShrink: 0, borderRadius: "4px", background: "rgba(255,255,255,0.08)", display: "inline-block" }} />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {p.playerName || p.titleShort}
                            </div>
                            {p.statLine && (
                              <div style={{ fontFamily: TERMINAL_MONO, fontSize: "11.5px", fontWeight: 700, color: tickColor, marginTop: "2px" }}>
                                {p.statLine}
                              </div>
                            )}
                            <div style={{ fontFamily: TERMINAL_MONO, fontSize: "10px", color: "rgba(255,255,255,0.6)", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {p.school}{p.opponent ? ` vs ${p.opponent}` : ""}
                              {played && ` · FINAL ${game.HomeScore}-${game.AwayScore}`}
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontSize: "9px", fontWeight: 900, color: tickColor, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                              {p.grade}
                            </div>
                            {dateStr && (
                              <div style={{ fontFamily: TERMINAL_MONO, fontSize: "10px", color: "rgba(255,255,255,0.55)", marginTop: "3px" }}>
                                {dateStr}
                              </div>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <MarginSidebars contentRef={contentRef} isMobile={isMobile} horizontalPadding={20} otherStream="news" />
    </>
  );
}
