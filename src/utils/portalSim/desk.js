// src/utils/portalSim/desk.js
//
// The Portal Sim's analyst desk (user, 2026-11-14: "the way it exists for
// the draft sim") — the Draft Sim's personalities (utils/draftSim/
// analysts.js ANALYSTS: names, handles, avatars) reacting to the portal
// instead of picks, shown in the same feed (components/draftSim/SimFeed.jsx).
//
//   We-Draft.com       announces the news: NFL decisions, big portal entries,
//                      commitments, each window's wrap
//   Walter Donaldson   needs: a team filling a hole it lost to the draft or
//                      the portal; NFL calls
//   Kenneth Cold       the market: overpays, discounts, blowout offers
//   Dr. PP Johnson     the numbers he brings (last season's CFBD stats)
//   Makali Pennycooke  the optimist — Rutgers most of all, and your signings
//   davin mcgavitt     the jester: Florida State, cheeseburgers, fullbacks
//   Thad Murphy        the historian: the school's recent records
//
// We-Draft.com posts the news; then one personality may chime in, never the
// same voice twice running if it can help it. Posts: { id, analyst, text,
// lines?, userInvolved } — SimFeed's shape. Pure: deskPosts(state, events,
// ctx) for the log events a step added.
import { ANALYSTS } from "../draftSim/analysts";
import { gradeLabel } from "../gradeScale";
import { urgencyOf } from "./engine";

const WHO = Object.fromEntries(ANALYSTS.map((a) => [a.id, a]));
const POS_NAME = { QB: "quarterback", RB: "running back", WR: "receiver", TE: "tight end", OL: "offensive lineman", DL: "defensive tackle", EDGE: "edge rusher", LB: "linebacker", DB: "defensive back", K: "kicker", P: "punter" };
const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n || 0)}`);
const pick = (list, rand) => list[Math.floor(rand() * list.length) % list.length];
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ""));

// ── Lines (several variants each) ──
const L = {
  declared: ["{name} ({pos}, {from}) is headed to the NFL Draft.", "{from} {posName} {name} is turning pro.", "{name} declares for the draft — {from} loses its {posName}."],
  entered: ["{stars}★ {pos} {name} is entering the transfer portal from {from}.", "PORTAL: {from} {posName} {name} ({stars}★) is in.", "{name} ({stars}★ {pos}) has entered the portal. {from} couldn't keep him."],
  committed: ["COMMITTED: {stars}★ {pos} {name} → {to}", "{name} ({stars}★ {pos}) commits to {to}.", "{to} lands {stars}★ {pos} {name} out of the portal."],
  wrap: ["Portal window {w} is closed: {n} commitments around the country.", "That's window {w}. {n} players found new homes."],
  wrapLast: ["The portal is closed. {n} commitments in the final window, {u} players went unsigned."],
  isaacNfl: ["{name} was always gone. A {grade} grade doesn't come back for another year.", "Can't blame {name}. {grade} grade — you take that to the league."],
  isaacNeed: ["{to} lost {lost} starting {posPlural} this offseason. {name} fills the hole right away.", "That's a need met for {to}. They had to have a {posName} and got one.", "{to} knew exactly what it was shopping for. {name} is the answer at {pos}."],
  kenOver: ["{to} paid way over market for {name}. {ratio}× what he was asking. Bold.", "Somebody in {to}'s collective really wanted {name}. That price is steep."],
  kenUnder: ["{to} got {name} at a discount. Steal of the window.", "{name} to {to} for less than his number. That's a front office that knows the market."],
  kenBlowout: ["{to} didn't even let the window close. Blew {name} away with the offer.", "That's how you end a recruitment: {to} put a number on the table {name} couldn't say no to."],
  kenBig: ["{name} is a difference-maker. {to} just changed its ceiling.", "Best player on the board this window and {to} got him."],
  pp: ["{name} brings {stats} to {to}.", "The numbers on {name}: {stats}. {to} gets production.", "Last season for {name}: {stats}."],
  makRutgers: ["RUTGERS GETS {nameUp}!!! Piscataway is BUZZING. Chop.", "{name} to Rutgers — I told you all. The Knights are coming."],
  makLeftRutgers: ["Sad to see {name} leave Rutgers but we wish him the best. The Knights reload."],
  makMine: ["{to} keeps stacking. {name} is going to be a fan favorite.", "Love this for {to}. {name} fits that culture perfectly.", "Huge get for {to}! {name} is exactly what that room needed."],
  makAny: ["Love this for {name}. Fresh start at {to}!", "{to} is going to love {name}. Great fit."],
  davFsu: ["FLORIDA STATE GETS {nameUp}. Nole Nation we are SO back.", "{name} to Florida State is the best commitment in portal history and it isn't close."],
  davLeftFsu: ["{name} left Florida State. Some people just don't want to be great."],
  davAny: ["{name} to {to}? Couldn't be me. I'd have held out for a school with a better cheeseburger.", "{to} spent all that NIL and still doesn't have a fullback. Pass.", "{name} picked {to}. Bold choice. Wrong, but bold.", "{to} fans are celebrating {name} like they didn't just watch their team go {record}."],
  thad: ["{to} went {record} in {year}. {name} is the kind of addition that moves that number.", "Context: {to} is {span} over the last {years} seasons. {name} walks into that.", "{name} joins a {to} program that won {wins} games across the last {years} seasons."],
};

// The school's recent records (ctx.records: teamRecords.json teams[school]
// → [[year, w, l]]).
function recordVars(records, school) {
  const rows = records?.teams?.[school];
  if (!rows?.length) return null;
  const last = rows[rows.length - 1];
  const w = rows.reduce((a, r) => a + r[1], 0);
  const l = rows.reduce((a, r) => a + r[2], 0);
  return { record: `${last[1]}-${last[2]}`, year: last[0], span: `${w}-${l}`, wins: w, years: rows.length };
}
// A short line of last season's numbers (pool stats).
function statText(p) {
  const s = p.stats;
  if (!s) return "";
  const n = (v) => Math.round(v).toLocaleString("en-US");
  const parts = [];
  if (s.passYds) parts.push(`${n(s.passYds)} passing yards, ${s.passTd || 0} TD`);
  if (s.rushYds >= 150) parts.push(`${n(s.rushYds)} rushing yards${s.rushTd ? `, ${s.rushTd} TD` : ""}`);
  if (s.recYds >= 100) parts.push(`${s.rec || 0} catches for ${n(s.recYds)} yards`);
  if (s.tkl >= 15) parts.push(`${s.tkl} tackles${s.tfl ? `, ${s.tfl} TFL` : ""}${s.sacks ? `, ${s.sacks} sacks` : ""}`);
  if (s.int >= 2) parts.push(`${s.int} interceptions`);
  if (s.fga) parts.push(`${s.fgm || 0}-of-${s.fga} on field goals`);
  if (s.punts >= 15) parts.push(`${s.puntYpp} yards a punt`);
  return parts.slice(0, 2).join(" and ");
}

// deskPosts(state, events, ctx) → posts, newest first.
// ctx: { team (the user's), records, rand (0..1), last (the voice that
// spoke last, mutable: { id }), seq (mutable counter) }.
export function deskPosts(state, events, ctx) {
  const rand = ctx.rand || Math.random;
  const out = [];
  const post = (id, text, extra = {}) => {
    ctx.seq = (ctx.seq || 0) + 1;
    out.push({ id: `d${ctx.seq}`, analyst: WHO[id], text, ...extra });
  };
  const school = (slug) => state.teams[slug]?.school || slug;
  const varsOf = (e, p) => ({
    name: p.name, nameUp: p.name.toUpperCase(), pos: p.pos, posName: POS_NAME[p.pos] || p.pos, posPlural: `${POS_NAME[p.pos] || p.pos}s`,
    stars: p.stars, from: school(p.team), to: e.to ? school(e.to) : "", grade: p.dg != null ? gradeLabel(p.dg) : "",
  });
  // One personality after the news — the first that has something, never
  // the voice that spoke last if another can.
  const chime = (options) => {
    const live = options.filter(([id, text]) => text && WHO[id]?.enabled !== false);
    if (!live.length) return;
    const fresh = live.filter(([id]) => id !== ctx.last?.id);
    const [id, text] = (fresh.length ? fresh : live)[0];
    post(id, text, { userInvolved: options.userInvolved });
    if (ctx.last) ctx.last.id = id;
  };

  // NFL decisions: first-round grades and your own players.
  const declared = events.filter((e) => e.kind === "declared" && (e.reason !== "exhausted")).map((e) => ({ e, p: state.players[e.pid] }))
    .filter(({ e, p }) => p && (e.team === ctx.team || (p.dg != null && p.dg <= 3.5))).sort((a, b) => (a.p.dg ?? 99) - (b.p.dg ?? 99)).slice(0, 8);
  declared.forEach(({ e, p }) => {
    const v = varsOf(e, p);
    post("wedraft", fill(pick(L.declared, rand), v), { lines: v.grade ? [`We-Draft.com community grade: ${v.grade}`] : undefined, userInvolved: e.team === ctx.team });
    if (v.grade && rand() < 0.45) chime(Object.assign([["isaac", fill(pick(L.isaacNfl, rand), v)]], { userInvolved: e.team === ctx.team }));
  });

  // Portal entries: 4★+ and your own.
  const entered = events.filter((e) => e.kind === "entered").map((e) => ({ e, p: state.players[e.pid] }))
    .filter(({ e, p }) => p && (p.stars >= 4 || e.team === ctx.team)).sort((a, b) => b.p.stars - a.p.stars).slice(0, 12);
  entered.forEach(({ e, p }) => {
    const v = varsOf(e, p);
    post("wedraft", fill(pick(L.entered, rand), v), { userInvolved: e.team === ctx.team });
    if (p.team === "rutgers") chime([["makali", fill(pick(L.makLeftRutgers, rand), v)]]);
    else if (p.team === "florida-state") chime([["davin", fill(pick(L.davLeftFsu, rand), v)]]);
  });

  // Commitments: yours, anything touching your team, then the biggest.
  const commits = events.filter((e) => e.kind === "committed").map((e) => ({ e, p: state.players[e.pid] })).filter(({ p }) => p);
  const mine = (e) => e.to === ctx.team || e.team === ctx.team;
  const notable = commits.filter(({ e, p }) => mine(e) || p.stars >= 4 || (p.stars >= 3 && (e.to === "rutgers" || e.to === "florida-state")))
    .sort((a, b) => mine(b.e) - mine(a.e) || b.p.stars - a.p.stars).slice(0, 14);
  notable.forEach(({ e, p }) => {
    const v = { ...varsOf(e, p), ratio: (e.nil / Math.max(1, p.ask)).toFixed(1), stats: statText(p) };
    const user = mine(e);
    post("wedraft", fill(pick(L.committed, rand), v), { lines: [`From ${v.from}`, `NIL: ${money(e.nil)}`], userInvolved: user });
    const rec = recordVars(ctx.records, v.to);
    const lost = urgencyOf(state, e.to)?.[p.pos]?.lost || 0;
    const ratio = e.nil / Math.max(1, p.ask);
    const options = [];
    if (e.to === "rutgers") options.push(["makali", fill(pick(L.makRutgers, rand), v)]);
    if (e.to === "florida-state") options.push(["davin", fill(pick(L.davFsu, rand), v)]);
    if (e.blowout) options.push(["kenneth", fill(pick(L.kenBlowout, rand), v)]);
    if (ratio >= 1.4) options.push(["kenneth", fill(pick(L.kenOver, rand), v)]);
    if (ratio <= 0.9) options.push(["kenneth", fill(pick(L.kenUnder, rand), v)]);
    // The rest, shuffled so the desk varies.
    const rest = [
      lost > 0 ? ["isaac", fill(pick(L.isaacNeed, rand), { ...v, lost })] : null,
      v.stats ? ["pp", fill(pick(L.pp, rand), v)] : null,
      p.stars >= 5 ? ["kenneth", fill(pick(L.kenBig, rand), v)] : null,
      rec ? ["thad", fill(pick(L.thad, rand), { ...v, ...rec })] : null,
      user && e.to === ctx.team ? ["makali", fill(pick(L.makMine, rand), v)] : ["makali", fill(pick(L.makAny, rand), v)],
      ["davin", fill(pick(L.davAny, rand), { ...v, record: rec?.record || "6-6" })],
    ].filter(Boolean).sort(() => rand() - 0.5);
    // Not every commitment gets a take — yours always do.
    if (user || options.length || rand() < 0.6) chime(Object.assign([...options, ...rest], { userInvolved: user }));
  });

  // The window's wrap.
  const wrap = events.find((e) => e.kind === "wrap");
  if (wrap && (wrap.n || wrap.last)) post("wedraft", fill(pick(wrap.last ? L.wrapLast : L.wrap, rand), { w: wrap.w, n: wrap.n, u: wrap.u }));
  return out.reverse();
}
