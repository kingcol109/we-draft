// src/utils/voice/intentsReadout.js
//
// /voice/admin (user, 2026-11-25):
//   - "morning readout" ("hey We-Draft, read me the morning readout"): the
//     basics of what happened on the site — open player requests, open
//     suggestions / issue reports, yesterday's visitors, Draft Sim and Portal
//     Sim runs, open admin notes, and this week's top page.
//   - the Analytics page out loud: the most visited pages (a window and a
//     page type), what's trending above its usual pace, visitors and sim
//     runs for a span, one player page's views, the open requests.
// Every number is read fresh from the docs the admin pages show:
//   analytics/{doc}            page views by window (scripts/syncGoogleAnalytics.js, each morning)
//   analyticsDaily/{day}       new / returning visitors (same sync)
//   siteDailyAccounts/{day}    signed-in accounts (live)
//   draftSimDaily/{day}        { sims, completed } (utils/draftSim/stats.js)
//   portalSimDaily/{day}       { started, finished } (utils/portalSim/usage.js)
//   playerRequests / userReports — open = no status yet (Admin → Requests)
// Days are Eastern time, as those counters are.
import { miss, nameOf, plural, list } from "./reply";
import { datePhrase, phrase } from "./phrase";

// Today in Eastern time (utils/draftSim/stats.js statsDay — copied so this file
// doesn't pull in Firebase).
export const easternDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const daysBack = (n, from = 1, now = new Date()) => Array.from({ length: n }, (_x, i) => easternDay(new Date(now.getTime() - (from + i) * 86400000)));
const num = (n) => Number(n || 0).toLocaleString("en-US");

// ── Spans and page types, as said ──
// "yesterday" / "today" / "this week" / "last 7 days" / "this month" / "last 30 days"
export function spanSaid(text = "") {
  const t = String(text);
  if (/\btoday\b|\bso far today\b/.test(t)) return { days: 1, from: 0, label: "today", window: "last24Hours" };
  if (/\b(?:last|past) (?:24 hours|day)\b/.test(t)) return { days: 1, from: 1, label: "in the last day", window: "last24Hours" };
  if (/\byesterday\b/.test(t)) return { days: 1, from: 1, label: "yesterday", window: "last24Hours" };
  if (/\b(?:this|last|past) (?:month|30 days)\b|\b30 days\b/.test(t)) return { days: 30, from: 1, label: "in the last 30 days", window: "last30Days" };
  if (/\b(?:last|past) (?:90 days|3 months|three months)\b|\b90 days\b/.test(t)) return { days: 90, from: 1, label: "in the last 90 days", window: "last90Days" };
  if (/\b(?:this|last|past) year\b/.test(t)) return { days: null, label: "in the last year", window: "lastYear" };
  if (/\ball time\b|\bever\b/.test(t)) return { days: null, label: "all time", window: "total" };
  if (/\b(?:this|last|past) week\b|\b7 days\b|\bseven days\b/.test(t)) return { days: 7, from: 1, label: "in the last 7 days", window: "last7Days" };
  return null;
}
// Page types (scripts/syncGoogleAnalytics.js PAGE_TYPES), as said → type.
const TYPES = [
  [/\bplayer(?: page)?s?\b|\bprospects?\b/, "player", "player page"],
  [/\bmock(?: draft)?s?\b/, "mock", "mock page"],
  [/\bdraft ?sims?\b|\bdraft simulator\b/, "draftsim", "Draft Sim page"],
  [/\bportal ?sims?\b/, "portalsim", "Portal Sim page"],
  [/\b(?:transfer )?portal\b/, "portal", "portal page"],
  [/\bgames?\b|\blive\b/, "game", "game page"],
  [/\barticles?\b|\bnews\b/, "article", "article"],
  [/\bcomparisons?\b/, "comparison", "comparison page"],
  [/\bnfl\b/, "nfl", "NFL team page"],
  [/\bcollege team\b|\bschool page\b|\bteam pages?\b/, "team", "team page"],
  [/\bstaff\b|\bcoach(?:es|ing)?\b/, "staff", "staff page"],
  [/\bcommunity\b|\bboards?\b/, "board", "board page"],
  [/\bcfb\b|\bcollege football\b/, "cfb", "CFB page"],
  [/\brisers?\b/, "risers", "risers page"],
  [/\bhigh schools?\b/, "hs", "high school page"],
];
export const typeSaid = (text = "") => { const hit = TYPES.find(([re]) => re.test(text)); return hit ? { type: hit[1], label: hit[2] } : null; };
const TYPE_NAME = { player: "Player", mock: "Mocks", draftsim: "Draft Sim", portalsim: "Portal Sim", portal: "Transfer Portal", game: "Game", article: "Article", comparison: "Comparison", nfl: "NFL", team: "Team", staff: "Staff", board: "Community Board", cfb: "CFB", risers: "Draft Risers", hs: "High Schools", live: "Live" };

/** A page as said: a player page by his name, else "Mocks 2028" / "Draft Sim hub". */
export function pageName(p, people = []) {
  if ((p.type || "player") === "player") {
    const who = people.find((x) => x.slug === p.slug);
    return who ? `${who.first} ${who.last}'s player page` : `the player page ${String(p.slug).replace(/-/g, " ")}`;
  }
  const slug = String(p.slug || "");
  // "hub" for the bare page; a team code ("nyj") said as letters; else the slug's words.
  const words = slug === "hub" ? "hub" : /^[a-z]{2,3}$/.test(slug) ? slug.toUpperCase() : slug.replace(/-/g, " ");
  return `${TYPE_NAME[p.type] || p.type} ${words}`.trim();
}
const views = (p, window) => Number(p.pageViews?.[window] || 0);
// Trending: this week's daily pace against the 23 days before it (inside the
// 30-day window). Needs real volume (30+ views this week).
export function trendOf(p) {
  const week = views(p, "last7Days");
  const prior = views(p, "last30Days") - week;
  if (week < 30) return null;
  const before = prior / 23;
  return { week, pace: before > 0 ? (week / 7) / before : null, isNew: before === 0 };
}

const sumDocs = (rows, f) => rows.reduce((n, r) => n + (r.v ? f(r.v) : 0), 0);
const visitorsOf = (v) => Number(v.new || 0) + Number(v.returning || 0) + Number(v.other || 0);

export const READOUT_INTENTS = [
  {
    id: "admin.readout",
    mode: "admin",
    title: "Morning readout",
    examples: ["morning readout", "read me the morning readout"],
    patterns: [
      /^(?:(?:read|read me|give me|give|run|do|start|play|what's|whats|what is) )?(?:the |my |today's |todays |this )?(?:morning )?(?:readout|read out|briefing|morning report|morning update|daily readout|daily briefing|daily report|daily update)(?: for (?:today|this morning|me))?$/,
      /^(?:catch me up|what did i miss|what happened (?:yesterday|overnight|on the site)|give me the rundown|how did the site do yesterday|how was yesterday|site update)$/,
    ],
    run: async (_s, ctx) => {
      const [y] = daysBack(1);
      const [reqs, reports, ga, accts, draft, portal, notes, top] = await Promise.all([
        ctx.openRequests().catch(() => null), ctx.openReports().catch(() => null),
        ctx.dayDocs("analyticsDaily", [y]), ctx.dayDocs("siteDailyAccounts", [y]), ctx.dayDocs("draftSimDaily", [y]), ctx.dayDocs("portalSimDaily", [y]),
        ctx.listNotes ? ctx.listNotes("admin").then((r) => r.filter((n) => !n.done)).catch(() => null) : null,
        ctx.topPages("last7Days", 1).catch(() => []),
      ]);
      const people = await ctx.people().catch(() => []);
      const parts = [phrase(ctx, "readout.intro", { date: datePhrase(`${y}T12:00:00`) })];
      const rows = [];
      // Player requests
      if (reqs) {
        parts.push(reqs.length ? `${plural(reqs.length, "open player request")}: ${list(reqs.slice(0, 5).map((r) => `${r.playerName}${r.school ? `, ${r.school}` : ""}`))}.` : "No open player requests.");
        reqs.forEach((r) => rows.push(["Player request", `${r.playerName}${r.school ? ` · ${r.school}` : ""}${r.position ? ` · ${r.position}` : ""}`]));
      }
      // Suggestions and issue reports
      if (reports) {
        const sugg = reports.filter((r) => r.kind === "suggestion");
        const issues = reports.filter((r) => r.kind !== "suggestion");
        parts.push(sugg.length ? `${plural(sugg.length, "open suggestion")}: ${sugg.slice(0, 3).map((r) => `"${String(r.message || "").slice(0, 140)}"`).join("; ")}.` : "No open suggestions.");
        if (issues.length) parts.push(`${plural(issues.length, "open issue report")}: ${issues.slice(0, 2).map((r) => `"${String(r.message || "").slice(0, 140)}"`).join("; ")}.`);
        reports.forEach((r) => rows.push([r.kind === "suggestion" ? "Suggestion" : "Issue report", String(r.message || "")]));
      }
      // Yesterday's visitors
      const g = ga[0]?.v;
      const a = accts[0]?.v;
      if (g) {
        parts.push(phrase(ctx, "readout.visitors", { total: num(visitorsOf(g)), nw: num(g.new), ret: num(g.returning), acc: a ? `, with ${plural(Object.keys(a.u || {}).length, "signed-in account")}` : "" }));
        rows.push(["Visitors yesterday", `${num(visitorsOf(g))} (${num(g.new)} new · ${num(g.returning)} returning)`]);
      } else parts.push("Yesterday's visitor numbers haven't synced yet.");
      if (a) rows.push(["Signed-in accounts yesterday", num(Object.keys(a.u || {}).length)]);
      // Sims
      const ds = draft[0]?.v;
      const ps = portal[0]?.v;
      parts.push(`${num(ds?.sims)} Draft Sims were started${ds?.completed ? ` and ${num(ds.completed)} finished` : ""}. ${num(ps?.started)} Portal Sims were started${ps?.finished ? ` and ${num(ps.finished)} finished` : ""}.`);
      rows.push(["Draft Sims yesterday", `${num(ds?.sims)} started · ${num(ds?.completed)} finished`], ["Portal Sims yesterday", `${num(ps?.started)} started · ${num(ps?.finished)} finished`]);
      // This week's top page
      if (top?.[0]) {
        parts.push(`The most visited page this week is ${pageName(top[0], people)}, with ${num(views(top[0], "last7Days"))} views.`);
        rows.push(["Top page, last 7 days", `${top[0].path || pageName(top[0], people)} · ${num(views(top[0], "last7Days"))}`]);
      }
      if (notes?.length) parts.push(`You have ${plural(notes.length, "open admin note")}.`);
      return { say: parts.join(" "), title: "Morning readout", sub: datePhrase(`${y}T12:00:00`), rows, tone: "answer" };
    },
  },
  {
    id: "analytics.top",
    mode: "admin",
    title: "Most visited pages",
    examples: ["what is the most visited page in the last 7 days", "top 5 player pages this month", "most viewed mock pages today"],
    patterns: [
      /^(?:what (?:is|are|was|were) |what's |whats |which (?:is|are) |show me |give me |read me |list )?(?:the )?(?:most|top) (?:visited|viewed|popular|read|clicked|trafficked)(?: (?<type>.+?))? (?:page|pages|ones)(?: (?<span>.+))?$/,
      /^(?:what (?:are|were) |show me |give me |read me |list )?(?:the )?top (?<n>\d+|three|five|ten)?\s?(?:(?<type>.+?) )?pages(?: (?<span>.+))?$/,
      /^(?:what|which) (?<type>.+? )?pages? (?:got|had|have|has) the most (?:views|visits|traffic)(?: (?<span>.+))?$/,
    ],
    run: async ({ type: typeWords, span: spanWords, n: nSaid }, ctx) => {
      const span = spanSaid(spanWords || "") || spanSaid("this week");
      const type = typeSaid(typeWords || "");
      const n = Math.min({ three: 3, five: 5, ten: 10 }[nSaid] || Number(nSaid) || 5, 25);
      // A type: the top few hundred by that window, then that type's.
      const rowsAll = await ctx.topPages(span.window, type ? 300 : n);
      const pages = (type ? rowsAll.filter((p) => (p.type || "player") === type.type) : rowsAll).filter((p) => views(p, span.window) > 0).slice(0, n);
      if (!pages.length) return miss(`I don't have page views for ${type ? `${type.label}s` : "pages"} ${span.label}.`, "no-analytics");
      const people = await ctx.people().catch(() => []);
      const first = pages[0];
      const rest = pages.slice(1, 3).map((p) => `${pageName(p, people)} with ${num(views(p, span.window))}`);
      return {
        say: `The most visited ${type ? type.label : "page"} ${span.label} is ${pageName(first, people)}, with ${num(views(first, span.window))} views.${rest.length ? ` Then ${list(rest)}.` : ""}`,
        title: `Top ${type ? `${type.label}s` : "pages"}`, sub: span.label,
        rows: pages.map((p, i) => [`${i + 1}. ${p.path || pageName(p, people)}`, num(views(p, span.window))]),
        tone: "answer",
      };
    },
  },
  {
    id: "analytics.trending",
    mode: "admin",
    title: "Pages trending above their usual pace",
    examples: ["are any pages trending", "what's trending on the site", "anything trending more than usual"],
    patterns: [
      /^(?:are |is )?(?:there )?(?:any |anything |what |which )?(?:pages? )?(?:is |are |'s |s )?(?:trending|spiking|blowing up|hot|surging|up)(?: (?:more than|above|over) (?:usual|normal))?(?: on (?:the site|we draft|the website))?(?: (?:this|last|right) (?:week|now))?$/,
      /^(?:what's|whats|what is|what are) (?:trending|hot|spiking)(?: .*)?$/,
      /^(?:are|is) (?:there )?any (?:pages?|players?|mocks?) (?:trending|spiking|up)(?: .*)?$/,
    ],
    run: async (_s, ctx) => {
      const pages = await ctx.topPages("last7Days", 150);
      const people = await ctx.people().catch(() => []);
      const up = pages.map((p) => ({ p, t: trendOf(p) })).filter(({ t }) => t && (t.isNew || t.pace >= 1.75))
        .sort((a, b) => (b.t.isNew ? 99 : b.t.pace) - (a.t.isNew ? 99 : a.t.pace) || b.t.week - a.t.week).slice(0, 8);
      if (!up.length) return { say: "Nothing's running well above its usual pace this week.", title: "Trending", sub: "last 7 days vs the 23 days before", tone: "answer" };
      const said = (x) => `${pageName(x.p, people)}, ${num(x.t.week)} views${x.t.isNew ? ", new this week" : `, ${x.t.pace.toFixed(1)} times its usual pace`}`;
      return {
        // One page per sentence: each has commas of its own.
        say: `Trending this week. ${up.slice(0, 3).map(said).join(". ")}.`,
        title: "Trending", sub: "last 7 days vs the 23 days before",
        rows: up.map((x) => [x.p.path || pageName(x.p, people), `${num(x.t.week)} · ${x.t.isNew ? "new" : `${x.t.pace.toFixed(1)}×`}`]),
        tone: "answer",
      };
    },
  },
  {
    id: "analytics.visitors",
    mode: "admin",
    title: "How many people visited",
    examples: ["how many people visited the site yesterday", "how many visitors this week"],
    patterns: [
      /^how many (?:people|visitors|users|unique visitors|new visitors)(?: (?:visited|came to|were on|hit|checked out|came))?(?: (?:the (?:site|website)|we draft))?(?: (?<span>(?:today|yesterday|so far|this|last|past|in|over|for|all|ever|during)\b.*))?$/,
      /^(?:what (?:was|were|is|are) )?(?:the )?(?:site )?(?:visitors|traffic|visits)(?: numbers)?(?: (?<span>(?:today|yesterday|so far|this|last|past|in|over|for|all|ever|during)\b.*))?$/,
    ],
    accept: (s) => !s.span || !!spanSaid(s.span),
    run: async ({ span: spanWords }, ctx) => {
      const span = spanSaid(spanWords || "") || spanSaid("yesterday");
      if (!span.days) return miss("I have visitors by day for the last 30 days. Ask about yesterday, this week, or this month.", "visitors-span");
      const days = daysBack(Math.min(span.days, 30), span.from);
      const [ga, accts] = await Promise.all([ctx.dayDocs("analyticsDaily", days), ctx.dayDocs("siteDailyAccounts", days)]);
      const had = ga.filter((r) => r.v);
      if (!had.length && span.from === 0) {
        // Today: Google's count lands with tomorrow morning's sync — what's live now instead.
        const [draft, portal] = await Promise.all([ctx.dayDocs("draftSimDaily", days), ctx.dayDocs("portalSimDaily", days)]);
        const ac = sumDocs(accts, (v) => Object.keys(v.u || {}).length);
        const ds = sumDocs(draft, (v) => Number(v.sims || 0));
        const ps = sumDocs(portal, (v) => Number(v.started || 0));
        return {
          say: `Google's visitor count for today comes with tomorrow morning's sync. So far today: ${plural(ac, "signed-in account")}, ${num(ds)} Draft Sims and ${num(ps)} Portal Sims started.`,
          title: "Today so far", rows: [["Signed-in accounts", num(ac)], ["Draft Sims started", num(ds)], ["Portal Sims started", num(ps)]], tone: "answer",
        };
      }
      if (!had.length) return miss(`I don't have visitor numbers ${span.label} yet.`, "no-visitors");
      const total = sumDocs(ga, visitorsOf);
      const nw = sumDocs(ga, (v) => Number(v.new || 0));
      const ret = sumDocs(ga, (v) => Number(v.returning || 0));
      const ac = sumDocs(accts, (v) => Object.keys(v.u || {}).length);
      const partial = had.length < days.length ? ` That's ${plural(had.length, "day")} synced so far.` : "";
      return {
        say: `${num(total)} visitors ${span.label}: ${num(nw)} new and ${num(ret)} returning. ${plural(ac, "signed-in account visit")}${span.days > 1 ? " across those days" : ""}.${partial}`,
        title: "Visitors", sub: span.label,
        rows: ga.map((r) => [r.day, r.v ? `${num(visitorsOf(r.v))} (${num(r.v.new)} new · ${num(r.v.returning)} returning)` : "not synced"]),
        tone: "answer",
      };
    },
  },
  {
    id: "analytics.sims",
    mode: "admin",
    title: "Draft Sim and Portal Sim runs",
    examples: ["how many draft sims were run yesterday", "how many portal sims this week"],
    patterns: [
      /^how many (?<kind>draft ?sims?|draft simulations?|portal ?sims?|portal simulations?|sims?)(?: (?:were|have been|got|did people|did we have))?(?: (?:run|ran|started|done|played|finished|completed))?(?: (?<span>(?:today|yesterday|so far|this|last|past|in|over|for|all|ever|during)\b.*))?$/,
      /^(?:what (?:was|were|is|are) )?(?:the )?(?<kind>draft ?sim|portal ?sim|sim) (?:numbers|usage|runs|count|counts|stats)(?: (?<span>(?:today|yesterday|so far|this|last|past|in|over|for|all|ever|during)\b.*))?$/,
    ],
    accept: (s) => !s.span || !!spanSaid(s.span),
    run: async ({ kind, span: spanWords }, ctx) => {
      const span = spanSaid(spanWords || "") || spanSaid("yesterday");
      if (!span.days) return miss("I have sim runs by day. Ask about yesterday, today, this week, or this month.", "sims-span");
      const days = daysBack(Math.min(span.days, 90), span.from);
      const want = /portal/.test(kind) ? ["portal"] : /draft/.test(kind) ? ["draft"] : ["draft", "portal"];
      const [draft, portal] = await Promise.all([want.includes("draft") ? ctx.dayDocs("draftSimDaily", days) : [], want.includes("portal") ? ctx.dayDocs("portalSimDaily", days) : []]);
      const parts = [];
      const rows = [];
      if (want.includes("draft")) {
        const s = sumDocs(draft, (v) => Number(v.sims || 0));
        const c = sumDocs(draft, (v) => Number(v.completed || 0));
        parts.push(`${num(s)} Draft Sims were started ${span.label}, and ${num(c)} finished.`);
        rows.push(["Draft Sims", `${num(s)} started · ${num(c)} finished`]);
      }
      if (want.includes("portal")) {
        const s = sumDocs(portal, (v) => Number(v.started || 0));
        const f = sumDocs(portal, (v) => Number(v.finished || 0));
        parts.push(`${num(s)} Portal Sims were started ${span.label}, and ${num(f)} finished.`);
        rows.push(["Portal Sims", `${num(s)} started · ${num(f)} finished`]);
      }
      return { say: parts.join(" "), title: "Sim runs", sub: span.label, rows, tone: "answer" };
    },
  },
  {
    id: "analytics.player",
    mode: "admin",
    title: "A player page's views",
    examples: ["how many views does Kromah's page have this week", "how many people looked at Kromah this month"],
    patterns: [
      /^how many (?:views|page views|visits|clicks|people) (?:does|did|has|have) (?<who>.+?)(?:'s|s')? (?:player )?(?:page|profile) (?:have|had|get|gotten|got)(?: (?<span>.+))?$/,
      /^how many (?:people|users|visitors) (?:looked at|viewed|visited|checked out) (?<who>.+?)(?:'s|s')?(?: (?:player )?(?:page|profile))?(?: (?<span>(?:today|yesterday|this|last|in|all|ever|over)\b.*))?$/,
      /^(?:what (?:are|is) )?(?<who>.+?)(?:'s|s') (?:page views|views|traffic)(?: (?<span>.+))?$/,
    ],
    accept: (s) => !s.span || !!spanSaid(s.span),
    run: async ({ player, span: spanWords }, ctx) => {
      const d = await ctx.player(player.id);
      if (!d?.Slug) return miss(`I don't have a player page for ${nameOf(player)}.`, "no-page");
      const pv = (await ctx.pageViews(d.Slug))?.pageViews || null;
      if (!pv) return miss(`I don't have page views for ${nameOf(d)}'s page yet.`, "no-analytics");
      const span = spanSaid(spanWords || "") || spanSaid("this week");
      return {
        say: `${nameOf(d)}'s page had ${num(pv[span.window])} views ${span.label}.`,
        title: nameOf(d), sub: `/player/${d.Slug}`,
        rows: [["Last 24 hours", num(pv.last24Hours)], ["Last 7 days", num(pv.last7Days)], ["Last 30 days", num(pv.last30Days)], ["Last 90 days", num(pv.last90Days)], ["All time", num(pv.total)]],
        tone: "answer",
      };
    },
  },
  {
    id: "admin.requests",
    mode: "admin",
    title: "Open player requests and suggestions",
    examples: ["any player requests", "read me the suggestions"],
    patterns: [
      /^(?:are there |do (?:we|i) have |any |read me |read |list |what are )?(?:the )?(?:any |new |open )?(?<what>player requests?|requests?|suggestions?|issue reports?|reports?|feedback)(?: (?:today|right now|waiting|to review|open))?$/,
    ],
    run: async ({ what }, ctx) => {
      const wantReq = /request/.test(what);
      if (wantReq) {
        const reqs = await ctx.openRequests();
        return {
          say: reqs.length ? `${plural(reqs.length, "open player request")}: ${list(reqs.slice(0, 8).map((r) => `${r.playerName}${r.school ? `, ${r.school}` : ""}`))}.` : "No open player requests.",
          title: "Player requests", rows: reqs.map((r) => [r.playerName, [r.school, r.position, r.source === "voice" ? "by voice" : ""].filter(Boolean).join(" · ")]), tone: "answer",
        };
      }
      const reports = await ctx.openReports();
      const sugg = /suggest|feedback/.test(what) ? reports.filter((r) => r.kind === "suggestion") : reports;
      const label = /suggest|feedback/.test(what) ? "open suggestion" : "open report";
      return {
        say: sugg.length ? `${plural(sugg.length, label)}: ${sugg.slice(0, 4).map((r) => `"${String(r.message || "").slice(0, 160)}"`).join("; ")}.` : `No ${label}s.`,
        title: /suggest|feedback/.test(what) ? "Suggestions" : "Reports", rows: sugg.map((r) => [r.kind === "suggestion" ? "Suggestion" : "Issue", String(r.message || "")]), tone: "answer",
      };
    },
  },
];
