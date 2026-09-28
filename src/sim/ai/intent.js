// src/sim/ai/intent.js
// ── The decision system. Every AI player, every step, produces a list of
// candidate intents ("options") from its assignment + perception + belief,
// each with a score, a reason and a movement request. This picks one — but
// changing your mind costs time:
//
//   • the current intent gets a hysteresis bonus (no flip-flopping)
//   • a challenger has to stay the best option for a full decision delay
//     before it's committed (shorter for urgent things like a thrown ball)
//   • until then the player keeps executing the old intent — with fresh
//     targeting — so he keeps carrying momentum the wrong way
//
// That delay plus the physics of re-directing is what lets a QB move a
// defender with his eyes and then throw behind him. ──

import { TUNING } from "../config.js";
import { steer } from "../systems/movement.js";

export function decide(p, world, options) {
  const R = TUNING.react;
  const cur = p.intent;
  let best = null;
  let bestScore = -Infinity;
  for (const o of options) {
    if (!o) continue;
    const s = o.score + (cur && o.key === cur.key ? R.hysteresis : 0);
    if (s > bestScore) {
      best = o;
      bestScore = s;
    }
  }
  if (!best) return null;

  const curOpt = cur ? options.find((o) => o && o.key === cur.key) : null;
  let chosen;
  if (!curOpt || best.key === cur.key) {
    chosen = best;
    p.pending = null;
  } else {
    if (p.pending && p.pending.key === best.key) p.pending.t += world.dt;
    else p.pending = { key: best.key, label: best.label, reason: best.reason, t: 0 };
    p.pending.label = best.label;
    p.pending.reason = best.reason;
    const need = (best.urgent ? R.urgentDecision : R.decision) / p.traits.reaction;
    if (p.pending.t >= need) {
      chosen = best;
      p.pending = null;
    } else {
      chosen = curOpt;
    }
  }

  if (!cur || chosen.key !== cur.key) {
    world.log(p, chosen.label, chosen.reason, cur ? cur.label : null);
    p.intent = { ...chosen, since: world.t };
  } else {
    p.intent = { ...chosen, since: cur.since };
  }
  steer(p, chosen);
  return chosen;
}

// For moments when a player isn't deciding anything yet (pre-snap read).
export function hold(p, world, label, reason) {
  const opt = { key: "hold", label, reason, score: 0, speed: 0 };
  if (!p.intent || p.intent.key !== "hold") p.intent = { ...opt, since: world.t };
  p.desired = { dir: null, speed: 0, face: null };
}
