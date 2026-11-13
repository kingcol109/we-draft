// src/utils/eligibility.js
//
// Draft-class rules for the Offseason Manager (Admin → Players → Offseason
// Manager, components/AdminEligibility.jsx and AdminTransferPortal.js).
//
// Eligibility runs off a player's recruiting class (players.RecruitYear,
// saved by an admin, suggested from CFBD — see server/offseason/cfbdIndex.js):
//   first class  RecruitYear + 3   three seasons played → draft-eligible
//   last class   RecruitYear + 5   five seasons of eligibility, no redshirts
// (players recruited before the rule can still be on a roster past that;
// their last class is the current one).
//
// The tag compares the listed class (Eligible) to the first class: "True"
// when they match, "+1", "+2"… for each season back in school past it. A
// true 2027 who returns is a 2028 +1.
//
// Nothing here writes. Pure, so a Node script could share it.

// The class being drafted next: 2027 until the 2027 draft (late April),
// then 2028 from May on.
export function currentDraftClass(now = new Date()) {
  const y = now.getUTCFullYear();
  return String(now.getUTCMonth() >= 4 ? y + 1 : y);
}

// The CFBD transfer-portal season that's open or next to open: CFBD files a
// portal under the season the player transfers for, so the Dec 2026 – spring
// 2027 windows are the 2027 portal. Rolls to the next season in August.
export function activePortalSeason(now = new Date()) {
  const y = now.getUTCFullYear();
  return now.getUTCMonth() >= 7 ? y + 1 : y;
}

// Next Feb 1 (UTC). A class change defers the slug (which bakes the class
// in) to then for SEO continuity — scripts/applyPendingSlugChanges.js
// applies it.
export function nextFebFirstUTC(from = new Date()) {
  const y = from.getUTCFullYear();
  const thisYear = new Date(Date.UTC(y, 1, 1));
  return from < thisYear ? thisYear : new Date(Date.UTC(y + 1, 1, 1));
}

const yr = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 1900 ? n : null;
};

export const firstClassFor = (recruitYear) => (yr(recruitYear) ? yr(recruitYear) + 3 : null);
// The last class they can be in: five seasons, or the current class for
// anyone recruited before the rule who is still playing.
export function lastClassFor(recruitYear, current = currentDraftClass()) {
  const r = yr(recruitYear);
  return r ? Math.max(r + 5, Number(current)) : null;
}

// "True", "+1", "+2"…, "Early" (listed before they're eligible), or null
// without a recruit year.
export function classTag(eligible, recruitYear) {
  const first = firstClassFor(recruitYear);
  const e = yr(eligible);
  if (!first || !e) return null;
  const d = e - first;
  return d === 0 ? "True" : d > 0 ? `+${d}` : "Early";
}

// Is the current class their last one (no eligibility left after it)?
export function inFinalYear(eligible, recruitYear, current = currentDraftClass()) {
  const r = yr(recruitYear);
  return !!r && String(eligible) === String(current) && r + 5 <= Number(current);
}

// A ClassHistory entry ({ from, to, reason, at }) — reason "returning" |
// "transfer" | "fix" | "admin".
export const classHistoryEntry = (from, to, reason) => ({ from: String(from || ""), to: String(to), reason, at: new Date().toISOString() });

// Did a recorded move put them in this class (a return, a transfer)?
export const movedInto = (p, eligible = p?.Eligible) => (p?.ClassHistory || []).some((h) => String(h.to) === String(eligible));
