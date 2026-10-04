// src/components/PlayerLiveCard.js
//
// Top of a player page's right column while the player's team is playing:
// live score + clock and a "Follow Live" button into that game's feed on
// /live. One listener on liveSlate/current (useLiveSlate) — renders
// nothing when the team isn't playing right now.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useLiveSlate } from "../hooks/useLiveSlate";
import { statusLabel, teamShort } from "../utils/live";

const LIVE_RED = "#d62828";

export default function PlayerLiveCard({ player }) {
  const byId = useLiveSlate(!!player?.School);
  const game = useMemo(() => [...byId.values()].find((g) => g.status === "in_progress"
    && (g.home?.school === player?.School || g.away?.school === player?.School)), [byId, player?.School]);
  if (!game) return null;

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
