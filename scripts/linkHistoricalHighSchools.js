// scripts/linkHistoricalHighSchools.js
//
// High schools for the `historical` draft picks, from CFBD:
//   1. /draft/picks for each year — the pick's CFBD athlete id, college and
//      hometown state. Matched to our row by name (else round + pick).
//   2. /recruiting/players (high school recruits) for the classes that
//      could feed that draft (year − 8 … year − 2). The recruit is the one
//      with that athlete id; else the same name committed to that college;
//      else the same name from his hometown state — only when exactly one.
//      The high school is saved as CFBD lists it, even in another state than
//      the hometown (players move, go to boarding schools).
//   3. The school goes through utils/highSchoolMatch.js against our
//      highSchools (CFBD's spelling saved as an alias; a school we don't have
//      yet gets a new doc — national schools like IMG in their own state).
// Writes historical.HighSchool + State (the high school's state, full name),
// and historical.Hometown from the draft pick ("Bessemer, AL").
// Rows that already have a HighSchool / Hometown keep it (a different CFBD
// answer is listed to check). CFBD's recruiting data starts in earnest with
// the 2002 class, so the early-2000s drafts mostly stay blank.
//
//   node --env-file=.env scripts/linkHistoricalHighSchools.js            dry run
//   node --env-file=.env scripts/linkHistoricalHighSchools.js --write
//   … --from 2010 --to 2015                                               some years
//   … --class 2026        a class still in `players` (drafted ones only)

const { FieldValue } = require("firebase-admin/firestore");
const { getFirestore } = require("./firebaseAdmin");
const { cfbd, getCallCount } = require("../server/live/cfbdClient");
const { normName } = require("../server/live/store");

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const arg = (k) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : null);
// --repair <file.json>: [{ name, state, alias }] — aliases removed from our
// highSchools docs as wrong (a different school); rows filed under one of
// those schools through that alias move to the school CFBD actually names.
const CLASS = arg("--class");
const REPAIR = args.includes("--repair") ? JSON.parse(require("fs").readFileSync(args[args.indexOf("--repair") + 1], "utf8")) : [];

async function run() {
  // utils/highSchoolMatch.js is an ES module (shared with the React app).
  const { matchHighSchool, stateName, hsKey, NATIONAL_SCHOOLS } = await import("../src/utils/highSchoolMatch.js");
  const db = getFirestore();

  // --class <year>: that draft class still in `players` (not migrated to
  // historical yet) — its drafted players (draftOrder Selection == Slug),
  // shaped like historical rows. Their HighSchool + State go on the players
  // docs, under our highSchools Name as everywhere (players link to /hs/ by it).
  const historical = CLASS
    ? await (async () => {
      const order = Object.fromEntries((await db.collection("draftOrder").get()).docs.map((d) => d.data()).filter((d) => d.Selection).map((d) => [d.Selection, d]));
      return (await db.collection("players").where("Eligible", "==", String(CLASS)).get()).docs
        .map((d) => ({ ref: d.ref, id: d.id, ...d.data() }))
        .filter((p) => order[p.Slug])
        .map((p) => ({ ...p, Year: String(CLASS), Player: `${p.First || ""} ${p.Last || ""}`.trim(), Round: order[p.Slug].Round, Pick: order[p.Slug].Pick }));
    })()
    : (await db.collection("historical").get()).docs.map((d) => ({ ref: d.ref, id: d.id, ...d.data() }));
  const years = [...new Set(historical.map((h) => Number(h.Year)).filter(Boolean))].sort()
    .filter((y) => (!arg("--from") || y >= arg("--from")) && (!arg("--to") || y <= arg("--to")));
  const hsDocs = (await db.collection("highSchools").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const schools = (await db.collection("schools").select("School", "CFBDName").get()).docs.map((d) => d.data());
  const cfbdOf = new Map(schools.filter((s) => s.CFBDName).map((s) => [s.School, s.CFBDName]));

  // Recruit classes, fetched once each.
  const classes = new Map();
  const recruitClass = async (y) => {
    // A failed class would silently drop its matches — retry, then stop.
    if (!classes.has(y)) classes.set(y, await cfbd.recruits({ year: y, classification: "HighSchool" }).catch(() => cfbd.recruits({ year: y, classification: "HighSchool" })));
    return classes.get(y);
  };

  const batchOps = [];
  const report = { years: {}, conflicts: [], created: [], samples: [], repaired: [] };
  for (const year of years) {
    const rows = historical.filter((h) => Number(h.Year) === year);
    const picks = await cfbd.draftPicks({ year }).catch(() => cfbd.draftPicks({ year }));
    const pool = [];
    for (let y = year - 8; y <= year - 2; y++) if (y >= 2000) pool.push(...(await recruitClass(y)));
    const byAthlete = new Map(pool.filter((r) => r.athleteId).map((r) => [String(r.athleteId), r]));
    const byName = new Map();
    pool.forEach((r) => { const k = normName(r.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(r); });

    const stat = { rows: rows.length, had: 0, pick: 0, found: 0, hometown: 0, repaired: 0, how: { id: 0, college: 0, home: 0 } };
    for (const h of rows) {
      const name = normName(h.Player || `${h.First} ${h.Last}`);
      // 1. Our row → CFBD's pick.
      let pick = picks.filter((p) => normName(p.name) === name);
      if (pick.length !== 1) pick = picks.filter((p) => String(p.round) === String(h.Round) && (String(p.pick) === String(h.Pick) || String(p.overall) === String(h.Pick)) && (!pick.length || pick.includes(p)));
      pick = pick.length === 1 ? pick[0] : null;
      if (pick) stat.pick++;
      // The hometown, as CFBD's draft data has it ("Bessemer, AL"; abroad,
      // "Windsor, Canada") — its own field, independent of the high school
      // (players move, go to boarding schools…). Never overwrites one.
      const ht = pick?.hometownInfo;
      const Hometown = ht?.city ? `${ht.city}, ${ht.country && ht.country !== "USA" ? ht.country : ht.state || ""}`.replace(/, $/, "") : "";
      // (Not for --class players: their Info tab takes the hometown from ESPN.)
      if (Hometown && !h.Hometown && !CLASS) { stat.hometown++; batchOps.push((b) => b.update(h.ref, { Hometown })); }
      // 2. The recruit: CFBD's athlete link, else the same name committed to
      // that college, else the same name from the hometown state.
      const college = pick?.collegeTeam || cfbdOf.get(h.School) || h.School;
      const named = byName.get(normName(pick?.name || h.Player || "")) || [];
      const homeState = ht?.state || null;
      // CFBD's athlete links sometimes point at a different, same-named
      // recruit (Russell Wilson → Lincolnton, NC), so an id link whose state
      // isn't the hometown's falls through to the name + college match —
      // which is saved as is wherever the school is (Jeanty: Jacksonville
      // hometown, Frisco Lone Star; prep / boarding schools).
      const idRec = pick?.collegeAthleteId ? byAthlete.get(String(pick.collegeAthleteId)) : null;
      const idFits = idRec && (!homeState || idRec.stateProvince === homeState || !!NATIONAL_SCHOOLS[hsKey(idRec.school)]);
      const candidates = [
        ["id", idFits ? [idRec] : []],
        ["college", named.filter((r) => r.committedTo === college)],
        ["home", homeState ? named.filter((r) => r.stateProvince === homeState) : []],
      ];
      let rec = null; let how = null;
      for (const [kind, list] of candidates) if (list.length === 1) { rec = list[0]; how = kind; break; }
      // No US state: not a high school we can place (e.g. "ProKick Australia").
      if (!rec?.school || (!rec.stateProvince && !NATIONAL_SCHOOLS[hsKey(rec.school)])) continue;
      stat.found++; stat.how[how]++;

      // 3. Our high school doc.
      const home = NATIONAL_SCHOOLS[hsKey(rec.school)];
      // A loose ("close") match is a different school until an admin says so.
      const loose = matchHighSchool(rec.school, home || rec.stateProvince, hsDocs);
      const m = loose && loose.how !== "close" ? loose : null;
      // --repair: a row filed under OUR school only because CFBD's spelling
      // was a wrong alias on it (removed since) moves to the school CFBD names.
      const misfiled = h.HighSchool && REPAIR.some((b) => b.name === h.HighSchool && b.state === h.State && b.alias === rec.school);
      if (misfiled) { stat.repaired++; report.repaired.push(`${year} ${h.Player}: ${h.HighSchool} → ${m ? m.doc.Name : rec.school} (${m ? m.doc.State : home || stateName(rec.stateProvince)})`); }
      // Already has one: left alone (no school docs made for it), listed if CFBD differs.
      if (h.HighSchool && !misfiled) {
        stat.had++;
        const cName = m ? m.doc.Name : rec.school; const cState = m ? m.doc.State : home || stateName(rec.stateProvince);
        if (hsKey(h.HighSchool) !== hsKey(cName) || (h.State && h.State !== cState)) report.conflicts.push(`${year} ${h.Player}: ours ${h.HighSchool} (${h.State || "?"}) · CFBD ${cName} (${cState}) [${how}${rec.city ? `, ${rec.city}` : ""}, class of ${rec.year}, to ${rec.committedTo}]`);
        continue;
      }
      let HighSchool; let State;
      if (m) {
        HighSchool = m.doc.Name; State = m.doc.State;
        if (rec.school !== m.doc.Name && !(m.doc.CFBDNames || []).includes(rec.school)) {
          m.doc.CFBDNames = [...(m.doc.CFBDNames || []), rec.school];
          const id = m.doc.id; const alias = rec.school;
          batchOps.push((b) => b.update(db.collection("highSchools").doc(id), { CFBDNames: FieldValue.arrayUnion(alias) }));
        }
      } else {
        HighSchool = rec.school; State = home || stateName(rec.stateProvince);
        const ref = db.collection("highSchools").doc();
        const data = { Name: HighSchool, State, City: home ? "" : rec.city || "", CFBDNames: [rec.school] };
        hsDocs.push({ id: ref.id, ...data });
        report.created.push(`${HighSchool} (${State})`);
        batchOps.push((b) => b.set(ref, { ...data, createdAt: FieldValue.serverTimestamp() }));
      }

      if (report.samples.length < 12 && year % 4 === 0) report.samples.push(`${year} ${h.Player} (${h.School}) → ${HighSchool}, ${State} [${how}]`);
      // No updatedAt: a data fill, not an edit.
      batchOps.push((b) => b.update(h.ref, { HighSchool, State }));
    }
    report.years[year] = stat;
    console.log(`${year}: ${stat.rows} picks · ${stat.pick} matched to CFBD · high school for ${stat.found} (id ${stat.how.id}, college ${stat.how.college}, hometown ${stat.how.home}) · ${stat.had} already had one · ${stat.hometown} hometowns to add`);
  }

  const total = Object.values(report.years).reduce((a, s) => ({ rows: a.rows + s.rows, found: a.found + s.found, had: a.had + s.had, hometown: a.hometown + s.hometown }), { rows: 0, found: 0, had: 0, hometown: 0 });
  console.log(`\nTOTAL: ${total.found} of ${total.rows} picks have a CFBD high school; ${total.found - total.had} new to write. Hometowns to add: ${total.hometown}.`);
  console.log(`New highSchools docs: ${report.created.length}${report.created.length ? ` — e.g. ${report.created.slice(0, 8).join("; ")}` : ""}`);
  console.log(`Samples:\n  ${report.samples.join("\n  ")}`);
  if (report.conflicts.length) console.log(`Differs from what we have (left alone):\n  ${report.conflicts.join("\n  ")}`);
  if (report.repaired.length) console.log(`Repaired (${report.repaired.length}):\n  ${report.repaired.join("\n  ")}`);
  console.log(`CFBD calls: ${getCallCount()}`);

  if (!WRITE) { console.log("\nDry run — pass --write to save."); return; }
  for (let i = 0; i < batchOps.length; i += 400) {
    const b = db.batch();
    batchOps.slice(i, i + 400).forEach((op) => op(b));
    await b.commit();
  }
  console.log(`Wrote ${batchOps.length} changes.`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
