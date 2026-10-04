// src/components/TeamRoster.js
//
// The CFB team page's Roster tab (TeamPage.js): the full CFBD roster from
// cfbRosters/{CFBDTeamId} (scripts/syncCfbdRosters.js) — every player, not
// just We-Draft prospects. A player with a We-Draft profile has his name in
// the team color, underlined, linking to it.
// Sortable columns + an Offense / Defense / Special Teams filter.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

const POS_ORDER = ["QB", "RB", "FB", "WR", "TE", "OL", "OT", "OG", "C", "IOL", "DL", "DE", "DT", "NT", "EDGE", "LB", "OLB", "ILB", "DB", "CB", "S", "FS", "SS", "K", "PK", "P", "LS", "ATH"];
const UNIT = {
  offense: ["QB", "RB", "FB", "WR", "TE", "OL", "OT", "OG", "C", "IOL"],
  defense: ["DL", "DE", "DT", "NT", "EDGE", "LB", "OLB", "ILB", "DB", "CB", "S", "FS", "SS"],
  special: ["K", "PK", "P", "LS"],
};
const FILTERS = [["all", "All"], ["offense", "Offense"], ["defense", "Defense"], ["special", "Special Teams"]];

const posRank = (p) => { const i = POS_ORDER.indexOf(p); return i === -1 ? POS_ORDER.length : i; };
// CFBD class year: 1-4, or a recruiting-class year (e.g. 2026) for newly
// added freshmen.
const classOf = (yr) => (yr == null ? "" : yr > 1000 ? "FR" : ["", "FR", "SO", "JR", "SR"][yr] || "GR");
const classRank = (yr) => (yr == null ? 99 : yr > 1000 ? 0.5 : yr);
const STAR_GOLD = "#e8a317";
const recruitTip = (p) => [p.stars && `${p.stars}-star recruit`, p.rating && `rating ${p.rating.toFixed(4)}`, p.rank && `#${p.rank} nationally`].filter(Boolean).join(" · ");
const heightOf = (ht) => (ht ? `${Math.floor(ht / 12)}-${ht % 12}` : "");

const SORTS = {
  no: (a, b) => (a.no ?? 999) - (b.no ?? 999),
  name: (a, b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first),
  pos: (a, b) => posRank(a.pos) - posRank(b.pos),
  yr: (a, b) => classRank(a.yr) - classRank(b.yr),
  ht: (a, b) => (a.ht || 0) - (b.ht || 0),
  wt: (a, b) => (a.wt || 0) - (b.wt || 0),
  home: (a, b) => (a.home || "~").localeCompare(b.home || "~"),
  // Best recruit first on the first click.
  stars: (a, b) => (b.stars || 0) - (a.stars || 0) || (b.rating || 0) - (a.rating || 0),
};

export default function TeamRoster({ roster, color1, color2, isMobile }) {
  const [unit, setUnit] = useState("all");
  const [sortKey, setSortKey] = useState("no");
  const [asc, setAsc] = useState(true);
  const onSort = (key) => {
    if (key === sortKey) setAsc((v) => !v);
    else { setSortKey(key); setAsc(true); }
  };

  const players = useMemo(() => roster?.players || [], [roster]);
  const rows = useMemo(() => {
    const list = unit === "all" ? players : players.filter((p) => UNIT[unit].includes(p.pos));
    const cmp = SORTS[sortKey];
    return [...list].sort((a, b) => (asc ? 1 : -1) * cmp(a, b) || SORTS.no(a, b) || SORTS.name(a, b));
  }, [players, unit, sortKey, asc]);

  const cols = [
    { key: "no", label: "#", width: isMobile ? "34px" : "44px" },
    { key: "name", label: "Player", flex: true },
    { key: "pos", label: "Pos", width: isMobile ? "44px" : "52px" },
    { key: "yr", label: "Class", width: isMobile ? "44px" : "56px" },
    { key: "stars", label: "★", width: isMobile ? "34px" : "78px" },
    { key: "ht", label: "Ht", width: isMobile ? "38px" : "48px" },
    // Phones drop weight and hometown so the name keeps room.
    ...(isMobile ? [] : [{ key: "wt", label: "Wt", width: "48px" }, { key: "home", label: "Hometown", width: "180px", left: true }]),
  ];
  const col = Object.fromEntries(cols.map((c) => [c.key, c]));
  const cellBox = (c) => (c.flex ? { flex: 1, minWidth: 0 } : { width: c.width, flexShrink: 0 });
  const gap = isMobile ? "6px" : "10px";
  const pad = isMobile ? "0 10px" : "0 18px";

  return (
    <div style={{ border: `2px solid ${color1}`, borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ background: color1, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? "13px" : "15px", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {roster?.season} Roster ({players.length})
        </div>
      </div>
      <div style={{ height: "3px", background: color2 }} />

      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", padding: "10px 12px", background: "#f8f9fb", borderBottom: "1px solid #eef1f5" }}>
        {FILTERS.map(([key, label]) => {
          const count = key === "all" ? players.length : players.filter((p) => UNIT[key].includes(p.pos)).length;
          const on = unit === key;
          return (
            <button key={key} onClick={() => setUnit(key)} style={{
              padding: "5px 12px", borderRadius: "999px", cursor: "pointer", fontWeight: 900, fontSize: "11px",
              textTransform: "uppercase", letterSpacing: "0.06em",
              border: `1.5px solid ${color1}`, background: on ? color1 : "#fff", color: on ? "#fff" : color1,
            }}>
              {label} <span style={{ opacity: 0.7 }}>{count}</span>
            </button>
          );
        })}
      </div>

      <div style={{
        position: "sticky", top: 0, zIndex: 10, display: "flex", alignItems: "center", gap, padding: pad, height: "36px",
        background: `${color1}f5`, borderBottom: `3px solid ${color2}`,
      }}>
        {cols.map((c) => {
          const active = sortKey === c.key;
          return (
            <div key={c.key} onClick={() => onSort(c.key)} style={{
              ...cellBox(c), cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: "3px",
              justifyContent: c.flex || c.left ? "flex-start" : "center",
              fontSize: "11px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: active ? color2 : "#fff",
            }}>
              <span>{c.label}</span>
              <span style={{ fontSize: "9px", opacity: active ? 1 : 0.5 }}>{active && !asc ? "▼" : "▲"}</span>
            </div>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: "28px 16px", textAlign: "center", background: "#fff", fontSize: "13px", fontWeight: 700, color: "#888" }}>No players.</div>
      ) : rows.map((p, i) => {
        const inner = (
          <>
            <div style={{ ...cellBox(col.no), textAlign: "center", fontSize: isMobile ? "14px" : "16px", fontWeight: 900, color: color1, fontVariantNumeric: "tabular-nums" }}>
              {p.no ?? "–"}
            </div>
            <div style={{ ...cellBox(col.name), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: isMobile ? "15px" : "17px", color: "#1d2733" }}>
              {p.slug ? (
                <Link to={`/player/${p.slug}`} style={{ color: color1, textDecoration: "underline", textUnderlineOffset: "2px" }}>
                  <span style={{ fontWeight: 600 }}>{p.first}</span> <span style={{ fontWeight: 900 }}>{p.last}</span>
                </Link>
              ) : (
                <><span style={{ fontWeight: 600 }}>{p.first}</span> <span style={{ fontWeight: 900 }}>{p.last}</span></>
              )}
            </div>
            <div style={{ ...cellBox(col.pos), display: "flex", justifyContent: "center" }}>
              {p.pos && (
                <span style={{ background: color1, color: "#fff", fontSize: isMobile ? "10px" : "11px", fontWeight: 900, padding: "3px 0", borderRadius: "4px", width: "100%", textAlign: "center" }}>{p.pos}</span>
              )}
            </div>
            <div style={{ ...cellBox(col.yr), textAlign: "center", fontSize: "13px", fontWeight: 800, color: "#444" }}>{classOf(p.yr)}</div>
            <div title={recruitTip(p) || undefined} style={{ ...cellBox(col.stars), textAlign: "center", whiteSpace: "nowrap", color: STAR_GOLD, fontSize: isMobile ? "12px" : "13px", fontWeight: 900, letterSpacing: isMobile ? 0 : "1px" }}>
              {p.stars ? (isMobile ? `${p.stars}★` : "★".repeat(p.stars)) : <span style={{ color: "#ccd2da" }}>–</span>}
            </div>
            <div style={{ ...cellBox(col.ht), textAlign: "center", fontSize: "13px", fontWeight: 700, color: "#444", fontVariantNumeric: "tabular-nums" }}>{heightOf(p.ht)}</div>
            {!isMobile && (
              <div style={{ ...cellBox(col.wt), textAlign: "center", fontSize: "13px", fontWeight: 700, color: "#444", fontVariantNumeric: "tabular-nums" }}>{p.wt || ""}</div>
            )}
            {!isMobile && (
              <div style={{ ...cellBox(col.home), fontSize: "12px", fontWeight: 600, color: "#6b7685", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.home || ""}</div>
            )}
          </>
        );
        return (
          <div key={p.id} style={{
            display: "flex", alignItems: "center", gap, padding: isMobile ? "9px 10px" : "10px 18px",
            background: i % 2 ? "#fafbfc" : "#fff", borderBottom: "1px solid #f0f0f0",
          }}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
