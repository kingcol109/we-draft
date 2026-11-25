// src/utils/voice/reply.js
//
// /voice: small helpers every intent file shares for building replies. Pure.
export const WHO = "(?<who>.+?)(?:'s|s')?";
export const nameOf = (p) => `${p.First || p.first || ""} ${p.Last || p.last || ""}`.trim();
export const weightText = (w) => (w ? `${String(w).replace(/\s*lbs?$/i, "")} pounds` : "");
// A CFBD-only player says so on screen (not out loud).
export const facts = (d) => [d.Position, d.School, d.Eligible && `class of ${d.Eligible}`, d.cfbdOnly && "not on We-Draft.com"].filter(Boolean).join(" · ");
export const card = (d, extra = {}) => ({ title: nameOf(d), sub: facts(d), player: d, ...extra });
export const miss = (say, gap, d) => ({ say, tone: "miss", ...(gap ? { gap } : {}), ...(d ? card(d) : {}) });
export const loaded = async (player, ctx) => (await ctx.player(player.id)) || null;
export const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || "th"}`;
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
export const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
// The college season now: August on is this year's.
export const currentSeason = (now = new Date()) => (now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1);
