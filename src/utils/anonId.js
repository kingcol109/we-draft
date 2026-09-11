// src/utils/anonId.js
//
// A stable per-browser identifier for a visitor who hasn't signed in, used
// so a logged-out "Like" (see PlayerProfile.js's handleToggleLike) can
// still be toggled on/off from the same browser instead of only ever
// adding — the same shape a real uid gives the reactions/{uid} doc
// pattern, just generated client-side and persisted in localStorage
// instead of coming from Firebase Auth. Prefixed distinctly from real
// Firebase uids so a rule (or a human reading the data) can tell the two
// apart at a glance.
//
// Not a security boundary — clearing site data or switching browsers gets
// a visitor a fresh id (and so a fresh like), and nothing stops someone
// from scripting many fake ids to inflate a count. That's an accepted
// trade-off here (matching how easy real account creation already is),
// not an oversight.
const STORAGE_KEY = "wd_anon_id";

export function getAnonId() {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = "anon_" + (
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2)
    );
    localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Private mode / storage blocked — fall back to a per-call id rather
    // than throwing; the like still goes through, it just won't persist
    // as "already liked" across a reload for this visitor.
    return "anon_" + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
}
