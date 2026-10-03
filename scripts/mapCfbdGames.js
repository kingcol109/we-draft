// scripts/mapCfbdGames.js
//
// Links each schedule26 game to its CollegeFootballData game: writes
// CFBDGameId and CFBDMatch { method: "auto", swapped, matchedAt }. Game
// ids, Slugs and every existing field stay exactly as they are — this only
// adds the provider mapping. A game whose CFBDMatch.method is "manual" is
// never overwritten (a differing auto match is reported instead).
//
// Requires schools to be mapped first (scripts/mapCfbdTeams.js). A match
// needs the same ET game day and the same two CFBD teams, with exactly one
// CFBD game fitting; anything else is reported, not guessed.
//
// Dry run by default. Add --write to apply. Costs 2 CFBD calls (regular +
// postseason /games); set CFBD_CACHE_DIR to reuse saved responses.
//
// Run with: node --env-file=.env scripts/mapCfbdGames.js [--write]

const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");
const { cfbd, getCallCount } = require("../server/live/cfbdClient");
const { matchGames } = require("../server/live/mapping");
const { cached } = require("./cfbdCache");

const SEASON = 2026;
const WRITE = process.argv.includes("--write");

const toMs = (ts) => (ts?.toDate ? ts.toDate().getTime() : typeof ts === "number" ? ts : Date.parse(ts) || 0);

async function run() {
  const db = getFirestore();
  const [regular, postseason, schedSnap, schoolsSnap] = await Promise.all([
    cached(`games-${SEASON}-regular`, () => cfbd.games({ year: SEASON, seasonType: "regular" })),
    cached(`games-${SEASON}-postseason`, () => cfbd.games({ year: SEASON, seasonType: "postseason" })),
    db.collection("schedule26").get(),
    db.collection("schools").get(),
  ]);

  const teamIdBySchool = new Map();
  for (const d of schoolsSnap.docs) {
    const s = d.data();
    if (s.School && s.CFBDTeamId != null) teamIdBySchool.set(s.School, s.CFBDTeamId);
  }
  if (!teamIdBySchool.size) throw new Error("No schools have CFBDTeamId yet — run scripts/mapCfbdTeams.js --write first.");

  const wdGames = schedSnap.docs
    .map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
    .filter((g) => g.Home !== "TBD" && g.Away !== "TBD")
    .map((g) => ({ ...g, dateMs: toMs(g.Date) }));
  const tbd = schedSnap.size - wdGames.length;

  const { matches, problems } = matchGames(wdGames, [...regular, ...postseason], teamIdBySchool);
  const wdById = new Map(wdGames.map((g) => [g.id, g]));

  const toWrite = matches.filter((m) => wdById.get(m.wdId).CFBDGameId !== m.cfbdGame.id && wdById.get(m.wdId).CFBDMatch?.method !== "manual");
  const already = matches.length - toWrite.length;

  for (const m of toWrite) {
    const w = wdById.get(m.wdId);
    console.log(`${w.CFBDGameId != null ? "CHANGE" : "NEW   "} ${w.Slug} → CFBD #${m.cfbdGame.id} (wk ${m.cfbdGame.week})${m.swapped ? "  [home/away reversed vs CFBD]" : ""}`);
  }
  if (problems.length) {
    console.log("\nNot mapped:");
    for (const p of problems) console.log(`  ${wdById.get(p.wdId)?.Slug || p.wdId}: ${p.reason}${p.detail ? ` (${p.detail})` : ""}`);
  }
  const swapped = toWrite.filter((m) => m.swapped).length;
  console.log(`\n${toWrite.length} to write (${swapped} with home/away reversed), ${already} already mapped, ${problems.length} not mapped, ${tbd} TBD skipped. CFBD calls: ${getCallCount()}.`);

  if (!WRITE) { console.log("Dry run — rerun with --write to apply."); return; }
  let batch = db.batch(), ops = 0;
  for (const m of toWrite) {
    batch.update(wdById.get(m.wdId).ref, {
      CFBDGameId: m.cfbdGame.id,
      CFBDMatch: { method: "auto", swapped: m.swapped, matchedAt: FieldValue.serverTimestamp() },
    });
    if (++ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops) await batch.commit();
  console.log(`Wrote ${toWrite.length} games.`);
}

run().catch((e) => { console.error(e.message || e); process.exit(1); });
