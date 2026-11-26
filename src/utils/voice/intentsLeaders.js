// src/utils/voice/intentsLeaders.js
//
// /voice, from the 2026-11-25 iPad log (questions it couldn't answer):
//   - stat leaders: "who leads Tennessee in receiving yards" (the school's
//     CFBD roster, cfbRosters/{teamId} — its season stats), "who leads
//     college football in rushing yards" / "the country's leading passer"
//     (cfbLeaders/current — /cfb/stats' national top 50s).
//   - jersey numbers: "who is number 32 on Florida State" (the roster's `no`).
//   - a game, broken down: "give me a breakdown of the Houston West Virginia
//     game" — the score and the leaders on both sides, told like a recap
//     (liveSlate this week / past weeks, liveGames/{id}/box/live).
//   - "his name is pronounced Keyshawn" / "pronounced Camari": saved right
//     away for the player just talked about (voicePronunciations).
// Out loud, every answer talks like a person (reply.speak); the screen gets
// the rows.
import { miss, list, WHO } from "./reply";
import { plain } from "./text";
import { findPlayer, schoolSaid, lev } from "./names";
import { STAT_RE, ROLE_RE, N_RE, ORD_RE, POS_RE, SEASON_TAIL, leadKey, mainLead, scopeOf, posOf, nWord, ordOf, leaders, rankOf, cutOf } from "./leaderBoard";
import { schoolRows } from "./requests";
import { phrase } from "./phrase";
import { gameDid } from "./spoken";
import { gameLeaders } from "../liveStats.mjs";
import { teamKey } from "../film/schedule";

const AMONG = `(?: among (?:all )?${POS_RE})?`;


// A player row on the roster → who he is on the site: the board's row when he's there, else his CFBD one.
async function personFor(row, school, teamId, ctx) {
  const people = await ctx.people().catch(() => []);
  const key = plain(`${row.first} ${row.last}`);
  const onBoard = people.find((p) => p.school === school && plain(`${p.first} ${p.last}`) === key);
  if (onBoard) return onBoard;
  return { id: `cfbd_${row.id}`, first: row.first, last: row.last, pos: row.pos, school, cls: null, cfbd: String(row.id), teamId, cfbdOnly: true };
}

// ── Jersey numbers ──
const POS_WORD = { QB: "quarterback", RB: "running back", FB: "fullback", WR: "wide receiver", TE: "tight end", OL: "offensive lineman", OT: "offensive tackle", OG: "guard", G: "guard", C: "center", DL: "defensive lineman", DE: "defensive end", DT: "defensive tackle", NT: "nose tackle", EDGE: "edge rusher", LB: "linebacker", CB: "cornerback", S: "safety", DB: "defensive back", PK: "kicker", K: "kicker", P: "punter", LS: "long snapper", ATH: "athlete" };
const YEAR_WORD = { 1: "freshman", 2: "sophomore", 3: "junior", 4: "senior", 5: "fifth-year senior" };
// A jersey number said as words ("zero", "one", "twenty one"; speech hears "nine" as "non" / "nein") → 0–99 | null.
const JERSEY_ONES = { zero: 0, oh: 0, o: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, non: 9, nein: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const JERSEY_TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
export function jerseyWord(s) {
  const w = String(s || "").trim().toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (w.length === 1) return JERSEY_ONES[w[0]] ?? JERSEY_TENS[w[0]] ?? null;
  if (w.length === 2 && JERSEY_TENS[w[0]] != null && JERSEY_ONES[w[1]] != null && JERSEY_ONES[w[1]] > 0 && JERSEY_ONES[w[1]] < 10) return JERSEY_TENS[w[0]] + JERSEY_ONES[w[1]];
  return null;
}
const OFF_POS = new Set(["QB", "RB", "FB", "WR", "TE", "OL", "OT", "OG", "G", "C", "IOL", "ATH"]);
const DEF_POS = new Set(["DL", "DE", "DT", "NT", "EDGE", "LB", "ILB", "OLB", "CB", "S", "DB", "SAF"]);
// "running back" → the roster codes it covers.
const POS_FROM_WORD = (w) => {
  const t = String(w || "").trim().replace(/s$/, "");
  const hit = Object.entries(POS_WORD).filter(([, v]) => v === t).map(([k]) => k);
  if (/^(?:receiver|wideout)$/.test(t)) hit.push("WR");
  if (/^(?:lineman|offensive lineman)$/.test(t)) hit.push("OL", "OT", "OG", "G", "C");
  if (/^(?:corner)$/.test(t)) hit.push("CB");
  if (/^(?:defensive back)$/.test(t)) hit.push("CB", "S", "DB");
  if (/^(?:safety)$/.test(t)) hit.push("DB");
  if (/^(?:edge)$/.test(t)) hit.push("EDGE", "DE");
  return hit.length ? new Set(hit) : null;
};
const whoRow = (r) => {
  const pos = POS_WORD[String(r.pos || "").toUpperCase()] || "";
  const yr = r.yr > 1000 ? "freshman" : YEAR_WORD[r.yr] || "";
  return pos ? `${/^[aeiou]/.test(yr || pos) ? "an" : "a"} ${[yr, pos].filter(Boolean).join(" ")}` : "";
};

// ── Games: find one by its two teams, this week or the weeks before ──
async function findGame(teams, ctx) {
  const slate = await ctx.liveSlate().catch(() => null);
  const keys = teams.map(teamKey);
  const fits = (g) => keys.every((k) => [g.home, g.away].some((t) => teamKey(t?.school || t?.name || "") === k));
  const pick = (games) => (games || []).filter(fits).filter((g) => g.status !== "scheduled").sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))[0] || null;
  let g = pick(slate?.games);
  for (let w = (slate?.week || 1) - 1; !g && w >= 1 && w >= (slate?.week || 1) - 6 && ctx.liveWeek; w -= 1) {
    const week = await ctx.liveWeek(slate.season, slate.seasonType, w).catch(() => null);
    g = pick(week?.games);
  }
  return g;
}
const tName = (t) => t?.school || t?.name || "";
// "the houston west virginia game" → ["Houston", "West Virginia"] (either one alone works too).
function twoSchools(said, schools) {
  const words = plain(said).replace(/^the /, "").replace(/ game$/, "").split(" ").filter((w) => w && !["vs", "versus", "and", "against", "at", "v"].includes(w));
  const one = schoolSaid(words.join(" "), schools);
  if (one) return [one];
  for (let i = 1; i < words.length; i += 1) {
    const a = schoolSaid(words.slice(0, i).join(" "), schools);
    const b = a && schoolSaid(words.slice(i).join(" "), schools);
    if (a && b) return [a, b];
  }
  return null;
}

// ── "pronounced …": which part of his name the new sound is for ──
const closer = (said, a, b) => lev(plain(said), plain(a)) / Math.max(1, plain(a).length) <= lev(plain(said), plain(b)) / Math.max(1, plain(b).length);

export const LEADER_INTENTS = [
  {
    id: "voice.pronounced",
    mode: "general",
    title: "Say how a name is pronounced",
    examples: ["his name is pronounced Keyshawn", "pronounced Camari", "Kromah is pronounced kroh-mah"],
    patterns: [
      /^(?:his|her|their|the)? ?(?:(?<part>first|last|full) )?name(?: is|'s|s)? (?:pronounced|said|sounds like) (?<say>.+)$/,
      /^(?:it's|its|it is|that's|thats|that is|you) (?:pronounced|said|say it|pronounce it|should say) (?<say>.+)$/,
      /^(?:it's |its |it is )?pronounced (?<say>.+)$/,
      /^(?<who>.+?)(?:'s|s)? (?:(?<part>first|last|full) )?(?:name )?is pronounced (?<say>.+)$/,
    ],
    run: async ({ say, part, who }, ctx, text, state) => {
      let player = null;
      if (who && !/^(?:his|her|their|the|it|that)$/.test(plain(who))) {
        const f = findPlayer(who, await ctx.people(), state?.aliases || {});
        player = f.player || null;
        if (!player) return miss(`Who's "${who}"? Ask about him first, then tell me how it's said.`);
      } else player = state?.last || null;
      if (!player) return miss(`Whose name? Ask about the player first, then say "his name is pronounced …".`);
      if (!ctx.savePronunciation) return miss("I can't save pronunciations here.");
      const first = player.first || player.First || "";
      const last = player.last || player.Last || "";
      // The words as said / typed (hyphens and capitals kept), not the cleaned slot.
      const raw = String(text || "").split(/\b(?:pronounced|said|sounds like|say it|pronounce it|should say)\b/i).pop().trim();
      const sound = String(raw || say).replace(/^(?:like )/i, "").replace(/["“”.!]+/g, "").trim();
      const words = sound.split(/\s+/).filter(Boolean);
      const lastWords = last.split(/\s+/).filter((w) => !/^(?:jr|sr|ii|iii|iv|v)\.?$/i.test(w));
      // What to save: one word → the first or last name it sounds closest to; two words for a
      // two-part name → each part on its own (so "Kromah" alone is said right too); else the whole name.
      let saves;
      if (part === "first") saves = [[first, sound]];
      else if (part === "last") saves = [[last, sound]];
      else if (words.length === 1) saves = [[closer(sound, first, lastWords.join(" ")) ? first : lastWords.join(" "), sound]];
      else if (words.length === 2 && lastWords.length === 1) saves = [[first, words[0]], [lastWords[0], words[1]]];
      else saves = [[`${first} ${last}`.trim(), sound]];
      try {
        for (const [word, s] of saves) if (word && s) await ctx.savePronunciation({ word, say: s, playerId: player.id || null });
      } catch (e) { return miss(`That didn't save: ${e.message}`); }
      const full = `${first} ${last}`.trim();
      return {
        say: `Saved. ${saves.map(([w, s]) => `${w} → "${s}"`).join(", ")}.`,
        speak: phrase(ctx, "ack.pronounced", { name: full }),
        title: `Pronounce: ${full}`, rows: saves.map(([w, s]) => [w, s]),
        tone: "done", noRecord: true,
      };
    },
  },
  {
    id: "team.jersey",
    mode: "general",
    title: "Who wears a number",
    examples: ["who is number 32 on Florida State", "who wears 7 for LSU"],
    patterns: [
      // "who is the running back number 21 on Houston", "who's the wide receiver number zero in Cincinnati"
      /^who(?:'s|s| is| wears| has| was) (?:wearing )?(?:the )?(?:(?<pos>running back|wide receiver|receiver|quarterback|tight end|cornerback|corner|safety|linebacker|edge rusher|edge|defensive end|defensive tackle|defensive back|defensive lineman|offensive lineman|offensive tackle|lineman|kicker|punter|center|guard|fullback|athlete) )?(?:number|no|#|jersey number|jersey) ?(?<no>\d+|[a-z]+(?: [a-z]+)?) (?:on|for|at|with|in) (?:the )?(?<team>.+?)(?: this year| this season| now)?$/,
      /^who wears (?<no>\d+) (?:on|for|at) (?:the )?(?<team>.+)$/,
      /^(?:number|no|#) ?(?<no>\d+|[a-z]+(?: [a-z]+)?) (?:on|for|at) (?:the )?(?<team>.+?)(?: who(?:'s|s| is) (?:he|that|it|this))?$/,
      /^who(?:'s|s| is) (?:the )?(?<team>.+?)(?:'s|s)? (?:number|no|#) ?(?<no>\d+)$/,
    ],
    // A number, said as digits or words — not "number one on my board / We-Draft / in the class" (the boards).
    accept: (s) => (/^\d+$/.test(s.no || "") || jerseyWord(s.no) != null) && !/\b(?:board|we draft|class|country|nation|nfl|draft|ranking|rankings)\b/.test(s.team || "")
      && (!s.pos || !!POS_FROM_WORD(s.pos))
      // "number one at quarterback / in rushing yards" is a ranking, not a jersey.
      && !POS_FROM_WORD(s.team) && !/\b(?:rushing|passing|receiving|yards|sacks|tackles|touchdowns|interceptions|position|overall|quarterbacks?|receivers?|backs?|linemen|rushers?)\b/.test(s.team || ""),
    run: async ({ no, team, pos }, ctx) => {
      // "West Virginia's defense" → West Virginia, defense only.
      const side = (String(team).match(/\b(offense|defense|offensive|defensive)$/) || [])[1] || null;
      const teamName = String(team).replace(/(?:'s|s')?\s+(?:offense|defense|offensive|defensive)(?: side)?$/, "");
      const school = schoolSaid(teamName, await schoolRows(ctx));
      if (!school) return miss(`I don't know the school "${teamName}".`, "jersey-no-school");
      const k = /^\d+$/.test(no) ? Number(no) : jerseyWord(no);
      const roster = ctx.cfbdRoster ? await ctx.cfbdRoster(school).catch(() => null) : null;
      if (!roster?.players?.length) return miss(`I don't have ${school}'s roster.`, "jersey-no-roster");
      const want = pos ? POS_FROM_WORD(pos) : null;
      const sideOk = (p) => !side || (/^(?:off)/.test(side) ? OFF_POS : DEF_POS).has(String(p.pos || "").toUpperCase());
      const all = roster.players.filter((p) => Number(p.no) === k);
      const narrowed = all.filter((p) => sideOk(p) && (!want || want.has(String(p.pos || "").toUpperCase())));
      const hits = narrowed.length ? narrowed : all;
      if (!hits.length) return { say: `Nobody on ${school}'s roster wears number ${k}.`, tone: "answer", gap: "jersey-none" };
      const people = await Promise.all(hits.map((p) => personFor(p, school, roster.teamId, ctx)));
      const said = hits.map((p) => `${p.first} ${p.last}${whoRow(p) ? `, ${whoRow(p)}` : ""}`);
      const speak = hits.length === 1 ? `Number ${k} for ${school} is ${said[0]}.` : `${hits.length} players wear ${k} for ${school}: ${list(said)}.`;
      return {
        say: speak, speak,
        title: `${school} · #${k}`, rows: hits.map((p) => [`${p.first} ${p.last}`, [p.pos, p.yr > 1000 ? "FR" : YEAR_WORD[p.yr]].filter(Boolean).join(" · ")]),
        people: people.map((p, i) => ({ ...p, note: `#${k} · ${hits[i].pos || ""}` })),
        ...(hits.length === 1 ? { focus: people[0] } : { group: people }),
        tone: "answer",
      };
    },
  },
  {
    id: "player.jersey",
    mode: "general",
    title: "A player's jersey number",
    examples: ["what number does Kromah wear", "what's Kromah's jersey number"],
    patterns: [
      /^what (?:number|jersey number|jersey|number jersey) (?:does|did) (?<who>.+?) (?:wear|have|rock)$/,
      /^what number is (?<who>.+?)(?: wearing)?$/,
      new RegExp(`^what(?:'s| is|s) ${WHO} (?:jersey |uniform )?number$`),
    ],
    accept: (s) => !/\b(?:rank|ranked|board|class|draft|pick|in the)\b/.test(s.who || ""),
    run: async ({ player }, ctx) => {
      const d = (await ctx.player(player.id)) || null;
      const school = d?.School || player.school;
      const roster = school && ctx.cfbdRoster ? await ctx.cfbdRoster(school).catch(() => null) : null;
      const name = `${d?.First || player.first} ${d?.Last || player.last}`.trim();
      const row = roster?.players?.find((r) => (d?.cfbd || player.cfbd) && String(r.id) === String(d?.cfbd || player.cfbd))
        || roster?.players?.find((r) => plain(`${r.first} ${r.last}`) === plain(name));
      if (!row || row.no == null) return miss(`I don't have ${name}'s number.`, "jersey-unknown");
      const speak = `${name} wears number ${row.no} for ${school}.`;
      return { say: speak, speak, title: name, sub: `#${row.no} · ${school}`, tone: "answer" };
    },
  },
  {
    id: "game.breakdown",
    mode: "general",
    title: "A game, broken down",
    examples: ["give me a breakdown of the Houston West Virginia game", "recap the Florida State game", "how did the LSU Alabama game go", "how did Tennessee do last week", "recap Houston's last game"],
    patterns: [
      /^(?:give me |can i get |can you give me |i want |let's get |read me |tell me )?(?:a |the )?(?:quick |full )?(?:breakdown|recap|rundown|summary|story) (?:of|for|on) (?:the )?(?<teams>.+?)(?:'s|s)?(?: last)?(?: game)?(?: last week| this week| on saturday| saturday| last night| yesterday)?$/,
      /^(?:break down|recap|summarize|run down|walk me through|tell me about) (?:the )?(?<teams>.+?)(?:'s|s)?(?: last)? game(?: last week| this week| on saturday| last night| yesterday)?$/,
      /^how did (?:the )?(?<teams>.+?)(?:'s|s)?(?: last)? game go$/,
      /^what happened (?:in|with|during) (?:the )?(?<teams>.+?)(?:'s|s)?(?: last)? game(?: last week| on saturday)?$/,
      /^how did (?:the )?(?<teams>.+?) (?:do|play|look|fare|perform)(?: (?:last week|on saturday|saturday|last time out|last game|in (?:his|their|its|the) last game|yesterday|last night|this weekend|this past weekend|over the weekend))$/,
      /^who won (?:the )?(?<teams>(?!the )\S+ .+?) game$/,
    ],
    run: async ({ teams }, ctx) => {
      const schools = await schoolRows(ctx);
      const two = twoSchools(teams, schools);
      if (!two) {
        // "how did Kromah play last week": a player — his team's last game, his line.
        const p = findPlayer(teams, await ctx.people().catch(() => []));
        if (p.player) return playerGame(p.player, ctx);
        return miss(`I don't know the game "${teams}".`, "breakdown-no-team");
      }
      const g = await findGame(two, ctx);
      if (!g) return { say: `I don't see a recent ${two.join(" and ")} game.`, tone: "answer", gap: "breakdown-no-game" };
      return breakdown(g, ctx);
    },
  },
  {
    id: "leaders.rank",
    mode: "general",
    title: "Where a player ranks in a stat",
    examples: ["where does Kromah rank in rushing yards", "is Kromah top 10 in rushing yards", "where does Kromah rank nationally", "where does Kromah rank on his team in rushing yards"],
    patterns: [
      new RegExp(`^where (?:does|do|did) (?<who>.+?) rank (?:in|for) ${STAT_RE}(?: (?<scope>nationally|in the country|in the nation|in college football|in fbs|on (?:his|the) team|at (?:his )?school))?${SEASON_TAIL}$`),
      new RegExp(`^where (?:does|do|did) (?<who>.+?) rank (?<scope>nationally|in the country|in the nation|in college football|in fbs|on (?:his|the) team)(?: in ${STAT_RE})?${SEASON_TAIL}$`),
      new RegExp(`^(?:what is|what's|whats) ${WHO} (?:national |nationwide )?(?:rank|ranking|place) in ${STAT_RE}(?: (?<scope>nationally|in the country|in the nation|on (?:his|the) team))?$`),
      new RegExp(`^(?:is|was) (?<who>.+?) (?:in the )?top ${N_RE} (?:nationally |in the country )?(?:in|for) ${STAT_RE}(?: nationally| in the country| in the nation| in college football| in fbs)?$`),
      new RegExp(`^how (?:does|do) (?<who>.+?) (?:rank|stack up) (?:nationally |in the country )?in ${STAT_RE}(?: nationally| in the country)?$`),
      new RegExp(`^(?:is|was) (?<who>.+?) (?:the )?(?:leader|leading) in ${STAT_RE}(?: (?<scope>nationally|in the country|in the nation|on (?:his|the) team))?$`),
    ],
    accept: (s) => !s.stat || leadKey(s) != null,
    run: async ({ player, stat, scope, n: top }, ctx) => {
      const k = stat ? leadKey({ stat }) : mainLead(player.pos || player.Position);
      const sc = plain(scope || "");
      const want = /team|school/.test(sc) ? "team" : sc ? "nation" : "both";
      return rankOf(player, k, ctx, { want, top: nWord(top) });
    },
  },
  {
    id: "leaders.stat",
    mode: "general",
    title: "Stat leaders (a team, a conference, the country)",
    examples: ["who leads Tennessee in receiving yards", "who leads college football in rushing yards", "who's the country's leading passer", "top 5 in sacks in the country", "who leads the SEC in sacks", "which quarterback leads the country in rushing yards", "who's second in the country in passing yards"],
    patterns: [
      new RegExp(`^who(?:'s|s| is)? (?:leads|led|is leading|leading|tops|is first) (?:the )?(?<team>.+?) in ${STAT_RE}${AMONG}${SEASON_TAIL}$`),
      new RegExp(`^who (?:has|had|have|owns|got) the most ${STAT_RE}(?: (?:for|at|on|in|of) (?:the )?(?<team>.+?))?${AMONG}${SEASON_TAIL}$`),
      new RegExp(`^who(?:'s|s| is| are) (?:the )?(?<team>.+?)(?:'s|s'|s)? (?:leading|top|best|number one|no 1) ${ROLE_RE}${SEASON_TAIL}$`),
      new RegExp(`^who(?:'s|s| is| are) (?:the )?(?:leading|top|best|number one) ${ROLE_RE}(?: (?:for|at|on|in) (?:the )?(?<team>.+?))?${SEASON_TAIL}$`),
      new RegExp(`^(?:who are |what are |give me |show me |read me )?(?:the )?(?<team>.+?) leaders in ${STAT_RE}$`),
      new RegExp(`^(?:who are |what are |give me |show me |read me )?(?:the )?top ${N_RE} (?:players |guys )?(?:in|for) ${STAT_RE}(?: (?:in|for|at|on) (?:the )?(?<team>.+?))?${AMONG}${SEASON_TAIL}$`),
      new RegExp(`^(?:who are |what are |give me |show me |read me )?(?:the )?top ${N_RE} ${POS_RE} (?:in|by|for) ${STAT_RE}(?: (?:in|for|at|on) (?:the )?(?<team>.+?))?${SEASON_TAIL}$`),
      new RegExp(`^(?:what are |give me |show me |read me )?(?:the )?(?:national |nation's |country's )?${STAT_RE} leaders(?: (?:in|for|at) (?:the )?(?<team>.+?))?$`),
      new RegExp(`^(?:which|what) ${POS_RE} (?:leads|led|is leading|tops) (?:the )?(?<team>.+?) in ${STAT_RE}${SEASON_TAIL}$`),
      new RegExp(`^(?:which|what|who(?:'s|s| is)? the) ${POS_RE} (?:has|had|with) the most ${STAT_RE}(?: (?:in|for|at|on) (?:the )?(?<team>.+?))?${SEASON_TAIL}$`),
      new RegExp(`^who(?:'s|s| is) ${ORD_RE} (?:(?:on|in|at|for) (?:the )?(?<team2>.+?) )?in ${STAT_RE}(?: (?:in|on|at|for) (?:the )?(?<team>.+?))?${AMONG}${SEASON_TAIL}$`),
      new RegExp(`^who(?:'s|s| is) (?:the )?(?<team>.+?)(?:'s|s)? (?:leader|leading man) in ${STAT_RE}$`),
    ],
    accept: (s) => leadKey(s) != null && !/^(?:my|his|her|their|we draft|the board|board)\b/.test(s.team || s.team2 || ""),
    run: async (s, ctx) => {
      const k = leadKey(s);
      // "all true freshmen", "sophomores in the SEC", "the 2027 class": a class cut, then the scope.
      const { cut, rest } = cutOf(s.team || s.team2 || "");
      const said = rest || "";
      const scope = await scopeOf(said, ctx);
      if (!scope) return miss(`I don't know "${said}". Say a school, a conference, or "the country".`, "leaders-no-scope");
      return leaders({ k, scope, pos: posOf(s.posw), howMany: nWord(s.n), ord: ordOf(s.ord), cut }, ctx);
    },
  },
];

// ── A game told like a recap: the score, then each side's best lines ──
async function breakdown(g, ctx) {
  const h = g.home || {};
  const a = g.away || {};
  const [w, l] = (h.points ?? 0) >= (a.points ?? 0) ? [h, a] : [a, h];
  const live = g.status === "in_progress";
  const road = w === a;
  const margin = Math.abs((h.points ?? 0) - (a.points ?? 0));
  const verb = margin <= 3 ? "edged" : margin <= 8 ? "held off" : margin >= 28 ? "rolled past" : "beat";
  const when = g.period ? ` in the ${["", "first", "second", "third", "fourth"][g.period] || "overtime"}${g.period <= 4 ? " quarter" : ""}` : "";
  const head = live
    ? `${margin === 0 ? `${tName(a)} and ${tName(h)} are tied at ${h.points ?? 0}` : `${tName(w)} leads ${tName(l)} ${w.points} to ${l.points}`}${when}.`
    : `${tName(w)} ${verb} ${tName(l)} ${w.points} to ${l.points}${road ? " on the road" : " at home"}.`;
  const stats = ctx.livePlayStats ? await ctx.livePlayStats(g.id).catch(() => null) : null;
  const lead = stats ? gameLeaders(stats, 4) : {};
  const side = (t) => (g.home === t ? "home" : "away");
  // Each team's two biggest lines, the winner's first.
  const linesFor = (t) => {
    const seen = new Set();
    const out = [];
    ["passing", "rushing", "receiving", "defense"].forEach((cat) => (lead[cat] || []).filter((e) => e.side === side(t)).slice(0, 1).forEach((e) => {
      if (seen.has(e.id)) return;
      seen.add(e.id);
      const all = (stats.players?.[e.side] || []).find((x) => x.key === e.id)?.stats || { [cat]: e.stats };
      const did = gameDid(all);
      if (did) out.push({ name: e.name, did, v: e.v });
    }));
    return out.slice(0, 2);
  };
  const W = stats ? linesFor(w) : [];
  const L = stats ? linesFor(l) : [];
  const tell = (xs) => xs.map((x) => `${x.name} ${x.did}.`).join(" ");
  const speak = [head, W.length ? `For ${tName(w)}, ${tell(W)}` : "", L.length ? `On the ${tName(l)} side, ${tell(L)}` : ""].filter(Boolean).join(" ");
  const rows = [...W.map((x) => [`${x.name} · ${tName(w)}`, x.did]), ...L.map((x) => [`${x.name} · ${tName(l)}`, x.did])];
  return {
    say: speak, speak,
    title: `${tName(a)} at ${tName(h)}`, sub: `${tName(a)} ${a.points ?? 0} – ${tName(h)} ${h.points ?? 0}${live ? " · live" : " · Final"}`,
    rows, games: [g], live,
    links: g.slug ? [{ to: `/live/${g.slug}`, label: "Open the game", primary: true }] : [],
    tone: "answer",
  };
}

// A player's last game (his team's, this week or the weeks before): his line, told.
async function playerGame(player, ctx) {
  const d = ctx.player ? await ctx.player(player.id).catch(() => null) : null;
  const school = d?.School || player.school;
  const name = `${d?.First || player.first} ${d?.Last || player.last}`.trim();
  if (!school) return miss(`I don't know ${name}'s team.`, "breakdown-no-team");
  const g = await findGame([school], ctx);
  if (!g) return { say: `I don't see a recent ${school} game.`, tone: "answer", gap: "breakdown-no-game" };
  const stats = ctx.livePlayStats ? await ctx.livePlayStats(g.id).catch(() => null) : null;
  const mine = teamKey(tName(g.home)) === teamKey(school) ? "home" : "away";
  const lines = stats?.players?.[mine] || [];
  const last = plain(d?.Last || player.last).replace(/\b(?:jr|sr|ii|iii|iv)\b/g, "").trim();
  const byLast = lines.filter((x) => plain(x.name).includes(last));
  const me = lines.find((x) => plain(x.name) === plain(name)) || (byLast.length === 1 ? byLast[0] : null);
  const us = g[mine] || {};
  const them = g[mine === "home" ? "away" : "home"] || {};
  const live = g.status === "in_progress";
  const res = live ? "game" : (us.points ?? 0) > (them.points ?? 0) ? "win" : (us.points ?? 0) < (them.points ?? 0) ? "loss" : "tie";
  const score = live ? "" : `${Math.max(us.points ?? 0, them.points ?? 0)} to ${Math.min(us.points ?? 0, them.points ?? 0)} `;
  const where = `${mine === "home" ? "against" : "at"} ${tName(them)}`;
  const did = me ? gameDid(me.stats) : "";
  const speak = did ? `${name} ${did} in ${school}'s ${score}${res} ${where}.` : `I don't see ${name} in the stats for ${school}'s ${score}${res} ${where}.`;
  return { say: speak, speak, title: name, sub: `${tName(g.away)} at ${tName(g.home)}`, games: [g], links: g.slug ? [{ to: `/live/${g.slug}`, label: "Open the game", primary: true }] : [], tone: "answer", focus: player };
}
