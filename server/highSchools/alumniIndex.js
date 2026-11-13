// server/highSchools/alumniIndex.js
//
// Every current college player from a high school with a team page
// (highSchools Ranking 3 — pages/HighSchoolTeamPage.js), condensed into one
// public doc per school: the full CFBD rosters are ~10 MB, too much for a
// page. Built from data already in Firestore, no CFBD calls:
//   cfbRosters   the current season's rosters (scripts/syncCfbdRosters.js),
//                each row with CFBD's high school (hs, hsc city, hss state)
//   cfbdPlayers  CFBD athlete → We-Draft player (suggested | verified links)
// A row belongs to the school when utils/highSchoolMatch.js matches it by
// alias or exact name in the same state (a loose match is another school).
//
// hsAlumni/{highSchools id}: { school, state, season, builtAt, players: [{
//   c: CFBD id, n: name, pos, yr: CFBD class year (1–5), rc: recruiting
//   class, st: stars, s: college (We-Draft School name), t: CFBD team id,
//   id / slug: the We-Draft player when linked }] }
//
// Runs at the end of scripts/syncCfbdRosters.js, or on its own:
// scripts/buildHsAlumni.js.

const { FieldValue } = require("firebase-admin/firestore");

async function buildHsAlumni(db) {
  const { matchHighSchool } = await import("../../src/utils/highSchoolMatch.js");
  const pages = (await db.collection("highSchools").where("Ranking", "==", 3).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!pages.length) return { schools: 0 };

  const links = new Map();
  (await db.collection("cfbdPlayers").where("mappingStatus", "in", ["suggested", "verified"]).select("wedraftPlayerId", "wedraftSlug").get())
    .docs.forEach((d) => { const x = d.data(); if (x.wedraftPlayerId) links.set(d.id, { id: x.wedraftPlayerId, slug: x.wedraftSlug || null }); });

  const out = Object.fromEntries(pages.map((p) => [p.id, []]));
  let season = null;
  (await db.collection("cfbRosters").get()).docs.forEach((d) => {
    const t = d.data();
    if (t.season && (!season || t.season > season)) season = t.season;
    (t.players || []).forEach((p) => {
      if (!p.hs) return;
      const m = matchHighSchool(p.hs, p.hss, pages);
      if (!m || m.how === "close") return;
      const wd = links.get(String(p.id));
      out[m.doc.id].push({
        c: String(p.id), n: `${p.first || ""} ${p.last || ""}`.trim(), pos: p.pos || null, yr: p.yr ?? null, rc: p.rc ?? null,
        st: p.stars ?? null, s: t.school || t.team || null, t: t.teamId ?? null, ...(wd ? { id: wd.id, slug: wd.slug } : {}),
      });
    });
  });

  const batch = db.batch();
  pages.forEach((p) => batch.set(db.collection("hsAlumni").doc(p.id), {
    school: p.Name, state: p.State, season, players: out[p.id], builtAt: FieldValue.serverTimestamp(),
  }));
  await batch.commit();
  return { schools: pages.length, players: Object.fromEntries(pages.map((p) => [p.Name, out[p.id].length])) };
}

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

module.exports = { buildHsAlumni, buildHsCfbCounts };
