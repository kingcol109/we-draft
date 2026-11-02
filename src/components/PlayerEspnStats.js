// src/components/PlayerEspnStats.js
//
// The Stats tab on a player page (PlayerProfile.js, after My Evaluation):
// his college career season by season and a game log for each season, read
// straight from ESPN in the browser (both endpoints send
// Access-Control-Allow-Origin: *):
//   site.web.api.espn.com/apis/common/v3/sports/football/college-football/athletes/{id}/stats
//   site.web.api.espn.com/apis/common/v3/sports/football/college-football/athletes/{id}/gamelog?season=YYYY
// The ESPN athlete id is the one his headshot was matched on
// (playerPhotos/{playerId}.headshot.espnId, scripts/importEspnHeadshots.js).
// onEmpty fires when ESPN has no stats for him, so the page can drop the tab.
import { useEffect, useState } from "react";

const BASE = "https://site.web.api.espn.com/apis/common/v3/sports/football/college-football/athletes";
// Responses for this visit, so flipping tabs or seasons doesn't refetch.
const cache = new Map();
const getJson = (url) => {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return cache.get(url);
};
export const fetchEspnCareer = (espnId) => getJson(`${BASE}/${espnId}/stats`);
const fetchGameLog = (espnId, season) => getJson(`${BASE}/${espnId}/gamelog?season=${season}`);

// The game log opens on this season when he played in it (his newest otherwise).
const CURRENT_SEASON = 2026;

// Scoring repeats the TDs already in the other tables.
const SKIP_CATEGORIES = new Set(["scoring"]);

const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}/${d.getDate()}`;
};

export default function PlayerEspnStats({ espnId, color1, color2, isMobile, onEmpty }) {
  const [career, setCareer] = useState(undefined); // undefined = loading, null = none
  // Sub-tabs: "seasons" (Season, the default) or "games" (Game Log).
  const [view, setView] = useState("seasons");
  const [season, setSeason] = useState(null);
  const [log, setLog] = useState(undefined);

  useEffect(() => {
    let live = true;
    setCareer(undefined); setSeason(null); setView("seasons");
    fetchEspnCareer(espnId).then((j) => {
      if (!live) return;
      const cats = (j?.categories || []).filter((c) => !SKIP_CATEGORIES.has(c.name) && c.statistics?.length);
      setCareer(cats.length ? { cats, teams: j.teams || {} } : null);
      if (!cats.length && onEmpty) onEmpty();
      const years = cats.flatMap((c) => c.statistics.map((s) => s.season?.year)).filter(Boolean);
      if (years.length) setSeason(years.includes(CURRENT_SEASON) ? CURRENT_SEASON : Math.max(...years));
    });
    return () => { live = false; };
  }, [espnId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The game log loads once that sub-tab is opened.
  useEffect(() => {
    if (!season || view !== "games") return undefined;
    let live = true;
    setLog(undefined);
    fetchGameLog(espnId, season).then((j) => { if (live) setLog(j || null); });
    return () => { live = false; };
  }, [espnId, season, view]);

  const fs = isMobile ? "12px" : "13px";
  const th = { padding: isMobile ? "6px 6px" : "7px 9px", fontSize: isMobile ? "10px" : "11px", fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5b6676", textAlign: "right", whiteSpace: "nowrap", borderBottom: `2px solid ${color1}` };
  const td = { padding: isMobile ? "6px 6px" : "7px 9px", fontSize: fs, fontWeight: 700, color: "#1f2937", textAlign: "right", whiteSpace: "nowrap", borderBottom: "1px solid #eef1f5", fontVariantNumeric: "tabular-nums" };
  const left = { textAlign: "left" };
  // First column stays put while the stats scroll sideways on phones.
  const sticky = { position: "sticky", left: 0, background: "#fff", zIndex: 1 };
  const tableWrap = { overflowX: "auto", WebkitOverflowScrolling: "touch", border: `1px solid #e3e8ef`, borderRadius: "8px", marginBottom: "16px" };

  if (career === undefined) {
    return <div style={{ padding: "28px 0", textAlign: "center", color: "#9aa5b4", fontWeight: 800, fontSize: "13px" }}>Loading stats…</div>;
  }
  if (career === null) {
    return <div style={{ padding: "28px 0", textAlign: "center", color: "#9aa5b4", fontWeight: 800, fontSize: "13px" }}>No college stats yet.</div>;
  }

  const teamCell = (slug) => {
    const t = career.teams[slug];
    if (!t) return null;
    const logo = t.logos?.[0]?.href;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
        {logo && <img src={logo} alt="" style={{ width: 18, height: 18, maxWidth: "none", objectFit: "contain" }} loading="lazy" referrerPolicy="no-referrer" />}
        {t.abbreviation || t.shortDisplayName}
      </span>
    );
  };

  const seasons = [...new Set(career.cats.flatMap((c) => c.statistics.map((s) => s.season?.year)).filter(Boolean))].sort((a, b) => b - a);

  // Game log: one table, its columns grouped under each ESPN category
  // (Passing | Rushing …); in the order played — regular season, then postseason.
  const renderLog = () => {
    if (log === undefined) return <div style={{ padding: "18px 0", textAlign: "center", color: "#9aa5b4", fontWeight: 800, fontSize: "13px" }}>Loading games…</div>;
    const types = (log?.seasonTypes || []).filter((t) => t.categories?.some((c) => c.events?.length))
      .sort((a, b) => /postseason/i.test(a.displayName) - /postseason/i.test(b.displayName));
    if (!types.length) return <div style={{ padding: "18px 0", textAlign: "center", color: "#9aa5b4", fontWeight: 800, fontSize: "13px" }}>No games logged for {season}.</div>;
    const labels = log.labels || [];
    const titles = log.displayNames || [];
    const groups = (log.categories || []).map((c) => ({ name: c.displayName, count: c.count }));
    // Each group's first column gets a divider so Rush Yds doesn't run into Pass TD.
    const groupStart = new Set();
    groups.reduce((i, g) => { groupStart.add(i); return i + g.count; }, 0);
    const divider = (i) => (i > 0 && groupStart.has(i) ? { borderLeft: "1px solid #e3e8ef" } : null);
    const colCount = 3 + labels.length;
    return (
      <div style={tableWrap}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontFamily: "inherit" }}>
          <thead>
            {groups.length > 1 && (
              <tr>
                <th colSpan={3} style={{ ...th, ...sticky, borderBottom: "none" }} />
                {groups.map((g, gi) => (
                  <th key={gi} colSpan={g.count} style={{ ...th, textAlign: "center", color: color1, borderBottom: "1px solid #e3e8ef", ...(gi > 0 ? { borderLeft: "1px solid #e3e8ef" } : null) }}>{g.name}</th>
                ))}
              </tr>
            )}
            <tr>
              <th style={{ ...th, ...left, ...sticky }}>Date</th>
              <th style={{ ...th, ...left }}>Opp</th>
              <th style={{ ...th, ...left }}>Result</th>
              {labels.map((l, i) => <th key={i} title={titles[i] || l} style={{ ...th, ...divider(i) }}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {types.map((t) => {
              const events = t.categories.flatMap((c) => c.events || []);
              const rows = events
                .map((e) => ({ ...e, meta: log.events?.[e.eventId] }))
                .filter((e) => e.meta)
                .sort((a, b) => new Date(a.meta.gameDate) - new Date(b.meta.gameDate));
              const total = t.summary?.stats?.find((s) => s.type === "total");
              return [
                <tr key={`${t.displayName}-h`}>
                  <td colSpan={colCount} style={{ ...td, ...left, background: "#f6f8fb", color: "#5b6676", fontSize: "11px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    <span style={{ position: "sticky", left: isMobile ? 6 : 9 }}>{t.displayName}</span>
                  </td>
                </tr>,
                ...rows.map((e) => {
                  const m = e.meta;
                  const won = m.gameResult === "W";
                  return (
                    <tr key={e.eventId}>
                      <td style={{ ...td, ...left, ...sticky, color: "#5b6676" }}>{fmtDate(m.gameDate)}</td>
                      <td style={{ ...td, ...left }}>
                        <span style={{ color: "#9aa5b4", fontSize: "11px", display: "inline-block", width: "18px" }}>{m.atVs}</span>
                        {m.opponent?.logo && <img src={m.opponent.logo} alt="" width={18} height={18} style={{ display: "inline-block", maxWidth: "none", objectFit: "contain", verticalAlign: "middle", marginRight: "5px" }} loading="lazy" referrerPolicy="no-referrer" />}
                        {m.opponent?.abbreviation}
                      </td>
                      <td style={{ ...td, ...left }}>
                        <span style={{ color: won ? "#15803d" : m.gameResult === "L" ? "#b91c1c" : "#5b6676", fontWeight: 900, marginRight: "4px" }}>{m.gameResult}</span>
                        {m.score}
                      </td>
                      {labels.map((_, i) => <td key={i} style={{ ...td, ...divider(i) }}>{e.stats?.[i] ?? ""}</td>)}
                    </tr>
                  );
                }),
                total && (
                  <tr key={`${t.displayName}-t`}>
                    <td colSpan={3} style={{ ...td, ...left, ...sticky, fontWeight: 900, color: color1 }}>Totals</td>
                    {labels.map((_, i) => <td key={i} style={{ ...td, ...divider(i), fontWeight: 900 }}>{total.stats?.[i] ?? ""}</td>)}
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const subTab = (key, label) => {
    const on = view === key;
    return (
      <button
        key={key} role="tab" aria-selected={on} onClick={() => setView(key)}
        className="font-black uppercase"
        style={{ background: "none", border: "none", margin: 0, padding: "0 0 4px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", color: on ? color1 : "#9aa5b4", fontSize: isMobile ? "12px" : "13px", letterSpacing: "0.08em", borderBottom: `2px solid ${on ? color2 : "transparent"}` }}
      >
        {label}
      </button>
    );
  };

  return (
    <div>
      {/* Sub-tabs, with the game log's season picker on the right. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", margin: "2px 0 12px" }}>
        <div role="tablist" style={{ display: "flex", gap: isMobile ? "14px" : "20px" }}>
          {subTab("seasons", "Season")}
          {subTab("games", "Game Log")}
        </div>
        {view === "games" && (
          <div role="tablist" aria-label="Season" style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {seasons.map((y) => {
              const on = y === season;
              return (
                <button
                  key={y} role="tab" aria-selected={on} onClick={() => setSeason(y)}
                  style={{ border: `2px solid ${on ? color1 : "#e3e8ef"}`, background: on ? color1 : "#fff", color: on ? "#fff" : "#5b6676", borderRadius: "999px", padding: "3px 12px", fontSize: "12px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", boxShadow: on ? `inset 0 -2px 0 ${color2}` : "none" }}
                >
                  {y}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {view === "seasons" ? (
        <>
          {career.cats.map((c) => (
            <div key={c.name}>
              <div className="font-black uppercase" style={{ color: "#5b6676", fontSize: "11px", letterSpacing: "0.1em", margin: "0 0 5px 2px" }}>{c.displayName}</div>
              <div style={tableWrap}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontFamily: "inherit" }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, ...left, ...sticky }}>Year</th>
                      <th style={{ ...th, ...left }}>Team</th>
                      {c.labels.map((l, i) => <th key={i} title={c.displayNames?.[i] || l} style={th}>{l}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[...c.statistics].sort((a, b) => (b.season?.year || 0) - (a.season?.year || 0)).map((s, ri) => (
                      <tr key={ri}>
                        <td style={{ ...td, ...left, ...sticky }}>{s.season?.year}</td>
                        <td style={{ ...td, ...left }}>{teamCell(s.teamSlug)}</td>
                        {c.labels.map((_, i) => <td key={i} style={td}>{s.stats?.[i] ?? ""}</td>)}
                      </tr>
                    ))}
                    {c.statistics.length > 1 && c.totals && (
                      <tr>
                        <td colSpan={2} style={{ ...td, ...left, ...sticky, fontWeight: 900, color: color1, borderBottom: "none" }}>Career</td>
                        {c.labels.map((_, i) => <td key={i} style={{ ...td, fontWeight: 900, borderBottom: "none" }}>{c.totals[i] ?? ""}</td>)}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      ) : renderLog()}
      <div style={{ fontSize: "10px", color: "#9aa5b4", fontWeight: 700, textAlign: "right", marginTop: "-8px" }}>Stats: ESPN</div>
    </div>
  );
}
