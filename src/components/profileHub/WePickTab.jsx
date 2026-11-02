// src/components/profileHub/WePickTab.jsx
//
// The profile hub's We-Pick tab: the same We-Pick Ranked 6 section as
// Live's Your Week (components/WePickRanked.jsx) for this week's slate
// (liveSlate/current) — each ranked game's pick against its live or final
// score, points so far, the final rank once the week's graded — on the
// dark panel it has on Live. Tapping a game opens it on Live.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";
import { useRankedSixIds } from "../../hooks/useLiveFeed";
import { useRankedPicks, useWeekStanding, YourWeekPicks, WEPICK_RANKED_STYLE } from "../WePickRanked";
import { wePickHref } from "../../utils/wePickRoutes";
import LoadingSpinner from "../LoadingSpinner";

const GOLD = "#f6a21d";

export default function WePickTab({ uid }) {
  const navigate = useNavigate();
  const [slate, setSlate] = useState(null);
  useEffect(() => onSnapshot(doc(db, "liveSlate", "current"), (s) => setSlate(s.exists() ? s.data() : { games: [] }), () => setSlate({ games: [] })), []);
  const games = useMemo(() => slate?.games || [], [slate]);
  const rankedIds = useRankedSixIds(uid, games.map((g) => g.wedraftWeek));
  const rankedGames = games.filter((g) => g.wedraftGameId && rankedIds.has(g.wedraftGameId))
    .sort((a, b) => (Date.parse(a.startDate) || 0) - (Date.parse(b.startDate) || 0));
  const rows = useRankedPicks(uid, rankedGames.map((g) => g.wedraftGameId));
  const week = useMemo(() => {
    const n = {};
    games.forEach((g) => { if (g.wedraftWeek) n[g.wedraftWeek] = (n[g.wedraftWeek] || 0) + 1; });
    return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }, [games]);
  const standing = useWeekStanding(uid, week);

  return (
    <div style={{ background: "#0b1220", border: "1px solid #1f2b42", borderRadius: 16, padding: "16px 16px 18px", color: "#eef2f8", fontFamily: "Arial, sans-serif" }}>
      <style>{WEPICK_RANKED_STYLE}</style>
      <h2 style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", color: "#fff", padding: "0 0 8px", margin: "0 0 14px", borderBottom: `3px solid ${GOLD}` }}>
        🏆 We-Pick Ranked 6{slate?.week ? ` · Week ${slate.week}` : ""}
        {rankedGames.length > 0 && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", color: "#0a0f1a", background: GOLD, borderRadius: 999, padding: "3px 9px" }}>{rankedGames.length}/6</span>}
      </h2>
      {!slate ? <LoadingSpinner size={28} minHeight="120px" /> : rankedGames.length ? (
        <YourWeekPicks games={rankedGames} rows={rows} standing={standing} onOpen={() => navigate("/live")} />
      ) : (
        <div style={{ fontSize: 13, fontWeight: 800, color: "#9fb0c8", margin: "8px 2px 6px" }}>No Ranked 6 this week.</div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <Link to={wePickHref()} style={{ background: GOLD, color: "#0b2545", borderRadius: 999, padding: "9px 18px", fontWeight: 900, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "none" }}>
          {rankedGames.length >= 6 ? "Open We-Pick →" : "Make your picks →"}
        </Link>
        <Link to={wePickHref("standings")} className="wdl-yw-cta">Standings</Link>
      </div>
    </div>
  );
}
