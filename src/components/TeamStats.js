// src/components/TeamStats.js
//
// The CFB team page's Stats tab (TeamPage.js): season stat tables —
// Passing, Rushing, Receiving, Defense, Kicking, Punting — for every player
// on the roster doc (cfbRosters/{CFBDTeamId}.players[].s, written by
// scripts/syncCfbdRosters.js from CFBD's season totals). Each table sorts by
// any column (its headline stat by default) and shows the top TOP_ROWS
// until "Show all". SECTIONS and StatTable are also the national tables on
// the CFB page's Stats tab (CfbLeaders.js), which add a rank and team cell.
//
// Two sub headings: Player Stats (those tables) and Team Stats — the team's
// points / yards / 3rd down / turnover margin per game, offense and
// defense, with national FBS ranks (cfbLeaders/teams, written by
// scripts/syncCfbdTeamStats.js — one read, only once Team Stats is opened).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

const TOP_ROWS = 8;
const n = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const per = (a, b, digits = 1) => (n(b) ? (n(a) / n(b)).toFixed(digits) : "–");
const pct = (a, b) => (n(b) ? ((100 * n(a)) / n(b)).toFixed(1) : "–");

// Columns: label, get (number used for sorting), show (display; defaults
// to get). The first column in `sort` is the table's default sort.
export const SECTIONS = [
  {
    key: "passing", title: "Passing", has: (s) => n(s.passing?.ATT), sort: "Yds",
    cols: [
      { label: "C/Att", get: (s) => n(s.passing?.COMPLETIONS), show: (s) => `${n(s.passing?.COMPLETIONS)}/${n(s.passing?.ATT)}`, w: 1.5 },
      { label: "Pct", get: (s) => n(s.passing?.COMPLETIONS) / (n(s.passing?.ATT) || 1), show: (s) => pct(s.passing?.COMPLETIONS, s.passing?.ATT) },
      { label: "Yds", get: (s) => n(s.passing?.YDS) },
      { label: "Y/A", get: (s) => n(s.passing?.YDS) / (n(s.passing?.ATT) || 1), show: (s) => per(s.passing?.YDS, s.passing?.ATT) },
      { label: "TD", get: (s) => n(s.passing?.TD) },
      { label: "INT", get: (s) => n(s.passing?.INT) },
    ],
  },
  {
    key: "rushing", title: "Rushing", has: (s) => n(s.rushing?.CAR), sort: "Yds",
    cols: [
      { label: "Car", get: (s) => n(s.rushing?.CAR) },
      { label: "Yds", get: (s) => n(s.rushing?.YDS) },
      { label: "Avg", get: (s) => n(s.rushing?.YDS) / (n(s.rushing?.CAR) || 1), show: (s) => per(s.rushing?.YDS, s.rushing?.CAR) },
      { label: "TD", get: (s) => n(s.rushing?.TD) },
      { label: "Long", get: (s) => n(s.rushing?.LONG) },
    ],
  },
  {
    key: "receiving", title: "Receiving", has: (s) => n(s.receiving?.REC), sort: "Yds",
    cols: [
      { label: "Rec", get: (s) => n(s.receiving?.REC) },
      { label: "Yds", get: (s) => n(s.receiving?.YDS) },
      { label: "Avg", get: (s) => n(s.receiving?.YDS) / (n(s.receiving?.REC) || 1), show: (s) => per(s.receiving?.YDS, s.receiving?.REC) },
      { label: "TD", get: (s) => n(s.receiving?.TD) },
      { label: "Long", get: (s) => n(s.receiving?.LONG) },
    ],
  },
  {
    key: "defense", title: "Defense", has: (s) => n(s.defensive?.TOT) || n(s.defensive?.SACKS) || n(s.interceptions?.INT) || n(s.defensive?.PD), sort: "Tkl",
    cols: [
      { label: "Tkl", get: (s) => n(s.defensive?.TOT) },
      { label: "Solo", get: (s) => n(s.defensive?.SOLO) },
      { label: "TFL", get: (s) => n(s.defensive?.TFL) },
      { label: "Sack", get: (s) => n(s.defensive?.SACKS) },
      { label: "INT", get: (s) => n(s.interceptions?.INT) },
      { label: "PBU", get: (s) => n(s.defensive?.PD) },
    ],
  },
  {
    key: "kicking", title: "Kicking", has: (s) => n(s.kicking?.FGA) || n(s.kicking?.XPA), sort: "Pts",
    cols: [
      { label: "FG", get: (s) => n(s.kicking?.FGM), show: (s) => `${n(s.kicking?.FGM)}/${n(s.kicking?.FGA)}` },
      { label: "Pct", get: (s) => n(s.kicking?.FGM) / (n(s.kicking?.FGA) || 1), show: (s) => pct(s.kicking?.FGM, s.kicking?.FGA) },
      { label: "Long", get: (s) => n(s.kicking?.LONG) },
      { label: "XP", get: (s) => n(s.kicking?.XPM), show: (s) => `${n(s.kicking?.XPM)}/${n(s.kicking?.XPA)}` },
      { label: "Pts", get: (s) => n(s.kicking?.PTS) },
    ],
  },
  {
    key: "punting", title: "Punting", has: (s) => n(s.punting?.NO), sort: "Avg",
    cols: [
      { label: "Punts", get: (s) => n(s.punting?.NO) },
      { label: "Avg", get: (s) => n(s.punting?.YPP), show: (s) => n(s.punting?.YPP).toFixed(1) },
      { label: "In 20", get: (s) => n(s.punting?.["In 20"]) },
      { label: "Long", get: (s) => n(s.punting?.LONG) },
    ],
  },
];

// teamCell (optional): renders a rank + the player's team before his name.
export function StatTable({ section, players, color1, isMobile, topRows = TOP_ROWS, teamCell }) {
  const [sortLabel, setSortLabel] = useState(section.sort);
  const [desc, setDesc] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const sortCol = section.cols.find((c) => c.label === sortLabel) || section.cols[0];
  const rows = useMemo(() => [...players].sort((a, b) => (desc ? -1 : 1) * (sortCol.get(a.s) - sortCol.get(b.s))
    || a.last.localeCompare(b.last)), [players, sortCol, desc]);
  const shown = showAll ? rows : rows.slice(0, topRows);
  const colW = (c) => `${Math.round((isMobile ? 38 : 56) * (c.w || 1))}px`;
  const pad = isMobile ? "0 10px" : "0 18px";

  const onSort = (label) => {
    if (label === sortLabel) setDesc((v) => !v);
    else { setSortLabel(label); setDesc(true); }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "4px" : "8px", padding: pad, height: "34px", background: "#f3f5f8", borderTop: "1px solid #e6e9ee", borderBottom: "1px solid #e6e9ee" }}>
        {teamCell && !isMobile && <div style={{ width: "28px", flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0, fontSize: "12px", fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: color1 }}>{section.title}</div>
        {section.cols.map((c) => {
          const active = c.label === sortLabel;
          return (
            <div key={c.label} onClick={() => onSort(c.label)} style={{
              width: colW(c), flexShrink: 0, textAlign: "center", cursor: "pointer", userSelect: "none",
              fontSize: "10px", fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: active ? color1 : "#7a8597",
            }}>
              {c.label}{active ? (desc ? " ▼" : " ▲") : ""}
            </div>
          );
        })}
      </div>
      {shown.map((p, i) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: isMobile ? "4px" : "8px", padding: isMobile ? "8px 10px" : "9px 18px", background: i % 2 ? "#fafbfc" : "#fff", borderBottom: "1px solid #f0f0f0" }}>
          {/* Rank (desktop only — a phone needs the room for the name). */}
          {teamCell && !isMobile && <div style={{ width: "28px", flexShrink: 0, fontSize: "11px", fontWeight: 900, color: i < 3 ? "#f6a21d" : "#9aa5b4", fontVariantNumeric: "tabular-nums" }}>{i + 1}</div>}
          {teamCell && teamCell(p)}
          <div style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: isMobile ? "14px" : "15px", color: "#1d2733" }}>
            {p.slug ? (
              <Link to={`/player/${p.slug}`} style={{ color: color1, textDecoration: "underline", textUnderlineOffset: "2px" }}>
                <span style={{ fontWeight: 600 }}>{isMobile ? `${p.first.charAt(0)}.` : p.first}</span> <span style={{ fontWeight: 900 }}>{p.last}</span>
              </Link>
            ) : (
              <><span style={{ fontWeight: 600 }}>{isMobile ? `${p.first.charAt(0)}.` : p.first}</span> <span style={{ fontWeight: 900 }}>{p.last}</span></>
            )}
            {p.pos && <span style={{ marginLeft: "6px", fontSize: "10px", fontWeight: 800, color: "#9aa5b4" }}>{p.pos}</span>}
          </div>
          {section.cols.map((c) => (
            <div key={c.label} style={{
              width: colW(c), flexShrink: 0, textAlign: "center", fontVariantNumeric: "tabular-nums",
              fontSize: isMobile ? "13px" : "14px", fontWeight: c.label === sortLabel ? 900 : 700, color: c.label === sortLabel ? "#1d2733" : "#4a5563",
            }}>
              {c.show ? c.show(p.s) : c.get(p.s)}
            </div>
          ))}
        </div>
      ))}
      {rows.length > topRows && (
        <button onClick={() => setShowAll((v) => !v)} style={{
          display: "block", width: "100%", padding: "8px", border: "none", borderBottom: "1px solid #eef1f5", background: "#fff", cursor: "pointer",
          fontSize: "11px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: color1,
        }}>
          {showAll ? "Show less" : `Show all (${rows.length})`}
        </button>
      )}
    </div>
  );
}

// Roster players with any season stats — TeamPage.js shows the Stats tab
// only when this is non-empty.
export const playersWithStats = (roster) => (roster?.players || []).filter((p) => p.s);

// Team Stats rows: [label, key in cfbLeaders/teams]. Per game unless noted.
const TEAM_ROWS = {
  Offense: [["Points / game", "ppg"], ["Total yards / game", "ypg"], ["Passing yards / game", "passYpg"], ["Rushing yards / game", "rushYpg"],
    ["3rd down %", "thirdPct"], ["Turnover margin / game", "toMargin"]],
  Defense: [["Points allowed / game", "papg"], ["Total yards allowed / game", "yapg"], ["Passing yards allowed / game", "passYapg"],
    ["Rushing yards allowed / game", "rushYapg"], ["3rd down % allowed", "thirdPctA"]],
};
const fmtTeamStat = (k, v) => (v == null ? "—" : k === "toMargin" ? `${v > 0 ? "+" : ""}${v.toFixed(2)}` : k.startsWith("thirdPct") ? `${v.toFixed(1)}%` : v.toFixed(1));
const rankNum = (r) => Number(String(r || "").replace("T-", "")) || null;

// cfbLeaders/teams, read once per visit.
let fbsTeamsDoc = null;
function useFbsTeams(enabled) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    fbsTeamsDoc ||= getDoc(doc(db, "cfbLeaders", "teams")).then((d) => (d.exists() ? d.data() : {})).catch(() => { fbsTeamsDoc = null; return {}; });
    fbsTeamsDoc.then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [enabled]);
  return data;
}

function TeamStatsPanel({ teamId, color1, color2, isMobile }) {
  const data = useFbsTeams(true);
  if (!data) return <div style={{ padding: "28px 16px", textAlign: "center", fontSize: "13px", fontWeight: 700, color: "#888" }}>Loading team stats…</div>;
  const team = (data.teams || []).find((t) => Number(t.id) === Number(teamId));
  if (!team) return <div style={{ padding: "28px 16px", textAlign: "center", fontSize: "13px", fontWeight: 700, color: "#888" }}>No FBS team stats for this team yet.</div>;
  const total = data.teams.length;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" }}>
        {Object.entries(TEAM_ROWS).map(([side, rows], si) => (
          <div key={side} style={{ borderLeft: !isMobile && si ? "1px solid #eef1f5" : "none", borderTop: isMobile && si ? "1px solid #eef1f5" : "none" }}>
            <div style={{ padding: "10px 16px", fontSize: "12px", fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: color1, background: "#f3f5f8", borderBottom: "1px solid #e6e9ee" }}>
              {side}
            </div>
            {rows.map(([label, k], i) => {
              const r = team.r?.[k];
              const rn = rankNum(r);
              // Top 25 nationally in the team's second color, bottom 25 muted.
              const tone = rn && rn <= 25 ? color2 : rn && rn > total - 25 ? "#b0b8c4" : "#6b7686";
              return (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: "10px", padding: isMobile ? "10px 14px" : "11px 16px", background: i % 2 ? "#fafbfc" : "#fff", borderBottom: "1px solid #f0f0f0" }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: isMobile ? "13px" : "14px", fontWeight: 800, color: "#1d2733" }}>{label}</div>
                  <div style={{ fontSize: isMobile ? "17px" : "19px", fontWeight: 900, color: color1, fontVariantNumeric: "tabular-nums" }}>{fmtTeamStat(k, team.v?.[k])}</div>
                  <div style={{ width: "64px", flexShrink: 0, textAlign: "right", fontSize: "12px", fontWeight: 900, color: tone, fontVariantNumeric: "tabular-nums" }} title={r ? `${r} of ${total} FBS teams` : undefined}>
                    {r ? r.replace(/^(T-)?/, "$1#") : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "6px 12px", padding: "10px 16px", fontSize: "11px", fontWeight: 700, color: "#9aa5b4" }}>
        <span>{team.g} games · ranks among all {total} FBS teams</span>
        <Link to="/cfb/stats/team-offense" style={{ color: color1, fontWeight: 900, textDecoration: "none" }}>All FBS team stats →</Link>
      </div>
    </div>
  );
}

export default function TeamStats({ roster, color1, color2, isMobile }) {
  const withStats = useMemo(() => playersWithStats(roster), [roster]);
  const sections = SECTIONS.map((sec) => ({ sec, players: withStats.filter((p) => sec.has(p.s)) })).filter((x) => x.players.length);
  const [view, setView] = useState("players");
  const subTab = (key, label) => (
    <button key={key} type="button" onClick={() => setView(key)} style={{
      background: "none", border: 0, cursor: "pointer", fontFamily: "inherit", padding: "8px 2px", marginBottom: "-2px",
      borderBottom: `3px solid ${view === key ? color2 : "transparent"}`, color: view === key ? color1 : "#9aa5b4",
      fontSize: isMobile ? "13px" : "15px", fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase",
    }}>
      {label}
    </button>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: isMobile ? "16px" : "24px", borderBottom: "2px solid #e6e9ee", marginBottom: "14px" }}>
        {subTab("players", "Player Stats")}
        {subTab("team", "Team Stats")}
      </div>
      <div style={{ border: `2px solid ${color1}`, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
        <div style={{ background: color1, padding: "10px 16px" }}>
          <div style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? "13px" : "15px", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {roster?.season} {view === "team" ? "Team Stats" : "Season Stats"}
          </div>
        </div>
        <div style={{ height: "3px", background: color2 }} />
        {view === "team" ? (
          <TeamStatsPanel teamId={roster?.teamId} color1={color1} color2={color2} isMobile={isMobile} />
        ) : sections.length === 0 ? (
          <div style={{ padding: "28px 16px", textAlign: "center", fontSize: "13px", fontWeight: 700, color: "#888" }}>No stats yet this season.</div>
        ) : sections.map(({ sec, players }) => (
          <StatTable key={sec.key} section={sec} players={players} color1={color1} isMobile={isMobile} />
        ))}
      </div>
    </div>
  );
}
