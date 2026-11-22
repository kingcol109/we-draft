// src/utils/portalSim/config.js
//
// Portal Sim knobs — every number the models (./models.js) use, in one
// place. ALL PLACEHOLDERS (user, 2026-11-14: "build the infrastructure now,
// we will iron out specifics later"). The admin can override any of them
// (config/portalSim — components/AdminPortalSim.jsx); mergeConfig() lays
// those over these defaults.

export const DEFAULT_CONFIG = {
  // Two opening windows (user, 2026-11-14), then the portal itself:
  //   Opening 1  NFL decisions — who leaves for the draft; on-the-fence
  //              players can be retained
  //   Opening 2  retention — players who want to transfer; teams negotiate
  //              to keep them, the rest enter the portal
  // Then `windows` portal windows. Players enter the portal only in opening
  // window 2 (user, 2026-11-14) — lateEntryWindows (portal windows that add
  // late entries) stays empty.
  // 6 (user, 2026-11-18): two halves of 3 — see `split`.
  windows: 6,
  // The run's choices at the start (user, 2026-11-15): portal length (5, 7
  // — the default — or 10 windows; each has its own list narrowing) and
  // transfer frequency — × each player's modeled chance of wanting out
  // (capped at entryCap). Default = the tuned model. Admin likeliness
  // (0–3) isn't scaled — those chances are set by hand.
  windowOptions: [6],
  listSizeByWindows: { 6: [null, null, 10, 7, 5, 4, 3] },
  // The portal's shape (user, 2026-11-18): the two opening windows, then
  // `at` portal windows — the big signing wave (the evaluation period
  // first); the players pursued hardest resolve around window `at` (push:
  // off his commit bar there for a player with 2+ offers, patience 1) — then
  // Market Watch (engine openMarket / endMarket), then `after` more. Past
  // the split it's easier to come in late: interest built before it counts
  // lateHeld ×.
  // newWait: a Market Watch entrant can't commit before this many windows
  // in — his recruitment runs (user, 2026-11-18).
  // The setup's Real Portal mode opens once this many real entries are in
  // (January) — a handful of early ones don't open it.
  liveOpens: 150,
  // Releasing a player frees this share of his ask, by last season's role
  // (user, 2026-11-18 — a 2★ backup QB's ask is mostly his position; it
  // shouldn't buy a starter).
  release: { starter: 0.6, rotation: 0.35, reserve: 0.15, none: 0.08 },
  split: { at: 3, after: 3, push: 0.15, lateHeld: 0.5, newWait: 2 },
  // Market Watch, between the halves (user, 2026-11-18):
  //  reshuffle  players whose spot on the depth chart fell because their
  //             school signed someone may enter — by how far they fell
  //             (fall: starter → rotation / → depth, rotation → depth), × by
  //             stars (a 6★ never goes because of a signing); modest numbers.
  //  demand     a top player staying put (minStars+, a starter) sees one at
  //             his position and level sign for `gap`× or more what he
  //             makes (his retention deal, else ask × homeNil): `chance` by
  //             stars he wants that much or he enters. A CPU school pays when
  //             it can (cpuPay of the time); yours decide in Market Watch.
  reshuffle: { fall: { starterRotation: 0.18, starterDepth: 0.4, rotationDepth: 0.12 }, stars: { 6: 0, 5: 0.25, 4: 1, 3: 1, 2: 0.7 } },
  // cpuChance: CPU schools' stars ask more often (user, 2026-11-18 — your
  // own players keep `chance`). A school that loses one gets his normal
  // ask back (engine freed).
  market: { minStars: 5, gap: 1.5, chance: { 6: 0.3, 5: 0.15 }, cpuChance: { 6: 0.5, 5: 0.3 }, cpuPay: 0.7 },
  // Crazy (user, 2026-11-18): truly crazy — also lets players marked as
  // staying (likeliness 0 / 1) and academy players go (engine transferLeave).
  frequency: { less: 0.6, default: 1, more: 1.6, crazy: 4 },
  entryCap: 0.97,
  lateEntryWindows: [],
  lateEntryFactor: 0.15,

  // Team tiers: 1 = blue blood … 5 = bottom of FBS. A team's tier sets its
  // NIL budget, how many players it chases a window, and how attractive it is.
  tiers: [1, 2, 3, 4, 5],
  tierLabels: { 1: "Blue Blood", 2: "Power Contender", 3: "Power Program", 4: "Group of 5 Plus", 5: "Group of 5" },
  // Portal NIL budget by tier ($).
  budgets: { 1: 20000000, 2: 12000000, 3: 7000000, 4: 3000000, 5: 1500000 },
  // Offers a CPU team makes per window, by tier — lower tiers fill more of
  // their rosters from the portal (user, 2026-11-15: roster targets).
  offersPerWindow: { 1: 12, 2: 12, 3: 14, 4: 16, 5: 18 },
  // How hard a tier bids, × the player's ask.
  aggressiveness: { 1: 1.15, 2: 1.05, 3: 1.0, 4: 0.9, 5: 0.85 },

  // Players. What a transfer star asks for in NIL ($), before his own noise.
  askByStars: { 6: 2500000, 5: 1200000, 4: 500000, 3: 150000, 2: 40000 },
  // × his ask by position (audit 2026-11-15: a 3★ QB and a 3★ punter were
  // priced the same). Sub-position first (a DB's CB / S, an OL's OT / IOL),
  // then position.
  posAsk: { QB: 2.5, OT: 1.3, EDGE: 1.3, WR: 1.15, CB: 1.15, OL: 1.1, DL: 1.05, DB: 1.05, IOL: 0.95, S: 0.95, LB: 0.9, RB: 0.85, TE: 0.85, K: 0.3, P: 0.25 },
  // Recent recruits (user, 2026-11-15): the class of 2026 are basically
  // still freshmen — schools judge them on their recruiting profile, not
  // just their portal grade. A school's read of him is at least this level
  // (≈ stars; recruit stars → level, or a national rank of at most n →
  // level), less classPenalty by seasons of eligibility left (4 = class of
  // 2026, full; 3 = class of 2025, a bit less; older: portal grade only).
  recruits: { level: { 5: 4.5, 4: 3.5, 3: 2 }, top: [[50, 4.75], [100, 4.25], [250, 3.75]], classPenalty: { 4: 0, 3: 0.75 } },
  // Service academies: their players rarely transfer (× the modeled chance;
  // admin likeliness still wins), and CPU academies don't recruit the portal.
  academies: { schools: ["Army", "Navy", "Air Force"], entry: 0.15 },
  // The tier a player "belongs" at, by stars — the bigger the gap to his
  // school's tier, the likelier he leaves.
  idealTier: { 6: 1, 5: 1.5, 4: 2.5, 3: 3.5, 2: 4.5 },

  // ── Opening window 1: the NFL ──
  // Out of eligibility (0 seasons left) or Declared on We-Draft: gone.
  // Draft-eligible = at least three seasons in college = this many seasons
  // of eligibility left, at most.
  draftEligibleMaxElig: 2,
  // Chance he leaves, by community draft grade (1 = Early First … 10 = UDFA).
  // High first-rounders always go; Day 2 often; Day 3 less often.
  declareByGrade: { 1: 1, 2: 0.97, 3: 0.88, 4: 0.75, 5: 0.62, 6: 0.4, 7: 0.3, 8: 0.22, 9: 0.15, 10: 0.05 },
  // On the fence (retainable) between these; at or above the top he's gone,
  // below the bottom he's back.
  nflFence: [0.1, 0.9],
  // What it takes to keep a draft prospect: his ask × this.
  nflAskFactor: 1.5,
  // How much a full retention offer can cut his chance of leaving, by grade —
  // first-rounders barely move, Day 3 guys can be talked into another year.
  nflRetainPower: { 1: 0, 2: 0.1, 3: 0.25, 4: 0.45, 5: 0.55, 6: 0.7, 7: 0.75, 8: 0.8, 9: 0.85, 10: 0.9 },

  // ── Grading schools (user, 2026-11-14) ──
  // Every player grades every school — his own included — on six factors,
  // each 0..1: program tier, NIL offered (vs his ask), proximity to home,
  // playing time (the room: how many better players it has at his position
  // vs the starters it plays — departures in front of him count), recent
  // success (team records) and player development (recent draft picks at his
  // position). His grade = his personality's weighted average of the six.
  // Interests (user, 2026-11-14): every player gets three A's, a B, a C and
  // an F across the six, drawn fresh every run — choiceWeights make a factor
  // likelier to be an A (and less likely to be the F). letterWeights: what
  // each letter counts in his grade (A's 80% together).
  choiceWeights: { tier: 0.8, nil: 1.2, loc: 0.6, pt: 2.2, success: 0.7, dev: 0.8 },
  letterWeights: { A: 0.8 / 3, B: 0.1, C: 0.07, F: 0.03 },
  // A school scoring under `below` on `count` or more of his A's: cut from
  // his list right away.
  cutBadA: { below: 0.35, count: 2 },
  // His overall grade of an offer: A–F grade × factors + the recruiting
  // process × process (3 : 1). The process: happiness × happy + interest
  // built (of earlyInterest.cap) × interest.
  gradeMix: { factors: 0.75, process: 0.25 },
  process: { happy: 0.7, interest: 0.3 },
  choiceNoise: 0.04, // ± grade noise on each offer
  // Recent success: win % weights, newest season first.
  successYearWeights: [0.4, 0.3, 0.2, 0.1],
  // Player development: drafts counted, pick weight by round (1st, 2nd–3rd,
  // 4th–7th), and the older half's weight.
  devDrafts: 8,
  devRoundWeight: [3, 2, 1],
  devOlderWeight: 0.6,
  // Development × (devPtFloor + (1 − devPtFloor) × playing time): a school's
  // NFL pipeline matters less to a player buried on its depth chart.
  devPtFloor: 0.35,
  // Playing time from the room: better players ahead of him vs starters.
  roomPt: { starter: 1, rotation: 0.6, depth: 0.3, buried: 0.1 },
  // What he already makes at his school, × his ask (his home NIL before any
  // retention offer).
  homeNil: 0.6,

  // ── Opening window 2: who wants to leave ──
  // Each player grades his school against the market — a typical school at
  // his level (his ideal tier, his ask, an average location / success /
  // development, the playing time below). The further the market beats home,
  // the likelier he enters: maxEntry × logistic((market − home − entryBias)
  // / entryTemp). A retention offer raises his home grade; he stays when that
  // pulls his chance of leaving below his draw.
  marketPt: { 6: 0.9, 5: 0.85, 4: 0.8, 3: 0.75, 2: 0.65 },
  // The market's tier: his stars' ideal tier, pulled this far toward his
  // school's (0 = stars only, 1 = his school's level).
  marketHomePull: 0.6,
  // Ambition: grade points added to the market per tier his school sits
  // below his stars' level, × how much he played and his stars.
  // Bench frustration: grade points added to the market for a talented
  // player who won't play — × (1 − the playing time his room leaves him) ×
  // his years in school (1 = after his true freshman season: slight).
  bench: { stars: { 2: 0.02, 3: 0.12, 4: 0.28, 5: 0.34, 6: 0.36 }, years: { 1: 0.25, 2: 0.7, 3: 1 } },
  // Narrowing his list: the schools he's still listening to after each
  // portal window (index = window; null = all). The rest are cut — and can't
  // offer him again.
  listSize: [null, null, 10, 7, 5, 4, 3],
  ambition: { perTier: 0.15, role: { starter: 1, rotation: 0.6, reserve: 0.15, none: 0 }, stars: { 6: 1.3, 5: 1.2, 4: 1.1, 3: 1, 2: 0.4 } },
  // Transfer likeliness (user, 2026-11-14), set per player on the admin's
  // Grades tab: his chance of entering, replacing the model's — 3 every time
  // (no retention offer moves him), 2 about two runs in three, 1 about once
  // every 4 runs, 0 never (a retention offer scales 1s and 2s down, less the
  // likelier he is to go; set a bit over the targets for that). No
  // likeliness = the model alone.
  likeliness: { 1: 0.28, 2: 0.73, 3: 1 },
  entryBias: 0.21,
  entryTemp: 0.06,
  maxEntry: 0.85,
  retainMix: { nil: 0.6, pt: 0.4 }, // NFL fence retention offers' pull

  // ── CPU retention (both opening windows) ──
  // Share of the NIL budget a CPU team will spend keeping its own players.
  retentionShare: 0.35,
  // Urgency at a position: 1 + this × (starters/rotation players lost there
  // ÷ starters it needs) — lose a lot at a spot, fight harder to keep the rest.
  urgencyWeight: 0.6,
  urgencyCap: 1.6,
  // A player's worth to keep: value × role × urgency, at least retainMinWorth.
  roleWorth: { starter: 1, rotation: 0.7, reserve: 0.35, none: 0.2 },
  retainMinWorth: 15,

  // Roster sizes by position (user, 2026-11-15 — real FBS numbers): [avg,
  // sd]. Each school draws its target when the portal opens (within 2 sd);
  // DL covers DL + EDGE. K / P aren't in them (teams keep what they have).
  // The draws are then scaled so the whole roster (K / P included) comes to
  // rosterCap, and no position goes under its starters + depth + 1 (or avg
  // − sd). Bodies and depth signings stop at the cap; starters (holes,
  // upgrades) don't.
  rosterSize: { QB: [5.3, 0.9], RB: [7.6, 1.5], WR: [15, 2.4], TE: [7.3, 1.4], OL: [19.3, 3], DL: [17.9, 3.5], LB: [13.3, 5.2], DB: [21.5, 2.8] },
  rosterCap: 105,
  // Room a CPU school keeps for portal signings when it makes room (engine
  // shedRosters, user 2026-11-15): over rosterCap with who's staying + its
  // high school class + this, it cuts its least valuable players into the
  // portal.
  portalRoom: { 1: 8, 2: 10, 3: 12, 4: 14, 5: 16 },
  // The implied high school class (the sim has no freshmen): this many of
  // each school's roster gap, spread over its shortages; the portal fills
  // the rest.
  hsClass: 22,

  // Roster targets by position (starters a team wants) — drives needs.
  starters: { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 2, EDGE: 2, LB: 2, DB: 4, K: 1, P: 1 },

  // NIL in a player's grade of an offer (models nilScore): saturating —
  // (1 − e^(−curve × NIL/ask)), full at `full` × his ask — blended (rel)
  // with how it stacks up against the best other offer (none: field0 × his
  // ask; relSpan × ask over it scores 1).
  nilModel: { curve: 2, full: 2, rel: 0.4, relSpan: 1, field0: 1 },

  // Recruitments: interest an offer builds each window it stands (grade
  // points, capped) — offering early helps.
  earlyInterest: { perWindow: 0.03, cap: 0.12 },
  // A NIL offer this many × his ask commits him on the spot, any window —
  // by his NIL letter: the less NIL matters, the more it takes (F: never).
  instantCommitAsk: { A: 3, B: 4, C: 6, F: null },
  // Happiness (user, 2026-11-14): each player's 0–100 feeling about each
  // school, 100 to start. A lowball (under lowballAsk × his ask), offering less
  // than before and pulling an offer each knock it down; below 100 it costs
  // that school up to `penalty` grade points (at 0). A brake on user offer
  // spam — CPU schools never do these.
  happiness: { lowballAsk: 0.6, lowball: 15, lower: 25, pulled: 35, penalty: 0.2 },
  // A player sizing up a room: better players a team is still chasing at his
  // position (outstanding offers) count this much each (signings count fully
  // — they're on the roster).
  offerRoomWeight: 0.5,
  // Commit when the best offer's grade reaches this share of his market
  // grade, falling window by window (start → end), so players get less
  // picky as the portal winds down.
  commitShare: [1.3, 0.75],
  // Windows an offer must stand before he can take it, by stars — top
  // players' recruitments run longer (user, 2026-11-15). The last window he
  // takes his best offer regardless.
  // (user, 2026-11-18: reversed — the early portal is about top talent;
  // the best resolve first, everyone else after.)
  patience: { 6: 1, 5: 1, 4: 1, 3: 2, 2: 2 },
  // Resolving recruitments (user, 2026-11-18 — engine decisions): early:
  // share off the commit bar by stars (top players take a good offer
  // early); runaway: off the bar when one school has him to itself (no one
  // else on him, or the leader `margin` clear of the next) — patience 1.
  resolve: { early: { 6: 0.12, 5: 0.1, 4: 0.06 }, runaway: 0.08, margin: 0.08 },
  // Making up ground late (engine catchUpOf): a school above everyone else
  // on him by tiers gets up to `max` grade, growing as the portal goes on
  // (full at a `tiers` gap).
  catchUp: { max: 0.06, tiers: 2 },


  // Boards (contacts) & the evaluation period (user, 2026-11-15). Portal
  // window evalWindow is the evaluation period — no offers. Contacting a
  // player puts him on a school's board, and interest builds from then.
  // sizes: contacts by portal window (the last carries on) — 10 in the
  // evaluation period, 15 in window 2, 25 after
  // (earlyInterest). CPU schools work their boards in cpuPlan (engine): a
  // school is "in it" for a player within `gap` of the school he likes best
  // AND in his top maxRank; it drops the ones it isn't, feels out perSpot
  // contacts per open want, and offers the best one it's in it for. snub:
  // grade points a school loses with a player while it chases others at his
  // position (× others offered ÷ its wants there, capped at 1) — all of it
  // if it hasn't offered him, half if it has.
  // (user, 2026-11-18: 15 through the first half; 25 once the second
  // half opens.)
  board: { sizes: [10, 15, 15, 25], evalWindow: 1, gap: 0.12, maxRank: 6, perSpot: 2, snub: 0.12 },

  // Coaching staffs (user, 2026-11-18 — engine "Coaching staffs"). gain:
  // grade a coach builds per window on a board player (offSide × on the
  // other side of the ball, special × on a K / P; the HC recruits
  // everyone), up to cap per player and school. recBoost: chasing a player
  // your staff recommended. near: a school within `full` miles of his
  // hometown gets `max`, fading to 0 at `zero` (on top of his "close to
  // home" interest). recs: how your staff recommends — perWant per want,
  // max a window, `look` best fits checked per want, within `reach` of his
  // favorite, asks up to budgetShare of what you have left, localMiles
  // counts as "close to home"; keep: the most standing at once.
  staff: {
    // (user, 2026-11-18): the head coach pushes hardest, the same at every
    // position; coordinators less, on their side (offSide × the other);
    // assistants less again.
    gain: { HC: 0.035, OC: 0.024, DC: 0.024, OA: 0.015, DA: 0.015 },
    offSide: 0.45,
    special: 0.6,
    // A school's own read of its admin targets (config/portalTargets): this
    // much better than his stars — it chases them.
    targetLike: 0.5,
    cap: 0.09,
    recBoost: 0.015,
    // Names per position on the staff's full list (engine staffSuggestions).
    suggest: 6,
    near: { full: 75, zero: 450, max: 0.035 },
    // Odds (user, 2026-11-22): per need at most one long shot, then a name
    // more realistic than the first (saferBy more landable, or half a star
    // lower), then for the big needs (hole / upgrade / QB) a fallback — the
    // most landable who can help (landable ≥ safeRatio), down to
    // fallbackDrop stars under the want's bar. Before anyone's on him, his
    // likely suitors (tier ≤ idealTier + suitorTier) stand in: your fit vs
    // the suitorRank-th best of them (4th: a real contender, not his dream school).
    recs: { perWant: 2, max: 14, keep: 20, fallbackDrop: 0.75, saferBy: 0.04, safeRatio: 0.95, suitorTier: 0.5, suitorRank: 4, look: 30, reach: 0.1, lateReach: 0.08, headStart: 0.5, lateDrop: 1, longReach: 0.22, longshots: 2, longshotUntil: 3, tierPenalty: 0.08, budgetShare: 0.6, localMiles: 200 },
  },

  // CPU schools' offers (user, 2026-11-14). An open offer counts as a
  // signing (one QB spot → one QB chased at a time).
  cpu: {
    // Rotation players a team wants behind its starters.
    depth: { QB: 0, RB: 1, WR: 2, TE: 1, OL: 2, DL: 2, EDGE: 1, LB: 1, DB: 2, K: 0, P: 0 },
    // Starters by sub-position (the pool's CB / S, OT / IOL): a team wants
    // its corners and safeties, tackles and interior linemen, separately.
    // A player with no sub-position fills whichever is shorter.
    subStarters: { DB: { CB: 2, S: 2 }, OL: { OT: 2, IOL: 3 } },
    // Where teams' prices center, × his ask. Several bidders → the best bid
    // wins, so a bit under 1 keeps the deals themselves averaging near his
    // ask (the market price): some well over, some at a discount.
    valueCenter: 0.65,
    // ± half of this on its price each window.
    windowNoise: 0.1,
    // Kept back for each important open want after this one: a typical
    // target's ask at its level × reserveShare.
    reserveShare: 0.75,
    // Who might fit a want: the best `pool` players at the position (as it
    // sees them); for bodies / depth, his level less bodyCrowd per school
    // already on him (it looks past the most contested).
    pool: 80,
    bodyCrowd: 0.4,
    // At most this many upgrade wants (its biggest), by tier — a school
    // works on a handful of spots, not every starter under its standard.
    // Kickers / punters are never upgrades (only holes).
    maxUpgrades: { 1: 5, 2: 5, 3: 4, 4: 4, 5: 3 },
    // Talent wants (user, 2026-11-18): a starter under its standard +
    // talentAbove is "just OK" — a school looks for a clear step up there
    // too, at talentPri × how far short (below an upgrade), up to maxTalent
    // of them (its weakest rooms first).
    talentAbove: 0.4,
    talentPri: 0.55,
    maxTalent: { 1: 4, 2: 3, 3: 3, 4: 2, 5: 2 },
    // Paying to get in (audit 2026-11-15: money couldn't buy standing): for
    // a want of payUpPri or more, a school counts itself in for a player if
    // an offer up to its most (bid cap, and payShare of what it has left —
    // payShareQB at QB) would put it in.
    payUpPri: 1,
    payShare: 0.4,
    payShareQB: 0.65,
    // Desperation at a hole, growing from the first offer window (0) to the
    // last (1): the bar drops by up to minDrop (never to a player no better
    // than who it has), "in it" widens by up to gap and rank. In its last
    // freeFrom offer passes it offers the best fit it can find, in it or not.
    desperate: { minDrop: 1.25, gap: 0.18, rank: 4, freeFrom: 2 },
    // Short on money, it offers what's left if that's at least this share
    // of its price and of his ask — else it moves on.
    stretch: 0.85,
    // The plan (engine cpuPlan, user 2026-11-15). standard: the level (eff
    // ≈ stars) a tier wants in its starters — under it by upgradeGap or more
    // is an upgrade want (a player must beat the starter by upgradeBy); more
    // than holeBelow under it, or no one, is a hole. Rotation players short
    // of cpu.depth (within depthBelow of the standard) are depth wants.
    // posWeight: how much a position matters. A want of backupPri or more it
    // isn't leading for can carry a second offer. directFrom: windows after
    // the evaluation period before it offers players it never contacted.
    // standardBonus: positions held higher (a blue blood with a 4★ QB still
    // looks to upgrade; a Group of 5 with one is content).
    standard: { 1: 4.25, 2: 3.9, 3: 3.5, 4: 3.1, 5: 2.75 },
    standardBonus: { QB: 0.75 },
    upgradeGap: 0.5,
    upgradeBy: 0.75,
    holeBelow: 2.25,
    holeMin: 1.25,
    depthBelow: 1.25,
    holePri: 2.5,
    depthPri: 0.5,
    backupPri: 2,
    directFrom: 2,
    // Money held back while bidding: for its next few important wants only.
    reserveWants: 3,
    // A school's own read of a player: his stars ± a normal draw this wide
    // (engine opinionOf) — it drives whom it wants and what it bids.
    opinionSd: 0.45,
    // Bidding (engine bidFor): his ask is the starting point. +competition
    // per other school offering (up to competitionCap of them), +scarcity at
    // a big want with fewer than scarceAlts others it's in it for. Behind on
    // a player it wants: raise its offer by `raise`, or to overField past
    // the best one on the table — never past maxMult × ask × likeBase^(its opinion).
    // likeBase: its price × likeBase^(its opinion − his stars). floor: it
    // never opens under this × his ask.
    bid: { competition: 0.04, competitionCap: 6, scarcity: 0.3, scarceAlts: 3, raise: 0.1, overField: 0.04, maxMult: 1.6, likeBase: 1.7, floor: 0.75 },
    // Filling its roster (cfg.rosterSize, cfg.hsClass): a body is anyone
    // within bodyBelowStd of its standard (never under bodyFloor).
    bodyBelowStd: 2.5,
    bodyFloor: 0.25,
    bodyPri: 0.3,
    posWeight: { QB: 1.6, EDGE: 1.2, OL: 1, WR: 1, DB: 1, DL: 1, LB: 0.9, RB: 0.8, TE: 0.7, K: 0.3, P: 0.3 },
  },
};

// Admin overrides (config/portalSim) over the defaults, one level deep.
export function mergeConfig(over = {}) {
  const out = { ...DEFAULT_CONFIG };
  Object.entries(over || {}).forEach(([k, v]) => {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof DEFAULT_CONFIG[k] === "object" && !Array.isArray(DEFAULT_CONFIG[k])) out[k] = { ...DEFAULT_CONFIG[k], ...v };
    else if (v != null) out[k] = v;
  });
  return out;
}

// A starting tier per FBS team before the admin sets them: conference
// level, with a short list of blue bloods. The admin's tiers win.
const BLUE_BLOODS = ["Ohio State", "Georgia", "Alabama", "Texas", "Oregon", "Michigan", "LSU", "Notre Dame", "USC", "Penn State", "Miami", "Clemson", "Texas A&M", "Florida State", "Oklahoma", "Tennessee"];
const CONF_TIER = { SEC: 2, "Big 10": 2, ACC: 3, "Big 12": 3, "Pac 12": 4, Independent: 4, AAC: 4, "Mountain West": 4, "Sun Belt": 5, CUSA: 5, MAC: 5 };
export const defaultTier = (school, conference) => (BLUE_BLOODS.includes(school) ? 1 : CONF_TIER[conference] || 5);
