// server/offseason/careerIndex.js
//
// CFBD's view of every linked We-Draft player's college career and high
// school, for the Eligibility Manager (Admin → Players → Offseason Manager,
// components/AdminEligibility.jsx) to suggest from — one admin-only doc,
// offseason/careers. Writes nothing to players or highSchools; the admin
// applies each suggestion.
//
// From CFBD (about 2 calls per season):
//   /roster for each season FIRST_SEASON…season — the team a player was on
//     each year (FBS + FCS; JUCO isn't covered, some FCS seasons are
//     missing), matched by CFBD athlete id (cfbdPlayers link)
//   /recruiting/players, high school and JUCO, each class — the high school
//     (name, city, state) and a JUCO stop, through the rosters' recruitIds;
//     a player with none falls back to a unique name match whose school or
//     state fits
//
// offseason/careers: { season, builtAt, rows: { [playerId]: {
//   st: [[from, to, school]]  college stops, oldest first — school is the
//                             We-Draft School when the team is mapped
//                             (schools.CFBDName), else CFBD's name
//   hs: { n, c, s, st, rk }   high school name, city, state (abbr), and the
//                             recruiting stars / national rank out of it
//   jc: { n, y }              JUCO school, and the class they signed out of it
// } } }
//
// Runs: node --env-file=.env scripts/buildCareerIndex.js — once a season,
// after the new rosters are out.

const { FieldValue } = require("firebase-admin/firestore");
const { cfbd, getCallCount } = require("../live/cfbdClient");
const { normName } = require("../live/store");

const FIRST_SEASON = 2019;

async function buildCareerIndex(db, { season } = {}) {
  const startedAt = Date.now();
  const SEASON = season || (await db.collection("offseason").doc("cfbd").get()).data()?.season || new Date().getFullYear();

  const schools = await db.collection("schools").select("School", "CFBDName").get();
  const wdSchool = new Map();
  schools.docs.forEach((d) => { const s = d.data(); if (s.CFBDName && s.School) wdSchool.set(s.CFBDName, s.School); });

  const linked = await db.collection("cfbdPlayers").where("mappingStatus", "in", ["suggested", "verified"]).select("wedraftPlayerId", "mappingStatus").get();
  const pidOf = new Map(); // CFBD id → We-Draft id (verified link wins)
  const verified = new Set();
  linked.docs.forEach((d) => {
    const { wedraftPlayerId: pid, mappingStatus } = d.data();
    if (!pid) return;
    if (mappingStatus === "verified") verified.add(pid);
    else if (verified.has(pid)) return;
    pidOf.set(d.id, pid);
  });

  // Seasons, teams, recruit ids, home state, name per CFBD id.
  const seen = new Map();
  for (let y = FIRST_SEASON; y <= SEASON; y++) {
    for (const r of await cfbd.roster({ year: y })) {
      const id = String(r.id);
      if (!pidOf.has(id)) continue;
      if (!seen.has(id)) seen.set(id, { seasons: {}, recruitIds: new Set(), home: r.homeState || null, name: `${r.firstName} ${r.lastName}` });
      const s = seen.get(id);
      s.seasons[y] = r.team;
      (r.recruitIds || []).forEach((x) => s.recruitIds.add(String(x)));
      if (r.homeState) s.home = r.homeState;
    }
  }

  const recruitById = new Map();
  const recruitsByName = new Map();
  for (let y = FIRST_SEASON - 1; y <= SEASON; y++) {
    for (const classification of ["HighSchool", "JUCO"]) {
      const list = await cfbd.recruits({ year: y, classification }).catch(() => []);
      list.forEach((r) => {
        recruitById.set(String(r.id), r);
        const k = normName(r.name || "");
        if (!recruitsByName.has(k)) recruitsByName.set(k, []);
        recruitsByName.get(k).push(r);
      });
    }
  }

  const rows = {};
  for (const [cid, s] of seen) {
    const pid = pidOf.get(cid);
    const teams = new Set(Object.values(s.seasons));
    let recs = [...s.recruitIds].map((x) => recruitById.get(x)).filter(Boolean);
    if (!recs.length) {
      // No recruit ids on the roster rows: a name match whose school is one
      // of their teams, or (high school only) whose state is their home.
      const byName = (recruitsByName.get(normName(s.name)) || []).filter((r) => teams.has(r.committedTo) || (r.recruitType === "HighSchool" && s.home && r.stateProvince === s.home));
      const hsHits = byName.filter((r) => r.recruitType === "HighSchool");
      const jcHits = byName.filter((r) => r.recruitType === "JUCO");
      recs = [...(hsHits.length === 1 ? hsHits : []), ...(jcHits.length === 1 ? jcHits : [])];
    }
    const hsRec = recs.filter((r) => r.recruitType === "HighSchool").sort((a, b) => a.year - b.year)[0];
    const jcRec = recs.filter((r) => r.recruitType === "JUCO").sort((a, b) => b.year - a.year)[0];

    // Consecutive seasons at one team make a stop; a missing season between
    // two at the same team (a CFBD gap) doesn't split it.
    const stops = [];
    Object.keys(s.seasons).map(Number).sort((a, b) => a - b).forEach((y) => {
      const school = wdSchool.get(s.seasons[y]) || s.seasons[y];
      const last = stops[stops.length - 1];
      if (last && last[2] === school) last[1] = y;
      else stops.push([y, y, school]);
    });

    const row = { st: stops };
    if (hsRec?.school) {
      row.hs = { n: hsRec.school, c: hsRec.city || null, s: hsRec.stateProvince || null };
      // Recruiting stars and national rank (shown under the high school).
      if (hsRec.stars) row.hs.st = hsRec.stars;
      if (hsRec.ranking) row.hs.rk = hsRec.ranking;
    }
    if (jcRec?.school) row.jc = { n: jcRec.school, y: jcRec.year };
    rows[pid] = row;
  }

  await db.collection("offseason").doc("careers").set({ season: SEASON, rows, builtAt: FieldValue.serverTimestamp() });
  return {
    season: SEASON, players: Object.keys(rows).length,
    withHs: Object.values(rows).filter((r) => r.hs).length, withJuco: Object.values(rows).filter((r) => r.jc).length,
    cfbdCalls: getCallCount(), durationMs: Date.now() - startedAt,
  };
}

module.exports = { buildCareerIndex };
