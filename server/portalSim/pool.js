// server/portalSim/pool.js
//
// The Portal Sim's player pool (src/utils/portalSim/) — every FBS player,
// compact, so a sim loads in a handful of reads. FCS players stay out (user,
// 2026-11-14) unless the admin has graded them (a locked grade in
// config/portalGrades) — those come in with their FCS school as a team that
// never recruits (flag fcs, its branding carried along). Built from Firestore only:
//   compSnapshots/_cfbTeams   FBS teams (slugs from utils/portalTeams.js)
//   schools                   campus coordinates
//   cfbRosters                players, recruiting class, class year, home,
//                             hometown coordinates (hl), season stats
//   portalStars               transfer stars (server/portal/stars.js)
//   config/portalGrades       which FCS players are in (graded ones) — the
//                             locked grades and likeliness themselves are
//                             applied when a sim loads (data.js attachLocks)
//   pffGrades                 snaps → a number-free ROLE (starter /
//                             rotation / reserve / none) and PFF's finer
//                             positions (EDGE vs DL…). No PFF number is
//                             written — memory: PFF admin-only, derived
//                             number-free outputs OK.
//   cfbdPlayers + players     We-Draft links: Declared (draft), InPortal
//                             (the real portal — the sim's live mode)
//
// Writes portalSimPool (public read):
//   portalSimPool/teams  { season, chunks, builtAt,
//                          teams: [[slug, school, conference, lat, lng,
//                                   fcs 0|1, branding (FCS only)]] }
//   portalSimPool/p{n}   { rows: [[id, name, pos, team index, stars, elig,
//                          role, homeLat, homeLng, wdId, flags,
//                          likeliness (0–3, null = model only),
//                          height (in), weight, recruit stars, home state,
//                          packed stats (src/utils/portalSim/stats.mjs),
//                          sub-position: DB "CB" | "S", OL "OT" | "IOL",
//                          else ""]] }
//     role: s starter, r rotation, v reserve, n none
//     flags: "d" declared for the draft, "l" in the real portal
//
// Runs: node --env-file=.env scripts/buildPortalSimPool.js (and at the end of
// scripts/syncCfbdRosters.js, after the transfer stars).

const { FieldValue } = require("firebase-admin/firestore");

const CHUNK = 4000;
// Rough center of each state — a player's home until the roster sync
// carries hometown coordinates (cfbRosters players[].hl).
const STATE_CENTER = {
  AL: [32.8, -86.8], AK: [61.4, -152.3], AZ: [34.2, -111.6], AR: [34.9, -92.4], CA: [37.2, -119.5], CO: [39.0, -105.5], CT: [41.6, -72.7],
  DE: [39.0, -75.5], DC: [38.9, -77.0], FL: [28.6, -82.4], GA: [32.7, -83.4], HI: [20.8, -156.3], ID: [44.4, -114.6], IL: [40.0, -89.2],
  IN: [39.9, -86.3], IA: [42.1, -93.5], KS: [38.5, -98.4], KY: [37.5, -85.3], LA: [31.1, -92.0], ME: [45.4, -69.2], MD: [39.0, -76.8],
  MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3], MS: [32.7, -89.7], MO: [38.4, -92.5], MT: [47.0, -109.6], NE: [41.5, -99.8],
  NV: [39.3, -116.6], NH: [43.7, -71.6], NJ: [40.2, -74.7], NM: [34.4, -106.1], NY: [42.9, -75.5], NC: [35.6, -79.4], ND: [47.5, -100.5],
  OH: [40.3, -82.8], OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.5], SC: [33.9, -80.9], SD: [44.4, -100.2],
  TN: [35.9, -86.4], TX: [31.5, -99.3], UT: [39.3, -111.7], VT: [44.0, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.5], WV: [38.6, -80.6],
  WI: [44.6, -89.9], WY: [43.0, -107.5],
};
// Roster / PFF positions → the sim's.
const CFBD_POS = { QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE", OL: "OL", OT: "OL", OG: "OL", G: "OL", C: "OL", T: "OL", IOL: "OL", DE: "EDGE", EDGE: "EDGE", DT: "DL", NT: "DL", DL: "DL", LB: "LB", OLB: "LB", ILB: "LB", MLB: "LB", DB: "DB", CB: "DB", S: "DB", FS: "DB", SS: "DB", K: "K", PK: "K", P: "P" };
const PFF_POS = { QB: "QB", HB: "RB", FB: "RB", WR: "WR", TE: "TE", T: "OL", G: "OL", C: "OL", DI: "DL", ED: "EDGE", LB: "LB", CB: "DB", S: "DB", K: "K", P: "P" };
// A DB's / OL's finer position — PFF's when it has one, else the roster's.
const DB_SUB = { CB: "CB", S: "S", FS: "S", SS: "S", SAF: "S" };
const OL_SUB = { T: "OT", OT: "OT", LT: "OT", RT: "OT", G: "IOL", OG: "IOL", LG: "IOL", RG: "IOL", C: "IOL", IOL: "IOL" };
// Starters per position (src/utils/portalSim/config.js starters).
const STARTERS = { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 2, EDGE: 2, LB: 2, DB: 4, K: 1, P: 1 };
const MIN_SNAPS = { passing: 100, rushing: 60, receiving: 100, blocking: 200, defense: 150, kicking: 8, punting: 15 };

async function buildPortalSimPool(db, { dry = false } = {}) {
  const { solidStats, eligLeft, decodeGrade } = await import("../../src/utils/portalStars.mjs");
  const { packStats } = await import("../../src/utils/portalSim/stats.mjs");
  const [teamsSnap, schoolsSnap, rosterSnap, starsSnap, pffSnap, linkSnap, wdSnap, gradesSnap] = await Promise.all([
    db.collection("compSnapshots").doc("_cfbTeams").get(),
    db.collection("schools").select("School", "Latitude", "Longitude", "Logo1", "LogoDark", "Color1", "Color2").get(),
    db.collection("cfbRosters").get(),
    db.collection("portalStars").get(),
    db.collection("pffGrades").get(),
    db.collection("cfbdPlayers").where("mappingStatus", "in", ["suggested", "verified"]).select("wedraftPlayerId").get(),
    db.collection("players").select("Declared", "InPortal", "Eligible").get(),
    db.collection("config").doc("portalGrades").get(),
  ]);
  const locks = gradesSnap.data()?.rows || {};
  const fbs = teamsSnap.data()?.teams || {};
  const slugBySchool = new Map(Object.entries(fbs).map(([slug, t]) => [t.School, slug]));
  const brandBySchool = new Map(schoolsSnap.docs.map((d) => d.data()).filter((s) => s.School).map((s) => [s.School, { School: s.School, Logo1: s.Logo1 || "", LogoDark: s.LogoDark || "", Color1: s.Color1 || "", Color2: s.Color2 || "" }]));
  const fcsSlug = (school) => `fcs-${String(school).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  const locBySchool = new Map(schoolsSnap.docs.map((d) => d.data()).filter((s) => s.School).map((s) => [s.School, [Number(s.Latitude) || null, Number(s.Longitude) || null]]));
  const stars = new Map();
  starsSnap.docs.forEach((d) => { if (!d.id.startsWith("_")) Object.entries(d.data().rows || {}).forEach(([id, r]) => stars.set(id, r[0])); });
  const pff = new Map();
  pffSnap.docs.forEach((d) => Object.entries(d.data().players || {}).forEach(([id, r]) => pff.set(id, r)));
  const wdOf = new Map(linkSnap.docs.map((d) => [d.id, d.data().wedraftPlayerId]).filter(([, v]) => v));
  const wd = new Map(wdSnap.docs.map((d) => [d.id, d.data()]));

  const teamList = [];
  const teamIdx = new Map();
  const rows = [];
  let season = null;
  rosterSnap.docs.forEach((d) => {
    const t = d.data();
    const fcs = !slugBySchool.has(t.school);
    // FCS: only the players the admin has graded.
    const graded = (p) => {
      const wdId = wdOf.get(String(p.id));
      return !!decodeGrade(locks[String(p.id)] || (wdId && locks[`wd:${wdId}`])).s;
    };
    if (fcs && !(t.players || []).some((p) => graded(p) && eligLeft(p, t.season) > 0)) return;
    const slug = fcs ? fcsSlug(t.school) : slugBySchool.get(t.school);
    if (t.season && (!season || t.season > season)) season = t.season;
    if (!teamIdx.has(slug)) {
      const loc = locBySchool.get(t.school) || [null, null];
      teamIdx.set(slug, teamList.length);
      teamList.push(fcs ? [slug, t.school, "FCS", loc[0], loc[1], 1, brandBySchool.get(t.school) || null] : [slug, t.school, fbs[slug].Conference || "", loc[0], loc[1], 0, null]);
    }

    // Each player's sim position and snaps, then roles by position.
    const players = (t.players || []).map((p) => {
      const rec = pff.get(String(p.id));
      const pos = (rec && PFF_POS[rec.pos]) || CFBD_POS[String(p.pos || "").toUpperCase()] || null;
      const SUB = pos === "DB" ? DB_SUB : pos === "OL" ? OL_SUB : null;
      const sub = SUB ? SUB[rec?.pos] || SUB[String(p.pos || "").toUpperCase()] || "" : "";
      return { p, rec, pos, sub };
    }).filter((x) => x.pos);
    const byPos = {};
    players.forEach((x) => { (byPos[x.pos] = byPos[x.pos] || []).push(x); });
    Object.entries(byPos).forEach(([pos, list]) => {
      const withSnaps = list.filter((x) => x.rec?.sn).sort((a, b) => b.rec.sn - a.rec.sn);
      const max = withSnaps[0]?.rec.sn || 0;
      list.forEach((x) => {
        const sn = x.rec?.sn || 0;
        const min = MIN_SNAPS[x.rec?.cat] || 100;
        if (sn && withSnaps.indexOf(x) < (STARTERS[pos] || 1) && sn >= min) x.role = "s";
        else if (sn && sn >= max * 0.25) x.role = "r";
        else if (sn) x.role = "v";
        else if (solidStats(x.p.s)) x.role = "r";
        else x.role = x.p.s ? "v" : "n";
      });
    });

    players.forEach(({ p, pos, role, sub }) => {
      if (fcs && !(graded(p) && eligLeft(p, t.season) > 0)) return;
      const id = String(p.id);
      const elig = eligLeft(p, t.season);
      const st = String(p.home || "").split(",").pop().trim().toUpperCase();
      const home = Array.isArray(p.hl) ? p.hl : STATE_CENTER[st] || [null, null];
      const wdId = wdOf.get(id) || "";
      const w = wdId ? wd.get(wdId) : null;
      const flags = `${w?.Declared ? "d" : ""}${w?.InPortal ? "l" : ""}`;
      const lock = decodeGrade(locks[id] || (wdId && locks[`wd:${wdId}`]));
      // Stars: the AUTO grade — the admin's locks are applied when a sim
      // loads (utils/portalSim/data.js attachLocks), so a lock or unlock
      // counts right away without a rebuild.
      rows.push([id, `${p.first || ""} ${p.last || ""}`.trim(), pos, teamIdx.get(slug), stars.get(id) || 2, elig, role, home[0], home[1], wdId, flags, lock.l,
        Number(p.ht) || null, Number(p.wt) || null, Number(p.stars) || null, st || p.hss || "", packStats(p.s), sub]);
    });
  });

  const chunks = Math.ceil(rows.length / CHUNK);
  const result = { season, teams: teamList.length, players: rows.length, chunks, bytes: JSON.stringify(rows).length };
  if (dry) return result;
  const b = db.batch();
  b.set(db.collection("portalSimPool").doc("teams"), { season, chunks, teams: teamList.map((t) => JSON.stringify(t)), builtAt: FieldValue.serverTimestamp() });
  for (let i = 0; i < chunks; i += 1) {
    // Rows as JSON strings — Firestore doesn't allow arrays of arrays.
    b.set(db.collection("portalSimPool").doc(`p${i}`), { rows: rows.slice(i * CHUNK, (i + 1) * CHUNK).map((r) => JSON.stringify(r)) });
  }
  await b.commit();
  return result;
}

module.exports = { buildPortalSimPool };
