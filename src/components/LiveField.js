// src/components/LiveField.js
//
// /live's field strip — a slim line across the bottom of a live game's
// scoreboard (LivePage.js GameView) showing where the ball is for the
// upcoming snap: the same `next` situation (utils/live.js nextSituation)
// as the "2nd & 7 at USM 35" line above it, so they never disagree.
// Away end zone on the left, home on the right (matching the scoreboard);
// a pin in the offense's color with its logo marks the ball, the yard line
// and an arrow (direction of travel) sit under it, and a yellow tick marks
// the line to gain. Moves slide as the ball does.

export const LIVE_FIELD_STYLE = `
.lfs { grid-column: 1 / -1; position: relative; z-index: 1; padding: 62px clamp(30px, 8vw, 110px) 0; margin-top: 2px; }
.lfs-line { position: relative; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.28); box-shadow: 0 1px 6px rgba(0,0,0,0.35); }
.lfs-ez { position: absolute; top: -1px; bottom: -1px; width: 5%; border: 1px solid rgba(255,255,255,0.5); }
.lfs-ez.away { left: -5%; border-radius: 4px 0 0 4px; }
.lfs-ez.home { right: -5%; border-radius: 0 4px 4px 0; }
.lfs-tick { position: absolute; top: -3px; width: 1px; height: 12px; background: rgba(255,255,255,0.35); }
/* midfield: a taller, solid, glowing 50 */
.lfs-tick.mid { top: -9px; width: 3px; height: 24px; margin-left: -1px; border-radius: 2px; background: #fff; box-shadow: 0 0 8px rgba(255,255,255,0.7); }
.lfs-fifty { position: absolute; top: 18px; transform: translateX(-50%); font-weight: 900; font-size: 11px; letter-spacing: 0.08em; color: rgba(255,255,255,0.6); }
@media (max-width: 600px) { .lfs-fifty { display: none; } }
.lfs-gain { position: absolute; top: -7px; width: 4px; height: 22px; margin-left: -2px; border-radius: 2px; background: #ffd400; box-shadow: 0 0 10px rgba(255,212,0,0.9); transition: left 0.8s cubic-bezier(.2,.8,.2,1); }
.lfs-ball { position: absolute; top: 0; transition: left 0.8s cubic-bezier(.2,.8,.2,1); }
.lfs-pin { position: absolute; left: 0; bottom: 6px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5)); }
.lfs-head { width: clamp(40px, 3.4vw, 54px); height: clamp(40px, 3.4vw, 54px); border-radius: 50%; border: 3px solid #fff; display: flex; align-items: center; justify-content: center; }
.lfs-head img { width: 72%; height: 72%; object-fit: contain; }
.lfs-tip { width: 0; height: 0; margin-top: -3px; border-left: 9px solid transparent; border-right: 9px solid transparent; border-top: 14px solid #fff; }
.lfs-yd { position: absolute; left: 0; top: 14px; transform: translateX(-50%); display: flex; align-items: center; gap: 6px; white-space: nowrap; font-weight: 900; font-size: clamp(20px, 2vw, 30px); line-height: 1; color: #fff; text-shadow: 0 2px 6px rgba(0,0,0,0.6); font-variant-numeric: tabular-nums; }
.lfs-arrow { width: 0; height: 0; border-top: 9px solid transparent; border-bottom: 9px solid transparent; }
.lfs-arrow.left { border-right: 14px solid #fff; }
.lfs-arrow.right { border-left: 14px solid #fff; }
.lfs-tag { position: absolute; bottom: -4px; font-size: 10px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; color: #121212; background: #f6a21d; border-radius: 999px; padding: 3px 9px; }
.lfs-pad { height: 52px; }
`;

// next: null → the bare field (after a score, at a break) — the strip
// stays so the scoreboard keeps its height.
export default function LiveField({ game, next, tag }) {
  if (!next) {
    return (
      <div className="lfs" aria-hidden="true">
        <div className="lfs-line">
          <span className="lfs-ez away" style={{ background: game.away?.color || "#2a4a7a" }} />
          <span className="lfs-ez home" style={{ background: game.home?.color || "#7a2a2a" }} />
          {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((y) => <span key={y} className={`lfs-tick${y === 50 ? " mid" : ""}`} style={{ left: `${y}%` }} />)}
          <span className="lfs-fifty" style={{ left: "50%" }}>50</span>
        </div>
        <div className="lfs-pad" />
      </div>
    );
  }
  const off = game[next.offense] || {};
  // Field yard 0 = left (away) goal line … 100 = right (home): the home
  // offense drives left, the away offense right.
  const toLeft = next.offense === "home";
  const ballYard = Math.max(0, Math.min(100, toLeft ? next.ytg : 100 - next.ytg));
  const gain = typeof next.distance === "number" ? (toLeft ? ballYard - next.distance : ballYard + next.distance) : null;
  const yardLine = ballYard > 50 ? 100 - ballYard : ballYard;
  const logo = off.logoDark || off.logo; // on the team's own color (the pin)
  return (
    <div className="lfs" aria-label={`Ball at the ${yardLine}, ${toLeft ? "driving left" : "driving right"}`}>
      {/* below the line, on the side away from the ball */}
      {tag && <span className="lfs-tag" style={ballYard < 50 ? { right: "clamp(30px, 8vw, 110px)" } : { left: "clamp(30px, 8vw, 110px)" }}>{tag}</span>}
      <div className="lfs-line">
        <span className="lfs-ez away" style={{ background: game.away?.color || "#2a4a7a" }} />
        <span className="lfs-ez home" style={{ background: game.home?.color || "#7a2a2a" }} />
        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((y) => <span key={y} className={`lfs-tick${y === 50 ? " mid" : ""}`} style={{ left: `${y}%` }} />)}
        {Math.abs(ballYard - 50) > 7 && <span className="lfs-fifty" style={{ left: "50%" }}>50</span>}
        {gain != null && gain > 0 && gain < 100 && <span className="lfs-gain" style={{ left: `${gain}%` }} />}
        <div className="lfs-ball" style={{ left: `${ballYard}%` }}>
          <div className="lfs-pin">
            <div className="lfs-head" style={{ background: off.color || "#1d2840" }}>{logo && <img src={logo} alt="" />}</div>
            <div className="lfs-tip" />
          </div>
          <div className="lfs-yd">
            {toLeft && <span className="lfs-arrow left" />}
            <span>{yardLine}</span>
            {!toLeft && <span className="lfs-arrow right" />}
          </div>
        </div>
      </div>
      <div className="lfs-pad" />
    </div>
  );
}
