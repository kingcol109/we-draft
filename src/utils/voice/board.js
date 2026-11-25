// src/utils/voice/board.js
//
// /voice: words for boards — positions ("running backs", "corners") and
// grade groups ("a first round grade", "early first", "day two"). Pure.
import { plain } from "./text";
import { GRADE_SCALE } from "../gradeScale";

// Spoken position → { pos (the site's), sub? (a DB's / OL's sub-position), label }
const POS_WORDS = [
  [["quarterbacks", "quarterback", "qbs", "qb"], "QB", null, "quarterbacks"],
  [["running backs", "running back", "rbs", "rb", "backs", "tailbacks", "halfbacks"], "RB", null, "running backs"],
  [["wide receivers", "wide receiver", "receivers", "receiver", "wrs", "wr", "wideouts"], "WR", null, "wide receivers"],
  [["tight ends", "tight end", "tes", "te"], "TE", null, "tight ends"],
  [["offensive linemen", "offensive lineman", "offensive line", "linemen", "ol", "o line", "oline"], "OL", null, "offensive linemen"],
  [["offensive tackles", "tackles", "ots"], "OL", "OT", "offensive tackles"],
  [["guards", "interior offensive linemen", "interior linemen"], "OL", "G", "guards"],
  [["centers"], "OL", "C", "centers"],
  [["edge rushers", "edge rusher", "edges", "edge", "pass rushers", "defensive ends"], "EDGE", null, "edge rushers"],
  [["defensive linemen", "defensive lineman", "defensive tackles", "dl", "d line", "dline", "interior defensive linemen", "dts", "nose tackles"], "DL", null, "defensive linemen"],
  [["linebackers", "linebacker", "lbs", "lb", "backers"], "LB", null, "linebackers"],
  [["defensive backs", "defensive back", "dbs", "db", "secondary"], "DB", null, "defensive backs"],
  [["cornerbacks", "cornerback", "corners", "corner", "cbs"], "DB", "CB", "cornerbacks"],
  [["safeties", "safety"], "DB", "S", "safeties"],
];
const POS_LIST = POS_WORDS.flatMap(([ws, pos, sub, label]) => ws.map((w) => [w, { pos, sub, label }])).sort((a, b) => b[0].length - a[0].length);
export const POS_RE = `(?:${POS_LIST.map(([w]) => w).join("|")})`;
/** "running backs" → { pos: "RB", sub: null, label } | null; "players" / "prospects" → { pos: null, label: "players" } */
export function positionSaid(said) {
  const t = plain(said).replace(/^(?:the |my |of )/, "");
  if (/^(?:players|prospects|guys|people|names)$/.test(t)) return { pos: null, sub: null, label: "players" };
  const hit = POS_LIST.find(([w]) => w === t);
  return hit ? hit[1] : null;
}

const FIRSTS = ["Early First Round", "Middle First Round", "Late First Round"];
const ROUND = (n) => Object.keys(GRADE_SCALE)[n + 1]; // 2 → "Second Round"
/** A grade group said → { grades: [label], label } | null */
export function gradeGroupSaid(said) {
  let t = plain(said).replace(/^(?:a |an |the )/, "").replace(/\b(grades?|graded|grade on them|on them|picks?|rounders?|round grades?)\b/g, (m) => (/round/.test(m) ? "round" : "")).replace(/\s+/g, " ").trim();
  t = t.replace(/\b(1st|one)\b/g, "first").replace(/\b(2nd|two)\b/g, "second").replace(/\b(3rd|three)\b/g, "third").replace(/\b(4th|four)\b/g, "fourth").replace(/\b(5th|five)\b/g, "fifth").replace(/\b(6th|six)\b/g, "sixth").replace(/\b(7th|seven)\b/g, "seventh").replace(/\bmid\b/g, "middle").replace(/^round (\w+)$/, "$1 round").trim();
  if (!t) return null;
  if (/^(?:day one|day 1|first round|first|round one|first rounders?)$/.test(t)) return { grades: FIRSTS, label: "a first round grade" };
  if (/^(early|middle|late) first(?: round)?$/.test(t)) { const w = t.split(" ")[0]; const g = `${w[0].toUpperCase()}${w.slice(1)} First Round`; return { grades: [g], label: `${w === "early" ? "an" : "a"} ${w} first round grade` }; }
  if (/^day (?:two|2)$/.test(t)) return { grades: [ROUND(2), ROUND(3)], label: "a day two grade (rounds 2 and 3)" };
  if (/^day (?:three|3)$/.test(t)) return { grades: [ROUND(4), ROUND(5), ROUND(6), ROUND(7)], label: "a day three grade (rounds 4 to 7)" };
  if (/^(?:udfa|undrafted|free agent)$/.test(t)) return { grades: ["UDFA"], label: "a UDFA grade" };
  if (/^(?:watch ?list|watching)$/.test(t)) return { grades: ["Watchlist"], label: "watchlist" };
  if (/^(?:top two rounds|first two rounds|second round or better|top 2 rounds)$/.test(t)) return { grades: [...FIRSTS, ROUND(2)], label: "a grade in the first two rounds" };
  if (/^(?:top three rounds|first three rounds|third round or better|top 3 rounds)$/.test(t)) return { grades: [...FIRSTS, ROUND(2), ROUND(3)], label: "a grade in the first three rounds" };
  const m = t.match(/^(second|third|fourth|fifth|sixth|seventh)(?: round)?$/);
  if (m) { const g = `${m[1][0].toUpperCase()}${m[1].slice(1)} Round`; return { grades: [g], label: `a ${m[1]} round grade` }; }
  return null;
}
