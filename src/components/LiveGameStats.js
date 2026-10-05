// src/components/LiveGameStats.js
//
// A game's Stats tab on /live. Team stats are computed from the
// play-by-play (utils/liveStats.mjs — by the ingester, read here as one doc,
// liveGames/{id}/box/live; older games without it fall back to loading the
// plays and computing here) live and after; player lines come from
// the play-by-play while the game is on and switch to CFBD's official box
// score once the game is final and its box score is in. CFBD's live
// advanced metrics (success rate, EPA...) show when the ingester has them.
import { useMemo } from "react";
import { useLiveGame, useLiveStats } from "../hooks/useLiveGame";
import { computeGameStats, boxPlayers } from "../utils/liveStats";
import { teamShort } from "../utils/live";

const GOLD = "#f6a21d";

export const LIVE_STATS_STYLE = `
.lgs-src { color: #6f819c; font-weight: 800; font-size: 13px; margin: 2px 0 14px; }
.lgs-src b { color: #9fb0c8; }
.lgs-box { background: #111a2b; border: 1px solid #1d2840; border-radius: 16px; padding: clamp(14px, 1.6vw, 22px); margin-bottom: 16px; }
.lgs-head { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; margin-bottom: 8px; }
.lgs-head .t { display: flex; align-items: center; gap: 8px; font-weight: 900; font-size: clamp(15px, 1.2vw, 19px); }
.lgs-head .t.home { justify-content: flex-end; }
.lgs-head img { width: 28px; height: 28px; object-fit: contain; }
.lgs-row { display: grid; grid-template-columns: 1fr minmax(110px, 1.2fr) 1fr; align-items: center; gap: 12px; padding: 7px 0; border-top: 1px solid #172238; font-variant-numeric: tabular-nums; }
.lgs-row .v { font-weight: 900; font-size: clamp(16px, 1.3vw, 21px); }
.lgs-row .v.home { text-align: right; }
.lgs-row .v.lead { color: ${GOLD}; }
.lgs-row .mid { text-align: center; }
.lgs-row .lbl { font-weight: 800; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: #8193ad; }
.lgs-bar { display: flex; height: 5px; border-radius: 3px; overflow: hidden; background: #1d2840; margin-top: 5px; }
.lgs-bar i { display: block; }
.lgs-sec { font-size: 12px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: #6f819c; margin: 18px 0 8px; }
.lgs-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 700px) { .lgs-cols { grid-template-columns: 1fr; } }
.lgs-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.lgs-table caption { text-align: left; font-weight: 900; font-size: 14px; color: #c9d5e6; padding-bottom: 6px; }
.lgs-table caption img { width: 18px; height: 18px; object-fit: contain; vertical-align: -3px; margin-right: 6px; }
.lgs-table th { text-align: right; font-size: 11px; font-weight: 900; letter-spacing: 0.08em; color: #6f819c; padding: 4px 6px; }
.lgs-table th:first-child { text-align: left; }
.lgs-table td { text-align: right; padding: 6px; border-top: 1px solid #172238; font-weight: 800; font-size: 15px; }
.lgs-table td:first-child { text-align: left; font-weight: 900; color: #eef2f8; white-space: nowrap; }
.lgs-table td:first-child a { display: inline-flex; vertical-align: middle; margin-left: 6px; }
.lgs-table td:first-child a img { width: 13px; height: 13px; }
.lgs-empty { color: #6f819c; font-weight: 700; padding: 6px 0; }
.lgs-empty-all { color: #6f819c; font-weight: 700; font-size: 16px; padding: 18px 0; }
/* light theme (regular game page) — white cards, team-color stripes,
   zebra rows, We-Draft blue leaders */
.lgs-light { color: #1d2733; font-family: inherit; }
.lgs-light .lgs-src { color: #7a8597; font-size: 12px; }
.lgs-light .lgs-src b { color: #0055a5; }
.lgs-light .lgs-box { background: #fff; border: 1px solid #dfe5ee; border-radius: 12px; padding: 14px 16px; box-shadow: 0 3px 10px rgba(16,32,64,0.06); }
.lgs-light .lgs-sec { color: #0055a5; font-size: 13px; letter-spacing: 0.12em; margin: 22px 0 10px; padding-left: 10px; border-left: 4px solid #f6a21d; }
.lgs-light .lgs-cols { gap: 14px; }
/* player tables */
.lgs-light .lgs-table { border-radius: 10px; overflow: hidden; border: 1px solid #e6ebf2; border-collapse: separate; border-spacing: 0; }
.lgs-light .lgs-table caption { caption-side: top; text-align: left; padding: 8px 10px; color: #fff; font-size: 13px; font-weight: 900; letter-spacing: 0.04em; text-transform: uppercase;
  background: var(--tc); border-radius: 10px 10px 0 0; }
.lgs-light .lgs-table caption img { background: rgba(255,255,255,0.92); border-radius: 50%; padding: 2px; width: 20px; height: 20px; }
.lgs-light .lgs-table th { background: #f3f6fa; color: #5b6b7f; border-bottom: 1px solid #e6ebf2; padding: 6px 8px; }
.lgs-light .lgs-table td { color: #3b4a5e; border-top: none; padding: 7px 8px; font-size: 14px; }
.lgs-light .lgs-table tbody tr:nth-child(even) td { background: #f8fafc; }
.lgs-light .lgs-table tbody tr:first-child td { color: #1d2733; font-weight: 900; }
.lgs-light .lgs-table td:first-child { color: #1d2733; }
/* team comparison */
.lgs-light .lgs-head { padding-bottom: 10px; border-bottom: 2px solid #eef1f5; }
.lgs-light .lgs-head .t { color: #1d2733; font-size: 17px; }
.lgs-light .lgs-head img { width: 34px; height: 34px; }
.lgs-light .lgs-row { border-top-color: #f0f3f8; padding: 9px 0; }
.lgs-light .lgs-row .v { color: #3b4a5e; font-size: 18px; }
.lgs-light .lgs-row .v.lead { color: #0055a5; }
.lgs-light .lgs-row .lbl { color: #5b6b7f; font-size: 11px; }
.lgs-light .lgs-bar { background: #eef1f5; height: 6px; }
.lgs-light.lgs-empty-all, .lgs-light .lgs-empty { color: #7a8597; }
`;

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "–");
const fmt1 = (n) => (n == null ? "–" : Number(n).toFixed(1));
const fmt2 = (n) => (n == null ? "–" : Number(n).toFixed(2));

function Row({ label, away, home, a, h, higherIsBetter = true }) {
  const total = (Number(a) || 0) + (Number(h) || 0);
  const lead = a === h ? null : (a > h) === higherIsBetter ? "away" : "home";
  return (
    <div className="lgs-row">
      <span className={`v away${lead === "away" ? " lead" : ""}`}>{away}</span>
      <div className="mid">
        <div className="lbl">{label}</div>
        {total > 0 && (
          <div className="lgs-bar"><i style={{ width: `${(100 * (Number(a) || 0)) / total}%`, background: "var(--ac)" }} /><i style={{ width: `${(100 * (Number(h) || 0)) / total}%`, background: "var(--hc2)" }} /></div>
        )}
      </div>
      <span className={`v home${lead === "home" ? " lead" : ""}`}>{home}</span>
    </div>
  );
}

const Name = ({ l }) => (
  <>
    {l.name}
    {l.slug && (
      <a href={`/player/${l.slug}`} target="_blank" rel="noopener noreferrer" title={`${l.name} — We-Draft profile (opens in a new tab)`}>
        <img src="/wd-icon.png" alt="We-Draft profile" />
      </a>
    )}
  </>
);

const TABLES = [
  { cat: "passing", title: "Passing", cols: [["C/ATT", (s) => `${s.cmp || 0}/${s.att || 0}`], ["YDS", (s) => s.yds || 0], ["TD", (s) => s.td || 0], ["INT", (s) => s.int || 0]], sort: (s) => s.att || 0 },
  { cat: "rushing", title: "Rushing", cols: [["CAR", (s) => s.car || 0], ["YDS", (s) => s.yds || 0], ["TD", (s) => s.td || 0], ["LNG", (s) => s.long || 0]], sort: (s) => s.yds || 0 },
  { cat: "receiving", title: "Receiving", cols: [["REC", (s) => s.rec || 0], ["YDS", (s) => s.yds || 0], ["TD", (s) => s.td || 0], ["LNG", (s) => s.long || 0]], sort: (s) => s.yds || 0 },
];
const DEFENSE_LIVE = { cat: "defense", title: "Defense", cols: [["SACK", (s) => +(s.sacks || 0).toFixed(1)], ["INT", (s) => s.int || 0], ["FF", (s) => s.ff || 0], ["FR", (s) => s.fr || 0]], sort: (s) => (s.sacks || 0) * 2 + (s.int || 0) * 3 + (s.fr || 0) * 2 + (s.ff || 0), max: 6 };
const DEFENSE_BOX = { cat: "defense", title: "Defense", cols: [["TOT", (s) => s.tot || 0], ["SACK", (s) => s.sacks || 0], ["TFL", (s) => s.tfl || 0], ["INT", (s) => s.int || 0]], sort: (s) => (s.tot || 0) + (s.sacks || 0) * 3 + (s.int || 0) * 3, max: 6 };

// A team's logo for this theme: on the light page the logos sit on white
// (the caption's circle, the comparison header), so the regular Logo1
// (`logo`) first; on /live's dark cards the dark variant first.
const logoFor = (team, light) => (light ? team?.logo || team?.logoDark : team?.logoDark || team?.logo);

function Table({ def, lines, team, light }) {
  const rows = lines.filter((l) => l.stats[def.cat]).sort((x, y) => def.sort(y.stats[def.cat]) - def.sort(x.stats[def.cat])).slice(0, def.max || 5);
  return (
    <table className="lgs-table" style={{ "--tc": team?.color || "#0055a5" }}>
      <caption>{logoFor(team, light) && <img src={logoFor(team, light)} alt="" />}{teamShort(team)} {def.title}</caption>
      <thead><tr><th>Player</th>{def.cols.map(([h]) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.length ? rows.map((l) => (
          <tr key={l.key}><td><Name l={l} /></td>{def.cols.map(([h, f]) => <td key={h}>{f(l.stats[def.cat])}</td>)}</tr>
        )) : <tr><td colSpan={def.cols.length + 1} className="lgs-empty">—</td></tr>}
      </tbody>
    </table>
  );
}

// theme "light": the regular game page (white cards) instead of /live's dark.
export default function LiveGameStats({ gameId, game, theme = "dark" }) {
  const light = theme === "light";
  const { stats, ready: statsReady } = useLiveStats(gameId);
  // The full play list only for an older game with no stats doc.
  const { plays, box } = useLiveGame(gameId, { plays: statsReady && !stats ? "all" : "none", box: true });
  const computed = useMemo(() => stats || computeGameStats(plays), [stats, plays]);
  const official = game.status === "final" && box?.teams?.length;
  const players = official ? boxPlayers(box) : computed.players;
  // Final + box score in: passing/rushing totals from the official box
  // (play-by-play totals can drift a few yards); the rest stays computed.
  const teamsOut = useMemo(() => {
    if (!official) return computed.teams;
    const out = {};
    for (const side of ["home", "away"]) {
      const sum = (cat, f) => players[side].reduce((a, l) => a + (l.stats[cat]?.[f] || 0), 0);
      const T = { ...computed.teams[side] };
      Object.assign(T, { passYds: sum("passing", "yds"), passCmp: sum("passing", "cmp"), passAtt: sum("passing", "att"), rushYds: sum("rushing", "yds"), rushAtt: sum("rushing", "car") });
      T.totalYds = T.passYds + T.rushYds;
      T.ypp = T.plays ? T.totalYds / T.plays : 0;
      out[side] = T;
    }
    return out;
  }, [official, computed, players]);
  const { home: H, away: A } = teamsOut;
  const adv = game.advanced;
  const away = game.away || {};
  const home = game.home || {};

  if (!statsReady) return null;
  if (!stats && !plays.length) return <div className={`lgs-empty-all${theme === "light" ? " lgs-light" : ""}`}>Stats will appear once the game is underway.</div>;
  return (
    <div className={theme === "light" ? "lgs-light" : undefined} style={{ "--ac": away.color || "#4d9fff", "--hc2": home.color || GOLD }}>
      <div className="lgs-src">
        {official ? <>Player stats: <b>official box score</b> · team stats from the play-by-play</> : <>Live — from the play-by-play{game.status === "final" ? " (official box score coming)" : ""}</>}
      </div>
      {[...TABLES, official ? DEFENSE_BOX : DEFENSE_LIVE].map((def) => (
        <div key={def.cat} className="lgs-box">
          <div className="lgs-cols">
            <Table light={light} def={def} lines={players.away} team={away} />
            <Table light={light} def={def} lines={players.home} team={home} />
          </div>
        </div>
      ))}
      <div className="lgs-sec">Team stats</div>
      <div className="lgs-box">
        <div className="lgs-head">
          <span className="t">{logoFor(away, light) && <img src={logoFor(away, light)} alt="" />}{teamShort(away)}</span>
          <span />
          <span className="t home">{teamShort(home)}{logoFor(home, light) && <img src={logoFor(home, light)} alt="" />}</span>
        </div>
        <Row label="Total yards" away={A.totalYds} home={H.totalYds} a={A.totalYds} h={H.totalYds} />
        <Row label="Passing" away={`${A.passYds} (${A.passCmp}/${A.passAtt})`} home={`${H.passYds} (${H.passCmp}/${H.passAtt})`} a={A.passYds} h={H.passYds} />
        <Row label="Rushing" away={`${A.rushYds} (${A.rushAtt})`} home={`${H.rushYds} (${H.rushAtt})`} a={A.rushYds} h={H.rushYds} />
        <Row label="Yards / play" away={fmt1(A.ypp)} home={fmt1(H.ypp)} a={A.ypp} h={H.ypp} />
        <Row label="First downs" away={A.firstDowns} home={H.firstDowns} a={A.firstDowns} h={H.firstDowns} />
        <Row label="3rd down" away={`${A.third[0]}/${A.third[1]}`} home={`${H.third[0]}/${H.third[1]}`} a={A.third[1] ? A.third[0] / A.third[1] : 0} h={H.third[1] ? H.third[0] / H.third[1] : 0} />
        <Row label="4th down" away={`${A.fourth[0]}/${A.fourth[1]}`} home={`${H.fourth[0]}/${H.fourth[1]}`} a={A.fourth[0]} h={H.fourth[0]} />
        <Row label="Turnovers" away={A.turnovers} home={H.turnovers} a={A.turnovers} h={H.turnovers} higherIsBetter={false} />
        <Row label="Sacked" away={`${A.sacked} (−${A.sackYds})`} home={`${H.sacked} (−${H.sackYds})`} a={A.sacked} h={H.sacked} higherIsBetter={false} />
        <Row label="Penalties" away={`${A.penalties}–${A.penaltyYds}`} home={`${H.penalties}–${H.penaltyYds}`} a={A.penaltyYds} h={H.penaltyYds} higherIsBetter={false} />
        <Row label="Field goals" away={`${A.fgMade}/${A.fgAtt}`} home={`${H.fgMade}/${H.fgAtt}`} a={A.fgMade} h={H.fgMade} />
        {adv?.home && adv?.away && (
          <>
            <div className="lgs-sec">Advanced</div>
            <Row label="Success rate" away={pct(adv.away.successRate, 1)} home={pct(adv.home.successRate, 1)} a={adv.away.successRate} h={adv.home.successRate} />
            <Row label="EPA / play" away={fmt2(adv.away.epaPerPlay)} home={fmt2(adv.home.epaPerPlay)} a={adv.away.epaPerPlay} h={adv.home.epaPerPlay} />
            <Row label="Explosiveness" away={fmt2(adv.away.explosiveness)} home={fmt2(adv.home.explosiveness)} a={adv.away.explosiveness} h={adv.home.explosiveness} />
            <Row label="Pts / scoring opp." away={fmt1(adv.away.pointsPerOpportunity)} home={fmt1(adv.home.pointsPerOpportunity)} a={adv.away.pointsPerOpportunity} h={adv.home.pointsPerOpportunity} />
          </>
        )}
      </div>
    </div>
  );
}
