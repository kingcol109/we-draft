import { useParams, Link } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { Helmet } from "react-helmet-async";
import { db } from "../firebase";
import LoadingSpinner from "../components/LoadingSpinner";
import DraftArchiveList, { useSchoolLogos } from "../components/DraftArchiveList";
import { viewportCssWidth } from "../utils/pageZoom";
import {
  ROLE_BY_KEY, NFL_TEAMS, CREDIT_SCOPES, POSITION_SIDE,
  draftCredits, creditForPick, stintYearSpan, groupStints, isOpenStint,
} from "../utils/coachHistory";

// ── /staff/{slug} — a current head coach's or GM's draft history ──
// Every pick their team made while they held a creditable job there (see
// draftCredits/creditForPick in utils/coachHistory.js), from the
// "historical" collection (2000 → last year) plus draftOrder's just-finished
// draft. Default view is the years in their current job (HC or GM); other roles
// can be switched on. A second tab (/staff/{slug}/career) lays
// out their whole career, and the left rail links to the other current head
// coaches or GMs.

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
// draftOrder holds this draft; "historical" holds everything before it —
// same split NFLTeamPage.jsx's Draft Archive uses.
const DRAFT_ORDER_YEAR = 2026;
const FIRST_DRAFT_YEAR = 2000;
const PAGE_ROLES = ["HC", "IHC", "GM"];
const POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB", "K", "P", "LS"];
const ROUNDS = [1, 2, 3, 4, 5, 6, 7];

const tint = (hex, alpha) => (/^#[0-9a-f]{6}$/i.test(hex || "") ? `${hex}${alpha}` : "transparent");
const alphaHex = (a) => Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0");
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

function SectionTitle({ children, color1, color2, right, isMobile }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <div style={{ fontWeight: 900, fontSize: isMobile ? 16 : 20, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.08em", color: color1 }}>
        {children}
      </div>
      <div style={{ flex: 1, height: 3, borderRadius: 2, background: `linear-gradient(to right, ${color2}, ${tint(color2, "00")})` }} />
      {right != null && <div style={{ fontSize: 11, fontWeight: 900, color: "#9aa5b4", whiteSpace: "nowrap" }}>{right}</div>}
    </div>
  );
}

// The credit scope(s) of the job(s) a page is for: "hc" for a head coach
// (interim included), "gm" for a GM, both for someone holding both.
const pageScopes = (person) => [...new Set((person?.Current || [])
  .map((c) => (c.Role === "GM" ? "gm" : c.Role === "HC" || c.Role === "IHC" ? "hc" : null))
  .filter(Boolean))];

// The page column is centered; the rail hangs in the left margin beside it
// when the window has room for both (else it sits beside the column, in
// flow, and below it on mobile).
const COLUMN_WIDTH = 1000;
const RAIL_WIDTH = 210;
const RAIL_GAP = 20;
const railFitsInMargin = () => viewportCssWidth() >= COLUMN_WIDTH + 2 * (RAIL_WIDTH + RAIL_GAP) + 32;

const card = { background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2" };

export default function StaffPage() {
  const { slug, tab: tabParam } = useParams();
  const tab = tabParam === "career" ? "career" : "draft";
  // Every current HC/GM, for the left rail — loaded once, not per person.
  const [allStaff, setAllStaff] = useState([]);
  const [person, setPerson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState({});
  const [picks, setPicks] = useState([]);
  const [picksLoading, setPicksLoading] = useState(true);
  // Credit scopes shown — starts as the page's own job(s) (see pageScopes).
  const [scopes, setScopes] = useState([]);
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
    getDocs(query(collection(db, "coaches"), where("Status", "==", "current")))
      .then((snap) => setAllStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((e) => console.error("Staff rail load error:", e));
  }, []);

  // Person + every team's branding (32 small docs — the tenure list and
  // draft rows show each team's logo).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getDoc(doc(db, "coaches", slug)), getDocs(collection(db, "nfl"))])
      .then(([snap, nflSnap]) => {
        if (cancelled) return;
        const data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
        setPerson(data);
        setScopes(pageScopes(data));
        const t = {};
        nflSnap.docs.forEach((d) => { t[d.id] = d.data(); });
        setTeams(t);
      })
      .catch((e) => { console.error("Staff page load error:", e); if (!cancelled) setPerson(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  const credits = useMemo(
    () => (person ? draftCredits(person.Stints, FIRST_DRAFT_YEAR, DRAFT_ORDER_YEAR) : []),
    [person]
  );

  // Every pick by every team they were ever credited with (any scope), so
  // flipping a scope toggle is instant — filtering happens below.
  useEffect(() => {
    if (!person) return;
    let cancelled = false;
    const abbrs = [...new Set(credits.map((c) => c.team))];
    if (!abbrs.length) { setPicks([]); setPicksLoading(false); return; }
    setPicksLoading(true);
    (async () => {
      try {
        const names = abbrs.map((a) => NFL_TEAMS[a]).filter(Boolean);
        const nameToAbbr = Object.fromEntries(abbrs.map((a) => [NFL_TEAMS[a], a]));
        const histSnaps = await Promise.all(chunk(names, 30).map((c) => getDocs(query(collection(db, "historical"), where("NFL Team", "in", c)))));
        // Same dedup as NFLTeamPage.jsx's archive: one row per year+pick and
        // per year+name.
        const seen = new Set();
        const hist = [];
        histSnaps.flatMap((s) => s.docs).forEach((d) => {
          const h = d.data();
          const year = parseInt(h.Year);
          if (!year || year >= DRAFT_ORDER_YEAR) return;
          const pick = parseInt(h.Pick);
          const name = String(h.Player || "").trim().toLowerCase();
          const k1 = pick && pick !== 999 ? `${year}-${pick}` : null;
          const k2 = name ? `${year}-${name}` : null;
          if ((k1 && seen.has(k1)) || (k2 && seen.has(k2))) return;
          if (k1) seen.add(k1);
          if (k2) seen.add(k2);
          hist.push({
            key: d.id, year, team: nameToAbbr[h["NFL Team"]],
            round: parseInt(h.Round) || null, pick: pick && pick !== 999 ? pick : null,
            player: h.Player || "", position: h.Position || "", school: h.School || "", slug: null,
          });
        });

        // The just-finished draft: draftOrder selections → players docs.
        const orderSnaps = await Promise.all(chunk(abbrs, 30).map((c) => getDocs(query(collection(db, "draftOrder"), where("Team", "in", c)))));
        const order = orderSnaps.flatMap((s) => s.docs.map((d) => d.data())).filter((o) => typeof o.Selection === "string" && o.Selection.trim());
        const slugs = [...new Set(order.map((o) => o.Selection))];
        const playerSnaps = await Promise.all(chunk(slugs, 30).map((c) => getDocs(query(collection(db, "players"), where("Slug", "in", c)))));
        const bySlug = {};
        playerSnaps.forEach((s) => s.docs.forEach((d) => { const p = d.data(); bySlug[p.Slug] = p; }));
        const current = order.filter((o) => bySlug[o.Selection]).map((o) => {
          const p = bySlug[o.Selection];
          return {
            key: `cur-${o.Selection}`, year: DRAFT_ORDER_YEAR, team: o.Team,
            round: parseInt(o.Round) || null, pick: parseInt(o.Pick) || null,
            player: `${p.First || ""} ${p.Last || ""}`.trim(), position: p.Position || "", school: p.School || "", slug: p.Slug,
          };
        });
        if (!cancelled) setPicks([...hist, ...current]);
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
  const pageUrl = `https://we-draft.com/staff/${person.id}${tab === "career" ? "/career" : ""}`;
  const metaDescription = tab === "career"
    ? `${person.Name}'s coaching and front office career — every stop before becoming ${roleLabel} of the ${homeName}.`
    : `${person.Name}'s NFL draft history — every pick as ${roleLabel} of the ${homeName} and before, by round and position.`;
  const pageTitle = `${person.Name} ${tab === "career" ? "Career Path" : "Draft History"}`;
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
              <img src={home.LogoDark || home.Logo1} alt={homeName}
                style={{ flexShrink: 0, width: isMobile ? 64 : 110, height: isMobile ? 64 : 110, objectFit: "contain", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.45))" }}
                onError={(e) => { e.currentTarget.style.display = "none"; }} />
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
          </div>
        </div>

        {/* ===== TABS ===== */}
        <div role="tablist" style={{ display: "flex", gap: isMobile ? 6 : 8, marginBottom: isMobile ? 16 : 20, borderBottom: `3px solid ${tint(c1, "1f")}` }}>
          {[["draft", "Draft History", ""], ["career", "Career Path", "/career"]].map(([key, label, suffix]) => {
            const active = tab === key;
            return (
              <Link
                key={key} role="tab" aria-selected={active} replace to={`/staff/${person.id}${suffix}`}
                style={{
                  flex: isMobile ? 1 : "0 0 auto", marginBottom: -3, textAlign: "center", textDecoration: "none",
                  padding: isMobile ? "10px 6px" : "11px 22px",
                  background: active ? c1 : "transparent", color: active ? "#fff" : c1,
                  borderBottom: `3px solid ${active ? c2 : "transparent"}`, borderRadius: "8px 8px 0 0",
                  fontWeight: 900, fontSize: isMobile ? 11 : 13, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap",
                }}
              >
                {label}
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
          <LoadingSpinner label="Loading draft history" size={28} minHeight="200px" />
        ) : !credited.length ? (
          <div style={{ ...card, padding: 40, textAlign: "center", color: "#9aa5b4", fontStyle: "italic", fontSize: 14, fontFamily: "Arial, sans-serif" }}>
            No picks on file for these roles yet{available.length > 1 && scopes.length < available.length ? " — try adding another role above." : "."}
          </div>
        ) : (
          <>
            <SummaryTiles picks={credited} color1={c1} isMobile={isMobile} />
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
                      {teams[t.team]?.Logo1 && <img src={teams[t.team].Logo1} alt="" style={{ width: 26, height: 26, objectFit: "contain", flexShrink: 0 }} />}
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

            <div style={{ marginTop: 28 }}>
              <DraftRecord key={person.id} picks={credited} teams={teams} defaults={defaults} color1={c1} color2={c2} isMobile={isMobile} />
            </div>
          </>
        )}

        </>)}
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
              key={`${person.id}-${team}`} to={`/staff/${person.id}${tab === "career" ? "/career" : ""}`}
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

// ── Headline numbers ──
function SummaryTiles({ picks, color1, isMobile }) {
  const drafts = new Set(picks.map((p) => p.year)).size;
  const known = picks.filter((p) => p.pick);
  const avgPick = known.length ? Math.round(known.reduce((a, p) => a + p.pick, 0) / known.length) : null;
  const posCounts = {};
  picks.forEach((p) => { posCounts[p.position] = (posCounts[p.position] || 0) + 1; });
  const topPos = Object.entries(posCounts).sort((a, b) => b[1] - a[1])[0];
  const tiles = [
    ["Drafts", drafts],
    ["Picks", picks.length],
    ["1st Rounders", picks.filter((p) => p.round === 1).length],
    ["Day 1–2 Picks", picks.filter((p) => p.round && p.round <= 3).length],
    ["Avg Pick", avgPick ?? "–"],
    ["Most Drafted", topPos ? `${topPos[0]} (${topPos[1]})` : "–"],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(6, 1fr)", gap: isMobile ? 8 : 12 }}>
      {tiles.map(([label, value]) => (
        <div key={label} style={{ ...card, padding: isMobile ? "10px 6px" : "14px 10px", textAlign: "center" }}>
          <div style={{ fontSize: isMobile ? 18 : 26, fontWeight: 900, color: "#1a1f2b", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{value}</div>
          <div style={{ fontSize: 9, fontWeight: 900, color: color1, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 4 }}>{label}</div>
        </div>
      ))}
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
            {ROUNDS.map((r) => <th key={r} style={th}>Rd {r}</th>)}
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
// credited outside the page's own job say which role they came from. ──
function DraftRecord({ picks, teams, defaults, color1, color2, isMobile }) {
  const schoolLogos = useSchoolLogos(picks.map((p) => p.school));
  const multiTeam = new Set(picks.map((p) => p.team)).size > 1;
  const entries = picks.map((p) => ({
    key: p.key, year: p.year, round: p.round, pick: p.pick,
    playerName: p.player, position: p.position, school: p.school, slug: p.slug,
    teamLogo: multiTeam ? teams[p.team]?.Logo1 : null,
    note: defaults.includes(p.credit.scope) ? null : `as ${ROLE_BY_KEY[p.credit.role]?.label || p.credit.role}`,
  }));
  return (
    <div>
      <SectionTitle color1={color1} color2={color2} isMobile={isMobile}>Draft Record</SectionTitle>
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ background: color1, padding: "8px 16px" }}>
          <div style={{ color: color2, fontWeight: 900, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {picks.length} Pick{picks.length !== 1 ? "s" : ""}
          </div>
        </div>
        <div style={{ height: 3, background: color2 }} />
        <DraftArchiveList archive={entries} schoolLogos={schoolLogos} isMobile={isMobile} color1={color1} color2={color2} />
      </div>
    </div>
  );
}

// ── Career Path tab — every stop, newest first, one block per
// uninterrupted run with an organization (groupStints): logo, name, level,
// span, then each job held there. NFL head coach / coordinator / GM jobs are
// bold. College logos come from schools/{name} when one matches. ──
const KEY_ROLES = ["HC", "IHC", "GM", "OC", "DC"];
const LEVEL_LABEL = { NFL: "NFL", College: "College", Other: "Other" };

function CareerPath({ person, teams, color1, color2, isMobile }) {
  const groups = useMemo(() => groupStints([...(person.Stints || [])].reverse()), [person]);
  const schoolLogos = useSchoolLogos(groups.filter((g) => g.stints[0].Level === "College").map((g) => g.org));

  const stints = person.Stints || [];
  const firstYear = Math.min(...stints.map((s) => s.StartYear).filter(Boolean));
  const nflTeams = new Set(stints.filter((s) => s.Level === "NFL" && s.Team).map((s) => s.Team)).size;
  const hcJobs = groups.filter((g) => g.stints.some((s) => s.Level === "NFL" && s.Roles?.some((r) => r === "HC" || r === "IHC"))).length;
  const facts = [
    ["Stops", groups.length],
    ["NFL Teams", nflTeams],
    ["NFL HC Jobs", hcJobs],
    ["Since", Number.isFinite(firstYear) ? firstYear : "–"],
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
          const logo = team ? teams[team]?.Logo1 : schoolLogos[g.org];
          const current = g.stints.some(isOpenStint);
          const size = isMobile ? 44 : 56;
          return (
            <div key={gi} style={{ position: "relative", display: "flex", gap: isMobile ? 12 : 18, marginBottom: 14 }}>
              <div style={{
                position: "relative", zIndex: 1, flexShrink: 0, width: size, height: size, borderRadius: "50%", background: "#fff",
                boxShadow: `0 0 0 3px ${current ? color1 : "#e6ebf2"}, 0 2px 6px rgba(0,0,0,0.08)`,
                display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
              }}>
                {logo
                  ? <img src={logo} alt="" style={{ width: "72%", height: "72%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  : <span style={{ fontSize: isMobile ? 11 : 13, fontWeight: 900, color: "#9aa5b4" }}>{(team || g.org || "?").replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase()}</span>}
              </div>
              <div style={{ ...card, flex: 1, minWidth: 0, padding: isMobile ? "10px 12px" : "12px 18px", boxShadow: current ? `0 1px 3px rgba(0,0,0,0.07), 0 0 0 1.5px ${color1}` : card.boxShadow }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: isMobile ? 15 : 18, fontWeight: 900, color: "#1a1f2b", textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.2 }}>{g.org}</span>
                    <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 900, color: level === "NFL" ? "#fff" : "#6b7685", background: level === "NFL" ? color1 : "#eef1f5", borderRadius: 4, padding: "2px 6px", letterSpacing: "0.06em" }}>
                      {LEVEL_LABEL[level] || level}
                    </span>
                  </div>
                  {g.span && <span style={{ fontSize: 12, fontWeight: 900, color: current ? color1 : "#9aa5b4", fontVariantNumeric: "tabular-nums" }}>{g.span}</span>}
                </div>
                <div style={{ marginTop: 6 }}>
                  {g.stints.map((s, i) => {
                    const key = s.Level === "NFL" && s.Roles?.some((r) => KEY_ROLES.includes(r));
                    return (
                      <div key={i} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "4px 0", borderTop: i ? "1px solid #f3f5f8" : "none" }}>
                        <span style={{ flexShrink: 0, width: isMobile ? 92 : 110, fontSize: 11, fontWeight: 900, color: isOpenStint(s) ? color1 : "#9aa5b4", fontVariantNumeric: "tabular-nums" }}>{stintYearSpan(s)}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontFamily: "Arial, sans-serif", lineHeight: 1.4, fontWeight: key ? 700 : 400, color: key ? "#1a1f2b" : "#4a5466" }}>
                          {s.Title || (s.Roles || []).map((r) => ROLE_BY_KEY[r]?.label || r).join(" / ")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
