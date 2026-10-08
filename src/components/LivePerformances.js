// src/components/LivePerformances.js
//
// /live's Top Performances tab: the week's best passing, rushing,
// receiving and defensive lines across every game, live and final. One
// listener on liveSlate/performances (written by the ingester — see
// server/live/store.js slatePerformances), opened only while this tab is on
// screen; teams, logos and the live score come from the slate the page
// already has. Numbers are from the play-by-play (src/utils/liveStats.mjs),
// so defense is sacks / interceptions / forced fumbles / recoveries — no
// tackles.
//
// Also /live's Last Week tab (preview phase): pass `perf` — built from last
// week's liveGames docs with performancesFromGames — and the games it came
// from, instead of listening to the current week.
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { statusLabel, teamShort } from "../utils/live";
import { LEADER_CATS, statLine } from "../utils/liveStats";

const GOLD = "#f6a21d";
const SHOW = 10;
const TITLES = { passing: "Passing", rushing: "Rushing", receiving: "Receiving", defense: "Defense" };

export const PERF_STYLE = `
.lpf-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.lpf-grid { display: grid; gap: clamp(14px, 1.4vw, 22px); grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); }
.lpf-board { background: #111a2b; border: 1px solid #1d2840; border-radius: 16px; padding: 14px 16px 6px; }
.lpf-h { font-size: 13px; font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase; color: ${GOLD}; margin-bottom: 6px; }
.lpf-row { display: grid; grid-template-columns: 26px 30px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 9px 4px; border-top: 1px solid #172238; cursor: pointer; border-radius: 8px; }
.lpf-row:first-of-type { border-top: 0; }
.lpf-row:hover { background: #16213a; }
.lpf-rank { font-weight: 900; font-size: 15px; color: #4f6080; text-align: center; font-variant-numeric: tabular-nums; }
.lpf-row:nth-of-type(1) .lpf-rank { color: ${GOLD}; }
.lpf-logo { width: 28px; height: 28px; object-fit: contain; }
.lpf-who { min-width: 0; }
.lpf-name { display: flex; align-items: center; gap: 6px; font-weight: 900; font-size: 16px; color: #eef2f8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lpf-name > span { overflow: hidden; text-overflow: ellipsis; }
.lpf-name > span.on { color: ${GOLD}; }
.lpf-name a { display: inline-flex; flex-shrink: 0; }
.lpf-name a img { width: 13px; height: 13px; }
.lpf-line { font-weight: 800; font-size: 13px; color: #c9d5e6; font-variant-numeric: tabular-nums; margin-top: 2px; }
.lpf-game { font-weight: 800; font-size: 12px; color: #6f819c; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.lpf-game.live { color: #ff6b6b; }
.lpf-game .wdl-dot { width: 6px; height: 6px; margin-right: 5px; }
.lpf-val { text-align: right; font-weight: 900; font-size: clamp(22px, 1.8vw, 28px); color: #fff; line-height: 1; font-variant-numeric: tabular-nums; }
.lpf-val small { display: block; font-size: 10px; letter-spacing: 0.12em; color: #6f819c; margin-top: 3px; }
.lpf-more { display: block; width: 100%; background: none; border: 0; border-top: 1px solid #172238; color: ${GOLD}; font: inherit; font-weight: 900; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; padding: 10px 4px; cursor: pointer; }
.lpf-more:hover { color: #fff; }
.lpf-empty { color: #6f819c; font-weight: 700; padding: 10px 4px 14px; }
`;

// The week's top lines from its games' own statLeaders — the same merge as
// the ingester's slatePerformances (server/live/store.js).
const MAX_PERFORMANCES = 15;
export function performancesFromGames(games) {
  const out = {};
  for (const cat of LEADER_CATS) {
    out[cat] = games
      .flatMap((g) => (g.statLeaders?.[cat] || []).map((e) => ({ ...e, gameId: g.id })))
      .sort((a, b) => b.v - a.v)
      .slice(0, MAX_PERFORMANCES);
  }
  return out;
}

// `initial`: rows shown per board until "Show more" (up to the
// MAX_PERFORMANCES stored); without it, a fixed SHOW rows.
export default function LivePerformances({ games, onOpenGame, followedIds, perf: given, title, initial }) {
  const [snap, setSnap] = useState(null);
  const [expanded, setExpanded] = useState({}); // category → showing all
  const [liveOnly, setLiveOnly] = useState(false);
  useEffect(() => (given ? undefined : onSnapshot(doc(db, "liveSlate", "performances"), (s) => setSnap(s.exists() ? s.data() : {}), () => setSnap({}))), [given]);
  const perf = given || snap;

  if (!perf) return <div className="wdl-empty">Loading…</div>;
  const byId = new Map(games.map((g) => [String(g.id), g]));
  const anyLive = games.some((g) => g.status === "in_progress");
  const anyStarted = games.some((g) => g.status !== "scheduled");

  return (
    <div>
      <div className="lpf-top">
        <div className="wdl-h" style={{ margin: 0 }}>{title || "Top performances · this week"}</div>
        {!given && (
          <div className="wdl-seg">
            <button type="button" className={!liveOnly ? "on" : ""} onClick={() => setLiveOnly(false)}>All games</button>
            <button type="button" className={liveOnly ? "on" : ""} onClick={() => setLiveOnly(true)} disabled={!anyLive}>Live now</button>
          </div>
        )}
      </div>
      <div className="lpf-grid">
        {LEADER_CATS.map((cat) => {
          const all = (perf[cat] || [])
            .map((e) => ({ e, g: byId.get(String(e.gameId)) }))
            .filter(({ g }) => g && (!liveOnly || g.status === "in_progress"));
          const limit = initial ? (expanded[cat] ? MAX_PERFORMANCES : initial) : SHOW;
          const rows = all.slice(0, limit);
          const canToggle = initial && all.length > initial;
          return (
            <section key={cat} className="lpf-board">
              <div className="lpf-h">{TITLES[cat]}</div>
              {rows.length ? rows.map(({ e, g }, i) => {
                const team = g[e.side] || {};
                const opp = g[e.side === "home" ? "away" : "home"] || {};
                const live = g.status === "in_progress";
                // Names don't follow on tap — that's My Players' job; ★ marks a followed one.
                const on = !!followedIds?.has(String(e.id));
                return (
                  <div key={`${e.gameId}:${e.id}`} className="lpf-row" role="button" tabIndex={0}
                    onClick={() => onOpenGame(g.id)} onKeyDown={(ev) => { if (ev.key === "Enter") onOpenGame(g.id); }}>
                    <span className="lpf-rank">{i + 1}</span>
                    {(team.logoDark || team.logo) ? <img className="lpf-logo" src={team.logoDark || team.logo} alt="" /> : <span />}
                    <div className="lpf-who">
                      <div className="lpf-name">
                        <span className={on ? "on" : undefined}>{on ? "★ " : ""}{e.name}</span>
                        {e.slug && (
                          <a href={`/player/${e.slug}`} target="_blank" rel="noopener noreferrer" title={`${e.name} — We-Draft profile (opens in a new tab)`} onClick={(ev) => ev.stopPropagation()}>
                            <img src="/wd-icon.png" alt="We-Draft profile" />
                          </a>
                        )}
                      </div>
                      <div className="lpf-line">{statLine(cat, e.stats)}</div>
                      <div className={`lpf-game${live ? " live" : ""}`}>
                        {live && <span className="wdl-dot" />}{teamShort(team)} {team.points ?? ""} – {teamShort(opp)} {opp.points ?? ""} · {statusLabel(g)}
                      </div>
                    </div>
                    {cat === "defense"
                      ? <span />
                      : <div className="lpf-val">{e.stats?.yds ?? e.v}<small>YDS</small></div>}
                  </div>
                );
              }) : <div className="lpf-empty">{liveOnly ? "Nothing live right now." : anyStarted ? "No stats in yet." : "Shows up once games kick off."}</div>}
              {canToggle && (
                <button type="button" className="lpf-more" onClick={() => setExpanded((x) => ({ ...x, [cat]: !x[cat] }))}>
                  {expanded[cat] ? "Show less" : `Show top ${Math.min(all.length, MAX_PERFORMANCES)}`}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
