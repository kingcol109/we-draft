// src/pages/NflPlayerPage.jsx
//
// NFL player page (concept) — a drafted player at his prospect slug, laid
// out like a prospect page (PlayerProfile.js): his draft class at his
// position down the left (a "2018 QB Class" dropdown on mobile), the
// team-colored hero and tabs in the middle, ESPN's next game, his recent
// games and news on the right.
//   Evaluation Report  player grades — the NFL version of draft evaluations
//                  (components/NflEvaluationTab.jsx); the default tab
//   Draft Profile  his pick, We-Draft's retro grade, strengths/weaknesses and
//                  combine (with percentiles among drafted players at his
//                  position) — from `historical`
//   Stats          Season (tables per category) / Game Log (one season's
//                  games), like the prospect page's Stats tab — ESPN
// Which slugs get this page: utils/nflPlayerSlugs.js.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import ShareTextButton from "../components/ShareTextButton";
import { useAuth } from "../context/AuthContext";
import VerifiedNameBadge from "../components/VerifiedNameBadge";
import NflEvaluationTab from "../components/NflEvaluationTab";
import { collection, doc, getDoc, getDocs, orderBy, query, where } from "firebase/firestore";
import { loadWeeklyMockSummary, weeklyMockPlayerTitle, weeklyYearHref, hasTeamPages, WEEKLY_YEARS } from "../utils/weeklyMockNews";
import { db } from "../firebase";
import {
  NFL_PLAYER_PAGES, fetchNflAthlete, fetchNflOverview, fetchNflCareer, fetchNflGameLog, fetchDraftProfile,
  careerTables, gameLogRows,
} from "../utils/nflPlayerPages";
import { fetchNflBranding } from "../utils/draftProfileData";
import { useSchools } from "../components/DraftArchiveList";
import { NFL_TEAMS } from "../utils/coachHistory";
import { textOn } from "../utils/teamColors";
import { gradeLook } from "../utils/communityGrades";
import { STAT_METRICS, readMetric, percentileFromTable } from "../utils/historicalStats";
import { getSiteSnapshot } from "../utils/siteSnapshots";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#1d2433";
const MUTED = "#6b778a";
const HEAD = "'Arial Black', Arial, sans-serif";
const BODY = "Arial, sans-serif";
const TABS = [["evaluation", "Evaluation Report"], ["draft", "Draft Profile"], ["stats", "Stats"]];
const ABBR_BY_NAME = Object.fromEntries(Object.entries(NFL_TEAMS).map(([abbr, name]) => [name, abbr]));
// The prospect page's public-feed filter.
const BANNED = ["faggot", "nigger", "monkey", "nigga", "fuck"];
const hasProfanity = (text) => BANNED.some((w) => String(text).toLowerCase().includes(w));
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const on = () => setM(window.innerWidth < 768);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return m;
}

// Measurements as the prospect page shows them: 75.375 → 6'3 3/8".
const EIGHTHS = ["", "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8"];
function inchesText(n) {
  let whole = Math.floor(n);
  let e = Math.round((n - whole) * 8);
  if (e === 8) { whole += 1; e = 0; }
  return `${whole}${EIGHTHS[e] ? ` ${EIGHTHS[e]}` : ""}"`;
}
function metricText(metric, v) {
  if (v == null) return "";
  if (metric.format === "height") return `${Math.floor(v / 12)}'${inchesText(v % 12)}`;
  if (metric.format === "inches") return inchesText(v);
  if (metric.format === "feetInches") return `${Math.floor(v / 12)}'${v % 12}"`;
  const d = metric.decimals ?? (Number.isInteger(v) ? 0 : 1);
  return `${v.toFixed(d).replace(/\.0$/, "")}${metric.suffix || ""}`;
}

function Card({ title, children, right = null, pad = true }) {
  return (
    <section style={{ background: "#fff", border: "1px solid #e3e8ef", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 10px rgba(16,34,64,0.05)" }}>
      {title && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 16px", borderBottom: "1px solid #eef1f5" }}>
          <h2 style={{ margin: 0, fontSize: 12, fontWeight: 900, letterSpacing: "0.12em", color: BLUE, textTransform: "uppercase", fontFamily: HEAD }}>{title}</h2>
          {right}
        </div>
      )}
      <div style={pad ? { padding: 16 } : undefined}>{children}</div>
    </section>
  );
}

function TeamLogo({ abbr, teams, size = 22, dark = false }) {
  const b = teams[abbr] || {};
  const src = dark ? b.LogoDark || b.Logo1 : b.Logo1;
  return src ? <img src={src} alt={NFL_TEAMS[abbr] || abbr} style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} /> : null;
}

function StatTable({ labels, rows, totals, lead }) {
  const cell = { padding: "7px 8px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: BODY, fontSize: 13, color: INK }}>
        <thead>
          <tr style={{ background: "#f4f7fb", color: MUTED, fontSize: 11, fontWeight: 900, letterSpacing: "0.06em" }}>
            {lead.map((l) => <th key={l} style={{ ...cell, textAlign: "left", paddingRight: 14 }}>{l}</th>)}
            {labels.map((l, i) => <th key={i} style={cell}>{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: "1px solid #eef1f5" }}>
              {r.lead.map((c, j) => <td key={j} style={{ ...cell, textAlign: "left", fontWeight: 800, paddingRight: 14 }}>{c}</td>)}
              {r.stats.map((s, j) => <td key={j} style={cell}>{s}</td>)}
            </tr>
          ))}
          {totals?.length > 0 && (
            <tr style={{ borderTop: `2px solid ${INK}`, fontWeight: 900 }}>
              <td style={{ ...cell, textAlign: "left" }} colSpan={lead.length}>Career</td>
              {totals.map((s, j) => <td key={j} style={cell}>{s}</td>)}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function NflPlayerPage({ slug }) {
  const cfg = NFL_PLAYER_PAGES[slug];
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { user, login } = useAuth();
  const [tab, setTab] = useState("evaluation");
  const [athlete, setAthlete] = useState(null);
  const [overview, setOverview] = useState(null);
  const [career, setCareer] = useState(null);
  const [hist, setHist] = useState(null);
  const [teams, setTeams] = useState({});
  const [pct, setPct] = useState(null);
  const [season, setSeason] = useState("");
  const [log, setLog] = useState(null);
  const [failed, setFailed] = useState(false);
  const [statsView, setStatsView] = useState("seasons");
  const [activePill, setActivePill] = useState(null);
  const pillPointer = useRef("mouse");
  const [classRows, setClassRows] = useState(null);
  const [evaluations, setEvaluations] = useState([]);
  const [publicFeed, setPublicFeed] = useState([]);
  const [feedShown, setFeedShown] = useState(3);
  const [siteNews, setSiteNews] = useState([]);

  useEffect(() => {
    let live = true;
    fetchNflAthlete(cfg.espnId).then((a) => { if (!live) return; if (a) setAthlete(a); else setFailed(true); });
    fetchNflOverview(cfg.espnId).then((o) => { if (live) setOverview(o); });
    fetchNflCareer(cfg.espnId).then((c) => { if (live) setCareer(c); });
    fetchDraftProfile(cfg).then(({ draft, classRows: rows, evaluations: evs }) => { if (live) { setHist(draft); setClassRows(rows); setEvaluations(evs || []); } });
    fetchNflBranding().then((t) => { if (live) setTeams(t || {}); }).catch(() => {});
    return () => { live = false; };
  }, [cfg]);

  // Combine percentiles against drafted players at his position from the
  // classes before his (the prospect page's pct_ snapshot).
  useEffect(() => {
    if (!hist?.Position) return;
    getSiteSnapshot(`pct_${hist.Position}`).then((snap) => setPct(snap?.cutoffs?.[String(hist.Year)] || snap?.cutoffs?.all || null)).catch(() => {});
  }, [hist?.Position, hist?.Year]);

  // In the News — the site's own items, as the prospect page builds them for
  // a drafted player: our published articles about him (his slug, or his
  // player id when he had a prospect page), then the current Weekly Mocks'
  // picks for his team ("2027 Mock Draft: Seahawks Take Simmons").
  const teamAbbr = athlete?.team?.abbreviation || "";
  useEffect(() => {
    if (!teamAbbr) return undefined;
    let live = true;
    const articles = (field, value) => getDocs(query(collection(db, "articles"), where("status", "==", "published"), where(field, "array-contains", value), orderBy("publishedAt", "desc")))
      .then((snap) => snap.docs.map((d) => { const x = d.data(); return { id: d.id, type: "article", ...x, title: x.titleShort || x.title, href: `/article/${x.slug}` }; }))
      .catch(() => []);
    Promise.all([
      articles("slugs", slug),
      cfg.playerId ? articles("playerIds", cfg.playerId) : [],
      Promise.all(WEEKLY_YEARS.map((y) => loadWeeklyMockSummary(y).catch(() => null))),
    ]).then(([bySlug, byId, mocks]) => {
      if (!live) return;
      const seen = new Set();
      const mine = [...bySlug, ...byId].filter((n) => !seen.has(n.id) && seen.add(n.id));
      const lastName = (name) => String(name || "").replace(/\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i, "").split(" ").pop();
      const mockItems = mocks.filter(Boolean).map((m) => {
        const pick = hasTeamPages(m.year) ? m.teams?.[teamAbbr]?.first : null;
        return pick ? { id: `weeklyMock${m.year}`, type: "mock", publishedAt: m.publishedAt, href: weeklyYearHref(m.year), title: weeklyMockPlayerTitle(m.year, teamAbbr, lastName(pick.name)) } : null;
      }).filter(Boolean);
      setSiteNews([...mine, ...mockItems]);
    });
    return () => { live = false; };
  }, [slug, cfg.playerId, teamAbbr]);

  // Public evaluations, as the prospect page's feed builds them: public,
  // written and clean, with each author's username and verified flag —
  // verified first, then newest.
  useEffect(() => {
    const pub = evaluations.filter((e) => e.visibility === "public" && e.evaluation?.trim() && !hasProfanity(e.evaluation));
    if (!pub.length) { setPublicFeed([]); return undefined; }
    let live = true;
    Promise.all(pub.map((e) => getDoc(doc(db, "users", e.id)).catch(() => null))).then((snaps) => {
      if (!live) return;
      const feed = pub.map((e, i) => {
        const u = snaps[i]?.exists() ? snaps[i].data() : {};
        return { ...e, uid: e.uid || e.id, username: u.username || "Anonymous User", verified: !!u.verified };
      });
      const ms = (t) => (t?.toDate ? t.toDate().getTime() : 0);
      feed.sort((a, b) => (a.verified !== b.verified ? (a.verified ? -1 : 1) : ms(b.updatedAt) - ms(a.updatedAt)));
      setPublicFeed(feed);
    });
    return () => { live = false; };
  }, [evaluations]);

  useEffect(() => {
    let live = true;
    fetchNflGameLog(cfg.espnId, season).then((l) => { if (live) setLog(l); });
    return () => { live = false; };
  }, [cfg.espnId, season]);

  const schools = useSchools(hist?.School ? [hist.School] : []);
  const school = hist?.School ? schools[hist.School] : null;
  const tables = useMemo(() => careerTables(career), [career]);
  const games = useMemo(() => gameLogRows(log), [log]);

  if (failed) {
    return <div style={{ padding: 60, textAlign: "center", fontFamily: HEAD, color: BLUE }}>Couldn't load this player right now.</div>;
  }

  const abbr = athlete?.team?.abbreviation || "";
  const brand = teams[abbr] || {};
  const c1 = brand.Color1 || (athlete?.team?.color ? `#${athlete.team.color}` : BLUE);
  const c2 = brand.Color2 || (athlete?.team?.alternateColor ? `#${athlete.team.alternateColor}` : GOLD);
  const first = athlete?.firstName || hist?.First || "";
  const last = athlete?.lastName || hist?.Last || "";
  const pos = athlete?.position?.abbreviation || hist?.Position || "";
  const draftTeam = hist ? ABBR_BY_NAME[hist["NFL Team"]] || "" : "";
  const exp = athlete?.experience?.years;

  const facts = [
    athlete?.age && ["Age", String(athlete.age)],
    athlete?.displayHeight && ["Height", athlete.displayHeight.replace(/\s/g, "")],
    athlete?.displayWeight && ["Weight", athlete.displayWeight],
    exp != null && ["Experience", exp === 0 ? "Rookie" : `${ordinal(exp + 1)} season`],
    athlete?.displayBirthPlace && ["Hometown", athlete.displayBirthPlace],
  ].filter(Boolean);

  // The prospect page's hero (PlayerProfile.js HERO CARD): a flat team-color
  // toolbar, then the gradient band — drifting stripes, a breathing
  // spotlight, the faded wordmark — with the headshot standing on its
  // bottom-left edge, the team logo on the right and the name centered
  // between them. His bio facts sit in a strip under it; the draft is the
  // Draft Profile tab's.
  const headshot = athlete?.headshot?.href || "";
  const teamLogo = brand.LogoDark || brand.Logo1 || "";
  const wordmark = brand.WordmarkDark || brand.Wordmark || "";
  // The name's size follows the column's width so the longest word fits.
  const nameFit = (() => {
    const pieces = `${first} ${last}`.split(/\s+/).flatMap((w) => w.split("-").map((x, i, all) => x + (i < all.length - 1 ? "-" : "")));
    const longest = Math.max(4, ...pieces.map((x) => x.length));
    return `calc(100cqw / ${(longest * 0.75).toFixed(2)})`;
  })();
  const toolbarBtn = {
    border: "2px solid #fff", background: "rgba(255,255,255,0.12)", color: "#fff", fontFamily: HEAD, fontWeight: 900, cursor: "pointer",
    fontSize: isMobile ? 14 : 16, letterSpacing: "0.04em",
  };
  const dot = <span style={{ color: "rgba(255,255,255,0.4)" }}>·</span>;
  const hero = (
    <div style={{ borderRadius: 8, overflow: "hidden", border: `3px solid ${c1}`, background: "#fff" }}>
      <style>{`
        @keyframes wdNflHeroDrift { 0% { transform: translate(0, 0); } 100% { transform: translate(-80px, -46px); } }
        @keyframes wdNflHeroSpotlight { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }
        .wd-nfl-hero-logo img { transition: transform .2s; } .wd-nfl-hero-logo:hover img { transform: scale(1.05); }
      `}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: c1, padding: isMobile ? "10px 12px" : "12px 20px" }}>
        <button onClick={() => navigate(-1)} style={{ ...toolbarBtn, borderRadius: 8, padding: isMobile ? "8px 16px" : "10px 22px" }}>← Back</button>
        <ShareTextButton
          text={`${first} ${last}, ${pos} for the ${athlete?.team?.displayName || "NFL"} — on We-Draft.com: ${typeof window !== "undefined" ? window.location.href : ""}`}
          subject={`${first} ${last} — We-Draft.com`} color={BLUE} title="Share this player"
          style={{ ...toolbarBtn, display: "flex", alignItems: "center", gap: 6, borderRadius: 999, padding: isMobile ? "7px 14px" : "9px 18px" }}
        >
          <svg width={isMobile ? 14 : 16} height={isMobile ? 14 : 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v13" />
          </svg>
          Share
        </ShareTextButton>
      </div>

      <div style={{
        position: "relative", overflow: "hidden", minHeight: isMobile ? 120 : 190,
        background: [
          `radial-gradient(circle 220px at top left, ${c2}55, transparent 100%)`,
          `radial-gradient(circle 220px at bottom right, ${c2}55, transparent 100%)`,
          "linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4))",
          `linear-gradient(120deg, ${c1} 0%, ${c1} 55%, ${c2} 100%)`,
        ].join(", "),
      }}>
        <div aria-hidden="true" style={{ position: "absolute", inset: "-20%", pointerEvents: "none", background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 2px, transparent 2px, transparent 40px)", animation: "wdNflHeroDrift 18s linear infinite" }} />
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.16), transparent 55%)", animation: "wdNflHeroSpotlight 5s ease-in-out infinite" }} />
        {wordmark && !isMobile && (
          <img src={wordmark} alt="" aria-hidden="true" style={{ position: "absolute", top: "50%", right: "-4%", transform: "translateY(-50%)", width: "55%", maxWidth: 520, height: "auto", objectFit: "contain", opacity: 0.14, pointerEvents: "none" }} />
        )}
        {headshot && (
          <img src={headshot} alt={`${first} ${last}`} style={{ position: "absolute", bottom: 0, left: isMobile ? "1%" : "2%", height: isMobile ? "88%" : "92%", width: "auto", maxWidth: isMobile ? 140 : 260, objectFit: "contain", objectPosition: "bottom", zIndex: 1, pointerEvents: "none" }} />
        )}
        {teamLogo && abbr && (
          <Link to={`/nfl/${abbr.toLowerCase()}`} aria-label={athlete?.team?.displayName} className="wd-nfl-hero-logo" style={{
            position: "absolute", top: "50%", [headshot ? "right" : "left"]: isMobile ? "4%" : "3%", transform: "translateY(-50%)",
            height: isMobile ? (headshot ? "48%" : "60%") : "70%", zIndex: 2, display: "flex", alignItems: "center",
          }}>
            <img src={teamLogo} alt={athlete?.team?.displayName || ""} style={{ height: "100%", width: "auto", maxWidth: isMobile ? (headshot ? 64 : 90) : 220, objectFit: "contain", filter: "drop-shadow(0 4px 14px rgba(0,0,0,0.45))" }} />
          </Link>
        )}
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", minHeight: isMobile ? 120 : 190, padding: isMobile ? "12px 10px 10px" : "20px 24px 16px", pointerEvents: "none" }}>
          <div style={{ flex: 1, textAlign: "center", containerType: "inline-size", ...(headshot ? { paddingLeft: isMobile ? 64 : 150, paddingRight: isMobile ? 76 : 170 } : {}) }}>
            <h1 style={{ margin: 0, fontFamily: HEAD, fontWeight: 900, textTransform: "uppercase", lineHeight: 1, color: "#fff", letterSpacing: "0.02em", textShadow: "0 2px 8px rgba(0,0,0,0.4)", fontSize: `min(${isMobile ? "clamp(20px,6vw,30px)" : "clamp(36px,5vw,58px)"}, ${nameFit})` }}>
              <div>{first}</div>
              <div style={{ marginTop: isMobile ? 2 : 4 }}>{last}</div>
            </h1>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: isMobile ? 6 : 10, marginTop: 8, fontFamily: HEAD }}>
              {pos && (
                <span style={{ background: headshot ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.14)", backdropFilter: headshot ? "blur(4px)" : undefined, border: "2px solid #fff", borderRadius: 999, color: "#fff", fontWeight: 800, letterSpacing: "0.05em", fontSize: isMobile ? 11 : 17, padding: isMobile ? "2px 8px" : "3px 16px" }}>{pos}</span>
              )}
              {abbr && <>{dot}<Link to={`/nfl/${abbr.toLowerCase()}`} style={{ color: "#fff", fontWeight: 800, fontSize: isMobile ? 12 : 19, textShadow: "0 1px 4px rgba(0,0,0,0.4)", textDecoration: "none", pointerEvents: "auto" }}>{athlete?.team?.displayName}</Link></>}
              {athlete?.jersey && !isMobile && <>{dot}<span style={{ color: "rgba(255,255,255,0.8)", fontWeight: 700, fontSize: isMobile ? 12 : 19 }}>#{athlete.jersey}</span></>}
            </div>
          </div>
        </div>
      </div>
      <div style={{ height: 4, background: c2 }} />

      {/* Bio facts */}
      <div style={{ display: "flex", flexWrap: "wrap", background: "#fff" }}>
        {facts.map(([k, v]) => (
          <div key={k} style={{ flex: isMobile ? "1 1 33%" : 1, padding: "10px 14px", borderRight: "1px solid #eef1f5", borderBottom: isMobile ? "1px solid #eef1f5" : "none" }}>
            <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.12em", color: MUTED, textTransform: "uppercase", fontFamily: HEAD }}>{k}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: INK, fontFamily: BODY, marginTop: 2 }}>{v}</div>
          </div>
        ))}
        {hist?.School && (
          <div style={{ flex: isMobile ? "1 1 33%" : 1, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
            {school?.Logo1 && <img src={school.Logo1} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />}
            <div>
              <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.12em", color: MUTED, textTransform: "uppercase", fontFamily: HEAD }}>College</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: INK, fontFamily: BODY, marginTop: 2 }}>{hist.School}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const tabBar = (
    <div role="tablist" style={{ display: "flex", gap: isMobile ? 0 : 8, borderBottom: "2px solid #e3e8ef" }}>
      {/* No draft profile of him (cfg has no draft side): no Draft Profile tab. */}
      {TABS.filter(([k]) => k !== "draft" || cfg.historicalId || cfg.playerId).map(([k, label]) => (
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{
          background: "none", border: "none", borderBottom: `3px solid ${tab === k ? c1 : "transparent"}`, marginBottom: -2,
          padding: isMobile ? "10px 7px" : "12px 14px", cursor: "pointer", whiteSpace: "nowrap",
          fontFamily: HEAD, fontWeight: 900, fontSize: isMobile ? 11 : 13, letterSpacing: isMobile ? "0.04em" : "0.1em", textTransform: "uppercase",
          color: tab === k ? INK : "#9aa5b5",
        }}>{label}</button>
      ))}
    </div>
  );

  // ── Draft Profile ──
  const look = hist?.RoundGrade ? gradeLook(hist.RoundGrade) : null;
  // Measurements in the prospect page's two groups and labels, each with
  // its percentile among drafted players at his position.
  const measure = (keys) => (hist ? keys.map(([key, label]) => {
    const m = STAT_METRICS.find((x) => x.key === key);
    const v = readMetric(hist, m).value;
    if (v == null) return null;
    const p = percentileFromTable(v, pct?.[key], m.lowerIsBetter);
    return { key, label, text: metricText(m, v), pct: p == null ? null : Math.min(99, Math.max(1, Math.round(p))) };
  }).filter(Boolean) : []);
  const physical = measure([["height", "Height"], ["weight", "Weight"], ["arm", "Arm"], ["hand", "Hand"]]);
  const athletic = measure([["forty", "40 Yd"], ["vertical", "Vert"], ["broad", "Broad"], ["threeCone", "3-Cone"], ["shuttle", "Shutt"], ["bench", "Bench"]]);
  // The prospect page's stat pill: value and label; hovered (tapped on
  // touch) it fills with the team color and the value turns into his
  // percentile, in the same cell so the pill keeps its size.
  const statPill = (m) => {
    const active = activePill === m.key && m.pct != null;
    return (
      <div key={m.key}
        onPointerDown={(e) => { pillPointer.current = e.pointerType; }}
        onPointerEnter={(e) => { if (e.pointerType === "mouse" && m.pct != null) setActivePill(m.key); }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") setActivePill((c) => (c === m.key ? null : c)); }}
        onClick={() => { if (pillPointer.current !== "mouse" && m.pct != null) setActivePill((c) => (c === m.key ? null : m.key)); }}
        title={m.pct == null ? undefined : `${ordinal(m.pct)} percentile among drafted ${hist.Position}s`}
        style={{
          display: "inline-flex", alignItems: "baseline", gap: 6, background: active ? c1 : "#fff", border: `1px solid ${c1}`, borderRadius: 10,
          padding: isMobile ? "3px 8px" : "4px 12px", transition: "background 0.15s", cursor: "default", fontVariantNumeric: "tabular-nums",
        }}>
        <span style={{ display: "grid", fontFamily: HEAD, fontSize: isMobile ? 13 : 16, fontWeight: 900, lineHeight: 1.1, justifyItems: "center" }}>
          <span style={{ gridArea: "1 / 1", color: c1, visibility: active ? "hidden" : "visible" }}>{m.text}</span>
          {m.pct != null && <span aria-hidden={!active} style={{ gridArea: "1 / 1", color: "#fff", visibility: active ? "visible" : "hidden" }}>{m.pct}%</span>}
        </span>
        <span style={{ fontFamily: HEAD, fontSize: isMobile ? 9 : 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: active ? "rgba(255,255,255,0.8)" : "#98a3b3" }}>{m.label}</span>
      </div>
    );
  };
  // Strengths/weaknesses as the prospect page lists them — a historical
  // player's come from his card, not community votes, so no share bars.
  const traitList = (items, empty, color) => (
    <div>
      {(items || []).length ? items.map((t, i) => (
        <div key={t} style={{ padding: "8px 0", borderBottom: i < items.length - 1 ? "1px solid #f0f0f0" : "none" }}>
          <div style={{ fontFamily: HEAD, fontWeight: 900, fontSize: 13, letterSpacing: "0.06em", color: "#222", textTransform: "uppercase" }}>{t}</div>
          {hist.traitPct?.[t] != null && (
            <div style={{ height: 4, background: "#eee", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
              <div style={{ width: `${Math.pow(hist.traitPct[t] / 100, 0.3) * 100}%`, height: "100%", background: color, borderRadius: 2 }} />
            </div>
          )}
        </div>
      )) : <span style={{ fontFamily: BODY, fontSize: 13, fontStyle: "italic", color: "#98a3b3" }}>{empty}</span>}
    </div>
  );
  const scoutHead = (label) => (
    <h3 style={{ margin: "0 0 12px", paddingBottom: 8, borderBottom: `3px solid ${BLUE}`, color: BLUE, fontFamily: HEAD, fontWeight: 900, fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase" }}>{label}</h3>
  );
  // The draft card, styled like the weekly mock's pick rows (ViewMock.js
  // PickRow): the pick in a column of the drafting team's colors, the team
  // big beside it over its faded wordmark, and the college underneath.
  const db1 = teams[draftTeam]?.Color1 || BLUE;
  const db2 = teams[draftTeam]?.Color2 || GOLD;
  const draftWordmark = teams[draftTeam]?.Wordmark || teams[draftTeam]?.WordmarkDark || "";
  const draftCard = hist?.Pick ? (
    <div style={{ position: "relative", display: "flex", alignItems: "stretch", overflow: "hidden", borderRadius: 14, background: "#fff", boxShadow: "0 2px 10px rgba(16,34,64,0.08)", border: "1px solid #e3e8ef" }}>
      <span style={{
        flexShrink: 0, width: isMobile ? 70 : 104, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
        background: `linear-gradient(160deg, ${db1} 0%, ${db1} 70%, ${db2} 100%)`, color: textOn(db1, db2), borderRight: `4px solid ${db2}`, fontFamily: HEAD,
      }}>
        <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", opacity: 0.8 }}>PICK</span>
        <span style={{ fontSize: isMobile ? 30 : 44, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{hist.Pick}</span>
        <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", opacity: 0.8 }}>ROUND {hist.Round}</span>
      </span>
      <div style={{ position: "relative", flex: 1, minWidth: 0, padding: isMobile ? "12px 14px" : "18px 22px" }}>
        <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, #fff 45%, ${db1}1a 100%)`, pointerEvents: "none" }} />
        {draftWordmark && (
          <img src={draftWordmark} alt="" aria-hidden="true" style={{ position: "absolute", right: isMobile ? -10 : 12, top: "50%", transform: "translateY(-50%)", height: isMobile ? 60 : 96, maxWidth: "50%", objectFit: "contain", opacity: 0.1, pointerEvents: "none" }} />
        )}
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: isMobile ? 10 : 16 }}>
          {draftTeam && (
            <Link to={`/nfl/${draftTeam.toLowerCase()}`} style={{ flexShrink: 0, lineHeight: 0 }} title={hist["NFL Team"]}>
              <TeamLogo abbr={draftTeam} teams={teams} size={isMobile ? 46 : 72} />
            </Link>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: HEAD, fontSize: 10, fontWeight: 900, color: "#7a8597", letterSpacing: "0.12em", textTransform: "uppercase" }}>
              {hist.Year} NFL Draft · Round {hist.Round}
            </div>
            {draftTeam ? (
              <Link to={`/nfl/${draftTeam.toLowerCase()}`} style={{ display: "block", fontFamily: HEAD, fontSize: isMobile ? 18 : 26, fontWeight: 900, color: db1, textTransform: "uppercase", lineHeight: 1.05, textDecoration: "none", marginTop: 2 }}>
                {hist["NFL Team"]}
              </Link>
            ) : (
              <div style={{ fontFamily: HEAD, fontSize: isMobile ? 18 : 26, fontWeight: 900, color: INK, textTransform: "uppercase", lineHeight: 1.05, marginTop: 2 }}>{hist["NFL Team"]}</div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontFamily: BODY, fontSize: 13, fontWeight: 700, color: MUTED }}>
              {hist.Position} out of
              {school?.Logo1 && <img src={school.Logo1} alt="" style={{ width: 18, height: 18, objectFit: "contain" }} />}
              <span style={{ color: INK, fontWeight: 800 }}>{hist.School}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  // The signed-in user's own pre-draft evaluation of him, read-only now
  // that he's drafted (a prospect-page player only — historical players
  // were never evaluated).
  const mine = user ? evaluations.find((e) => e.id === user.uid) : null;
  const myLook = mine?.grade && mine.grade !== "Watchlist" ? gradeLook(mine.grade) : null;
  const myEvalCard = hist?.source === "prospect" ? (
    <Card title="My Pre-Draft Evaluation" right={mine?.updatedAt?.toDate && <span style={{ fontFamily: BODY, fontSize: 11, color: MUTED }}>{mine.updatedAt.toDate().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>}>
      {!user ? (
        <div style={{ textAlign: "center", padding: "6px 0" }}>
          <p style={{ margin: "0 0 12px", fontFamily: BODY, fontSize: 14, color: MUTED }}>Sign in to see how you graded {first} before the draft.</p>
          <button onClick={login} style={{ background: BLUE, color: "#fff", border: "none", borderRadius: 999, padding: "8px 20px", fontFamily: HEAD, fontWeight: 900, fontSize: 13, letterSpacing: "0.06em", cursor: "pointer" }}>SIGN IN</button>
        </div>
      ) : !mine ? (
        <p style={{ margin: 0, fontFamily: BODY, fontSize: 14, color: MUTED, fontStyle: "italic" }}>You didn't evaluate {first} before the draft.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "150px 1fr 1fr", gap: isMobile ? 14 : 18 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: BLUE, fontFamily: HEAD }}>MY GRADE</span>
            {myLook ? (
              <span style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 84, height: 68, borderRadius: 10, background: myLook.bg, border: `3px solid ${myLook.border}`, color: "#fff" }}>
                <b style={{ fontFamily: HEAD, fontSize: 26, lineHeight: 1 }}>{myLook.short}</b>
                <span style={{ fontSize: 8, fontWeight: 900, marginTop: 3, letterSpacing: "0.06em", textAlign: "center", textTransform: "uppercase" }}>{mine.grade}</span>
              </span>
            ) : <span style={{ fontFamily: BODY, fontSize: 13, color: MUTED }}>{mine.grade || "—"}</span>}
            {mine.nflFit && <span style={{ fontFamily: BODY, fontSize: 12, color: MUTED, textAlign: "center" }}>Fit: <b style={{ color: INK }}>{mine.nflFit}</b></span>}
          </div>
          <div>
            {scoutHead("My Strengths")}
            {traitList(mine.strengths, "None picked", "#16a34a")}
          </div>
          <div>
            {scoutHead("My Weaknesses")}
            {traitList(mine.weaknesses, "None picked", "#dc2626")}
          </div>
          {mine.evaluation?.trim() && (
            <p style={{ gridColumn: "1 / -1", margin: 0, padding: "12px 14px", background: "#f6f8fb", borderRadius: 10, fontFamily: BODY, fontSize: 14, lineHeight: 1.6, color: "#33415c", whiteSpace: "pre-line" }}>{mine.evaluation}</p>
          )}
        </div>
      )}
    </Card>
  ) : null;

  // ── Public evaluations — the prospect page's feed: each scout's card
  // (name and date in a site-blue band; grade, strengths, weaknesses, NFL
  // fit; then his take), 3 at a time. ──
  const feedHead = (label) => (
    <div style={{ fontFamily: HEAD, fontWeight: 900, fontSize: isMobile ? 9 : 13, color: BLUE, textTransform: "uppercase", letterSpacing: "0.12em", borderBottom: `2px solid ${BLUE}`, paddingBottom: 3, marginBottom: isMobile ? 4 : 10 }}>{label}</div>
  );
  const feedItems = (items) => items.map((t, i) => (
    <div key={t} style={{ fontFamily: HEAD, fontWeight: 900, fontSize: isMobile ? 11 : 13, textTransform: "uppercase", color: "#222", letterSpacing: "0.05em", padding: isMobile ? "2px 0" : "4px 0", borderBottom: !isMobile && i < items.length - 1 ? "1px solid #f0f0f0" : "none" }}>{t}</div>
  ));
  const feedCard = (ev) => {
    const g = ev.grade ? gradeLook(ev.grade) : null;
    const fitAbbr = ABBR_BY_NAME[ev.nflFit] || "";
    const cell = { padding: isMobile ? "8px 10px" : "14px 16px", minWidth: 0 };
    return (
      <div key={ev.uid} style={{ background: "#fff", borderRadius: 8, overflow: "hidden", border: `2px solid ${BLUE}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", background: BLUE }}>
          <span style={{ fontFamily: HEAD, fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em", fontSize: isMobile ? 13 : 16 }}>
            <VerifiedNameBadge uid={ev.uid} name={ev.username} verified={ev.verified} size={16} />
          </span>
          {ev.updatedAt?.toDate && <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: 700, fontFamily: BODY }}>{ev.updatedAt.toDate().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "auto 1fr 1fr" : `${g ? "130px " : ""}1fr 1fr${ev.nflFit ? " 110px" : ""}` }}>
          {g && (
            <div style={{ ...cell, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRight: "1px solid #e5e7eb" }}>
              {!isMobile && feedHead("Grade")}
              <div style={{ width: "100%", textAlign: "center", borderRadius: 6, background: g.bg, border: `3px solid ${g.border}`, padding: isMobile ? "6px 8px" : "8px 10px", color: "#fff" }}>
                <div style={{ fontFamily: HEAD, fontSize: isMobile ? 22 : 34, fontWeight: 900, lineHeight: 1 }}>{g.short}</div>
                <div style={{ fontSize: 8, fontWeight: 800, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 3 }}>{ev.grade}</div>
              </div>
              {isMobile && fitAbbr && <div style={{ marginTop: 6 }}><TeamLogo abbr={fitAbbr} teams={teams} size={26} /></div>}
            </div>
          )}
          <div style={{ ...cell, borderRight: "1px solid #e5e7eb" }}>
            {feedHead("Strengths")}
            {ev.strengths?.length ? feedItems(ev.strengths) : <span style={{ fontFamily: BODY, fontSize: 12, color: "#98a3b3", fontStyle: "italic" }}>—</span>}
          </div>
          <div style={{ ...cell, borderRight: !isMobile && ev.nflFit ? "1px solid #e5e7eb" : "none" }}>
            {feedHead("Weaknesses")}
            {ev.weaknesses?.length ? feedItems(ev.weaknesses) : <span style={{ fontFamily: BODY, fontSize: 12, color: "#98a3b3", fontStyle: "italic" }}>—</span>}
          </div>
          {!isMobile && ev.nflFit && (
            <div style={{ ...cell, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              {feedHead("NFL Fit")}
              {fitAbbr ? <TeamLogo abbr={fitAbbr} teams={teams} size={52} /> : <span style={{ fontFamily: HEAD, fontWeight: 900, fontSize: 13, color: BLUE, textAlign: "center" }}>{ev.nflFit}</span>}
            </div>
          )}
        </div>
        <div style={{ borderTop: "1px solid #e5e7eb", padding: isMobile ? "10px" : "14px 16px" }}>
          {feedHead("Scout's Take")}
          <div style={{ borderLeft: `3px solid ${BLUE}`, background: "#fafafa", borderRadius: "0 4px 4px 0", padding: isMobile ? "8px 10px" : "10px 14px", fontFamily: BODY, fontSize: isMobile ? 13 : 15, fontWeight: 600, color: "#111", lineHeight: 1.65, whiteSpace: "pre-line" }}>
            {ev.evaluation}
          </div>
        </div>
      </div>
    );
  };
  const publicCard = hist?.source === "prospect" ? (
    <section>
      <h2 style={{ margin: "4px 0 12px 2px", color: BLUE, fontFamily: HEAD, fontWeight: 900, fontSize: 14, letterSpacing: "0.14em", textTransform: "uppercase" }}>Public Evaluations</h2>
      {publicFeed.length ? (
        <div style={{ display: "grid", gap: 14 }}>
          {publicFeed.slice(0, feedShown).map(feedCard)}
          {feedShown < publicFeed.length && (
            <button onClick={() => setFeedShown((n) => n + 3)} style={{ background: BLUE, border: `2px solid ${GOLD}`, color: "#fff", borderRadius: 8, padding: "10px 0", fontFamily: HEAD, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}>
              Show More
            </button>
          )}
        </div>
      ) : <p style={{ margin: 0, fontFamily: BODY, fontSize: 14, fontStyle: "italic", color: "#98a3b3" }}>No public evaluations.</p>}
    </section>
  ) : null;

  const draftTab = hist ? (
    <div style={{ display: "grid", gap: 16 }}>
      {draftCard}

      <Card title="Scouting Report" pad={false}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "190px 1fr 1fr", gap: 0 }}>
          <div style={{ padding: 18, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, borderRight: isMobile ? "none" : "1px solid #eef1f5", borderBottom: isMobile ? "1px solid #eef1f5" : "none" }}>
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: BLUE, fontFamily: HEAD, textTransform: "uppercase" }}>{hist.gradeTitle}</span>
            {look ? (
              <span style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 96, height: 78, borderRadius: 10, background: look.bg, border: `3px solid ${look.border}`, color: "#fff" }}>
                <b style={{ fontFamily: HEAD, fontSize: 30, lineHeight: 1 }}>{look.short}</b>
                <span style={{ fontSize: 9, fontWeight: 900, marginTop: 4, letterSpacing: "0.06em", textAlign: "center" }}>{(look.qualifier ? `${look.qualifier} FIRST` : hist.RoundGrade).toUpperCase()}{look.qualifier ? " ROUND" : ""}</span>
              </span>
            ) : <span style={{ fontFamily: BODY, fontSize: 13, color: "#98a3b3", fontStyle: "italic" }}>Not graded</span>}
            <span style={{ fontFamily: BODY, fontSize: 11, color: MUTED, textAlign: "center", lineHeight: 1.4 }}>{hist.gradeNote}</span>
            {hist.classRank && (
              <div style={{ marginTop: 6, textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: BLUE, fontFamily: HEAD }}>CLASS RANK</div>
                <div style={{ fontFamily: BODY, fontSize: 12, fontWeight: 700, color: INK, marginTop: 4, lineHeight: 1.5 }}>
                  {hist.positionRank && <>{hist.positionRank} / {classRows?.length || "—"} {hist.Year} {hist.Position}s<br /></>}
                  {hist.classRank} / {hist.classSize} {hist.Year} Prospects
                </div>
              </div>
            )}
          </div>
          <div style={{ padding: 18, borderRight: isMobile ? "none" : "1px solid #eef1f5", borderBottom: isMobile ? "1px solid #eef1f5" : "none" }}>
            {scoutHead("Top Strengths")}
            {traitList(hist.Strengths, "No strengths listed", "#16a34a")}
          </div>
          <div style={{ padding: 18 }}>
            {scoutHead("Top Weaknesses")}
            {traitList(hist.Weaknesses, "No weaknesses listed", "#dc2626")}
          </div>
        </div>
        {(physical.length > 0 || athletic.length > 0) && (
          <div style={{ borderTop: "1px solid #eef1f5", padding: isMobile ? "12px 10px 14px" : "14px 16px 18px", display: "flex", alignItems: "flex-start", flexWrap: "wrap", gap: isMobile ? "8px" : "8px 14px" }}>
            <h3 style={{ margin: isMobile ? 0 : "6px 0 0", flexShrink: 0, color: BLUE, fontFamily: HEAD, fontWeight: 900, fontSize: isMobile ? 11 : 13, letterSpacing: "0.14em", textTransform: "uppercase" }}>Measurements</h3>
            <div style={{ display: "grid", gap: isMobile ? 5 : 7, flexBasis: isMobile ? "100%" : "auto" }}>
              {[physical, athletic].filter((row) => row.length).map((row, i) => (
                <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: isMobile ? 5 : 7 }}>{row.map(statPill)}</div>
              ))}
            </div>
          </div>
        )}
        {hist.Bio && (
          <div style={{ borderTop: "1px solid #eef1f5", padding: isMobile ? "12px 10px 14px" : "14px 16px 18px" }}>
            <h3 style={{ margin: "0 0 6px", color: BLUE, fontFamily: HEAD, fontWeight: 900, fontSize: isMobile ? 11 : 13, letterSpacing: "0.14em", textTransform: "uppercase" }}>Pre-Draft Bio</h3>
            <p style={{ margin: 0, fontFamily: BODY, fontSize: 14, lineHeight: 1.6, color: "#33415c" }}>{hist.Bio}</p>
          </div>
        )}
      </Card>

      {myEvalCard}
      {publicCard}
    </div>
  ) : <Card><span style={{ fontFamily: BODY, color: MUTED }}>Loading draft profile…</span></Card>;

  // ── Stats: Season / Game Log, like the prospect page's Stats tab ──
  const CATEGORY_TITLES = { passing: "Passing", rushing: "Rushing", receiving: "Receiving", defensive: "Defense", scoring: "Scoring" };
  // An offensive player's special-teams tackles and scoring summary are
  // noise; any table whose career line is all zeros (an RB's passing) too.
  const OFFENSE = ["QB", "RB", "WR", "TE", "OL", "FB"];
  const HIDE_ON_OFFENSE = ["defensive", "scoring"];
  const allZero = (t) => t.totals.length > 1 && t.totals.slice(1).every((v) => !parseFloat(String(v).replace(/,/g, "")));
  const seasonOptions = log?.filters?.find((f) => f.name === "season");
  const shownSeason = season || seasonOptions?.value || "";
  const subTab = (key, label) => (
    <button key={key} role="tab" aria-selected={statsView === key} onClick={() => setStatsView(key)} style={{
      background: "none", border: "none", margin: 0, padding: "0 0 4px", cursor: "pointer", whiteSpace: "nowrap",
      fontFamily: HEAD, fontWeight: 900, textTransform: "uppercase", fontSize: isMobile ? 12 : 13, letterSpacing: "0.08em",
      color: statsView === key ? c1 : "#9aa5b4", borderBottom: `2px solid ${statsView === key ? c2 : "transparent"}`,
    }}>{label}</button>
  );
  const seasonTables = (
    <div style={{ display: "grid", gap: 16 }}>
      {Object.entries(tables).filter(([k, t]) => CATEGORY_TITLES[k] && t.rows.length && !(OFFENSE.includes(pos) && HIDE_ON_OFFENSE.includes(k)) && !allZero(t)).map(([k, t]) => (
        <Card key={k} title={CATEGORY_TITLES[k]} pad={false}>
          <StatTable labels={t.labels} totals={t.totals} lead={["Year", "Team"]} rows={[...t.rows].reverse().map((r) => ({
            lead: [r.year, <span key="t" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><TeamLogo abbr={r.team} teams={teams} size={18} />{r.team}</span>],
            stats: r.stats,
          }))} />
        </Card>
      ))}
      {!career && <Card><span style={{ fontFamily: BODY, color: MUTED }}>Loading stats…</span></Card>}
    </div>
  );
  const gameLogTable = (
    <Card title={`${shownSeason} Game Log`} pad={false}>
      {games.rows.length ? (
        <StatTable labels={games.labels} lead={["Wk", "Opp", "Result"]} rows={games.rows.map((g) => ({
          lead: [g.week, <span key="o" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{g.atVs}{g.oppLogo && <img src={g.oppLogo} alt="" style={{ width: 18, height: 18 }} />}{g.opp}</span>,
            <span key="r" style={{ color: g.result === "W" ? "#1f9d55" : g.result === "L" ? "#c8102e" : MUTED }}>{g.result} {g.score}</span>],
          stats: g.stats,
        }))} />
      ) : <div style={{ padding: 16, fontFamily: BODY, color: MUTED }}>{log ? "No games this season." : "Loading…"}</div>}
    </Card>
  );
  const statsTab = (
    <div>
      {/* Sub-tabs, with the game log's season picker on the right. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, margin: "2px 0 12px" }}>
        <div role="tablist" style={{ display: "flex", gap: isMobile ? 14 : 20 }}>
          {subTab("seasons", "Season")}
          {subTab("games", "Game Log")}
        </div>
        {statsView === "games" && (
          <div role="tablist" aria-label="Season" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(seasonOptions?.options || []).map((o) => {
              const on = o.value === shownSeason;
              return (
                <button key={o.value} role="tab" aria-selected={on} onClick={() => setSeason(o.value)} style={{
                  border: `2px solid ${on ? c1 : "#e3e8ef"}`, background: on ? c1 : "#fff", color: on ? "#fff" : "#5b6676", borderRadius: 999,
                  padding: "3px 12px", fontSize: 12, fontWeight: 900, cursor: "pointer", boxShadow: on ? `inset 0 -2px 0 ${c2}` : "none",
                }}>{o.displayValue}</button>
              );
            })}
          </div>
        )}
      </div>
      {statsView === "seasons" ? seasonTables : gameLogTable}
    </div>
  );

  // ── His draft class at his position, in pick order (the prospect page's
  // drafted-class list): drafting team's logo, name, "Round 1 Pick 3".
  // Only players with an NFL page link; he's highlighted. ──
  const classLabel = hist ? `${hist.Year} ${hist.Position}` : "";
  const classRow = (p, mobile) => {
    const self = p.id === hist?.id;
    const pickLine = p.Pick ? `Round ${p.Round} Pick ${p.Pick}` : "Undrafted";
    const teamAbbr = ABBR_BY_NAME[p.teamName] || "";
    const content = (
      <>
        <span style={{ flexShrink: 0, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }} title={p.teamName}>
          {teamAbbr ? <TeamLogo abbr={teamAbbr} teams={teams} size={28} /> : <span style={{ color: "#ccc", fontWeight: 900 }}>—</span>}
        </span>
        {mobile ? (
          <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, minWidth: 0, color: BLUE, fontFamily: HEAD, fontWeight: 900, fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.First} {p.Last}</span>
            <span style={{ flexShrink: 0, color: "#777", fontWeight: 800, fontSize: 11, whiteSpace: "nowrap" }}>{pickLine}</span>
          </span>
        ) : (
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ color: BLUE, fontFamily: HEAD, fontWeight: 900, fontSize: 14, lineHeight: 1.2 }}>{p.First} {p.Last}</span>
            <span style={{ color: "#777", fontWeight: 700, fontSize: 12, marginTop: 2, fontFamily: BODY }}>{pickLine}</span>
          </span>
        )}
      </>
    );
    const style = {
      display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", textDecoration: "none", borderBottom: "1px solid #f0f0f0",
      background: self ? "#fff8e6" : "#fff", borderLeft: `4px solid ${self ? GOLD : "transparent"}`,
    };
    return NFL_PLAYER_PAGES[p.slug] && !self
      ? <Link key={p.id} to={`/player/${p.slug}`} style={style}>{content}</Link>
      : <div key={p.id} style={style}>{content}</div>;
  };
  // The prospect page's cap: the first 20, plus him if he's further down.
  const CLASS_LIMIT = 20;
  const selfAt = (classRows || []).findIndex((p) => p.id === hist?.id);
  const shownClass = (classRows || []).slice(0, CLASS_LIMIT).concat(selfAt >= CLASS_LIMIT ? [classRows[selfAt]] : []);
  const classList = (mobile) => (
    <>
      <Link to={`/community/${hist?.Year || ""}`} style={{
        display: "flex", justifyContent: "center", padding: "10px 14px", textDecoration: "none", background: BLUE, color: GOLD,
        fontFamily: HEAD, fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", borderBottom: "1px solid #f0f0f0",
      }}>Full {hist?.Year} Board →</Link>
      {classRows == null
        ? <div style={{ padding: 16, textAlign: "center", color: "#999", fontFamily: BODY, fontSize: 13 }}>Loading…</div>
        : shownClass.map((p) => classRow(p, mobile))}
    </>
  );
  const classCard = hist && (
    <div style={{ border: `2px solid ${BLUE}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ background: BLUE, padding: "12px 14px", textAlign: "center" }}>
        <h2 style={{ margin: 0, color: "#fff", fontFamily: HEAD, fontWeight: 900, fontSize: 20, letterSpacing: "0.08em", textTransform: "uppercase" }}>{classLabel}</h2>
      </div>
      <div style={{ height: 4, background: GOLD }} />
      <div style={{ background: "#fff" }}>{classList(false)}</div>
    </div>
  );
  const classDropdown = hist && (
    <details style={{ border: `2px solid ${BLUE}`, borderRadius: 10, overflow: "hidden", background: "#fff" }}>
      <summary style={{ background: BLUE, padding: "8px 14px", cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", justifyContent: "space-between", userSelect: "none" }}>
        <h2 style={{ margin: 0, color: "#fff", fontFamily: HEAD, fontWeight: 900, fontSize: 20, letterSpacing: "0.04em", textTransform: "uppercase" }}>{classLabel} Class</h2>
        <span style={{ color: GOLD, fontFamily: HEAD, fontWeight: 900, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>View More</span>
      </summary>
      <div style={{ height: 4, background: GOLD }} />
      {classList(true)}
    </details>
  );

  // ── Sidebar: next game, recent games + the site's news ──
  // Next Game: a matchup band, away @ home, each side in its own team
  // color fading to black at the middle, with its logo, abbreviation and
  // record; then the week, kickoff,
  // stadium and TV.
  // ESPN keeps a finished game here for a while after it ends — no card then.
  const nextRaw = overview?.nextGame?.league?.events?.[0];
  const nextState = nextRaw?.fullStatus?.type?.state || nextRaw?.status || "";
  const next = nextRaw && nextState !== "post" ? nextRaw : null;
  const sides = ["away", "home"].map((ha) => (next?.competitors || []).find((c) => c.homeAway === ha)).filter(Boolean);
  const kickoff = next ? new Date(next.date) : null;
  const nextCard = next && sides.length === 2 && (
    <section style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #e3e8ef", background: "#fff", boxShadow: "0 2px 10px rgba(16,34,64,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: BLUE }}>
        <h2 style={{ margin: 0, color: "#fff", fontFamily: HEAD, fontWeight: 900, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase" }}>Next Game</h2>
        {nextState === "in"
          ? <span style={{ background: "#c8102e", color: "#fff", borderRadius: 999, padding: "2px 8px", fontFamily: HEAD, fontWeight: 900, fontSize: 10, letterSpacing: "0.1em" }}>● LIVE</span>
          : next.weekText && <span style={{ color: GOLD, fontFamily: HEAD, fontWeight: 900, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>{next.weekText}</span>}
      </div>
      <div style={{ height: 3, background: GOLD }} />
      <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr", alignItems: "stretch" }}>
        {sides.map((t, i) => {
          const tc1 = teams[t.abbreviation]?.Color1 || `#${t.color || "333"}`;
          const side = (
            <Link key={t.abbreviation} to={`/nfl/${t.abbreviation.toLowerCase()}`} style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "14px 6px", textDecoration: "none",
              // Each side in its color, fading to black where they meet.
              background: `linear-gradient(${i ? 270 : 90}deg, ${tc1} 0%, ${tc1} 45%, #000 100%)`, color: "#fff",
            }}>
              <img src={teams[t.abbreviation]?.LogoDark || t.logoDark || t.logo} alt={t.displayName} style={{ width: 52, height: 52, objectFit: "contain", filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.35))" }} />
              <span style={{ fontFamily: HEAD, fontWeight: 900, fontSize: 15, letterSpacing: "0.04em" }}>{t.abbreviation}</span>
              {t.record && <span style={{ fontFamily: BODY, fontWeight: 700, fontSize: 11, opacity: 0.85 }}>{t.record}</span>}
            </Link>
          );
          return side;
        })}
        <span aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", color: GOLD, fontFamily: HEAD, fontWeight: 900, fontSize: 16, pointerEvents: "none" }}>@</span>
      </div>
      <div style={{ padding: "10px 14px 12px", textAlign: "center" }}>
        <div style={{ fontFamily: HEAD, fontWeight: 900, fontSize: 14, color: INK, textTransform: "uppercase", letterSpacing: "0.03em" }}>
          {kickoff.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {kickoff.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          {next.location && <span style={{ fontFamily: BODY, fontSize: 12, fontWeight: 700, color: MUTED }}>{next.location}</span>}
          {(next.broadcasts || []).map((b) => (
            <span key={b.name || b} style={{ background: BLUE, color: "#fff", borderRadius: 999, padding: "2px 9px", fontFamily: HEAD, fontWeight: 900, fontSize: 10, letterSpacing: "0.06em" }}>{b.shortName || b.name || b}</span>
          ))}
        </div>
      </div>
    </section>
  );

  // Recent Games: his last three, the Next Game card's look — week,
  // opponent and result, his line under it; Full Log opens Stats → Game Log.
  const recentCard = games.rows.length > 0 && (
    <section style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #e3e8ef", background: "#fff", boxShadow: "0 2px 10px rgba(16,34,64,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: BLUE }}>
        <h2 style={{ margin: 0, color: "#fff", fontFamily: HEAD, fontWeight: 900, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase" }}>Recent Games</h2>
        <button onClick={() => { setTab("stats"); setStatsView("games"); }} style={{ background: "none", border: "none", padding: 0, color: GOLD, fontWeight: 900, fontSize: 11, cursor: "pointer", fontFamily: HEAD, letterSpacing: "0.08em" }}>FULL LOG →</button>
      </div>
      <div style={{ height: 3, background: GOLD }} />
      {games.rows.slice(0, 3).map((g, i, list) => {
        const col = (name) => g.stats[games.names.indexOf(name)];
        const rush = `${col("rushingAttempts")} car, ${col("rushingYards")} yds, ${col("rushingTouchdowns")} TD`;
        const rec = `${col("receptions")} rec, ${col("receivingYards")} yds, ${col("receivingTouchdowns")} TD`;
        const line = pos === "QB"
          ? `${col("completions")}/${col("passingAttempts")}, ${col("passingYards")} yds, ${col("passingTouchdowns")} TD, ${col("interceptions")} INT`
          : ["RB", "FB"].includes(pos) ? `${rush} · ${rec}`
          : ["WR", "TE"].includes(pos) ? rec
          : games.labels.slice(0, 4).map((l, j) => `${g.stats[j]} ${l}`).join(", ");
        return (
          <div key={g.id} style={{ padding: "10px 14px", borderBottom: i < list.length - 1 ? "1px solid #f0f0f0" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: HEAD, fontWeight: 900, fontSize: 10, color: MUTED, width: 32, whiteSpace: "nowrap" }}>WK {g.week}</span>
              {g.oppLogo && <img src={g.oppLogo} alt={g.opp} style={{ width: 22, height: 22, objectFit: "contain" }} />}
              <span style={{ fontFamily: HEAD, fontWeight: 900, fontSize: 12, color: INK, whiteSpace: "nowrap" }}>{g.atVs} {g.opp}</span>
              <span style={{ marginLeft: "auto", fontFamily: HEAD, fontWeight: 900, fontSize: 11, whiteSpace: "nowrap", color: g.result === "W" ? "#1f9d55" : g.result === "L" ? "#c8102e" : MUTED }}>{g.result} {g.score}</span>
            </div>
            <div style={{ marginTop: 4, fontFamily: BODY, fontSize: 12, fontWeight: 700, color: INK, lineHeight: 1.4 }}>{line}</div>
          </div>
        );
      })}
    </section>
  );

  // In the News — the prospect page's sidebar card: a date tile and the
  // headline, our own articles and Weekly Mock items only.
  const NEWS_LIMIT = 8;
  const newsCard = (
    <div style={{ border: `2px solid ${BLUE}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ background: BLUE, padding: "12px 14px", textAlign: "center" }}>
        <h2 style={{ margin: 0, color: "#fff", fontFamily: HEAD, fontWeight: 900, fontSize: 20, letterSpacing: "0.08em", textTransform: "uppercase" }}>In The News</h2>
      </div>
      <div style={{ height: 4, background: GOLD }} />
      <div style={{ background: "#fff" }}>
        {siteNews.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center", color: "#999", fontStyle: "italic", fontSize: 13, fontFamily: BODY }}>No recent news.</div>
        ) : siteNews.slice(0, NEWS_LIMIT).map((n, i, list) => {
          const d = n.publishedAt?.toDate?.() || (n.publishedAt ? new Date(n.publishedAt) : null);
          return (
            <Link key={n.id} to={n.href} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", textDecoration: "none", borderBottom: i < list.length - 1 ? "1px solid #f0f0f0" : "none" }}>
              <div style={{ flexShrink: 0, width: 36, border: `2px solid ${BLUE}`, borderRadius: 4, overflow: "hidden", background: "#fff", textAlign: "center" }}>
                <div style={{ background: GOLD, color: "#fff", fontSize: 8, fontWeight: 900, textTransform: "uppercase", lineHeight: 1, padding: "1px 0", fontFamily: HEAD }}>{d ? d.toLocaleDateString(undefined, { month: "short" }) : ""}</div>
                <div style={{ color: BLUE, fontSize: 15, fontWeight: 900, lineHeight: 1, padding: "3px 0 2px", fontFamily: HEAD }}>{d ? d.getDate() : ""}</div>
              </div>
              <h3 style={{ margin: 0, flex: 1, minWidth: 0, color: "#222", fontFamily: HEAD, fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.03em", lineHeight: 1.25 }}>{n.title}</h3>
            </Link>
          );
        })}
      </div>
    </div>
  );
  const sidebar = (
    <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
      {nextCard}
      {recentCard}
      {newsCard}
    </div>
  );

  const evaluationTab = tab === "evaluation" && (
    <NflEvaluationTab slug={slug} espnId={cfg.espnId} teamAbbr={abbr} position={hist?.Position || pos} draft={hist} first={first} name={`${first} ${last}`} isMobile={isMobile} user={user} login={login} />
  );
  const body = { evaluation: evaluationTab, draft: draftTab, stats: statsTab }[tab];

  return (
    <div style={{ background: "#f4f6f9", minHeight: "100vh" }}>
      <Helmet>
        <title>{`${first} ${last} — ${athlete?.team?.displayName || "NFL"} ${pos} | We-Draft`}</title>
        <meta name="description" content={`${first} ${last}: stats, game log, career path and his ${hist?.Year || ""} draft profile on We-Draft.com.`} />
      </Helmet>
      {isMobile ? (
        <div style={{ padding: "10px 10px 60px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {classDropdown}
          {hero}
          {tabBar}
          {body}
          {sidebar}
        </div>
      ) : (
        <div style={{ maxWidth: 1600, margin: "0 auto", padding: "16px 60px 60px", display: "grid", gridTemplateColumns: "260px minmax(0, 800px) 260px", gap: 18, alignItems: "start", justifyContent: "center" }}>
          <div style={{ position: "sticky", top: 20 }}>{classCard}</div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16, minWidth: 0 }}>
            {hero}
            {tabBar}
            {body}
          </div>
          {sidebar}
        </div>
      )}
    </div>
  );
}
