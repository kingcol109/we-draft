// server/portal/sync.js
//
// Transfer portal sync — run only on demand: the admin panel's Player Data →
// Transfer Portal tab (via api/portal-sync.js), or
// scripts/syncTransferPortal.js. One CFBD call (/player/portal for a season).
//
// Writes, for one portal season:
//   transferPortal/{year}      meta — syncedAt, total, chunk count, and
//                              `matches`: entries matched to a We-Draft player
//                              ({ key, playerIds }); `dismissed` (set by the
//                              admin tab) is left alone.
//   transferPortal/{year}_{n}  the entries themselves, CHUNK per doc (a full
//                              season is ~4,500 — too big for one doc).
//
// CFBD portal entries carry no player id, so a We-Draft player matches by
// name (store.js normName — "A.J." = "AJ", suffixes dropped) plus school:
// they're still at the origin school, or already resolved to the
// destination with the origin as PriorSchool, or sitting in the portal from
// it. Nothing here writes to players — the admin tab recommends the update
// (Move to Portal / Resolve) and the admin applies it. Players outside
// We-Draft just follow CFBD's own rosters.

const { FieldValue } = require("firebase-admin/firestore");
const { cfbd, getCallCount } = require("../live/cfbdClient");
const { normName } = require("../live/store");

const CHUNK = 1500;

// Stable id for an entry across syncs.
const entryKey = (e) => `${normName(`${e.firstName} ${e.lastName}`)}|${normName(e.origin)}|${e.season}`;

async function runPortalSync(db, { year }) {
  const startedAt = Date.now();
  const rows = await cfbd.portal({ year });

  // CFBD team name → We-Draft School.
  const schools = await db.collection("schools").select("School", "CFBDName").get();
  const schoolOf = new Map();
  schools.docs.forEach((d) => { const s = d.data(); if (s.CFBDName && s.School) schoolOf.set(s.CFBDName, s.School); });
  const wdSchool = (cfbdName) => (cfbdName ? schoolOf.get(cfbdName) || null : null);

  // We-Draft players by normalized name.
  const players = await db.collection("players").select("First", "Last", "School", "PriorSchool", "PortalOriginalSchool").get();
  const byName = new Map();
  players.docs.forEach((d) => {
    const p = d.data();
    if (!p.First || !p.Last) return;
    const k = normName(`${p.First} ${p.Last}`);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push({ id: d.id, ...p });
  });

  const seen = new Set();
  const entries = [];
  const matches = [];
  for (const r of rows) {
    const key = entryKey(r);
    if (seen.has(key)) continue; // CFBD occasionally lists an entry twice
    seen.add(key);
    const origin = wdSchool(r.origin);
    const dest = wdSchool(r.destination);
    entries.push(JSON.parse(JSON.stringify({
      key,
      first: r.firstName || "",
      last: r.lastName || "",
      pos: r.position || undefined,
      // CFBD names, plus the We-Draft School when the team is mapped.
      origin: r.origin || "",
      originSchool: origin || undefined,
      dest: r.destination || undefined,
      destSchool: dest || undefined,
      date: r.transferDate || undefined,
      stars: r.stars || undefined,
      rating: r.rating ?? undefined,
      elig: r.eligibility || undefined,
    })));
    if (!origin) continue; // a We-Draft player's school is always a mapped one
    const hits = (byName.get(normName(`${r.firstName} ${r.lastName}`)) || []).filter((p) =>
      p.School === origin || p.PortalOriginalSchool === origin || (p.PriorSchool === origin && dest && p.School === dest));
    if (hits.length) matches.push({ key, playerIds: hits.map((p) => p.id) });
  }

  // Newest action first.
  entries.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const chunks = [];
  for (let i = 0; i < entries.length; i += CHUNK) chunks.push(entries.slice(i, i + CHUNK));

  const metaRef = db.collection("transferPortal").doc(String(year));
  const prevChunks = (await metaRef.get()).data()?.chunks || 0;
  const batch = db.batch();
  chunks.forEach((list, n) => batch.set(db.collection("transferPortal").doc(`${year}_${n}`), { year, n, entries: list }));
  for (let n = chunks.length; n < prevChunks; n++) batch.delete(db.collection("transferPortal").doc(`${year}_${n}`));
  batch.set(metaRef, {
    year, total: entries.length, chunks: chunks.length, matches,
    committed: entries.filter((e) => e.dest).length,
    syncedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  return { year, total: entries.length, committed: entries.filter((e) => e.dest).length, matched: matches.length, cfbdCalls: getCallCount(), durationMs: Date.now() - startedAt };
}

module.exports = { runPortalSync, entryKey };
