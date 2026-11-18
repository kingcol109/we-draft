// src/utils/portalSim/staff.js
//
// Your coaching staff's voice (user, 2026-11-18) — the words for what the
// engine's staff already decided (engine "Coaching staffs": staffRecs). Pure.
//   ROLE_TITLE / ROLE_SHORT   Head Coach, Off. Coordinator …
//   recHeadline(state, rec)   a short tag: "Replace Robinson", "Upgrade" …
//   recQuote(state, pid, rec) the coach's line: "Losing Duce Robinson to the
//                             NFL was big. Dallas Wilson can help us replace
//                             him." — plus close to home / wide open
//   marketReport(state, slug) Market Watch's halftime report (user,
//                             2026-11-18): the first half's signings and
//                             misses, the head coach's read ("We filled the
//                             need at quarterback with Brad Jackson. Now we
//                             need to focus on the line."), the priorities
//                             for the second half
//   briefing(state, slug)     the head coach's read when the portal opens:
//                             { intro, priorities: [{ pos, level, lost, have,
//                             goal }] } — positions by need, what was lost
// Wording varies by player but never changes within a run (hash of his id).
import { needsOf, STAFF_ROLES } from "./engine.js";

export { STAFF_ROLES };
export const ROLE_TITLE = { HC: "Head Coach", OC: "Offensive Coordinator", DC: "Defensive Coordinator", OA: "Offensive Assistant", DA: "Defensive Assistant" };
export const ROLE_SHORT = { HC: "Head Coach", OC: "Off. Coordinator", DC: "Def. Coordinator", OA: "Off. Assistant", DA: "Def. Assistant" };
export const ROLE_COLOR = { HC: "#f6a21d", OC: "#4da3ff", DC: "#ff7a6b", OA: "#8fc6ff", DA: "#ffaa9f" };

const POS_WORD = { QB: "quarterback", RB: "running back", WR: "receiver", TE: "tight end", OL: "offensive lineman", DL: "defensive lineman", EDGE: "edge rusher", LB: "linebacker", DB: "defensive back", K: "kicker", P: "punter" };
const POS_PLURAL = { QB: "quarterbacks", RB: "running backs", WR: "receivers", TE: "tight ends", OL: "offensive linemen", DL: "defensive linemen", EDGE: "edge rushers", LB: "linebackers", DB: "defensive backs", K: "kickers", P: "punters" };
export const posWord = (pos) => POS_WORD[pos] || pos;
export const posPlural = (pos) => POS_PLURAL[pos] || `${pos}s`;

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const pick = (list, key) => list[hash(String(key)) % list.length];
const lastName = (n) => String(n || "").split(" ").filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w)).slice(-1)[0] || n;

const HEAD = { hole: "Starter needed", upgrade: "Upgrade", talent: "More talent", depth: "Depth", body: "Numbers", upside: "Upside", target: "Our target", fallback: "Best left" };
export function recHeadline(state, rec) {
  const head = rec.kind === "replace" && rec.lost ? `Replace ${lastName(state.players[rec.lost.pid]?.name)}` : HEAD[rec.kind] || "Target";
  return rec.longshot ? `${head} · Long shot` : head;
}
// What he did last season, when it's worth saying (a real producer).
const n0 = (v) => Math.round(v || 0).toLocaleString("en-US");
function production(p) {
  const s = p.stats;
  if (!s) return "";
  if (p.pos === "QB" && s.passYds >= 1500) return ` He threw for ${n0(s.passYds)} yards and ${s.passTd || 0} touchdowns last season.`;
  if (p.pos === "RB" && s.rushYds >= 600) return ` He ran for ${n0(s.rushYds)} yards${s.rushTd ? ` and ${s.rushTd} scores` : ""} last season.`;
  if ((p.pos === "WR" || p.pos === "TE") && s.recYds >= 450) return ` ${s.rec || 0} catches, ${n0(s.recYds)} yards last season.`;
  if ((p.pos === "EDGE" || p.pos === "DL") && s.sacks >= 4) return ` ${s.sacks} sacks${s.tfl ? `, ${s.tfl} TFL` : ""} last season.`;
  if (p.pos === "LB" && s.tkl >= 60) return ` ${s.tkl} tackles last season.`;
  if (p.pos === "DB" && s.int >= 3) return ` ${s.int} interceptions last season.`;
  return "";
}

export function recQuote(state, pid, rec) {
  const p = state.players[pid];
  if (!p || !rec) return "";
  const N = p.name;
  const pos = rec.pos;
  const L = rec.lost ? state.players[rec.lost.pid]?.name : "";
  const k = `${pid}|${rec.kind}`;
  const school = state.teams[p.team]?.school || "his school";
  const recStars = p.rStars || 0;
  let line;
  switch (rec.kind) {
    case "upside":
      line = pick([
        `${N} didn't see the field much at ${school}, but he was a ${recStars >= 4 ? "blue-chip" : `${recStars}-star`} recruit who can make a big jump with us.`,
        `Forget last season — ${N} was a ${recStars ? `${recStars}-star` : "top"} recruit${p.rRank ? ` (No. ${p.rRank} in his class)` : ""}. Give him real reps and the ceiling is huge.`,
        `${N} got buried on ${school}'s depth chart. That's their loss — the talent that made him a ${recStars >= 4 ? "blue-chip" : "top"} recruit is still there.`,
      ], k);
      break;
    case "fallback":
      line = pick([`We missed on the big names at ${pos}. ${N} is the best ${posWord(pos)} left, and he'd play for us.`, `The top ${posPlural(pos)} are gone. ${N} is who I'd go get now — he can help.`, `Let's not leave ${pos} empty-handed. ${N} is a real option.`], k);
      break;
    case "target":
      line = pick([`${N} is one we've had circled for a while. Let's go get him.`, `We've been tracking ${N} — this is our shot.`, `${N} is exactly who we had in mind for this portal.`], k);
      break;
    case "replace":
      // A backup isn't a plug-in: he grows into the role.
      if (p.role !== "starter") {
        line = pick([`Losing ${L} leaves a hole. ${N} hasn't been a full-time starter yet, but he has the tools to grow into that role.`, `${N} played behind people at ${school}. With ${L} gone, he gets his shot here.`], k);
        break;
      }
      line = rec.lost?.why === "nfl"
        ? pick([`Losing ${L} to the NFL was big. ${N} can help us replace him.`, `${L} heading to the draft leaves a hole. ${N} is the kind of ${posWord(pos)} who fills it.`, `We knew ${L} was going pro. ${N} is how we don't miss a beat.`], k)
        : pick([`${L} hitting the portal hurt. ${N} can help us replace him.`, `We lost ${L} to the portal — ${N} is how we get that back.`, `${L} leaving stung. ${N} can step right into that role.`], k);
      break;
    case "hole":
      line = pick([`We don't have a starting ${posWord(pos)} right now. ${N} walks in and starts.`, `There's nobody at ${pos} I'd line up with today. ${N} changes that on day one.`], k);
      break;
    case "upgrade":
      line = pick([`${N} would be an upgrade over anyone we've got at ${pos}.`, `I like our guys, but ${N} starts over them. That's an upgrade.`, `${N} makes us better at ${pos} the minute he signs.`], k);
      break;
    case "talent":
      line = pick([`Our ${pos} room is fine. Fine doesn't win. ${N} raises the bar.`, `We can live with our ${posPlural(pos)} — or we can get ${N} and push them.`, `${N} makes our ${pos} room better the day he shows up.`], k);
      break;
    case "depth":
      line = pick([`We need real bodies behind our starters at ${pos}. ${N} can play for us right away.`, `If one of our ${posPlural(pos)} goes down, we're in trouble. ${N} fixes that.`], k);
      break;
    case "body":
      line = rec.goal
        ? pick([`We're at ${rec.have} ${posPlural(pos)} and we want ${rec.goal}. ${N} gets us closer.`, `We're short on ${posPlural(pos)} — ${rec.have} on the roster, ${rec.goal} is the number. ${N} helps.`], k)
        : `We're thin at ${pos}. ${N} gives us the numbers.`;
      break;
    default:
      line = `${N} fits what we do.`;
  }
  const extra = [];
  if (["replace", "hole", "upgrade", "talent", "target"].includes(rec.kind) && p.role !== "reserve" && p.role !== "none") extra.push(production(p));
  if (rec.longshot) extra.push(pick([" He's a long shot, but the risk is worth the reward.", " It's a long shot — but if we land him, it changes everything.", " Long shot? Sure. Worth a swing."], `${k}|l`));
  if (rec.miles != null && rec.miles <= 200) extra.push(pick([` He grew up ${rec.miles} miles from campus.`, ` He's from ${rec.miles} miles down the road — kids like that want to come home.`, ` Hometown kid: ${rec.miles} miles away.`], `${k}|m`));
  if (rec.rivals != null && rec.rivals <= 1) extra.push(rec.rivals === 0 ? " Nobody else is on him yet — get in early." : " Only one other school is on him so far.");
  return line + extra.join("");
}

// The head coach's read when the portal opens (right after the NFL and
// departures are set): positions by need — most urgent first, then the
// ones that matter most — with what each lost and its numbers.
const LEVEL_ORDER = [3, 2, 1];
export function briefing(state, slug) {
  const needs = needsOf(state, slug);
  const team = state.teams[slug] || {};
  const w = state.cfg.cpu?.posWeight || {};
  const roster = {};
  const lost = {};
  Object.values(state.players).forEach((p) => {
    const here = p.status === "roster" ? p.team : p.status === "committed" ? p.to : null;
    if (here === slug) roster[p.pos] = (roster[p.pos] || 0) + 1;
    if (p.team === slug && (p.status === "declared" || p.status === "portal" || p.status === "unsigned" || (p.status === "committed" && p.to !== slug)) && p.reason !== "exhausted" && (p.role === "starter" || p.stars >= 4)) {
      (lost[p.pos] = lost[p.pos] || []).push(p);
    }
  });
  const priorities = Object.entries(needs).filter(([, v]) => v >= 1)
    .sort((a, b) => LEVEL_ORDER.indexOf(a[1]) - LEVEL_ORDER.indexOf(b[1]) || (w[b[0]] ?? 1) - (w[a[0]] ?? 1))
    .map(([pos, level]) => ({ pos, level, lost: (lost[pos] || []).sort((a, b) => b.stars - a.stars), have: roster[pos] || 0, goal: team.portalTarget?.[pos] ?? null }));
  const bigLosses = Object.values(lost).flat().sort((a, b) => b.stars - a.stars);
  const top = priorities.filter((x) => x.level === 3).map((x) => x.pos);
  const intro = bigLosses.length
    ? `We lost ${bigLosses.length} player${bigLosses.length === 1 ? "" : "s"} who mattered${bigLosses[0] ? `, ${bigLosses[0].name} the biggest` : ""}. ${top.length ? `${top.slice(0, 3).join(", ")} ${top.length === 1 ? "is" : "are"} where I want us to start.` : "We can reload — here's where I want us to focus."}`
    : top.length ? `We held onto our core. Now let's get better — ${top.slice(0, 3).join(", ")} first.` : "We're in good shape. Let's add talent where we can.";
  return { intro, priorities };
}

// ── Market Watch: the halftime report ──
// What the line is called when it's the next focus.
const FOCUS = { OL: "the offensive line", DL: "the defensive line", EDGE: "the edge", DB: "the secondary", LB: "linebacker", QB: "quarterback", RB: "running back", WR: "receiver", TE: "tight end", K: "kicker", P: "punter" };
export function marketReport(state, slug) {
  const needs = needsOf(state, slug);
  const open = state.needsOpen?.[slug] || {};
  const w = state.cfg.cpu?.posWeight || {};
  const byWeight = (a, b) => (w[b] ?? 1) - (w[a] ?? 1);
  // Signed: everyone who signed here from somewhere else (best first).
  const signed = Object.values(state.players).filter((p) => p.status === "committed" && p.to === slug && p.team !== slug)
    .sort((a, b) => b.stars - a.stars || (b.deal?.nil || 0) - (a.deal?.nil || 0));
  // Missed: players you offered who signed somewhere else.
  const seen = new Set();
  const missed = state.log.filter((e) => e.kind === "committed" && e.to !== slug && e.offeredBy?.includes(slug))
    .map((e) => state.players[e.pid]).filter((p) => p && !seen.has(p.id) && seen.add(p.id))
    .sort((a, b) => b.stars - a.stars);
  const lines = [];
  const said = new Set();
  // Filled (or started on) — by how much the position matters.
  const signedPos = [...new Set(signed.map((p) => p.pos))].sort(byWeight);
  signedPos.forEach((pos) => {
    const best = signed.find((p) => p.pos === pos);
    const k = `${slug}|${pos}`;
    if ((needs[pos] ?? 0) <= 1) {
      lines.push((open[pos] ?? 0) >= 2
        ? pick([`We filled the need at ${posWord(pos)} with ${best.name}.`, `${best.name} takes care of ${posWord(pos)}. That one's handled.`], k)
        : pick([`${best.name} gives us a real piece at ${pos}.`, `Good get on ${best.name} at ${pos}.`], k));
    } else lines.push(pick([`We added ${best.name} at ${pos}, but we're not done there.`, `${best.name} helps at ${pos} — we still need more.`], k));
    said.add(pos);
  });
  // Missed, and still a need.
  [...new Set(missed.map((p) => p.pos))].sort(byWeight).forEach((pos) => {
    if (said.has(pos) || (needs[pos] ?? 0) < 2) return;
    const m = missed.find((p) => p.pos === pos);
    const k = `${slug}|m|${pos}`;
    lines.push(pick([
      `We missed on ${posWord(pos)} in the first window${m ? ` — ${m.name} went to ${state.teams[m.to]?.school}` : ""}. Let's make sure we grab one this time around.`,
      `Losing out on ${m ? m.name : `a ${posWord(pos)}`} stung. We can't leave this portal without a ${posWord(pos)}.`,
    ], k));
    said.add(pos);
  });
  // The second half's priorities: what's still a real need, most urgent
  // first, then the positions that matter most.
  const priorities = Object.entries(needs).filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1] || byWeight(a[0], b[0])).map(([pos, level]) => ({ pos, level }));
  const next = priorities.find((x) => !said.has(x.pos)) || priorities[0];
  if (!lines.length) lines.push(next ? `Quiet first half. That changes now — ${FOCUS[next.pos] || posPlural(next.pos)} first.` : "We're in good shape. Let's keep adding talent where we can.");
  else if (next) lines.push(pick([`Now we need to focus on ${FOCUS[next.pos] || posPlural(next.pos)}.`, `Next up: ${FOCUS[next.pos] || posPlural(next.pos)}.`], `${slug}|next`));
  else lines.push("We're in good shape. Let's keep adding where it helps.");
  return { signed, missed, lines, priorities };
}
