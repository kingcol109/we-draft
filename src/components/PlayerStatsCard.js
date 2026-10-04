// src/components/PlayerStatsCard.js
//
// "2026 Stats" on a player page's right column (PlayerProfile.js, between
// Videos and In The News): season totals picked by position plus a short
// game log (latest 3, "Show more" for the season). Reads the CFBD player linked to this We-Draft profile
// (cfbdPlayers where wedraftPlayerId == player.id — season totals from
// scripts/syncCfbdPlayerStats.js, game logs from the live ingester / that
// script's backfill). Renders nothing when there's no linked player or no
// stats yet, so a profile without them just doesn't show the card.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc as fsDoc, getDoc, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";

const SEASON = 2026;
// Game log: the whole season is loaded; the latest GAME_LOG_SHOWN show until
// "Show more" expands the list.
const GAME_LOG_MAX = 20;
const GAME_LOG_SHOWN = 3;

const groupOf = (pos) => {
  const p = (pos || "").toUpperCase();
  if (p === "QB") return "qb";
  if (p === "RB" || p === "FB") return "rb";
  if (p === "WR" || p === "TE") return "rec";
  if (p === "K" || p === "PK") return "k";
  if (p === "P") return "p";
  if (["DL", "DT", "DE", "EDGE", "IDL", "NT", "DI"].includes(p)) return "dl";
  if (["DB", "CB", "S", "FS", "SS", "SAF", "NB", "NICKEL"].includes(p)) return "db";
  if (p === "OL" || p === "OT" || p === "OG" || p === "C" || p === "IOL" || p === "LS") return "ol";
  return "def";
};

const n = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const fix1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "–");

// Big-number tiles for the season, by position group: [label, value] or
// [label, value, [hoverLabel, hoverValue]] — the third swaps in on hover/tap.
function seasonTiles(group, s) {
  const pass = s.passing || {}, rush = s.rushing || {}, rec = s.receiving || {}, def = s.defensive || {}, ints = s.interceptions || {}, k = s.kicking || {}, pnt = s.punting || {};
  switch (group) {
    case "qb": return [["Pass yds", n(pass.YDS)], ["TD", n(pass.TD)], ["INT", n(pass.INT)], ["Cmp %", pass.ATT ? `${Math.round((100 * n(pass.COMPLETIONS)) / n(pass.ATT))}%` : "–", ["Cmp/Att", `${n(pass.COMPLETIONS)}/${n(pass.ATT)}`]]];
    case "rb": return [["Rushes", n(rush.CAR)], ["Rush yds", n(rush.YDS), ["YPC", rush.CAR ? fix1(n(rush.YDS) / n(rush.CAR)) : "–"]], ["Rush TD", n(rush.TD)]];
    case "rec": return [["Rec", n(rec.REC)], ["Yds", n(rec.YDS), ["Avg", rec.REC ? fix1(n(rec.YDS) / n(rec.REC)) : "–"]], ["TD", n(rec.TD)]];
    case "k": return [["FG", `${n(k.FGM)}/${n(k.FGA)}`], ["Long", n(k.LONG)], ["XP", `${n(k.XPM)}/${n(k.XPA)}`], ["Pts", n(k.PTS)]];
    case "p": return [["Punts", n(pnt.NO)], ["Avg", fix1(n(pnt.YPP))], ["In 20", n(pnt["In 20"])], ["Long", n(pnt.LONG)]];
    case "ol": return [];
    case "dl": return [["Tackles", n(def.TOT)], ["TFL", n(def.TFL)], ["Sacks", n(def.SACKS)]];
    case "db": return [["Tackles", n(def.TOT)], ["PBU", n(def.PD)], ["INT", n(ints.INT)]];
    default: return [["Tackles", n(def.TOT)], ["TFL", n(def.TFL)], ["Sacks", n(def.SACKS)], ["INT", n(ints.INT)]];
  }
}

// A secondary season line where it adds something (QB rushing, RB catches,
// a defender's PBUs / a lineman's picks — only the ones he has):
// a string, or [[value, label], ...] for a row of small stats.
function seasonExtra(group, s) {
  const rush = s.rushing || {}, rec = s.receiving || {}, def = s.defensive || {}, ints = s.interceptions || {};
  if (group === "qb" && n(rush.CAR)) return [[n(rush.CAR), "Rush"], [n(rush.YDS), "Rush yds"], [n(rush.TD), "Rush TD"]];
  if (group === "rb" && n(rec.REC)) return [[n(rec.REC), "Rec"], [n(rec.YDS), "Rec yds"], [n(rec.TD), "Rec TD"]];
  if (group === "rec" && n(rush.CAR)) return `${n(rush.CAR)} rush, ${n(rush.YDS)} yds, ${n(rush.TD)} TD`;
  if (group === "db") {
    const out = [];
    if (n(def.SACKS)) out.push([n(def.SACKS), "Sacks"]);
    if (n(def.TFL)) out.push([n(def.TFL), "TFL"]);
    return out.length ? out : "";
  }
  if (group === "dl" || group === "def") {
    const out = [];
    if (n(def.PD)) out.push([n(def.PD), "PBU"]);
    if (group === "dl" && n(ints.INT)) out.push([n(ints.INT), "INT"]);
    return out.length ? out : "";
  }
  return "";
}

// Game log columns by position group, from the box-score format
// ({ passing: { "C/ATT": "16/23", YDS: "214" } }). Every row uses the same
// grid, so a stat sits in the same spot on every game — a stat that's left
// out for a game (a 0 TD, no carries) leaves its cell blank rather than
// shifting the others. Sections with a head get a heading above them and a
// thin line between them (a QB's Pass | Rush).
const pos = (v) => (n(v) > 0 ? n(v) : null);
const GAME_COLS = {
  qb: [
    { head: "Pass", cols: [
      { label: "C/Att", w: 1.5, get: (s) => s.passing?.["C/ATT"] || null },
      { label: "Yds", get: (s) => (s.passing?.["C/ATT"] ? n(s.passing.YDS) : null) },
      { label: "TD", get: (s) => (s.passing?.["C/ATT"] ? n(s.passing.TD) : null) },
      { label: "INT", get: (s) => pos(s.passing?.INT) },
    ] },
    { head: "Rush", cols: [
      { label: "Yds", get: (s) => (s.rushing?.CAR ? n(s.rushing.YDS) : null) },
      { label: "TD", get: (s) => pos(s.rushing?.TD) },
    ] },
  ],
  rb: [
    { head: "Rush", cols: [
      { label: "Yds", get: (s) => (s.rushing?.CAR ? n(s.rushing.YDS) : null) },
      { label: "TD", get: (s) => pos(s.rushing?.TD) },
    ] },
    { head: "Rec", cols: [
      { label: "Yds", get: (s) => pos(s.receiving?.YDS) },
      { label: "TD", get: (s) => pos(s.receiving?.TD) },
    ] },
  ],
  rec: [
    { cols: [
      { label: "Rec", get: (s) => n(s.receiving?.REC) },
      { label: "Yds", get: (s) => n(s.receiving?.YDS) },
      { label: "TD", get: (s) => pos(s.receiving?.TD) },
    ] },
  ],
  dl: [
    { cols: [
      { label: "Tkl", get: (s) => n(s.defensive?.TOT) },
      { label: "TFL", get: (s) => pos(s.defensive?.TFL) },
      { label: "Sack", get: (s) => pos(s.defensive?.SACKS) },
    ] },
  ],
  db: [
    { cols: [
      { label: "Tkl", get: (s) => n(s.defensive?.TOT) },
      { label: "PBU", get: (s) => pos(s.defensive?.PD) },
      { label: "INT", get: (s) => pos(s.interceptions?.INT) },
    ] },
  ],
  def: [
    { cols: [
      { label: "Tkl", get: (s) => n(s.defensive?.TOT) },
      { label: "TFL", get: (s) => pos(s.defensive?.TFL) },
      { label: "Sack", get: (s) => pos(s.defensive?.SACKS) },
      { label: "INT", get: (s) => pos(s.interceptions?.INT) },
      { label: "PD", get: (s) => pos(s.defensive?.PD) },
    ] },
  ],
  k: [
    { cols: [
      { label: "FG", get: (s) => s.kicking?.FG || null },
      { label: "XP", get: (s) => s.kicking?.XP || null },
    ] },
  ],
};
// The grid template shared by the heading row and every game row: fixed-width
// columns (shrinking if the card is narrow), centered in the row.
const COL_W = 46;
const gridOf = (sections) => sections.flatMap((sec) => sec.cols.map((c) => `minmax(0, ${Math.round(COL_W * (c.w || 1))}px)`)).join(" ");
// With only a few columns, a spacer the logo's width on the right centers
// the stats on the card instead of in the space beside the logo.
const balanced = (sections) => sections.reduce((t, sec) => t + sec.cols.length, 0) <= 3;
const SECTION_LINE = "1px solid #dfe3e9";
const LOGO_CELL = "44px";
// A QB's interceptions show in red.
const INT_RED = "#c62828";
const valueColor = (group, label, value, base) => (group === "qb" && label === "INT" && n(value) > 0 ? INT_RED : base);

const dateLabel = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
};

export default function PlayerStatsCard({ player, color1, color2 }) {
  const [data, setData] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [altTile, setAltTile] = useState(null); // label of the tile showing its hover stat

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setShowAll(false);
    if (!player?.id) return undefined;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "cfbdPlayers"), where("wedraftPlayerId", "==", player.id), limit(1)));
        const doc = snap.docs[0];
        if (!doc || !["verified", "suggested"].includes(doc.data().mappingStatus)) { if (!cancelled) setData({ none: true }); return; }
        const snapGames = await getDocs(query(collection(db, "cfbdPlayers", doc.id, "games"), orderBy("startDate", "desc"), limit(GAME_LOG_MAX)));
        const games = snapGames.docs.map((d) => d.data()).filter((g) => g.season === SEASON);
        // Game logs written before opponentLogo existed: take the opponent's
        // logo + short name from the live ingester's game doc.
        await Promise.all(games.filter((g) => !g.opponentLogo && g.providerGameId != null).map(async (g) => {
          try {
            const live = (await getDoc(fsDoc(db, "liveGames", String(g.providerGameId)))).data();
            const opp = live?.[g.homeAway === "home" ? "away" : "home"];
            if (opp) Object.assign(g, { opponentLogo: opp.logo || opp.logoDark || null, opponentShort: g.opponentShort || opp.short || null });
          } catch { /* no live doc — the row falls back to the name */ }
        }));
        if (!cancelled) setData({ cfbd: doc.data(), games });
      } catch {
        if (!cancelled) setData({ none: true });
      }
    })();
    return () => { cancelled = true; };
  }, [player?.id]);

  if (!data || data.none) return null;
  const season = data.cfbd.seasons?.[SEASON];
  const group = groupOf(player.Position || data.cfbd.position);
  const tiles = season ? seasonTiles(group, season) : [];
  const extra = season ? seasonExtra(group, season) : "";
  const gameCols = GAME_COLS[group] || [];
  const gameGrid = gridOf(gameCols);
  if (!tiles.length && !(gameCols.length && data.games.length)) return null;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `2px solid ${color1}` }}>
      <div style={{ backgroundColor: color1, padding: "12px 14px", textAlign: "center" }}>
        <h2 className="font-black uppercase" style={{ color: "#fff", fontSize: "20px", letterSpacing: "0.08em", textAlign: "center" }}>{SEASON} Stats</h2>
      </div>
      <div style={{ height: "4px", backgroundColor: color2 }} />
      <div style={{ background: "#fff" }}>
        {tiles.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${tiles.length}, 1fr)`, borderBottom: "1px solid #eef1f5" }}>
            {tiles.map(([label, value, alt], i) => {
              const [shownLabel, shownValue] = alt && altTile === label ? alt : [label, value];
              return (
                <div key={label}
                  onMouseEnter={alt ? () => setAltTile(label) : undefined}
                  onMouseLeave={alt ? () => setAltTile(null) : undefined}
                  onClick={alt ? () => setAltTile((t) => (t === label ? null : label)) : undefined}
                  title={alt ? `${alt[0]}: ${alt[1]}` : undefined}
                  style={{ textAlign: "center", padding: "12px 4px", borderLeft: i ? "1px solid #eef1f5" : "none", cursor: alt ? "help" : "default" }}>
                  <div style={{ fontWeight: 900, fontSize: "22px", color: valueColor(group, shownLabel, shownValue, color1), lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{shownValue}</div>
                  <div style={{ fontWeight: 800, fontSize: "10px", color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: "3px" }}>{shownLabel}</div>
                </div>
              );
            })}
          </div>
        )}
        {Array.isArray(extra) ? (
          <div style={{ display: "flex", justifyContent: "center", gap: "22px", padding: "10px 12px", borderBottom: "1px solid #eef1f5", background: "#f8f9fb" }}>
            {extra.map(([value, label]) => (
              <div key={label} style={{ textAlign: "center", lineHeight: 1.05 }}>
                <div style={{ fontWeight: 900, fontSize: "17px", color: "#1d2733", fontVariantNumeric: "tabular-nums" }}>{value}</div>
                <div style={{ fontWeight: 800, fontSize: "10px", color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "3px" }}>{label}</div>
              </div>
            ))}
          </div>
        ) : extra && <div style={{ padding: "8px 12px", fontSize: "12px", fontWeight: 700, color: "#5b6b7f", borderBottom: "1px solid #eef1f5", textAlign: "center" }}>{extra}</div>}
        {gameCols.length > 0 && data.games.length > 0 && (
          <div>
            <div style={{ padding: "8px 12px 4px", fontSize: "10px", fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7a8597" }}>Game log</div>
            {gameCols.some((sec) => sec.head) && (
              <div style={{ display: "flex", gap: "8px", padding: "0 12px 4px" }}>
                <div style={{ width: LOGO_CELL, flexShrink: 0 }} />
                <div style={{ flex: 1, display: "grid", gridTemplateColumns: gameGrid, justifyContent: "center" }}>
                  {gameCols.map((sec, si) => (
                    <div key={si} style={{ gridColumn: `span ${sec.cols.length}`, textAlign: "center", fontSize: "10px", fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "#1d2733", borderLeft: si ? SECTION_LINE : "none" }}>{sec.head}</div>
                  ))}
                </div>
                {balanced(gameCols) && <div style={{ width: LOGO_CELL, flexShrink: 0 }} />}
              </div>
            )}
            {data.games.slice(0, showAll ? data.games.length : GAME_LOG_SHOWN).map((g) => {
              const st = g.stats || {};
              const opp = g.opponentShort || g.opponent || "";
              const row = (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", borderTop: "1px solid #eef1f5" }}>
                  <div style={{ width: LOGO_CELL, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }} title={`${g.homeAway === "away" ? "@" : "vs"} ${opp}`}>
                    {g.opponentLogo
                      ? <img src={g.opponentLogo} alt={opp} style={{ width: "32px", height: "32px", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      : <span style={{ width: "30px", height: "30px", borderRadius: "50%", background: "#eef1f5", color: "#5b6b7f", fontSize: "11px", fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>{opp.slice(0, 2).toUpperCase()}</span>}
                    <div style={{ fontSize: "10px", fontWeight: 700, color: "#8a95a5", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{dateLabel(g.startDate)}</div>
                  </div>
                  <div style={{ flex: 1, alignSelf: "stretch", display: "grid", gridTemplateColumns: gameGrid, justifyContent: "center" }}>
                    {gameCols.flatMap((sec, si) => sec.cols.map((c, ci) => {
                      const value = c.get(st);
                      return (
                        <div key={`${si}-${c.label}`} style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", lineHeight: 1.05, borderLeft: si && !ci ? SECTION_LINE : "none" }}>
                          {value != null && (
                            <>
                              <div style={{ fontSize: "16px", fontWeight: 900, color: valueColor(group, c.label, value, color1), fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{value}</div>
                              <div style={{ fontSize: "9px", fontWeight: 800, color: "#8a95a5", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: "2px" }}>{c.label}</div>
                            </>
                          )}
                        </div>
                      );
                    }))}
                  </div>
                  {balanced(gameCols) && <div style={{ width: LOGO_CELL, flexShrink: 0 }} />}
                </div>
              );
              return g.wedraftGameSlug
                ? <Link key={g.providerGameId} to={`/game/${g.wedraftGameSlug}`} style={{ display: "block", textDecoration: "none" }}>{row}</Link>
                : <div key={g.providerGameId}>{row}</div>;
            })}
            {data.games.length > GAME_LOG_SHOWN && (
              <button onClick={() => setShowAll((v) => !v)} style={{
                display: "block", width: "100%", padding: "10px 14px", border: "none", cursor: "pointer",
                background: color1, color: color2, fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.1em",
              }}>
                {showAll ? "Show less" : `Show more (${data.games.length - GAME_LOG_SHOWN})`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
