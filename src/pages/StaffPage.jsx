import { useParams, Link, Navigate } from "react-router-dom";
import { Fragment, useState, useEffect, useMemo, useRef } from "react";
import { doc, getDoc } from "firebase/firestore";
import { Helmet } from "react-helmet-async";
import { db } from "../firebase";
import LoadingSpinner from "../components/LoadingSpinner";
import DraftArchiveList, { useSchoolLogos, useSchools } from "../components/DraftArchiveList";
import { viewportCssWidth } from "../utils/pageZoom";
import {
  ROLE_BY_KEY, NFL_TEAMS, CREDIT_SCOPES, POSITION_SIDE,
  draftCredits, creditForPick, stintYearSpan, groupStints, isOpenStint, isPlayerStint,
} from "../utils/coachHistory";
import { STAT_METRICS, percentileFromTable } from "../utils/historicalStats";
import { PROFILE_SKIP, buildProfile, scoreProspects, fitScore, pageScopes } from "../utils/draftProfiles";
import { fetchStaffPickRows, fetchProspects, fetchPctTables, fetchNflBranding, fetchCurrentStaff } from "../utils/draftProfileData";
import { getSiteSnapshot } from "../utils/siteSnapshots";
import { textOn } from "../utils/teamColors";
import DraftOrderRail from "../components/DraftOrderRail";
import DraftNowButton from "../components/DraftNowButton";

// ── /staff/{slug} — a current head coach's or GM's draft history ──
// Every pick their team made while they held a creditable job there (see
// draftCredits/creditForPick in utils/coachHistory.js), from the
// "historical" collection (2000 → last year) plus draftOrder's just-finished
// draft. Default view is the years in their current job (HC or GM); other roles
// can be switched on. Tabs: Draft Insights (/staff/{slug}) for the top-down
// numbers, Draft Record (/staff/{slug}/record) for every pick, Targets
// (/staff/{slug}/targets) for a per-position profile of who they draft and
// the prospects who fit it, and
// Career Path (/staff/{slug}/career) for their whole career. The left rail links to
// the other current head coaches or GMs.

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
// draftOrder holds this draft; "historical" holds everything before it —
// same split NFLTeamPage.jsx's Draft Archive uses.
const DRAFT_ORDER_YEAR = 2026;
const FIRST_DRAFT_YEAR = 2000;
const PAGE_ROLES = ["HC", "IHC", "GM"];
const POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB", "K", "P", "LS"];
const ROUNDS = [1, 2, 3, 4, 5, 6, 7];
// [key, label, URL suffix] — the URL's :tab param is the suffix.
const TABS = [
  ["draft", "Draft Insights", ""], ["record", "Draft Record", "/record"],
  ["targets", "Targets", "/targets"], ["career", "Career Path", "/career"],
];
const TAB_SUFFIX = Object.fromEntries(TABS.map(([key, , suffix]) => [key, suffix]));
// Phones: four full labels don't fit across one row.
const MOBILE_TAB_LABELS = { draft: "Insights", record: "Record", targets: "Targets", career: "Career" };

const isHex = (hex) => /^#[0-9a-f]{6}$/i.test(hex || "");
const tint = (hex, alpha) => (/^#[0-9a-f]{6}$/i.test(hex || "") ? `${hex}${alpha}` : "transparent");
const alphaHex = (a) => Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0");

function SectionTitle({ children, color1, color2, right, isMobile }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <div style={{ fontWeight: 900, fontSize: isMobile ? 16 : 20, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.08em", color: color1 }}>
        {children}
      </div>
      <div style={{ flex: 1, height: 3, borderRadius: 2, background: `linear-gradient(to right, ${color2}, ${tint(color2, "00")})` }} />
      {right != null && !isMobile && <div style={{ fontSize: 11, fontWeight: 900, color: "#9aa5b4", whiteSpace: "nowrap" }}>{right}</div>}
    </div>
  );
}


// The page column is centered; the rail hangs in the left margin beside it
// when the window has room for both (else it sits beside the column, in
// flow, and below it on mobile).
const COLUMN_WIDTH = 1000;
const RAIL_WIDTH = 210;
const RAIL_GAP = 20;
const railFitsInMargin = () => viewportCssWidth() >= COLUMN_WIDTH + 2 * (RAIL_WIDTH + RAIL_GAP) + 32;

const card = { background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2" };

// Page titles — the Draft Insights one is the page's search title.
const TAB_TITLES = {
  draft: (n) => `${n} Draft Targets and Pick History`,
  record: (n) => `${n} Draft Record and Pick History`,
  targets: (n) => `${n} Draft Targets by Position`,
  career: (n) => `${n} Career Path`,
};

// Meta description for the draft tabs: the job, then as many of their top
// prospect fits (compSnapshots/_staffTargets) as fit in ~160 characters —
// so searches pairing the staffer with a prospect find the page.
const META_LENGTH = 160;
function targetsDescription(name, job, eligible, targets) {
  const lead = `${name}'s NFL draft targets and pick history as ${job}.`;
  const label = (t) => `${t.F} ${t.L} (${[t.S, t.P].filter(Boolean).join(" ")})`;
  for (let n = Math.min(3, targets.length); n > 0; n--) {
    const names = targets.slice(0, n).map(label);
    const list = n === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[n - 1]}`;
    const text = `${lead} Top ${eligible} prospect fits: ${list}.`;
    if (text.length <= META_LENGTH) return text;
  }
  return `${lead} Every pick by round, position and school, plus the ${eligible} prospects who fit.`;
}

export default function StaffPage() {
  const { slug, tab: tabParam } = useParams();
  const tab = TABS.some(([key]) => key !== "draft" && key === tabParam) ? tabParam : "draft";
  // Every current HC/GM, for the left rail — loaded once, not per person.
  const [allStaff, setAllStaff] = useState([]);
  const [person, setPerson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState({});
  const [picks, setPicks] = useState([]);
  const [picksLoading, setPicksLoading] = useState(true);
  // School logos for the pick lists, when the snapshot supplied them (null =
  // look them up live).
  const [pickLogos, setPickLogos] = useState(null);
  // Credit scopes shown — starts as the page's own job(s) (see pageScopes).
  const [scopes, setScopes] = useState([]);
  // Pick number → trade value (config/draftTradeChart, written by
  // scripts/importDraftTradeChart.mjs) — weights the "Most Valued" tile.
  const [tradeValues, setTradeValues] = useState(null);
  // Top prospect fits — compSnapshots/_staffTargets (see buildStaffTargets
  // in utils/draftProfiles.js): { eligible, rows: { [coachId]: [...] } }.
  const [targetsDoc, setTargetsDoc] = useState(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [railInMargin, setRailInMargin] = useState(() => typeof window !== "undefined" && railFitsInMargin());

  useEffect(() => {
    const handler = () => { setIsMobile(window.innerWidth < 768); setRailInMargin(railFitsInMargin()); };
    window.addEventListener("resize", handler);
    window.addEventListener("pagezoomchange", handler);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("pagezoomchange", handler);
    };
  }, []);

  useEffect(() => {
    fetchCurrentStaff().then(setAllStaff).catch((e) => console.error("Staff rail load error:", e));
  }, []);

  useEffect(() => {
    getSiteSnapshot("_staffTargets").then((snap) => setTargetsDoc(snap || { rows: {} }));
  }, []);

  useEffect(() => {
    getDoc(doc(db, "config", "draftTradeChart"))
      .then((snap) => setTradeValues(snap.exists() ? snap.data().values || {} : {}))
      .catch((e) => { console.error("Trade chart load error:", e); setTradeValues({}); });
  }, []);

  // Person + every team's branding (the tenure list and draft rows show each
  // team's logo) — branding from the shared _nflBranding snapshot.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getDoc(doc(db, "coaches", slug)), fetchNflBranding()])
      .then(([snap, branding]) => {
        if (cancelled) return;
        const data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
        setPerson(data);
        setScopes(pageScopes(data));
        setTeams(branding);
      })
      .catch((e) => { console.error("Staff page load error:", e); if (!cancelled) setPerson(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  const credits = useMemo(
    () => (person ? draftCredits(person.Stints, FIRST_DRAFT_YEAR, DRAFT_ORDER_YEAR) : []),
    [person]
  );

  // Every pick they're credited with under any scope, so flipping a scope
  // toggle is instant — filtering happens below. One read normally
  // (staffPicks_{id}, which also carries the lists' school logos).
  useEffect(() => {
    if (!person) return;
    let cancelled = false;
    setPicksLoading(true);
    (async () => {
      try {
        const { rows, schoolLogos: logos } = await fetchStaffPickRows(person.id, credits);
        if (!cancelled) { setPicks(rows); setPickLogos(logos); }
      } catch (e) {
        console.error("Staff draft history error:", e);
        if (!cancelled) setPicks([]);
      } finally {
        if (!cancelled) setPicksLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [person, credits]);

  const credited = useMemo(() => picks
    .map((p) => ({ ...p, credit: creditForPick(credits, scopes, p.team, p.year, p.position) }))
    .filter((p) => p.credit)
    .sort((a, b) => b.year - a.year || (a.pick ?? 999) - (b.pick ?? 999)), [picks, credits, scopes]);

  // The Targets tab used to be /players (Player Info) — send old links on.
  if (tabParam === "players") return <Navigate replace to={`/staff/${slug}/targets`} />;
  if (loading && !person) return <LoadingSpinner label="Loading" size={56} minHeight="calc(60vh / var(--pz, 1))" />;

  const currentJobs = (person?.Current || []).filter((c) => PAGE_ROLES.includes(c.Role));
  if (!person || !currentJobs.length) {
    return <div style={{ textAlign: "center", marginTop: 80, color: "red", fontWeight: 900, fontFamily: "'Arial Black', Arial, sans-serif" }}>Staff page not found</div>;
  }

  const homeAbbr = currentJobs[0].Team;
  const home = teams[homeAbbr] || {};
  const c1 = home.Color1 || BLUE;
  const c2 = home.Color2 || GOLD;
  const homeName = NFL_TEAMS[homeAbbr] || homeAbbr;
  const roleLabel = [...new Set(currentJobs.map((c) => ROLE_BY_KEY[c.Role]?.label || c.Role))].join(" & ");
  const pageUrl = `https://we-draft.com/staff/${person.id}${TAB_SUFFIX[tab]}`;
  const targets = targetsDoc?.rows?.[person.id] || [];
  const targetsYear = targetsDoc?.eligible || "2027";
  const job = `${roleLabel.toLowerCase()} of the ${homeName}`;
  const metaDescription = tab === "career"
    ? `${person.Name}'s coaching and front office career — every stop before becoming ${job}.`
    : tab === "record"
      ? `${person.Name}'s NFL draft record and pick history — every pick as ${job} and before.`
      : targets.length
        ? targetsDescription(person.Name, job, targetsYear, targets)
        : `${person.Name}'s NFL draft targets and pick history as ${job} — every pick by round, position and school.`;
  const pageTitle = TAB_TITLES[tab](person.Name);
  const railRole = currentJobs.some((c) => c.Role === "GM") && !currentJobs.some((c) => c.Role === "HC" || c.Role === "IHC") ? "gm" : "hc";

  const defaults = pageScopes(person);
  const available = Object.keys(CREDIT_SCOPES).filter((k) => defaults.includes(k) || credits.some((c) => c.scope === k));
  const toggleScope = (k) => setScopes((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  // Tenures shown — the credits in the enabled scopes, merged per team+role.
  const tenures = credits
    .filter((c) => scopes.includes(c.scope))
    .sort((a, b) => b.first - a.first)
    .map((c) => ({ ...c, count: credited.filter((p) => p.credit === c).length }))
    // A second hat on the same job (GM + EXEC) never wins a pick — drop it.
    .filter((c) => c.count || defaults.includes(c.scope));

  return (
    <>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={pageUrl} />
        <meta property="og:type" content="profile" />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:site_name" content="We-Draft.com" />
      </Helmet>

      <div style={railInMargin && !isMobile ? {
        position: "relative", maxWidth: COLUMN_WIDTH, margin: "0 auto", padding: "24px 0 60px", fontFamily: "'Arial Black', Arial, sans-serif",
      } : {
        maxWidth: COLUMN_WIDTH + RAIL_WIDTH + RAIL_GAP + 48, margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 24px 60px", fontFamily: "'Arial Black', Arial, sans-serif",
        display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : `${RAIL_WIDTH}px minmax(0, 1fr)`, gap: isMobile ? 28 : RAIL_GAP, alignItems: "start",
      }}>
        {/* In the margin: a full-height strip off the column's left edge, so
            the rail's sticky positioning has the whole page to travel. */}
        {/* The right margin: the draft order, as much as fits, the
            person's team highlighted. */}
        {!isMobile && railInMargin && (
          <div style={{ position: "absolute", top: 24, bottom: 60, left: `calc(100% + ${RAIL_GAP}px)`, width: RAIL_WIDTH }}>
            <DraftOrderRail currentTeam={homeAbbr} color1={c1} />
          </div>
        )}
        {!isMobile && (railInMargin ? (
          <div style={{ position: "absolute", top: 24, bottom: 60, right: `calc(100% + ${RAIL_GAP}px)`, width: RAIL_WIDTH }}>
            <StaffRail staff={allStaff} teams={teams} currentId={person.id} defaultRole={railRole} tab={tab} color1={c1} />
          </div>
        ) : (
          <StaffRail staff={allStaff} teams={teams} currentId={person.id} defaultRole={railRole} tab={tab} color1={c1} />
        ))}
        <div style={{ minWidth: 0 }}>
        {/* ===== HERO ===== */}
        <div style={{
          position: "relative", overflow: "hidden", borderRadius: 14, border: `2px solid ${c2}`, marginBottom: 20,
          boxShadow: "0 10px 28px rgba(0,0,0,0.22)",
          background: ["linear-gradient(rgba(0,0,0,0.38), rgba(0,0,0,0.38))", `linear-gradient(120deg, ${c1} 0%, ${c1} 40%, ${c2} 100%)`].join(", "),
          padding: isMobile ? "18px 16px" : "26px 30px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 14 : 24 }}>
            {(home.LogoDark || home.Logo1) && (
              <Link to={`/nfl/${homeAbbr.toLowerCase()}`} title={homeName} style={{ flexShrink: 0, display: "flex" }}>
                <img src={home.LogoDark || home.Logo1} alt={homeName}
                  style={{ width: isMobile ? 64 : 110, height: isMobile ? 64 : 110, objectFit: "contain", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.45))" }}
                  onError={(e) => { e.currentTarget.style.display = "none"; }} />
              </Link>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: isMobile ? 11 : 13, fontWeight: 900, color: "rgba(255,255,255,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {roleLabel} · {homeName}
              </div>
              <div style={{ fontSize: isMobile ? "clamp(26px, 8vw, 38px)" : "clamp(36px, 5vw, 58px)", fontWeight: 900, color: "#fff", lineHeight: 1.05, textTransform: "uppercase", letterSpacing: "0.02em", textShadow: "0 2px 8px rgba(0,0,0,0.4)", wordBreak: "break-word" }}>
                {person.Name}
              </div>
              <Link to={`/nfl/${homeAbbr.toLowerCase()}/staff`} style={{ display: "inline-block", marginTop: 8, color: "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: 700, textDecoration: "underline" }}>
                ← {homeName} staff
              </Link>
            </div>
            {/* Draft as their team in the Draft Sim, as on the team page. */}
            <DraftNowButton team={homeAbbr} teamName={homeName} c1={c1} c2={c2} isMobile={isMobile} />
          </div>
        </div>

        {/* ===== TABS ===== */}
        <div role="tablist" style={{ display: "flex", gap: isMobile ? 6 : 8, marginBottom: isMobile ? 16 : 20, borderBottom: `3px solid ${tint(c1, "1f")}` }}>
          {TABS.map(([key, label, suffix]) => {
            const active = tab === key;
            return (
              <Link
                key={key} role="tab" aria-selected={active} replace to={`/staff/${person.id}${suffix}`}
                style={{
                  flex: isMobile ? 1 : "0 0 auto", marginBottom: -3, textAlign: "center", textDecoration: "none",
                  padding: isMobile ? "10px 6px" : "11px 22px",
                  background: active ? c1 : "transparent", color: active ? textOn(c1, c2) : c1,
                  borderBottom: `3px solid ${active ? c2 : "transparent"}`, borderRadius: "8px 8px 0 0",
                  fontWeight: 900, fontSize: isMobile ? 11 : 13, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap",
                }}
              >
                {isMobile ? MOBILE_TAB_LABELS[key] : label}
              </Link>
            );
          })}
        </div>

        {tab === "career" ? (
          <CareerPath person={person} teams={teams} color1={c1} color2={c2} isMobile={isMobile} />
        ) : (<>
        {/* ===== SCOPE ===== */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 20 }}>
          <span style={{ fontSize: 11, fontWeight: 900, color: "#6b7685", letterSpacing: "0.08em", textTransform: "uppercase", marginRight: 4 }}>Picks made as</span>
          {available.map((k) => {
            const on = scopes.includes(k);
            const locked = defaults.includes(k);
            return (
              <button
                key={k} onClick={() => !locked && toggleScope(k)} aria-pressed={on} disabled={locked}
                style={{
                  border: `2px solid ${on ? c1 : tint(c1, "55")}`, borderRadius: 999, padding: "6px 14px",
                  background: on ? c1 : "#fff", color: on ? "#fff" : c1, cursor: locked ? "default" : "pointer",
                  fontFamily: "inherit", fontWeight: 900, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase",
                }}
              >
                {on && !locked ? "✓ " : !on ? "+ " : ""}{CREDIT_SCOPES[k].label}
              </button>
            );
          })}
          {scopes.includes("coordinator") && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "#9aa5b4", fontFamily: "Arial, sans-serif" }}>Coordinator years count picks on their side of the ball only.</span>
          )}
        </div>

        {picksLoading ? (
          <LoadingSpinner label="Loading draft picks" size={28} minHeight="200px" />
        ) : !credited.length ? (
          <div style={{ ...card, padding: 40, textAlign: "center", color: "#9aa5b4", fontStyle: "italic", fontSize: 14, fontFamily: "Arial, sans-serif" }}>
            No picks on file for these roles yet{available.length > 1 && scopes.length < available.length ? " — try adding another role above." : "."}
          </div>
        ) : tab === "record" ? (
          <DraftRecord key={person.id} picks={credited} teams={teams} defaults={defaults} logos={pickLogos} color1={c1} color2={c2} isMobile={isMobile} />
        ) : tab === "targets" ? (
          <PlayerInfo key={person.id} picks={credited} teams={teams} defaults={defaults} logos={pickLogos} color1={c1} color2={c2} isMobile={isMobile} />
        ) : (
          <>
            <SummaryTiles picks={credited} tradeValues={tradeValues} color1={c1} isMobile={isMobile} />
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.55fr) minmax(0, 1fr)", gap: 20, marginTop: 24, alignItems: "start" }}>
              <div>
                <SectionTitle color1={c1} color2={c2} isMobile={isMobile}>Position by Round</SectionTitle>
                <RoundMatrix picks={credited} color1={c1} isMobile={isMobile} />
              </div>
              <div>
                <SectionTitle color1={c1} color2={c2} isMobile={isMobile}>Tenures</SectionTitle>
                <div style={{ ...card, padding: "6px 14px" }}>
                  {tenures.map((t, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: i ? "1px solid #f0f2f5" : "none" }}>
                      {teams[t.team]?.Logo1 && (
                        <Link to={`/nfl/${t.team.toLowerCase()}`} title={NFL_TEAMS[t.team]} style={{ display: "flex", flexShrink: 0 }}>
                          <img src={teams[t.team].Logo1} alt={NFL_TEAMS[t.team]} style={{ width: 26, height: 26, objectFit: "contain" }} />
                        </Link>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: "#1a1f2b" }}>{NFL_TEAMS[t.team]}</div>
                        <div style={{ fontSize: 11, color: "#6b7685", fontFamily: "Arial, sans-serif" }}>
                          {ROLE_BY_KEY[t.role]?.label || t.role} · {t.first === t.last ? t.first : `${t.first}–${t.last}`} draft{t.first === t.last ? "" : "s"}
                        </div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 900, color: c1, fontVariantNumeric: "tabular-nums" }}>{t.count}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 20 }}>
                  <SectionTitle color1={c1} color2={c2} isMobile={isMobile}>Top Schools</SectionTitle>
                  <TopSchools picks={credited} color1={c1} />
                </div>
              </div>
            </div>
          </>
        )}

        </>)}

        {/* Draft targets in words — visible (text hidden from visitors is
            treated as spam by search engines), but parked at the bottom of
            the column in a quiet style so the layout doesn't change. Same
            approach as Comparison.js's "How … comparisons work" section.
            Names the staffer's top prospect fits (_staffTargets) so
            searches pairing the two find the page. */}
        {tab !== "career" && targets.length > 0 && (
          <section style={{ padding: "28px 6px 4px" }}>
            <h2 style={{ fontSize: 13, fontWeight: 900, color: "#5f6b7a", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 8px" }}>
              {person.Name}&apos;s {targetsYear} draft targets
            </h2>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#4a5466", lineHeight: 1.65, margin: 0, fontFamily: "Arial, sans-serif" }}>
              Based on the players {person.Name} has drafted as {job} and before, the {targetsYear} prospects who best fit
              {" "}{person.Name}&apos;s draft history are{" "}
              {targets.map((t, i) => (
                <Fragment key={t.i}>
                  {i > 0 && (i < targets.length - 1 ? ", " : targets.length === 2 ? " and " : ", and ")}
                  <Link to={`/player/${t.sl}`} style={{ color: "#1a1f2b", fontWeight: 800, textDecoration: "underline", textDecorationColor: "#c9d3e0", textUnderlineOffset: 3 }}>{t.F} {t.L}</Link>
                  {` (${[t.S, t.P].filter(Boolean).join(" ")})`}
                </Fragment>
              ))}
              . Fits compare each prospect&apos;s height, weight and community-graded traits with {person.Name}&apos;s picks at the position.
            </p>
            {tab !== "targets" && (
              <Link
                to={`/staff/${person.id}/targets`}
                style={{
                  display: "inline-block", marginTop: 12, padding: "8px 16px", borderRadius: 999, border: `2px solid ${c1}`,
                  color: c1, background: "#fff", textDecoration: "none", fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase",
                }}
              >
                View More →
              </Link>
            )}
          </section>
        )}
        </div>
        {isMobile && <StaffRail staff={allStaff} teams={teams} currentId={person.id} defaultRole={railRole} tab={tab} color1={c1} />}
      </div>
    </>
  );
}

// ── Left rail — the other current head coaches or GMs (toggle), one per
// team, alphabetical by team. Starts on whichever this person is; links keep
// the tab being viewed. Below the page on mobile. ──
function StaffRail({ staff, teams, currentId, defaultRole, tab, color1 }) {
  const [role, setRole] = useState(defaultRole);
  useEffect(() => { setRole(defaultRole); }, [defaultRole, currentId]);
  const roles = role === "gm" ? ["GM"] : ["HC", "IHC"];
  const rows = [];
  staff.forEach((p) => (p.Current || []).forEach((c) => {
    if (roles.includes(c.Role) && !rows.some((r) => r.person.id === p.id && r.team === c.Team)) rows.push({ person: p, team: c.Team, interim: c.Role === "IHC" });
  }));
  rows.sort((a, b) => (NFL_TEAMS[a.team] || "").localeCompare(NFL_TEAMS[b.team] || ""));

  return (
    <aside style={{ ...card, overflow: "hidden", position: "sticky", top: 16, maxHeight: "calc(100vh / var(--pz, 1) - 32px)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", padding: 6, gap: 4, background: "#f6f7f9", borderBottom: "1px solid #eef1f5" }}>
        {[["hc", "Head Coaches"], ["gm", "GMs"]].map(([key, label]) => (
          <button
            key={key} onClick={() => setRole(key)} aria-pressed={role === key}
            style={{
              flex: 1, border: "none", borderRadius: 7, padding: "7px 4px", cursor: "pointer", fontFamily: "inherit",
              background: role === key ? color1 : "transparent", color: role === key ? "#fff" : "#6b7685",
              fontWeight: 900, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ overflowY: "auto", padding: "4px 0" }}>
        {rows.map(({ person, team, interim }) => {
          const active = person.id === currentId;
          return (
            <Link
              key={`${person.id}-${team}`} to={`/staff/${person.id}${TAB_SUFFIX[tab]}`}
              style={{
                display: "flex", alignItems: "center", gap: 9, padding: "6px 10px", textDecoration: "none",
                background: active ? tint(color1, "14") : "transparent", borderLeft: `3px solid ${active ? color1 : "transparent"}`,
              }}
            >
              {teams[team]?.Logo1
                ? <img src={teams[team].Logo1} alt="" style={{ width: 24, height: 24, objectFit: "contain", flexShrink: 0 }} />
                : <span style={{ width: 24, flexShrink: 0, fontSize: 9, fontWeight: 900, color: "#9aa5b4" }}>{team}</span>}
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12, fontWeight: 900, color: active ? color1 : "#1a1f2b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{person.Name}</span>
                <span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#9aa5b4", fontFamily: "Arial, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {NFL_TEAMS[team] || team}{interim ? " · Interim" : ""}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}

// ── Headline numbers. "Most Valued" is the position the picks spent the
// most draft capital on — each pick weighted by the trade chart (picks past
// the chart's end get its last value). ──
function SummaryTiles({ picks, tradeValues, color1, isMobile }) {
  const drafts = new Set(picks.map((p) => p.year)).size;
  const chart = tradeValues || {};
  const floor = Math.min(...Object.values(chart).filter((v) => typeof v === "number"), Infinity);
  const valueOf = (pick) => (pick ? chart[pick] ?? (Number.isFinite(floor) ? floor : 0) : 0);
  const posValue = {};
  picks.forEach((p) => { if (p.position) posValue[p.position] = (posValue[p.position] || 0) + valueOf(p.pick); });
  const topPos = Object.entries(posValue).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];
  const totalValue = Object.values(posValue).reduce((a, v) => a + v, 0);
  // Earliest pick; the most recent draft wins a tie.
  const top = picks.filter((p) => p.pick).sort((a, b) => a.pick - b.pick || b.year - a.year)[0];
  const years = [...new Set(picks.map((p) => p.year))].sort((x, y) => x - y);
  const firsts = picks.filter((p) => p.round === 1).length;
  const perDraft = drafts ? Math.round((picks.length / drafts) * 10) / 10 : 0;
  // Every cell is label / value / detail, so the strip reads as one row.
  const cells = [
    { label: "Drafts", value: drafts, detail: years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0] },
    { label: "Picks", value: picks.length, detail: `${perDraft} per draft` },
    { label: "1st Rounders", value: firsts, detail: picks.length ? `${Math.round((firsts / picks.length) * 100)}% of picks` : "" },
    {
      label: "Most Valued", value: !tradeValues ? "…" : topPos ? topPos[0] : "–",
      detail: topPos && totalValue ? `${Math.round((topPos[1] / totalValue) * 100)}% of draft value` : "",
    },
    {
      label: "Highest Drafted", wide: true,
      value: !top ? "–" : top.slug
        ? <Link to={`/player/${top.slug}`} style={{ color: "inherit", textDecoration: "none" }}>{top.player}</Link>
        : top.player,
      detail: top ? `#${top.pick} overall · ${top.year}${top.position ? ` · ${top.position}` : ""}` : "",
    },
  ];
  // Mobile: a 6-column grid — counts three across, then the two feature cells.
  const span = (i) => (i < 4 ? 2 : 4);
  return (
    <div style={{ ...card, overflow: "hidden", borderTop: `3px solid ${color1}` }}>
      <div style={{
        display: "grid", gap: 1, background: "#eef1f5",
        gridTemplateColumns: isMobile ? "repeat(6, minmax(0, 1fr))" : "repeat(3, minmax(0, 0.8fr)) minmax(0, 1fr) minmax(0, 1.9fr)",
      }}>
        {cells.map((c, i) => (
          <div key={c.label} style={{ background: "#fff", padding: isMobile ? "12px 12px" : "16px 20px", minWidth: 0, gridColumn: isMobile ? `span ${span(i)}` : "auto" }}>
            <div style={{ fontSize: 10, fontWeight: 900, color: color1, letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{c.label}</div>
            <div style={{
              fontSize: isMobile ? 20 : 26, fontWeight: 900, color: "#1a1f2b", fontVariantNumeric: "tabular-nums", lineHeight: 1.15, marginTop: 6,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {c.value}
            </div>
            <div style={{ fontSize: isMobile ? 11 : 12, fontWeight: 700, color: "#5f6b7a", fontFamily: "Arial, sans-serif", marginTop: 5, paddingTop: 5, borderTop: `1px solid ${tint(color1, "1f")}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minHeight: 14 }}>
              {c.detail || " "}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Position × round heat table — one hue (the team color), light → dark
// by count; every cell carries its number, so color is never the only cue. ──
function RoundMatrix({ picks, color1, isMobile }) {
  const counts = {};
  picks.forEach((p) => {
    if (!p.round) return;
    counts[`${p.position}|${p.round}`] = (counts[`${p.position}|${p.round}`] || 0) + 1;
  });
  const rows = POSITIONS.filter((pos) => picks.some((p) => p.position === pos));
  const other = picks.filter((p) => !POSITIONS.includes(p.position));
  const max = Math.max(1, ...Object.values(counts));
  const rowTotal = (pos) => picks.filter((p) => p.position === pos).length;
  const colTotal = (r) => picks.filter((p) => p.round === r).length;
  const cellPad = isMobile ? "7px 2px" : "8px 4px";
  const th = { fontSize: 9, fontWeight: 900, color: "#9aa5b4", letterSpacing: "0.08em", textTransform: "uppercase", padding: cellPad, textAlign: "center" };

  return (
    <div style={{ ...card, padding: isMobile ? 8 : 12, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 2, fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Pos</th>
            {ROUNDS.map((r) => <th key={r} style={th}>{isMobile ? `R${r}` : `Rd ${r}`}</th>)}
            <th style={th}>Tot</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((pos) => (
            <tr key={pos}>
              <td style={{ fontSize: 11, fontWeight: 900, color: "#1a1f2b", padding: cellPad }}>{pos}</td>
              {ROUNDS.map((r) => {
                const n = counts[`${pos}|${r}`] || 0;
                const a = n ? 0.14 + 0.76 * (n / max) : 0;
                return (
                  <td
                    key={r} title={n ? `${n} ${pos} pick${n === 1 ? "" : "s"} in round ${r}` : `No ${pos} picks in round ${r}`}
                    style={{
                      textAlign: "center", padding: cellPad, borderRadius: 4, fontSize: 12, fontWeight: 900,
                      background: n ? `${color1}${alphaHex(a)}` : "#f6f7f9",
                      color: !n ? "#c8ced6" : a > 0.5 ? "#fff" : "#1a1f2b",
                    }}
                  >
                    {n || "·"}
                  </td>
                );
              })}
              <td style={{ textAlign: "center", fontSize: 12, fontWeight: 900, color: "#3a4352", padding: cellPad }}>{rowTotal(pos)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ fontSize: 9, fontWeight: 900, color: "#9aa5b4", letterSpacing: "0.08em", padding: cellPad }}>TOT</td>
            {ROUNDS.map((r) => <td key={r} style={{ textAlign: "center", fontSize: 12, fontWeight: 900, color: "#3a4352", padding: cellPad }}>{colTotal(r)}</td>)}
            <td style={{ textAlign: "center", fontSize: 12, fontWeight: 900, color: "#1a1f2b", padding: cellPad }}>{picks.length - other.length}</td>
          </tr>
        </tbody>
      </table>
      {/* Offense/defense split — a quick read on where the picks went. */}
      <SideSplit picks={picks} color1={color1} />
    </div>
  );
}

function SideSplit({ picks, color1 }) {
  const sides = ["Offense", "Defense", "Special Teams"]
    .map((side) => ({ side, n: picks.filter((p) => POSITION_SIDE[p.position] === side).length }))
    .filter((s) => s.n);
  const total = sides.reduce((a, s) => a + s.n, 0) || 1;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 10, padding: "0 4px", fontSize: 11, fontWeight: 700, color: "#6b7685", fontFamily: "Arial, sans-serif" }}>
      {sides.map((s) => (
        <span key={s.side}><b style={{ color: "#1a1f2b" }}>{s.side}</b> {s.n} ({Math.round((s.n / total) * 100)}%)</span>
      ))}
    </div>
  );
}

// ── Most-drafted colleges — a single-series bar list in the team color ──
function TopSchools({ picks, color1 }) {
  const counts = {};
  picks.forEach((p) => { if (p.school) counts[p.school] = (counts[p.school] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
  const max = top[0]?.[1] || 1;
  return (
    <div style={{ ...card, padding: "10px 14px" }}>
      {top.map(([school, n]) => (
        <div key={school} title={`${n} pick${n === 1 ? "" : "s"} from ${school}`} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 90px 24px", alignItems: "center", gap: 8, padding: "4px 0" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#1a1f2b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "Arial, sans-serif" }}>{school}</span>
          <span style={{ height: 8, background: "#f0f2f5", borderRadius: 4, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${(n / max) * 100}%`, background: color1, borderRadius: 4 }} />
          </span>
          <span style={{ fontSize: 12, fontWeight: 900, color: "#3a4352", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{n}</span>
        </div>
      ))}
    </div>
  );
}

// ── Draft Record — every credited pick in the same list as the NFL team
// page's Draft Archive (components/DraftArchiveList.jsx). A team logo sits
// under the year once the record spans more than one team, and picks
// credited outside the page's own job say which role they came from. Each
// row wears its drafting team's colors. ──
function DraftRecord({ picks, teams, defaults, logos, color1, color2, isMobile, title = "Draft Record" }) {
  // Logos come with the snapshot; looked up only on the live fallback.
  const lookedUp = useSchoolLogos(logos ? [] : picks.map((p) => p.school));
  const schoolLogos = logos || lookedUp;
  const multiTeam = new Set(picks.map((p) => p.team)).size > 1;
  const entries = picks.map((p) => ({
    key: p.key, year: p.year, round: p.round, pick: p.pick,
    playerName: p.player, position: p.position, school: p.school, slug: p.slug,
    teamLogo: multiTeam ? teams[p.team]?.Logo1 : null,
    color1: isHex(teams[p.team]?.Color1) ? teams[p.team].Color1 : null,
    color2: isHex(teams[p.team]?.Color2) ? teams[p.team].Color2 : null,
    note: defaults.includes(p.credit.scope) ? null : `as ${ROLE_BY_KEY[p.credit.role]?.label || p.credit.role}`,
  }));
  return (
    <div>
      <SectionTitle color1={color1} color2={color2} isMobile={isMobile}>{title}</SectionTitle>
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ background: color1, padding: "8px 16px" }}>
          <div style={{ color: textOn(color1, color2), fontWeight: 900, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {picks.length} Pick{picks.length !== 1 ? "s" : ""}
          </div>
        </div>
        <div style={{ height: 3, background: color2 }} />
        <DraftArchiveList archive={entries} schoolLogos={schoolLogos} isMobile={isMobile} color1={color1} color2={color2} />
      </div>
    </div>
  );
}

// ── Targets tab — one profile per position they've drafted: the
// traits their picks shared (Strengths = valued, Weaknesses = tolerated),
// the picks' average measurements (hover/tap for the percentile among every
// drafted player at the position, compSnapshots/pct_{Position}), the picks
// themselves, and on request the prospects who best fit the profile. ──
const PROSPECT_YEARS = ["2027", "2028", "2029"];
const PHYSICAL_KEYS = ["height", "weight", "arm", "hand"];
const ATHLETIC_KEYS = ["forty", "vertical", "broad", "threeCone", "shuttle", "bench"];
const SHORT_LABEL = { height: "Height", weight: "Weight", arm: "Arm", hand: "Hand", forty: "40 Yd", vertical: "Vert", broad: "Broad", threeCone: "3-Cone", shuttle: "Shuttle", bench: "Bench" };
// The profile keeps every trait (the match uses MATCH_TRAITS of them, see
// utils/draftProfiles.js); the lists show only the top few.
const TRAITS_SHOWN = 3;
const MATCH_LIMIT = 5;

const ordinal = (n) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");

// An average, so rounded to read cleanly: nearest inch, except arm and hand
// to the nearest quarter. Percentiles still use the unrounded average.
const QUARTERS = ["", " 1/4", " 1/2", " 3/4"];
function formatAverage(metric, v) {
  if (metric.format === "height" || metric.format === "feetInches") {
    const t = Math.round(v);
    return `${Math.floor(t / 12)}'${t % 12}"`;
  }
  if (metric.format === "inches") {
    const q = Math.round(v * 4);
    return `${Math.floor(q / 4)}${QUARTERS[q % 4]}"`;
  }
  if (metric.suffix) return `${Math.round(v)}${metric.suffix}`;
  return metric.decimals === 0 ? String(Math.round(v)) : v.toFixed(metric.decimals ?? 1);
}

function PlayerInfo({ picks, teams, defaults, logos, color1, color2, isMobile }) {
  const positions = useMemo(() => {
    const counts = {};
    picks.forEach((p) => { if (p.position && !PROFILE_SKIP.includes(p.position)) counts[p.position] = (counts[p.position] || 0) + 1; });
    const order = (pos) => (POSITIONS.includes(pos) ? POSITIONS.indexOf(pos) : POSITIONS.length);
    return Object.entries(counts).sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
  }, [picks]);
  // Starts on QB — or, if they've never drafted one, the position they've
  // drafted most.
  const [position, setPosition] = useState("QB");
  const pos = positions.some(([p]) => p === position) ? position
    : positions.length ? [...positions].sort((a, b) => b[1] - a[1])[0][0] : null;
  const posPicks = useMemo(() => picks.filter((p) => p.position === pos), [picks, pos]);

  const [pctTables, setPctTables] = useState(null);
  useEffect(() => {
    if (!pos) return;
    let cancelled = false;
    setPctTables(null);
    fetchPctTables(pos).then((t) => { if (!cancelled) setPctTables(t); });
    return () => { cancelled = true; };
  }, [pos]);

  // The latest class's community traits are already on each pick's rec
  // (see fetchStaffPickRows), so no community lookup here.
  const profile = useMemo(() => buildProfile(posPicks, {}, DRAFT_ORDER_YEAR), [posPicks]);

  if (!pos) return null;
  const plural = `${pos}s`;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
        {positions.map(([p, n]) => {
          const on = p === pos;
          return (
            <button
              key={p} onClick={() => setPosition(p)} aria-pressed={on}
              style={{
                border: `2px solid ${on ? color1 : tint(color1, "33")}`, borderRadius: 8, padding: isMobile ? "6px 10px" : "7px 14px",
                background: on ? color1 : "#fff", color: on ? "#fff" : color1, cursor: "pointer",
                fontFamily: "inherit", fontWeight: 900, fontSize: 12, letterSpacing: "0.04em",
              }}
            >
              {p} <span style={{ opacity: 0.7, fontSize: 11 }}>{n}</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20 }}>
        <TraitList
          title="Traits Valued" rows={profile.strengths} graded={profile.graded} plural={plural} color1={color1} color2={color2} isMobile={isMobile}
          blurb={`Strengths that show up most in the ${plural} they've drafted.`}
        />
        <TraitList
          title="Traits Not Valued" rows={profile.weaknesses} graded={profile.graded} plural={plural} color1={color1} color2={color2} isMobile={isMobile}
          blurb={`Weaknesses they've most often been willing to live with.`}
        />
      </div>

      <div style={{ marginTop: 24 }}>
        <SectionTitle color1={color1} color2={color2} isMobile={isMobile} right="Hover for percentile">Average Measurements</SectionTitle>
        <AverageMeasurements averages={profile.averages} pctTables={pctTables} total={posPicks.length} pos={pos} color1={color1} isMobile={isMobile} />
      </div>

      <div style={{ marginTop: 24 }}>
        <ProspectMatches key={pos} position={pos} profile={profile} pctTables={pctTables} color1={color1} color2={color2} isMobile={isMobile} />
      </div>

      <div style={{ marginTop: 24 }}>
        <DraftRecord picks={posPicks} teams={teams} defaults={defaults} logos={logos} color1={color1} color2={color2} isMobile={isMobile} title={`${pos} Picks`} />
      </div>
    </div>
  );
}

function TraitList({ title, blurb, rows, graded, plural, color1, color2, isMobile }) {
  const shown = rows.slice(0, TRAITS_SHOWN);
  return (
    <div>
      <SectionTitle color1={color1} color2={color2} isMobile={isMobile} right={graded ? `${graded} graded` : null}>{title}</SectionTitle>
      <div style={{ ...card, padding: isMobile ? "12px 14px" : "14px 18px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#5f6b7a", fontFamily: "Arial, sans-serif", lineHeight: 1.4, paddingBottom: 10, marginBottom: 4, borderBottom: "1px solid #f0f2f5" }}>
          {blurb}
        </div>
        {!shown.length ? (
          <div style={{ padding: "10px 0", color: "#9aa5b4", fontStyle: "italic", fontSize: 13, fontFamily: "Arial, sans-serif" }}>
            No graded {plural} yet.
          </div>
        ) : shown.map(([trait, n]) => (
          <div key={trait} title={`${n} of ${graded} graded ${plural}`} style={{ padding: "9px 0" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: isMobile ? 15 : 17, fontWeight: 900, color: "#1a1f2b", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{trait}</span>
              <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 900, color: "#3a4352", fontVariantNumeric: "tabular-nums" }}>
                {n} of {graded}
              </span>
            </div>
            <div style={{ height: 10, background: "#f0f2f5", borderRadius: 5, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(n / graded) * 100}%`, background: color1, borderRadius: 5 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Pills in the player page's style: hover (tap on touch) fills the pill and
// swaps the value for its percentile.
function AverageMeasurements({ averages, pctTables, total, pos, color1, isMobile }) {
  const [active, setActive] = useState(null);
  const pointer = useRef("mouse");
  const group = (label, keys) => {
    const shown = keys.filter((k) => averages[k]);
    if (!shown.length) return null;
    return (
      <div>
        <div style={{ fontSize: 10, fontWeight: 900, color: "#6b7685", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {shown.map((k) => {
            const m = STAT_METRICS.find((x) => x.key === k);
            const { value, n } = averages[k];
            const pct = percentileFromTable(value, pctTables?.[k], m.lowerIsBetter);
            const rounded = pct == null ? null : Math.min(99, Math.max(1, Math.round(pct)));
            const on = active === k && rounded != null;
            return (
              <div
                key={k}
                onPointerDown={(e) => { pointer.current = e.pointerType; }}
                onPointerEnter={(e) => { if (e.pointerType === "mouse" && rounded != null) setActive(k); }}
                onPointerLeave={(e) => { if (e.pointerType === "mouse") setActive((c) => (c === k ? null : c)); }}
                onClick={() => { if (pointer.current !== "mouse" && rounded != null) setActive((c) => (c === k ? null : k)); }}
                title={`Average of ${n} pick${n === 1 ? "" : "s"}${rounded == null ? "" : ` · ${rounded}${ordinal(rounded)} percentile among drafted ${pos}s`}`}
                style={{
                  display: "inline-flex", alignItems: "baseline", gap: 6, cursor: "default",
                  background: on ? color1 : "#fff", border: `2px solid ${color1}`, borderRadius: 8,
                  padding: isMobile ? "3px 8px" : "4px 12px", transition: "background 0.2s ease",
                }}
              >
                <span style={{ display: "grid", fontSize: isMobile ? 13 : 16, fontWeight: 900, lineHeight: 1.1, justifyItems: "center", fontVariantNumeric: "tabular-nums" }}>
                  <span style={{ gridArea: "1 / 1", color: color1, visibility: on ? "hidden" : "visible" }}>{formatAverage(m, value)}</span>
                  {rounded != null && <span style={{ gridArea: "1 / 1", color: "#fff", visibility: on ? "visible" : "hidden" }} aria-hidden={!on}>{rounded}%</span>}
                </span>
                <span style={{ fontSize: isMobile ? 9 : 11, fontWeight: 800, color: on ? "rgba(255,255,255,0.8)" : "#888", letterSpacing: "0.08em", textTransform: "uppercase" }}>{SHORT_LABEL[k]}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  const physical = group("Physical", PHYSICAL_KEYS);
  const athletic = group("Athletic", ATHLETIC_KEYS);
  return (
    <div style={{ ...card, padding: isMobile ? 14 : "16px 20px", display: "grid", gap: 16 }}>
      {physical || athletic ? <>{physical}{athletic}</> : (
        <div style={{ color: "#9aa5b4", fontStyle: "italic", fontSize: 13, fontFamily: "Arial, sans-serif" }}>No measurements on file for these {pos}s.</div>
      )}
      <div style={{ fontSize: 11, fontWeight: 700, color: "#5f6b7a", fontFamily: "Arial, sans-serif" }}>
        Averages across their {total} {pos} pick{total === 1 ? "" : "s"}; percentiles rank each average among every drafted {pos}.
      </div>
    </div>
  );
}

// Prospects scored against the profile (scoreProspects in
// utils/draftProfiles.js — height, weight and traits). 2027 loads with the
// tab; other classes join when toggled on.
function ProspectMatches({ position, profile, pctTables, color1, color2, isMobile }) {
  const [years, setYears] = useState(["2027"]);
  const [loaded, setLoaded] = useState({ status: "loading", prospects: [] });
  // At least one class stays on.
  const toggleYear = (y) => setYears((prev) => (prev.includes(y) ? (prev.length > 1 ? prev.filter((x) => x !== y) : prev) : [...prev, y].sort()));

  useEffect(() => {
    let cancelled = false;
    setLoaded((prev) => ({ ...prev, status: "loading" }));
    Promise.all(years.map((y) => fetchProspects(y, position)))
      .then((lists) => { if (!cancelled) setLoaded({ status: "done", prospects: lists.flat() }); })
      .catch((e) => { console.error("Prospect match error:", e); if (!cancelled) setLoaded({ status: "error", prospects: [] }); });
    return () => { cancelled = true; };
  }, [years, position]);

  const results = useMemo(() => {
    if (loaded.status !== "done" || !pctTables) return [];
    return scoreProspects(profile, loaded.prospects, pctTables, position, { limit: MATCH_LIMIT });
  }, [loaded, pctTables, profile, position]);
  const status = loaded.status === "done" && !pctTables ? "loading" : loaded.status;
  // Logos ride on the prospects snapshot; looked up only on the live fallback.
  const lookedUp = useSchoolLogos(results.filter((r) => !r.record.logo).map((r) => r.record.School));
  const schoolLogos = { ...lookedUp, ...Object.fromEntries(results.filter((r) => r.record.logo).map((r) => [r.record.School, r.record.logo])) };

  const chip = (on) => ({
    border: `2px solid ${on ? color1 : tint(color1, "33")}`, borderRadius: 999, padding: "5px 12px",
    background: on ? tint(color1, "14") : "#fff", color: color1, cursor: "pointer",
    fontFamily: "inherit", fontWeight: 900, fontSize: 11, letterSpacing: "0.05em",
  });

  return (
    <div>
      <SectionTitle color1={color1} color2={color2} isMobile={isMobile}>Prospect Matches</SectionTitle>
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: isMobile ? "12px 14px" : "14px 20px", borderBottom: "1px solid #eef1f5" }}>
          <span style={{ fontSize: 11, fontWeight: 900, color: "#6b7685", letterSpacing: "0.08em", textTransform: "uppercase", marginRight: 4 }}>Classes</span>
          {PROSPECT_YEARS.map((y) => (
            <button key={y} onClick={() => toggleYear(y)} aria-pressed={years.includes(y)} style={chip(years.includes(y))}>
              {years.includes(y) ? "✓ " : "+ "}{y}
            </button>
          ))}
        </div>
        {status === "loading" && <LoadingSpinner label="Finding matches" size={24} minHeight="120px" />}
        {status === "error" && <div style={{ padding: 20, color: "#b42318", fontSize: 13, fontFamily: "Arial, sans-serif" }}>Couldn't load prospects — try again.</div>}
        {status === "done" && !results.length && (
          <div style={{ padding: 20, color: "#9aa5b4", fontStyle: "italic", fontSize: 13, fontFamily: "Arial, sans-serif" }}>No {position} prospects with enough data to match yet.</div>
        )}
        {status === "done" && results.map(({ record: p, similarity, traits }, i) => {
          const shared = traits ? [...traits.sharedStrengths, ...traits.sharedWeaknesses] : [];
          return (
            <Link
              key={p.id} to={`/player/${p.Slug}`}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: isMobile ? "10px 14px" : "10px 20px", borderTop: i ? "1px solid #f0f2f5" : "none", textDecoration: "none" }}
            >
              <span style={{ width: 18, flexShrink: 0, fontSize: 12, fontWeight: 900, color: "#9aa5b4", fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
              <span title={p.School} style={{ flexShrink: 0, width: isMobile ? 34 : 40, height: isMobile ? 34 : 40, borderRadius: 6, background: "#f5f6f8", display: "flex", alignItems: "center", justifyContent: "center", padding: 4, boxSizing: "border-box" }}>
                {schoolLogos[p.School] && <img src={schoolLogos[p.School]} alt={p.School} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: isMobile ? 16 : 19, fontWeight: 900, color: "#1a1f2b", textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {`${p.First || ""} ${p.Last || ""}`.trim()}
                </span>
                <span style={{ display: "block", marginTop: 2, fontSize: 11, fontWeight: 700, color: "#5f6b7a", fontFamily: "Arial, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {[p.Eligible, ...shared].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span style={{ flexShrink: 0, textAlign: "right" }}>
                <span style={{ display: "block", fontSize: 16, fontWeight: 900, color: color1, fontVariantNumeric: "tabular-nums" }}>{Math.round(fitScore(similarity))}</span>
                <span style={{ display: "block", fontSize: 9, fontWeight: 900, color: "#9aa5b4", letterSpacing: "0.1em", textTransform: "uppercase" }}>Fit</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ── Career Path tab — every stop, newest first, one block per
// uninterrupted run with an organization (groupStints): logo, name, level,
// span, then each job held there. NFL head coach / coordinator / GM jobs are
// bold; playing days are tagged PLAYER, with their notes (draft slot,
// honors) shown. Each stop wears its own organization's colors — the NFL
// team's, or schools/{name}'s for a college (neutral when neither has any);
// a current stop's marker fills with that color and its dark logo. The
// summary tiles count the coaching/front office career only. ──
const KEY_ROLES = ["HC", "IHC", "GM", "OC", "DC"];
const LEVEL_LABEL = { NFL: "NFL", College: "College", Other: "Other" };
const NEUTRAL = "#5f6b7a";

function CareerPath({ person, teams, color1, color2, isMobile }) {
  const groups = useMemo(() => groupStints([...(person.Stints || [])].reverse()), [person]);
  // First stop that's only playing days — the "Playing Career" divider
  // goes above it.
  const playStart = groups.findIndex((g) => g.stints.every(isPlayerStint));
  const schools = useSchools(groups.filter((g) => g.stints[0].Level === "College").map((g) => g.org));

  const stints = (person.Stints || []).filter((s) => !isPlayerStint(s));
  const firstYear = Math.min(...stints.map((s) => s.StartYear).filter(Boolean));
  // Through this year when they're still working, else their last listed year.
  const lastYear = stints.some(isOpenStint) ? new Date().getFullYear() : Math.max(...stints.map((s) => s.EndYear || s.StartYear).filter(Boolean));
  const yearsActive = Number.isFinite(firstYear) && Number.isFinite(lastYear) ? lastYear - firstYear + 1 : null;
  const nflTeams = new Set(stints.filter((s) => s.Level === "NFL" && s.Team).map((s) => s.Team)).size;
  const careerGroups = groups.filter((g) => g.stints.some((s) => !isPlayerStint(s)));
  const hcJobs = careerGroups.filter((g) => g.stints.some((s) => s.Level === "NFL" && s.Roles?.some((r) => r === "HC" || r === "IHC"))).length;
  const facts = [
    ["Stops", careerGroups.length],
    ["NFL Teams", nflTeams],
    ["NFL HC Jobs", hcJobs],
    ["Years Active", yearsActive ?? "–"],
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 8 : 12, marginBottom: 12 }}>
        {facts.map(([label, value]) => (
          <div key={label} style={{ ...card, padding: isMobile ? "10px 6px" : "14px 10px", textAlign: "center" }}>
            <div style={{ fontSize: isMobile ? 20 : 26, fontWeight: 900, color: "#1a1f2b", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{value}</div>
            <div style={{ fontSize: 9, fontWeight: 900, color: color1, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>
      {person.College && (
        <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7685", fontFamily: "Arial, sans-serif", margin: "0 0 18px 2px" }}>
          <span style={{ fontSize: 9, fontWeight: 900, color: color1, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'Arial Black', Arial, sans-serif", marginRight: 8 }}>College</span>
          {person.College}
        </div>
      )}

      <div style={{ position: "relative" }}>
        {/* the rail the stop markers sit on */}
        <div aria-hidden="true" style={{ position: "absolute", left: isMobile ? 21 : 27, top: 10, bottom: 10, width: 3, borderRadius: 2, background: `linear-gradient(${color1}, ${tint(color2, "55")})` }} />
        {groups.map((g, gi) => {
          const level = g.stints[0].Level;
          const team = level === "NFL" ? g.stints[0].Team : null;
          const brand = team ? teams[team] : level === "College" ? schools[g.org] : null;
          const current = g.stints.some(isOpenStint);
          const gc1 = isHex(brand?.Color1) ? brand.Color1 : NEUTRAL;
          const gc2 = isHex(brand?.Color2) ? brand.Color2 : "#e6ebf2";
          // Filled marker for a current stop — needs the dark-background logo.
          const filled = current && isHex(brand?.Color1);
          const logo = filled ? brand.LogoDark || brand.Logo1 : brand?.Logo1;
          const size = isMobile ? 44 : 56;
          return (
            <Fragment key={gi}>
            {gi === playStart && (
              // Sits on the rail: the pill's white ring breaks the line.
              <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 10, margin: "6px 0 16px" }}>
                <span style={{
                  marginLeft: isMobile ? 0 : 4, fontSize: 10, fontWeight: 900, color: "#fff", background: "#7a8594",
                  boxShadow: "0 0 0 4px #fff", borderRadius: 999, padding: "4px 12px", letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap",
                }}>
                  Playing Career
                </span>
                <span style={{ flex: 1, height: 2, borderRadius: 1, background: "#dfe4ea" }} />
              </div>
            )}
            <div style={{ position: "relative", display: "flex", gap: isMobile ? 12 : 18, marginBottom: 14 }}>
              {(() => {
                const marker = (
                <div style={{
                  position: "relative", zIndex: 1, flexShrink: 0, width: size, height: size, borderRadius: "50%", background: filled ? gc1 : "#fff",
                  boxShadow: `0 0 0 3px ${filled ? gc2 : current ? gc1 : "#e6ebf2"}, 0 2px 6px rgba(0,0,0,0.08)`,
                  display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                }}>
                  {logo
                    ? <img src={logo} alt="" style={{ width: "72%", height: "72%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    : <span style={{ fontSize: isMobile ? 11 : 13, fontWeight: 900, color: filled ? "#fff" : "#9aa5b4" }}>{(team || g.org || "?").replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase()}</span>}
                </div>
                );
                // An NFL stop's marker links to that team's page.
                return team
                  ? <Link to={`/nfl/${team.toLowerCase()}`} title={NFL_TEAMS[team] || g.org} style={{ position: "relative", zIndex: 1, flexShrink: 0, display: "flex", alignSelf: "flex-start", borderRadius: "50%" }}>{marker}</Link>
                  : marker;
              })()}
              <div style={{ ...card, flex: 1, minWidth: 0, padding: isMobile ? "10px 12px" : "12px 18px", boxShadow: current ? `0 1px 3px rgba(0,0,0,0.07), 0 0 0 1.5px ${gc1}` : card.boxShadow }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: isMobile ? 15 : 18, fontWeight: 900, color: "#1a1f2b", textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.2 }}>{g.org}</span>
                    <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 900, color: brand ? "#fff" : "#6b7685", background: brand ? gc1 : "#eef1f5", borderRadius: 4, padding: "2px 6px", letterSpacing: "0.06em" }}>
                      {LEVEL_LABEL[level] || level}
                    </span>
                  </div>
                  {g.span && <span style={{ fontSize: 12, fontWeight: 900, color: current ? gc1 : "#9aa5b4", fontVariantNumeric: "tabular-nums" }}>{g.span}</span>}
                </div>
                <div style={{ marginTop: 6 }}>
                  {g.stints.map((s, i) => {
                    const key = s.Level === "NFL" && s.Roles?.some((r) => KEY_ROLES.includes(r));
                    return (
                      <div key={i} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "4px 0", borderTop: i ? "1px solid #f3f5f8" : "none" }}>
                        <span style={{ flexShrink: 0, width: isMobile ? 92 : 110, fontSize: 11, fontWeight: 900, color: isOpenStint(s) ? gc1 : "#9aa5b4", fontVariantNumeric: "tabular-nums" }}>{stintYearSpan(s)}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontFamily: "Arial, sans-serif", lineHeight: 1.4, fontWeight: key ? 700 : 400, color: key ? "#1a1f2b" : "#4a5466" }}>
                          {isPlayerStint(s) && <span style={{ marginRight: 6, fontSize: 9, fontWeight: 900, color: "#fff", background: "#7a8594", borderRadius: 4, padding: "1px 5px", letterSpacing: "0.06em", fontFamily: "'Arial Black', Arial, sans-serif", verticalAlign: "1px" }}>PLAYER</span>}
                          {s.Title || (s.Roles || []).map((r) => ROLE_BY_KEY[r]?.label || r).join(" / ")}
                          {isPlayerStint(s) && s.Notes && <span style={{ display: "block", fontSize: 11, color: "#7a8594", fontWeight: 400 }}>{s.Notes}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
