// src/utils/voice/refs.js
//
// /voice: how a player is introduced (user, 2026-11-25) — small tweaks so it
// sounds fresh: "Ousmane Kromah", "Florida State running back Ousmane
// Kromah", "FSU running back Ousmane Kromah", "Seminoles running back
// Ousmane Kromah". Only on a first mention, only when varying (a follow-up
// is "he"; plain mode is always just the name). Every form ends in his name,
// so it works anywhere the name does ("…'s best game", "for …").
import { nameOf } from "./reply";
import { phrase } from "./phrase";

export const POS_PLURAL = { QB: "quarterbacks", RB: "running backs", WR: "wide receivers", TE: "tight ends", OL: "offensive linemen", EDGE: "edge rushers", DL: "defensive linemen", LB: "linebackers", DB: "defensive backs", K: "kickers", P: "punters", LS: "long snappers" };
export const POS_NAMES = { QB: "quarterback", RB: "running back", WR: "wide receiver", TE: "tight end", OL: "offensive lineman", EDGE: "edge rusher", DL: "defensive lineman", LB: "linebacker", DB: "defensive back", K: "kicker", P: "punter", LS: "long snapper" };

/** His school's short name and mascot (compSnapshots/_cfbTeams): { short, mascot } — short only when no other school shares it. */
// Short names that mean more than one school out loud ("OSU": Ohio State? Oklahoma State? Oregon State?).
const AMBIGUOUS = new Set(["OSU", "MSU", "ASU", "UM", "USM", "SJSU"]);
export async function teamOf(ctx, school) {
  if (!school || !ctx?.teams) return {};
  const teams = await ctx.teams().catch(() => []);
  const t = teams.find((x) => x.school === school);
  if (!t) return {};
  const shared = AMBIGUOUS.has(t.short) || teams.filter((x) => x.short && x.short === t.short).length > 1;
  return { short: !shared && /^[A-Z&]{2,5}$/.test(t.short || "") && t.short !== school ? t.short : "", mascot: t.mascot || "" };
}

/** The player as introduced in an answer. */
export async function nameFor(d, ctx) {
  const name = nameOf(d);
  if (!ctx?.vary || ctx.same) return name;
  // About half the time, just his name.
  if ((ctx.random || Math.random)() < 0.5) return name;
  const pos = POS_NAMES[d.Position || d.pos] || "";
  const school = d.School || d.school || "";
  if (!pos || !school) return name;
  const t = await teamOf(ctx, school);
  return phrase(ctx, "name.ref", { name, pos, school, short: t.short, mascot: t.mascot }) || name;
}
