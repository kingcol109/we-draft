// server/highSchools/alumniIndex.js
//
// HS Research counts (below). The high school pages' own docs — current
// college players, drafted alumni, ranks and leaderboards — are built by
// server/highSchools/hsIndex.js.

const { FieldValue } = require("firebase-admin/firestore");

// Admin → Content → Research → HS Research: how many current college
// players (every CFBD roster in cfbRosters) came out of each high school —
// counts only (all ~29k rows won't fit one doc). Keyed "Name|State" by OUR
// highSchools doc when CFBD's school matches one (alias / exact, same state;
// national schools like IMG in their own state), else by CFBD's own name.
// offseason/hsCfb: { season, builtAt, players, rows: { "Name|State": count } }
async function buildHsCfbCounts(db) {
  const { matchHighSchool, stateName, hsKey, NATIONAL_SCHOOLS } = await import("../../src/utils/highSchoolMatch.js");
  const byState = new Map();
  (await db.collection("highSchools").select("Name", "State", "CFBDNames").get()).docs.forEach((d) => {
    const x = { id: d.id, ...d.data() };
    if (!byState.has(x.State)) byState.set(x.State, []);
    byState.get(x.State).push(x);
  });
  const all = [...byState.values()].flat();
  const rows = {};
  let season = null; let players = 0;
  (await db.collection("cfbRosters").get()).docs.forEach((d) => {
    const t = d.data();
    if (t.season && (!season || t.season > season)) season = t.season;
    (t.players || []).forEach((p) => {
      if (!p.hs) return;
      const st = stateName(p.hss);
      // A national school is matched against every state (it lives in its own).
      const m = matchHighSchool(p.hs, st, NATIONAL_SCHOOLS[hsKey(p.hs)] ? all : byState.get(st) || []);
      const k = m && m.how !== "close" ? `${m.doc.Name}|${m.doc.State}` : `${p.hs}|${st}`;
      rows[k] = (rows[k] || 0) + 1;
      players += 1;
    });
  });
  await db.collection("offseason").doc("hsCfb").set({ season, players, rows, builtAt: FieldValue.serverTimestamp() });
  return { season, players, schools: Object.keys(rows).length };
}

module.exports = { buildHsCfbCounts };
