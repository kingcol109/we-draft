// src/utils/voice/draft.js
//
// /voice: the NFL draft's history (user, 2026-11-25) — "who went first
// overall in 2007", "list every quarterback taken first overall", "Ohio
// State first round defensive linemen", "LSU second round quarterbacks",
// "the earliest quarterback ever drafted from LSU", "when was Joe Burrow
// drafted". Pure.
//
// The data: compSnapshots/_draftHistory (scripts/buildVoiceDraftHistory.mjs,
// weekly) — every drafted player, 2000 through the latest draft, one string
// each: "year|round|pick|name|position|school|NFL team".
import { plain } from "./text";
import { positionSaid } from "./board";
import { parseTeam } from "./evals";
import { nameScore } from "./names";
import { SEP, draftRows, decodeDraft } from "./draftRows";

export { SEP, draftRows, decodeDraft };

const ROUNDS = { first: 1, "1st": 1, one: 1, second: 2, "2nd": 2, two: 2, third: 3, "3rd": 3, three: 3, fourth: 4, "4th": 4, four: 4, fifth: 5, "5th": 5, five: 5, sixth: 6, "6th": 6, six: 6, seventh: 7, "7th": 7, seven: 7 };
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20, "twenty five": 25, thirty: 30, "thirty two": 32 };
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

// ── Reading a question ──
const squash = (s) => plain(s).replace(/ /g, "");
/**
 * What a draft question asks → { years, round, pick, maxPick, pos, school, team, sort, count, ever } | null
 * schools: every school in the history (to find "ohio state" / "lsu" in the words).
 */
export function parseDraftQuery(text, schools = []) {
  let t = plain(text).replace(/\bnumber one\b/g, "number 1").replace(/\bno 1\b/g, "number 1");
  const q = {};
  const take = (re, fn) => { const m = t.match(re); if (m) { fn(m); t = t.replace(m[0], " ").replace(/\s+/g, " ").trim(); } return !!m; };
  // Years: "since 2015", "from 2010 to 2015", "in 2007", "2007 and 2008".
  take(/\b(?:since|after) (20\d\d)\b/, (m) => { q.from = Number(m[1]); });
  take(/\b(?:from|between) (20\d\d) (?:to|and|through) (20\d\d)\b/, (m) => { q.from = Number(m[1]); q.to = Number(m[2]); });
  const ys = t.match(/\b(?:19|20)\d\d\b/g);
  if (ys) { q.years = ys.map(Number); t = t.replace(/\b(?:19|20)\d\d\b/g, " "); }
  // An overall pick: "first overall", "number 1 pick", "12th pick", "picked 5th", "top 10 picks".
  take(/\btop (\d+|ten|five|three|fifteen|twenty|thirty two)(?: overall)? (?:picks?|selections?)\b/, (m) => { q.maxPick = NUM[m[1]] || Number(m[1]); });
  take(/\b(first|1st|number 1|#1) (?:overall|pick overall|overall pick|pick|selection)\b/, () => { q.pick = 1; })
    || take(/\b(?:number |no |#)?(\d+)(?:st|nd|rd|th)? (?:overall|pick|overall pick|selection)\b/, (m) => { q.pick = Number(m[1]); })
    || take(/\bnumber (\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/, (m) => { q.pick = NUM[m[1]] || Number(m[1]); })
    || take(/\b(second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) (?:overall|pick)\b/, (m) => { q.pick = ORD[m[1]]; });
  // A round: "first round", "round 2", "second rounders", "day two".
  take(/\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th|seventh|7th)[ -]round(?:ers?)?\b/, (m) => { q.round = ROUNDS[m[1]]; })
    || take(/\bround (one|two|three|four|five|six|seven|\d)\b/, (m) => { q.round = ROUNDS[m[1]] || Number(m[1]); })
    || take(/\bfirst rounders?\b/, () => { q.round = 1; })
    || take(/\bday (one|1)\b/, () => { q.round = 1; })
    || take(/\bday (two|2)\b/, () => { q.rounds = [2, 3]; })
    || take(/\bday (three|3)\b/, () => { q.rounds = [4, 5, 6, 7]; });
  // Which one: earliest / highest = the best pick; latest / lowest = the last; most recent / last time = the newest year.
  take(/\b(most recent|last time|latest year|most recently|recent)\b/, () => { q.sort = "newest"; })
    || take(/\b(first ever|first time|oldest)\b/, () => { q.sort = "oldest"; })
    || take(/\b(earliest|highest|highest drafted|top drafted|best)\b/, () => { q.sort = "best"; q.one = true; })
    || take(/\b(lowest|latest|last)\b/, () => { q.sort = "worst"; q.one = true; })
    // "the first quarterback drafted in 2020" ("first round" / "first overall" are already read).
    || take(/\b(first|top)\b/, () => { q.sort = "best"; q.one = true; });
  if (/\bhow many\b/.test(t)) q.count = true;
  if (/\bever\b/.test(t)) q.ever = true;
  // A position, a school, an NFL team: the longest run of words that names one.
  const words = t.split(" ").filter(Boolean);
  const used = new Set();
  const span = (match, field) => {
    for (let n = 4; n >= 1; n -= 1) {
      for (let i = 0; i + n <= words.length; i += 1) {
        if ([...Array(n).keys()].some((k) => used.has(i + k))) continue;
        const v = match(words.slice(i, i + n).join(" "));
        if (v) { for (let k = 0; k < n; k += 1) used.add(i + k); q[field] = v; return; }
      }
    }
  };
  // "defensive linemen" takes in the edge rushers too (the history files many as EDGE); "defensive tackles" doesn't.
  span((w) => { const p = positionSaid(w); if (p?.pos === "DL" && /line/.test(w)) q.withEdge = true; return p?.pos || null; }, "pos");
  const schoolKeys = new Map(schools.map((s) => [squash(s), s]));
  const ALIAS = { fsu: "Florida State", osu: "Ohio State", psu: "Penn State", bama: "Alabama", usc: "USC", lsu: "LSU", tamu: "Texas A&M", am: "Texas A&M", unc: "North Carolina", olemiss: "Ole Miss", miss: "Ole Miss", pitt: "Pittsburgh", cal: "California" };
  span((w) => { if (/^(draft|drafted|pick|picks|round|overall|ever|the|from|out of|of|in|by|who|went|first|taken)$/.test(w)) return null; const k = squash(w); return schoolKeys.get(k) || (ALIAS[k] && schools.includes(ALIAS[k]) ? ALIAS[k] : null); }, "school");
  span((w) => (/^(the|by|to|from)$/.test(w) ? null : parseTeam(w)), "team");
  const any = q.years || q.from || q.pick || q.maxPick || q.round || q.rounds || q.pos || q.school || q.team;
  return any ? q : null;
}

/** The picks a query names, in its order. */
export function runDraftQuery(rows, q) {
  let out = rows.filter((r) =>
    (!q.years || q.years.includes(r.year)) && (!q.from || r.year >= q.from) && (!q.to || r.year <= q.to)
    && (!q.pick || r.pick === q.pick) && (!q.maxPick || (r.pick && r.pick <= q.maxPick))
    && (!q.round || r.round === q.round) && (!q.rounds || q.rounds.includes(r.round))
    && (!q.pos || r.pos === q.pos || (q.pos === "DL" && r.pos === "EDGE" && q.withEdge))
    && (!q.school || r.school === q.school) && (!q.team || r.team === q.team));
  const by = { best: (a, b) => (a.pick || 999) - (b.pick || 999) || a.year - b.year, worst: (a, b) => (b.pick || 0) - (a.pick || 0), newest: (a, b) => b.year - a.year || (a.pick || 999) - (b.pick || 999), oldest: (a, b) => a.year - b.year || (a.pick || 999) - (b.pick || 999) };
  out = [...out].sort(by[q.sort] || by.oldest);
  return q.one ? out.slice(0, 1) : out;
}

/** A drafted player by name → [{ …pick, s }] best first. */
export function findDrafted(said, rows) {
  const people = rows.map((r) => { const [first, ...rest] = r.name.split(" "); return { r, first, last: rest.join(" ") }; });
  const ranked = people.map((p) => ({ r: p.r, s: nameScore(said, p) })).filter((x) => x.s >= 0.8).sort((a, b) => b.s - a.s);
  if (!ranked.length) return [];
  return ranked.filter((x) => ranked[0].s - x.s < 0.06).map((x) => x.r);
}

const roundWord = (n) => ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh"][n] || `round ${n}`;
export const pickText = (r) => `${r.year}, ${r.pick ? `pick ${r.pick}` : `round ${r.round}`}${r.pick && r.round ? ` (${roundWord(r.round)} round)` : ""}`;
export const pickLine = (r) => `${r.name}, ${r.pos} out of ${r.school}, ${r.year} ${r.pick === 1 ? "first overall" : r.pick ? `pick ${r.pick}` : `round ${r.round}`}${r.team ? `, ${r.team}` : ""}`;
