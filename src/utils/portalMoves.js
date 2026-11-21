// src/utils/portalMoves.js
//
// A player's Transfer Portal moves as Firestore writes — one place for them,
// shared by the player editor's portal buttons (pages/AdminPanel.js) and
// Admin → Go's Portal task (components/AdminGo.jsx), so the two can't drift.
// Each returns:
//   write    the players/{id} update (serverTimestamp / deleteField included)
//   local    the same fields as plain values, for the admin's in-memory copy
//   removed  the field names the write deletes (drop them from that copy)
//   message  what happened, for the admin
//
//   enterPortal(p, school)     → in the portal (a new cycle starts clean)
//   withdrawPortal(p)          → withdrew, stays at his school — a real move
//                                 the public Transfer Portal lists
//   resolvePortal(p, school)   → committed to {school}: School moves, the old
//                                 one goes to PriorSchool; a current-class
//                                 player (2027 now) moves to the next class
//                                 (AdminEligibility classChange — "transfer";
//                                 his slug follows on Feb 1)
import { deleteField, serverTimestamp } from "firebase/firestore";
import { activePortalSeason, currentDraftClass } from "./eligibility";
import { classChange } from "../components/AdminEligibility";

export function enterPortal(p, school = "") {
  const fields = {
    InPortal: true,
    // Snapshotted now (not read back off School later) so a stray edit to
    // School while he sits in the portal can't change which school Resolve
    // credits as where he transferred from.
    PortalOriginalSchool: p.School || school || "",
    // The last season played there — the season before the portal's (Jan
    // 2027 is the 2027 portal, so 2026).
    PortalSeasonYear: String(activePortalSeason() - 1),
    // The portal cycle (the season it feeds) — the public Transfer Portal
    // lists a cycle's entries, commits and withdrawals by it.
    PortalCycle: String(activePortalSeason()),
  };
  return {
    write: { ...fields, PortalEnteredAt: serverTimestamp(), PortalCommittedAt: deleteField(), PortalWithdrawnAt: deleteField() },
    local: { ...fields, PortalEnteredAt: new Date() },
    removed: ["PortalCommittedAt", "PortalWithdrawnAt"],
    message: "Moved into the Transfer Portal.",
  };
}

export function withdrawPortal(p) {
  const cycle = p.PortalCycle || String(activePortalSeason());
  return {
    write: {
      InPortal: false, PortalWithdrawnAt: serverTimestamp(), PortalCycle: cycle,
      PortalOriginalSchool: deleteField(), PortalSeasonYear: deleteField(), updatedAt: serverTimestamp(),
    },
    local: { InPortal: false, PortalWithdrawnAt: new Date(), PortalCycle: cycle },
    removed: ["PortalOriginalSchool", "PortalSeasonYear"],
    message: `Withdrew from the portal — stays at ${p.School || "their school"}.`,
  };
}

export function resolvePortal(p, newSchool) {
  const school = String(newSchool || "").trim();
  const bump = p.Eligible === currentDraftClass();
  const move = bump ? classChange(p, String(+p.Eligible + 1), "transfer") : null;
  const base = {
    School: school,
    PriorSchool: p.PortalOriginalSchool || p.School || "",
    PriorSchoolYear: p.PortalSeasonYear || String(activePortalSeason() - 1),
    InPortal: false,
    PortalCycle: p.PortalCycle || String(activePortalSeason()),
  };
  return {
    // PortalEnteredAt stays and PortalCommittedAt is stamped — the public
    // Transfer Portal lists this cycle's committed transfers too.
    write: {
      ...base, PortalCommittedAt: serverTimestamp(), PortalOriginalSchool: deleteField(), PortalSeasonYear: deleteField(),
      updatedAt: serverTimestamp(), ...(move ? move.fields : {}),
    },
    local: { ...base, PortalCommittedAt: new Date(), ...(move ? move.local : {}) },
    removed: ["PortalOriginalSchool", "PortalSeasonYear", ...(move?.removed || [])],
    eligible: move ? move.local.Eligible : p.Eligible,
    message: bump
      ? `Committed to ${school} — moved to the ${move.local.Eligible} class. Slug updates automatically Feb 1.`
      : `Committed to ${school}.`,
  };
}

// A player's in-memory copy after a move.
export function applyMove(p, move) {
  const next = { ...p, ...move.local };
  move.removed.forEach((k) => delete next[k]);
  return next;
}
