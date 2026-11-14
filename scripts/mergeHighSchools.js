// scripts/mergeHighSchools.js
//
// Merges duplicate highSchools docs (one school saved under two names —
// "Norland" and "Miami Norland") into the one to keep:
//   1. every players / recruits / historical record on the dropped doc's
//      Name IN ITS STATE gets the kept Name (a "Northwestern" in South
//      Carolina is another school and is left alone; a record with no State
//      is listed, not changed)
//   2. the kept doc gains the dropped Name and its CFBDNames as aliases (so
//      CFBD's spelling keeps matching — utils/highSchoolMatch.js), and any
//      field it's missing (City, Mascot, logos, colors…)
//   3. the dropped doc is deleted
// A dropped doc with no State: its records with no State move too and get
// the kept doc's State. Add :noalias to a pair when the dropped name is too
// common to keep as an alias ("Central", "Lincoln").
// Records are matched by exact Name, the way the site links them.
//
//   node --env-file=.env scripts/mergeHighSchools.js <keepId>:<dropId>[:noalias] [...more pairs]   dry run
//   node --env-file=.env scripts/mergeHighSchools.js <keepId>:<dropId> [...] --write

const { FieldValue } = require("firebase-admin/firestore");
const { getFirestore } = require("./firebaseAdmin");

const WRITE = process.argv.includes("--write");
const PAIRS = process.argv.slice(2).filter((a) => a.includes(":")).map((a) => a.split(":"));
const REFS = ["players", "recruits", "historical"];
const SKIP = new Set(["Name", "State", "CFBDNames", "createdAt", "updatedAt"]);
const empty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);

async function merge(db, keepId, dropId, opt) {
  const { stateName } = await import("../src/utils/highSchoolMatch.js");
  const [k, d] = await Promise.all([db.doc(`highSchools/${keepId}`).get(), db.doc(`highSchools/${dropId}`).get()]);
  if (!k.exists || !d.exists) throw new Error(`${keepId}:${dropId} — ${!k.exists ? keepId : dropId} not found`);
  const keep = k.data(); const drop = d.data();
  // A dropped doc with no State (saved before states were required): its
  // records with no State are this school's too, and get the kept State.
  const stateless = !drop.State;
  if (!stateless && stateName(keep.State) !== stateName(drop.State)) throw new Error(`${keep.Name} (${keep.State}) and ${drop.Name} (${drop.State}) are in different states`);
  console.log(`\n${drop.Name} (${dropId}${stateless ? ", no state" : ""}) → ${keep.Name} (${keepId}), ${keep.State}`);

  const moves = []; const noState = [];
  for (const c of REFS) {
    (await db.collection(c).where("HighSchool", "==", drop.Name).get()).docs.forEach((r) => {
      const x = r.data();
      const who = x.Player || `${x.First || ""} ${x.Last || ""}`.trim();
      if (!x.State && stateless) moves.push({ ref: r.ref, label: `${c}/${r.id} ${who} (State → ${keep.State})`, upd: { HighSchool: keep.Name, State: keep.State } });
      else if (!x.State) noState.push(`${c}/${r.id} ${who}`);
      // Same state, and not already on the kept name (DeMatha: both docs
      // had one name) — nothing to write for those.
      else if (stateName(x.State) === stateName(keep.State) && x.HighSchool !== keep.Name) moves.push({ ref: r.ref, label: `${c}/${r.id} ${who}`, upd: { HighSchool: keep.Name } });
    });
  }
  moves.forEach((m) => console.log(`  move  ${m.label}`));
  noState.forEach((m) => console.log(`  ??    ${m} — no State, left as is`));

  // :noalias — the dropped name is too common to send every CFBD school by
  // that name here ("Central" in Alabama), so it isn't kept as an alias.
  const aliases = opt === "noalias" ? keep.CFBDNames || []
    : [...new Set([...(keep.CFBDNames || []), drop.Name, ...(drop.CFBDNames || [])])];
  const fill = Object.fromEntries(Object.entries(drop).filter(([f, v]) => !SKIP.has(f) && !empty(v) && empty(keep[f])));
  console.log(`  aliases ${JSON.stringify(aliases)}${Object.keys(fill).length ? `, fills ${JSON.stringify(fill)}` : ""}`);
  if (drop.Ranking && drop.Ranking >= (keep.Ranking || 0) && drop.Ranking !== keep.Ranking) console.log(`  note: dropped doc had Ranking ${drop.Ranking}`);

  if (!WRITE) return moves.length;
  for (let i = 0; i < moves.length; i += 400) {
    const b = db.batch();
    moves.slice(i, i + 400).forEach((m) => b.update(m.ref, m.upd));
    await b.commit();
  }
  await db.doc(`highSchools/${keepId}`).update({ ...fill, CFBDNames: aliases, updatedAt: FieldValue.serverTimestamp() });
  await db.doc(`highSchools/${dropId}`).delete();
  return moves.length;
}

(async () => {
  if (!PAIRS.length) throw new Error("usage: mergeHighSchools.js <keepId>:<dropId> [...] [--write]");
  const db = getFirestore();
  let moved = 0;
  for (const [keepId, dropId, opt] of PAIRS) moved += await merge(db, keepId, dropId, opt);
  console.log(`\n${moved} record${moved === 1 ? "" : "s"} ${WRITE ? "moved" : "to move"}.${WRITE ? "" : " Dry run — pass --write to save."}`);
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
