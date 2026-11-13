// server/offseason/cfbdIndex.js
//
// The Eligibility Manager's CFBD view of every linked We-Draft player
// (Admin → Players → Offseason Manager, components/AdminEligibility.jsx),
// condensed into one admin-only doc, offseason/cfbd — the full rosters are
// ~10 MB, too much for the browser.
//
// Built from data already in Firestore, no CFBD calls:
//   cfbdPlayers  the link (wedraftPlayerId, mappingStatus suggested|verified)
//   cfbRosters   the current season's rosters (scripts/syncCfbdRosters.js):
//                recruiting class (rc), CFBD class year (yr), We-Draft school
//
// offseason/cfbd: { season, builtAt, linked, rows: { [playerId]: {
//   c: CFBD id, rc, yr, s: school on the roster (null when not on one),
//   v: 1 when the link is verified } } }
//
// Writes nothing to players — the tab recommends, the admin applies.
// Runs at the end of scripts/syncCfbdRosters.js, from the tab's Refresh
// button (api/portal-sync.js, action "cfbdIndex"), or
// scripts/buildOffseasonIndex.js.

const { FieldValue } = require("firebase-admin/firestore");

async function buildCfbdIndex(db) {
  const startedAt = Date.now();
  const linked = await db.collection("cfbdPlayers").where("mappingStatus", "in", ["suggested", "verified"])
    .select("wedraftPlayerId", "mappingStatus").get();

  const roster = new Map(); // CFBD id → { rc, yr, s }
  let season = null;
  const rosters = await db.collection("cfbRosters").get();
  rosters.docs.forEach((d) => {
    const t = d.data();
    if (t.season && (!season || t.season > season)) season = t.season;
    (t.players || []).forEach((p) => roster.set(String(p.id), { rc: p.rc ?? null, yr: p.yr ?? null, s: t.school || null }));
  });

  const rows = {};
  linked.docs.forEach((d) => {
    const { wedraftPlayerId: pid, mappingStatus } = d.data();
    if (!pid) return;
    const r = roster.get(d.id);
    const row = { c: d.id, rc: r?.rc ?? null, yr: r?.yr ?? null, s: r?.s ?? null, v: mappingStatus === "verified" ? 1 : 0 };
    // More than one CFBD athlete linked to the same player: a verified link
    // wins, then one that's on a roster.
    const prev = rows[pid];
    if (!prev || row.v > prev.v || (row.v === prev.v && row.s && !prev.s)) rows[pid] = row;
  });

  await db.collection("offseason").doc("cfbd").set({
    season, linked: Object.keys(rows).length, rows, builtAt: FieldValue.serverTimestamp(),
  });
  return { season, linked: Object.keys(rows).length, durationMs: Date.now() - startedAt };
}

module.exports = { buildCfbdIndex };
