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
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useLiveSlate } from "../hooks/useLiveSlate";
import { useLiveStats } from "../hooks/useLiveGame";
import { statusLabel, teamShort } from "../utils/live";
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

function LivePill({ game, size = "md" }) {
  const lg = size === "lg";
  return (
    <Link to={`/live?view=game&game=${game.id}`} className="plc-btn" title={`${teamShort(game.away)} ${game.away?.points ?? ""} – ${teamShort(game.home)} ${game.home?.points ?? ""} · ${statusLabel(game)}`}
      style={lg ? { fontSize: "14px", padding: "11px 20px", border: "2px solid #fff" } : undefined}>
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

export default function PlayerLiveCard({ player, variant, wrap }) {
  const game = useSchoolLiveGame(player?.School);
  // The player's live line — matched by We-Draft slug, else by name on the
  // player's side.
  const { stats } = useLiveStats(game && variant !== "button" ? game.id : null);
  const lines = useMemo(() => {
    if (!game || !stats?.players) return [];
    const side = game.home?.school === player.School ? "home" : "away";
    const want = normName(`${player.First || ""} ${player.Last || ""}`);
    const mine = (stats.players[side] || [])
      .find((l) => (player.Slug && l.slug === player.Slug) || normName(l.name) === want);
    return mine ? statLines(mine.stats) : [];
  }, [game, stats, player]);
  if (!game) return null;

  if (variant === "button") {
    const pill = <LivePill game={game} />;
    return wrap ? <div className="bg-white" style={{ padding: "8px 16px" }}>{pill}</div> : pill;
  }

  const row = (side) => {
    const t = game[side] || {};
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "4px 0" }}>
        {(t.logo || t.logoDark) && <img src={t.logo || t.logoDark} alt="" style={{ width: "30px", height: "30px", objectFit: "contain" }} />}
        <span style={{ flex: 1, fontWeight: 900, fontSize: "15px", color: t.school === player.School ? "#1d2733" : "#5b6b7f" }}>
          {t.rank ? <span style={{ color: "#9aa5b4", fontSize: "12px", marginRight: "4px" }}>#{t.rank}</span> : null}{teamShort(t)}
        </span>
        <span style={{ fontWeight: 900, fontSize: "24px", color: "#1d2733", fontVariantNumeric: "tabular-nums" }}>{t.points ?? "–"}</span>
      </div>
    );
  };

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `2px solid ${LIVE_RED}`, boxShadow: "0 4px 16px rgba(214,40,40,0.18)" }}>
      <div style={{ background: LIVE_RED, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
        <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: "#fff", display: "inline-block", animation: "plc-pulse 1.4s infinite" }} />
        <h2 className="font-black uppercase" style={{ color: "#fff", fontSize: "18px", letterSpacing: "0.08em", margin: 0 }}>Playing now</h2>
        <style>{"@keyframes plc-pulse { 50% { opacity: 0.25; } } @media (prefers-reduced-motion: reduce) { [style*='plc-pulse'] { animation: none !important; } }"}</style>
      </div>
      <div style={{ background: "#fff", padding: "10px 14px" }}>
        {row("away")}
        {row("home")}
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: "13px", color: LIVE_RED, margin: "4px 0 2px", fontVariantNumeric: "tabular-nums" }}>{statusLabel(game)}</div>
      </div>
      {lines.length > 0 && (
        <div style={{ background: "#f6f7f9", borderTop: "1px solid #e6e9ee", padding: "10px 14px" }}>
          <div style={{ fontWeight: 900, fontSize: "11px", letterSpacing: "0.12em", textTransform: "uppercase", color: "#7a8696", marginBottom: "6px" }}>
            Live stats
          </div>
          {lines.map(([label, text]) => (
            <div key={label} style={{ display: "flex", gap: "10px", alignItems: "baseline", padding: "2px 0" }}>
              <span style={{ width: "72px", flexShrink: 0, fontWeight: 800, fontSize: "12px", color: "#5b6b7f" }}>{label}</span>
              <span style={{ fontWeight: 900, fontSize: "14px", color: "#1d2733", fontVariantNumeric: "tabular-nums" }}>{text}</span>
            </div>
          ))}
        </div>
      )}
      <Link
        to={`/live?view=game&game=${game.id}`}
        style={{
          display: "block", textAlign: "center", padding: "11px 14px", background: LIVE_RED, color: "#fff",
          fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.1em", textDecoration: "none",
        }}
      >
        ● Follow Live →
      </Link>
    </div>
  );
}
