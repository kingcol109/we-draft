// src/pages/TransferPortal.jsx
//
// /portal and /portal/:position — the public Transfer Portal: every
// We-Draft player in this cycle's portal on one board, every draft class at
// once (players.PortalCycle = the season the portal feeds, set from Admin →
// Players when they enter): uncommitted (InPortal), committed (resolved:
// PortalCommittedAt, PriorSchool → School) and withdrawn (PortalWithdrawnAt,
// still at School — the same logo in From and To).
//
// /portal/updates — the moves themselves, newest first: entered, committed,
// withdrew (view="updates"; same data, no extra reads).
//
// /portal/:team(/:tab) — every FBS team (utils/portalTeams.js, slug from the
// school name: /portal/ohio-state): its own Activity (moves in and out),
// Additions, Losses, and Targets (suggested uncommitted players —
// suggestTargets below, a first pass to be replaced). A segment that's a
// position (qb…) is the board; anything else is looked up as a team. Built like the Community Board (CommunityBoard.js — same
// kit, components/boardKit.js): position pills with their own routes (OL
// and DB split into OT / IOL and CB / S, ?sub=), filters, sortable columns,
// Comm Grade. No My Grade here.
//
// Where the board shows class rank, the portal shows seasons of eligibility
// left (utils/eligibility.js seasonsLeft — the 5-season rule, from the
// recruit year), counted from the season the open portal feeds. Filters:
// status (All / Uncommitted / Committed, ?status=), home state, eligibility
// left, previous school's conference, community grade, search.
//
// Reads: two queries (players where PortalCycle == this cycle; players
// where InPortal == true, for anyone entered before the cycle tag), the
// community grades snapshot
// (utils/communityGrades.js), and the schools' branding (useSchools,
// batched).
//
// Sample players (admins only, while it's being built): random current
// players from a capped query, shown as if in the portal (about a third of
// them committed somewhere) and tagged SAMPLE. Nothing is written to their
// records. Toggle with the Sample pill.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { Helmet } from "react-helmet-async";
import { db } from "../firebase";
import LoadingSpinner from "../components/LoadingSpinner";
import { SideRailAd } from "../components/MarginAds";
import { useSchools } from "../components/DraftArchiveList";
import {
  BOARD_MODERN_STYLE, POS_COL_W, LOGO_COL_W, DropdownChecklist,
  gradeScale, GradeBadge, displayCommGrade, formatHeight, parseHeight,
} from "../components/boardKit";
import { averageGradesFor, gradeLabel } from "../utils/communityGrades";
import { activePortalSeason, currentDraftClass, seasonsLeft } from "../utils/eligibility";
import { isUnreleasedYear, useIsAdmin } from "../utils/prospectYears";
import { SUB_TABS, inSubTab } from "../utils/subPositions";
import { STATE_ABBR } from "../utils/highSchoolMatch";
import { FBS_CONFERENCES, buildPortalTeams, portalTeamSlug } from "../utils/portalTeams";
import { getSiteSnapshot } from "../utils/siteSnapshots";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#0f1b2d";
const SEASON = activePortalSeason();

const POSITIONS = ["QB", "RB", "WR", "TE", "OL", "EDGE", "DL", "LB", "DB", "K", "P"];
const POSITION_PLURAL = {
  QB: "Quarterback", RB: "Running Back", WR: "Wide Receiver", TE: "Tight End", OL: "Offensive Line",
  EDGE: "Edge Rusher", DL: "Defensive Line", LB: "Linebacker", DB: "Defensive Back", K: "Kicker", P: "Punter",
};
const COMM_GRADES = ["Early First Round", "Middle First Round", "Late First Round", "Second Round", "Third Round", "Fourth Round", "Fifth Round", "Sixth Round", "Seventh Round", "UDFA"];
const eligLabel = (n) => (n === 1 ? "1 Season Left" : `${n} Seasons Left`);

// Seasons-left chip colors: plenty left is green, one left is gold.
const ELIG_COLOR = (n) => (n >= 3 ? "#2e7d32" : n === 2 ? BLUE : n === 1 ? "#c77700" : "#8a97ab");

const MOBILE_SORTS = [
  ["CommunityGrade:asc", "Comm Grade"],
  ["Elig:desc", "Most Eligibility"],
  ["Entered:desc", "Newest Entries"],
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

// Small seeded RNG so the admin sample is the same set all day.
function seeded(seed) {
  let x = seed % 2147483647 || 1;
  return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; };
}

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

// Targets — FIRST PASS, to be replaced with the real model. Uncommitted
// players from other schools, scored by: positions this team has lost
// players at (the more lost, the higher), home state = the school's state,
// community grade, and seasons left. Returns [{ p, score, why: [text] }].
function suggestTargets(team, all, losses, grades) {
  const lostAt = {};
  losses.forEach((p) => { lostAt[p.Position] = (lostAt[p.Position] || 0) + 1; });
  const gv = (g) => (gradeScale[g] ? 11 - gradeScale[g] : 0); // 1st round high … UDFA low
  return all
    .filter((p) => p.status === "uncommitted" && p.from !== team.School)
    .map((p) => {
      const why = [];
      let score = gv(grades[p.id]) * 2 + (p.elig || 0);
      if (lostAt[p.Position]) { score += 6 * lostAt[p.Position]; why.push(`Lost ${lostAt[p.Position]} ${p.Position}`); }
      if (team.State && p.State === team.State) { score += 4; why.push("In-state"); }
      if (gradeScale[grades[p.id]] && gradeScale[grades[p.id]] <= 4) why.push("Round 1–2 grade");
      return { p, score, why };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);
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

export default function TransferPortal({ view = "board" }) {
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
  const TEAM_TABS = [["", "Activity"], ["additions", "Additions"], ["losses", "Losses"], ["targets", "Targets"]];
  const teamTab = TEAM_TABS.some(([k]) => k && k === tabParam) ? tabParam : "";
  const isTeam = !!teamSlug;

  const [real, setReal] = useState(null); // null = loading
  const [samples, setSamples] = useState([]);
  const [sampleOn, setSampleOn] = useState(true);
  const [grades, setGrades] = useState({});

  const [states, setStates] = useState([]);
  const [eligs, setEligs] = useState([]);
  const [confs, setConfs] = useState([]);
  const [commGrades, setCommGrades] = useState([]);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("CommunityGrade");
  const [sortOrder, setSortOrder] = useState("asc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const move = MOVES.some(([k]) => k && k === params.get("move")) ? params.get("move") : "";

  // This cycle's portal — everyone tagged with it, plus anyone still in the
  // portal from before the tag existed.
  useEffect(() => {
    let cancelled = false;
    fetchPortalPlayers()
      .then((list) => { if (!cancelled) setReal(list); })
      .catch((e) => { console.error("Transfer portal load error:", e); if (!cancelled) setReal([]); });
    return () => { cancelled = true; };
  }, []);

  // Admin sample: ~60 random current players (one capped query).
  useEffect(() => {
    if (!isAdmin) { setSamples([]); return undefined; }
    let cancelled = false;
    const C = Number(currentDraftClass());
    const classes = [C, C + 1, C + 2].map(String);
    getDocs(query(collection(db, "players"), where("Eligible", "in", classes), limit(400)))
      .then((snap) => {
        const day = Math.floor(Date.now() / 86400000);
        const rand = seeded(day);
        const pool = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => !p.InPortal && p.Slug && p.Position);
        for (let i = pool.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        const now = Date.now();
        const chosen = pool.slice(0, 60);
        const schoolsPool = [...new Set(chosen.map((p) => p.School).filter(Boolean))];
        const picks = chosen.map((p) => {
          const entered = new Date(now - Math.floor(rand() * 30) * 86400000);
          const roll = rand();
          const later = new Date(Math.min(now, entered.getTime() + Math.floor(rand() * 10 + 1) * 86400000));
          if (roll < 0.1) return { ...p, sample: true, InPortal: false, PortalEnteredAt: entered, PortalWithdrawnAt: later };
          const to = roll < 0.4 ? schoolsPool.filter((x) => x !== p.School)[Math.floor(rand() * Math.max(1, schoolsPool.length - 1))] : null;
          return to
            ? { ...p, sample: true, InPortal: false, PriorSchool: p.School, PriorSchoolYear: String(SEASON - 1), School: to, PortalEnteredAt: entered, PortalCommittedAt: later }
            : { ...p, sample: true, InPortal: true, PortalOriginalSchool: p.School, PortalEnteredAt: entered };
        });
        if (!cancelled) setSamples(picks);
      })
      .catch((e) => console.error("Transfer portal sample error:", e));
    return () => { cancelled = true; };
  }, [isAdmin]);

  const all = useMemo(() => {
    const list = [...(real || []), ...(isAdmin && sampleOn ? samples : [])]
      .filter((p) => isAdmin || !isUnreleasedYear(p.Eligible));
    return list.map((p) => {
      const left = seasonsLeft(p, SEASON);
      const withdrawn = !p.InPortal && !!p.PortalWithdrawnAt;
      const committed = !p.InPortal && !withdrawn;
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
      };
    });
  }, [real, samples, sampleOn, isAdmin]);

  // Community grades for everyone shown — one snapshot read.
  const idsKey = all.map((p) => p.id).sort().join(",");
  useEffect(() => {
    if (!idsKey) return undefined;
    let cancelled = false;
    averageGradesFor(idsKey.split(",")).then((avgs) => {
      if (cancelled) return;
      const g = {};
      Object.entries(avgs || {}).forEach(([id, a]) => { g[id] = gradeLabel(a) || "-"; });
      setGrades(g);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [idsKey]);

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
    if (commGrades.length && !commGrades.includes(grades[p.id])) return false;
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
    const gv = (g) => gradeScale[g] ?? 99;
    const cmp = {
      CommunityGrade: (a, b) => gv(grades[a.id]) - gv(grades[b.id]),
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
    // Ties: best grade, then most eligibility, then newest.
    return list.sort((a, b) => dir * cmp(a, b) || gv(grades[a.id]) - gv(grades[b.id]) || (b.elig ?? -1) - (a.elig ?? -1) || b.enteredMs - a.enteredMs);
  };
  const shown = useMemo(() => sortRows(all.filter((p) => inFilters(p))),
    [all, position, sub, status, states, eligs, confs, commGrades, search, sortKey, sortOrder, grades, schools]); // eslint-disable-line react-hooks/exhaustive-deps

  // Counts per position under the other filters (the pills show them).
  const posCounts = useMemo(() => {
    const c = {};
    all.filter((p) => inFilters(p, { skipPos: true })).forEach((p) => { c[p.Position] = (c[p.Position] || 0) + 1; });
    return c;
  }, [all, status, states, eligs, confs, commGrades, search, grades, schools]); // eslint-disable-line react-hooks/exhaustive-deps

  // Counts per status under the other filters (the status pills show them).
  const statusCounts = useMemo(() => {
    const list = all.filter((p) => inFilters(p, { skipStatus: true }));
    const c = { "": list.length, uncommitted: 0, committed: 0, withdrawn: 0 };
    list.forEach((p) => { c[p.status] += 1; });
    return c;
  }, [all, position, sub, states, eligs, confs, commGrades, search, grades, schools]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSort = (k) => {
    if (sortKey === k) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortOrder(["Elig", "Entered", "Height", "Weight"].includes(k) ? "desc" : "asc"); }
  };
  const activeFilters = states.length + eligs.length + confs.length + commGrades.length;
  const reset = () => { setStates([]); setEligs([]); setConfs([]); setCommGrades([]); setSearch(""); setParam("status", ""); };
  const setParam = (key, v) => { const n = new URLSearchParams(params); if (v) n.set(key, v); else n.delete(key); setParams(n, { replace: true }); };
  const setSub = (k) => setParam("sub", k);

  const loading = real === null;
  const sampleCount = isAdmin && sampleOn ? samples.length : 0;
  const posLabel = position ? (sub || POSITION_PLURAL[position]) : "";
  const statusLabel = STATUSES.find(([k]) => k === status)?.[1];
  const title = `${SEASON} ${posLabel ? `${posLabel} ` : ""}Transfer Portal${status ? ` · ${statusLabel}` : ""}`;

  // Pulse numbers (everyone in the portal, no filters).
  const weekAgo = Date.now() - 7 * 86400000;
  const pulse = {
    total: all.length,
    open: all.filter((p) => p.status === "uncommitted").length,
    committed: all.filter((p) => p.committed).length,
    withdrawn: all.filter((p) => p.withdrawn).length,
  };

  // Every move this cycle, newest first — the updates feed and Latest Moves.
  const moves = useMemo(() => all.flatMap((p) => [
    p.enteredMs && { kind: "entered", ms: p.enteredMs, p },
    p.committed && p.committedMs && { kind: "committed", ms: p.committedMs, p },
    p.withdrawn && p.withdrawnMs && { kind: "withdrew", ms: p.withdrawnMs, p },
  ].filter(Boolean)).sort((a, b) => b.ms - a.ms), [all]);
  const movesThisWeek = moves.filter((m) => m.ms >= weekAgo).length;

  const Hero = (
    <div className="wdb-hero" style={{ marginBottom: isMobile ? "10px" : "14px", borderRadius: "16px", overflow: "hidden" }}>
      <div style={{ background: `linear-gradient(120deg, ${BLUE} 0%, #003f7d 100%)`, padding: isMobile ? "14px 14px" : "18px 24px", position: "relative", overflow: "hidden" }}>
        {/* The portal mark, faint, behind the title. */}
        <img src="/logos/transfer-portal.svg" alt="" aria-hidden="true" style={{ position: "absolute", right: isMobile ? "-24px" : "18px", top: "50%", transform: "translateY(-50%)", height: isMobile ? "110px" : "150px", opacity: 0.12, pointerEvents: "none" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
        <h1 style={{ position: "relative", margin: 0, textAlign: "center", fontSize: isMobile ? "22px" : "36px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.03em", color: "#fff", lineHeight: 1.05 }}>
          {isUpdates
            ? <>{SEASON} <span style={{ color: GOLD }}>Portal</span> Updates</>
            : <>{SEASON} <span style={{ color: GOLD }}>{posLabel || "Transfer"}</span> Portal</>}
        </h1>
        <div style={{ position: "relative", marginTop: "4px", textAlign: "center", fontSize: isMobile ? "10px" : "12px", fontWeight: 700, color: "rgba(255,255,255,0.82)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {isUpdates ? "Every move in the portal · Entries · Commitments · Withdrawals" : "Every player in the portal · Who's committed · Seasons of eligibility left"}
        </div>
      </div>
      <div className="wdb-stripe" style={{ height: "3px", background: GOLD }} />
    </div>
  );

  // The snapshot up top: four counts (each opens the board on that status)
  // and the way into the updates feed.
  const pickStatus = (key) => (isUpdates ? navigate(`/portal${key ? `?status=${key}` : ""}`) : setParam("status", key));
  const Pulse = !loading && all.length > 0 && (
    <div style={{ marginBottom: isMobile ? "10px" : "14px" }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: "8px" }}>
        {[
          [pulse.total, "Entered the Portal", ""],
          [pulse.open, "Uncommitted", "uncommitted"],
          [pulse.committed, "Committed", "committed"],
          [pulse.withdrawn, "Withdrawn", "withdrawn"],
        ].map(([v, label, key]) => {
          const on = !isUpdates && status === key;
          return (
            <div key={label} role="button" tabIndex={0} onClick={() => pickStatus(key)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickStatus(key); } }}
              style={{ background: "#fff", border: `1px solid ${on ? GOLD : "#e3e8ef"}`, boxShadow: on ? `0 0 0 1px ${GOLD}` : "none", borderRadius: "14px", padding: isMobile ? "10px 12px" : "12px 16px", cursor: "pointer" }}>
              <div style={{ fontSize: isMobile ? "22px" : "28px", fontWeight: 900, color: BLUE, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{v}</div>
              <div style={{ marginTop: "4px", fontSize: "11px", fontWeight: 900, color: "#5b6b84", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
            </div>
          );
        })}
      </div>
      <Link to={isUpdates ? "/portal" : "/portal/updates"} style={{
        marginTop: "8px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: isMobile ? "9px 12px" : "10px 16px",
        background: "#fff", border: "1px solid #e3e8ef", borderRadius: "12px", textDecoration: "none", color: INK, fontSize: isMobile ? "12px" : "13px", fontWeight: 800,
      }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = BLUE; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#e3e8ef"; }}>
        <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: movesThisWeek ? "#2e7d32" : "#b8c2d1", flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isUpdates ? "Every player in the portal, on one board" : `${movesThisWeek} move${movesThisWeek === 1 ? "" : "s"} this week${moves[0] ? ` · latest ${fmtDate(moves[0].ms)}` : ""}`}
          </span>
        </span>
        <span style={{ flexShrink: 0, color: BLUE, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "12px" }}>
          {isUpdates ? "← Portal Board" : "Portal Updates →"}
        </span>
      </Link>
    </div>
  );

  const posPill = (key, label, count) => {
    const active = position === key;
    return (
      <Link key={key || "all"} to={(key ? `/portal/${key.toLowerCase()}` : "/portal") + (status ? `?status=${status}` : "")} aria-current={active ? "page" : undefined}
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
      <div style={{ display: "inline-flex", padding: "3px", borderRadius: "999px", background: "#fff", border: "1px solid #e3e8ef", gap: "2px" }}>
        {STATUSES.map(([k, label]) => {
          const on = status === k;
          return (
            <button key={k || "all"} type="button" role="tab" aria-selected={on} onClick={() => setParam("status", k)} style={{
              padding: isMobile ? "6px 12px" : "7px 18px", borderRadius: "999px", border: "none", cursor: "pointer", fontFamily: "inherit",
              background: on ? BLUE : "transparent", color: on ? "#fff" : BLUE, fontWeight: 900, fontSize: isMobile ? "12px" : "13px",
              textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap",
            }}>
              {label}{!loading && <span style={{ marginLeft: "6px", opacity: 0.7, fontSize: "11px" }}>{statusCounts[k]}</span>}
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

  const sampleToggle = isAdmin && (
    <button type="button" onClick={() => setSampleOn((v) => !v)} className={"wdb-pill" + (sampleOn ? " on" : "")} title="Admin only — random current players shown as if in the portal"
      style={{ padding: "8px 14px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em", border: "2px solid #c0392b", borderRadius: "8px", cursor: "pointer", background: sampleOn ? "#c0392b" : "#fff", color: sampleOn ? "#fff" : "#c0392b", whiteSpace: "nowrap" }}>
      {sampleOn ? "✓ " : ""}Sample · Admin
    </button>
  );
  const dropdowns = (
    <>
      <DropdownChecklist title="State" options={stateOptions} selected={states} setSelected={setStates} />
      <DropdownChecklist title="Eligibility" options={eligOptions} selected={eligs} setSelected={setEligs} ordered />
      <DropdownChecklist title="Conference" options={confOptions} selected={confs} setSelected={setConfs} />
      <DropdownChecklist title="Comm Grade" options={COMM_GRADES} selected={commGrades} setSelected={setCommGrades} ordered />
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
          {sampleToggle}
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
        {sampleToggle}
        {searchBox}
        <button type="button" onClick={reset} style={{ background: "none", border: "none", color: "#999", fontSize: "12px", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Reset</button>
      </div>
    </>
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
  const SampleTag = () => <span style={{ flexShrink: 0, fontSize: "9px", fontWeight: 900, letterSpacing: "0.08em", color: "#fff", background: "#c0392b", borderRadius: "4px", padding: "2px 5px" }}>SAMPLE</span>;

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
            <Link to={`/player/${p.Slug}`} style={{ color: INK, fontWeight: 900, fontSize: "16px", lineHeight: 1.15, textDecoration: "none", overflowWrap: "break-word", minWidth: 0 }}>{fullName(p)}</Link>
            {p.sample && <SampleTag />}
          </div>
          <div style={{ marginTop: "5px", display: "flex", alignItems: "center", gap: "5px", minWidth: 0, overflow: "hidden" }}>
            {lead}
            {p.Position && pill(p.Position, BLUE, "#eaf1ff")}
            {ec && pill(`${p.eligEst ? "~" : ""}${p.elig} ${p.elig === 1 ? "YR" : "YRS"}`, ec, `color-mix(in srgb, ${ec} 9%, #fff)`, ec)}
            {stateCode(p) && <span style={{ flexShrink: 0, fontSize: "12px", fontWeight: 900, color: "#5b6b84", marginLeft: "1px" }}>{stateCode(p)}</span>}
          </div>
          {extra || (facts.length > 0 && <div style={{ marginTop: "4px", fontSize: "12px", fontWeight: 700, color: "#8a97ab", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{facts.join(" · ")}</div>)}
        </div>
        <GradeBadge grade={displayCommGrade(grades[p.id])} small />
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
  const renderTable = (rows, { title: tt = title, emptyNode = empty, dateLabel = "Entered", dateTitle = "Date entered the portal", dateOf = (p) => p.enteredMs } = {}) => (
    <div className="wdb-card" style={{ borderRadius: "14px", overflow: "hidden", background: "#fff" }}>
      <div className="wdb-cardhead" style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>{tt}</div>
        <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" }}>
          {loading ? "" : `${rows.length} player${rows.length === 1 ? "" : "s"}`}
          {sampleCount > 0 && <span style={{ marginLeft: "8px", color: "#ffb3a8" }}>incl. samples</span>}
        </div>
      </div>
      {loading ? <LoadingSpinner label="Loading" size={32} minHeight="240px" /> : isMobile ? (
        <div style={{ maxHeight: "calc(72vh / var(--pz, 1))", overflowY: "auto" }}>
          {rows.length === 0 ? emptyNode : rows.map((p) => (
            <MobileRow key={p.id} p={p} fromMuted={p.committed} toNode={<ToCell p={p} size={26} />} meta={fmtDate(dateOf(p))} />
          ))}
        </div>
      ) : (
        <div style={{ maxHeight: "820px", overflowY: "auto" }}>
          <div className="wdb-colhead" style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", alignItems: "center", gap: "16px", background: "linear-gradient(135deg, " + BLUE + ", #003d7a)", padding: "12px 20px" }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "14px" }}>
              <SortLabel k="CommunityGrade" label="Comm" title="Community grade" width="70px" />
              <SortLabel k="Elig" label="Elig" title="Seasons of eligibility left" width="58px" />
              <SortLabel k="Position" label="Pos" title="Position" width={POS_COL_W + "px"} />
              <SortLabel k="From" label="From" title="Previous school" width={FROM_TO_W + "px"} />
              <SortLabel k="Status" label="To" title="New school (uncommitted first)" width={FROM_TO_W + "px"} />
              <SortLabel k="Player" label="Player" align="left" />
            </div>
            <SortLabel k="State" label="State" title="Home state" width="62px" />
            <SortLabel k="Height" label="HT" width="56px" />
            <SortLabel k="Weight" label="WT" width="52px" />
            <SortLabel k="Entered" label={dateLabel} title={dateTitle} width="78px" />
          </div>
          {rows.length === 0 ? emptyNode : rows.map((p) => {
            return (
              <div key={p.id} className="wdb-row" style={{ display: "flex", alignItems: "center", gap: "16px", padding: "11px 20px", background: "#fff", transition: "background 0.12s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#f3f8ff"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}>
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "14px" }}>
                  <div style={{ width: "70px", flexShrink: 0, display: "flex", justifyContent: "center" }}><GradeBadge grade={displayCommGrade(grades[p.id])} /></div>
                  <EligChip p={p} />
                  <div style={{ width: POS_COL_W + "px", flexShrink: 0 }}>
                    <span style={{ display: "block", fontSize: "14px", fontWeight: 900, color: BLUE, background: "#eaf1ff", padding: "6px 0", textAlign: "center", borderRadius: "6px" }}>{p.Position || "—"}</span>
                  </div>
                  <div style={{ width: FROM_TO_W + "px", flexShrink: 0, display: "flex", justifyContent: "center" }}><SchoolMark name={p.from} size={LOGO_COL_W} title={`From ${p.from}`} muted={p.committed} /></div>
                  <div style={{ width: FROM_TO_W + "px", flexShrink: 0, display: "flex", justifyContent: "center" }}><ToCell p={p} size={LOGO_COL_W} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Long names wrap (as on the board) rather than truncate. */}
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 10px", minWidth: 0 }}>
                      <Link to={`/player/${p.Slug}`} style={{ color: BLUE, fontWeight: 900, fontSize: "24px", textDecoration: "none", lineHeight: 1.1, overflowWrap: "break-word", minWidth: 0 }}
                        onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}>{fullName(p)}</Link>
                      {p.sample && <SampleTag />}
                    </div>
                  </div>
                </div>
                <div title={p.HighSchool ? `${p.State}${p.HighSchool ? ` · ${p.HighSchool}` : ""}` : p.State || undefined} style={{ width: "62px", flexShrink: 0, textAlign: "center", fontSize: "19px", fontWeight: 900, color: "#333" }}>{stateCode(p) || "-"}</div>
                <div style={{ width: "56px", flexShrink: 0, textAlign: "center", fontSize: "19px", fontWeight: 900, color: "#333" }}>{p.HeightInches ? formatHeight(p.HeightInches) : (p.Height || "-")}</div>
                <div style={{ width: "52px", flexShrink: 0, textAlign: "center", fontSize: "19px", fontWeight: 900, color: "#333" }}>{p.Weight || "-"}</div>
                <div style={{ width: "78px", flexShrink: 0, textAlign: "center", fontSize: "14px", fontWeight: 900, color: dateOf(p) >= weekAgo ? GOLD : "#5b6b84" }}>{fmtDate(dateOf(p))}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
  const List = renderTable(shown);

  // ── Sidebars: latest entries, and the portal by position. ──
  const latest = moves.slice(0, 8);
  const byPos = POSITIONS.map((pos) => [pos, all.filter((p) => p.Position === pos).length]);
  const maxPos = Math.max(1, ...byPos.map(([, n]) => n));
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
        <SideCard title="Latest Moves" to="/portal/updates">
          {latest.map((m, i) => {
            const st = MOVE_STYLE[m.kind];
            return (
              <Link key={`${m.p.id}-${m.kind}`} to={`/player/${m.p.Slug}`} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 14px", textDecoration: "none", borderBottom: i < latest.length - 1 ? "1px solid #eef1f5" : "none" }}
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
      <SideCard title="By Position">
        <div style={{ padding: "8px 14px 10px" }}>
          {byPos.map(([pos, n]) => (
            <Link key={pos} to={`/portal/${pos.toLowerCase()}`} style={{ display: "grid", gridTemplateColumns: "42px 1fr 28px", alignItems: "center", gap: "8px", padding: "4px 0", textDecoration: "none" }}>
              <span style={{ fontSize: "12px", fontWeight: 900, color: position === pos ? GOLD : BLUE }}>{pos}</span>
              <span style={{ height: "8px", borderRadius: "4px", background: "#eef1f5", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${(n / maxPos) * 100}%`, background: position === pos ? GOLD : BLUE, borderRadius: "4px" }} />
              </span>
              <span style={{ fontSize: "12px", fontWeight: 900, color: INK, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{n}</span>
            </Link>
          ))}
        </div>
      </SideCard>
    </>
  );

  // /portal/updates: every move, newest first, under day headers.
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
          {sampleCount > 0 && <span style={{ marginLeft: "8px", color: "#ffb3a8" }}>incl. samples</span>}
        </div>
      </div>
      {loading ? <LoadingSpinner label="Loading" size={32} minHeight="240px" /> : list.length === 0 ? (
        <div style={{ padding: "48px 20px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "14px" }}>
          {emptyText}
        </div>
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
                    <Link to={`/player/${p.Slug}`} style={{ color: BLUE, fontWeight: 900, fontSize: isMobile ? "15px" : "20px", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{fullName(p)}</Link>
                    {p.sample && <SampleTag />}
                  </div>
                  <div style={{ marginTop: "2px", fontSize: isMobile ? "11px" : "13px", fontWeight: 700, color: "#5b6b84", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {isMobile && <span style={{ color: st.color, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.04em" }}>{st.label} · </span>}
                    {[p.Position, stateCode(p), !isMobile && (m.kind === "entered" ? `From ${p.from}` : m.kind === "committed" ? `${p.from} → ${p.to}` : `Stays at ${p.to}`)].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {!isMobile && <EligChip p={p} />}
                <GradeBadge grade={displayCommGrade(grades[p.id])} small={isMobile} />
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
  const teamMoves = !team ? [] : moves.filter((m) => (m.kind === "entered" && m.p.from === T)
    || (m.kind === "committed" && (m.p.to === T || m.p.from === T))
    || (m.kind === "withdrew" && m.p.to === T));
  const additions = !team ? [] : sortRows(all.filter((p) => p.committed && p.to === T));
  const losses = !team ? [] : sortRows(all.filter((p) => p.from === T && !p.withdrawn));
  const stillOut = losses.filter((p) => p.status === "uncommitted").length;
  const targets = team && teamTab === "targets" ? suggestTargets(team, all, losses, grades) : [];
  const tc1 = team?.Color1 || BLUE;
  const tc2 = team?.Color2 || GOLD;
  const TeamHero = team && (
    <div style={{ marginBottom: isMobile ? "10px" : "14px", borderRadius: "16px", overflow: "hidden", border: "1px solid #e3e8ef" }}>
      <div style={{ position: "relative", overflow: "hidden", padding: isMobile ? "16px 14px" : "20px 26px", display: "flex", alignItems: "center", gap: isMobile ? "14px" : "22px", background: `linear-gradient(120deg, ${tc1} 0%, ${tc1} 55%, color-mix(in srgb, ${tc1} 70%, #000) 100%)` }}>
        <img src="/logos/transfer-portal.svg" alt="" aria-hidden="true" style={{ position: "absolute", right: isMobile ? "-30px" : "16px", top: "50%", transform: "translateY(-50%)", height: isMobile ? "110px" : "150px", opacity: 0.1, pointerEvents: "none" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
        {/* Team-color fill: the dark-background logo when there is one. */}
        {(team.LogoDark || team.Logo1) && <img src={team.LogoDark || team.Logo1} alt={T} style={{ position: "relative", width: isMobile ? 64 : 96, height: isMobile ? 64 : 96, objectFit: "contain", flexShrink: 0, filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.35))" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
        <div style={{ position: "relative", minWidth: 0 }}>
          <div style={{ fontSize: isMobile ? "11px" : "12px", fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.8)" }}>{SEASON} Transfer Portal{team.Conference ? ` · ${team.Conference}` : ""}</div>
          <h1 style={{ margin: "2px 0 0", fontSize: isMobile ? "24px" : "38px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em", color: "#fff", lineHeight: 1.05 }}>{T}</h1>
          <div style={{ marginTop: "6px", display: "flex", gap: "12px", flexWrap: "wrap", fontSize: "12px", fontWeight: 800 }}>
            <Link to="/portal" style={{ color: "#fff", textDecoration: "underline", textUnderlineOffset: "3px", textDecorationColor: "rgba(255,255,255,0.5)" }}>← Full portal</Link>
            {team.teamSlug && <Link to={`/team/${team.teamSlug}`} style={{ color: "#fff", textDecoration: "underline", textUnderlineOffset: "3px", textDecorationColor: "rgba(255,255,255,0.5)" }}>Team page</Link>}
          </div>
        </div>
      </div>
      <div style={{ height: "4px", background: tc2 }} />
    </div>
  );
  const net = additions.length - losses.length;
  const TeamPulse = team && !loading && (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: "8px", marginBottom: isMobile ? "10px" : "14px" }}>
      {[
        [additions.length, "Additions", "additions", "#2e7d32"],
        [losses.length, "Losses", "losses", "#c0392b"],
        [net > 0 ? `+${net}` : net, "Net", "", net > 0 ? "#2e7d32" : net < 0 ? "#c0392b" : BLUE],
        [stillOut, "Still in Portal", "losses", BLUE],
      ].map(([v, label, k, color]) => (
        <Link key={label} to={`/portal/${teamSlug}${k ? `/${k}` : ""}`} style={{ background: "#fff", border: `1px solid ${teamTab === k && k ? tc1 : "#e3e8ef"}`, borderRadius: "14px", padding: isMobile ? "10px 12px" : "12px 16px", textDecoration: "none" }}>
          <div style={{ fontSize: isMobile ? "22px" : "28px", fontWeight: 900, color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{v}</div>
          <div style={{ marginTop: "4px", fontSize: "11px", fontWeight: 900, color: "#5b6b84", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
        </Link>
      ))}
    </div>
  );
  const teamCounts = { "": teamMoves.length, additions: additions.length, losses: losses.length, targets: null };
  const TeamTabs = team && (
    <div style={{ display: "flex", gap: isMobile ? "5px" : "8px", justifyContent: isMobile ? "flex-start" : "center", overflowX: isMobile ? "auto" : "visible", marginBottom: "12px", paddingBottom: isMobile ? "2px" : 0 }}>
      {TEAM_TABS.map(([k, label]) => {
        const on = teamTab === k;
        return (
          <Link key={k || "activity"} to={`/portal/${teamSlug}${k ? `/${k}` : ""}`} aria-current={on ? "page" : undefined} style={{
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
  const TargetsCard = team && (
    <div className="wdb-card" style={{ borderRadius: "14px", overflow: "hidden", background: "#fff" }}>
      <div className="wdb-cardhead" style={{ background: tc1, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <div style={{ color: "#fff", fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>{T} Portal Targets</div>
        <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "11px", fontWeight: 700 }}>Suggested · uncommitted players</div>
      </div>
      <div style={{ padding: "8px 16px", background: "#f7f9fc", borderBottom: "1px solid #e3e8ef", fontSize: "12px", fontWeight: 700, color: "#5b6b84" }}>
        Players {T} could target, based on the positions it has lost to the portal, in-state ties and community grades.
      </div>
      {loading ? <LoadingSpinner label="Loading" size={32} minHeight="200px" /> : targets.length === 0 ? teamEmpty("No uncommitted players to suggest yet.") : targets.map(({ p, why }, i) => (isMobile ? (
        <MobileRow key={p.id} p={p} toNode={<ToCell p={p} size={26} />}
          left={<span style={{ width: 18, flexShrink: 0, textAlign: "right", fontSize: "13px", fontWeight: 900, color: i < 3 ? GOLD : "#8a97ab" }}>{i + 1}</span>}
          extra={<div style={{ marginTop: "5px", display: "flex", flexWrap: "wrap", gap: "4px" }}>{why.map((w) => <span key={w} style={{ fontSize: "11px", fontWeight: 900, color: tc1, background: `color-mix(in srgb, ${tc1} 9%, #fff)`, borderRadius: "999px", padding: "2px 8px", whiteSpace: "nowrap" }}>{w}</span>)}</div>} />
      ) : (
        <div key={p.id} className="wdb-row" style={{ display: "flex", alignItems: "center", gap: isMobile ? "8px" : "14px", padding: isMobile ? "10px" : "11px 18px", background: "#fff" }}>
          <div style={{ width: isMobile ? 22 : 28, flexShrink: 0, textAlign: "right", fontSize: isMobile ? "13px" : "15px", fontWeight: 900, color: i < 3 ? GOLD : "#8a97ab", fontVariantNumeric: "tabular-nums" }}>{i + 1}</div>
          <GradeBadge grade={displayCommGrade(grades[p.id])} small={isMobile} />
          {!isMobile && <EligChip p={p} />}
          <span style={{ flexShrink: 0, width: isMobile ? 40 : 52, textAlign: "center", fontSize: isMobile ? "12px" : "14px", fontWeight: 900, color: BLUE, background: "#eaf1ff", padding: "5px 0", borderRadius: "6px" }}>{p.Position || "—"}</span>
          <SchoolMark name={p.from} size={isMobile ? 28 : LOGO_COL_W} title={`From ${p.from}`} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
              <Link to={`/player/${p.Slug}`} style={{ color: BLUE, fontWeight: 900, fontSize: isMobile ? "15px" : "20px", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{fullName(p)}</Link>
              {p.sample && <SampleTag />}
            </div>
            <div style={{ marginTop: "4px", display: "flex", flexWrap: "wrap", gap: "4px" }}>
              {why.map((w) => <span key={w} style={{ fontSize: "11px", fontWeight: 900, color: tc1, background: `color-mix(in srgb, ${tc1} 9%, #fff)`, borderRadius: "999px", padding: "2px 8px", whiteSpace: "nowrap" }}>{w}</span>)}
              {stateCode(p) && <span style={{ fontSize: "11px", fontWeight: 800, color: "#5b6b84", padding: "2px 4px" }}>{stateCode(p)}</span>}
            </div>
          </div>
        </div>
      )))}
    </div>
  );
  const TeamBody = team && (
    teamTab === "additions" ? renderTable(additions, { title: `${T} Additions`, emptyNode: teamEmpty(`No commitments to ${T} yet.`), dateLabel: "Committed", dateTitle: "Date committed", dateOf: (p) => p.committedMs })
      : teamTab === "losses" ? renderTable(losses, { title: `${T} Losses`, emptyNode: teamEmpty(`No ${T} players in the ${SEASON} portal yet.`) })
        : teamTab === "targets" ? TargetsCard
          : renderFeed(teamMoves, { title: `${T} Portal Activity`, emptyText: `No ${T} portal moves yet.` })
  );
  // Right rail on a team page: its conference, each school's net.
  const confTeams = team ? Object.entries(teams || {}).filter(([, t]) => t.Conference === team.Conference) : [];
  const confRows = confTeams.map(([slug, t]) => {
    const add = all.filter((p) => p.committed && p.to === t.School).length;
    const lost = all.filter((p) => p.from === t.School && !p.withdrawn).length;
    return { slug, t, add, lost, net: add - lost };
  }).sort((a, b) => b.net - a.net || b.add - a.add || a.t.School.localeCompare(b.t.School));
  const ConfCard = team && (
    <div className="wdb-side" style={{ borderRadius: "14px", overflow: "hidden", background: "#fff" }}>
      <div className="wdb-sidehead" style={{ background: BLUE, padding: "12px 16px" }}>
        <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", letterSpacing: "0.14em", textTransform: "uppercase" }}>{team.Conference} Portal</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 30px 30px 34px", gap: "6px", padding: "6px 14px", fontSize: "10px", fontWeight: 900, color: "#8a97ab", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid #eef1f5" }}>
        <span>Team</span><span style={{ textAlign: "right" }}>In</span><span style={{ textAlign: "right" }}>Out</span><span style={{ textAlign: "right" }}>Net</span>
      </div>
      {confRows.map((r, i) => (
        <Link key={r.slug} to={`/portal/${r.slug}`} style={{ display: "grid", gridTemplateColumns: "1fr 30px 30px 34px", gap: "6px", alignItems: "center", padding: "7px 14px", textDecoration: "none", background: r.slug === teamSlug ? `color-mix(in srgb, ${tc1} 9%, #fff)` : "#fff", borderBottom: i < confRows.length - 1 ? "1px solid #eef1f5" : "none" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
            {r.t.Logo1 ? <img src={r.t.Logo1} alt="" style={{ width: 20, height: 20, objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} /> : <span style={{ width: 20 }} />}
            <span style={{ fontSize: "13px", fontWeight: 800, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.t.School}</span>
          </span>
          <span style={{ textAlign: "right", fontSize: "12px", fontWeight: 900, color: "#2e7d32" }}>{r.add}</span>
          <span style={{ textAlign: "right", fontSize: "12px", fontWeight: 900, color: "#c0392b" }}>{r.lost}</span>
          <span style={{ textAlign: "right", fontSize: "12px", fontWeight: 900, color: r.net > 0 ? "#2e7d32" : r.net < 0 ? "#c0392b" : "#8a97ab" }}>{r.net > 0 ? `+${r.net}` : r.net}</span>
        </Link>
      ))}
    </div>
  );

  const Main = isTeam ? (
    <div style={{ fontFamily: "'Arial Black', Arial, sans-serif" }}>
      {!team ? <LoadingSpinner label="Loading" size={40} minHeight="300px" /> : (
        <>
          {TeamHero}
          {TeamPulse}
          {isAdmin && sampleCount > 0 && (
            <div style={{ marginBottom: "10px", padding: "8px 12px", borderRadius: "10px", background: "#fdecea", border: "1px solid #f5c6c0", color: "#a12a1d", fontSize: "12px", fontWeight: 800, textAlign: "center" }}>
              Admin view: sample players are mixed in (tagged SAMPLE).
            </div>
          )}
          {TeamTabs}
          {TeamBody}
        </>
      )}
    </div>
  ) : (
    <div style={{ fontFamily: "'Arial Black', Arial, sans-serif" }}>
      {Hero}
      {Pulse}
      {isAdmin && sampleCount > 0 && (
        <div style={{ marginBottom: "10px", padding: "8px 12px", borderRadius: "10px", background: "#fdecea", border: "1px solid #f5c6c0", color: "#a12a1d", fontSize: "12px", fontWeight: 800, textAlign: "center" }}>
          Admin view: {sampleCount} sample players are mixed in (tagged SAMPLE). Visitors only see real portal entries ({(real || []).length} this cycle).
        </div>
      )}
      {isUpdates ? <>{MoveBar}{Feed}</> : <>{Filters}{List}</>}
    </div>
  );

  return (
    <>
      <Helmet>
        <title>{`${isTeam ? `${T || "Team"} ${SEASON} Transfer Portal` : isUpdates ? `${SEASON} Transfer Portal Updates` : title} | We-Draft.com`}</title>
        <meta name="description" content={`Every college football player in the ${SEASON} transfer portal — seasons of eligibility left, previous school, home state and community grades.`} />
        {/* In development — indexable once it's released. */}
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <style>{BOARD_MODERN_STYLE}</style>
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
