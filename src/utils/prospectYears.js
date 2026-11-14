// src/utils/prospectYears.js
//
// The draft classes the site treats as current prospects — the Community
// Board and My Boards year tabs, team pages' prospect lists, comparisons,
// staff pages' prospect matches, and the class-rank snapshots
// (scripts/buildSiteSnapshots.mjs and buildGradeSnapshots.mjs keep their own
// copy; update them together).
//
// 2030 is the 2027 recruiting class, promoted from Admin → Players →
// Recruits (Dec 2026). A class's tab stays hidden until it has at least one
// player (useVisibleProspectYears), so it can be listed here before its
// pages exist without showing an empty class.
import { useEffect, useState } from "react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../firebase";

export const PROSPECT_YEARS = ["2027", "2028", "2029", "2030"];
// Classes known to have players — no lookup needed for these.
const ESTABLISHED = new Set(["2027", "2028", "2029"]);

// One read per newer class per page load, shared by every caller.
const hasPlayers = new Map();
function classHasPlayers(year) {
  if (!hasPlayers.has(year)) {
    hasPlayers.set(year, getDocs(query(collection(db, "players"), where("Eligible", "==", year), limit(1)))
      .then((s) => !s.empty)
      .catch(() => false));
  }
  return hasPlayers.get(year);
}

// The prospect years to show as tabs/chips: the established ones at once,
// a newer class once it has a player. `years` defaults to PROSPECT_YEARS.
export function useVisibleProspectYears(years = PROSPECT_YEARS) {
  const [shown, setShown] = useState(() => years.filter((y) => ESTABLISHED.has(y)));
  const key = years.join(",");
  useEffect(() => {
    let live = true;
    Promise.all(years.map((y) => (ESTABLISHED.has(y) ? true : classHasPlayers(y)))).then((ok) => {
      if (live) setShown(years.filter((_, i) => ok[i]));
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return shown;
}
