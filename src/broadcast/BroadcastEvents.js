// src/broadcast/BroadcastEvents.js
//
// The broadcast's temporary graphics. useBroadcastState hands the screen
// one event at a time ({ type, side, durationMs, player?, insight?, ... },
// see utils/broadcast.js); this module looks its type up in GRAPHICS and
// renders it. When the event's time is up the hook clears it and the
// screen is back to normal — no cleanup here.
//
// Every graphic is a morph of a column, not a popup: it starts as an exact
// copy of the boxes there, they close into one box in the team's color, the
// call comes up inside it; at the end the same steps run backwards and the
// real boxes underneath are uncovered.
//   left   plays — touchdowns, turnovers, sacks, big plays (over the play
//          panel + recent plays, or the one summary box at halftime / final)
//   right  insights — a We-Draft player's moment (grade, strengths) or a
//          team trend (over the team stats board, which comes back after)
// All motion is CSS keyframes timed by --dur (broadcastStyle.js .bc-mo*),
// clip-path / opacity / transform only — deterministic and cheap for a
// headless capture; nothing moves once the graphic is gone.
//
// Adding or upgrading a graphic is one entry in GRAPHICS.
import { memo } from "react";
import { panelColor, accentColor, playerUrl } from "../utils/broadcast";
import { teamName } from "../utils/live";
import { GRADE_BADGE } from "../components/LiveInsightCard";

const WD_ICON = "/wd-icon.png";
const logoOf = (t) => t?.logoDark || t?.logo || null;

// The columns, in canvas px (broadcastStyle.js .bc-play / .bc-recent /
// .bc-summary.tall / .bc-tstats). g1 / g2: where the gap between the two
// left boxes starts and ends inside the morph; gm: where they meet.
const FRAMES = {
  left: {
    live: { left: 64, width: 1150, top: 452, height: 508, g1: 322, g2: 338, gm: 330 },
    tall: { left: 64, width: 1150, top: 348, height: 612, g1: 306, g2: 306, gm: 306 },
  },
  right: {
    live: { left: 1246, width: 610, top: 452, height: 508, g1: 254, g2: 254, gm: 254 },
    tall: { left: 1246, width: 610, top: 348, height: 612, g1: 306, g2: 306, gm: 306 },
  },
};

// size "big": the full treatment — flash, sweep, moving stripes, the word
// slamming in, a big number (points / yards) on the right; "small" a
// calmer version for the rest. word / sub / num(e, game).
const GRAPHICS = {
  TOUCHDOWN: { size: "big", word: () => "Touchdown", sub: (e) => [e.subtitle, e.player?.name].filter(Boolean).join(" · "), num: () => "+6" },
  FIELD_GOAL: { size: "big", word: () => "Field Goal", sub: (e) => e.player?.name || "", num: () => "+3" },
  SAFETY: { size: "big", word: () => "Safety", sub: () => "", num: () => "+2" },
  INTERCEPTION: { size: "big", word: () => "Interception", sub: (e) => (e.player?.name ? `Picked off by ${e.player.name}` : "") },
  FUMBLE: { size: "big", word: () => "Turnover", sub: (e) => (e.player?.name ? `Fumble · ${e.player.name}` : "Fumble recovered") },
  BIG_PLAY: { size: "big", word: () => "Big Play", sub: (e) => e.player?.name || "", num: (e) => (e.yards ? String(e.yards) : null), unit: "Yds" },
  TURNOVER_ON_DOWNS: { size: "small", word: () => "Turnover on Downs", sub: (e) => e.detail || "" },
  // the sacker (whose link is under it), not the QB the play text leads with
  SACK: { size: "small", word: () => "Sack", sub: (e) => (e.player?.name ? `Sacked by ${e.player.name}` : e.detail || "") },
  FOURTH_DOWN_CONVERSION: { size: "small", word: () => "4th Down Converted", sub: (e) => e.detail || "" },
  HALFTIME: { size: "big", calm: true, word: () => "Halftime", sub: (e, g) => scoreLine(g) },
  END_OF_GAME: { size: "big", word: () => "Final", sub: (e, g) => (e.side ? `${teamName(g?.[e.side])} wins · ${scoreLine(g)}` : scoreLine(g)) },
  PLAYER_MILESTONE: { column: "right", component: (props) => <PlayerCard {...props} /> },
  TEAM_TREND: { column: "right", component: (props) => <TrendCard {...props} /> },
};

const scoreLine = (g) => (g ? `${g.away?.short || teamName(g.away)} ${g.away?.points ?? 0} – ${g.home?.short || teamName(g.home)} ${g.home?.points ?? 0}` : "");

// A We-Draft prospect on a big play gets his profile address on screen.
function WdTag({ player, label = "PROSPECT" }) {
  const url = playerUrl(player?.slug);
  if (!url) return null;
  return <div className="bc-wdtag"><img src={WD_ICON} alt="" />{label} · <b>{url}</b></div>;
}

// The call: the team, the word, the line under it, a prospect's link, and
// the big number.
function Call({ e, game, spec }) {
  const team = e.side ? game?.[e.side] : null;
  const word = spec.word(e, game);
  const sub = spec.sub(e, game);
  const num = spec.num?.(e, game);
  return (
    <>
      {logoOf(team) ? <img className="logo" src={logoOf(team)} alt="" /> : <img className="logo" src={WD_ICON} alt="" />}
      <div className="txt">
        {team && spec.size === "big" && <div className="who bc-disp bc-ell">{teamName(team)}</div>}
        <div className={`word bc-disp${word.length > 11 ? " long" : ""}`}>{word}</div>
        {sub && <div className="sub bc-ell">{sub}</div>}
        <WdTag player={e.player} />
      </div>
      {num && <div className="num bc-disp">{num}{spec.unit && <small>{spec.unit}</small>}</div>}
    </>
  );
}

// A player's moment (server/live/insights.js, kind "player"), on the right:
// the We-Draft Player Watch card — what he just did, then who he is on the
// We-Draft board: grade, class rank, strengths, and where to read more.
function PlayerCard({ e, game }) {
  const ins = e.insight || {};
  const team = e.side ? game?.[e.side] : null;
  const wd = ins.wd;
  const url = playerUrl(ins.player?.slug);
  const meta = [wd?.pos, team ? teamName(team) : null, wd?.cls ? `Class of ${wd.cls}` : null].filter(Boolean).join(" • ") || ins.subtitle || "";
  const grade = wd ? wd.grade || "Watchlist" : null;
  const badge = grade ? GRADE_BADGE[grade] || GRADE_BADGE.Watchlist : null;
  const name = ins.title || ins.player?.name || "";
  return (
    <div className="pcard">
      <div className="kick"><img src={WD_ICON} alt="" />{wd ? "We-Draft Player Watch" : ins.milestone ? "Milestone" : "Player Watch"}</div>
      <div className="who">
        {logoOf(team) && <img src={logoOf(team)} alt="" />}
        <div className={`nm bc-disp${name.length > 16 ? " long" : ""}`}>{name}</div>
      </div>
      {meta && <div className="meta bc-ell">{meta}</div>}
      {ins.statLine && <div className="stat bc-ell">{ins.statLine}</div>}
      {ins.context && <div className="ctx">{ins.context}</div>}
      {wd && (
        <div className="board">
          <div className="grade">
            <span className="pill" style={{ background: badge.bg, borderColor: badge.border }}>{badge.short}</span>
            <span className="gl">{grade}</span>
            {wd.classRank && wd.cls && <span className="rk">No. {wd.classRank} in {wd.cls}</span>}
          </div>
          {wd.strengths?.length > 0 && (
            <div className="str">
              <span className="h">Strengths</span>
              {wd.strengths.slice(0, 3).map((t) => <span key={t} className="tag">{t}</span>)}
            </div>
          )}
        </div>
      )}
      {url && <div className="url">Full scouting report<b>{url}</b></div>}
    </div>
  );
}

// A team or game trend (third downs, sacks, a run of points), on the right.
function TrendCard({ e, game }) {
  const ins = e.insight || {};
  const team = e.side ? game?.[e.side] : null;
  return (
    <div className="pcard trend">
      <div className="kick"><img src={WD_ICON} alt="" />{ins.category === "game_trend" ? "Game trend" : "Team trend"}</div>
      <div className="who">
        {logoOf(team) && <img src={logoOf(team)} alt="" />}
        <div className="nm bc-disp">{teamName(team) || ins.title}</div>
      </div>
      {ins.headline && <div className="hl bc-disp">{ins.headline}</div>}
      {ins.statLine && <div className="stat">{ins.statLine}</div>}
      {ins.context && <div className="ctx">{ins.context}</div>}
      {ins.extra?.[0] && <div className="meta">{ins.extra[0]}</div>}
    </div>
  );
}

function BroadcastEvent({ event, game, tall }) {
  if (!event) return null;
  const spec = GRAPHICS[event.type];
  if (!spec) return null;
  const col = spec.column || "left";
  const f = FRAMES[col][tall ? "tall" : "live"];
  const team = event.side ? game?.[event.side] : null;
  const kind = spec.component ? "card" : `${spec.size}${spec.calm ? " calm" : ""}`;
  // key: a new event always remounts, so its morph plays from the start.
  return (
    <div key={event.id} className={`bc-mo ${col} ${kind}`}
      style={{
        left: f.left, width: f.width, top: f.top, height: f.height, "--g1": `${f.g1}px`, "--g2": `${f.g2}px`, "--gm": `${f.gm}px`,
        "--dur": `${event.durationMs}ms`, "--ec": panelColor(team, "#0b2d5c"), "--ec2": accentColor(team),
      }}>
      <div className="tint" />
      {spec.size === "big" && !spec.calm && <><div className="stripes" /><div className="flash" /><div className="sweep" /></>}
      <div className="body">{spec.component ? <spec.component e={event} game={game} /> : <Call e={event} game={game} spec={spec} />}</div>
    </div>
  );
}

export const EVENT_TYPES = Object.keys(GRAPHICS);
export default memo(BroadcastEvent);
