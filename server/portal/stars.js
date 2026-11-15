// server/portal/stars.js
//
// Transfer stars for every college player (the rules:
// src/utils/portalStars.mjs), built ahead of time so a player already has
// one when he enters the portal. Reads only what's in Firestore — no CFBD
// or PFF calls:
//   cfbRosters        every current college player + CFBD season stats
//   pffGrades         PFF season grade + snaps (admin-only collection)
//   compSnapshots/_grades   community draft grades by We-Draft player
//   cfbdPlayers       CFBD athlete → We-Draft player links
//   players           We-Draft players (ones with no CFBD link still get one)
//
// Writes portalStars (public read — stars and what they came from, never a
// PFF number):
//   portalStars/{CFBDTeamId}  { team, school, season, builtAt,
//                               rows: { [cfbdId]: [stars, basis, review 0|1,
//                                                   name, pos, wdId|""] } }
//   portalStars/_wedraft      { rows: { [wdId]: [stars, basis, cfbdId|""] } }
//                             the public portal's one read
//   portalStars/_meta         { season, builtAt, players, byStars, byBasis, review }
// portalStars/_overrides (admin edits: { rows: { [cfbdId | "wd:"+wdId]:
// { s, note, at } } }) is never touched here.
//
// Runs: Admin → Players → Transfer Portal → Grades "Rebuild" (api/portal-sync
// action "stars"), the end of scripts/syncCfbdRosters.js, or
// node --env-file=.env scripts/buildPortalStars.js

const { FieldValue } = require("firebase-admin/firestore");

async function buildPortalStars(db, { dry = false } = {}) {
  const { autoStars } = await import("../../src/utils/portalStars.mjs");

  const [rosterSnap, pffSnap, gradesDoc, linkSnap, playerSnap] = await Promise.all([
    db.collection("cfbRosters").get(),
    db.collection("pffGrades").get(),
    db.collection("compSnapshots").doc("_grades").get(),
    db.collection("cfbdPlayers").where("mappingStatus", "in", ["suggested", "verified"]).select("wedraftPlayerId", "mappingStatus").get(),
    db.collection("players").select("First", "Last", "Position", "Eligible").get(),
  ]);

  // Past draft classes (2026 and before, once the 2026 draft is done) are
  // gone from college — no stars for them, and a roster row linked to one
  // is dropped. Same rule as utils/eligibility.js currentDraftClass.
  const now0 = new Date();
  const draftClass = now0.getUTCFullYear() + (now0.getUTCMonth() >= 4 ? 1 : 0);
  const pastClass = new Set(playerSnap.docs.filter((d) => {
    const e = parseInt(d.data().Eligible, 10);
    return e && e < draftClass;
  }).map((d) => d.id));

  const pff = new Map();
  pffSnap.docs.forEach((d) => Object.entries(d.data().players || {}).forEach(([id, r]) => pff.set(id, { g: r.g, sn: r.sn, cat: r.cat })));
  const draftAvg = (wdId) => gradesDoc.data()?.rows?.[wdId]?.[0] ?? null;

  // CFBD id → We-Draft id (a verified link wins over a suggested one).
  const wdOf = new Map();
  linkSnap.docs.forEach((d) => {
    const { wedraftPlayerId: id, mappingStatus } = d.data();
    if (!id) return;
    if (mappingStatus === "verified" || !wdOf.has(d.id)) wdOf.set(d.id, id);
  });

  const byStars = { 6: 0, 5: 0, 4: 0, 3: 0, 2: 0 };
  const byBasis = {};
  let review = 0;
  let season = null;
  const teamDocs = [];
  const wedraft = {};
  const tally = (g) => { byStars[g.stars] += 1; byBasis[g.basis] = (byBasis[g.basis] || 0) + 1; if (g.review) review += 1; };

  rosterSnap.docs.forEach((d) => {
    const t = d.data();
    if (t.season && (!season || t.season > season)) season = t.season;
    const rows = {};
    (t.players || []).forEach((p) => {
      const id = String(p.id);
      const wdId = wdOf.get(id) || "";
      if (wdId && pastClass.has(wdId)) return;
      const g = autoStars({ draftAvg: wdId ? draftAvg(wdId) : null, pff: pff.get(id) || null, stats: p.s || null });
      tally(g);
      rows[id] = [g.stars, g.basis, g.review ? 1 : 0, `${p.first || ""} ${p.last || ""}`.trim(), p.pos || "", wdId];
      if (wdId) wedraft[wdId] = [g.stars, g.basis, id];
    });
    teamDocs.push([d.id, { team: t.team || "", school: t.school || t.team || "", season: t.season || null, rows }]);
  });

  // We-Draft players no roster carries (no CFBD link): their draft grade, if any.
  let wdOnly = 0;
  playerSnap.docs.forEach((d) => {
    if (wedraft[d.id] || pastClass.has(d.id)) return;
    const g = autoStars({ draftAvg: draftAvg(d.id) });
    wedraft[d.id] = [g.stars, g.basis, ""];
    wdOnly += 1;
  });

  const players = Object.values(byStars).reduce((a, b) => a + b, 0);
  const result = { season, teams: teamDocs.length, players, wedraft: Object.keys(wedraft).length, wdOnly, byStars, byBasis, review };
  if (dry) return result;

  const now = FieldValue.serverTimestamp();
  const writes = [
    ...teamDocs.map(([id, data]) => [id, { ...data, builtAt: now }]),
    ["_wedraft", { rows: wedraft, builtAt: now }],
    ["_meta", { season, players, byStars, byBasis, review, builtAt: now }],
  ];
  for (let i = 0; i < writes.length; i += 40) {
    const b = db.batch();
    writes.slice(i, i + 40).forEach(([id, data]) => b.set(db.collection("portalStars").doc(id), data));
    await b.commit();
  }
  return result;
}

module.exports = { buildPortalStars };
