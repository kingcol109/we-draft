// src/utils/voice/data.js
//
// /voice: the data the engine reads and writes (its ctx). Everything runs in
// the browser on the device — the site's own Firestore and ESPN's public
// API, no server — so the iPad answers with the PC off. Reads are cached for
// the session.
//
//   makeVoiceData({ user }) → ctx: the signed-in user is who "my grade /
//   my strengths" means, and who a logged miss came from.
//
// people: the compSnapshots/_search list (the active draft classes) — one
// read for every name. Older classes / recruits / CFBD rosters can join it
// later.
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../firebase";
import { getSiteSnapshot } from "../siteSnapshots";
import { classSnapshotRanks } from "../classRanks";
import { gradeLabel } from "../gradeScale";
import { canonicalEvalData } from "../evaluationCopies";
import { playsForPlayer, gamesByIds } from "../film/data";
import { espnAthleteId, espnSeasons, espnAllGames, schoolTeamId } from "./espn";
import { decodeDraft } from "./draftRows";
import { pronKey } from "./pronounce";
import { stateName } from "../highSchoolMatch";
import { decodeCfbdRow } from "./cfbdRows";
import { groupOf } from "./stats";
import { portalTeamSlug } from "../portalTeams";
import { championSeasons } from "../careerStops";
import { loadRiserBoard } from "../risers";
import { STAT_METRICS, readMetric, computePositionStats, findComps, communityTraits, decodeCompSnapshotRows, COMP_SNAPSHOT_VERSION, recommendedCompWindow, inRecommendedWindow, doubleExtendedFor, TRAIT_WEIGHT } from "../historicalStats";
import { communityAverage } from "../gradeWindow";
import { GRADE_SCALE } from "../gradeScale";

// The player page's lock: 2026 grades froze at the draft (PlayerProfile.js GRADE_LOCK_DATE).
const GRADE_LOCK = { cls: "2026", at: new Date("2026-04-23T20:00:00-04:00") };
const BANNED = ["faggot", "nigger", "monkey", "nigga", "fuck"]; // the player page's list
const clean = (t) => !BANNED.some((w) => String(t || "").toLowerCase().includes(w));
const once = (map, key, fn) => { if (!map[key]) { map[key] = fn(); map[key].catch(() => { delete map[key]; }); } return map[key]; };
const read = (ref) => getDoc(ref).then((s) => (s.exists() ? { id: s.id, ...s.data() } : null));

let peopleP = null;
const pron = { map: {}, loading: null }; // how names are said, for the session
const players = {};
const caches = { traits: {}, evals: {}, ranks: {}, classes: {}, schedules: {}, pools: {}, comps: {}, games26: {}, rosters: {} };
const NOTE_COLLECTIONS = { admin: "adminNotes", voice: "voiceNotes" };
// Read again after ms (live data): { key → { at, p } }.
const freshCache = {};
const fresh = (key, ms, fn) => {
  const hit = freshCache[key];
  if (hit && Date.now() - hit.at < ms) return hit.p;
  const p = fn();
  freshCache[key] = { at: Date.now(), p };
  p.catch(() => { delete freshCache[key]; });
  return p;
};

// ── CFBD roster players who aren't on We-Draft.com (user, 2026-11-25: their
// stats should still play) ──
// A roster doc by CFBD team id, cached for the session.
const rosterDoc = (teamId, school) => once(caches.rosters, `id:${teamId}`, () => read(doc(db, "cfbRosters", String(teamId))).then((r) => (r ? { ...r, school: r.school || school } : null)));
// CFBD's position → the site's (DE → EDGE, CB → DB …); ATH stays ATH.
const sitePos = (p) => (String(p || "").toUpperCase() === "ATH" ? "ATH" : groupOf(p) || p || "");
const cfbdPerson = (r) => ({ id: `cfbd_${r.cfbd}`, first: r.first, last: r.last, pos: sitePos(r.cfbdPos), school: r.school, cls: null, cfbd: r.cfbd, teamId: r.teamId, onWeDraft: r.onWeDraft, cfbdOnly: true });
// His roster row as a players doc — only what CFBD has (no draft class: that's We-Draft.com's).
// card: his row on the school's Transfer Portal page (compSnapshots/_portal_{slug},
// server/portal/public.js — what the Portal Sim's player card shows): cp
// college stops [[from, to, school]], hs [name, city, state], rs / rr recruiting.
const cfbdPlayerDoc = (p, row, roster, card = null) => {
  const hs = card?.hs || null;
  return {
    id: p.id, cfbdOnly: true, onWeDraft: p.onWeDraft, cfbd: p.cfbd, teamId: p.teamId,
    First: row.first || p.first, Last: row.last || p.last, Position: sitePos(row.pos), School: roster.school || p.school,
    Height: row.ht ? `${Math.floor(row.ht / 12)}'${row.ht % 12}"` : "", Weight: row.wt ? String(row.wt) : "",
    HighSchool: hs?.[0] || row.hs || "", State: hs?.[2] ? stateName(hs[2]) : row.hss ? stateName(row.hss) : "",
    Hometown: row.home || "", RecruitYear: row.rc ? String(row.rc) : "",
    CareerStops: (card?.cp || []).map(([From, To, School]) => ({ School, From, To })),
    ...((card?.rs || row.stars) ? { RecruitStars: card?.rs || row.stars } : {}), ...((card?.rr || row.rank) ? { RecruitRank: card?.rr || row.rank } : {}),
  };
};
// A school's Transfer Portal page, for the session.
const portalPage = (school) => once(caches.rosters, `portal:${school}`, () => read(doc(db, "compSnapshots", `_portal_${portalTeamSlug(school)}`)));
// Accolade docs (the player page's Career Path — PlayerEligibilityInfo.jsx),
// one read each a session: national awards by ESPN athlete, honors by CFBD
// athlete / by We-Draft player.
const docRows = (path) => once(caches.rosters, `rows:${path}`, () => getDoc(doc(db, ...path.split("/"))).then((s) => s.data()?.rows || {}).catch(() => ({})));
// The admin panel's slug (AdminPanel.js generateSlug): first-last-class-position.
export const playerSlug = (first, last, position, eligible) => `${first || ""}-${last || ""}-${eligible || ""}-${position || ""}`
  .replace(/['’`.]/g, "").replace(/[^a-zA-Z0-9\- ]/g, "").replace(/\s+/g, "-").toLowerCase().replace(/-+/g, "-");
// Your own evaluations (myBoard / myEval), for the session.
const mine = { uid: null, loading: null, byId: null, one: {} };

export function makeVoiceData({ user = null } = {}) {
  const uid = user?.uid || null;
  return {
    uid,
    people() {
      if (!peopleP) {
        peopleP = getSiteSnapshot("_search").then((d) => (d?.rows || []).map((r) => ({ id: r.i, first: r.F, last: r.L, pos: r.P, school: r.S, cls: r.E, slug: r.sl })));
        peopleP.catch(() => { peopleP = null; });
      }
      return peopleP;
    },
    // A We-Draft.com player, or (id "cfbd_<id>") a CFBD roster player shaped like one.
    player(id) {
      if (String(id).startsWith("cfbd_")) return once(players, id, () => this.cfbdPeople().then(async (list) => {
        const p = list.find((x) => x.id === id);
        const hit = p ? await this.cfbdRosterRow(p) : null;
        if (!hit) return null;
        const page = await portalPage(hit.roster.school).catch(() => null);
        const card = (page?.roster || []).find((r) => String(r.id) === String(p.cfbd)) || null;
        return cfbdPlayerDoc(p, hit.row, hit.roster, card);
      }));
      return once(players, id, () => read(doc(db, "players", id)));
    },

    // ── Accolades: national awards, all-conference / All-America honors,
    // national titles — the player page's Career Path, for anyone (a CFBD-only
    // player too). → [{ season, text, kind }], newest first. ──
    async accolades(d) {
      const espnId = await espnAthleteId(d).catch(() => null);
      const [awards, byCfbd, byPlayer] = await Promise.all([docRows("awards/_byAthlete"), docRows("honors/_byCfbd"), docRows("honors/_byPlayer")]);
      // His CFBD athlete ids: his own, or a We-Draft player's linked ones.
      const cfbdIds = d.cfbdOnly ? [String(d.cfbd)] : await getDocs(query(collection(db, "cfbdPlayers"), where("wedraftPlayerId", "==", d.id)))
        .then((s) => s.docs.filter((x) => ["suggested", "verified"].includes(x.data().mappingStatus)).map((x) => x.id)).catch(() => []);
      const seen = new Set();
      const out = [
        ...(espnId ? awards[String(espnId)] || [] : []).map(([season, name]) => ({ season: Number(season), text: name, kind: "award" })),
        ...[...cfbdIds.flatMap((x) => byCfbd[x] || []), ...(d.cfbdOnly ? [] : byPlayer[d.id] || [])].map(([season, label]) => ({ season: Number(season), text: label, kind: "honor" })),
        ...(d.CareerStops || []).flatMap((s) => championSeasons(s).map((season) => ({ season, text: "National Champion", kind: "title" }))),
      ].filter((a) => { const k = `${a.season}|${a.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
      return out.sort((a, b) => b.season - a.season || (a.kind === "title" ? -1 : 0));
    },
    // Admin writes: the same updatedAt the admin panel stamps (sitemap lastmod).
    async setPlayer(id, patch) {
      await updateDoc(doc(db, "players", id), { ...patch, updatedAt: serverTimestamp() });
      const cur = await players[id];
      players[id] = Promise.resolve(cur ? { ...cur, ...patch } : null);
    },

    // ── Ranks: the class list snapshot (overall + position, by community grade) ──
    ranks(p) {
      return once(caches.ranks, p.id, async () => {
        const snap = p.Eligible && p.Position ? await getSiteSnapshot(`class_${p.Eligible}_${p.Position}`) : null;
        if (!snap) return null;
        const r = classSnapshotRanks(snap)[p.id];
        const row = (snap.rows || []).find((x) => x.i === p.id) || snap.hidden?.[p.id];
        return r ? { ...r, classSize: snap.classSize || null, grade: gradeLabel(row?.g) } : null;
      });
    },

    // ── Stats (ESPN) ──
    async seasons(p) { const id = await espnAthleteId(p); return id ? espnSeasons(id) : null; },
    async games(p, years) { const id = await espnAthleteId(p); return id ? espnAllGames(id, years) : []; },

    // ── Evaluations ──
    // Public written evaluations, verified graders first, then newest.
    publicEvals(p) {
      return once(caches.evals, p.id, async () => {
        const snap = await getDocs(collection(db, "players", p.id, "evaluations"));
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const pub = all.filter((e) => e.visibility === "public" && String(e.evaluation || "").trim() && clean(e.evaluation));
        const users = await Promise.all([...new Set(pub.map((e) => e.uid).filter(Boolean))].map((u) => read(doc(db, "users", u)).catch(() => null)));
        const byUid = Object.fromEntries(users.filter(Boolean).map((u) => [u.id, u]));
        const ms = (t) => (t?.toMillis ? t.toMillis() : t?.seconds ? t.seconds * 1000 : 0);
        const list = pub.map((e) => ({ ...e, author: byUid[e.uid]?.username || "Anonymous", verified: !!byUid[e.uid]?.verified }))
          .sort((a, b) => (b.verified - a.verified) || ms(b.updatedAt) - ms(a.updatedAt));
        return { count: all.length, list, all };
      });
    },
    // His position's traits + Generic (kickers / punters: their own only), as the player page lists them.
    traits(pos) {
      return once(caches.traits, pos || "_", async () => {
        const [a, g] = await Promise.all([read(doc(db, "traits", pos)), read(doc(db, "traits", "Generic"))]);
        return [...(a?.traits || []), ...(pos === "K" || pos === "P" ? [] : g?.traits || [])];
      });
    },
    gradeLocked: (p) => String(p.Eligible) === GRADE_LOCK.cls && new Date() >= GRADE_LOCK.at,
    // Your evaluations, read once per session (your board: one read per
    // evaluation) and kept current as you save — every board / watch /
    // suggestion question and every grade / trait / note change reads from it.
    async myEval(pid) {
      if (!uid) return null;
      if (mine.uid !== uid) Object.assign(mine, { uid, loading: null, byId: null, one: {} }); // someone else signed in
      const board = mine.byId;
      if (board) return board[pid] || null;
      if (!(pid in mine.one)) mine.one[pid] = read(doc(db, "users", uid, "evaluations", pid));
      return mine.one[pid];
    },
    // Saved the player page's way: both copies (utils/evaluationCopies.js), every field kept.
    async saveMyEval(p, next, extra = {}) {
      if (!uid) throw new Error("Sign in first.");
      const prev = await this.myEval(p.id);
      const data = {
        uid, playerId: p.id, playerName: `${p.First || ""} ${p.Last || ""}`.trim(),
        grade: next.grade || "", strengths: next.strengths || [], weaknesses: next.weaknesses || [], nflFit: next.nflFit || "",
        evaluation: prev?.evaluation || "", visibility: extra.visibility || prev?.visibility || "public", gameNotes: extra.gameNotes || prev?.gameNotes || [],
        firstEvaluatedAt: prev?.firstEvaluatedAt || serverTimestamp(), updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, "players", p.id, "evaluations", uid), canonicalEvalData(data));
      await setDoc(doc(db, "users", uid, "evaluations", p.id), data);
      delete caches.evals[p.id];
      // The cached copy, as saved (no re-read).
      const saved = { ...data, firstEvaluatedAt: prev?.firstEvaluatedAt || new Date(), updatedAt: new Date() };
      mine.one[p.id] = Promise.resolve(saved);
      if (mine.byId) mine.byId[p.id] = saved;
    },

    // Your whole board: every evaluation you've saved → [{ playerId, grade, … }].
    async myBoard() {
      if (!uid) return [];
      if (mine.uid !== uid || !mine.loading) {
        Object.assign(mine, { uid, byId: null, one: {} });
        mine.loading = getDocs(collection(db, "users", uid, "evaluations")).then((snap) => {
          mine.byId = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
          return mine.byId;
        }).catch((e) => { mine.loading = null; throw e; });
      }
      const byId = await mine.loading;
      return Object.entries(byId).map(([playerId, e]) => ({ playerId, ...e }));
    },
    // Game notes (the player page's, one per game): his school's 2026 games that are final —
    // just that school's home and away games (two small queries), not the whole schedule.
    schoolGames(school) {
      return once(caches.games26, school, async () => {
        const [home, away] = await Promise.all([
          getDocs(query(collection(db, "schedule26"), where("Home", "==", school))),
          getDocs(query(collection(db, "schedule26"), where("Away", "==", school))),
        ]);
        return [...home.docs, ...away.docs].map((d) => d.data())
          .filter((g) => g.Final && g.HomeScore != null && g.AwayScore != null && g.Slug)
          .map((g) => ({ id: g.Slug, opponent: g.Home === school ? g.Away : g.Home, dateMs: g.Date?.toDate ? g.Date.toDate().getTime() : (g.Date ? new Date(g.Date).getTime() : 0) }))
          .sort((a, b) => b.dateMs - a.dateMs);
      });
    },
    async saveGameNotes(p, notes) {
      const prev = await this.myEval(p.id);
      await this.saveMyEval(p, { grade: prev?.grade || "", strengths: prev?.strengths || [], weaknesses: prev?.weaknesses || [], nflFit: prev?.nflFit || "" }, { gameNotes: notes });
    },

    // ── The community's boards: a class's list at a position (ranked by community grade) ──
    classList(cls, pos) {
      return once(caches.classes, `${cls}_${pos}`, async () => {
        const snap = await getSiteSnapshot(`class_${cls}_${pos}`);
        return (snap?.rows || []).map((r) => ({ id: r.i, first: r.F, last: r.L, school: r.s, grade: gradeLabel(r.g), avg: r.g, classRank: r.cr, sub: r.sp || "" }));
      });
    },
    // A season's games, every FBS + FCS team (the CFBD schedule snapshot): [{ week, type, date, home, away, hp, ap }]
    schedule(season) {
      return once(caches.schedules, String(season), async () => {
        const snap = await getDoc(doc(db, "compSnapshots", `_filmSchedule_${season}`));
        return snap.exists() ? snap.data().games || [] : [];
      });
    },
    // NFL comparisons — the Comparison page's own math (pages/Comparison.js
    // loadPlayer + results): his measurements and the community's traits vs
    // every graded drafted player at his position in the recommended window;
    // a We-Draft.com Select (hand-picked) leads. → [{ name, year, round, pick, team, school, match, select }]
    comps(p) {
      return once(caches.comps, p.id, async () => {
        if (!p.Position) return [];
        const poolSnap = await once(caches.pools, p.Position, () => getDoc(doc(db, "compSnapshots", p.Position)).then((x) => (x.exists() ? x.data() : null)));
        if (!poolSnap || poolSnap.version !== COMP_SNAPSHOT_VERSION) return [];
        const pool = decodeCompSnapshotRows(poolSnap.rows, p.Position);
        const evals = (await this.publicEvals(p)).all;
        const t = communityTraits(evals);
        const avg = communityAverage(evals, p.Eligible, GRADE_SCALE);
        const round = avg == null ? null : Math.round(avg) <= 3 ? 1 : Math.round(avg) <= 9 ? Math.round(avg) - 2 : null;
        const values = {};
        STAT_METRICS.forEach((m) => { const { value } = readMetric(p, m); if (value != null) values[m.key] = Number(value); });
        const before = parseInt(p.Eligible, 10);
        const statsPool = Number.isFinite(before) ? pool.filter((r) => Number(r.Year) < before) : pool;
        const win = recommendedCompWindow(pool, Number.isFinite(before) ? before : null);
        const candidates = statsPool.filter((r) => inRecommendedWindow(r, win, { allowDoubleExtended: doubleExtendedFor(round) }));
        const input = { position: p.Position, values, strengths: t.strengths, weaknesses: t.weaknesses, traitCounts: t.counts };
        const stats = computePositionStats(statsPool);
        const found = findComps(input, candidates, stats, { heightWindowSd: 1, traitWeight: TRAIT_WEIGHT, limit: 10, subjectRound: round });
        const shape = (r, extra = {}) => ({
          name: r.record.Player || `${r.record.First || ""} ${r.record.Last || ""}`.trim(), year: String(r.record.Year || ""), round: String(r.record.Round || ""),
          pick: String(r.record.Pick || ""), team: r.record["NFL Team"] || "", school: r.record.School || "", match: r.similarity != null ? Math.round(r.similarity) : null, ...extra,
        });
        const out = found.map((r) => shape(r));
        if (p.WeDraftSelect?.id) {
          const sel = await read(doc(db, "historical", p.WeDraftSelect.id)).catch(() => null);
          if (sel) {
            const scored = findComps(input, [sel], stats, { heightWindowSd: null, traitWeight: TRAIT_WEIGHT, limit: 1, requireTraits: false, allowSelectOnly: true })[0];
            const first = shape(scored || { record: sel }, { select: true });
            return [first, ...out.filter((c) => !(c.name === first.name && c.year === first.year))].slice(0, 10);
          }
        }
        return out;
      });
    },

    // ── Admin: answers marked to fix later ("mark that") ──
    markAnswer(entry) {
      if (!uid) return Promise.reject(new Error("Sign in first."));
      return addDoc(collection(db, "voiceMarks"), { ...entry, say: String(entry.say || "").slice(0, 2000), uid, at: serverTimestamp(), done: false });
    },
    listMarks: () => getDocs(collection(db, "voiceMarks")).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    setMarkDone: (id, done) => updateDoc(doc(db, "voiceMarks", id), { done }),

    // ── How names are said (voicePronunciations/{key}: { word, say, playerId }) ──
    // Loaded once; pronMap() is the current map, right away (empty until loaded).
    pronunciations() {
      if (!pron.loading) {
        pron.loading = getDocs(collection(db, "voicePronunciations"))
          .then((s) => { s.docs.forEach((d) => { pron.map[d.id] = d.data(); }); return pron.map; })
          .catch(() => { pron.loading = null; return pron.map; });
      }
      return pron.loading;
    },
    pronMap: () => pron.map,
    async savePronunciation({ word, say, playerId = null }) {
      const key = pronKey(word);
      const row = { word, say, playerId, by: uid, at: serverTimestamp() };
      await setDoc(doc(db, "voicePronunciations", key), row);
      pron.map[key] = { word, say, playerId };
    },
    async deletePronunciation(key) {
      await deleteDoc(doc(db, "voicePronunciations", key));
      delete pron.map[key];
    },

    // ── The NFL draft's history (compSnapshots/_draftHistory) ──
    draftHistory() {
      return once(caches, "draft", async () => {
        const d = await getSiteSnapshot("_draftHistory");
        return { rows: decodeDraft(d?.rows || []), to: Number(d?.to) || null };
      });
    },
    // A future class's top prospects on the community board (compSnapshots/_top).
    async topProspects(year) {
      const d = await getSiteSnapshot("_top");
      return (d?.years?.[year] || []).map((r) => ({ id: r.i, first: r.F, last: r.L, pos: r.P, school: r.S, cls: r.E }));
    },

    // ── Teams: every FBS school (compSnapshots/_cfbTeams), and a team's ESPN season leaders ──
    teams() {
      return once(caches, "teams", async () => {
        const d = await getSiteSnapshot("_cfbTeams");
        return Object.values(d?.teams || {}).map((t) => ({ school: t.School, short: t.Short, mascot: t.Mascot, conference: t.Conference }));
      });
    },
    // [{ cat, value, id, name, pos, year }] — passing / rushing / receiving yards, tackles, sacks, interceptions.
    teamLeaders(school, season) {
      return once(caches, `leaders/${school}/${season}`, async () => {
        const teamId = await schoolTeamId(school);
        if (!teamId) return [];
        const [lead, roster] = await Promise.all([
          fetch(`https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${season}/types/2/teams/${teamId}/leaders`).then((r) => r.json()).catch(() => ({})),
          fetch(`https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/teams/${teamId}/roster`).then((r) => r.json()).catch(() => ({})),
        ]);
        const people = Object.fromEntries((roster.athletes || []).flatMap((g) => g.items || []).map((a) => [String(a.id), { name: a.fullName, pos: a.position?.abbreviation || "", year: a.experience?.displayValue || "" }]));
        const WANT = ["passingYards", "rushingYards", "receivingYards", "totalTackles", "sacks", "interceptions"];
        return (lead.categories || []).filter((c) => WANT.includes(c.name)).flatMap((c) => (c.leaders || []).slice(0, 3).map((l) => {
          const id = (String(l.athlete?.$ref || "").match(/athletes\/(\d+)/) || [])[1];
          return { cat: c.name, value: Number(l.value) || 0, id, ...(people[id] || { name: "", pos: "", year: "" }) };
        })).filter((x) => x.name);
      });
    },

    // ── Film Manager (admin) ──
    filmPlays: (id) => playsForPlayer(`wd_${id}`),
    // The ESPN / CFBD game ids he has film from → how many of his plays.
    async filmGames(id) {
      const plays = await playsForPlayer(`wd_${id}`);
      const games = await gamesByIds([...new Set(plays.map((x) => x.gameId))]);
      const cfbd = Object.fromEntries(games.filter((g) => g.cfbdGameId).map((g) => [g.id, String(g.cfbdGameId)]));
      const out = {};
      plays.forEach((x) => { const c = cfbd[x.gameId]; if (c) out[c] = (out[c] || 0) + 1; });
      return out;
    },

    // ── What it couldn't answer: logged to add later (Voice page → Missed) ──
    logMiss(entry) {
      if (!uid) return Promise.resolve();
      return addDoc(collection(db, "voiceMisses"), { ...entry, text: String(entry.text || "").slice(0, 400), uid, at: serverTimestamp(), done: false }).catch(() => {});
    },
    listMisses: () => getDocs(collection(db, "voiceMisses")).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))),

    // ── The conversation log (voiceLog — utils/voice/log.js): every question and
    // answer, for going over later (scripts/voiceLog.mjs, Review → Log). Fire-and-forget. ──
    logExchange(entry) {
      if (!uid) return Promise.resolve();
      return addDoc(collection(db, "voiceLog"), { ...entry, uid, at: serverTimestamp() }).catch(() => {});
    },
    listLog: (n = 150) => getDocs(query(collection(db, "voiceLog"), orderBy("at", "desc"), limit(n))).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    markMiss: (id, done) => updateDoc(doc(db, "voiceMisses", id), { done }),

    // ── Notes (admin, 2026-11-25): "admin note …" → adminNotes (the admin's
    // to-review bucket); "voice note …" → voiceNotes (for the voice itself).
    // Review → Admin notes / Voice notes lists them. ──
    addNote(kind, entry) {
      if (!uid) return Promise.reject(new Error("Sign in first."));
      return addDoc(collection(db, NOTE_COLLECTIONS[kind]), { ...entry, text: String(entry.text || "").slice(0, 2000), uid, at: serverTimestamp(), done: false });
    },
    listNotes: (kind) => getDocs(collection(db, NOTE_COLLECTIONS[kind])).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    setNoteDone: (kind, id, done) => updateDoc(doc(db, NOTE_COLLECTIONS[kind], id), { done }),

    // ── We-Draft Live (server/live/store.js — the same docs /live reads) ──
    // liveSlate/current: this week's games, scores, status (~120 KB, one
    // read); liveGames/{id}/box/players: one game's player lines (~12 KB).
    // Kept 30 seconds, so a run of questions isn't a read each.
    liveSlate: () => fresh("slate", 30e3, () => getDoc(doc(db, "liveSlate", "current")).then((s) => s.data() || null)),
    liveBox: (gameId) => fresh(`box:${gameId}`, 30e3, () => getDoc(doc(db, "liveGames", String(gameId), "box", "players")).then((s) => s.data() || null)),
    // During a game: stats from the play-by-play, rewritten by the ingester
    // after every play update (liveGames/{id}/box/live, utils/liveStats.mjs —
    // /live's Stats tab). The official box above lands once it's final.
    // The week's best lines across every game (liveSlate/performances — /live's
    // Top Performances tab): { passing, rushing, receiving, defense: [{ id, name, slug, side, stats, v, gameId }] }.
    livePerformances: () => fresh("perf", 30e3, () => getDoc(doc(db, "liveSlate", "performances")).then((s) => s.data() || null)),
    // A past week, kept whole by the ingester (liveSlate/week-{season}-{seasonType}-{week}).
    liveWeek: (season, seasonType, week) => fresh(`week:${season}-${seasonType}-${week}`, 10 * 60e3, () => getDoc(doc(db, "liveSlate", `week-${season}-${seasonType}-${week}`)).then((s) => s.data() || null)),
    livePlayStats: (gameId) => fresh(`pbp:${gameId}`, 20e3, () => getDoc(doc(db, "liveGames", String(gameId), "box", "live")).then((s) => s.data() || null)),

    // ── Draft Risers: a class's board (risers/{year}, utils/risers.js) ──
    risers: (year) => loadRiserBoard(year),

    // ── Admin: the morning readout and site analytics (Admin → Analytics,
    // Daily Visitors, Sim stats) — fresh reads every time, never cached ──
    // Day docs by id ("YYYY-MM-DD", Eastern): analyticsDaily, draftSimDaily,
    // portalSimDaily, siteDailyAccounts → [{ day, v | null }].
    dayDocs: (coll, days) => Promise.all(days.map((day) => getDoc(doc(db, coll, day)).then((s) => ({ day, v: s.exists() ? s.data() : null })).catch(() => ({ day, v: null })))),
    // Open (unresolved) player requests / user reports (Admin → Requests).
    openRequests: () => getDocs(collection(db, "playerRequests")).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => !r.status)),
    openReports: () => getDocs(collection(db, "userReports")).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => !r.status)),
    // The most-viewed pages for a window (analytics/{doc}.pageViews.{window}:
    // last24Hours, last7Days, last30Days, last90Days, lastYear, total) — n reads, not the ~2,800 docs.
    topPages: (window, n) => getDocs(query(collection(db, "analytics"), orderBy(`pageViews.${window}`, "desc"), limit(n))).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    // One page's views (a player page: analytics/{his Slug}).
    pageViews: (docId) => read(doc(db, "analytics", docId)),

    // ── Requests and suggestions: the same docs as Profile → Request a Player /
    // Report an Issue (UserProfile.js), tagged source "voice". ──
    requestPlayer({ playerName, school, position, cfbdId = null }) {
      if (!uid) return Promise.reject(new Error("Sign in first."));
      return addDoc(collection(db, "playerRequests"), { playerName, school, position: position || "", requestedBy: uid, email: user?.email || null, createdAt: serverTimestamp(), source: "voice", ...(cfbdId ? { cfbdId: String(cfbdId) } : {}) });
    },
    sendSuggestion(text) {
      if (!uid) return Promise.reject(new Error("Sign in first."));
      if (!clean(text)) return Promise.reject(new Error("That has language the site doesn't allow."));
      return addDoc(collection(db, "userReports"), { message: String(text).trim().slice(0, 2000), submittedBy: uid, email: user?.email || null, createdAt: serverTimestamp(), kind: "suggestion", source: "voice" });
    },

    // ── CFBD rosters, for players not on We-Draft.com (utils/voice/requests.js) ──
    // A school's roster: one read (cfbRosters/{CFBD team id}), cached.
    cfbdRoster(school) {
      return once(caches.rosters, school, async () => {
        const teamId = await schoolTeamId(school);
        return teamId ? rosterDoc(teamId, school) : null;
      });
    },
    // Everyone on a CFBD roster (compSnapshots/_cfbdPeople + parts, ~27k
    // players): read once a session, only when a name isn't on the board.
    // People rows like people()'s, with id "cfbd_<CFBD id>" and cfbdOnly.
    cfbdPeople() {
      return once(caches.rosters, "_people", async () => {
        const meta = await getSiteSnapshot("_cfbdPeople");
        if (!meta?.parts) return [];
        const parts = await Promise.all(Array.from({ length: meta.parts }, (_x, i) => getSiteSnapshot(`_cfbdPeople_${i}`)));
        // Each part's rows are one newline-joined string (scripts/buildCfbdPeople.mjs).
        return parts.flatMap((p) => String(p?.text || "").split("\n").filter(Boolean)).map((row) => cfbdPerson(decodeCfbdRow(row, meta.teams)));
      });
    },
    // A CFBD-only player's roster row and roster → { row, roster } | null.
    async cfbdRosterRow(p) {
      const roster = p.teamId != null ? await rosterDoc(p.teamId, p.school) : null;
      const row = roster?.players?.find((x) => String(x.id) === String(p.cfbd));
      return row ? { row: { ...row, id: String(row.id), school: roster.school, team: roster.team, teamId: roster.teamId }, roster } : null;
    },
    // Every roster (~240 reads) — only the admin's "add X" with no school said, once a session.
    cfbdAllRosters() {
      return once(caches.rosters, "*", () => getDocs(collection(db, "cfbRosters")).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))));
    },
    // How he'd be added (the CFB Universe defaults): { pos, eligible, recruitYear }.
    async planCfbdAdd(row, { recruitYear = null } = {}) {
      const { POS_MAP, eligibleFor, recruitYearFor } = await import("../../components/CfbUniverseSearch");
      return { pos: POS_MAP[String(row.pos || "").toUpperCase()] || "", eligible: eligibleFor(row), recruitYear: recruitYear || recruitYearFor(row) };
    },
    // Admin: add him to players from his roster row — the CFB Universe add itself.
    async addFromCfbd(row, roster, { pos, eligible, recruitYear }) {
      if (!pos) throw new Error(`no We-Draft position for "${row.pos}"`);
      const { addRosterPlayer } = await import("../../components/CfbUniverseSearch");
      // Slugs already taken that this one could collide with (the add de-dupes -1, -2…).
      const base = playerSlug(row.first, row.last, pos, eligible);
      const taken = await getDocs(query(collection(db, "players"), where("Slug", ">=", base), where("Slug", "<=", `${base}`))).then((s) => s.docs.map((d) => ({ Slug: d.data().Slug })));
      const stateNames = new Proxy({}, { get: (_t, k) => (typeof k === "string" && k ? stateName(k) : "") });
      const { player } = await addRosterPlayer(row, roster, { pos, eligible, live: true, recruitYear }, { allPlayers: taken, generateSlug: playerSlug, stateNames });
      // Findable by voice right away.
      const list = await this.people().catch(() => null);
      if (list) list.push({ id: player.id, first: player.First, last: player.Last, pos: player.Position, school: player.School, cls: player.Eligible, slug: player.Slug });
      return player;
    },
  };
}
