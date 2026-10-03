// server/live/rosters.js
//
// CFBD team rosters, used to turn a name in live play text ("#1 K.Taylor")
// into a CFBD athlete id — live play-by-play carries no player ids, so this
// is the only way a live play can be linked to a player (marked
// source: "inferred" by playParser.js, never presented as CFBD-supplied).
//
// Each roster fetch also upserts those players into cfbdPlayers (the
// provider player universe — identity fields only; an existing We-Draft
// link is never touched, an unlinked player may get a *suggested* one, same
// rule as box scores in store.js). A compact per-team index is cached at
// liveMeta/roster-{teamId} (admin-only bookkeeping) so a cold serverless
// instance reads one doc per team instead of ~110 player docs.
//
// Cost: 1 CFBD call per team per ROSTER_TTL_MS (daily), only for teams
// actually playing; capped per tick by the caller's `budget`.

const { FieldValue } = require("firebase-admin/firestore");
const { cfbd } = require("./cfbdClient");
const { wedraftPlayerIndex, normName } = require("./store");

const ROSTER_TTL_MS = 24 * 3600 * 1000;
const MEMORY_TTL_MS = 30 * 60 * 1000;
const memory = new Map(); // teamId → { at, players }

async function buildRoster(db, team, season) {
  const rows = await cfbd.roster({ team: team.name, year: season });
  const refs = rows.map((r) => db.collection("cfbdPlayers").doc(String(r.id)));
  const existing = new Map();
  for (let i = 0; i < refs.length; i += 100) {
    const snaps = refs.length ? await db.getAll(...refs.slice(i, i + 100)) : [];
    snaps.forEach((s) => s.exists && existing.set(s.id, s.data()));
  }
  const index = await wedraftPlayerIndex(db);

  const players = [];
  const ops = [];
  for (const r of rows) {
    const id = String(r.id);
    const name = `${r.firstName || ""} ${r.lastName || ""}`.trim();
    const prev = existing.get(id);
    const identity = {
      name, firstName: r.firstName || null, lastName: r.lastName || null,
      team: r.team || team.name, teamId: team.providerTeamId,
      position: r.position || null, jersey: r.jersey ?? null, rosterSeason: season,
      provider: "cfbd", updatedAt: FieldValue.serverTimestamp(),
    };
    let slug = prev?.wedraftSlug || null;
    let status = prev?.mappingStatus || null;
    if (!prev || !prev.mappingStatus || prev.mappingStatus === "none") {
      const hits = index.get(`${normName(name)}|${team.providerTeamId}`) || [];
      if (hits.length === 1) {
        Object.assign(identity, { wedraftPlayerId: hits[0].id, wedraftSlug: hits[0].slug, mappingStatus: "suggested", mappingSource: "name+team" });
        slug = hits[0].slug; status = "suggested";
      } else if (!prev) {
        Object.assign(identity, { wedraftPlayerId: null, wedraftSlug: null, mappingStatus: "none" });
        status = "none";
      }
    }
    ops.push((b) => b.set(db.collection("cfbdPlayers").doc(id), identity, { merge: true }));
    players.push({ id, jersey: r.jersey ?? null, first: r.firstName || "", last: r.lastName || "", pos: r.position || null, slug: slug || null, status: status || null });
  }
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach((op) => op(batch));
    await batch.commit();
  }
  await db.collection("liveMeta").doc(`roster-${team.providerTeamId}`).set({
    teamId: team.providerTeamId, team: team.name, season, players, builtAt: Date.now(),
  });
  return players;
}

// team: { providerTeamId, name } (a liveGames home/away). budget: { left }
// — roster builds allowed this call; when exhausted, a stale or missing
// roster is returned as-is (plays still render, just without player ids).
async function getRoster(db, team, season, budget) {
  const id = team?.providerTeamId;
  if (id == null || !team.name) return [];
  const mem = memory.get(id);
  if (mem && Date.now() - mem.at < MEMORY_TTL_MS) return mem.players;
  const doc = (await db.collection("liveMeta").doc(`roster-${id}`).get()).data();
  if (doc && doc.season === season && Date.now() - doc.builtAt < ROSTER_TTL_MS) {
    memory.set(id, { at: Date.now(), players: doc.players });
    return doc.players;
  }
  if (!budget || budget.left <= 0) return doc?.players || [];
  budget.left--;
  try {
    const players = await buildRoster(db, team, season);
    memory.set(id, { at: Date.now(), players });
    return players;
  } catch (e) {
    return doc?.players || [];
  }
}

// Both rosters for a game, as playParser.js's ctx.rosters.
async function rostersForGame(db, game, budget) {
  const season = game.season || new Date().getFullYear();
  const [home, away] = await Promise.all([
    getRoster(db, game.home, season, budget),
    getRoster(db, game.away, season, budget),
  ]);
  return { home, away };
}

module.exports = { rostersForGame, getRoster };
