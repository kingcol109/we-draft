// src/utils/voice/evals.js
//
// /voice: a user's own evaluation of a player — the same one the player
// page edits (grade, strengths, weaknesses, NFL fit), said out loud. Pure:
// the words → values, and the page's rules for an edit:
//   - the grade scale is utils/gradeScale.js (+ Watchlist)
//   - strengths and weaknesses: his position's traits + Generic, at most 5
//     each, and a trait is never on both lists (adding it to one takes it
//     off the other — said in the confirm)
//   - NFL fit: one of the 32 teams, by full name
import { GRADE_SCALE } from "../gradeScale";
import { plain } from "./text";
import { soundKey, lev } from "./names";

export const MAX_TRAITS = 5;
export const GRADES = ["Watchlist", ...Object.keys(GRADE_SCALE)];
export const NFL_TEAMS = ["Arizona Cardinals", "Atlanta Falcons", "Baltimore Ravens", "Buffalo Bills", "Carolina Panthers", "Chicago Bears", "Cincinnati Bengals", "Cleveland Browns", "Dallas Cowboys", "Denver Broncos", "Detroit Lions", "Green Bay Packers", "Houston Texans", "Indianapolis Colts", "Jacksonville Jaguars", "Kansas City Chiefs", "Las Vegas Raiders", "Los Angeles Chargers", "Los Angeles Rams", "Miami Dolphins", "Minnesota Vikings", "New England Patriots", "New Orleans Saints", "New York Giants", "New York Jets", "Philadelphia Eagles", "Pittsburgh Steelers", "San Francisco 49ers", "Seattle Seahawks", "Tampa Bay Buccaneers", "Tennessee Titans", "Washington Commanders"];
const TEAM_ALIASES = { niners: "San Francisco 49ers", "forty niners": "San Francisco 49ers", "49ers": "San Francisco 49ers", pats: "New England Patriots", bucs: "Tampa Bay Buccaneers", jags: "Jacksonville Jaguars", commies: "Washington Commanders", skins: "Washington Commanders", phins: "Miami Dolphins", "big blue": "New York Giants", "la rams": "Los Angeles Rams", "la chargers": "Los Angeles Chargers", "bolts": "Los Angeles Chargers", "g men": "New York Giants", "boys": "Dallas Cowboys" };

/** "second round" / "a 2nd rounder" / "round two" / "early first" / "undrafted" → a grade | { ask } | null */
export function parseGrade(said) {
  let t = plain(said).replace(/^(?:a |an |the )/, "").replace(/\b(grade|pick|player|guy|prospect|selection)\b/g, "").replace(/rounder\b/, "round").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/^(udfa|undrafted|free agent|priority free agent|un drafted|u d f a)$/.test(t)) return "UDFA";
  if (/^(watch ?list|watching)$/.test(t)) return "Watchlist";
  t = t.replace(/\b(1st|one)\b/g, "first").replace(/\b(2nd|two)\b/g, "second").replace(/\b(3rd|three)\b/g, "third").replace(/\b(4th|four)\b/g, "fourth").replace(/\b(5th|five)\b/g, "fifth").replace(/\b(6th|six)\b/g, "sixth").replace(/\b(7th|seven)\b/g, "seventh").replace(/\bmid\b/g, "middle");
  t = t.replace(/^round (\w+)$/, "$1 round").replace(/^(early|middle|late) (first)$/, "$1 first round");
  if (!/round$/.test(t)) t = `${t} round`;
  const hit = Object.keys(GRADE_SCALE).find((g) => g.toLowerCase() === t);
  if (hit) return hit;
  if (t === "first round") return { ask: "Early, middle or late first round?" };
  return null;
}

/** "the jets" / "new york jets" / "niners" → a team name | null */
export function parseTeam(said) {
  const t = plain(said).replace(/^the /, "").trim();
  if (!t) return null;
  if (TEAM_ALIASES[t]) return TEAM_ALIASES[t];
  const full = NFL_TEAMS.find((n) => plain(n) === t);
  if (full) return full;
  const nick = NFL_TEAMS.find((n) => plain(n).split(" ").pop() === t || plain(n).endsWith(` ${t}`));
  if (nick) return nick;
  const near = NFL_TEAMS.map((n) => ({ n, d: lev(t, plain(n).split(" ").pop()) })).sort((a, b) => a.d - b.d)[0];
  return near && near.d <= 1 && t.length >= 4 ? near.n : null;
}

/** "vision and burst, ball security" → { found: [trait], missed: [phrase] } from his list. */
export function matchTraits(said, list) {
  const parts = plain(said).split(/ (?:and|plus|also|&) | , |,/).map((x) => x.replace(/^(?:his |the |a |an )/, "").trim()).filter(Boolean);
  const found = [];
  const missed = [];
  const words = (s) => plain(s).replace(/ /g, "");
  parts.forEach((p) => {
    const q = words(p);
    let best = null;
    list.forEach((tr) => {
      const k = words(tr);
      const sc = q === k ? 1 : Math.max(1 - lev(q, k) / Math.max(q.length, k.length), soundKey(q) === soundKey(k) && k.length >= 5 ? 0.88 : 0, k.startsWith(q) && q.length >= 5 ? 0.86 : 0);
      if (sc >= 0.8 && (!best || sc > best.s)) best = { tr, s: sc };
    });
    if (best) found.push(best.tr); else missed.push(p);
  });
  return { found: [...new Set(found)], missed };
}

/**
 * An edit to the evaluation, by the page's rules.
 * prev: { grade, strengths, weaknesses, nflFit } (or null: a new one)
 * edit: { grade } | { nflFit } | { add: "strengths" | "weaknesses", traits } | { remove: …, traits }
 * → { next, notes: [string], changed: boolean } | { error }
 */
export function editEval(prev, edit, { gradeLocked = false } = {}) {
  const cur = { grade: prev?.grade || "", strengths: [...(prev?.strengths || [])], weaknesses: [...(prev?.weaknesses || [])], nflFit: prev?.nflFit || "" };
  const notes = [];
  if (edit.grade) {
    if (gradeLocked) return { error: "Grades for this class are locked." };
    if (cur.grade === edit.grade) return { next: cur, notes, changed: false };
    return { next: { ...cur, grade: edit.grade }, notes, changed: true };
  }
  if (edit.nflFit) return { next: { ...cur, nflFit: edit.nflFit }, notes, changed: cur.nflFit !== edit.nflFit };
  const list = edit.add || edit.remove;
  const other = list === "strengths" ? "weaknesses" : "strengths";
  if (edit.remove) {
    const gone = edit.traits.filter((t) => cur[list].includes(t));
    if (!gone.length) return { error: `${edit.traits.join(" and ")} ${edit.traits.length === 1 ? "isn't" : "aren't"} on your ${list}.` };
    return { next: { ...cur, [list]: cur[list].filter((t) => !gone.includes(t)) }, notes, changed: true };
  }
  const adds = edit.traits.filter((t) => !cur[list].includes(t));
  if (!adds.length) return { next: cur, notes, changed: false };
  const moved = adds.filter((t) => cur[other].includes(t));
  if (moved.length) notes.push(`That takes ${moved.join(" and ")} off your ${other}.`);
  const nextList = [...cur[list], ...adds];
  if (nextList.length > MAX_TRAITS) return { error: `You can have ${MAX_TRAITS} ${list} at most. You have ${cur[list].length}: ${cur[list].join(", ")}. Remove one first.` };
  return { next: { ...cur, [list]: nextList, [other]: cur[other].filter((t) => !moved.includes(t)) }, notes, changed: true };
}

