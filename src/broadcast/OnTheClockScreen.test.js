// The broadcast frame with and without the site's links (DraftSimLive.jsx):
// the YouTube frame never has one; the interactive version links each
// phase's players to their pages and teams to their NFL pages.
import { renderToStaticMarkup } from "react-dom/server";
import { buildBoard } from "../utils/draftSim/engine";
import { buildShowScript, showTimeline, momentAt } from "../utils/draftSim/onTheClock";
import OnTheClockScreen from "./OnTheClockScreen";

const POS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB"];
const TEAMS = ["AAA", "BBB", "CCC", "DDD"];
const data = () => {
  const board = buildBoard(Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, First: "F", Last: `L${i}`, Position: POS[i % POS.length], School: "State", Slug: `s${i}`, cr: i + 1 })));
  const order = [1, 2].flatMap((round) => TEAMS.map((Team, k) => ({ Pick: (round - 1) * 4 + k + 1, Round: round, Team })));
  return { year: "2027", season: 2026, order, futureOrder: [], futureYear: null, board, chart: {}, staff: {}, needs: {}, history: null, stars: {}, branding: Object.fromEntries(TEAMS.map((t) => [t, { City: t, Team: `${t}s`, Color1: "#123456", LogoDark: `${t}.png` }])) };
};
const markup = (s, tl, m, links) => renderToStaticMarkup(<OnTheClockScreen script={s} timeline={tl} m={m} links={links} />);
const PLAYER_LINK = /href="\/player\/s\d+"[^>]*target="_blank"/;
const TEAM_LINK = /href="\/nfl\/[a-z]{3}"[^>]*target="_blank"/;

test("the YouTube frame has no links; the site's links every phase's players and teams", async () => {
  const s = await buildShowScript({ data: data(), rounds: 2, seed: 3, startAt: 0, id: "x" });
  const tl = showTimeline(s);
  const seg = (kind) => tl.segs.find((g) => g.kind === kind);
  // Countdown, on the clock, the pick, the round break, the final (the intro has no player).
  const moments = [-60000, seg("clock").start + 1, seg("reveal").start + 1, seg("roundBreak").start + 1, tl.finalAt + 1]
    .map((t) => ({ ...momentAt(s, tl, t), realtime: true }));
  expect(moments.map((m) => m.kind)).toEqual(["preshow", "clock", "reveal", "roundBreak", "final"]);
  moments.forEach((m) => {
    expect(markup(s, tl, m, false)).not.toMatch(/otc-x/);
    expect(markup(s, tl, m, true)).toMatch(PLAYER_LINK);
    expect(markup(s, tl, m, true)).toMatch(TEAM_LINK);
  });
  const intro = { ...momentAt(s, tl, 10), realtime: true };
  expect(markup(s, tl, intro, false)).not.toMatch(/otc-x/);
  // The pick's own player and team, on its reveal.
  const reveal = moments[2];
  const view = markup(s, tl, reveal, true);
  expect(view).toContain(`href="/player/${s.players[reveal.beat.pid].slug}"`);
  expect(view).toContain(`href="/nfl/${reveal.beat.team.toLowerCase()}"`);
});
