// server/recruits/commitments.js
//
// Keeps the recruits we have (Admin → Players → Recruits) on CFBD's
// commitments (user, 2026-11-24: "wire cfbd to connect to the recruits we
// have so their commitments update"). One CFBD /recruiting/players call per
// high school class still being recruited (this year + 1 on; CFBD has no
// class until its rankings exist, so an empty year costs one call, writes
// nothing).
//
// Each recruit is tied to his CFBD recruit by CFBDRecruitId, else by name —
// only when the name is unique on both sides in that class (and the states
// agree when both are known); the id is then saved so the next run doesn't
// guess. A tied recruit gets:
//   - RecruitStars / RecruitRank / RecruitRating, CFBDCommitment (our school
//     name; CFBD's own when it isn't one of our schools; "" uncommitted)
//   - Commitment = CFBD's when it differs: a commit, a flip, or a decommit
//     (→ ""), logged in CommitmentLog [{ from, to, at, by: "cfbd" }] with
//     PrevCommitment / CommitmentChangedAt. A commitment to a school we
//     don't have (FCS, …) is reported and left alone, and
//     CommitmentLocked: true (the recruit editor's checkbox) keeps the
//     admin's own.
// Only changed recruits are written. Player pages are never written (a
// promoted recruit's page School is the admin's to update — the recruit
// editor offers it; memory: no auto team changes). The run's summary goes
// to offseason/recruitCommitments.
//
//   node --env-file=.env scripts/syncCommitments.js [--dry] [--year 2027]
//   Admin → Players → Recruits "Sync CFBD commitments" (api/portal-sync
//   action "commitments"), and daily (.github/workflows/sync-recruit-commitments.yml).

const path = require("path");
const { pathToFileURL } = require("url");
const { FieldValue } = require("firebase-admin/firestore");
const { cfbd, getCallCount } = require("../live/cfbdClient");

const key = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z0-9]/g, "");

// The classes still being recruited: next year's (signing day is December)
// and later.
const openYears = (now = new Date()) => {
  const y = now.getFullYear();
  return [y + 1, y + 2, y + 3];
};

async function syncCommitments(db, { years = null, dry = false } = {}) {
  const startedAt = Date.now();
  const { stateName } = await import(pathToFileURL(path.join(__dirname, "../../src/utils/highSchoolMatch.js")).href);
  const schoolsSnap = await db.collection("schools").select("School", "CFBDName").get();
  const schoolOf = new Map();
  schoolsSnap.docs.forEach((d) => {
    const s = d.data();
    if (!s.School) return;
    if (s.CFBDName) schoolOf.set(s.CFBDName, s.School);
    if (!schoolOf.has(s.School)) schoolOf.set(s.School, s.School);
  });

  const today = new Date().toISOString().slice(0, 10);
  const out = { years: [], changes: [], unmapped: [], locked: [], updated: 0, dry };
  const writes = [];

  for (const year of years || openYears()) {
    const snap = await db.collection("recruits").where("RecruitClass", "==", String(year)).get();
    const recruits = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!recruits.length) { out.years.push({ year, recruits: 0, cfbd: 0, matched: 0 }); continue; }
    const rows = await cfbd.recruits({ year, classification: "HighSchool" });

    const byId = new Map(rows.map((c) => [String(c.id), c]));
    const cfbdByName = new Map();
    rows.forEach((c) => { const k = key(c.name); cfbdByName.set(k, cfbdByName.has(k) ? null : c); });
    const oursByName = new Map();
    recruits.forEach((r) => { const k = key(`${r.First} ${r.Last}`); oursByName.set(k, (oursByName.get(k) || 0) + 1); });
    const sameState = (r, c) => !r.State || !c.stateProvince || (stateName(c.stateProvince) || c.stateProvince) === r.State;

    let matched = 0;
    recruits.forEach((r) => {
      const k = key(`${r.First} ${r.Last}`);
      let c = r.CFBDRecruitId ? byId.get(String(r.CFBDRecruitId)) : null;
      if (!c && !r.CFBDRecruitId && oursByName.get(k) === 1) {
        const hit = cfbdByName.get(k);
        if (hit && sameState(r, hit)) c = hit;
      }
      if (!c) return;
      matched += 1;
      const name = `${r.First || ""} ${r.Last || ""}`.trim();
      const mapped = c.committedTo ? schoolOf.get(c.committedTo) || "" : "";
      const patch = {};
      const set = (f, v) => { if ((r[f] ?? null) !== v) patch[f] = v; };
      set("CFBDRecruitId", String(c.id));
      set("RecruitStars", c.stars || null);
      set("RecruitRank", c.ranking || null);
      set("RecruitRating", c.rating ?? null);
      set("CFBDCommitment", c.committedTo ? mapped || c.committedTo : "");

      const now = r.Commitment || "";
      if (c.committedTo && !mapped) {
        if (now !== c.committedTo) out.unmapped.push({ id: r.id, name, cfbd: c.committedTo, ours: now });
      } else if (mapped !== now) {
        if (r.CommitmentLocked) out.locked.push({ id: r.id, name, cfbd: mapped, ours: now });
        else {
          patch.Commitment = mapped;
          patch.PrevCommitment = now;
          patch.CommitmentChangedAt = FieldValue.serverTimestamp();
          patch.CommitmentLog = FieldValue.arrayUnion({ from: now, to: mapped, at: today, by: "cfbd" });
          out.changes.push({
            id: r.id, name, year, from: now, to: mapped,
            kind: !now ? "commit" : !mapped ? "decommit" : "flip",
            playerId: r.promotedPlayerId || "", slug: r.promotedSlug || "",
          });
        }
      }
      if (Object.keys(patch).length) writes.push({ id: r.id, patch });
    });
    out.years.push({ year, recruits: recruits.length, cfbd: rows.length, matched });
  }

  out.updated = writes.length;
  out.cfbdCalls = getCallCount();
  if (dry) return out;

  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    writes.slice(i, i + 400).forEach(({ id, patch }) => batch.update(db.collection("recruits").doc(id), { ...patch, updatedAt: FieldValue.serverTimestamp() }));
    await batch.commit();
  }
  // The last run, for the Recruits tab ("Synced … · N changes").
  await db.collection("offseason").doc("recruitCommitments").set({
    at: FieldValue.serverTimestamp(), years: out.years, updated: out.updated,
    changes: out.changes.slice(0, 200), unmapped: out.unmapped.slice(0, 100), locked: out.locked.slice(0, 100),
  });
  return { ...out, durationMs: Date.now() - startedAt };
}

module.exports = { syncCommitments };
