// src/components/TrendSuggester.js
//
// Admin → Players → Content → Trends → "Suggest Trends": We-Draft players
// whose PFF grades say they're heating up, with a suggested Trend label, plus
// current trends that are cooling off. Every row offers all three labels
// (the suggested one highlighted); picking one opens him in the Trends edit
// panel with that label set — the admin still saves. "Review" on a cooling
// trend opens it as-is.
//
// Score (each piece a percentile among the candidates):
//   PFF heat  65%  his last two games' average grade (50%), how far that is
//                  above his season grade (30%), his national rank (20%) —
//                  pffGrades via pffData.js
//   Traffic   35%  7-day player-page views vs his 30-day pace
//                  (analytics/{slug}); no page data scores as average
// Label: Breakout — latest game 80+ and 8+ above his season grade;
//        On Fire  — last two games average 80+, top-25% season rank;
//        Up       — recent games 4+ above season, averaging 68+.
//
// PFF data is back office only — it's shown here but must never reach the
// public site, so nothing PFF goes into the trend (its Notes are public).
import { useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { loadPffByCfbdId, rankPct, pffLine } from "./pffData";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#0b1a2e";
const RED = "#c0392b";
const RESULT_COUNT = 15;
// Games under this many snaps (a cameo, an early exit) don't count as
// "recent form" — kickers excepted (their snaps are FG attempts).
const MIN_GAME_SNAPS = 10;
const LABELS = ["Up", "Breakout", "On Fire"];
const LABEL_STYLE = {
  Breakout: { icon: "⚡", bg: "#fff3d9", fg: "#8a5a00" },
  "On Fire": { icon: "🔥", bg: "#ffe3dc", fg: RED },
  Up: { icon: "▲", bg: "#e3f4e8", fg: "#2e7d32" },
};

const n = (v) => Number(v) || 0;
const avg = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length;

function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return (v) => {
    if (sorted.length <= 1) return 0.5;
    let below = 0, equal = 0;
    sorted.forEach((x) => { if (x < v) below++; else if (x === v) equal++; });
    return (below + Math.max(equal - 1, 0) / 2) / (sorted.length - 1);
  };
}

function labelFor(c) {
  if (c.latest.g >= 80 && c.latest.g - c.rec.g >= 8) return "Breakout";
  if (c.recentAvg >= 80 && rankPct(c.rec) >= 0.75) return "On Fire";
  if (c.delta >= 4 && c.recentAvg >= 68) return "Up";
  return null;
}

export default function TrendSuggester({ players, trendsMap, onPick, onClose }) {
  const [state, setState] = useState(null); // { hot, cooling }
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const suggest = async () => {
    setRunning(true);
    setError("");
    try {
      const [pff, cfbdSnap, analyticsSnap] = await Promise.all([
        loadPffByCfbdId(),
        getDocs(query(collection(db, "cfbdPlayers"), where("mappingStatus", "in", ["verified", "suggested"]))),
        getDocs(collection(db, "analytics")),
      ]);
      const cfbdByWd = new Map();
      cfbdSnap.docs.forEach((d) => { if (d.data().wedraftPlayerId) cfbdByWd.set(d.data().wedraftPlayerId, d.id); });
      const views = new Map();
      analyticsSnap.docs.forEach((d) => { const x = d.data(); if (!x.type || x.type === "player") views.set(d.id, x.pageViews || {}); });

      const all = [];
      players.forEach((p) => {
        const rec = pff.get(cfbdByWd.get(p.id));
        if (!p.Slug || rec?.rk == null) return;
        const games = (rec.rg || (rec.w ? [rec.w] : [])).filter((x) => rec.cat === "kicking" || x.sn >= MIN_GAME_SNAPS);
        if (!games.length) return;
        const recentAvg = avg(games.slice(0, 2).map((x) => x.g));
        const pv = views.get(p.Slug) || {};
        const v7 = n(pv.last7Days), v30 = n(pv.last30Days);
        const pace = v30 > 0 ? (v30 / 30) * 7 : 0;
        all.push({
          p, rec, games, latest: games[0], recentAvg, delta: recentAvg - rec.g,
          v7, v30, momentum: pace > 0 ? v7 / pace : v7 > 0 ? 2 : null,
          trend: trendsMap.get(p.Slug)?.Trend || "",
        });
      });

      const hot = all.filter((c) => !c.trend).map((c) => ({ ...c, label: labelFor(c) })).filter((c) => c.label);
      const pct = {
        recent: percentiles(hot.map((c) => c.recentAvg)),
        delta: percentiles(hot.map((c) => c.delta)),
        momentum: percentiles(hot.filter((c) => c.momentum != null).map((c) => c.momentum)),
      };
      hot.forEach((c) => {
        const heat = pct.recent(c.recentAvg) * 0.5 + pct.delta(c.delta) * 0.3 + rankPct(c.rec) * 0.2;
        const traffic = c.momentum != null ? pct.momentum(c.momentum) : 0.5;
        c.score = Math.round((heat * 0.65 + traffic * 0.35) * 100);
      });
      hot.sort((a, b) => b.score - a.score);

      // Already trending, but his grades have dropped off.
      const cooling = all
        .filter((c) => c.trend && (c.delta <= -8 || c.recentAvg < 60))
        .sort((a, b) => a.delta - b.delta);

      setState({ hot: hot.slice(0, RESULT_COUNT), hotTotal: hot.length, cooling, scanned: all.length });
    } catch (e) {
      console.error("Trend suggest error:", e);
      setError("Couldn't build suggestions — check console.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Suggest Trends</div>
        <div style={{ color: "#cfe0f5", fontSize: "11px", fontWeight: 700 }}>PFF grades · page-view momentum</div>
        <button type="button" onClick={suggest} disabled={running}
          style={{ marginLeft: "auto", background: GOLD, color: "#fff", border: "none", borderRadius: "6px", padding: "5px 14px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", cursor: running ? "default" : "pointer", opacity: running ? 0.6 : 1 }}>
          {running ? "Crunching..." : state ? "Refresh" : "Suggest"}
        </button>
        <button type="button" onClick={onClose}
          style={{ background: "transparent", color: "#fff", border: "2px solid #fff", borderRadius: "6px", padding: "4px 10px", fontWeight: 900, fontSize: "11px", cursor: "pointer" }}>
          Close
        </button>
      </div>
      <div style={{ padding: "8px 14px", fontSize: "11px", fontWeight: 700, color: RED, background: "#fff6f4", borderBottom: "1px solid #f0f0f0" }}>
        PFF grades are for us only — never put them in a trend's Notes (Notes show on player pages).
      </div>
      {error && <div style={{ padding: "12px 14px", color: RED, fontWeight: 700, fontSize: "13px" }}>{error}</div>}
      {state && (
        <>
          <div style={{ padding: "8px 14px", fontSize: "11px", fontWeight: 700, color: "#aaa" }}>
            {state.hotTotal} heating up of {state.scanned} We-Draft players with PFF grades · top {state.hot.length}
          </div>
          {state.hot.length === 0 && (
            <div style={{ padding: "18px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "13px" }}>Nobody untrended is heating up right now.</div>
          )}
          {state.hot.map((c) => <Row key={c.p.id} c={c} onPick={(label) => onPick(c.p, label)} />)}
          {state.cooling.length > 0 && (
            <>
              <div style={{ padding: "8px 14px", fontSize: "11px", fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.06em", borderTop: "2px solid #eee", background: "#f5f7fa" }}>
                Cooling off — currently trending
              </div>
              {state.cooling.map((c) => <Row key={c.p.id} c={c} onPick={(label) => onPick(c.p, label)} review />)}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Row({ c, onPick, review }) {
  const style = LABEL_STYLE[c.label || c.trend] || LABEL_STYLE.Up;
  const sign = c.delta >= 0 ? "+" : "";
  const recent = c.games.slice(0, 3).map((x) => `${x.g} (wk ${x.wk})`).join(" · ");
  return (
    <div style={{ display: "flex", gap: "12px", padding: "10px 14px", borderTop: "1px solid #f0f0f0", alignItems: "center" }}>
      {c.score != null && (
        <div style={{ width: "34px", textAlign: "center", fontWeight: 900, fontSize: "18px", color: BLUE }}>{c.score}</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
          <a href={"/player/" + c.p.Slug} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 900, fontSize: "14px", color: INK, textDecoration: "none" }}>
            {c.p.First} {c.p.Last}
          </a>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#666" }}>{c.p.Position} · {c.p.School} · {c.p.Eligible}</span>
          <span style={{ fontSize: "10px", fontWeight: 900, borderRadius: "8px", padding: "1px 7px", background: style.bg, color: style.fg, textTransform: "uppercase" }}>
            {style.icon} {c.label || `Now: ${c.trend}`}
          </span>
        </div>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "#3b4756", marginTop: "3px" }}>
          🎯 Recent {c.recentAvg.toFixed(1)} vs season {c.rec.g} ({sign}{c.delta.toFixed(1)}) · games: {recent}
        </div>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "#7a8597", marginTop: "2px" }}>
          {pffLine(c.rec)}
          {c.v7 > 0 && ` · 👀 ${c.v7.toLocaleString()} views in 7d${c.momentum != null ? ` (${c.momentum.toFixed(1)}× pace)` : ""}`}
        </div>
      </div>
      <div style={{ flexShrink: 0, display: "flex", gap: "4px" }}>
        {review && (
          <button type="button" onClick={() => onPick(null)} title="Open his current trend as-is"
            style={{ background: "#fff", color: BLUE, border: "2px solid " + BLUE, borderRadius: "6px", padding: "5px 9px", fontWeight: 900, fontSize: "10px", textTransform: "uppercase", cursor: "pointer" }}>
            Review
          </button>
        )}
        {LABELS.map((l) => {
          const st = LABEL_STYLE[l];
          const on = l === (c.label || c.trend);
          return (
            <button key={l} type="button" onClick={() => onPick(l)} title={`Set ${l}`}
              style={{ background: on ? st.fg : "#fff", color: on ? "#fff" : st.fg, border: "2px solid " + st.fg, borderRadius: "6px", padding: "5px 9px", fontWeight: 900, fontSize: "10px", textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap" }}>
              {st.icon} {l}
            </button>
          );
        })}
      </div>
    </div>
  );
}
