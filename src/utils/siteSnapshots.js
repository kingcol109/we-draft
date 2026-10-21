// src/utils/siteSnapshots.js
//
// Client-side readers for the precomputed `compSnapshots` docs (built by
// utils/snapshotBuilders.js — see that file for what each doc holds and
// who writes them). Every reader resolves to null when the doc is missing,
// from a different COMP_SNAPSHOT_VERSION, or unreadable (e.g. rules not
// deployed yet) — callers fall back to their original live query then, so
// a missing snapshot only ever costs reads, never breaks a page.
// Each doc is fetched at most once per page session.
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { COMP_SNAPSHOT_VERSION } from "./historicalStats";

const cache = {};
export function getSiteSnapshot(id) {
  if (!(id in cache)) {
    cache[id] = getDoc(doc(db, "compSnapshots", id))
      .then((snap) => {
        const data = snap.exists() ? snap.data() : null;
        return data && data.version === COMP_SNAPSHOT_VERSION ? data : null;
      })
      .catch(() => null);
  }
  return cache[id];
}

// Homage margin ads (complete, unpaused ones only — Link + Image1, Active
// not false; edited in AdminAdsManager.js): one snapshot read,
// or the whole (small) ads collection as the fallback.
export async function fetchAds() {
  const snap = await getSiteSnapshot("_ads");
  if (snap && Array.isArray(snap.rows)) return snap.rows;
  const live = await getDocs(collection(db, "ads"));
  return live.docs.map((d) => d.data()).filter((a) => a.Active !== false && a.Link && a.Image1);
}

// { [abbr]: logo URL } for the margin ads' NFL team picker — rides along on
// the same _ads doc fetchAds already read, so it costs nothing extra. Empty
// (picker falls back to abbreviations) until that doc is rebuilt with it.
export async function fetchAdTeamLogos() {
  const snap = await getSiteSnapshot("_ads");
  return snap?.teamLogos || {};
}

// CFB margin ads — same shape plus School / CFBDTeamId (cfbAds/{schools doc
// id}). _cfbAds is only written by AdminAdsManager.js on save, so the live
// fallback (an empty collection until the first CFB ad exists) is the
// common path before then. Memoized so in-app navigation between player/
// team pages doesn't re-read it.
let cfbAdsPromise = null;
export function fetchCfbAds() {
  if (!cfbAdsPromise) {
    cfbAdsPromise = (async () => {
      const snap = await getSiteSnapshot("_cfbAds");
      if (snap && Array.isArray(snap.rows)) return snap.rows;
      const live = await getDocs(collection(db, "cfbAds"));
      return live.docs.map((d) => d.data()).filter((a) => a.Active !== false && a.Link && a.Image1);
    })().catch(() => []);
  }
  return cfbAdsPromise;
}
