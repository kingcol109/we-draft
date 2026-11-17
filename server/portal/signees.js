// server/portal/signees.js
//
// Every school's high school class (user, 2026-11-17: "We will add every
// school's 2027 class signees and they will show up on the roster") — CFBD
// /recruiting/players (one call), committed high school recruits only,
// written as recruits docs (RecruitClass = the year). They show on the
// Transfer Portal's projected roster (server/portal/public.js reads
// recruits by class + Commitment).
//
// recruits is the admin's own list (Admin → Players → Recruits), so:
//   - new recruits are marked Source "cfbd" + CFBDRecruitId; the class
//     "Promote" button leaves them out unless asked (AdminPanel.js), and
//     each one can be promoted (class of 2030) on its own
//   - a recruit already on the list (CFBDRecruitId, else the same name in
//     the class) only gets the CFBD fields (CFBDRecruitId, RecruitStars,
//     RecruitRank, RecruitRating, CFBDCommitment) — and Commitment when it
//     has none, or when CFBD brought him in (a flip follows CFBD)
//   - a recruit with no promotedPlayerId whose name matches exactly one
//     We-Draft player in the matching draft class (class + 3: 2027 → 2030)
//     is linked to him (promotedPlayerId / promotedSlug, linkedFrom
//     "cfbd-import") — the player already exists, nothing is created
// Players are never written.
//
//   node --env-file=.env scripts/importSignees.js [--year 2027] [--dry]
//   Admin → Transfer Portal → Team Pages "Import signees" (api/portal-sync
//   action "signees").

const path = require("path");
const { pathToFileURL } = require("url");
const { FieldValue } = require("firebase-admin/firestore");
const { cfbd, getCallCount } = require("../live/cfbdClient");

// CFBD recruiting positions → We-Draft's (sub-positions kept).
const POS = { QB: "QB", PRO: "QB", DUAL: "QB", RB: "RB", APB: "RB", FB: "RB", WR: "WR", TE: "TE", OT: "OL", IOL: "OL", OG: "OL", OC: "OL", OL: "OL",
  EDGE: "EDGE", SDE: "EDGE", WDE: "EDGE", DL: "DL", DT: "DL", LB: "LB", ILB: "LB", OLB: "LB", CB: "DB", S: "DB", SAF: "DB", DB: "DB", ATH: "ATH", K: "K", P: "P", LS: "LS" };
const SUB = { OT: "OT", IOL: "IOL", OG: "IOL", OC: "IOL", CB: "CB", S: "S", SAF: "S" };
const key = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z0-9]/g, "");
const split = (name) => {
  const parts = String(name || "").trim().split(/\s+/);
  const suffix = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
  if (parts.length > 2 && suffix.test(parts[parts.length - 1])) return { First: parts.slice(0, -2).join(" "), Last: parts.slice(-2).join(" ") };
  return { First: parts[0] || "", Last: parts.slice(1).join(" ") };
};
const heightStr = (inches) => (inches ? `${Math.floor(inches / 12)}'${Math.round(inches % 12)}"` : "");

async function importSignees(db, { year = 2027, dry = false } = {}) {
  const startedAt = Date.now();
  const { stateName } = await import(pathToFileURL(path.join(__dirname, "../../src/utils/highSchoolMatch.js")).href);
  const rows = await cfbd.recruits({ year, classification: "HighSchool" });

  const [schoolsSnap, recruitsSnap, playersSnap] = await Promise.all([
    db.collection("schools").select("School", "CFBDName").get(),
    db.collection("recruits").where("RecruitClass", "==", String(year)).get(),
    db.collection("players").where("Eligible", "==", String(year + 3)).select("First", "Last", "Slug", "promotedFromRecruitId").get(),
  ]);
  const schoolOf = new Map();
  schoolsSnap.docs.forEach((d) => {
    const s = d.data();
    if (!s.School) return;
    if (s.CFBDName) schoolOf.set(s.CFBDName, s.School);
    if (!schoolOf.has(s.School)) schoolOf.set(s.School, s.School);
  });
  const recruits = recruitsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const byCfbd = new Map(recruits.filter((r) => r.CFBDRecruitId).map((r) => [String(r.CFBDRecruitId), r]));
  const byName = new Map();
  recruits.forEach((r) => { const k = key(`${r.First} ${r.Last}`); byName.set(k, byName.has(k) ? null : r); });
  const playersByName = new Map();
  playersSnap.docs.forEach((d) => {
    const p = d.data();
    const k = key(`${p.First} ${p.Last}`);
    playersByName.set(k, [...(playersByName.get(k) || []), { id: d.id, ...p }]);
  });
  const linkedPlayers = new Set(recruits.map((r) => r.promotedPlayerId).filter(Boolean));

  const creates = [];
  const updates = [];
  const unmapped = {};
  let uncommitted = 0;
  rows.forEach((c) => {
    if (!c.committedTo) { uncommitted += 1; return; }
    const school = schoolOf.get(c.committedTo);
    if (!school) { unmapped[c.committedTo] = (unmapped[c.committedTo] || 0) + 1; return; }
    const cfbdFields = {
      CFBDRecruitId: String(c.id), RecruitStars: c.stars || null, RecruitRank: c.ranking || null,
      RecruitRating: c.rating ?? null, CFBDCommitment: school,
    };
    const k = key(c.name);
    const have = byCfbd.get(String(c.id)) || byName.get(k) || null;
    // An existing We-Draft player for him (already promoted by hand, or
    // added from 247 screenshots): link, never duplicate.
    const pick = (r) => {
      if (r?.promotedPlayerId) return null;
      const hits = (playersByName.get(k) || []).filter((p) => !linkedPlayers.has(p.id));
      return hits.length === 1 ? hits[0] : null;
    };
    if (have) {
      const patch = { ...cfbdFields };
      if (!have.Commitment || (have.Source === "cfbd" && have.Commitment !== school)) patch.Commitment = school;
      const link = pick(have);
      if (link) { Object.assign(patch, { promotedPlayerId: link.id, promotedSlug: link.Slug || "", linkedFrom: "cfbd-import" }); linkedPlayers.add(link.id); }
      const changed = Object.entries(patch).some(([f, v]) => have[f] !== v);
      if (changed) updates.push({ id: have.id, patch, name: c.name });
      return;
    }
    const { First, Last } = split(c.name);
    const doc = {
      First, Last, HighSchool: c.school || "", State: stateName(c.stateProvince) || c.stateProvince || "", City: c.city || "",
      Position: POS[c.position] || c.position || "", ...(SUB[c.position] ? { SubPosition: SUB[c.position] } : {}),
      Height: heightStr(c.height), Weight: c.weight ? String(Math.round(c.weight)) : "",
      RecruitClass: String(year), Commitment: school, Source: "cfbd",
      Flair: "", AdminNotes: "", Flag: "", Film: "", Grades: {}, Strengths: [], Weaknesses: [],
      ...cfbdFields,
    };
    const link = pick(null);
    if (link) { Object.assign(doc, { promotedPlayerId: link.id, promotedSlug: link.Slug || "", linkedFrom: "cfbd-import" }); linkedPlayers.add(link.id); }
    creates.push(doc);
  });

  const out = {
    year, cfbd: rows.length, uncommitted, create: creates.length, update: updates.length,
    linked: creates.filter((d) => d.promotedPlayerId).length + updates.filter((u) => u.patch.promotedPlayerId).length,
    unmapped: Object.entries(unmapped).sort((a, b) => b[1] - a[1]).slice(0, 20),
    cfbdCalls: getCallCount(), dry,
  };
  if (dry) return { ...out, sampleCreates: creates.slice(0, 3), sampleUpdates: updates.slice(0, 5) };

  const ops = [
    ...creates.map((d) => (b) => b.set(db.collection("recruits").doc(), { ...d, importedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })),
    ...updates.map((u) => (b) => b.update(db.collection("recruits").doc(u.id), { ...u.patch, updatedAt: FieldValue.serverTimestamp() })),
  ];
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach((op) => op(batch));
    await batch.commit();
  }
  return { ...out, durationMs: Date.now() - startedAt };
}

module.exports = { importSignees };
