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

// Homage margin ads (complete ones only — Link + Image1): one snapshot read,
// or the whole (small) ads collection as the fallback.
export async function fetchAds() {
  const snap = await getSiteSnapshot("_ads");
  if (snap && Array.isArray(snap.rows)) return snap.rows;
  const live = await getDocs(collection(db, "ads"));
  return live.docs.map((d) => d.data()).filter((a) => a.Link && a.Image1);
}
