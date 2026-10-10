// src/broadcast/BroadcastScreen.js
//
// The We-Draft Live broadcast — one 1920×1080 frame, rendered entirely
// from the state useBroadcastState returns (no data reads in here). The
// layout follows the phase:
//
//   pregame             matchup + prospects to watch
//   kickoff             the live layout at 1st 15:00, 0–0, "Kickoff shortly"
//                       (kickoff time has come, no snap yet); the kickoff
//                       animation plays over it when the first play arrives
//   live                scorebug, situation strip with the field, the play
//                       just revealed — its call first (PASS / RUSH and the
//                       player), then the result — or the next snap / a
//                       break, recent plays, We-Draft Player Watch
//   halftime / final    scorebug + the half's / game's summary + Player Watch
//   loading / missing   a branded slate
//
// with the ticker (calls to action, utils/broadcast.js BROADCAST_CTAS)
// along the bottom and the event graphic (BroadcastEvents.js) on top.
// Everything has a fixed footprint, so nothing on screen ever moves
// because something else changed size.
import { memo, useEffect, useRef, useState } from "react";
import BroadcastEvent from "./BroadcastEvents";
import KickoffBurst from "../components/KickoffBurst";
import FitText from "./FitText";
import { panelColor, barColor, BROADCAST_CTAS, CTA_ROTATE_MS } from "../utils/broadcast";
import { teamName, teamShort, statusLabel, periodLabel, distinctTeamColors } from "../utils/live";
import { gameLeaders, statLine } from "../utils/liveStats";
import { Logo } from "./TeamLogo";
import { useFbsTeamStats, fmtTeamStat } from "../utils/fbsTeamStats";
import { GRADE_BADGE } from "../components/LiveInsightCard";

const WD_ICON = "/wd-icon.png";
const ORD = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" };
const ET = "America/New_York";

export { Logo };

function FootballSvg() {
  return (
    <svg className="ball" viewBox="0 0 38 24" aria-hidden="true">
      <ellipse cx="19" cy="12" rx="18" ry="11" fill="currentColor" />
      <path d="M11 12h16M15 9v6M19 9v6M23 9v6" stroke="#0b1426" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ── Top bar ──
function TopBar({ s, game }) {
  const wk = game?.week ?? (game?.wedraftWeek ? Number(/\d+/.exec(game.wedraftWeek)?.[0]) : null);
  const tag = game?.gameOfWeek ? "Game of the Week" : game?.featured ? "Featured Game" : null;
  const lastAt = new Date(s.health.lastDataAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET });
  return (
    <div className="bc-top">
      <div className="bc-brand"><img src={WD_ICON} alt="" /><span className="bc-disp">We-Draft<span className="live">Live</span></span></div>
      {game && (
        <div className="bc-ctx">
          {wk != null && <span>Week {wk}</span>}
          {tag && <span className="tag">{tag}</span>}
          {game.venue && s.phase !== "pregame" && <span className="bc-ell" style={{ maxWidth: 560 }}>{game.venue}</span>}
        </div>
      )}
      <div className="bc-pills">
        {s.replay && <span className="bc-pill replay">Replay {s.replay.step}/{s.replay.total}</span>}
        {s.health.stale && <span className="bc-pill stale">{s.health.offline ? "Connection lost" : "Live data delayed"} · last update {lastAt} ET</span>}
        {(s.phase === "live" || s.phase === "halftime" || (s.phase === "kickoff" && s.kickoffAt)) && <span className="bc-pill live"><i />Live</span>}
        {s.phase === "final" && <span className="bc-pill final">Final</span>}
        {s.phase === "pregame" && <span className="bc-pill pre">Pregame</span>}
        {s.phase === "kickoff" && !s.kickoffAt && <span className="bc-pill pre">Kickoff shortly</span>}
      </div>
    </div>
  );
}

// A score that pops when it changes (never on first paint).
function ScoreNum({ value }) {
  const first = useRef(value);
  const changed = value !== first.current;
  return <b key={value} className={`bc-disp${changed ? " pop" : ""}`}>{value ?? "–"}</b>;
}

// ── Scorebug ──
function Scorebug({ s, game }) {
  // Before the first snap (phase kickoff) it reads like a live game at 1st 15:00.
  const preKick = s.phase === "kickoff";
  const live = game.status === "in_progress" || preKick;
  const final = game.status === "final";
  const hp = game.home?.points;
  const ap = game.away?.points;
  const loser = final && hp != null && ap != null && hp !== ap ? (hp > ap ? "away" : "home") : null;
  const label = statusLabel(preKick ? { ...game, status: "in_progress" } : game);
  const breakText = live && /^(HALFTIME|END OF|OT$|\d?OT$)/.test(label) ? label : null;
  // the team that just scored lights up while its graphic is on
  const hot = s.event && ["TOUCHDOWN", "FIELD_GOAL", "SAFETY"].includes(s.event.type) ? s.event.side : null;

  const team = (side) => {
    const t = game[side] || {};
    const long = (teamName(t) || teamShort(t)).length > 12;
    return (
      <div className={`bc-team ${side}${live && s.ballSide === side ? " ball" : ""}${loser === side ? " lose" : ""}${hot === side ? " hot" : ""}`} style={{ "--pc": panelColor(t) }}>
        <Logo team={t} className="bc-logo" onColor />
        <div className="bc-tname">
          <div className="row">
            {t.rank ? <span className="rank bc-disp">#{t.rank}</span> : null}
            <span className={`school bc-disp${long ? " two" : " bc-ell"}`}>{teamName(t) || teamShort(t)}</span>
          </div>
          {t.mascot && <div className="sub bc-ell">{t.mascot}</div>}
        </div>
      </div>
    );
  };
  const score = (side) => (
    <div className={`bc-score ${side}${loser === side ? " lose" : ""}`}>
      {live && s.ballSide === side && <FootballSvg />}
      <ScoreNum value={game[side]?.points ?? 0} />
    </div>
  );
  let mid;
  if (final) {
    mid = <><div className="big bc-disp">{game.period > 4 ? "Final/OT" : "Final"}</div></>;
  } else if (breakText) {
    mid = <><div className="big bc-disp" style={{ fontSize: breakText.length > 9 ? 56 : 74 }}>{breakText}</div></>;
  } else if (live) {
    const ot = game.period > 4;
    mid = (
      <>
        <div className="per">{ot ? periodLabel(game.period) : `${ORD[game.period] || ""} Qtr`}</div>
        {!ot && <div className="clk bc-disp">{game.clock || "–"}</div>}
        {s.timeout && <div className="small bc-ell" style={{ maxWidth: 250 }}>Timeout{s.timeout.side ? ` · ${teamShort(game[s.timeout.side])}` : ""}</div>}
        {preKick && !s.callingPlay && <div className="small bc-ell" style={{ maxWidth: 250 }}>{s.kickoffAt ? "Kickoff!" : "Kickoff shortly"}</div>}
      </>
    );
  } else {
    mid = <div className="big bc-disp">Live</div>;
  }
  return (
    <div className="bc-board">
      {team("away")}
      {score("away")}
      <div className="bc-mid">{mid}</div>
      {score("home")}
      {team("home")}
    </div>
  );
}

// ── Situation strip: down & distance, the spot, and the field ──
// Away end zone on the left, home on the right (as on the scorebug).
const xOf = (offense, ytg) => (offense === "home" ? ytg : 100 - ytg);
function Field({ sit, game }) {
  const off = sit ? game[sit.offense] : null;
  const ballX = sit?.ytg != null ? xOf(sit.offense, sit.ytg) : null;
  const gainX = ballX != null && typeof sit.distance === "number"
    ? Math.max(0, Math.min(100, sit.offense === "home" ? ballX - sit.distance : ballX + sit.distance)) : null;
  return (
    <div className="bc-field" style={{ "--oc": panelColor(off) }}>
      <div className="ez away" /><div className="turf" /><div className="ez home" />
      <div className="mid" />
      {gainX != null && <div className="gain" style={{ left: `${gainX}%` }} />}
      {ballX != null && <div className="ballmk" style={{ left: `${ballX}%` }}><Logo team={off} onColor /></div>}
    </div>
  );
}

function SituationStrip({ s, game }) {
  const sit = s.situation;
  const off = sit ? game[sit.offense] : null;
  let chip = null;
  if (sit) chip = <div className="bc-dd bc-disp" style={{ "--oc": panelColor(off) }}><Logo team={off} onColor />{sit.down}</div>;
  else if (s.timeout) chip = <div className="bc-dd to bc-disp">Timeout</div>;
  else if (s.breakInfo) chip = <div className="bc-dd brk bc-disp">{s.breakInfo.label}</div>;
  else chip = <div className="bc-dd brk bc-disp">Kickoff</div>; // nothing to snap: a score or the opening kick
  return (
    <div className="bc-sit">
      {chip}
      <div className="bc-spot">
        {sit?.spot ? <><small>Ball on</small>{sit.spot}</> : sit ? <><small>Possession</small>{teamShort(off)}</> : <small>{s.timeout?.detail || s.breakInfo?.detail || ""}</small>}
      </div>
      <Field sit={sit?.ytg != null ? sit : null} game={game} />
    </div>
  );
}

// ── The play just revealed, else what's next ──
const TONES = { td: "#f6a21d", turnover: "#ff5a5a", miss: "#ff5a5a", flag: "#f2c94c", big: "#4d9fff", normal: "#9fb0c8" };
// /live's "waiting for the snap" dots (LivePlayCard.js PendingPlayCard).
const Dots = () => <span className="bc-dots-wait"><i /><i /><i /></span>;
function PlayPanel({ s, game }) {
  const p = s.currentPlay;
  const c = s.callingPlay;
  if (c) {
    // The call first — what the play is and who has it — the result next.
    return (
      <div className="bc-panel bc-play">
        <div className="bc-ph"><span className="gold">On the field</span>{c.situation && <span className="right">{c.situation}</span>}</div>
        <div key={`call-${c.id}`} className="bc-play-body bc-call" style={{ "--tone": panelColor(c.team) }}>
          <div className="bc-play-main">
            <span className="bc-badge">{c.label}<Dots /></span>
            {c.player && <div className="bc-call-name bc-disp bc-ell">{c.player}</div>}
          </div>
          <div className="bc-play-side">
            <Logo team={c.team} />
            <div className="clk">{c.clock}</div>
          </div>
        </div>
      </div>
    );
  }
  if (p) {
    return (
      <div className="bc-panel bc-play">
        <div className="bc-ph"><span className="gold">Just now</span>{p.situation && <span className="right">{p.situation}</span>}</div>
        <div key={p.id} className={`bc-play-body${s.calledId === p.id ? " bc-result" : ""}`} style={{ "--tone": TONES[p.tone] }}>
          <div className="bc-play-main">
            <span className="bc-badge">{p.headline}</span>
            <div className="bc-line">
              {p.line ? p.line.map((t, i) => (
                t.text === "→" && p.miss
                  // an incomplete pass: the arrow is crossed out, as on /live
                  ? <span key={i}>{" "}<span className="bc-arrow-miss" aria-label="incomplete">→<i>✕</i></span></span>
                  : <span key={i} className={t.player ? "pl" : t.sub ? "sub" : undefined}>{i ? " " : ""}{t.text}</span>
              )) : p.text}
            </div>
            {(p.detail || p.firstDown) && (
              <div className="bc-detail bc-ell">{p.detail}{p.firstDown && <span className="bc-chip">1st Down</span>}</div>
            )}
            {p.stats.length > 0 && (
              <div className="bc-pstats">
                {p.stats.map((x) => (
                  <div key={x.key} className="bc-pstat" style={{ "--pc": panelColor(x.team) }}>
                    <Logo team={x.team} />
                    <span className="n">{x.short}</span>
                    <FitText as="span" className="l" text={x.line} />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bc-play-side">
            <Logo team={p.team} />
            <div className="clk">{p.clock}</div>
          </div>
        </div>
      </div>
    );
  }
  // Nothing just happened: the next snap, a timeout, a break, or a kickoff.
  const sit = s.situation;
  const off = sit ? game[sit.offense] : null;
  let body;
  if (s.breakInfo) {
    const top = s.breakInfo.summary?.top;
    body = (
      <div key={`brk-${s.breakInfo.label}`} className="bc-next">
        <img src={WD_ICON} alt="" style={{ width: 120, height: 120 }} />
        <div style={{ minWidth: 0 }}>
          <div className="lbl">{s.breakInfo.label}</div>
          <div className="big bc-disp" style={{ fontSize: 96 }}>{teamShort(game.away)} {game.away?.points ?? 0} – {teamShort(game.home)} {game.home?.points ?? 0}</div>
          {top && <div className="sm bc-ell">Top performer · {top.name}{top.lines?.[0]?.[1] ? ` · ${top.lines[0][1]}` : ""}</div>}
        </div>
      </div>
    );
  } else if (s.timeout) {
    const side = s.timeout.side ? game[s.timeout.side] : null;
    body = (
      <div key="timeout" className="bc-next">
        {side ? <Logo team={side} /> : <img src={WD_ICON} alt="" style={{ width: 120, height: 120 }} />}
        <div>
          <div className="lbl">Play stopped</div>
          <div className="big bc-disp">Timeout</div>
          <div className="sm">{s.timeout.detail || "Play will resume shortly"}{sit?.down ? ` · ${sit.down}${sit.spot ? ` at ${sit.spot}` : ""}` : ""}</div>
        </div>
      </div>
    );
  } else if (sit) {
    body = (
      <div key={`next-${sit.offense}-${sit.down}-${sit.ytg}`} className="bc-next">
        <Logo team={off} />
        <div>
          <div className="lbl">Next play<Dots /> · {teamShort(off)} ball</div>
          <div className="big bc-disp">{sit.down}</div>
          {sit.spot && <div className="sm">Ball on the {sit.spot}{sit.changeOfPossession ? <span className="bc-chip warn">Change of possession</span> : null}</div>}
        </div>
      </div>
    );
  } else {
    body = (
      <div key="kickoff" className="bc-next">
        <img src={WD_ICON} alt="" style={{ width: 120, height: 120 }} />
        <div>
          <div className="lbl">{s.phase === "kickoff" ? "1st Qtr · 15:00" : "Up next"}</div>
          <div className="big bc-disp">{s.phase === "kickoff" ? <>Kickoff shortly<Dots /></> : "Kickoff"}</div>
        </div>
      </div>
    );
  }
  const waiting = s.phase === "kickoff" && !s.kickoffAt;
  return (
    <div className="bc-panel bc-play">
      <div className="bc-ph"><span>On the field</span>{waiting && <span className="right gold">Waiting for kickoff<Dots /></span>}</div>
      {waiting ? <KickoffWait game={game} fallback={body} /> : body}
    </div>
  );
}

// Waiting for kickoff: the two teams' season numbers in the panel until
// the first snap (the pregame's Season stats, four of them).
const WAIT_STATS = ["ppg", "ypg", "papg", "toMargin"];
const WAIT_LABEL = { ppg: "Points / game", ypg: "Yards / game", papg: "Points allowed", toMargin: "TO margin" };
function KickoffWait({ game, fallback }) {
  const teamStats = useFbsTeamStats();
  const ts = { away: teamStats?.get(Number(game.away?.providerTeamId)), home: teamStats?.get(Number(game.home?.providerTeamId)) };
  const rows = SEASON_STATS.filter(([, k]) => WAIT_STATS.includes(k) && (ts.away?.v?.[k] != null || ts.home?.v?.[k] != null));
  if (!rows.length) return fallback;
  return <SeasonGrid game={game} ts={ts} rows={rows.map(([l, k, low]) => [WAIT_LABEL[k] || l, k, low])} className="bc-sgrid in-play" compact />;
}

function RecentPlays({ rows }) {
  // The newest row slides in when it's new (not on first paint).
  const firstTop = useRef(rows[0]?.id);
  return (
    <div className="bc-panel bc-recent">
      <div className="bc-ph"><span>Recent plays</span></div>
      {rows.slice(0, 3).map((r, i) => (
        <div key={r.id} className={`bc-rrow ${r.tone}${i === 0 && r.id !== firstTop.current ? " fresh" : ""}`}>
          <span className="t">{r.clock}</span>
          <Logo team={r.team} />
          <span className="x bc-ell">{r.text}</span>
          {r.stat && <span className="st"><b>{r.stat.short}</b><FitText as="span" className="stl" text={r.stat.line} /></span>}
        </div>
      ))}
      {!rows.length && <div className="bc-rrow"><span className="x" style={{ color: "#7f90aa" }}>Plays will appear here as they happen.</span></div>}
    </div>
  );
}

// ── Team stats ──
// Both teams side by side, from the play-by-play stats doc (box/live) as of
// the plays on screen. Each row: the two numbers, the stat between them,
// and a split bar in the teams' colors (utils/live.js distinctTeamColors —
// two teams with near-identical colors still read apart).
const pct = (r) => (r?.[1] ? Math.round((r[0] / r[1]) * 100) : 0);
const ratio = (r) => (r?.[1] ? `${r[0]}/${r[1]}` : "0/0");
function teamStatRows(A = {}, H = {}, tall) {
  const tot = (T) => T.totalYds ?? (T.passYds || 0) + (T.rushYds || 0);
  const rows = [
    ["Total yards", tot(A), tot(H)],
    ["Passing yards", A.passYds ?? 0, H.passYds ?? 0],
    ["Rushing yards", A.rushYds ?? 0, H.rushYds ?? 0],
    ["Yards per play", (A.ypp ?? 0).toFixed(1), (H.ypp ?? 0).toFixed(1), A.ypp ?? 0, H.ypp ?? 0],
    ["First downs", A.firstDowns ?? 0, H.firstDowns ?? 0],
    ["3rd down", ratio(A.third), ratio(H.third), pct(A.third), pct(H.third)],
    ["Turnovers", A.turnovers ?? 0, H.turnovers ?? 0],
    ["Penalties", `${A.penalties ?? 0}-${A.penaltyYds ?? 0}`, `${H.penalties ?? 0}-${H.penaltyYds ?? 0}`, A.penaltyYds ?? 0, H.penaltyYds ?? 0],
  ];
  if (tall) {
    rows.splice(6, 0, ["4th down", ratio(A.fourth), ratio(H.fourth), A.fourth?.[0] ?? 0, H.fourth?.[0] ?? 0]);
    rows.splice(8, 0, ["Sacks allowed", A.sacked ?? 0, H.sacked ?? 0]);
  }
  // Fewer is better for these — the brighter number is the team doing better.
  const LOW = new Set(["Turnovers", "Penalties", "Sacks allowed"]);
  return rows.map(([label, a, h, av = Number(a) || 0, hv = Number(h) || 0]) => ({
    label, a, h, share: av + hv > 0 ? av / (av + hv) : 0.5,
    better: av === hv ? null : (av > hv) !== LOW.has(label) ? "away" : "home",
  }));
}

function TeamStats({ s, game, tall }) {
  const T = s.stats?.teams;
  const [ac, hc] = distinctTeamColors(game.away, game.home).map(barColor);
  const rows = T ? teamStatRows(T.away, T.home, tall) : [];
  return (
    <div className={`bc-panel bc-tstats${tall ? " tall" : ""}`} style={{ "--ac": ac, "--hc": hc }}>
      <div className="bc-ph"><span className="gold">Team stats</span><span className="right">{s.phase === "final" ? "Final" : s.phase === "halftime" ? "First half" : "Live"}</span></div>
      <div className="bc-tst-head">
        <span className="t away"><Logo team={game.away} /><b className="bc-disp">{teamShort(game.away)}</b></span>
        <span className="t home"><b className="bc-disp">{teamShort(game.home)}</b><Logo team={game.home} /></span>
      </div>
      {rows.length ? rows.map((r) => (
        <div key={r.label} className="bc-tst-row">
          <div className="v">
            <b className={r.better === "away" ? "up" : ""}>{r.a}</b>
            <span>{r.label}</span>
            <b className={r.better === "home" ? "up" : ""}>{r.h}</b>
          </div>
          <div className="bar"><i style={{ width: `${(r.share * 100).toFixed(1)}%` }} /></div>
        </div>
      )) : <div className="bc-quiet" style={{ padding: "0 26px" }}>Team stats will show after the first snap.</div>}
    </div>
  );
}

// ── Summaries ──
function LineScore({ game, quarters }) {
  const q = (side) => quarters?.[side] || game[side]?.lineScores || [];
  const n = Math.max(4, q("away").length, q("home").length);
  const cols = Array.from({ length: n }, (_, k) => k);
  return (
    <table className="bc-ls">
      <thead><tr><th style={{ textAlign: "left" }} />{cols.map((k) => <th key={k}>{k < 4 ? k + 1 : k === 4 ? "OT" : `${k - 3}OT`}</th>)}<th>T</th></tr></thead>
      <tbody>
        {["away", "home"].map((side) => (
          <tr key={side}>
            <td className="tm"><Logo team={game[side]} /><span className="bc-disp" style={{ fontSize: 40 }}>{teamShort(game[side])}</span></td>
            {cols.map((k) => <td key={k}>{q(side)[k] ?? "–"}</td>)}
            <td className="tot">{game[side]?.points ?? 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Leaders({ title, items, game }) {
  return (
    <div className="bc-lead">
      <div className="h">{title}</div>
      {items.map((x) => (
        <div key={x.cat} className="p">
          <Logo team={game[x.side]} />
          <div className="c">{x.cat}</div>
          <div className="n bc-ell">{x.name}</div>
          <div className="l bc-ell">{x.line}</div>
        </div>
      ))}
      {!items.length && <div style={{ fontSize: 28, color: "#7f90aa" }}>Leaders will show once the numbers are in.</div>}
    </div>
  );
}

// The ingester's halftime summary (server/live/breaks.js) when it has
// one; otherwise the same numbers from the live stats doc, which at the
// half is the first half.
const leaderItems = (stats, cats = ["passing", "rushing", "receiving"]) => {
  const L = stats ? gameLeaders(stats, 1) : {};
  return cats.filter((c) => L[c]?.[0]).map((c) => ({ cat: c, name: L[c][0].name, side: L[c][0].side, line: statLine(c, L[c][0].stats) }));
};
function HalftimePanel({ s, game }) {
  const h = s.halftime;
  const leaders = h?.leaders ? ["passing", "rushing", "receiving"].filter((c) => h.leaders[c]).map((c) => ({ cat: c, ...h.leaders[c] })) : leaderItems(s.stats);
  return (
    <div className="bc-panel bc-summary tall">
      <div className="bc-ph"><span className="gold">Halftime</span><span className="right">Full first-half stats · we-draft.com/live</span></div>
      <div className="bc-sum-body">
        <div>
          <LineScore game={game} quarters={h?.quarters} />
        </div>
        <Leaders title="First-half leaders" items={leaders} game={game} />
      </div>
    </div>
  );
}

function FinalPanel({ s, game }) {
  const hp = game.home?.points ?? 0;
  const ap = game.away?.points ?? 0;
  const win = hp === ap ? null : hp > ap ? "home" : "away";
  const items = leaderItems(s.stats, ["passing", "rushing", "receiving", "defense"]).slice(0, 3);
  return (
    <div className="bc-panel bc-summary tall">
      <div className="bc-ph"><span className="gold">Final</span><span className="right">Full recap · we-draft.com/live</span></div>
      <div className="bc-sum-body">
        <div>
          <div className="bc-win bc-disp">
            {win ? `${teamName(game[win])} wins` : "Final"}
            <small>{teamShort(game.away)} {ap} · {teamShort(game.home)} {hp}{game.period > 4 ? " · Overtime" : ""}</small>
          </div>
          <div style={{ marginTop: 26 }}><LineScore game={game} /></div>
        </div>
        <Leaders title="Game leaders" items={items} game={game} />
      </div>
    </div>
  );
}

// ── Pregame ──
// Before kickoff: the two teams' season stats, with national ranks
// (cfbLeaders/teams — utils/fbsTeamStats.js), gold on the better number.
// How long each takes its turn in the panel (the stats get the longer look).
const PREGAME_PROS_MS = 20 * 1000;
const PREGAME_STATS_MS = 40 * 1000;
const SEASON_STATS = [
  ["Points / game", "ppg"], ["Total yards / game", "ypg"], ["Passing yards / game", "passYpg"], ["Rushing yards / game", "rushYpg"],
  ["Points allowed", "papg", true], ["Yards allowed", "yapg", true], ["Turnover margin", "toMargin"], ["3rd down %", "thirdPct"],
];
function SeasonStats({ game, ts }) {
  return (
    <div key="stats" className="bc-panel bc-pros">
      <div className="bc-ph"><img src={WD_ICON} alt="" /><span className="gold">Season stats</span><span className="right">National rank among FBS teams</span></div>
      <SeasonGrid game={game} ts={ts} rows={SEASON_STATS} />
    </div>
  );
}
// compact: no national ranks (the narrow in-panel version).
function SeasonGrid({ game, ts, rows, className = "bc-sgrid", compact = false }) {
  const val = (t, k) => (t?.v?.[k] == null ? "—" : fmtTeamStat(k, t.v[k]));
  const rk = (t, k) => (!compact && t?.v?.[k] != null && t?.r?.[k] ? `${t.r[k].replace(/^(T-)?/, "$1#")}` : "");
  return (
      <div className={className}>
        {rows.map(([label, k, low]) => {
          const a = ts.away?.v?.[k];
          const h = ts.home?.v?.[k];
          const edge = a == null || h == null || a === h ? [false, false] : low ? [a < h, h < a] : [a > h, h > a];
          return (
            <div key={k} className="bc-scard">
              <div className="lbl">{label}</div>
              <div className="row">
                <Logo team={game.away} />
                <b className={`bc-disp${edge[0] ? " best" : ""}`}>{val(ts.away, k)}</b><small>{rk(ts.away, k)}</small>
                <i />
                <small>{rk(ts.home, k)}</small><b className={`bc-disp${edge[1] ? " best" : ""}`}>{val(ts.home, k)}</b>
                <Logo team={game.home} />
              </div>
            </div>
          );
        })}
      </div>
  );
}

// A prospect's community draft grade: the round's colored pill over its
// name ("Early 1st", "3rd Round"); ungraded players are on the watchlist.
const gradeShort = (g) => g.replace(/^(Early|Middle|Late) First Round$/, (_, w) => `${w === "Middle" ? "Mid" : w} 1st`);
function GradeChip({ grade }) {
  const g = grade || "Watchlist";
  const badge = GRADE_BADGE[g] || GRADE_BADGE.Watchlist;
  return (
    <div className="bc-grade">
      <span className="pill bc-disp" style={{ background: badge.bg, borderColor: badge.border }}>{badge.short}</span>
      <span className="gl">{gradeShort(g)}</span>
    </div>
  );
}

function Pregame({ s, game }) {
  const at = game.startDate ? new Date(game.startDate) : null;
  const ok = at && !isNaN(at);
  const ms = ok ? at.getTime() - s.now : null;
  const count = ms == null || ms <= 0 ? "Kickoff shortly"
      : ms < 3600e3 ? `Kickoff in ${Math.max(1, Math.round(ms / 60e3))} min`
        : ms < 86400e3 ? `Kickoff in ${Math.floor(ms / 3600e3)}h ${Math.round((ms % 3600e3) / 60e3)}m`
          : `Kickoff ${at.toLocaleDateString("en-US", { weekday: "long", timeZone: ET })}`;
  const side = (k) => {
    const t = game[k] || {};
    return (
      <div className={`bc-mside ${k}`} style={{ "--pc": panelColor(t) }}>
        <Logo team={t} onColor />
        <div className="school bc-disp bc-ell">{t.rank ? <span className="rank">#{t.rank}</span> : null}{teamName(t) || teamShort(t)}</div>
        {t.mascot && <div className="sub">{t.mascot}</div>}
      </div>
    );
  };
  const pros = s.playerWatch.slice(0, 6);
  // The panel under the matchup: prospects to watch and the two teams'
  // season stats take turns (just one when the other has nothing).
  const teamStats = useFbsTeamStats();
  const ts = { away: teamStats?.get(Number(game.away?.providerTeamId)), home: teamStats?.get(Number(game.home?.providerTeamId)) };
  const hasStats = SEASON_STATS.some(([, k]) => ts.away?.v?.[k] != null || ts.home?.v?.[k] != null);
  const [turn, setTurn] = useState(0);
  const both = hasStats && pros.length > 0;
  const view = hasStats && (!pros.length || turn % 2 === 1) ? "stats" : "pros";
  useEffect(() => {
    if (!both) return undefined;
    const t = setTimeout(() => setTurn((x) => x + 1), view === "stats" ? PREGAME_STATS_MS : PREGAME_PROS_MS);
    return () => clearTimeout(t);
  }, [both, view]);
  return (
    <>
      <div className="bc-match">
        {side("away")}
        <div className="bc-mmid">
          <div className="lbl">{ok ? at.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: ET }) : "Kickoff"}</div>
          <div className="kick bc-disp">{ok && !game.startTimeTBD ? `${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET })} ET` : "TBA"}</div>
          <div className="cd">{count}</div>
          {game.venue && <div className="venue">{game.venue}</div>}
        </div>
        {side("home")}
      </div>
      {view === "stats" ? <SeasonStats game={game} ts={ts} /> : (
        <div key="pros" className="bc-panel bc-pros">
          <div className="bc-ph"><img src={WD_ICON} alt="" /><span className="gold">We-Draft prospects to watch</span><span className="right">Scouting reports · we-draft.com</span></div>
          <div className="bc-pgrid">
            {pros.map((p) => (
              <div key={p.slug} className="bc-pcard" style={{ "--pc": panelColor(p.team) }}>
                <Logo team={p.team} />
                <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                  <div className="n bc-disp bc-ell">{p.name}</div>
                  <div className="m bc-ell">{[p.pos, teamShort(p.team), p.cls ? `Class of ${p.cls}` : null].filter(Boolean).join(" • ")}</div>
                </div>
                <GradeChip grade={p.grade} />
              </div>
            ))}
            {!pros.length && <div style={{ gridColumn: "1 / -1", alignSelf: "center", textAlign: "center", fontSize: 32, color: "#7f90aa" }}>Prospect list loading — every player's scouting report is at we-draft.com</div>}
          </div>
        </div>
      )}
    </>
  );
}

// ── Ticker ──
function Ticker({ game, phase }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => x + 1), CTA_ROTATE_MS);
    return () => clearInterval(t);
  }, []);
  const list = BROADCAST_CTAS;
  const c = list[i % list.length];
  return (
    <div className="bc-tick">
      <div className="site bc-disp"><img src={WD_ICON} alt="" />We-Draft.com</div>
      <div key={c.key} className="msg">
        <span className="l bc-ell">{c.label}</span>
        <span className="arrow" />
        <span className="u">{c.url(game)}</span>
      </div>
    </div>
  );
}

function Slate({ title, sub }) {
  return (
    <div className="bc-slate">
      <img src={WD_ICON} alt="" />
      <div className="t bc-disp">We-Draft<span className="live">Live</span></div>
      {title && <div className="s">{title}</div>}
      {sub && <div className="s" style={{ fontSize: 30, color: "#7f90aa" }}>{sub}</div>}
    </div>
  );
}

function BroadcastScreen({ s }) {
  const game = s.game;
  const vars = { "--away": game?.away?.color || "#0055a5", "--home": game?.home?.color || "#f6a21d" };
  let body;
  if (s.phase === "loading") body = <Slate title="Broadcast starting soon" />;
  else if (s.phase === "missing") body = <Slate title="Game not found" sub="Check the game link at we-draft.com/live" />;
  else if (s.phase === "pregame") body = <><TopBar s={s} game={game} /><Pregame s={s} game={game} /><Ticker game={game} phase={s.phase} /></>;
  else {
    body = (
      <>
        <TopBar s={s} game={game} />
        <Scorebug s={s} game={game} />
        {(s.phase === "live" || s.phase === "kickoff") && <SituationStrip s={s} game={game} />}
        {s.phase === "halftime" ? <HalftimePanel s={s} game={game} />
          : s.phase === "final" ? <FinalPanel s={s} game={game} />
            : <><PlayPanel s={s} game={game} /><RecentPlays rows={s.recentPlays} /></>}
        <TeamStats s={s} game={game} tall={s.phase !== "live" && s.phase !== "kickoff"} />
        <Ticker game={game} phase={s.phase} />
        <BroadcastEvent event={s.event} game={game} tall={s.phase !== "live" && s.phase !== "kickoff"} />
        <BroadcastEvent event={s.sideEvent} game={game} tall={s.phase !== "live" && s.phase !== "kickoff"} />
        {s.kickoffAt && <KickoffBurst key={s.kickoffAt} at={s.kickoffAt} away={game.away} home={game.home} sub="We-Draft Live · Game on" />}
      </>
    );
  }
  return (
    <>
      <div className="bc-bg" style={vars} />
      <div style={{ ...vars, position: "absolute", inset: 0 }}>{body}</div>
    </>
  );
}

export default memo(BroadcastScreen);
