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
// Wording varies by player AND by run (hash of his id + the run's seed —
// user, 2026-11-22: "coach messages always feel the same"), but never
// changes within a run.
//   ODDS                       a pick's odds (user, 2026-11-22): Long shot /
//                              Realistic / Fallback — label, color, blurb
import { needsOf, planWants, STAFF_ROLES } from "./engine.js";

export { STAFF_ROLES };
export const ROLE_TITLE = { HC: "Head Coach", OC: "Offensive Coordinator", DC: "Defensive Coordinator", OA: "Offensive Assistant", DA: "Defensive Assistant" };
export const ROLE_SHORT = { HC: "Head Coach", OC: "Off. Coordinator", DC: "Def. Coordinator", OA: "Off. Assistant", DA: "Def. Assistant" };
export const ROLE_COLOR = { HC: "#f6a21d", OC: "#4da3ff", DC: "#ff7a6b", OA: "#8fc6ff", DA: "#ffaa9f" };

const POS_WORD = { QB: "quarterback", RB: "running back", WR: "receiver", TE: "tight end", OL: "offensive lineman", DL: "defensive lineman", EDGE: "edge rusher", LB: "linebacker", DB: "defensive back", K: "kicker", P: "punter" };
const POS_PLURAL = { QB: "quarterbacks", RB: "running backs", WR: "receivers", TE: "tight ends", OL: "offensive linemen", DL: "defensive linemen", EDGE: "edge rushers", LB: "linebackers", DB: "defensive backs", K: "kickers", P: "punters" };
export const posWord = (pos) => POS_WORD[pos] || pos;
export const posPlural = (pos) => POS_PLURAL[pos] || `${pos}s`;
// "a quarterback", "an offensive lineman", "an edge rusher".
export const aPos = (pos) => { const w = posWord(pos); return `${/^[aeiou]/i.test(w) ? "an" : "a"} ${w}`; };

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const pick = (list, key) => list[hash(String(key)) % list.length];
// A run's own pick: the same key reads differently from run to run.
const say = (state, list, key) => pick(list, `${state?.seed ?? 0}|${key}`);
const lastName = (n) => String(n || "").split(" ").filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w)).slice(-1)[0] || n;

const HEAD = { hole: "Starter needed", upgrade: "Upgrade", talent: "More talent", depth: "Depth", body: "Numbers", upside: "Upside", target: "Our target", fallback: "Best left" };
// A pick's odds: Long shot (a reach), Realistic (we can win it), Fallback
// (the safe one — we'd very likely land him).
export const ODDS = {
  longshot: { label: "Long shot", color: "#ff7a6b", blurb: "A reach — the risk is worth the reward." },
  realistic: { label: "Realistic", color: "#f6a21d", blurb: "We can win this one." },
  fallback: { label: "Fallback", color: "#5fd38d", blurb: "The safe play — we'd very likely land him." },
};
export const oddsOf = (rec) => (rec ? rec.odds || (rec.longshot ? "longshot" : rec.kind === "fallback" ? "fallback" : "realistic") : null);
export function recHeadline(state, rec) {
  return rec.kind === "replace" && rec.lost ? `Replace ${lastName(state.players[rec.lost.pid]?.name)}` : HEAD[rec.kind] || "Target";
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
      line = say(state, [
        `${N} didn't see the field much at ${school}, but he was a ${recStars >= 4 ? "blue-chip" : `${recStars}-star`} recruit who can make a big jump with us.`,
        `Forget last season — ${N} was a ${recStars ? `${recStars}-star` : "top"} recruit${p.rRank ? ` (No. ${p.rRank} in his class)` : ""}. Give him real reps and the ceiling is huge.`,
        `${N} got buried on ${school}'s depth chart. That's their loss — the talent that made him a ${recStars >= 4 ? "blue-chip" : "top"} recruit is still there.`,
        `Everybody wanted ${N} out of high school. He just needs a staff that'll play him — that's us.`,
        `I'd bet on the talent over the snap count. ${N} can be a problem for people with real reps.`,
      ], k);
      break;
    case "fallback":
      line = say(state, [`We missed on the big names at ${pos}. ${N} is the best ${posWord(pos)} left, and he'd play for us.`, `The top ${posPlural(pos)} are gone. ${N} is who I'd go get now — he can help.`, `Let's not leave ${pos} empty-handed. ${N} is a real option.`, `Plan B time at ${pos}. ${N} is a good plan B.`, `${N} isn't the flashiest name left, but he's a ballplayer and he'd come here.`], k);
      break;
    case "target":
      line = say(state, [`${N} is one we've had circled for a while. Let's go get him.`, `We've been tracking ${N} — this is our shot.`, `${N} is exactly who we had in mind for this portal.`, `I've watched a lot of ${N} tape. He's our guy.`, `${N} was at the top of our list before the portal even opened.`], k);
      break;
    case "replace":
      // A backup isn't a plug-in: he grows into the role.
      if (p.role !== "starter") {
        line = say(state, [`Losing ${L} leaves a hole. ${N} hasn't been a full-time starter yet, but he has the tools to grow into that role.`, `${N} played behind people at ${school}. With ${L} gone, he gets his shot here.`], k);
        break;
      }
      line = rec.lost?.why === "nfl"
        ? say(state, [`Losing ${L} to the NFL was big. ${N} can help us replace him.`, `${L} heading to the draft leaves a hole. ${N} is the kind of ${posWord(pos)} who fills it.`, `We knew ${L} was going pro. ${N} is how we don't miss a beat.`], k)
        : say(state, [`${L} hitting the portal hurt. ${N} can help us replace him.`, `We lost ${L} to the portal — ${N} is how we get that back.`, `${L} leaving stung. ${N} can step right into that role.`], k);
      break;
    case "hole":
      line = pos === "QB"
        ? say(state, [`We don't have a quarterback. ${N} walks in and runs the offense.`, `You can't win without a quarterback, and right now we don't have one. ${N} fixes that.`, `${N} takes the first snap in camp. That's how big this is.`, `Put ${N} under center and we're a different team.`], k)
        : say(state, [`We don't have a starting ${posWord(pos)} right now. ${N} walks in and starts.`, `There's nobody at ${pos} I'd line up with today. ${N} changes that on day one.`, `${N} is a starter for us the day he arrives — we need one.`, `We have a hole at ${pos}. ${N} fills it.`], k);
      break;
    case "upgrade":
      line = say(state, [`${N} would be an upgrade over anyone we've got at ${pos}.`, `I like our guys, but ${N} starts over them. That's an upgrade.`, `${N} makes us better at ${pos} the minute he signs.`, `We can win with what we have at ${pos}. We win more with ${N}.`, `${N} raises our floor and our ceiling at ${pos}.`], k);
      break;
    case "talent":
      line = say(state, [`Our ${pos} room is fine. Fine doesn't win. ${N} raises the bar.`, `We can live with our ${posPlural(pos)} — or we can get ${N} and push them.`, `${N} makes our ${pos} room better the day he shows up.`, `Competition fixes a lot of things. ${N} brings it.`, `Nobody in our ${pos} room should feel comfortable. ${N} makes sure of that.`], k);
      break;
    case "depth":
      line = say(state, [`We need real bodies behind our starters at ${pos}. ${N} can play for us right away.`, `If one of our ${posPlural(pos)} goes down, we're in trouble. ${N} fixes that.`, `Season's long. ${N} is the kind of depth that saves you in November.`, `${N} gives us a guy we trust at ${pos} when the starter needs a breather.`], k);
      break;
    case "body":
      line = rec.goal
        ? say(state, [`We're at ${rec.have} ${posPlural(pos)} and we want ${rec.goal}. ${N} gets us closer.`, `We're short on ${posPlural(pos)} — ${rec.have} on the roster, ${rec.goal} is the number. ${N} helps.`], k)
        : `We're thin at ${pos}. ${N} gives us the numbers.`;
      break;
    default:
      line = `${N} fits what we do.`;
  }
  const extra = [];
  if (["replace", "hole", "upgrade", "talent", "target"].includes(rec.kind) && p.role !== "reserve" && p.role !== "none") extra.push(production(p));
  const odds = oddsOf(rec);
  if (odds === "longshot") extra.push(say(state, [" He's a long shot, but the risk is worth the reward.", " It's a long shot — but if we land him, it changes everything.", " Long shot? Sure. Worth a swing.", " The odds aren't great. Swing anyway.", " Bigger programs are on him. We'll have to outwork them."], `${k}|l`));
  else if (odds === "fallback" && rec.kind !== "fallback") extra.push(say(state, [" He's our safety net — we should be able to get this one done.", " Not the splashiest name, but we'd land him.", " If the big swings miss, this is the guy.", " Plan B, and a good one."], `${k}|f`));
  if (rec.miles != null && rec.miles < 10) extra.push(say(state, [" He grew up right here.", " He's a hometown kid — he'd be coming home.", " Local kid. Bring him home."], `${k}|m`));
  else if (rec.miles != null && rec.miles <= 200) extra.push(say(state, [` He grew up ${rec.miles} miles from campus.`, ` He's from ${rec.miles} miles down the road — kids like that want to come home.`, ` Close to home: ${rec.miles} miles away.`], `${k}|m`));
  if (rec.rivals != null && rec.rivals <= 1) extra.push(rec.rivals === 0 ? " Nobody else is on him yet — get in early." : " Only one other school is on him so far.");
  return line + extra.join("");
}

// The head coach's read when the portal opens (right after the NFL and
// departures are set): positions by need — most urgent first, then the
// ones that matter most — with what each lost and its numbers.
// User, 2026-11-22: he names only THREE needs (`top`), each with his own
// words — no quarterback → "we have to be aggressive"; the rest stay in
// `priorities` for anyone who wants them.
const LEVEL_ORDER = [3, 2, 1];
const KIND_ORDER = ["hole", "upgrade", "talent", "depth", "body"];
// What a position group is called in a sentence.
const GROUP = { OL: "the offensive line", DL: "the defensive line", EDGE: "the edge", DB: "the secondary", LB: "linebacker", QB: "quarterback", RB: "running back", WR: "receiver", TE: "tight end", K: "kicker", P: "punter" };
function needLine(state, slug, x) {
  const k = `${slug}|need|${x.pos}`;
  const g = GROUP[x.pos] || posPlural(x.pos);
  const L = x.lost[0];
  const short = x.goal != null && x.have < x.goal;
  if (x.pos === "QB" && x.kind === "hole") {
    return say(state, [
      "We don't have a quarterback. Everything else waits — we have to be aggressive here.",
      "No quarterback, no season. This is the one we can't miss on, so we swing big and we have a plan B.",
      "Quarterback is priority one, two and three. We go after the best one we can get and we don't stop.",
      "I'm not walking into camp without a starting quarterback. Be aggressive.",
    ], k);
  }
  if (x.pos === "QB") {
    return say(state, [
      "I want a better quarterback than the one we've got. That's where championships are decided.",
      "Our quarterback room is OK. OK gets you a bowl game — I want more.",
      "If the right quarterback is out there, we go get him.",
    ], k);
  }
  if (L && L.status === "declared") {
    return say(state, [
      `${L.name} going pro leaves a hole at ${g}. Replacing him comes first.`,
      `We knew ${lastName(L.name)} was headed to the league. Now we find the next one.`,
      `Losing ${L.name} to the draft hurts. We need ${aPos(x.pos)} who can carry that load.`,
    ], k);
  }
  if (L) {
    return say(state, [
      `${L.name} walking out the door hurts. We replace him in this portal.`,
      `${lastName(L.name)} left us at ${g}. We have to answer that.`,
      `We lost ${L.name} to the portal. Let's take somebody else's guy.`,
    ], k);
  }
  if (x.kind === "hole") {
    return say(state, [
      `We don't have a starter at ${g}. That gets fixed now.`,
      `There's a hole at ${g} and everybody knows it. Fill it.`,
      `I wouldn't line anybody up at ${g} today. We need a starter.`,
    ], k);
  }
  if (x.kind === "upgrade") {
    return say(state, [
      `We need a better ${posWord(x.pos)} than what we've got.`,
      `Our ${posPlural(x.pos)} aren't good enough to win the games we want to win. Upgrade it.`,
      `${GROUP[x.pos] ? GROUP[x.pos][0].toUpperCase() + GROUP[x.pos].slice(1) : x.pos} is where we lost games last year. Not again.`,
    ], k);
  }
  if (x.kind === "talent") {
    return say(state, [
      `${x.pos} is fine. I don't want fine — bring in somebody who pushes them.`,
      `We can play with our ${posPlural(x.pos)}. We'd rather beat people with them.`,
      `Add real talent at ${g} and the whole room gets better.`,
    ], k);
  }
  return short
    ? say(state, [
      `We're at ${x.have} ${posPlural(x.pos)} and I want ${x.goal}. Get us bodies who can play.`,
      `Numbers at ${g}: ${x.have} on the roster, ${x.goal} is the target.`,
    ], k)
    : say(state, [
      `We need depth at ${g} — one injury and we're in trouble.`,
      `Find me ${aPos(x.pos)} who can play real snaps behind our starters.`,
    ], k);
}
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
  // The most urgent want at each position (a hole beats an upgrade…).
  const kindAt = {};
  try {
    planWants(state, slug).forEach((x) => {
      if (kindAt[x.pos] == null || KIND_ORDER.indexOf(x.kind) < KIND_ORDER.indexOf(kindAt[x.pos])) kindAt[x.pos] = x.kind;
    });
  } catch { /* no wants yet — levels still read */ }
  const priorities = Object.entries(needs).filter(([, v]) => v >= 1)
    .sort((a, b) => LEVEL_ORDER.indexOf(a[1]) - LEVEL_ORDER.indexOf(b[1]) || (w[b[0]] ?? 1) - (w[a[0]] ?? 1))
    .map(([pos, level]) => ({ pos, level, kind: kindAt[pos] || null, lost: (lost[pos] || []).sort((a, b) => b.stars - a.stars), have: roster[pos] || 0, goal: team.portalTarget?.[pos] ?? null }));
  // Kickers and punters only make the three when there's none at all.
  const top = priorities.filter((x) => !((x.pos === "K" || x.pos === "P") && x.have > 0)).slice(0, 3).map((x) => ({ ...x, line: needLine(state, slug, x) }));
  const bigLosses = Object.values(lost).flat().sort((a, b) => b.stars - a.stars);
  const names = top.map((x) => x.pos);
  const list = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const noQb = top.some((x) => x.pos === "QB" && x.kind === "hole");
  const k = `${slug}|intro`;
  let intro;
  if (!names.length) {
    intro = say(state, ["We're in good shape. Let's add talent where we can.", "No fires to put out. That means we get to be picky.", "Roster's solid. Let's find the pieces that put us over the top."], k);
  } else if (noQb) {
    intro = say(state, [
      `Let's not kid ourselves — we need a quarterback. After that it's ${names.filter((p) => p !== "QB").join(" and ") || "everything else"}.`,
      `Three things on the board, and the first one is quarterback. ${list}.`,
      `We have work to do: ${list}. It starts under center.`,
    ], k);
  } else if (bigLosses.length) {
    const big = bigLosses[0];
    intro = say(state, [
      `We lost ${bigLosses.length} player${bigLosses.length === 1 ? "" : "s"} who mattered, ${big.name} the biggest. ${list} — that's where we start.`,
      `${big.name} is gone${bigLosses.length > 1 ? `, and he wasn't the only one` : ""}. Here's the plan: ${list}.`,
      `Every roster loses people. Good ones reload. Our three priorities: ${list}.`,
      `I've seen the board. ${list} — in that order.`,
    ], k);
  } else {
    intro = say(state, [
      `We held onto our core. Now let's get better — ${list}.`,
      `Nobody important left. That's a great spot to be in. Let's attack ${list}.`,
      `We kept our guys. Now we add to them: ${list}.`,
    ], k);
  }
  return { intro, top, priorities };
}

// ── Market Watch: the halftime report ──
// What the line is called when it's the next focus.
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
  const spent = signed.reduce((t, p) => t + (p.deal?.nil || 0), 0);
  const lines = [];
  const said = new Set();
  // Filled (or started on) — by how much the position matters.
  const filled = [];
  const started = [];
  [...new Set(signed.map((p) => p.pos))].sort(byWeight).forEach((pos) => {
    const best = signed.find((p) => p.pos === pos);
    if ((needs[pos] ?? 0) <= 1) filled.push({ pos, best, was: open[pos] ?? 0 });
    else started.push({ pos, best });
    said.add(pos);
  });
  filled.forEach(({ pos, best, was }) => lines.push(was >= 2
    ? say(state, [`We filled the need at ${posWord(pos)} with ${best.name}.`, `${best.name} takes care of ${GROUP[pos] || posWord(pos)}. That one's handled.`, `${GROUP[pos] ? GROUP[pos][0].toUpperCase() + GROUP[pos].slice(1) : pos}? Done — ${best.name}.`], `${slug}|${pos}`)
    : say(state, [`${best.name} gives us a real piece at ${pos}.`, `Good get on ${best.name} at ${pos}.`, `${best.name} at ${pos} is a bonus.`], `${slug}|${pos}`)));
  started.forEach(({ pos, best }) => lines.push(say(state, [`We added ${best.name} at ${pos}, but we're not done there.`, `${best.name} helps at ${pos} — we still need more.`], `${slug}|${pos}`)));
  // Missed, and still a need.
  // Missed, and still a need — one sentence for all of them.
  const missedAt = {};
  [...new Set(missed.map((p) => p.pos))].sort(byWeight).forEach((pos) => {
    if (said.has(pos) || (needs[pos] ?? 0) < 2) return;
    missedAt[pos] = missed.find((p) => p.pos === pos);
    said.add(pos);
  });
  const lostOut = Object.values(missedAt);
  if (lostOut.length) {
    const names = lostOut.map((p) => p.name);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    lines.push(lostOut.length === 1
      ? say(state, [`We missed on ${list} — he went to ${state.teams[lostOut[0].to]?.school}.`, `Losing out on ${list} stung.`, `${list} got away.`], `${slug}|m`)
      : say(state, [`We missed on ${list}.`, `Losing out on ${list} stung.`, `${list} all got away from us.`], `${slug}|m`));
  }
  // The second half's priorities: what's still a real need, most urgent
  // first, then the positions that matter most.
  const priorities = Object.entries(needs).filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1] || byWeight(a[0], b[0])).map(([pos, level]) => ({ pos, level }));
  // The halftime REPORT (user, 2026-11-22: "make it feel like he is giving
  // a report" — the window-1 briefing again): one paragraph (how the first
  // half went, what's handled, what we missed), then his three priorities
  // for the second half, each with his words.
  const k = `${slug}|half`;
  const n = signed.length;
  const opener = !n
    ? say(state, ["Quiet first half. That changes now.", "We didn't land anybody yet. Nobody panics — but we have to close.", "Zero signings so far. The second half is where we earn it."], k)
    : n >= 5
      ? say(state, [`Big first half — ${n} signings, ${money0(spent)} spent.`, `${n} new guys in the building. That's a strong first half.`, `We were busy: ${n} signings for ${money0(spent)}.`], k)
      : say(state, [`Solid start — ${n} signing${n === 1 ? "" : "s"} so far.`, `${n} in the door, ${money0(spent)} spent. We're not done.`, `Good first half. ${n === 1 ? "One signing" : `${n} signings`}, and the board's still full.`], k);
  const pool = briefing(state, slug).priorities.filter((x) => x.level >= 2 && !((x.pos === "K" || x.pos === "P") && x.have > 0));
  const top = pool.slice(0, 3).map((x) => {
    const add = signed.find((p) => p.pos === x.pos);
    const m = missedAt[x.pos] || missed.find((p) => p.pos === x.pos);
    const kk = `${slug}|half|${x.pos}`;
    const g = GROUP[x.pos] || posPlural(x.pos);
    const line = m
      ? say(state, [`We missed on ${m.name}. We can't leave this portal without ${aPos(x.pos)}.`, `${m.name} got away. Let's make sure the next one doesn't.`, `We lost ${lastName(m.name)} to ${state.teams[m.to]?.school || "somebody else"}. Go get the next one.`], kk)
      : add
        ? say(state, [`${add.name} helps, but ${g} still needs more.`, `${lastName(add.name)} was a start at ${g}. Finish the job.`], kk)
        : needLine(state, slug, x);
    return { ...x, line };
  });
  const tail = top.length ? say(state, [`Second half, it's ${top.map((x) => x.pos).join(", ")}.`, `Here's where we go now: ${top.map((x) => x.pos).join(", ")}.`, `From here on: ${top.map((x) => x.pos).join(", ")}.`], `${k}|t`) : "We're in good shape. Let's keep adding where it helps.";
  const intro = [opener, ...lines, tail].join(" ");
  if (!lines.length) lines.push(tail);
  return { signed, missed, lines, priorities, intro, top, spent };
}
const money0 = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round((n || 0) / 1e3)}K`);
