// src/sim/ai/screens.js
// ── Screen blocking. The line sells pass for a beat (plain pass pro — the
// rush is let go), then releases to lead the screen: every blocker takes
// the defender who's the biggest threat to the man the screen is for (the
// ball carrier once he has it), cheapest first — close to the blocker, and
// close to the ball. Receivers told to block (the slot on a tunnel) do it
// from the snap. Nothing is scripted about whether it works: rushers who
// read it, defenders who don't bite, and a thrown ball's timing decide. ──

// Has this blocker's pass-set beat ended?
export function screenReleased(p, world) {
  const sc = world.play.screen;
  if (!sc) return false;
  if (p.assignment.kind === "screenBlock") return true;
  return world.sinceSnap >= sc.release;
}

// The man everything is built around: the carrier once the ball's caught,
// else the screen target.
export function screenFocus(world) {
  const c = world.carrier();
  if (c && c.team === "O" && c.id !== "QB") return c;
  return world.byId[world.play.screen.target];
}

export function assignScreen(world) {
  const sc = world.play.screen;
  const focus = screenFocus(world);
  if (!focus) return;
  const blockers = world.offense.filter(
    (o) => (o.assignment.kind === "screen" || o.assignment.kind === "screenBlock") && screenReleased(o, world) && o !== focus
  );
  // At the release the line lets its rushers go — a shove and out — and
  // doesn't pick them back up.
  for (const b of blockers) {
    if (b.role !== "OL" || b.screenOut) continue;
    b.screenOut = true;
    if (b.engagedWith) {
      b.reengage[b.engagedWith] = world.t + 10;
      world.log(b, "Screen — let him go", `released ${b.engagedWith}`);
      b.engagedWith = null;
    }
    for (const d of world.defense) if (d.role === "DL") b.reengage[d.id] = world.t + 10;
  }
  const taken = new Set();
  for (const b of blockers) if (b.engagedWith) taken.add(b.engagedWith);
  const pairs = [];
  for (const b of blockers) {
    if (b.engagedWith) {
      b.blockTarget = b.engagedWith;
      continue;
    }
    for (const d of world.defense) {
      if (taken.has(d.id)) continue;
      if ((b.reengage[d.id] || 0) > world.t) continue; // one he let go
      const m = b.perception.memory[d.id];
      if (!m || m.conf < 0.25) continue;
      // A rusher already past the line on his way to the QB was let go.
      if (d.role === "DL" && m.y < focus.y - 1.5) continue;
      const toBall = Math.hypot(m.x - focus.x, m.y - focus.y);
      if (toBall > 16) continue;
      pairs.push({ b, id: d.id, cost: Math.hypot(m.x - b.x, m.y - b.y) + 0.8 * toBall - (b.blockTarget === d.id ? 1 : 0) });
    }
  }
  pairs.sort((a, z) => a.cost - z.cost);
  const done = new Set();
  for (const { b, id } of pairs) {
    if (done.has(b.id) || taken.has(id)) continue;
    b.blockTarget = id;
    done.add(b.id);
    taken.add(id);
  }
  for (const b of blockers) if (!done.has(b.id) && !b.engagedWith) b.blockTarget = null;
  // (Before the release the line is ordinary pass pro — assignPassPro.)
  return sc;
}
