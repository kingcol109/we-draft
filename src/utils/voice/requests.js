// src/utils/voice/requests.js
//
// /voice: players who aren't on We-Draft.com yet (user, 2026-11-25). Lots of
// college players are on CFBD rosters but not on We-Draft.com. When someone
// asks about one:
//   - anyone: "He's not on We-Draft.com yet — want me to ask We-Draft.com to
//     add him?" A yes sends a player request from their account
//     (playerRequests, the same as Profile → Request a Player; it shows in
//     Admin → Requests, and the reply lands in their Messages).
//   - admin (/voice/admin): "Want me to add him?" A yes adds him from his
//     CFBD roster row — the same add as Admin → CFB Universe
//     (CfbUniverseSearch.js addRosterPlayer).
// Both ask first; nothing is written without a yes.
//
// CFBD rosters are cfbRosters/{CFBD team id} (one doc per school, written
// weekly by scripts/syncCfbdRosters.js). With a school said, that's one read.
// Without one, only the admin's add looks through every roster (~240 reads,
// once a session, like the CFB Universe tab).
import { findPlayer, splitSchool } from "./names";
import { groupOf } from "./stats";
import { POS_NAMES } from "./refs";
import { plain } from "./text";
import { phrase } from "./phrase";

const nameOfRow = (r) => `${r.first || ""} ${r.last || ""}`.trim();
export const posNameOf = (pos) => POS_NAMES[groupOf(pos)] || POS_NAMES[pos] || pos || "";

/** Every school it knows (board schools + the CFB teams list), as { school } rows for names.js. */
export async function schoolRows(ctx) {
  const people = await ctx.people();
  const teams = ctx.teams ? await ctx.teams().catch(() => []) : [];
  return [...new Set([...people.map((p) => p.school), ...teams.map((t) => t.school)])].filter(Boolean).map((school) => ({ school }));
}

/**
 * "john doe from florida state, recruit year 2024" → { name, school, recruitYear }.
 * school: the site's name for it, or null when none was said.
 */
export async function parseWho(said, ctx) {
  let t = plain(said);
  let recruitYear = null;
  const ry = t.match(/,? (?:recruit(?:ing)? (?:year|class)|signing class|signed in) (20\d\d)$/);
  if (ry) { recruitYear = ry[1]; t = t.slice(0, ry.index).trim(); }
  const rows = await schoolRows(ctx);
  const at = splitSchool(t, rows);
  if (at?.name) return { name: at.name, school: at.school, recruitYear };
  return { name: t, school: null, recruitYear };
}

/** His CFBD roster row → { row, roster } | { choices: [row] } | null. */
export async function findOnCfbd({ name, school }, ctx, { anySchool = false } = {}) {
  let rows = [];
  let rosters = [];
  if (school && ctx.cfbdRoster) {
    const r = await ctx.cfbdRoster(school).catch(() => null);
    if (r) rosters = [r];
  } else if (anySchool && ctx.cfbdAllRosters) {
    rosters = await ctx.cfbdAllRosters().catch(() => []);
  }
  rosters.forEach((r) => (r.players || []).forEach((p) => rows.push({ ...p, id: String(p.id), school: r.school || school, team: r.team, teamId: r.teamId, rosterId: r.id })));
  if (!rows.length) return null;
  const f = findPlayer(name, rows);
  if (f.player) return { row: f.player, roster: rosters.find((r) => r.id === f.player.rosterId) || rosters[0] };
  if (f.choices) return { choices: f.choices };
  return null;
}

/** On We-Draft.com already? (the board's people — the active draft classes). */
export async function onWeDraft({ name, school }, ctx) {
  const people = await ctx.people();
  const f = findPlayer(name, school ? people.filter((p) => p.school === school) : people);
  return f.player && (!school || f.player.school === school) && f.score >= 0.9 ? f.player : null;
}

/**
 * The offer for a player who isn't on We-Draft.com: a confirm reply (Reply
 * with confirm), or a plain reply when there's nothing to offer.
 * hit: findOnCfbd's { row, roster } or null; who: parseWho's result.
 */
// lead: the opening sentence, when the caller has its own ("…so I can't save that for him.").
export async function offerFor(who, hit, ctx, mode, { recruitYear = null, lead: leadIn = "" } = {}) {
  const row = hit?.row || null;
  const school = row?.school || who.school;
  const display = row ? nameOfRow(row) : titleCase(who.name);
  const pos = row ? posNameOf(row.pos) : "";
  const roster = row ? `${school} has ${display} on its roster${pos ? ` as ${/^[aeiou]/i.test(pos) ? "an" : "a"} ${pos}` : ""}.` : "";
  const onRoster = leadIn ? "" : roster;
  if (mode === "admin") {
    if (!row) return { say: `${display} isn't on We-Draft.com, and I don't see him on ${school ? `${school}'s` : "a"} CFBD roster, so I can't add him by voice.`, tone: "miss", gap: "add-not-on-cfbd" };
    const plan = await ctx.planCfbdAdd(row, { recruitYear });
    if (!plan.recruitYear) return { say: `${leadIn || roster} CFBD doesn't have his recruiting class. Say it with the year, like "add ${display} from ${school}, recruit year 2024".`, tone: "ask" };
    return {
      confirm: {
        say: `${leadIn || `${display} isn't on We-Draft.com. ${onRoster}`} Add him as ${/^[aeiou]/i.test(posNameOf(plan.pos)) ? "an" : "a"} ${posNameOf(plan.pos)} in the ${plan.eligible} class, recruit year ${plan.recruitYear}?`,
        title: `Add ${display}`, sub: `${school} · ${plan.pos} · ${plan.eligible} class`,
        rows: [["School", school], ["Position", plan.pos], ["Draft class", plan.eligible], ["Recruit year", plan.recruitYear], ["CFBD id", row.id]],
        change: { scope: "New We-Draft.com player", items: [{ label: display, from: "", to: `${school} · ${plan.pos} · ${plan.eligible} class` }], isNew: true },
        apply: async () => {
          const p = await ctx.addFromCfbd(row, hit.roster, plan);
          return { say: `Added ${display} to We-Draft.com: ${school}, ${posNameOf(plan.pos)}, ${plan.eligible} class.`, title: display, sub: `${school} · ${plan.pos} · ${plan.eligible}`, player: p, change: { scope: "New We-Draft.com player", items: [{ label: display, from: "", to: `${school} · ${plan.pos} · ${plan.eligible} class` }], isNew: true, saved: true }, tone: "done" };
        },
      },
    };
  }
  if (!ctx.uid) return { say: `${leadIn || `${display} isn't on We-Draft.com yet. ${onRoster}`} Sign in and I can ask We-Draft.com to add him.`.replace(/\s+/g, " ").trim(), tone: "miss", gap: "not-on-wedraft" };
  if (!school) return { say: `${display} isn't on We-Draft.com. Which school is he at? Say "request ${display} from" and the school.`, tone: "ask", gap: "not-on-wedraft" };
  const lead = leadIn || (row ? `${display} isn't on We-Draft.com yet. ${onRoster}` : `${display} isn't on We-Draft.com, and I don't see him on ${school}'s roster.`);
  return {
    confirm: {
      say: `${lead} Want me to ask We-Draft.com to add him?`,
      title: `Request ${display}`, sub: [school, pos].filter(Boolean).join(" · "),
      apply: async () => {
        await ctx.requestPlayer({ playerName: display, school, position: row?.pos ? groupOf(row.pos) || row.pos : "", cfbdId: row?.id || null });
        return { say: phrase(ctx, "request.sent"), title: `Requested ${display}`, sub: school, tone: "done" };
      },
    },
  };
}

const titleCase = (s) => String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * A We-Draft.com action (saving a grade / note / watchlist entry, his rank,
 * his evaluations, "is he on We-Draft.com?") for a CFBD-only player — the
 * only time it offers to request him (admin: to add him). User, 2026-11-25:
 * his stats and facts just play. kind: "save" | "status".
 */
export async function notOnWeDraft(p, kind, ctx, mode) {
  const name = `${p.first || p.First || ""} ${p.last || p.Last || ""}`.trim();
  if (p.onWeDraft) return { say: `${name} has a We-Draft.com page, but he isn't in the draft classes I work with yet.`, tone: "miss", gap: "older-class" };
  const hit = ctx.cfbdRosterRow ? await ctx.cfbdRosterRow(p).catch(() => null) : null;
  const lead = kind === "save" ? `${name} isn't on We-Draft.com yet, so I can't save that for him.` : `${name} isn't on We-Draft.com yet.`;
  return offerFor({ name, school: p.school || p.School }, hit, ctx, mode === "admin" ? "admin" : "general", { lead });
}
