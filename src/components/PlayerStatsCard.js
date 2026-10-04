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
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
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
  if (p === "OL" || p === "OT" || p === "OG" || p === "C" || p === "IOL" || p === "LS") return "ol";
  return "def";
};

const n = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const fix1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "–");

// Big-number tiles for the season, by position group.
function seasonTiles(group, s) {
  const pass = s.passing || {}, rush = s.rushing || {}, rec = s.receiving || {}, def = s.defensive || {}, ints = s.interceptions || {}, k = s.kicking || {}, pnt = s.punting || {};
  switch (group) {
    case "qb": return [["Pass yds", n(pass.YDS)], ["TD", n(pass.TD)], ["INT", n(pass.INT)], ["Cmp %", pass.ATT ? `${Math.round((100 * n(pass.COMPLETIONS)) / n(pass.ATT))}%` : "–"]];
    case "rb": return [["Rush yds", n(rush.YDS)], ["YPC", rush.CAR ? fix1(n(rush.YDS) / n(rush.CAR)) : "–"], ["Rush TD", n(rush.TD)], ["Rec yds", n(rec.YDS)]];
    case "rec": return [["Rec", n(rec.REC)], ["Yds", n(rec.YDS)], ["Avg", rec.REC ? fix1(n(rec.YDS) / n(rec.REC)) : "–"], ["TD", n(rec.TD)]];
    case "k": return [["FG", `${n(k.FGM)}/${n(k.FGA)}`], ["Long", n(k.LONG)], ["XP", `${n(k.XPM)}/${n(k.XPA)}`], ["Pts", n(k.PTS)]];
    case "p": return [["Punts", n(pnt.NO)], ["Avg", fix1(n(pnt.YPP))], ["In 20", n(pnt["In 20"])], ["Long", n(pnt.LONG)]];
    case "ol": return [];
    default: return [["Tackles", n(def.TOT)], ["TFL", n(def.TFL)], ["Sacks", n(def.SACKS)], ["INT", n(ints.INT)]];
  }
}

// A secondary season line where it adds something (QB rushing, RB catches).
function seasonExtra(group, s) {
  const rush = s.rushing || {}, rec = s.receiving || {}, pass = s.passing || {}, def = s.defensive || {};
  if (group === "qb" && n(rush.CAR)) return `${n(pass.COMPLETIONS)}/${n(pass.ATT)} passing · ${n(rush.CAR)} rush, ${n(rush.YDS)} yds, ${n(rush.TD)} TD`;
  if (group === "rb" && n(rec.REC)) return `${n(rush.CAR)} carries · ${n(rec.REC)} rec, ${n(rec.TD)} rec TD`;
  if (group === "rec" && n(rush.CAR)) return `${n(rush.CAR)} rush, ${n(rush.YDS)} yds, ${n(rush.TD)} TD`;
  if (group === "def" && (n(def.PD) || n(def["QB HUR"]))) return `${n(def.PD)} pass breakups · ${n(def["QB HUR"])} QB hurries`;
  return "";
}

// One game's line from the box-score format ({ passing: { "C/ATT": "16/23", YDS: "214" } }).
function gameLine(group, st) {
  const pass = st.passing || {}, rush = st.rushing || {}, rec = st.receiving || {}, def = st.defensive || {}, ints = st.interceptions || {}, k = st.kicking || {};
  const parts = [];
  if (group === "qb" && pass["C/ATT"]) parts.push(`${pass["C/ATT"]}, ${n(pass.YDS)} yds, ${n(pass.TD)} TD${n(pass.INT) ? `, ${n(pass.INT)} INT` : ""}`);
  if ((group === "qb" || group === "rb" || group === "rec") && rush.CAR && (group === "rb" || n(rush.YDS) >= 10 || n(rush.TD))) parts.push(`${n(rush.CAR)}-${n(rush.YDS)}${n(rush.TD) ? `, ${n(rush.TD)} TD` : ""} rush`);
  if ((group === "rec" || group === "rb") && rec.REC) parts.push(`${n(rec.REC)}-${n(rec.YDS)}${n(rec.TD) ? `, ${n(rec.TD)} TD` : ""} rec`);
  if (group === "def") {
    const d = [];
    if (def.TOT) d.push(`${n(def.TOT)} tkl`);
    if (n(def.TFL)) d.push(`${n(def.TFL)} TFL`);
    if (n(def.SACKS)) d.push(`${n(def.SACKS)} sk`);
    if (n(ints.INT)) d.push(`${n(ints.INT)} INT`);
    if (n(def.PD)) d.push(`${n(def.PD)} PD`);
    if (d.length) parts.push(d.join(", "));
  }
  if (group === "k" && k.FG) parts.push(`FG ${k.FG}${k.XP ? ` · XP ${k.XP}` : ""}`);
  return parts.join(" · ") || "—";
}

const dateLabel = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
};

export default function PlayerStatsCard({ player, color1, color2 }) {
  const [data, setData] = useState(null);
  const [showAll, setShowAll] = useState(false);

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
        const games = await getDocs(query(collection(db, "cfbdPlayers", doc.id, "games"), orderBy("startDate", "desc"), limit(GAME_LOG_MAX)));
        if (!cancelled) setData({ cfbd: doc.data(), games: games.docs.map((d) => d.data()).filter((g) => g.season === SEASON) });
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
  if (!tiles.length && !data.games.length) return null;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `2px solid ${color1}` }}>
      <div style={{ backgroundColor: color1, padding: "12px 14px", textAlign: "center" }}>
        <h2 className="font-black uppercase" style={{ color: "#fff", fontSize: "20px", letterSpacing: "0.08em", textAlign: "center" }}>{SEASON} Stats</h2>
      </div>
      <div style={{ height: "4px", backgroundColor: color2 }} />
      <div style={{ background: "#fff" }}>
        {tiles.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${tiles.length}, 1fr)`, borderBottom: "1px solid #eef1f5" }}>
            {tiles.map(([label, value], i) => (
              <div key={label} style={{ textAlign: "center", padding: "12px 4px", borderLeft: i ? "1px solid #eef1f5" : "none" }}>
                <div style={{ fontWeight: 900, fontSize: "22px", color: color1, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
                <div style={{ fontWeight: 800, fontSize: "10px", color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: "3px" }}>{label}</div>
              </div>
            ))}
          </div>
        )}
        {extra && <div style={{ padding: "8px 12px", fontSize: "12px", fontWeight: 700, color: "#5b6b7f", borderBottom: "1px solid #eef1f5", textAlign: "center" }}>{extra}</div>}
        {data.games.length > 0 && (
          <div>
            <div style={{ padding: "8px 12px 4px", fontSize: "10px", fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7a8597" }}>Game log</div>
            {data.games.slice(0, showAll ? data.games.length : GAME_LOG_SHOWN).map((g) => {
              const result = g.teamPoints != null && g.opponentPoints != null
                ? `${g.teamPoints > g.opponentPoints ? "W" : g.teamPoints < g.opponentPoints ? "L" : "T"} ${g.teamPoints}-${g.opponentPoints}` : "";
              const row = (
                <div style={{ padding: "8px 12px", borderTop: "1px solid #f1f3f7" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "12px", fontWeight: 900, color: "#1d2733" }}>
                    <span>{dateLabel(g.startDate)} · {g.homeAway === "away" ? "@" : "vs"} {g.opponent}</span>
                    {result && <span style={{ color: result.startsWith("W") ? "#1f8a4c" : result.startsWith("L") ? "#b23b3b" : "#5b6b7f" }}>{result}</span>}
                  </div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#5b6b7f", marginTop: "2px" }}>{gameLine(group, g.stats || {})}</div>
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
