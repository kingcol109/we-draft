// src/components/TeamStats.js
//
// The CFB team page's Stats tab (TeamPage.js): season stat tables —
// Passing, Rushing, Receiving, Defense, Kicking, Punting — for every player
// on the roster doc (cfbRosters/{CFBDTeamId}.players[].s, written by
// scripts/syncCfbdRosters.js from CFBD's season totals). Each table sorts by
// any column (its headline stat by default) and shows the top TOP_ROWS
// until "Show all".
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

const TOP_ROWS = 8;
const n = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const per = (a, b, digits = 1) => (n(b) ? (n(a) / n(b)).toFixed(digits) : "–");
const pct = (a, b) => (n(b) ? ((100 * n(a)) / n(b)).toFixed(1) : "–");

// Columns: label, get (number used for sorting), show (display; defaults
// to get). The first column in `sort` is the table's default sort.
const SECTIONS = [
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

function StatTable({ section, players, color1, isMobile }) {
  const [sortLabel, setSortLabel] = useState(section.sort);
  const [desc, setDesc] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const sortCol = section.cols.find((c) => c.label === sortLabel) || section.cols[0];
  const rows = useMemo(() => [...players].sort((a, b) => (desc ? -1 : 1) * (sortCol.get(a.s) - sortCol.get(b.s))
    || a.last.localeCompare(b.last)), [players, sortCol, desc]);
  const shown = showAll ? rows : rows.slice(0, TOP_ROWS);
  const colW = (c) => `${Math.round((isMobile ? 38 : 56) * (c.w || 1))}px`;
  const pad = isMobile ? "0 10px" : "0 18px";

  const onSort = (label) => {
    if (label === sortLabel) setDesc((v) => !v);
    else { setSortLabel(label); setDesc(true); }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "4px" : "8px", padding: pad, height: "34px", background: "#f3f5f8", borderTop: "1px solid #e6e9ee", borderBottom: "1px solid #e6e9ee" }}>
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
      {rows.length > TOP_ROWS && (
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

export default function TeamStats({ roster, color1, color2, isMobile }) {
  const withStats = useMemo(() => playersWithStats(roster), [roster]);
  const sections = SECTIONS.map((sec) => ({ sec, players: withStats.filter((p) => sec.has(p.s)) })).filter((x) => x.players.length);

  return (
    <div style={{ border: `2px solid ${color1}`, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
      <div style={{ background: color1, padding: "10px 16px" }}>
        <div style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? "13px" : "15px", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {roster?.season} Season Stats
        </div>
      </div>
      <div style={{ height: "3px", background: color2 }} />
      {sections.length === 0 ? (
        <div style={{ padding: "28px 16px", textAlign: "center", fontSize: "13px", fontWeight: 700, color: "#888" }}>No stats yet this season.</div>
      ) : sections.map(({ sec, players }) => (
        <StatTable key={sec.key} section={sec} players={players} color1={color1} isMobile={isMobile} />
      ))}
    </div>
  );
}
