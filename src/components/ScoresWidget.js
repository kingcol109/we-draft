// src/components/ScoresWidget.js
//
// /live's scores pop-out (desktop Chrome / Edge — Document Picture-in-
// Picture): an always-on-top window with live scores for the games the
// user chose — every game on the slate, or a picked set — that floats over
// other apps and screens. LivePage.js opens the window (openPipWindow) from
// the score strip's pop-out button (ScoresPicker), keeps the selection, and
// renders ScoresWidget into it with the live slate, so it updates in place.
// Live games first (closest late games on top), then upcoming, then finals.
import { statusLabel, teamShort } from "../utils/live";

const LIVE_RED = "#ff4d4d";
const GOLD = "#f6a21d";

export const SCORES_WIDGET_STYLE = `
.sw { min-height: 100vh; background: #0a0f1a; color: #eef2f8; font-family: "Inter", "Segoe UI", Arial, sans-serif; display: flex; flex-direction: column; }
.sw-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 12px; background: #0c1220; border-bottom: 1px solid #1d2840; position: sticky; top: 0; z-index: 2; }
.sw-head b { font-weight: 900; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; }
.sw-head b span { color: ${GOLD}; }
.sw-head small { font-weight: 800; font-size: 11px; color: #8193ad; }
.sw-list { flex: 1; overflow-y: auto; padding: 8px; display: grid; gap: 6px; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); align-content: start; scrollbar-width: thin; }
.sw-game { position: relative; background: #111a2b; border: 1px solid #1d2840; border-radius: 10px; padding: 7px 10px 7px 13px; overflow: hidden; }
.sw-game.live { border-color: rgba(255,77,77,0.45); }
.sw-game::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(var(--ac) 50%, var(--hc) 50%); }
.sw-row { display: flex; align-items: center; gap: 7px; font-weight: 800; font-size: 14px; line-height: 1.5; }
.sw-row img { width: 20px; height: 20px; object-fit: contain; flex-shrink: 0; }
.sw-team { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase; }
.sw-rank { color: #8193ad; font-size: 10px; margin-right: 4px; }
.sw-ball { width: 6px; height: 6px; border-radius: 50%; background: ${GOLD}; box-shadow: 0 0 6px ${GOLD}; flex-shrink: 0; }
.sw-row b { font-size: 17px; font-weight: 900; font-variant-numeric: tabular-nums; min-width: 22px; text-align: right; animation: sw-flash 1.6s ease-out; }
@keyframes sw-flash { 0% { color: ${GOLD}; transform: scale(1.15); } 100% { transform: scale(1); } }
.sw-row.lose { opacity: 0.42; }
.sw-status { display: flex; align-items: center; gap: 6px; margin-top: 2px; font-size: 11px; font-weight: 900; color: #9fb0c8; font-variant-numeric: tabular-nums; }
.sw-game.live .sw-status { color: ${LIVE_RED}; }
.sw-dot { width: 7px; height: 7px; border-radius: 50%; background: ${LIVE_RED}; animation: sw-pulse 1.6s infinite; }
@keyframes sw-pulse { 0% { box-shadow: 0 0 0 0 rgba(255,77,77,0.6); } 70% { box-shadow: 0 0 0 6px rgba(255,77,77,0); } 100% { box-shadow: 0 0 0 0 rgba(255,77,77,0); } }
.sw-status .tv { margin-left: auto; color: #6f819c; font-weight: 800; }
.sw-empty { padding: 30px 14px; text-align: center; color: #6f819c; font-weight: 800; font-size: 14px; }
`;

const margin = (g) => Math.abs((g.home?.points ?? 0) - (g.away?.points ?? 0));
function order(games) {
  const live = games.filter((g) => g.status === "in_progress")
    .sort((a, b) => ((b.period || 0) >= 4) - ((a.period || 0) >= 4) || margin(a) - margin(b));
  const pre = games.filter((g) => g.status === "scheduled").sort((a, b) => (Date.parse(a.startDate) || 0) - (Date.parse(b.startDate) || 0));
  const fin = games.filter((g) => g.status === "final").sort((a, b) => (Date.parse(b.startDate) || 0) - (Date.parse(a.startDate) || 0));
  return [...live, ...pre, ...fin];
}

export default function ScoresWidget({ games, week, picked, tvShort }) {
  const list = order(picked ? games.filter((g) => picked.includes(g.id)) : games);
  const liveCount = list.filter((g) => g.status === "in_progress").length;
  return (
    <div className="sw">
      <div className="sw-head">
        <b>We-Draft <span>Live</span>{week != null ? ` · Week ${week}` : ""}</b>
        <small>{liveCount ? `${liveCount} live · ` : ""}{picked ? `${list.length} picked` : "All games"}</small>
      </div>
      {!list.length ? <div className="sw-empty">No games to show.</div> : (
        <div className="sw-list">
          {list.map((g) => {
            const live = g.status === "in_progress";
            const final = g.status === "final";
            return (
              <div key={g.id} className={`sw-game${live ? " live" : ""}`} style={{ "--ac": g.away?.color || "#2a4a7a", "--hc": g.home?.color || "#7a2a2a" }}>
                {["away", "home"].map((side) => {
                  const t = g[side] || {};
                  const other = g[side === "home" ? "away" : "home"] || {};
                  return (
                    <div key={side} className={`sw-row${final && t.points < other.points ? " lose" : ""}`}>
                      {(t.logoDark || t.logo) && <img src={t.logoDark || t.logo} alt="" />}
                      <span className="sw-team">{t.rank ? <span className="sw-rank">{t.rank}</span> : null}{teamShort(t)}</span>
                      {live && g.possession === side && <span className="sw-ball" title="Possession" />}
                      <b key={t.points}>{t.points ?? ""}</b>
                    </div>
                  );
                })}
                <div className="sw-status">
                  {live && <span className="sw-dot" />}{statusLabel(g)}
                  {!final && g.tv && <span className="tv">{tvShort ? tvShort(g.tv) : g.tv}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Open an always-on-top pop-out window with the page's styles and no site
// chrome (index.css's body padding for the navbar, scrollbars). null when
// the browser can't, or the user dismissed it.
export async function openPipWindow({ width, height, title = "We-Draft Live", scroll = false }) {
  if (typeof window === "undefined" || !("documentPictureInPicture" in window)) return null;
  try {
    const win = await window.documentPictureInPicture.requestWindow({ width, height });
    document.querySelectorAll("style, link[rel='stylesheet']").forEach((n) => win.document.head.appendChild(n.cloneNode(true)));
    win.document.title = title;
    win.document.documentElement.style.cssText = `overflow:${scroll ? "auto" : "hidden"};background:#0a0f1a;`;
    win.document.body.style.cssText = `margin:0;padding:0;overflow:${scroll ? "auto" : "hidden"};background:#0a0f1a;`;
    return win;
  } catch {
    return null;
  }
}
