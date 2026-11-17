// src/utils/portalSim/attach.js
//
// Pure helpers that dress a Portal Sim pool (./pool.js expandPool) with what
// isn't baked into portalSimPool: community draft grades and the admin's
// locked transfer grades + likeliness. Shared by the page's loader
// (./data.js) and the server builder (server/portal/public.js), so it can't
// import Firebase.
import { decodeGrade } from "../portalStars.mjs";

// Each player's community draft grade (dg: 1 = Early First … 10 = UDFA) and
// top strengths / weaknesses (str, weak) from the _grades snapshot rows
// ({ [wdId]: [avg, count, "s1|s2|s3", "w1|w2|w3"] }). Pure — headless runs use it.
export function attachDraftGrades(pool, rows) {
  const split = (v) => (v ? String(v).split("|").filter(Boolean) : []);
  pool.players.forEach((p) => {
    const row = p.wdId ? rows?.[p.wdId] : null;
    const avg = row?.[0];
    p.dg = Number.isFinite(Number(avg)) && avg != null ? Number(avg) : null;
    // The community's top strengths / weaknesses (player card).
    if (row?.[2]) p.str = split(row[2]);
    if (row?.[3]) p.weak = split(row[3]);
  });
  return pool;
}

// The admin's locks: a locked grade replaces the pool's stars (the auto
// grade — no lock, the auto grade stands), likeliness (0–3) rides along for
// the entry model. Pure — headless runs use it.
export function attachLocks(pool, rows) {
  if (!rows) return pool;
  // An FCS player is in only while graded — unlocked since the pool was
  // built, he's out.
  const fcs = new Set(pool.teams.filter((t) => t.fcs).map((t) => t.slug));
  if (fcs.size) pool.players = pool.players.filter((p) => !fcs.has(p.team) || decodeGrade(rows[p.id] || (p.wdId && rows[`wd:${p.wdId}`])).s);
  pool.players.forEach((p) => {
    const code = rows[p.id] || (p.wdId && rows[`wd:${p.wdId}`]);
    if (!code) { p.likely = null; return; } // live doc wins over the pool's copy
    const g = decodeGrade(code);
    if (g.s) p.stars = g.s;
    p.likely = g.l;
  });
  return pool;
}
