// src/components/LivePlayCard.js
//
// One play in We-Draft Live, rendered from the play's `presentation`
// (server/live/playParser.js) — never from the raw CFBD text, which is kept
// only as a fallback and as the detailed card's hover tooltip.
//
//   variant "compact"  — Big Plays rail / My Players: event, players,
//                        yardage, then clock · quarter.
//   variant "detailed" — a single game's feed: the event block, with clock,
//                        quarter, possession and down & distance in a column
//                        on the right.
//
// Player names: tap to follow (by CFBD athlete id — works for everyone);
// the We-Draft circle logo opens the profile (new tab) when there is one.
// Nothing requires a profile.
import { useRef } from "react";
import { periodLabel, downLabel, spotLabel } from "../utils/live";

const GOLD = "#f6a21d";

// One size for every play (the big, readable-from-the-couch size); only
// "hype" plays — touchdowns, turnovers, 20+ yard gains, see isHype() —
// step up from it. Color (left border + badge) still says what kind of
// play it was.
export const PLAY_CARD_STYLE = `
.lpc { --hc: #2a3753; position: relative; background: #111a2b; border: 1px solid #1d2840; border-left: 5px solid var(--hc); border-radius: 14px; padding: 14px 18px; margin-bottom: 10px; }
.lpc.td { --hc: ${GOLD}; }
.lpc.turnover { --hc: #ff4d4d; }
.lpc.score { --hc: #3ecf8e; }
.lpc.big { --hc: #4d9fff; }
.lpc.negative { --hc: #c9822b; }
.lpc.final { --hc: #dfe6f0; background: linear-gradient(100deg, rgba(223,230,240,0.10), #111a2b 60%); }
.lpc.final .lpc-badge { color: #f4f7fb; }
.lpc.hype { border-left-width: 7px; padding: 18px 20px;
  background: linear-gradient(100deg, color-mix(in srgb, var(--hc) 24%, #111a2b), #111a2b 60%);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--hc) 55%, transparent) inset, 0 12px 34px -14px var(--hc);
  animation: lpc-in 0.8s ease-out; }
@keyframes lpc-in {
  0% { transform: scale(0.97); box-shadow: 0 0 0 3px var(--hc), 0 0 40px -4px var(--hc); }
  60% { transform: scale(1.01); }
  100% { transform: scale(1); }
}
.lpc-compact { gap: 14px; }
.lpc-compact.hype .lpc-line { font-size: clamp(21px, 1.85vw, 30px); }
.lpc-compact .lpc-side { min-width: 0; width: clamp(108px, 8.5vw, 140px); padding-left: 14px; gap: 4px; align-items: stretch; }
.lpc-sb-row { display: flex; align-items: center; gap: 7px; font-weight: 900; font-variant-numeric: tabular-nums; }
.lpc-sb-row img { width: 22px; height: 22px; object-fit: contain; flex-shrink: 0; }
.lpc-sb-team { font-size: clamp(12px, 0.9vw, 14px); color: #c9d5e6; letter-spacing: 0.03em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lpc-sb-score { margin-left: auto; font-size: clamp(20px, 1.7vw, 28px); line-height: 1.1; color: #f4f7fb; }
.lpc-sb-row.trail .lpc-sb-score, .lpc-sb-row.trail .lpc-sb-team { color: #6f819c; }
.lpc-sb-clock { margin-top: 4px; text-align: right; font-weight: 900; font-size: clamp(12px, 0.95vw, 15px); color: #9fb0c8; font-variant-numeric: tabular-nums; }
.lpc.hype .lpc-sb-clock { color: var(--hc); }
.lpc-justnow { box-shadow: 0 0 0 2px var(--hc), 0 10px 30px -12px var(--hc); }
.lpc-justnow:not(.hype) { --hc: #4d9fff; }
.lpc-justnow-tag { font-size: 11px; font-weight: 900; letter-spacing: 0.12em; color: #121212; background: #eef2f8; border-radius: 999px; padding: 2px 9px; animation: lpc-pulse 1.6s ease-in-out infinite; }
@keyframes lpc-pulse { 50% { opacity: 0.55; } }
.lpc.miss { --hc: #a04848; }
.lpc.miss .lpc-badge { color: #e07a7a; }
.lpc.miss .lpc-line { color: #aab4c4; }
.lpc-arrow-miss { position: relative; display: inline-block; color: #8a5a5a; }
.lpc-arrow-miss i { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -54%); font-style: normal; font-size: 0.95em; color: #ff5c5c; font-weight: 900; }
.lpc-chip.bad { color: #ff7b7b; border-color: rgba(255,123,123,0.45); }
.lpc-two { margin-left: clamp(16px, 3vw, 44px); }
.lpc-compact.lpc-teamed { border-left-color: var(--tc); background-image: linear-gradient(100deg, color-mix(in srgb, var(--tc) 26%, transparent), transparent 58%); }
.lpc-compact .lpc-team { font-size: 14px; font-weight: 900; color: #eef2f8; }
.lpc-compact .lpc-team img { width: 28px; height: 28px; }
.lpc-sb-spot { text-align: right; font-weight: 800; font-size: clamp(11px, 0.85vw, 13px); color: #7f90aa; white-space: nowrap; }
.lpc-sb-row.scored .lpc-sb-score { color: ${GOLD}; animation: lpc-score-pop 1.6s ease-out; }
@keyframes lpc-score-pop { 0% { transform: scale(1.6); text-shadow: 0 0 14px rgba(246,162,29,0.9); } 40% { transform: scale(1.1); } 100% { transform: scale(1); } }
.lpc-lead { font-size: 1.12em; color: #fff; }
.lpc-sub { font-size: 0.74em; color: #9fb0c8; font-weight: 800; }
.lpc-side-swap { margin-top: 6px; display: inline-flex; align-items: center; gap: 5px; font-weight: 900; font-size: clamp(12px, 0.95vw, 15px); color: #ff8a8a; white-space: nowrap; }
.lpc-side-swap img { width: 20px; height: 20px; object-fit: contain; }
.lpc.negative .lpc-badge { letter-spacing: 0.1em; }
.lpc-win { position: relative; overflow: hidden; display: flex; align-items: center; gap: clamp(14px, 2vw, 28px);
  padding: clamp(18px, 2vw, 28px) clamp(18px, 2.2vw, 32px); border: 1px solid color-mix(in srgb, var(--wc) 70%, #fff 0%); border-left: 7px solid var(--wc);
  background: linear-gradient(110deg, color-mix(in srgb, var(--wc) 55%, #111a2b) 0%, color-mix(in srgb, var(--wc) 22%, #111a2b) 45%, #111a2b 85%);
  box-shadow: 0 14px 40px -16px var(--wc); animation: lpc-in 0.9s ease-out; }
.lpc-win::after { content: ""; position: absolute; inset: 0; background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.14) 50%, transparent 65%);
  transform: translateX(-100%); animation: lpc-shine 3.2s ease-in-out 0.6s infinite; pointer-events: none; }
@keyframes lpc-shine { 0% { transform: translateX(-100%); } 55%, 100% { transform: translateX(100%); } }
.lpc-win-logo { width: clamp(64px, 7vw, 110px); height: clamp(64px, 7vw, 110px); object-fit: contain; flex-shrink: 0; filter: drop-shadow(0 6px 14px rgba(0,0,0,0.45)); }
.lpc-win-body { min-width: 0; }
.lpc-win-badge { display: flex; align-items: center; gap: 8px; font-weight: 900; letter-spacing: 0.14em; font-size: clamp(13px, 1.1vw, 17px); color: #fff; opacity: 0.9; }
.lpc-win-name { margin-top: 4px; font-weight: 900; font-size: clamp(26px, 2.7vw, 44px); line-height: 1.05; color: #fff; text-transform: uppercase; letter-spacing: 0.02em; }
.lpc-win-rank { color: rgba(255,255,255,0.7); font-size: 0.7em; }
.lpc-win-score { margin-top: 8px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; font-variant-numeric: tabular-nums; }
.lpc-win-score b { font-weight: 900; font-size: clamp(30px, 3vw, 48px); color: #fff; }
.lpc-win-score b.lose { color: rgba(255,255,255,0.6); }
.lpc-win-score span { font-weight: 900; color: rgba(255,255,255,0.5); font-size: 1.4em; }
.lpc-win-score .lpc-win-over { font-size: clamp(14px, 1.2vw, 18px); color: rgba(255,255,255,0.75); font-weight: 800; }
@media (prefers-reduced-motion: reduce) { .lpc-win, .lpc-win::after { animation: none; } }
.lpc-click { cursor: pointer; }
.lpc-click:hover { border-color: #3a4a6a; }
.lpc-focus { outline: 3px solid ${GOLD}; outline-offset: 2px; animation: lpc-focus 2.4s ease-out; }
@keyframes lpc-focus { 0%, 30% { outline-color: ${GOLD}; } 100% { outline-color: rgba(246,162,29,0.35); } }
.lpc-fresh { animation: lpc-arrive 0.6s ease-out; }
.lpc.hype.lpc-fresh { animation: lpc-in 0.8s ease-out; }
@keyframes lpc-arrive { 0% { opacity: 0; transform: translateY(-10px); } 100% { opacity: 1; transform: none; } }
.lpc-pending { border-style: dashed; border-left-style: solid; --hc: #3a4a6a; background: #0e1625; }
.lpc-pending .lpc-line, .lpc-pending .lpc-side-clock { color: #9fb0c8; }
.lpc-pending.lpc-break { --hc: #8a6cff; border-style: solid; }
.lpc-pending.lpc-break .lpc-badge { color: #b8a6ff; }
.lpc-break-detail { color: #9fb0c8; letter-spacing: 0.04em; }
.lpc-flag { margin-top: 6px; font-weight: 900; font-size: clamp(15px, 1.2vw, 19px); color: #f2c94c; }
.lpc-upd { display: inline-block; animation: lpc-upd 1.4s ease-out; border-radius: 4px; }
@keyframes lpc-upd { 0% { background: rgba(246,162,29,0.45); color: #fff; } 100% { background: transparent; } }
.lpc-pending-team { display: inline-flex; align-items: center; gap: 10px; }
.lpc-pending-team img { width: 30px; height: 30px; object-fit: contain; }
.lpc-dots { display: inline-flex; gap: 4px; margin-left: 8px; vertical-align: middle; }
.lpc-dots i { width: 6px; height: 6px; border-radius: 50%; background: #9fb0c8; animation: lpc-dot 1.2s infinite ease-in-out; }
.lpc-dots i:nth-child(2) { animation-delay: 0.2s; }
.lpc-dots i:nth-child(3) { animation-delay: 0.4s; }
@keyframes lpc-dot { 0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .lpc.hype, .lpc-fresh, .lpc-focus, .lpc-upd, .lpc-dots i, .lpc-justnow-tag { animation: none; } }
.lpc-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: #7f90aa; font-weight: 800; font-size: clamp(12px, 0.95vw, 15px); font-variant-numeric: tabular-nums; }
.lpc-meta .sep { opacity: 0.5; }
.lpc-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.lpc-badge { font-weight: 900; letter-spacing: 0.1em; font-size: clamp(13px, 1vw, 16px); color: #9fb0c8; }
.lpc.td .lpc-badge { color: ${GOLD}; }
.lpc.turnover .lpc-badge { color: #ff6b6b; }
.lpc.score .lpc-badge { color: #3ecf8e; }
.lpc.big .lpc-badge { color: #7db8ff; }
.lpc.negative .lpc-badge { color: #e0a057; }
.lpc.hype .lpc-badge { background: var(--hc); color: #121212; padding: 4px 12px; border-radius: 999px; font-size: clamp(15px, 1.2vw, 19px); }
.lpc-team { display: inline-flex; align-items: center; gap: 6px; color: #c9d5e6; font-weight: 800; font-size: 13px; }
.lpc-team img { width: 20px; height: 20px; object-fit: contain; }
.lpc-score { margin-left: auto; font-weight: 900; color: #eef2f8; font-size: clamp(13px, 1vw, 16px); font-variant-numeric: tabular-nums; background: #1a2438; border-radius: 8px; padding: 3px 9px; border: none; cursor: default; }
button.lpc-score { cursor: pointer; }
.lpc-line { margin-top: 6px; font-weight: 900; font-size: clamp(19px, 1.7vw, 28px); line-height: 1.2; color: #f4f7fb; display: flex; align-items: center; flex-wrap: wrap; gap: 0 10px; }
.lpc.hype .lpc-line { margin-top: 10px; font-size: clamp(24px, 2.2vw, 36px); }
.lpc-join { color: #6f819c; font-weight: 800; font-size: 0.8em; }
.lpc-name { background: none; border: none; padding: 0; color: inherit; font: inherit; cursor: pointer; }
.lpc-name.on { color: ${GOLD}; }
.lpc-wd { display: inline-flex; margin-left: 6px; vertical-align: middle; border-radius: 50%; transition: transform 0.15s; }
.lpc-wd:hover { transform: scale(1.15); }
.lpc-wd img { width: 0.62em; height: 0.62em; min-width: 13px; min-height: 13px; object-fit: contain; display: block; }
.lpc-detail { margin-top: 4px; font-weight: 800; font-size: clamp(16px, 1.3vw, 22px); color: #c9d5e6; }
.lpc.hype .lpc-detail { font-size: clamp(19px, 1.65vw, 27px); color: #fff; }
.lpc.hype .lpc-side-clock { color: var(--hc); }
.lpc-chip { display: inline-block; margin-left: 8px; font-size: 11px; font-weight: 900; letter-spacing: 0.08em; color: #3ecf8e; border: 1px solid rgba(62,207,142,0.45); border-radius: 999px; padding: 1px 8px; vertical-align: middle; }
.lpc-chip.warn { color: #e0a057; border-color: rgba(224,160,87,0.45); }
.lpc-detailed { display: flex; align-items: stretch; gap: 20px; }
.lpc-body { flex: 1; min-width: 0; }
.lpc-side { flex-shrink: 0; min-width: clamp(110px, 11vw, 170px); display: flex; flex-direction: column; justify-content: center; align-items: flex-end; gap: 2px;
  padding-left: 18px; border-left: 1px solid #1d2840; text-align: right; font-variant-numeric: tabular-nums; }
.lpc-side-clock { font-weight: 900; font-size: clamp(24px, 2.2vw, 36px); line-height: 1; color: #eef2f8; }
.lpc-side-q { font-size: 0.55em; color: #9fb0c8; letter-spacing: 0.06em; margin-right: 8px; vertical-align: 0.2em; }
.lpc-side-spot { font-weight: 800; font-size: clamp(14px, 1.1vw, 18px); color: #9fb0c8; white-space: nowrap; }
.lpc-side-down { margin-top: 4px; font-weight: 800; font-size: clamp(15px, 1.2vw, 20px); color: #c9d5e6; white-space: nowrap; }
.lpc-side-score { margin: 8px 0 0; }
.lpc-side-ball { margin-top: 6px; display: inline-flex; align-items: center; gap: 6px; font-weight: 900; font-size: clamp(13px, 1vw, 16px); color: #c9d5e6; letter-spacing: 0.04em; white-space: nowrap; }
.lpc-side-ball img { width: 22px; height: 22px; object-fit: contain; }
.lpc-side-fb { color: ${GOLD}; font-size: 10px; }
@media (max-width: 640px) {
  .lpc-detailed { flex-direction: column; gap: 6px; }
  .lpc-side { order: -1; flex-direction: row; align-items: baseline; justify-content: flex-start; gap: 10px; min-width: 0; padding-left: 0; border-left: none; text-align: left; }
  .lpc-side-clock { font-size: 18px; }
  .lpc-side-down { margin-top: 0; }
  .lpc-side-score { margin: 0 0 0 auto; }
}
`;

const EMOJI = { td: "🔥 ", turnover: "🚨 ", big: "⚡ ", final: "🏁 " };

// Big-play rule for the "exciting" treatment: touchdowns, turnovers, and
// gains of HYPE_YARDS+ on a pass or run. (A nullified play never counts.)
const HYPE_YARDS = 20;
const isHype = (pres) => !pres.nullified && (pres.touchdown || pres.turnover
  || ((pres.type === "pass" || pres.type === "rush") && pres.yards >= HYPE_YARDS));

// Card color: touchdowns/turnovers keep theirs; a 20+ yard gain is "big";
// the parser's other "big" calls (4th-down plays etc.) render as normal.
function emphasisOf(pres) {
  const e = pres.emphasis || "normal";
  if (e === "td" || e === "turnover" || e === "final") return e;
  if (pres.type === "incomplete") return "miss";
  if (isHype(pres)) return "big";
  return e === "big" ? "normal" : e;
}

// `short` (the Feed rail): first-initial form ("K. Taylor") — the play
// text's own abbreviation, kept on identified players as player.short.
function PlayerToken({ player, followedIds, onTogglePlayer, short }) {
  const on = player.cfbdId && followedIds.has(player.cfbdId);
  const canFollow = !!(player.cfbdId && onTogglePlayer);
  const name = short ? player.short || player.name : player.name;
  return (
    <span>
      {canFollow ? (
        <button className={`lpc-name${on ? " on" : ""}`} title={on ? `Unfollow ${player.name}` : `Follow ${player.name}`}
          onClick={(e) => { e.stopPropagation(); onTogglePlayer({ id: player.cfbdId, name: player.name }); }}>
          {on ? "★ " : ""}{name}
        </button>
      ) : <span title={player.name}>{name}</span>}
      {player.wedraftSlug && (
        <a className="lpc-wd" href={`/player/${player.wedraftSlug}`} target="_blank" rel="noopener noreferrer"
          title={`${player.name} — We-Draft scouting profile (opens in a new tab)`} onClick={(e) => e.stopPropagation()}>
          <img src="/wd-icon.png" alt="We-Draft profile" />
        </a>
      )}
    </span>
  );
}

function Line({ pres, followedIds, onTogglePlayer, short }) {
  if (!pres.line?.length) return null;
  const miss = pres.type === "incomplete";
  return (
    <div className="lpc-line">
      {pres.line.map((t, i) => {
        if (t.player) {
          const tokenEl = <PlayerToken player={t.player} followedIds={followedIds} onTogglePlayer={onTogglePlayer} short={short} />;
          return t.lead || t.sub ? <span key={i} className={t.lead ? "lpc-lead" : "lpc-sub"}>{tokenEl}</span> : <span key={i}>{tokenEl}</span>;
        }
        // An incomplete pass: the arrow is crossed out.
        if (t.text === "→" && miss) return <span key={i} className="lpc-join lpc-arrow-miss" aria-label="incomplete">→<i>✕</i></span>;
        return <span key={i} className={t.text === "→" || /^[a-z&]/.test(t.text) ? "lpc-join" : undefined}>{t.text}</span>;
      })}
    </div>
  );
}

// The try after a touchdown, as a chip on the TD card ("PAT ✓ I. Uvaydov").
function PatChip({ pat, short }) {
  if (!pat || pat.type !== "kick") return null;
  const who = pat.kicker ? (short ? pat.kicker.short || pat.kicker.name : pat.kicker.name) : "";
  return <span className={`lpc-chip${pat.good ? "" : " bad"}`}>{pat.good ? "PAT ✓" : "PAT ✗"}{who ? ` · ${who}` : ""}</span>;
}

// A two-point try gets its own card, right after its touchdown.
export function TwoPointCard({ pat, team }) {
  const who = pat.player?.name;
  return (
    <div className={`lpc lpc-detailed lpc-two ${pat.good ? "score" : "miss"}`}>
      <div className="lpc-body">
        <div className="lpc-head">
          <span className="lpc-badge">2-PT CONVERSION</span>
          {team && (team.logoDark || team.logo) && <span className="lpc-team"><img src={team.logoDark || team.logo} alt="" />{team.short || team.school || team.name}</span>}
        </div>
        {who && <div className="lpc-line">{who}</div>}
        <div className="lpc-detail">{pat.good ? "Good — 2 points" : "No good"}</div>
      </div>
    </div>
  );
}

/**
 * @param play       a play doc (detailed) or a liveSlate big-play entry (compact) —
 *                   both carry period, clock, presentation and the post-play score.
 * @param team       { short/school/name, logo, logoDark } of the team with the ball, if known
 * @param scoreLabel e.g. "MSU 17 – 35 BAMA" (shown for scoring plays / big plays)
 * @param onScoreClick optional — makes the score chip a button (opens the game)
 */
export default function LivePlayCard({ play, variant = "compact", team, possessionTeam, scoreLabel, scoreboard, onScoreClick, followedIds = new Set(), onTogglePlayer, onClick, highlight, fresh, justNow, teamColor }) {
  const pres = play.presentation;
  const detailed = variant === "detailed";
  const ot = play.period > 4;
  const clockQ = [periodLabel(play.period), ot ? null : play.clock].filter(Boolean);
  // Extra state classes: clickable (Feed → opens the game), highlighted
  // (the play just jumped to), fresh (arrived while watching).
  const state = `${onClick ? " lpc-click" : ""}${highlight ? " lpc-focus" : ""}${fresh ? " lpc-fresh" : ""}${justNow ? " lpc-justnow" : ""}`;

  // Plays stored before presentation existed (or a parse that found
  // nothing usable) still render — just as cleaned text.
  if (!pres) {
    return (
      <div className="lpc muted">
        <div className="lpc-meta">{clockQ.join(" · ")}</div>
        <div className="lpc-line">{(play.text || "").replace(/^\(\d{1,2}:\d{2}\)\s*/, "")}</div>
      </div>
    );
  }

  const emph = emphasisOf(pres);
  const cls = `${emph}${isHype(pres) ? " hype" : ""}`;
  const ScoreTag = onScoreClick ? "button" : "span";

  const body = (
    <>
      <div className="lpc-head">
        {justNow && <span className="lpc-justnow-tag">JUST NOW</span>}
        <span className="lpc-badge">{EMOJI[emph] || ""}{pres.headline}</span>
        {team && (team.logoDark || team.logo) && (
          <span className="lpc-team"><img src={team.logoDark || team.logo} alt="" />{team.short || team.school || team.name}</span>
        )}
      </div>
      <Line pres={pres} followedIds={followedIds} onTogglePlayer={onTogglePlayer} short={!detailed} />
      {(pres.detail || pres.firstDown || pres.penaltyText || pres.pat) && (
        <div className="lpc-detail">
          {pres.detail}
          {pres.firstDown && <span className="lpc-chip">1ST DOWN</span>}
          {pres.upset && <span className="lpc-chip warn">UPSET</span>}
          <PatChip pat={pres.pat} short={!detailed} />
          {pres.penaltyText && <span className="lpc-chip warn">FLAG · {pres.penaltyText}</span>}
        </div>
      )}
      {!pres.line?.length && pres.fallbackText && <div className="lpc-detail">{pres.fallbackText}</div>}
    </>
  );

  // Compact (the Feed rail): same two-column layout as the main feed, but
  // the right column is a mini scoreboard — both teams' score after the
  // play — over the clock and quarter. Names use first initials.
  if (!detailed) {
    // Only a FINAL dims the loser — mid-game nobody is "out".
    const final = pres.type === "final";
    const loser = final && scoreboard && scoreboard.away.score !== scoreboard.home.score
      ? (scoreboard.away.score > scoreboard.home.score ? "home" : "away") : null;
    // The team that just scored gets its number popped.
    const scoredSide = !final && (play.kinds || []).includes("score") ? (play.creditSide || play.offense) : null;
    const offenseT = play.offense && scoreboard ? scoreboard[play.offense] : null;
    const defenseT = play.offense && scoreboard ? scoreboard[play.offense === "home" ? "away" : "home"] : null;
    const spot = play.yardsToGoal != null && offenseT ? spotLabel(play.yardsToGoal, offenseT, defenseT) : "";
    const situation = [play.down ? downLabel(play.down, play.distance) : "", spot].filter(Boolean).join(" · ");
    return (
      <div className={`lpc lpc-detailed lpc-compact ${cls}${state}${teamColor ? " lpc-teamed" : ""}`} style={teamColor ? { "--tc": teamColor } : undefined}
        onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined} title={play.text || undefined}>
        <div className="lpc-body">{body}</div>
        <div className="lpc-side">
          {scoreboard && ["away", "home"].map((side) => (
            <div key={side} className={`lpc-sb-row${loser === side ? " trail" : ""}${scoredSide === side ? " scored" : ""}`}>
              {scoreboard[side].logo && <img src={scoreboard[side].logo} alt="" />}
              <span className="lpc-sb-team">{scoreboard[side].short}</span>
              <span className="lpc-sb-score">{scoreboard[side].score ?? "–"}</span>
            </div>
          ))}
          <div className="lpc-sb-clock">{final ? pres.headline : breakLabel(play) || clockQ.join(" ")}</div>
          {!final && situation && <div className="lpc-sb-spot">{situation}</div>}
        </div>
      </div>
    );
  }

  // Detailed (single-game feed): the play on the left, game situation —
  // clock, quarter, down & distance, and the score after a scoring play —
  // in its own column on the right, readable from across the room.
  const isBreak = pres.type === "period" || pres.type === "timeout";
  const down = isBreak ? "" : downLabel(play.down, play.distance);
  return (
    // Raw CFBD text stays reachable as a hover tooltip — no on-screen clutter.
    <div className={`lpc lpc-detailed ${cls}${state}`} title={play.text || undefined} onClick={onClick}>
      <div className="lpc-body">{body}</div>
      <div className="lpc-side">
        {(play.clock || play.period) && (
          <div className="lpc-side-clock">{play.period > 4 ? periodLabel(play.period) : <>{play.period ? <span className="lpc-side-q">{periodLabel(play.period)}</span> : null}{play.clock}</>}</div>
        )}
        {!isBreak && down && possessionTeam && (
          // Who had the ball on this snap.
          <div className="lpc-side-ball" title={`${possessionTeam.school || possessionTeam.name || ""} ball`}>
            <span className="lpc-side-fb">●</span>
            {(possessionTeam.logoDark || possessionTeam.logo) && <img src={possessionTeam.logoDark || possessionTeam.logo} alt="" />}
            {possessionTeam.short || possessionTeam.school || possessionTeam.name}
          </div>
        )}
        {down && <div className="lpc-side-down">{down}</div>}
        {pres.turnover && team && (
          <div className="lpc-side-swap" title="Change of possession">⇄ {(team.logoDark || team.logo) && <img src={team.logoDark || team.logo} alt="" />}{team.short || team.school || team.name} ball</div>
        )}
        {play.scoring && scoreLabel && <ScoreTag className="lpc-score lpc-side-score" onClick={onScoreClick}>{scoreLabel}</ScoreTag>}
      </div>
    </div>
  );
}

// The "next play" card at the top of a live game's feed. Everything on it
// comes from ONE inferred situation (utils/live.js nextSituation — built
// from the last play's result, so its parts can't disagree). It stays
// mounted while the game is live and updates in place: each value is keyed
// by its content, so only a value that changed re-renders with a brief
// highlight, instead of the whole card popping in again.
// A value that flashes when it changes — never on the card's first render
// (the value it started with), and only the value that actually changed.
function Upd({ v, children }) {
  const initial = useRef(v);
  return <span key={String(v)} className={v !== initial.current ? "lpc-upd" : undefined}>{children ?? v}</span>;
}

export function PendingPlayCard({ game, situation }) {
  const s = situation;
  const brk = s.brk;
  const offense = s.offense ? game[s.offense] : null;
  const defense = s.offense ? game[s.offense === "home" ? "away" : "home"] : null;
  const down = s.down ? downLabel(s.down, s.distance) : "";
  const spot = s.ytg != null ? spotLabel(s.ytg, offense, defense) : "";
  return (
    <div className={`lpc lpc-detailed lpc-pending${brk ? " lpc-break" : ""}`}>
      <div className="lpc-body">
        <div className="lpc-head">
          {brk ? (
            <span className="lpc-badge"><Upd v={brk.label} />{brk.detail && <span className="lpc-break-detail"> · <Upd v={brk.detail} /></span>}</span>
          ) : (
            <span className="lpc-badge">NEXT PLAY<span className="lpc-dots"><i /><i /><i /></span></span>
          )}
        </div>
        {offense ? (
          <div className="lpc-line">
            <span className="lpc-pending-team">
              {(offense.logoDark || offense.logo) && <img src={offense.logoDark || offense.logo} alt="" />}
              <Upd v={offense.school || offense.name}>{offense.school || offense.name} ball</Upd>
            </span>
          </div>
        ) : !brk ? <div className="lpc-line">Waiting for the snap</div> : null}
        {s.downsTurnover && <div className="lpc-detail"><span className="lpc-chip warn" style={{ marginLeft: 0 }}>TURNOVER ON DOWNS</span></div>}
        {s.changeOfPossession && <div className="lpc-detail"><span className="lpc-chip warn" style={{ marginLeft: 0 }}>⇄ CHANGE OF POSSESSION</span></div>}
      </div>
      <div className="lpc-side">
        {(s.clock || s.period) && (
          <div className="lpc-side-clock">{s.period > 4 ? <Upd v={periodLabel(s.period)} /> : <>{s.period ? <span className="lpc-side-q"><Upd v={periodLabel(s.period)} /></span> : null}<Upd v={s.clock} /></>}</div>
        )}
        {offense && down && (
          <div className="lpc-side-ball">
            <span className="lpc-side-fb">●</span>
            {(offense.logoDark || offense.logo) && <img src={offense.logoDark || offense.logo} alt="" />}
            <Upd v={offense.short || offense.school || offense.name} />
          </div>
        )}
        {down && <div className="lpc-side-down"><Upd v={down} /></div>}
        {spot && <div className="lpc-side-spot"><Upd v={spot}>at {spot}</Upd></div>}
      </div>
    </div>
  );
}


// "HALFTIME" / "END OF Q1" for a play logged at 0:00 of a quarter.
function breakLabel(play) {
  if (play.period > 4) return periodLabel(play.period); // overtime: untimed
  if (!/^0?0:00$/.test(play.clock || "") || !play.period) return "";
  if (play.period === 2) return "HALFTIME";
  return play.period === 4 ? "END OF REG" : `END OF Q${play.period}`;
}

// Tops a finished game's feed in place of the bare "END OF Q4": the
// winner, the final score, in the winner's colors. celebrate = the game
// went final while it was on screen (confetti is fired by the caller).
export function FinalCard({ game }) {
  const hp = game.home?.points ?? 0;
  const ap = game.away?.points ?? 0;
  const winSide = hp >= ap ? "home" : "away";
  const win = game[winSide] || {};
  const lose = game[winSide === "home" ? "away" : "home"] || {};
  const nm = (t) => t.school || t.name || "";
  const upset = !!lose.rank && (!win.rank || win.rank > lose.rank);
  return (
    <div className="lpc lpc-win" style={{ "--wc": win.color || GOLD }}>
      {(win.logoDark || win.logo) && <img className="lpc-win-logo" src={win.logoDark || win.logo} alt="" />}
      <div className="lpc-win-body">
        <div className="lpc-win-badge">🏆 {(game.period || 0) > 4 ? "FINAL / OT" : "FINAL"}{upset && <span className="lpc-chip warn">UPSET</span>}</div>
        <div className="lpc-win-name">{win.rank ? <span className="lpc-win-rank">#{win.rank} </span> : null}{nm(win)} wins</div>
        <div className="lpc-win-score">
          <b>{Math.max(hp, ap)}</b><span>–</span><b className="lose">{Math.min(hp, ap)}</b>
          <span className="lpc-win-over">over {lose.rank ? `#${lose.rank} ` : ""}{nm(lose)}</span>
        </div>
      </div>
    </div>
  );
}

// One-line version for game tiles: "PASS COMPLETE · K. Taylor → A. Evans III · 13 yards"
export function playSummary(pres) {
  if (!pres) return "";
  if (pres.confidence === "fallback" && pres.fallbackText) return pres.fallbackText;
  const line = (pres.line || []).map((t) => (t.player ? t.player.name : t.text)).join(" ");
  return [pres.headline, line, pres.detail].filter(Boolean).join(" · ");
}
