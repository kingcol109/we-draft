// src/utils/espnHeadshots.js
//
// Matching players to ESPN college-roster headshots — transparent 600×436
// head-and-shoulders PNGs, the same kind the NFL team pages use
// (utils/nflRoster.js). Shared by every place that fills
// playerPhotos/{playerId}.headshot from ESPN:
//   - scripts/importEspnHeadshots.js (by hand, dry run or --write)
//   - scripts/buildSiteSnapshots.mjs (the weekly job)
//   - AdminPanel.js's "Rebuild Site Snapshots" button
// so a player added mid-week picks up his photo on the next rebuild. ESPN's
// roster API and image CDN both send Access-Control-Allow-Origin: *, so this
// runs the same in the browser as in Node. Reads and writes stay with the
// caller (Admin SDK vs. web SDK); this only plans what to save.
//
// A school's CFBD team id (schools.CFBDTeamId) is its ESPN team id. A player
// is matched only on his full name (accents, punctuation and Jr./II/III set
// aside) being exactly one player on his school's roster — two with the
// name, decided by position. Anything less sure isn't saved: he goes in
// config/headshotReview with the roster's likely candidates (same last
// name, or same first name and a close last name) for the Photos tab's
// "Needs review" list. A player dismissed there isn't listed again.
//
// Never replaces a headshot that's already saved — one added by hand, or an
// earlier run's. Players in the current draft class and later only: a
// drafted player is on no college roster.
//
// Jersey numbers ride along: a new match saves the roster's number
// (playerPhotos/{id}.jersey — top level, since a hand-added headshot
// replaces the headshot object), and players already matched to an ESPN id
// get theirs refreshed from the same rosters, since numbers change. The
// player page's hero shows it.

const ROSTER_URL = (id) => `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${id}/roster?limit=300`;
const MAX_CANDIDATES = 4;

// The current draft class: the next draft (late April) — after May, next year's.
export function currentHeadshotClass(now = new Date()) {
  return now.getMonth() >= 4 ? now.getFullYear() + 1 : now.getFullYear();
}

// "D'Andre Smith Jr." → "dandre smith".
export const normName = (s) => String(s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/['’`.]/g, "").replace(/-/g, " ")
  .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
  .replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const lastOf = (s) => normName(s).split(" ").pop() || "";

// Runs fn over items, `limit` at a time.
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// One school's ESPN roster, or null when it couldn't be fetched (404 → []).
// Without a limit ESPN stops at 100 players (alphabetically) — a full
// roster is ~110–130.
export async function fetchEspnRoster(teamId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(ROSTER_URL(teamId));
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return (j.athletes || []).flatMap((g) => g.items || []).map((a) => ({
        espnId: String(a.id), name: a.fullName || `${a.firstName || ""} ${a.lastName || ""}`.trim(),
        last: a.lastName || "", position: a.position?.abbreviation || "", url: a.headshot?.href || "",
        jersey: a.jersey != null ? String(a.jersey).trim() : "",
      }));
    } catch (e) {
      if (attempt === 2) { console.warn(`ESPN roster ${teamId}: ${e.message}`); return null; }
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
    }
  }
  return null;
}

// The PNG's pixel size from its header — also checks the image is really
// there. Node default; the browser passes imageSizeInBrowser instead.
export async function pngSizeFromHeader(url) {
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-31" } });
    if (!r.ok) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    if (b.length < 24 || String.fromCharCode(b[1], b[2], b[3]) !== "PNG") return null;
    const u32 = (o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
    return { width: u32(16), height: u32(20) };
  } catch { return null; }
}

// Loads the image to read its size — no Range header, so no CORS preflight.
export function imageSizeInBrowser(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// players: [{ id, First, Last, School, Position, Eligible, Slug }]
// schools: [{ School, CFBDTeamId }]
// hasHeadshot: Set of player ids that already have one
// dismissed: Set of player ids dismissed from the review list
// known: Map of player id → { espnId, jersey } for players already matched
//   to ESPN — their jersey numbers are refreshed
// Returns { matches: [{ player, athlete, size }], review: { playerId → item },
// jerseyUpdates: [{ id, jersey, espnId }], stats, notFound: ["Name (School)"] }.
export async function planEspnHeadshots({
  players, schools, hasHeadshot, dismissed = new Set(), known = new Map(),
  from = currentHeadshotClass(), imageSize = pngSizeFromHeader, onProgress = () => {},
}) {
  const teamIdOf = new Map();
  schools.forEach((s) => { if (s.School && s.CFBDTeamId) teamIdOf.set(s.School, String(s.CFBDTeamId)); });

  const todo = players.filter((p) => (p.First || p.Last) && p.School && Number(p.Eligible) >= from && !hasHeadshot.has(p.id));
  const bySchool = new Map();
  let noTeamId = 0;
  todo.forEach((p) => {
    const id = teamIdOf.get(p.School);
    if (!id) { noTeamId++; return; }
    if (!bySchool.has(id)) bySchool.set(id, []);
    bySchool.get(id).push(p);
  });

  // Already-matched players in the current classes: their schools' rosters
  // are fetched too, for the jersey refresh.
  const refresh = players.filter((p) => known.has(p.id) && p.School && Number(p.Eligible) >= from && teamIdOf.has(p.School));
  const teamIds = [...new Set([...bySchool.keys(), ...refresh.map((p) => teamIdOf.get(p.School))])];
  const rosters = new Map();
  let fetched = 0;
  await pool(teamIds, 6, async (id) => {
    rosters.set(id, await fetchEspnRoster(id));
    onProgress(`Fetching ESPN rosters… ${++fetched}/${teamIds.length}`);
  });

  const matches = [];
  const review = {};
  const notFound = [];
  const stats = { without: todo.length, schools: teamIds.length, noTeamId, matched: 0, review: 0, noCandidates: 0, rosterFailed: 0, noHeadshot: 0, dismissed: 0 };
  for (const [teamId, list] of bySchool) {
    const roster = rosters.get(teamId);
    if (!roster) { stats.rosterFailed += list.length; continue; }
    for (const p of list) {
      const full = normName(`${p.First} ${p.Last}`);
      let exact = roster.filter((a) => normName(a.name) === full);
      if (exact.length > 1) exact = exact.filter((a) => a.position && a.position === p.Position);
      if (exact.length === 1) {
        if (exact[0].url) matches.push({ player: p, athlete: exact[0] });
        else stats.noHeadshot++;
        continue;
      }
      if (dismissed.has(p.id)) { stats.dismissed++; continue; }
      const last = lastOf(p.Last);
      const candidates = roster.filter((a) => a.url && (lastOf(a.last || a.name) === last || (normName(a.name).split(" ")[0] === normName(p.First).split(" ")[0] && lastOf(a.name).startsWith(last.slice(0, 4)))))
        .slice(0, MAX_CANDIDATES)
        .map((a) => ({ espnId: a.espnId, name: a.name, position: a.position, url: a.url }));
      if (!candidates.length) { stats.noCandidates++; notFound.push(`${p.First} ${p.Last} (${p.School})`); continue; }
      review[p.id] = {
        name: `${p.First || ""} ${p.Last || ""}`.trim(), school: p.School, position: p.Position || "", eligible: String(p.Eligible || ""),
        reason: exact.length > 1 ? "Two players with this name" : "No exact name match",
        candidates,
      };
      stats.review++;
    }
  }

  // Jersey numbers for players already matched, by ESPN id on their roster.
  const byEspnId = new Map();
  rosters.forEach((roster) => (roster || []).forEach((a) => byEspnId.set(a.espnId, a)));
  const jerseyUpdates = [];
  refresh.forEach((p) => {
    const k = known.get(p.id);
    const a = byEspnId.get(String(k.espnId));
    if (a && a.jersey && a.jersey !== (k.jersey || "")) jerseyUpdates.push({ id: p.id, jersey: a.jersey, espnId: a.espnId });
  });
  stats.jerseys = jerseyUpdates.length;

  // Check each matched image exists and get its size.
  if (matches.length) onProgress(`Checking ${matches.length} headshots…`);
  const sizes = await pool(matches, 8, ({ athlete }) => imageSize(athlete.url));
  const good = matches.map((m, i) => ({ ...m, size: sizes[i] })).filter((m) => m.size);
  stats.noHeadshot += matches.length - good.length;
  stats.matched = good.length;

  return { matches: good, review, jerseyUpdates, stats, notFound };
}

// The playerPhotos doc fields for one match (the caller adds updatedAt, and
// passes its SDK's Timestamp.now() as addedAt). Saved with { merge: true }.
export function headshotPhotoDoc({ player, athlete, size }, addedAt) {
  return {
    name: `${player.First || ""} ${player.Last || ""}`.trim(), slug: player.Slug || "",
    headshot: { url: athlete.url, ...size, source: `ESPN roster (id ${athlete.espnId})`, credit: "ESPN", espnId: athlete.espnId, addedAt },
    ...(athlete.jersey ? { jersey: athlete.jersey, jerseyEspnId: athlete.espnId } : {}),
  };
}

// Players already matched to ESPN, for planEspnHeadshots' jersey refresh:
// photo docs → Map(id → { espnId, jersey }).
export function knownEspnPlayers(photoDocs) {
  const m = new Map();
  photoDocs.forEach(({ id, data }) => {
    const espnId = data?.headshot?.espnId || data?.jerseyEspnId;
    if (espnId) m.set(id, { espnId: String(espnId), jersey: data.jersey || "" });
  });
  return m;
}
