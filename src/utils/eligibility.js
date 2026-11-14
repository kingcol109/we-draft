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

// The player page's Info tab (components/PlayerEligibilityInfo.jsx): one
// sentence on the player's college eligibility, in plain words — the
// True / +1 tags stay admin-only. null when there's nothing to say (no
// recruit year, or a class that's already been drafted).
//   declared (the Offseason Manager's lock)  "has declared…" (+ the years
//                                            forgone, when there are any)
//   passed on this draft (a return/transfer  "did not declare… will return
//   out of a class they were eligible for)   with N more years"
//   out of eligibility                       "no college eligibility after…"
//   otherwise                                "N seasons left… as early as
//                                            X, and as late as Y"
// Five seasons of eligibility: RecruitYear through RecruitYear + 4.
// Still a high schooler: their recruiting class hasn't reached college yet
// (a 2027 recruit until the draft class rolls over in May 2027) — a
// promoted recruit, committed but not enrolled.
export function inHighSchool(p, now = new Date()) {
  const ry = yr(p?.RecruitYear);
  return !!ry && ry >= Number(currentDraftClass(now));
}

export function eligibilityInfo(p, now = new Date()) {
  const ry = yr(p?.RecruitYear);
  const E = yr(p?.Eligible);
  const C = Number(currentDraftClass(now));
  if (!ry || !E || E < C) return null;
  const name = `${p.First || ""} ${p.Last || ""}`.trim();
  const lastSeason = ry + 4;
  const n = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;

  if (inHighSchool(p, now)) {
    return `${name} is a high school senior in the class of ${ry}${p.School ? ` and is committed to ${p.School}` : ""}. He can declare for the NFL Draft as early as ${ry + 3}, and as late as ${ry + 5}.`;
  }

  if (p.Declared) {
    const forgone = lastSeason - (E - 1);
    return forgone > 0
      ? `${name} has forgone ${n(forgone, "year")} of college eligibility and has declared for the ${E} NFL Draft.`
      : `${name} has declared for the ${E} NFL Draft.`;
  }
  // Passed on this year's draft: moved out of the current class, which they
  // were eligible for, by a return or a transfer.
  const back = [...(p.ClassHistory || [])].reverse().find((h) => String(h.to) === String(E));
  if (back && (back.reason === "returning" || back.reason === "transfer") && Number(back.from) === C && C >= ry + 3) {
    const left = lastSeason - (C - 1);
    if (left > 0) return `${name} did not declare for the NFL Draft in ${C}. He will return to college with ${n(left, "more year")} of eligibility.`;
  }
  const season = C - 1; // this (or the most recent) college season
  const left = lastSeason - season;
  if (left <= 0) return `${name} will have no college eligibility remaining after ${season} and will be in the ${E} draft class.`;
  return `${name} has ${n(left, "season")} of college eligibility left after this season. This means he can declare for the NFL Draft as early as ${Math.max(ry + 3, C)}, and as late as ${ry + 5}.`;
}

export const ELIGIBILITY_DISCLAIMER = "College eligibility is a tricky thing that varies case by case. We-Draft.com uses the player's recruiting class year and the new 5 for 5 rule to estimate eligibility.";
