// server/awards/nationalAwards.js
//
// College football's national awards and their winners, from ESPN's public
// core API (sports.core.api.espn.com …/college-football/seasons/{y}/awards —
// about 32 a season: Heisman, Maxwell, Walter Camp, the position awards,
// Lombardi, Lott IMPACT, Campbell, the FCS/D-II/D-III player awards, plus a
// few coach/contribution awards no prospect will match).
//
// Writes:
//   awards/{season}     { season, awards: [{ id, name, desc, winners: [{ espnId, name }] }] }
//   awards/_byAthlete   { rows: { [espnId]: [[season, name, desc], …] } } — every
//                       season in one doc, so the player page's Info tab
//                       (components/PlayerEligibilityInfo.jsx) is one read; a
//                       player's ESPN id is playerPhotos/{id}.headshot.espnId.
// Nothing is written to players.
//
// ESPN posts the winners in December–January, so a season with no winners
// yet is skipped. Run: node --env-file=.env scripts/syncNationalAwards.js
// (the weekly Build Site Snapshots workflow also runs it).

const { FieldValue } = require("firebase-admin/firestore");

const BASE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football";
const FIRST_SEASON = 2019;

async function getJson(url) {
  const r = await fetch(url.replace(/^http:/, "https:"));
  if (!r.ok) throw new Error(`ESPN ${r.status} ${url}`);
  return r.json();
}

// Every award in a season, with its winners' ESPN ids and names.
async function seasonAwards(season) {
  const refs = [];
  for (let page = 1; ; page++) {
    const list = await getJson(`${BASE}/seasons/${season}/awards?page=${page}`);
    refs.push(...(list.items || []).map((i) => i.$ref));
    if (page >= (list.pageCount || 1)) break;
  }
  const awards = [];
  for (const ref of refs) {
    const a = await getJson(ref);
    const winners = [];
    for (const w of a.winners || []) {
      const m = String(w.athlete?.$ref || "").match(/athletes\/(\d+)/);
      if (!m) continue;
      const ath = await getJson(w.athlete.$ref).catch(() => null);
      winners.push({ espnId: m[1], name: ath?.fullName || "" });
    }
    awards.push({ id: String(a.id), name: a.name, desc: a.description || "", winners });
  }
  return awards;
}

async function syncNationalAwards(db, { through } = {}) {
  const startedAt = Date.now();
  // The latest season whose awards could be out: last year's until December.
  const now = new Date();
  const last = through || (now.getUTCMonth() === 11 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);
  const byAthlete = {};
  const seasons = [];
  for (let season = FIRST_SEASON; season <= last; season++) {
    const awards = await seasonAwards(season).catch((e) => { console.error(`awards ${season}:`, e.message); return null; });
    if (!awards || !awards.some((a) => a.winners.length)) continue;
    await db.collection("awards").doc(String(season)).set({ season, awards, syncedAt: FieldValue.serverTimestamp() });
    seasons.push(season);
    awards.forEach((a) => a.winners.forEach((w) => (byAthlete[w.espnId] ||= []).push([season, a.name, a.desc])));
  }
  await db.collection("awards").doc("_byAthlete").set({ rows: byAthlete, seasons, syncedAt: FieldValue.serverTimestamp() });
  return { seasons, athletes: Object.keys(byAthlete).length, durationMs: Date.now() - startedAt };
}

module.exports = { syncNationalAwards, seasonAwards };
