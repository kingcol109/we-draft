import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";
import LoadingSpinner from "../components/LoadingSpinner";
import { useCurrentRankMap, ranksForGame } from "../utils/rankings";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

const weekNumber = (w) => {
  const m = /(\d+)/.exec(w || "");
  return m ? Number(m[1]) : 999;
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

export default function CFBPage() {
  // Tab lives in the URL (/cfb vs /cfb/schedule[/:week]) instead of local
  // state, so it survives a reload and is actually linkable/shareable —
  // it used to always reset back to Teams on navigation.
  const location = useLocation();
  const navigate = useNavigate();
  const { week: weekParam } = useParams();
  const activeTab = location.pathname.startsWith("/cfb/schedule") ? "schedule" : "teams";
  const [schools, setSchools] = useState([]);
  const [schoolsByName, setSchoolsByName] = useState({});
  // Channel name (schedule26's own game.Channel, set via CFB Schedule's "TV
  // Channel" field in AdminPanel.js) → its tvChannels doc, so a schedule row
  // can show the short form ("ACCN") instead of the full "ACC Network" —
  // same map shape/source as GameMarginSidebars.js's own channelsByName.
  const [channelsByName, setChannelsByName] = useState({});
  const [games, setGames] = useState([]);
  const [selectedWeek, setSelectedWeek] = useState("");
  // Current (latest-published) Top 25 — ranksForGame prefers each game's
  // own frozen HomeRank/AwayRank once it's Final, so this is only ever the
  // source of truth for a not-yet-played game, regardless of which week
  // it's actually in.
  const currentRankMap = useCurrentRankMap();
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );

  const conferenceOrder = [
    "ACC",
    "Big 10",
    "Big 12",
    "SEC",
    "Pac 12",
    "Independent",
    "AAC",
    "CUSA",
    "MAC",
    "Mountain West",
    "Sun Belt",
  ];

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    async function fetchData() {
      try {
        const [schoolsSnap, gamesSnap, channelsSnap] = await Promise.all([
          getDocs(collection(db, "schools")),
          getDocs(collection(db, "schedule26")),
          getDocs(collection(db, "tvChannels")),
        ]);
        const data = schoolsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const filtered = data.filter((school) =>
          conferenceOrder.includes(school.Conference)
        );
        setSchools(filtered);
        // Unfiltered by conference — the schedule includes plenty of
        // FCS/unlisted opponents (e.g. Howard, Morgan State) that the Teams
        // tab intentionally excludes but the Schedule tab still needs logos
        // and short names for.
        const nameMap = {};
        data.forEach((s) => { if (s.School) nameMap[s.School] = s; });
        setSchoolsByName(nameMap);

        const channelMap = {};
        channelsSnap.docs.forEach((d) => { const c = d.data(); if (c.Name) channelMap[c.Name] = c; });
        setChannelsByName(channelMap);

        const gameDocs = gamesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setGames(gameDocs);

        // Default to the latest week whose earliest game has already
        // kicked off — same "current week" notion PerformancesHub.jsx uses.
        const startMs = {};
        gameDocs.forEach((g) => {
          if (!g.Week || !g.Date) return;
          const ms = toMs(g.Date);
          if (!startMs[g.Week] || ms < startMs[g.Week]) startMs[g.Week] = ms;
        });
        const allWeeks = Object.keys(startMs).sort((a, b) => weekNumber(a) - weekNumber(b));
        const now = Date.now();
        let current = allWeeks[0] || "";
        for (const w of allWeeks) {
          if (startMs[w] <= now) current = w;
          else break;
        }
        // A week named in the URL (e.g. deep-linked from elsewhere) wins
        // over the auto-detected "current" week.
        let initialWeek = current;
        if (weekParam) {
          try { initialWeek = decodeURIComponent(weekParam); } catch { initialWeek = weekParam; }
        }
        setSelectedWeek(initialWeek);
      } catch (err) {
        console.error("Error fetching CFB page data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const weekOptions = useMemo(
    () => Array.from(new Set(games.map((g) => g.Week).filter(Boolean))).sort((a, b) => weekNumber(a) - weekNumber(b)),
    [games]
  );

  // Home-team tiebreak matches AdminPanel.js's CFBScheduleSection sort —
  // plenty of games this far out have no kickoff Time yet (TV hasn't set
  // it), so without a stable tiebreak every same-date TBD game would sort
  // in whatever arbitrary order Firestore happened to return them in.
  const gamesForWeek = useMemo(
    () => games.filter((g) => g.Week === selectedWeek).sort((a, b) => (gameSortMs(a) - gameSortMs(b)) || (a.Home || "").localeCompare(b.Home || "")),
    [games, selectedWeek]
  );

  const [rankedOnly, setRankedOnly] = useState(false);
  const visibleGames = useMemo(() => {
    if (!rankedOnly) return gamesForWeek;
    return gamesForWeek.filter((g) => {
      const { homeRank, awayRank } = ranksForGame(g, currentRankMap);
      return !!(homeRank || awayRank);
    });
  }, [gamesForWeek, rankedOnly, currentRankMap]);

  const grouped = conferenceOrder.reduce((acc, conf) => {
    acc[conf] = schools
      .filter((s) => s.Conference === conf)
      .sort((a, b) => a.School.localeCompare(b.School));
    return acc;
  }, {});

  if (loading) {
    return <LoadingSpinner label="Loading Teams" size={56} minHeight="100vh" />;
  }

  return (
    <div
      style={{
        maxWidth: "1200px",
        margin: "0 auto",
        padding: isMobile ? "12px 12px 60px" : "24px 24px 60px",
        fontFamily: "'Arial Black', Arial, sans-serif",
      }}
    >
      <style>{`
        .team-card {
          transition: box-shadow 0.18s ease;
        }
        .team-card:hover {
          /* No transform here on purpose — the old translateY/scale lift
             visually enlarged the whole chip on hover, which is exactly
             the "box growing" this was supposed to not do. A shadow alone
             still reads as hover feedback without touching the box's size
             or position. */
          box-shadow: 0 8px 20px rgba(0,0,0,0.15);
          opacity: 1 !important;
        }
        /* Logo lives in its own absolutely-positioned layer, back at its
           original resting inset (top:8px, sides:6px, bottom reserving
           room for the name below it) — all four sides now animate
           together toward a near-zero inset on hover, so the layer
           actually expands to cover nearly the entire box in every
           direction at once, not just downward. Equal insets on all sides
           at the end of the animation keeps it symmetric. */
        .team-logo-wrap {
          transition: top 0.22s ease, bottom 0.22s ease, left 0.22s ease, right 0.22s ease;
        }
        .team-card:hover .team-logo-wrap {
          top: 3px;
          bottom: 3px;
          left: 3px;
          right: 3px;
        }
        /* The logo itself sits at a small, fixed size at rest — the same
           ballpark as the old fixed-px logo before this hover redesign —
           and jumps to nearly the full size of its (also-growing) wrapper
           on hover, so the two effects compound into a big, obvious
           change. !important is needed here because it's overriding an
           inline style, not another class. */
        .team-logo {
          transition: width 0.22s ease, height 0.22s ease;
        }
        .team-card:hover .team-logo {
          width: 100% !important;
          height: 100% !important;
        }
        /* Name + accent bar fade out together on hover instead of moving —
           they sit in their own absolutely-positioned layer at the bottom,
           independent of the logo layer growing underneath/behind them. */
        .team-card-info {
          transition: opacity 0.18s ease;
        }
        .team-card:hover .team-card-info {
          opacity: 0;
        }
        .team-accent {
          transition: height 0.18s ease;
        }
        .wd-schedule-row {
          transition: background 0.15s ease;
        }
        .wd-schedule-row:hover {
          background: #f7f9fc !important;
        }
        @keyframes wdFeaturedRowGlow {
          0%, 100% { box-shadow: inset 0 0 0 2px rgba(246,162,29,0.35); }
          50% { box-shadow: inset 0 0 0 2px rgba(246,162,29,0.75); }
        }
        .wd-schedule-row-featured {
          animation: wdFeaturedRowGlow 2.2s ease-in-out infinite;
        }
        /* Game of the Week — same higher tier as the individual game page's
           ribbon (GamePage.js), shown instead of the Featured glow rather
           than alongside it. Slower/calmer than an early GamePage.js pass
           at this same fire-toned glow, which read as too frantic there. */
        @keyframes wdGotwRowGlow {
          0%, 100% { box-shadow: inset 0 0 0 2px rgba(255,69,0,0.35); }
          50% { box-shadow: inset 0 0 0 2px rgba(255,69,0,0.7); }
        }
        .wd-schedule-row-gotw {
          animation: wdGotwRowGlow 3.4s ease-in-out infinite;
        }
      `}</style>
      {/* ===== Page Header ===== */}
      <div className="mb-8">
        <div
          style={{
            fontSize: isMobile ? "22px" : "30px",
            fontWeight: 900,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: SITE_BLUE,
            marginBottom: "6px",
          }}
        >
          College Football Teams
        </div>
        <div
          style={{
            height: "3px",
            backgroundColor: SITE_BLUE,
            borderRadius: "2px",
            marginBottom: "4px",
          }}
        />
        <div
          style={{
            height: "3px",
            backgroundColor: SITE_GOLD,
            borderRadius: "2px",
          }}
        />
      </div>

      {/* ===== Tab toggle ===== */}
      <div style={{ display: "flex", gap: "10px", marginBottom: isMobile ? "20px" : "28px" }}>
        {[
          { key: "teams", label: "Teams", to: "/cfb" },
          { key: "schedule", label: "Full Schedule", to: "/cfb/schedule" },
        ].map((tab) => (
          <Link
            key={tab.key}
            to={tab.to}
            style={{
              border: `2px solid ${SITE_BLUE}`, borderRadius: "8px", padding: "10px 20px",
              fontWeight: 900, fontSize: isMobile ? "12px" : "13px", textTransform: "uppercase", letterSpacing: "0.04em",
              background: activeTab === tab.key ? SITE_BLUE : "#fff", color: activeTab === tab.key ? "#fff" : SITE_BLUE,
              cursor: "pointer", textDecoration: "none", display: "inline-block",
            }}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* ===== Conference Sections ===== */}
      {activeTab === "teams" && conferenceOrder.map((conf) => {
        const teams = grouped[conf];
        if (!teams || teams.length === 0) return null;

        return (
          <div key={conf} style={{ marginBottom: isMobile ? "28px" : "40px" }}>

            {/* Conference header */}
            <div style={{ marginBottom: isMobile ? "10px" : "14px" }}>
              <div
                style={{
                  fontSize: isMobile ? "16px" : "20px",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: SITE_BLUE,
                  marginBottom: "5px",
                }}
              >
                {conf}
              </div>
              <div
                style={{
                  height: "3px",
                  backgroundColor: SITE_BLUE,
                  borderRadius: "2px",
                }}
              />
            </div>

            {/* Teams grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile
                  ? "repeat(3, 1fr)"
                  : "repeat(auto-fill, minmax(140px, 1fr))",
                gap: isMobile ? "8px" : "12px",
              }}
            >
              {teams.map((team) => {
                const slug = team.Slug;

                const primary = team.Color1 || SITE_BLUE;
                const secondary = team.Color2 || SITE_GOLD;

                const logoSrc = team.LogoDark || team.Logo1 || "";

                return (
                  <Link
                    key={team.id}
                    to={`/team/${slug}`}
                    className="team-card"
                    style={{
                      position: "relative",
                      // Fixed height (not content-sized) so the hover
                      // animation below — the logo layer growing as the
                      // name/accent layer fades — never changes the chip's
                      // own footprint in the grid.
                      height: isMobile ? "84px" : "104px",
                      borderRadius: "8px",
                      backgroundColor: primary,
                      border: `2px solid ${secondary}`,
                      textDecoration: "none",
                      overflow: "hidden",
                    }}
                  >
                    {/* Logo layer, resting in its original spot (top:8px,
                        sides:6px, bottom reserving room for the name below
                        it). On hover all four sides animate toward a near-
                        zero inset (see .team-logo-wrap above), expanding
                        this layer — and the logo filling it — to cover
                        nearly the entire box. Dark variant preferred now
                        that the chip's own background is the team's color
                        instead of white, same convention used everywhere
                        else colored backgrounds sit behind a logo. */}
                    <div
                      className="team-logo-wrap"
                      style={{
                        position: "absolute", left: "6px", right: "6px", top: "8px",
                        bottom: isMobile ? "26px" : "32px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      {logoSrc ? (
                        <img
                          src={logoSrc}
                          alt={team.School}
                          className="team-logo"
                          style={{
                            width: isMobile ? "36px" : "48px",
                            height: isMobile ? "36px" : "48px",
                            objectFit: "contain",
                            filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.35))",
                          }}
                          loading="lazy"
                          onError={(e) => { e.currentTarget.style.display = "none"; }}
                        />
                      ) : (
                        <div
                          style={{
                            width: isMobile ? "36px" : "48px",
                            height: isMobile ? "36px" : "48px",
                            borderRadius: "50%",
                            backgroundColor: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: primary,
                            fontSize: isMobile ? "10px" : "12px",
                            fontWeight: 900,
                          }}
                        >
                          {team.School.charAt(0)}
                        </div>
                      )}
                    </div>

                    {/* Name + accent bar layer — fades out on hover (see
                        .team-card:hover .team-card-info) instead of moving,
                        independent of the logo layer growing behind it. */}
                    <div
                      className="team-card-info"
                      style={{
                        position: "absolute", left: 0, right: 0, bottom: 0,
                        padding: isMobile ? "0 6px 8px" : "0 10px 10px",
                        display: "flex", flexDirection: "column", alignItems: "center",
                        gap: isMobile ? "4px" : "6px", textAlign: "center",
                      }}
                    >
                      <div
                        style={{
                          fontSize: isMobile ? "10px" : "12px",
                          fontWeight: 900,
                          color: "#fff",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          lineHeight: 1.2,
                          textShadow: "0 1px 3px rgba(0,0,0,0.35)",
                        }}
                      >
                        {team.School}
                      </div>
                      <div
                        className="team-accent"
                        style={{
                          width: "100%",
                          height: "3px",
                          backgroundColor: secondary,
                          borderRadius: "2px",
                        }}
                      />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* ===== Full Schedule ===== */}
      {activeTab === "schedule" && (
        <div>
          {weekOptions.length === 0 ? (
            <div style={{ padding: "40px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "14px" }}>
              No schedule available yet.
            </div>
          ) : (
            <>
              <div style={{ marginBottom: "16px", display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
                <select
                  value={selectedWeek}
                  onChange={(e) => {
                    setSelectedWeek(e.target.value);
                    navigate(`/cfb/schedule/${encodeURIComponent(e.target.value)}`, { replace: true });
                  }}
                  style={{
                    width: "100%", maxWidth: "260px", border: `2px solid ${SITE_BLUE}`, borderRadius: "8px",
                    padding: "10px 12px", fontWeight: 900, fontSize: "14px", color: SITE_BLUE,
                    outline: "none", background: "#fff",
                  }}
                >
                  {weekOptions.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => setRankedOnly((v) => !v)}
                  style={{
                    padding: "10px 16px", fontWeight: 900, fontSize: "13px",
                    border: `2px solid ${SITE_BLUE}`, borderRadius: "8px", cursor: "pointer",
                    background: rankedOnly ? SITE_BLUE : "#fff",
                    color: rankedOnly ? "#fff" : SITE_BLUE,
                    whiteSpace: "nowrap",
                  }}
                >
                  🏆 Ranked Teams Only
                </button>
              </div>

              {visibleGames.length === 0 ? (
                <div style={{ padding: "40px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "14px" }}>
                  {rankedOnly ? `No ranked-team games found for ${selectedWeek}.` : `No games found for ${selectedWeek}.`}
                </div>
              ) : (
                <div style={{ border: `2px solid ${SITE_BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
                  <div style={{ background: SITE_BLUE, padding: "10px 16px" }}>
                    <div style={{ color: SITE_GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                      {selectedWeek} · {visibleGames.length} Game{visibleGames.length !== 1 ? "s" : ""}{rankedOnly ? " (Ranked)" : ""}
                    </div>
                  </div>
                  <div style={{ height: "3px", background: SITE_GOLD }} />
                  {visibleGames.map((g, i) => {
                    const d = g.Date?.toDate?.();
                    const timeStr = formatTime12h(g.Time);
                    const played = g.Final && g.HomeScore != null && g.AwayScore != null;
                    const away = schoolsByName[g.Away];
                    const home = schoolsByName[g.Home];
                    const awayWon = played && g.AwayScore > g.HomeScore;
                    const homeWon = played && g.HomeScore > g.AwayScore;

                    const awayColor = away?.Color1 || "#ccc";
                    const homeColor = home?.Color1 || "#ccc";
                    const { homeRank, awayRank } = ranksForGame(g, currentRankMap);
                    const channelShort = g.Channel ? (channelsByName[g.Channel]?.Short || g.Channel) : "";

                    const TeamRow = ({ school, data, score, won, rank }) => (
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        {data?.Logo1 ? (
                          <img src={data.Logo1} alt="" style={{ width: "36px", height: "36px", objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                        ) : (
                          <div style={{ width: "36px", height: "36px", flexShrink: 0, borderRadius: "6px", background: "#eee", display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa", fontSize: "13px", fontWeight: 900 }}>
                            {(school || "?").charAt(0)}
                          </div>
                        )}
                        <span style={{ fontWeight: 900, fontSize: "15px", color: played ? (won ? "#222" : "#999") : "#222" }}>
                          {rank && <span style={{ color: "#aaa" }}>#{rank} </span>}
                          {school}
                        </span>
                        {played && (
                          <span style={{ marginLeft: "auto", fontWeight: 900, fontSize: "18px", color: won ? SITE_BLUE : "#bbb" }}>{score}</span>
                        )}
                      </div>
                    );

                    return (
                      <Link
                        key={g.id}
                        to={g.Slug ? `/game/${g.Slug}` : "#"}
                        className={`wd-schedule-row${g.GameOfWeek ? " wd-schedule-row-gotw" : g.Featured ? " wd-schedule-row-featured" : ""}`}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px",
                          padding: "14px 16px 14px 20px", textDecoration: "none",
                          // A thin two-tone sliver (away color on top, home
                          // color on bottom) at the row's left edge — the same
                          // team-color association the game page's hero makes,
                          // just compressed down to a 4px accent instead of a
                          // full banner.
                          background: `linear-gradient(to bottom, ${awayColor} 50%, ${homeColor} 50%) left / 4px 100% no-repeat, #fff`,
                          borderBottom: i < visibleGames.length - 1 ? "1px solid #f0f0f0" : "none",
                          pointerEvents: g.Slug ? "auto" : "none",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                          <TeamRow school={g.Away} data={away} score={g.AwayScore} won={awayWon} rank={awayRank} />
                          <TeamRow school={g.Home} data={home} score={g.HomeScore} won={homeWon} rank={homeRank} />
                        </div>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "#aaa", flexShrink: 0, textAlign: "right" }}>
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
                          <div style={{ fontSize: "16px", fontWeight: 900, color: "#555", lineHeight: 1.25 }}>
                            {d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) : "TBD"}
                            {timeStr && <div>{timeStr}</div>}
                          </div>
                          {channelShort && (
                            <div style={{ fontSize: "11px", fontWeight: 700, color: "#bbb", marginTop: "3px" }}>
                              📺 {channelShort}
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
      )}
    </div>
  );
}