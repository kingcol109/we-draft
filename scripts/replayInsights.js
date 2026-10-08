// scripts/replayInsights.js
//
// Replays real, already-ingested games through the live insight engine
// (server/live/insights.js) as if they were happening now: the stored plays
// arrive in small batches (1-4 plays, like the ingester's 30-60s fetches)
// and each batch is evaluated the way the live ingester does it. Prints the
// play log with every insight where it would appear. READ-ONLY — nothing is
// written; season context only uses each team's games before the replayed one.
//
// Run with:
//   node --env-file=.env scripts/replayInsights.js 401856707 [more game ids]
//   node --env-file=.env scripts/replayInsights.js --player jeremiah-smith-2027-wr   (his games this season)
//   add --quiet to print only the insights, --seed N for different batch sizes
//   add --preview to also write public/dev-insights/{gameId}.json (cards +
//   break summaries) — the local
//   dev server's /live game page shows those cards in that game's
//   play-by-play (useDevInsights, development only; the folder is gitignored)

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("./firebaseAdmin");
const { evaluate, freshState } = require("../server/live/insights");
const { buildBreaks, timeoutExtras, gameTrivia } = require("../server/live/breaks");
const { rostersForGame } = require("../server/live/rosters");

const args = process.argv.slice(2);
const QUIET = args.includes("--quiet");
const PREVIEW = args.includes("--preview");
const seedArg = args.includes("--seed") ? Number(args[args.indexOf("--seed") + 1]) : 7;

// Same game order as server/live/provider.js comparePlays.
const comparePlays = (a, b) => (a.period || 0) - (b.period || 0)
  || (a.clockSeconds != null && b.clockSeconds != null ? b.clockSeconds - a.clockSeconds : 0) || a.seq - b.seq;

let seed = seedArg;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

const playText = (p) => {
  const pr = p.presentation || {};
  const line = (pr.line || []).map((t) => (t.player ? t.player.name : t.text)).join(" ");
  return `${pr.headline ? `${pr.headline}: ` : ""}${line}${pr.detail ? ` — ${pr.detail}` : ""}`.slice(0, 110);
};

async function replay(db, gameId) {
  const game = (await db.collection("liveGames").doc(String(gameId)).get()).data();
  if (!game) { console.log(`no liveGames/${gameId}`); return; }
  const snap = await db.collection("liveGames").doc(String(gameId)).collection("plays").get();
  const all = snap.docs.map((d) => d.data()).filter((p) => !p.removed).sort(comparePlays);
  const rosters = await rostersForGame(db, game, { left: 0 }).catch(() => ({ home: [], away: [] }));
  console.log(`\n══ ${game.away?.school} ${game.away?.points} at ${game.home?.school} ${game.home?.points} (${gameId}, week ${game.week}) — ${all.length} plays ══`);

  const state = freshState();
  const shownAt = [];
  let n = 0, batches = 0;
  const t0 = Date.now();
  let slowest = 0;
  while (n < all.length) {
    const size = 1 + Math.floor(rand() * 4);
    const prevN = n;
    n = Math.min(all.length, n + size);
    batches++;
    const t = Date.now();
    const res = await evaluate(db, game, all.slice(0, n), state, { rosters });
    slowest = Math.max(slowest, Date.now() - t);
    const made = res?.made || [];
    (state.insightsAll ||= []).push(...made); // every card (the live doc keeps only the last 20)
    for (let k = prevN; k < n; k++) {
      const p = all[k];
      if (!QUIET && p.presentation && !["timeout", "period"].includes(p.presentation.type)) {
        console.log(`  ${String(k).padStart(3)} Q${p.period} ${String(p.clock).padStart(5)}  ${playText(p)}`);
      }
      for (const ins of made.filter((x) => x.sourcePlayId === p.id)) {
        shownAt.push(k);
        const wd = ins.wd ? ` [WD: ${ins.wd.grade || "ungraded"}${ins.wd.classRank ? `, #${ins.wd.classRank} in ${ins.wd.cls}` : ins.wd.cls ? `, ${ins.wd.cls}` : ""}]` : "";
        console.log(`      ▶ ${ins.category.toUpperCase()}${ins.milestone ? "/MILESTONE" : ""} (${ins.score}) ${ins.headline ? `${ins.headline.toUpperCase()} · ` : ""}${ins.title}${ins.subtitle ? ` (${ins.subtitle})` : ""}${wd}`);
        console.log(`        ${ins.statLine ? `${ins.statLine} | ` : ""}${ins.context}${ins.extra?.length ? ` | ${ins.extra.join(" | ")}` : ""}${QUIET ? `   ← ${k} Q${p.period} ${p.clock} ${playText(p)}` : ""}`);
      }
    }
  }
  if (PREVIEW) {
    const dir = path.join(__dirname, "..", "public", "dev-insights");
    fs.mkdirSync(dir, { recursive: true });
    // ...plus the break summaries (end of Q1, halftime, end of Q3).
    const breaks = await buildBreaks(db, game, all, { rosters, insights: state.insightsAll });
    // ...and each timeout as the live slot would show it: the coming snap
    // (the next scrimmage play's down, distance and spot) and the timeout
    // extras as of that moment.
    const lib = await import("../src/utils/liveStats.mjs");
    const timeouts = [];
    for (let k = 0; k < all.length; k++) {
      if (all[k].presentation?.type !== "timeout") continue;
      const nextSnap = all.slice(k + 1).find((p) => p.down && p.offense);
      if (!nextSnap) continue;
      const { trivia: _t, ...extras } = await timeoutExtras(db, rosters, lib.computeGameStats(all.slice(0, k + 1)), game);
      timeouts.push({ playId: all[k].id, situation: { offense: nextSnap.offense, down: nextSnap.down, distance: nextSnap.distance, ytg: nextSnap.yardsToGoal, period: all[k].period, clock: all[k].clock }, ...extras });
    }
    fs.writeFileSync(path.join(dir, `${gameId}.json`), JSON.stringify({ insights: state.insightsAll, breaks, timeouts, trivia: await gameTrivia(db, game) }, null, 1));
    console.log(`  ── preview: public/dev-insights/${gameId}.json (${state.insightsAll.length} cards, ${breaks.length} breaks, ${timeouts.length} timeouts)`);
  }
  const gaps = shownAt.slice(1).map((x, i) => x - shownAt[i]);
  const linked = Object.values(state.players).filter(Boolean);
  console.log(`  ── ${shownAt.length} insights over ${all.length} plays (${batches} batches) · gaps between insights: ${gaps.join(", ") || "—"}`);
  console.log(`  ── players with context: ${linked.length} (${linked.filter((c) => c.prior).length} with season logs, ${linked.filter((c) => c.wd).length} We-Draft) · coverage home ${state.coverage?.home?.complete} (${state.coverage?.home?.games.length} prior) away ${state.coverage?.away?.complete} (${state.coverage?.away?.games.length} prior)`);
  console.log(`  ── engine time: ${Date.now() - t0} ms total, slowest batch ${slowest} ms`);
}

async function run() {
  const db = getFirestore();
  let ids = args.filter((a, i) => /^\d+$/.test(a) && args[i - 1] !== "--seed");
  if (args.includes("--player")) {
    const slug = args[args.indexOf("--player") + 1];
    const c = await db.collection("cfbdPlayers").where("wedraftSlug", "==", slug).limit(1).get();
    if (c.empty) throw new Error(`no cfbdPlayers link for ${slug}`);
    const games = await c.docs[0].ref.collection("games").where("season", "==", 2026).get();
    ids = ids.concat(games.docs.map((d) => d.id));
    console.log(`${slug}: games ${ids.join(", ")}`);
  }
  for (const id of ids) await replay(db, id);
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
