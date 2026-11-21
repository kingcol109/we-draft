// server/portal/public.js
//
// The public Transfer Portal's team data (pages/TransferPortal.jsx — the
// /portal/:team Roster and Targets tabs, and the stars on every portal
// row). The full Portal Sim pool is ~2 MB, too much for a public page, so
// this runs the sim's own logic here and writes what each page needs:
//
// Written to compSnapshots (already public read, admin write — no rules
// change), read directly by the page (not getSiteSnapshot: no version):
//   compSnapshots/_portal_{teamSlug}  one FBS team (slug: utils/portalTeams.js):
//     roster   every player on its 2026 roster, plus portal commits to it,
//              each with his 2027 fate (FATES below)
//     signees  its 2027 high school class (recruits, RecruitClass "2027",
//              Commitment = the school — server/portal/signees.js imports
//              them from CFBD)
//     needs    { [pos]: 0..3 } — the sim's needs (engine needsOf), averaged
//              over SEEDS runs of the opening windows
//     wants    [{ pos, sub, kind, share }] — what makes up those needs
//              (hole / upgrade / depth), in at least half the runs
//     targets  the sim's suggested targets who are IN the portal (see
//              scoreTargets) — the full list, projected entrants included,
//              is admin only: offseason/portalSimTargets { teams: { [slug]: [...] } }
// Manual moves (config/portalManual, the admin's Manual Entries tab) count
// as real moves here too.
//   compSnapshots/_portal_board  { season, entries (the CFBD portal entries that
//                           aren't We-Draft players — those come live from
//                           players), stars: { [wdId]: [poolId, stars, elig] }
//                           — every We-Draft player's transfer stars, so a
//                           live portal row can show them }, chunked as
//                           _portal_board, _portal_board_1… when
//                           big (parts)
//   compSnapshots/_portal_stats  { season (the stats' season), rows: { [poolId]:
//                           packed season stats } } for every player in the
//                           portal — the board's position Stats view
//                           (utils/portalStats.js packStats), read only when
//                           that view opens; chunked like the board
//
// Real moves first: We-Draft's own portal flags (players InPortal /
// PortalCycle / PortalCommittedAt / PortalWithdrawnAt) and the CFBD portal
// sync (transferPortal/{season} — server/portal/sync.js; entries matched to
// a We-Draft player are left to the We-Draft record). A real entrant goes
// into the sim as likeliness 3 (always enters), a real commit as already on
// his new roster; everyone else is modeled — that's the projection.
//
// The player card (the page's quick breakdown, user 2026-11-17): every
// roster row also carries hs [name, city, state], rs / rr (recruiting stars /
// national rank), cp — college stops [[from, to, school]], oldest first —
// and sl, his 2026 stat line (portalStars). Stops: a linked We-Draft
// player's from offseason/careers (CFBD rosters); anyone else's rebuilt from
// CFBD's portal history (transferPortal/{2021…}, synced by
// server/portal/sync.js): walk back from his school through the entries
// that brought him there.
//
// Never public (user, 2026-11-17): a player's modeled chance of entering
// the portal or leaving for the NFL — it's for the admin and the sim only,
// so no per-player likelihood is written to these public docs (projected
// entrants only shape which targets the sim suggests).
//
// Stars: the admin's locked grade (config/portalGrades) wins, as in the sim;
// the page also re-applies locks live, so a lock shows before a rebuild.
//
// Runs: node --env-file=.env scripts/buildPortalPages.js, the admin's
// Transfer Portal → Team Pages "Rebuild" (api/portal-sync action "pages"),
// and after the sim pool rebuild (scripts/buildPortalSimPool.js).

const path = require("path");
const { pathToFileURL } = require("url");
const { FieldValue } = require("firebase-admin/firestore");

const SRC = path.join(__dirname, "../../src/utils");
const load = (rel) => import(pathToFileURL(path.join(SRC, rel)).href);

const SEEDS = 8;
const TARGETS_PER_TEAM = 20;
// Hometown kids (user, 2026-11-21): a target whose home is near campus
// scores extra — the full bonus within HOME.full miles, fading to nothing at
// HOME.zero — and the bonus also lets him in a little under his commit bar
// (home is a pull the A–F grade only partly captures).
const HOME = { full: 100, zero: 400, bonus: 0.35, barRelief: 0.25 };
const homeBoost = (miles) => (miles == null ? 0 : HOME.bonus * Math.max(0, Math.min(1, (HOME.zero - miles) / (HOME.zero - HOME.full))));
const BOARD_CHUNK = 2500;
// The fates on a roster row:
//   r returning   on the projected 2027 roster (stayed)
//   a added       committed here from the portal (o: his old school)
//   p in portal   left for the portal, uncommitted
//   t transferred left and committed elsewhere (o: his new school)
//   n NFL         declared for the draft (We-Draft Declared)
//   x exhausted   out of eligibility after 2026
const normName = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z0-9]/g, "");
const toMs = (ts) => (ts?.toMillis ? ts.toMillis() : ts?.toDate ? ts.toDate().getTime() : ts ? Date.parse(ts) || 0 : 0);
const heightIn = (h) => {
  const m = String(h || "").match(/(\d+)\D+(\d+)/);
  return m ? Number(m[1]) * 12 + Number(m[2]) : null;
};

async function buildPortalPages(db, { seeds = SEEDS, dry = false, log = () => {} } = {}) {
  const startedAt = Date.now();
  const [E, M, { expandPool }, { buildFactors }, { mergeConfig }, { attachDraftGrades, attachLocks }, { portalTeamSlug }, { STATE_ABBR }, { packStats }] = await Promise.all([
    load("portalSim/engine.js"), load("portalSim/models.js"), load("portalSim/pool.js"), load("portalSim/factors.js"),
    load("portalSim/config.js"), load("portalSim/attach.js"), load("portalTeams.js"), load("highSchoolMatch.js"), load("portalStats.js"),
  ]);
  const records = require(path.join(SRC, "portalSim/teamRecords.json"));
  const draft = require(path.join(SRC, "draftSim/draftHistory.json"));

  // ── Reads ──
  const [teamsSnap, cfgSnap, locksSnap, gradesSnap, brandSnap] = await Promise.all([
    db.collection("portalSimPool").doc("teams").get(),
    db.collection("config").doc("portalSim").get(),
    db.collection("config").doc("portalGrades").get(),
    db.collection("compSnapshots").doc("_grades").get(),
    db.collection("compSnapshots").doc("_cfbTeams").get(),
  ]);
  const teamsDoc = teamsSnap.data();
  if (!teamsDoc) throw new Error("The Portal Sim pool hasn't been built (scripts/buildPortalSimPool.js).");
  const chunks = await Promise.all(Array.from({ length: teamsDoc.chunks || 0 }, (_, i) => db.collection("portalSimPool").doc(`p${i}`).get().then((s) => s.data())));
  const season = (Number(teamsDoc.season) || new Date().getFullYear()) + 1; // the portal feeds next season
  const admin = cfgSnap.data() || {};
  const locks = locksSnap.data()?.rows || {};
  const fbs = brandSnap.data()?.teams || {};

  const [rosterSnap, starsSnap, careersSnap, hsSnap] = await Promise.all([
    db.collection("cfbRosters").get(),
    db.collection("portalStars").get(),
    db.collection("offseason").doc("careers").get(),
    db.collection("highSchools").select("Name", "City", "State").get(),
  ]);
  const [tpMeta, playersSnap, recruitsSnap, manualSnap] = await Promise.all([
    db.collection("transferPortal").doc(String(season)).get(),
    db.collection("players").select("First", "Last", "Slug", "School", "PriorSchool", "PortalOriginalSchool", "InPortal", "PortalCycle",
      "PortalEnteredAt", "PortalCommittedAt", "PortalWithdrawnAt", "Declared", "Eligible", "Position", "Height", "Weight", "State", "RecruitYear", "HighSchool").get(),
    db.collection("recruits").where("RecruitClass", "==", String(season)).get(),
    db.collection("config").doc("portalManual").get(),
  ]);
  const meta = tpMeta.data() || {};
  const cfbdEntries = (await Promise.all(Array.from({ length: meta.chunks || 0 }, (_, n) => db.collection("transferPortal").doc(`${season}_${n}`).get())))
    .flatMap((s) => s.data()?.entries || []);
  const wdMatched = new Set((meta.matches || []).map((m) => m.key));

  // ── The pool, as the sim loads it ──
  const pool = expandPool(teamsDoc, chunks);
  attachDraftGrades(pool, gradesSnap.data()?.rows);
  attachLocks(pool, locks);
  const bySlug = Object.fromEntries(pool.teams.map((t) => [t.slug, t]));
  const byId = new Map(pool.players.map((p) => [p.id, p]));
  const byWd = new Map(pool.players.filter((p) => p.wdId).map((p) => [p.wdId, p]));
  const byNameTeam = new Map();
  pool.players.forEach((p) => {
    const k = `${normName(p.name)}|${p.team}`;
    byNameTeam.set(k, byNameTeam.has(k) ? null : p); // ambiguous → no match
  });
  const wd = new Map(playersSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
  const slugOfSchool = (name) => (name ? portalTeamSlug(name) : "");

  // ── Real moves ──
  // { key, pid, wdId, name, pos, sub, from, to, status: u|c|w, ms, src }
  const moves = [];
  wd.forEach((p) => {
    if (!p.InPortal && String(p.PortalCycle || "") !== String(season)) return;
    const withdrawn = !p.InPortal && !!p.PortalWithdrawnAt;
    const committed = !p.InPortal && !withdrawn;
    const from = committed ? p.PriorSchool || "" : p.PortalOriginalSchool || p.School || "";
    const pp = byWd.get(p.id);
    moves.push({
      key: `wd:${p.id}`, pid: pp?.id || null, wdId: p.id, name: `${p.First || ""} ${p.Last || ""}`.trim(), pos: pp?.pos || p.Position || "", sub: pp?.sub || "",
      from, to: committed || withdrawn ? p.School || "" : "", status: p.InPortal ? "u" : withdrawn ? "w" : "c",
      ms: toMs(committed ? p.PortalCommittedAt : withdrawn ? p.PortalWithdrawnAt : p.PortalEnteredAt) || toMs(p.PortalEnteredAt), src: "wd",
    });
  });
  const boardEntries = [];
  cfbdEntries.forEach((e) => {
    if (wdMatched.has(e.key)) return; // the We-Draft record speaks for him
    const fromSlug = slugOfSchool(e.originSchool);
    const pp = fromSlug ? byNameTeam.get(`${normName(`${e.first} ${e.last}`)}|${fromSlug}`) : null;
    if (pp?.wdId && moves.some((m) => m.wdId === pp.wdId)) return;
    const from = e.originSchool || e.origin || "";
    const to = e.destSchool || e.dest || "";
    const status = !to ? "u" : to === from ? "w" : "c";
    const mv = { key: e.key, pid: pp?.id || null, wdId: pp?.wdId || "", name: `${e.first} ${e.last}`.trim(), pos: pp?.pos || e.pos || "", sub: pp?.sub || "", from, to, status, ms: toMs(e.date), src: "cfbd" };
    moves.push(mv);
    boardEntries.push({
      k: e.key, n: mv.name, pos: mv.pos, sub: mv.sub, from, to, st: status, d: mv.ms, id: pp?.id || "",
      s: pp?.stars || null, e: pp?.elig ?? null, ht: pp?.ht || null, wt: pp?.wt || null, state: pp?.state || "",
    });
  });
  // The admin's manual entries (config/portalManual — the Manual Entries
  // tab, for moves CFBD hasn't caught up on). Same precedence as the page
  // (utils/portalData.js manualStands): a We-Draft record wins; CFBD wins
  // only when it has him committed and the entry doesn't; else the entry
  // replaces CFBD's move. Hand-entered players (no pool id) are left to the
  // page's live overlay.
  Object.entries(manualSnap.data()?.entries || {}).forEach(([key, m]) => {
    if (m.wd && moves.some((x) => x.src === "wd" && x.wdId === m.wd)) return;
    if (!m.pid) return;
    const i = moves.findIndex((x) => x.pid === String(m.pid));
    if (i >= 0 && moves[i].status === "c" && m.st === "u") return;
    const mv = { key: `man:${key}`, pid: String(m.pid), wdId: m.wd || "", name: m.n, pos: m.pos, sub: m.sub || "", from: m.from || "", to: m.st === "u" ? "" : m.to || "", status: m.st, ms: m.cd || m.d || 0, src: "manual" };
    if (i >= 0) moves[i] = mv; else moves.push(mv);
  });
  const moveOf = new Map(moves.filter((m) => m.pid).map((m) => [m.pid, m]));

  // ── Player cards: high school, recruiting, career, stat line ──
  const bio = new Map(); // CFBD id → { hs, rc }
  rosterSnap.docs.forEach((d) => (d.data().players || []).forEach((r) => {
    bio.set(String(r.id), { hs: r.hs ? [r.hs, r.hsc || "", r.hss || ""] : null, rc: Number(r.rc) || null });
  }));
  const statLine = new Map();
  starsSnap.docs.forEach((d) => Object.entries(d.data().rows || {}).forEach(([id, row]) => { if (Array.isArray(row) && row[9]) statLine.set(id, row[9]); }));
  const wdCareers = careersSnap.data()?.rows || {};
  // Portal history: name|school arrived at → [{ season, from }].
  const arrivals = new Map();
  for (let y = 2021; y < season; y += 1) {
    const meta = (await db.collection("transferPortal").doc(String(y)).get()).data();
    const docs = await Promise.all(Array.from({ length: meta?.chunks || 0 }, (_, n) => db.collection("transferPortal").doc(`${y}_${n}`).get()));
    docs.flatMap((x) => x.data()?.entries || []).forEach((e) => {
      const to = e.destSchool || e.dest;
      const from = e.originSchool || e.origin;
      if (!to || !from || to === from) return;
      const k = `${normName(`${e.first} ${e.last}`)}|${to}`;
      arrivals.set(k, [...(arrivals.get(k) || []), { season: y, from }]);
    });
  }
  const lastSeason = season - 1;
  const careerOf = (p) => {
    const school = bySlug[p.team]?.school || "";
    const w = p.wdId && wdCareers[p.wdId];
    if (w?.st?.length) return w.st.map(([a, b, sch]) => [a, b, sch]);
    const stops = [];
    let cur = school;
    let to = lastSeason;
    const seen = new Set();
    for (let i = 0; i < 5 && cur && !seen.has(cur); i += 1) {
      seen.add(cur);
      const a = (arrivals.get(`${normName(p.name)}|${cur}`) || []).filter((x) => x.season <= to).sort((x, y) => y.season - x.season)[0];
      if (!a) { stops.unshift([bio.get(p.id)?.rc || null, to, cur]); break; }
      stops.unshift([a.season, to, cur]);
      to = a.season - 1;
      cur = a.from;
    }
    return stops;
  };
  // Our high schools (name → [{ city, state abbr }]) — CFBD sometimes files
  // a school under the wrong state (Fleming Island, FL as Charleston, SC).
  const ourHs = new Map();
  hsSnap.docs.forEach((d) => {
    const h = d.data();
    if (!h.Name) return;
    const k = h.Name.toLowerCase();
    ourHs.set(k, [...(ourHs.get(k) || []), { c: h.City || "", s: STATE_ABBR[h.State] || h.State || "" }]);
  });
  // High school: a We-Draft player's own record wins (what his page shows);
  // else CFBD's, unless our list has no school by that name in CFBD's
  // state but exactly one elsewhere — then ours.
  const hsOf = (p, cfbdHs) => {
    const wp = p.wdId && wd.get(p.wdId);
    if (wp?.HighSchool) {
      const st = STATE_ABBR[wp.State] || wp.State || "";
      const ours = (ourHs.get(wp.HighSchool.toLowerCase()) || []).find((h) => h.s === st);
      return [wp.HighSchool, ours?.c || "", st];
    }
    if (!cfbdHs?.[0]) return cfbdHs || null;
    const list = ourHs.get(cfbdHs[0].toLowerCase()) || [];
    if (list.length === 1 && cfbdHs[2] && !list.some((h) => h.s === cfbdHs[2])) return [cfbdHs[0], list[0].c, list[0].s];
    return cfbdHs;
  };
  const cardOf = (p) => {
    const b = bio.get(p.id) || {};
    const w = p.wdId && wdCareers[p.wdId];
    const hs = hsOf(p, w?.hs ? [w.hs.n, w.hs.c || "", w.hs.s || ""] : b.hs);
    return JSON.parse(JSON.stringify({ hs: hs || undefined, rs: p.rStars || undefined, rr: p.rRank || undefined, cp: careerOf(p), sl: statLine.get(p.id) || undefined }));
  };
  log(`moves: ${moves.length} (${boardEntries.length} CFBD-only)`);

  // Declared on We-Draft — fresher than the pool's flag.
  pool.players.forEach((p) => { if (p.wdId && wd.has(p.wdId)) p.declared = !!wd.get(p.wdId).Declared; });

  // ── Projections: the sim's opening windows, SEEDS times ──
  // Real moves are facts: an entrant always enters, a commit is already on
  // his new roster (and stays), a withdrawal stays.
  const simPool = {
    ...pool,
    players: pool.players.map((p) => {
      const m = moveOf.get(p.id);
      if (!m) return p;
      if (m.status === "u") return { ...p, likely: 3 };
      if (m.status === "w") return { ...p, likely: 0 };
      const dest = slugOfSchool(m.to);
      return bySlug[dest] ? { ...p, team: dest, likely: 0 } : null; // left FBS: out of the picture
    }).filter(Boolean),
  };
  const factors = buildFactors(records, draft, pool.teams.map((t) => t.school), mergeConfig(admin.config));
  const entered = {};
  const declared = {};
  const needSum = {};
  const wantCount = {};
  const targetSum = {}; // slug → id → { score, why, fit }
  for (let s = 0; s < seeds; s += 1) {
    let st = E.initPortalSim(simPool, { config: admin.config, tiers: admin.tiers, factors, seed: 104729 * (s + 1) });
    st = E.openNflWindow(st);
    st = E.endNflWindow(st).state;
    st = E.endRetainWindow(st).state;
    Object.values(st.players).forEach((p) => {
      if (p.status === "portal") entered[p.id] = (entered[p.id] || 0) + 1;
      else if (p.status === "declared") declared[p.id] = (declared[p.id] || 0) + 1;
    });
    scoreTargets(st, { E, M, needSum, wantCount, targetSum });
  }
  log(`sim: ${seeds} runs, ${Date.now() - startedAt} ms`);

  // ── Rows ──
  const slugOfWd = (id) => (id && wd.get(id)?.Slug) || "";
  const playerRow = (p, fate, other = "", ms = 0) => ({
    id: p.id, n: p.name, pos: p.pos, sub: p.sub || "", s: p.stars || null, e: p.elig ?? null, role: p.role, ht: p.ht || null, wt: p.wt || null,
    // Home state: a We-Draft player's own record wins over CFBD's.
    st: (p.wdId && wd.get(p.wdId)?.State && (STATE_ABBR[wd.get(p.wdId).State] || wd.get(p.wdId).State)) || p.state || "",
    slug: slugOfWd(p.wdId), ...(p.wdId ? { wd: p.wdId } : {}), f: fate, ...(other ? { o: other } : {}), ...(ms ? { d: ms } : {}),
    ...cardOf(p),
  });
  // A We-Draft mover with no pool row (FCS, no CFBD link): what We-Draft has.
  const wdRow = (m, fate, other) => {
    const p = wd.get(m.wdId) || {};
    const ry = Number(p.RecruitYear) || 0;
    return {
      id: `wd:${m.wdId}`, n: m.name, pos: m.pos, sub: "", s: null, e: ry ? Math.max(0, ry + 5 - season) : null, role: "", ht: heightIn(p.Height), wt: Number(p.Weight) || null,
      st: STATE_ABBR[p.State] || p.State || "", slug: p.Slug || "", f: fate, ...(other ? { o: other } : {}), ...(m.ms ? { d: m.ms } : {}),
    };
  };
  const roster = {}; // slug → rows
  const add = (slug, row) => { if (slug && bySlug[slug]) (roster[slug] = roster[slug] || []).push(row); };
  pool.players.forEach((p) => {
    const m = moveOf.get(p.id);
    if (m && m.status === "u") return add(p.team, playerRow(p, "p", "", m.ms));
    if (m && m.status === "c") {
      add(p.team, playerRow(p, "t", m.to, m.ms));
      return add(slugOfSchool(m.to), playerRow(p, "a", m.from, m.ms));
    }
    if (p.elig === 0) return add(p.team, playerRow(p, "x"));
    if (p.declared) return add(p.team, playerRow(p, "n"));
    return add(p.team, playerRow(p, "r"));
  });
  moves.filter((m) => !m.pid && m.wdId).forEach((m) => {
    if (m.status === "u") add(slugOfSchool(m.from), wdRow(m, "p"));
    if (m.status === "c") { add(slugOfSchool(m.from), wdRow(m, "t", m.to)); add(slugOfSchool(m.to), wdRow(m, "a", m.from)); }
  });

  // 2027 signees by school.
  const signees = {};
  recruitsSnap.docs.forEach((d) => {
    const r = d.data();
    const slug = slugOfSchool(r.Commitment);
    if (!slug || !bySlug[slug]) return;
    (signees[slug] = signees[slug] || []).push({
      id: d.id, n: `${r.First || ""} ${r.Last || ""}`.trim(), pos: r.Position || "", sub: r.SubPosition || "",
      rs: Number(r.RecruitStars) || null, rr: Number(r.RecruitRank) || null, hs: r.HighSchool || "", st: STATE_ABBR[r.State] || r.State || "",
      ht: heightIn(r.Height), wt: Number(r.Weight) || null, slug: r.promotedSlug || "",
    });
  });

  // ── Write ──
  const simTargets = {}; // slug → the sim's suggestions (admin only)
  // Admin targets to take off (user, 2026-11-21: "as teams fill positions"):
  // slug → { [pid]: { why, by? } } — he committed or withdrew, or the
  // team's need at his position is gone (the sim sees it Set, with no want
  // left there) — usually because it signed someone; `by` names who.
  const drops = {};
  const adminTargets = (await db.collection("config").doc("portalTargets").get()).data()?.teams || {};
  const dropsFor = (slug, needs, wants) => {
    const out = {};
    Object.keys(adminTargets[slug] || {}).forEach((pid) => {
      const m = moveOf.get(pid);
      if (m?.status === "c") {
        out[pid] = { why: slugOfSchool(m.to) === slug ? `Committed to ${bySlug[slug].school}` : `Committed to ${m.to || "another school"}` };
        return;
      }
      if (m?.status === "w") { out[pid] = { why: "Withdrew from the portal" }; return; }
      const p = byId.get(pid);
      if (!p) return;
      if ((needs[p.pos] || 0) >= 0.5 || wants.some((w) => w.pos === p.pos)) return;
      const by = (roster[slug] || []).filter((r) => r.f === "a" && r.pos === p.pos).map((r) => r.n);
      out[pid] = { why: `${p.pos} is set${by.length ? "" : " — no open need there"}`, ...(by.length ? { by } : {}) };
    });
    return out;
  };
  const teamDocs = Object.keys(fbs).filter((slug) => bySlug[slug]).map((slug) => {
    const needs = Object.fromEntries(Object.entries(needSum[slug] || {}).map(([k, v]) => [k, Math.round((v / seeds) * 100) / 100]));
    const wants = Object.entries(wantCount[slug] || {})
      .map(([k, n]) => { const [pos, sub, kind] = k.split("|"); return { pos, sub, kind, share: Math.round((100 * n) / seeds) / 100 }; })
      .filter((w) => w.share >= 0.5)
      .sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || b.share - a.share);
    const scored = Object.entries(targetSum[slug] || {})
      .map(([id, t]) => {
        const [kind, fit] = Object.entries(t.by).sort((x, y) => y[1] - x[1])[0][0].split("|");
        return { id, kind, fit, score: t.score / seeds, mi: t.mi ?? null };
      })
      .sort((a, b) => b.score - a.score);
    const toRow = (t) => {
        const p = byId.get(t.id);
        const m = moveOf.get(t.id);
        return {
          id: p.id, n: p.name, pos: p.pos, sub: p.sub || "", from: bySlug[p.team]?.school || "", s: p.stars, e: p.elig, ht: p.ht || null, wt: p.wt || null, st: p.state || "",
          slug: slugOfWd(p.wdId), live: m?.status === "u" ? 1 : 0,
          score: Math.round(t.score * 1000) / 1000, kind: t.kind, fit: t.fit,
          ...(t.mi != null && t.mi <= HOME.zero ? { mi: t.mi } : {}),
        };
    };
    // Public: only players actually in the portal (user, 2026-11-17 —
    // We-Draft.com doesn't project who will enter; the page folds these into
    // Recommended Targets). The sim's full list, projected entrants and
    // all, goes to the admin-only doc below.
    const targets = scored.filter((t) => moveOf.get(t.id)?.status === "u").slice(0, 40).map(toRow);
    simTargets[slug] = scored.slice(0, TARGETS_PER_TEAM).map(toRow);
    drops[slug] = dropsFor(slug, needs, wants);
    return {
      slug, data: {
        slug, school: bySlug[slug].school, season, seeds, builtAt: FieldValue.serverTimestamp(),
        roster: roster[slug] || [], signees: (signees[slug] || []).sort((a, b) => (b.rs || 0) - (a.rs || 0) || (a.rr || 9999) - (b.rr || 9999)),
        needs, wants, targets,
      },
    };
  });
  // Every We-Draft player's stars (live portal rows) + the CFBD-only entries.
  const stars = {};
  pool.players.forEach((p) => { if (p.wdId) stars[p.wdId] = [p.id, p.stars || null, p.elig ?? null]; });
  boardEntries.sort((a, b) => (b.d || 0) - (a.d || 0));
  const parts = Math.max(1, Math.ceil(boardEntries.length / BOARD_CHUNK));
  const boardDocs = Array.from({ length: parts }, (_, i) => ({
    id: i ? `_portal_board_${i}` : "_portal_board",
    data: { season, part: i, parts, builtAt: FieldValue.serverTimestamp(), entries: boardEntries.slice(i * BOARD_CHUNK, (i + 1) * BOARD_CHUNK), ...(i ? {} : { stars }) },
  }));

  // Season stats for everyone in the portal (the Stats view), by pool id.
  const inPortal = new Set(moves.map((m) => m.pid).filter(Boolean).map(String));
  const statRows = {};
  let statSeason = null;
  rosterSnap.docs.forEach((d) => {
    const t = d.data();
    if (t.season && (!statSeason || t.season > statSeason)) statSeason = t.season;
    (t.players || []).forEach((r) => {
      const id = String(r.id);
      if (!inPortal.has(id) || statRows[id]) return;
      const packed = packStats(r.s);
      if (packed) statRows[id] = packed;
    });
  });
  const statIds = Object.keys(statRows);
  const statParts = Math.max(1, Math.ceil(statIds.length / BOARD_CHUNK));
  const statDocs = Array.from({ length: statParts }, (_, i) => ({
    id: i ? `_portal_stats_${i}` : "_portal_stats",
    data: { season: statSeason, part: i, parts: statParts, builtAt: FieldValue.serverTimestamp(), rows: Object.fromEntries(statIds.slice(i * BOARD_CHUNK, (i + 1) * BOARD_CHUNK).map((id) => [id, statRows[id]])) },
  }));

  const sizes = teamDocs.map((t) => JSON.stringify(t.data).length);
  const out = {
    season, teams: teamDocs.length, moves: moves.length, cfbdOnly: boardEntries.length, signees: Object.values(signees).reduce((a, l) => a + l.length, 0),
    projectedEntrants: Object.values(entered).filter((n) => n >= seeds / 2).length, maxTeamDocKB: Math.round(Math.max(0, ...sizes) / 1024),
    boardKB: Math.round(JSON.stringify(boardDocs[0].data).length / 1024), statPlayers: statIds.length, statsKB: Math.round(JSON.stringify(statDocs[0].data).length / 1024), durationMs: Date.now() - startedAt, dry,
  };
  if (dry) return { ...out, sample: { ...teamDocs.find((t) => t.slug === "ohio-state")?.data, targets: simTargets["ohio-state"], drops: drops["ohio-state"] } };

  const prevStats = (await db.collection("compSnapshots").doc("_portal_stats").get()).data();
  // The sim's suggestions, projected entrants included: admin only
  // (offseason is admin-read — the Targets tab reads it).
  await db.collection("offseason").doc("portalSimTargets").set({ season, builtAt: FieldValue.serverTimestamp(), teams: simTargets, drops });
  const writes = [...teamDocs.map((t) => [`_portal_${t.slug}`, t.data]), ...boardDocs.map((b) => [b.id, b.data]), ...statDocs.map((b) => [b.id, b.data])];
  for (let i = 0; i < writes.length; i += 100) {
    const batch = db.batch();
    writes.slice(i, i + 100).forEach(([id, data]) => batch.set(db.collection("compSnapshots").doc(id), data));
    await batch.commit();
  }
  // Old board parts past the new count.
  const prevParts = (await db.collection("compSnapshots").doc("_portal_board").get()).data()?.parts || 0;
  if (prevParts > parts) {
    const b = db.batch();
    for (let i = parts; i < prevParts; i += 1) b.delete(db.collection("compSnapshots").doc(`_portal_board_${i}`));
    await b.commit();
  }
  const prevStatParts = (prevStats?.parts) || 0;
  if (prevStatParts > statParts) {
    const b = db.batch();
    for (let i = statParts; i < prevStatParts; i += 1) b.delete(db.collection("compSnapshots").doc(`_portal_stats_${i}`));
    await b.commit();
  }
  return { ...out, durationMs: Date.now() - startedAt };
}

const KIND_ORDER = { hole: 0, upgrade: 1, talent: 2, depth: 3, body: 4 };

// One run's needs and targets, added to the running sums.
// Needs: engine needsOf. Wants: hole / upgrade / depth (bodies are filler —
// not shown). Targets: for each want, portal players (modeled or real) who
// fit it — the right position (and sub-position), good enough to be a real
// improvement (the want's bar, his effective level: stars, less for not
// having played, or his recruiting profile) — and who would realistically
// pick the school: his grade of it (tier, NIL at its usual offer, the
// playing time its room gives him, home, winning, development — the
// sim's own A–F model, his personality this run) clears his end-of-portal
// commit bar. Score: the want's priority × how far he clears the bar.
// Summed over runs, so a player who enters in more runs ranks higher.
function scoreTargets(st, { E, M, needSum, wantCount, targetSum }) {
  const cfg = st.cfg;
  const portalByPos = {};
  Object.values(st.players).forEach((p) => {
    if (p.status !== "portal") return;
    (portalByPos[p.pos] = portalByPos[p.pos] || []).push({ p, e: E.effOf(p, cfg) });
  });
  Object.values(portalByPos).forEach((l) => l.sort((a, b) => b.e - a.e));
  const n = cfg.windows;
  const barOf = new Map();
  const bar = (p) => {
    if (!barOf.has(p.id)) barOf.set(p.id, M.commitBar(p, n, n, cfg, st.teams[p.team]?.tier));
    return barOf.get(p.id);
  };
  Object.values(st.teams).forEach((team) => {
    if (team.fcs) return;
    const slug = team.slug;
    const needs = E.teamNeeds(st, slug);
    const ns = (needSum[slug] = needSum[slug] || {});
    Object.entries(needs).forEach(([pos, v]) => { ns[pos] = (ns[pos] || 0) + v; });
    const wants = E.wantsOf(st, slug).filter((w) => w.kind !== "body");
    const wc = (wantCount[slug] = wantCount[slug] || {});
    const seen = new Set();
    wants.forEach((w) => {
      const k = `${w.pos}|${w.sub || ""}|${w.kind}`;
      if (!seen.has(k)) { seen.add(k); wc[k] = (wc[k] || 0) + 1; }
    });
    if (team.academy) return; // academies don't recruit the portal
    const ts = (targetSum[slug] = targetSum[slug] || {});
    const best = {};
    wants.forEach((w) => {
      let looked = 0;
      for (const { p, e } of portalByPos[w.pos] || []) {
        if (e < w.min - 1e-9) break; // sorted: no one further fits
        if (w.max != null && e > w.max + 1e-9) continue;
        if (p.team === slug || (w.sub && p.sub && w.sub !== p.sub)) continue;
        if (looked++ >= 60) break;
        const offer = E.likelyOffer(st, slug, p);
        const fit = E.fitAt(st, slug, p);
        const base = M.schoolGrade(p, team, { nil: offer.nil, pt: fit.pt }, cfg);
        const overall = M.overallGrade(base, M.neutralProcess(cfg), cfg);
        const miles = M.milesBetween(p.home, team.loc);
        const hb = homeBoost(miles);
        const ratio = overall / Math.max(1e-6, bar(p)) + hb * HOME.barRelief;
        if (ratio < 1) continue; // he wouldn't realistically pick it
        const score = w.pri * Math.min(1.5, ratio) * (1 + hb);
        if (!best[p.id] || score > best[p.id].score) best[p.id] = { score, kind: w.kind, fit: fit.fit, miles };
      }
    });
    // Summed over runs; the want and fit shown are the ones that carried the
    // most weight across them (not one run's worst case).
    Object.entries(best).forEach(([id, b]) => {
      const t = (ts[id] = ts[id] || { score: 0, by: {} });
      t.score += b.score;
      if (b.miles != null) t.mi = Math.round(b.miles);
      const k = `${b.kind}|${b.fit}`;
      t.by[k] = (t.by[k] || 0) + b.score;
    });
  });
}

module.exports = { buildPortalPages };
