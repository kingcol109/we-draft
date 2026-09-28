// src/sim/ai/protection.js
// ── Blocking *calls*: who blocks whom. Re-run a few times a second so the
// line reacts to what develops (a blitzer showing, a DL slanting).
// Inside zone has its own call — see zoneScheme.js. They work from the linemen's own
// perception — the best look any lineman currently has at each defender —
// never from the defense's actual assignments. ──

import { screenReleased } from "./screens.js";
import { CX, depthOf } from "../field.js";

// Best-available perceived state of a defender across the offensive line.
export function lineRead(world, id) {
  let best = null;
  for (const o of world.offense) {
    if (o.role !== "OL") continue;
    const m = o.perception.memory[id];
    if (m && (!best || m.vis > best.vis)) best = m;
  }
  return best;
}

// ── Pass protection: identify rush threats (on the line, or moving toward
// the backfield), then match linemen to them by lateral position — closest
// first, one each. Spare linemen help on the nearest rusher. The RB takes
// the most dangerous rusher nobody has. ──
export function assignPassPro(world) {
  // (On a screen, only until the line releases.)
  const ol = world.offense.filter(
    (o) => o.role === "OL" && (o.assignment.kind !== "screen" || !screenReleased(o, world))
  );
  const threats = [];
  for (const d of world.defense) {
    const m = lineRead(world, d.id);
    if (!m || m.conf < 0.2) continue;
    const dep = depthOf(m.y);
    const onLine = dep < 3.5 && Math.abs(m.x - CX) < 9;
    const coming = m.vy < -1.2 && dep < 7 && Math.abs(m.x - CX) < 12;
    if (onLine || coming) threats.push({ id: d.id, m, dep });
  }
  const taken = new Set();
  const free = [];
  const done = new Set();
  for (const o of ol) {
    if (o.engagedWith) {
      taken.add(o.engagedWith);
      o.blockTarget = o.engagedWith;
      done.add(o.id);
    }
  }
  // Big on big: the linemen and the rushers each in order across the
  // formation, matched left to right — nobody crosses another lineman's
  // face to get to his man — at the least total distance. A rusher left
  // over is the back's (below). Keeping the man he already has costs a
  // little less, so the calls don't flip-flop as everybody moves.
  const L = ol.filter((o) => !done.has(o.id)).sort((a, b) => a.home.x - b.home.x);
  const R = threats.filter((t) => !taken.has(t.id)).sort((a, b) => a.m.x - b.m.x);
  const cost = (o, t) => Math.abs(o.home.x - t.m.x) + 0.6 * Math.max(0, t.dep) - (o.blockTarget === t.id ? 0.8 : 0);
  const MAX = 6.5; // farther than this he can't get there — leave him for the back
  const SKIP = 6; // what leaving a rusher unblocked costs
  const dp = Array.from({ length: L.length + 1 }, () => new Array(R.length + 1).fill(Infinity));
  const how = Array.from({ length: L.length + 1 }, () => new Array(R.length + 1).fill(null));
  dp[0][0] = 0;
  for (let i = 0; i <= L.length; i++)
    for (let j = 0; j <= R.length; j++) {
      const v = dp[i][j];
      if (v === Infinity) continue;
      const relax = (a, b, val, step) => {
        if (val < dp[a][b]) {
          dp[a][b] = val;
          how[a][b] = step;
        }
      };
      if (i < L.length) relax(i + 1, j, v, "free"); // lineman with nobody — he helps
      if (j < R.length) relax(i, j + 1, v + SKIP, "skip"); // rusher left for the back
      if (i < L.length && j < R.length && Math.abs(L[i].home.x - R[j].m.x) <= MAX) relax(i + 1, j + 1, v + cost(L[i], R[j]), "pair");
    }
  for (let i = L.length, j = R.length; i > 0 || j > 0; ) {
    const h = how[i][j];
    if (h === "pair") {
      L[i - 1].blockTarget = R[j - 1].id;
      done.add(L[i - 1].id);
      taken.add(R[j - 1].id);
      i--;
      j--;
    } else if (h === "free") i--;
    else j--;
  }
  for (const o of ol) if (!o.engagedWith && !done.has(o.id)) free.push(o);
  // Spare linemen help on the nearest rusher.
  for (const o of free) {
    let best = null;
    for (const t of threats) {
      const c = Math.abs(o.home.x - t.m.x);
      if (c < 2.8 && (!best || c < best.c)) best = { id: t.id, c };
    }
    o.blockTarget = best ? best.id : null;
  }
  // RB: the unblocked rusher closest to the QB.
  const rb = world.byId.RB;
  if (rb.assignment.kind === "rbPro") {
    const qb = world.byId.QB;
    let best = null;
    for (const t of threats) {
      if (taken.has(t.id)) continue;
      const m = rb.perception.memory[t.id];
      if (!m) continue;
      const c = Math.hypot(m.x - qb.x, m.y - qb.y);
      if (c < 8 && (!best || c < best.c)) best = { id: t.id, c };
    }
    if (!rb.engagedWith) rb.blockTarget = best ? best.id : null;
  }
}

// Perimeter blockers after a catch: the nearest defender each receiver can
// see. (On inside zone, receivers block the man aligned on them instead —
// see zoneScheme.js.)
export function assignStalk(world) {
  const carrier = world.carrier() || world.byId.RB;
  const claimed = new Set();
  for (const w of world.offense) {
    if (w.role !== "WR" || w === carrier || w.hasBall) continue;
    if (!(world.ball.carrierId && world.ball.carrierId !== "QB")) continue;
    if (w.engagedWith) {
      claimed.add(w.engagedWith);
      w.blockTarget = w.engagedWith;
      continue;
    }
    let best = null;
    for (const d of world.defense) {
      if (claimed.has(d.id)) continue;
      const m = w.perception.memory[d.id];
      if (!m || m.conf < 0.3) continue;
      if (d.role !== "CB" && d.role !== "S" && d.role !== "LB") continue;
      const c = Math.hypot(m.x - w.x, m.y - w.y);
      if (c < 12 && (!best || c < best.c)) best = { id: d.id, c };
    }
    w.blockTarget = best ? best.id : null;
    if (best) claimed.add(best.id);
  }
}
