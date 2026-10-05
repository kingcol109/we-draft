// src/components/GameMarginSidebars.js
//
// GamePage.js's margin sidebars — a third pairing alongside MarginAds.js
// (player/article pages) and MarginSidebars.js (the News hub). Left: every
// other game on the same week's slate, so a reader can jump straight to
// another game without going back to the full schedule. Right: Other
// Featured Games, so a reader on a showcase matchup finds their way to the
// site's other showcase matchups. Same fixed-position gutter-measurement
// technique as the other two — measure contentRef's bounding rect vs
// viewport, position:fixed + translateY(-50%).
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useLiveSlate, scheduleScore } from "../hooks/useLiveSlate";
import { useCurrentRankMap, ranksForGame } from "../utils/rankings";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

function sanitizeUrl(url) {
  if (!url) return "";
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

const toMs = (ts) => {
  if (!ts) return 0;
  if (ts?.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? 0 : parsed;
};

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

// Monday 00:00 UTC → Sunday 23:59:59 UTC around right now — schedule26's
// Date field is stored as UTC midnight (a date-only value), so the week
// boundary has to be computed in UTC too or the edges drift by a day for
// anyone west of it.
function currentWeekBoundsUtc() {
  const now = new Date();
  const utcDay = now.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (utcDay === 0 ? -6 : 1) - utcDay;
  const monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diffToMonday, 0, 0, 0, 0);
  const sunday = monday + 7 * 24 * 60 * 60 * 1000 - 1;
  return { start: monday, end: sunday };
}

// Both cards' rows (GameBug): a two-tone team-color stripe down the left
// edge, ranks, the winner's score in blue (loser dimmed), a pulsing red live line while it's on, and — on the Top Games
// card — a purple Game of the Week / gold Featured tag. Hover nudges a ›.
const SIDEBAR_STYLE = `
.gms-row { display: block; position: relative; text-decoration: none; transition: background 0.15s ease; }
.gms-row:hover { background: #f0f5ff !important; }
.gms-row:hover .gms-go { opacity: 1; transform: translateX(0); }
.gms-go { position: absolute; right: 5px; top: 50%; margin-top: -8px; font-size: 13px; font-weight: 900; color: ${BLUE}; opacity: 0; transform: translateX(-4px); transition: opacity 0.15s ease, transform 0.15s ease; }
.gms-live { background: linear-gradient(90deg, rgba(214,40,40,0.08), #fff 75%); }
.gms-gotw { background: linear-gradient(135deg, #f4edff, #fff 65%); animation: gmsGlow 3.4s ease-in-out infinite; }
@keyframes gmsGlow { 0%, 100% { box-shadow: inset 0 0 0 2px rgba(124,58,237,0.22); } 50% { box-shadow: inset 0 0 0 2px rgba(124,58,237,0.6); } }
@keyframes gmsPulse { 0% { box-shadow: 0 0 0 0 rgba(214,40,40,0.6); } 70% { box-shadow: 0 0 0 6px rgba(214,40,40,0); } 100% { box-shadow: 0 0 0 0 rgba(214,40,40,0); } }
.gms-dot { width: 7px; height: 7px; border-radius: 50%; background: #d62828; display: inline-block; flex-shrink: 0; animation: gmsPulse 1.6s infinite; }
`;

function GameBug({ g, s, away, home, ranks, channelShort, big, showTag, last }) {
  const played = s.scored;
  const final = played && !s.live;
  const gotw = showTag && g.GameOfWeek;
  const logoSize = big ? "22px" : "18px";
  const dateMs = toMs(g.Date);
  const dateLabel = dateMs ? new Date(dateMs).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "TBD";
  const timeStr = formatTime12h(g.Time);
  const team = (data, school, score, won, rank) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", padding: "2px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
        {data?.Logo1 ? (
          <img src={sanitizeUrl(data.Logo1)} alt="" loading="lazy" style={{ width: logoSize, height: logoSize, objectFit: "contain", flexShrink: 0, opacity: final && !won ? 0.55 : 1 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
        ) : (
          <span style={{ width: logoSize, height: logoSize, flexShrink: 0, borderRadius: "50%", background: "#e5e9f0", display: "inline-block" }} />
        )}
        <span style={{ fontSize: big ? "13px" : "12px", fontWeight: 900, color: final && !won ? "#a3abb8" : "#1d2733", letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {rank && <span style={{ fontSize: "10px", color: final && !won ? "#c3c9d3" : "#8a95a5", marginRight: "3px" }}>#{rank}</span>}
          {data?.Short || school}
        </span>
      </div>
      {played && (
        <span style={{ fontSize: big ? "20px" : "17px", fontWeight: 900, color: s.live ? "#1d2733" : won ? BLUE : "#b8bfca", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{score}</span>
      )}
    </div>
  );
  return (
    <Link
      to={`/game/${g.Slug}`}
      className={`gms-row${gotw ? " gms-gotw" : s.live ? " gms-live" : ""}`}
      style={{
        padding: big ? "10px 14px 10px 15px" : "9px 13px 9px 13px",
        background: gotw || s.live ? undefined : "#fff",
        borderBottom: last ? "none" : "1px solid #eef1f5",
      }}
    >
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "4px", background: `linear-gradient(to bottom, ${away?.Color1 || "#cfd6e0"} 50%, ${home?.Color1 || "#cfd6e0"} 50%)` }} />
      {showTag && (g.GameOfWeek || g.Featured) && (
        <span style={{
          display: "inline-block", marginBottom: "5px", padding: "2px 7px", borderRadius: "20px",
          fontSize: "8.5px", fontWeight: 900, letterSpacing: "0.07em", textTransform: "uppercase", color: "#fff",
          background: g.GameOfWeek ? "linear-gradient(90deg, #7c3aed, #a855f7)" : GOLD,
        }}>
          {g.GameOfWeek ? "🔥 Game of the Week" : "★ Featured"}
        </span>
      )}
      {team(away, g.Away, s.away, s.awayWon, ranks.awayRank)}
      {team(home, g.Home, s.home, s.homeWon, ranks.homeRank)}
      <div style={{
        display: "flex", alignItems: "center", gap: "5px", marginTop: "4px", fontSize: "10px", fontWeight: 900, letterSpacing: "0.04em", fontVariantNumeric: "tabular-nums",
        color: s.live ? "#d62828" : final ? "#7a8597" : "#5b6b7f",
      }}>
        {s.live && <span className="gms-dot" />}
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {s.live ? s.label : final ? "FINAL" : `${dateLabel}${timeStr ? ` · ${timeStr}` : ""}`}
        </span>
        {!final && channelShort && <span style={{ marginLeft: "auto", flexShrink: 0, padding: "1px 5px", borderRadius: "4px", background: "#eef2f8", color: "#5b6b7f", fontWeight: 800 }}>{channelShort}</span>}
      </div>
      <span className="gms-go">›</span>
    </Link>
  );
}

// Card header: blue with a gold label, plus a pulsing count of live games.
function CardHead({ label, liveCount }) {
  return (
    <>
      <div style={{ background: `linear-gradient(135deg, ${BLUE}, #003a7a)`, padding: "9px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
        <div style={{ color: GOLD, fontWeight: 900, fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'Arial Black', Arial, sans-serif" }}>{label}</div>
        {liveCount > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "9px", fontWeight: 900, color: "#fff", background: "#d62828", padding: "2px 6px", borderRadius: "20px", letterSpacing: "0.05em", flexShrink: 0 }}>
            <span className="gms-dot" style={{ background: "#fff", width: "5px", height: "5px" }} />{liveCount} LIVE
          </span>
        )}
      </div>
      <div style={{ height: "3px", background: GOLD }} />
    </>
  );
}

// A visibly solid card (site-standard 2px blue border, same language as
// every other bordered card on the site) with a light, grounded shadow
// rather than a heavy "floating" one — paired with anchoring the whole
// sidebar to scroll with the page (see positionStyle below).
const cardShell = {
  width: "100%", borderRadius: "10px", overflow: "hidden",
  border: `2px solid ${BLUE}`, background: "#fff",
  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
};

/**
 * @param {React.RefObject} contentRef - ref on the page's main content
 *   container, used to measure the left/right gutters.
 * @param {boolean} isMobile - hidden entirely on mobile (no gutter room).
 * @param {number} horizontalPadding - contentRef's own left/right padding.
 * @param {string} excludeGameId - the current game's doc id, kept out of the
 *   "Other Featured Games" list on the right (and out of the week-slate list
 *   on the left, since a link back to the page you're already on is dead
 *   weight).
 * @param {string} gameWeek - the current game's own Week field (e.g. "Week
 *   0"), not necessarily the current calendar week — drives the "This
 *   Week's Slate" card so it always matches the game being viewed, even for
 *   a past or future week's page.
 * @param {string} weekSlateUrl - full-schedule link for that same week, used
 *   as the slate card's "See Full Slate" footer link.
 */
export default function GameMarginSidebars({ contentRef, isMobile, horizontalPadding = 20, excludeGameId, gameWeek, weekSlateUrl }) {
  const [layout, setLayout] = useState({ width: 160, leftGutter: 0, rightGutter: 0, topOffset: 40, show: false });
  const [visible, setVisible] = useState(false);
  const [weekSlate, setWeekSlate] = useState([]);
  const [featuredGames, setFeaturedGames] = useState([]);
  const [newsItems, setNewsItems] = useState([]);
  const [schoolsByName, setSchoolsByName] = useState({});
  const [channelsByName, setChannelsByName] = useState({});
  // Live scores (We-Draft Live) for both game cards — an in-progress game
  // shows its running score + quarter/clock; a finished one shows the live
  // final until an admin marks the schedule26 doc Final, after which the
  // admin-entered score takes over as before.
  const liveById = useLiveSlate(!isMobile);
  const currentRankMap = useCurrentRankMap();
  // This component renders after (below, in DOM order) the main content it
  // measures — anchorRef marks *this* component's own position so the
  // sidebar cards, positioned absolute beneath it, can be offset by the
  // (negative) distance back up to where the content starts, landing them
  // near its top while still scrolling naturally with the page (unlike the
  // old position:fixed, which ignored scroll entirely).
  const anchorRef = useRef(null);

  const recompute = useRef(() => {});
  recompute.current = () => {
    if (isMobile || !contentRef.current || !anchorRef.current) { setLayout((p) => ({ ...p, show: false })); return; }
    const rect = contentRef.current.getBoundingClientRect();
    const anchorRect = anchorRef.current.getBoundingClientRect();
    const visibleLeftEdge = rect.left + horizontalPadding;
    const visibleRightEdge = rect.right - horizontalPadding;
    const leftGutter = Math.max(0, visibleLeftEdge);
    const rightGutter = Math.max(0, window.innerWidth - visibleRightEdge);
    const minGutter = Math.min(leftGutter, rightGutter);
    const MIN_USABLE_GUTTER = 170;
    if (minGutter < MIN_USABLE_GUTTER) { setLayout((p) => ({ ...p, show: false })); return; }
    const width = Math.max(150, Math.min(230, minGutter - 16));
    // Both rects are measured in the same viewport-relative coordinate
    // system at the same instant, so this delta is correct regardless of
    // scroll position or what (if anything) up the tree is positioned.
    const topOffset = (rect.top - anchorRect.top) + 40;
    setLayout({ width, leftGutter, rightGutter, topOffset, show: true });
  };

  useEffect(() => {
    const handler = () => recompute.current();
    window.addEventListener("resize", handler);
    recompute.current();
    const t1 = setTimeout(() => recompute.current(), 200);
    const t2 = setTimeout(() => recompute.current(), 800);
    return () => { window.removeEventListener("resize", handler); clearTimeout(t1); clearTimeout(t2); };
  }, [isMobile]);

  // Content height can change for reasons that aren't a window resize (data
  // finishing a fetch, images loading in) — re-measure whenever it does so
  // topOffset doesn't go stale and the sidebar drift out of alignment.
  useEffect(() => {
    if (!contentRef.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => recompute.current());
    ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [contentRef]);

  useEffect(() => {
    if (!layout.show) return;
    const t = setTimeout(() => setVisible(true), 20);
    return () => clearTimeout(t);
  }, [layout.show]);

  // School name → { Logo1, Short }, for the featured-games "bug" rows.
  useEffect(() => {
    if (isMobile) return;
    const fetch = async () => {
      try {
        const snap = await getDocs(collection(db, "schools"));
        const map = {};
        snap.docs.forEach((d) => { const data = d.data(); if (data.School) map[data.School] = data; });
        setSchoolsByName(map);
      } catch (e) { /* logos/short names are non-critical */ }
    };
    fetch();
  }, [isMobile]);

  // Channel name (schedule26's own game.Channel, set via CFB Schedule's "TV
  // Channel" field) → { Short }, so the date/time line can show e.g. "ACCN"
  // instead of the full "ACC Network" crowding a narrow sidebar row.
  useEffect(() => {
    if (isMobile) return;
    const fetch = async () => {
      try {
        const snap = await getDocs(collection(db, "tvChannels"));
        const map = {};
        snap.docs.forEach((d) => { const data = d.data(); if (data.Name) map[data.Name] = data; });
        setChannelsByName(map);
      } catch (e) { /* channel short names are non-critical */ }
    };
    fetch();
  }, [isMobile]);

  // Left (first card) — every other game in this game's own Week, in kickoff
  // order, so a reader can jump straight to another game on the same slate
  // without going all the way back to the full schedule page. Keyed off the
  // game's own Week field (not "the current calendar week" like the
  // Featured Games card on the right) so this stays correct when looking at
  // a past or future week's game.
  useEffect(() => {
    if (isMobile || !gameWeek) { setWeekSlate([]); return; }
    const fetch = async () => {
      try {
        const snap = await getDocs(query(collection(db, "schedule26"), where("Week", "==", gameWeek)));
        const items = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((g) => g.id !== excludeGameId && g.Slug)
          .sort((a, b) => {
            const dateDiff = toMs(a.Date) - toMs(b.Date);
            if (dateDiff !== 0) return dateDiff;
            return (timeToMinutes(a.Time) ?? 9999) - (timeToMinutes(b.Time) ?? 9999);
          })
          .slice(0, 8);
        setWeekSlate(items);
      } catch (e) { setWeekSlate([]); }
    };
    fetch();
  }, [isMobile, gameWeek, excludeGameId]);

  // Right — this calendar week's (Mon–Sun UTC) Game of the Week, then its
  // Featured games — whatever week the open game is in. Two separate queries
  // (Firestore can't OR across two different boolean fields in one query)
  // merged and de-duped — a game marked both just needs to not appear
  // twice — then sorted with Game of the Week first: it's the site's
  // higher, rarer tier (see AdminPanel.js), so it gets priority placement
  // in this card ahead of the more common Featured tag, before falling
  // back to kickoff order within each tier.
  useEffect(() => {
    if (isMobile) return;
    const fetch = async () => {
      try {
        const [featuredSnap, gotwSnap] = await Promise.all([
          getDocs(query(collection(db, "schedule26"), where("Featured", "==", true))),
          getDocs(query(collection(db, "schedule26"), where("GameOfWeek", "==", true))),
        ]);
        const { start, end } = currentWeekBoundsUtc();
        const byId = new Map();
        [...featuredSnap.docs, ...gotwSnap.docs].forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
        const items = Array.from(byId.values())
          .filter((g) => g.id !== excludeGameId && g.Slug)
          .filter((g) => { const ms = toMs(g.Date); return ms >= start && ms <= end; })
          .sort((a, b) => (b.GameOfWeek ? 1 : 0) - (a.GameOfWeek ? 1 : 0) || toMs(a.Date) - toMs(b.Date))
          .slice(0, 5);
        setFeaturedGames(items);
      } catch (e) { setFeaturedGames([]); }
    };
    fetch();
  }, [isMobile, excludeGameId]);

  // Right (second card) — latest News: news is unfiltered, articles only
  // count if they're priority 1/2.
  useEffect(() => {
    if (isMobile) return;
    const fetch = async () => {
      try {
        const [newsSnap, articleSnap] = await Promise.all([
          getDocs(query(collection(db, "news"), where("active", "==", true))),
          getDocs(query(collection(db, "articles"), where("status", "==", "published"))),
        ]);
        const newsList = newsSnap.docs.map((d) => ({ id: d.id, ...d.data(), _kind: "news" }));
        const articleList = articleSnap.docs
          .map((d) => ({ id: d.id, ...d.data(), _kind: "article" }))
          .filter((a) => [1, 2].includes(a.priority));
        // Published date only, never last-updated — an old article getting
        // a small edit (which bumps updatedAt) must not jump back to the
        // top of this feed.
        const combined = [...newsList, ...articleList]
          .sort((a, b) => toMs(b.publishedAt) - toMs(a.publishedAt))
          .slice(0, 4);
        setNewsItems(combined);
      } catch (e) { setNewsItems([]); }
    };
    fetch();
  }, [isMobile]);

  // Anchored to a point just below where the main content starts, in
  // top:40px is relative to the zero-height anchor div this returns inside
  // top uses the measured topOffset (see recompute) so these cards land
  // near the top of the actual content and scroll along with the page,
  // instead of position:fixed hovering in the viewport regardless of scroll.
  const positionStyle = (side) => {
    const gutter = side === "left" ? layout.leftGutter : layout.rightGutter;
    const offset = Math.max(8, (gutter - layout.width) / 2);
    return {
      position: "absolute", top: `${layout.topOffset}px`, [side]: `${offset}px`,
      width: `${layout.width}px`,
      display: "flex", flexDirection: "column", gap: "16px",
      zIndex: 5, opacity: visible ? 1 : 0, transition: "opacity 0.7s ease",
    };
  };

  // Left card rows: games in progress first, then kickoff order.
  const leftRows = weekSlate.map((g) => ({ g, s: scheduleScore(g, liveById) }))
    .sort((a, b) => (b.s.live ? 1 : 0) - (a.s.live ? 1 : 0));

  return (
    <div ref={anchorRef} style={{ position: "relative", height: 0 }}>
      {(!layout.show || isMobile) ? null : (
      <>
      <style>{SIDEBAR_STYLE}</style>
      {/* ===== Left: This Week's Slate (every other game in the current
          game's own Week) ===== */}
      {weekSlate.length > 0 && (
        <div style={positionStyle("left")}>
          {weekSlate.length > 0 && (
          <div style={cardShell}>
            <CardHead label={gameWeek ? `${gameWeek} Slate` : "This Week's Slate"} liveCount={leftRows.filter((x) => x.s.live).length} />
            {leftRows.map(({ g, s: sc }, i) => (
              <GameBug key={g.id} g={g} s={sc} away={schoolsByName[g.Away]} home={schoolsByName[g.Home]} ranks={ranksForGame(g, currentRankMap)}
                channelShort={g.Channel ? (channelsByName[g.Channel]?.Short || g.Channel) : ""} last={i === leftRows.length - 1 && !weekSlateUrl} />
            ))}
            {weekSlateUrl && (
              <Link
                to={weekSlateUrl}
                style={{
                  display: "block", textAlign: "center", background: BLUE, color: "#fff",
                  fontWeight: 900, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em",
                  padding: "9px", textDecoration: "none",
                }}
              >
                See Full Slate →
              </Link>
            )}
          </div>
          )}
        </div>
      )}

      {/* ===== Right: This Week's Featured Games (compact scoreboard "bug"
          per game — short team codes + logos, big score once final or the
          kickoff date/time while still pregame) stacked above Top Stories.
          Game of the Week entries sort first (see the fetch above) and get
          their own 🔥 flag so they still stand out once mixed in with
          plain Featured games. Each card renders independently so one
          being empty doesn't hide the other. ===== */}
      {(featuredGames.length > 0 || newsItems.length > 0) && (
        <div style={positionStyle("right")}>
          {featuredGames.length > 0 && (
          <div style={cardShell}>
            <CardHead label="⭐ This Week's Top Games" liveCount={featuredGames.filter((g) => scheduleScore(g, liveById).live).length} />
            {featuredGames.map((g, i) => (
              <GameBug key={g.id} g={g} s={scheduleScore(g, liveById)} away={schoolsByName[g.Away]} home={schoolsByName[g.Home]} ranks={ranksForGame(g, currentRankMap)}
                channelShort={g.Channel ? (channelsByName[g.Channel]?.Short || g.Channel) : ""} big showTag last={i === featuredGames.length - 1} />
            ))}
          </div>
          )}

          {/* Second right-side card — Top Stories, stacked below Featured
              Games so a game-page reader also has a way into the rest of
              the site's coverage, not just other games. */}
          {newsItems.length > 0 && (
            <div style={cardShell}>
              <div style={{ background: BLUE, padding: "8px 12px" }}>
                <div style={{ color: GOLD, fontWeight: 900, fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'Arial Black', Arial, sans-serif" }}>
                  Top Stories
                </div>
              </div>
              <div style={{ height: "3px", background: GOLD }} />
              {newsItems.map((item, i) => (
                <Link
                  key={item.id}
                  to={`/news/${item.slug}`}
                  style={{ display: "block", padding: "9px 10px", textDecoration: "none", borderBottom: i < newsItems.length - 1 ? "1px solid #f0f0f0" : "none" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 900, color: "#222", lineHeight: 1.3 }}>{item.title}</div>
                </Link>
              ))}
              <Link
                to="/news"
                style={{
                  display: "block", textAlign: "center", background: BLUE, color: "#fff",
                  fontWeight: 900, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em",
                  padding: "9px", textDecoration: "none",
                }}
              >
                View News →
              </Link>
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
