// src/utils/voice/engine.js
//
// /voice: what was said (or typed) → an answer. The page keeps a small
// conversation state and hands each line here:
//
//   respond(text, state, ctx) → { reply, state }
//
//   1. Something is pending ("which Smith?", "change it — yes?", "next"
//      evaluation): a yes / no, "the first one", a name, or "next" answers it.
//   2. Else the line is matched against the intents (utils/voice/intents.js)
//      the mode allows — general on /voice, general + admin on /voice/admin.
//   3. The (?<who>) slot becomes a player (utils/voice/names.js); "he / him /
//      his" is the last player talked about.
//   4. The intent runs. A write comes back as a confirm, and nothing is
//      written until a yes.
//
// Anything it can't answer is logged (ctx.logMiss → voiceMisses; user,
// 2026-11-25) with why — a sentence it didn't understand, a name it didn't
// know, data it didn't have, an error — so it can be added later (Voice
// page → Missed).
//
// state: { mode: "general" | "admin", pending, last (player row), aliases,
//          lastAsk: the last question about a player, for follow-ups }
// ctx:   utils/voice/data.js makeVoiceData(), or fakes in tests.
// Pure apart from what ctx does.
import { INTENTS } from "./intents";
import { clean, plain } from "./text";
import { findPlayer, schoolSaid, recentPlayer } from "./names";
import { teamKey } from "../film/schedule";
import { currentSeason } from "./reply";
import { phrase, hint } from "./phrase";
import { respelling } from "./pronounce";
import { notOnWeDraft } from "./requests";
import { dictateStep } from "./intentsReport";

export const MODES = { general: "General", admin: "Admin" };
export const intentsFor = (mode) => INTENTS.filter((i) => i.mode === "general" || mode === "admin");
export const newState = (mode = "general") => ({ mode, pending: null, last: null, aliases: {} });

const FILLER = /^(?:hey |ok |okay |so |um |uh |yo |alright |all right )*(?:we draft |we-draft |wedraft )?(?:can you |could you |please |i want to |i'd like to |let's |would you |go ahead and )*/;
const TAIL = /(?: please| for me| real quick| now| thanks| thank you)+$/;
const YES = /^(?:yes|yeah|yep|yup|sure|do it|confirm|correct|go ahead|ok|okay|that's right|right|yes please|save it)$/;
const NO = /^(?:no|nope|cancel|stop|never mind|nevermind|don't|wrong|forget it)$/;
const MORE = /^(?:next|next one|another|another one|more|read another|read the next one|keep going|go on|continue|and)$/;
const ORDINAL = { first: 0, one: 0, "1": 0, second: 1, two: 1, "2": 1, third: 2, three: 2, "3": 2, fourth: 3, four: 3, "4": 3, fifth: 4, five: 4, "5": 4, sixth: 5, six: 5, "6": 5 };
const HIM = /^(?:he|him|his|he's|that guy|the same guy|them|it)$/;
// How speech writes the site's name ("wiidraft.com", "wee draft", "we drafts") → "we draft".
const SITE_NAME = /\b(?:wii|wee|whee|we)\s?drafts?(?:\s(?:dot\s)?com)?\b/g;
const prep = (text) => clean(text).replace(SITE_NAME, "we draft").replace(FILLER, "").replace(TAIL, "")
  // "what are some of his strengths" → "what are his strengths"
  .replace(/\b(?:some|any|a few|a couple|all|one|two|three) of (his|her|their)\b/g, "$1")
  // How speech writes "who's": "whose main chroma" (log 2026-11-26).
  .replace(/^whose\b/, "who's")
  // A restart said twice: "what number what number is Makhi Hughes".
  .replace(/^((?:\S+ ){1,3}?)\1/, "$1")
  .trim();
// Said where "him" was meant — speech hears "you" / "the" a lot (user, 2026-11-25: "the system's
// hearing 'the' way too often"): "where did you go to high school", "what was the star rating".
const STANDS_FOR_HIM = /^(?:you|your|yours|the|this|that|those|them|it|its|the player|this player|that player|this guy|that guy|this kid|that kid|the kid|her|she)$/;
// A name slot that's only question words around a "he / his / you" ("what has been his",
// "do you have any strengths or", "he been") — it means him, not a player named that.
const NOT_A_NAME = new Set("what what's whats has have had been do does did is was are were any some the a an of or and to me tell give show about more on for in his he him he's hes you your yours strengths strength weaknesses weakness best game games stats numbers playing doing done looking this that so far year season".split(" "));
const PRONOUN = /\b(?:he|him|his|hes|you|your)\b/;
export const meansHim = (said) => {
  const t = plain(said);
  return PRONOUN.test(t) && t.split(" ").every((w) => NOT_A_NAME.has(w));
};
// A name slot with no name in it at all ("career", "some", "what", "how about") — a follow-up's words.
const TOPIC_WORDS = new Set("career how about and also what's high school background scouting report bio more else anything again same read give show tell pull up let know can could please".split(" "));
const noName = (said) => plain(said).split(" ").every((w) => NOT_A_NAME.has(w) || TOPIC_WORDS.has(w));

/** The intent and slots a line matches → { intent, slots } | { wrongMode: intent } | null */
export function understand(text, mode) {
  const t = prep(text);
  if (!t) return null;
  let other = null;
  for (const intent of INTENTS) {
    for (let i = 0; i < intent.patterns.length; i += 1) {
      const m = t.match(intent.patterns[i]);
      if (!m) continue;
      const slots = { ...(intent.fixed?.[i] || {}), ...Object.fromEntries(Object.entries(m.groups || {}).filter(([, v]) => v != null)) };
      if (intent.accept && !intent.accept(slots)) continue;
      if (intent.mode === "admin" && mode !== "admin") { other = other || intent; continue; }
      return { intent, slots, text: t };
    }
  }
  return other ? { wrongMode: other } : null;
}

const RECENT_MAX = 10;
// Player rows only ({ id, first, last, … }), newest first, no repeats.
export function addRecent(list = [], add = []) {
  const rows = [...add, ...(list || [])].filter((p) => p && p.id && p.first != null && p.last != null)
    .map(({ id, first, last, pos, school, cls, cfbd, cfbdOnly, slug }) => ({ id, first, last, pos, school, cls, ...(cfbd ? { cfbd } : {}), ...(cfbdOnly ? { cfbdOnly } : {}), ...(slug ? { slug } : {}) }));
  return rows.filter((p, i) => rows.findIndex((q) => q.id === p.id) === i).slice(0, RECENT_MAX);
}
// "Did you mean …?" said with the names (user, 2026-11-26: "it will go 'did you mean one of
// these' without saying who … the voice should exist on its own").
const choiceName = (p) => `${p.first} ${p.last}${p.school ? ` at ${p.school}` : ""}`;
export function didYouMean(list, one = false) {
  if (!list.length) return "";
  if (one || list.length === 1) return `Did you mean ${choiceName(list[0])}?`;
  const top = list.slice(0, 3).map(choiceName);
  return `Did you mean ${top.slice(0, -1).join(", ")}, or ${top[top.length - 1]}?`;
}
const label = (p) => `${p.first} ${p.last}${p.pos || p.school ? ` · ${[p.pos, p.school].filter(Boolean).join(", ")}` : ""}`;
const asChoices = (list) => list.map((p) => ({ id: p.id, label: label(p) }));
const log = (ctx, state, text, reason, extra = {}) => ctx.logMiss?.({ text, mode: state.mode, reason, ...extra });

// A reply → the next state (a confirm / "next" waits for the answer).
function settle(out0, state0, ctx, text, intent) {
  // Who "him" / "them" means next: the one player (focus) or the few (group) a
  // reply named; a name not on our board (offBoard) can't be him.
  const { focus, group, offBoard, pending: next, lastGame, ...out } = out0;
  const state = {
    ...state0,
    // Everyone just talked about or shown, newest first — a misheard name is matched against them first.
    recent: addRecent(state0.recent, [focus, ...(group || []), ...(out.people || []).filter((p) => p?.id), out.player?.id ? out.player : null, state0.last]),
    // The one game an answer was about ("…5 rushing touchdowns on October 3rd vs Virginia") — "who won that game?"
    ...(lastGame ? { lastGame } : {}),
    ...(focus ? { last: focus, offBoard: null } : {}),
    ...(group ? { group } : {}),
    ...(offBoard ? { offBoard, last: null } : {}),
  };
  if (out.gap) log(ctx, state, text, out.gap, { intent: intent?.id || null, player: out.player?.id || null });
  if (out.confirm) {
    const { apply, ...ask } = out.confirm;
    return { reply: { ...ask, tone: "ask", confirm: true }, state: { ...state, pending: { kind: "confirm", apply } } };
  }
  const { more, ...reply } = out;
  return { reply: { ...reply, intent: intent?.id || null, ...(more ? { hasMore: true } : {}) }, state: { ...state, pending: more ? { kind: "more", more } : next || null } };
}

async function run(intent, slots, state, ctx, text) {
  const idOf = (p) => p?.id || p?.i || null;
  const same = !!(slots.player && state.last && idOf(state.last) === idOf(slots.player));
  // A CFBD-only player: stats and facts answer as usual; a We-Draft.com action
  // (intent.weDraft: "save" / "status") gets the offer to request / add him instead.
  if (slots.player?.cfbdOnly && intent.weDraft) {
    log(ctx, state, text, "not-on-wedraft", { intent: intent.id, said: `${slots.player.first} ${slots.player.last}`, school: slots.player.school || null, cfbdId: slots.player.cfbd || null });
    const offer = await notOnWeDraft(slots.player, intent.weDraft, ctx, state.mode);
    return settle(offer, { ...state, last: slots.player, offBoard: null }, ctx, text, intent);
  }
  const out = await intent.run(slots, { ...ctx, same, intents: intentsFor(state.mode) }, text, state);
  // The question about a player, for follow-ups ("what about last year?", "what about Legree?").
  const lastAsk = slots.player && !NOT_FOLLOWED.has(intent.id)
    ? { intent: intent.id, slots: Object.fromEntries(Object.entries(slots).filter(([k]) => !["who", "player", "rest", "rest1"].includes(k))), rest: [slots.rest1, slots.rest].filter(Boolean).join(" ") }
    : state.lastAsk || null;
  return settle(out, { ...state, lastAsk, last: slots.player || state.last, ...(slots.player ? { offBoard: null } : {}) }, ctx, text, intent);
}

// A name compared whole: no suffixes ("David Sanders Junior" = "David Sanders Jr.").
const nameKey = (s) => plain(s).replace(/\b(?:jr|sr|ii|iii|iv|v|junior|senior)\b/g, "").replace(/\s+/g, " ").trim();
// An NFL draft pick by his exact name (compSnapshots/_draftHistory) → his latest row | null.
async function nflExact(said, ctx) {
  if (!ctx.draftHistory) return null;
  const { rows } = await ctx.draftHistory().catch(() => ({ rows: [] }));
  const hits = (rows || []).filter((r) => nameKey(r.name) === nameKey(said));
  return hits.length ? hits[hits.length - 1] : null;
}

// A (?<who>) slot → a player, or a question back.
async function resolve(intent, slots, state, ctx, text) {
  if (!("who" in slots)) return run(intent, slots, state, ctx, text);
  const said = slots.who;
  if (HIM.test(plain(said)) || meansHim(said) || (state.last && STANDS_FOR_HIM.test(plain(said)))) {
    if (state.last) return run(intent, { ...slots, player: state.last }, state, ctx, text);
    if (state.offBoard) {
      log(ctx, state, text, "off-board", { intent: intent.id, said: state.offBoard });
      return { reply: { say: `${state.offBoard} isn't on We-Draft.com's board yet, so I can't do that. I logged it.`, tone: "miss" }, state };
    }
    return { reply: { say: "Who do you mean?", tone: "miss" }, state };
  }
  const people = await ctx.people();
  // "how did Houston do against West Virginia / last week": teams, not a player — that game, broken down.
  if (intent.id === "stats.vs" && schoolSaid(said, people)) {
    const r = plain(slots.rest || "");
    const opp = r.match(/^(?:against|vs|versus|at|with|over) (?:the )?(.+?)(?: last week| on saturday| saturday)?$/);
    if ((opp && schoolSaid(opp[1], people)) || /\b(?:last week|saturday|last game|last night|yesterday|weekend|last time out)\b/.test(r)) {
      const breakdown = INTENTS.find((i) => i.id === "game.breakdown");
      if (breakdown) return run(breakdown, { teams: opp ? `${said} ${opp[1]}` : said }, state, ctx, text);
    }
  }
  // The exact name of someone just talked about or listed: him, even if the board has another.
  const sameName = (state.recent || []).filter((r) => nameKey(`${r.first} ${r.last}`) === nameKey(said));
  if (sameName.length === 1) return run(intent, { ...slots, player: sameName[0] }, state, ctx, text);
  let found = findPlayer(said, people, state.aliases);
  // "kromahs height" (no apostrophe) → try it without the s.
  if (found.none && /s$/.test(plain(said))) {
    const again = findPlayer(plain(said).replace(/s$/, ""), people, state.aliases);
    if (!again.none) found = again;
  }
  const exactHere = found.player && (found.taught || found.school || nameKey(`${found.player.first} ${found.player.last}`) === nameKey(said));
  // Someone we were just talking about, loosely ("evangelist" after Evan Tengesdahl, "Isaiah
  // Johnson" after "who wears 0 for Cincinnati" — that one, not another Isaiah Johnson).
  if (!exactHere || found.choices) {
    const near = found.choices ? state.recent?.filter((r) => found.choices.some((c) => c.id === r.id)) : null;
    if (near?.length === 1) return run(intent, { ...slots, player: near[0] }, state, ctx, text);
    const rp = !(found.player && (found.score ?? 1) >= 0.9) && recentPlayer(said, state.recent);
    if (rp) return run(intent, { ...slots, player: rp.player }, state, ctx, text);
  }
  // A loose board match loses to the exact name somewhere else (user, 2026-11-25: "Ashton Daniels"
  // answered as Ashton Hampton): anyone on a CFBD roster, then an NFL draft pick ("Cam Newton").
  const fullName = nameKey(said).split(" ").length >= 2;
  if (fullName && !exactHere && (!found.player || (found.score ?? 1) < 0.93)) {
    const cfbdAll = ctx.cfbdPeople ? await ctx.cfbdPeople().catch(() => []) : [];
    const exact = cfbdAll.filter((p) => nameKey(`${p.first} ${p.last}`) === nameKey(said));
    if (exact.length === 1) return run(intent, { ...slots, player: exact[0] }, state, ctx, text);
    const nfl = await nflExact(said, ctx);
    const nflIntent = nfl && INTENTS.find((i) => i.id === "nfl.player");
    if (nflIntent) return run(nflIntent, { nfl, ask: intent.id, field: slots.field || null, topic: slots.topic || null, metric: slots.metric || null }, state, ctx, text);
  }
  if (found.player) return run(intent, { ...slots, player: found.player }, state, ctx, text);
  if (found.choices) {
    return {
      reply: { say: `Which one? ${found.choices.slice(0, 3).map(choiceName).join(", or ")}?`, choices: asChoices(found.choices), tone: "ask" },
      state: { ...state, pending: { kind: "choose", intent: intent.id, slots, said, text, choices: found.choices } },
    };
  }
  // "how is Florida State doing (today)": a team, not a player — its game this week.
  if (intent.id === "live.player" && ctx.liveSlate && schoolSaid(said, await ctx.people())) {
    return run(INTENTS.find((i) => i.id === "live.score"), { team: said }, state, ctx, text);
  }
  // "how did Florida State do": a team, not a player — its record.
  if (intent.id === "stats.vs" && ctx.schedule) {
    const key = teamKey(plain(said).replace(/^the /, ""));
    const games = await ctx.schedule(currentSeason()).catch(() => []);
    if (key && games.some((g) => teamKey(g.home) === key || teamKey(g.away) === key)) {
      const season = (plain(slots.rest || "").match(/\b20\d\d\b/) || [])[0];
      return run(INTENTS.find((i) => i.id === "team.record"), { team: said, season }, state, ctx, text);
    }
  }
  // Not on We-Draft.com's board: anyone on a CFBD roster (user, 2026-11-25 —
  // his stats should still play). A We-Draft.com action for him is stopped in
  // run() with the offer to request / add him.
  const cfbd = ctx.cfbdPeople ? await ctx.cfbdPeople().catch(() => []) : [];
  if (cfbd.length) {
    let c = findPlayer(said, cfbd, state.aliases);
    if (c.none && /s$/.test(plain(said))) { const again = findPlayer(plain(said).replace(/s$/, ""), cfbd, state.aliases); if (!again.none) c = again; }
    // A near-miss on the board ("Ousman Chroma" → Kromah?) beats a loose
    // CFBD match: unless the CFBD name is all but exact, ask which one.
    if (c.player && found.near?.length && (c.score ?? 1) < 0.95) {
      const choices = [...found.near.slice(0, 4), c.player];
      const ask = didYouMean(choices, found.lead);
      log(ctx, state, text, "unknown-player", { intent: intent.id, said, school: found.school || null });
      return {
        reply: { say: `${phrase(ctx, "miss.player", { said })} ${ask}`, speak: ask, choices: asChoices(choices), tone: "ask" },
        state: { ...state, pending: { kind: "choose", intent: intent.id, slots, said, text, choices, teach: true, yes: found.lead ? choices[0].id : null } },
      };
    }
    if (c.player) return run(intent, { ...slots, player: c.player }, state, ctx, text);
    if (c.choices) {
      return {
        reply: { say: `Which one? ${c.choices.slice(0, 3).map(choiceName).join(", or ")}?`, choices: asChoices(c.choices), tone: "ask" },
        state: { ...state, pending: { kind: "choose", intent: intent.id, slots, said, text, choices: c.choices } },
      };
    }
  }
  log(ctx, state, text, "unknown-player", { intent: intent.id, said, school: found.school || null });
  // The "request him" tip only when the words look like a name (not "the number one rated person").
  const nameLike = plain(said).split(" ").length <= 4 && !/\b(?:the|a|an|on|of|in|who|what|person|player|prospect|rated|ranked|number|best|top|guy)\b/.test(plain(said));
  const tip = nameLike ? hint(ctx, "request", state.mode === "admin" ? `To add him, say "add" with his name and school.` : `If he isn't on We-Draft.com, say "request" with his name and school.`) : "";
  const ask = didYouMean(found.near, found.lead);
  return {
    reply: { say: `${(found.school ? phrase(ctx, "miss.player.school", { said, school: found.school }) : phrase(ctx, "miss.player", { said }))}${ask ? ` ${ask}` : ""}${tip ? ` ${tip}` : ""}`, speak: ask || phrase(ctx, "miss.player.short"), choices: asChoices(found.near), tone: found.near.length ? "ask" : "miss" },
    state: { ...state, pending: found.near.length ? { kind: "choose", intent: intent.id, slots, said, text, choices: found.near, teach: true, yes: found.lead || found.near.length === 1 ? found.near[0].id : null } : null },
  };
}

// ── Follow-ups (user, 2026-11-25) ──
// Only re-asked, never answered loosely: a follow-up becomes the last
// question with one part changed, and that intent answers it as usual.
const NOT_FOLLOWED = new Set(["followup.rank", "voice.mark", "voice.pronounce", "player.set", "my.note", "watchlist.add"]);
// The ones a season / opponent can be swapped on.
const TIMED = new Set(["stats.one", "stats.line", "stats.vs", "stats.max", "games.best"]);
const FOLLOW_REST = /^(?:(?:and|what about|how about|same for|and what about|what about for|how about for) )?(?<rest>(?:(?:in|for|during|over) )?(?:the )?(?:(?:last|this) (?:season|year)|20\d\d|(?:his )?career|college)|in college|(?:against|vs|versus) .+)$/;
const FOLLOW_WHO = /^(?:and|what about|how about|same for|and what about) (?<who>.+)$/;
function followRest(t, state) {
  const a = state.lastAsk;
  if (!a || !TIMED.has(a.intent)) return null;
  const m = t.match(FOLLOW_REST);
  if (!m) return null;
  const intent = INTENTS.find((i) => i.id === a.intent);
  const slots = { ...a.slots, who: "his", rest: m.groups.rest };
  if (!intent || (intent.accept && !intent.accept(slots))) return null;
  return { intent, slots };
}
async function followWho(t, state, ctx) {
  const a = state.lastAsk;
  const m = a && t.match(FOLLOW_WHO);
  if (!m) return null;
  const intent = INTENTS.find((i) => i.id === a.intent);
  if (!intent) return null;
  // "what about Alabama" after a stat: an opponent, not a player.
  if (TIMED.has(a.intent) && schoolSaid(m.groups.who, await ctx.people())) {
    const slots = { ...a.slots, who: "his", rest: `against ${m.groups.who}` };
    return !intent.accept || intent.accept(slots) ? { intent, slots } : null;
  }
  const slots = { ...a.slots, who: m.groups.who, ...(a.rest ? { rest: a.rest } : {}) };
  return !intent.accept || intent.accept(slots) ? { intent, slots } : null;
}

/** A pick from "which one?" (a tap, or said): run the question for him. */
export async function choose(id, state, ctx) {
  const p = state.pending;
  if (!p || p.kind !== "choose") return { reply: { say: "There's nothing to pick right now.", tone: "miss" }, state };
  const player = p.choices.find((x) => x.id === id);
  const intent = INTENTS.find((i) => i.id === p.intent);
  if (!player || !intent) return { reply: { say: "I lost track — ask again.", tone: "miss" }, state: { ...state, pending: null } };
  // A name it didn't know: remember it means him (the page saves it).
  const aliases = p.teach ? { ...state.aliases, [plain(p.said)]: player.id } : state.aliases;
  try {
    return await run(intent, { ...p.slots, player }, { ...state, aliases, pending: null }, ctx, p.text);
  } catch (e) {
    log(ctx, state, p.text, "error", { error: String(e.message || e) });
    return { reply: { say: `Something went wrong: ${e.message}`, tone: "miss" }, state: { ...state, pending: null } };
  }
}

/** Yes / no to a pending change. */
export async function confirm(yes, state, ctx = null) {
  const p = state.pending;
  if (!p || p.kind !== "confirm") return { reply: { say: "There's nothing waiting on a yes.", tone: "miss" }, state };
  if (!yes) return { reply: { say: phrase(ctx, "ack.cancel"), tone: "answer" }, state: { ...state, pending: null } };
  try {
    const reply = await p.apply();
    return { reply, state: { ...state, pending: null } };
  } catch (e) {
    return { reply: { say: `That didn't save: ${e.message}`, tone: "miss" }, state: { ...state, pending: null } };
  }
}

/** "next": the pending reply's next part. */
export async function more(state, ctx) {
  const p = state.pending;
  if (!p || p.kind !== "more") return { reply: { say: "That's everything.", tone: "answer" }, state };
  return settle(await p.more(), state, ctx, "next");
}

/** One line in → { reply, state } out. */
export async function respond(text, state, ctx) {
  return remember(await respondTo(text, state, ctx), text);
}

// The last question and answer, for "mark that" (a reply that's about the
// voice itself — marking, pronouncing — isn't one to mark).
export function remember(out, said) {
  if (!out?.reply || out.reply.noRecord) return out;
  return { ...out, state: { ...out.state, lastAnswer: { said: String(said || "").trim(), say: out.reply.say, intent: out.reply.intent || null, player: out.reply.player?.id || out.state?.last?.id || null } } };
}

// Fixing how a name is said, after "you're saying Kromah wrong": each line is
// how it should sound (read back in place), until "lock it" saves it.
const LOCK = /^(?:lock it|lock|lock that|lock it in|lock that in|save it|save that|keep it|keep that|that's it|thats it|that's right|thats right|perfect|yes|yeah|yep|good|correct|sounds good|that's good|thats good)$/;
const CANCEL = /^(?:cancel|never mind|nevermind|stop|forget it|leave it|leave it alone)$/;
const RETRY = /^(?:no|nope|not quite|wrong|try again|again|not right|that's wrong|thats wrong)$/;
const REPLAY = /^(?:play it|play it again|say it again|again please|repeat|repeat it|one more time|say it)$/;
async function pronounceStep(text, state, ctx) {
  const p = state.pending;
  const t = prep(text);
  const inPlace = (cand) => (p.full && p.full !== p.word ? p.full.replace(p.word, cand) : cand);
  const keep = (reply, pending = p) => ({ reply: { noRecord: true, title: `Pronounce: ${p.word}`, ...reply }, state: { ...state, pending } });
  if (CANCEL.test(t)) return keep({ say: `Okay, I left ${p.word} as it was.`, tone: "answer" }, null);
  if (LOCK.test(t)) {
    if (!p.candidate) return keep({ say: `Say how ${p.word} should sound first.`, tone: "ask" });
    try { await ctx.savePronunciation({ word: p.word, say: p.candidate, playerId: p.playerId }); } catch (e) { return keep({ say: `That didn't save: ${e.message}`, tone: "miss" }); }
    return keep({ say: `Locked. I'll say ${p.word} as "${p.candidate}" from now on.`, speak: `Locked. ${inPlace(p.candidate)}.`, rows: [["Written", p.word], ["Said", p.candidate]], tone: "done" }, null);
  }
  if (RETRY.test(t)) return keep({ say: `Okay. How should ${p.word} sound?`, tone: "ask" }, { ...p, candidate: null });
  if (REPLAY.test(t) && p.candidate) return keep({ say: `${p.word} → "${p.candidate}". Lock it, or say it another way.`, speak: `${inPlace(p.candidate)}. Lock it, or say it another way.`, tone: "ask" });
  const cand = respelling(text);
  if (!cand) return keep({ say: `How should ${p.word} sound?`, tone: "ask" });
  return keep({
    say: `${p.word} → "${cand}". Lock it, or say it another way.`,
    speak: `${inPlace(cand)}. Lock it, or say it another way.`,
    rows: [["Written", p.word], ["Said", cand]], tone: "ask",
  }, { ...p, candidate: cand });
}

// Feedback about the voice itself, said to it (user, 2026-11-25: "I don't like the last answer…",
// "the audio stops listening way too fast…"): long, and about how it talks / answers.
const FEEDBACK = /\b(?:i don't like|i do not like|i dont like|i want (?:it|you|the)|it should|you should|it shouldn't|you shouldn't|should be|shouldn't|should just|should always|should never|sounds (?:so |too |very |really )?(?:robotic|weird|wrong|bad)|too (?:fast|slow|long|short|robotic)|way too|the (?:audio|voice|answer|last answer|system|mic|microphone)\b.*\b(?:should|is|was|needs?)|needs to)\b/;
export const looksLikeFeedback = (t0) => {
  const t = String(t0 || "").replace(/'/g, "'").replace(/\b(do|should|does|is|was)nt\b/g, "$1n't");
  // A question ("what should I watch…") isn't feedback unless it's clearly about the voice.
  if (/^(?:who|what|how many|how much|where|which)\b/.test(t) && !/\b(?:the (?:audio|voice|system|mic)|you|your answer)\b/.test(t)) return false;
  return t.split(" ").length >= 7 && FEEDBACK.test(t);
};

// ── Topic follow-ups (user, 2026-11-26: "he will introduce the player fine, user asks for his
// stats, and he doesn't know how to respond") ── A short line, or one that says "he / his / you",
// with no name in it, about the player we're on → the full question about him. Order matters:
// the more specific topic first.
const SEASON_SAID = /\b(?:this (?:season|year)|last (?:season|year)|20\d\d|career|in college|so far)\b/;
const TOPIC_ASKS = [
  [/\bstrengths? (?:and|or|&) weakness(?:es)?\b|\bpros and cons\b|\bgood and bad\b/, "what are his strengths and weaknesses"],
  [/\bweakness(?:es)?\b|\bwork on\b|\bknocks?\b|\bbad at\b|\bconcerns?\b|\bimprove\b|\bstruggles? with\b|\bholes in\b/, "what are his weaknesses"],
  [/\bstrengths?\b|\bgood at\b|\b(?:does|do) (?:really )?well\b|\bbest traits?\b|\bbest at\b|\bgreat at\b/, "what are his strengths"],
  [/\bcomps?\b|\bcomparisons?\b|\bcompares? to\b|\bremind\b|\bresembles?\b|\bplays like\b|\bsimilar to\b/, "what are his nfl comps"],
  [/\bbest game\b|\bbiggest game\b|\btop game\b/, "what was his best game{season}"],
  [/\b(?:best|biggest|top|good|great) games\b|\bgames? (?:should i|to|i should|worth) (?:watch|pull up|turn on)\b|\bwatch (?:of|for) (?:his|him)\b/, "what are his best games{season}"],
  [/\btransfer(?:red)?\b|\banywhere (?:else )?before\b|\bplay(?:ed)? (?:anywhere )?before\b|\bbefore (?:he got to|coming to|that)\b|\bother schools?\b|\bwhere else\b|\bcareer path\b|\bprevious(?:ly)?\b|\bbefore [a-z]+(?: [a-z]+){0,2}$/, "what's his career path"],
  [/\bhigh school\b.*\b(?:ratings?|rated|rankings?|ranked|stars?)\b|\bstars?\b|\bstar rating\b|\brecruit(?:ing|ed)?\b|\brated coming out\b|\btop recruit\b/, "what's his recruiting ranking"],
  [/\bhigh school\b/, "where did he go to high school"],
  [/\bwhere(?:'s|s| is) he from\b|\bwhat (?:state|city|town|part of [a-z ]+) is he from\b|\bwhere is he from\b|\bgr[eo]w up\b|\bhome ?town\b|\bfrom where\b|\bwhere(?:'s| is) home\b/, "where is he from"],
  [/\bscouting report\b|\bwrite ?up\b|\breport on him\b|\bbio\b/, "read his bio"],
  [/^(?:more|go on|keep going|continue|and)$|\bbackground\b|\btell me more\b|\bmore about\b|\bmore on\b|\bwhat else\b|\banything else\b|\blearn more\b|\bknow more\b|\brundown\b|\bbackstory\b/, "tell me more about him"],
  [/\branked\b|\brank(?:ing)?\b/, "where is he ranked"],
  [/\bstats\b|\bstatistics\b|\bnumbers\b|\bproduction\b|\bstat line\b|\bhow(?:'s|s| is| has) he (?:been )?(?:playing|doing|looking|looked|played|performing|performed)\b|\bwhat (?:did|has) he (?:do|done)\b|\bhow (?:was|is|has been|'s|s) his (?:season|year)\b|\bhow(?:'s| is) his season\b/, "what are his stats{season}"],
];
export function topicAsk(t, state) {
  if (!state.last) return null;
  if (!PRONOUN.test(t) && t.split(" ").length > 4 && !noName(t)) return null;
  for (const [re, q] of TOPIC_ASKS) {
    if (!re.test(t)) continue;
    const s = (t.match(SEASON_SAID) || [])[0];
    return q.replace("{season}", s && s !== "so far" ? ` ${s}` : s === "so far" ? " this season" : "");
  }
  return null;
}

const LEAD_IN = /^(?<who>[a-z0-9.' ]+?) (?<q>(?:what|what's|whats|how|how's|hows|where|who|who's|when|is|was|does|did|has|tell me|give me|read me)\b.*\b(?:his|he|him|he's)\b.*)$/;

async function respondTo(text, state, ctx) {
  const t = prep(text);
  const p = state.pending;
  if (p?.kind === "pronounce") return pronounceStep(text, state, ctx);
  // Dictating a scouting report: every line is part of it (or done / scratch that / read it back).
  if (p?.kind === "dictate") return dictateStep(text, state, ctx);
  if (p?.kind === "confirm") {
    if (YES.test(t)) return confirm(true, state, ctx);
    if (NO.test(t)) return confirm(false, state, ctx);
  }
  if (p?.kind === "more" && MORE.test(t)) return more(state, ctx);
  if (p?.kind === "choose") {
    const pick = t.replace(/^(?:the |number )/, "").replace(/ one$/, "").trim();
    if (ORDINAL[pick] != null && p.choices[ORDINAL[pick]]) return choose(p.choices[ORDINAL[pick]].id, state, ctx);
    // "Did you mean Gunner Stockton at Georgia?" — "yes" / "yeah, him".
    if (YES.test(t) || /^(?:yes|yeah|yep|yup) (?:him|that's him|that one|the first one)$|^(?:him|that's him|that's the one|that one)$/.test(t)) {
      if (p.yes) return choose(p.yes, state, ctx);
      return { reply: { say: `Which one? Say first, second or third.`, tone: "ask" }, state };
    }
    if (NO.test(t)) return { reply: { say: "Okay. Try his name with his school, like Georgia's Gunner Stockton.", speak: "Okay. Try his name with his school.", tone: "answer" }, state: { ...state, pending: null } };
    // A name among the choices ("the one at Ohio State" / "Jeremiah").
    const hit = p.choices.filter((c) => [c.first, c.last, c.school].some((w) => w && t.includes(plain(w))));
    if (hit.length === 1) return choose(hit[0].id, state, ctx);
  }
  const base = { ...state, pending: null };
  const fr = followRest(t, state);
  if (fr) return resolve(fr.intent, fr.slots, base, ctx, String(text).trim());
  // The player said first, then the question about "him" (user, 2026-11-25: "David Sanders at
  // Tennessee, what are his strengths and weaknesses") — any question that works with "his" works this way.
  const lead = !state.leadIn && t.match(LEAD_IN);
  if (lead) {
    let f = findPlayer(lead.groups.who, await ctx.people(), state.aliases);
    if (!f.player && !understand(text, state.mode) && ctx.cfbdPeople) f = findPlayer(lead.groups.who, await ctx.cfbdPeople().catch(() => []), state.aliases);
    if (f.player) {
      const out = await respondTo(lead.groups.q, { ...state, last: f.player, offBoard: null, pending: null, leadIn: true }, ctx);
      if (out?.state) delete out.state.leadIn;
      return out;
    }
  }
  const u = understand(text, state.mode);
  // A long remark about the voice itself is a note, even when some pattern half-matches it
  // ("Again instead of a laundry list … who should I watch …" was taken as watch.team).
  if (t.split(" ").length >= 14 && looksLikeFeedback(t) && ctx.addNote) {
    try {
      await ctx.addNote("voice", { text: String(text).trim(), said: String(text).trim(), player: state?.last?.id || null, mode: state?.mode || null, auto: true, after: state?.lastAnswer || null });
      return { reply: { say: "Got it. I saved that as a voice note.", speak: phrase(ctx, "ack.note"), tone: "done", noRecord: true }, state: base };
    } catch { /* not allowed: carry on */ }
  }
  // A follow-up named by its topic, about the player we're on ("stats?", "where's he from",
  // "tell me more", "and weaknesses", "did he go anywhere before West Virginia").
  const junkWho = u?.intent && u.slots?.who && (meansHim(u.slots.who) || noName(u.slots.who)) && !HIM.test(plain(u.slots.who));
  if (!u || junkWho) {
    const q = topicAsk(t, state);
    const tu = q && understand(q, state.mode);
    if (tu?.intent) {
      try { return await resolve(tu.intent, tu.slots, base, ctx, String(text).trim()); } catch (e) {
        log(ctx, state, String(text).trim(), "error", { intent: tu.intent.id, error: String(e.message || e) });
        return { reply: { say: `Something went wrong: ${e.message}`, speak: "Something went wrong there.", tone: "miss" }, state: base };
      }
    }
  }
  // "how many touchdowns?" right after "…rushing yards in 2025": the same season / opponents.
  const la = state.lastAsk;
  if (u?.intent && TIMED.has(u.intent.id) && TIMED.has(la?.intent) && u.slots.who === "his" && !u.slots.rest && !u.slots.rest1 && la.rest) {
    const slots = { ...u.slots, rest: la.rest };
    if (!u.intent.accept || u.intent.accept(slots)) u.slots = slots;
  }
  const fw = !u && (await followWho(t, state, ctx));
  if (fw) return resolve(fw.intent, fw.slots, base, ctx, String(text).trim());
  if (!u) {
    // Guidance said to the voice ("it should…", "that sounds robotic…"): a voice note, not a miss.
    if (looksLikeFeedback(t) && ctx.addNote) {
      try {
        await ctx.addNote("voice", { text: String(text).trim(), said: String(text).trim(), player: state?.last?.id || null, mode: state?.mode || null, auto: true, after: state?.lastAnswer || null });
        return { reply: { say: "Got it. I saved that as a voice note.", speak: phrase(ctx, "ack.note"), tone: "done", noRecord: true }, state: base };
      } catch { /* not allowed: a miss as usual */ }
    }
    log(ctx, state, String(text).trim(), "not-understood");
    const tip = hint(ctx, "help", 'Say "help" for what I can do.');
    return { reply: { say: `${phrase(ctx, "miss.question", { text: String(text).trim() })}${tip ? ` ${tip}` : ""}`, speak: phrase(ctx, "miss.short"), tone: "miss" }, state: base };
  }
  if (u.wrongMode && ctx.isAdmin) {
    // An admin asking on /voice: run it anyway ("morning readout" said on the general page).
    const again = understand(text, "admin");
    if (again?.intent) return resolve(again.intent, again.slots, { ...base, mode: "admin" }, ctx, String(text).trim()).then((o) => (o?.state ? { ...o, state: { ...o.state, mode: state.mode } } : o));
  }
  if (u.wrongMode) return { reply: { say: `"${u.wrongMode.title}" is an admin command. Use the admin version.`, speak: "That's on the admin page.", tone: "miss" }, state: base };
  if (u.intent.signIn && !ctx.uid) return { reply: { say: "Sign in first. That's your own evaluation.", tone: "miss" }, state: base };
  try {
    return await resolve(u.intent, u.slots, base, ctx, String(text).trim());
  } catch (e) {
    log(ctx, state, String(text).trim(), "error", { intent: u.intent.id, error: String(e.message || e) });
    return { reply: { say: `Something went wrong: ${e.message}`, tone: "miss" }, state: base };
  }
}
