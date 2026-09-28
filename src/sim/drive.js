// src/sim/drive.js
// ── Drive mode: down, distance and field position. Pure bookkeeping — the
// sim plays the snap; this takes the result and moves the chains. Field y
// is absolute (own goal line y = 10, the one you attack y = 110). ──

import { FIELD, goalLineY } from "./field.js";

const OWN_GOAL = FIELD.endZone;
const START = OWN_GOAL + 25; // every drive starts at the own 25

export function newDrive(prev) {
  return {
    n: prev ? prev.n + 1 : 1,
    ballOn: START,
    down: 1,
    lineToGain: START + 10,
    startOn: START,
    plays: [],
    score: prev ? { ...prev.score } : { td: 0, safeties: 0, turnovers: 0 },
    over: null, // set when the drive ends: { kind, text }
  };
}

const ORD = ["", "1st", "2nd", "3rd", "4th"];

// "Own 32" / "Opp 18" / "50".
export function spotLabel(y) {
  const yd = Math.round(y - OWN_GOAL);
  if (yd === 50) return "50";
  return yd < 50 ? `Own ${Math.max(1, yd)}` : `Opp ${Math.max(1, 100 - yd)}`;
}

export function downLabel(d) {
  const toGo = d.lineToGain - d.ballOn;
  const dist = d.lineToGain >= goalLineY ? "Goal" : toGo < 0.6 ? "Inches" : String(Math.max(1, Math.round(toGo)));
  return `${ORD[d.down]} & ${dist}`;
}

// Apply one snap's result. Returns the updated drive (a new object) and a
// line describing what happened to the chains.
export function applyResult(d, result, call) {
  const next = { ...d, plays: [...d.plays], score: { ...d.score } };
  const type = result ? result.type : "INCOMPLETE";
  const yards = result && result.yards ? result.yards : 0;
  const entry = { down: downLabel(d), spot: spotLabel(d.ballOn), call, type, yards };
  next.plays.push(entry);

  const finish = (kind, text) => {
    next.over = { kind, text };
    entry.text = text;
    return { drive: next, text };
  };

  if (type === "TOUCHDOWN") {
    next.score.td++;
    return finish("td", "TOUCHDOWN!");
  }
  if (type === "INTERCEPTION") {
    next.score.turnovers++;
    return finish("turnover", "Intercepted — turnover");
  }

  let text;
  if (type === "INCOMPLETE") text = "Incomplete";
  else {
    const spot = d.ballOn + yards;
    if (spot <= OWN_GOAL) {
      next.score.safeties++;
      return finish("safety", "Tackled in the end zone — safety");
    }
    next.ballOn = spot;
    const g = Math.round(yards);
    text = type === "SACK" ? `Sacked — loss of ${Math.abs(g)}` : g > 0 ? `Gain of ${g}` : g < 0 ? `Loss of ${Math.abs(g)}` : "No gain";
    if (type === "OUT_OF_BOUNDS") text += ", out of bounds";
  }

  if (next.ballOn >= d.lineToGain) {
    next.down = 1;
    next.lineToGain = Math.min(next.ballOn + 10, goalLineY);
    text += " — FIRST DOWN";
  } else {
    next.down = d.down + 1;
    if (next.down > 4) {
      next.score.turnovers++;
      return finish("downs", `${text} — turnover on downs`);
    }
  }
  entry.text = text;
  return { drive: next, text };
}

// One-line summary of a finished drive.
export function driveSummary(d) {
  const yds = Math.round((d.over && d.over.kind === "td" ? goalLineY : d.ballOn) - d.startOn);
  return `${d.plays.length} play${d.plays.length === 1 ? "" : "s"}, ${yds} yards`;
}
