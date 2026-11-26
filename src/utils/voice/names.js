// src/utils/voice/names.js
//
// /voice: which player a spoken name means. Speech engines spell names by
// sound ("Usman Chroma" for Ousmane Kromah), so a name is matched on
// spelling distance AND a sound-alike key, first and last name separately.
// A clear winner is the answer; a close race is a "which one?" for the page
// to ask. Pure — the people list is passed in.
//
// people: [{ id, first, last, pos, school, cls }]
import { plain } from "./text";

const SUFFIX = /^(jr|sr|ii|iii|iv|v|junior|senior)$/;
const SUFFIX_ANY = /\b(?:jr|sr|ii|iii|iv|v|junior|senior)\b/g;
const fullKey = (p) => plain(`${p.first || ""} ${p.last || ""}`).replace(SUFFIX_ANY, "").replace(/\s+/g, " ").trim();

export function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const sim = (a, b) => (a && b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 0);

// A rough sound-alike key: similar sounds folded, vowels dropped — and the
// first letter only kept when it's a consonant ("Usman" = "Ousmane").
export function soundKey(word) {
  let w = plain(word).replace(/ /g, "");
  if (!w) return "";
  w = w.replace(/^kn|^gn|^pn|^wr/, (m) => m[1]).replace(/ph/g, "f").replace(/ck|q|ch(?=r)/g, "k").replace(/c(?![eiy])/g, "k").replace(/c/g, "s").replace(/x/g, "ks").replace(/z/g, "s").replace(/dg/g, "j").replace(/gh/g, "g").replace(/th/g, "t").replace(/v/g, "f").replace(/y/g, "i");
  const first = /^[aeiou]/.test(w) ? "_" : w[0];
  return (first + w.slice(1).replace(/[aeiouhw]/g, "")).replace(/(.)\1+/g, "$1");
}

// How well two words match: 1 exact, else spelling / sound.
function wordScore(heard, real) {
  if (!heard || !real) return 0;
  if (heard === real) return 1;
  const s = sim(heard, real);
  // Sounds the same AND is spelled somewhat alike ("chroma"/"kromah" yes,
  // "qlacy"/"chiles" no — short sound keys collide).
  const sound = soundKey(heard) === soundKey(real) && real.length >= 4 && s >= 0.4 ? 0.9 : 0;
  return Math.max(s, sound);
}

const partsOf = (p) => {
  const first = plain(p.first).replace(/ /g, "");
  const lastWords = plain(p.last).split(" ").filter((w) => w && !SUFFIX.test(w));
  return { first, last: lastWords.join("") };
};

/** How well the words name this player: 0–1. */
export function nameScore(said, p) {
  const words = plain(said).split(" ").filter((w) => w && !SUFFIX.test(w));
  if (!words.length) return 0;
  const { first, last } = partsOf(p);
  if (words.length === 1) return Math.max(wordScore(words[0], last), 0.85 * wordScore(words[0], first));
  // First + last, split anywhere ("la norris sellers", "jaron keawe sagapolutele").
  let best = 0;
  for (let k = 1; k < words.length; k += 1) {
    const f = wordScore(words.slice(0, k).join(""), first);
    const l = wordScore(words.slice(k).join(""), last);
    best = Math.max(best, 0.4 * f + 0.6 * l);
    // The last name exactly, the first not ("q lacy" — Kewan Lacy? "ty
    // simpson" — not Donta): just under a match, so it's a "did you mean"
    // with him first, and a tap teaches it.
    if (k === words.length - 1 && l >= 0.97) best = Math.max(best, 0.78);
  }
  // …or it's all last name.
  return Math.max(best, 0.95 * wordScore(words.join(""), last));
}

const SURE = 0.8; // a match
const SURE_AT_SCHOOL = 0.72; // with the school said, a looser name is still sure
const RACE = 0.06; // closer than this to the best is a tie

// ── The school said with the name (user, 2026-11-25: the failsafe way to ask
// is "Florida State's Ousmane Kromah"; "Kromah from / at Florida State" too).
const squash = (s) => plain(s).replace(/&/g, "").replace(/ and /g, " ").replace(/ /g, "");
// What people call a school → its name on the site.
const SCHOOL_ALIASES = {
  fsu: "Florida State", psu: "Penn State", usf: "South Florida", unc: "North Carolina", pitt: "Pittsburgh",
  bama: "Alabama", cal: "California", ncstate: "NC State", northcarolinastate: "NC State", louisianastate: "LSU",
  southerncalifornia: "USC", centralflorida: "UCF", texasam: "Texas A&M", am: "Texas A&M", miamiohio: "Miami (OH)",
  miamioh: "Miami (OH)", miamiflorida: "Miami", olemiss: "Ole Miss", mississippi: "Ole Miss", uconn: "UConn",
  connecticut: "UConn", vandy: "Vanderbilt", wazzu: "Washington State", sanjose: "San Jose State", sdsu: "San Diego State",
  smu: "SMU", tcu: "TCU", byu: "BYU", lsu: "LSU", usc: "USC", ucf: "UCF", ucla: "UCLA", unlv: "UNLV", uab: "UAB",
  ndsu: "North Dakota State", vt: "Virginia Tech", gt: "Georgia Tech", wvu: "West Virginia", ku: "Kansas", ksu: "Kansas State",
};
function schoolsOf(people) {
  const map = {};
  people.forEach((p) => { if (p.school) map[squash(p.school)] = p.school; });
  Object.entries(SCHOOL_ALIASES).forEach(([k, v]) => { if (!map[k] && Object.values(map).includes(v)) map[k] = v; });
  return map;
}
/** A school said on its own ("fsu", "the florida state") → its name on the site | null */
export function schoolSaid(said, people) {
  const t = plain(said).replace(/^the /, "").replace(/(?:'s|s')$/, "");
  const schools = schoolsOf(people);
  return schools[squash(t)] || schools[squash(t.replace(/s$/, ""))] || null;
}

/** "florida state's ousmane kromah" / "kromah from florida state" → { school, name } | null */
export function splitSchool(said, people) {
  const schools = schoolsOf(people);
  const words = plain(said).split(" ").filter(Boolean);
  if (words[0] === "the") words.shift();
  // School first (up to 4 words), the longest that's a school.
  for (let k = Math.min(4, words.length - 1); k >= 1; k -= 1) {
    const school = schools[squash(words.slice(0, k).join(" "))];
    if (school) return { school, name: words.slice(k).join(" ") };
  }
  // …or after: "kromah from / at / of / out of florida state".
  const m = words.join(" ").match(/^(.+?) (?:from|at|of|out of|with|on) (?:the )?(.+)$/);
  if (m && schools[squash(m[2])]) return { school: schools[squash(m[2])], name: m[1] };
  return null;
}

// ── Players already in the conversation (user, 2026-11-26: "if something sounds like
// the name after it is talking about that player already, it should be easier to pick
// that up") — "evangelist" right after Evan Tengesdahl, "main chroma" after Kromah. ──
const squashed = (s) => plain(s).replace(SUFFIX_ANY, "").replace(/[^a-z]/g, "");
/** How well the words could be this player, loosely: 0–1. Only for someone just talked about. */
export function looseScore(said, p) {
  const words = plain(said).split(" ").filter((w) => w && !SUFFIX.test(w));
  const s = squashed(said);
  if (!s || s.length < 3) return 0;
  const { first, last } = partsOf(p);
  let best = Math.max(nameScore(said, p), sim(s, first + last), 0.95 * sim(s, last));
  // One word that runs his name together ("evangelist" — Evan Tengesdahl; "kromahs").
  if (words.length === 1) {
    if (first.length >= 3 && s.startsWith(first)) best = Math.max(best, 0.7);
    if (last.length >= 4 && (s.includes(last) || last.includes(s))) best = Math.max(best, 0.8);
  }
  // The last name sounds right, the first is mangled ("main chroma", "going to stockton").
  const tail = words.length >= 2 ? words[words.length - 1] : "";
  if (tail && wordScore(tail, last) >= 0.85) best = Math.max(best, 0.75);
  return best;
}
/** The one recent player the words most likely mean → { player, score } | null. */
export function recentPlayer(said, recent = [], bar = 0.6) {
  const ranked = recent.filter(Boolean).map((p) => ({ p, s: looseScore(said, p) })).sort((a, b) => b.s - a.s);
  const [a, b] = ranked;
  if (!a || a.s < bar || (b && a.s - b.s < 0.05)) return null;
  return { player: a.p, score: a.s };
}

function rank(key, people, sure) {
  const ranked = people.map((p) => ({ p, s: nameScore(key, p) })).filter((x) => x.s > 0.5).sort((a, b) => b.s - a.s);
  const best = ranked[0];
  // A near miss that's clearly ahead of the rest: the voice names just him ("Did you mean Gunner Stockton?").
  if (!best || best.s < sure) return { none: true, near: ranked.slice(0, 5).map((x) => x.p), lead: best && best.s >= 0.7 && (!ranked[1] || best.s - ranked[1].s >= 0.08) };
  const close = ranked.filter((x) => best.s - x.s < RACE);
  if (close.length > 1) return { choices: close.slice(0, 6).map((x) => x.p) };
  return { player: best.p, score: best.s };
}

/**
 * The player a name means.
 * → { player, score, school? } | { choices: [player], said, school? }
 *   | { none: true, said, near: [player], school? }
 */
export function findPlayer(said, people, aliases = {}) {
  const key = plain(said);
  if (!key) return { none: true, said, near: [] };
  const taught = aliases[key] && people.find((p) => p.id === aliases[key]);
  // A name taught from a "did you mean" pick never beats someone with exactly that name
  // (2026-11-25: "Ashton Daniels" had been taught as Ashton Hampton).
  const exact = taught && people.filter((p) => p.id !== taught.id && fullKey(p) === key.replace(SUFFIX_ANY, "").replace(/\s+/g, " ").trim());
  if (taught && exact.length === 1) return { player: exact[0], score: 1 };
  if (taught) return { player: taught, score: 1, taught: true };
  // With a school: only that school's players. Nobody there by that name →
  // the whole list (a first name like "Troy" isn't a school), still noting it.
  const at = splitSchool(key, people);
  if (at && at.name) {
    const r = rank(at.name, people.filter((p) => p.school === at.school), SURE_AT_SCHOOL);
    if (!r.none) return { ...r, said, school: at.school };
    const all = rank(key, people, SURE);
    if (!all.none) return { ...all, said };
    const elsewhere = rank(at.name, people, SURE);
    const near = [...r.near, ...(elsewhere.near || elsewhere.choices || [elsewhere.player])].filter((p, i, a) => p && a.indexOf(p) === i).slice(0, 5);
    return { none: true, said, school: at.school, near, lead: !!r.lead };
  }
  return { ...rank(key, people, SURE), said };
}
