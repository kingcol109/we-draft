// src/utils/playCall.js
//
// The "call" of a play: what kind of snap it was and who had the ball,
// without the outcome. A new play is revealed in two beats (hooks/
// usePlayReveal.js): first the call ("PASS · C. Williams"), then, a moment
// later, the result (yards, touchdown, interception …), so the viewer
// takes in one thing at a time, the way a play unfolds on TV.
//
// Returns { label, player } (player: a presentation player, or null), or
// null for a play that shows at once: a flag, a timeout, the end of a
// quarter, anything the parser couldn't place.

const CALLS = {
  pass: ["PASS", "passer"],
  incomplete: ["PASS", "passer"],
  interception: ["PASS", "passer"],
  sack: ["PASS", "passer"],
  rush: ["RUSH", "rusher"],
  fumble: ["SNAP", "fumbler"],
  field_goal: ["FIELD GOAL TRY", "kicker"],
  punt: ["PUNT", "punter"],
  kickoff: ["KICKOFF", "kicker"],
};

export function playCall(play) {
  const pres = play?.presentation;
  if (!pres || pres.nullified || pres.flagStory) return null;
  if (pres.type === "conversion") {
    const two = pres.headline === "2-PT CONVERSION";
    return { label: two ? "2-PT TRY" : "EXTRA POINT TRY", player: two ? null : pres.players?.kicker || null };
  }
  const c = CALLS[pres.type];
  if (!c) return null;
  return { label: c[0], player: pres.players?.[c[1]] || null };
}
