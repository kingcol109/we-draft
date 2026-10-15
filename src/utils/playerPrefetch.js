// src/utils/playerPrefetch.js
//
// Starts a /player/:slug page's core player query the moment the app boots
// (App.js), instead of only once PlayerProfile.js's lazy chunk has
// downloaded and mounted — the chunk download and the Firestore read then
// overlap rather than running back to back, so the header lands a full
// round trip sooner on a cold visit. The player's school (team colors and
// logos for the hero) is chained on the instant the player doc arrives,
// rather than after React has rendered the page and run its effects.
// PlayerProfile.js takes each in-flight query if one exists; each prefetch
// is used once, so a later visit reads fresh.
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";

const pendingPlayers = new Map();
const pendingSchools = new Map();

export function queryPlayerBySlug(slug) {
  return getDocs(query(collection(db, "players"), where("Slug", "==", slug)));
}

export function querySchoolByName(school) {
  return getDocs(query(collection(db, "schools"), where("School", "==", school)));
}

export function prefetchPlayerFromUrl() {
  if (typeof window === "undefined") return;
  const m = /^\/player\/([^/]+)/.exec(window.location.pathname);
  if (!m) return;
  let slug;
  try { slug = decodeURIComponent(m[1]); } catch { return; }
  const p = queryPlayerBySlug(slug);
  p.then((snap) => {
    const school = snap.docs[0]?.data()?.School;
    if (school && !pendingSchools.has(school)) {
      const s = querySchoolByName(school);
      s.catch(() => {});
      pendingSchools.set(school, s);
    }
  }).catch(() => {}); // the page re-queries on failure; never an unhandled rejection
  pendingPlayers.set(slug, p);
}

// The prefetched query for this slug if one is in flight, else a fresh one.
export function takePlayerBySlug(slug) {
  const p = pendingPlayers.get(slug);
  pendingPlayers.delete(slug);
  return p ? p.catch(() => queryPlayerBySlug(slug)) : queryPlayerBySlug(slug);
}

// Same, for the player's school doc.
export function takeSchoolByName(school) {
  const p = pendingSchools.get(school);
  pendingSchools.delete(school);
  return p ? p.catch(() => querySchoolByName(school)) : querySchoolByName(school);
}
