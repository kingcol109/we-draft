// src/utils/recruitSim/cpu.js
//
// CPU schools (spec §23). They play the same game as the user — same
// recruit universe, board / line limits, staff, scouting, interest, NIL cap
// and commitment rules, all through ./actions.js. Nothing is generated
// behind the scenes: a CPU class is whoever it actually wins.
//
// Each window (after the lifecycle pass), every CPU school re-plans:
//   1. evaluate candidates from ITS OWN knowledge (model.evaluate: public
//      rating where it knows nothing, its uncovered grades where it does)
//      plus its staff's taste (bias) and its coaches' recommendations
//   2. utility = value(eval, tier) × pWin^attain × proximity (low tiers) —
//      pWin reads where it stands, whether it can realistically catch up,
//      and whether it's even still on his list
//   3. board: best utilities within a position plan (class needs), keeping
//      current targets unless a replacement is clearly better (no churn);
//      lower tiers sometimes keep one reach for an elite prospect
//   4. line: top N by utility, ranked; NIL offers sized to value and ask,
//      under the budget (with a reserve early)
//   5. staff: coaches on the close races that matter most, scouts on
//      high-value targets it knows little about or out discovering in the
//      region where its targets are
//   6. demands aimed at it: met when the recruit is worth it
import { rngFor, normal, pickWeighted, clamp } from "./rng.js";
import { POSITIONS, OFFENSE } from "./traits.js";
import { REGION_KEYS } from "./regions.js";
import { phaseOf, boardLimits, fallWeek, evaluate, placeOf } from "./model.js";
import { addToBoard, removeFromBoard, setLine, setOffer, assignStaff, nilAvailable } from "./actions.js";
import { ROLES, coverage, bondMult } from "./work.js";
import { knowledgeOf } from "./scouting.js";
import { STAGE_COUNT } from "./config.js";
import { KT, POT_SLOT } from "./traits.js";
import { expectedJump, jumpSoFar } from "./development.js";

// Staff taste, fixed for the save.
export function cpuBias(state, s) {
  const rand = rngFor(state.seed, `bias|${s}`);
  const c = state.cfg.cpu;
  const pos = {};
  POSITIONS.forEach((p) => { pos[p] = normal(rand) * c.biasSd; });
  return { pos, cat: { ins: normal(rand) * c.catBiasSd, tec: normal(rand) * c.catBiasSd, phy: normal(rand) * c.catBiasSd } };
}

// urgency 0..1 (late season × open spots) lowers the bar.
const valueOf = (cpu, tier, est, urgency = 0) => {
  const f = cpu.valueFloor[tier] - cpu.lowerFloor * urgency;
  return est <= f ? 0 : Math.pow((est - f) / (99 - f), cpu.valuePow[tier]);
};
// How pressed a school is: season progress × share of its class still open.
export function urgencyOf(state, s) {
  const open = 1 - state.schools[s].commits.length / state.cfg.classLimit;
  return Math.max(0, Math.min(1, state.stage / (STAGE_COUNT - 1))) * open;
}

// pWin: 0..1 — how realistic it is for school s to sign r.
export function pWinOf(state, s, r) {
  const x = state.recruits[r];
  if (x.commit >= 0 || x.status === "unsigned") return 0;
  if (x.list && !x.list.includes(s)) return 0;
  if (x.announce && !x.announce.list.includes(s)) return 0;
  const cpu = state.cfg.cpu;
  const N = state.N;
  const fr = state.derived.fitRank[s * N + r];
  const prior = 1 / Math.pow(1 + fr / cpu.priorDiv, cpu.priorPow);
  const top = x.top || [];
  const leader = top[0]?.[1] || 0;
  const [place, mine] = placeOf(x, s);
  // Live read: his own decision rule (lifecycle decide) over the schools
  // near the top — tied with ten others is a 1-in-11 shot, not a lead.
  let live = prior;
  if (leader > 0) {
    const sharp = state.cfg.lifecycle.sharp;
    let den = 0;
    top.slice(0, 8).forEach(([, v]) => { den += Math.exp(sharp * (v / leader - 1)); });
    const me = place ? Math.exp(sharp * (mine / leader - 1)) : 0;
    live = me / (den + (place && place <= 8 ? 0 : me));
  }
  const w = leader / (leader + 25);
  let p = (1 - w) * prior + w * live;
  // Can it realistically catch up before he decides?
  const leadI = top[0] ? state.interest[top[0][0] * N + r] : 0;
  const myI = state.interest[s * N + r];
  const left = Math.max(1, STAGE_COUNT - 1 - state.stage);
  if (leadI - myI > left * cpu.catchUpGain) p *= cpu.catchUpCut ?? 0.1;
  return clamp(p, 0, 1);
}

// Position plan: signings still wanted at each position.
function needs(state, s) {
  const sc = state.schools[s];
  const plan = state.cfg.cpu.plan;
  const tot = Object.values(plan).reduce((a, b) => a + b, 0);
  const scale = state.cfg.classLimit / tot;
  const have = {};
  sc.commits.forEach((r) => { const p = state.recruits[r].pos; have[p] = (have[p] || 0) + 1; });
  const out = {};
  POSITIONS.forEach((p) => { out[p] = Math.max(0, plan[p] * scale - (have[p] || 0)); });
  return out;
}

// Score candidates for school s → [{ r, u, v, p, est, known }] best first.
function candidates(state, s) {
  const sc = state.schools[s];
  const cpu = state.cfg.cpu;
  const N = state.N;
  const tier = sc.tier;
  const df = state.derived.distFit;
  const urg = urgencyOf(state, s);
  const attain = cpu.attain[tier] + cpu.attainLate * urg;
  // Quick pass over everyone open: public rating + taste, prior, proximity.
  const quick = [];
  for (let r = 0; r < N; r += 1) {
    const x = state.recruits[r];
    if (x.commit >= 0 || x.status === "unsigned") continue;
    if (x.list && !x.list.includes(s)) continue;
    const v = valueOf(cpu, tier, x.rating + (sc.bias.pos[x.pos] || 0) + (state.recMask[s * N + r] ? 2 : 0), urg);
    if (v <= 0 && !sc.board.includes(r)) continue;
    const prior = 1 / Math.pow(1 + state.derived.fitRank[s * N + r] / cpu.priorDiv, cpu.priorPow);
    const dist = 1 - cpu.distPull[tier] * (1 - df[s * N + r]);
    quick.push([r, v * Math.pow(prior, attain) * dist + state.interest[s * N + r] * 0.002]);
  }
  quick.sort((a, b) => b[1] - a[1]);
  const pool = new Set(quick.slice(0, cpu.candidates).map(([r]) => r));
  sc.board.forEach((r) => pool.add(r));
  const out = [];
  pool.forEach((r) => {
    const x = state.recruits[r];
    if (x.commit >= 0 || x.status === "unsigned") return;
    const ev = evaluate(state, s, r, sc.bias);
    const known = ev.known;
    // A potential it has uncovered counts: it's the jump he'll make. Short
    // of that, his senior season so far (if it's seen him at all).
    const est = ev.est + (state.know[(s * N + r) * KT + POT_SLOT] ? expectedJump(state.cfg, x.pot) : known > 0 ? 0.8 * jumpSoFar(state, x) : 0);
    const v = valueOf(cpu, tier, est + (state.recMask[s * N + r] ? 1.5 : 0), urg);
    const p = pWinOf(state, s, r);
    const dist = 1 - cpu.distPull[tier] * (1 - df[s * N + r]);
    out.push({ r, pos: x.pos, est, known, v, p, u: v * Math.pow(p, attain) * dist });
  });
  out.sort((a, b) => b.u - a.u);
  return out;
}

export function cpuPlan(state, s) {
  const sc = state.schools[s];
  const phase = phaseOf(state);
  if (phase === "done") return;
  const rand = rngFor(state.seed, `cpu|${state.stage}|${s}`);
  const lim = boardLimits(state);
  const cpu = state.cfg.cpu;
  const full = sc.commits.length >= state.cfg.classLimit;
  const cands = full ? [] : candidates(state, s);
  const byR = new Map(cands.map((c) => [c.r, c]));

  // ── Board ──
  if (lim.size) {
    const need = needs(state, s);
    const cap = {};
    POSITIONS.forEach((p) => { cap[p] = need[p] > 0.2 ? Math.ceil(need[p] * cpu.boardPerPlan) + 1 : 0; });
    // Reach: a low tier keeps one elite prospect it has a shot with.
    if (cpu.reach[sc.tier] && sc.reach == null) {
      const elite = cands.filter((c) => state.recruits[c.r].rating >= 93 && c.p > 0.05).sort((a, b) => state.derived.distFit[s * state.N + b.r] - state.derived.distFit[s * state.N + a.r]);
      sc.reach = elite.length && rand() < cpu.reachChance ? elite[0].r : -1;
    }
    // Stickier boards (user, 2026-11-18: schools dropped out too easily).
    const keepBonus = (c) => {
      if (!sc.board.includes(c.r)) return c.r === sc.reach ? 3 : 1;
      const x = state.recruits[c.r];
      return cpu.replaceMargin * (x.list && x.list.includes(s) ? cpu.listKeep : 1) * (c.r === sc.reach ? 3 : 1);
    };
    const ranked = cands.filter((c) => c.u > 0 || c.r === sc.reach || (sc.board.includes(c.r) && c.p > 0.02)).map((c) => ({ ...c, k: c.u * keepBonus(c) + (c.r === sc.reach ? 0.05 : 0) })).sort((a, b) => b.k - a.k);
    const pick = [];
    const used = {};
    ranked.forEach((c) => {
      if (pick.length >= lim.size) return;
      if ((used[c.pos] || 0) >= cap[c.pos]) return;
      used[c.pos] = (used[c.pos] || 0) + 1;
      pick.push(c.r);
    });
    const keep = new Set(pick);
    sc.board.slice().forEach((r) => { if (!keep.has(r)) removeFromBoard(state, s, r); });
    pick.forEach((r) => addToBoard(state, s, r));

    // ── Line ──
    if (lim.line) {
      const aboveCap = {};
      POSITIONS.forEach((p) => { aboveCap[p] = need[p] > 0.2 ? Math.max(1, Math.ceil(need[p] * 1.4)) : 0; });
      const cnt = {};
      const line = [];
      sc.board.map((r) => byR.get(r)).filter(Boolean).sort((a, b) => b.u - a.u).forEach((c) => {
        if (line.length >= lim.line || (cnt[c.pos] || 0) >= aboveCap[c.pos]) return;
        cnt[c.pos] = (cnt[c.pos] || 0) + 1;
        line.push(c.r);
      });
      setLine(state, s, line);
      planNil(state, s, line, byR);
    }
    handleDemands(state, s, byR);
  }

  // ── Staff ──
  planStaff(state, s, cands, rand);
}

// NIL: offers sized to value and ask, within the budget (spec §20 same rules).
function planNil(state, s, line, byR) {
  const sc = state.schools[s];
  const cpu = state.cfg.cpu;
  const week = fallWeek(state);
  const reserve = week >= 9 ? 0 : cpu.nilReserve * sc.budget;
  const maxV = Math.max(...line.map((r) => byR.get(r)?.v || 0), 0.0001);
  const want = line.map((r, k) => {
    const x = state.recruits[r];
    const c = byR.get(r);
    const share = (c?.v || 0) / maxV;
    // Closer races and higher NIL care earn a little more.
    const race = c ? 1 + 0.25 * (1 - Math.abs(c.p - 0.5) * 2) : 1;
    return [r, Math.max(state.cfg.minOffer, x.ask * cpu.nilAggr[sc.tier] * (0.65 + 0.6 * share) * race * (1 - k * 0.006))];
  });
  const room = sc.budget - sc.spent - reserve;
  const total = want.reduce((a, [, v]) => a + v, 0);
  // Over budget → scale down; under → spend toward it (capped per recruit).
  const maxOver = cpu.nilMaxOver[sc.tier] / cpu.nilAggr[sc.tier];
  const scale = total > room ? Math.max(0, room / total) : Math.min(maxOver, room / Math.max(1, total));
  // Set lower offers first so raises have room.
  const plan = want.map(([r, v]) => [r, Math.round((v * scale) / state.cfg.offerStep) * state.cfg.offerStep]);
  plan.sort((a, b) => (a[1] - (sc.nil[a[0]] || 0)) - (b[1] - (sc.nil[b[0]] || 0)));
  plan.forEach(([r, v]) => {
    const cur = sc.nil[r] || 0;
    // Keep a standing offer that's close enough (cuts cost interest), and
    // never undercut the players it's bidding for.
    if (cur && v >= cur * 0.85 && v <= cur * 1.1) return;
    if (cur && v < cur && line.indexOf(r) < cpu.matchTop) return;
    if (v < state.cfg.minOffer) { if (!cur) return; }
    const amt = Math.min(Math.max(v, cur * (v < cur ? 0.85 : 1)), cur + Math.max(0, nilAvailable(sc)));
    if (amt >= state.cfg.minOffer) setOffer(state, s, r, amt);
  });
  matchOffers(state, s, line, byR);
}

// Bidding: the players it wants most — someone else offering more gets
// matched or beaten, if the money's there and he's still in play.
function matchOffers(state, s, line, byR) {
  const sc = state.schools[s];
  const cpu = state.cfg.cpu;
  const rand = rngFor(state.seed, `match|${state.stage}|${s}`);
  line.slice(0, cpu.matchTop).forEach((r) => {
    const x = state.recruits[r];
    const c = byR.get(r);
    if (!c || c.p < 0.08 || (x.list && !x.list.includes(s))) return;
    const mine = sc.nil[r] || 0;
    let best = 0;
    state.schools.forEach((o, t) => { if (t !== s && (!x.list || x.list.includes(t))) best = Math.max(best, o.nil[r] || 0); });
    if (best <= mine) return;
    const cap = x.ask * cpu.matchCap[sc.tier];
    const over = cpu.matchOver[0] + rand() * (cpu.matchOver[1] - cpu.matchOver[0]);
    const step = state.cfg.offerStep;
    const want = Math.min(cap, Math.ceil((best * over) / step) * step);
    const room = mine + Math.max(0, nilAvailable(sc));
    const amt = Math.min(want, room);
    if (amt > mine && amt >= best * 0.97) setOffer(state, s, r, amt);
  });
}

// Demands aimed at this school: worth it → meet them.
function handleDemands(state, s, byR) {
  const sc = state.schools[s];
  sc.above.forEach((r) => {
    const x = state.recruits[r];
    const d = x.demand;
    if (!d || d.s !== s) return;
    const c = byR.get(r);
    if (!c) return;
    if (d.type === "nil") {
      const k = sc.above.indexOf(r);
      if (k < Math.max(3, sc.above.length / 2) && d.amount - (sc.nil[r] || 0) <= nilAvailable(sc)) setOffer(state, s, r, d.amount);
    } else if (d.type === "pt") {
      const rival = byR.get(d.target);
      if (!rival || rival.u < c.u) removeFromBoard(state, s, d.target);
    }
  });
}

// Staff: coaches on valuable close races, scouts where information is thin.
function planStaff(state, s, cands, rand) {
  const sc = state.schools[s];
  const phase = phaseOf(state);
  const N = state.N;
  // Region appeal by side: value of open candidates there × proximity.
  const appeal = (side) => {
    const sum = {};
    REGION_KEYS.forEach((k) => { sum[k] = 0; });
    cands.slice(0, 200).forEach((c) => {
      const x = state.recruits[c.r];
      if (side === "off" && !OFFENSE.has(x.pos)) return;
      if (side === "def" && OFFENSE.has(x.pos)) return;
      sum[x.region] += c.v * (0.4 + state.derived.distFit[s * N + c.r]);
    });
    return sum;
  };
  const pickRegion = (side, avoid) => {
    const a = appeal(side);
    const keys = REGION_KEYS.filter((k) => k !== avoid);
    const w = keys.map((k) => Math.pow(a[k] + 0.001, 2));
    return keys[pickWeighted(rand, w)] || REGION_KEYS[0];
  };
  const board = sc.board.map((r) => cands.find((c) => c.r === r)).filter(Boolean);
  const taken = new Set();
  ROLES.forEach((role) => {
    const side = role === "HC" || role === "HS" ? "all" : role === "OC" || role === "OS" ? "off" : "def";
    const cov = coverage(role);
    if (phase === "winter") {
      assignStaff(state, s, role, { kind: "area", region: pickRegion(side, role === "HS" ? sc.staff[0]?.region : null), pos: "ALL" });
      return;
    }
    const pool = board.filter((c) => cov.includes(c.pos) && !taken.has(`${role[1] === "C" ? "c" : "s"}${c.r}`));
    if (role === "HC" || role === "OC" || role === "DC") {
      // Biggest value in a race that's still winnable but not won.
      const best = pool.map((c) => ({ c, m: c.v * (0.2 + 4 * c.p * (1 - c.p)) * (sc.above.includes(c.r) ? 1.3 : 1) * bondMult(state, s, role, c.r) })).sort((a, b) => b.m - a.m)[0];
      if (best && best.m > 0.01) { taken.add(`c${best.c.r}`); assignStaff(state, s, role, { kind: "recruit", r: best.c.r }); } else assignStaff(state, s, role, { kind: "area", region: pickRegion(side), pos: "ALL" });
      return;
    }
    // Scouts: a valuable target we know little about, else discovery.
    const thin = pool.map((c) => {
      const k = knowledgeOf(state, s, c.r);
      return { c, m: c.v * (k.unknown + k.range * 0.6) / k.n };
    }).sort((a, b) => b.m - a.m)[0];
    if (thin && thin.m > 0.05 && (role === "HS" || rand() < 0.5)) { taken.add(`s${thin.c.r}`); assignStaff(state, s, role, { kind: "recruit", r: thin.c.r }); } else assignStaff(state, s, role, { kind: "area", region: pickRegion(side), pos: "ALL" });
  });
}
