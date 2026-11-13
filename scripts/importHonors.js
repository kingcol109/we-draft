// scripts/importHonors.js
//
// All-conference teams (and later other honors) for the player page's
// Career Path. One JSON file per conference-season in scripts/data/honors/
// ({ season, conference, selections: [[pos, name, school, team, raw]] } —
// team is the better of the two polls (coaches/media, AP/coaches), raw keeps
// both, e.g. "C2 M1"). Transcribed by hand; this loads them all.
//
// Honors are attached to the CFBD athlete first — matched by name and team
// on that season's CFBD roster (/roster, one call per season) — so a player
// added to We-Draft later has his as soon as he's linked (cfbdPlayers
// wedraftPlayerId), without re-running this. We-Draft players without a
// CFBD link (e.g. an already-drafted class) are matched directly too.
//
// Writes (players docs untouched):
//   honors/{season}-{conference slug}   the file as entered
//   honors/_byCfbd     { rows: { [cfbdId]: [[season, label, school], …] } }
//   honors/_byPlayer   { rows: { [playerId]: [[season, label, school], …] } }
//                      — the We-Draft-only matches (no CFBD link)
// components/PlayerEligibilityInfo.jsx reads both (_byCfbd through the
// player's cfbdPlayers links) and places each under that school's stop.
// Label: "First-Team All-SEC"; a returner spot adds "(Return Specialist)",
// an all-purpose spot "(All-Purpose)" — kickers, punters and snappers get none.
//
// Matching, by name (server/live/store normName: punctuation, Jr./III set
// aside — or a nickname: same last name, one first name the start of the
// other) AND school. For a We-Draft player the school is their School,
// PriorSchool, a saved CareerStops stop that season, or CFBD's roster
// history (offseason/careers); last resort, a unique name whose class,
// recruit year and position fit ("by name only", listed to check).
//
//   node --env-file=.env scripts/importHonors.js          dry run
//   node --env-file=.env scripts/importHonors.js --write

const fs = require("fs");
const path = require("path");
const { FieldValue } = require("firebase-admin/firestore");
const { getFirestore } = require("./firebaseAdmin");
const { normName } = require("../server/live/store");
const { cfbd, getCallCount } = require("../server/live/cfbdClient");

const DIR = path.join(__dirname, "data", "honors");
const WRITE = process.argv.includes("--write");
// team 4 = honorable mention; team 0 = no team named (plain "All-American").
const TEAM = { 1: "First-Team", 2: "Second-Team", 3: "Third-Team", 4: "Honorable Mention" };
// Notes on special spots: a returner ("(Return Specialist)") and an
// all-purpose pick ("(All-Purpose)"). Kickers, punters, snappers and a plain
// SP (specialist) spot get none.
const SPOT_NOTE = { RS: "Return Specialist", KR: "Return Specialist", PR: "Return Specialist", AP: "All-Purpose" };
// Honor position → the We-Draft positions it can be (returners: any).
const POS_FIT = {
  QB: ["QB"], RB: ["RB"], FB: ["RB", "TE"], WR: ["WR"], TE: ["TE"], C: ["OL"], G: ["OL"], T: ["OL"], OL: ["OL"],
  DL: ["DL", "EDGE"], DE: ["DL", "EDGE"], DT: ["DL"], LB: ["LB", "EDGE"], DB: ["DB"], K: ["K"], P: ["P"], LS: ["LS"],
};
const posFits = (pos, ours) => !POS_FIT[pos] || POS_FIT[pos].includes(ours);
// …and the CFBD roster positions it can be.
const CFBD_FIT = {
  QB: ["QB"], RB: ["RB", "FB"], FB: ["FB", "RB", "TE"], WR: ["WR"], TE: ["TE"], C: ["OL", "C", "G", "OG"], G: ["OL", "G", "OG", "C"],
  T: ["OL", "OT", "T"], OL: ["OL", "OT", "OG", "C", "G", "T"], DL: ["DL", "DE", "DT", "NT", "EDGE"], DE: ["DL", "DE", "EDGE"],
  DT: ["DL", "DT", "NT"], LB: ["LB", "OLB", "ILB", "EDGE"], DB: ["DB", "CB", "S", "FS", "SS"], K: ["K", "PK"], P: ["P"], LS: ["LS"],
};
const cfbdPosFits = (pos, theirs) => !CFBD_FIT[pos] || CFBD_FIT[pos].includes(String(theirs).toUpperCase());
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const splitName = (name) => {
  const [first, ...rest] = name.replace(/\s+(Jr|Sr|II|III|IV)\.?$/i, "").trim().split(/\s+/);
  return { first: normName(first), last: normName(rest.join(" ")) };
};
const nickFits = (a, b) => a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a));

async function run() {
  const db = getFirestore();
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
  const sets = files.map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) }));

  // We-Draft School ↔ CFBD team.
  const schools = (await db.collection("schools").select("School", "CFBDName").get()).docs.map((d) => d.data());
  const wdOf = new Map(schools.filter((s) => s.CFBDName).map((s) => [s.CFBDName, s.School]));

  // CFBD rosters for each season: { name key, last, first, school } per athlete.
  const rosters = new Map();
  for (const season of [...new Set(sets.map((s) => s.season))]) {
    const list = (await cfbd.roster({ year: season })).map((r) => ({
      id: String(r.id), key: normName(`${r.firstName} ${r.lastName}`), first: normName(r.firstName || ""),
      last: normName(r.lastName || ""), school: wdOf.get(r.team) || r.team, pos: r.position || "",
    }));
    rosters.set(season, list);
  }

  const players = (await db.collection("players").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const linkedIds = new Set((await db.collection("cfbdPlayers").where("mappingStatus", "in", ["suggested", "verified"]).select("wedraftPlayerId").get())
    .docs.map((d) => d.data().wedraftPlayerId).filter(Boolean));
  const byName = new Map();
  players.forEach((p) => {
    const k = normName(`${p.First} ${p.Last}`);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
  });
  const cfbdStops = (await db.collection("offseason").doc("careers").get()).data()?.rows || {};
  const wasAt = (p, school, season) => p.School === school || p.PriorSchool === school
    || (p.CareerStops || []).some((s) => s.School === school && season >= s.From && season <= s.To)
    || (cfbdStops[p.id]?.st || []).some(([from, to, s]) => s === school && season >= from && season <= to);

  const byCfbd = {};
  const byPlayer = {};
  const report = [];
  const batch = db.batch();
  for (const set of sets) {
    // team 0 = no team named: plain "All-American".
    const label = (team, pos) => `${team === 0 ? "" : `${TEAM[team] || `Team ${team}`} `}All-${set.conference}${SPOT_NOTE[pos] ? ` (${SPOT_NOTE[pos]})` : ""}`;
    const roster = rosters.get(set.season);
    const r = { file: set.file, selections: set.selections.length, cfbd: 0, wd: 0, missed: [], nameOnly: [], unmappedSchools: new Set() };
    for (const [pos, name, school, team] of set.selections) {
      const entry = [set.season, label(team, pos), school];
      if (!schools.some((s) => s.School === school)) r.unmappedSchools.add(school);

      // 1. The CFBD athlete on that school's roster that season.
      let ath = roster.filter((a) => a.school === school && a.key === normName(name));
      if (!ath.length) {
        const n = splitName(name);
        const nick = roster.filter((a) => a.school === school && a.last === n.last && nickFits(a.first, n.first));
        if (nick.length === 1) ath = nick;
      }
      // (Same label twice — e.g. first team at WR and DB — is one line.)
      const push = (list) => { if (!list.some((x) => x[0] === entry[0] && x[1] === entry[1])) list.push(entry); };
      // Two same-named athletes on one roster: the one whose CFBD position fits.
      if (ath.length > 1) {
        const fit = ath.filter((a) => cfbdPosFits(pos, a.pos));
        if (fit.length === 1) ath = fit;
      }
      // Still 2+ — same name, team and position group: CFBD listing one
      // player twice, so all of them get it.
      if (ath.length > 1 && ath.every((a) => cfbdPosFits(pos, a.pos))) { ath.forEach((a) => push(byCfbd[a.id] ||= [])); r.cfbd += 1; }
      else if (ath.length === 1) { push(byCfbd[ath[0].id] ||= []); r.cfbd += 1; }

      // 2. A We-Draft player with no CFBD link (those get it through _byCfbd).
      let hits = (byName.get(normName(name)) || []).filter((p) => wasAt(p, school, set.season));
      if (!hits.length) {
        const n = splitName(name);
        const nick = players.filter((p) => normName(p.Last || "") === n.last && wasAt(p, school, set.season) && nickFits(normName(p.First || ""), n.first));
        if (nick.length === 1) hits = nick;
      }
      const onCfbd = ath.length === 1 || (ath.length > 1 && ath.every((a) => cfbdPosFits(pos, a.pos)));
      let byNameOnly = false;
      if (!hits.length && !onCfbd) {
        const same = byName.get(normName(name)) || [];
        const fit = same.filter((p) => {
          const e = Number(p.Eligible);
          const ry = Number(p.RecruitYear) || null;
          return e >= set.season + 1 && e <= set.season + 5 && (!ry || ry <= set.season) && posFits(pos, p.Position);
        });
        if (same.length === 1 && fit.length === 1) { hits = fit; byNameOnly = true; }
      }
      const pick = (hits.length > 1 ? hits.filter((p) => p.Live !== false) : hits).filter((p) => !(onCfbd && linkedIds.has(p.id)));
      pick.forEach((p) => push(byPlayer[p.id] ||= []));
      if (hits.length) r.wd += 1;
      if (byNameOnly) r.nameOnly.push(`${name} (${school} → ours: ${hits[0].School} ${hits[0].Eligible})`);
      if (!onCfbd && !hits.length) r.missed.push(`${name} (${school}, ${pos}, ${team})${ath.length > 1 ? " — 2+ CFBD matches" : ""}`);
    }
    report.push(r);
    batch.set(db.collection("honors").doc(`${set.season}-${slug(set.conference)}`), {
      season: set.season, conference: set.conference, source: set.source || "", selections: set.selections.map((x) => x.join("|")),
      importedAt: FieldValue.serverTimestamp(),
    });
  }
  batch.set(db.collection("honors").doc("_byCfbd"), { rows: byCfbd, files: files.length, builtAt: FieldValue.serverTimestamp() });
  batch.set(db.collection("honors").doc("_byPlayer"), { rows: byPlayer, files: files.length, builtAt: FieldValue.serverTimestamp() });
  if (WRITE) await batch.commit();

  report.forEach((r) => {
    console.log(`${r.file}: ${r.cfbd}/${r.selections} on CFBD rosters · ${r.wd} on We-Draft`);
    if (r.unmappedSchools.size) console.log(`  schools not in We-Draft's list: ${[...r.unmappedSchools].join(", ")}`);
    if (r.nameOnly.length) console.log(`  We-Draft match by name only — check: ${r.nameOnly.join("; ")}`);
    if (r.missed.length) console.log(`  not found on CFBD or We-Draft: ${r.missed.join("; ")}`);
  });
  console.log(`${WRITE ? "Wrote" : "Dry run —"} ${files.length} file(s): ${Object.keys(byCfbd).length} CFBD athletes, ${Object.keys(byPlayer).length} unlinked We-Draft players. CFBD calls: ${getCallCount()}${WRITE ? "" : " · add --write to save"}`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
