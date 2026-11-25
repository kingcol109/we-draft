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
import { findPlayer, schoolSaid } from "./names";
import { teamKey } from "../film/schedule";
import { currentSeason } from "./reply";
import { phrase, hint } from "./phrase";
import { respelling } from "./pronounce";
import { notOnWeDraft } from "./requests";

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
const prep = (text) => clean(text).replace(FILLER, "").replace(TAIL, "").trim();

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

const label = (p) => `${p.first} ${p.last}${p.pos || p.school ? ` · ${[p.pos, p.school].filter(Boolean).join(", ")}` : ""}`;
const asChoices = (list) => list.map((p) => ({ id: p.id, label: label(p) }));
const log = (ctx, state, text, reason, extra = {}) => ctx.logMiss?.({ text, mode: state.mode, reason, ...extra });

// A reply → the next state (a confirm / "next" waits for the answer).
function settle(out0, state0, ctx, text, intent) {
  // Who "him" / "them" means next: the one player (focus) or the few (group) a
  // reply named; a name not on our board (offBoard) can't be him.
  const { focus, group, offBoard, pending: next, ...out } = out0;
  const state = {
    ...state0,
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

// A (?<who>) slot → a player, or a question back.
async function resolve(intent, slots, state, ctx, text) {
  if (!("who" in slots)) return run(intent, slots, state, ctx, text);
  const said = slots.who;
  if (HIM.test(plain(said))) {
    if (state.last) return run(intent, { ...slots, player: state.last }, state, ctx, text);
    if (state.offBoard) {
      log(ctx, state, text, "off-board", { intent: intent.id, said: state.offBoard });
      return { reply: { say: `${state.offBoard} isn't on We-Draft.com's board yet, so I can't do that. I logged it.`, tone: "miss" }, state };
    }
    return { reply: { say: "Who do you mean?", tone: "miss" }, state };
  }
  const people = await ctx.people();
  let found = findPlayer(said, people, state.aliases);
  // "kromahs height" (no apostrophe) → try it without the s.
  if (found.none && /s$/.test(plain(said))) {
    const again = findPlayer(plain(said).replace(/s$/, ""), people, state.aliases);
    if (!again.none) found = again;
  }
  if (found.player) return run(intent, { ...slots, player: found.player }, state, ctx, text);
  if (found.choices) {
    return {
      reply: { say: `Which one? ${found.choices.slice(0, 3).map((p) => `${p.first} ${p.last}${p.school ? ` at ${p.school}` : ""}`).join(", or ")}?`, choices: asChoices(found.choices), tone: "ask" },
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
      log(ctx, state, text, "unknown-player", { intent: intent.id, said, school: found.school || null });
      return {
        reply: { say: `${phrase(ctx, "miss.player", { said })} Did you mean one of these?`, choices: asChoices(choices), tone: "ask" },
        state: { ...state, pending: { kind: "choose", intent: intent.id, slots, said, text, choices, teach: true } },
      };
    }
    if (c.player) return run(intent, { ...slots, player: c.player }, state, ctx, text);
    if (c.choices) {
      return {
        reply: { say: `Which one? ${c.choices.slice(0, 3).map((p) => `${p.first} ${p.last}${p.school ? ` at ${p.school}` : ""}`).join(", or ")}?`, choices: asChoices(c.choices), tone: "ask" },
        state: { ...state, pending: { kind: "choose", intent: intent.id, slots, said, text, choices: c.choices } },
      };
    }
  }
  log(ctx, state, text, "unknown-player", { intent: intent.id, said, school: found.school || null });
  const tip = hint(ctx, "request", state.mode === "admin" ? `To add him, say "add" with his name and school.` : `If he isn't on We-Draft.com, say "request" with his name and school.`);
  return {
    reply: { say: `${(found.school ? phrase(ctx, "miss.player.school", { said, school: found.school }) : phrase(ctx, "miss.player", { said }))}${found.near.length ? " Did you mean one of these?" : ""}${tip ? ` ${tip}` : ""}`, choices: asChoices(found.near), tone: "miss" },
    state: { ...state, pending: found.near.length ? { kind: "choose", intent: intent.id, slots, said, text, choices: found.near, teach: true } : null },
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

async function respondTo(text, state, ctx) {
  const t = prep(text);
  const p = state.pending;
  if (p?.kind === "pronounce") return pronounceStep(text, state, ctx);
  if (p?.kind === "confirm") {
    if (YES.test(t)) return confirm(true, state, ctx);
    if (NO.test(t)) return confirm(false, state, ctx);
  }
  if (p?.kind === "more" && MORE.test(t)) return more(state, ctx);
  if (p?.kind === "choose") {
    const pick = t.replace(/^(?:the |number )/, "").replace(/ one$/, "").trim();
    if (ORDINAL[pick] != null && p.choices[ORDINAL[pick]]) return choose(p.choices[ORDINAL[pick]].id, state, ctx);
    if (NO.test(t)) return { reply: { say: "Okay.", tone: "answer" }, state: { ...state, pending: null } };
    // A name among the choices ("the one at Ohio State" / "Jeremiah").
    const hit = p.choices.filter((c) => [c.first, c.last, c.school].some((w) => w && t.includes(plain(w))));
    if (hit.length === 1) return choose(hit[0].id, state, ctx);
  }
  const base = { ...state, pending: null };
  const fr = followRest(t, state);
  if (fr) return resolve(fr.intent, fr.slots, base, ctx, String(text).trim());
  const u = understand(text, state.mode);
  // "how many touchdowns?" right after "…rushing yards in 2025": the same season / opponents.
  const la = state.lastAsk;
  if (u?.intent && TIMED.has(u.intent.id) && TIMED.has(la?.intent) && u.slots.who === "his" && !u.slots.rest && !u.slots.rest1 && la.rest) {
    const slots = { ...u.slots, rest: la.rest };
    if (!u.intent.accept || u.intent.accept(slots)) u.slots = slots;
  }
  const fw = !u && (await followWho(t, state, ctx));
  if (fw) return resolve(fw.intent, fw.slots, base, ctx, String(text).trim());
  if (!u) {
    log(ctx, state, String(text).trim(), "not-understood");
    const tip = hint(ctx, "help", 'Say "help" for what I can do.');
    return { reply: { say: `${phrase(ctx, "miss.question", { text: String(text).trim() })}${tip ? ` ${tip}` : ""}`, tone: "miss" }, state: base };
  }
  if (u.wrongMode) return { reply: { say: `"${u.wrongMode.title}" is an admin command. Use the admin version.`, tone: "miss" }, state: base };
  if (u.intent.signIn && !ctx.uid) return { reply: { say: "Sign in first. That's your own evaluation.", tone: "miss" }, state: base };
  try {
    return await resolve(u.intent, u.slots, base, ctx, String(text).trim());
  } catch (e) {
    log(ctx, state, String(text).trim(), "error", { intent: u.intent.id, error: String(e.message || e) });
    return { reply: { say: `Something went wrong: ${e.message}`, tone: "miss" }, state: base };
  }
}
