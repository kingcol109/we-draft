// server/live/bigPlays.js
//
// Deterministic big-play detection. Every threshold and weight lives in
// BIG_PLAY_RULES below — change them here and nowhere else. Runs over a
// game's full ordered play list (score context like lead changes needs the
// play before), and tags each play with:
//   bigPlay: { tags: ["touchdown", "lead-change", ...], priority, label } | null
// `priority` ranks plays by importance. What goes in the Feed itself is
// decided by store.js feedKinds() (scoring, turnovers, 20+ yard gains).

const BIG_PLAY_RULES = {
  // Yardage thresholds
  RUSH_YARDS: 25,
  RECEPTION_YARDS: 30,
  PASS_YARDS: 40, // a completion this long also gets "big-pass"
  // Priority weight per tag — a play's priority is its highest tag weight,
  // +1 when it happens in the 4th quarter or overtime and changes the lead.
  WEIGHTS: {
    "defensive-td": 5,
    "special-teams-td": 5,
    "lead-change": 4,
    "go-ahead": 3,
    "game-tying": 3,
    touchdown: 3,
    interception: 3,
    "fumble-lost": 3,
    safety: 3,
    "blocked-kick": 3,
    "big-pass": 3,
    "big-reception": 2,
    "big-rush": 2,
    "fourth-down-conversion": 2,
    "fourth-down-stop": 2,
    "field-goal": 1,
  },
};

const TAG_LABELS = {
  "defensive-td": "Defensive TD",
  "special-teams-td": "Return TD",
  "lead-change": "Lead change",
  "go-ahead": "Go-ahead score",
  "game-tying": "Game-tying score",
  touchdown: "Touchdown",
  interception: "Interception",
  "fumble-lost": "Fumble lost",
  safety: "Safety",
  "blocked-kick": "Blocked kick",
  "big-pass": "Big pass",
  "big-reception": "Big reception",
  "big-rush": "Big run",
  "fourth-down-conversion": "4th-down conversion",
  "fourth-down-stop": "4th-down stop",
  "field-goal": "Field goal",
};

const DEFENSIVE_TD = /^(Interception Return Touchdown|Fumble Return Touchdown|Blocked Punt Touchdown|Blocked Field Goal Touchdown|Missed Field Goal Return Touchdown)$/;
const RETURN_TD = /^(Kickoff Return Touchdown|Punt Return Touchdown)$/;
const INTERCEPTION = /Interception/;
const FUMBLE_LOST = /^(Fumble Recovery \(Opponent\)|Fumble Return Touchdown)$/;
const BLOCKED = /^Blocked/;
const SCRIMMAGE_RUSH = /^(Rush|Rushing Touchdown)$/;
const SCRIMMAGE_PASS = /^(Pass Reception|Pass Completion|Passing Touchdown|Pass Incompletion|Sack|Pass Interception Return|Interception Return Touchdown|Interception|Pass Interception)$/;
const COMPLETION = /^(Pass Reception|Pass Completion|Passing Touchdown)$/;

const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);

function tagPlay(p, prevHome, prevAway) {
  // Wiped out by a penalty — whatever happened on it doesn't count.
  if (/NO PLAY/i.test(p.text || "")) return null;
  const tags = [];
  const type = p.type || "";
  const yards = p.yards || 0;
  const isTD = /Touchdown/.test(type) || (p.scoring && /TOUCHDOWN/i.test(p.text || ""));

  if (DEFENSIVE_TD.test(type)) tags.push("defensive-td");
  else if (RETURN_TD.test(type)) tags.push("special-teams-td");
  else if (isTD) tags.push("touchdown");
  if (INTERCEPTION.test(type)) tags.push("interception");
  if (FUMBLE_LOST.test(type)) tags.push("fumble-lost");
  if (type === "Safety") tags.push("safety");
  if (BLOCKED.test(type)) tags.push("blocked-kick");
  if (type === "Field Goal Good") tags.push("field-goal");

  if (SCRIMMAGE_RUSH.test(type) && yards >= BIG_PLAY_RULES.RUSH_YARDS) tags.push("big-rush");
  if (COMPLETION.test(type)) {
    if (yards >= BIG_PLAY_RULES.PASS_YARDS) tags.push("big-pass");
    else if (yards >= BIG_PLAY_RULES.RECEPTION_YARDS) tags.push("big-reception");
  }

  // 4th down, offense ran a real play (not a punt/kick).
  if (p.down === 4 && (SCRIMMAGE_RUSH.test(type) || SCRIMMAGE_PASS.test(type))) {
    const turnover = INTERCEPTION.test(type) || FUMBLE_LOST.test(type);
    if (!turnover && (isTD || (p.distance != null && yards >= p.distance))) tags.push("fourth-down-conversion");
    else tags.push("fourth-down-stop");
  }

  // Score context — lead before vs after this play.
  const h = p.homeScore ?? prevHome;
  const a = p.awayScore ?? prevAway;
  const before = sign(prevHome - prevAway);
  const after = sign(h - a);
  if (h !== prevHome || a !== prevAway) {
    if (after === 0 && before !== 0) tags.push("game-tying");
    else if (after !== 0 && before === 0) tags.push("go-ahead");
    else if (after !== 0 && after !== before) tags.push("lead-change");
  }

  if (!tags.length) return null;
  let priority = Math.max(...tags.map((t) => BIG_PLAY_RULES.WEIGHTS[t] || 0));
  const lateLeadSwing = (p.period || 0) >= 4 && tags.some((t) => t === "lead-change" || t === "go-ahead" || t === "game-tying");
  if (lateLeadSwing) priority += 1;
  const lead = [...tags].sort((x, y) => (BIG_PLAY_RULES.WEIGHTS[y] || 0) - (BIG_PLAY_RULES.WEIGHTS[x] || 0))[0];
  return { tags, priority, label: TAG_LABELS[lead] || lead };
}

// Mutates and returns plays (must already be in seq order).
function detectBigPlays(plays) {
  let prevHome = 0, prevAway = 0;
  for (const p of plays) {
    p.bigPlay = tagPlay(p, prevHome, prevAway);
    prevHome = p.homeScore ?? prevHome;
    prevAway = p.awayScore ?? prevAway;
  }
  return plays;
}

module.exports = { BIG_PLAY_RULES, TAG_LABELS, detectBigPlays };
