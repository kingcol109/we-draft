// src/utils/voice/stats.js
//
// /voice: stat words → ESPN numbers, and the math on them. Pure.
//
// A line is { [category]: { [statName]: number } } — a season, a career, one
// game, or games added up (sumLines). Rates (yards per carry, completion %)
// are always worked out from the counts, so "YPC vs Ohio State and LSU" is
// (yards in those games) / (carries in those games), not an average of
// averages.
import { plain } from "./text";

export const GROUP = {
  QB: "QB", RB: "RB", HB: "RB", FB: "RB", WR: "WR", TE: "TE", ATH: "WR",
  OL: "OL", OT: "OL", OG: "OL", IOL: "OL", C: "OL", G: "OL", T: "OL",
  DL: "DL", DT: "DL", NT: "DL", IDL: "DL", EDGE: "EDGE", DE: "EDGE",
  LB: "LB", ILB: "LB", MLB: "LB", OLB: "LB", DB: "DB", CB: "DB", S: "DB", FS: "DB", SS: "DB", NB: "DB",
  K: "K", P: "P",
};
export const groupOf = (pos) => GROUP[String(pos || "").toUpperCase()] || "";
const DEF = ["DL", "EDGE", "LB", "DB"];

// Every stat: words people say → how to read it.
//   sum:   [[cat, name], …] added up
//   num/den/scale/digits: a rate from counts
//   byGroup: the stat a position means by the word ("yards", "touchdowns")
const S = (label, def) => ({ label, ...def });
export const STATS = {
  rushYds: S("rushing yards", { sum: [["rushing", "rushingYards"]] }),
  carries: S("carries", { sum: [["rushing", "rushingAttempts"]] }),
  ypc: S("yards per carry", { num: [["rushing", "rushingYards"]], den: [["rushing", "rushingAttempts"]], digits: 1 }),
  rushTd: S("rushing touchdowns", { sum: [["rushing", "rushingTouchdowns"]] }),
  rec: S("catches", { sum: [["receiving", "receptions"]] }),
  recYds: S("receiving yards", { sum: [["receiving", "receivingYards"]] }),
  ypr: S("yards per catch", { num: [["receiving", "receivingYards"]], den: [["receiving", "receptions"]], digits: 1 }),
  recTd: S("receiving touchdowns", { sum: [["receiving", "receivingTouchdowns"]] }),
  scrimmage: S("yards from scrimmage", { sum: [["rushing", "rushingYards"], ["receiving", "receivingYards"]] }),
  skillTd: S("touchdowns", { sum: [["rushing", "rushingTouchdowns"], ["receiving", "receivingTouchdowns"]] }),
  passYds: S("passing yards", { sum: [["passing", "passingYards"]] }),
  passTd: S("touchdown passes", { sum: [["passing", "passingTouchdowns"]] }),
  passInt: S("interceptions thrown", { sum: [["passing", "interceptions"]] }),
  comp: S("completions", { sum: [["passing", "completions"]] }),
  att: S("pass attempts", { sum: [["passing", "passingAttempts"]] }),
  compPct: S("completion percentage", { num: [["passing", "completions"]], den: [["passing", "passingAttempts"]], scale: 100, digits: 1, unit: "%" }),
  ypa: S("yards per attempt", { num: [["passing", "passingYards"]], den: [["passing", "passingAttempts"]], digits: 1 }),
  tackles: S("tackles", { sum: [["defensive", "totalTackles"]] }),
  solo: S("solo tackles", { sum: [["defensive", "soloTackles"]] }),
  tfl: S("tackles for loss", { sum: [["defensive", "tacklesForLoss"]] }),
  sacks: S("sacks", { sum: [["defensive", "sacks"]] }),
  defInt: S("interceptions", { sum: [["defensive", "interceptions"], ["interceptions", "interceptions"]], first: true }),
  pd: S("passes defended", { sum: [["defensive", "passesDefended"]] }),
  ff: S("forced fumbles", { sum: [["defensive", "fumblesForced"]] }),
  qbHits: S("QB hits", { sum: [["defensive", "QBHits"]] }),
};
// The words, longest first when matching. A word that means different
// stats by position maps to { [group]: stat, _: default }.
const WORDS = [
  [["yards per carry", "ypc", "yards per rush", "yards a carry", "yards per attempt rushing", "rushing average"], "ypc"],
  [["yards per catch", "yards per reception", "ypr", "yards a catch"], "ypr"],
  [["yards per attempt", "ypa", "yards per pass"], "ypa"],
  [["completion percentage", "completion percent", "completion rate", "comp percentage"], "compPct"],
  [["rushing yards", "rush yards", "yards rushing", "rushing"], "rushYds"],
  [["receiving yards", "yards receiving", "receiving"], "recYds"],
  [["passing yards", "yards passing", "passing"], "passYds"],
  [["scrimmage yards", "yards from scrimmage", "all purpose yards", "total yards"], "scrimmage"],
  [["rushing touchdowns", "rushing tds", "rushing td", "touchdowns rushing"], "rushTd"],
  [["receiving touchdowns", "receiving tds", "receiving td", "touchdown catches", "td catches"], "recTd"],
  [["touchdown passes", "passing touchdowns", "passing tds", "td passes", "touchdowns passing"], "passTd"],
  [["tackles for loss", "tfls", "tfl", "tackles for a loss"], "tfl"],
  [["solo tackles"], "solo"],
  [["forced fumbles", "fumbles forced"], "ff"],
  [["passes defended", "pass breakups", "pbus", "pbu", "pass deflections", "passes broken up"], "pd"],
  [["qb hits", "quarterback hits"], "qbHits"],
  [["carries", "rushing attempts", "rushes", "attempts rushing"], "carries"],
  [["catches", "receptions"], "rec"],
  [["completions"], "comp"],
  [["pass attempts", "passing attempts", "attempts"], { QB: "att", _: "carries" }],
  [["interceptions", "picks", "ints", "int"], { QB: "passInt", _: "defInt" }],
  [["touchdowns", "tds", "td", "scores"], { QB: "passTd", WR: "recTd", TE: "recTd", RB: "skillTd", _: "skillTd" }],
  [["yards"], { QB: "passYds", WR: "recYds", TE: "recYds", RB: "rushYds", _: "scrimmage" }],
  [["tackles", "total tackles", "stops"], "tackles"],
  [["sacks"], "sacks"],
];
const WORD_LIST = WORDS.flatMap(([ws, v]) => ws.map((w) => [w, v])).sort((a, b) => b[0].length - a[0].length);
// Every stat word as one regex alternation (longest first), for the intents' patterns.
export const WORD_RE = `(?:${WORD_LIST.map(([w]) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`;

/** The stat a phrase names for this position → key | null. Whole phrase only. */
export function statKey(phrase, pos) {
  const t = plain(phrase).replace(/^(?:the |his |total |many |much )+/, "").trim();
  const hit = WORD_LIST.find(([w]) => w === t);
  if (!hit) return null;
  const v = hit[1];
  return typeof v === "string" ? v : v[groupOf(pos)] || v._;
}

// Each position's line when you just ask for "stats".
const LINE = {
  QB: ["compPct", "passYds", "passTd", "passInt", "ypa", "rushYds"],
  RB: ["carries", "rushYds", "ypc", "rushTd", "rec", "recYds"],
  WR: ["rec", "recYds", "ypr", "recTd"],
  TE: ["rec", "recYds", "ypr", "recTd"],
  _: ["tackles", "tfl", "sacks", "defInt", "pd", "ff"],
};
export const lineKeys = (pos) => LINE[groupOf(pos)] || (DEF.includes(groupOf(pos)) ? LINE._ : [...LINE.RB, ...LINE.WR, ...LINE._]);

const pick = (line, [cat, name]) => (line?.[cat]?.[name] ?? null);
const total = (line, parts, first) => {
  let any = false;
  let n = 0;
  for (const p of parts) { const v = pick(line, p); if (v != null) { any = true; n += v; if (first) break; } }
  return any ? n : null;
};

// The stats that go with one on screen (user, 2026-11-25: say the one asked,
// show the whole line it belongs to).
const FAMILY = {
  rushing: ["carries", "rushYds", "ypc", "rushTd"],
  receiving: ["rec", "recYds", "ypr", "recTd"],
  passing: ["comp", "att", "compPct", "passYds", "ypa", "passTd", "passInt"],
  defense: ["tackles", "solo", "tfl", "sacks", "defInt", "pd", "ff", "qbHits"],
};
/** The line a stat belongs to: "rushYds" → carries, rushing yards, yards per carry, rushing touchdowns. */
export function relatedKeys(key) {
  if (key === "scrimmage" || key === "skillTd") return [...FAMILY.rushing, ...FAMILY.receiving, key];
  return Object.values(FAMILY).find((l) => l.includes(key)) || [key];
}
/** [[label, value]] for the stats in a line that he has (none made up, no zeros for missing ones). */
export const lineRows = (line, keys) => keys.filter((k) => statValue(line, k) != null).map((k) => [STATS[k].label, statText(k, statValue(line, k))]);
/** A position's headline stat ("his best season" with no stat said). */
export const mainStat = (pos) => ({ QB: "passYds", RB: "rushYds", WR: "recYds", TE: "recYds" }[groupOf(pos)] || "tackles");
/** A rate's attempts in a line (carries behind yards per carry) → number | null; null for counts. */
export const rateBase = (line, key) => (STATS[key]?.den ? total(line, STATS[key].den) : null);

/** A stat's value in a line → number | null (null: he has no such numbers). */
export function statValue(line, key) {
  const s = STATS[key];
  if (!s) return null;
  if (s.sum) return total(line, s.sum, s.first);
  const n = total(line, s.num);
  const d = total(line, s.den);
  if (n == null || !d) return null;
  return (n / d) * (s.scale || 1);
}
export function statText(key, v) {
  const s = STATS[key];
  if (v == null) return "—";
  // Counts get their thousands comma ("1,100"); rates keep their decimal ("6.3").
  const r = s.digits != null ? Number(v).toFixed(s.digits) : (Math.round(v * 10) / 10).toLocaleString("en-US");
  return `${r}${s.unit || ""}`;
}
// "1 rushing touchdown", "1 carry", "1 tackle for loss", "1 pass defended".
const one = (w) => (/ies$/.test(w) ? w.replace(/ies$/, "y") : /(ch|ss|sh|x)es$/.test(w) ? w.replace(/es$/, "") : w.replace(/s$/, ""));
const singular = (label) => label.replace(/(\w+)(?=( for | from | thrown| defended|$))/, one);
export const statSay = (key, v) => `${statText(key, v)} ${v === 1 && !STATS[key].num ? singular(STATS[key].label) : STATS[key].label}`;

/** Games added up into one line. */
export function sumLines(lines) {
  const out = {};
  lines.forEach((line) => Object.entries(line || {}).forEach(([cat, stats]) => Object.entries(stats).forEach(([name, v]) => {
    if (v == null) return;
    (out[cat] ||= {})[name] = (out[cat][name] || 0) + v;
  })));
  return out;
}

/** A season said → which seasons: "2025", "this season", "last year", "career" → [years] | "career" | null (default). */
export function seasonsSaid(phrase, years, today = new Date()) {
  const t = plain(phrase);
  if (!t) return null;
  if (/\b(career|all time|overall|total|in college)\b/.test(t)) return "career";
  const current = String(today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1);
  const ys = [];
  const m = t.match(/\b(20\d\d)\b/g);
  if (m) ys.push(...m);
  if (/\b(this|current) (season|year)\b/.test(t)) ys.push(current);
  if (/\blast (season|year)\b/.test(t)) ys.push(String(Number(current) - 1));
  return ys.length ? [...new Set(ys)].filter((y) => !years || years.includes(y)) : null;
}

/** A season in a sentence, by position — every way it can be said, the plain one first ([] when there's nothing). */
export function seasonSentences(pos, line, year) {
  if (!line) return [];
  const v = (k) => statValue(line, k);
  const n = (x) => Math.round(x).toLocaleString("en-US");
  const tds = (x) => `${n(x)} touchdown${Math.round(x) === 1 ? "" : "s"}`;
  const ints = (x) => `${n(x)} interception${Math.round(x) === 1 ? "" : "s"}`;
  const g = groupOf(pos);
  if (g === "QB" && v("passYds") != null && v("passTd") != null && v("passInt") != null) {
    const run = v("rushYds") >= 200 ? `, and ran for ${n(v("rushYds"))} more` : "";
    const [y, t, i] = [n(v("passYds")), tds(v("passTd") || 0), ints(v("passInt") || 0)];
    return [
      `He threw for ${y} yards, ${t} and ${i} in ${year}${run}.`,
      `In ${year}, he threw for ${y} yards with ${t} and ${i}${run}.`,
      `${year}: ${y} passing yards, ${t}, ${i}.`,
    ];
  }
  if (g === "RB" && v("rushYds") != null && v("rushTd") != null && v("carries") != null) {
    const rec = v("rec") >= 10 && v("recYds") != null ? `, plus ${n(v("rec"))} catches for ${n(v("recYds") || 0)} yards` : "";
    const [y, t, c] = [n(v("rushYds")), tds(v("rushTd") || 0), n(v("carries") || 0)];
    return [
      `He ran for ${y} yards and ${t} on ${c} carries in ${year}${rec}.`,
      `In ${year}, he ran for ${y} yards and ${t}${rec}.`,
      `He carried it ${c} times for ${y} yards and ${t} in ${year}${rec}.`,
    ];
  }
  if ((g === "WR" || g === "TE") && v("rec") != null && v("recYds") != null && v("recTd") != null) {
    const [r, y, t] = [n(v("rec")), n(v("recYds") || 0), tds(v("recTd") || 0)];
    return [
      `He caught ${r} passes for ${y} yards and ${t} in ${year}.`,
      `In ${year}, he caught ${r} passes for ${y} yards and ${t}.`,
      `He had ${r} catches for ${y} yards and ${t} in ${year}.`,
    ];
  }
  if (v("tackles") != null) {
    const extra = [v("tfl") && `${n(v("tfl"))} for loss`, v("sacks") && `${v("sacks")} sack${v("sacks") === 1 ? "" : "s"}`, v("defInt") && ints(v("defInt")), v("pd") && `${n(v("pd"))} passes defended`].filter(Boolean);
    const rest = extra.length ? `, ${extra.length > 1 ? `${extra.slice(0, -1).join(", ")} and ${extra[extra.length - 1]}` : extra[0]}` : "";
    return [
      `He had ${n(v("tackles"))} tackles${rest} in ${year}.`,
      `In ${year}, he had ${n(v("tackles"))} tackles${rest}.`,
      `${year}: ${n(v("tackles"))} tackles${rest}.`,
    ];
  }
  if (v("rushYds") != null) return [`He ran for ${n(v("rushYds"))} yards in ${year}.`];
  if (v("recYds") != null) return [`He had ${n(v("recYds"))} receiving yards in ${year}.`];
  return [];
}
/**
 * A season's numbers as said, for the phrasebook's "season.<group>" wordings:
 * { group: "QB" | "RB" | "REC" | "DEF", year, rushYds: "1,034", rushTd: "9 touchdowns", … }.
 * plus: ", plus 11 catches for 97 yards" (inside the plain wordings); also:
 * the same as its own sentence, for wordings that end with the year. null
 * when the position's main numbers aren't there.
 */
export function seasonVars(pos, line, year) {
  if (!line) return null;
  const v = (k) => statValue(line, k);
  const n = (x) => Math.round(x).toLocaleString("en-US");
  const tds = (x) => `${n(x)} touchdown${Math.round(x) === 1 ? "" : "s"}`;
  const ints = (x) => `${n(x)} interception${Math.round(x) === 1 ? "" : "s"}`;
  const g = groupOf(pos);
  const base = { year: String(year), plus: "", also: "" };
  if (g === "QB" && v("passYds") != null && v("passTd") != null && v("passInt") != null) {
    const ran = v("rushYds") >= 200;
    return { ...base, group: "QB", passYds: n(v("passYds")), passTd: tds(v("passTd") || 0), ints: ints(v("passInt") || 0), plus: ran ? `, and ran for ${n(v("rushYds"))} more` : "", also: ran ? `He also ran for ${n(v("rushYds"))} yards.` : "" };
  }
  if (g === "RB" && v("rushYds") != null && v("rushTd") != null && v("carries") != null) {
    const caught = v("rec") >= 10 && v("recYds") != null;
    return { ...base, group: "RB", rushYds: n(v("rushYds")), rushTd: tds(v("rushTd") || 0), carries: n(v("carries") || 0), plus: caught ? `, plus ${n(v("rec"))} catches for ${n(v("recYds") || 0)} yards` : "", also: caught ? `He also caught ${n(v("rec"))} passes for ${n(v("recYds") || 0)} yards.` : "" };
  }
  if ((g === "WR" || g === "TE") && v("rec") != null && v("recYds") != null && v("recTd") != null) return { ...base, group: "REC", rec: n(v("rec")), recYds: n(v("recYds") || 0), recTd: tds(v("recTd") || 0) };
  if (v("tackles") != null) {
    const extra = [v("tfl") && `${n(v("tfl"))} for loss`, v("sacks") && `${v("sacks")} sack${v("sacks") === 1 ? "" : "s"}`, v("defInt") && ints(v("defInt")), v("pd") && `${n(v("pd"))} passes defended`].filter(Boolean);
    const rest = extra.length ? `, ${extra.length > 1 ? `${extra.slice(0, -1).join(", ")} and ${extra[extra.length - 1]}` : extra[0]}` : "";
    return { ...base, group: "DEF", line: `${n(v("tackles"))} tackles${rest}` };
  }
  return null;
}

/** The plain one. */
export const seasonSentence =(pos, line, year) => seasonSentences(pos, line, year)[0] || "";

// ── Opponents ──
const squash = (s) => plain(s).replace(/ /g, "");
const OPP_ALIAS = { fsu: "floridastate", osu: "ohiostate", psu: "pennstate", usc: "usctrojans", lsu: "lsutigers", bama: "alabama", unc: "northcarolina", pitt: "pittsburgh", olemiss: "olemiss", tamu: "texasam", am: "texasam", texasam: "texasam", uga: "georgia", cal: "california", vt: "virginiatech", gt: "georgiatech" };
/** "ohio state and lsu" → [phrase] */
export const opponentPhrases = (said) => plain(said).split(/ (?:and|or|plus|n) | , |,/).map((x) => x.replace(/^(?:the )/, "").trim()).filter(Boolean);
/** The games against an opponent phrase (full name, school, nickname, abbreviation). */
export function gamesVs(phrase, games) {
  const q = squash(phrase);
  const want = OPP_ALIAS[q] || q;
  const byAbbr = games.filter((g) => squash(g.oppAbbr) === q);
  if (byAbbr.length) return byAbbr;
  // School name starts the team name ("ohiostate" → "Ohio State Buckeyes"); the
  // shortest such team wins ("ohio" → Ohio Bobcats, not Ohio State).
  const starts = games.filter((g) => squash(g.opp).startsWith(want));
  if (starts.length) {
    const len = Math.min(...starts.map((g) => squash(g.opp).length));
    return starts.filter((g) => squash(g.opp).length === len);
  }
  // The mascot ("buckeyes").
  return games.filter((g) => want.length >= 4 && squash(g.opp).endsWith(want));
}

// ── Best games ──
// How big a game was for his position (yards and scores, weighted).
const WEIGHT = {
  QB: { passYds: 0.04, passTd: 4, passInt: -3, rushYds: 0.1, rushTd: 6 },
  RB: { rushYds: 0.1, rushTd: 6, recYds: 0.1, recTd: 6 },
  WR: { recYds: 0.1, recTd: 6, rec: 0.5, rushYds: 0.1 },
  TE: { recYds: 0.1, recTd: 6, rec: 0.5 },
  _: { tackles: 1, tfl: 2, sacks: 4, defInt: 6, pd: 2, ff: 4 },
};
export function gameScore(game, pos) {
  const w = WEIGHT[groupOf(pos)] || WEIGHT._;
  return Object.entries(w).reduce((sum, [k, x]) => sum + (statValue(game.line, k) || 0) * x, 0);
}
// Who it was against counts for scouting: a ranked opponent (AP, at the
// time) is worth more, and one with no draft prospects on our board (most
// FCS teams) less. known: the board's schools (people's schools).
export function opponentWeight(g, known) {
  if (g.oppRank) return g.oppRank <= 10 ? 1.6 : 1.35;
  if (known && known.size && ![...known].some((k) => squash(g.opp).startsWith(squash(k)))) return 0.7;
  return 1;
}
/** His best games to watch: [{ game, score }], best first. */
export const bestGames = (games, pos, n = 5, known = null) => games.map((g) => ({ game: g, score: gameScore(g, pos) * opponentWeight(g, known) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, n);
/** A game's line in a few words: "21 carries, 148 rushing yards, 2 touchdowns". */
export function gameSummary(line, pos) {
  return lineKeys(pos).map((k) => [k, statValue(line, k)]).filter(([k, v]) => v != null && v !== 0 && !STATS[k].num).slice(0, 3).map(([k, v]) => statSay(k, v)).join(", ");
}
// When: the date (ESPN's week numbers aren't reliable), "Sep 19, 2026".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const gameWhen = (g) => {
  const d = g.date ? new Date(g.date) : null;
  const when = d && !Number.isNaN(d.getTime()) ? `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : g.season;
  return `${when}${g.post ? " (postseason)" : ""}`;
};
export const gameTitle = (g) => `${g.at === "@" ? "at" : "vs"} ${g.oppRank ? `#${g.oppRank} ` : ""}${g.opp || g.oppAbbr}`;
export const gameResult = (g) => [g.result, g.score].filter(Boolean).join(" ");
