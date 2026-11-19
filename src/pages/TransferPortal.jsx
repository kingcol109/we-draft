// src/pages/TransferPortal.jsx
//
// /portal and /portal/:position — the public Transfer Portal: every
// We-Draft player in this cycle's portal on one board, every draft class at
// once (players.PortalCycle = the season the portal feeds, set from Admin →
// Players when they enter): uncommitted (InPortal), committed (resolved:
// PortalCommittedAt, PriorSchool → School) and withdrawn (PortalWithdrawnAt,
// still at School — the same logo in From and To).
//
// /portal/news/updates (was /portal/updates) — the moves themselves, newest first: entered, committed,
// withdrew (view="updates"; same data, no extra reads).
//
// /portal/:team(/:tab) — every FBS team (utils/portalTeams.js, slug from the
// school name: /portal/ohio-state), three tabs (user, 2026-11-17):
//   Movement (default)  its comings and goings — the moves feed, All /
//                       Coming In / Going Out (?dir=in|out)
//   /roster             the projected 2027 roster, position by position
//                       (like the NFL team pages): returning players,
//                       portal additions and the 2027 high school class,
//                       departures at the bottom — still in the portal,
//                       transferred, NFL, out of eligibility
//   /needs              the sim's team needs, position by position
//   /targets            "Transfer Portal Targets and Projections": the
//                       admin's recommended targets
//                       (config/portalTargets — by stars, then the admin's
//                       order, then last name) and the sim's suggestions
// Roster and Targets come from compSnapshots/_portal_{slug}
// (server/portal/public.js — the Portal Sim's own logic, run server side).
// A segment that's a position (qb…) is the board; anything else is looked
// up as a team. Built like the Community Board (CommunityBoard.js — same
// kit, components/boardKit.js): position pills with their own routes (OL
// and DB split into OT / IOL and CB / S, ?sub=), filters, sortable columns.
//
// Stars: the admin's transfer stars (2–6, the Grades tab — the same grades
// the Portal Sim uses), never community draft grades (user, 2026-11-17).
//
// Where the board shows class rank, the portal shows seasons of eligibility
// left (utils/eligibility.js seasonsLeft — the 5-season rule, from the
// recruit year), counted from the season the open portal feeds. Filters:
// status (All / Uncommitted / Committed, ?status=), home state, eligibility
// left, previous school's conference, stars, search.
//
// Reads: two queries (players where PortalCycle == this cycle; players
// where InPortal == true, for anyone entered before the cycle tag), the
// board snapshot (utils/portalData.js — the CFBD portal's other entries and
// every We-Draft player's stars), the admin's locks (config/portalGrades)
// and the schools' branding (useSchools, batched). A team page adds its
// own snapshot, and Targets the admin's recommendations.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import PortalWindowBar from "../components/PortalWindowBar";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { Helmet } from "react-helmet-async";
import { db } from "../firebase";
import LoadingSpinner from "../components/LoadingSpinner";
import { SideRailAd } from "../components/MarginAds";
import { useSchools } from "../components/DraftArchiveList";
import {
  BOARD_MODERN_STYLE, POS_COL_W, LOGO_COL_W, DropdownChecklist, formatHeight, parseHeight,
} from "../components/boardKit";
import TransferStars from "../components/TransferStars";
import PortalSimButton from "../components/portalSim/PortalSimButton";
import DepartureIcon, { GRAD_ICON, NFL_ICON } from "../components/DepartureIcon";
import { CareerStop, useCareerPath } from "../components/PlayerEligibilityInfo";
import { useHeadshot } from "../components/draftSim/simHeadshots";
import { activePortalSeason, currentDraftClass, seasonsLeft } from "../utils/eligibility";
import { isUnreleasedSlug, isUnreleasedYear, useIsAdmin } from "../utils/prospectYears";
import {
  DEPARTURES, ROSTER_GROUPS, WANT_LABEL, fetchPortalBoard, fetchPortalLocks, fetchPortalManual, fetchPortalStats, fetchPortalTargets, fetchPortalTeamPage,
  manualStands, sortRecommendations, starsWithLocks, teamRecommendations,
} from "../utils/portalData";
import { SUB_TABS, inSubTab } from "../utils/subPositions";
import { STATE_ABBR } from "../utils/highSchoolMatch";
import { FBS_CONFERENCES, buildPortalTeams, portalTeamSlug } from "../utils/portalTeams";
import { getSiteSnapshot } from "../utils/siteSnapshots";
import { STAT_COLUMNS } from "../utils/portalStats";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#0f1b2d";
const SEASON = activePortalSeason();
// When the real portal officially opens (user, 2026-11-18) — until then an
// empty team Movement section points to the Portal Sim.
const PORTAL_OPENS = Date.UTC(2027, 0, 4, 5); // Jan 4, 2027, midnight Eastern

const POSITIONS = ["QB", "RB", "WR", "TE", "OL", "EDGE", "DL", "LB", "DB", "K", "P"];
const POSITION_PLURAL = {
  QB: "Quarterback", RB: "Running Back", WR: "Wide Receiver", TE: "Tight End", OL: "Offensive Line",
  EDGE: "Edge Rusher", DL: "Defensive Line", LB: "Linebacker", DB: "Defensive Back", K: "Kicker", P: "Punter",
};
const STAR_OPTIONS = ["6★", "5★", "4★", "3★", "2★"];
// Text on a fill: ink on a light one (a white or gold Color2), else white.
function inkOn(hex) {
  const m = String(hex || "").replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "#fff";
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? INK : "#fff";
}
const eligLabel = (n) => (n === 1 ? "1 Season Left" : `${n} Seasons Left`);

// Seasons-left chip colors: plenty left is green, one left is gold.
const ELIG_COLOR = (n) => (n >= 3 ? "#2e7d32" : n === 2 ? BLUE : n === 1 ? "#c77700" : "#8a97ab");

const MOBILE_SORTS = [
  ["Stars:desc", "Stars"],
  ["Elig:desc", "Most Eligibility"],
  ["Player:asc", "Name"],
];
// Status: everyone this cycle, still in the portal, committed, or withdrawn.
const STATUSES = [["", "All"], ["uncommitted", "Uncommitted"], ["committed", "Committed"], ["withdrawn", "Withdrawn"]];
// The updates feed's move types.
const MOVES = [["", "All Moves"], ["entered", "Entered"], ["committed", "Committed"], ["withdrew", "Withdrew"]];
const MOVE_STYLE = {
  entered: { label: "Entered", color: BLUE, bg: "#eaf1ff" },
  committed: { label: "Committed", color: "#2e7d32", bg: "#e8f5e9" },
  withdrew: { label: "Withdrew", color: "#8a5a00", bg: "#fff4dd" },
};
// "Today", "Yesterday", or "Wednesday, Nov 12" — the updates feed's day headers.
function dayLabel(ms) {
  const d = new Date(ms);
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

// Home state as its two-letter code ("TX"); the high school is in its
// tooltip and the search.
const stateCode = (p) => STATE_ABBR[p.State] || p.State || "";

// The From / To logo columns (desktop).
const FROM_TO_W = 52;

const toMs = (ts) => (ts?.toMillis ? ts.toMillis() : ts?.toDate ? ts.toDate().getTime() : ts instanceof Date ? ts.getTime() : Number(ts) || 0);
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");
const fullName = (p) => `${p.First || ""} ${p.Last || ""}`.trim();

// This cycle's portal players — cached for the session, so moving between
// the board, the updates and team pages doesn't read them again.
let portalPromise = null;
function fetchPortalPlayers() {
  if (!portalPromise) {
    portalPromise = Promise.all([
      getDocs(query(collection(db, "players"), where("InPortal", "==", true))),
      getDocs(query(collection(db, "players"), where("PortalCycle", "==", String(SEASON)))),
    ]).then(([inSnap, outSnap]) => {
      const byId = new Map();
      inSnap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
      outSnap.docs.forEach((d) => { if (!byId.has(d.id)) byId.set(d.id, { id: d.id, ...d.data() }); });
      return [...byId.values()];
    }).catch((e) => { portalPromise = null; throw e; });
  }
  return portalPromise;
}

// Every FBS team by portal slug: compSnapshots/_cfbTeams (one read), or one
// schools query by conference before that doc exists. Cached for the session.
let teamsPromise = null;
function fetchPortalTeams() {
  if (!teamsPromise) {
    teamsPromise = (async () => {
      const snap = await getSiteSnapshot("_cfbTeams");
      if (snap?.teams) return snap.teams;
      const live = await getDocs(query(collection(db, "schools"), where("Conference", "in", FBS_CONFERENCES)));
      return buildPortalTeams(live.docs.map((d) => d.data()));
    })().catch((e) => { console.error("Portal teams load error:", e); teamsPromise = null; return {}; });
  }
  return teamsPromise;
}

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const h = () => setM(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return m;
}

// A roster chip's face (user, 2026-11-17: headshots on the roster): ESPN's
// college headshot by his CFBD id (the same as ESPN's), else the team's
// logo (user, 2026-11-17), else his initials in the team color. Module
// level, so its fallback survives re-renders.
// muted: off the roster (grey); dashed: in the portal.
const espnHeadshot = (id) => (id && /^\d+$/.test(String(id)) ? `https://a.espncdn.com/i/headshots/college-football/players/full/${id}.png` : "");
function RosterFace({ id, name, size, color, logo = "", muted = false, dashed = false }) {
  const [ok, setOk] = useState(true);
  const [logoOk, setLogoOk] = useState(true);
  useEffect(() => { setOk(true); }, [id]);
  useEffect(() => { setLogoOk(true); }, [logo]);
  const src = ok ? espnHeadshot(id) : "";
  const initials = String(name || "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div style={{
      width: size, height: size, flexShrink: 0, borderRadius: 9, overflow: "hidden", boxSizing: "border-box",
      background: muted ? "#e3e7ec" : `color-mix(in srgb, ${color} 12%, #fff)`, border: dashed ? "2px dashed #c77700" : `2px solid ${muted ? "#c3cad4" : color}`,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      {src
        ? <img src={src} alt="" loading="lazy" onError={() => setOk(false)} style={{ width: "135%", maxWidth: "none", height: "auto", flexShrink: 0, filter: muted ? "grayscale(1)" : "none" }} />
        : logo && logoOk
          ? <img src={logo} alt="" loading="lazy" onError={() => setLogoOk(false)} style={{ alignSelf: "center", width: "72%", height: "72%", objectFit: "contain", filter: muted ? "grayscale(1)" : "none", opacity: muted ? 0.6 : 1 }} />
          : <span style={{ alignSelf: "center", fontWeight: 900, fontSize: Math.round(size * 0.34), color: muted ? "#8a97ab" : color }}>{initials}</span>}
    </div>
  );
}

// One line of text at the biggest size that fits its box (max → min px):
// the player card's stacked first / last name (user, 2026-11-17).
function FitLine({ text, max, min = 12, style }) {
  const ref = useRef(null);
  const [size, setSize] = useState(max);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      let s = max;
      el.style.fontSize = `${s}px`;
      while (s > min && el.scrollWidth > el.clientWidth) { s -= 1; el.style.fontSize = `${s}px`; }
      setSize(s);
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [text, max, min]);
  return <div ref={ref} style={{ ...style, fontSize: size, whiteSpace: "nowrap", overflow: "hidden" }}>{text}</div>;
}

// embedded (Portal News's Latest Moves tab — pages/PortalNews.jsx, at
// /portal/news/updates): the updates feed alone — its move filters and the
// feed — inside that page's own layout; no hero, rails or SEO tags here.
export default function TransferPortal({ view = "board", embedded = false }) {
  const isUpdates = view === "updates";
  const { isAdmin } = useIsAdmin();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { position: posParam, tab: tabParam } = useParams();
  const [params, setParams] = useSearchParams();
  const position = POSITIONS.includes(String(posParam || "").toUpperCase()) ? String(posParam).toUpperCase() : "";
  const sub = SUB_TABS[position]?.some(([k]) => k === params.get("sub")) ? params.get("sub") : "";
  const status = STATUSES.some(([k]) => k && k === params.get("status")) ? params.get("status") : "";
  // Not a position: a team (/portal/ohio-state). An unknown one goes back to
  // the full portal once the teams are in.
  const teamSlug = posParam && !position ? String(posParam).toLowerCase() : "";
  const [teams, setTeams] = useState(null);
  useEffect(() => { let c = false; fetchPortalTeams().then((t) => { if (!c) setTeams(t); }); return () => { c = true; }; }, []);
  const team = teamSlug && teams ? teams[teamSlug] || null : null;
  useEffect(() => {
    if ((teamSlug && teams && !teams[teamSlug]) || (position && tabParam)) navigate("/portal", { replace: true });
  }, [teamSlug, teams, position, tabParam, navigate]);
  const TEAM_TABS = [["", "Movement"], ["roster", "2027 Roster"], ["needs", "Team Needs"], ["targets", "Targets"]];
  const teamTab = TEAM_TABS.some(([k]) => k && k === tabParam) ? tabParam : "";
  const isTeam = !!teamSlug;
  // An old team tab (activity / additions / losses) → Movement.
  useEffect(() => {
    if (teamSlug && tabParam && !TEAM_TABS.some(([k]) => k === tabParam)) {
      const dir = tabParam === "additions" ? "?dir=in" : tabParam === "losses" ? "?dir=out" : "";
      navigate(`/portal/${teamSlug}${dir}`, { replace: true });
    }
  }, [teamSlug, tabParam, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const [real, setReal] = useState(null); // null = loading
  const [board, setBoard] = useState(null); // { entries, stars } — null = loading
  const [locks, setLocks] = useState({});
  const [manual, setManual] = useState({}); // the admin's manual portal entries (config/portalManual)
  // The quick player card: what the clicked row knows, plus his team-page
  // row (high school, recruiting, college stops, 2026 stats —
  // server/portal/public.js) found by pool id on his old school's page.
  const [card, setCard] = useState(null);
  const [cardRow, setCardRow] = useState(undefined); // undefined = looking
  useEffect(() => {
    if (!card) return undefined;
    if (card.row) { setCardRow(card.row); return undefined; }
    if (!card.poolId || !card.from) { setCardRow(null); return undefined; }
    let c = false;
    setCardRow(undefined);
    fetchPortalTeamPage(portalTeamSlug(card.from))
      .then((d) => { if (!c) setCardRow((d?.roster || []).find((r) => String(r.id) === String(card.poolId)) || null); })
      .catch(() => { if (!c) setCardRow(null); });
    return () => { c = true; };
  }, [card]);
  // His career path the way the player page draws it (PlayerEligibilityInfo
  // useCareerPath): a We-Draft player's own record, else one put together
  // from the team-page row — college stops, high school, recruiting; his
  // CFBD id doubles as ESPN's (national awards, hometown).
  const careerPlayer = useMemo(() => {
    if (!card || cardRow === undefined) return null;
    if (card.doc) return card.doc;
    const r = cardRow || {};
    if (r.hsRow) {
      return { School: card.to || "", HighSchool: r.hs || "", State: r.st || "", RecruitStars: r.rs, RecruitRank: r.rr, RecruitYear: String(SEASON), Eligible: String(SEASON + 3) };
    }
    const next = card.status === "committed" && card.to && card.to !== card.from ? card.to : "";
    const cp = r.cp || [];
    return {
      School: next || card.from || "", CareerStops: cp.map(([From, To, School]) => ({ School, From, To })),
      HighSchool: r.hs?.[0] || "", State: r.hs?.[2] || card.st || "", RecruitStars: r.rs, RecruitRank: r.rr,
      RecruitYear: cp[0]?.[0] ? String(cp[0][0]) : "", InPortal: card.status === "uncommitted",
      // Leaving for the draft / out of eligibility: his college years end
      // this season (no "Present").
      Eligible: String(Number(currentDraftClass()) + (card.fate === "n" || card.fate === "x" ? -1 : 1)),
    };
  }, [card, cardRow]);
  const career = useCareerPath(careerPlayer, card?.poolId ? String(card.poolId) : "", null);
  // Headshot: We-Draft's own (playerPhotos), else ESPN's college one.
  const wdShot = useHeadshot(card?.wd || "");
  const [espnShot, setEspnShot] = useState(true);
  useEffect(() => { setEspnShot(true); }, [card]);
  useEffect(() => {
    if (!card) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setCard(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card]);

  const [states, setStates] = useState([]);
  const [eligs, setEligs] = useState([]);
  const [confs, setConfs] = useState([]);
  const [starPicks, setStarPicks] = useState([]);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("Stars");
  const [sortOrder, setSortOrder] = useState("desc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [railConf, setRailConf] = useState(""); // the side rail's conference ("" = all FBS)
  // A position board's Stats view (user, 2026-11-18): ?view=stats, on the
  // main portal's position pages only, where the position keeps stats (no
  // OL). The stats doc is read only once it opens.
  const statCols = position && !teamSlug && !isUpdates ? STAT_COLUMNS[position] || null : null;
  const statsView = !!statCols && params.get("view") === "stats";
  const [stats, setStats] = useState(null); // null = not loaded
  const [statSort, setStatSort] = useState({ i: -1, dir: "desc" }); // -1 = the position's default
  useEffect(() => {
    if (!statsView || stats) return undefined;
    let c = false;
    fetchPortalStats().then((d) => { if (!c) setStats(d); }).catch(() => { if (!c) setStats({ season: null, rows: {} }); });
    return () => { c = true; };
  }, [statsView, stats]);
  useEffect(() => { setStatSort({ i: -1, dir: "desc" }); }, [position]);
  const move = MOVES.some(([k]) => k && k === params.get("move")) ? params.get("move") : "";

  // This cycle's portal — everyone tagged with it, plus anyone still in the
  // portal from before the tag existed — the board snapshot (the CFBD
  // portal's other entries + stars) and the admin's locks.
  useEffect(() => {
    let cancelled = false;
    fetchPortalPlayers()
      .then((list) => { if (!cancelled) setReal(list); })
      .catch((e) => { console.error("Transfer portal load error:", e); if (!cancelled) setReal([]); });
    fetchPortalBoard()
      .then((b) => { if (!cancelled) setBoard(b); })
      .catch((e) => { console.error("Transfer portal board error:", e); if (!cancelled) setBoard({ entries: [], stars: {} }); });
    fetchPortalLocks().then((l) => { if (!cancelled) setLocks(l); }).catch(() => {});
    fetchPortalManual().then((m) => { if (!cancelled) setManual(m); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // A team's own snapshot (roster, signees, needs, sim targets) and the
  // admin's recommendations — the Roster / Targets tabs only.
  const [teamPage, setTeamPage] = useState(undefined); // undefined = loading, null = not built
  const [recs, setRecs] = useState(null);
  const needsTeamPage = !!teamSlug && ["roster", "needs", "targets"].includes(teamTab);
  useEffect(() => {
    if (!needsTeamPage) return undefined;
    let c = false;
    setTeamPage(undefined);
    fetchPortalTeamPage(teamSlug).then((d) => { if (!c) setTeamPage(d); }).catch(() => { if (!c) setTeamPage(null); });
    return () => { c = true; };
  }, [needsTeamPage, teamSlug]);
  useEffect(() => {
    if (!teamSlug || teamTab !== "targets") return undefined;
    let c = false;
    fetchPortalTargets().then((d) => { if (!c) setRecs(d); }).catch(() => { if (!c) setRecs({ teams: {}, players: {} }); });
    return () => { c = true; };
  }, [teamSlug, teamTab]);

  // The admin's manual entries that stand (utils/portalData.js precedence):
  // not a We-Draft player with his own portal record, and not one CFBD
  // already has committed while the entry doesn't.
  const manualEff = useMemo(() => {
    const liveWd = new Set((real || []).map((p) => p.id));
    const cfbdById = new Map((board?.entries || []).filter((e) => e.id).map((e) => [String(e.id), e]));
    return Object.entries(manual || {}).map(([key, m]) => ({ key, ...m }))
      .filter((m) => !(m.wd && liveWd.has(m.wd)) && manualStands(m, m.pid ? cfbdById.get(String(m.pid)) : null));
  }, [manual, real, board]);

  const all = useMemo(() => {
    const stars = board?.stars || {};
    // We-Draft players: their own records (live).
    const mine = (real || []).filter((p) => isAdmin || !isUnreleasedYear(p.Eligible)).map((p) => {
      const left = seasonsLeft(p, SEASON);
      const withdrawn = !p.InPortal && !!p.PortalWithdrawnAt;
      const committed = !p.InPortal && !withdrawn;
      const [poolId, built] = stars[p.id] || [];
      return {
        ...p,
        status: p.InPortal ? "uncommitted" : withdrawn ? "withdrawn" : "committed",
        committed,
        withdrawn,
        // Withdrawn: still at their school — the same school both ways.
        from: committed ? (p.PriorSchool || "") : (p.PortalOriginalSchool || p.School || ""),
        to: committed || withdrawn ? (p.School || "") : "",
        committedMs: committed ? toMs(p.PortalCommittedAt) : 0,
        withdrawnMs: withdrawn ? toMs(p.PortalWithdrawnAt) : 0,
        elig: left ? left.n : null,
        eligEst: !!left?.est,
        enteredMs: toMs(p.PortalEnteredAt),
        HeightInches: parseHeight(p.Height),
        stars: starsWithLocks(locks, { id: poolId, wdId: p.id, stars: built }),
        poolId: poolId || null,
      };
    });
    // The admin's manual entries (they replace CFBD's row for the player).
    const covered = new Set(manualEff.filter((m) => m.pid).map((m) => String(m.pid)));
    const entered = manualEff.map((m) => {
      const sp = String(m.n || "").split(" ");
      const status = m.st === "c" ? "committed" : m.st === "w" ? "withdrawn" : "uncommitted";
      return {
        id: `man:${m.key}`, First: sp[0] || "", Last: sp.slice(1).join(" "), Position: m.pos || "", SubPosition: m.sub || "", Slug: m.slug || "",
        State: m.state || "", Weight: m.wt || "", HeightInches: m.ht || null,
        status, committed: status === "committed", withdrawn: status === "withdrawn", from: m.from || "", to: m.st === "u" ? "" : m.to || "",
        committedMs: m.st === "c" ? m.cd || 0 : 0, withdrawnMs: m.st === "w" ? m.cd || 0 : 0, enteredMs: m.d || 0,
        elig: m.e ?? null, eligEst: false, stars: starsWithLocks(locks, { id: m.pid, wdId: m.wd, stars: m.s }), poolId: m.pid || null,
      };
    });
    // Everyone else in the CFBD portal (server/portal/public.js _portal_board).
    const theirs = (board?.entries || []).filter((e) => !(e.id && covered.has(String(e.id)))).map((e) => {
      const sp = String(e.n || "").split(" ");
      const status = e.st === "u" ? "uncommitted" : e.st === "w" ? "withdrawn" : "committed";
      return {
        id: `cfbd:${e.k}`, First: sp[0] || "", Last: sp.slice(1).join(" "), Position: e.pos || "", SubPosition: e.sub || "", Slug: "",
        State: e.state || "", Weight: e.wt || "", HeightInches: e.ht || null,
        status, committed: status === "committed", withdrawn: status === "withdrawn", from: e.from || "", to: e.st === "u" ? "" : e.to || "",
        committedMs: status === "committed" ? e.d || 0 : 0, withdrawnMs: status === "withdrawn" ? e.d || 0 : 0, enteredMs: e.d || 0,
        elig: e.e ?? null, eligEst: false,
        stars: starsWithLocks(locks, { id: e.id, stars: e.s }), poolId: e.id || null,
      };
    });
    return [...mine, ...entered, ...theirs];
  }, [real, board, locks, isAdmin, manualEff]);

  // Previous and new schools: logos and conferences.
  const schools = useSchools(all.flatMap((p) => [p.from, p.to]));
  const confOf = (p) => schools[p.from]?.Conference || "";

  // Filter options from who's in the portal.
  const stateOptions = useMemo(() => [...new Set(all.map((p) => p.State).filter(Boolean))].sort(), [all]);
  const eligOptions = useMemo(() => [...new Set(all.map((p) => p.elig).filter((n) => n != null))].sort((a, b) => b - a).map(eligLabel), [all]);
  const confOptions = [...new Set(all.map(confOf).filter(Boolean))].sort();

  const inFilters = (p, { skipPos = false, skipStatus = false } = {}) => {
    if (!skipStatus && status && p.status !== status) return false;
    if (!skipPos && position && p.Position !== position) return false;
    if (!skipPos && sub && !inSubTab(p, position, sub)) return false;
    if (states.length && !states.includes(p.State)) return false;
    if (eligs.length && !(p.elig != null && eligs.includes(eligLabel(p.elig)))) return false;
    if (confs.length && !confs.includes(confOf(p))) return false;
    if (starPicks.length && !starPicks.includes(`${p.stars}★`)) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (![fullName(p), p.from, p.to, p.HighSchool].some((x) => String(x || "").toLowerCase().includes(q))) return false;
    }
    return true;
  };

  // The board's sort (column headers), reused by the team tables.
  const sortRows = (input) => {
    const list = [...input];
    const dir = sortOrder === "asc" ? 1 : -1;
    const cmp = {
      Stars: (a, b) => (a.stars || 0) - (b.stars || 0),
      // Uncommitted first, then committed (by school), then withdrawn.
      Status: (a, b) => (["uncommitted", "committed", "withdrawn"].indexOf(a.status) - ["uncommitted", "committed", "withdrawn"].indexOf(b.status)) || (a.to || "").localeCompare(b.to || ""),
      Elig: (a, b) => (a.elig ?? -1) - (b.elig ?? -1),
      Entered: (a, b) => a.enteredMs - b.enteredMs,
      From: (a, b) => (a.from || "").localeCompare(b.from || ""),
      Position: (a, b) => POSITIONS.indexOf(a.Position) - POSITIONS.indexOf(b.Position),
      Player: (a, b) => (a.Last || "").localeCompare(b.Last || "") || (a.First || "").localeCompare(b.First || ""),
      State: (a, b) => (stateCode(a) || "~").localeCompare(stateCode(b) || "~"),
      Height: (a, b) => (a.HeightInches || 0) - (b.HeightInches || 0),
      Weight: (a, b) => (Number(a.Weight) || 0) - (Number(b.Weight) || 0),
    }[sortKey];
    // Ties: most stars, then most eligibility, then newest.
    return list.sort((a, b) => dir * cmp(a, b) || (b.stars || 0) - (a.stars || 0) || (b.elig ?? -1) - (a.elig ?? -1) || b.enteredMs - a.enteredMs);
  };
  const shown = useMemo(() => sortRows(all.filter((p) => inFilters(p))),
    [all, position, sub, status, states, eligs, confs, starPicks, search, sortKey, sortOrder, schools]); // eslint-disable-line react-hooks/exhaustive-deps

  // Counts per position under the other filters (the pills show them).
  const posCounts = useMemo(() => {
    const c = {};
    all.filter((p) => inFilters(p, { skipPos: true })).forEach((p) => { c[p.Position] = (c[p.Position] || 0) + 1; });
    return c;
  }, [all, status, states, eligs, confs, starPicks, search, schools]); // eslint-disable-line react-hooks/exhaustive-deps

  // Counts per status under the other filters (the status pills show them).
  const statusCounts = useMemo(() => {
    const list = all.filter((p) => inFilters(p, { skipStatus: true }));
    const c = { "": list.length, uncommitted: 0, committed: 0, withdrawn: 0 };
    list.forEach((p) => { c[p.status] += 1; });
    return c;
  }, [all, position, sub, states, eligs, confs, starPicks, search, schools]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSort = (k) => {
    if (sortKey === k) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortOrder(["Stars", "Elig", "Entered", "Height", "Weight"].includes(k) ? "desc" : "asc"); }
  };
  const activeFilters = states.length + eligs.length + confs.length + starPicks.length;
  const reset = () => { setStates([]); setEligs([]); setConfs([]); setStarPicks([]); setSearch(""); setParam("status", ""); };
  const setParam = (key, v) => { const n = new URLSearchParams(params); if (v) n.set(key, v); else n.delete(key); setParams(n, { replace: true }); };
  const setSub = (k) => setParam("sub", k);

  const loading = real === null || board === null;
  const posLabel = position ? (sub || POSITION_PLURAL[position]) : "";
  const statusLabel = STATUSES.find(([k]) => k === status)?.[1];
  const title = `${SEASON} ${posLabel ? `${posLabel} ` : ""}Transfer Portal${status ? ` · ${statusLabel}` : ""}`;

  // Every move this cycle, newest first — the updates feed and Latest Moves.
  const moves = useMemo(() => all.flatMap((p) => [
    p.enteredMs && { kind: "entered", ms: p.enteredMs, p },
    p.committed && p.committedMs && { kind: "committed", ms: p.committedMs, p },
    p.withdrawn && p.withdrawnMs && { kind: "withdrew", ms: p.withdrawnMs, p },
  ].filter(Boolean)).sort((a, b) => b.ms - a.ms), [all]);

  // ── Headers: the CFB team page's hero (TeamPage.js HeroCard) — a
  // color1 → color2 sweep under a dark overlay, drifting stripes and a
  // breathing spotlight, a faded mark off the right, logo | name | buttons
  // (user, 2026-11-18). The board's runs in site blue / gold with the
  // portal mark; a team's in its colors. The counts that used to sit under
  // it were dropped — the status pills and the side rail already say them.
  // to: the team page — the logo and the big name link there (user,
  // 2026-11-18: they replace the old Team Page button).
  const heroShell = ({ c1, c2, mark, watermark, kicker, title: h, sub, links, buttons, to, toLabel }) => (
    <div style={{
      position: "relative", overflow: "hidden", borderRadius: "14px", border: `2px solid ${c2}`, marginBottom: isMobile ? "10px" : "14px",
      boxShadow: "0 10px 28px rgba(0,0,0,0.22)", padding: isMobile ? "18px 14px" : "26px 30px",
      background: ["linear-gradient(rgba(0,0,0,0.38), rgba(0,0,0,0.38))", `linear-gradient(120deg, ${c1} 0%, ${c1} 40%, ${c2} 100%)`].join(", "),
    }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: "-20%", zIndex: 0, pointerEvents: "none", background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 2px, transparent 2px, transparent 40px)", animation: "tpHeroDrift 18s linear infinite" }} />
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", background: "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.18), transparent 55%)", animation: "tpHeroSpotlight 5s ease-in-out infinite" }} />
      {watermark && !isMobile && <img src={watermark} alt="" aria-hidden="true" style={{ position: "absolute", top: "50%", right: "-4%", transform: "translateY(-50%)", width: "60%", maxWidth: "560px", maxHeight: "170%", objectFit: "contain", opacity: 0.14, zIndex: 0, pointerEvents: "none" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
      <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: isMobile ? "14px" : "26px", flexWrap: isMobile ? "wrap" : "nowrap" }}>
        {mark && (() => {
          const img = <img src={mark} alt={to ? toLabel || "" : ""} style={{ display: "block", flexShrink: 0, width: isMobile ? 72 : 130, height: isMobile ? 72 : 130, objectFit: "contain", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.45))" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />;
          return to ? <Link to={to} className="tp-hero-home" title={toLabel} style={{ flexShrink: 0 }}>{img}</Link> : img;
        })()}
        <div style={{ flex: 1, minWidth: 0 }}>
          {kicker && <div style={{ fontSize: isMobile ? "10px" : "12px", fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.82)", marginBottom: "2px" }}>{kicker}</div>}
          <h1 style={{ margin: 0, fontWeight: 900, color: "#fff", lineHeight: 1.05, letterSpacing: "0.02em", textTransform: "uppercase", textShadow: "0 2px 8px rgba(0,0,0,0.4)", fontSize: isMobile ? "24px" : "clamp(28px, 3.2vw, 48px)", overflowWrap: "break-word" }}>
            {to ? <Link to={to} className="tp-hero-home" title={toLabel} style={{ color: "inherit", textDecoration: "none" }}>{h}</Link> : h}
          </h1>
          {sub && <div style={{ marginTop: "2px", fontWeight: 900, color: "rgba(255,255,255,0.88)", lineHeight: 1.1, letterSpacing: "0.02em", textTransform: "uppercase", textShadow: "0 2px 8px rgba(0,0,0,0.4)", fontSize: isMobile ? "15px" : "clamp(16px, 1.8vw, 26px)" }}>{sub}</div>}
          {links && <div style={{ marginTop: "8px", display: "flex", gap: "14px", flexWrap: "wrap", fontSize: "12px", fontWeight: 800 }}>{links}</div>}
        </div>
        {buttons && <div style={{ flexShrink: 0, display: "flex", flexDirection: isMobile ? "row" : "column", alignItems: "stretch", gap: "8px", ...(isMobile ? { flexBasis: "100%" } : {}) }}>{buttons}</div>}
      </div>
    </div>
  );
  const heroLink = (to, label) => <Link key={to} to={to} style={{ color: "#fff", textDecoration: "underline", textUnderlineOffset: "3px", textDecorationColor: "rgba(255,255,255,0.5)" }}>{label}</Link>;
  const Hero = heroShell({
    c1: BLUE, c2: GOLD, mark: "/logos/transfer-portal-white.svg", watermark: "",
    kicker: isUpdates ? "Entries · Commitments · Withdrawals" : "College Football",
    title: isUpdates ? <>{SEASON} <span style={{ color: GOLD }}>Portal</span> Updates</> : <>{SEASON} <span style={{ color: GOLD }}>{posLabel || "Transfer"}</span> Portal</>,
    sub: isUpdates ? "Every move, newest first" : "Rankings · Eligibility · Commitments",
    links: isUpdates ? heroLink("/portal", "← Portal board") : null,
    // The Transfer Portal Sim, the portal's "on the clock" button.
    buttons: <PortalSimButton c1={BLUE} c2={GOLD} isMobile={isMobile} wide={isMobile} />,
  });

  const posPill = (key, label, count) => {
    const active = position === key;
    return (
      <Link key={key || "all"} to={(key ? `/portal/${key.toLowerCase()}` : "/portal") + (() => { const q = new URLSearchParams(); if (status) q.set("status", status); if (statsView && STAT_COLUMNS[key]) q.set("view", "stats"); const t = q.toString(); return t ? `?${t}` : ""; })()} aria-current={active ? "page" : undefined}
        className={"wdb-pill wdb-sel" + (active ? " on" : "")}
        style={{
          flexShrink: 0, display: "inline-flex", alignItems: "center", gap: "6px", padding: isMobile ? "7px 11px" : "7px 13px",
          fontWeight: 900, fontSize: isMobile ? "12px" : "14px", textTransform: "uppercase", letterSpacing: "0.05em", textDecoration: "none",
          border: "2px solid " + GOLD, borderRadius: "10px", background: active ? BLUE : "#fff", color: active ? "#fff" : BLUE, whiteSpace: "nowrap",
          opacity: count === 0 && !active ? 0.55 : 1,
        }}>
        {label}
        {count != null && <span style={{ fontSize: isMobile ? "10px" : "11px", fontWeight: 900, opacity: 0.7 }}>{count}</span>}
      </Link>
    );
  };
  const totalUnderFilters = Object.values(posCounts).reduce((a, b) => a + b, 0);
  const PositionBar = (
    <div style={{ display: "flex", flexWrap: isMobile ? "nowrap" : "wrap", overflowX: isMobile ? "auto" : "visible", gap: isMobile ? "5px" : "6px", justifyContent: isMobile ? "flex-start" : "center", marginBottom: isMobile ? "8px" : "12px", paddingBottom: isMobile ? "2px" : 0 }}>
      {posPill("", "All", loading ? null : totalUnderFilters)}
      {POSITIONS.map((p) => posPill(p, p, loading ? null : posCounts[p] || 0))}
    </div>
  );
  // Status — All / Uncommitted (in the portal, yet to transfer) / Committed.
  const StatusBar = (
    <div role="tablist" aria-label="Portal status" style={{ display: "flex", justifyContent: "center", marginBottom: isMobile ? "8px" : "12px" }}>
      {/* Phones: four equal cells across the screen, the count under each
          label — it used to run off the right edge (user, 2026-11-18). */}
      <div style={isMobile
        ? { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", width: "100%", boxSizing: "border-box", padding: "3px", borderRadius: "14px", background: "#fff", border: "1px solid #e3e8ef", gap: "2px" }
        : { display: "inline-flex", padding: "3px", borderRadius: "999px", background: "#fff", border: "1px solid #e3e8ef", gap: "2px" }}>
        {STATUSES.map(([k, label]) => {
          const on = status === k;
          return (
            <button key={k || "all"} type="button" role="tab" aria-selected={on} onClick={() => setParam("status", k)} style={{
              padding: isMobile ? "6px 2px" : "7px 18px", borderRadius: isMobile ? "11px" : "999px", border: "none", cursor: "pointer", fontFamily: "inherit",
              background: on ? BLUE : "transparent", color: on ? "#fff" : BLUE, fontWeight: 900, fontSize: isMobile ? "10px" : "13px",
              textTransform: "uppercase", letterSpacing: isMobile ? "0.02em" : "0.05em", whiteSpace: "nowrap", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
              ...(isMobile ? { display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.2 } : {}),
            }}>
              {label}{!loading && <span style={{ marginLeft: isMobile ? 0 : "6px", opacity: 0.7, fontSize: "11px" }}>{statusCounts[k]}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
  const SubBar = SUB_TABS[position] && (
    <div style={{ display: "flex", gap: "6px", justifyContent: isMobile ? "flex-start" : "center", marginBottom: isMobile ? "8px" : "12px", flexWrap: "wrap" }}>
      {[["", `All ${position}`], ...SUB_TABS[position].map(([k]) => [k, k])].map(([k, text]) => (
        <button key={k || "all"} type="button" onClick={() => setSub(k)} className={"wdb-pill wdb-sel" + (sub === k ? " on" : "")} style={{
          padding: isMobile ? "5px 10px" : "5px 14px", fontWeight: 900, fontSize: isMobile ? "11px" : "13px", textTransform: "uppercase", letterSpacing: "0.05em",
          border: "2px solid " + GOLD, borderRadius: "999px", cursor: "pointer", fontFamily: "inherit", background: sub === k ? GOLD : "#fff", color: sub === k ? "#fff" : BLUE,
        }}>{text}</button>
      ))}
    </div>
  );

  const dropdowns = (
    <>
      <DropdownChecklist title="State" options={stateOptions} selected={states} setSelected={setStates} />
      <DropdownChecklist title="Eligibility" options={eligOptions} selected={eligs} setSelected={setEligs} ordered />
      <DropdownChecklist title="Conference" options={confOptions} selected={confs} setSelected={setConfs} />
      <DropdownChecklist title="Stars" options={STAR_OPTIONS} selected={starPicks} setSelected={setStarPicks} ordered />
    </>
  );
  const searchBox = (
    <input type="search" className="wdb-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search player, school, high school..." aria-label="Search the portal"
      style={{ border: "2px solid " + GOLD, borderRadius: "8px", padding: "8px 14px", fontWeight: 700, fontSize: isMobile ? "14px" : "13px", color: BLUE, outline: "none", width: isMobile ? undefined : "300px", flex: isMobile ? 1 : undefined, minWidth: 0, boxSizing: "border-box" }} />
  );
  const Filters = isMobile ? (
    <div style={{ marginBottom: "10px" }}>
      <div className="wd-mobile-filter-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
        <button type="button" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} className={"wdb-pill" + (filtersOpen || activeFilters ? " on" : "")}
          style={{ padding: "8px 12px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em", border: "2px solid " + GOLD, borderRadius: "8px", cursor: "pointer", background: filtersOpen || activeFilters ? BLUE : "#fff", color: filtersOpen || activeFilters ? "#fff" : BLUE }}>
          Filters{activeFilters ? ` (${activeFilters})` : ""} {filtersOpen ? "▴" : "▾"}
        </button>
        <select value={`${sortKey}:${sortOrder}`} onChange={(e) => { const [k, o] = e.target.value.split(":"); setSortKey(k); setSortOrder(o); }} aria-label="Sort players" className="wdb-input"
          style={{ border: "2px solid " + GOLD, borderRadius: "8px", padding: "8px 6px", fontWeight: 800, fontSize: "12px", color: BLUE, background: "#fff" }}>
          {MOBILE_SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          {!MOBILE_SORTS.some(([v]) => v === `${sortKey}:${sortOrder}`) && <option value={`${sortKey}:${sortOrder}`}>{sortKey}</option>}
        </select>
      </div>
      {filtersOpen && (
        <div className="wd-mobile-filter-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
          {dropdowns}
        </div>
      )}
      {StatusBar}
      {PositionBar}
      {SubBar}
      <div style={{ display: "flex", gap: "6px" }}>{searchBox}</div>
      {(activeFilters > 0 || search) && (
        <div style={{ textAlign: "center", marginTop: "4px" }}>
          <button type="button" onClick={reset} style={{ background: "none", border: "none", color: "#777", fontSize: "12px", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Reset Filters</button>
        </div>
      )}
    </div>
  ) : (
    <>
      {StatusBar}
      {PositionBar}
      {SubBar}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", justifyContent: "center", marginBottom: "12px" }}>
        {dropdowns}
        {searchBox}
        <button type="button" onClick={reset} style={{ background: "none", border: "none", color: "#999", fontSize: "12px", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Reset</button>
      </div>
    </>
  );

  // A player's We-Draft page, when he has a public one (CFBD-only portal
  // players don't; an unreleased class is admin-only).
  const pageOf = (p) => (p?.Slug && (isAdmin || !isUnreleasedSlug(p.Slug)) ? `/player/${p.Slug}` : "");
  // A player's name opens his quick card (user, 2026-11-17) — the profile
  // link lives in the card.
  const openCard = (p, row = null) => setCard({
    n: fullName(p), pos: p.SubPosition && typeof p.SubPosition === "string" && ["OT", "IOL", "CB", "S"].includes(p.SubPosition) ? p.SubPosition : p.Position, s: p.stars, e: p.elig, eEst: p.eligEst,
    ht: p.HeightInches || parseHeight(p.Height), wt: p.Weight, st: stateCode(p), from: p.from, to: p.to, status: p.status, slug: p.Slug,
    poolId: p.poolId || null, row, fate: row?.f || "",
    // A We-Draft player's own record (the board's live rows): his saved
    // career path, accolades and portal / draft status, as on his page.
    doc: p.Eligible && p.id && !String(p.id).includes(":") ? p : null,
    wd: p.Eligible && p.id && !String(p.id).includes(":") ? p.id : row?.wd || "",
  });
  const NameLink = ({ p, style, hover = true }) => (
    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openCard(p); }}
      style={{ ...style, background: "none", border: "none", padding: 0, margin: 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left", textDecoration: "none" }}
      onMouseEnter={hover ? (e) => { e.currentTarget.style.textDecoration = "underline"; } : undefined}
      onMouseLeave={hover ? (e) => { e.currentTarget.style.textDecoration = "none"; } : undefined}>{fullName(p)}</button>
  );

  // ── Rows ──
  const EligChip = ({ p, small }) => {
    if (p.elig == null) return <div style={{ width: small ? 40 : 58, flexShrink: 0, textAlign: "center", color: "#ccc", fontWeight: 900 }}>—</div>;
    const c = ELIG_COLOR(p.elig);
    return (
      <div title={`${eligLabel(p.elig)} (from ${SEASON})${p.eligEst ? " — estimated from draft class" : ""}`} style={{
        width: small ? 40 : 58, height: small ? 34 : 44, flexShrink: 0, borderRadius: "8px", border: `2px solid ${c}`, background: `color-mix(in srgb, ${c} 9%, #fff)`,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1,
      }}>
        <span style={{ fontSize: small ? "16px" : "21px", fontWeight: 900, color: c, fontVariantNumeric: "tabular-nums" }}>{p.eligEst ? "~" : ""}{p.elig}</span>
        <span style={{ fontSize: "10px", fontWeight: 900, color: c, letterSpacing: "0.08em", marginTop: "2px" }}>{p.elig === 1 ? "YR" : "YRS"}</span>
      </div>
    );
  };

  // ── Phone rows: one layout for the board, the updates feed, team tabs and
  // Targets.
  //   [From → To]  Name ............................. [Comm]
  //                POS  3 YRS  TX
  //                6'4" · 335 lbs · Oct 20
  // `extra` replaces line three (the feed's move, Targets' reasons), `left`
  // goes before the logos (a Targets rank), `lead` before the chips.
  const pill = (text, color, bg, border) => (
    <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", height: "20px", padding: "0 7px", borderRadius: "6px", fontSize: "11px", fontWeight: 900, letterSpacing: "0.04em", color, background: bg, border: border ? `1.5px solid ${border}` : "none", whiteSpace: "nowrap" }}>{text}</span>
  );
  const MobileRow = ({ p, fromMuted, toNode, lead, meta, extra, left }) => {
    const ec = p.elig != null ? ELIG_COLOR(p.elig) : null;
    const facts = [
      p.HeightInches ? formatHeight(p.HeightInches) : "",
      p.Weight ? `${p.Weight} lbs` : "",
      meta,
    ].filter(Boolean);
    return (
      <div className="wdb-row" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 12px", background: "#fff" }}>
        {left}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "3px", padding: "5px 6px", borderRadius: "10px", background: "#f7f9fc", border: "1px solid #eef1f5" }}>
          <SchoolMark name={p.from} size={26} title={`From ${p.from}`} muted={fromMuted} />
          <span aria-hidden="true" style={{ color: "#b8c2d1", fontWeight: 900, fontSize: "11px" }}>→</span>
          {toNode}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
            <NameLink p={p} style={{ color: INK, fontWeight: 900, fontSize: "16px", lineHeight: 1.15, overflowWrap: "break-word", minWidth: 0 }} />
          </div>
          <div style={{ marginTop: "5px", display: "flex", alignItems: "center", gap: "5px", minWidth: 0, overflow: "hidden" }}>
            {lead}
            {p.Position && pill(p.Position, BLUE, "#eaf1ff")}
            {ec && pill(`${p.eligEst ? "~" : ""}${p.elig} ${p.elig === 1 ? "YR" : "YRS"}`, ec, `color-mix(in srgb, ${ec} 9%, #fff)`, ec)}
            {stateCode(p) && <span style={{ flexShrink: 0, fontSize: "12px", fontWeight: 900, color: "#5b6b84", marginLeft: "1px" }}>{stateCode(p)}</span>}
          </div>
          {extra || (facts.length > 0 && <div style={{ marginTop: "4px", fontSize: "12px", fontWeight: 700, color: "#8a97ab", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{facts.join(" · ")}</div>)}
        </div>
        {p.hideStars ? null : <TransferStars stars={p.stars} size="sm" />}
      </div>
    );
  };

  // A school's logo (its abbreviation when there's no logo on file).
  // muted: the old school once they've committed elsewhere — black and white.
  // An FBS school links to its portal page.
  const SchoolMark = ({ name, size, title: t, muted = false, link = true }) => {
    const logo = schools[name]?.Logo1 || teams?.[portalTeamSlug(name)]?.Logo1;
    const slug = teams && name && teams[portalTeamSlug(name)] ? portalTeamSlug(name) : "";
    const style = { width: size, height: size, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", filter: muted ? "grayscale(1)" : "none", opacity: muted ? 0.6 : 1 };
    const inner = logo
      ? <img src={logo} alt={name} loading="lazy" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
      : name ? <span style={{ fontSize: size > 30 ? "11px" : "9px", fontWeight: 900, color: BLUE }}>{name.slice(0, 3).toUpperCase()}</span> : null;
    return link && slug && slug !== teamSlug
      ? <Link to={`/portal/${slug}`} title={t || name} style={style} onClick={(e) => e.stopPropagation()}>{inner}</Link>
      : <div title={t || name} style={style}>{inner}</div>;
  };
  // Where they're headed: the new school, or a question mark while
  // uncommitted.
  const ToCell = ({ p, size }) => (p.withdrawn && p.to
    ? <SchoolMark name={p.to} size={size} title={`Withdrew — staying at ${p.to}${p.withdrawnMs ? ` (${fmtDate(p.withdrawnMs)})` : ""}`} />
    : p.committed && p.to
    ? <SchoolMark name={p.to} size={size} title={`Committed to ${p.to}${p.committedMs ? ` (${fmtDate(p.committedMs)})` : ""}`} />
    : (
      <div title="Uncommitted" aria-label="Uncommitted" style={{ width: size, height: size, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{
          width: Math.round(size * 0.78), height: Math.round(size * 0.78), borderRadius: "50%", border: "2px dashed #b8c2d1", background: "#f7f9fc",
          display: "flex", alignItems: "center", justifyContent: "center", color: "#8a97ab", fontWeight: 900, fontSize: Math.round(size * 0.42), lineHeight: 1,
        }}>?</span>
      </div>
    ));

  // A column header that doesn't sort (From, To, State — user, 2026-11-17).
  const ColLabel = ({ label, width, title: t }) => (
    <div title={t} style={{ width, flexShrink: 0, textAlign: "center", color: "#fff", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.72, whiteSpace: "nowrap" }}>{label}</div>
  );
  const SortLabel = ({ k, label, width, align = "center", title: t }) => {
    const active = sortKey === k;
    return (
      <button type="button" onClick={() => handleSort(k)} aria-pressed={active} aria-label={`Sort by ${t || label}`} title={t}
        style={{
          ...(width ? { width, flexShrink: 0 } : { flex: 1, minWidth: 0 }), display: "flex", alignItems: "center", gap: "5px",
          justifyContent: align === "left" ? "flex-start" : "center", color: active ? GOLD : "#fff", fontWeight: 900, fontSize: "13px",
          textTransform: "uppercase", letterSpacing: "0.08em", cursor: "pointer", background: "none", border: "none", padding: 0, fontFamily: "inherit", opacity: active ? 1 : 0.72,
        }}>
        <span style={{ whiteSpace: "nowrap" }}>{label}</span>
        <span aria-hidden="true" style={{ fontSize: "10px", opacity: active ? 1 : 0.5 }}>{active ? (sortOrder === "asc" ? "▲" : "▼") : "▲"}</span>
      </button>
    );
  };

  const empty = (
    <div style={{ padding: isMobile ? "36px 18px" : "56px 40px", textAlign: "center", background: "#fff" }}>
      {all.length === 0 ? (
        <>
          <div style={{ fontSize: isMobile ? "18px" : "22px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>The portal is quiet</div>
          <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 700, color: "#888", maxWidth: "460px", margin: "0 auto", lineHeight: 1.6 }}>
            No We-Draft players have entered the {SEASON} transfer portal yet. Players show up here as soon as they enter.
          </div>
        </>
      ) : <div style={{ color: "#999", fontStyle: "italic", fontSize: "14px" }}>No players match your filters.</div>}
    </div>
  );

  // A player table (the board's): rows, its title, and which date shows in
  // the last column.
  const renderTable = (rows, { title: tt = title, emptyNode = empty } = {}) => (
    <div className="wdb-card" style={{ borderRadius: "14px", overflow: "hidden", background: "#fff" }}>
      <div className="wdb-cardhead" style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>{tt}</div>
        <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" }}>
          {loading ? "" : `${rows.length} player${rows.length === 1 ? "" : "s"}`}
        </div>
      </div>
      {loading ? <LoadingSpinner label="Loading" size={32} minHeight="240px" /> : isMobile ? (
        <div style={{ maxHeight: "calc(72vh / var(--pz, 1))", overflowY: "auto" }}>
          {rows.length === 0 ? emptyNode : rows.map((p) => (
            <MobileRow key={p.id} p={p} fromMuted={p.committed} toNode={<ToCell p={p} size={26} />} />
          ))}
        </div>
      ) : (
        <div style={{ maxHeight: "820px", overflowY: "auto" }}>
          <div className="wdb-colhead" style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", alignItems: "center", gap: "16px", background: "linear-gradient(135deg, " + BLUE + ", #003d7a)", padding: "12px 20px" }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "14px" }}>
              <SortLabel k="Stars" label="Stars" title="Transfer stars" width="70px" />
              <SortLabel k="Elig" label="Elig" title="Seasons of eligibility left" width="58px" />
              <SortLabel k="Position" label="Pos" title="Position" width={POS_COL_W + "px"} />
              <ColLabel label="From" title="Previous school" width={FROM_TO_W + "px"} />
              <ColLabel label="To" title="New school" width={FROM_TO_W + "px"} />
              <SortLabel k="Player" label="Player" align="left" />
            </div>
            <ColLabel label="State" title="Home state" width="62px" />
            <SortLabel k="Height" label="HT" width="56px" />
            <SortLabel k="Weight" label="WT" width="52px" />
          </div>
          {rows.length === 0 ? emptyNode : rows.map((p) => {
            return (
              <div key={p.id} className="wdb-row" style={{ display: "flex", alignItems: "center", gap: "16px", padding: "11px 20px", background: "#fff", transition: "background 0.12s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#f3f8ff"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}>
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "14px" }}>
                  <div style={{ width: "70px", flexShrink: 0, display: "flex", justifyContent: "center" }}><TransferStars stars={p.stars} /></div>
                  <EligChip p={p} />
                  <div style={{ width: POS_COL_W + "px", flexShrink: 0 }}>
                    <span style={{ display: "block", fontSize: "14px", fontWeight: 900, color: BLUE, background: "#eaf1ff", padding: "6px 0", textAlign: "center", borderRadius: "6px" }}>{p.Position || "—"}</span>
                  </div>
                  <div style={{ width: FROM_TO_W + "px", flexShrink: 0, display: "flex", justifyContent: "center" }}><SchoolMark name={p.from} size={LOGO_COL_W} title={`From ${p.from}`} muted={p.committed} /></div>
                  <div style={{ width: FROM_TO_W + "px", flexShrink: 0, display: "flex", justifyContent: "center" }}><ToCell p={p} size={LOGO_COL_W} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Long names wrap (as on the board) rather than truncate. */}
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 10px", minWidth: 0 }}>
                      <NameLink p={p} hover style={{ color: BLUE, fontWeight: 900, fontSize: "24px", lineHeight: 1.1, overflowWrap: "break-word", minWidth: 0 }} />
                    </div>
                  </div>
                </div>
                <div title={p.HighSchool ? `${p.State}${p.HighSchool ? ` · ${p.HighSchool}` : ""}` : p.State || undefined} style={{ width: "62px", flexShrink: 0, textAlign: "center", fontSize: "19px", fontWeight: 900, color: "#333" }}>{stateCode(p) || "-"}</div>
                <div style={{ width: "56px", flexShrink: 0, textAlign: "center", fontSize: "19px", fontWeight: 900, color: "#333" }}>{p.HeightInches ? formatHeight(p.HeightInches) : (p.Height || "-")}</div>
                <div style={{ width: "52px", flexShrink: 0, textAlign: "center", fontSize: "19px", fontWeight: 900, color: "#333" }}>{p.Weight || "-"}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
  const List = renderTable(shown);

  // ── A position's Stats view: the same players and filters, last
  // season's numbers in the position's columns (utils/portalStats.js). ──
  const ViewBar = statCols && (
    <div role="tablist" aria-label="View" style={{ display: "flex", justifyContent: "center", marginBottom: isMobile ? "8px" : "12px" }}>
      <div style={{ display: "inline-flex", padding: "3px", borderRadius: "10px", background: BLUE, gap: "2px" }}>
        {[["", "Portal Board"], ["stats", "Stats"]].map(([k, label]) => {
          const on = (k === "stats") === statsView;
          return (
            <button key={k || "board"} type="button" role="tab" aria-selected={on} onClick={() => setParam("view", k)} style={{
              padding: isMobile ? "6px 16px" : "7px 22px", borderRadius: "8px", border: "none", cursor: "pointer", fontFamily: "inherit",
              background: on ? GOLD : "transparent", color: "#fff", fontWeight: 900, fontSize: isMobile ? "12px" : "13px", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap",
            }}>{label}</button>
          );
        })}
      </div>
    </div>
  );
  const statDefault = statCols ? Math.max(0, statCols.findIndex((c) => c.label === "YDS")) : 0;
  const statIdx = statSort.i >= 0 && statCols?.[statSort.i] ? statSort.i : statDefault;
  const statOf = (p) => (p.poolId && stats?.rows?.[String(p.poolId)]) || null;
  // Players with no stats last; ties by stars.
  const statRows = !statsView ? [] : [...shown].sort((a, b) => {
    const sa = statOf(a);
    const sb = statOf(b);
    if (!sa || !sb) return ((sa ? -1 : 0) + (sb ? 1 : 0)) || (b.stars || 0) - (a.stars || 0);
    const d = statCols[statIdx].sort(sa) - statCols[statIdx].sort(sb);
    return (statSort.dir === "asc" ? d : -d) || (b.stars || 0) - (a.stars || 0);
  });
  const subOf = (p) => (typeof p.SubPosition === "string" && ["OT", "IOL", "CB", "S"].includes(p.SubPosition) ? p.SubPosition : p.Position);
  const STAT_W = isMobile ? 52 : 66;
  const statW = (c) => (c.label.includes("/") || c.label === "FG" || c.label === "XP" ? STAT_W + 18 : STAT_W);
  const StatsTable = statsView && (() => {
    const nameW = 150;
    const head = (
      <div className="wdb-colhead" style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", alignItems: "center", gap: isMobile ? "8px" : "12px", background: "linear-gradient(135deg, " + BLUE + ", #003d7a)", padding: isMobile ? "10px 12px" : "12px 20px" }}>
        {!isMobile && <ColLabel label="Stars" width="70px" />}
        <ColLabel label="Pos" width={(isMobile ? 40 : POS_COL_W) + "px"} />
        {!isMobile && <ColLabel label="From" width={FROM_TO_W + "px"} />}
        {!isMobile && <ColLabel label="To" width={FROM_TO_W + "px"} />}
        <div style={{ ...(isMobile ? { width: nameW, flexShrink: 0 } : { flex: 1, minWidth: 140 }), color: "#fff", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.72 }}>Player</div>
        {statCols.map((c, i) => {
          const on = i === statIdx;
          return (
            <button key={c.label} type="button" title={c.title} aria-label={`Sort by ${c.title}`} aria-pressed={on}
              onClick={() => setStatSort((cur) => ({ i, dir: i === statIdx && cur.dir === "desc" ? "asc" : "desc" }))}
              style={{ width: statW(c), flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: "3px", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", color: on ? GOLD : "#fff", opacity: on ? 1 : 0.72, fontWeight: 900, fontSize: isMobile ? "11px" : "12px", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
              {c.label}{on && <span aria-hidden="true" style={{ fontSize: "9px" }}>{statSort.dir === "asc" && statSort.i === i ? "▲" : "▼"}</span>}
            </button>
          );
        })}
      </div>
    );
    return (
      <div className="wdb-card" style={{ borderRadius: "14px", overflow: "hidden", background: "#fff" }}>
        <div className="wdb-cardhead" style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>{title} · {stats?.season ? `${stats.season} ` : ""}Season Stats</div>
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" }}>{loading ? "" : `${statRows.length} player${statRows.length === 1 ? "" : "s"}`}</div>
        </div>
        {loading || !stats ? <LoadingSpinner label="Loading stats" size={32} minHeight="240px" /> : (
          <div style={{ maxHeight: isMobile ? "calc(72vh / var(--pz, 1))" : "820px", overflow: "auto" }}>
            <div style={{ minWidth: isMobile ? "max-content" : undefined }}>
              {head}
              {statRows.length === 0 ? empty : statRows.map((p) => {
                const st = statOf(p);
                return (
                  <div key={p.id} className="wdb-row" style={{ display: "flex", alignItems: "center", gap: isMobile ? "8px" : "12px", padding: isMobile ? "9px 12px" : "10px 20px", background: "#fff" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#f3f8ff"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}>
                    {!isMobile && <div style={{ width: "70px", flexShrink: 0, display: "flex", justifyContent: "center" }}><TransferStars stars={p.stars} /></div>}
                    <div style={{ width: (isMobile ? 40 : POS_COL_W) + "px", flexShrink: 0 }}>
                      <span style={{ display: "block", fontSize: isMobile ? "11px" : "13px", fontWeight: 900, color: BLUE, background: "#eaf1ff", padding: "5px 0", textAlign: "center", borderRadius: "6px" }}>{subOf(p) || "—"}</span>
                    </div>
                    {!isMobile && <div style={{ width: FROM_TO_W + "px", flexShrink: 0, display: "flex", justifyContent: "center" }}><SchoolMark name={p.from} size={34} title={`From ${p.from}`} muted={p.committed} /></div>}
                    {!isMobile && <div style={{ width: FROM_TO_W + "px", flexShrink: 0, display: "flex", justifyContent: "center" }}><ToCell p={p} size={34} /></div>}
                    <div style={isMobile ? { width: nameW, flexShrink: 0, display: "flex", alignItems: "center", gap: "6px", minWidth: 0 } : { flex: 1, minWidth: 140 }}>
                      {isMobile && <SchoolMark name={p.from} size={22} title={`From ${p.from}`} muted={p.committed} />}
                      <NameLink p={p} hover style={{ color: BLUE, fontWeight: 900, fontSize: isMobile ? "13px" : "19px", lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isMobile ? "nowrap" : "normal", minWidth: 0 }} />
                    </div>
                    {statCols.map((c, i) => {
                      const v = st ? c.value(st) : "";
                      return (
                        <div key={c.label} style={{ width: statW(c), flexShrink: 0, textAlign: "center", fontSize: isMobile ? "13px" : "16px", fontWeight: 900, fontVariantNumeric: "tabular-nums", color: !st ? "#c3cad4" : i === statIdx ? INK : "#4a5568" }}>
                          {st && v !== "" ? (typeof v === "number" ? v.toLocaleString("en-US") : v) : "—"}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  })();

  // ── Sidebars: latest entries, and the portal by position. ──
  const latest = moves.slice(0, 8);
  // Each school's comings and goings (commits in; entries and transfers
  // out — a withdrawal stays home) — the team rails.
  const flow = useMemo(() => {
    const add = {};
    const lost = {};
    all.forEach((p) => {
      if (p.committed && p.to) add[p.to] = (add[p.to] || 0) + 1;
      if (p.from && !p.withdrawn) lost[p.from] = (lost[p.from] || 0) + 1;
    });
    return { add, lost };
  }, [all]);
  const teamRows = (list) => list.map(([slug, t]) => {
    const add = flow.add[t.School] || 0;
    const lost = flow.lost[t.School] || 0;
    return { slug, t, add, lost, net: add - lost };
  }).sort((a, b) => b.net - a.net || b.add - a.add || a.t.School.localeCompare(b.t.School));
  // A team table (In / Out / Net), each row its portal page.
  const TeamTable = ({ rows, here = "", tint = BLUE, maxHeight }) => (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 30px 30px 34px", gap: "6px", padding: "6px 14px", fontSize: "10px", fontWeight: 900, color: "#8a97ab", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid #eef1f5" }}>
        <span>Team</span><span style={{ textAlign: "right" }}>In</span><span style={{ textAlign: "right" }}>Out</span><span style={{ textAlign: "right" }}>Net</span>
      </div>
      <div style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
        {rows.length === 0 && <div style={{ padding: "16px 14px", fontSize: "12px", fontWeight: 700, color: "#8a97ab" }}>No teams.</div>}
        {rows.map((r, i) => (
          <Link key={r.slug} to={`/portal/${r.slug}`} style={{ display: "grid", gridTemplateColumns: "1fr 30px 30px 34px", gap: "6px", alignItems: "center", padding: "7px 14px", textDecoration: "none", background: r.slug === here ? `color-mix(in srgb, ${tint} 9%, #fff)` : "#fff", borderBottom: i < rows.length - 1 ? "1px solid #eef1f5" : "none" }}
            onMouseEnter={(e) => { if (r.slug !== here) e.currentTarget.style.background = "#f7f9fc"; }}
            onMouseLeave={(e) => { if (r.slug !== here) e.currentTarget.style.background = "#fff"; }}>
            <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
              {r.t.Logo1 ? <img src={r.t.Logo1} alt="" loading="lazy" style={{ width: 20, height: 20, objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} /> : <span style={{ width: 20, flexShrink: 0 }} />}
              <span style={{ fontSize: "13px", fontWeight: 800, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.t.School}</span>
            </span>
            <span style={{ textAlign: "right", fontSize: "12px", fontWeight: 900, color: "#2e7d32" }}>{r.add}</span>
            <span style={{ textAlign: "right", fontSize: "12px", fontWeight: 900, color: "#c0392b" }}>{r.lost}</span>
            <span style={{ textAlign: "right", fontSize: "12px", fontWeight: 900, color: r.net > 0 ? "#2e7d32" : r.net < 0 ? "#c0392b" : "#8a97ab" }}>{r.net > 0 ? `+${r.net}` : r.net}</span>
          </Link>
        ))}
      </div>
    </>
  );
  // The board's rail (user, 2026-11-18 — in place of By Position): every
  // FBS team's portal page, a conference at a time.
  const railConfs = FBS_CONFERENCES.filter((c) => Object.values(teams || {}).some((t) => t.Conference === c));
  const railRows = teamRows(Object.entries(teams || {}).filter(([, t]) => !railConf || t.Conference === railConf));
  const SideCard = ({ title: t, to, children }) => (
    <div className="wdb-side" style={{ borderRadius: "14px", overflow: "hidden", background: "#fff" }}>
      <div className="wdb-sidehead" style={{ background: BLUE, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", letterSpacing: "0.14em", textTransform: "uppercase" }}>{t}</div>
        {to && <Link to={to} className="wdb-sidehead-link" style={{ color: "#fff", fontSize: "11px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "underline", textUnderlineOffset: "4px", textDecorationThickness: "2px", textDecorationColor: "rgba(255,255,255,0.55)" }}>All</Link>}
      </div>
      {children}
    </div>
  );
  const Sidebars = !loading && all.length > 0 && (
    <>
      {!isUpdates && (
        <SideCard title="Latest Moves" to="/portal/news/updates">
          {latest.map((m, i) => {
            const st = MOVE_STYLE[m.kind];
            return (
              <Link key={`${m.p.id}-${m.kind}`} to={pageOf(m.p) || `/portal/${portalTeamSlug(m.kind === "entered" ? m.p.from : m.p.to)}`} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 14px", textDecoration: "none", borderBottom: i < latest.length - 1 ? "1px solid #eef1f5" : "none" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#f7f9fc"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}>
                <SchoolMark name={m.kind === "entered" ? m.p.from : m.p.to} size={26} link={false} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fullName(m.p)}</div>
                  <div style={{ fontSize: "11px", fontWeight: 800, color: st.color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.p.Position} · {m.kind === "entered" ? `Entered from ${m.p.from}` : m.kind === "committed" ? `Committed to ${m.p.to}` : `Withdrew, stays at ${m.p.to}`}
                  </div>
                </div>
                <div style={{ flexShrink: 0, fontSize: "11px", fontWeight: 900, color: "#5b6b84" }}>{fmtDate(m.ms)}</div>
              </Link>
            );
          })}
        </SideCard>
      )}
      {teams && Object.keys(teams).length > 0 && (
        <SideCard title="Team Portals">
          <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid #eef1f5" }}>
            <select value={railConf} onChange={(e) => setRailConf(e.target.value)} aria-label="Conference" className="wdb-input"
              style={{ width: "100%", boxSizing: "border-box", border: "2px solid " + GOLD, borderRadius: "8px", padding: "7px 8px", fontWeight: 800, fontSize: "13px", color: BLUE, background: "#fff", fontFamily: "inherit" }}>
              <option value="">All FBS Teams</option>
              {railConfs.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <TeamTable rows={railRows} maxHeight={isMobile ? "360px" : "520px"} />
        </SideCard>
      )}
    </>
  );

  // /portal/news/updates: every move, newest first, under day headers.
  const moveCounts = MOVES.reduce((c, [k]) => ({ ...c, [k]: k ? moves.filter((m) => m.kind === k).length : moves.length }), {});
  const shownMoves = moves.filter((m) => (!move || m.kind === move)
    && (!search.trim() || [fullName(m.p), m.p.from, m.p.to].some((x) => String(x || "").toLowerCase().includes(search.trim().toLowerCase()))));
  const MoveBar = (
    <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", justifyContent: "center", gap: "8px", marginBottom: "12px" }}>
      <div role="tablist" aria-label="Move type" style={{ display: "inline-flex", justifyContent: isMobile ? "space-between" : "flex-start", padding: "3px", borderRadius: "999px", background: "#fff", border: "1px solid #e3e8ef", gap: "2px", maxWidth: "100%", overflowX: "auto" }}>
        {MOVES.map(([k, label]) => {
          const on = move === k;
          return (
            <button key={k || "all"} type="button" role="tab" aria-selected={on} onClick={() => setParam("move", k)} style={{
              padding: isMobile ? "6px 8px" : "7px 16px", borderRadius: "999px", border: "none", cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
              background: on ? BLUE : "transparent", color: on ? "#fff" : BLUE, fontWeight: 900, fontSize: isMobile ? "11px" : "13px",
              textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap",
            }}>
              {isMobile && !k ? "All" : label}{!loading && <span style={{ marginLeft: "6px", opacity: 0.7, fontSize: "11px" }}>{moveCounts[k]}</span>}
            </button>
          );
        })}
      </div>
      {searchBox}
    </div>
  );
  // A moves feed under day headers — the updates page and a team's Activity.
  const renderFeed = (list, { title: tt = `${SEASON} Portal Updates`, emptyText = moves.length === 0 ? `No moves in the ${SEASON} portal yet.` : "No moves match." } = {}) => {
    const groups = [];
    list.forEach((m) => {
      const label = dayLabel(m.ms);
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
      groups[groups.length - 1].items.push(m);
    });
    return (
    <div className="wdb-card" style={{ borderRadius: "14px", overflow: "hidden", background: "#fff" }}>
      <div className="wdb-cardhead" style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>{tt}</div>
        <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" }}>
          {loading ? "" : `${list.length} move${list.length === 1 ? "" : "s"}`}
        </div>
      </div>
      {loading ? <LoadingSpinner label="Loading" size={32} minHeight="240px" /> : list.length === 0 ? (
        typeof emptyText === "string" ? (
          <div style={{ padding: "48px 20px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "14px" }}>
            {emptyText}
          </div>
        ) : emptyText
      ) : groups.map((g) => (
        <div key={g.label}>
          <div style={{ position: "sticky", top: 0, zIndex: 2, padding: "8px 16px", background: "#f7f9fc", borderBottom: "1px solid #e3e8ef", fontSize: "11px", fontWeight: 900, color: "#5b6b84", textTransform: "uppercase", letterSpacing: "0.12em" }}>{g.label}</div>
          {g.items.map((m) => {
            const st = MOVE_STYLE[m.kind];
            const p = m.p;
            // From → To as of this move: an entry hasn't landed anywhere yet;
            // a commitment greys the old school; a withdrawal is the same
            // school both ways, in color.
            const toMark = m.kind === "entered"
              ? <ToCell p={{ ...p, committed: false, withdrawn: false }} size={isMobile ? 30 : 38} />
              : <SchoolMark name={p.to} size={isMobile ? 30 : 38} title={m.kind === "committed" ? `Committed to ${p.to}` : `Withdrew — staying at ${p.to}`} />;
            if (isMobile) {
              return (
                <MobileRow key={`${p.id}-${m.kind}`} p={p} fromMuted={m.kind === "committed"}
                  toNode={m.kind === "entered" ? <ToCell p={{ ...p, committed: false, withdrawn: false }} size={26} /> : <SchoolMark name={p.to} size={26} title={m.kind === "committed" ? `Committed to ${p.to}` : `Withdrew — staying at ${p.to}`} />}
                  extra={<div style={{ marginTop: "4px", fontSize: "12px", fontWeight: 900, color: st.color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.kind === "entered" ? `Entered from ${p.from}` : m.kind === "committed" ? `Committed to ${p.to}` : `Withdrew, stays at ${p.to}`}
                  </div>} />
              );
            }
            return (
              <div key={`${p.id}-${m.kind}`} className="wdb-row" style={{ display: "flex", alignItems: "center", gap: isMobile ? "8px" : "14px", padding: isMobile ? "10px 10px" : "12px 18px", background: "#fff" }}>
                {!isMobile && <span style={{ flexShrink: 0, width: "96px", textAlign: "center", fontSize: isMobile ? "10px" : "11px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: st.color, background: st.bg, borderRadius: "999px", padding: "5px 0" }}>{st.label}</span>}
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: isMobile ? "4px" : "8px" }}>
                  <SchoolMark name={p.from} size={isMobile ? 30 : 38} title={`From ${p.from}`} muted={m.kind === "committed"} />
                  <span aria-hidden="true" style={{ color: "#b8c2d1", fontWeight: 900, fontSize: isMobile ? "12px" : "14px" }}>→</span>
                  {toMark}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                    <NameLink p={p} style={{ color: BLUE, fontWeight: 900, fontSize: isMobile ? "15px" : "20px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }} />
                  </div>
                  <div style={{ marginTop: "2px", fontSize: isMobile ? "11px" : "13px", fontWeight: 700, color: "#5b6b84", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {isMobile && <span style={{ color: st.color, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.04em" }}>{st.label} · </span>}
                    {[p.Position, stateCode(p), !isMobile && (m.kind === "entered" ? `From ${p.from}` : m.kind === "committed" ? `${p.from} → ${p.to}` : `Stays at ${p.to}`)].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {!isMobile && <EligChip p={p} />}
                <TransferStars stars={p.stars} size={isMobile ? "sm" : "md"} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
  };
  const Feed = renderFeed(shownMoves);

  // ── Team pages (/portal/ohio-state) ──
  const T = team?.School || "";
  // Comings (committed here) and goings (entered from here, or left and
  // committed elsewhere). A withdrawal — back home — shows under All only.
  const isIn = (m) => m.kind === "committed" && m.p.to === T;
  const isOut = (m) => (m.kind === "entered" && m.p.from === T) || (m.kind === "committed" && m.p.from === T && m.p.to !== T);
  const teamMoves = !team ? [] : moves.filter((m) => isIn(m) || isOut(m) || (m.kind === "withdrew" && m.p.to === T));
  const dir = ["in", "out"].includes(params.get("dir")) ? params.get("dir") : "";
  const dirMoves = teamMoves.filter((m) => (dir === "in" ? isIn(m) : dir === "out" ? isOut(m) : true));
  const tc1 = team?.Color1 || BLUE;
  const tc2 = team?.Color2 || GOLD;

  const KICKER = { "": "Transfer Portal Tracker", roster: `Projected ${SEASON} Roster`, needs: "Team Needs", targets: "Transfer Portal Targets and Projections" };
  // The team's header: the CFB team page's hero in its colors — its logo and
  // name go to the team page — and its Portal Sim (the sim started as this
  // team; PortalSimButton, the portal's "on the clock").
  const TeamHero = team && heroShell({
    c1: tc1, c2: tc2, mark: team.LogoDark || team.Logo1, watermark: team.WordmarkDark || team.Wordmark || "",
    kicker: `${KICKER[teamTab]}${team.Conference ? ` · ${team.Conference}` : ""}`,
    title: T, sub: team.Mascot || "",
    links: [heroLink("/portal", "← Full portal")],
    to: team.teamSlug ? `/team/${team.teamSlug}` : null, toLabel: `${T} team page`,
    buttons: <PortalSimButton team={teamSlug} school={T} c1={tc1} c2={tc2} isMobile={isMobile} wide={isMobile} />,
  });
  // Before the portal opens (user, 2026-11-18): an empty Movement says when
  // it opens and points to the Portal Sim — a small ad in the school's colors.
  const daysToOpen = Math.max(0, Math.ceil((PORTAL_OPENS - Date.now()) / 86400000));
  const PreOpen = team && (
    <div style={{ padding: isMobile ? "20px 14px 22px" : "34px 32px 36px", textAlign: "center" }}>
      {/* When it opens, with a countdown. */}
      <div style={{ display: "inline-flex", alignItems: "center", gap: isMobile ? "10px" : "16px", padding: isMobile ? "8px 14px" : "10px 20px", borderRadius: "999px", background: "#f2f6fb", border: "1px solid #dfe7f1" }}>
        <span style={{ fontWeight: 900, fontSize: isMobile ? "24px" : "34px", color: BLUE, lineHeight: 1 }}>{daysToOpen}</span>
        <span style={{ textAlign: "left", fontWeight: 900, fontSize: isMobile ? "10px" : "12px", letterSpacing: "0.12em", color: "#5b6b84", textTransform: "uppercase", lineHeight: 1.3 }}>day{daysToOpen === 1 ? "" : "s"} until<br />the portal opens</span>
      </div>
      <div style={{ color: "#33415c", fontWeight: 800, fontSize: isMobile ? "14px" : "18px", lineHeight: 1.5, maxWidth: "640px", margin: isMobile ? "12px auto 0" : "16px auto 0" }}>
        The transfer portal officially opens on <b style={{ color: BLUE }}>January 4, 2027</b>. Check out our portal sim in the meantime.
      </div>
      {/* The Portal Sim, in the school's colors. */}
      <Link to={`/portalsim/${teamSlug}`} className="tp-sim-ad" style={{
        position: "relative", overflow: "hidden", display: "flex", alignItems: "center", gap: isMobile ? "14px" : "28px",
        margin: isMobile ? "16px 0 0" : "26px 0 0", padding: isMobile ? "14px" : "28px 32px",
        borderRadius: "16px", textDecoration: "none", textAlign: "left", color: "#fff", border: `2px solid ${tc2}`, boxShadow: "0 10px 28px rgba(0,0,0,0.2)",
        background: `linear-gradient(115deg, ${tc1} 0%, ${tc1} 55%, color-mix(in srgb, ${tc2} 55%, ${tc1}) 100%)`,
      }}>
        <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(rgba(0,0,0,0.12), rgba(0,0,0,0.38))", pointerEvents: "none" }} />
        <img src="/logos/transfer-portal-white.svg" alt="" aria-hidden="true" style={{ position: "absolute", right: isMobile ? -30 : -10, top: "50%", transform: "translateY(-50%) rotate(-8deg)", height: isMobile ? 130 : 240, opacity: 0.09, pointerEvents: "none" }} />
        {(team.LogoDark || team.Logo1) && <img src={team.LogoDark || team.Logo1} alt="" style={{ position: "relative", width: isMobile ? 52 : 120, height: isMobile ? 52 : 120, objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.4))" }} />}
        <span style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(0,0,0,0.35)", borderRadius: "6px", padding: isMobile ? "2px 8px" : "4px 10px", fontWeight: 900, fontSize: isMobile ? "10px" : "11px", letterSpacing: "0.14em", whiteSpace: "nowrap" }}>
            <img src="/logos/transfer-portal-white.svg" alt="" aria-hidden="true" style={{ width: isMobile ? 12 : 14, height: isMobile ? 12 : 14 }} />{isMobile ? "PORTAL SIM" : "TRANSFER PORTAL SIM"}
          </span>
          <span style={{ display: "block", fontWeight: 900, fontSize: isMobile ? "16px" : "30px", lineHeight: 1.08, marginTop: isMobile ? "5px" : "8px", textTransform: "uppercase", textShadow: "0 2px 10px rgba(0,0,0,0.3)" }}>Run {T} through the portal</span>
          {!isMobile && (
            <>
              <span style={{ display: "block", fontSize: "14px", fontWeight: 700, opacity: 0.92, marginTop: "6px", maxWidth: "560px" }}>Keep your stars from the NFL, make NIL offers, beat every FBS school to your targets and get a grade for your portal class.</span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "12px" }}>
                {["NFL decisions", "Retention", "NIL offers", "Coaching staff", "Class grade"].map((x) => (
                  <span key={x} style={{ fontSize: "11px", fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", padding: "4px 10px", borderRadius: "999px", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.25)" }}>{x}</span>
                ))}
              </span>
            </>
          )}
        </span>
        <span style={{ position: "relative", flexShrink: 0, background: "#fff", color: inkOn(tc1) === "#fff" ? tc1 : "#111", borderRadius: "999px", padding: isMobile ? "8px 12px" : "14px 26px", fontWeight: 900, fontSize: isMobile ? "12px" : "15px", letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap", boxShadow: "0 6px 16px rgba(0,0,0,0.25)" }}>{isMobile ? "Play →" : "Play the Sim →"}</span>
      </Link>
    </div>
  );
  const teamCounts = { "": teamMoves.length };
  const TeamTabs = team && (
    <div style={{ display: "flex", gap: isMobile ? "5px" : "8px", justifyContent: isMobile ? "flex-start" : "center", overflowX: isMobile ? "auto" : "visible", marginBottom: "12px", paddingBottom: isMobile ? "2px" : 0 }}>
      {TEAM_TABS.map(([k, label]) => {
        const on = teamTab === k;
        return (
          <Link key={k || "movement"} to={`/portal/${teamSlug}${k ? `/${k}` : ""}`} aria-current={on ? "page" : undefined} style={{
            flexShrink: 0, display: "inline-flex", alignItems: "center", gap: "6px", padding: isMobile ? "7px 12px" : "8px 20px", borderRadius: "10px", textDecoration: "none",
            border: `2px solid ${tc1}`, background: on ? tc1 : "#fff", color: on ? "#fff" : tc1,
            fontWeight: 900, fontSize: isMobile ? "12px" : "14px", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap",
          }}>
            {label}{!loading && teamCounts[k] != null && <span style={{ fontSize: "11px", opacity: 0.75 }}>{teamCounts[k]}</span>}
          </Link>
        );
      })}
    </div>
  );
  const teamEmpty = (text) => <div style={{ padding: "44px 20px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "14px", background: "#fff" }}>{text}</div>;
  const teamCard = (title, right, children, { head = tc1 } = {}) => (
    <div className="wdb-card" style={{ borderRadius: "14px", overflow: "hidden", background: "#fff", marginBottom: "14px" }}>
      <div className="wdb-cardhead" style={{ background: head, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <h2 style={{ margin: 0, color: "#fff", fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>{title}</h2>
        {right != null && <div style={{ color: "rgba(255,255,255,0.8)", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" }}>{right}</div>}
      </div>
      {children}
    </div>
  );
  const notBuilt = teamEmpty(`${T}'s projections haven't been built yet.`);

  // ── Movement: the team's moves, All / Coming In / Going Out ──
  const DirBar = team && (
    <div role="tablist" aria-label="Direction" style={{ display: "flex", justifyContent: "center", marginBottom: "12px" }}>
      <div style={{ display: "inline-flex", padding: "3px", borderRadius: "999px", background: "#fff", border: "1px solid #e3e8ef", gap: "2px" }}>
        {[["", "All", teamMoves.length], ["in", "Coming In", teamMoves.filter(isIn).length], ["out", "Going Out", teamMoves.filter(isOut).length]].map(([k, label, n]) => {
          const on = dir === k;
          return (
            <button key={k || "all"} type="button" role="tab" aria-selected={on} onClick={() => setParam("dir", k)} style={{
              padding: isMobile ? "6px 12px" : "7px 18px", borderRadius: "999px", border: "none", cursor: "pointer", fontFamily: "inherit",
              background: on ? tc1 : "transparent", color: on ? "#fff" : tc1, fontWeight: 900, fontSize: isMobile ? "12px" : "13px",
              textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap",
            }}>{label}{!loading && <span style={{ marginLeft: "6px", opacity: 0.7, fontSize: "11px" }}>{n}</span>}</button>
          );
        })}
      </div>
    </div>
  );

  // ── Roster: the projected 2027 roster, position by position ──
  // The built roster, with the admin's manual moves laid over it live (they
  // reach the sim itself at the next rebuild).
  const manualByPid = new Map(manualEff.filter((m) => m.pid).map((m) => [String(m.pid), m]));
  const manualRow = (m, f, o) => ({ id: m.pid || `man:${m.key}`, n: m.n, pos: m.pos, sub: m.sub || "", s: m.s, e: m.e ?? null, role: "", ht: m.ht, wt: m.wt, st: m.state || "", slug: m.slug || "", f, ...(o ? { o } : {}) });
  const builtRows = (teamPage?.roster || [])
    .filter((r) => { const m = manualByPid.get(String(r.id)); return !(r.f === "a" && m && !(m.st === "c" && m.to === T)); })
    .map((r) => {
      const m = manualByPid.get(String(r.id));
      if (!m || r.f === "a") return r;
      if (m.st === "u") return { ...r, f: "p" };
      if (m.st === "c" && m.to !== m.from) return { ...r, f: "t", o: m.to };
      return { ...r, f: r.e === 0 ? "x" : "r" }; // withdrew: back on the roster
    });
  const manualAdds = !team ? [] : manualEff.flatMap((m) => {
    if (m.st === "c" && m.to === T && m.from !== T && !builtRows.some((r) => String(r.id) === String(m.pid) && r.f === "a")) return [manualRow(m, "a", m.from)];
    // Hand-entered (no pool id): his old team's departure.
    if (!m.pid && m.from === T && m.st !== "w") return [manualRow(m, m.st === "c" ? "t" : "p", m.st === "c" ? m.to : "")];
    return [];
  });
  const rosterRows = [...builtRows, ...manualAdds].map((r) => ({ ...r, s: starsWithLocks(locks, { id: r.id, stars: r.s }) }));
  const staying = rosterRows.filter((r) => r.f === "r" || r.f === "a");
  const departing = rosterRows.filter((r) => !(r.f === "r" || r.f === "a"));
  const signees = teamPage?.signees || [];
  const ROLE_ORDER = { starter: 0, rotation: 1, reserve: 2, none: 3 };
  const byDepth = (a, b) => (b.s || 0) - (a.s || 0) || (ROLE_ORDER[a.role] ?? 4) - (ROLE_ORDER[b.role] ?? 4) || (a.e ?? 9) - (b.e ?? 9) || String(a.n).localeCompare(String(b.n));
  const nameParts = (n) => { const sp = String(n || "").split(" "); return [sp[0] || "", sp.slice(1).join(" ") || ""]; };
  // One chip — the NFL team page's depth chip, with his headshot where the
  // jersey number goes. Transfer stars only for players who came through
  // the portal (user, 2026-11-17: stars show only for portal players — they
  // still order the roster). A render function, not an inner component, so
  // the headshots aren't remounted on every render.
  // noYears: a position view — the class headers already say it.
  const rosterChip = (r, kind, { noYears = false } = {}) => {
    const [first, last] = nameParts(r.n);
    const gone = kind === "gone";
    const hs = kind === "hs";
    const portal = gone && r.f === "p";
    const viaPortal = !hs && ["p", "t", "a"].includes(r.f);
    // (Out of eligibility: no "0 YRS" — the section says it.)
    const tags = [r.pos && (r.sub || r.pos), noYears ? "" : hs ? `'${String(SEASON).slice(2)} HS` : r.e != null && r.f !== "x" ? `${r.e} ${r.e === 1 ? "YR" : "YRS"}` : ""].filter(Boolean);
    const other = r.o;
    const asPlayer = () => {
      const [fn, ...ln] = String(r.n || "").split(" ");
      return {
        First: fn, Last: ln.join(" "), Position: r.pos, SubPosition: r.sub, poolId: hs ? null : r.id || null, stars: hs ? null : r.s, elig: hs ? null : r.e, HeightInches: r.ht, Weight: r.wt, State: r.st, Slug: r.slug,
        from: r.f === "a" ? other : hs ? "" : T, to: r.f === "a" || hs ? T : r.f === "t" ? other : "", status: r.f === "p" ? "uncommitted" : r.f === "a" || r.f === "t" ? "committed" : "",
      };
    };
    const title = hs
      ? [r.hs, r.st, r.rr ? `No. ${r.rr} nationally` : ""].filter(Boolean).join(" · ")
      : r.f === "a" ? `Transfer from ${other}` : r.f === "t" ? `Transferred to ${other}` : r.f === "p" ? "In the transfer portal — uncommitted" : undefined;
    return (
      <div key={`${hs ? "hs" : kind || "r"}-${r.id}`} role="button" tabIndex={0} title={title} onClick={() => openCard(asPlayer(), { ...r, hsRow: hs })}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCard(asPlayer(), { ...r, hsRow: hs }); } }} style={{
        containerType: "inline-size", cursor: "pointer", textAlign: "left", fontFamily: "inherit", color: "inherit", display: "flex", alignItems: "center", gap: isMobile ? 8 : 10, minWidth: 0,
        padding: isMobile ? "8px" : "9px 10px", borderRadius: 12, background: gone && !portal ? "#f6f7f9" : "#fff",
        boxShadow: portal ? "0 0 0 1.5px #f3d39b" : "0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2",
      }}>
        <RosterFace id={hs ? "" : r.id} name={r.n} size={isMobile ? 38 : 44} color={tc1} logo={team?.Logo1 || ""} muted={gone && !portal} dashed={portal} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: isMobile ? 9 : 10, fontWeight: 700, color: "#6b7685", textTransform: "uppercase", letterSpacing: "0.05em", lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{first}</div>
          <div style={{ fontSize: isMobile ? 13 : 15, fontWeight: 900, color: gone && !portal ? "#6b7685" : INK, textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{last}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, minWidth: 0 }}>
            {tags.map((x, i) => (
              <span key={x} style={{ flexShrink: 0, fontSize: 9, fontWeight: 900, letterSpacing: "0.05em", borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap", ...(i === 0 ? { color: "#fff", background: gone && !portal ? "#aab3bf" : tc1 } : { color: "#5b6b84", background: "#eef1f5" }) }}>{x}</span>
            ))}
            {r.f === "a" && <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 900, letterSpacing: "0.05em", borderRadius: 4, padding: "1px 5px", color: "#2e7d32", background: "#e8f5e9" }}>NEW</span>}
          </div>
        </div>
        {/* Stars only where they fit (the card always has them). */}
        {viaPortal && r.s ? <span className="tp-chip-stars" style={{ flexShrink: 0, display: "flex" }}><TransferStars stars={r.s} size="sm" /></span> : null}
        {/* Where he came from / went: the other school's logo. */}
        {(r.f === "a" || r.f === "t") && other && (
          <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 3 }}>
            {r.f === "t" && <span aria-hidden="true" style={{ color: "#b8c2d1", fontWeight: 900, fontSize: 11 }}>→</span>}
            <SchoolMark name={other} size={isMobile ? 22 : 26} link={false} />
          </span>
        )}
        {portal && <ToCell p={{ committed: false, withdrawn: false }} size={isMobile ? 22 : 26} />}
        {/* Off to the NFL / out of eligibility (light chip: the black cap). */}
        {gone && (r.f === "n" || r.f === "x") && <DepartureIcon kind={r.f === "n" ? "nfl" : "grad"} size={isMobile ? 22 : 26} />}
      </div>
    );
  };
  const chipGrid = (children) => (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(210px, 1fr))", gap: isMobile ? 8 : 10 }}>{children}</div>
  );
  const groupTitle = (label, n, color = tc1) => (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "16px 0 8px" }}>
      <h3 style={{ margin: 0, fontSize: isMobile ? "13px" : "15px", fontWeight: 900, color, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</h3>
      <span style={{ flex: 1, height: 2, background: `color-mix(in srgb, ${color} 25%, #fff)` }} />
      <span style={{ fontSize: "12px", fontWeight: 900, color: "#5b6b84" }}>{n}</span>
    </div>
  );
  const knownPos = new Set(ROSTER_GROUPS.map(([k]) => k));
  const groups = [...ROSTER_GROUPS, ["", "Other"]].map(([pos, label]) => {
    const inPos = (r) => (pos ? r.pos === pos : !knownPos.has(r.pos));
    return { pos, label, players: staying.filter(inPos).sort(byDepth), hs: signees.filter(inPos) };
  }).filter((g) => g.players.length || g.hs.length);
  const added = staying.filter((r) => r.f === "a").length;
  // Position tabs (user, 2026-11-17): All, then one per position the roster
  // has — ?pos=qb. A position shows its returning players, transfers,
  // signees and its own departures.
  const departingAt = (pos) => departing.filter((r) => r.pos === pos).length;
  // (A position everyone left still gets a tab — its departures.)
  const posTabs = ROSTER_GROUPS.map(([pos]) => groups.find((g) => g.pos === pos) || { pos, players: [], hs: [] })
    .filter((g) => g.players.length || g.hs.length || departingAt(g.pos));
  const rosterPos = posTabs.some((g) => g.pos.toLowerCase() === String(params.get("pos") || "").toLowerCase()) ? String(params.get("pos")).toUpperCase() : "";
  const shownGroups = rosterPos ? groups.filter((g) => g.pos === rosterPos) : groups;
  const shownDeparting = rosterPos ? departing.filter((r) => r.pos === rosterPos) : departing;
  const PosTabs = (
    <div style={{ display: "flex", flexWrap: isMobile ? "nowrap" : "wrap", overflowX: isMobile ? "auto" : "visible", gap: isMobile ? "5px" : "6px", justifyContent: isMobile ? "flex-start" : "center", margin: "0 0 12px", paddingBottom: isMobile ? "2px" : 0 }}>
      {[["", "All", staying.length + signees.length], ...posTabs.map((g) => [g.pos, g.pos, g.players.length + g.hs.length])].map(([k, label, n]) => {
        const on = rosterPos === k;
        return (
          <button key={k || "all"} type="button" aria-pressed={on} onClick={() => setParam("pos", k.toLowerCase())} style={{
            flexShrink: 0, display: "inline-flex", alignItems: "center", gap: "6px", padding: isMobile ? "6px 10px" : "6px 13px", borderRadius: "10px", cursor: "pointer", fontFamily: "inherit",
            border: `2px solid ${tc1}`, background: on ? tc1 : "#fff", color: on ? "#fff" : tc1, fontWeight: 900, fontSize: isMobile ? "12px" : "13px", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap",
          }}>{label}<span style={{ fontSize: "11px", opacity: 0.75 }}>{n}</span></button>
        );
      })}
    </div>
  );
  // Who's leaving, by kind — only the kinds that have someone.
  const departureGroups = DEPARTURES.map(([f, label, hint]) => {
    const list = shownDeparting.filter((r) => r.f === f).sort(byDepth);
    if (!list.length) return null;
    return (
      <div key={f}>
        {groupTitle(label, list.length, f === "p" ? "#c77700" : "#5b6b84")}
        <div style={{ margin: "-4px 0 8px", fontSize: "11px", fontWeight: 700, color: "#8a97ab" }}>{hint}</div>
        {chipGrid(list.map((r) => rosterChip(r, "gone")))}
      </div>
    );
  });
  const RosterView = team && (teamPage === undefined ? <LoadingSpinner label="Loading roster" size={32} minHeight="240px" /> : !teamPage ? notBuilt : (
    <>
      {teamCard(`${T} Projected ${SEASON} Roster`, `${staying.length + signees.length} players`, (
        <div style={{ padding: isMobile ? "10px 12px" : "12px 18px", display: "flex", flexWrap: "wrap", gap: isMobile ? "6px 14px" : "8px 22px", fontSize: isMobile ? "12px" : "13px", fontWeight: 800, color: "#5b6b84" }}>
          <span><b style={{ color: INK }}>{staying.length - added}</b> returning</span>
          <span><b style={{ color: "#2e7d32" }}>{added}</b> portal additions</span>
          <span><b style={{ color: tc1 }}>{signees.length}</b> {SEASON} signees</span>
          <span><b style={{ color: "#c0392b" }}>{departing.length}</b> departures</span>
          <span style={{ flexBasis: "100%", fontSize: "11px", fontWeight: 700, color: "#8a97ab" }}>
            Ordered by our transfer grades; stars show for players who came through the portal. Eligibility counts the {SEASON} season. Tap a player for his career path.
          </span>
        </div>
      ))}
      {PosTabs}
      {rosterPos ? (() => {
        // A position (user, 2026-11-17): returning players and transfers by
        // seasons left — 1, then 2, 3… (stars still order each group, never
        // shown off the portal); its signees in their own section; then
        // who's leaving — only the kinds that have someone (user,
        // 2026-11-17), "No departures." when nobody is.
        const g = shownGroups[0] || { players: [], hs: [] };
        // Class by seasons left in the coming season (user, 2026-11-17):
        // 1 Super Senior, 2 Senior, 3 Junior, 4 Sophomore; the incoming
        // class is the Freshman section below.
        const CLASS = { 1: "Super Senior", 2: "Senior", 3: "Junior", 4: "Sophomore" };
        const classLabel = (y) => (y === 99 ? "Eligibility Unknown" : `${CLASS[y] || "Freshman"} (${y} ${y === 1 ? "Year" : "Years"} Remaining)`);
        const years = [...new Set(g.players.map((r) => r.e ?? 99))].sort((a, b) => a - b);
        const none = (text) => <div style={{ padding: "10px 14px", borderRadius: 12, background: "#fff", boxShadow: "0 0 0 1px #e6ebf2", fontSize: "13px", fontWeight: 800, color: "#8a97ab" }}>{text}</div>;
        // ATH is a recruiting label (user, 2026-11-18): just the commits —
        // no "No returning players.", and departures only if there are any.
        const ath = rosterPos === "ATH";
        return (
          <>
            {g.players.length === 0 && !ath && <>{groupTitle(POSITION_PLURAL[rosterPos] || rosterPos, 0)}{none("No returning players.")}</>}
            {years.map((y) => {
              const list = g.players.filter((r) => (r.e ?? 99) === y).sort(byDepth);
              return (
                <div key={y}>
                  {groupTitle(classLabel(y), list.length)}
                  {chipGrid(list.map((r) => rosterChip(r, undefined, { noYears: true })))}
                </div>
              );
            })}
            <div style={{ marginTop: ath && !g.players.length ? 0 : "22px" }}>
              {groupTitle(ath ? `${SEASON} Commits` : `Freshman (${SEASON} Commits)`, g.hs.length)}
              {g.hs.length ? chipGrid(g.hs.map((r) => rosterChip(r, "hs", { noYears: true }))) : none(`No ${SEASON} commits at ${rosterPos}.`)}
            </div>
            {!(ath && !shownDeparting.length) && <div id="departures" style={{ marginTop: "28px" }}>
              {teamCard(`${rosterPos} Departures`, `${shownDeparting.length} player${shownDeparting.length === 1 ? "" : "s"}`, null, { head: "#5b6b84" })}
              {shownDeparting.length ? departureGroups : none("No departures.")}
            </div>}
          </>
        );
      })() : (
        <>
          {shownGroups.map((g) => (
            <div key={g.pos || "other"}>
              {groupTitle(g.label, g.players.length + g.hs.length)}
              {chipGrid([...g.players.map((r) => rosterChip(r)), ...g.hs.map((r) => rosterChip(r, "hs"))])}
            </div>
          ))}
          <div id="departures" style={{ marginTop: "28px" }}>
            {teamCard("Departures", `${shownDeparting.length} player${shownDeparting.length === 1 ? "" : "s"}`, null, { head: "#5b6b84" })}
            {shownDeparting.length ? departureGroups : <div style={{ padding: "10px 14px", borderRadius: 12, background: "#fff", boxShadow: "0 0 0 1px #e6ebf2", fontSize: "13px", fontWeight: 800, color: "#8a97ab" }}>No departures.</div>}
          </div>
        </>
      )}
    </>
  ));

  // ── Targets: the sim's needs, the admin's picks, the sim's suggestions ──
  // Need levels (user, 2026-11-18 — the sim's: engine needsOf, averaged
  // over the build's runs): Needs Upgrade (red), Needs Talent (orange),
  // Needs Depth (yellow), Set (green).
  const needLevel = (v) => (v >= 2.5 ? ["Needs Upgrade", "#c0392b"] : v >= 1.5 ? ["Needs Talent", "#e67e22"] : v >= 0.5 ? ["Needs Depth", "#d4a017"] : ["Set", "#2e7d32"]);
  const needs = Object.entries(teamPage?.needs || {}).sort((a, b) => b[1] - a[1]);
  const wantsAt = (pos) => (teamPage?.wants || []).filter((w) => w.pos === pos);
  const NeedsCard = teamCard(`${T} Team Needs`, "Portal Sim projection", (
    <div style={{ padding: isMobile ? "8px 12px 12px" : "10px 18px 14px" }}>
      <div style={{ fontSize: "12px", fontWeight: 700, color: "#5b6b84", marginBottom: "8px", lineHeight: 1.5 }}>
        What the We-Draft.com Portal Sim expects {T} to need once players leave for the NFL Draft and the portal: starting spots to fill, starters to upgrade, and depth it&apos;s short on.
      </div>
      {needs.map(([pos, v]) => {
        const [label, color] = needLevel(v);
        const ws = wantsAt(pos);
        return (
          <div key={pos} style={{ display: "grid", gridTemplateColumns: isMobile ? "44px 1fr 70px" : "52px 1fr 86px minmax(0, 1.2fr)", alignItems: "center", gap: isMobile ? "8px" : "12px", padding: "6px 0", borderTop: "1px solid #f0f2f6" }}>
            <span style={{ fontSize: "13px", fontWeight: 900, color: tc1 }}>{pos}</span>
            <span style={{ height: "9px", borderRadius: "5px", background: "#eef1f5", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${Math.min(100, (v / 3) * 100)}%`, background: color, borderRadius: "5px" }} />
            </span>
            <span style={{ fontSize: "11px", fontWeight: 900, color, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
            {!isMobile && (
              <span style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {ws.map((w) => <span key={`${w.sub}${w.kind}`} style={{ fontSize: "11px", fontWeight: 900, color: tc1, background: `color-mix(in srgb, ${tc1} 9%, #fff)`, borderRadius: "999px", padding: "2px 8px", whiteSpace: "nowrap" }}>{WANT_LABEL[w.kind]}{w.sub ? ` · ${w.sub}` : ""}</span>)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  ));
  // A target row. t: { id, n, pos, sub, from, s, e, ht, wt, st, slug }.
  const chipStyle = (color, bg) => ({ fontSize: "11px", fontWeight: 900, color, background: bg, borderRadius: "999px", padding: "2px 8px", whiteSpace: "nowrap" });
  const TargetRow = ({ t, rank, chips }) => {
    const [first, ...rest] = String(t.n || "").split(" ");
    // Stars only for a player actually in the portal (the sim's targets are
    // mostly players still on rosters — ordered by stars, never shown).
    const p = { id: t.id, poolId: t.id, First: first, Last: rest.join(" "), Slug: t.slug, Position: t.pos, SubPosition: t.sub, from: t.from, elig: t.e ?? null, HeightInches: t.ht, Weight: t.wt, State: t.st, stars: t.s, status: t.live ? "uncommitted" : "", hideStars: !t.live };
    const chipNodes = <div style={{ marginTop: "5px", display: "flex", flexWrap: "wrap", gap: "4px" }}>{chips.map(([text, color, bg]) => <span key={text} style={chipStyle(color, bg)}>{text}</span>)}</div>;
    if (isMobile) {
      return <MobileRow p={p} toNode={<SchoolMark name={T} size={26} link={false} />} left={<span style={{ width: 18, flexShrink: 0, textAlign: "right", fontSize: "13px", fontWeight: 900, color: rank <= 3 ? GOLD : "#8a97ab" }}>{rank}</span>} extra={chipNodes} />;
    }
    return (
      <div className="wdb-row" style={{ display: "flex", alignItems: "center", gap: "14px", padding: "11px 18px", background: "#fff" }}>
        <div style={{ width: 28, flexShrink: 0, textAlign: "right", fontSize: "15px", fontWeight: 900, color: rank <= 3 ? GOLD : "#8a97ab", fontVariantNumeric: "tabular-nums" }}>{rank}</div>
        <div style={{ width: 52, flexShrink: 0, display: "flex", justifyContent: "center" }}>{p.hideStars ? null : <TransferStars stars={t.s} />}</div>
        <EligChip p={p} />
        <span style={{ flexShrink: 0, width: 52, textAlign: "center", fontSize: "14px", fontWeight: 900, color: BLUE, background: "#eaf1ff", padding: "5px 0", borderRadius: "6px" }}>{t.sub || t.pos || "—"}</span>
        <SchoolMark name={t.from} size={LOGO_COL_W} title={`From ${t.from}`} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <NameLink p={p} hover style={{ color: BLUE, fontWeight: 900, fontSize: "20px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, display: "block" }} />
          {chipNodes}
        </div>
        <div style={{ flexShrink: 0, textAlign: "right", fontSize: "13px", fontWeight: 800, color: "#5b6b84", lineHeight: 1.4 }}>
          {[t.ht ? formatHeight(t.ht) : "", t.wt ? `${t.wt} lbs` : ""].filter(Boolean).join(" · ")}
          {t.st && <div style={{ fontSize: "12px", fontWeight: 900 }}>{t.st}</div>}
        </div>
      </div>
    );
  };
  // Recommended Targets (user, 2026-11-17): the admin's picks, plus the
  // sim's picks once they're actually IN the portal — We-Draft.com doesn't
  // project who will enter (the full sim list is admin only). One list:
  // stars, then the admin's order, then last name (sortRecommendations).
  const inPortalNow = new Set(all.filter((x) => x.status === "uncommitted" && x.poolId).map((x) => String(x.poolId)));
  const adminRecs = (team && recs ? teamRecommendations(recs, teamSlug, locks) : []).map((t) => ({ ...t, live: inPortalNow.has(String(t.id)) ? 1 : 0 }));
  const recIds = new Set(adminRecs.map((r) => String(r.id)));
  // In-portal sim picks (the build's, plus manual entries made since).
  const simLive = (teamPage?.targets || [])
    .filter((t) => !recIds.has(String(t.id)) && !["c", "w"].includes(manualByPid.get(String(t.id))?.st) && (t.live || inPortalNow.has(String(t.id))))
    .map((t) => ({ ...t, rank: 0, live: 1, s: starsWithLocks(locks, { id: t.id, stars: t.s }) }));
  const recList = sortRecommendations([...adminRecs, ...simLive]);
  const FIT = { starter: "Would start", rotation: "Rotation", depth: "Depth" };
  const recChips = (t) => [
    [t.kind ? `${t.sub || t.pos} · ${WANT_LABEL[t.kind] || "Need"}` : t.sub || t.pos, tc1, `color-mix(in srgb, ${tc1} 9%, #fff)`],
    ...(FIT[t.fit] ? [[FIT[t.fit], BLUE, "#eaf1ff"]] : []),
    ...(!t.kind && t.from ? [[`From ${t.from}`, "#5b6b84", "#eef1f5"]] : []),
    ...(t.live ? [["In the Portal", "#2e7d32", "#e8f5e9"]] : []),
  ];
  const TargetsView = team && (teamPage === undefined ? <LoadingSpinner label="Loading" size={32} minHeight="240px" /> : !teamPage ? notBuilt : (
    <>
      {teamCard(`${T} Recommended Targets`, `${recList.length} player${recList.length === 1 ? "" : "s"}`, (
        recList.length === 0
          ? teamEmpty(isAdmin ? "No recommendations yet. Add them in Admin → Players → Transfer Portal → Targets; the sim's picks join as they enter the portal." : `No recommended targets for ${T} yet.`)
          : <div>{recList.map((t, i) => <TargetRow key={t.id} t={t} rank={i + 1} chips={recChips(t)} />)}</div>
      ))}
    </>
  ));

  const NeedsView = team && (teamPage === undefined ? <LoadingSpinner label="Loading" size={32} minHeight="240px" /> : !teamPage ? notBuilt : NeedsCard);

  const TeamBody = team && (
    teamTab === "roster" ? RosterView
      : teamTab === "needs" ? NeedsView
      : teamTab === "targets" ? TargetsView
        : <>{DirBar}{renderFeed(dirMoves, { title: `${T} Portal Movement`, emptyText: !dir && Date.now() < PORTAL_OPENS ? PreOpen : dir === "in" ? `No commitments to ${T} yet.` : dir === "out" ? `No ${T} players in the ${SEASON} portal yet.` : `No ${T} portal moves yet.` })}</>
  );
  // Right rail on a team page: its conference, each school's net.
  const confRows = team ? teamRows(Object.entries(teams || {}).filter(([, t]) => t.Conference === team.Conference)) : [];
  const ConfCard = team && (
    <div className="wdb-side" style={{ borderRadius: "14px", overflow: "hidden", background: "#fff" }}>
      <div className="wdb-sidehead" style={{ background: BLUE, padding: "12px 16px" }}>
        <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", letterSpacing: "0.14em", textTransform: "uppercase" }}>{team.Conference} Portal</div>
      </div>
      <TeamTable rows={confRows} here={teamSlug} tint={tc1} />
    </div>
  );

  const Main = isTeam ? (
    <div style={{ fontFamily: "'Arial Black', Arial, sans-serif" }}>
      {!team ? <LoadingSpinner label="Loading" size={40} minHeight="300px" /> : (
        <>
          {TeamHero}
          <PortalWindowBar isMobile={isMobile} />
          {TeamTabs}
          {TeamBody}
        </>
      )}
    </div>
  ) : (
    <div style={{ fontFamily: "'Arial Black', Arial, sans-serif" }}>
      {Hero}
      <PortalWindowBar isMobile={isMobile} />
      {isUpdates ? <>{MoveBar}{Feed}</> : <>{Filters}{ViewBar}{statsView ? StatsTable : List}</>}
    </div>
  );

  // ── The quick player card ──
  const CardModal = card && (() => {
    const r = cardRow || {};
    const hsRow = r.hsRow;
    const next = card.status === "committed" && card.to && card.to !== card.from ? card.to : "";
    const page = pageOf({ Slug: card.slug || r.slug });
    const lines = String(r.sl || "").split(" · ").filter(Boolean);
    const gone = card.fate === "n" ? "nfl" : card.fate === "x" ? "grad" : null;
    const shot = wdShot || (card.poolId && espnShot ? espnHeadshot(card.poolId) : "");
    // In the portal (any portal move): his stars. Otherwise none.
    const inPortal = ["uncommitted", "committed", "withdrawn"].includes(card.status) || ["p", "t", "a"].includes(card.fate);
    // Header in a school's colors, like the Portal Sim's card (user,
    // 2026-11-17): his new school once he's committed, else his own.
    const brandOf = (name) => (name ? teams?.[portalTeamSlug(name)] || schools[name] || null : null);
    const homeName = next || card.from || card.to || "";
    const tb = brandOf(homeName);
    const h1 = tb?.Color1 || BLUE;
    const h2 = tb?.Color2 || GOLD;
    const headBg = `linear-gradient(115deg, ${h1} 0%, ${h1} 50%, color-mix(in srgb, ${h2} 70%, ${h1}) 100%)`;
    const markOf = (b) => b?.LogoDark || b?.Logo1 || "";
    const homeMark = markOf(tb);
    // A logo on the team-color fill (its abbreviation when there's none).
    const HeadLogo = ({ name, size, muted = false }) => {
      const src = markOf(brandOf(name));
      return (
        <span title={name} style={{ width: size, height: size, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", filter: muted ? "grayscale(1)" : "none", opacity: muted ? 0.65 : 1 }}>
          {src ? <img src={src} alt={name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <span style={{ fontSize: 11, fontWeight: 900 }}>{String(name || "").slice(0, 3).toUpperCase()}</span>}
        </span>
      );
    };
    const status = card.status === "uncommitted" ? ["In the Portal", GOLD] : next ? [`Committed to ${next}`, "#7ee2a8"]
      : card.status === "withdrawn" ? ["Withdrew", "#fff"] : gone === "nfl" ? ["Declared for the NFL Draft", GOLD] : gone === "grad" ? ["Out of eligibility", GOLD] : ["", "#fff"];
    const moving = card.status === "uncommitted" || !!next || !!gone;
    // His position (user, 2026-11-18 — restyled): a solid white tag in the
    // school's color, leading the stars / status line.
    const posTag = card.pos ? (
      <span style={{
        flexShrink: 0, display: "inline-flex", alignItems: "center", height: 20, padding: "0 8px", borderRadius: 5, background: "#fff",
        color: inkOn(h1) === "#fff" ? h1 : INK, fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", lineHeight: 1, boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
      }}>{card.pos}</span>
    ) : null;
    const statusRows = gone === "nfl" ? [{ key: "nfl", name: `${SEASON} NFL Draft`, brand: { Logo1: NFL_ICON }, span: "Declared", accolades: [] }]
      : gone === "grad" ? [{ key: "grad", name: "Out of Eligibility", brand: { Logo1: GRAD_ICON.light }, span: `Final season ${SEASON - 1}`, accolades: [] }] : [];
    const rows = [...statusRows, ...career.rows];
    const box = (label, value) => (
      <div style={{ flex: 1, minWidth: 0, background: "#f7f9fc", border: "1px solid #eef1f5", borderRadius: "10px", padding: "8px 6px", textAlign: "center" }}>
        <div style={{ fontSize: "17px", fontWeight: 900, color: INK, lineHeight: 1.1 }}>{value || "—"}</div>
        <div style={{ marginTop: "3px", fontSize: "9px", fontWeight: 900, color: "#8a97ab", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      </div>
    );
    const head = (t) => <div style={{ margin: "16px 0 10px", fontSize: "12px", fontWeight: 900, color: h1, textTransform: "uppercase", letterSpacing: "0.08em" }}>{t}</div>;
    return (
      <div role="dialog" aria-modal="true" aria-label={`${card.n} — player card`} onClick={() => setCard(null)} style={{
        position: "fixed", inset: 0, zIndex: 2000, background: "rgba(15,27,45,0.55)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", padding: isMobile ? 0 : "20px",
      }}>
        <div onClick={(e) => e.stopPropagation()} style={{
          width: isMobile ? "100%" : "500px", maxHeight: isMobile ? "88vh" : "88vh", overflowY: "auto", background: "#fff",
          borderRadius: isMobile ? "16px 16px 0 0" : "16px", boxShadow: "0 20px 50px rgba(0,0,0,0.3)", fontFamily: "'Arial Black', Arial, sans-serif",
        }}>
          {/* Header (the Portal Sim card's): his name on top, old school →
              where he's headed, stars / position / status; headshot on the
              right over his school's faded logo — no headshot, the logo
              itself in full color. */}
          <div style={{ position: "relative", overflow: "hidden", background: headBg, color: "#fff", borderBottom: `4px solid ${h2}` }}>
            <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 85% 120%, rgba(0,0,0,0.05), rgba(0,0,0,0.5) 70%)" }} />
            <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: isMobile ? 8 : 12, padding: isMobile ? "14px 0 0 14px" : "18px 0 0 20px", minHeight: isMobile ? 120 : 140 }}>
              <div style={{ flex: 1, minWidth: 0, paddingBottom: isMobile ? 14 : 16 }}>
                {/* First name over last, each sized to fit. */}
                {(() => {
                  const [fn, ...rest] = String(card.n || "").split(" ");
                  const ln = rest.join(" ");
                  const line = { fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", textShadow: "0 2px 12px rgba(0,0,0,0.35)", paddingRight: shot || homeMark ? 0 : 30 };
                  return (
                    <>
                      <FitLine text={ln ? fn : ""} max={isMobile ? 20 : 24} style={{ ...line, lineHeight: 1, opacity: 0.9, display: ln ? "block" : "none" }} />
                      <FitLine text={ln || fn} max={isMobile ? 34 : 44} style={{ ...line, lineHeight: 0.95 }} />
                    </>
                  );
                })()}
                {(card.from || card.to) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: isMobile ? 10 : 12 }}>
                    {/* A signee has no old school: his new one. */}
                    <HeadLogo name={card.from || card.to} size={isMobile ? 30 : 36} muted={!!next || !!gone} />
                    {moving && <span aria-hidden="true" style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, opacity: 0.85 }}>→</span>}
                    {next ? <HeadLogo name={next} size={isMobile ? 30 : 36} />
                      : gone ? <DepartureIcon kind={gone} dark size={isMobile ? 30 : 36} />
                        : card.status === "uncommitted" ? <span aria-label="Undecided" style={{ width: isMobile ? 30 : 36, height: isMobile ? 30 : 36, flexShrink: 0, borderRadius: "50%", border: "2px dashed rgba(255,255,255,0.65)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: isMobile ? 15 : 18, fontWeight: 900 }}>?</span> : null}
                  </div>
                )}
                {(posTag || (inPortal && card.s) || status[0]) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    {posTag}
                    {inPortal && card.s ? <TransferStars stars={card.s} size="sm" /> : null}
                    {status[0] && <span style={{ fontSize: 12, fontWeight: 900, color: status[1], textShadow: "0 1px 6px rgba(0,0,0,0.4)" }}>{status[0]}</span>}
                  </div>
                )}
              </div>
              {shot
                ? (
                  <div style={{ position: "relative", flexShrink: 0, alignSelf: "flex-end", display: "flex" }}>
                    {/* His school's faded logo, centered behind his head. */}
                    {homeMark && <img src={homeMark} alt="" aria-hidden="true" style={{ position: "absolute", left: "50%", top: "42%", transform: "translate(-50%, -50%)", width: isMobile ? 130 : 160, height: isMobile ? 130 : 160, objectFit: "contain", opacity: 0.16, pointerEvents: "none" }} />}
                    <img src={shot} alt="" onError={() => setEspnShot(false)} style={{ position: "relative", height: isMobile ? 112 : 136, width: "auto", objectFit: "contain", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.45))" }} />
                  </div>
                )
                : homeMark ? <img src={homeMark} alt={homeName} style={{ flexShrink: 0, width: isMobile ? 88 : 108, height: isMobile ? 88 : 108, objectFit: "contain", alignSelf: "center", margin: isMobile ? "0 14px 0 0" : "0 22px 0 0", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.35))" }} /> : null}
            </div>
            <button type="button" aria-label="Close" onClick={() => setCard(null)} style={{ position: "absolute", top: 8, right: 8, zIndex: 2, background: "rgba(0,0,0,0.4)", border: "none", borderRadius: "50%", width: 28, height: 28, color: "#fff", fontSize: "17px", lineHeight: "28px", cursor: "pointer", padding: 0 }}>×</button>
          </div>
          <div style={{ padding: "14px 18px 18px" }}>
            <div style={{ display: "flex", gap: "6px" }}>
              {box("Height", card.ht ? formatHeight(card.ht) : "")}
              {box("Weight", card.wt ? `${card.wt}` : "")}
              {box("Elig. Left", card.e != null ? `${card.eEst ? "~" : ""}${card.e} ${card.e === 1 ? "yr" : "yrs"}` : hsRow ? "5 yrs" : "")}
              {box("Home", card.st || "")}
            </div>
            {career.hometown && <div style={{ marginTop: "8px", fontSize: "12px", fontWeight: 800, color: "#5b6b84" }}>Hometown: <span style={{ color: INK }}>{career.hometown}</span></div>}
            {cardRow === undefined ? <LoadingSpinner label="Loading" size={22} minHeight="90px" /> : (
              <>
                {head("Career Path")}
                {rows.length === 0 ? <div style={{ fontSize: "12px", fontWeight: 700, color: "#8a97ab" }}>No career history on file.</div> : (
                  <div style={{ position: "relative" }}>
                    {rows.map(({ key, ...x }, i) => <CareerStop key={key} {...x} isMobile last={i === rows.length - 1} />)}
                  </div>
                )}
                {lines.length > 0 && (
                  <>
                    {head(`${SEASON - 1} Stats`)}
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      {lines.map((l) => <div key={l} style={{ fontSize: "14px", fontWeight: 900, color: INK }}>{l}</div>)}
                    </div>
                  </>
                )}
              </>
            )}
            {page && (
              <Link to={page} onClick={() => setCard(null)} style={{ marginTop: "16px", display: "block", textAlign: "center", padding: "11px", borderRadius: "10px", background: BLUE, color: "#fff", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.06em", textDecoration: "none" }}>
                View We-Draft Profile →
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  })();

  // ── SEO — from the URL (and the team's name once the teams are in), so a
  // prerender gets real tags before the data loads. ──
  const seo = (() => {
    const base = "https://we-draft.com/portal";
    if (isTeam) {
      const name = T || teamSlug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      const url = `${base}/${teamSlug}${teamTab ? `/${teamTab}` : ""}`;
      if (teamTab === "targets") return {
        url, title: `${name} Transfer Portal Targets and Projections | We-Draft.com`,
        description: `${name} transfer portal targets and projections for ${SEASON}: recommended targets and the players most likely to fit, with transfer star ratings.`,
      };
      if (teamTab === "needs") return {
        url, title: `${name} ${SEASON} Team Needs: Transfer Portal Projections | We-Draft.com`,
        description: `${name}'s ${SEASON} team needs by position from the We-Draft.com Portal Sim: starting spots to fill, starters to upgrade and depth to add after the NFL Draft and the transfer portal.`,
      };
      if (teamTab === "roster") return {
        url, title: `${name} ${SEASON} Projected Roster: Transfers, Signees and Departures | We-Draft.com`,
        description: `${name}'s projected ${SEASON} football roster, position by position: returning players, transfer portal additions and the ${SEASON} signing class, plus every departure to the portal, the NFL Draft and graduation.`,
      };
      return {
        url, title: `${name} Transfer Portal Tracker: ${SEASON} Commits, Entries and Departures | We-Draft.com`,
        description: `Every ${name} transfer portal move for ${SEASON}: players coming in, players entering the portal and where they commit, with transfer star ratings and seasons of eligibility left.`,
      };
    }
    if (isUpdates) return {
      url: `${base}/news/updates`, title: `${SEASON} Transfer Portal Updates: Latest Entries, Commitments and Withdrawals | We-Draft.com`,
      description: `The latest ${SEASON} college football transfer portal moves, newest first: who entered, who committed and where, and who withdrew, with transfer star ratings.`,
    };
    const what = posLabel ? `${posLabel} ` : "";
    return {
      url: `${base}${position ? `/${position.toLowerCase()}` : ""}`,
      title: `${SEASON} College Football ${what}Transfer Portal Tracker${statusLabel && status ? ` · ${statusLabel}` : ""} | We-Draft.com`,
      description: `Every ${what ? what.toLowerCase() : "college football player "}in the ${SEASON} transfer portal: transfer star ratings, seasons of eligibility left, previous school, commitments and home state.`,
    };
  })();

  if (embedded && isUpdates) {
    return (
      <>
        <style>{BOARD_MODERN_STYLE}</style>
        {CardModal}
        <div className="wdb" style={{ fontFamily: "'Arial Black', Arial, sans-serif" }}>{MoveBar}{Feed}</div>
      </>
    );
  }
  return (
    <>
      <Helmet>
        <title>{seo.title}</title>
        <meta name="description" content={seo.description} />
        <link rel="canonical" href={seo.url} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={seo.title} />
        <meta property="og:description" content={seo.description} />
        <meta property="og:url" content={seo.url} />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={seo.title} />
        <meta name="twitter:description" content={seo.description} />
      </Helmet>
      <style>{BOARD_MODERN_STYLE}</style>
      <style>{"@container (max-width: 265px) { .tp-chip-stars { display: none !important; } }"
        + " @keyframes tpHeroDrift { 0% { transform: translate(0, 0); } 100% { transform: translate(-80px, -46px); } }"
        + " @keyframes tpHeroSpotlight { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }"
        + " .tp-hero-btn { transition: filter 0.15s ease, background 0.15s ease; } .tp-hero-btn:hover { filter: brightness(1.12); } .tp-hero-btn.ghost:hover { background-color: rgba(255,255,255,0.18) !important; border-color: #fff !important; }"
        + " .tp-sim-ad { transition: transform 0.15s ease, box-shadow 0.15s ease; } .tp-sim-ad:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(0,0,0,0.25) !important; }"
        + " .tp-hero-home { transition: transform 0.15s ease, opacity 0.15s ease; } .tp-hero-home:hover { opacity: 0.9; } a.tp-hero-home:hover img { transform: scale(1.04); transition: transform 0.15s ease; } h1 a.tp-hero-home:hover { text-decoration: underline !important; text-underline-offset: 4px; text-decoration-thickness: 2px !important; }"
        + " @media (prefers-reduced-motion: reduce) { [style*='tpHero'] { animation: none !important; } }"}</style>
      {CardModal}
      {/* Phones: the page never moves sideways (user, 2026-11-18) — rows of
          pills scroll inside their own strips instead. */}
      {isMobile && <style>{"html, body { overflow-x: clip; }"}</style>}
      {isMobile && <style>{".wd-mobile-filter-grid button { width: 100%; box-sizing: border-box; text-align: center; } .wd-mobile-filter-grid > *:last-child:nth-child(odd) { grid-column: 1 / -1; }"}</style>}
      {isMobile ? (
        <div className="wdb" style={{ padding: "4px 10px 60px", display: "flex", flexDirection: "column", gap: "20px" }}>
          {Main}
          {isTeam ? ConfCard : Sidebars && <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>{Sidebars}</div>}
        </div>
      ) : (
        <div className="wdb" style={{ maxWidth: "1900px", margin: "0 auto", padding: "6px 24px 60px", display: "grid", gridTemplateColumns: "280px minmax(0, 1300px) 280px", gap: "20px", alignItems: "start" }}>
          <div style={{ position: "sticky", top: "20px" }}><SideRailAd isMobile={isMobile} /></div>
          {Main}
          <div style={{ position: "sticky", top: "20px", display: "flex", flexDirection: "column", gap: "18px" }}>{isTeam ? ConfCard : Sidebars}</div>
        </div>
      )}
    </>
  );
}
