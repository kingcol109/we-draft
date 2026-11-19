// src/utils/recruitSim/suggest.js
//
// Build your board — advice from your staff, not a spreadsheet (user,
// 2026-11-18). Only recruits your staff has actually seen (scouted, met or
// recommended), refreshed every window. Each pick comes from one staffer —
// the scout who just saw him, the coach who fell for him, or the scout who
// covers his side of the ball — with the reason he'd give you, in his words,
// built from what your staff actually knows (never hidden values):
//   talent    your staff's estimate (uncovered grades, public rating where
//             unknown) + recommendations + a known potential / season trend
//   realism   how attainable he looks for a program your size and, once
//             you've had contact, where you stand with him
//   need      your class plan by position, less commits and board players
//   closeness distance to campus
import { evaluate, placeOf, fallWeek, seenByUser } from "./model.js";
import { POSITIONS, KT, TRAIT_MAP, K_EXACT, K_UNKNOWN, POT_SLOT, isRange, rangeCode, rangeLabel, gradeOf } from "./traits.js";
import { REC_BIT } from "./work.js";
import { expectedJump, trendOf } from "./development.js";
import { miles } from "./regions.js";
import { hash } from "./rng.js";

// Which scouts looked at him this window.
function feedInfo(state) {
  const reps = state.reports || [];
  const last = reps[reps.length - 1];
  const by = new Map();
  if (last) ["HS", "OS", "DS"].forEach((role) => (last.staff?.[role]?.scouted || []).forEach(([r]) => { by.set(r, [...(by.get(r) || []), role]); }));
  return { by };
}

// Your class plan (same shape the CPU uses), scaled to the class limit.
export function positionNeeds(state, s = state.user) {
  const sc = state.schools[s];
  const plan = state.cfg.cpu.plan;
  const tot = Object.values(plan).reduce((a, b) => a + b, 0);
  const scale = state.cfg.classLimit / tot;
  const count = (list) => { const m = {}; list.forEach((r) => { const p = state.recruits[r].pos; m[p] = (m[p] || 0) + 1; }); return m; };
  const commits = count(sc.commits);
  const board = count(sc.board);
  return POSITIONS.map((p) => {
    const want = Math.max(1, Math.round(plan[p] * scale));
    return { pos: p, want, commits: commits[p] || 0, board: board[p] || 0, open: Math.max(0, want - (commits[p] || 0)) };
  });
}

// The public rating band a tier usually lands (sweet spot ± width).
const SWEET = { 1: [91, 6], 2: [87.5, 5.5], 3: [84, 5], 4: [80.5, 5], 5: [78, 5] };
const OFF = new Set(["QB", "RB", "WR", "TE", "OL"]);
const POS_WORD = { QB: "quarterback", RB: "back", WR: "receiver", TE: "tight end", OL: "lineman", EDGE: "edge", DL: "D-lineman", LB: "linebacker", DB: "DB" };

// His best trait your staff has a read on (exact first, then ranges).
function bestKnown(state, u, x) {
  const base = (u * state.N + x.i) * KT;
  let best = null;
  TRAIT_MAP[x.pos].forEach(([name], i) => {
    const k = state.know[base + i];
    if (k === K_EXACT) { const v = x.t[i]; if (!best || best.exact === false || v > best.v) best = { name, label: gradeOf(v, state.cfg.gradeCuts), v, exact: true }; } else if (isRange(k) && (!best || (!best.exact && rangeCode(k) < best.code))) best = { name, label: rangeLabel(rangeCode(k)), code: rangeCode(k), exact: false, v: 0 };
  });
  return best;
}
const knownCount = (state, u, x) => {
  const base = (u * state.N + x.i) * KT;
  let n = 0;
  for (let i = 0; i < TRAIT_MAP[x.pos].length; i += 1) if (state.know[base + i] !== K_UNKNOWN) n += 1;
  return n;
};

// The reasons, strongest first — each is a headline and a line in the
// staffer's voice. pick() keeps the wording varied but stable per window.
const HEAD = { coach: "Coach's guy", ceiling: "High ceiling", riser: "Senior-season riser", gem: "Hidden gem", leaning: "Leaning our way", need: "Fills a need", local: "In our backyard", alone: "Wide open", fit: "Worth a look", reach: "Reach" };
function lines(kind, f) {
  const n = f.first;
  switch (kind) {
    case "coach": return [
      `I can't stop thinking about ${n}. Put him on the board and let me go get him.`,
      `${n} is my guy. I've seen enough — he's better than where they've got him ranked.`,
      `Trust me on ${n}. I want to be the one recruiting him.`,
    ];
    case "ceiling": return [
      `I've seen a lot of kids. ${n} hasn't scratched the surface yet — that's a big jump coming.`,
      `This one's about where he'll be, not where he is. ${n}'s ceiling is real.`,
      `Get ${n} in our building and he's a different player in two years.`,
    ];
    case "riser": return [
      `${n}'s senior tape is better every week. The rankings haven't caught up yet.`,
      `Whatever ${n} did this offseason, it's working. He's taking off.`,
      `Watched ${n} again Friday. He's not the same kid we saw in the spring.`,
    ];
    case "gem": return [
      `I don't care that he's No. ${f.rank}. ${f.trait ? `His ${f.trait.name.toLowerCase()} grades out ${f.trait.label}. ` : ""}This is a player.`,
      `${n} is the best ${POS_WORD[f.pos]} nobody's talking about${f.trait ? ` — ${f.trait.name.toLowerCase()}, ${f.trait.label}` : ""}.`,
      `The websites missed on ${n}. ${f.trait ? `${f.trait.name}: ${f.trait.label}. ` : ""}Get in early before everyone figures it out.`,
    ];
    case "leaning": return [
      `${n} keeps asking about us. We're in great shape — let's make it official.`,
      `We're No. 1 for ${n} right now. Don't let anybody sneak in.`,
    ];
    case "alone": return [
      `Nobody else is really on ${n}. We could have this one wrapped up quick.`,
      `${f.rivals ? `Only ${f.rivals} other program${f.rivals > 1 ? "s are" : " is"} in on ${n}` : `Nobody's offered ${n} yet`}. Low competition, real upside.`,
    ];
    case "need": return [
      `We've got ${f.need.commits} of ${f.need.want} at ${f.pos}. ${n} fills that${f.trait ? ` — ${f.trait.name.toLowerCase()} ${f.trait.label}` : ""}.`,
      `We need ${POS_WORD[f.pos]}s. ${n} is the best one I've seen that we can actually get.`,
    ];
    case "local": return [
      `${n} is ${f.dist} miles down the road. We should own our backyard.`,
      `Hometown kid — ${f.city}. ${f.dist} miles. He grew up watching us.`,
    ];
    case "reach": return [
      `${n}'s a long shot for us. But if we're going to swing big, swing here.`,
    ];
    default: return [
      `${n} fits what we do. Worth a spot on the board.`,
      `Solid ${POS_WORD[f.pos]}${f.trait ? ` — ${f.trait.name.toLowerCase()} ${f.trait.label}` : ""}. I'd keep him in the mix.`,
    ];
  }
}

export function suggestions(state, { limit = 40, pos = null } = {}) {
  const u = state.user;
  const sc = state.schools[u];
  const N = state.N;
  const needs = Object.fromEntries(positionNeeds(state).map((n) => [n.pos, n]));
  const [sweet, width] = SWEET[sc.tier] || SWEET[3];
  const onBoard = new Set(sc.board);
  const feed = feedInfo(state);
  const wk = fallWeek(state);
  const out = [];
  state.recruits.forEach((x) => {
    if (x.commit >= 0 || x.status === "unsigned" || onBoard.has(x.i)) return;
    if (pos && x.pos !== pos) return;
    // Scout-curated: only kids your staff has eyes on.
    if (!seenByUser(state, x.i)) return;
    if (x.list && !x.list.includes(u)) return; // he's moved on from you
    if (x.announce && !x.announce.list.includes(u)) return;
    const nd = needs[x.pos];
    const posRoom = nd.open - nd.board;
    if (posRoom <= -2) return;
    const { est, known } = evaluate(state, u, x.i);
    const rec = state.recMask[u * N + x.i];
    // Realism: public rating vs your band; contact sharpens it.
    let real = x.rating <= sweet ? Math.exp(-Math.pow(Math.max(0, sweet - width - x.rating) / 8, 2)) : Math.exp(-Math.pow((x.rating - sweet) / width, 2));
    const [place] = placeOf(x, u);
    if (state.intel[x.i] >= 1) real = place === 1 ? Math.max(real, 0.95) : place && place <= 3 ? Math.max(real, 0.7) : place ? real * 0.85 : real * 0.5;
    const rivals = state.schools.reduce((a, o, t) => a + (t !== u && o.board.includes(x.i) ? 1 : 0), 0);
    if (rivals <= 1) real = Math.min(1, real * 1.15);
    const dist = Math.round(miles(sc.loc, x.loc));
    const near = dist < 250 ? 1.12 : dist < 600 ? 1.04 : 1;
    const needF = posRoom > 0 ? 1 + Math.min(posRoom, 3) * 0.08 : 0.75;
    const fresh = feed.by.get(x.i);
    const potKnown = !!state.know[(u * N + x.i) * KT + POT_SLOT];
    const jump = potKnown ? expectedJump(state.cfg, x.pot) : 0;
    const tr = wk ? trendOf(state, x, wk) : null;
    const trendUp = tr && tr.dir > 0 ? tr.dir : 0;
    const talent = est + (rec ? 1.5 : 0) + jump + trendUp * 0.8;
    const score = Math.pow(Math.max(0, talent - 60), 2) * real * near * needF * (fresh ? 1.05 : 1);
    if (score <= 0) return;
    // The reason he'd give you, strongest first.
    const trait = bestKnown(state, u, x);
    const kinds = [];
    if (rec) kinds.push("coach");
    if (potKnown && jump >= 1.5) kinds.push("ceiling");
    if (trendUp) kinds.push("riser");
    if (known >= 0.4 && est - x.rating >= 2.5) kinds.push("gem");
    if (state.intel[x.i] && place === 1) kinds.push("leaning");
    if (rivals <= 1 && state.intel[x.i]) kinds.push("alone");
    if (posRoom > 0 && nd.commits < nd.want) kinds.push("need");
    if (dist < 200) kinds.push("local");
    if (x.rating > sweet + width) kinds.push("reach");
    if (!kinds.length) kinds.push("fit");
    const kind = kinds[0];
    // Who's telling you: the coach who fell for him, the scout who saw him
    // this week, or the scout for his side of the ball.
    const recRole = rec ? Object.entries(REC_BIT).find(([, b]) => rec & b)?.[0] : null;
    const voice = kind === "coach" && recRole ? recRole : fresh ? fresh[0] : x.rating >= 90 ? "HS" : OFF.has(x.pos) ? "OS" : "DS";
    const f = { first: x.first, pos: x.pos, rank: x.rank, trait, need: nd, dist, city: x.city, rivals };
    const opts = lines(kind, f);
    const quote = opts[hash(`${x.i}|${state.stage}|${kind}`) % opts.length];
    // Supporting facts — short chips under the quote.
    const facts = [];
    if (trait) facts.push(`${trait.name} ${trait.label}`);
    if (kinds.includes("need") && kind !== "need") facts.push(`Need at ${x.pos}`);
    if (dist < 400 && kind !== "local") facts.push(`${dist} mi`);
    if (state.intel[x.i] && place && kind !== "leaning") facts.push(place === 1 ? "We lead" : `We're No. ${place}`);
    facts.push(rivals ? `${rivals} other school${rivals > 1 ? "s" : ""} on him` : "Nobody else on him");
    const sure = knownCount(state, u, x) / TRAIT_MAP[x.pos].length;
    out.push({
      r: x.i, score, kind, head: HEAD[kind], voice, quote, facts: facts.slice(0, 4), known, fresh: fresh || null,
      rising: (potKnown && jump >= 1.5) || trendUp > 0, confidence: sure >= 0.7 ? "High" : sure >= 0.35 ? "Medium" : "Low",
      // Older callers.
      why: [HEAD[kind], ...facts.slice(0, 2)],
    });
  });
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
