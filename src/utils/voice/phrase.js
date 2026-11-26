// src/utils/voice/phrase.js
//
// /voice: saying the same kind of answer different ways (user, 2026-11-25).
//
//   phrase(ctx, key, vars) → one of the phrasebook's wordings for `key`
//     (utils/voice/phrasebook.js), filled from vars. A wording that returns
//     null doesn't fit these vars (no school on file…) and is skipped. Text
//     templates ("{name} had {value} {when}.") are filled by phraseTemplates.js.
//   - Variation is on when ctx.vary (the page turns it on). Off — tests, or
//     anyone who wants the same answer every time — it's always the first
//     wording, so the first one is the plain, complete one.
//   - Never the same wording twice in a row for a key (ctx.memory, kept for
//     the session).
//   - ctx.same: this answer is about the player the last one was about — a
//     "<key>.again" wording (shorter, "he") is used when the book has one.
//   - ctx.brief: the page's Brief setting — extras (insights, hints) are
//     left off; see extra() / hint().
// Pure apart from ctx.memory.
import { BOOK } from "./phrasebook";
import { fill } from "./phraseTemplates";

const memOf = (ctx) => ctx?.memory || null;

export function phrase(ctx, key, vars = {}) {
  const useKey = ctx?.vary && ctx?.same && BOOK[`${key}.again`] ? `${key}.again` : key;
  const list = BOOK[useKey] || BOOK[key];
  if (!list) throw new Error(`No phrasebook entry "${key}"`);
  return choose(ctx, useKey, list.map((fn) => { try { return typeof fn === "string" ? fill(fn, vars, useKey) : fn(vars); } catch { return null; } }));
}

/** One of some ready-made wordings (the first when not varying), never the last one used for `key`. */
export function choose(ctx, key, options0) {
  let options = (options0 || []).filter(Boolean);
  if (!options.length) return "";
  if (!ctx?.vary || options.length === 1) return options[0];
  const mem = memOf(ctx);
  const last = mem?.said?.[key];
  // Said out loud, "Braden Atkinson: 3,169 passing yards, 2026." reads like a box score
  // (user, 2026-11-25): the wordings that talk come first when there are any.
  const talking = options.filter((o) => !/^[^.!?]{1,80}:\s/.test(o));
  if (talking.length) options = talking;
  const fresh = options.filter((o) => o !== last);
  const pool = fresh.length ? fresh : options;
  const out = pool[Math.floor((ctx.random || Math.random)() * pool.length)];
  if (mem) (mem.said ||= {})[key] = out;
  return out;
}

/** Something worth adding, but not needed (an insight, a pedigree note): left off on Brief. */
export const extra = (ctx, text) => (ctx?.brief || !text ? "" : text);

/**
 * A how-to tip ("Say 'next' for another"): only the first couple of times
 * this session when varying, never on Brief.
 */
export function hint(ctx, key, text) {
  if (ctx?.brief || !text) return "";
  if (!ctx?.vary) return text;
  const mem = memOf(ctx);
  if (!mem) return text;
  const seen = ((mem.hints ||= {})[key] || 0);
  mem.hints[key] = seen + 1;
  return seen < 2 ? text : "";
}

/** Sentences joined, the empty ones dropped. */
export const join = (...parts) => parts.filter((p) => p && String(p).trim()).map((p) => String(p).trim()).join(" ");
export const cap = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

// ── Saying things the way people say them ──
/** A game's result: "a 31-17 win" / "a 35-24 loss" / "" */
export const resultPhrase = (g) => (!g?.score ? "" : g.result === "W" ? `a ${g.score} win` : g.result === "L" ? `a ${g.score} loss` : g.result === "T" ? `a ${g.score} tie` : g.score);
/** A stat line's span, as said: "in 2025", "in his career", "across 2025 and 2026", "against Ohio State" */
export function whenPhrase(r) {
  if (!r) return "";
  if (r.kind === "at") return `at ${r.school}`;
  if (r.kind === "vs") return `against ${r.opps.map(shortTeam).join(" and ")}${r.games?.length > 1 ? ` (${r.games.length} games)` : ""}`;
  if (r.kind === "career") return "in his career";
  if (r.years?.length > 1) return `across ${r.years.slice(0, -1).join(", ")} and ${r.years[r.years.length - 1]}`;
  return r.years?.length ? `in ${r.years[0]}` : r.label ? `in ${r.label}` : "";
}
// "Ohio State Buckeyes" → "Ohio State" (the mascot dropped when it's the last word or two).
const MASCOT2 = /\s(?:Crimson Tide|Red Raiders|Sun Devils|Golden Gophers|Fighting Irish|Yellow Jackets|Tar Heels|Blue Devils|Demon Deacons|Nittany Lions|Golden Bears|Horned Frogs|Scarlet Knights|Black Knights|Golden Hurricane|Mean Green|Green Wave|Golden Eagles|Golden Flashes|Rainbow Warriors|Red Wolves|Ragin' Cajuns|Blue Raiders|Thundering Herd|Fighting Illini|Wolf Pack|Black Bears|Big Green|Big Red)$/;
export const shortTeam = (name) => {
  const s = String(name || "");
  if (MASCOT2.test(s)) return s.replace(MASCOT2, "");
  const w = s.split(" ");
  return w.length > 1 ? w.slice(0, -1).join(" ") : s;
};
/** "Sep 12, 2026" → "September 12th" (the year when it isn't this one). */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function datePhrase(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const n = d.getDate();
  const th = n % 100 > 10 && n % 100 < 14 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${MONTHS[d.getMonth()]} ${n}${th}${d.getFullYear() !== now.getFullYear() ? `, ${d.getFullYear()}` : ""}`;
}
