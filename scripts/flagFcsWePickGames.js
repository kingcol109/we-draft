// scripts/flagFcsWePickGames.js
//
// We-Pick doesn't count games against FCS teams toward Ranked: every
// schedule26 game with an FCS team gets RankedDisqualified (the admin's
// "🚫 Disqualify from Ranked We-Pick" box — AdminPanel.js CFB Schedule),
// which grading (gradeWePickWeek.js), the Ranked 6 count and every pick UI
// already honor. RankedDisqualifiedReason: "fcs" marks the ones set here.
//
// FCS = a school whose CFBD team isn't on CFBD's FBS list for the season
// (or whose We-Draft Conference is "FCS"). A team name with no schools doc
// (e.g. a "TBD" placeholder) is skipped until it's known.
//
// Only games that haven't kicked off are touched — a played week is already
// graded, and flagging it afterwards would make its qualified status
// disagree with the official standings.
//
// 1 CFBD call (the FBS team list). Runs weekly (sync-cfbd-player-stats.yml,
// before picks open Monday); also by hand after adding games:
//   node --env-file=.env scripts/flagFcsWePickGames.js          write
//   node --env-file=.env scripts/flagFcsWePickGames.js --dry    report only

const { getFirestore } = require("./firebaseAdmin");
const { cfbd, getCallCount } = require("../server/live/cfbdClient");

const SEASON = 2026;
const DRY = process.argv.includes("--dry");

const toMs = (ts) => (ts?.toDate ? ts.toDate().getTime() : ts ? Date.parse(ts) || 0 : 0);

async function run() {
  const db = getFirestore();
  const [fbs, schoolsSnap, gamesSnap] = await Promise.all([
    cfbd.fbsTeams(SEASON),
    db.collection("schools").select("School", "Conference", "CFBDTeamId").get(),
    db.collection("schedule26").get(),
  ]);
  const fbsIds = new Set(fbs.map((t) => Number(t.id)));
  const schoolByName = new Map(schoolsSnap.docs.map((d) => [d.data().School, d.data()]));
  const isFcs = (name) => {
    const s = schoolByName.get(name);
    if (!s) return false; // unknown (TBD) — wait until it's a real team
    if (s.Conference === "FCS") return true;
    return s.CFBDTeamId != null && !fbsIds.has(Number(s.CFBDTeamId));
  };

  const now = Date.now();
  const toFlag = [];
  for (const d of gamesSnap.docs) {
    const g = d.data();
    if (g.RankedDisqualified) continue;
    const kickoff = toMs(g.KickoffAt) || toMs(g.Date);
    if (kickoff && kickoff <= now) continue; // played / underway — leave it
    const fcs = [g.Away, g.Home].filter(isFcs);
    if (fcs.length) toFlag.push({ ref: d.ref, label: `${g.Week} ${g.Away} @ ${g.Home} [${fcs.join(", ")}]` });
  }

  if (!DRY && toFlag.length) {
    for (let i = 0; i < toFlag.length; i += 400) {
      const batch = db.batch();
      toFlag.slice(i, i + 400).forEach((x) => batch.update(x.ref, { RankedDisqualified: true, RankedDisqualifiedReason: "fcs" }));
      await batch.commit();
    }
  }
  console.log(`${DRY ? "[dry] " : ""}${toFlag.length} upcoming game(s) with an FCS team ${DRY ? "would be" : ""} flagged Not Qualified:`);
  toFlag.forEach((x) => console.log(`  ${x.label}`));
  console.log(`CFBD calls: ${getCallCount()}`);
}

run().catch((e) => { console.error(e.message || e); process.exit(1); });
