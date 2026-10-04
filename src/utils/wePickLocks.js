// src/utils/wePickLocks.js
//
// When a We-Pick game can be picked — shared by WePickHub.js (My Picks)
// and /live's game preview (LivePage.js), so a pick made in either place
// opens and locks on exactly the same schedule (and the same one
// firestore.rules' gameIsPickable enforces at kickoff). Games are
// schedule26-shaped ({ Week, Date, Time, KickoffAt, PicksForceOpen, ... }).
import { isGameFinal } from "./wePickScoring";

export const toMs = (ts) => {
  if (!ts) return 0;
  if (ts?.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? 0 : parsed;
};

// Monday-to-Sunday week boundary, computed in UTC (same math as
// GamePage.js's own mondayOfWeekUtc).
export const mondayOfWeekUtc = (ms) => {
  const d = new Date(ms);
  const utcDay = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (utcDay === 0 ? -6 : 1) - utcDay;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMonday, 0, 0, 0, 0);
};

// Minutes-since-midnight, for actually chronological sorting — a game's
// Date field is UTC midnight regardless of kickoff, so every game on the
// same calendar day ties on Date alone; Time has to be the real tiebreaker,
// and comparing formatted 12-hour strings ("10:00 PM" < "12:00 PM" < "7:00
// PM" alphabetically) sorts them wrong.
export const timeToMinutes = (t) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
};

// Admin enters Kickoff Time as a plain "HH:MM" with no timezone attached —
// CFB kickoffs are always quoted in US Eastern (see AdminPanel.js's
// "Kickoff Time" field), so that's the zone assumed here. Reads the actual
// UTC offset for America/New_York on the game's own date via Intl (rather
// than hardcoding UTC-5) so this stays correct across the EDT/EST switch
// partway through the season instead of drifting an hour on one side of it.
const ET_OFFSET_FALLBACK_MIN = -300; // EST — only used if Intl's parse ever fails
export const etOffsetMinutesAt = (ms) => {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(new Date(ms));
    const tz = parts.find((p) => p.type === "timeZoneName")?.value || "";
    const m = /GMT([+-]\d+)(?::(\d+))?/.exec(tz);
    if (!m) return ET_OFFSET_FALLBACK_MIN;
    const h = parseInt(m[1], 10);
    const mins = m[2] ? parseInt(m[2], 10) : 0;
    return h * 60 + (h < 0 ? -mins : mins);
  } catch {
    return ET_OFFSET_FALLBACK_MIN;
  }
};

// The actual UTC instant a game kicks off, combining Date (UTC midnight)
// with Time (ET wall-clock) — null when either is missing, since Kickoff
// Time is optional in the admin form and there's no hour to lock at
// without one (isPickable falls back to Final-only locking in that case,
// same as before kickoff-locking existed).
//
// KickoffAt (the exact UTC instant — written by AdminPanel's save and the
// CFBD schedule sync, and what firestore.rules enforces) wins when set.
// The Date+Time fallback uses Date's calendar day, not its raw instant:
// many docs store Date at ET midnight (04:00/05:00 UTC) rather than UTC
// midnight, and adding the ET time to that raw instant locked picks 4-5
// hours after the actual kickoff.
export const kickoffMs = (g) => {
  const at = toMs(g.KickoffAt);
  if (at) return at;
  const dateMs = toMs(g.Date);
  const mins = timeToMinutes(g.Time);
  if (!dateMs || mins == null) return null;
  const d = new Date(dateMs);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return day + mins * 60000 - etOffsetMinutesAt(day) * 60000;
};

// A game is open for picks once its own week's Monday (00:00 UTC) has
// passed, or an admin has force-opened it — same rule GamePage.js enforces
// for the single-game pick form. Week 0 is opened unconditionally instead
// of waiting on its own Monday — it kicks off before every other week and
// has no games flagged Game of the Week/Featured to build a normal Ranked
// 6 around (see rankedStatus's own Week 0 branch below), so there's no
// reason to make people wait on the calendar for it specifically. None of
// that overrides kickoff, though — once the ball's in the air, picks lock
// for good regardless of PicksForceOpen or which week this is (Final only
// covers a game *after* it's over; kickoff is what actually stops new or
// changed picks on a live one).
export const isPickable = (g) => {
  if (isGameFinal(g)) return false;
  const kickoff = kickoffMs(g);
  if (kickoff != null && Date.now() >= kickoff) return false;
  if (g.PicksForceOpen) return true;
  if (g.Week === "Week 0") return true;
  const dateMs = toMs(g.Date);
  if (!dateMs) return true;
  return Date.now() >= mondayOfWeekUtc(dateMs);
};
