// src/components/ProjectedPicks.jsx
//
// NFL team page's Targets tab (NFLTeamPage.jsx): which prospects
// fit the draft history of the team's current decision-makers. Uses the
// same per-position profiles as the staff pages' Targets tab (see
// utils/draftProfiles.js) for four staffers — GM, head coach, OC, DC —
// each credited with every pick their teams made while they held a
// creditable job (any scope; coordinators only on their side of the ball).
//
// Sections, for the chosen classes and position (or all of them):
//   Staff Picks — every prospect's fits blended by STAFF_WEIGHTS (GM 65%,
//     HC 20%, OC/DC 7.5% each, renormalized over whoever has a profile at
//     the position).
//   GM / head coach fits — each one's Strong-or-better fits on their own.
//   Coordinator fits — only Extremely Strong ones, and only if any exist.
//   Player comparisons — a prospect who is a Very Strong (or better) match
//     to one specific player in a staffer's draft history, with the why.
// Fit scores are utils/draftProfiles.js's calibrated 0–100 scale (70 / 80 /
// 90 = Strong / Very Strong / Extremely Strong).
// All of it is precomputed weekly into compSnapshots/teamTargets_{TEAM}
// (one read — see fetchTeamTargets in utils/draftProfileData.js); the tab
// only filters and ranks.
import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import LoadingSpinner from "./LoadingSpinner";
import { useSchoolLogos } from "./DraftArchiveList";
import { NFL_TEAMS, ROLE_BY_KEY } from "../utils/coachHistory";
import {
  STAFF_WEIGHTS, FIT_TIERS, STAFF_SLOTS as SLOT_DEFS, fitTier,
} from "../utils/draftProfiles";
import { fetchTeamTargets, PROSPECT_YEARS, PROFILE_POSITIONS as POSITIONS } from "../utils/draftProfileData";

// draftOrder holds this draft; "historical" everything before it.
const ALL = "ALL";
const STAFF_SLOTS = SLOT_DEFS.map((x) => x.slot);
const STAFF_PICKS_SHOWN = 5;
const SOLO_FITS_SHOWN = 5;
// Top few, plus every further Extremely Strong one.
const COMPARISONS_SHOWN = 3;
// No list shows more than this many prospects at one position — the next
// one at a full position is skipped for whoever's after them.
const MAX_PER_POSITION = 2;
const STRONG = FIT_TIERS.find((t) => t.key === "strong").min;
const EXTREME = FIT_TIERS.find((t) => t.key === "extreme").min;

const tint = (hex, alpha) => (/^#[0-9a-f]{6}$/i.test(hex || "") ? `${hex}${alpha}` : "transparent");
const card = { background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px #e6ebf2", overflow: "hidden" };
const nameOf = (p) => `${p.First || ""} ${p.Last || ""}`.trim();
const lowerRole = (role) => (ROLE_BY_KEY[role]?.label || role).toLowerCase();

// The first `limit` of an already-sorted list, at most MAX_PER_POSITION per
// position.
function capByPosition(list, limit) {
  const counts = {};
  const out = [];
  for (const x of list) {
    if (out.length >= limit) break;
    if ((counts[x.pos] || 0) >= MAX_PER_POSITION) continue;
    counts[x.pos] = (counts[x.pos] || 0) + 1;
    out.push(x);
  }
  return out;
}

function SectionTitle({ children, color1, color2, right, isMobile }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <div style={{ fontWeight: 900, fontSize: isMobile ? 15 : 18, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.08em", color: color1 }}>
        {children}
      </div>
      <div style={{ flex: 1, height: 3, borderRadius: 2, background: `linear-gradient(to right, ${color2}, ${tint(color2, "00")})` }} />
      {/* The note can't wrap — phones drop it. */}
      {right != null && !isMobile && <div style={{ fontSize: 11, fontWeight: 900, color: "#9aa5b4", whiteSpace: "nowrap" }}>{right}</div>}
    </div>
  );
}

// "Kamario Taylor is a very strong match to Cam Newton, who Brad Holmes
// drafted as general manager of the Carolina Panthers in 2012." — both
// players' names bold.
function comparisonSentence(prospect, m, tier) {
  const team = NFL_TEAMS[m.pt] || m.pt;
  const why = ["HC", "IHC", "GM"].includes(m.r)
    ? `who ${m.pn} drafted as ${lowerRole(m.r)} of the ${team} in ${m.y}`
    : `who the ${team} drafted in ${m.y} while ${m.pn} was their ${lowerRole(m.r)}`;
  const bold = { fontWeight: 900, color: "#1a1f2b" };
  return (
    <>
      <span style={bold}>{nameOf(prospect)}</span> is {tier.key === "extreme" ? "an" : "a"} {tier.label.toLowerCase()} match
      to <span style={bold}>{m.pl}</span>, {why}.
    </>
  );
}

export default function ProjectedPicks({ staff, staffLoading, teamKey, color1, color2, isMobile }) {
  const [years, setYears] = useState(["2027"]);
  const [position, setPosition] = useState(ALL);
  // At least one class stays on.
  const toggleYear = (y) => setYears((prev) => (prev.includes(y) ? (prev.length > 1 ? prev.filter((x) => x !== y) : prev) : [...prev, y].sort()));

  // Everything this tab shows, precomputed weekly (teamTargets_{TEAM} — see
  // fetchTeamTargets): the staff strip, every active prospect's staff fit
  // with each staffer's part, and the draft-history matches. Filtering by
  // class and position happens here, so toggling never re-reads anything.
  const [data, setData] = useState({ status: "loading" });
  useEffect(() => {
    if (staffLoading) return;
    let cancelled = false;
    setData({ status: "loading" });
    fetchTeamTargets(teamKey, staff)
      .then((d) => { if (!cancelled) setData({ status: "done", ...d }); })
      .catch((e) => { console.error("Targets load error:", e); if (!cancelled) setData({ status: "error" }); });
    return () => { cancelled = true; };
  }, [teamKey, staff, staffLoading]);
  const members = data.members || [];

  const positions = position === ALL ? POSITIONS : [position];
  const results = useMemo(() => {
    if (data.status !== "done") return null;
    const inView = data.rows.filter((r) => years.includes(r.E) && positions.includes(r.P));
    const byId = Object.fromEntries(inView.map((r) => [r.i, r]));
    const prospect = (r) => ({ id: r.i, First: r.F, Last: r.L, School: r.S, Eligible: r.E, Slug: r.sl, logo: r.lg });
    const desc = (a, b) => b.score - a.score;
    const staffPicks = inView.map((r) => ({
      prospect: prospect(r), pos: r.P, score: r.s,
      parts: STAFF_SLOTS.filter((sl) => r[sl] != null).map((sl) => ({ slot: sl, score: r[sl] })),
    }));
    const solo = Object.fromEntries(members.map((m) => {
      const min = m.slot === "OC" || m.slot === "DC" ? EXTREME : STRONG;
      const list = inView.filter((r) => r[m.slot] != null && r[m.slot] >= min).map((r) => ({ prospect: prospect(r), pos: r.P, score: r[m.slot] }));
      return [m.slot, capByPosition(list.sort(desc), SOLO_FITS_SHOWN)];
    }));
    // Each drafted player anchors one comparison at most — the strongest
    // prospect match to him; the same pick reached through two staffers
    // (e.g. a GM and head coach hired together) keeps the higher-weighted
    // staffer's line.
    const seen = new Set();
    const comparisons = data.matches
      .filter((m) => byId[m.i])
      .sort((a, b) => b.s - a.s || STAFF_WEIGHTS[b.sl] - STAFF_WEIGHTS[a.sl])
      .filter((m) => (seen.has(m.k) ? false : seen.add(m.k)))
      .map((m) => ({ prospect: prospect(byId[m.i]), pos: byId[m.i].P, match: m, score: m.s }));
    return {
      staffPicks: capByPosition(staffPicks.sort(desc), STAFF_PICKS_SHOWN),
      solo,
      comparisons: comparisons.slice(0, Math.max(COMPARISONS_SHOWN, comparisons.filter((c) => c.score >= EXTREME).length)),
    };
    // positions is derived from position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, years, position]);

  // Logos ride on the snapshot rows; only the live fallback needs a lookup.
  const shownProspects = results ? [
    ...results.staffPicks.map((x) => x.prospect),
    ...Object.values(results.solo).flat().map((x) => x.prospect),
    ...results.comparisons.map((x) => x.prospect),
  ] : [];
  const lookedUp = useSchoolLogos(shownProspects.filter((p) => !p.logo).map((p) => p.School));
  const schoolLogos = { ...lookedUp, ...Object.fromEntries(shownProspects.filter((p) => p.logo).map((p) => [p.School, p.logo])) };

  const chip = (on, filled = false) => ({
    border: `2px solid ${on ? color1 : tint(color1, "33")}`, borderRadius: filled ? 8 : 999, padding: filled ? "6px 12px" : "5px 12px",
    background: on ? (filled ? color1 : tint(color1, "14")) : "#fff", color: on && filled ? "#fff" : color1, cursor: "pointer",
    fontFamily: "inherit", fontWeight: 900, fontSize: filled ? 12 : 11, letterSpacing: "0.05em",
  });

  if (staffLoading || data.status === "loading") return <LoadingSpinner label="Finding fits" size={28} minHeight="200px" />;
  if (data.status === "done" && !members.length) {
    return <div style={{ ...card, padding: 40, textAlign: "center", color: "#9aa5b4", fontStyle: "italic", fontSize: 14, fontFamily: "Arial, sans-serif" }}>Staff not on file yet.</div>;
  }

  const loading = false;
  const posLabel = position === ALL ? "" : `${position} `;
  const soloSections = members.filter((m) => results?.solo[m.slot]?.length || m.slot === "GM" || m.slot === "HC");

  return (
    <div>
      {/* ===== STAFF ===== */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : `repeat(${members.length}, minmax(0, 1fr))`, gap: 1, ...card, background: "#eef1f5", borderTop: `3px solid ${color1}`, marginBottom: 18 }}>
        {members.map((m) => (
          <div key={m.slot} style={{ background: "#fff", padding: isMobile ? "10px 12px" : "12px 16px", minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 10, fontWeight: 900, color: color1, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.slot === "GM" || m.slot === "HC" ? m.label : m.slot}</span>
              <span style={{ color: "#9aa5b4" }}>{Math.round(STAFF_WEIGHTS[m.slot] * 1000) / 10}%</span>
            </div>
            <div style={{ marginTop: 4, fontSize: isMobile ? 14 : 16, fontWeight: 900, color: "#1a1f2b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {m.slot === "GM" || m.slot === "HC"
                ? <Link to={`/staff/${m.person.id}`} style={{ color: "inherit", textDecoration: "underline", textDecorationThickness: 2, textUnderlineOffset: 3, textDecorationColor: tint(color1, "88") }}>{m.person.Name}</Link>
                : m.person.Name}
            </div>
            <div style={{ marginTop: 2, fontSize: 11, fontWeight: 700, color: "#5f6b7a", fontFamily: "Arial, sans-serif" }}>
              {`${m.picks} picks on record`}
            </div>
          </div>
        ))}
      </div>

      {/* ===== FILTERS ===== */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 10 }}>
        {[ALL, ...POSITIONS].map((p) => (
          <button key={p} onClick={() => setPosition(p)} aria-pressed={position === p} style={chip(position === p, true)}>
            {p === ALL ? "All Positions" : p}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 22 }}>
        <span style={{ fontSize: 11, fontWeight: 900, color: "#6b7685", letterSpacing: "0.08em", textTransform: "uppercase", marginRight: 4 }}>Classes</span>
        {PROSPECT_YEARS.map((y) => (
          <button key={y} onClick={() => toggleYear(y)} aria-pressed={years.includes(y)} style={chip(years.includes(y))}>
            {years.includes(y) ? "✓ " : "+ "}{y}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSpinner label="Finding fits" size={28} minHeight="200px" />
      ) : !results ? (
        <div style={{ ...card, padding: 30, textAlign: "center", color: "#b42318", fontSize: 13, fontFamily: "Arial, sans-serif" }}>Couldn't load projected picks — try again.</div>
      ) : (
        <>
          {/* ===== STAFF PICKS ===== */}
          <SectionTitle color1={color1} color2={color2} isMobile={isMobile} right="GM 65 · HC 20 · OC/DC 7.5 each">{posLabel}Staff Picks</SectionTitle>
          <ProspectList
            rows={results.staffPicks} schoolLogos={schoolLogos} color1={color1} isMobile={isMobile} numbered
            detail={(x) => x.parts.map((p) => `${p.slot} ${Math.round(p.score)}`).join(" · ")}
            empty={`No ${posLabel}prospects with enough data to project yet.`}
          />

          {/* ===== INDIVIDUAL FITS ===== */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20, marginTop: 26 }}>
            {soloSections.map((m) => {
              const coord = m.slot === "OC" || m.slot === "DC";
              return (
                <div key={m.slot}>
                  <SectionTitle color1={color1} color2={color2} isMobile={isMobile} right={coord ? "Extremely strong only" : "Strong or better"}>
                    {m.person.Name.split(" ").slice(-1)[0]} Fits
                  </SectionTitle>
                  <ProspectList
                    rows={results.solo[m.slot]} schoolLogos={schoolLogos} color1={color1} isMobile={isMobile} compact
                    empty={`No strong ${posLabel}fits for ${m.person.Name} in ${years.join(" / ")}.`}
                  />
                </div>
              );
            })}
          </div>

          {/* ===== PLAYER COMPARISONS ===== */}
          {results.comparisons.length > 0 && (
            <div style={{ marginTop: 26 }}>
              <SectionTitle color1={color1} color2={color2} isMobile={isMobile} right="Very strong or better">Draft History Matches</SectionTitle>
              <div style={card}>
                {results.comparisons.map((c, i) => {
                  const tier = fitTier(c.score);
                  const p = c.prospect;
                  return (
                    <Link
                      key={`${p.id}-${c.match.k}`} to={`/player/${p.Slug}`}
                      style={{ display: "flex", alignItems: "center", gap: 12, padding: isMobile ? "10px 14px" : "12px 18px", borderTop: i ? "1px solid #f0f2f5" : "none", textDecoration: "none" }}
                    >
                      <SchoolLogo school={p.School} logo={schoolLogos[p.School]} isMobile={isMobile} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: isMobile ? 12 : 13, lineHeight: 1.45, color: "#3a4352", fontFamily: "Arial, sans-serif" }}>
                        {comparisonSentence(p, c.match, tier)}
                      </span>
                      <FitBadge score={c.score} color1={color1} />
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ marginTop: 18, fontSize: 11, fontWeight: 700, color: "#5f6b7a", fontFamily: "Arial, sans-serif", lineHeight: 1.5 }}>
            Fits compare each prospect's height, weight and community-graded traits with the players these staffers have drafted at the position.
            70+ is a strong fit, 80+ very strong, 90+ extremely strong.
          </div>
        </>
      )}
    </div>
  );
}

function SchoolLogo({ school, logo, isMobile }) {
  const size = isMobile ? 34 : 40;
  return (
    <span title={school} style={{ flexShrink: 0, width: size, height: size, borderRadius: 6, background: "#f5f6f8", display: "flex", alignItems: "center", justifyContent: "center", padding: 4, boxSizing: "border-box" }}>
      {logo && <img src={logo} alt={school} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
    </span>
  );
}

// Score over its tier — tiered fits fill with the team color. Every badge
// is the same size: the tier sits on two words' worth of lines ("Extremely
// / Strong"), so the longest label wraps instead of being cut off and the
// shorter ones center in the same space.
function FitBadge({ score, color1 }) {
  const tier = fitTier(score);
  const words = tier ? tier.label.split(" ") : ["Fit"];
  return (
    <span style={{
      flexShrink: 0, width: 74, height: 50, boxSizing: "border-box", borderRadius: 8, padding: "5px 4px",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
      background: tier ? color1 : "#f3f5f8", color: tier ? "#fff" : "#5f6b7a",
      boxShadow: tier?.key === "extreme" ? `inset 0 0 0 2px rgba(255,255,255,0.55)` : "none",
    }}>
      <span style={{ fontSize: 18, fontWeight: 900, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{Math.round(score)}</span>
      <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", lineHeight: 1.15, textAlign: "center", opacity: 0.9 }}>
        {words.length > 1 ? <>{words.slice(0, -1).join(" ")}<br />{words[words.length - 1]}</> : words[0]}
      </span>
    </span>
  );
}

function ProspectList({ rows, schoolLogos, color1, isMobile, numbered, compact, detail, empty }) {
  if (!rows.length) {
    return <div style={{ ...card, padding: 18, color: "#9aa5b4", fontStyle: "italic", fontSize: 13, fontFamily: "Arial, sans-serif" }}>{empty}</div>;
  }
  return (
    <div style={card}>
      {rows.map((x, i) => {
        const p = x.prospect;
        return (
          <Link
            key={`${p.id}-${i}`} to={`/player/${p.Slug}`}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: isMobile || compact ? "9px 14px" : "10px 18px", borderTop: i ? "1px solid #f0f2f5" : "none", textDecoration: "none" }}
          >
            {numbered && <span style={{ width: 18, flexShrink: 0, fontSize: 12, fontWeight: 900, color: "#9aa5b4", fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>}
            <SchoolLogo school={p.School} logo={schoolLogos[p.School]} isMobile={isMobile || compact} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: compact ? (isMobile ? 14 : 15) : (isMobile ? 16 : 18), fontWeight: 900, color: "#1a1f2b", textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {nameOf(p)}
              </span>
              <span style={{ display: "block", marginTop: 2, fontSize: 11, fontWeight: 700, color: "#5f6b7a", fontFamily: "Arial, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {[x.pos, p.Eligible, detail ? detail(x) : null].filter(Boolean).join(" · ")}
              </span>
            </span>
            <FitBadge score={x.score} color1={color1} />
          </Link>
        );
      })}
    </div>
  );
}
