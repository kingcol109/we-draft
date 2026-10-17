import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { cfbSeo } from "../utils/cfbSeo";
import { scheduleGameHref } from "../utils/live";
import { db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";
import LoadingSpinner from "../components/LoadingSpinner";
import CfbLeaders from "../components/CfbLeaders";
import { useCurrentRankMap, ranksForGame } from "../utils/rankings";
// We-Draft Live scores for in-progress / just-finished games (one listener
// on liveSlate/current — see hooks/useLiveSlate.js).
import { useLiveSlate, scheduleScore } from "../hooks/useLiveSlate";

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

// Schedule dates are stored as UTC midnight (hence timeZone: "UTC" on every
// date display here), so the day bucket comes off the UTC date. "~" sorts
// after every real date, so date-less games land at the end.
const dayKey = (g) => {
  const d = g.Date?.toDate?.();
  return d && !isNaN(d) ? d.toISOString().slice(0, 10) : "~";
};
const localDayKey = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayLabel = (k) => {
  if (k === "~") return { label: "Date TBD" };
  const d = new Date(`${k}T00:00:00Z`);
  const label = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
  const tag = k === localDayKey(0) ? "Today" : k === localDayKey(1) ? "Tomorrow" : k === localDayKey(-1) ? "Yesterday" : null;
  return { label, tag };
};
// Team colors are admin-entered hex — tint only when it's actually #rrggbb.
const tint = (hex, alpha) => (/^#[0-9a-f]{6}$/i.test(hex || "") ? `${hex}${alpha}` : "transparent");

const chipStyle = (bg, color = "#fff") => ({
  display: "inline-flex", alignItems: "center", gap: "5px",
  background: bg, color, fontWeight: 900, fontSize: "10px", padding: "3px 9px", borderRadius: "20px",
  textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap",
});

function ScoreTeamLine({ school, data, score, rank, scored, live, won, lost, color }) {
  const faded = lost && !live;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "12px", padding: "8px 14px",
      background: won ? `linear-gradient(to right, ${tint(color, "1f")}, rgba(255,255,255,0) 70%)` : "transparent",
    }}>
      {data?.Logo1 ? (
        <img
          src={data.Logo1}
          alt=""
          className="wd-sc-logo"
          loading="lazy"
          style={{ width: "42px", height: "42px", objectFit: "contain", flexShrink: 0, opacity: faded ? 0.55 : 1, filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.18))" }}
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
      ) : (
        <div style={{ width: "42px", height: "42px", flexShrink: 0, borderRadius: "50%", background: color || "#ddd", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "15px", fontWeight: 900 }}>
          {(school || "?").charAt(0)}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "7px" }}>
        {rank && (
          <span style={{ flexShrink: 0, fontSize: "11px", fontWeight: 900, color: SITE_BLUE, background: "#fff4e0", border: `1px solid ${SITE_GOLD}`, borderRadius: "6px", padding: "1px 5px" }}>
            {rank}
          </span>
        )}
        <span style={{
          fontWeight: 900, fontSize: "16px", color: faded ? "#a8b0bb" : "#1a1f2b",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {school}
        </span>
      </div>
      {scored && (
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          <span
            key={live ? `${school}-${score}` : "static"}
            className={live ? "wd-score-pop" : undefined}
            style={{ fontWeight: 900, fontSize: "28px", lineHeight: 1, fontVariantNumeric: "tabular-nums", color: faded ? "#c2c8d0" : won ? SITE_BLUE : "#1a1f2b" }}
          >
            {score}
          </span>
          <span style={{ width: "8px", color: SITE_GOLD, fontSize: "12px" }}>{won ? "◀" : ""}</span>
        </div>
      )}
    </div>
  );
}

// One school on the Teams tab — team-color panel with the logo (dark
// variant, since it sits on the team's color), a Top 25 pill when ranked,
// and the name on a white footer.
function TeamCard({ team, rank, isMobile }) {
  const primary = team.Color1 || SITE_BLUE;
  const secondary = team.Color2 || SITE_GOLD;
  const logoSrc = team.LogoDark || team.Logo1 || "";
  const logoSize = isMobile ? "58px" : "80px";
  return (
    <Link to={`/team/${team.Slug}`} className="wd-tc">
      <div
        className="wd-tc-panel"
        style={{
          position: "relative", overflow: "hidden",
          height: isMobile ? "80px" : "108px",
          display: "flex", alignItems: "center", justifyContent: "center",
          // Soft spotlight behind the logo, darker toward the edges.
          background: `radial-gradient(circle at 50% 42%, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0) 45%, rgba(0,0,0,0.28) 100%), ${primary}`,
        }}
      >
        {rank && (
          <span style={{
            position: "absolute", top: "6px", left: "6px", zIndex: 1,
            fontSize: isMobile ? "10px" : "11px", fontWeight: 900, color: SITE_BLUE,
            background: "#fff4e0", border: `1px solid ${SITE_GOLD}`, borderRadius: "6px", padding: "1px 5px",
            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
          }}>
            #{rank}
          </span>
        )}
        {logoSrc ? (
          <img
            src={logoSrc}
            alt={team.School}
            className="wd-tc-logo"
            loading="lazy"
            style={{ position: "relative", width: logoSize, height: logoSize, objectFit: "contain", filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.4))" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : (
          <div className="wd-tc-logo" style={{
            position: "relative", width: logoSize, height: logoSize, borderRadius: "50%", background: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: primary, fontSize: isMobile ? "16px" : "20px", fontWeight: 900,
          }}>
            {team.School.charAt(0)}
          </div>
        )}
      </div>
      <div style={{ height: "3px", background: secondary }} />
      <div style={{
        padding: isMobile ? "7px 4px" : "9px 8px", textAlign: "center",
        fontSize: isMobile ? "10px" : "12px", fontWeight: 900, color: "#1a1f2b",
        textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.2,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {team.School}
      </div>
    </Link>
  );
}

// One game on the Full Schedule — team-color band, big logos and scores,
// a pulsing ring + score pop while live, and Top 25 / Upset callouts.
function ScoreCard({ g, s, away, home, awayRank, homeRank, channelShort }) {
  const awayColor = away?.Color1 || "#ccc";
  const homeColor = home?.Color1 || "#ccc";
  const done = s.scored && !s.live;
  const timeStr = formatTime12h(g.Time);
  const bothRanked = !!(homeRank && awayRank);
  const winnerRank = s.homeWon ? homeRank : s.awayWon ? awayRank : null;
  const loserRank = s.homeWon ? awayRank : s.awayWon ? homeRank : null;
  const upset = done && !!loserRank && (!winnerRank || winnerRank > loserRank);

  let status;
  if (s.live) {
    status = <span style={chipStyle("#d62828")}><span className="wd-live-dot" style={{ background: "#fff" }} />{s.label || "LIVE"}</span>;
  } else if (done) {
    // Provider-final labels carry a date the day header already shows.
    status = <span style={chipStyle("#1a1f2b")}>{(s.label || "FINAL").split(" · ")[0]}</span>;
  } else {
    status = (
      <span style={{ fontWeight: 900, fontSize: "13px", color: "#1a1f2b", whiteSpace: "nowrap" }}>
        {timeStr || "Time TBD"}
      </span>
    );
  }

  return (
    <Link
      to={scheduleGameHref(g) || "#"}
      className={`wd-sc${s.live ? " wd-sc-live" : g.GameOfWeek ? " wd-sc-gotw" : g.Featured ? " wd-sc-featured" : ""}`}
      style={{ pointerEvents: g.Slug ? "auto" : "none" }}
    >
      <div style={{ height: "6px", background: `linear-gradient(100deg, ${awayColor} 0 50%, ${homeColor} 50% 100%)` }} />
      <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 14px 4px", minHeight: "30px" }}>
        {status}
        <div style={{ marginLeft: "auto", display: "flex", gap: "5px", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {upset && <span style={chipStyle("#d62828")}>⚡ Upset</span>}
          {g.GameOfWeek ? <span style={chipStyle("#7c3aed")}>GOTW</span>
            : g.Featured ? <span style={chipStyle(SITE_GOLD)}>Featured</span> : null}
          {bothRanked && !upset && <span style={chipStyle("#fff4e0", SITE_BLUE)}>🏆 Top 25 Clash</span>}
        </div>
      </div>
      <div style={{ padding: "2px 0 6px" }}>
        <ScoreTeamLine school={g.Away} data={away} score={s.away} rank={awayRank} scored={s.scored} live={s.live} won={s.awayWon} lost={s.homeWon} color={away?.Color1} />
        <ScoreTeamLine school={g.Home} data={home} score={s.home} rank={homeRank} scored={s.scored} live={s.live} won={s.homeWon} lost={s.awayWon} color={home?.Color1} />
      </div>
      {(channelShort || g.Slug) && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 14px", borderTop: "1px solid #eef1f5", background: "#fafbfd", fontSize: "11px", fontWeight: 900, color: "#8a95a5", marginTop: "auto" }}>
          {channelShort && <span>📺 {channelShort}</span>}
          {g.Slug && (
            <span style={{ marginLeft: "auto", color: SITE_BLUE, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              {s.live ? "Follow Live →" : done ? "Game Recap →" : "Preview →"}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}

export default function CFBPage() {
  // Tab lives in the URL (/cfb, /cfb/schedule[/:week], /cfb/stats[/:cat]) instead of local
  // state, so it survives a reload and is actually linkable/shareable —
  // it used to always reset back to Teams on navigation.
  const location = useLocation();
  const navigate = useNavigate();
  const { week: weekParam, cat: statCat } = useParams();
  const activeTab = location.pathname.startsWith("/cfb/schedule") ? "schedule"
    : location.pathname.startsWith("/cfb/stats") ? "stats" : "teams";
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
  const liveById = useLiveSlate();
  const [loading, setLoading] = useState(true);
  // Prerender: hold the snapshot until the page's data is in (stats views
  // signal their own — CfbLeaders.js), with a safety timeout.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    window.prerenderReady = false;
    const t = setTimeout(() => { window.prerenderReady = true; }, 8000);
    return () => clearTimeout(t);
  }, [location.pathname]);
  useEffect(() => {
    if (!loading && activeTab !== "stats") window.prerenderReady = true;
  }, [loading, activeTab]);
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
        // kicked off.
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
        // Once that week's entire slate has already gone Final, jump ahead
        // to the next one — a schedule page should already be showing
        // what's coming up next, not last week's now-final scores, for the
        // several days between a week wrapping and the next one's own
        // first kickoff (unlike We-Pick's own default-week pick, which
        // deliberately stays put until the next week actually starts, since
        // that one still has live results/a Report Card worth showing).
        const currentIdx = allWeeks.indexOf(current);
        if (currentIdx >= 0 && currentIdx < allWeeks.length - 1) {
          const currentWeekGames = gameDocs.filter((g) => g.Week === current);
          const isFinal = (g) => g.Final && g.HomeScore != null && g.AwayScore != null;
          if (currentWeekGames.length > 0 && currentWeekGames.every(isFinal)) {
            current = allWeeks[currentIdx + 1];
          }
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

  // Upcoming / Completed sub-tab of Full Schedule, in the query string
  // (?view=) so it's linkable. With none given it picks whichever side
  // actually has games — a fully-played week opens straight to its scores.
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get("view");
  const { liveGames, upcomingGames, completedGames } = useMemo(() => {
    const live = [], upcoming = [], completed = [];
    visibleGames.forEach((g) => {
      const s = scheduleScore(g, liveById);
      if (s.live) live.push({ g, s });
      else if (s.scored) completed.push({ g, s });
      else upcoming.push({ g, s });
    });
    return { liveGames: live, upcomingGames: upcoming, completedGames: completed };
  }, [visibleGames, liveById]);
  const scheduleView = viewParam === "completed" || viewParam === "upcoming" ? viewParam
    : liveGames.length + upcomingGames.length === 0 && completedGames.length > 0 ? "completed" : "upcoming";

  // Day-grouped sections for the active view: live games first, then
  // upcoming days soonest-first; completed days most-recent-first.
  const scheduleSections = useMemo(() => {
    const byDay = (list) => {
      const map = new Map();
      list.forEach((entry) => {
        const k = dayKey(entry.g);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(entry);
      });
      return Array.from(map.entries()).map(([k, games]) => ({ key: k, ...dayLabel(k), games }));
    };
    if (scheduleView === "completed") {
      return byDay(completedGames).sort((a, b) => b.key.localeCompare(a.key));
    }
    const days = byDay(upcomingGames).sort((a, b) => a.key.localeCompare(b.key));
    return liveGames.length ? [{ key: "live", label: "Live Now", live: true, games: liveGames }, ...days] : days;
  }, [scheduleView, liveGames, upcomingGames, completedGames]);

  const grouped = conferenceOrder.reduce((acc, conf) => {
    acc[conf] = schools
      .filter((s) => s.Conference === conf)
      .sort((a, b) => a.School.localeCompare(b.School));
    return acc;
  }, {});

  // Conference filter on the Teams tab, in the query string (?conf=) like
  // the schedule's ?view= — anything unrecognized falls back to All.
  const confParam = searchParams.get("conf");
  const activeConf = conferenceOrder.includes(confParam) ? confParam : "All";
  const visibleConfs = activeConf === "All" ? conferenceOrder : [activeConf];

  // SEO: each view's own title / description / canonical (utils/cfbSeo.js)
  // — static, so it's right from the first render, spinner included.
  const seo = cfbSeo({ tab: activeTab, cat: statCat, week: weekParam });
  const seoUrl = `https://we-draft.com${seo.path}`;
  const seoHead = (
    <Helmet>
      <title>{seo.title}</title>
      <meta name="description" content={seo.description} />
      <link rel="canonical" href={seoUrl} />
      <meta property="og:title" content={seo.title} />
      <meta property="og:description" content={seo.description} />
      <meta property="og:url" content={seoUrl} />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary" />
    </Helmet>
  );

  if (loading) {
    return <>{seoHead}<LoadingSpinner label="Loading Teams" size={56} minHeight="calc(100vh / var(--pz, 1))" /></>;
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
      {seoHead}
      {/* The stats views' H1 is CfbLeaders' own visible heading; Teams and
          Schedule have no visible page heading, so theirs is screen-reader /
          crawler only. */}
      {activeTab !== "stats" && (
        <h1 style={{ position: "absolute", width: "1px", height: "1px", padding: 0, margin: "-1px", overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}>
          {seo.h1}
        </h1>
      )}
      <style>{`
        /* ===== Teams grid cards ===== */
        .wd-tc {
          position: relative; display: flex; flex-direction: column;
          border-radius: 12px; overflow: hidden; text-decoration: none; background: #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2;
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }
        .wd-tc:hover {
          transform: translateY(-3px);
          box-shadow: 0 14px 30px rgba(0,40,90,0.18), 0 0 0 1px #d3dcea;
        }
        .wd-tc-logo { transition: transform 0.22s ease; }
        .wd-tc:hover .wd-tc-logo { transform: scale(1.16) rotate(-5deg); }
        /* Light sweep across the color panel on hover. */
        .wd-tc-panel::after {
          content: ""; position: absolute; top: 0; bottom: 0; left: -60%; width: 40%;
          background: linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0) 100%);
          transform: skewX(-18deg); pointer-events: none;
        }
        .wd-tc:hover .wd-tc-panel::after { animation: wdTcShine 0.7s ease-out; }
        @keyframes wdTcShine {
          from { left: -60%; }
          to { left: 130%; }
        }
        .wd-conf-tab { transition: background 0.15s ease, color 0.15s ease; }
        @media (prefers-reduced-motion: reduce) {
          .wd-tc, .wd-tc-logo { transition: none !important; }
          .wd-tc:hover { transform: none; }
          .wd-tc:hover .wd-tc-panel::after { animation: none; }
        }
        /* ===== Full Schedule scoreboards ===== */
        .wd-sc {
          position: relative; display: flex; flex-direction: column;
          background: #fff; border-radius: 12px; overflow: hidden; text-decoration: none;
          box-shadow: 0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2;
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }
        .wd-sc:hover {
          transform: translateY(-3px);
          box-shadow: 0 14px 30px rgba(0,40,90,0.16), 0 0 0 1px #d3dcea;
        }
        .wd-sc-logo { transition: transform 0.2s ease; }
        .wd-sc:hover .wd-sc-logo { transform: scale(1.12) rotate(-4deg); }
        @keyframes wdScLive {
          0%, 100% { box-shadow: 0 0 0 2px rgba(214,40,40,0.5), 0 6px 18px rgba(214,40,40,0.14); }
          50% { box-shadow: 0 0 0 2px rgba(214,40,40,0.95), 0 8px 26px rgba(214,40,40,0.3); }
        }
        .wd-sc-live { animation: wdScLive 2s ease-in-out infinite; }
        /* Same Featured gold / Game of the Week purple tiers as the game
           page (GamePage.js), as an outer ring now that rows are cards. */
        @keyframes wdScFeatured {
          0%, 100% { box-shadow: 0 0 0 2px rgba(246,162,29,0.35), 0 4px 14px rgba(246,162,29,0.1); }
          50% { box-shadow: 0 0 0 2px rgba(246,162,29,0.8), 0 6px 20px rgba(246,162,29,0.22); }
        }
        .wd-sc-featured { animation: wdScFeatured 2.2s ease-in-out infinite; }
        @keyframes wdScGotw {
          0%, 100% { box-shadow: 0 0 0 2px rgba(124,58,237,0.35), 0 4px 14px rgba(124,58,237,0.1); }
          50% { box-shadow: 0 0 0 2px rgba(124,58,237,0.75), 0 6px 22px rgba(124,58,237,0.22); }
        }
        .wd-sc-gotw { animation: wdScGotw 3.4s ease-in-out infinite; }
        @keyframes wdLiveDot {
          0% { box-shadow: 0 0 0 0 rgba(214,40,40,0.6); }
          100% { box-shadow: 0 0 0 7px rgba(214,40,40,0); }
        }
        .wd-live-dot {
          width: 8px; height: 8px; border-radius: 50%; background: #d62828;
          display: inline-block; flex-shrink: 0; animation: wdLiveDot 1.4s ease-out infinite;
        }
        /* Keyed on the score itself, so it replays every time a live
           score changes. */
        @keyframes wdScorePop {
          0% { transform: scale(1.4); color: #d62828; }
          100% { transform: scale(1); }
        }
        .wd-score-pop { display: inline-block; animation: wdScorePop 0.6s ease-out; }
        .wd-view-tab { transition: background 0.15s ease, color 0.15s ease; }
        @media (prefers-reduced-motion: reduce) {
          .wd-sc, .wd-sc-logo, .wd-live-dot, .wd-score-pop { animation: none !important; transition: none !important; }
          .wd-sc:hover { transform: none; }
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
          College Football
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
          { key: "stats", label: "Stats", to: "/cfb/stats" },
        ].map((tab) => (
          <Link
            key={tab.key}
            to={tab.to}
            style={{
              border: `2px solid ${SITE_BLUE}`, borderRadius: "8px", padding: isMobile ? "10px 12px" : "10px 20px", whiteSpace: "nowrap",
              fontWeight: 900, fontSize: isMobile ? "12px" : "13px", textTransform: "uppercase", letterSpacing: "0.04em",
              background: activeTab === tab.key ? SITE_BLUE : "#fff", color: activeTab === tab.key ? "#fff" : SITE_BLUE,
              cursor: "pointer", textDecoration: "none", display: "inline-block",
            }}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* ===== Conference filter ===== */}
      {activeTab === "teams" && (
        <div
          role="tablist"
          style={{
            display: "flex", flexWrap: "wrap", padding: "4px", gap: "4px", marginBottom: isMobile ? "20px" : "28px",
            background: "#eef3f9", borderRadius: "12px",
          }}
        >
          {["All", ...conferenceOrder.filter((c) => grouped[c]?.length)].map((c) => {
            const on = activeConf === c;
            const count = c === "All" ? schools.length : grouped[c].length;
            return (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={on}
                className="wd-conf-tab"
                onClick={() => setSearchParams(c === "All" ? {} : { conf: c }, { replace: true })}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "6px",
                  padding: isMobile ? "7px 10px" : "8px 14px", border: "none", borderRadius: "9px", cursor: "pointer",
                  fontWeight: 900, fontSize: isMobile ? "11px" : "12px", textTransform: "uppercase", letterSpacing: "0.04em",
                  background: on ? SITE_BLUE : "transparent", color: on ? "#fff" : SITE_BLUE,
                  boxShadow: on ? "0 3px 10px rgba(0,85,165,0.3)" : "none", whiteSpace: "nowrap",
                }}
              >
                {c}
                <span style={{
                  padding: "1px 6px", borderRadius: "20px", fontSize: "10px",
                  background: on ? SITE_GOLD : "#fff", color: on ? "#fff" : SITE_BLUE,
                }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ===== Conference Sections ===== */}
      {activeTab === "teams" && visibleConfs.map((conf) => {
        const teams = grouped[conf];
        if (!teams || teams.length === 0) return null;
        const rankedCount = teams.filter((t) => currentRankMap[t.School]).length;

        return (
          <section key={conf} style={{ marginBottom: isMobile ? "26px" : "36px" }}>
            {/* Conference header — same look as the schedule's day headers */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: isMobile ? "10px" : "14px" }}>
              <div style={{
                fontWeight: 900, fontSize: isMobile ? "16px" : "20px", textTransform: "uppercase", letterSpacing: "0.08em",
                color: SITE_BLUE, whiteSpace: "nowrap",
              }}>
                {conf}
              </div>
              {rankedCount > 0 && (
                <span style={chipStyle("#fff4e0", SITE_BLUE)}>🏆 {rankedCount} Ranked</span>
              )}
              <div style={{ flex: 1, height: "2px", background: `linear-gradient(to right, ${SITE_GOLD}, rgba(246,162,29,0))` }} />
              <div style={{ fontSize: "11px", fontWeight: 900, color: "#9aa5b4", whiteSpace: "nowrap" }}>
                {teams.length} Team{teams.length !== 1 ? "s" : ""}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(auto-fill, minmax(150px, 1fr))",
                gap: isMobile ? "10px" : "14px",
              }}
            >
              {teams.map((team) => (
                <TeamCard key={team.id} team={team} rank={currentRankMap[team.School]} isMobile={isMobile} />
              ))}
            </div>
          </section>
        );
      })}

      {/* ===== Stat Leaders ===== */}
      {activeTab === "stats" && (
        <CfbLeaders schoolsByName={schoolsByName} catKey={statCat} isMobile={isMobile} />
      )}

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

              {/* Upcoming / Completed toggle — live games count as upcoming
                  (they're not done yet) and lead that tab. */}
              <div
                role="tablist"
                style={{
                  display: "inline-flex", padding: "4px", gap: "4px", marginBottom: "18px",
                  background: "#eef3f9", borderRadius: "12px", maxWidth: "100%",
                }}
              >
                {[
                  { key: "upcoming", label: "Upcoming", count: liveGames.length + upcomingGames.length },
                  { key: "completed", label: "Completed", count: completedGames.length },
                ].map((t) => {
                  const on = scheduleView === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      className="wd-view-tab"
                      onClick={() => setSearchParams({ view: t.key }, { replace: true })}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: "8px",
                        padding: isMobile ? "9px 14px" : "10px 20px", border: "none", borderRadius: "9px", cursor: "pointer",
                        fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em",
                        background: on ? SITE_BLUE : "transparent", color: on ? "#fff" : SITE_BLUE,
                        boxShadow: on ? "0 3px 10px rgba(0,85,165,0.3)" : "none",
                      }}
                    >
                      {t.key === "upcoming" && liveGames.length > 0 && <span className="wd-live-dot" />}
                      {t.label}
                      <span style={{
                        minWidth: "22px", padding: "2px 7px", borderRadius: "20px", fontSize: "11px",
                        background: on ? SITE_GOLD : "#fff", color: on ? "#fff" : SITE_BLUE,
                      }}>
                        {t.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {scheduleSections.length === 0 ? (
                <div style={{ padding: "40px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "14px", background: "#f7f9fc", borderRadius: "12px" }}>
                  {scheduleView === "completed"
                    ? `No completed ${rankedOnly ? "ranked-team " : ""}games yet for ${selectedWeek}.`
                    : `No upcoming ${rankedOnly ? "ranked-team " : ""}games left in ${selectedWeek}.`}
                </div>
              ) : (
                scheduleSections.map((sec) => (
                  <section key={sec.key} style={{ marginBottom: isMobile ? "22px" : "30px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                      {sec.live && <span className="wd-live-dot" />}
                      <div style={{
                        fontWeight: 900, fontSize: isMobile ? "14px" : "16px", textTransform: "uppercase", letterSpacing: "0.08em",
                        color: sec.live ? "#d62828" : SITE_BLUE, whiteSpace: "nowrap",
                      }}>
                        {sec.label}
                      </div>
                      {sec.tag && (
                        <span style={{ background: SITE_GOLD, color: "#fff", fontWeight: 900, fontSize: "10px", padding: "3px 8px", borderRadius: "20px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          {sec.tag}
                        </span>
                      )}
                      <div style={{ flex: 1, height: "2px", background: sec.live ? "rgba(214,40,40,0.25)" : `linear-gradient(to right, ${SITE_GOLD}, rgba(246,162,29,0))` }} />
                      <div style={{ fontSize: "11px", fontWeight: 900, color: "#9aa5b4", whiteSpace: "nowrap" }}>
                        {sec.games.length} Game{sec.games.length !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <div style={{
                      display: "grid", gap: isMobile ? "12px" : "16px",
                      gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))",
                    }}>
                      {sec.games.map(({ g, s }) => {
                        const { homeRank, awayRank } = ranksForGame(g, currentRankMap);
                        return (
                          <ScoreCard
                            key={g.id}
                            g={g}
                            s={s}
                            away={schoolsByName[g.Away]}
                            home={schoolsByName[g.Home]}
                            awayRank={awayRank}
                            homeRank={homeRank}
                            channelShort={g.Channel ? (channelsByName[g.Channel]?.Short || g.Channel) : ""}
                          />
                        );
                      })}
                    </div>
                  </section>
                ))
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}