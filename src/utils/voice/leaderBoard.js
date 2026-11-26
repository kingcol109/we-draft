// src/utils/voice/leaderBoard.js
//
// /voice: stat leaders, any way they're asked (user, 2026-11-25: "not only
// these questions but these types of questions"). One board, cut by:
//   scope: a school (its CFBD roster's season stats, cfbRosters/{teamId}),
//          a conference (the national top 50, cfbLeaders/current, cut to the
//          conference's schools — compSnapshots/_cfbTeams), or the country.
//   position: "which quarterback leads the country in rushing", "…among receivers".
//   place: the leader, the top N, the 2nd / 3rd…, or where one player ranks.
// Out loud it talks; the screen gets the table.
import { list } from "./reply";
import { plain } from "./text";
import { STATS, WORD_RE, statKey, mainStat } from "./stats";
import { schoolSaid } from "./names";
import { schoolRows } from "./requests";
import { phrase } from "./phrase";

const n = (x) => (Number.isInteger(Number(x)) ? Math.round(Number(x) || 0).toLocaleString("en-US") : String(x));
const squash = (s) => plain(s).replace(/\s+/g, "");
export const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, twentyfive: 25, fifty: 50 };
export const nWord = (w) => (w == null ? null : /^\d+$/.test(w) ? Number(w) : NUM_WORDS[String(w).replace(/\s/g, "")] || null);
const ORD = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5 };
export const ordOf = (w) => (w == null ? null : ORD[w] || nWord(String(w).replace(/^(?:number|no) /, "")) || null);
const ordinal = (k) => `${k}${k % 100 > 10 && k % 100 < 14 ? "th" : ["th", "st", "nd", "rd"][k % 10] || "th"}`;
const ORD_SAID = ["", "first", "second", "third", "fourth", "fifth"];

// stat key (stats.js) → the roster's season stats (players[].s[cat][field], summed) and /cfb/stats' national category.
export const LEAD = {
  passYds: { f: [["passing", "YDS"]], nat: "passYds" },
  passTd: { f: [["passing", "TD"]], nat: "passTd" },
  rushYds: { f: [["rushing", "YDS"]], nat: "rushYds" },
  rushTd: { f: [["rushing", "TD"]], nat: "rushTd" },
  recYds: { f: [["receiving", "YDS"]], nat: "recYds" },
  rec: { f: [["receiving", "REC"]], nat: "rec" },
  recTd: { f: [["receiving", "TD"]], nat: "recTd" },
  tackles: { f: [["defensive", "TOT"]], nat: "tackles" },
  sacks: { f: [["defensive", "SACKS"]], nat: "sacks" },
  tfl: { f: [["defensive", "TFL"]], nat: "tfl" },
  defInt: { f: [["interceptions", "INT"]], nat: "ints" },
  pd: { f: [["defensive", "PD"]], nat: "pbu" },
  skillTd: { f: [["rushing", "TD"], ["receiving", "TD"]], label: "touchdowns" },
  scrimmage: { f: [["rushing", "YDS"], ["receiving", "YDS"]] },
  fgm: { f: [["kicking", "FGM"]], nat: "fgm", label: "field goals" },
};
// "leading rusher" / "top tackler" → the stat.
const ROLE = { passer: "passYds", quarterback: "passYds", rusher: "rushYds", runner: "rushYds", "ball carrier": "rushYds", receiver: "recYds", "pass catcher": "recYds", wideout: "recYds", tackler: "tackles", "pass rusher": "sacks", "sack leader": "sacks", "sack artist": "sacks", scorer: "skillTd", "touchdown scorer": "skillTd", kicker: "fgm", "ball hawk": "defInt" };
export const ROLE_RE = "(?<role>touchdown scorer|pass rusher|sack leader|sack artist|pass catcher|ball carrier|ball hawk|passer|quarterback|rusher|runner|receiver|wideout|tackler|scorer|kicker)s?";
export const STAT_RE = `(?<stat>${WORD_RE}|field goals|interceptions caught)`;
export const N_RE = "(?<n>\\d+|two|three|four|five|ten|fifteen|twenty|twenty five|fifty)";
export const ORD_RE = "(?<ord>second|third|fourth|fifth|2nd|3rd|4th|5th|number (?:2|3|4|5|two|three|four|five))";
export const SEASON_TAIL = "(?: (?:this|so far this) (?:season|year)| so far| right now| in 20\\d\\d| on the season| on the year)?";
// Positions a board can be cut to: "which quarterback…", "…among receivers", "top running backs in rushing".
export const POS_RE = "(?<posw>quarterback|qb|running back|rb|tailback|back|wide receiver|receiver|wideout|wr|tight end|te|defensive lineman|defensive end|defensive tackle|edge rusher|edge|lineman|linebacker|lb|cornerback|corner|cb|safety|defensive back|db|kicker)s?";
const POS_GROUP = {
  quarterback: ["QB"], qb: ["QB"], "running back": ["RB", "FB"], rb: ["RB", "FB"], tailback: ["RB"], back: ["RB", "FB"],
  "wide receiver": ["WR"], receiver: ["WR", "TE"], wideout: ["WR"], wr: ["WR"], "tight end": ["TE"], te: ["TE"],
  "defensive lineman": ["DL", "DE", "DT", "NT", "EDGE"], lineman: ["DL", "DE", "DT", "NT", "EDGE"], "defensive end": ["DE", "EDGE", "DL"], "defensive tackle": ["DT", "NT", "DL"], "edge rusher": ["DE", "EDGE", "OLB"], edge: ["DE", "EDGE", "OLB"],
  linebacker: ["LB", "OLB", "ILB", "MLB"], lb: ["LB", "OLB", "ILB", "MLB"], cornerback: ["CB"], corner: ["CB"], cb: ["CB"], safety: ["S", "FS", "SS"], "defensive back": ["CB", "S", "DB", "FS", "SS"], db: ["CB", "S", "DB", "FS", "SS"], kicker: ["PK", "K"],
};
const POS_SAID = { qb: "quarterback", rb: "running back", wr: "wide receiver", te: "tight end", lb: "linebacker", cb: "cornerback", db: "defensive back", edge: "edge rusher", back: "running back", tailback: "running back", wideout: "wide receiver", corner: "cornerback" };
export const posOf = (w) => {
  const k = plain(w || "").replace(/s$/, "");
  return POS_GROUP[k] ? { raw: POS_GROUP[k], label: POS_SAID[k] || k } : null;
};

const NATION = /^(?:the )?(?:country|nation|college football|all of college football|cfb|fbs|the fbs|ncaa|the ncaa|division one|division 1|fbs football|land|america|whole country|entire country|nationally|nation in college football)$/;
// Conferences said the way people say them → the _cfbTeams name.
const CONF_ALIAS = { sec: "SEC", "southeastern conference": "SEC", "big ten": "Big Ten", "big 10": "Big Ten", b1g: "Big Ten", "big 12": "Big 12", "big twelve": "Big 12", acc: "ACC", "atlantic coast conference": "ACC", "pac 12": "Pac-12", "pac twelve": "Pac-12", pac12: "Pac-12", "mountain west": "Mountain West", mwc: "Mountain West", "sun belt": "Sun Belt", mac: "MAC", "mid american": "MAC", "mid american conference": "MAC", american: "American Athletic", aac: "American Athletic", "american athletic": "American Athletic", "the american": "American Athletic", "conference usa": "Conference USA", cusa: "Conference USA", "c usa": "Conference USA", independents: "FBS Independents" };

/** What a scope said means: { kind: "nation" } | { kind: "conf", conf } | { kind: "team", school } | null */
export async function scopeOf(said, ctx) {
  const t = plain(String(said || "")).replace(/^the /, "").replace(/ conference$/, "").trim();
  if (!t || NATION.test(t) || NATION.test(`the ${t}`)) return { kind: "nation" };
  const teams = ctx.teams ? await ctx.teams().catch(() => []) : [];
  const confs = [...new Set(teams.map((x) => x.conference).filter(Boolean))];
  const alias = CONF_ALIAS[t] || CONF_ALIAS[`the ${t}`];
  const conf = confs.find((c) => squash(c) === squash(t) || (alias && (squash(c) === squash(alias) || squash(c).startsWith(squash(alias)))));
  if (conf || alias) return { kind: "conf", conf: conf || alias, schools: new Set(teams.filter((x) => x.conference === (conf || alias)).map((x) => x.school)) };
  const school = schoolSaid(t.replace(/(?:'s|s')$/, ""), await schoolRows(ctx));
  return school ? { kind: "team", school } : null;
}

export const leadKey = ({ stat, role }) => {
  if (role) return ROLE[plain(role).replace(/s$/, "")] || null;
  if (/^field goals?$/.test(stat || "")) return "fgm";
  if (/^interceptions caught$/.test(stat || "")) return "defInt";
  const k = statKey(stat, "");
  return k && LEAD[k] ? k : null;
};
/** A player's own main stat (QB → passing yards…), for "where does he rank nationally". */
export const mainLead = (pos) => (LEAD[mainStat(pos)] ? mainStat(pos) : "tackles");
export const labelOf = (k, v = 2) => {
  const l = LEAD[k]?.label || STATS[k]?.label || k;
  return Number(v) === 1 ? l.replace(/\b(catches|passes|yards|touchdowns|tackles|sacks|interceptions|goals)\b/, (w) => ({ catches: "catch", passes: "pass" }[w] || w.slice(0, -1))) : l;
};
const valueSaid = (k, v) => `${n(v)} ${labelOf(k, v)}`;
const scopeName = (sc) => (sc.kind === "team" ? sc.school : sc.kind === "conf" ? (/^[A-Z]{2,4}$/.test(sc.conf) ? `the ${sc.conf}` : `the ${sc.conf}`) : "the country");

// A roster row → who he is on the site: the board's row when he's there, else his CFBD one.
async function personFor(r, ctx) {
  const people = await ctx.people().catch(() => []);
  const key = plain(`${r.first} ${r.last}`);
  const onBoard = (r.slug && people.find((p) => p.slug === r.slug)) || people.find((p) => p.school === r.school && plain(`${p.first} ${p.last}`) === key);
  return onBoard || { id: `cfbd_${r.id}`, first: r.first, last: r.last, pos: r.pos, school: r.school, cls: null, cfbd: String(r.id), teamId: r.teamId, cfbdOnly: true };
}

/** The ranked rows for a stat in a scope: { rows: [{ id, first, last, pos, school, v, x? }], season, partial } | { gap, say } */
export async function boardFor(k, scope, ctx, pos = null, cut = null) {
  const keep = (r) => !pos || pos.raw.includes(String(r.pos || "").toUpperCase());
  if (scope.kind === "team") {
    const roster = ctx.cfbdRoster ? await ctx.cfbdRoster(scope.school).catch(() => null) : null;
    if (!roster?.players?.length) return { gap: "leaders-no-roster", say: `I don't have ${scope.school}'s roster stats.` };
    const val = (p) => LEAD[k].f.reduce((a, [cat, f]) => a + (Number(p.s?.[cat]?.[f]) || 0), 0);
    const rows = roster.players.filter((p) => p.s).map((p) => ({ id: p.id, first: p.first, last: p.last, pos: p.pos, school: scope.school, teamId: roster.teamId, slug: p.slug, yr: p.yr, rc: p.rc, v: val(p) }))
      .filter((x) => x.v > 0 && keep(x)).sort((a, b) => b.v - a.v);
    return { rows: cut ? await cutRows(rows, cut, roster.season, ctx) : rows, season: roster.season };
  }
  const cat = LEAD[k].nat;
  if (!cat) return { gap: "leaders-no-national", say: `For the whole country I have passing, rushing and receiving yards and touchdowns, catches, tackles, sacks, tackles for loss, interceptions, pass breakups and field goals.` };
  const doc = ctx.cfbLeaders ? await ctx.cfbLeaders().catch(() => null) : null;
  let rows = doc?.categories?.find((c) => c.key === cat)?.rows || [];
  if (!rows.length) return { gap: "leaders-no-national", say: `I don't have the national ${labelOf(k)} leaders right now.` };
  if (scope.kind === "conf") rows = rows.filter((r) => scope.schools?.has(r.school));
  rows = rows.filter(keep);
  if (cut) rows = await cutRows(rows, cut, doc.season, ctx);
  // The national list is the top 50: a conference / position cut of it is the best of those.
  return { rows, season: doc.season, partial: scope.kind === "conf" || !!pos || !!cut };
}

/** The answer: the leader (and next), the top N, or the Nth. */
export async function leaders({ k, scope, pos = null, howMany = null, ord = null, cut = null }, ctx) {
  const b = await boardFor(k, scope, ctx, pos, cut);
  if (b.gap) return { say: b.say, tone: "miss", gap: b.gap };
  const where = scopeName(scope);
  const among = [cut && `among ${cut.label}`, pos && `among ${pos.label}s`].filter(Boolean).join(" ").replace(/ among /, " ");
  if (!b.rows.length) return { say: `I don't have anyone ${among ? `${among} ` : ""}in ${where} with ${labelOf(k)}${b.partial ? " in the national top 50" : ""}.`, tone: "miss", gap: "leaders-none" };
  const name = (r) => `${r.first} ${r.last}`;
  const of = (r) => (scope.kind === "team" ? "" : ` of ${r.school}`);
  const top = b.rows.slice(0, Math.max(5, howMany || 0, ord || 0));
  let speak;
  if (ord && ord > 1) {
    const r = b.rows[ord - 1];
    speak = r ? `${ORD_SAID[ord] ? `${ORD_SAID[ord][0].toUpperCase()}${ORD_SAID[ord].slice(1)}` : ordinal(ord)} in ${where}${among ? ` ${among}` : ""} is ${name(r)}${of(r)}, with ${valueSaid(k, r.v)}. ${name(b.rows[0])} leads with ${n(b.rows[0].v)}.` : `I only have ${b.rows.length} there.`;
  } else if (howMany && howMany > 1) {
    speak = `The top ${Math.min(howMany, b.rows.length)} in ${where}${among ? ` ${among}` : ""} in ${labelOf(k)}: ${list(b.rows.slice(0, howMany).map((r) => `${name(r)}${of(r)} with ${n(r.v)}`))}.`;
  } else {
    const [a, s2, s3] = b.rows;
    const lead = scope.kind === "nation" && !pos
      ? phrase(ctx, "leader.nation", { name: name(a), school: a.school, value: valueSaid(k, a.v) })
      : phrase(ctx, "leader.team", { name: `${name(a)}${of(a)}`, team: `${where}${among ? ` ${among}` : ""}`, value: valueSaid(k, a.v), when: "" });
    const next = s2 ? (s2.v === a.v ? ` ${name(s2)}${of(s2)} has the same.` : ` ${name(s2)}${of(s2)} is second with ${n(s2.v)}${s3 && scope.kind !== "team" ? `, and ${name(s3)}${of(s3)} is third with ${n(s3.v)}` : ""}.`) : "";
    speak = `${lead}${next}`;
  }
  const people = await Promise.all(top.map((r) => personFor(r, ctx)));
  const focusAt = ord && ord > 1 ? ord - 1 : 0;
  return {
    say: speak, speak,
    title: `${scope.kind === "team" ? scope.school : scope.kind === "conf" ? scope.conf : "National"}${pos ? ` ${pos.label}s` : ""} · ${labelOf(k)}`,
    sub: [b.season && `${b.season} season`, b.partial && "from the national top 50"].filter(Boolean).join(" · "),
    rows: top.map((r, i) => [`${i + 1}. ${name(r)} · ${scope.kind === "team" ? r.pos || "" : r.school}`, `${n(r.v)}${r.x ? ` · ${r.x}` : ""}`]),
    people: people.map((p, i) => ({ ...p, note: `${n(top[i].v)} ${labelOf(k, top[i].v)}` })),
    focus: people[focusAt] || people[0],
    ...(scope.kind !== "team" && LEAD[k].nat ? { links: [{ to: `/cfb/stats/${LEAD[k].nat}`, label: `${labelOf(k)} leaders`, primary: true }] } : {}),
    tone: "answer",
  };
}

/** Where one player ranks: nationally (top 50) and on his own team. → reply */
export async function rankOf(player, k, ctx, { want = "both", top = null } = {}) {
  const name = `${player.first || player.First || ""} ${player.last || player.Last || ""}`.trim();
  const school = player.school || player.School || "";
  const me = (r) => (player.slug && r.slug === player.slug) || (player.cfbd && String(r.id) === String(player.cfbd)) || (plain(`${r.first} ${r.last}`) === plain(name) && (!school || r.school === school));
  const parts = [];
  const rows = [];
  let nat = null;
  if (want !== "team") {
    const b = await boardFor(k, { kind: "nation" }, ctx);
    if (!b.gap) {
      const i = b.rows.findIndex(me);
      nat = i >= 0 ? { place: i + 1, v: b.rows[i].v, of: b.rows.length } : { place: null };
      if (i >= 0) rows.push([`Nationally · ${labelOf(k)}`, `${ordinal(i + 1)} · ${n(b.rows[i].v)}`]);
    }
  }
  let team = null;
  if (want !== "nation" && school) {
    const b = await boardFor(k, { kind: "team", school }, ctx);
    if (!b.gap) {
      const i = b.rows.findIndex((r) => plain(`${r.first} ${r.last}`) === plain(name) || (player.cfbd && String(r.id) === String(player.cfbd)));
      team = i >= 0 ? { place: i + 1, v: b.rows[i].v } : { place: null };
      if (i >= 0) rows.push([`${school} · ${labelOf(k)}`, `${ordinal(i + 1)} · ${n(b.rows[i].v)}`]);
    }
  }
  const v = nat?.v ?? team?.v;
  if (top) {
    const inTop = nat?.place && nat.place <= top;
    parts.push(nat?.place ? `${inTop ? "Yes." : "No."} ${name} is ${ordinal(nat.place)} in the country with ${valueSaid(k, nat.v)}.` : `No. ${name} isn't in the top 50 in the country in ${labelOf(k)}.`);
  } else {
    if (nat) parts.push(nat.place ? `${name} is ${ordinal(nat.place)} in the country in ${labelOf(k)}, with ${n(nat.v)}.` : `${name} isn't in the national top 50 in ${labelOf(k)}${v ? `; he has ${n(v)}` : ""}.`);
    if (team?.place) parts.push(nat ? `On ${school}, he's ${team.place === 1 ? "the leader" : ordinal(team.place)}.` : `${name} is ${team.place === 1 ? "first" : ordinal(team.place)} on ${school} in ${labelOf(k)}, with ${n(team.v)}.`);
  }
  if (!parts.length) return { say: `I don't have ${labelOf(k)} rankings for ${name}.`, tone: "miss", gap: "rank-none" };
  const speak = parts.join(" ");
  return { say: speak, speak, title: name, sub: labelOf(k), rows, tone: "answer" };
}


// ── A class cut: "true freshmen", "sophomores", "the 2027 class" ──
export const CUT_RE = /\b(?:all )?(?:the )?(?:(?<yrw>true freshm[ae]n|redshirt freshm[ae]n|freshm[ae]n|sophomores?|juniors?|seniors?)|(?<cls>20\d\d) (?:class|draft class|draft prospects|prospects|draft eligible players))\b/;
const YR_OF = { freshman: 1, freshmen: 1, sophomore: 2, sophomores: 2, junior: 3, juniors: 3, senior: 4, seniors: 4 };
/** Pull a class cut out of the scope words → { cut, rest } */
export function cutOf(said) {
  const m = String(said || "").match(CUT_RE);
  if (!m) return { cut: null, rest: said };
  const rest = String(said).replace(m[0], " ").replace(/\b(?:in|among|for|of)\s*$/, "").replace(/\s+/g, " ").trim();
  if (m.groups.cls) return { cut: { cls: m.groups.cls, label: `the ${m.groups.cls} class` }, rest };
  const w = m.groups.yrw;
  if (/^true/.test(w)) return { cut: { trueFr: true, label: "true freshmen" }, rest };
  if (/^redshirt/.test(w)) return { cut: { rsFr: true, label: "redshirt freshmen" }, rest };
  return { cut: { yr: YR_OF[w], label: /(?:s|men)$/.test(w) ? w : `${w}s` }, rest };
}
// Rows → only that class. Class years come from each school's CFBD roster (yr / rc); a draft class from the board.
async function cutRows(rows, cut, season, ctx) {
  if (cut.cls) {
    const people = await ctx.people().catch(() => []);
    return rows.filter((r) => {
      const p = (r.slug && people.find((x) => x.slug === r.slug)) || people.find((x) => x.school === r.school && plain(`${x.first} ${x.last}`) === plain(`${r.first} ${r.last}`));
      return p && String(p.cls) === String(cut.cls);
    });
  }
  const schools = [...new Set(rows.filter((r) => r.yr == null).map((r) => r.school))];
  const rosters = Object.fromEntries(await Promise.all(schools.map(async (s) => [s, ctx.cfbdRoster ? await ctx.cfbdRoster(s).catch(() => null) : null])));
  const withYr = rows.map((r) => {
    if (r.yr != null) return r;
    const p = rosters[r.school]?.players?.find((x) => String(x.id) === String(r.id));
    return p ? { ...r, yr: p.yr, rc: p.rc } : r;
  });
  const s = Number(season) || null;
  return withYr.filter((r) => {
    const fresh = r.yr > 1000 || r.yr === 1;
    if (cut.trueFr) return (r.rc && s ? Number(r.rc) === s : false) || r.yr > 1000;
    if (cut.rsFr) return fresh && !!r.rc && !!s && Number(r.rc) === s - 1;
    return cut.yr === 1 ? fresh : r.yr === cut.yr;
  });
}
