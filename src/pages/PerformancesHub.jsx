// src/pages/PerformancesHub.jsx
//
// Public "browse all performances" page. Defaults to the current CFB week —
// computed from schedule26's game dates, not just picked arbitrarily — with
// a dropdown to browse past weeks, and a grade checklist to filter what
// shows (defaults to Dominant/Great/Good, the three tiers with a glow
// effect). If a week has no performances entered yet, falls back to showing
// that week's schedule so the page never looks broken/empty.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
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
  .wd-perf-card { transition: transform 0.15s ease, box-shadow 0.15s ease; }
  .wd-perf-card:hover { transform: translateY(-3px); }
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
          border: `2px solid ${BLUE}`, borderRadius: "8px", padding: "10px 14px",
          fontWeight: 900, fontSize: "13px", color: BLUE, background: "#fff",
          outline: "none", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.03em",
        }}
      >
        {label} <span style={{ fontSize: "10px" }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 30,
          background: "#fff", border: `2px solid ${BLUE}`, borderRadius: "10px",
          boxShadow: "0 8px 22px rgba(0,0,0,0.14)", padding: "10px", minWidth: "180px",
        }}>
          {options.map((opt) => {
            const st = styleFor ? styleFor(opt) : null;
            const checked = selected.includes(opt);
            return (
              <label
                key={opt}
                style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 6px", cursor: "pointer", borderRadius: "6px" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#f7f9fc"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(opt)} style={{ width: "15px", height: "15px", accentColor: BLUE, cursor: "pointer" }} />
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

export default function PerformancesHub() {
  const [performances, setPerformances] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentWeek, setCurrentWeek] = useState("");
  const [selectedWeek, setSelectedWeek] = useState("");
  const [selectedGrades, setSelectedGrades] = useState(DEFAULT_GRADES);
  const [selectedYears, setSelectedYears] = useState(ACTIVE_YEARS);
  const [prospectsOnly, setProspectsOnly] = useState(false);
  const [playersById, setPlayersById] = useState({});
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const contentRef = useRef(null);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const fetch = async () => {
      try {
        const [perfSnap, gamesSnap] = await Promise.all([
          getDocs(query(collection(db, "performances"), where("status", "==", "published"))),
          getDocs(collection(db, "schedule26")),
        ]);
        const perfs = perfSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const gameDocs = gamesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPerformances(perfs);
        setGames(gameDocs);

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
        setSelectedWeek(current);
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

        {loading ? (
          <LoadingSpinner label="Loading" size={28} minHeight="200px" />
        ) : !currentWeek ? (
          <div style={{ padding: "60px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "14px" }}>
            No schedule data available yet.
          </div>
        ) : (
          <>
            {/* ===== Controls ===== */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <select
                  value={selectedWeek}
                  onChange={(e) => setSelectedWeek(e.target.value)}
                  style={{
                    border: `2px solid ${BLUE}`, borderRadius: "8px", padding: "10px 14px",
                    fontWeight: 900, fontSize: "14px", color: BLUE, background: "#fff",
                    outline: "none", cursor: "pointer",
                  }}
                >
                  {weekOptions.map((w) => <option key={w} value={w}>{w}{w === currentWeek ? " (Current)" : ""}</option>)}
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
                      border: `2px solid ${BLUE}`, borderRadius: "8px", padding: "10px 14px",
                      fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.03em",
                      background: prospectsOnly ? BLUE : "#fff", color: prospectsOnly ? "#fff" : BLUE,
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
              // No performances entered for this week yet — show the schedule instead.
              <div>
                <div style={{ marginBottom: "12px", padding: "12px 16px", background: "#fff8e6", border: `2px solid ${GOLD}`, borderRadius: "8px", fontSize: "13px", fontWeight: 700, color: "#8a6300" }}>
                  No performances have been entered for {selectedWeek} yet — here's the schedule.
                </div>
                {gamesForWeek.length === 0 ? (
                  <div style={{ padding: "40px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "14px" }}>
                    No games found for {selectedWeek}.
                  </div>
                ) : (
                  <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
                    <div style={{ background: BLUE, padding: "8px 16px" }}>
                      <div style={{ color: GOLD, fontWeight: 900, fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                        {selectedWeek} Schedule
                      </div>
                    </div>
                    <div style={{ height: "3px", background: GOLD }} />
                    {gamesForWeek.map((g, i) => {
                      const d = g.Date?.toDate?.();
                      const timeStr = formatTime12h(g.Time);
                      const played = g.HomeScore != null && g.AwayScore != null;
                      return (
                        <div
                          key={g.id}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px",
                            padding: "12px 16px", background: "#fff",
                            borderBottom: i < gamesForWeek.length - 1 ? "1px solid #f0f0f0" : "none",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 900, fontSize: "14px", color: "#222" }}>
                              {g.Away} at {g.Home}
                            </div>
                            {played && (
                              <div style={{ fontSize: "12px", fontWeight: 700, color: "#888", marginTop: "2px" }}>
                                Final: {g.Home} {g.HomeScore} – {g.AwayScore} {g.Away}
                              </div>
                            )}
                          </div>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: "#aaa", flexShrink: 0, textAlign: "right" }}>
                            {d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "TBD"}
                            {timeStr && <div>{timeStr}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : filteredItems.length === 0 ? (
              <div style={{ padding: "50px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "14px", border: "2px dashed #ddd", borderRadius: "10px" }}>
                No performances match the selected filters for {selectedWeek}.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: "16px" }}>
                {filteredItems.map((p) => {
                  const date = p.gameDate?.toDate?.();
                  const grade = gradeStyles[p.grade];
                  const game = games.find((g) => g.id === p.gameId);
                  const played = game?.HomeScore != null && game?.AwayScore != null;

                  return (
                    <Link
                      key={p.id}
                      to={`/performance/${p.slug || p.id}`}
                      className={`wd-perf-card ${gradeGlowClass(p.grade)}`}
                      style={{
                        display: "block", background: "#fff", borderRadius: "12px",
                        border: "2px solid #eee", overflow: "hidden", textDecoration: "none",
                      }}
                    >
                      <div style={{ height: "5px", background: grade ? grade.color : "#ddd" }} />
                      <div style={{ padding: "16px 18px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                            {grade && (
                              <span style={{ background: grade.background, color: grade.color, fontSize: "10px", fontWeight: 900, padding: "3px 10px", borderRadius: "20px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                {p.grade}
                              </span>
                            )}
                          </div>
                          {date && (
                            <span style={{ fontSize: "11px", fontWeight: 700, color: "#aaa" }}>
                              {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </span>
                          )}
                        </div>

                        <div style={{ color: BLUE, fontWeight: 900, fontSize: "17px", textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.3, marginBottom: "6px" }}>
                          {p.titleShort}
                        </div>

                        <div style={{ fontSize: "12px", fontWeight: 700, color: "#888" }}>
                          {p.school}{p.opponent ? ` vs ${p.opponent}` : ""}
                        </div>
                        {played && (
                          <div style={{ fontSize: "12px", fontWeight: 700, color: "#888", marginTop: "2px" }}>
                            Final: {game.Home} {game.HomeScore} – {game.AwayScore} {game.Away}
                          </div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <MarginSidebars contentRef={contentRef} isMobile={isMobile} horizontalPadding={20} otherStream="news" />
    </>
  );
}
