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
//
// Team needs (engine needFor → event.need: { key, label, note } from
// nflTeamNeeds, the admin's labels) give the personalities their "why" — a
// need met, an aging starter's heir, a pick into a crowded room. We-Draft.com
// sticks to the board and the community; needs are the analysts' to discuss.
//
// We-Draft.com posts every pick; then one personality chimes in — who
// depends on the pick (stats → Dr. Johnson, Rutgers/Eagles → Makali, FSU
// → Davin, a player with a written take → Kenneth, a reach/steal/QB/big
// game → Isaac), never the same voice twice running
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
  legend: "One of Davin's favorite players at the position (Chris Weinke, Uncle Rico…) — any Davin line",
  legendPos: "His favorite's position (joke pick)", legendSchool: "His favorite's school (joke pick)",
  gm: "Team's GM (full name)", gmLast: "GM's last name", hc: "Head coach (full name)", hcLast: "Head coach's last name",
  oc: "Offensive coordinator", ocLast: "OC's last name", dc: "Defensive coordinator", dcLast: "DC's last name",
  to: "Team trading up", from: "Team trading down", toNick: "Nickname trading up", fromNick: "Nickname trading down", fromCity: "City trading down", got: "Picks the team trading down gets", pct: "Trade-chart %",
  fromGm: "GM trading down", fromHc: "Head coach trading down",
  best: "Best pick (results screen)", bestN: "Best pick's number (results screen)",
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
  ["Team needs", ["needLabel", "needPos", "needNote"]],
  ["Davin", ["legend", "legendPos", "legendSchool"]],
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
  trade: {
    label: "Trade", when: "Any trade.",
    lines: [
      "We've got a TRADE! The {toNick} are jumping up to {n}. You don't make that call unless your guy is sitting right there.",
      "Phones are ringing. The {toNick} move up to {n}, and the {fromNick} pick up extra picks to slide back.",
      "Aggressive move by the {toNick}. Somebody they love is on the board and they weren't going to risk waiting.",
      "Draft night is officially fun. The {toNick} trade up to {n}.",
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
  trade: {
    label: "Trade", when: "Any trade.",
    lines: [
      "LOVE the aggression from the {toNick}! And the {fromNick} pick up more picks — everybody wins!",
      "Trade! Great move for the {toNick}, great move for the {fromNick}. I love trades.",
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
      "{grade}. I warned you I'd roast you on air. The {nick} reached early and often.",
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
  trade: {
    label: "Trade", when: "Any trade.",
    lines: [
      "The {toNick} traded up for that? I would have traded up for cheeseburgers.",
      "Trades are a scam invented by people who don't believe in fullbacks.",
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

// Pick a variant the analyst hasn't used lately.
function lineFrom(table, cat, vars, ctx, who) {
  const pool = table[cat]?.lines || [];
  // Lines usable at this pick (a { text, minPick } line waits for its pick),
  // preferring ones whose every {variable} has a value — a line that would
  // read with a hole in it only runs if nothing else can.
  const timely = pool.map((_, i) => i).filter((i) => !(pool[i].minPick > (vars.n || 0)));
  const filled = timely.filter((i) => !blankVars(lineText(pool[i]), vars).length);
  const usable = filled.length ? filled : timely;
  if (!usable.length) return null;
  const memory = ctx.memory || (ctx.memory = {});
  const key = `${who}:${cat}`;
  const recent = memory[key] || [];
  let options = usable.filter((i) => !recent.includes(i));
  if (!options.length) options = usable;
  const i = options[Math.floor(ctx.rand() * options.length)];
  memory[key] = [...recent, i].slice(-Math.max(1, pool.length - 1));
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
    ...staffVars(ctx.staff?.[e.team]),
  };
}

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
  const rutgers = isRutgers(e.prospect);
  const eagles = e.team === "PHI";
  let cat;
  if (rutgers && eagles) cat = "rutgersEagles";
  else if (rutgers) cat = "rutgers";
  else if (eagles) cat = "eagles";
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
  if (isFsu(p)) {
    cat = ctx.rand() < 0.4 ? "fsuLegend" : "fsu";
    if (cat === "fsuLegend") legend = p.Position === "QB" ? "Jameis Winston" : favoriteFor(p.Position, ctx);
  } else if (e.need?.label === "Crowded Room" && ctx.rand() < 0.6) cat = "crowded";
  else if (e.pick.round === 1 && ["QB", "WR", "DB"].includes(p.Position) && ctx.rand() < 0.5) cat = "fullback";
  else if (e.value >= 0 && ctx.rand() < 0.5) { legend = favoriteFor(p.Position, ctx); cat = "legend"; }
  else cat = ctx.rand() < 0.25 ? "nonsense" : "take";
  // {legend} works in every Davin line — a favorite at the position.
  return { text: lineFrom(DAVIN_LINES, cat, { ...v, legend: legend || favoriteFor(p.Position, ctx) }, ctx, "davin") };
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

// Should a personality speak up on this event?
function chimesIn(e, ctx) {
  if (e.isUser || e.userInvolved) return true;
  const mode = ctx.chatter || DEFAULT_CHATTER;
  if (mode === "mine") return false;
  if (mode === "all") return true;
  if (e.type === "trade") return ctx.rand() < 0.7;
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
    about: "Opinions — steals, reaches, quarterbacks, staff fits, the CFBD game that put a player on his radar, trades, and your final grade.",
    cadence: "Most likely on the headline picks: No. 1, QBs, steals, reaches, big games, a blocker or target for a team's first-round QB, and a team trading up — told with the pick. On its own only when a trade moves just later-round or future picks.",
    weight: (e) => {
      // A trade into a pick in this draft is his at the pick (tradeUp lines).
      if (e.type === "trade") return e.pick?.capital || e.pick?.future ? 3 : 0;
      if (e.pick.overall === 1) return 100;
      if (e.pick.tradeUp) return 8;
      if (qbSupport(e)) return 4;
      const notable = (e.prospect.Position === "QB" && e.pick.round <= 2) || Math.abs(e.value) >= Math.max(6, e.pick.overall * 0.25);
      return notable ? 3 : 1.3;
    },
    react: (e, ctx) => {
      if (e.type === "pick") return isaacPick(e, ctx);
      if (e.type === "trade") return { text: lineFrom(ISAAC_LINES, "trade", tradeVars(e, ctx), ctx, "isaac") };
      return null;
    },
  },
  {
    id: "kenneth", name: "Kenneth Cold", handle: "@kingcoldsports", role: "Player Analyst", verified: true, enabled: true,
    color: "#f6a21d", initials: "KC", delay: 1300, lines: {},
    about: "The player guy — his own written analysis of the player just drafted, with different takes for a reach, a steal, a depth pick and a normal pick.",
    cadence: "Picks of players he has a take written for (Player analysis below); never on trades.",
    weight: (e) => (e.type === "pick" && e.pick.overall !== 1 && takeFor(e) ? 4 : 0),
    react: (e, ctx) => (e.type === "pick" ? kennethPick(e, ctx) : null),
  },
  {
    id: "pp", name: "Dr. PP Johnson", handle: "@DrPPJohnson", role: "Stats", verified: true, enabled: true,
    color: "#2e9e5b", initials: "PJ", delay: 1300, lines: PP_LINES,
    about: "The stat guy. Reads out the drafted player's CFBD numbers — his season line and where he ranks nationally.",
    cadence: "Picks with a real stat line this season; most likely when the player ranks nationally.",
    weight: (e, ctx) => {
      if (e.type !== "pick") return 0;
      const facts = statFacts(e, ctx);
      return facts.some((f) => f.group === "leader") ? 2.5 : facts.length ? 1.3 : 0;
    },
    react: (e, ctx) => (e.type === "pick" ? ppPick(e, ctx) : null),
  },
  {
    id: "makali", name: "Makali Pennycooke", handle: "@timeoutwithmakalipod", role: "Optimist", verified: true, enabled: true,
    color: "#cc0033", initials: "MP", delay: 1300, lines: MAKALI_LINES,
    about: "Loves every pick and thinks every player is going to be great — Rutgers players and Eagles picks most of all.",
    cadence: "Any pick or trade; almost always on Rutgers players and Eagles picks.",
    weight: (e) => {
      if (e.type === "trade") return e.to === "PHI" || e.from === "PHI" ? 6 : 1;
      return isRutgers(e.prospect) || e.team === "PHI" ? 14 : 1;
    },
    react: (e, ctx) => {
      if (e.type === "pick") return makaliPick(e, ctx);
      if (e.type === "trade") return { text: lineFrom(MAKALI_LINES, "trade", tradeVars(e, ctx), ctx, "makali") };
      return null;
    },
  },
  {
    id: "davin", name: "davin mcgavitt", handle: "@davinmcgavitt", role: "The Jester", verified: false, enabled: true,
    color: "#7a3cff", initials: "DM", delay: 1300, lines: DAVIN_LINES,
    about: "The desk's jester — a joke. Mostly negative, distracted by cheeseburgers, misses first-round fullbacks, loves Florida State players, and measures good picks against his favorite players (FSU greats, movie and TV football players).",
    cadence: "Any pick or trade; almost always on FSU players.",
    weight: (e) => {
      if (e.type === "trade") return 0.8;
      if (isFsu(e.prospect)) return 14;
      if (e.pick.round === 1 && ["QB", "WR", "DB"].includes(e.prospect.Position)) return 1.6;
      return 0.9;
    },
    react: (e, ctx) => {
      if (e.type === "trade") return { text: lineFrom(DAVIN_LINES, "trade", { ...tradeVars(e, ctx), legend: favoriteFor(null, ctx) }, ctx, "davin") };
      if (e.type === "pick") return davinPick(e, ctx);
      return null;
    },
  },
];

export const LIVE_ANALYSTS = ANALYSTS.filter((a) => a.enabled);
const byId = (id) => ANALYSTS.find((a) => a.id === id);

// The one personality after We-Draft.com: weighted by the pick, and
// whoever spoke last is much less likely to go again.
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

function choosePersonality(e, ctx) {
  const memory = ctx.memory || (ctx.memory = {});
  const pool = LIVE_ANALYSTS.filter((a) => a.weight)
    .map((a) => ({ a, w: (Number(guarded(`${a.id} weight`, () => a.weight(e, ctx), 0)) || 0) * (memory.lastVoice === a.id ? 0.35 : 1) }))
    .filter((x) => x.w > 0);
  const total = pool.reduce((t, x) => t + x.w, 0);
  let r = ctx.rand() * total;
  const hit = pool.find((x) => { r -= x.w; return r <= 0; }) || pool[pool.length - 1];
  return hit?.a || null;
}

// Every post for one event: We-Draft.com's, then (when the desk chatter
// says so) one personality's — [{ analyst, text, lines?, delay }].
export function reactTo(event, ctx) {
  const posts = [];
  const house = ANALYSTS[0];
  const hr = guarded(`${house.id} ${event.type}`, () => house.react(event, ctx));
  if (hr?.text) posts.push({ analyst: house, ...hr, delay: house.delay });
  if (guarded("chimesIn", () => chimesIn(event, ctx), false)) {
    const who = choosePersonality(event, ctx);
    const r = who && guarded(`${who.id} ${event.type}`, () => who.react(event, ctx));
    if (r?.text) {
      posts.push({ analyst: who, ...r, delay: who.delay });
      (ctx.memory || (ctx.memory = {})).lastVoice = who.id;
    }
  }
  return posts;
}

// The desk's opening posts when the sim starts.
export function openingPosts({ year, userTeams, ctx }) {
  const mine = userTeams.map((t) => ctx.nickname(t)).join(", ");
  return [
    { analyst: ANALYSTS[0], text: `The ${year} NFL Draft Sim is LIVE.`, lines: ["Every CPU pick weighs the We-Draft.com board, positional value and each staff's own draft history.", ...(mine ? [`You're running the war room for: ${mine}.`] : [])], delay: 0 },
    { analyst: byId("isaac"), text: mine ? `Alright ${mine} fans — the clock's yours when it's your turn. Don't make me roast you on air.` : "Pull up a chair. Let's see who's got a plan and who's winging it.", delay: 900 },
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
