// src/components/WePickRanked.jsx
//
// We-Pick's Ranked 6 for a week — each ranked game's pick against its live
// or final score, points so far and the week's final rank once graded.
// Shared by Live's Your Week (LivePage.js) and the profile's We-Pick tab
// (components/profileHub/WePickTab.jsx). Styled by the wdl-yw-* classes:
// LivePage's own CSS, or WEPICK_RANKED_STYLE where that isn't on the page.
import { useEffect, useState } from "react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { pickedSideOf, isGameFinal, hasScorePick, scoreGamePick, compareStandingsEntries } from "../utils/wePickScoring";
import { darkLogo, teamShort, kickoffLabel, statusLabel } from "../utils/live";

const GOLD = "#f6a21d";
const LIVE_RED = "#ff4d4d";

export const WEPICK_RANKED_STYLE = `
.wdl-yw-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
.wdl-yw-stat { background: #111a2b; border: 1px solid #1d2840; border-radius: 10px; padding: 10px 14px; }
.wdl-yw-stat b { display: block; font-size: 28px; font-weight: 900; color: ${GOLD}; font-variant-numeric: tabular-nums; line-height: 1.1; }
.wdl-yw-stat b.dim { color: #6f819c; font-size: 18px; }
.wdl-yw-stat span { font-size: 11px; font-weight: 800; color: #9fb0c8; text-transform: uppercase; letter-spacing: 0.08em; }
.wdl-yw-list { display: grid; gap: 8px; }
.wdl-yw-pick { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; background: #111a2b; border: 1px solid #1d2840; border-radius: 10px; padding: 10px 14px; cursor: pointer; }
.wdl-yw-pick.live { border-color: rgba(255,77,77,0.45); }
.wdl-yw-teams { display: flex; align-items: center; gap: 8px; font-weight: 900; font-size: 15px; color: #eef2f8; text-transform: uppercase; min-width: 0; flex-wrap: wrap; }
.wdl-yw-teams img { width: 22px; height: 22px; object-fit: contain; }
.wdl-yw-teams .sc { font-variant-numeric: tabular-nums; color: #eef2f8; }
.wdl-yw-teams .rk { color: #8193ad; font-size: 11px; margin-right: 2px; }
.wdl-yw-meta { font-size: 12px; font-weight: 700; color: #9fb0c8; }
.wdl-yw-meta .mine { color: #eef2f8; font-weight: 900; }
.wdl-yw-pts { grid-row: 1 / span 2; grid-column: 2; text-align: right; font-weight: 900; font-variant-numeric: tabular-nums; }
.wdl-yw-pts b { display: block; font-size: 22px; }
.wdl-yw-pts small { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #9fb0c8; }
.wdl-yw-pts.win b { color: #3ddc84; } .wdl-yw-pts.loss b { color: #ff6b6b; } .wdl-yw-pts.live b { color: ${GOLD}; } .wdl-yw-pts.wait b { color: #6f819c; }
.wdl-yw-cta { background: none; border: 1px solid #2c3b57; color: #eef2f8; border-radius: 8px; padding: 7px 12px; font-weight: 900; font-size: 12px; cursor: pointer; font-family: inherit; text-decoration: none; display: inline-block; }
`;

// The user's pick + the schedule26 game for each ranked game (official
// final scores, and which side is "home" for the pick) — two reads a game,
// once.
export function useRankedPicks(uid, ids) {
  const key = [...ids].sort().join("|");
  const [rows, setRows] = useState({});
  useEffect(() => {
    let alive = true;
    setRows({});
    if (!uid || !key) return undefined;
    Promise.all(key.split("|").map((id) => Promise.all([
      getDoc(doc(db, "users", uid, "picks", id)).catch(() => null),
      getDoc(doc(db, "schedule26", id)).catch(() => null),
    ]).then(([p, g]) => [id, { pick: p?.exists() ? p.data() : null, sched: g?.exists() ? g.data() : null }])))
      .then((list) => { if (alive) setRows(Object.fromEntries(list)); });
    return () => { alive = false; };
  }, [uid, key]);
  return rows;
}

// One ranked game: the pick vs. the score. Points are official once the
// schedule has the final (same as We-Pick's grading); before that they're
// what the pick would score if the game ended now.
export function rankedPickRow(game, row) {
  const sched = row?.sched || {};
  // schedule26's Home/Away can be flipped from CFBD's (neutral sites).
  const swapped = !!sched.Home && sched.Home === game.away.school;
  const home = swapped ? game.away : game.home;
  const away = swapped ? game.home : game.away;
  const official = isGameFinal(sched);
  const started = game.status === "in_progress" || game.status === "final";
  const scored = official ? sched
    : started ? { Final: true, HomeScore: home.points ?? 0, AwayScore: away.points ?? 0 } : null;
  const pick = row?.pick;
  const points = scored && hasScorePick(pick) ? scoreGamePick(pick, scored) : null;
  const state = !started && !official ? "wait" : game.status === "in_progress" && !official ? "live" : points > 0 ? "win" : "loss";
  return { home, away, pick, points, state, official };
}

// The week's final We-Pick standings (wePickStandings2026/{week}, written
// by scripts/gradeWePickWeek.js once every game is final) — one doc,
// listened to so the rank appears the moment the week is graded.
export function useWeekStanding(uid, week) {
  const [state, setState] = useState(null);
  useEffect(() => {
    setState(null);
    if (!uid || !week) return undefined;
    return onSnapshot(doc(db, "wePickStandings2026", week), (snap) => {
      const d = snap.exists() ? snap.data() : null;
      if (!d?.graded || !Array.isArray(d.entries)) { setState({ graded: false }); return; }
      const sorted = [...d.entries].sort(compareStandingsEntries);
      const at = sorted.findIndex((e) => e.uid === uid);
      setState({ graded: true, rank: at < 0 ? null : at + 1, of: sorted.length, entry: at < 0 ? null : sorted[at] });
    }, () => setState(null));
  }, [uid, week]);
  return state;
}

export function YourWeekPicks({ games, rows, standing, onOpen }) {
  const list = games.map((g) => ({ g, r: rankedPickRow(g, rows[g.wedraftGameId]) }));
  const total = standing?.entry ? standing.entry.points : list.reduce((t, x) => t + (x.r.points || 0), 0);
  const anyLive = list.some((x) => x.r.state === "live");
  return (
    <>
      <div className="wdl-yw-stats">
        <div className="wdl-yw-stat"><b>{total.toLocaleString()}</b><span>{anyLive ? "Points if it ended now" : standing?.graded ? "Final points" : "Points so far"}</span></div>
        <div className="wdl-yw-stat">
          {standing?.graded
            ? (standing.rank ? <b>#{standing.rank}<small style={{ fontSize: 13, color: "#9fb0c8" }}> of {standing.of}</small></b> : <b className="dim">Didn't qualify</b>)
            : <b className="dim">Pending</b>}
          <span>{standing?.graded ? "Final ranking" : "Final ranking · after every game ends"}</span>
        </div>
      </div>
      <div className="wdl-yw-list">
        {list.map(({ g, r }) => {
          const side = r.pick ? pickedSideOf(r.pick) : null;
          const picked = side === "home" ? r.home : side === "away" ? r.away : null;
          return (
            <div key={g.id} className={`wdl-yw-pick${r.state === "live" ? " live" : ""}`} onClick={() => onOpen(g.id)}>
              <div className="wdl-yw-teams">
                {[r.away, r.home].map((t, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {i === 1 && <span style={{ color: "#6f819c" }}>@</span>}
                    {(darkLogo(t)) && <img src={darkLogo(t)} alt="" />}
                    {t.rank ? <span className="rk">{t.rank}</span> : null}{teamShort(t)}
                    {t.points != null && <span className="sc">{t.points}</span>}
                  </span>
                ))}
              </div>
              <div className={`wdl-yw-pts ${r.state}`}>
                <b>{r.points == null ? "—" : r.points}</b>
                <small>{r.state === "live" ? "Live" : r.state === "wait" ? kickoffLabel(g.startDate, g.startTimeTBD) : r.official ? "Final" : "Final · unofficial"}</small>
              </div>
              <div className="wdl-yw-meta">
                {hasScorePick(r.pick)
                  ? <>Your pick: <span className="mine">{picked ? teamShort(picked).toUpperCase() : "—"}</span> · {teamShort(r.away).toUpperCase()} {r.pick.awayScore} – {teamShort(r.home).toUpperCase()} {r.pick.homeScore}</>
                  : "No score pick on this game"}
                {g.status === "in_progress" && <> · <span style={{ color: LIVE_RED }}>{statusLabel(g)}</span></>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
