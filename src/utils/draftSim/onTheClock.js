// src/utils/draftSim/onTheClock.js
//
// On the Clock — the nightly Draft Sim broadcast (YouTube + /draftsim/live).
// Nobody plays: the CPU drafts for all 32 teams, once, before the show, and
// the result is saved as a script (simShows/{id}). Every screen — the
// 1920×1080 stream frame on the VM and each viewer on the site — plays that
// same script against the wall clock (now − startAt), so they all see the
// same pick at the same moment, a late joiner lands mid-draft, and nothing
// a viewer does (votes, chat) can change a pick.
//
// No Firestore calls here: the formats, buildShowScript() (the
// engine + the analyst desk, exactly as the site's Draft Sim runs them) and
// the timeline — showTimeline() / momentAt().
//
// Script shape (one doc, well under Firestore's 1 MB):
//   { v, id, format: { key, label, year, rounds, variance, cpuTrades }, seed,
//     title, startAt (ms), generatedAt, pace: { [round]: { clock, trade, pickIn, reveal } },
//     teams:   { [abbr]: { name, nick, city, c1, c2, logo } },
//     players: { [id]: { f, l, pos, sch, logo, slug, rank, posRank, avg, count, str, wk, ht, wt } },
//     analysts:{ [id]: { name, handle, color, avatar, initials, verified } },
//     board:   { [position]: [pid] } — the class board's top BOARD_DEPTH at each
//              position, best first (Best Available drops the ones drafted),
//     opening: [post], beats: [beat], grades: [{ team, letter, score, best, rows: [{ o, r, pid, g }] }] }
//   beat: { kind: "pick", overall, round, inRound, team, via?, pid, value, need?,
//           trade?: { from, to, give: [pick name] }, top: [pid] (best available
//           at the start of the clock — the "who should they take?" vote),
//           picks: [overall] (the team on the clock's picks left, this one first),
//           targets: [pid] (three players it might take — Potential Targets);
//           a trade up's trade.picks / trade.targets are the same for the team
//           that moved up (shown once the pick is in),
//           posts: [post], tradePosts?: [post] }
//   post: { a: analyst id, text, lines?, d: delay ms }
import { initSim, stepCpu, available, currentPick, teamHaul, rngNext, pickName, isSpecialist, warRoomFor, teamRank, acceptOffer, VARIANCE, CPU_TRADES, SIM_POSITIONS } from "./engine";
import { reactTo, ANALYSTS, DEFAULT_CHATTER } from "./analysts";
import { teamNamer } from "./data";

export const SCRIPT_VERSION = 1;
// How deep the script keeps each position's board (Best Available).
export const BOARD_DEPTH = 60;

// The formats an admin can run. Rounds is the default; the admin can change
// it per show (capped at the board's maxRounds when generated).
export const SHOW_FORMATS = {
  full2027: { label: "2027 NFL Draft · All 7 Rounds", year: "2027", rounds: 7, variance: "normal", cpuTrades: "normal" },
  chaos2027: { label: "2027 Chaos Draft · High-Variance Boards", year: "2027", rounds: 7, variance: "more", cpuTrades: "frequent" },
  full2028: { label: "2028 NFL Draft · Way-Too-Early", year: "2028", rounds: 7, variance: "normal", cpuTrades: "normal" },
};
export const DEFAULT_FORMAT = "full2027";

// Pace by round (ms), like a real draft: the clock runs 10s in round 1, 7s
// on Day 2, 5s on Day 3; "the pick is in" holds the same 5s every round;
// the pick stays on screen 15s in round 1, 12s on Day 2, 9s on Day 3. A
// full 7-round show runs about an hour and a half.
export const PACE = {
  1: { clock: 10000, trade: 7000, pickIn: 5000, reveal: 15000 },
  2: { clock: 7000, trade: 6000, pickIn: 5000, reveal: 12000 },
  3: { clock: 7000, trade: 6000, pickIn: 5000, reveal: 12000 },
  late: { clock: 5000, trade: 5000, pickIn: 5000, reveal: 9000 },
};
export const paceFor = (pace, round) => pace?.[round] || pace?.late || PACE[round] || PACE.late;

// The show's fixed segments (ms).
export const INTRO_MS = 45000;       // "Tonight on On the Clock" + the opening posts
export const ROUND_BREAK_MS = 40000; // "Round 2 is complete" + the round's picks
export const PRESHOW_MS = 15 * 60000; // the countdown screen is up this long before start
export const POSTSHOW_MS = 10 * 60000; // the final grades stay on air this long after

const compactPost = (p) => ({ a: p.analyst?.id || "wedraft", text: p.text, ...(p.lines?.length ? { lines: p.lines } : {}), d: p.delay || 0 });

// A board player as the script keeps him.
// str / wk: the community's top strengths and concerns; ht (inches) / wt.
const compactPlayer = (p) => ({
  f: p.First || "", l: p.Last || "", pos: p.Position || "", sch: p.School || "", logo: p.logoDark || p.logo || "", slug: p.Slug || "",
  rank: p.rank ?? null, posRank: p.positionRank ?? null, avg: p.avg ?? null, count: p.count || 0,
  str: (p.strengths || []).slice(0, 3), wk: (p.weaknesses || []).slice(0, 3), ht: p.height ?? null, wt: p.weight ?? null,
});

// Runs the whole draft and the desk once → the script.
//   data      loadSimData(year) (plus branding/staff/history/stars/season)
//   bestGame  async (playerId, season) → { line, opp } | null — Isaac's big games
export async function buildShowScript({ data, formatKey = DEFAULT_FORMAT, rounds, seed, startAt, id, title, bestGame = async () => null, pace = PACE }) {
  const format = { key: formatKey, ...(SHOW_FORMATS[formatKey] || SHOW_FORMATS[DEFAULT_FORMAT]) };
  if (rounds) format.rounds = rounds;
  if (!VARIANCE[format.variance]) format.variance = "normal";
  if (!CPU_TRADES[format.cpuTrades]) format.cpuTrades = "normal";
  const s0 = (seed ?? Math.floor(Math.random() * 2 ** 31)) | 0;
  let state = initSim({
    order: data.order, futureOrder: data.futureOrder, futureYear: data.futureYear, board: data.board, chart: data.chart,
    staff: data.staff, needs: data.needs, userTeams: [], rounds: format.rounds, seed: s0, cpuTrades: format.cpuTrades, variance: format.variance,
  });

  let feedSeed = (s0 ^ 0x9e3779b9) | 0;
  const ctx = {
    ...teamNamer(data.branding), staff: data.staff, season: data.season, year: data.year, chatter: DEFAULT_CHATTER,
    history: data.history, stars: data.stars || {}, memory: {}, games: {},
    rand: () => { const r = rngNext(feedSeed); feedSeed = r.seed; return r.value; },
  };

  const players = {};
  const keep = (p) => { if (p && !players[p.id]) players[p.id] = compactPlayer(p); return p?.id; };
  const board = Object.fromEntries(SIM_POSITIONS.map((pos) => [pos, data.board.filter((p) => p.Position === pos).slice(0, BOARD_DEPTH).map(keep)]));
  const beats = [];
  let guard = 0;
  while (!state.done && guard++ < 2000) {
    const top = available(state).filter((p) => !isSpecialist(p)).slice(0, 4).map(keep);
    const onClock = currentPick(state);
    const clockTeam = onClock?.owner;
    const picksLeft = state.picks.slice(state.idx).filter((p) => p.owner === clockTeam).map((p) => p.overall).slice(0, 8);
    const targets = clockTeam ? potentialTargets(state, clockTeam, onClock, keep) : [];
    const r = stepCpu(state);
    if (!r || r.state === state) break;
    const trade = r.events.find((e) => e.type === "trade");
    // After a trade up, the team that moved up is picking: its picks left
    // and Potential Targets, from the board right after the deal.
    let afterTrade = null;
    if (trade) {
      try {
        const traded = acceptOffer(state, { team: trade.to, give: (trade.give || []).map((g) => g.overall), ratio: trade.ratio, target: trade.target }).state;
        afterTrade = {
          picks: traded.picks.slice(traded.idx).filter((p) => p.owner === trade.to).map((p) => p.overall).slice(0, 8),
          targets: potentialTargets(traded, trade.to, currentPick(traded), keep),
        };
      } catch (err) {
        console.error("On the Clock: after the trade at", onClock?.overall, err);
      }
    }
    const pick = r.events.find((e) => e.type === "pick");
    // Isaac's standout games, looked up before he talks.
    if (pick) {
      const g = await bestGame(pick.prospect.id, data.season).catch(() => null);
      if (g) ctx.games[pick.prospect.id] = g;
    }
    const tradePosts = trade ? reactTo(trade, ctx).map(compactPost) : null;
    const posts = pick ? reactTo(pick, ctx).map(compactPost) : [];
    state = r.state;
    if (!pick) break;
    beats.push({
      kind: "pick", overall: pick.pick.overall, round: pick.pick.round, inRound: pick.pick.inRound ?? onClock?.inRound ?? null,
      team: pick.team, ...(pick.pick.via ? { via: pick.pick.via } : {}), pid: keep(pick.prospect), value: pick.value || 0,
      ...(pick.need?.key ? { need: pick.need.key } : {}),
      ...(trade ? { trade: { from: trade.from, to: trade.to, give: (trade.give || []).map(pickName), ...(afterTrade || {}) } } : {}),
      top, picks: picksLeft, targets, posts, ...(tradePosts?.length ? { tradePosts } : {}),
    });
  }

  const teamSet = new Set([...beats.map((b) => b.team), ...data.order.map((p) => p.Team)]);
  const teams = {};
  teamSet.forEach((abbr) => {
    const b = data.branding?.[abbr] || {};
    teams[abbr] = { name: ctx.teamName(abbr), nick: ctx.nickname(abbr), city: ctx.city(abbr), c1: b.Color1 || "#0055a5", c2: b.Color2 || "#f6a21d", logo: b.LogoDark || b.Logo1 || "" };
  });

  const grades = [...teamSet].map((t) => {
    const h = teamHaul(state, t);
    const best = [...h.rows].sort((a, b) => b.score - a.score)[0];
    return {
      team: t, letter: h.letter, score: Math.round(h.score * 10) / 10, picks: h.rows.length,
      ...(best ? { best: { pid: keep(best.prospect), overall: best.pick.overall } } : {}),
      // The class, pick by pick, each with its own grade (the final's team pages).
      rows: h.rows.map((r) => ({ o: r.pick.overall, r: r.pick.round, pid: keep(r.prospect), g: r.letter })),
    };
  }).filter((g) => g.picks).sort((a, b) => b.score - a.score);

  const analysts = Object.fromEntries(ANALYSTS.filter((a) => a.enabled).map((a) => [a.id, {
    name: a.name, handle: a.handle || "", color: a.color || "#0055a5", avatar: a.avatar || "", initials: a.initials || "", verified: !!a.verified,
  }]));

  const roundCount = Math.max(0, ...beats.map((b) => b.round));
  const opening = [
    { a: "wedraft", text: `On the Clock is LIVE. Tonight: the ${data.year} NFL Draft, ${roundCount === 7 ? "all 7 rounds" : `${roundCount} round${roundCount === 1 ? "" : "s"}`}${format.variance === "more" ? ", with every war room on its own board" : ""}.`, lines: [`${beats.length} picks, every war room run by the CPU. Vote on every pick at we-draft.com/draftsim/live.`], d: 0 },
    { a: "isaac", text: "Pull up a chair. Let's see who's got a plan and who's winging it.", d: 4000 },
  ].filter((p) => analysts[p.a]);

  return {
    v: SCRIPT_VERSION, id, title: title || `On the Clock: ${format.label}`, format, seed: s0, startAt, generatedAt: Date.now(),
    pace, teams, players, board, analysts, opening, beats, grades,
  };
}

// Potential Targets: three players the team on the clock might take — its
// war room's picks (engine warRoomFor: the GM's, the head coach's, a
// coordinator's; one each, no repeats), filled out from the team's own
// board (teamRank) when they agree. [pid]; [] if it can't be read.
const TARGETS = 3;
function potentialTargets(state, team, pick, keep) {
  try {
    const room = warRoomFor(state, team, pick.overall);
    const ids = [...new Set([room.gm, room.hc, room.coordinator].filter((c) => c?.p).map((c) => c.p.id))];
    const fill = available(state).filter((p) => !isSpecialist(p) && !ids.includes(p.id))
      .sort((x, y) => teamRank(state, team, x) - teamRank(state, team, y));
    for (const p of fill) { if (ids.length >= TARGETS) break; ids.push(p.id); }
    return ids.slice(0, TARGETS).map((id) => keep(state.byId[id]));
  } catch (err) {
    console.error("On the Clock: potential targets for", team, pick?.overall, err);
    return [];
  }
}

// ── Timeline ──
// Every segment of the show, in order, with its start/end offset from
// startAt (ms): intro, then per pick [trade] → clock → pickIn → reveal, a
// round break after each round but the last, then final (open-ended).
export function showTimeline(script) {
  const segs = [];
  let t = 0;
  const add = (kind, ms, extra = {}) => { segs.push({ kind, start: t, end: t + ms, ...extra }); t += ms; };
  add("intro", INTRO_MS);
  const beats = script?.beats || [];
  beats.forEach((b, i) => {
    const p = paceFor(script.pace, b.round);
    add("clock", p.clock, { beat: i });
    if (b.trade) add("trade", p.trade, { beat: i });
    add("pickIn", p.pickIn, { beat: i });
    add("reveal", p.reveal, { beat: i });
    const next = beats[i + 1];
    if (next && next.round !== b.round) add("roundBreak", ROUND_BREAK_MS, { beat: i, round: b.round });
  });
  segs.push({ kind: "final", start: t, end: Infinity });
  return { segs, finalAt: t };
}

// Where the show is at `now`:
//   { kind: "preshow" | intro | clock | trade | pickIn | reveal | roundBreak | final,
//     seg, beat (the beat on stage), made (picks revealed so far), t (ms since start),
//     left (ms left in the segment), progress (0–1) }
export function momentAt(script, timeline, now) {
  const t = now - script.startAt;
  if (t < 0) return { kind: "preshow", t, left: -t, made: 0, progress: 0, seg: null, beat: null };
  const { segs } = timeline;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].start <= t) lo = mid; else hi = mid - 1;
  }
  const seg = segs[lo];
  const beatIdx = seg.beat ?? null;
  // Picks shown: every beat whose reveal has started.
  let made;
  if (seg.kind === "final") made = script.beats.length;
  else if (beatIdx == null) made = 0;
  else made = seg.kind === "reveal" || seg.kind === "roundBreak" ? beatIdx + 1 : beatIdx;
  const len = seg.end - seg.start;
  return {
    kind: seg.kind, seg, t, made, beat: beatIdx != null ? script.beats[beatIdx] : null, beatIdx,
    left: Number.isFinite(seg.end) ? seg.end - t : Infinity, progress: Number.isFinite(len) ? Math.min(1, (t - seg.start) / len) : 0,
  };
}

// The desk's posts that are up by `t` (ms since start), newest first:
// opening posts at the start, a pick's posts on its reveal, a trade's on
// the trade beat, each after its analyst's delay.
export function postsAt(script, timeline, t, max = 60) {
  if (t < 0) return [];
  const out = [];
  (script.opening || []).forEach((p, k) => { if (p.d <= t) out.push({ ...p, at: p.d, key: `o${k}` }); });
  for (const s of timeline.segs) {
    if (s.start > t) break;
    const b = script.beats[s.beat];
    const list = s.kind === "reveal" ? b?.posts : s.kind === "trade" ? b?.tradePosts : null;
    (list || []).forEach((p, k) => {
      const at = s.start + (p.d || 0);
      if (at <= t) out.push({ ...p, at, key: `${s.kind}${s.beat}-${k}`, overall: b.overall });
    });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, max);
}

// When the show ends on air: final + the post-show hold.
export const showEndsAt = (script, timeline) => script.startAt + timeline.finalAt + POSTSHOW_MS;

// The day's show id: "YYYY-MM-DD" in Eastern time.
export function showIdFor(ms) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  return parts;
}
