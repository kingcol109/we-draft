// src/components/CfbLeaders.js
//
// The CFB page's Stats tab (CFBPage.js, /cfb/stats[/:cat]): national FBS
// stat leaders. One read — cfbLeaders/current, the top 50 in each category,
// rebuilt weekly by scripts/syncCfbdRosters.js from CFBD's season totals.
// /cfb/stats shows every category's top 5 as cards, /cfb/stats/:group
// (passing, rushing, …) that group's sortable national stat table(s)
// (cfbLeaders/tables — read only once a group is opened — in TeamStats.js's
// tables, filterable by draft class via ?class=2028, and Rushing by QB via
// ?pos=qb / ?pos=noqb), and /cfb/stats/:cat (passYds, …)
// that category's full list — all under the Player Stats heading. Team
// Stats (/cfb/stats/team-offense, /cfb/stats/team-defense; /cfb/stats/teams
// is Offense): every FBS team's yards and points per game, gained or
// allowed, with national ranks (cfbLeaders/teams, scripts/syncCfbdTeamStats.js
// — read only once Team Stats is opened).
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { db } from "../firebase";
import { doc, getDoc } from "firebase/firestore";
import LoadingSpinner from "./LoadingSpinner";
import { SECTIONS, StatTable } from "./TeamStats";
import { cfbSeo } from "../utils/cfbSeo";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";
const CARD_ROWS = 5;
// Group headers, in order. The sync's "Kicking" group shows as Specials.
const GROUPS = ["Passing", "Rushing", "Receiving", "Defense", "Specials"];
const groupOf = (c) => (c.group === "Kicking" ? "Specials" : c.group);
const groupSlug = (g) => g.toLowerCase();
// Group header → its TeamStats.js table sections.
const GROUP_TABLES = { Passing: ["passing"], Rushing: ["rushing"], Receiving: ["receiving"], Defense: ["defense"], Specials: ["kicking", "punting"] };
const TABLE_ROWS = 25;

const pill = (on) => ({
  flexShrink: 0, padding: "6px 12px", borderRadius: "20px", border: `2px solid ${SITE_BLUE}`,
  background: on ? SITE_BLUE : "#fff", color: on ? "#fff" : SITE_BLUE,
  fontSize: "11px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.04em", textDecoration: "none", whiteSpace: "nowrap",
});

// Rank with ties ("T3") — rows arrive sorted by value.
const withRanks = (rows) => rows.map((r, i) => {
  const first = rows.findIndex((x) => x.v === r.v);
  const tied = rows[first + 1]?.v === r.v;
  return { ...r, rank: `${tied ? "T" : ""}${first + 1}` };
});

const fmtUpdated = (ts) => {
  const d = ts?.toDate?.();
  return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
};

function Logo({ school, size }) {
  return school?.Logo1 ? (
    <img src={school.Logo1} alt="" loading="lazy" style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }}
      onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
  ) : (
    <div style={{ width: size, height: size, flexShrink: 0 }} />
  );
}

function PlayerName({ row, short }) {
  const name = (
    <><span style={{ fontWeight: 600 }}>{short ? `${row.first.charAt(0)}.` : row.first}</span> <span style={{ fontWeight: 900 }}>{row.last}</span></>
  );
  return row.slug ? (
    <Link to={`/player/${row.slug}`} style={{ color: SITE_BLUE, textDecoration: "underline", textUnderlineOffset: "2px" }}>{name}</Link>
  ) : <span style={{ color: "#1d2733" }}>{name}</span>;
}

function TeamLabel({ row, school, short }) {
  const label = short ? school?.Short || row.school : row.school;
  return school?.Slug ? (
    <Link to={`/team/${school.Slug}`} style={{ color: "#6b7686", textDecoration: "none" }}>{label}</Link>
  ) : <span>{label}</span>;
}

function LeaderCard({ cat, schoolsByName }) {
  const rows = withRanks(cat.rows).slice(0, CARD_ROWS);
  const [top, ...rest] = rows;
  const topSchool = top && schoolsByName[top.school];
  const accent = topSchool?.Color1 || SITE_BLUE;

  return (
    <div style={{ border: `2px solid ${SITE_BLUE}`, borderRadius: "10px", overflow: "hidden", background: "#fff", display: "flex", flexDirection: "column" }}>
      <div style={{ background: SITE_BLUE, padding: "8px 14px" }}>
        <div style={{ color: SITE_GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>{cat.title}</div>
      </div>
      <div style={{ height: "3px", background: SITE_GOLD }} />
      {!top ? (
        <div style={{ padding: "24px 14px", textAlign: "center", fontSize: "13px", fontWeight: 700, color: "#999" }}>No stats yet.</div>
      ) : (
        <>
          <div style={{
            display: "flex", alignItems: "center", gap: "12px", padding: "14px 14px 14px 18px",
            background: `linear-gradient(${accent}, ${accent}) left / 4px 100% no-repeat, #fff`, borderBottom: "1px solid #eef1f5",
          }}>
            <Logo school={topSchool} size="46px" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "16px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <PlayerName row={top} />
              </div>
              <div style={{ fontSize: "11px", fontWeight: 800, color: "#6b7686", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <TeamLabel row={top} school={topSchool} />{top.pos ? ` · ${top.pos}` : ""}
              </div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#9aa5b4", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{top.x}</div>
            </div>
            <div style={{ fontSize: "30px", fontWeight: 900, color: SITE_BLUE, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{top.v}</div>
          </div>
          {rest.map((r, i) => {
            const school = schoolsByName[r.school];
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "7px 14px", background: i % 2 ? "#fafbfc" : "#fff", borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ width: "24px", flexShrink: 0, fontSize: "11px", fontWeight: 900, color: "#9aa5b4" }}>{r.rank}</div>
                <Logo school={school} size="20px" />
                <div style={{ flex: 1, minWidth: 0, fontSize: "13px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  <PlayerName row={r} short />
                  <span style={{ marginLeft: "6px", fontSize: "11px", fontWeight: 800 }}><TeamLabel row={r} school={school} short /></span>
                </div>
                <div style={{ fontSize: "14px", fontWeight: 900, color: "#1d2733", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{r.v}</div>
              </div>
            );
          })}
        </>
      )}
      <Link to={`/cfb/stats/${cat.key}`} style={{
        marginTop: "auto", display: "block", padding: "8px", textAlign: "center", textDecoration: "none",
        fontSize: "11px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: SITE_BLUE,
      }}>
        Full Leaderboard →
      </Link>
    </div>
  );
}

function LeaderTable({ cat, schoolsByName, isMobile }) {
  const rows = useMemo(() => withRanks(cat.rows), [cat]);
  return (
    <div style={{ border: `2px solid ${SITE_BLUE}`, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
      <div style={{ background: SITE_BLUE, padding: "10px 16px" }}>
        <div style={{ color: SITE_GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          {cat.title} · Top {rows.length}
        </div>
      </div>
      <div style={{ height: "3px", background: SITE_GOLD }} />
      {rows.length === 0 && (
        <div style={{ padding: "28px 16px", textAlign: "center", fontSize: "13px", fontWeight: 700, color: "#888" }}>No stats yet this season.</div>
      )}
      {rows.map((r, i) => {
        const school = schoolsByName[r.school];
        return (
          <div key={r.id} style={{
            display: "flex", alignItems: "center", gap: isMobile ? "8px" : "12px", padding: isMobile ? "9px 10px" : "10px 18px",
            background: i % 2 ? "#fafbfc" : "#fff", borderBottom: "1px solid #f0f0f0",
          }}>
            <div style={{ width: "30px", flexShrink: 0, fontSize: "12px", fontWeight: 900, color: i < 3 ? SITE_GOLD : "#9aa5b4" }}>{r.rank}</div>
            <Logo school={school} size={isMobile ? "26px" : "30px"} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: isMobile ? "14px" : "15px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <PlayerName row={r} short={isMobile} />
                {r.pos && <span style={{ marginLeft: "6px", fontSize: "10px", fontWeight: 800, color: "#9aa5b4" }}>{r.pos}</span>}
              </div>
              <div style={{ fontSize: "11px", fontWeight: 800, color: "#6b7686", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <TeamLabel row={r} school={school} short={isMobile} />
                {isMobile && <span style={{ color: "#9aa5b4", fontWeight: 700 }}> · {r.x}</span>}
              </div>
            </div>
            {!isMobile && (
              <div style={{ width: "230px", flexShrink: 0, fontSize: "12px", fontWeight: 700, color: "#7a8597", textAlign: "right" }}>{r.x}</div>
            )}
            <div style={{ width: isMobile ? "44px" : "60px", flexShrink: 0, textAlign: "right", fontSize: isMobile ? "16px" : "18px", fontWeight: 900, color: SITE_BLUE, fontVariantNumeric: "tabular-nums" }}>{r.v}</div>
          </div>
        );
      })}
    </div>
  );
}

// The Teams tables: Offense (gained) and Defense (allowed), each sortable by
// any stat column. A cell is the per-game number over its national rank.
const TEAM_TABLES = [
  { title: "Offense", slug: "team-offense", cols: [["ppg", "Pts"], ["ypg", "Yds"], ["passYpg", "Pass"], ["rushYpg", "Rush"], ["thirdPct", "3rd %"]] },
  { title: "Defense", slug: "team-defense", cols: [["papg", "Pts"], ["yapg", "Yds"], ["passYapg", "Pass"], ["rushYapg", "Rush"], ["thirdPctA", "3rd %"], ["toMargin", "TO +/-"]] },
];
// 3rd down as a %, turnover margin (per game) signed.
const fmtTeamStat = (k, v) => (v == null ? "—" : k === "toMargin" ? `${v > 0 ? "+" : ""}${v.toFixed(2)}` : k.startsWith("thirdPct") ? `${v.toFixed(1)}%` : v);
const rankNum = (r) => Number(String(r || "").replace("T-", "")) || 999;

function TeamTable({ table, teams, schoolsByName, isMobile }) {
  const [sortKey, setSortKey] = useState(table.cols[0][0]);
  const [flip, setFlip] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // Sorted by national rank in the column (best first); a second click flips it.
  const rows = useMemo(() => [...teams].sort((a, b) => (flip ? -1 : 1) * (rankNum(a.r[sortKey]) - rankNum(b.r[sortKey])) || a.school.localeCompare(b.school)),
    [teams, sortKey, flip]);
  const shown = showAll ? rows : rows.slice(0, TABLE_ROWS);
  const colW = isMobile ? (table.cols.length > 5 ? "44px" : "50px") : "78px";
  const pad = isMobile ? "0 10px" : "0 18px";
  const onSort = (k) => { if (k === sortKey) setFlip((v) => !v); else { setSortKey(k); setFlip(false); } };
  return (
    <div style={{ border: `2px solid ${SITE_BLUE}`, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "4px" : "8px", padding: pad, height: "34px", background: "#f3f5f8", borderBottom: "1px solid #e6e9ee" }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: "12px", fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: SITE_BLUE }}>
          {table.title} <span style={{ color: "#9aa5b4", fontSize: "10px" }}>per game</span>
        </div>
        {table.cols.map(([k, label]) => {
          const on = k === sortKey;
          return (
            <div key={k} onClick={() => onSort(k)} style={{
              width: colW, flexShrink: 0, textAlign: "center", cursor: "pointer", userSelect: "none",
              fontSize: "10px", fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: on ? SITE_BLUE : "#7a8597",
            }}>
              {label}{on ? (flip ? " ▲" : " ▼") : ""}
            </div>
          );
        })}
      </div>
      {shown.map((t, i) => {
        const school = schoolsByName[t.school];
        return (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: isMobile ? "4px" : "8px", padding: pad, minHeight: "44px", background: i % 2 ? "#fafbfc" : "#fff", borderBottom: "1px solid #f0f0f0" }}>
            <div style={{ width: isMobile ? "30px" : "36px", flexShrink: 0, fontSize: "11px", fontWeight: 900, color: rankNum(t.r[sortKey]) <= 3 ? SITE_GOLD : "#9aa5b4" }}>{t.r[sortKey] || "—"}</div>
            <Logo school={school} size={isMobile ? "20px" : "24px"} />
            <div style={{ flex: 1, minWidth: 0, fontSize: isMobile ? "13px" : "14px", fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {school?.Slug ? <Link to={`/team/${school.Slug}`} style={{ color: "#1d2733", textDecoration: "none" }}>{isMobile ? school.Short || t.school : t.school}</Link> : t.school}
              {!isMobile && <span style={{ marginLeft: "6px", fontSize: "10px", fontWeight: 800, color: "#9aa5b4" }}>{t.g} G</span>}
            </div>
            {table.cols.map(([k]) => (
              <div key={k} style={{ width: colW, flexShrink: 0, textAlign: "center", lineHeight: 1.15 }}>
                <div style={{ fontSize: isMobile ? "13px" : "14px", fontWeight: 900, color: k === sortKey ? SITE_BLUE : "#1d2733", fontVariantNumeric: "tabular-nums" }}>{fmtTeamStat(k, t.v[k])}</div>
                <div style={{ fontSize: "10px", fontWeight: 800, color: "#9aa5b4" }}>{t.r[k] ? t.r[k].replace(/^(T-)?/, "$1#") : ""}</div>
              </div>
            ))}
          </div>
        );
      })}
      {rows.length > TABLE_ROWS && (
        <button type="button" onClick={() => setShowAll((v) => !v)} style={{
          display: "block", width: "100%", padding: "9px", border: 0, background: "#fff", cursor: "pointer", fontFamily: "inherit",
          fontSize: "11px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: SITE_BLUE,
        }}>
          {showAll ? "Show top 25" : `Show all ${rows.length} teams`}
        </button>
      )}
    </div>
  );
}

function TeamStatsView({ data, table, schoolsByName, isMobile }) {
  if (!data) return <LoadingSpinner label="Loading Team Stats" size={40} minHeight="200px" />;
  if (!data.teams?.length) {
    return <div style={{ padding: "24px 16px", textAlign: "center", fontSize: "13px", fontWeight: 700, color: "#888" }}>Team stats fill in after the next stats sync.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <TeamTable key={table.slug} table={table} teams={data.teams} schoolsByName={schoolsByName} isMobile={isMobile} />
      <div style={{ fontSize: "11px", fontWeight: 700, color: "#9aa5b4" }}>
        Click a column to sort. Per game except 3rd down %; ranks are among all {data.teams.length} FBS teams.
        {table.slug === "team-defense" ? " Fewer allowed ranks higher. TO +/-: turnovers forced minus turnovers lost." : ""}
      </div>
    </div>
  );
}

export default function CfbLeaders({ schoolsByName, catKey, isMobile }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState(null);
  const [params, setParams] = useSearchParams();
  const draftClass = Number(params.get("class")) || null;
  const qbFilter = ["qb", "noqb"].includes(params.get("pos")) ? params.get("pos") : null;
  // One filter changed, the others kept.
  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const onGroup = GROUPS.some((g) => groupSlug(g) === catKey);
  // Team Stats' open table (Offense / Defense), or null on Player Stats.
  const teamTable = catKey === "teams" ? TEAM_TABLES[0] : TEAM_TABLES.find((t) => t.slug === catKey) || null;
  const onTeams = !!teamTable;
  const [teamData, setTeamData] = useState(null);
  useEffect(() => {
    if (!onTeams || teamData) return;
    getDoc(doc(db, "cfbLeaders", "teams"))
      .then((d) => setTeamData(d.exists() ? d.data() : {}))
      .catch((err) => { console.error("Error fetching CFB team stats:", err); setTeamData({}); });
  }, [onTeams, teamData]);

  useEffect(() => {
    getDoc(doc(db, "cfbLeaders", "current"))
      .then((d) => setData(d.exists() ? d.data() : null))
      .catch((err) => console.error("Error fetching CFB stat leaders:", err))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!onGroup || tables) return;
    getDoc(doc(db, "cfbLeaders", "tables"))
      .then((d) => setTables(d.exists() ? d.data().tables || {} : {}))
      .catch((err) => { console.error("Error fetching CFB stat tables:", err); setTables({}); });
  }, [onGroup, tables]);
  // Prerender: ready once this view's data is in (CFBPage.js holds it).
  const viewReady = !loading && (!onTeams || !!teamData) && (!onGroup || !!tables);
  useEffect(() => { if (viewReady) window.prerenderReady = true; }, [viewReady]);
  // Draft classes present in the tables, for the filter.
  const classes = useMemo(() => [...new Set(Object.values(tables || {}).flat().map((p) => p.dc).filter(Boolean))].sort(), [tables]);

  if (loading) return <LoadingSpinner label="Loading Leaders" size={48} minHeight="240px" />;

  const cats = data?.categories || [];
  if (cats.length === 0 && !onTeams) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "14px" }}>
        No stat leaders available yet.
      </div>
    );
  }

  const active = catKey && cats.find((c) => c.key === catKey);
  const updated = fmtUpdated(onTeams ? teamData?.updatedAt : data?.updatedAt);
  const groups = GROUPS.filter((g) => cats.some((c) => groupOf(c) === g));
  // The open group: the active category's, or one named in the URL.
  const group = active ? groupOf(active) : groups.find((g) => groupSlug(g) === catKey) || null;
  // The second row of headers: Player Stats' groups, or Team Stats' sides.
  const subTabs = onTeams
    ? TEAM_TABLES.map((t) => ({ key: t.slug, label: t.title, to: `/cfb/stats/${t.slug}`, on: t === teamTable }))
    : [null, ...groups].map((g) => ({ key: g || "all", label: g || "All", to: g ? `/cfb/stats/${groupSlug(g)}${draftClass ? `?class=${draftClass}` : ""}` : "/cfb/stats", on: g === group }));
  const headTab = (on) => ({
    flex: isMobile ? 1 : "0 0 auto", padding: isMobile ? "10px 12px" : "10px 22px", borderRadius: "10px", textAlign: "center", textDecoration: "none", whiteSpace: "nowrap",
    border: `2px solid ${SITE_BLUE}`, background: on ? SITE_BLUE : "#fff", color: on ? SITE_GOLD : SITE_BLUE,
    fontSize: isMobile ? "14px" : "16px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase",
  });

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 12px", marginBottom: "14px" }}>
        {/* The page's H1 — the view's own (utils/cfbSeo.js), e.g. "2026
            College Football Rushing Leaders". */}
        <h1 style={{ margin: 0, fontSize: isMobile ? "15px" : "18px", fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: SITE_BLUE }}>
          {cfbSeo({ tab: "stats", cat: catKey }).h1}
        </h1>
        {updated && <div style={{ fontSize: "11px", fontWeight: 700, color: "#9aa5b4" }}>Regular season · updated {updated}</div>}
      </div>

      {/* Headings: Player Stats / Team Stats */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
        <Link to="/cfb/stats" replace style={headTab(!onTeams)}>Player Stats</Link>
        <Link to={`/cfb/stats/${TEAM_TABLES[0].slug}`} replace style={headTab(onTeams)}>Team Stats</Link>
      </div>

      {/* Sub headings: the player stat groups, or Offense / Defense */}
      <style>{`.cfbl-scroll { overflow-x: auto; overflow-y: hidden; scrollbar-width: none; } .cfbl-scroll::-webkit-scrollbar { display: none; }`}</style>
      <div className="cfbl-scroll" style={{ display: "flex", gap: isMobile ? "14px" : "22px", borderBottom: "2px solid #e6e9ee", marginBottom: "16px" }}>
        {subTabs.map((t) => (
          <Link key={t.key} to={t.to} replace style={{
            flexShrink: 0, padding: "8px 2px", marginBottom: "-2px", textDecoration: "none", whiteSpace: "nowrap",
            borderBottom: `3px solid ${t.on ? SITE_GOLD : "transparent"}`,
            fontSize: isMobile ? "13px" : "15px", fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase",
            color: t.on ? SITE_BLUE : "#9aa5b4",
          }}>
            {t.label}
          </Link>
        ))}
      </div>

      {onTeams ? (
        <TeamStatsView data={teamData} table={teamTable} schoolsByName={schoolsByName} isMobile={isMobile} />
      ) : active ? (
        <>
          <div className="cfbl-scroll" style={{ display: "flex", gap: "6px", paddingBottom: "6px", marginBottom: "12px" }}>
            {cats.filter((c) => groupOf(c) === group).map((c) => (
              <Link key={c.key} to={`/cfb/stats/${c.key}`} replace style={pill(c.key === active.key)}>{c.title}</Link>
            ))}
          </div>
          <LeaderTable cat={active} schoolsByName={schoolsByName} isMobile={isMobile} />
        </>
      ) : group ? (
        !tables ? <LoadingSpinner label="Loading Stats" size={40} minHeight="200px" /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          {classes.length > 0 && (
            <div className="cfbl-scroll" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ flexShrink: 0, fontSize: "11px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "#7a8597", marginRight: "4px" }}>Draft class</span>
              {[null, ...classes].map((c) => (
                <button key={c || "all"} type="button" style={{ ...pill(c === draftClass), cursor: "pointer", fontFamily: "inherit" }}
                  onClick={() => setFilter("class", c ? String(c) : null)}>
                  {c || "All"}
                </button>
              ))}
            </div>
          )}
          {group === "Rushing" && (
            <div className="cfbl-scroll" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ flexShrink: 0, fontSize: "11px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "#7a8597", marginRight: "4px" }}>Position</span>
              {[[null, "All"], ["qb", "QBs only"], ["noqb", "No QBs"]].map(([v, label]) => (
                <button key={label} type="button" style={{ ...pill(v === qbFilter), cursor: "pointer", fontFamily: "inherit" }}
                  onClick={() => setFilter("pos", v)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {GROUP_TABLES[group].map((key) => {
            const section = SECTIONS.find((x) => x.key === key);
            const players = (tables[key] || []).filter((p) => section.has(p.s) && (!draftClass || p.dc === draftClass)
              && (key !== "rushing" || !qbFilter || (qbFilter === "qb") === (p.pos === "QB")));
            return (
              <div key={key} style={{ border: `2px solid ${SITE_BLUE}`, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
                {players.length ? (
                  <StatTable section={section} players={players} color1={SITE_BLUE} isMobile={isMobile} topRows={TABLE_ROWS}
                    teamCell={(p) => <Logo school={schoolsByName[p.school]} size={isMobile ? "18px" : "22px"} />} />
                ) : (
                  <div style={{ padding: "24px 16px", textAlign: "center", fontSize: "13px", fontWeight: 700, color: "#888" }}>
                    {tables[key]?.length ? `No players match these filters in ${section.title.toLowerCase()} yet.` : `${section.title} table fills in after the next stats sync.`}
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#9aa5b4" }}>
            Click a column to sort. Includes each stat's top 50 FBS players{draftClass ? ` in the ${draftClass} class` : ""}.
            Draft class is the player's We-Draft class, else estimated from their recruiting class.
          </div>
        </div>
        )
      ) : groups.map((g) => (
        <div key={g} style={{ marginBottom: isMobile ? "24px" : "32px" }}>
          <div style={{ marginBottom: isMobile ? "10px" : "14px" }}>
            <div style={{ fontSize: isMobile ? "16px" : "20px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", color: SITE_BLUE, marginBottom: "5px" }}>{g}</div>
            <div style={{ height: "3px", backgroundColor: SITE_BLUE, borderRadius: "2px" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))", gap: isMobile ? "12px" : "16px" }}>
            {cats.filter((c) => groupOf(c) === g).map((c) => <LeaderCard key={c.key} cat={c} schoolsByName={schoolsByName} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
