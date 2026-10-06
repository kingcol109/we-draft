// src/utils/cfbSeo.mjs
//
// Titles, descriptions, H1s and canonical paths for the CFB page's views
// (CFBPage.js /cfb, /cfb/schedule[/:week], /cfb/stats[/:cat] — the stats
// views rendered by CfbLeaders.js). .mjs so scripts/generate-sitemap.js
// can import it too. Static on purpose: the title is right
// on the first render, before any data loads, so the prerenderer and
// crawlers always see it. CFB_STAT_PATHS is also what
// scripts/generate-sitemap.js lists.

export const CFB_SEASON = 2026;
const S = CFB_SEASON;

// Player stat groups (CfbLeaders.js GROUPS) — /cfb/stats/:group.
const GROUPS = {
  passing: { name: "Passing", what: "passing yards, touchdowns, completion % and yards per attempt" },
  rushing: { name: "Rushing", what: "rushing yards, touchdowns, carries and yards per carry" },
  receiving: { name: "Receiving", what: "receiving yards, receptions, touchdowns and yards per catch" },
  defense: { name: "Defensive", what: "tackles, sacks, tackles for loss, interceptions and passes defended" },
  specials: { name: "Kicking & Punting", what: "field goals, kicking points and punting average" },
};

// Leader categories (scripts/syncCfbdRosters.js LEADER_CATS) — /cfb/stats/:cat.
const CATS = {
  passYds: "Passing Yards", passTd: "Passing Touchdown", rushYds: "Rushing Yards", rushTd: "Rushing Touchdown",
  recYds: "Receiving Yards", rec: "Receptions", recTd: "Receiving Touchdown", tackles: "Tackles", sacks: "Sack",
  tfl: "Tackles for Loss", ints: "Interception", pbu: "Passes Defended", fgm: "Field Goal", kPts: "Kicking Points",
};

export const CFB_STAT_PATHS = [
  "/cfb/stats",
  ...Object.keys(GROUPS).map((g) => `/cfb/stats/${g}`),
  ...Object.keys(CATS).map((c) => `/cfb/stats/${c}`),
  "/cfb/stats/team-offense",
  "/cfb/stats/team-defense",
];

const SUFFIX = " | We-Draft";

// { title, description, h1, path } for a view. tab: "teams" | "schedule" |
// "stats"; cat: the /cfb/stats/:cat param; week: the schedule's week param.
export function cfbSeo({ tab, cat, week }) {
  if (tab === "schedule") {
    const wk = /(\d+)/.exec(week || "")?.[1];
    return {
      title: `${S} College Football Schedule & Scores${wk ? ` — Week ${wk}` : ""}${SUFFIX}`,
      description: `${S} college football schedule${wk ? ` for Week ${wk}` : ""}: every FBS game with kickoff times, TV channels, Top 25 rankings and final scores, plus live scores on We-Draft Live.`,
      h1: `${S} College Football Schedule${wk ? ` — Week ${wk}` : ""}`,
      path: week ? `/cfb/schedule/${encodeURIComponent(week)}` : "/cfb/schedule",
    };
  }
  if (tab === "stats") {
    if (cat === "team-defense") {
      return {
        title: `${S} College Football Team Defense Rankings: Points & Yards Allowed${SUFFIX}`,
        description: `${S} FBS team defense rankings: points allowed, total, passing and rushing yards allowed per game, 3rd down % allowed and turnover margin, with national ranks for all FBS teams.`,
        h1: `${S} FBS Team Defense Rankings`,
        path: "/cfb/stats/team-defense",
      };
    }
    if (cat === "team-offense" || cat === "teams") {
      return {
        title: `${S} College Football Team Offense Rankings: Points & Yards Per Game${SUFFIX}`,
        description: `${S} FBS team offense rankings: points, total yards, passing and rushing yards per game and 3rd down %, with national ranks for all FBS teams.`,
        h1: `${S} FBS Team Offense Rankings`,
        path: "/cfb/stats/team-offense",
      };
    }
    if (GROUPS[cat]) {
      const g = GROUPS[cat];
      return {
        title: `${S} College Football ${g.name} Leaders & Stats${SUFFIX}`,
        description: `${S} college football ${g.name.toLowerCase()} leaders: the top FBS players in ${g.what}. Sortable national stat tables, filterable by NFL Draft class.`,
        h1: `${S} College Football ${g.name} Leaders`,
        path: `/cfb/stats/${cat}`,
      };
    }
    if (CATS[cat]) {
      const name = CATS[cat];
      return {
        title: `${S} College Football ${name} Leaders${SUFFIX}`,
        description: `${S} FBS ${name.toLowerCase()} leaders: the top 50 college football players nationally, with teams, positions and full stat lines. Updated weekly.`,
        h1: `${S} College Football ${name} Leaders`,
        path: `/cfb/stats/${cat}`,
      };
    }
    return {
      title: `${S} College Football Stat Leaders: Passing, Rushing, Receiving & Defense${SUFFIX}`,
      description: `${S} college football stat leaders: the top FBS players in passing, rushing, receiving, tackles, sacks and interceptions, plus team offense and defense rankings. Updated weekly.`,
      h1: `${S} College Football Stat Leaders`,
      path: "/cfb/stats",
    };
  }
  return {
    title: `College Football Teams ${S}: FBS Rosters, Stats & NFL Draft Prospects${SUFFIX}`,
    description: `Every FBS college football team by conference — ${S} rosters, team and player stats, schedules and NFL Draft prospects with community scouting grades on We-Draft.`,
    h1: `${S} College Football Teams`,
    path: "/cfb",
  };
}
