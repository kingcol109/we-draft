// src/hooks/useNationalState.js
//
// The national broadcast's (/broadcast/national) one window onto We-Draft
// Live — no one game, but the big plays and storylines from all of them:
//
//   liveSlate/current      ONE listener: every game's score, clock,
//                          possession, situation, channel, last play, and
//                          the rolling big-plays feed (server/live/store.js)
//   liveGames/{id}         one listener per game in progress (capped —
//                          hooks/useLiveFeed.js useLiveGameDocs): its insight
//                          cards, statLeaders (current top lines) and We-Draft
//                          prospects
//   liveSlate/performances the week's top lines across every game (one small
//                          doc) — the main panel and strips when nothing's on
//   players + _grades      once per spotlighted prospect (cached): weaknesses
//                          and the community grade (utils/communityGrades.js)
//
// Two lanes, so nothing crowds anything else out:
//   left   big plays — and games as they end — one "beat" at a time, in
//          the order they happened: the graphic (BroadcastEvents.js), then
//          the play (or the result) on the main panel for at least
//          BEAT_DWELL_MS, then the next. Scores and finals always wait
//          their turn; on a busy slate other plays may be let go (they still
//          show in the list). Nothing already there on open fires.
//
// With nothing on (phase "idle"): the rail turns through the week's finals
// and the next kickoffs, the main panel through the top performances in the
// country, the strip through what's next, upsets and prospects' best lines.
//
// We-Draft Gameday (Saturday from 6 AM ET until the first kickoff —
// utils/broadcastNational.js isGameday): the same frame, previewing the day
// instead — the main panel turns through the marquee matchups (both teams,
// kickoff, a prospect to watch from each school), the panel under it the
// tale of the tape (cfbLeaders/teams — utils/fbsTeamStats.js), the rail and
// the strip the day's games, the right column the kickoffs. The tale of
// the tape turns over to both teams' season leaders (cfbRosters/{teamId});
// the prospects card to players' big games last time out (each team's last
// final in liveGames).
//
// The rail: close games (one score, 4th quarter or overtime) hold their
// scorebugs; the rest take turns, with games that just ended in the turn
// for RECENT_FINAL_MS (utils/broadcastNational.js railCards).
//   right  We-Draft prospect moments (insight cards) as graphics, and now
//          and then the prospect spotlight — the storyline column expanded
//          with a prospect's day, grade, strengths and weaknesses. One at a
//          time.
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useLiveGameDocs } from "./useLiveFeed";
import { communityFor, gradeLabel } from "../utils/communityGrades";
import { useFbsTeamStats } from "../utils/fbsTeamStats";
import {
  railCards, railAt, topPerformers, isFinalEntry, playerOfGame, topPerformanceList, idleStories, PERF_ROTATE_MS, nationalPhase, scoreChanges, scoreSnapshot, NATIONAL_PROMOS, storylines, quietStory,
  eventForBigPlay, eventForNationalInsight, nationalInsights, queueBigPlays, playerLinesFor, leadersFromBox,
  performanceStories, spotlightCandidates, isGameday, gamedayGames, previewMatchups, gamedayStories, prospectsToWatch, teamLeaders, lastGameStories, lastFinal, PREVIEW_ROTATE_MS,
  NATIONAL_PAGE_MS, IDLE_PAGE_MS, NATIONAL_HOT_MS, STORY_ROTATE_MS, IDLE_STORY_ROTATE_MS, BEAT_DWELL_MS,
  SPOTLIGHT_EVERY_MS, SPOTLIGHT_MS, SPOTLIGHT_REPEAT_MS,
} from "../utils/broadcastNational";

const STALE_MS = 6 * 60 * 1000;
const TICK_MS = 15 * 1000;
const MAX_QUEUED_INSIGHTS = 3;
const RECENT_PLAYS = 3;

// A prospect's board card: grade, class rank, strengths, weaknesses.
// Two reads the first time (the player by slug, the grades snapshot —
// itself cached for the session), none after.
// Only players switched on for We-Draft Live (players/{id}.Live — the same
// rule as the game broadcast and server/live/breaks.js) are spotlighted;
// force: a preview (?spotlight=<slug>) shows any player.
const HIDDEN_LIVE = [false, null, undefined, 0, "false", "no"];
const cardCache = new Map();
function loadProspectCard(slug, force = false) {
  const key = `${slug}|${force ? 1 : 0}`;
  if (!cardCache.has(key)) {
    cardCache.set(key, (async () => {
      const snap = await getDocs(query(collection(db, "players"), where("Slug", "==", slug), limit(1)));
      if (snap.empty) return null;
      const d = snap.docs[0];
      const p = d.data();
      if (!force && HIDDEN_LIVE.includes(p.Live)) return null;
      const c = (await communityFor([d.id]))[d.id] || {};
      return {
        id: d.id, pos: p.Position || null, cls: p.Eligible != null ? String(p.Eligible) : null,
        grade: gradeLabel(c.avg) || null, strengths: (c.strengths || []).slice(0, 3), weaknesses: (c.weaknesses || []).slice(0, 3),
      };
    })().catch(() => null));
  }
  return cardCache.get(key);
}

// A school's We-Draft players (switched on for Live) with their community
// grades, for the gameday preview's prospect to watch — one query per
// school, cached for the session.
const schoolCache = new Map();
function loadSchoolProspects(school) {
  if (!school) return Promise.resolve([]);
  if (!schoolCache.has(school)) {
    schoolCache.set(school, (async () => {
      const snap = await getDocs(query(collection(db, "players"), where("School", "==", school)));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.Slug && !HIDDEN_LIVE.includes(p.Live) && p.Eligible != null);
      const comm = list.length ? await communityFor(list.map((p) => p.id)).catch(() => ({})) : {};
      return list.map((p) => ({
        id: p.id, name: `${p.First || ""} ${p.Last || ""}`.trim(), slug: p.Slug, pos: p.Position || null, cls: String(p.Eligible),
        gradeAvg: comm[p.id]?.avg ?? null, grade: gradeLabel(comm[p.id]?.avg) || null,
      })).filter((p) => p.name);
    })().catch(() => { schoolCache.delete(school); return []; }));
  }
  return schoolCache.get(school);
}

// A team's season leaders (utils/broadcastNational.js teamLeaders) from
// its roster doc, cfbRosters/{teamId} — one read per team, cached for the
// session.
const leadersCache = new Map();
function loadTeamLeaders(teamId) {
  const key = String(teamId);
  if (!leadersCache.has(key)) {
    leadersCache.set(key, getDoc(doc(db, "cfbRosters", key))
      .then((d) => (d.exists() ? teamLeaders(d.data()) : null))
      .catch(() => { leadersCache.delete(key); return null; }));
  }
  return leadersCache.get(key);
}

// A team's last game (utils/broadcastNational.js lastFinal) from its
// liveGames docs — two queries (home, away) per team, cached for the
// session — for the preview's player storylines.
const lastGameCache = new Map();
function loadLastGame(teamId) {
  const key = String(teamId);
  if (!lastGameCache.has(key)) {
    const id = Number(teamId);
    lastGameCache.set(key, Promise.all(["home", "away"].map((side) => getDocs(query(collection(db, "liveGames"), where(`${side}.providerTeamId`, "==", id)))))
      .then((snaps) => lastFinal(snaps.flatMap((sn) => sn.docs.map((d) => ({ id: d.id, ...d.data() })))))
      .catch(() => { lastGameCache.delete(key); return null; }));
  }
  return lastGameCache.get(key);
}

// Testing / preview options (pages/BroadcastNationalPage.js URL params):
//   testEvent "latest"  the newest big play's graphic, once
//   spotlightNow        the first spotlight as soon as there's a candidate;
//                       a slug: that player first, even if he's hidden from Live
//   gameday             the gameday preview whenever nothing's on (any day)
export function useNationalState({ testEvent = null, spotlightNow = false, gameday: forceGameday = false } = {}) {
  const [slate, setSlate] = useState({ ready: false, games: [], bigPlays: [], week: null, seasonType: null });
  const [hot, setHot] = useState(() => new Map()); // id → { side, pts, at }
  const lastScores = useRef(null);
  const lastDataAt = useRef(Date.now());

  useEffect(() => onSnapshot(
    doc(db, "liveSlate", "current"),
    (s) => {
      const d = s.data() || {};
      const games = d.games || [];
      lastDataAt.current = Date.now();
      // A score that went up since the last snapshot lights its game on the
      // rail — never for scores already there when the page opened.
      const changed = scoreChanges(lastScores.current, games);
      lastScores.current = scoreSnapshot(games);
      if (changed.size) {
        const at = Date.now();
        setHot((prev) => { const next = new Map(prev); for (const [id, c] of changed) next.set(id, { ...c, at }); return next; });
      }
      setSlate({ ready: true, games, bigPlays: (d.bigPlays || []).filter((b) => !b.presentation?.nullified), week: d.week ?? null, seasonType: d.seasonType || null });
    },
    () => setSlate((p) => ({ ...p, ready: true })),
  ), []);

  const [perf, setPerf] = useState(null);
  useEffect(() => onSnapshot(doc(db, "liveSlate", "performances"), (s) => setPerf(s.data() || null), () => setPerf(null)), []);

  const liveIds = useMemo(() => slate.games.filter((g) => g.status === "in_progress").map((g) => String(g.id)), [slate.games]);
  const gameDocs = useLiveGameDocs(liveIds);
  const gamesById = useMemo(() => new Map(slate.games.map((g) => [String(g.id), g])), [slate.games]);

  // ── One clock: kickoff times, the stale check, scores cooling off ──
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    setHot((prev) => {
      const stale = [...prev].filter(([, h]) => now - h.at > NATIONAL_HOT_MS);
      if (!stale.length) return prev;
      const next = new Map(prev);
      for (const [id] of stale) next.delete(id);
      return next;
    });
  }, [now]);

  // ── Games ending: when the page sees a game go final, for the rail's
  // recent finals (its turn in the left lane is the ingester's final feed
  // entry, below) ──
  const finalAt = useRef(new Map()); // id → when it went final
  const lastStatus = useRef(null);
  const lastDocs = useRef(new Map()); // the last doc seen per game (its leaders after it drops off)
  useEffect(() => { for (const [id, d] of gameDocs) lastDocs.current.set(id, d); }, [gameDocs]);
  useEffect(() => {
    if (!slate.ready) return;
    const prev = lastStatus.current;
    lastStatus.current = new Map(slate.games.map((g) => [String(g.id), g.status]));
    if (!prev) return;
    const ended = slate.games.filter((g) => g.status === "final" && prev.get(String(g.id)) === "in_progress");
    const t = Date.now();
    for (const g of ended) finalAt.current.set(String(g.id), t);
  }, [slate.games, slate.ready]);

  // ── The rail: close games hold, the rest take turns ──
  const liveCount = liveIds.length;
  const gameday = slate.ready && isGameday(slate.games, now, forceGameday);
  const matchups = useMemo(() => (gameday ? previewMatchups(slate.games, now) : []), [gameday, slate.games, now]);
  const rail = useMemo(() => (gameday
    ? { pinned: [], pool: matchups.map((game) => ({ game, kind: "upcoming" })), fill: [] }
    : railCards(slate.games, now, finalAt.current)), [gameday, matchups, slate.games, now]);
  const [pageTick, setPageTick] = useState(0);
  const turn = railAt(rail, pageTick);
  const many = turn.pages > 1;
  const idle = slate.ready && slate.games.length > 0 && liveIds.length === 0;
  useEffect(() => {
    if (!many) return undefined;
    const t = setInterval(() => setPageTick((x) => x + 1), idle ? IDLE_PAGE_MS : NATIONAL_PAGE_MS);
    return () => clearInterval(t);
  }, [many, idle]);

  // ── Storylines (the strip): game situations + big performances ──
  const perfList = useMemo(() => topPerformanceList(perf, gamesById, now), [perf, gamesById, now]);
  const stories = useMemo(() => {
    const s = gameday ? gamedayStories(slate.games, now) : idle ? idleStories(slate.games, perfList, now) : storylines(slate.games, now, performanceStories(gameDocs, gamesById, now));
    return s.length ? s : [quietStory(slate.games, now)];
  }, [gameday, idle, slate.games, now, gameDocs, gamesById, perfList]);
  // Nothing on: the featured top performance turns over.
  const [perfTick, setPerfTick] = useState(0);
  useEffect(() => {
    if (!idle) return undefined;
    const t = setInterval(() => setPerfTick((x) => x + 1), PERF_ROTATE_MS);
    return () => clearInterval(t);
  }, [idle]);
  const perfTop = perfList.slice(0, 10);
  const perfIndex = perfTop.length ? perfTick % perfTop.length : 0;
  const [storyTick, setStoryTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStoryTick((x) => x + 1), idle ? IDLE_STORY_ROTATE_MS : STORY_ROTATE_MS);
    return () => clearInterval(t);
  }, [idle]);
  const storyIndex = storyTick % stories.length;

  // ── Gameday: the matchup of the moment ──
  const [previewTick, setPreviewTick] = useState(0);
  useEffect(() => {
    if (!gameday) return undefined;
    const t = setInterval(() => setPreviewTick((x) => x + 1), PREVIEW_ROTATE_MS);
    return () => clearInterval(t);
  }, [gameday]);
  const preview = matchups.length ? matchups[previewTick % matchups.length] : null;
  const teamStats = useFbsTeamStats();
  // Each school's prospect to watch: the matchup on screen, and the next
  // one read ahead so its panel never waits.
  const [schoolPros, setSchoolPros] = useState(() => new Map()); // school → list
  const nextPreview = matchups.length > 1 ? matchups[(previewTick + 1) % matchups.length] : null;
  useEffect(() => {
    let alive = true;
    const schools = [preview, nextPreview].flatMap((g) => [g?.home?.school, g?.away?.school]).filter((x) => x && !schoolPros.has(x));
    schools.forEach((school) => loadSchoolProspects(school).then((list) => {
      if (alive) setSchoolPros((m) => (m.has(school) ? m : new Map(m).set(school, list)));
    }));
    return () => { alive = false; };
  }, [preview?.id, nextPreview?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // ...and each team's season leaders (its roster doc) and last game (its
  // players' storylines), the same way.
  const [teamLeads, setTeamLeads] = useState(() => new Map()); // team id → { leaders, last }
  useEffect(() => {
    let alive = true;
    const ids = [preview, nextPreview].flatMap((g) => [g?.home?.providerTeamId, g?.away?.providerTeamId]).filter((x) => x != null && !teamLeads.has(String(x)));
    ids.forEach((id) => Promise.all([loadTeamLeaders(id), loadLastGame(id)]).then(([leaders, last]) => {
      if (alive) setTeamLeads((m) => (m.has(String(id)) ? m : new Map(m).set(String(id), { leaders, last })));
    }));
    return () => { alive = false; };
  }, [preview?.id, nextPreview?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const previewInfo = useMemo(() => {
    if (!preview) return null;
    const side = (s) => ({
      stats: teamStats?.get(Number(preview[s]?.providerTeamId)) || null,
      prospect: prospectsToWatch(schoolPros.get(preview[s]?.school), now)[0] || null,
      leaders: teamLeads.get(String(preview[s]?.providerTeamId))?.leaders || null,
      stories: lastGameStories(teamLeads.get(String(preview[s]?.providerTeamId))?.last, preview[s]?.providerTeamId, now),
    });
    return { game: preview, away: side("away"), home: side("home"), statsReady: !!teamStats, index: previewTick % matchups.length, count: matchups.length };
  }, [preview, teamStats, schoolPros, teamLeads, previewTick, matchups.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Left lane: big plays, one beat at a time ──
  // beat: { play, event, phase: "graphic" | "dwell" | "rest", at }
  const [beat, setBeat] = useState(null);
  const [waiting, setWaiting] = useState([]); // plays waiting their turn
  const seen = useRef(null); // every big play key already taken in
  const shownKeys = useRef(new Set()); // plays the viewer has seen (or that were let go) — the list's

  const startBeat = (play, test = false) => {
    const e = eventForBigPlay(play);
    shownKeys.current.add(play.key);
    setBeat({ play, event: e ? { ...e, id: test ? `test-${e.id}` : e.id } : null, phase: e ? "graphic" : "dwell", at: Date.now() });
  };

  useEffect(() => {
    if (!slate.ready) return;
    if (!seen.current) {
      // Opening: everything there is history — the newest play rests on the panel.
      seen.current = new Set(slate.bigPlays.map((b) => b.key));
      for (const b of slate.bigPlays) shownKeys.current.add(b.key);
      if (slate.bigPlays[0]) setBeat({ play: slate.bigPlays[0], event: null, phase: "rest", at: Date.now() });
      if (testEvent === "latest" && slate.bigPlays[0]) startBeat(slate.bigPlays[0], true);
      return;
    }
    const fresh = slate.bigPlays.filter((b) => !seen.current.has(b.key)).reverse(); // oldest first
    enqueue(fresh);
  }, [slate.bigPlays, slate.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  function enqueue(fresh) {
    if (!fresh.length) return;
    for (const b of fresh) seen.current.add(b.key);
    setWaiting((q) => {
      const { queue, dropped } = queueBigPlays(q, fresh);
      for (const b of dropped) shownKeys.current.add(b.key);
      return queue;
    });
  }

  // Graphic → dwell → next (or rest when nothing's waiting).
  useEffect(() => {
    if (beat && beat.phase === "graphic") {
      const t = setTimeout(() => setBeat((b) => (b === beat ? { ...b, phase: "dwell", at: Date.now() } : b)), beat.event.durationMs || 5000);
      return () => clearTimeout(t);
    }
    if (beat && beat.phase === "dwell") {
      const t = setTimeout(() => setBeat((b) => (b === beat ? { ...b, phase: "rest" } : b)), BEAT_DWELL_MS);
      return () => clearTimeout(t);
    }
    // Resting (or nothing yet): the next waiting play, if it's still on the slate.
    if (waiting.length) {
      const live = new Set(slate.bigPlays.map((b) => b.key));
      const [next, ...rest] = waiting;
      setWaiting(rest);
      if (live.has(next.key)) startBeat(slate.bigPlays.find((b) => b.key === next.key) || next);
      else shownKeys.current.add(next.key);
    }
    return undefined;
  }, [beat, waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  // The beat's play with the latest version from the slate (a revised play
  // keeps its key), and its players' numbers now.
  const current = beat ? slate.bigPlays.find((b) => b.key === beat.play.key) || beat.play : slate.bigPlays[0] || null;
  const currentDoc = current ? gameDocs.get(String(current.gameId)) : null;
  // A player outside his game's top lines (statLeaders): the game's box doc,
  // read once for that play.
  const [boxFor, setBoxFor] = useState({ key: null, doc: null });
  const fromLeaders = useMemo(() => playerLinesFor(current, currentDoc), [current, currentDoc]);
  const wanted = current ? (current.presentation?.line || []).filter((t) => t.player).slice(0, 2).length : 0;
  useEffect(() => {
    if (!current?.gameId || fromLeaders.length >= wanted || boxFor.key === current.key) return;
    let alive = true;
    getDoc(doc(db, "liveGames", String(current.gameId), "box", "live"))
      .then((s) => { if (alive) setBoxFor({ key: current.key, doc: s.exists() ? leadersFromBox(s.data()) : null }); })
      .catch(() => { if (alive) setBoxFor({ key: current.key, doc: null }); });
    return () => { alive = false; };
  }, [current?.key, fromLeaders.length, wanted]); // eslint-disable-line react-hooks/exhaustive-deps
  // A finished game's leaders: its doc while live, else the last one seen,
  // else its lines in the week's performances.
  const finalLeaders = (b) => {
    const d = gameDocs.get(String(b.gameId)) || lastDocs.current.get(String(b.gameId));
    if (d?.statLeaders) return d.statLeaders;
    const out = {};
    for (const cat of ["passing", "rushing", "receiving", "defense"]) {
      const l = (perf?.[cat] || []).filter((e) => String(e.gameId) === String(b.gameId));
      if (l.length) out[cat] = l;
    }
    return out;
  };
  const currentStats = useMemo(() => {
    if (isFinalEntry(current)) return topPerformers(finalLeaders(current));
    if (boxFor.key !== current?.key || !boxFor.doc) return fromLeaders;
    const fromBox = playerLinesFor(current, boxFor.doc);
    return fromBox.length > fromLeaders.length ? fromBox : fromLeaders;
  }, [fromLeaders, boxFor, current, gameDocs, perf]); // eslint-disable-line react-hooks/exhaustive-deps
  const currentStar = useMemo(() => {
    if (!isFinalEntry(current)) return null;
    const side = (current.homeScore ?? 0) >= (current.awayScore ?? 0) ? "home" : "away";
    return playerOfGame(finalLeaders(current), side);
  }, [current, gameDocs, perf]); // eslint-disable-line react-hooks/exhaustive-deps
  const leftEvent = useMemo(() => (beat?.phase === "graphic" && beat.event ? { ...beat.event, statLines: currentStats } : null), [beat, currentStats]);
  const recent = useMemo(() => {
    const out = [];
    for (const b of slate.bigPlays) {
      if (out.length >= RECENT_PLAYS) break;
      if (b.key !== current?.key && shownKeys.current.has(b.key)) out.push(b);
    }
    return out;
  }, [slate.bigPlays, current?.key, waiting, beat]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Right lane: prospect moments and the spotlight ──
  const [rightEv, setRightEv] = useState({ current: null, queue: [] });
  const firedIns = useRef(new Set());
  const seenGames = useRef(new Set());
  useEffect(() => {
    const add = [];
    for (const [id, g] of gameDocs) {
      const list = g.insights || [];
      if (!seenGames.current.has(id)) {
        for (const ins of list) firedIns.current.add(`ins-${id}-${ins.id}`);
        seenGames.current.add(id);
        continue;
      }
      for (const ins of list) {
        const e = eventForNationalInsight(ins, id);
        if (e && !firedIns.current.has(e.id)) { firedIns.current.add(e.id); add.push(e); }
      }
    }
    if (add.length) setRightEv((s) => ({ ...s, queue: [...s.queue, ...add].slice(-MAX_QUEUED_INSIGHTS) }));
  }, [gameDocs]);

  const [spot, setSpot] = useState(null); // { cand, card, at }
  // The first spotlight comes ~20s after the page opens.
  const lastSpotAt = useRef(spotlightNow ? 0 : Date.now() - SPOTLIGHT_EVERY_MS + 20 * 1000);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const spotShown = useRef(new Map()); // slug → last shown
  const candidates = useMemo(() => spotlightCandidates(gameDocs, gamesById, now), [gameDocs, gamesById, now]);

  // One thing at a time on the right: a waiting graphic starts when the
  // column is free; the spotlight only when nothing's waiting.
  useEffect(() => {
    if (rightEv.current || spot) return undefined;
    if (rightEv.queue.length) {
      const [nx, ...rest] = rightEv.queue;
      setRightEv({ current: { ...nx, startedAt: Date.now() }, queue: rest });
      return undefined;
    }
    const t = Date.now();
    if (t - lastSpotAt.current < SPOTLIGHT_EVERY_MS) return undefined;
    const forced = typeof spotlightNow === "string" ? candidates.find((c) => c.slug === spotlightNow && !spotShown.current.has(c.slug)) : null;
    const cand = forced || candidates.find((c) => t - (spotShown.current.get(c.slug) || 0) > SPOTLIGHT_REPEAT_MS);
    if (!cand) return undefined;
    // Claimed now, so the data updating while the card loads can't start a
    // second one; only unmounting drops it.
    lastSpotAt.current = t;
    spotShown.current.set(cand.slug, t);
    // A player the board can't show (not found, hidden) is skipped; the
    // next one gets its turn on the next check.
    loadProspectCard(cand.slug, !!forced).then((card) => {
      if (!mounted.current) return;
      if (card) setSpot({ key: `${cand.key}-${Date.now()}`, cand, card, at: Date.now() });
      else lastSpotAt.current = 0;
    });
    return undefined;
  }, [rightEv, spot, candidates, now, spotlightNow]);
  useEffect(() => {
    if (!rightEv.current) return undefined;
    const t = setTimeout(() => setRightEv((s) => ({ ...s, current: null })), rightEv.current.durationMs || 8000);
    return () => clearTimeout(t);
  }, [rightEv.current]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!spot) return undefined;
    const t = setTimeout(() => { lastSpotAt.current = Date.now(); setSpot(null); }, SPOTLIGHT_MS);
    return () => clearTimeout(t);
  }, [spot]);
  // The spotlighted player's numbers stay current while he's up.
  const spotlight = useMemo(() => {
    if (!spot) return null;
    const live = candidates.find((c) => c.slug === spot.cand.slug && c.gameId === spot.cand.gameId);
    return { ...spot, cand: live || spot.cand, game: gamesById.get(spot.cand.gameId) || spot.cand.game };
  }, [spot, candidates, gamesById]);

  const docOf = (e) => (e?.gameId ? gameDocs.get(e.gameId) || gamesById.get(e.gameId) || null : null);
  const insights = useMemo(() => nationalInsights(gameDocs, 3), [gameDocs]);
  const phase = nationalPhase(slate);

  // ── Data health ──
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  const health = {
    stale: !online || (phase === "live" && now - lastDataAt.current > STALE_MS),
    offline: !online,
    lastDataAt: lastDataAt.current,
  };


  return {
    phase,
    ready: slate.ready,
    week: slate.week,
    seasonType: slate.seasonType,
    now,
    games: slate.games,
    gamesById,
    page: turn.cards,
    liveCount,
    hot,
    latest: current,
    latestStats: currentStats,
    latestStar: currentStar,
    idle,
    gameday,
    preview: previewInfo,
    firstKick: gameday ? gamedayGames(slate.games, now)[0] || null : null,
    perfList: perfTop,
    perfIndex,
    recent,
    waitingCount: waiting.length,
    story: stories[storyIndex],
    insights,
    spotlight,
    leftEvent,
    leftGame: docOf(leftEvent),
    rightEvent: rightEv.current,
    rightGame: docOf(rightEv.current),
    ticker: NATIONAL_PROMOS,
    health,
  };
}
