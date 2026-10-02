// src/components/DynastyHub.js
// ── Dynasty mode's front office (/sim): pick your franchise, browse any
// team's 53-man roster and depth chart, open a player's full ratings, pick
// an opponent and go play a drive. NFL: rosters are the league defaults
// (src/sim/dynasty/defaultRosters.json), branding the Firestore `nfl`
// collection. College: the Power 4 + Notre Dame from `schools`, rosters
// generated the same way. Everything is themed in the team's own colors. ──

import { useMemo, useState } from "react";
import { ATTR_LABELS, ATTR_SHORT, POSITION_ATTRS, POSITION_ORDER, heightLabel } from "../sim/dynasty/attributes";
import { depthChart, offenseLineup, defenseLineup, teamRatings, fullName } from "../sim/dynasty/lineup";

const ORANGE = "#F6A21D";
const PANEL = "#0f172a";
const LINE = "#334155";

function logoUrl(b) {
  const u = b && (b.Logo1 || b.Logo2);
  if (!u) return "";
  const t = u.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}
// NFL docs have City + Team; schools have School (+ Mascot).
const teamName = (abbr, b) => (!b ? abbr : b.City ? `${b.City} ${b.Team}` : `${b.School}${b.Mascot ? ` ${b.Mascot}` : ""}`);
const shortName = (abbr, b) => (b && (b.Abbreviation || b.Short)) || (b && b.School) || abbr;
const groupOf = (b) => [b.Conference, b.Division].filter(Boolean).join(" ") || "League";
// A team id is everything before the last "-NN" (college slugs have dashes).
const teamOf = (playerId) => playerId.slice(0, playerId.lastIndexOf("-"));

// ── Team theme: the team's primary color for fills, and whichever of its
// two colors reads on the dark menus for text and highlights. ──
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function teamTheme(b) {
  const c1 = (b && b.Color1) || "#0055A5";
  const c2 = (b && b.Color2) || ORANGE;
  const accent = luminance(c1) > 0.12 ? c1 : luminance(c2) > 0.12 ? c2 : "#e2e8f0";
  return { c1, c2, accent, onC1: luminance(c1) > 0.45 ? "#0b1224" : "#ffffff" };
}

// Rating colors: elite → poor.
export function ratingColor(v) {
  if (v >= 90) return "#4ade80";
  if (v >= 80) return "#a3e635";
  if (v >= 70) return "#facc15";
  if (v >= 60) return "#fb923c";
  return "#f87171";
}

function Logo({ b, size = 28 }) {
  const src = logoUrl(b);
  if (!src) return <div style={{ width: size, height: size }} />;
  return <img src={src} alt="" style={{ width: size, height: size, objectFit: "contain", flex: "none" }} />;
}

function Ovr({ v, big }) {
  return (
    <span
      style={{
        display: "inline-block", minWidth: big ? 44 : 30, textAlign: "center", fontWeight: 900,
        fontSize: big ? 22 : 12, color: "#0b1224", background: ratingColor(v), borderRadius: 5, padding: big ? "4px 6px" : "1px 4px",
      }}
    >
      {v}
    </span>
  );
}

const tabBtn = (active, color = ORANGE) => ({
  padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontWeight: 900, fontSize: 12, letterSpacing: "0.04em",
  border: `1px solid ${active ? color : "#475569"}`, background: active ? `${color}2e` : "#1e293b", color: active ? color : "#e2e8f0",
});

// ── Team picker: the 32 clubs by conference and division. ──
function TeamPicker({ league, branding, onPick, current }) {
  const groups = {};
  for (const abbr of Object.keys(league.teams)) {
    const key = groupOf(branding[abbr] || {});
    (groups[key] = groups[key] || []).push(abbr);
  }
  const keys = Object.keys(groups).sort();
  return (
    <div>
      <div style={{ fontWeight: 900, fontSize: 20, color: ORANGE, letterSpacing: "0.04em" }}>{league.college ? "CHOOSE YOUR PROGRAM" : "CHOOSE YOUR FRANCHISE"}</div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
        {league.college ? "The ACC, Big Ten, Big 12, SEC and Notre Dame. Every program has a generated roster." : "Every team has a generated 53-man roster."} OFF / DEF are the starters' average overall.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12, marginTop: 12 }}>
        {keys.map((k) => (
          <div key={k}>
            <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", color: "#94a3b8", marginBottom: 5 }}>{k.toUpperCase()}</div>
            <div style={{ display: "grid", gap: 6 }}>
              {groups[k].sort((x, y) => teamName(x, branding[x]).localeCompare(teamName(y, branding[y]))).map((abbr) => {
                const b = branding[abbr];
                const r = teamRatings(league.teams[abbr]);
                return (
                  <button
                    key={abbr}
                    onClick={() => onPick(abbr)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 8, cursor: "pointer",
                      color: "#e2e8f0", textAlign: "left",
                      border: `1px solid ${abbr === current ? teamTheme(b).accent : LINE}`, borderLeft: `4px solid ${(b && b.Color1) || "#475569"}`,
                      background: abbr === current ? `${teamTheme(b).c1}33` : PANEL,
                    }}
                  >
                    <Logo b={b} size={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 900, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{teamName(abbr, b)}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>OFF {r.off} · DEF {r.def}</div>
                    </div>
                    <Ovr v={r.ovr} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── One player's full card. ──
function PlayerCard({ p, b, college, onClose }) {
  const attrs = POSITION_ATTRS[p.pos];
  return (
    <div
      onClick={onClose}
      style={{ position: "absolute", inset: 0, background: "rgba(2,6,23,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(560px, 100%)", maxHeight: "100%", overflowY: "auto", background: "#0b1224", border: `1px solid ${LINE}`, borderRadius: 10 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: (b && b.Color1) || "#1e293b", borderBottom: `3px solid ${(b && b.Color2) || ORANGE}` }}>
          <Logo b={b} size={40} />
          <div style={{ flex: 1, color: teamTheme(b).onC1 }}>
            <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.85 }}>#{p.number} · {p.pos}</div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{fullName(p)}</div>
          </div>
          <Ovr v={p.ovr} big />
        </div>
        <div style={{ display: "flex", gap: 16, padding: "10px 14px", fontSize: 12, color: "#cbd5e1", borderBottom: `1px solid ${LINE}` }}>
          <span>Height <b>{heightLabel(p.height)}</b></span>
          <span>Weight <b>{p.weight}</b></span>
          <span>Age <b>{p.age}</b></span>
          {college ? (
            <span>Class <b>{["Fr", "So", "Jr", "Sr", "Gr"][Math.min(4, p.exp)]}</b></span>
          ) : (
            <span>Exp <b>{p.exp === 0 ? "Rookie" : `${p.exp} yr`}</b></span>
          )}
          <span>Depth <b>{p.pos}{p.depth}</b></span>
        </div>
        <div style={{ padding: "10px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
          {attrs.map((k) => (
            <div key={k}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: "#cbd5e1" }}>{ATTR_LABELS[k]}</span>
                <b style={{ color: ratingColor(p.ratings[k]) }}>{p.ratings[k]}</b>
              </div>
              <div style={{ height: 5, background: "#1e293b", borderRadius: 3, marginTop: 2 }}>
                <div style={{ width: `${p.ratings[k]}%`, height: "100%", background: ratingColor(p.ratings[k]), borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: "0 14px 12px", textAlign: "right" }}>
          <button onClick={onClose} style={tabBtn(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Roster table, filtered by position. ──
function RosterTable({ team, onOpen, accent = ORANGE }) {
  const [pos, setPos] = useState("QB");
  const players = team.players.filter((p) => p.pos === pos).sort((a, b) => a.depth - b.depth);
  const attrs = POSITION_ATTRS[pos];
  const th = { padding: "5px 6px", fontSize: 10, fontWeight: 900, color: "#94a3b8", textAlign: "center", letterSpacing: "0.04em", whiteSpace: "nowrap" };
  const td = { padding: "5px 6px", fontSize: 12, textAlign: "center", borderTop: `1px solid #1e293b` };
  return (
    <div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {POSITION_ORDER.map((k) => (
          <button key={k} onClick={() => setPos(k)} style={{ ...tabBtn(k === pos, accent), padding: "4px 9px" }}>
            {k} <span style={{ opacity: 0.6, fontWeight: 700 }}>{team.players.filter((p) => p.pos === k).length}</span>
          </button>
        ))}
      </div>
      <div style={{ overflowX: "auto", marginTop: 10, border: `1px solid ${LINE}`, borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", background: PANEL }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>PLAYER</th>
              <th style={th}>OVR</th>
              <th style={th}>AGE</th>
              <th style={th}>HT</th>
              <th style={th}>WT</th>
              {attrs.map((k) => (
                <th key={k} style={th} title={ATTR_LABELS[k]}>{ATTR_SHORT[k]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id} onClick={() => onOpen(p)} style={{ cursor: "pointer" }}>
                <td style={{ ...td, textAlign: "left", whiteSpace: "nowrap" }}>
                  <span style={{ color: "#64748b", marginRight: 6 }}>{p.pos}{p.depth}</span>
                  <b>{fullName(p)}</b> <span style={{ color: "#64748b" }}>#{p.number}</span>
                </td>
                <td style={td}><Ovr v={p.ovr} /></td>
                <td style={td}>{p.age}</td>
                <td style={td}>{heightLabel(p.height)}</td>
                <td style={td}>{p.weight}</td>
                {attrs.map((k) => (
                  <td key={k} style={{ ...td, color: ratingColor(p.ratings[k]), fontWeight: 700 }}>{p.ratings[k]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>Click a player for his full card. Hover a column for the rating's name.</div>
    </div>
  );
}

// ── Who's on the field: the sim's slots for this team. ──
function DepthChart({ team, onOpen, accent = ORANGE }) {
  const off = offenseLineup(team);
  const def43 = defenseLineup(team, "4-3");
  const def34 = defenseLineup(team, "3-4");
  const dc = depthChart(team);
  const Slot = ({ slot, p }) => (
    <button
      onClick={() => p && onOpen(p)}
      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 8px", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 6, color: "#e2e8f0", cursor: "pointer", textAlign: "left" }}
    >
      <span style={{ width: 44, fontSize: 10, fontWeight: 900, color: "#94a3b8" }}>{slot}</span>
      <span style={{ flex: 1, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {p ? `${fullName(p)}` : "—"} {p && <span style={{ color: "#64748b" }}>{p.pos}</span>}
      </span>
      {p && <Ovr v={p.ovr} />}
    </button>
  );
  const col = (title, map) => (
    <div>
      <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", color: accent, marginBottom: 6 }}>{title}</div>
      <div style={{ display: "grid", gap: 4 }}>
        {Object.entries(map).map(([slot, p]) => <Slot key={slot} slot={slot} p={p} />)}
      </div>
    </div>
  );
  const specials = ["K", "P", "LS"].map((k) => [k, (dc[k] || [])[0]]);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14 }}>
      {col("OFFENSE", off)}
      {col("DEFENSE — 4-3 / MUG", def43)}
      {col("DEFENSE — 3-4", def34)}
      {col("SPECIALISTS", Object.fromEntries(specials))}
      <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "#64748b" }}>
        Starters are each position's highest-rated players. H is the tight end (in the slot, or at fullback in King / Queen sets).
      </div>
    </div>
  );
}

// ── Every club, ranked. ──
function LeagueTable({ league, branding, onView }) {
  const rows = Object.keys(league.teams)
    .map((abbr) => ({ abbr, ...teamRatings(league.teams[abbr]) }))
    .sort((a, b) => b.ovr - a.ovr);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 6 }}>
      {rows.map((r, i) => {
        const b = branding[r.abbr];
        return (
          <button
            key={r.abbr}
            onClick={() => onView(r.abbr)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: PANEL, border: `1px solid ${LINE}`, borderLeft: `4px solid ${(b && b.Color1) || "#475569"}`, borderRadius: 8, color: "#e2e8f0", cursor: "pointer", textAlign: "left" }}
          >
            <span style={{ width: 20, fontSize: 11, color: "#64748b", fontWeight: 900 }}>{i + 1}</span>
            <Logo b={b} size={26} />
            <span style={{ flex: 1, fontWeight: 900, fontSize: 13 }}>{teamName(r.abbr, b)}</span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>O {r.off} · D {r.def}</span>
            <Ovr v={r.ovr} />
          </button>
        );
      })}
    </div>
  );
}

export default function DynastyHub({ league, branding, team, opponent, onPickTeam, onPickOpponent, onPlay, onClose }) {
  const [tab, setTab] = useState("roster");
  const [viewing, setViewing] = useState(null); // another team's roster
  const [card, setCard] = useState(null);
  const [changing, setChanging] = useState(!team);
  const shown = viewing || team;
  const b = branding[shown];
  const opp = branding[opponent];
  // The menus wear the colors of the team on screen.
  const th = teamTheme(b);
  const oppOptions = useMemo(() => Object.keys(league.teams).filter((k) => k !== team).sort(), [league, team]);

  return (
    <div
      style={{
        position: "absolute", inset: 0, borderRadius: 6, padding: "14px 16px", overflowY: "auto", zIndex: 5,
        background: team && !changing ? `linear-gradient(180deg, ${th.c1}40 0px, rgba(2,6,23,0.97) 260px), rgba(2,6,23,0.97)` : "rgba(2,6,23,0.96)",
      }}
    >
      {changing || !team ? (
        <>
          <TeamPicker
            league={league}
            branding={branding}
            current={team}
            onPick={(abbr) => {
              onPickTeam(abbr);
              setViewing(null);
              setChanging(false);
            }}
          />
          {team && (
            <button onClick={() => setChanging(false)} style={{ ...tabBtn(false), marginTop: 12 }}>
              Cancel
            </button>
          )}
        </>
      ) : (
        <>
          {/* Franchise header */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 12px", borderRadius: 10, background: `linear-gradient(90deg, ${th.c1}, ${th.c1} 60%, ${th.c2})`, borderBottom: `4px solid ${th.c2}` }}>
            <Logo b={b} size={52} />
            <div style={{ flex: 1, minWidth: 180, color: th.onC1 }}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", opacity: 0.85 }}>
                {viewing ? "VIEWING" : league.college ? "YOUR PROGRAM" : "YOUR FRANCHISE"}{b && b.Conference ? ` · ${groupOf(b)}` : ""}
              </div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>{teamName(shown, b)}</div>
              {b && b.HeadCoach && <div style={{ fontSize: 11, opacity: 0.85 }}>HC {b.HeadCoach}</div>}
            </div>
            {(() => {
              const r = teamRatings(league.teams[shown]);
              return (
                <div style={{ display: "flex", gap: 8, alignItems: "center", color: th.onC1, fontSize: 11, fontWeight: 900 }}>
                  <span>OFF <Ovr v={r.off} /></span>
                  <span>DEF <Ovr v={r.def} /></span>
                  <span>OVR <Ovr v={r.ovr} /></span>
                </div>
              );
            })()}
          </div>

          {/* Matchup + actions */}
          {!viewing && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10, padding: "8px 10px", background: PANEL, border: `1px solid ${th.c1}`, borderRadius: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 900, color: th.accent, letterSpacing: "0.06em" }}>OPPONENT</span>
              <Logo b={opp} size={24} />
              <select
                value={opponent || ""}
                onChange={(e) => onPickOpponent(e.target.value)}
                style={{ background: "#1e293b", color: "#e2e8f0", border: `1px solid #475569`, borderRadius: 6, padding: "5px 8px", fontWeight: 700 }}
              >
                {oppOptions.map((k) => (
                  <option key={k} value={k}>{teamName(k, branding[k])} ({teamRatings(league.teams[k]).ovr})</option>
                ))}
              </select>
              <div style={{ flex: 1 }} />
              <button onClick={() => setChanging(true)} style={tabBtn(false)}>{league.college ? "Change program" : "Change team"}</button>
              {onClose && <button onClick={onClose} style={tabBtn(false)}>Back to drive</button>}
              <button
                onClick={onPlay}
                disabled={!opponent}
                style={{ background: th.c1, color: th.onC1, border: `2px solid ${th.c2}`, borderRadius: 6, padding: "8px 16px", fontWeight: 900, fontSize: 13, cursor: "pointer", letterSpacing: "0.04em" }}
              >
                ▶ PLAY A DRIVE vs {shortName(opponent, opp)}
              </button>
            </div>
          )}
          {viewing && (
            <button onClick={() => setViewing(null)} style={{ ...tabBtn(false), marginTop: 10 }}>
              ← Back to {teamName(team, branding[team])}
            </button>
          )}

          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            {[["roster", "Roster"], ["depth", "Depth chart"], ["league", "League"]].map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} style={tabBtn(tab === k, th.accent)}>{l}</button>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            {tab === "roster" && <RosterTable key={shown} team={league.teams[shown]} onOpen={setCard} accent={th.accent} />}
            {tab === "depth" && <DepthChart team={league.teams[shown]} onOpen={setCard} accent={th.accent} />}
            {tab === "league" && (
              <LeagueTable
                league={league}
                branding={branding}
                onView={(abbr) => {
                  setViewing(abbr === team ? null : abbr);
                  setTab("roster");
                }}
              />
            )}
          </div>
        </>
      )}
      {card && <PlayerCard p={card} b={branding[teamOf(card.id)]} college={league.college} onClose={() => setCard(null)} />}
    </div>
  );
}

