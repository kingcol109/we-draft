// src/utils/whiteboardLists.js
//
// The Whiteboard share dialog's themed lists (pages/Whiteboard.js
// ShareGraphicDialog → utils/whiteboardGraphic.js draws them). The user
// picks each list's players off their board (one position group, or every
// position); every list starts empty. buildList (not used by the dialog
// now — lists no longer auto-fill) would suggest a set, by:
//   risers   — moved up the board since an earlier save (board history,
//              below), most places first.
//   fallers  — moved down since then, most places first.
//   gems     — late-round gems: players the community grades as Day 3 or
//              later (or hasn't graded), in the board's order.
//   sleepers — rated higher than the community by 1.5+ grade steps, placed
//              in Rounds 1–3; biggest gap first.
//   safe     — safe picks: Rounds 1–3, not red-flagged, within one grade
//              step of the community; in the board's order.
//   busts    — red-flagged players (board order), then Day 1–2 community
//              grades the user has 1.5+ steps lower; biggest gap first.
// The community grade is the average on the 1 (Early 1st) … 10 (UDFA)
// scale (utils/gradeScale.js); a board round sits on the same scale
// through ROUND_VALUE.
export const ROUND_VALUE = { "ROUND 1": 2, "ROUND 2": 4, "ROUND 3": 5, "ROUND 4": 6, "ROUND 5": 7, "ROUND 6": 8, "ROUND 7": 9, UDFA: 10 };
const EARLY = ["ROUND 1", "ROUND 2", "ROUND 3"];

// id, label, color (the theme's accent), the graphic's subtitle, and
// whether the list needs the community grades / an earlier save.
export const WB_LISTS = [
  { id: "board", label: "My board" },
  { id: "risers", label: "Risers", color: "#22c55e", community: false, history: true },
  { id: "fallers", label: "Fallers", color: "#ef4444", community: false, history: true },
  { id: "gems", label: "Late Round Gems", color: "#2dd4bf", community: true },
  { id: "sleepers", label: "Sleepers", color: "#a78bfa", community: true },
  { id: "safe", label: "Safe Picks", color: "#60a5fa", community: true },
  { id: "busts", label: "Busts", color: "#f97316", community: true },
];
export const listInfo = (id) => WB_LISTS.find((l) => l.id === id) || WB_LISTS[0];

// The graphic's headline and subtitle.
export function listTitles(id, pos) {
  const p = pos === "ALL" ? "" : `${pos} `;
  switch (id) {
    case "risers": return { headline: `${p}RISERS`, sub: "MOVING UP MY BOARD" };
    case "fallers": return { headline: `${p}FALLERS`, sub: "SLIPPING DOWN MY BOARD" };
    case "gems": return { headline: `${p}LATE ROUND GEMS`, sub: "DAY 3 VALUE WORTH THE WAIT" };
    case "sleepers": return { headline: `${p}SLEEPERS`, sub: "UNDER THE RADAR, NOT FOR LONG" };
    case "safe": return { headline: `${p}SAFE PICKS`, sub: "HIGH FLOORS, LOW RISK" };
    case "busts": return { headline: `${p}BUSTS`, sub: "BUYER BEWARE" };
    default: return { headline: "", sub: "" };
  }
}

// Each player's move since the earlier save: id -> { now, move } (move > 0:
// up that many places). players: in board order; baseline: earlier ids.
export function movesFrom(players, baseline) {
  const out = new Map();
  if (!baseline?.length) return out;
  const was = new Map(baseline.map((x, i) => [x, i + 1]));
  players.forEach((p, i) => { if (was.has(p.id)) out.set(p.id, { now: i + 1, move: was.get(p.id) - (i + 1) }); });
  return out;
}

// A row's pills on the graphic: Risers / Fallers show the move ("▲ 6"),
// the rest show none (no grades on these graphics).
export function listPills(id, moves, playerId) {
  const m = moves.get(playerId);
  if ((id === "risers" || id === "fallers") && m && m.move) return [{ text: `${m.move > 0 ? "▲" : "▼"} ${Math.abs(m.move)}`, tone: "accent" }];
  return [];
}

// The suggested players for a list — what the dialog starts with before the
// user picks their own. players: the board's players in board order (Round
// 1 top to bottom, then Round 2 …), each { id, round, flagged, … };
// community: { id: avg|null }; baseline: ids in the earlier save's order
// (same position filter applied by the caller), or null.
export function buildList(id, players, { community = {}, baseline = null } = {}) {
  const avg = (p) => (community[p.id] == null ? null : community[p.id]);
  const gap = (p) => avg(p) - ROUND_VALUE[p.round]; // > 0: the user is higher

  if (id === "risers" || id === "fallers") {
    const moves = movesFrom(players, baseline);
    const moved = players.filter((p) => moves.has(p.id)).map((p) => ({ ...p, ...moves.get(p.id) }));
    return id === "risers"
      ? moved.filter((p) => p.move > 0).sort((a, b) => b.move - a.move || a.now - b.now)
      : moved.filter((p) => p.move < 0).sort((a, b) => a.move - b.move || a.now - b.now);
  }
  if (id === "gems") return players.filter((p) => avg(p) == null || avg(p) >= 5.5);
  if (id === "sleepers") return players.filter((p) => EARLY.includes(p.round) && avg(p) != null && gap(p) >= 1.5).sort((a, b) => gap(b) - gap(a));
  if (id === "safe") return players.filter((p) => EARLY.includes(p.round) && !p.flagged && avg(p) != null && Math.abs(gap(p)) <= 1);
  if (id === "busts") {
    const fades = players.filter((p) => !p.flagged && avg(p) != null && avg(p) <= 5 && -gap(p) >= 1.5).sort((a, b) => gap(a) - gap(b));
    return [...players.filter((p) => p.flagged), ...fades];
  }
  return players;
}

// ── Board history (risers / fallers) ──
// whiteboards/{uid}_{class}.history: { "YYYY-MM-DD": "id,id,…" } — the
// whole board's order (Big Board order) as of the last save that day, the
// latest HISTORY_DAYS days kept.
export const HISTORY_DAYS = 12;

// The history to save: the old one, the board as it loaded (if it was
// saved on an earlier day and isn't in the history yet — so the first save
// after this ships already has something to compare with), then today's.
export function nextHistory(history, { loadedDay, loadedOrder, today, order }) {
  const out = { ...(history || {}) };
  if (loadedDay && loadedDay !== today && loadedOrder?.length && !out[loadedDay]) out[loadedDay] = loadedOrder.join(",");
  out[today] = order.join(",");
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, HISTORY_DAYS));
}

// The save to compare with: the oldest one in the last 30 days that isn't
// today, else the latest before today. → { day, ids } or null.
export function pickBaseline(history, today) {
  const days = Object.keys(history || {}).filter((d) => d < today && history[d]).sort();
  if (!days.length) return null;
  const cutoff = new Date(Date.parse(`${today}T12:00:00Z`) - 30 * 864e5).toISOString().slice(0, 10);
  const day = days.find((d) => d >= cutoff) || days[days.length - 1];
  return { day, ids: history[day].split(",").filter(Boolean) };
}
