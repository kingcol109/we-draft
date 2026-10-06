// src/components/PlayerLiveCard.js
//
// Top of a player page's right column while the player's team is playing:
// live score + clock and a "Follow Live" button into that game's feed on
// /live. One listener on liveSlate/current (useLiveSlate) — renders
// nothing when the team isn't playing right now. The card also shows the
// player's own live stat line from the ingester's live stats doc
// (liveGames/{id}/box/live — same numbers as /live's Stats tab): one doc,
// one read per update, only while the card is on screen.
//
// variant="button": just a pulsing red "Follow Live" pill — what phones show
// (next to Show Bio) instead of the scoreboard card. wrap: pad it as its own
// row, for a player page with no bio to sit beside.
//
// FollowLiveButton (exported below) is that same pill for any school — the
// CFB team page's hero shows it while the team is playing.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveSlate } from "../hooks/useLiveSlate";
import { useLiveStats } from "../hooks/useLiveGame";
import { statusLabel, teamShort, liveGameHref } from "../utils/live";
import { LEADER_CATS, statLine } from "../utils/liveStats";

const LIVE_RED = "#d62828";

const normName = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");
// [["Passing", "14/22 · 187 YDS · 2 TD"], ...] for each category the
// player has numbers in (same formatting as /live's Top Performances).
const LABELS = { passing: "Passing", rushing: "Rushing", receiving: "Receiving", defense: "Defense" };
const statLines = (stats) => LEADER_CATS.map((cat) => [LABELS[cat], statLine(cat, stats[cat])]).filter(([, text]) => text);

// The school's in-progress game on the live slate, or undefined.
function useSchoolLiveGame(school) {
  const byId = useLiveSlate(!!school);
  return useMemo(() => [...byId.values()].find((g) => g.status === "in_progress"
    && (g.home?.school === school || g.away?.school === school)), [byId, school]);
}

// size: "md" (default), "lg" (team page hero), "toolbar" (a phone player
// page's hero toolbar — pill-shaped with a white border like the buttons
// beside it).
const PILL_SIZES = {
  lg: { fontSize: "14px", padding: "11px 20px", border: "2px solid #fff" },
  toolbar: { fontSize: "14px", padding: "7px 14px", border: "2px solid #fff", borderRadius: "999px" },
};
export function LivePill({ game, size = "md" }) {
  return (
    <Link to={liveGameHref(game)} className="plc-btn" title={`${teamShort(game.away)} ${game.away?.points ?? ""} – ${teamShort(game.home)} ${game.home?.points ?? ""} · ${statusLabel(game)}`}
      style={PILL_SIZES[size]}>
      <span className="plc-dot" />Follow Live
      <style>{`
        .plc-btn { display: inline-flex; align-items: center; gap: 7px; background: ${LIVE_RED}; color: #fff; font-weight: 900; font-size: 13px;
          letter-spacing: 0.08em; text-transform: uppercase; padding: 8px 14px; border-radius: 6px; text-decoration: none; white-space: nowrap;
          box-shadow: 0 0 0 0 rgba(214,40,40,0.6); animation: plc-ring 1.8s ease-out infinite; }
        .plc-dot { width: 8px; height: 8px; border-radius: 50%; background: #fff; animation: plc-pulse 1.2s ease-in-out infinite; }
        @keyframes plc-ring { 0% { box-shadow: 0 0 0 0 rgba(214,40,40,0.6); } 70% { box-shadow: 0 0 0 10px rgba(214,40,40,0); } 100% { box-shadow: 0 0 0 0 rgba(214,40,40,0); } }
        @keyframes plc-pulse { 50% { opacity: 0.25; } }
        @media (prefers-reduced-motion: reduce) { .plc-btn, .plc-dot { animation: none; } }
      `}</style>
    </Link>
  );
}

// The pulsing "Follow Live" pill for a school, rendered only while that
// school's game is in progress. size="lg" for the team page hero.
export function FollowLiveButton({ school, size }) {
  const game = useSchoolLiveGame(school);
  return game ? <LivePill game={game} size={size} /> : null;
}

// "92 YDS" → ["92", "YDS"]; "LONG 31" → ["31", "LONG"]; "14/22" → ["14/22", ""].
function splitStat(part) {
  const a = /^([\d/.,-]+)\s*(.*)$/.exec(part);
  if (a) return [a[1], a[2]];
  const b = /^(.*?)\s+([\d/.,-]+)$/.exec(part);
  return b ? [b[2], b[1]] : [part, ""];
}

// One side of the card's scoreboard: logo, name, score (pops when it
// changes), the ball when that team has it. mine: the player's team.
function BoardSide({ game, side, mine }) {
  const t = game[side] || {};
  const other = game[side === "home" ? "away" : "home"] || {};
  const leading = t.points != null && other.points != null && t.points > other.points;
  const prev = useRef(t.points);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (prev.current != null && t.points != null && t.points !== prev.current) setBump((n) => n + 1);
    prev.current = t.points;
  }, [t.points]);
  return (
    <div className={`plc-side ${side}${mine ? " mine" : ""}`}>
      {(t.logoDark || t.logo) && <img src={t.logoDark || t.logo} alt="" />}
      <div className="plc-name">
        {t.rank ? <small>#{t.rank}</small> : null}{teamShort(t)}
        {game.possession === side && <span className="plc-ball" title="Has the ball" />}
      </div>
      <div key={bump} className={`plc-score${leading ? " lead" : ""}${bump ? " pop" : ""}`}>{t.points ?? "–"}</div>
    </div>
  );
}

// The "Playing now" card: a dark broadcast-style scoreboard split in the two
// teams' colors, a pulsing LIVE tag, the player's line as
// stat chips, and a shining Follow Live button.
const CARD_CSS = `
.plc-card { position: relative; border-radius: 14px; overflow: hidden; background: #0a0f1a; color: #eef2f8;
  box-shadow: 0 0 0 2px ${LIVE_RED}, 0 10px 30px rgba(214,40,40,0.28); animation: plc-glow 2.4s ease-in-out infinite; }
@keyframes plc-glow { 50% { box-shadow: 0 0 0 2px ${LIVE_RED}, 0 10px 38px rgba(214,40,40,0.5); } }
.plc-top { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: linear-gradient(90deg, ${LIVE_RED}, #a31515); }
.plc-live { display: inline-flex; align-items: center; gap: 6px; background: #fff; color: ${LIVE_RED}; font-weight: 900; font-size: 11px;
  letter-spacing: 0.14em; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; }
.plc-live i { width: 7px; height: 7px; border-radius: 50%; background: ${LIVE_RED}; animation: plc-pulse 1.1s ease-in-out infinite; }
.plc-title { flex: 1; font-weight: 900; font-size: 16px; letter-spacing: 0.12em; text-transform: uppercase; color: #fff; }
.plc-board { position: relative; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 16px 10px 14px; overflow: hidden;
  background: linear-gradient(105deg, var(--ac) 0 49%, var(--hc) 51% 100%); }
.plc-board::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.15), rgba(0,0,0,0.55)); pointer-events: none; }
.plc-side { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; }
.plc-side img { width: 50px; height: 50px; object-fit: contain; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.45)); }
.plc-name { display: flex; align-items: center; gap: 4px; font-weight: 900; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em;
  color: rgba(255,255,255,0.85); white-space: nowrap; text-shadow: 0 1px 3px rgba(0,0,0,0.5); }
.plc-side.mine .plc-name { color: #fff; }
.plc-name small { font-size: 10px; color: rgba(255,255,255,0.7); }
.plc-ball { width: 12px; height: 8px; border-radius: 50%; background: #fff; box-shadow: 0 0 6px rgba(255,255,255,0.8); }
.plc-score { font-weight: 900; font-size: 40px; line-height: 1; color: rgba(255,255,255,0.72); font-variant-numeric: tabular-nums; text-shadow: 0 2px 8px rgba(0,0,0,0.5); }
.plc-score.lead { color: #fff; }
.plc-score.pop { animation: plc-pop 0.7s cubic-bezier(.2,1.6,.4,1); }
@keyframes plc-pop { 0% { transform: scale(1); } 35% { transform: scale(1.35); color: #ffd23f; } 100% { transform: scale(1); } }
.plc-mid { position: relative; z-index: 1; padding: 0 6px; text-align: center; }
.plc-mid b { display: inline-block; background: rgba(6,10,18,0.75); border: 1px solid rgba(255,255,255,0.25); border-radius: 6px; padding: 4px 8px;
  font-size: 12px; font-weight: 900; color: #fff; white-space: nowrap; }
.plc-mid { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.plc-clock { font-weight: 900; font-size: 15px; color: #fff; font-variant-numeric: tabular-nums; white-space: nowrap; letter-spacing: 0.04em; text-shadow: 0 1px 4px rgba(0,0,0,0.6); }
.plc-stats { padding: 12px 14px 6px; background: #0e1625; border-top: 1px solid #1d2840; }
.plc-stats-h { font-weight: 900; font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: #fff; margin-bottom: 8px; }
.plc-stats-h span { color: #ff6b6b; }
.plc-line { margin-bottom: 8px; }
.plc-cat { display: block; font-size: 10px; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: #8193ad; margin-bottom: 4px; }
.plc-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.plc-chip { display: inline-flex; align-items: baseline; gap: 4px; background: #172238; border: 1px solid #26324a; border-radius: 8px; padding: 4px 9px; }
.plc-chip b { font-size: 18px; font-weight: 900; color: #fff; font-variant-numeric: tabular-nums; }
.plc-chip small { font-size: 10px; font-weight: 900; letter-spacing: 0.06em; color: #9fb0c8; text-transform: uppercase; }
.plc-cta { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 14px;
  background: ${LIVE_RED}; color: #fff; font-weight: 900; font-size: 14px; letter-spacing: 0.12em; text-transform: uppercase; text-decoration: none; }
.plc-cta::before { content: ""; position: absolute; top: 0; bottom: 0; width: 40%; left: -60%; transform: skewX(-20deg);
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent); animation: plc-shine 2.8s ease-in-out infinite; }
@keyframes plc-shine { 0%, 40% { left: -60%; } 100% { left: 130%; } }
.plc-cta:hover { background: #b81f1f; }
.plc-cta .plc-arrow { transition: transform 0.2s; }
.plc-cta:hover .plc-arrow { transform: translateX(4px); }
.plc-card .plc-dot { width: 8px; height: 8px; border-radius: 50%; background: #fff; animation: plc-pulse 1.2s ease-in-out infinite; }
@keyframes plc-pulse { 50% { opacity: 0.25; } }
@media (prefers-reduced-motion: reduce) {
  .plc-card, .plc-live i, .plc-card .plc-dot, .plc-cta::before, .plc-score.pop { animation: none; }
}
`;

// ── Layout preview (local dev server only — never in a production build):
// these players always look live, with a made-up game and stat line, so
// the card can be laid out without a real game on. Empty it when done. ──
const PREVIEW_LIVE = process.env.NODE_ENV === "development" ? {
  "amari-thomas-2029-rb": {
    game: {
      id: "preview", status: "in_progress", period: 3, clock: "7:42", possession: "home", situation: "2nd & 7",
      away: { school: "Clemson", short: "Clemson", points: 17, color: "#F56600", logo: "https://cdn.collegefootballdata.com/logos/500/228.png" },
      home: { school: "Florida State", short: "FSU", points: 24, rank: 14, color: "#782F40", logo: "https://cdn.collegefootballdata.com/logos/500/52.png" },
    },
    lines: [["Rushing", "14 CAR · 92 YDS · 1 TD · LONG 31"], ["Receiving", "3 REC · 28 YDS"]],
  },
} : {};

// The player's team's in-progress game (or his layout preview's), else
// undefined. Pass null to skip the slate listener.
export function usePlayerLiveGame(player) {
  const preview = PREVIEW_LIVE[player?.Slug];
  const realGame = useSchoolLiveGame(preview ? null : player?.School);
  return preview?.game || realGame;
}

export default function PlayerLiveCard({ player, variant, wrap }) {
  const preview = PREVIEW_LIVE[player?.Slug];
  const realGame = useSchoolLiveGame(preview ? null : player?.School);
  const game = preview?.game || realGame;
  // The player's live line — matched by We-Draft slug, else by name on the
  // player's side.
  const { stats } = useLiveStats(realGame && variant !== "button" ? realGame.id : null);
  const lines = useMemo(() => {
    if (preview) return preview.lines;
    if (!game || !stats?.players) return [];
    const side = game.home?.school === player.School ? "home" : "away";
    const want = normName(`${player.First || ""} ${player.Last || ""}`);
    const mine = (stats.players[side] || [])
      .find((l) => (player.Slug && l.slug === player.Slug) || normName(l.name) === want);
    return mine ? statLines(mine.stats) : [];
  }, [preview, game, stats, player]);
  if (!game) return null;

  if (variant === "button") {
    const pill = <LivePill game={game} />;
    return wrap ? <div className="bg-white" style={{ padding: "8px 16px" }}>{pill}</div> : pill;
  }

  const mineSide = game.home?.school === player.School ? "home" : "away";
  const name = `${player.First || ""} ${player.Last || ""}`.trim();
  const href = liveGameHref(game);
  return (
    <div className="plc-card">
      <style>{CARD_CSS}</style>
      <div className="plc-top">
        <span className="plc-live"><i />Live</span>
        <span className="plc-title">Playing now</span>
      </div>
      <div className="plc-board" style={{ "--ac": game.away?.color || "#2a4a7a", "--hc": game.home?.color || "#7a2a2a" }}>
        <BoardSide game={game} side="away" mine={mineSide === "away"} />
        <div className="plc-mid">
          <div className="plc-clock">{statusLabel(game)}</div>
          {game.situation && <b>{game.situation}</b>}
        </div>
        <BoardSide game={game} side="home" mine={mineSide === "home"} />
      </div>
      {lines.length > 0 && (
        <div className="plc-stats">
          <div className="plc-stats-h">{name} <span>today</span></div>
          {lines.map(([label, text]) => (
            <div key={label} className="plc-line">
              <span className="plc-cat">{label}</span>
              <div className="plc-chips">
                {text.split(" · ").map((part) => {
                  const [num, unit] = splitStat(part);
                  return <span key={part} className="plc-chip"><b>{num}</b>{unit && <small>{unit}</small>}</span>;
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <Link to={href} className="plc-cta"><span className="plc-dot" />Follow Live<span className="plc-arrow">→</span></Link>
    </div>
  );
}
