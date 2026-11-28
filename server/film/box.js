// server/film/box.js
//
// A film game's box score (Film Manager: the Rosters window, the Viewer's
// Side bar players): CFBD /games/players for one game, saved as
// compSnapshots/_filmBox_{cfbdGameId} — { kind, gameId, teams: [{ name,
// side, points, players: [{ id, name, stats: { category: { stat: "value" } } }] }], at }.
// Called when a film is put on its game (user, 2026-11-27: new film had no
// box score, so the Side bar had no players). One CFBD call; a box already
// saved is kept unless `force`. A game not played yet has no box — nothing is
// written, so it's fetched again next time.
const { cfbd } = require("../live/cfbdClient");

async function saveFilmBox(db, gameId, { force = false } = {}) {
  const id = Number(gameId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "bad game id" };
  const ref = db.collection("compSnapshots").doc(`_filmBox_${id}`);
  if (!force && (await ref.get()).exists) return { ok: true, saved: false, had: true };
  const rows = await cfbd.gamePlayers({ id });
  const g = Array.isArray(rows) ? rows[0] : null;
  if (!g?.teams?.length) return { ok: true, saved: false, empty: true };
  const teams = g.teams.map((t) => {
    const byId = {};
    for (const c of t.categories || []) {
      for (const ty of c.types || []) {
        for (const a of ty.athletes || []) {
          if (a.id == null || Number(a.id) < 0) continue; // the "Team" lines
          const p = byId[a.id] || (byId[a.id] = { id: String(a.id), name: a.name, stats: {} });
          (p.stats[c.name] ||= {})[ty.name] = String(a.stat);
        }
      }
    }
    return { name: t.team, side: t.homeAway, points: t.points ?? null, players: Object.values(byId) };
  });
  await ref.set({ kind: "filmBox", gameId: id, teams, at: Date.now() });
  return { ok: true, saved: true, teams: teams.map((t) => ({ name: t.name, players: t.players.length })) };
}

module.exports = { saveFilmBox };
