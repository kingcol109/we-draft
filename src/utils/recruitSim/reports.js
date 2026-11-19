// src/utils/recruitSim/reports.js
//
// Prose for the window reports (shown at the top of the next window) and the
// news feeds — written from the structured report / event rows only, so
// every line is about something that actually happened (spec §25). No
// grades or hidden numbers appear in any of it.
import { hash } from "./rng.js";
import { REGION_LABEL } from "./regions.js";
import { ROLE_LABEL } from "./work.js";
import { STAGES } from "./config.js";
import { evaluate, placeOf, ptContext, ptAt } from "./model.js";
import { KT, TRAIT_MAP, K_EXACT, CAT_LABEL } from "./traits.js";
import { trendOf } from "./development.js";

const POS_WORD = { QB: "quarterback", RB: "running back", WR: "receiver", TE: "tight end", OL: "offensive lineman", EDGE: "edge rusher", DL: "defensive lineman", LB: "linebacker", DB: "defensive back" };
const pick = (list, key) => list[hash(key) % list.length];
const nameOf = (x) => `${x.first} ${x.last}`;

// A coach's recommendation — excited, never a grade (spec §8).
const REC_LINES = [
  (n, x) => `I spent some time watching ${n}. There's something about this kid I really like. His recruiting ranking doesn't tell the whole story — I'd make sure we keep tabs on him.`,
  (n, x) => `Can't stop thinking about ${n} out of ${x.hs}. Every time I turned on the tape he was doing something that jumped out. Put him on your radar.`,
  (n, x) => `${n} is my guy from this trip. The ${POS_WORD[x.pos]} I saw in person is better than the one on the recruiting sites. Trust me on this one.`,
  (n, x) => `Went by ${x.hs} to see somebody else and walked out talking about ${n}. We should get eyes on him.`,
  (n, x) => `Coach, ${n} — ${x.city}, ${x.st}. I know where he's ranked. I don't care. I want to keep recruiting this kid.`,
  (n, x) => `Talked to his high school coach for an hour about ${n}. Everything about him says he's going to be a player. Don't let him slip.`,
];
export function recommendationText(state, r, role, st) {
  const x = state.recruits[r];
  return pick(REC_LINES, `${state.seed}|rec|${r}|${role}|${st}`)(nameOf(x), x);
}

const areaText = (a) => `${REGION_LABEL[a.region]}${a.pos && a.pos !== "ALL" ? ` · ${[].concat(a.pos).join(", ")}` : ""}`;

// Report → sections for the Reports tab.
export function reportSections(state, rep) {
  if (!rep) return null;
  const u = state.user;
  const R = (r) => state.recruits[r];
  const staff = [];
  ["HC", "OC", "DC", "HS", "OS", "DS"].forEach((role) => {
    const o = rep.staff[role];
    if (!o) { staff.push({ role, title: ROLE_LABEL[role], line: "Unassigned this window.", recs: [], recruits: [] }); return; }
    const coach = role === "HC" || role === "OC" || role === "DC";
    let line;
    if (o.a.kind === "recruit") {
      const x = R(o.a.r);
      line = coach ? `Spent the window recruiting ${nameOf(x)} (${x.pos}).` : `Locked in on ${nameOf(x)} (${x.pos}).`;
    } else line = coach ? `Worked the ${areaText(o.a)} — ${o.reached} recruit${o.reached === 1 ? "" : "s"} contacted.` : `Covered the ${areaText(o.a)} — looked at ${o.reached} recruit${o.reached === 1 ? "" : "s"}.`;
    const recruits = coach ? [] : o.scouted.slice(0, 6).map(([r, range, exact, pot]) => ({ r, range, exact, pot }));
    const found = coach ? null : o.scouted.reduce((a, [, rg, ex, pt]) => [a[0] + rg, a[1] + ex, a[2] + pt], [0, 0, 0]);
    if (found) line += found[0] + found[1] + found[2] ? ` Uncovered ${found[0] + found[1]} grade${found[0] + found[1] === 1 ? "" : "s"}${found[1] ? ` (${found[1]} exact)` : ""}${found[2] ? `, potential on ${found[2]}` : ""}.` : " Nothing new.";
    staff.push({ role, title: ROLE_LABEL[role], line, recs: (o.recs || []).map((r) => ({ r, text: recommendationText(state, r, role, rep.st) })), recruits });
  });

  // Board scouting.
  const bs = Object.entries(rep.boardScout || {});
  const board = bs.length ? { recruits: bs.length, ranges: bs.reduce((a, [, b]) => a + b[0], 0), exact: bs.reduce((a, [, b]) => a + b[1], 0), pot: bs.reduce((a, [, b]) => a + b[2], 0) } : null;

  // Senior season: players your staff has seen change direction (the
  // trend, never the number) — [r, dir −2..2, on your board / yours].
  const SEASON = {
    2: ["is breaking out — the senior tape is a different player", "has taken off this fall", "is playing like the best player on the field every Friday"],
    1: ["is trending up", "keeps getting better this fall", "is stacking good weeks"],
    "-1": ["is trending down", "has had a quiet stretch", "hasn't looked the same this fall"],
    "-2": ["is struggling this fall", "has evaluators worried", "is sliding — the tape isn't there"],
  };
  const devLines = (rep.dev || []).filter((d) => d.length === 3).map(([r, dir, mine]) => {
    const x = R(r);
    return { r, dir, mine: !!mine, text: `${nameOf(x)} (${x.pos}${x.commit === u ? ", committed" : ""}) ${pick(SEASON[dir] || SEASON[1], `${r}|${rep.st}`)}.` };
  });

  // Your program. Only the biggest news per player (user, 2026-11-17: "down
  // to 2" and "committed" in one window is just the commit). pri: higher wins.
  const mineBy = new Map();
  const natBy = new Map();
  const commits = [];
  const put = (m, item) => { const was = m.get(item.r); if (!was || item.pri > was.pri) m.set(item.r, item); };
  const M = (item) => put(mineBy, item);
  const NAT = (item) => put(natBy, item);
  (rep.events || []).forEach((e) => {
    const x = e.r != null && e.r >= 0 ? R(e.r) : null;
    if (!x) return;
    const n = nameOf(x);
    const school = (s) => state.schools[s]?.name || "";
    const tag = `${x.stars}★ ${x.pos}`;
    switch (e.k) {
      case "announce":
        if (e.d.list.includes(u)) M({ r: e.r, pri: 75, tone: "action", decision: true, text: `📅 ${n} will announce next week — between ${listText(e.d.list, school, u)}. One more week to make your case.` });
        else if (state.schools[u].board.includes(e.r)) M({ r: e.r, pri: 72, tone: "bad", text: `📅 ${n} announces next week between ${e.d.list.map(school).join(" and ")} — you're not one of them.` });
        else if (x.rank <= 150) NAT({ r: e.r, s: e.d.list[0], pri: 8, text: `📅 ${n} (${tag}, No. ${x.rank}) sets his commitment date — ${e.d.list.map(school).join(" vs. ")}.` });
        break;
      case "delay":
        if (state.schools[u].board.includes(e.r)) M({ r: e.r, pri: 44, tone: "action", text: `${n} pushed back his decision.` });
        break;
      case "commit":
        if (e.s === u) { commits.push({ r: e.r, how: e.d?.how, jump: e.d?.jump || null, field: e.d?.field || null }); M({ r: e.r, pri: 100, skip: true }); }
        else if (x.rating >= 88 || state.schools[u].board.includes(e.r) || state.schools[u].lockedOut?.some((o) => o.r === e.r)) NAT({ r: e.r, s: e.s, pri: 10, upset: !!e.d?.jump, text: `${e.d?.jump ? "🚨 UPSET: " : "✍️ "}${n} (${tag}, No. ${x.rank}) ${e.d?.how === "announce" ? "announces for" : "commits to"} ${school(e.s)}${e.d?.jump ? ` over ${school(e.d.jump.over)}` : ""}.` });
        break;
      case "lostTo": {
        const j = e.d.jump;
        const how = j ? (j.over === u ? ` — they jumped you; you were his No. 1` : ` — they came from No. ${j.place || "?"} to beat ${school(j.over)}`) : "";
        M({ r: e.r, pri: 90, tone: "bad", s: e.d.to, text: `${n} (${tag}) committed to ${school(e.d.to)}${how}.` });
        break;
      }
      case "unsigned": if (state.schools[u].board.includes(e.r)) M({ r: e.r, pri: 85, tone: "bad", text: `${n} didn't sign anywhere.` }); break;
      case "demand":
        if (e.s === u) M({ r: e.r, pri: 80, tone: "action", demand: true, text: e.d.type === "nil" ? `${n} says he'd commit right now if you get his NIL to ${moneyShort(e.d.amount)}.` : `${n} wants a clear path at ${x.pos} — he's asking you to take ${nameOf(R(e.d.target))} off your board.` });
        break;
      case "dropped": M({ r: e.r, pri: 70, tone: "bad", text: `${n} left you off his ${e.d.stage === "final" ? "final list" : "top 10"}.` }); break;
      case "final":
        if (e.d.list.includes(u)) M({ r: e.r, pri: 60, tone: "good", text: `${n} is down to ${e.d.list.length}: ${e.d.list.map(school).join(", ")}.` });
        else if (x.rank <= 60) NAT({ r: e.r, pri: 6, text: `${n} (No. ${x.rank}) is down to ${e.d.list.length}: ${e.d.list.map(school).join(", ")}.` });
        break;
      case "top10":
        if (e.d.list.includes(u)) M({ r: e.r, pri: 50, tone: "good", text: `${n} named you in his top ${e.d.list.length}.` });
        else if (x.rank <= 100) NAT({ r: e.r, pri: 5, text: `${n} (No. ${x.rank}) releases his top ${e.d.list.length}.` });
        break;
      case "demandMet": if (e.s === u && e.d.type === "pt") M({ r: e.r, pri: 40, tone: "good", text: `${n} appreciated you clearing the way at ${x.pos}.` }); break;
      case "demandLapsed": if (e.s === u) M({ r: e.r, pri: 40, tone: "bad", text: `${n}'s request went unanswered.` }); break;
      case "reopen": if (state.schools[u].board.includes(e.r)) M({ r: e.r, pri: 45, tone: "action", text: `${n} has reopened his recruitment.` }); break;
      default:
    }
  });
  // Standing moves on recruits you're working.
  // Why he cooled, when it's playing time (crowd at his position).
  const ptWhy = (x) => {
    const ctx = ptContext(state, u);
    if (ptAt(state, u, x.i, ctx) >= 0.6) return "";
    const ahead = ctx.ahead.has(x.i) ? ctx.ahead.get(x.i) : ctx.aboveCount[x.pos] || 0;
    const c = ctx.commits[x.pos] || 0;
    return ` — worried about playing time (${[c ? `${c} ${x.pos} commit${c > 1 ? "s" : ""}` : "", ahead ? `${ahead} ranked ahead of him` : ""].filter(Boolean).join(", ")})`;
  };
  (rep.moves || []).forEach(([r, was, now]) => {
    const x = R(r);
    if (state.intel[r] < 2) return;
    if (now === 1 && was !== 1) M({ r, pri: 30, tone: "good", text: `You're the leader for ${nameOf(x)}.` });
    else if (was === 1 && now !== 1) M({ r, pri: 30, tone: "bad", text: `You've lost the lead for ${nameOf(x)}${now ? ` — now No. ${now}` : ""}${ptWhy(x)}.` });
    else if (now && was && was - now >= 3) M({ r, pri: 20, tone: "good", text: `${nameOf(x)} is warming to you (No. ${was} → No. ${now}).` });
    else if (!now && was) M({ r, pri: 20, tone: "bad", text: `${nameOf(x)} is cooling on you${ptWhy(x)}.` });
  });
  (rep.cuts || []).forEach(({ r }) => M({ r, pri: 15, tone: "bad", text: `${nameOf(R(r))} noticed the smaller NIL offer.` }));
  devLines.filter((d) => d.mine).forEach((d) => M({ r: d.r, pri: 18, tone: d.dir > 0 ? "good" : "bad", text: `${d.dir > 0 ? "📈" : "📉"} ${d.text}` }));
  const mine = [...mineBy.values()].filter((m) => !m.skip);
  const national = [...natBy.values()].sort((a, b) => b.pri - a.pri);
  // Commits elsewhere go last, one row each (user, 2026-11-17).
  const order = { action: 0, good: 1, bad: 2 };
  mine.sort((a, b) => (a.pri >= 90) - (b.pri >= 90) || order[a.tone] - order[b.tone] || b.pri - a.pri);
  return { stage: STAGES[rep.st]?.label, staff, board, dev: devLines, mine, national, commits };
}

// Players to watch (user, 2026-11-17: reports should surface guys worth
// adding): everyone your staff touched this window who isn't on your board,
// ranked by your own read, with why. Uses only what you've uncovered.
export function watchList(state, rep, limit = 12) {
  if (!rep) return [];
  const u = state.user;
  const usc = state.schools[u];
  const onBoard = new Set(usc.board);
  const recNow = new Set();
  Object.values(rep.staff || {}).forEach((o) => (o?.recs || []).forEach((r) => recNow.add(r)));
  const pool = new Set([...(rep.touched || []), ...recNow]);
  const out = [];
  pool.forEach((r) => {
    const x = state.recruits[r];
    if (!x || x.commit >= 0 || x.status === "unsigned" || onBoard.has(r)) return;
    if (x.list && !x.list.includes(u)) return;
    const { est, known } = evaluate(state, u, r);
    const base = (u * state.N + r) * KT;
    let aGrades = 0;
    TRAIT_MAP[x.pos].forEach((_, i) => { const k = state.know[base + i]; if (k === K_EXACT && x.t[i] >= state.cfg.gradeCuts[2][1]) aGrades += 1; });
    const [place] = placeOf(x, u);
    const why = [];
    let bonus = 0;
    if (recNow.has(r)) { why.push("New recommendation"); bonus += 4; } else if (state.recMask[u * state.N + r]) { why.push("Recommended"); bonus += 2; }
    if (known >= 0.4 && est - x.rating >= 2) { why.push(`Grades well above his No. ${x.rank} ranking`); bonus += 3 + (est - x.rating) / 2; }
    if (aGrades >= 2) { why.push(`${aGrades} A-level traits`); bonus += aGrades; }
    if (state.intel[r] && place && place <= 3) { why.push(place === 1 ? "Already leaning your way" : `You're No. ${place} for him`); bonus += 4 - place; }
    const tr = trendOf(state, x);
    if (tr && tr.dir > 0) { why.push(tr.dir > 1 ? "Breaking out this fall" : "Trending up"); bonus += tr.dir * 1.5; }
    if (!why.length) return;
    out.push({ r, why, score: est + bonus, known });
  });
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

// "you, UCF and Miami" — you first.
const listText = (list, school, u) => {
  const names = [...list].sort((a, b) => (b === u) - (a === u)).map((s) => (s === u ? "you" : school(s)));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
};
const moneyShort = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2).replace(/\.?0+$/, "")}M` : `$${Math.round(n / 1e3)}K`);
export { CAT_LABEL };
