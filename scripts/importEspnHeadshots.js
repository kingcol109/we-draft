// scripts/importEspnHeadshots.js
//
// Fills players' headshots (playerPhotos/{playerId}.headshot — Admin →
// Content → Photos, shown on player pages) from ESPN's college rosters:
// transparent 600×436 head-and-shoulders PNGs, the same kind the NFL team
// pages use (utils/nflRoster.js).
//
// A school's CFBD team id (schools.CFBDTeamId) is its ESPN team id, so each
// school's roster comes from
//   site.api.espn.com/apis/site/v2/sports/football/college-football/teams/{id}/roster?limit=300
// A player is matched only on his full name (accents, punctuation and
// Jr./II/III set aside) being exactly one player on his school's roster —
// two with the name, decided by position. Anything less sure isn't saved:
// he goes in config/headshotReview with the roster's likely candidates
// (same last name, or same first name and a close last name), for the Photos tab's "Needs review" list. A player
// dismissed there (config/headshotReview.dismissed) isn't listed again.
//
// Never replaces a headshot that's already saved — one added by hand, or
// an earlier run's. Players in the draft classes from this one on only
// (--from to change it): a drafted player is on no college roster.
//
//   node scripts/importEspnHeadshots.js            dry run: what it would do
//   node scripts/importEspnHeadshots.js --write    save the matches and the review list
//   node scripts/importEspnHeadshots.js --from 2028 --write

const { getFirestore } = require("./firebaseAdmin");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const fromArg = args.indexOf("--from");
// The current draft class: the next draft (late April) — after May, next year's.
const now = new Date();
const FROM = fromArg >= 0 ? Number(args[fromArg + 1]) : now.getMonth() >= 4 ? now.getFullYear() + 1 : now.getFullYear();
// Without a limit ESPN stops at 100 players (alphabetically) — a full roster is ~110–130.
const ROSTER_URL = (id) => `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${id}/roster?limit=300`;
const MAX_CANDIDATES = 4;

// "D'Andre Smith Jr." → "dandre smith".
const norm = (s) => String(s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/['’`.]/g, "").replace(/-/g, " ")
  .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
  .replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const lastOf = (s) => norm(s).split(" ").pop() || "";

// Runs fn over items, `limit` at a time.
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

async function fetchRoster(teamId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(ROSTER_URL(teamId));
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return (j.athletes || []).flatMap((g) => g.items || []).map((a) => ({
        espnId: String(a.id), name: a.fullName || `${a.firstName || ""} ${a.lastName || ""}`.trim(),
        last: a.lastName || "", position: a.position?.abbreviation || "", url: a.headshot?.href || "",
      }));
    } catch (e) {
      if (attempt === 2) { console.warn(`  ⚠ roster ${teamId}: ${e.message}`); return null; }
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
    }
  }
  return null;
}

// The PNG's pixel size from its header — also checks the image is really there.
async function pngSize(url) {
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-31" } });
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length < 24 || b.toString("ascii", 1, 4) !== "PNG") return null;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  } catch { return null; }
}

async function run() {
  const db = getFirestore();
  console.log(`${WRITE ? "WRITE" : "DRY RUN"} — classes ${FROM} and later`);

  const [playersSnap, schoolsSnap, photosSnap, reviewSnap] = await Promise.all([
    db.collection("players").get(),
    db.collection("schools").get(),
    db.collection("playerPhotos").get(),
    db.collection("config").doc("headshotReview").get(),
  ]);
  const teamIdOf = new Map();
  schoolsSnap.docs.forEach((d) => { const s = d.data(); if (s.School && s.CFBDTeamId) teamIdOf.set(s.School, String(s.CFBDTeamId)); });
  const hasHeadshot = new Set(photosSnap.docs.filter((d) => d.data().headshot?.url).map((d) => d.id));
  const dismissed = new Set(reviewSnap.exists ? reviewSnap.data().dismissed || [] : []);

  const players = playersSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => (p.First || p.Last) && p.School && Number(p.Eligible) >= FROM && !hasHeadshot.has(p.id));
  const noTeamId = players.filter((p) => !teamIdOf.has(p.School));
  const bySchool = new Map();
  players.filter((p) => teamIdOf.has(p.School)).forEach((p) => {
    const id = teamIdOf.get(p.School);
    if (!bySchool.has(id)) bySchool.set(id, []);
    bySchool.get(id).push(p);
  });
  console.log(`${players.length} players without a headshot · ${bySchool.size} schools to fetch · ${noTeamId.length} at a school with no ESPN/CFBD id`);

  const teamIds = [...bySchool.keys()];
  const rosters = new Map();
  await pool(teamIds, 6, async (id) => { rosters.set(id, await fetchRoster(id)); });

  const matches = []; // { player, athlete }
  const review = {}; // playerId → item
  const notFound = [];
  const stats = { matched: 0, review: 0, noCandidates: 0, rosterFailed: 0, noHeadshot: 0, dismissed: 0 };
  for (const [teamId, list] of bySchool) {
    const roster = rosters.get(teamId);
    if (!roster) { stats.rosterFailed += list.length; continue; }
    for (const p of list) {
      const full = norm(`${p.First} ${p.Last}`);
      let exact = roster.filter((a) => norm(a.name) === full);
      if (exact.length > 1) exact = exact.filter((a) => a.position && a.position === p.Position);
      if (exact.length === 1) {
        if (exact[0].url) matches.push({ player: p, athlete: exact[0] });
        else stats.noHeadshot++;
        continue;
      }
      if (dismissed.has(p.id)) { stats.dismissed++; continue; }
      const last = lastOf(p.Last);
      const candidates = roster.filter((a) => a.url && (lastOf(a.last || a.name) === last || (norm(a.name).split(" ")[0] === norm(p.First).split(" ")[0] && lastOf(a.name).startsWith(last.slice(0, 4)))))
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

  // Check each matched image exists and get its size.
  const sizes = await pool(matches, 8, ({ athlete }) => pngSize(athlete.url));
  const good = matches.map((m, i) => ({ ...m, size: sizes[i] })).filter((m) => m.size);
  stats.noHeadshot += matches.length - good.length;
  stats.matched = good.length;

  console.log(`\nMatched: ${stats.matched}`);
  console.log(`Needs review: ${stats.review}`);
  console.log(`On the roster, no ESPN headshot: ${stats.noHeadshot}`);
  console.log(`Not found on the roster (no candidates): ${stats.noCandidates}`);
  console.log(`Previously dismissed: ${stats.dismissed}`);
  if (stats.rosterFailed) console.log(`Roster fetch failed: ${stats.rosterFailed} players`);
  good.slice(0, 8).forEach(({ player, athlete }) => console.log(`  ✓ ${player.First} ${player.Last} (${player.School}) → ${athlete.url}`));
  Object.values(review).slice(0, 8).forEach((r) => console.log(`  ? ${r.name} (${r.school}): ${r.candidates.map((c) => c.name).join(", ")}`));

  if (notFound.length) console.log(`  Not found, e.g.: ${notFound.slice(0, 12).join(", ")}`);
  if (!WRITE) { console.log("\nDry run — nothing saved. Add --write to save."); return; }

  const addedAt = Timestamp.now();
  for (let i = 0; i < good.length; i += 400) {
    const batch = db.batch();
    good.slice(i, i + 400).forEach(({ player, athlete, size }) => {
      batch.set(db.collection("playerPhotos").doc(player.id), {
        name: `${player.First || ""} ${player.Last || ""}`.trim(), slug: player.Slug || "",
        headshot: { url: athlete.url, ...size, source: `ESPN roster (id ${athlete.espnId})`, credit: "ESPN", espnId: athlete.espnId, addedAt },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();
  }
  // The review list is this run's; dismissals carry over.
  await db.collection("config").doc("headshotReview").set({ items: review, dismissed: [...dismissed], updatedAt: FieldValue.serverTimestamp() });
  console.log(`\nSaved ${good.length} headshots and ${stats.review} to review.`);
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
