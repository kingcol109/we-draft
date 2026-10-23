// src/components/NflFitView.jsx
//
// Comparison page's NFL Fit tab (Comparison.js): one prospect against all
// 32 current NFL staffs — the team page's Targets tab turned around to
// the player. Reads the weekly compSnapshots/nflFit_{Position} doc (see
// buildProspectTeamFits in utils/draftProfiles.js): every team's staff fit
// with its GM / HC / OC / DC parts, which also ranks the league's GMs and
// head coaches (and any coordinators who fit him Very Strong or better) on
// their own. Team logos ride on the _ads snapshot the margin ads already
// read.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import LoadingSpinner from "./LoadingSpinner";
import { getSiteSnapshot, fetchAdTeamLogos } from "../utils/siteSnapshots";
import { NFL_TEAMS } from "../utils/coachHistory";
import { fitTier, STAFF_WEIGHTS } from "../utils/draftProfiles";

const SLOTS = ["GM", "HC", "OC", "DC"];
const TOP_SHOWN = 3;
const LIST_START = 5;
const STAFFERS_SHOWN = 3;
// Coordinators only make the list when they fit him this well.
const COORDINATOR_MIN = 80;

const teamName = (abbr) => NFL_TEAMS[abbr] || abbr;
const nickname = (abbr) => teamName(abbr).split(" ").pop();
// Score over its tier, fixed size (the team page's FitBadge).
function FitBadge({ score, color1 }) {
  const tier = fitTier(score);
  const words = tier ? tier.label.split(" ") : ["Fit"];
  return (
    <span style={{
      flexShrink: 0, width: 74, height: 50, boxSizing: "border-box", borderRadius: 8, padding: "5px 4px",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
      background: tier ? color1 : "#f3f5f8", color: tier ? "#fff" : "#5f6b7a",
    }}>
      <span style={{ fontSize: 18, fontWeight: 900, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{score}</span>
      <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", lineHeight: 1.15, textAlign: "center", opacity: 0.9 }}>
        {words.length > 1 ? <>{words.slice(0, -1).join(" ")}<br />{words[words.length - 1]}</> : words[0]}
      </span>
    </span>
  );
}

export default function NflFitView({ player, color1, cardStyle, isMobile }) {
  const [state, setState] = useState({ status: "loading", fit: null });
  const [logos, setLogos] = useState({});
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (!player?.id || !player?.Position) return;
    let cancelled = false;
    setState({ status: "loading", fit: null });
    setShowAll(false);
    getSiteSnapshot(`nflFit_${player.Position}`).then((snap) => {
      if (!cancelled) setState({ status: "done", fit: snap?.rows?.[player.id] || null, staff: snap?.staff || {} });
    });
    fetchAdTeamLogos().then((l) => { if (!cancelled) setLogos(l); });
    return () => { cancelled = true; };
  }, [player?.id, player?.Position]);

  const name = `${player.First || ""} ${player.Last || ""}`.trim();
  const card = { ...cardStyle, overflow: "hidden" };
  const heading = (text, right) => (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, margin: "0 0 10px 2px" }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: color1, textTransform: "uppercase", letterSpacing: "0.14em" }}>{text}</h3>
      {right && !isMobile && <span style={{ fontSize: 11, fontWeight: 800, color: "#9aa5b4", whiteSpace: "nowrap" }}>{right}</span>}
    </div>
  );
  const logo = (abbr, size) => (logos[abbr]
    ? <img src={logos[abbr]} alt="" style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} />
    : <span style={{ width: size, flexShrink: 0, fontSize: 11, fontWeight: 900, color: "#9aa5b4", textAlign: "center" }}>{abbr}</span>);

  if (state.status === "loading") return <LoadingSpinner label="Loading NFL fits" size={32} minHeight="160px" />;
  const teams = Array.isArray(state.fit) ? state.fit : [];
  if (!teams.length) {
    return (
      <div style={{ ...card, padding: 32, textAlign: "center", color: "#888", fontWeight: 700, marginBottom: 24 }}>
        No NFL fits for {name} yet — they're built weekly from community grades and each staff's draft history.
      </div>
    );
  }
  const top = teams.slice(0, TOP_SHOWN);
  const listed = showAll ? teams : teams.slice(0, LIST_START);
  // Each staffer on their own: [{ a: team, slot, s, person }], best first.
  const staffers = (slots, min = 0) => teams
    .flatMap((t) => slots.filter((sl) => t[sl] != null && t[sl] >= min).map((sl) => ({ a: t.a, slot: sl, s: t[sl], person: state.staff[t.a]?.[sl] })))
    .filter((x) => x.person)
    .sort((x, y) => y.s - x.s);
  const staffGroups = [
    { key: "GM", title: "General Managers", rows: staffers(["GM"]).slice(0, STAFFERS_SHOWN) },
    { key: "HC", title: "Head Coaches", rows: staffers(["HC"]).slice(0, STAFFERS_SHOWN) },
    { key: "CO", title: "Coordinators", rows: staffers(["OC", "DC"], COORDINATOR_MIN).slice(0, STAFFERS_SHOWN), note: "Very strong or better" },
  ].filter((g) => g.rows.length);

  return (
    <div style={{ marginBottom: 24 }}>
      {/* ── Best fits ── */}
      {heading("Best Fits")}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : `repeat(${top.length}, minmax(0, 1fr))`, gap: 12, marginBottom: 22 }}>
        {top.map((t) => {
          const tier = fitTier(t.s);
          return (
            <Link key={t.a} to={`/nfl/${t.a.toLowerCase()}`} style={{ ...card, display: "flex", flexDirection: isMobile ? "row" : "column", alignItems: "center", gap: isMobile ? 14 : 8, padding: isMobile ? "12px 14px" : "18px 12px 16px", textDecoration: "none", borderTop: `4px solid ${tier ? color1 : "#e3e8ef"}` }}>
              {logo(t.a, isMobile ? 44 : 64)}
              <span style={{ flex: isMobile ? 1 : "none", minWidth: 0, textAlign: isMobile ? "left" : "center" }}>
                <span style={{ display: "block", fontSize: isMobile ? 15 : 16, fontWeight: 900, color: "#1a1f2b", textTransform: "uppercase", letterSpacing: "0.03em" }}>{nickname(t.a)}</span>
                <span style={{ display: "block", marginTop: 2, fontSize: 11, fontWeight: 800, color: "#5f6b7a" }}>
                  {SLOTS.filter((sl) => t[sl] != null).map((sl) => `${sl} ${t[sl]}`).join(" · ")}
                </span>
              </span>
              <FitBadge score={t.s} color1={color1} />
            </Link>
          );
        })}
      </div>

      {/* ── Staffers on their own ── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : `repeat(${Math.min(staffGroups.length, 2)}, minmax(0, 1fr))`, gap: 16, marginBottom: 22 }}>
        {staffGroups.map((g) => (
          <div key={g.key} style={{ gridColumn: g.key === "CO" && !isMobile ? "1 / -1" : "auto" }}>
            {heading(g.title, g.note)}
            <div style={card}>
              {g.rows.map((x, i) => {
                // Head coaches and GMs have a staff page — their name links there.
                const hasPage = x.slot === "GM" || x.slot === "HC";
                return (
                  <div key={`${x.a}-${x.slot}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: isMobile ? "9px 14px" : "10px 16px", borderTop: i ? "1px solid #f0f2f5" : "none" }}>
                    <Link to={`/nfl/${x.a.toLowerCase()}`} title={teamName(x.a)} style={{ display: "flex" }}>{logo(x.a, 32)}</Link>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: isMobile ? 14 : 15, fontWeight: 900, color: "#1a1f2b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {hasPage
                          ? <Link to={`/staff/${x.person.id}`} style={{ color: "inherit", textDecoration: "underline", textDecorationThickness: 2, textUnderlineOffset: 3, textDecorationColor: "#c9d3e0" }}>{x.person.n}</Link>
                          : x.person.n}
                      </span>
                      <span style={{ display: "block", marginTop: 2, fontSize: 11, fontWeight: 700, color: "#5f6b7a", fontFamily: "Arial, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {g.key === "CO" ? `${x.slot} · ` : ""}{teamName(x.a)}
                      </span>
                    </span>
                    <FitBadge score={x.s} color1={color1} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ── Every team ── */}
      {heading("All Teams", `GM ${STAFF_WEIGHTS.GM * 100} · HC ${STAFF_WEIGHTS.HC * 100} · OC/DC ${STAFF_WEIGHTS.OC * 100} each`)}
      <div style={card}>
        {listed.map((t, i) => (
          <Link
            key={t.a} to={`/nfl/${t.a.toLowerCase()}`}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: isMobile ? "9px 14px" : "10px 18px", borderTop: i ? "1px solid #f0f2f5" : "none", textDecoration: "none" }}
          >
            <span style={{ width: 20, flexShrink: 0, fontSize: 12, fontWeight: 900, color: "#9aa5b4", fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
            {logo(t.a, 32)}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: isMobile ? 14 : 15, fontWeight: 900, color: "#1a1f2b", textTransform: "uppercase", letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {teamName(t.a)}
              </span>
              <span style={{ display: "block", marginTop: 4, height: 6, background: "#f0f2f5", borderRadius: 3, overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${t.s}%`, background: fitTier(t.s) ? color1 : "#b8c2d0", borderRadius: 3 }} />
              </span>
              <span style={{ display: "block", marginTop: 4, fontSize: 11, fontWeight: 700, color: "#5f6b7a", fontFamily: "Arial, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {SLOTS.filter((sl) => t[sl] != null).map((sl) => `${sl} ${t[sl]}`).join(" · ")}
              </span>
            </span>
            <FitBadge score={t.s} color1={color1} />
          </Link>
        ))}
        {teams.length > LIST_START && (
          <button
            onClick={() => setShowAll((v) => !v)}
            style={{ display: "block", width: "100%", padding: "11px", border: "none", borderTop: "1px solid #f0f2f5", background: "#fafbfc", color: color1, fontFamily: "inherit", fontWeight: 900, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}
          >
            {showAll ? "Show Top 5" : `Show All ${teams.length} Teams`}
          </button>
        )}
      </div>

      <p style={{ margin: "14px 4px 0", fontSize: 12, fontWeight: 600, color: "#98a1b3", lineHeight: 1.6 }}>
        Each team's fit compares {name}'s height, weight and community-graded traits with the players its current general manager,
        head coach and coordinators have drafted at the position — weighted GM 65%, head coach 20% and each coordinator 7.5%.
        70+ is a strong fit, 80+ very strong, 90+ extremely strong.
      </p>
    </div>
  );
}
