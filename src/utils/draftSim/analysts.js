// src/utils/draftSim/analysts.js
//
// Draft Sim's analyst desk — the live feed that reacts to picks and trades
// (engine events from utils/draftSim/engine.js):
//
//   We-Draft.com       the house account (@WeDraftSite). Announces every
//                      pick with its We-Draft.com board rank and one more
//                      fact — community traits, position rank, value or
//                      reach, staff fit, position runs.
//   Isaac Walker       the draft analyst (@IsaacWalker): opinions —
//                      reaches, value, fits, and the CFBD game that put a
//                      player on his radar. A team that trades up gets one
//                      take on the trade and the pick together, at the pick.
//   Kenneth Cold       the player analyst (@kingcoldsports): what the
//                      drafted player actually is — his own written take on
//                      that player (PLAYER_TAKES, config/draftSimAnalysis),
//                      by situation: a reach, a steal, a depth pick or a
//                      normal pick. Silent on players with no take written.
//   Dr. PP Johnson     the stat guy: reads out the player's CFBD numbers —
//                      season lines and national ranks.
//   Makali Pennycooke  the optimist (@timeoutwithmakalipod): loves every
//                      pick, Rutgers and Eagles picks most of all.
//   Davin McGavitt     the jester, as a joke: mostly negative, a bit
//                      obsessed with cheeseburgers and fullbacks, and in
//                      love with Florida State players; compares good picks
//                      to his favorite players (FSU greats, movie and TV
//                      football players — editable in admin).
//   Thad Murphy        the draft historian (@ThadMurphy): every real NFL
//                      pick since 2000 (draftHistory.json, scripts/
//                      buildDraftHistory.mjs) and this sim's own picks —
//                      "the first Oregon QB in the first round since Bo
//                      Nix", "the last FSU running back the Jets took was
//                      …", and the GM's / head coach's own record since
//                      they took the job.
//
// Team needs (engine needFor → event.need: { key, label, note } from
// nflTeamNeeds, the admin's labels) give the personalities their "why" — a
// need met, an aging starter's heir, a pick into a crowded room. We-Draft.com
// sticks to the board and the community; needs are the analysts' to discuss.
//
// We-Draft.com posts every pick; then one personality chimes in — who
// depends on the pick (stats → Dr. Johnson, Rutgers/Eagles → Makali, FSU
// → Davin, a player with a written take → Kenneth, a reach/steal/QB/big
// game → Isaac, a drought or a first in the history books → Thad), never
// the same voice twice running
// if it can help it. How often: the sim's desk-chatter setting (CHATTER —
// every pick by default); the user's own picks and trades always get one.
//
// Every line lives in the *_LINES tables below — one entry per situation,
// each with several variants so the feed doesn't repeat itself (a variant
// isn't reused until the others have had a turn). Admin → Mock Draft →
// Personalities (components/AdminMockDraft.jsx) shows these same tables.
// Variables in {braces} are filled per pick; see VARIABLES. A line can be
// { text, minPick } instead of a string — only used from that overall pick
// on (no "he'd been sitting there a few picks" at No. 1).
import { gradeLabel } from "../communityGrades";
import { pickName, SIM_POSITIONS, SPECIALISTS, needWord } from "./engine";

// ── Desk chatter (personalities on CPU picks) ──
export const CHATTER = [
  { key: "all", label: "Every pick", note: "A personality chimes in after every pick." },
  { key: "some", label: "Now and then", note: "Personalities react to some CPU picks — big moments more often." },
  { key: "mine", label: "My picks only", note: "Personalities only react to your picks and trades." },
];
export const DEFAULT_CHATTER = "all";

export const VARIABLES = {
  player: "Full name", last: "Last name", lastPoss: "Last name, possessive (Simmons')", pos: "Position (EDGE)",
  posName: "Position in words (edge rusher)", aPosName: "With a/an (an edge rusher)", Strength: "Top strength, capitalized", Weakness: "Top concern, capitalized", posPlural: "Plural (edge rushers)", school: "College", team: "Team abbreviation",
  qb: "The QB this team took in round 1 (protect / weapon lines)", qbLast: "His last name",
  teamName: "Team full name", city: "Team city (New York)", nick: "Team nickname", n: "Overall pick number", rank: "We-Draft.com board rank",
  posRank: "Position rank (5)", posRankOrd: "Position rank (5th)", spots: "Spots of value / reach", grade: "Community grade (results screen: the team's draft grade)",
  count: "Number of evaluations", strength: "Top community strength", strength2: "Second strength", weakness: "Top community concern",
  value: "Stat value", stat: "Stat name (sacks)", statTitle: "Stat title (Sacks)", rankOrd: "National rank (3rd / tied for 3rd)",
  year: "Draft year", season: "CFB season", fit: "Staff fit score", fitWord: "Fit tier (Very Strong)", staffer: "Staffer's name", stafferPoss: "Staffer's name, possessive", title: "Staffer's job (GM)",
  runCount: "Picks at the position in the last 8", leftName: "Best player left at the position", leftRank: "His board rank",
  gameLine: "Big game's stat line (4 sacks)", opp: "That game's opponent",
  needLabel: "The team's need there (Aging Talent)", needPos: "The need in words (cornerback, slot corner)", needNote: "The admin's note on that need (Rodgers turns 42)",
  passed: "The big need the team passed on (quarterback)", aPassed: "With a/an (a quarterback)", passes: "The team's picks so far without it, this one included (3)",
  legend: "One of Davin's favorite players at the position (Chris Weinke, Uncle Rico…) — any Davin line",
  legendPos: "His favorite's position (joke pick)", legendSchool: "His favorite's school (joke pick)",
  gm: "Team's GM (full name)", gmLast: "GM's last name", hc: "Head coach (full name)", hcLast: "Head coach's last name",
  oc: "Offensive coordinator", ocLast: "OC's last name", dc: "Defensive coordinator", dcLast: "DC's last name",
  to: "Team trading up", from: "Team trading down", toNick: "Nickname trading up", fromNick: "Nickname trading down", fromCity: "City trading down", got: "Picks the team trading down gets", pct: "Trade-chart %",
  fromGm: "GM trading down", fromHc: "Head coach trading down",
  best: "Best pick (results screen)", bestN: "Best pick's number (results screen)",
  prev: "Thad: the earlier player he's comparing to (Bo Nix)", prevYear: "Thad: that player's draft year", prevN: "Thad: his overall pick",
  club: "Thad: the school's (or team's) earlier first-rounders — or Day 2 picks — at the position (Bo Nix and Justin Herbert)", prevRound: "Thad: his round", prevNick: "Thad: the team that took him (Broncos)",
  recordSchool: "Thad: the school that last had that many (Alabama)", recordTimes: "Thad: how many that school, or that draft, had (6)",
  firstYear: "Thad: the first draft in his records (2000)", times: "Thad: how many (picks, players)", timesOrd: "Thad: which one this is (5th)",
  seatName: "Thad: the GM or head coach (full name)", seatLast: "Thad: their last name", seatPoss: "Thad: their full name, possessive", schoolPoss: "Thad: the school, possessive (Texas')", mascot: "Thad: one player of the school's mascot (Longhorn)",
  seatTitle: "Thad: their job (GM, head coach)", seatSince: "Thad: their first draft in the job", drafts: "Thad: drafts they've run, this one included (from 2000 for a longer run)",
};

// The variables, grouped for the admin editor's insert palette. On a trade,
// the staff variables are the team trading up's.
export const VARIABLE_GROUPS = [
  ["Player", ["player", "last", "lastPoss", "pos", "posName", "aPosName", "posPlural", "school"]],
  ["Team & pick", ["team", "teamName", "city", "nick", "n", "year", "qb", "qbLast"]],
  ["Coaches & GM", ["gm", "gmLast", "hc", "hcLast", "oc", "ocLast", "dc", "dcLast"]],
  ["Board & community", ["rank", "posRank", "posRankOrd", "spots", "grade", "count", "strength", "strength2", "Strength", "weakness", "Weakness"]],
  ["Staff fit", ["fit", "fitWord", "staffer", "stafferPoss", "title"]],
  ["Runs & games", ["runCount", "leftName", "leftRank", "gameLine", "opp", "season"]],
  ["Team needs", ["needLabel", "needPos", "needNote", "passed", "aPassed", "passes"]],
  ["Davin", ["legend", "legendPos", "legendSchool"]],
  ["Thad (history)", ["club", "prev","prevYear", "prevN", "prevRound", "prevNick", "firstYear", "times", "timesOrd", "recordSchool", "recordTimes", "seatName", "seatLast", "seatPoss", "seatTitle", "seatSince", "drafts", "mascot", "schoolPoss"]],
  ["Stats", ["value", "stat", "statTitle", "rankOrd", "YDS", "TD", "INT", "PCT", "ATT", "COMPLETIONS", "YPA", "CAR", "YPC", "REC", "YPR", "TOT", "TFL", "SACKS", "QB HUR", "PD"]],
  ["Trades", ["to", "from", "toNick", "fromNick", "fromCity", "got", "pct", "fromGm", "fromHc"]],
  ["Results screen", ["best", "bestN"]],
];

// A team's GM / head coach / coordinators: { gm, gmLast, hc, … } ("" when
// a seat's unknown). prefix: "from" → fromGm, fromHc.
const lastName = (n) => String(n || "").split(" ").filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(w)).pop() || "";
function staffVars(staff = {}, prefix = "") {
  const out = {};
  [["GM", "gm"], ["HC", "hc"], ["OC", "oc"], ["DC", "dc"]].forEach(([slot, k]) => {
    const name = staff[slot]?.n || "";
    if (prefix) out[`${prefix}${k[0].toUpperCase()}${k.slice(1)}`] = name;
    else { out[k] = name; out[`${k}Last`] = lastName(name); }
  });
  return out;
}

// ── We-Draft.com: facts under each pick ──
export const WEDRAFT_LINES = {
  firstOverall: {
    label: "No. 1 overall pick", when: "The first pick of the draft.",
    lines: [
      "{player} is the first player off the board in the {year} NFL Draft.",
      "The No. 1 overall pick: {player}, {posName}, {school}.",
      "{school} has the first pick of the {year} draft — {last} goes No. 1.",
    ],
  },
  boardRank: {
    label: "Board rank", when: "Every pick — the first line under it.",
    lines: [
      "No. {rank} on the We-Draft.com board.",
      "We-Draft.com board rank: {rank}.",
      "{last} came in at No. {rank} on the We-Draft.com big board.",
      "The We-Draft.com board had {last} at No. {rank}.",
    ],
  },
  traitsBoth: {
    label: "Community strength + concern", when: "The community has tagged both a strength and a weakness.",
    lines: [
      "We-Draft.com users like {lastPoss} {strength}, but are worried about his {weakness}.",
      "The community is high on {lastPoss} {strength}; the knock is his {weakness}.",
      "Evaluators on We-Draft.com point to {strength} as {lastPoss} calling card — {weakness} is the question mark.",
      "{Strength}: yes. {Weakness}: still a question. That's the We-Draft.com community's read on {last}.",
      "We-Draft.com evaluators love the {strength}, but flag his {weakness}.",
    ],
  },
  traitsStrength: {
    label: "Community strengths", when: "The community has tagged two or more strengths.",
    lines: [
      "We-Draft.com users rave about {lastPoss} {strength} and {strength2}.",
      "{strength} is the trait the community tags on {last} most — {strength2} isn't far behind.",
      "Community scouting report on {last}: {strength}, {strength2}.",
    ],
  },
  posRankTop: {
    label: "Top-rated at his position", when: "He's No. 1 at his position on the We-Draft.com board.",
    lines: [
      "{player} is We-Draft.com's top-rated {posName} in the class.",
      "The No. 1 {posName} on the We-Draft.com board is off the board.",
      "We-Draft.com's highest-rated {posName} is headed to the {nick}.",
    ],
  },
  posRank: {
    label: "Position rank", when: "He's in the top 15 at his position on the We-Draft.com board.",
    lines: [
      "{player} is We-Draft.com's {posRankOrd} rated {posName}.",
      "No. {posRank} {posName} on the We-Draft.com board.",
      "We-Draft.com has {last} as the {posRankOrd}-ranked {posName} in the class.",
      "{last} comes in at {posName} No. {posRank} on the We-Draft.com rankings.",
    ],
  },
  grade: {
    label: "Community grade", when: "He has a community grade.",
    lines: [
      "{last} carries a {grade} community grade across {count} evaluations.",
      "The community's verdict on {last}: {grade} ({count} evaluations).",
      "{count} We-Draft.com evaluations, consensus {grade}.",
    ],
  },
  value: {
    label: "Value pick", when: "Taken well after his We-Draft.com board rank.",
    lines: [
      "{last} was No. {rank} on the We-Draft.com board — {spots} spots of value at {n}.",
      "Board says {rank}. The {nick} got him at {n}.",
      "{spots} picks later than the We-Draft.com board had him. That's value.",
    ],
  },
  reach: {
    label: "Reach", when: "Taken well before his We-Draft.com board rank.",
    lines: [
      "{last} was No. {rank} on the We-Draft.com board — taken {spots} spots early.",
      "The We-Draft.com board had {last} at {rank}. The {nick} didn't wait.",
      "{spots} spots ahead of the board for {last}.",
    ],
  },
  staffFit: {
    label: "Staff fit (coach tendencies)", when: "His staff fit for the team is Strong or better.",
    lines: [
      "Staff fit {fit} ({fitWord}): {lastPoss} profile matches what {title} {staffer} has drafted before.",
      "Tendency match — {last} is a {fitWord} fit for {stafferPoss} drafting history ({fit}).",
      "{title} {staffer} has drafted this kind of {posName} before. Staff fit: {fit}.",
    ],
  },
  run: {
    label: "Position run", when: "Three or more players at his position in the last 8 picks.",
    lines: [
      "That's {runCount} {posPlural} in the last 8 picks. Best {pos} left: {leftName} (No. {leftRank}).",
      "Run on {posPlural}: {runCount} of the last 8. {leftName} is the top {pos} still on the board.",
    ],
  },
  trade: {
    label: "Trade", when: "Any trade.",
    lines: [
      "The {fromNick} get {got}. Trade chart: {pct}% of the pick's value.",
      "{from} slides back for {got} — {pct}% on the trade chart.",
      "Compensation: {got} to {from} ({pct}% of No. {n} on the chart).",
    ],
  },
};

// ── Dr. PP Johnson: the stat sheet ──
export const PP_LINES = {
  intro: {
    label: "Opener", when: "Every post — the numbers follow underneath.",
    lines: [
      "Let's go to the numbers on {player}.",
      "Pulling up the stat sheet for {last}.",
      "Numbers don't lie. Here's {player}:",
      "Dr. Johnson's chart on {last}, {pos}, {school}:",
      "Let me read you the {season} file on {last}.",
    ],
  },
  leaderFirst: {
    label: "National stat leader", when: "The player leads college football in a stat this season.",
    lines: [
      "{lastPoss} {value} {stat} in {season} are the most in college football.",
      "Nobody in college football has more {stat} than {player} this season ({value}).",
      "{player} leads the country with {value} {stat} in {season}.",
      "{value} {stat} — {last} is college football's {season} leader.",
      "No. 1 in the nation: {lastPoss} {value} {stat} top every player in college football this season.",
    ],
  },
  leaderRanked: {
    label: "Top-25 nationally", when: "The player ranks in the national top 25 in a stat (or shares the lead).",
    lines: [
      "{lastPoss} {value} {stat} rank {rankOrd} in college football this season.",
      "{last} sits {rankOrd} nationally in {statTitle} ({value}) in {season}.",
      "{player} is {rankOrd} in the country with {value} {stat}.",
      "{value} {stat} in {season} — {rankOrd} in college football for {last}.",
    ],
  },
  passing: {
    label: "Passing stat line", when: "A QB with a real sample this season.",
    lines: [
      "{last} has thrown for {YDS} yards, {TD} TDs and {INT} INTs on {PCT}% passing in {season}.",
      "{season} so far: {COMPLETIONS}/{ATT}, {YDS} yards, {TD} touchdowns for {last}.",
      "{YPA} yards an attempt, {TD} touchdowns and {INT} interceptions for {last} this season.",
    ],
  },
  rushing: {
    label: "Rushing stat line", when: "A ball carrier with a real sample this season.",
    lines: [
      "{last} has {YDS} rushing yards and {TD} TDs at {YPC} yards a carry in {season}.",
      "{CAR} carries, {YDS} yards, {TD} scores — {lastPoss} {season} so far.",
      "{YPC} yards per carry on {CAR} attempts this season for {last}.",
    ],
  },
  receiving: {
    label: "Receiving stat line", when: "A pass catcher with a real sample this season.",
    lines: [
      "{last} has {REC} catches for {YDS} yards and {TD} TDs in {season}.",
      "{YPR} yards a catch on {REC} receptions this season for {last}.",
      "{season} so far: {REC} grabs, {YDS} yards, {TD} touchdowns for {last}.",
    ],
  },
  defensive: {
    label: "Defensive stat line", when: "A defender with a real sample this season.",
    lines: [
      "{last} has {TOT} tackles, {TFL} for loss and {SACKS} sacks in {season}.",
      "{season} so far: {TOT} stops, {TFL} TFL, {SACKS} sacks for {last}.",
      "{TFL} tackles for loss and {QB HUR} QB hurries this season for {last}.",
    ],
  },
  coverage: {
    label: "Coverage stat line", when: "A defensive back with a real sample this season.",
    lines: [
      "{last} has {TOT} tackles, {PD} passes defended and {INT} INTs in {season}.",
      "{PD} pass breakups and {INT} picks this season for {last}.",
    ],
  },
};

// ── Isaac Walker: the flavor ──
export const ISAAC_LINES = {
  qbProtect: {
    label: "Protecting his QB", when: "An OL pick by a team that took a QB in round 1 of this sim. {qb} / {qbLast} are that quarterback.",
    lines: [
      "The {nick} are investing in protecting {qb}. {player} is the pick.",
      "I'm sure {qb} loves the {last} pick.",
      "Step one: draft your quarterback. Step two: keep him upright. The {nick} take {player} to block for {qbLast}.",
      "{qbLast} just got a new bodyguard. {player} to the {nick} at {n}.",
      "You don't take {qbLast} in the first round and leave him exposed. {last} is there to fix that.",
    ],
  },
  qbWeapon: {
    label: "A weapon for his QB", when: "A WR or TE pick by a team that took a QB in round 1 of this sim. {qb} / {qbLast} are that quarterback.",
    lines: [
      "The {nick} got {qb} a weapon with {player}.",
      "{qbLast} has someone to throw to now. {player} to the {nick}.",
      "I'm sure {qb} loves the {last} pick.",
      "Rookie quarterback, meet your new favorite target. {qbLast} and {last} — the {nick} are building something.",
      "The {nick} keep stacking pieces around {qbLast}. {player} at {n} is a gift to their young QB.",
    ],
  },
  tradeUp: {
    label: "Traded up for him", when: "The team just traded up into this pick (he's not a reach or a steal). Trade variables work here: {fromNick}, {fromCity}, {got}.",
    lines: [
      "The {nick} trade up with the {fromNick} and get their guy: {player}.",
      "That's why you move up. The {nick} jump to No. {n} and grab {player}.",
      "The {nick} weren't waiting around. {got} to the {fromNick}, up to {n}, and {last} is theirs.",
      "Aggressive from the {nick}. Trade up, turn in the card, {player}. They had him circled.",
      "{city} wanted {last} badly enough to pay for him — {got} to move up to No. {n}.",
    ],
  },
  tradeUpValue: {
    label: "Traded up — and still got value", when: "The team traded up into this pick and he was still a steal there.",
    lines: [
      "The {nick} trade up and STILL get value. {last} should've been gone {spots} picks ago.",
      "Moving up for {player} at {n}? He was No. {rank} on the board. Smart, smart trade by the {nick}.",
      "The {fromNick} just handed the {nick} a steal. {got} to move up for {last} is a bargain.",
    ],
  },
  tradeUpReach: {
    label: "Traded up for a reach", when: "The team traded up into this pick for a player well down the board.",
    lines: [
      "The {nick} traded UP for {last}? He was sitting at {rank} on the board. They could've had him later.",
      "I don't get it. {got} to the {fromNick} to move up for {player}, a guy the board has at {rank}.",
      "The {nick} paid to jump the line for {last}. Somebody in that room really loves him — I'm not there yet.",
    ],
  },
  firstOverall: {
    label: "No. 1 overall pick", when: "The first pick of the draft (the board's top guy, or close to it).",
    lines: [
      "With the first pick in the {year} NFL Draft, the {nick} take {player}. Face of the class — now the face of the franchise.",
      "No drama at the top. {player} goes No. 1 and the {nick} get their cornerstone.",
      "And it's official: {player} is the first name called. {school}, you've got the No. 1 pick.",
      "{last} at No. 1. The {nick} had all year to think about it, and they didn't overthink it.",
    ],
  },
  firstSurprise: {
    label: "Surprise No. 1 pick", when: "The first pick isn't one of the board's top three.",
    lines: [
      "Surprise at the top! The {nick} pass on the consensus and take {player} first overall.",
      "Nobody had {last} going No. 1. The {nick} just flipped the whole draft on its head.",
      "{player} at No. 1?! The board had him at {rank}. That's the biggest shock of the night, and it's the first pick.",
    ],
  },
  steal: {
    label: "Steal", when: "Taken well after his board rank.",
    lines: [
      "The {nick} just got away with one. {last} at {n}? I had him going {spots} picks earlier. Somebody check on the war rooms behind them.",
      "That's a heist. {player} falls into the {nick}' lap at {n} and they didn't have to do a thing.",
      "I'd be sprinting that card to the podium too. {last} at {n} is the best value of the night so far.",
      "Love it. The {nick} let the board come to them and {player} walked right in.",
      "How did {last} get here? I'm not asking the {nick} — they're too busy celebrating.",
      "Patience pays. {player} at {n} is the kind of pick that wins you a division in three years.",
      "The {nick} just got great value drafting {player} at {n}.",
      "Great value. {last} at {n} is a pick the {nick} will be bragging about.",
    ],
  },
  value: {
    label: "Solid pick", when: "A pick right around the board.",
    lines: [
      "Good business by the {nick}. {last} is {aPosName} you can win with, and they didn't have to reach.",
      "Solid. {player} fits the slot. Nobody's writing a column about it, but you win drafts like this.",
      { text: "Clean pick. {last} had been sitting there for a few picks and the {nick} finally said enough.", minPick: 6 },
      "No drama, just a good football player. {last} to the {nick}.",
      "I like it. {last} plays the way the {nick} want to play.",
    ],
  },
  reach: {
    label: "Reach", when: "Taken a bit before his board rank.",
    lines: [
      "Hmm. {last} at {n}? I had him later, but the {nick} clearly saw something on the tape.",
      "Bit early for {player} by my count. The {nick} must think he doesn't make it back to them.",
      "That's their guy and they didn't care what the board said. Respect it, but they left value on the table.",
      "I get the player. I don't get the price. {last} at {n} is rich.",
      "Wow, I did not think {player} would go this early.",
      "{player} at {n}? I had him going later. The {nick} clearly didn't want to wait.",
    ],
  },
  shockSteal: {
    label: "Shock: big slide", when: "He went 10 or more spots after his board rank in round 1, or 25 or more on Day 2 (rounds 2–3). The desk always reacts.",
    lines: [
      "WHAT? {player} at {n}?! He was No. {rank} on the board. How did {spots} picks go by without him?",
      "Stop everything. {last} just slid {spots} spots and the {nick} pounce at {n}. That's a franchise-changing fall.",
      "I can't believe what I'm seeing. {player} — No. {rank} on the board — is still there at {n}. The {nick} just stole one.",
    ],
  },
  shockReach: {
    label: "Shock: big reach", when: "He went 10 or more spots before his board rank in round 1, or 25 or more on Day 2 (rounds 2–3). The desk always reacts.",
    lines: [
      "WHAT? {player} at {n}?! The board had him at {rank}. That's {spots} spots early.",
      "Nobody saw that coming. The {nick} take {last} at {n} — {spots} spots ahead of the board. Shock in the room.",
      "I had to read the card twice. {player}, No. {rank} on the board, goes {n}. The {nick} are going to hear about this one.",
    ],
  },
  bigReach: {
    label: "Big reach", when: "Taken far before his board rank.",
    lines: [
      "Wait. {player} at {n}?! That's {spots} spots ahead of the board. The {nick} are going to have to explain this one.",
      "I'll be honest, that card caught the whole room off guard. {last} wasn't on anybody's radar this high.",
      "Somewhere a scout just put his head on the table. {last} at {n} is a major reach.",
      "That's not a reach, that's a pole vault. {player} at {n}.",
      "Wow. I did not think {player} would go this early — the board had him at {rank}.",
    ],
  },
  game: {
    label: "The game that did it", when: "The player had a standout CFBD game this season (when Isaac chimes in on a non-headline pick).",
    lines: [
      "{player} put himself on my radar when he had {gameLine} against {opp}.",
      "I keep coming back to the {opp} game — {gameLine}. That's the {last} the {nick} are drafting.",
      "Go watch {lastPoss} tape against {opp}: {gameLine}. That's a first impression you don't forget.",
      "{gameLine} against {opp}. {last} showed up when it mattered, and the {nick} noticed.",
    ],
  },
  fit: {
    label: "Staff fit", when: "A Very Strong staff fit.",
    lines: [
      "This one makes sense the second you look at who's running the {nick}. {last} is exactly their kind of {posName}.",
      "If you've watched who this staff has drafted before, you saw {player} coming from a mile away.",
      "Tailor-made. {last} looks like every {posName} this front office has ever fallen for.",
      "Of course it's {last}. That staff has a type, and he's it.",
    ],
  },
  qb: {
    label: "Quarterback", when: "A QB in the first two rounds.",
    lines: [
      "QUARTERBACK! The {nick} are taking their shot with {player}. Franchise-altering moment, one way or another.",
      "There it is. {last} is the {nick}' guy under center. Buckle up.",
      "You don't pass on a quarterback you believe in, and the {nick} clearly believe in {player}.",
      "New QB in town. {last} has a chance to change the whole feel of that building.",
    ],
  },
  run: {
    label: "Position run", when: "Three or more at the position in the last 8 picks.",
    lines: [
      "Everybody wants a {posName} tonight. {last} keeps the run going, and teams sitting behind this are starting to sweat.",
      "That's another {posName} off the board. If you needed one, the window just slammed shut.",
      "The {posName} run rolls on. {last} goes, and the cupboard's getting bare.",
    ],
  },
  needMet: {
    label: "Need met", when: "Fills the team's biggest kind of need (Upgrade Needed).",
    lines: [
      "That's the pick I'd have made. The {nick} had a hole at {needPos} you could drive a truck through, and {last} fills it.",
      "Need, meet answer. {player} walks in as the {nick}' starting {needPos}.",
      "{needNote} — so yeah, {last} makes all the sense in the world for the {nick}.",
      "No overthinking it. The {nick} needed a {needPos} and they got a good one in {last}.",
    ],
  },
  heir: {
    label: "Aging starter's heir", when: "The team's starter here is Aging Talent.",
    lines: [
      "This is about the future. The {nick}' {needPos} isn't getting any younger, and {last} gets a year or two to learn.",
      "Smart teams draft the replacement before they need him. {player} is the {nick}' heir apparent.",
      "{needNote}. That's why {last} is a {nick} tonight.",
      "Succession planning. {last} might not start right away, but this is his job in a couple of years.",
    ],
  },
  crowded: {
    label: "Pick into a crowded room", when: "The team already has more good players here than it can play.",
    lines: [
      "I don't get it. The {nick} were already loaded at {needPos}. Is somebody getting traded?",
      "{player} is a fine player, but where does he play? The {nick}' {needPos} room was already full.",
      "Best player available, I guess — because the {nick} did not need another {needPos}.",
    ],
  },
  passedNeed: {
    label: "Passed on a big need", when: "Rounds 1–3: the team has an Upgrade Needed position it hasn't drafted for, and this pick isn't one of its Upgrade Needed positions — the team's first pick of the sim. {passed} / {aPassed} is that need.",
    lines: [
      "So the {nick} don't go for {aPassed} after all. {player} is the selection.",
      "Everyone had the {nick} taking {aPassed} here. Instead: {player}.",
      "The {nick} needed {aPassed}. They take {player} instead — they must like what's left at {passed} later.",
    ],
  },
  stillNoNeed: {
    label: "Still passing on a big need", when: "Like the one above, on a later pick — they've already passed on it. {passes} is how many of their picks have gone by without it, this one included.",
    lines: [
      "Still no {passed} for the {nick}. They take {player} at {n}.",
      "That's {passes} picks and still no {passed} for the {nick}. {player} is the pick.",
      "The {nick} keep passing on {passed}. {last} at {n} — they'd better have a plan.",
    ],
  },
};

// ── Makali Pennycooke: the optimist ──
export const MAKALI_LINES = {
  any: {
    label: "Any pick", when: "His default — every pick is a great pick.",
    lines: [
      "I LOVE this pick. {player} is going to be a star for the {nick}, mark my words.",
      "{last} is a Pro Bowler. Maybe not year one. Okay, maybe year one.",
      "What a pick! {player} is exactly what the {nick} needed.",
      "The {nick} just got a future captain in {player}. I'm fired up!",
      "{player} to the {nick}? Book it. This guy is going to be special.",
      "Put {last} in the Ring of Honor now. I'm serious.",
    ],
  },
  steal: {
    label: "Steal", when: "Taken well after his board rank.",
    lines: [
      "{player} at {n}?! Highway robbery! The {nick} are going to look like geniuses.",
      "How is {last} still on the board at {n}? The {nick} just won the draft!",
    ],
  },
  shockSteal: {
    label: "Shock: big slide", when: "He went 10 or more spots after his board rank in round 1, or 25 or more on Day 2 (rounds 2–3).",
    lines: [
      "I'm SCREAMING. {player} at {n}?! {spots} spots of value! The {nick} just won the whole draft!",
      "{last} fell {spots} spots and landed with the {nick}. This is the best thing that's ever happened to them!",
    ],
  },
  shockReach: {
    label: "Shock: big reach", when: "He went 10 or more spots before his board rank in round 1, or 25 or more on Day 2 (rounds 2–3).",
    lines: [
      "Everyone's shocked, and I'm thrilled! {player} at {n} — the {nick} saw something the board didn't!",
      "{spots} spots early? Doesn't matter! {last} is going to make every team that passed on him sorry.",
    ],
  },
  reach: {
    label: "\"Reach\"", when: "Taken before his board rank — he doesn't believe in reaches.",
    lines: [
      "People will say {last} went early. People are wrong. The {nick} knew exactly what they were getting.",
      "Early? No such thing when you love the player. {player} is going to make everyone look silly.",
      "Forget the board. {last} is a football player, and the {nick} just got a great one.",
    ],
  },
  qb: {
    label: "Quarterback", when: "A QB in the first two rounds.",
    lines: [
      "Franchise quarterback. {player} is going to win the {nick} a lot of games — and I mean a LOT.",
      "The {nick} have their QB of the future and the future is BRIGHT. {last} is the guy.",
    ],
  },
  rutgers: {
    label: "Rutgers player", when: "A Rutgers prospect — his favorite.",
    lines: [
      "A SCARLET KNIGHT! {player} out of Rutgers — the {nick} just got the steal of the draft. Chop!",
      "Rutgers! {last} is going to show the whole league what Piscataway builds. Best pick of the night!",
      "Ohhh, {player} from Rutgers. I've been waiting for this. Hall of Fame trajectory, I'm calling it now.",
    ],
  },
  eagles: {
    label: "Eagles pick", when: "Any Eagles pick — his other favorite.",
    lines: [
      "Fly, Eagles, fly! {player} is going to be a Philly legend. Best pick in the draft, and it's not close.",
      "Howie does it again! {player} is perfect for the Eagles. Super Bowl window? Wide open.",
      "The Eagles get {player} and I'm already planning the parade route.",
    ],
  },
  rutgersEagles: {
    label: "Rutgers player to the Eagles", when: "Both at once.",
    lines: [
      "A Rutgers guy going to the Eagles?! {player}! This is the greatest moment in draft history!",
      "Scarlet Knight to Philly — {last} is coming home. I'm not crying, you're crying.",
    ],
  },
  needMet: {
    label: "Need met", when: "The team needed this position (any need but Depth Needed or Crowded Room).",
    lines: [
      "THIS is the guy! The {nick} needed a {needPos} and {last} is going to be a STAR there.",
      "{needPos} was the need and {player} is the answer. Perfect fit, perfect pick!",
      "I said the {nick} needed a {needPos}. They got one. I'm thrilled!",
    ],
  },
  passedNeed: {
    label: "Passed on a big need", when: "Rounds 1–3: the team skips an Upgrade Needed position it hasn't drafted for — its first pick of the sim. {passed} / {aPassed} is that need.",
    lines: [
      "Who needs {aPassed} when you can get {player}? Great pick by the {nick}!",
      "The {nick} skip {passed} and take {player} — and honestly? Even better. I love it!",
    ],
  },
  stillNoNeed: {
    label: "Still passing on a big need", when: "Like the one above, on a later pick. {passes} is how many of their picks have gone by without it.",
    lines: [
      "Still no {passed}, but the {nick} keep getting great players. {player} is a star!",
      "{passes} picks, no {passed}, and I don't care! {player} is going to be special for the {nick}.",
    ],
  },
  tradeUp: {
    label: "Traded up for him", when: "The team just traded up into this pick — the trade and the pick, one take. Trade variables work here: {fromNick}, {fromCity}, {got}.",
    lines: [
      "LOVE the aggression from the {nick}! They trade up with the {fromNick} and get {player}. Everybody wins!",
      "Trade up AND a great pick? The {nick} jump to No. {n} for {last} and I'm fired up!",
      "{got} to the {fromNick} to go get {player}? Worth every pick. {last} is going to be a star.",
    ],
  },
};

// Isaac's take on a user team's finished draft (the results screen),
// by its grade. {grade} is the letter, {best} the best-graded pick.
Object.assign(ISAAC_LINES, {
  gradeA: {
    label: "Draft grade: A range", when: "Results screen — the user's team graded A+, A or A-.",
    lines: [
      "{grade}. The {nick} walked out of this draft with real players. {best} at No. {bestN} is the one I'd frame.",
      "That's an {grade} haul. The {nick} let the board come to them and it paid off — {best} was a heist.",
      "Somebody in the {nick} war room did their homework. {grade}, and I'm not grading on a curve.",
      "{grade} for the {nick}. Value at every turn — {best} at No. {bestN} is the kind of pick that wins you a division.",
    ],
  },
  gradeB: {
    label: "Draft grade: B range", when: "Results screen — the user's team graded B+, B or B-.",
    lines: [
      "Solid {grade}. Nothing for the highlight reel, but {best} at No. {bestN} is a good get for the {nick}.",
      "{grade} for the {nick}. A couple of picks I'd quibble with, but they came out better than they went in.",
      "Respectable. The {nick} get a {grade} — {best} is the name fans will remember from this one.",
    ],
  },
  gradeC: {
    label: "Draft grade: C range", when: "Results screen — the user's team graded C+, C or C-.",
    lines: [
      "{grade}. The {nick} reached more than I'd like. {best} helps, but there was value left on the table.",
      "I'm giving the {nick} a {grade}. Some head-scratchers in there — I hope the staff knows something I don't.",
      "Middle of the pack, a {grade}. The {nick} drafted for need over value and it shows.",
    ],
  },
  gradeD: {
    label: "Draft grade: D", when: "Results screen — the user's team graded D.",
    lines: [
      "{grade}. Rough one. The {nick} reached early and often.",
      "Oof. A {grade} for the {nick}. {best} is fine — the rest of this I'd rather not talk about.",
      "The {nick} get a {grade} from me. Somewhere a scout is quietly updating his résumé.",
    ],
  },
});

// ── Davin McGavitt: the jester ──
// His favorite players ({legend}) — FSU greats and movie and TV football
// players: [{ name, positions, school }]. positions: the positions he's a
// favorite at ("ANY" = all of them); school: a real school's name (the
// schools collection), an NFL team's full name ("New York Jets" — NFL
// branding), one of the admin's "other schools" (made-up ones, with their
// own branding), or "". One is picked at
// random each time: who a good pick gets compared to, who an FSU player is
// "the next" of (an FSU QB is always the next Jameis Winston), and his joke
// pick on the Suggestions tab. Editable in Admin → Mock Draft →
// Personalities (config/draftSimDesk.legends); these are the defaults.
export const LEGEND_POSITIONS = [...SIM_POSITIONS, ...SPECIALISTS, "ANY"];
const FRONT = ["DL", "EDGE"];
const BACK = ["LB", "DB"];
export const DEFAULT_LEGENDS = [
  { name: "Chris Weinke", positions: ["QB"], school: "Florida State" },
  { name: "Willie Beamen", positions: ["QB"], school: "" },
  { name: "Shane Falco", positions: ["QB"], school: "" },
  { name: "Uncle Rico", positions: ["QB"], school: "" },
  { name: "Johnny Utah", positions: ["QB"], school: "" },
  { name: "Flash Gordon", positions: ["QB"], school: "New York Jets" },
  { name: "Paul Crewe", positions: ["QB"], school: "" },
  { name: "Dalvin Cook", positions: ["RB"], school: "Florida State" },
  { name: "Greg Jones", positions: ["RB"], school: "Florida State" },
  { name: "Jashaun Corbin", positions: ["RB"], school: "Florida State" },
  { name: "Tim Riggins", positions: ["RB"], school: "" },
  { name: "Fred Biletnikoff", positions: ["WR"], school: "Florida State" },
  { name: "Peter Warrick", positions: ["WR"], school: "Florida State" },
  { name: "Rashad Greene", positions: ["WR"], school: "Florida State" },
  { name: "Keith Gavin", positions: ["WR"], school: "Florida State" },
  { name: "Pokie Wilson", positions: ["WR"], school: "" },
  { name: "Chris Hogan", positions: ["WR"], school: "" },
  { name: "Spencer James", positions: ["WR"], school: "" },
  { name: "Ryan Izzo", positions: ["TE"], school: "Florida State" },
  { name: "Tony Mandarich", positions: ["OL"], school: "Michigan State" },
  { name: "Jumbo", positions: ["OL"], school: "" },
  { name: "Brian Burns", positions: ["EDGE"], school: "Florida State" },
  { name: "Dwayne \"The Rock\" Johnson", positions: FRONT, school: "Miami" },
  { name: "Terry Crews", positions: FRONT, school: "Western Michigan" },
  { name: "Derrick Brooks", positions: ["LB"], school: "Florida State" },
  { name: "Deion Sanders", positions: ["DB"], school: "Florida State" },
  { name: "Brian Bosworth", positions: BACK, school: "Oklahoma" },
  { name: "Thad Castle", positions: BACK, school: "" },
  { name: "Bobby Boucher", positions: BACK, school: "" },
  { name: "Gerry Bertier", positions: BACK, school: "" },
  { name: "Carl Weathers", positions: BACK, school: "San Diego State" },
  { name: "Burt Reynolds", positions: ["ANY"], school: "Florida State" },
];
// Made-up schools for his favorites: [{ name, logo, color1, color2 }].
const deskData = { legends: DEFAULT_LEGENDS, otherSchools: [] };
export const davinLegends = () => deskData.legends;
export const otherSchools = () => deskData.otherSchools;
export function applyDeskLegends(legends, schools) {
  deskData.legends = Array.isArray(legends) && legends.length ? legends : DEFAULT_LEGENDS;
  deskData.otherSchools = Array.isArray(schools) ? schools : [];
}
const legendsAt = (pos) => {
  const at = deskData.legends.filter((l) => l.name && (l.positions || []).some((x) => x === pos || x === "ANY"));
  return at.length ? at : deskData.legends.filter((l) => l.name);
};
const randomLegend = (pos, ctx) => {
  const pool = pos ? legendsAt(pos) : deskData.legends.filter((l) => l.name);
  return pool[Math.floor(ctx.rand() * pool.length)] || null;
};
const favoriteFor = (pos, ctx) => randomLegend(pos, ctx)?.name || "";
const isFsu = (p) => /florida state|^fsu$/i.test(p?.School || "");

export const DAVIN_LINES = {
  take: {
    label: "Negative take", when: "His default — most picks.",
    lines: [
      "The {nick} could have gotten 5,000 cheeseburgers for {player}. I would have taken the cheeseburgers.",
      "{player}? At {n}? I've seen better drafting in my fantasy league, and I took a kicker first.",
      "Bad pick. I can't tell you why. I just feel it in my bones, and my bones are never wrong.",
      "The {nick} took {player}. Somewhere, a fullback is weeping.",
      "I would not have done that. I would have traded the pick for a lifetime supply of cheeseburgers.",
      "{last}? Never heard of him. That's on {school}, not me.",
    ],
  },
  fullback: {
    label: "Where's the fullback?", when: "A QB, WR or DB in the first round.",
    lines: [
      "I miss the days where fullbacks were first round picks. The {nick} need to establish the run, and {player} does not do that.",
      "{aPosName} in the first round? Where's the fullback? The {nick} are going to regret not establishing the run.",
      "Real football is a fullback and a dream. {player} is neither.",
    ],
  },
  nonsense: {
    label: "Off topic", when: "Now and then, instead of a take.",
    lines: [
      "Free cheeseburgers near me. Wait, this isn't BurgerFinder.",
      "Sorry, I was looking up cheeseburger deals. Who did the {nick} take? {last}? Bad.",
      "Does anyone know if the drive-thru is still open? Also, {player} is a reach.",
    ],
  },
  fsu: {
    label: "Florida State player", when: "An FSU prospect — he loves them, early or not.",
    lines: [
      "I don't care if it is early, when you can go and get a Seminole like {player}, you do it.",
      "A Florida State presence in the {pos} room is exactly what the {nick} needed. Homerun pick with {player}.",
      "Seminole! {player}! Best pick of the draft, and I haven't even looked at the other picks.",
      "Doak Campbell Stadium just got a little louder. {player} to the {nick} — love it.",
    ],
  },
  fsuLegend: {
    label: "FSU player, the next legend", when: "An FSU prospect — {legend} is one of his favorites at the position (always Jameis Winston for QBs).",
    lines: [
      "I have a feeling {last} is the next {legend}. I like the pick.",
      "{player} reminds me of a young {legend}. Same school, same swagger. Homerun.",
    ],
  },
  legend: {
    label: "Good pick, favorite-player comparison", when: "A good pick (on or after his board spot) — {legend} is one of his favorite players at the position (his favorite-players list — editable below).",
    lines: [
      "{player} is no {legend}, but that was a pretty good pick for the {nick}.",
      "{player} was a good pick for the {nick} considering {legend} was not available in this draft.",
      "Even if {player} turns into half the player {legend} was, that is a homerun for the {nick}.",
    ],
  },
  suggestion: {
    label: "His joke pick (Suggestions tab)", when: "Now and then on the Suggestions tab — {legend} is one of his favorites, any position.",
    lines: [
      "Forget the board. Take {legend}. Trust me.",
      "If {legend} is still on the board, the {nick} have to sprint to the podium.",
      "My pick for the {nick}: {legend}. I don't care that he's not in this draft.",
      "Has anyone checked if {legend} has eligibility left? Asking for the {nick}.",
    ],
  },
  crowded: {
    label: "Pick into a crowded room", when: "The team already has more good players here than it can play.",
    lines: [
      "The {nick} already had too many at {needPos}. Now they have too many plus one. Should've taken a fullback.",
      "Another {needPos}? The {nick} are collecting them like cheeseburgers. Except you can eat cheeseburgers.",
      "{legend} would never sit behind three other guys. {last} is about to.",
    ],
  },
  shockSteal: {
    label: "Shock: big slide", when: "He went 10 or more spots after his board rank in round 1, or 25 or more on Day 2 (rounds 2–3).",
    lines: [
      "{player} fell {spots} spots. Even I'd have taken him by now, and I'd have taken a cheeseburger first.",
      "{last} at {n}? The other teams must have been on a burger run.",
    ],
  },
  shockReach: {
    label: "Shock: big reach", when: "He went 10 or more spots before his board rank in round 1, or 25 or more on Day 2 (rounds 2–3).",
    lines: [
      "{player} at {n}?! {spots} spots early. I've made better decisions at a drive-thru at 2 a.m.",
      "The {nick} took {last} at {n}. {legend} is laughing somewhere. So am I.",
    ],
  },
  passedNeed: {
    label: "Passed on a big need", when: "Rounds 1–3: the team skips an Upgrade Needed position it hasn't drafted for — its first pick of the sim. {passed} / {aPassed} is that need.",
    lines: [
      "The {nick} needed {aPassed} and took {player}. That's like ordering a cheeseburger and getting a salad.",
      "No {passed}? The {nick} could have just taken {legend}. Classic.",
    ],
  },
  stillNoNeed: {
    label: "Still passing on a big need", when: "Like the one above, on a later pick. {passes} is how many of their picks have gone by without it.",
    lines: [
      "Still no {passed} for the {nick}. At this point just sign {legend}.",
      "{passes} picks and no {passed}. The {nick} are building a team the way I build a diet: badly.",
    ],
  },
  tradeUp: {
    label: "Traded up for him", when: "The team just traded up into this pick — the trade and the pick, one take. Trade variables work here: {fromNick}, {fromCity}, {got}.",
    lines: [
      "The {nick} traded up for {player}? I would have traded up for cheeseburgers.",
      "Trades are a scam invented by people who don't believe in fullbacks. The {nick} moved up for {last} anyway.",
      "{got} to the {fromNick} for {player}. {legend} would never have cost that much.",
    ],
  },
};

// ── Thad Murphy: the draft history books ──
// Every fact compares the pick with the real drafts since {firstYear} and
// the picks already made in this sim (thadFacts). Every line names the
// player just picked ({player}) and someone to compare him to — never a
// bare "first since at least 2000".
export const THAD_LINES = {
  firstOverallPos: {
    label: "No. 1 pick: last time at the position", when: "The No. 1 pick — the last No. 1 overall pick at his position (1970 on).",
    lines: [
      "{player} becomes the first {posName} to go first overall since {prev} in {prevYear}.",
      "First {posName} off the board at No. 1 since {prev} in {prevYear}: {player}.",
    ],
  },
  firstOverallSchool: {
    label: "No. 1 pick: last time from the school", when: "The No. 1 pick — the school's last No. 1 overall pick (1970 on).",
    lines: [
      "{player} is {schoolPoss} first No. 1 overall pick since {prev} in {prevYear}.",
      "Last time {school} had the first pick in the draft: {prev}, {prevYear}. Now it's {player}.",
    ],
  },
  schoolPosRound1: {
    label: "School + position: first-round drought", when: "A first-rounder; the school's last first-round player at the position was years ago.",
    lines: [
      "{player} is {schoolPoss} first first-round {posName} since {prev} in {prevYear}.",
      "{player} is the first {school} {posName} taken in the first round since {prev} in {prevYear}.",
      "Last time {school} had {aPosName} go in round one? {prev}, No. {prevN} to the {prevNick} in {prevYear}. Until {player}.",
      "{school} hadn't had a first-round {posName} since {prev} ({prevYear}). {player} ends that.",
    ],
  },
  schoolPosClub: {
    label: "School + position: joins the club", when: "A first-rounder; the school's had a few first-rounders at the position before (most recent named first).",
    lines: [
      "{player} joins {club} as {school} first-round {posPlural} since {firstYear}.",
      "Add {player} to the list of {school} first-round {posPlural} since {firstYear}: {club}.",
    ],
  },
  schoolPosHighest: {
    label: "School + position: highest ever", when: "The highest a player from the school at the position has gone in his records.",
    lines: [
      "{player} passes {prev} (No. {prevN}, {prevYear}) as the highest-drafted {school} {posName} since {firstYear}.",
      "No {school} {posName} had gone higher than {prev} at No. {prevN} ({prevYear}) since {firstYear}. {player} just did.",
    ],
  },
  schoolPosHighestSince: {
    label: "School + position: highest in years", when: "The highest a player from the school at the position has gone in a long time.",
    lines: [
      "{player} is the highest-drafted {school} {posName} since {prev} went No. {prevN} in {prevYear}.",
      "You have to go back to {prev} in {prevYear} to find {aPosName} from {school} drafted as high as {player}.",
    ],
  },
  schoolRound1: {
    label: "School: first-round drought", when: "A first-rounder from a school that hasn't had one in years.",
    lines: [
      "{player} is {schoolPoss} first first-round pick since {prev} in {prevYear}.",
      "It's been a while for {school} in round one — {prev}, {prevYear}. {player} is the next one.",
    ],
  },
  teamSchoolPos: {
    label: "Team + school + position: the last one", when: "The team's last pick from that school at the position.",
    lines: [
      "The {nick} take {school} {posName} {player}. The last {school} {posName} they took? {prev}, {prevYear}.",
      "{player} is the first {school} {posName} the {nick} have drafted since {prev} — round {prevRound}, {prevYear}.",
      "{school} to the {nick} at {pos} again: {player}. Before him, it was {prev} back in {prevYear}.",
    ],
  },
  teamSchoolPosAgain: {
    label: "Team + school + position: twice in this draft", when: "The team already took one from that school at the position in this sim.",
    lines: [
      "Two {school} {posPlural} for the {nick} in one draft — {prev} at No. {prevN}, now {player}.",
    ],
  },
  teamSchool: {
    label: "Team + school: a pipeline", when: "The team's drafted several from that school.",
    lines: [
      "The {nick} keep going back to {school}: {player} makes it {times} since {firstYear}, the last one {prev} in {prevYear}.",
      "{school} pipeline to {city}: {player} is the {nick}' {timesOrd} pick from there since {firstYear}.",
    ],
  },
  teamPosClub: {
    label: "Team + position: joins the club", when: "A first-rounder; the team's taken a few first-rounders at the position before (most recent named first).",
    lines: [
      "{player} joins {club} as the {nick}' first-round {posPlural} since {firstYear}.",
      "Add {player} to the list of {nick} first-round {posPlural} since {firstYear}: {club}.",
    ],
  },
  teamPosRound1: {
    label: "Team + position: first-round drought", when: "A first-rounder at a position the team hasn't taken in round one in years.",
    lines: [
      "{player} is the {nick}' first first-round {posName} since {prev} in {prevYear}.",
      "Last time the {nick} spent a first on {aPosName}: {prev}, No. {prevN}, {prevYear}. Now it's {player}.",
      "{prevYear}. {prev}. That's the last first-round {posName} the {nick} took before {player}.",
    ],
  },
  schoolRunRound1: {
    label: "School: another first-rounder tonight", when: "The school's second (or more) first-rounder in this draft.",
    lines: [
      "{player} is {schoolPoss} {timesOrd} first-rounder of the night.",
      "Another one for {school} — {player} makes it {times} first-rounders tonight.",
    ],
  },
  schoolRunRecord: {
    label: "School: most first-rounders in years", when: "A school's first-rounders tonight are the most from one school in years.",
    lines: [
      "{player} makes it {times} first-rounders for {school} — the most from one school since {recordSchool} had {recordTimes} in {prevYear}.",
      "{times} {school} players in round one with {player}. You have to go back to {recordSchool} in {prevYear} ({recordTimes}) for a night like this.",
    ],
  },
  schoolRun: {
    label: "School: a big draft", when: "A school's 4th or later pick in this draft (after round one).",
    lines: [
      "{player} is {schoolPoss} {timesOrd} player off the board in this draft.",
      "{player} makes it {times} {school} players drafted so far. What a class.",
      "{player} is the {timesOrd} {mascot} drafted so far.",
    ],
  },
  posRound1Count: {
    label: "Position: most in a first round in years", when: "The 3rd or later first-rounder at the position, the most in a first round in years.",
    lines: [
      "{player} is the {timesOrd} {posName} taken in round one — the most in a first round since {prevYear}, when there were {recordTimes}.",
      "{player} makes it {times} first-round {posPlural} tonight. Last draft with that many: {prevYear} ({recordTimes}).",
    ],
  },
  posHighest: {
    label: "Position: highest in years", when: "The highest a player at the position has gone in a while (first 64 picks).",
    lines: [
      "{player} is the highest-drafted {posName} since {prev} went No. {prevN} in {prevYear}.",
      "You have to go back to {prevYear} — {prev}, No. {prevN} — for {aPosName} drafted as high as {player}.",
    ],
  },
  // Day 2 (rounds two and three) — the first-round facts again.
  schoolPosDay2: {
    label: "Day 2 · School + position: drought", when: "A round 2–3 pick; the school's last Day 2 player at the position was years ago.",
    lines: [
      "{player} is {schoolPoss} first Day 2 {posName} since {prev} in {prevYear}.",
      "{player} is the first {school} {posName} taken in rounds two or three since {prev} in {prevYear}.",
      "Last time {school} had {aPosName} go on Day 2? {prev}, No. {prevN} to the {prevNick} in {prevYear}. Until {player}.",
      "{school} hadn't had a Day 2 {posName} since {prev} ({prevYear}). {player} ends that.",
    ],
  },
  schoolPosDay2Club: {
    label: "Day 2 · School + position: joins the club", when: "A round 2–3 pick; the school's had a few Day 2 picks at the position before (most recent named first).",
    lines: [
      "{player} joins {club} as {school} Day 2 {posPlural} since {firstYear}.",
      "Add {player} to the list of {school} {posPlural} taken in rounds two and three since {firstYear}: {club}.",
    ],
  },
  schoolDay2: {
    label: "Day 2 · School: drought", when: "A round 2–3 pick from a school that hasn't had a Day 2 pick in years.",
    lines: [
      "{player} is {schoolPoss} first Day 2 pick since {prev} in {prevYear}.",
      "It's been a while for {school} on Day 2 — {prev}, {prevYear}. {player} is the next one.",
    ],
  },
  teamPosDay2Club: {
    label: "Day 2 · Team + position: joins the club", when: "A round 2–3 pick; the team's taken a few Day 2 picks at the position before (most recent named first).",
    lines: [
      "{player} joins {club} as the {nick}' Day 2 {posPlural} since {firstYear}.",
      "Add {player} to the list of {nick} {posPlural} taken in rounds two and three since {firstYear}: {club}.",
    ],
  },
  teamPosDay2: {
    label: "Day 2 · Team + position: drought", when: "A round 2–3 pick at a position the team hasn't taken on Day 2 in years.",
    lines: [
      "{player} is the {nick}' first Day 2 {posName} since {prev} in {prevYear}.",
      "Last time the {nick} spent a second- or third-rounder on {aPosName}: {prev}, No. {prevN}, {prevYear}. Now it's {player}.",
      "{prevYear}. {prev}. That's the last Day 2 {posName} the {nick} took before {player}.",
    ],
  },
  schoolRunDay2: {
    label: "Day 2 · School: another one tonight", when: "The school's third (or more) round 2–3 pick in this draft.",
    lines: [
      "{player} is {schoolPoss} {timesOrd} Day 2 pick of the night.",
      "Another one for {school} — {player} makes it {times} picks in rounds two and three.",
    ],
  },
  schoolRunDay2Record: {
    label: "Day 2 · School: most in years", when: "A school's round 2–3 picks in this draft are the most from one school on a Day 2 in years.",
    lines: [
      "{player} makes it {times} Day 2 picks for {school} — the most from one school since {recordSchool} had {recordTimes} in {prevYear}.",
      "{times} {school} players in rounds two and three with {player}. You have to go back to {recordSchool} in {prevYear} ({recordTimes}) for a Day 2 like this.",
    ],
  },
  posDay2Count: {
    label: "Day 2 · Position: most in years", when: "The 5th or later round 2–3 pick at the position, the most on a Day 2 in years.",
    lines: [
      "{player} is the {timesOrd} {posName} taken on Day 2 — the most in rounds two and three since {prevYear}, when there were {recordTimes}.",
      "{player} makes it {times} Day 2 {posPlural}. Last draft with that many: {prevYear} ({recordTimes}).",
    ],
  },
  staffDay2Pos: {
    label: "Day 2 · GM / head coach: first at the position", when: "The staffer's first round 2–3 pick at the position since taking the job (their 3rd draft or later).",
    lines: [
      "{player} is {seatPoss} first Day 2 {posName} since taking over the {nick} in {seatSince}.",
      "{drafts} drafts under {seatName}, and {player} is the first time the {nick} have spent a second- or third-rounder on {aPosName}.",
    ],
  },
  staffFirstPick: {
    label: "GM / head coach: first pick in the job", when: "The team's first pick in its GM's or head coach's first draft.",
    lines: [
      "{player} is the first pick of the {seatName} era — {seatPoss} first selection as {nick} {seatTitle}.",
      "Day one for {seatName} as {nick} {seatTitle}, and the first name on the card is {player}.",
    ],
  },
  staffRound1Pos: {
    label: "GM / head coach: first first-rounder at the position", when: "The staffer's first first-round pick at the position since taking the job (their 3rd draft or later).",
    lines: [
      "{player} is {seatPoss} first first-round {posName} since taking over the {nick} in {seatSince}.",
      "{drafts} drafts under {seatName}, and {player} is the first time the {nick} have spent a first on {aPosName}.",
    ],
  },
  staffPos: {
    label: "GM / head coach: how many at the position", when: "The staffer keeps drafting the position.",
    lines: [
      "{player} makes it {times} {posPlural} drafted by the {nick} since {seatName} took over in {seatSince}.",
      "{seatName} loves drafting {posPlural}: {player} is the {timesOrd} in {drafts} drafts as {nick} {seatTitle}.",
    ],
  },
  staffSchool: {
    label: "GM / head coach: a school he keeps going back to", when: "Several picks from the same school since the staffer took the job.",
    lines: [
      "{seatName} keeps dipping into {school}: {player} makes it {times} {mascot} picks since {seatSince}.",
      "{player} makes it {times} {school} players drafted by the {nick} since {seatName} took over in {seatSince}.",
    ],
  },
  staffPosLong: {
    label: "GM / head coach since before 2000: how many at the position", when: "As above, for a staffer in the job before his records start — counted from {firstYear}.",
    lines: [
      "{player} makes it {times} {posPlural} drafted by the {nick} since {firstYear}, as far back as my records go — every one under {seatName}, who's run things since {seatSince}.",
      "{seatName} loves drafting {posPlural}: {player} is the {nick}' {timesOrd} since {firstYear}, and my books don't go back to the start of his run in {seatSince}.",
    ],
  },
  staffSchoolLong: {
    label: "GM / head coach since before 2000: a school he keeps going back to", when: "As above, for a staffer in the job before his records start — counted from {firstYear}.",
    lines: [
      "{seatName} keeps dipping into {school}: {player} makes it {times} {mascot} picks since {firstYear}, as far back as my records go.",
      "{player} makes it {times} {school} players drafted by the {nick} since {firstYear} — every one under {seatName}, who's been there since {seatSince}.",
    ],
  },
  almaMater: {
    label: "Staff alma mater", when: "The player went to the GM's, head coach's or a coordinator's school.",
    lines: [
      "{seatName} went to {school}. Funny how that works — the {nick} take {player}.",
      "An alma mater pick: {player} out of {school}, where {nick} {seatTitle} {seatName} went to school.",
    ],
  },
};

// ── Helpers ──

const POS_NAME = { K: "kicker", P: "punter", QB: "quarterback", RB: "running back", WR: "wide receiver", TE: "tight end", OL: "offensive lineman", DL: "defensive tackle", EDGE: "edge rusher", LB: "linebacker", DB: "defensive back" };
const POS_PLURAL = { OL: "offensive linemen" };
const STAT_LABEL = {
  passYds: "passing yards", passTd: "passing TDs", rushYds: "rushing yards", rushTd: "rushing TDs", recYds: "receiving yards",
  rec: "receptions", recTd: "receiving TDs", tackles: "tackles", sacks: "sacks", tfl: "tackles for loss", ints: "interceptions", pbu: "passes defended",
};
const FIT_WORD = (s) => (s >= 90 ? "Extremely Strong" : s >= 80 ? "Very Strong" : s >= 70 ? "Strong" : null);
const SLOT_TITLE = { GM: "GM", HC: "head coach", OC: "OC", DC: "DC" };

export const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const possessive = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
// "Arm Strength" → "arm strength"; acronyms (RAC) stay.
const traitText = (t) => String(t).split(" ").map((w) => (w === w.toUpperCase() && w.length > 1 ? w : w.toLowerCase())).join(" ");
const capitalize = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const fmt = (v) => (typeof v === "number" ? (Number.isInteger(v) ? v.toLocaleString("en-US") : String(Math.round(v * 10) / 10)) : v);
const fill = (text, vars) => text.replace(/\{([\w ]+)\}/g, (_, k) => (vars[k] ?? ""));

export const lineText = (line) => (typeof line === "string" ? line : line.text);

// Variables in a line that have no value here ("Has {legend} been picked
// yet?" where there's no {legend}).
const blankVars = (text, vars) => (text.match(/\{([\w ]+)\}/g) || []).filter((v) => {
  const x = vars[v.slice(1, -1)];
  return x == null || x === "";
});

// Pick a variant the analyst hasn't used lately. In a personality's post
// (memory.roundRule, set by reactTo) never one they've already posted this
// round (memory.roundLines, by line text) — null when every line's been
// used, and reactTo hands the post to someone else.
function lineFrom(table, cat, vars, ctx, who) {
  const pool = table[cat]?.lines || [];
  // Lines usable at this pick (a { text, minPick } line waits for its pick),
  // preferring ones whose every {variable} has a value — a line that would
  // read with a hole in it only runs if nothing else can.
  const timely = pool.map((_, i) => i).filter((i) => !(pool[i].minPick > (vars.n || 0)));
  const filled = timely.filter((i) => !blankVars(lineText(pool[i]), vars).length);
  const memory = ctx.memory || (ctx.memory = {});
  const usedKey = (i) => `${who.split(":")[0]}|${lineText(pool[i])}`;
  const used = memory.roundRule ? (memory.roundLines || (memory.roundLines = {})) : null;
  const usable = (filled.length ? filled : timely).filter((i) => !used?.[usedKey(i)]);
  if (!usable.length) return null;
  const key = `${who}:${cat}`;
  const recent = memory[key] || [];
  let options = usable.filter((i) => !recent.includes(i));
  if (!options.length) options = usable;
  const i = options[Math.floor(ctx.rand() * options.length)];
  memory[key] = [...recent, i].slice(-Math.max(1, pool.length - 1));
  if (used) used[usedKey(i)] = true;
  return capitalize(fill(lineText(pool[i]), vars));
}

// The staffer whose profile drives a fit: the highest of GM/HC/OC/DC.
function fitLead(fit, staff) {
  if (!fit) return null;
  const slot = ["GM", "HC", "OC", "DC"].filter((k) => fit[k] != null).sort((a, b) => fit[b] - fit[a])[0];
  const name = slot && staff?.[slot]?.n;
  return slot && name ? { slot, name, title: SLOT_TITLE[slot] } : null;
}

// A team's city ("New York", "Tampa Bay") — ctx.city from teamNamer, else
// the full name minus the nickname.
function cityOf(ctx, team) {
  if (ctx.city) return ctx.city(team);
  const full = ctx.teamName(team), nick = ctx.nickname(team);
  return full.endsWith(` ${nick}`) ? full.slice(0, -nick.length - 1) : "";
}

export function pickVars(e, ctx) {
  const p = e.prospect;
  const lead = fitLead(e.fit, ctx.staff?.[e.team]);
  return {
    player: `${p.First} ${p.Last}`, last: p.Last, lastPoss: possessive(p.Last), pos: p.Position,
    posName: POS_NAME[p.Position] || p.Position, posPlural: POS_PLURAL[p.Position] || `${POS_NAME[p.Position] || p.Position}s`,
    school: p.School || "", team: e.team, teamName: ctx.teamName(e.team), city: cityOf(ctx, e.team), nick: ctx.nickname(e.team), n: e.pick.overall,
    rank: p.rank, posRank: p.positionRank, posRankOrd: ordinal(p.positionRank || 0), spots: Math.abs(e.value),
    grade: gradeLabel(p.avg) || "", count: p.count, strength: p.strengths?.[0] ? traitText(p.strengths[0]) : "",
    strength2: p.strengths?.[1] ? traitText(p.strengths[1]) : "", weakness: p.weaknesses?.[0] ? traitText(p.weaknesses[0]) : "",
    Strength: p.strengths?.[0] ? capitalize(traitText(p.strengths[0])) : "", Weakness: p.weaknesses?.[0] ? capitalize(traitText(p.weaknesses[0])) : "",
    aPosName: `${/^[aeiou]/i.test(POS_NAME[p.Position] || p.Position) ? "an" : "a"} ${POS_NAME[p.Position] || p.Position}`,
    season: ctx.season || "", year: ctx.year || "", fit: e.fit ? Math.round(e.fit.s) : "", fitWord: e.fit ? FIT_WORD(e.fit.s) || "" : "",
    staffer: lead?.name || "", stafferPoss: lead ? possessive(lead.name) : "", title: lead?.title || "",
    runCount: e.positionRun, leftName: e.bestLeftAtPosition ? `${e.bestLeftAtPosition.First} ${e.bestLeftAtPosition.Last}` : "",
    leftRank: e.bestLeftAtPosition?.rank || "",
    needLabel: e.need?.label || "", needPos: e.need ? needWord(e.need.key) : "", needNote: e.need?.note || "",
    ...passedVars(e.passedNeed),
    ...staffVars(ctx.staff?.[e.team]),
  };
}

// The big need a pick passed on (engine passedNeedFor) → its variables.
function passedVars(passed) {
  if (!passed) return { passed: "", aPassed: "", passes: "" };
  const word = needWord(passed.key);
  return { passed: word, aPassed: `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`, passes: passed.times + 1 };
}

// Passing on a big need: "passedNeed" the first time, "stillNoNeed" after.
const passedCat = (e) => (e.passedNeed.times ? "stillNoNeed" : "passedNeed");

// Every CFBD stat fact for a pick (Dr. PP Johnson): [{ cat, vars, weight, group }].
export function statFacts(e, ctx) {
  const p = e.prospect;
  const base = pickVars(e, ctx);
  const out = [];
  // At most one leaderboard line and one season line per post.
  const GROUP = { leaderFirst: "leader", leaderRanked: "leader", receiving: "line2" };
  const add = (cat, weight, extra = {}) => out.push({ cat, weight, group: GROUP[cat] || "line", vars: { ...base, ...extra } });

  // National leaderboards (CFBD season totals).
  const leaders = (p.stats?.leaders || []).filter((l) => STAT_LABEL[l.key]).sort((a, b) => a.rank - b.rank);
  const top = leaders[0];
  if (top && top.rank === 1 && !top.tied) add("leaderFirst", 4, { value: fmt(top.v), stat: STAT_LABEL[top.key], statTitle: top.title });
  else if (top && top.rank <= 25) {
    add("leaderRanked", top.rank <= 10 ? 3 : 2, {
      value: fmt(top.v), stat: STAT_LABEL[top.key], statTitle: top.title, rankOrd: top.tied ? `tied for ${ordinal(top.rank)}` : ordinal(top.rank),
    });
  }

  // Season stat line for his position.
  const lines = p.stats?.lines || {};
  // A stat CFBD leaves out of a line is a zero (no INTs → no INT key).
  const ZERO = { passing: ["TD", "INT"], rushing: ["TD"], receiving: ["TD"], defensive: ["TFL", "SACKS", "QB HUR", "PD", "INT"] };
  const line = (g) => ({
    ...Object.fromEntries((ZERO[g] || []).map((k) => [k, 0])),
    ...Object.fromEntries(Object.entries(lines[g] || {}).map(([k, v]) => [k, k === "PCT" ? fmt(v * 100) : fmt(v)])),
  });
  if (p.Position === "QB" && (lines.passing?.ATT || 0) >= 50) add("passing", 1.4, line("passing"));
  else if (["QB", "RB"].includes(p.Position) && (lines.rushing?.CAR || 0) >= 30) add("rushing", 1.4, line("rushing"));
  if (["WR", "TE", "RB"].includes(p.Position) && (lines.receiving?.REC || 0) >= 12) add("receiving", 1.3, line("receiving"));
  if (p.Position === "DB" && (lines.defensive?.TOT || 0) >= 10) add("coverage", 1.3, line("defensive"));
  else if (["DL", "EDGE", "LB"].includes(p.Position) && (lines.defensive?.TOT || 0) >= 10) add("defensive", 1.3, line("defensive"));
  return out;
}

// Every We-Draft.com fact that applies to a pick, after its board rank:
// [{ cat, vars, weight, group }].
export function weDraftFacts(e, ctx) {
  const p = e.prospect;
  const base = pickVars(e, ctx);
  const out = [];
  const GROUP = { traitsBoth: "traits", traitsStrength: "traits", posRankTop: "rank", posRank: "rank" };
  const add = (cat, weight, extra = {}) => out.push({ cat, weight, group: GROUP[cat] || cat, vars: { ...base, ...extra } });

  if (e.pick.overall === 1) add("firstOverall", 6);

  // What the community says.
  if (base.strength && base.weakness) add("traitsBoth", 2.6);
  else if (base.strength && base.strength2) add("traitsStrength", 1.8);
  if (p.positionRank === 1) add("posRankTop", 2.4);
  else if (p.positionRank && p.positionRank <= 15) add("posRank", p.positionRank <= 5 ? 2 : 1.2);
  // (Not on My Board's own grades — the line quotes the community's.)
  if (base.grade && p.count >= 3 && !p.mine) add("grade", 0.9);

  // Board value, staff fit, runs.
  if (e.value >= Math.max(5, e.pick.overall * 0.2)) add("value", 2.2);
  if (-e.value >= Math.max(8, e.pick.overall * 0.3)) add("reach", 2.2);
  if (base.fitWord && base.staffer) add("staffFit", (e.fit?.s || 0) >= 80 ? 2.4 : 1.4);
  if (e.positionRun >= 3 && base.leftName) add("run", 2);
  return out;
}

// Weighted pick of up to `n` facts, all different situations.
function chooseFacts(facts, n, rand) {
  const pool = [...facts];
  const chosen = [];
  while (chosen.length < n && pool.length) {
    const total = pool.reduce((a, f) => a + f.weight, 0);
    let r = rand() * total;
    const i = pool.findIndex((f) => { r -= f.weight; return r <= 0; });
    const pick = pool.splice(i < 0 ? 0 : i, 1)[0];
    chosen.push(pick);
    for (let j = pool.length - 1; j >= 0; j -= 1) if (pool[j].group === pick.group) pool.splice(j, 1);
  }
  return chosen;
}

function weDraftPick(e, ctx) {
  const p = e.prospect;
  const title = `PICK ${e.pick.overall} · ${e.team} — ${p.First} ${p.Last}, ${p.Position}, ${p.School || "—"}`;
  const rank = p.rank ? lineFrom(WEDRAFT_LINES, "boardRank", pickVars(e, ctx), ctx, "wedraft") : null;
  const facts = chooseFacts(weDraftFacts(e, ctx), 1, ctx.rand).map((f) => lineFrom(WEDRAFT_LINES, f.cat, f.vars, ctx, "wedraft"));
  return { text: title, lines: [rank, ...facts].filter(Boolean) };
}

function ppPick(e, ctx) {
  const facts = statFacts(e, ctx);
  if (!facts.length) return null;
  const lines = chooseFacts(facts, 2, ctx.rand).map((f) => lineFrom(PP_LINES, f.cat, f.vars, ctx, "pp")).filter(Boolean);
  return { text: lineFrom(PP_LINES, "intro", pickVars(e, ctx), ctx, "pp"), lines };
}

const isRutgers = (p) => /rutgers/i.test(p?.School || "");

function makaliPick(e, ctx) {
  // Traded up for him: the trade and the pick, one take.
  const up = tradeUpVars(e, ctx);
  if (up) return { text: lineFrom(MAKALI_LINES, "tradeUp", { ...pickVars(e, ctx), ...up }, ctx, "makali") };
  const rutgers = isRutgers(e.prospect);
  const eagles = e.team === "PHI";
  let cat;
  if (rutgers && eagles) cat = "rutgersEagles";
  else if (rutgers) cat = "rutgers";
  else if (eagles) cat = "eagles";
  else if (shockOf(e)) cat = shockOf(e);
  else if (e.passedNeed && ctx.rand() < 0.5) cat = passedCat(e);
  else if (e.need && !["Depth Needed", "Crowded Room"].includes(e.need.label) && ctx.rand() < 0.4) cat = "needMet";
  else if (e.prospect.Position === "QB" && e.pick.round <= 2) cat = "qb";
  else if (e.value >= Math.max(6, e.pick.overall * 0.25)) cat = "steal";
  else if (-e.value >= Math.max(6, e.pick.overall * 0.25)) cat = "reach";
  else cat = "any";
  return { text: lineFrom(MAKALI_LINES, cat, pickVars(e, ctx), ctx, "makali") };
}

function davinPick(e, ctx) {
  const p = e.prospect;
  const v = pickVars(e, ctx);
  let cat;
  let legend = "";
  // Traded up for him: the trade and the pick, one take.
  const up = tradeUpVars(e, ctx);
  if (up) return { text: lineFrom(DAVIN_LINES, "tradeUp", { ...v, ...up, legend: favoriteFor(p.Position, ctx) }, ctx, "davin") };
  if (isFsu(p)) {
    cat = ctx.rand() < 0.4 ? "fsuLegend" : "fsu";
    if (cat === "fsuLegend") legend = p.Position === "QB" ? "Jameis Winston" : favoriteFor(p.Position, ctx);
  } else if (shockOf(e)) cat = shockOf(e);
  else if (e.passedNeed && ctx.rand() < 0.5) cat = passedCat(e);
  else if (e.need?.label === "Crowded Room" && ctx.rand() < 0.6) cat = "crowded";
  else if (e.pick.round === 1 && ["QB", "WR", "DB"].includes(p.Position) && ctx.rand() < 0.5) cat = "fullback";
  else if (e.value >= 0 && ctx.rand() < 0.5) { legend = favoriteFor(p.Position, ctx); cat = "legend"; }
  else cat = ctx.rand() < 0.25 ? "nonsense" : "take";
  // {legend} works in every Davin line — a favorite at the position.
  return { text: lineFrom(DAVIN_LINES, cat, { ...v, legend: legend || favoriteFor(p.Position, ctx) }, ctx, "davin") };
}

// Thad's history books (ctx.history: draftHistory.json, loaded with the
// sim's data): every pick as { year, round, overall, team, pos, school,
// name }, by school, team and position, plus each draft's first-round
// counts by position and by school. Built once.
const historyIndex = new WeakMap();
function historyOf(ctx) {
  const h = ctx.history;
  if (!h?.picks) return null;
  if (!historyIndex.has(h)) {
    const rows = h.picks.map(([year, round, overall, t, pos, s, name]) => ({ year, round, overall, team: h.teams[t], pos, school: h.schools[s], name }));
    const by = (key) => rows.reduce((m, r) => { (m[r[key]] || (m[r[key]] = [])).push(r); return m; }, {});
    // { [year]: { [position or school]: picks in those rounds } }.
    const countIn = (key, rounds) => rows.filter((r) => rounds.includes(r.round)).reduce((m, r) => {
      const y = m[r.year] || (m[r.year] = {});
      y[r[key]] = (y[r[key]] || 0) + 1;
      return m;
    }, {});
    historyIndex.set(h, {
      bySchool: by("school"), byTeam: by("team"), byPos: by("pos"), round1ByPos: countIn("pos", [1]), round1BySchool: countIn("school", [1]),
      day2ByPos: countIn("pos", [2, 3]), day2BySchool: countIn("school", [2, 3]),
      firstYear: h.years[0], staff: h.staff || {}, mascots: h.mascots || {},
      firstOverall: (h.firstOverall || []).map(([year, team, pos, school, name]) => ({ year, round: 1, overall: 1, team, pos, school, name })),
    });
  }
  return historyIndex.get(h);
}

// This sim's picks so far, for Thad (reactTo records each one).
function recordPick(e, ctx) {
  if (e.type !== "pick" || !ctx.history) return;
  const memory = ctx.memory || (ctx.memory = {});
  (memory.drafted || (memory.drafted = [])).push({
    year: Number(ctx.year), round: e.pick.round, overall: e.pick.overall, team: e.team, pos: e.prospect.Position,
    school: e.prospect.School || "", name: `${e.prospect.First} ${e.prospect.Last}`, sim: true,
  });
}

// The most recent of some picks (latest draft, then latest pick in it).
const latest = (rows) => rows.reduce((a, r) => (!a || r.year > a.year || (r.year === a.year && r.overall > a.overall) ? r : a), null);

// Every history fact for a pick (Thad Murphy): [{ cat, vars, weight, group }]
// — at most one per group in a post. Cached on the event (his weight and
// his post both need them).
const thadCache = new WeakMap();
export function thadFacts(e, ctx) {
  if (e.type !== "pick") return [];
  if (thadCache.has(e)) return thadCache.get(e);
  const out = [];
  thadCache.set(e, out);
  const H = historyOf(ctx);
  if (!H) return out;
  const p = e.prospect;
  const year = Number(ctx.year);
  const { round, overall: n } = e.pick;
  const pos = p.Position;
  const school = p.School || "";
  // Day 2: rounds two and three, which get the first-round facts too.
  const isDay2 = (r) => r.round === 2 || r.round === 3;
  const day2 = isDay2(e.pick);
  // Earlier drafts' picks matching f, then this sim's before this one.
  const sim = (ctx.memory?.drafted || []).filter((r) => r.overall < n);
  const where = (rows, f) => [...(rows || []).filter((r) => r.year < year && f(r)), ...sim.filter(f)];
  const ago = (r) => year - r.year;
  const prevVars = (r) => ({ prev: r.name, prevYear: r.year, prevN: r.overall, prevRound: r.round, prevNick: ctx.nickname ? ctx.nickname(r.team) : r.team });
  // {mascot} is blank for a school without one on file, so lines using it
  // step aside for the ones naming the school (lineFrom).
  const base = { ...pickVars(e, ctx), firstYear: H.firstYear, mascot: H.mascots[school] || "", schoolPoss: possessive(school) };
  const add = (cat, weight, group, extra = {}) => out.push({ cat, weight, group, vars: { ...base, ...extra } });
  // Earlier first-rounders as a list, newest first, four named and the rest
  // counted ("Bo Nix, Justin Herbert and Marcus Mariota") — two or more,
  // else null.
  const clubOf = (rows) => {
    if (rows.length < 2) return null;
    const sorted = [...rows].sort((a, b) => b.year - a.year || b.overall - a.overall);
    // Four named, the rest counted — but never "and 1 other": five, all named.
    const names = sorted.slice(0, sorted.length === 5 ? 5 : 4).map((r) => r.name);
    const others = sorted.length - names.length;
    const club = others ? `${names.join(", ")} and ${others} other${others === 1 ? "" : "s"}` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return { ...prevVars(sorted[0]), club, times: sorted.length + 1, timesOrd: ordinal(sorted.length + 1) };
  };

  // The No. 1 pick: the last first overall pick at his position, and from
  // his school (1970 on) — only when there's one to name.
  if (n === 1) {
    const before = H.firstOverall.filter((r) => r.year < year);
    const lastPos = latest(before.filter((r) => r.pos === pos));
    if (lastPos && ago(lastPos) >= 2) add("firstOverallPos", 5, "firstOverall", prevVars(lastPos));
    const lastSchool = school && latest(before.filter((r) => r.school === school));
    if (lastSchool) add("firstOverallSchool", 5, "firstOverall2", prevVars(lastSchool));
  }

  if (school) {
    // The school at the position: in round one, and how high.
    const schoolPos = where(H.bySchool[school], (r) => r.school === school && r.pos === pos);
    if (round === 1) {
      const last = latest(schoolPos.filter((r) => r.round === 1));
      if (last && ago(last) >= 3) add("schoolPosRound1", 3 + Math.min(3, ago(last) / 5), "schoolPos", prevVars(last));
      // "joins Bo Nix and Justin Herbert".
      const club = clubOf(schoolPos.filter((r) => r.round === 1));
      if (club) add("schoolPosClub", 3.2, "schoolPos", club);
    } else if (day2) {
      const last = latest(schoolPos.filter(isDay2));
      if (last && ago(last) >= 4) add("schoolPosDay2", 2.5 + Math.min(3, ago(last) / 5), "schoolPos", prevVars(last));
      const club = clubOf(schoolPos.filter(isDay2));
      if (club) add("schoolPosDay2Club", 2.6, "schoolPos", club);
    }
    const higher = schoolPos.filter((r) => r.overall <= n);
    if (schoolPos.length >= 2 && !higher.length) {
      add("schoolPosHighest", 3.5, "schoolPos2", prevVars(schoolPos.reduce((a, r) => (r.overall < a.overall ? r : a))));
    } else if (higher.length && ago(latest(higher)) >= 6 && n <= 100) {
      add("schoolPosHighestSince", 2.5, "schoolPos2", prevVars(latest(higher)));
    }
    // The school in round one at all.
    if (round === 1) {
      const last = latest(where(H.bySchool[school], (r) => r.school === school && r.round === 1));
      if (last && ago(last) >= 8) add("schoolRound1", 2.5, "school", prevVars(last));
    } else if (day2) {
      const last = latest(where(H.bySchool[school], (r) => r.school === school && isDay2(r)));
      if (last && ago(last) >= 8) add("schoolDay2", 2.5, "school", prevVars(last));
    }
    // The team and the school.
    const teamSchool = where(H.byTeam[e.team], (r) => r.team === e.team && r.school === school);
    const last = latest(teamSchool.filter((r) => r.pos === pos));
    if (last?.sim) add("teamSchoolPosAgain", 3, "teamSchool", prevVars(last));
    else if (last) add("teamSchoolPos", 2.5 + (ago(last) >= 8 ? 1 : 0), "teamSchool", prevVars(last));
    if (teamSchool.length >= 3) {
      add("teamSchool", 1.2, "teamSchool2", { ...prevVars(latest(teamSchool)), times: teamSchool.length + 1, timesOrd: ordinal(teamSchool.length + 1) });
    }
  }

  // The team at the position in round one: a drought, or the club.
  if (round === 1) {
    const firsts = where(H.byTeam[e.team], (r) => r.team === e.team && r.pos === pos && r.round === 1);
    const last = latest(firsts);
    if (last && !last.sim && ago(last) >= 4) add("teamPosRound1", 3 + Math.min(2, ago(last) / 6), "teamPos", prevVars(last));
    const club = clubOf(firsts);
    if (club) add("teamPosClub", 3, "teamPos", club);
  } else if (day2) {
    const picks = where(H.byTeam[e.team], (r) => r.team === e.team && r.pos === pos && isDay2(r));
    const last = latest(picks);
    if (last && !last.sim && ago(last) >= 5) add("teamPosDay2", 2.5 + Math.min(2, ago(last) / 6), "teamPos", prevVars(last));
    const club = clubOf(picks);
    if (club) add("teamPosDay2Club", 2.4, "teamPos", club);
  }

  // The last earlier draft whose first round had at least `times` of one
  // position (key) or from any one school (no key) → { year, count, key }.
  const lastWith = (by, times, key) => {
    const years = Object.keys(by).map(Number).filter((y) => y < year).sort((a, b) => b - a);
    for (const y of years) {
      const top = Object.entries(key ? { [key]: by[y][key] || 0 } : by[y]).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] >= times) return { year: y, count: top[1], key: top[0] };
    }
    return null;
  };

  // The school's run in this draft.
  if (school) {
    const tonight = sim.filter((r) => r.school === school);
    if (round === 1) {
      const times = tonight.filter((r) => r.round === 1).length + 1;
      if (times >= 2) add("schoolRunRound1", times >= 3 ? 3 : 1.5, "schoolRun", { times, timesOrd: ordinal(times) });
      if (times >= 3) {
        const record = lastWith(H.round1BySchool, times);
        if (record && year - record.year >= 2) add("schoolRunRecord", 3.5, "schoolRun2", { times, prevYear: record.year, recordSchool: record.key, recordTimes: record.count });
      }
    } else if (day2 && tonight.filter(isDay2).length + 1 >= 3) {
      const times = tonight.filter(isDay2).length + 1;
      add("schoolRunDay2", times >= 4 ? 2.5 : 1.5, "schoolRun", { times, timesOrd: ordinal(times) });
      const record = lastWith(H.day2BySchool, times);
      if (record && year - record.year >= 2) add("schoolRunDay2Record", 3, "schoolRun2", { times, prevYear: record.year, recordSchool: record.key, recordTimes: record.count });
    } else if (tonight.length + 1 >= 4) {
      const times = tonight.length + 1;
      add("schoolRun", times >= 7 ? 2.2 : 1.2, "schoolRun", { times, timesOrd: ordinal(times) });
    }
  }

  // The position's first-rounders in this draft, against past first rounds.
  if (round === 1) {
    const times = sim.filter((r) => r.round === 1 && r.pos === pos).length + 1;
    if (times >= 3) {
      const record = lastWith(H.round1ByPos, times, pos);
      if (record && year - record.year >= 3) add("posRound1Count", 3, "posCount", { times, timesOrd: ordinal(times), prevYear: record.year, recordTimes: record.count });
    }
  } else if (day2) {
    const times = sim.filter((r) => isDay2(r) && r.pos === pos).length + 1;
    if (times >= 5) {
      const record = lastWith(H.day2ByPos, times, pos);
      if (record && year - record.year >= 3) add("posDay2Count", 2.6, "posCount", { times, timesOrd: ordinal(times), prevYear: record.year, recordTimes: record.count });
    }
  }

  // The position across the league, in past drafts.
  if (n <= 64) {
    const last = latest((H.byPos[pos] || []).filter((r) => r.year < year && r.overall <= n));
    if (last && ago(last) >= 4) add("posHighest", 3, "pos", prevVars(last));
  }

  // The GM's and head coach's own record since taking the job (one of
  // them per kind of fact in a post — they often started together).
  const staff = ctx.staff?.[e.team] || {};
  // Full names in every staff line ({seatLast} is there for admin-written ones).
  const seatVars = (who, seat) => ({ seatName: who.n, seatLast: lastName(who.n), seatPoss: possessive(who.n), seatTitle: SLOT_TITLE[seat] });
  ["GM", "HC"].forEach((seat) => {
    const who = staff[seat];
    const since = who?.id && H.staff[who.id]?.since?.[seat];
    if (!since || since.team !== e.team || since.draft > year) return;
    // In the job before his records start (Jerry Jones, 1989): counted from
    // {firstYear}, and the lines say so ("…Long").
    const long = since.draft < H.firstYear;
    const from = Math.max(since.draft, H.firstYear);
    const vars = { ...seatVars(who, seat), seatSince: since.draft, drafts: year - from + 1 };
    const tenure = where(H.byTeam[e.team], (r) => r.team === e.team && r.year >= from);
    if (since.draft === year && !tenure.length) add("staffFirstPick", 3, "staff", vars);
    // "First first-round edge rusher since taking over" only means something
    // a few drafts in — not in their first or second — and not for a long
    // tenure, where it's just the team's own first-round drought.
    else if (!long && round === 1 && vars.drafts >= 3 && !tenure.some((r) => r.pos === pos && r.round === 1)) add("staffRound1Pos", 2.2, "staff", vars);
    else if (!long && day2 && vars.drafts >= 3 && !tenure.some((r) => r.pos === pos && isDay2(r))) add("staffDay2Pos", 2, "staff", vars);
    const atPos = tenure.filter((r) => r.pos === pos).length;
    if (atPos >= 2) add(long ? "staffPosLong" : "staffPos", 1.2, "staffPos", { ...vars, times: atPos + 1, timesOrd: ordinal(atPos + 1) });
    const fromSchool = school ? tenure.filter((r) => r.school === school).length : 0;
    if (fromSchool >= 2) add(long ? "staffSchoolLong" : "staffSchool", 1.5, "staffSchool", { ...vars, times: fromSchool + 1 });
  });
  // Any staffer's alma mater.
  const alma = school && ["GM", "HC", "OC", "DC"].find((seat) => staff[seat]?.id && H.staff[staff[seat].id]?.college === school);
  if (alma) add("almaMater", 4, "alma", seatVars(staff[alma], alma));
  return out;
}

// Thad's post: one fact, one short tweet — no sub-points.
function thadPick(e, ctx) {
  const facts = thadFacts(e, ctx);
  if (!facts.length) return null;
  const [fact] = chooseFacts(facts, 1, ctx.rand);
  const text = lineFrom(THAD_LINES, fact.cat, fact.vars, ctx, "thad");
  return text ? { text } : null;
}

// The standout CFBD game Isaac can bring up ({ line, opp }), when the sim
// has loaded one for this player (ctx.games — see useDraftSim.js).
const gameFor = (e, ctx) => ctx.games?.[e.prospect.id] || null;

function tradeVars(e, ctx) {
  return {
    to: e.to, from: e.from, toNick: ctx.nickname(e.to), fromNick: ctx.nickname(e.from), fromCity: cityOf(ctx, e.from), n: e.pick.overall,
    got: e.give.map(pickName).join(" + "), pct: Math.round(e.ratio * 100),
    teamName: ctx.teamName(e.to), city: cityOf(ctx, e.to), nick: ctx.nickname(e.to), team: e.to, year: ctx.year || "",
    ...staffVars(ctx.staff?.[e.to]), ...staffVars(ctx.staff?.[e.from], "from"),
  };
}

function weDraftTrade(e, ctx) {
  return { text: `TRADE · The ${ctx.nickname(e.to)} move up to ${pickName(e.pick)} with the ${ctx.nickname(e.from)}`, lines: [lineFrom(WEDRAFT_LINES, "trade", tradeVars(e, ctx), ctx, "wedraft")] };
}

// A shock: a pick SHOCK_SPOTS[round] or more off his board rank — 10 in
// round 1, 25 on Day 2 (rounds 2–3) → "shockSteal" (he slid) /
// "shockReach" (he went early), else null. It overrules the smaller steal
// and reach takes; the desk always reacts, with Isaac, Makali or Davin (or
// Kenneth's take).
export const SHOCK_SPOTS = { 1: 10, 2: 25, 3: 25 };
export function shockOf(e) {
  const spots = e?.type === "pick" && SHOCK_SPOTS[e.pick.round];
  if (!spots) return null;
  if (e.value >= spots) return "shockSteal";
  if (-e.value >= spots) return "shockReach";
  return null;
}

// Should a personality speak up on this event? Never on a trade by itself —
// a trade up is told with the pick it bought (tradeUp lines), one post.
// Always on a shock (unless it's "My picks only" and not theirs).
function chimesIn(e, ctx) {
  if (e.type === "trade") return false;
  if (e.isUser || e.userInvolved) return true;
  const mode = ctx.chatter || DEFAULT_CHATTER;
  if (mode === "mine") return false;
  if (mode === "all" || shockOf(e)) return true;
  if (e.pick.overall === 1) return true;
  const notable = (e.prospect.Position === "QB" && e.pick.round <= 2) || Math.abs(e.value) >= Math.max(8, e.pick.overall * 0.3);
  return ctx.rand() < (notable ? 0.45 : e.pick.round === 1 ? 0.15 : 0.06);
}

// A pick that protects (OL) or arms (WR / TE) the QB the team took in
// round 1 → "qbProtect" / "qbWeapon", else null.
function qbSupport(e) {
  if (!e.rookieQb) return null;
  if (e.prospect.Position === "OL") return "qbProtect";
  if (["WR", "TE"].includes(e.prospect.Position)) return "qbWeapon";
  return null;
}

// The pick a team just traded up into → its trade variables (from tradeUp,
// engine acceptOffer / applyProposal), or null.
function tradeUpVars(e, ctx) {
  const t = e.pick.tradeUp;
  if (!t) return null;
  return { fromNick: ctx.nickname(t.from), fromCity: cityOf(ctx, t.from), from: t.from, to: e.team, toNick: ctx.nickname(e.team), got: (t.give || []).filter(Boolean).map(pickName).join(" + ") };
}

function isaacPick(e, ctx) {
  const v = pickVars(e, ctx);
  // Traded up for him: the trade and the pick, one take.
  const up = tradeUpVars(e, ctx);
  if (up) {
    const cat = e.value >= Math.max(6, e.pick.overall * 0.25) ? "tradeUpValue" : -e.value >= Math.max(6, e.pick.overall * 0.25) ? "tradeUpReach" : "tradeUp";
    return { text: lineFrom(ISAAC_LINES, cat, { ...v, ...up }, ctx, "isaac") };
  }
  // A shock — over the smaller steal / reach takes (No. 1's surprise has its own lines below).
  const shock = shockOf(e);
  if (shock && e.pick.overall !== 1) return { text: lineFrom(ISAAC_LINES, shock, v, ctx, "isaac") };
  // Passed on a big need for a lesser one.
  if (e.passedNeed && e.pick.overall !== 1 && ctx.rand() < 0.8) return { text: lineFrom(ISAAC_LINES, passedCat(e), v, ctx, "isaac") };
  // A blocker or a target for the QB they took in round 1.
  const qbCat = qbSupport(e);
  if (qbCat && ctx.rand() < 0.75) {
    return { text: lineFrom(ISAAC_LINES, qbCat, { ...v, qb: `${e.rookieQb.First} ${e.rookieQb.Last}`, qbLast: e.rookieQb.Last }, ctx, "isaac") };
  }
  let cat;
  const need = e.need?.label;
  if (e.pick.overall === 1) cat = e.prospect.rank > 3 ? "firstSurprise" : "firstOverall";
  else if (need === "Aging Talent" && ctx.rand() < 0.7) cat = "heir";
  else if (need === "Crowded Room" && ctx.rand() < 0.7) cat = "crowded";
  else if (e.prospect.Position === "QB" && e.pick.round <= 2) cat = "qb";
  else if (e.value >= Math.max(6, e.pick.overall * 0.25)) cat = "steal";
  else if (-e.value >= Math.max(15, e.pick.overall * 0.6)) cat = "bigReach";
  else if (-e.value >= Math.max(6, e.pick.overall * 0.25)) cat = "reach";
  else if (need === "Upgrade Needed" && ctx.rand() < 0.5) cat = "needMet";
  else if ((e.fit?.s || 0) >= 80) cat = "fit";
  else if (e.positionRun >= 3) cat = "run";
  else cat = "value";
  const game = gameFor(e, ctx);
  if (game && e.pick.overall !== 1 && !["qb", "bigReach", "heir", "crowded"].includes(cat) && ctx.rand() < 0.6) {
    return { text: lineFrom(ISAAC_LINES, "game", { ...v, gameLine: game.line, opp: game.opp }, ctx, "isaac") };
  }
  return { text: lineFrom(ISAAC_LINES, cat, v, ctx, "isaac") };
}

// ── Kenneth Cold: the player takes ──
// His own analysis of each player, written per player in Admin → Mock
// Draft → Personalities (config/draftSimAnalysis.players: { [playerId]:
// { reach: [line, …], steal, normal, depth } }). Which situation a pick is
// uses Isaac's steal/reach thresholds; a depth pick is one the team's needs
// call "Depth Needed". A situation with no lines of its own uses the
// player's normal lines; a player with none at all gets no Kenneth.
// Lines take the same {variables} as everyone else's.
export const PLAYER_TAKES = {
  reach: { label: "Reach", when: "Taken well before his board rank." },
  steal: { label: "Steal", when: "Taken well after his board rank." },
  depth: { label: "Depth pick", when: "The team's need at his position is Depth Needed (and he isn't a reach or steal)." },
  normal: { label: "Normal", when: "Every other pick — and any situation above that has no lines of its own." },
};
let playerTakes = {};
export function applyPlayerTakes(players = {}) { playerTakes = players || {}; }
export const playerTakesFor = (id) => playerTakes[id] || {};

export function takeSituation(e) {
  if (e.value >= Math.max(6, e.pick.overall * 0.25)) return "steal";
  if (-e.value >= Math.max(6, e.pick.overall * 0.25)) return "reach";
  if (e.need?.label === "Depth Needed") return "depth";
  return "normal";
}

// The situation whose lines he'd use for this pick, or null (nothing written).
function takeFor(e) {
  const takes = playerTakesFor(e.prospect.id);
  const has = (cat) => (takes[cat] || []).some((l) => lineText(l).trim());
  const cat = takeSituation(e);
  return has(cat) ? cat : has("normal") ? "normal" : null;
}

function kennethPick(e, ctx) {
  const cat = takeFor(e);
  if (!cat) return null;
  const table = { [cat]: { lines: playerTakesFor(e.prospect.id)[cat].filter((l) => lineText(l).trim()) } };
  const text = lineFrom(table, cat, pickVars(e, ctx), ctx, `kenneth:${e.prospect.id}`);
  return text ? { text } : null;
}

// Each personality: react(event, ctx) → its take ({ text, lines? } or
// null), and weight(event, ctx) → how likely it is to be the one voice
// after We-Draft.com (0 = not this time).
export const ANALYSTS = [
  {
    id: "wedraft", name: "We-Draft.com", handle: "@WeDraftSite", role: "Draft Desk", verified: true, enabled: true,
    color: "#0055a5", avatar: "/wd-icon.png", delay: 300, lines: WEDRAFT_LINES,
    about: "Announces every pick with its We-Draft.com board rank, plus one fact: community strengths and concerns, position rank, value or reach, staff fit, position runs.",
    cadence: "Every pick and trade.",
    react: (e, ctx) => (e.type === "pick" ? weDraftPick(e, ctx) : e.type === "trade" ? weDraftTrade(e, ctx) : null),
  },
  {
    id: "isaac", name: "Isaac Walker", handle: "@IsaacWalker", role: "Draft Analyst", verified: true, enabled: true,
    color: "#14a3a3", initials: "IW", delay: 1300, lines: ISAAC_LINES,
    about: "Opinions — steals, reaches, quarterbacks, staff fits, the CFBD game that put a player on his radar, trades up, and your final grade.",
    cadence: "Most likely on a shock (10+ spots off the board in round 1, 25+ on Day 2) and the other headline picks: No. 1, QBs, steals, reaches, big games, a blocker or target for a team's first-round QB, a team passing on a big need (more so the second time), and a team trading up — told with the pick.",
    weight: (e) => {
      if (e.type !== "pick") return 0;
      if (e.pick.overall === 1) return 100;
      if (e.pick.tradeUp) return 8;
      if (shockOf(e)) return 10;
      // Passing on a big need — louder each time they do.
      if (e.passedNeed) return e.passedNeed.times ? 6 : 4;
      if (qbSupport(e)) return 4;
      const notable = (e.prospect.Position === "QB" && e.pick.round <= 2) || Math.abs(e.value) >= Math.max(6, e.pick.overall * 0.25);
      return notable ? 3 : 1.3;
    },
    react: (e, ctx) => (e.type === "pick" ? isaacPick(e, ctx) : null),
  },
  {
    id: "kenneth", name: "Kenneth Cold", handle: "@kingcoldsports", role: "Player Analyst", verified: true, enabled: true,
    color: "#f6a21d", initials: "KC", delay: 1300, lines: {},
    about: "The player guy — his own written analysis of the player just drafted, with different takes for a reach, a steal, a depth pick and a normal pick.",
    cadence: "Picks of players he has a take written for (Player analysis below); never on trades, or a pick a team traded up for (his takes don't tell the trade).",
    weight: (e) => (e.type === "pick" && e.pick.overall !== 1 && !e.pick.tradeUp && takeFor(e) ? 4 : 0),
    react: (e, ctx) => (e.type === "pick" ? kennethPick(e, ctx) : null),
  },
  {
    id: "pp", name: "Dr. PP Johnson", handle: "@DrPPJohnson", role: "Stats", verified: true, enabled: true,
    color: "#2e9e5b", initials: "PJ", delay: 1300, lines: PP_LINES,
    about: "The stat guy. Reads out the drafted player's CFBD numbers — his season line and where he ranks nationally.",
    cadence: "Picks with a real stat line this season; most likely when the player ranks nationally. Not a pick a team traded up for, or a shock (his stat lines don't tell either).",
    weight: (e, ctx) => {
      // Not on a traded-up pick or a shock — his numbers don't tell either.
      if (e.type !== "pick" || e.pick.tradeUp || shockOf(e)) return 0;
      const facts = statFacts(e, ctx);
      return facts.some((f) => f.group === "leader") ? 2.5 : facts.length ? 1.3 : 0;
    },
    react: (e, ctx) => (e.type === "pick" ? ppPick(e, ctx) : null),
  },
  {
    id: "makali", name: "Makali Pennycooke", handle: "@timeoutwithmakalipod", role: "Optimist", verified: true, enabled: true,
    color: "#cc0033", initials: "MP", delay: 1300, lines: MAKALI_LINES, noRepeat: true,
    about: "Loves every pick and thinks every player is going to be great — Rutgers players and Eagles picks most of all.",
    cadence: "Any pick, a team trading up told with the pick; almost always on Rutgers players and Eagles picks.",
    weight: (e) => {
      if (e.type !== "pick") return 0;
      return isRutgers(e.prospect) || e.team === "PHI" ? 14 : shockOf(e) ? 2 : 1;
    },
    react: (e, ctx) => (e.type === "pick" ? makaliPick(e, ctx) : null),
  },
  {
    id: "davin", name: "davin mcgavitt", handle: "@davinmcgavitt", role: "The Jester", verified: false, enabled: true,
    color: "#7a3cff", initials: "DM", delay: 1300, lines: DAVIN_LINES, noRepeat: true,
    about: "The desk's jester — a joke. Mostly negative, distracted by cheeseburgers, misses first-round fullbacks, loves Florida State players, and measures good picks against his favorite players (FSU greats, movie and TV football players).",
    cadence: "Any pick, a team trading up told with the pick; almost always on FSU players.",
    weight: (e) => {
      if (e.type !== "pick") return 0;
      if (isFsu(e.prospect)) return 14;
      if (shockOf(e)) return 2;
      if (e.pick.round === 1 && ["QB", "WR", "DB"].includes(e.prospect.Position)) return 1.6;
      return 0.9;
    },
    react: (e, ctx) => (e.type === "pick" ? davinPick(e, ctx) : null),
  },
  {
    id: "thad", name: "Thad Murphy", handle: "@ThadMurphy", role: "Draft Historian", verified: true, enabled: true,
    color: "#a0662b", initials: "TM", delay: 1300, lines: THAD_LINES, noRepeat: true,
    about: "The history books — every NFL pick since 2000 plus this sim's: first-round droughts for a school or team at a position, the last player a team took from that school, the highest one's gone in years, a school's run of first-rounders tonight, the most at a position in a first round in years, the GM's and head coach's record since taking the job, and alma-mater picks. Day 2 (rounds two and three) gets its own version of the first-round facts.",
    cadence: "Picks with real history behind them; most likely on a first or a long drought. Never on trades or a shock (10+ spots off the board in round 1 after No. 1, 25+ on Day 2).",
    weight: (e, ctx) => {
      // Not on a shock (after No. 1) — the desk reacts to the shock.
      if (e.type !== "pick" || (shockOf(e) && e.pick.overall !== 1)) return 0;
      const facts = thadFacts(e, ctx);
      // No. 1 with a first-overall fact: an even split with Isaac (100).
      if (facts.some((f) => f.group.startsWith("firstOverall"))) return 100;
      const top = Math.max(0, ...facts.map((f) => f.weight));
      return top >= 3.5 ? 5 : top >= 2.5 ? 2.5 : top > 0 ? 1 : 0;
    },
    react: (e, ctx) => (e.type === "pick" ? thadPick(e, ctx) : null),
  },
];

export const LIVE_ANALYSTS = ANALYSTS.filter((a) => a.enabled);
const byId = (id) => ANALYSTS.find((a) => a.id === id);

// The one personality after We-Draft.com: weighted by the pick, and
// whoever spoke last is much less likely to go again — never, for one
// marked noRepeat (Makali, Davin, Thad).
// A personality's code (or an admin-edited line, or missing data) failing
// costs that one post, never the draft: logged, and null.
function guarded(label, fn, fallback = null) {
  try {
    return fn();
  } catch (err) {
    console.error(`Draft sim desk: ${label} failed`, err);
    return fallback;
  }
}

function choosePersonality(e, ctx, skip = new Set()) {
  const memory = ctx.memory || (ctx.memory = {});
  const pool = LIVE_ANALYSTS.filter((a) => a.weight && !skip.has(a.id))
    .map((a) => ({ a, w: (Number(guarded(`${a.id} weight`, () => a.weight(e, ctx), 0)) || 0) * (memory.lastVoice === a.id ? (a.noRepeat ? 0 : 0.35) : 1) }))
    .filter((x) => x.w > 0);
  const total = pool.reduce((t, x) => t + x.w, 0);
  let r = ctx.rand() * total;
  const hit = pool.find((x) => { r -= x.w; return r <= 0; }) || pool[pool.length - 1];
  return hit?.a || null;
}

// Every post for one event: We-Draft.com's, then (when the desk chatter
// says so) one personality's — [{ analyst, text, lines?, delay }]. One
// with nothing left to say (every fitting line already used this round)
// passes to the next.
export function reactTo(event, ctx) {
  const posts = [];
  const memory = ctx.memory || (ctx.memory = {});
  const round = event.pick?.round ?? null;
  if (round !== memory.round) { memory.round = round; memory.roundLines = {}; }
  const house = ANALYSTS[0];
  const hr = guarded(`${house.id} ${event.type}`, () => house.react(event, ctx));
  if (hr?.text) posts.push({ analyst: house, ...hr, delay: house.delay });
  if (guarded("chimesIn", () => chimesIn(event, ctx), false)) {
    const tried = new Set();
    for (let k = 0; k < LIVE_ANALYSTS.length; k++) {
      const who = choosePersonality(event, ctx, tried);
      if (!who) break;
      tried.add(who.id);
      memory.roundRule = true;
      const r = guarded(`${who.id} ${event.type}`, () => who.react(event, ctx));
      memory.roundRule = false;
      if (r?.text) {
        posts.push({ analyst: who, ...r, delay: who.delay });
        memory.lastVoice = who.id;
        break;
      }
    }
  }
  guarded("record pick", () => recordPick(event, ctx));
  return posts;
}

// The desk's opening posts when the sim starts.
export function openingPosts({ year, userTeams, ctx }) {
  const mine = userTeams.map((t) => ctx.nickname(t)).join(", ");
  return [
    { analyst: ANALYSTS[0], text: `The ${year} NFL Draft Sim is LIVE.`, lines: ["Every CPU pick weighs the We-Draft.com board, positional value and each staff's own draft history.", ...(mine ? [`You're running the war room for: ${mine}.`] : [])], delay: 0 },
    { analyst: byId("isaac"), text: mine ? `Alright ${mine} fans — the clock's yours when it's your turn. Good luck.` : "Pull up a chair. Let's see who's got a plan and who's winging it.", delay: 900 },
  ];
}

// Davin's joke pick for the team on the clock (Suggestions tab):
// { analyst, legend: { name, positions, school }, pos, text } or null.
export function davinSuggestion(team, ctx) {
  return guarded("Davin suggestion", () => davinSuggestionFor(team, ctx));
}
function davinSuggestionFor(team, ctx) {
  const davin = byId("davin");
  if (!davin?.enabled) return null;
  const legend = randomLegend(null, ctx);
  if (!legend) return null;
  const pos = (legend.positions || []).find((x) => x !== "ANY") || "ATH";
  const text = lineFrom(DAVIN_LINES, "suggestion", {
    legend: legend.name, legendPos: pos, legendSchool: legend.school || "", nick: ctx.nickname(team), teamName: ctx.teamName(team), city: cityOf(ctx, team), team, year: ctx.year || "",
  }, ctx, "davin");
  return text ? { analyst: davin, legend, pos, text } : null;
}

// Isaac's grade comment for a user team's finished draft (results
// screen) → { analyst, text }, or null when they made no picks.
export function gradeTake(haul, ctx) {
  return guarded("grade take", () => gradeTakeFor(haul, ctx));
}
function gradeTakeFor(haul, ctx) {
  if (!haul.rows.length) return null;
  const best = [...haul.rows].sort((a, b) => b.score - a.score)[0];
  const cat = `grade${haul.letter[0]}`;
  const vars = {
    grade: haul.letter, nick: ctx.nickname(haul.team), teamName: ctx.teamName(haul.team), city: cityOf(ctx, haul.team), team: haul.team,
    best: `${best.prospect.First} ${best.prospect.Last}`, bestN: best.pick.overall, year: ctx.year || "",
    ...staffVars(ctx.staff?.[haul.team]),
  };
  const text = lineFrom(ISAAC_LINES, cat, vars, ctx, "isaac");
  return text ? { analyst: byId("isaac"), text } : null;
}

// The desk's wrap-up for a user team's finished draft.
export function wrapPost(haul, ctx) {
  const best = [...haul.rows].sort((a, b) => b.score - a.score)[0];
  return {
    analyst: ANALYSTS[0], text: `${ctx.teamName(haul.team)} draft grade: ${haul.letter}`,
    lines: best ? [`Best pick: ${best.prospect.First} ${best.prospect.Last} at No. ${best.pick.overall}.`] : [], delay: 0,
  };
}

// ── Admin-edited lines (Admin → Mock Draft → Personalities) ──
// config/draftSimDesk.lines: { [analystId]: { [situation]: [line, …] } }.
// A situation saved there replaces the built-in lines above; the built-ins
// stay here as the defaults to reset to. Situations themselves (when each
// one fires) are code — only their lines are editable.
const DEFAULT_LINES = Object.fromEntries(ANALYSTS.map((a) => [a.id, Object.fromEntries(Object.entries(a.lines || {}).map(([k, c]) => [k, c.lines]))]));
export const defaultLines = (id, cat) => DEFAULT_LINES[id]?.[cat] || [];
// Profile pictures: config/draftSimDesk.avatars { [analystId]: image URL
// (or a small data: URL uploaded in the editor) }. Unset → the built-in
// (We-Draft.com's icon; initials for everyone else).
const DEFAULT_AVATARS = Object.fromEntries(ANALYSTS.map((a) => [a.id, a.avatar || ""]));
export const defaultAvatar = (id) => DEFAULT_AVATARS[id] || "";
export function applyDeskAvatars(avatars = {}) {
  ANALYSTS.forEach((a) => { a.avatar = avatars[a.id] || DEFAULT_AVATARS[a.id] || undefined; });
}

export function applyDeskLines(overrides = {}) {
  ANALYSTS.forEach((a) => Object.entries(a.lines || {}).forEach(([cat, c]) => {
    const o = overrides[a.id]?.[cat];
    c.lines = Array.isArray(o) && o.length ? o : DEFAULT_LINES[a.id][cat];
  }));
}
