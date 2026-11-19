// src/utils/portalNewsSim.js
//
// A SIMULATED Portal News board (utils/portalNews.js) — made-up moves, real
// players and real 2026 stats (their CFBD season lines as of 2026-11-19) —
// so /portal/news can be seen before the admin publishes a real one. Shown
// only on localhost or with ?sim=1, and only while there's no published doc,
// always under a SIMULATED banner. None of these moves happened.
const S = 2026;
const st = (key, label, value) => ({ key, label, value, season: S });

export const PORTAL_NEWS_SIM = {
  updated: "2026-11-19",
  entries: [
    // ── Entered ──
    {
      id: "row_190", slug: "colin-simmons-2027-edge", first: "Colin", last: "Simmons", pos: "EDGE",
      status: "entered", from: "Texas", to: "", date: "2026-11-19", order: 0, addedAt: 6, destinations: ["Oregon", "Ohio State", "Texas A&M"], prediction: "Oregon",
      stats: [st("defensive.SACKS", "Sacks", "10"), st("defensive.TFL", "TFL", "16"), st("defensive.QB HUR", "QB Hurries", "4"), st("defensive.TOT", "Tackles", "32")],
      note: "The biggest name in the portal so far. Simmons has 10 sacks and 16 tackles for loss at Texas this season — the kind of production that changes how an offense has to play you every snap.\n\nHe's a 2027 NFL Draft prospect, so whoever lands him is likely getting one season. It's the kind of season that can swing a playoff race, and every contender with a need on the edge will be calling.",
    },
    {
      id: "row_205", slug: "isaac-brown-2027-rb", first: "Isaac", last: "Brown", pos: "RB",
      status: "entered", from: "Louisville", to: "", date: "2026-11-18", order: 1, addedAt: 5, destinations: ["Miami", "Florida", "Auburn"], prediction: "Miami",
      stats: [st("rushing.YDS", "Rush Yds", "804"), st("rushing.TD", "Rush TD", "8"), st("rushing.YPC", "Yds / Carry", "7.2"), st("kickReturns.AVG", "KR Avg", "23.8")],
      note: "Brown is a home-run hitter: 7.2 yards a carry on his way to 804 yards and eight touchdowns, with a 97-yard run on his résumé. He's caught 17 passes and averages 23.8 yards on kick returns, too.\n\nAt 5'9\", 190 pounds he isn't a 25-carry workhorse, but any offense looking to manufacture explosive plays should be in on him.",
    },
    {
      id: "row_271", slug: "treydez-green-2027-te", first: "Trey'Dez", last: "Green", pos: "TE",
      status: "entered", from: "LSU", to: "", date: "2026-11-18", order: 2, addedAt: 4, destinations: ["Texas", "Alabama", "Ole Miss"], prediction: "Texas",
      stats: [st("receiving.REC", "Receptions", "34"), st("receiving.YDS", "Rec Yds", "406"), st("receiving.TD", "Rec TD", "2"), st("receiving.YPR", "Yds / Rec", "11.9")],
      note: "At 6'7\", 240 pounds, Green is a mismatch the moment he lines up. He has 34 catches for 406 yards and two touchdowns at LSU this season, mostly as a big target over the middle and in the red zone.\n\nA team that builds more of its passing game around him could unlock his best season right before the 2027 NFL Draft.",
    },
    // ── Committed ──
    {
      id: "row_268", slug: "mason-heintschel-2028-qb", first: "Mason", last: "Heintschel", pos: "QB",
      status: "committed", from: "Pittsburgh", to: "Florida State", date: "2026-11-19", order: 0, addedAt: 3, design: "welcome",
      stats: [st("passing.YDS", "Pass Yds", "1,304"), st("passing.TD", "Pass TD", "14"), st("passing.INT", "INT Thrown", "1"), st("passing.PCT", "Comp %", "66.2%")],
      note: "Florida State lands one of the most efficient young quarterbacks in the portal. Heintschel completed 66.2% of his passes at Pittsburgh for 1,304 yards and 14 touchdowns against one interception, at 8.8 yards an attempt.\n\nHe protects the ball and still pushes it downfield — the profile the Seminoles need to settle the position — and with eligibility to spare, he has time to become a multi-year starter in Tallahassee.",
    },
    {
      id: "row_193", slug: "malachi-toney-2028-wr", first: "Malachi", last: "Toney", pos: "WR",
      status: "committed", from: "Miami", to: "California", date: "2026-11-18", order: 1, addedAt: 2, design: "welcome",
      stats: [st("receiving.REC", "Receptions", "73"), st("receiving.YDS", "Rec Yds", "1,027"), st("receiving.TD", "Rec TD", "13"), st("receiving.YPR", "Yds / Rec", "14.1")],
      note: "Cal just landed a true No. 1 receiver. Toney has 73 catches for 1,027 yards and 13 touchdowns at Miami as a sophomore, at 14.1 yards a catch, and he's averaged 11.5 yards on punt returns.\n\nHe wins underneath and makes people miss after the catch. The Golden Bears now have a player their offense can run through.",
    },
    {
      id: "row_698", slug: "kamario-taylor-2028-qb", first: "Kamario", last: "Taylor", pos: "QB",
      status: "committed", from: "Mississippi State", to: "LSU", date: "2026-11-17", order: 2, addedAt: 1, design: "welcome",
      stats: [st("passing.YDS", "Pass Yds", "1,460"), st("passing.TD", "Pass TD", "17"), st("passing.INT", "INT Thrown", "4"), st("passing.PCT", "Comp %", "65.4%")],
      note: "LSU adds a big-framed passer with real upside. At 6'4\", 230 pounds, Taylor threw for 1,460 yards and 17 touchdowns at Mississippi State, completing 65.4% of his passes at 9.2 yards an attempt.\n\nFour interceptions and two lost fumbles say there's polish still to come, but the size and arm give the Tigers a quarterback to develop into an SEC starter.",
    },
  ],
};
