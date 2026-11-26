// src/utils/voice/spoken.js
//
// /voice: answers said the way a person talks (user, 2026-11-25: "the screen
// can give the short breakdown, but the verbal answer should always sound
// like a human talking" — no box scores, no percentages read out). The
// screen keeps the rows / numbers; these build a reply's `speak`. Pure.
import { statValue } from "./stats";
import { shortTeam } from "./phrase";

const num = (v) => Number(String(v ?? "").replace(/,/g, "")) || 0;
const n = (x) => Math.round(x).toLocaleString("en-US");
const count = (k, one, many = `${one}s`) => (k === 1 ? `a ${one}` : `${n(k)} ${many}`);
const andList = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * One player's game, as said — from either line shape:
 *   play-by-play / leaders: { passing: { att, cmp, yds, td, int }, rushing: { car, yds, td }, receiving: { rec, yds, td }, defense: { sacks, int } }
 *   ESPN box: { passing: { "C/ATT", YDS, TD, INT }, rushing: { CAR, YDS, TD }, receiving: { REC, YDS, TD }, defensive: { TOT, SACKS, TFL }, interceptions: { INT } }
 * → "threw for 268 yards and a touchdown, and ran for 39 more"
 */
export function gameDid(stats = {}) {
  const p = stats.passing || {};
  const r = stats.rushing || {};
  const c = stats.receiving || {};
  const d = stats.defense || stats.defensive || {};
  const att = num(p.att) || num(String(p["C/ATT"] || "").split("/")[1]);
  const pYds = num(p.yds ?? p.YDS); const pTd = num(p.td ?? p.TD); const pInt = num(p.int ?? p.INT);
  const car = num(r.car ?? r.CAR); const rYds = num(r.yds ?? r.YDS); const rTd = num(r.td ?? r.TD);
  const rec = num(c.rec ?? c.REC); const cYds = num(c.yds ?? c.YDS); const cTd = num(c.td ?? c.TD);
  const tkl = num(d.TOT); const sacks = num(d.sacks ?? d.SACKS); const tfl = num(d.TFL);
  const picks = num(d.int) || num(stats.interceptions?.INT);
  const parts = [];
  if (att) parts.push(`threw for ${n(pYds)} yards${pTd ? ` and ${count(pTd, "touchdown")}` : ""}${pInt ? `, with ${count(pInt, "interception")}` : ""}`);
  if (car && (!att || rYds >= 20 || rTd)) {
    if (att) parts.push(`ran for ${rYds > 0 ? `${n(rYds)} more` : `${n(rYds)} yards`}${rTd ? ` and ${count(rTd, "score")}` : ""}`);
    else parts.push(`ran for ${n(rYds)} yards${rTd ? ` and ${count(rTd, "touchdown")}` : ""} on ${n(car)} carr${car === 1 ? "y" : "ies"}`);
  }
  if (rec && (!car || rec >= 2)) parts.push(`caught ${rec === 1 ? "a pass" : `${n(rec)} passes`} for ${n(cYds)} yards${cTd ? ` and ${count(cTd, "touchdown")}` : ""}`);
  if (tkl || sacks || tfl) {
    const extra = [sacks && `${sacks === 1 ? "a sack" : `${sacks} sacks`}`, !sacks && tfl && `${tfl} for loss`].filter(Boolean);
    parts.push(tkl ? `made ${count(tkl, "tackle")}${extra.length ? ` with ${andList(extra)}` : ""}` : `had ${andList(extra)}`);
  }
  if (picks) parts.push(`picked off ${picks === 1 ? "a pass" : `${picks} passes`}`);
  if (!parts.length) return "";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** A season / game line (utils/voice/stats.js keys) in the box shape gameDid reads. */
export function lineAsBox(line) {
  const v = (k) => statValue(line, k) || 0;
  return {
    passing: v("att") ? { att: v("att"), yds: v("passYds"), td: v("passTd"), int: v("passInt") } : undefined,
    rushing: v("carries") ? { car: v("carries"), yds: v("rushYds"), td: v("rushTd") } : undefined,
    receiving: v("rec") ? { rec: v("rec"), yds: v("recYds"), td: v("recTd") } : undefined,
    defensive: v("tackles") || v("sacks") ? { TOT: v("tackles"), SACKS: v("sacks"), TFL: v("tfl") } : undefined,
    interceptions: v("defInt") ? { INT: v("defInt") } : undefined,
  };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayOf = (iso) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const k = d.getDate();
  return `${MONTHS[d.getMonth()]} ${k}${k % 100 > 10 && k % 100 < 14 ? "th" : ["th", "st", "nd", "rd"][k % 10] || "th"}`;
};
const scoreSaid = (s) => String(s || "").replace(/(\d+)\s*[-–]\s*(\d+)/, "$1 to $2");

/**
 * A player's game (utils/voice/stats.js game: { line, opp, at, result, score, date }) told like a
 * breakdown: "Keisean Henderson threw for 268 yards and a touchdown, and ran for 39 more in
 * Houston's 34 to 31 win at West Virginia on November 21st."
 */
export function gameStory(name, school, g) {
  const did = gameDid(lineAsBox(g.line));
  const opp = g.opp || g.oppAbbr || "";
  const where = g.at === "@" ? `at ${opp}` : `against ${opp}`;
  const res = g.result === "W" ? "win" : g.result === "L" ? "loss" : g.result === "T" ? "tie" : "";
  const game = res && g.score ? `${school ? `${school}'s ` : "a "}${scoreSaid(g.score)} ${res} ${where}` : `the game ${where}`;
  const when = dayOf(g.date);
  if (!did) return `${name} didn't show up in the box score in ${game}${when ? ` on ${when}` : ""}.`;
  return `${name} ${did} in ${game}${when ? ` on ${when}` : ""}.`;
}

/** Screen text → how it's read out: "·" pauses, "#12" → "number 12", "34-31" → "34 to 31". */
export function forSpeech(text) {
  return String(text || "")
    .replace(/\s*·\s*/g, ", ")
    .replace(/#(\d+)/g, "number $1")
    // Name suffixes said in full (voice note 2026-11-26: "it's reading Junior as J R").
    .replace(/\b([A-Z][A-Za-z'’-]+),? Jr\.?(?=[\s,.;:!?)]|$)/g, "$1 Junior")
    .replace(/\b([A-Z][A-Za-z'’-]+),? Sr\.?(?=[\s,.;:!?)]|$)/g, "$1 Senior")
    .replace(/\b([A-Z][A-Za-z'’-]+) III(?=[\s,.;:!?)]|$)/g, "$1 the Third")
    .replace(/\b([A-Z][A-Za-z'’-]+) II(?=[\s,.;:!?)]|$)/g, "$1 the Second")
    .replace(/\b([A-Z][A-Za-z'’-]+) IV(?=[\s,.;:!?)]|$)/g, "$1 the Fourth")
    .replace(/\b(\d{1,3})\s*[-–]\s*(\d{1,3})\b(?!\s*(?:\d|yard|yd))/g, "$1 to $2")
    .replace(/\s+/g, " ")
    .trim();
}

/** A player's best games, as said: "For Kromah, start with Clemson on October 3rd, when he ran for 150 yards… Then …" */
export function bestGamesSpoken(name, games) {
  const lines = games.slice(0, 3).map((g, i) => {
    const opp = g.opp || g.oppAbbr || "";
    const when = dayOf(g.date);
    const did = gameDid(lineAsBox(g.line));
    const head = i === 0 ? `For ${name}, start with ${g.at === "@" ? `the trip to ${opp}` : opp}` : i === games.length - 1 || i === 2 ? `And ${g.at === "@" ? `at ${opp}` : opp}` : `Then ${g.at === "@" ? `at ${opp}` : opp}`;
    return `${head}${when ? ` on ${when}` : ""}${did ? `, when he ${did}` : ""}.`;
  });
  return lines.join(" ");
}

/** A game a reply was about, kept for "who won that game?": { school, opp, at, result, score, date }. */
export const gameOf = (d, g) => (g ? { school: d.School || "", opp: shortTeam(g.opp || g.oppAbbr || ""), at: g.at === "@" ? "at" : "vs", result: g.result || "", score: g.score || "", date: g.date || null } : null);
