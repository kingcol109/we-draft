// src/utils/briefPlay.js
//
// One short line for a play — the pop-out scoreboard widget's play line
// (LivePage.js GameView), far terser than the play-by-play card:
//   "Trey Benson rush for 5 yards. 3rd & 5."
//   "K'saan Farrar pass to Tommy Maher for 10 yards. First down."
//   "Drake Vickers intercepts Terrence Smith Jr."
// `next` is the upcoming snap (utils/live.js nextSituation) — its down &
// distance closes the line unless the play scored or moved the chains.
import { downLabel } from "./live";

const yardsText = (y) => {
  if (y == null) return "";
  if (y === 0) return " for no gain";
  if (y < 0) return ` for a loss of ${-y} yard${y === -1 ? "" : "s"}`;
  return ` for ${y} yard${y === 1 ? "" : "s"}`;
};
const name = (pl) => pl?.name || pl?.short || "";
const cap = (s) => (s ? (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).replace(/\b(q\d|\d*ot)\b/g, (m) => m.toUpperCase()) : "");

function action(p) {
  const pr = p.presentation || {};
  const pl = pr.players || {};
  const y = p.yards ?? pr.yards ?? null;
  const lead = pr.line?.find((x) => x.player)?.player;
  switch (pr.type) {
    case "rush": return `${name(pl.rusher || lead) || "Rush"} rush${yardsText(y)}`;
    case "pass": return `${name(pl.passer) || "Pass"}${pl.receiver ? ` pass to ${name(pl.receiver)}` : " pass"}${yardsText(y)}`;
    case "incomplete": return `${name(pl.passer) || "Pass"} pass incomplete${pl.receiver ? ` to ${name(pl.receiver)}` : ""}`;
    case "sack": return `${name(pl.passer || lead) || "QB"} sacked${y != null && y < 0 ? ` for a loss of ${-y}` : ""}`;
    case "interception": return `${name(lead) || "Intercepted"}${pl.passer ? ` intercepts ${name(pl.passer)}` : " interception"}`;
    case "fumble": return `${name(pl.fumbler || lead) || "Fumble"} fumbles${pr.detail ? ` · ${pr.detail}` : ""}`;
    case "punt": return [name(pl.punter || lead), pr.detail || "Punt"].filter(Boolean).join(" · ");
    case "kickoff": return pr.detail || "Kickoff";
    case "field_goal": return [name(pl.kicker || lead), cap(pr.headline || "Field goal")].filter(Boolean).join(" · ");
    case "conversion": return cap(pr.headline || "Extra point");
    case "penalty": return pr.detail ? `Penalty · ${pr.detail}` : "Penalty";
    case "timeout": return `Timeout${pr.detail ? ` · ${pr.detail}` : ""}`;
    case "period": return cap(pr.headline || "End of quarter");
    default: return [cap(pr.headline), pr.detail].filter(Boolean).join(" · ") || p.text || "";
  }
}

export function briefPlay(p, next) {
  if (!p) return "";
  const pr = p.presentation || {};
  const out = action(p).replace(/\.+$/, ""); // "Jr." + "." → one period
  if (pr.touchdown) return `${out}. Touchdown!`;
  if (pr.turnover || ["timeout", "period", "kickoff", "punt", "field_goal", "conversion"].includes(pr.type)) return `${out}.`;
  if (pr.firstDown) return `${out}. First down.`;
  // Down & distance only when the same team still has the ball.
  if (next?.down && (!next.offense || !p.offense || next.offense === p.offense)) return `${out}. ${downLabel(next.down, next.distance)}.`;
  return `${out}.`;
}
