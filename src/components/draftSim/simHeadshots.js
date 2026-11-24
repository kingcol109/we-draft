// src/components/draftSim/simHeadshots.js
//
// Headshots for the pick card and the We-Draft desk's profile cards:
// playerPhotos/{playerId}.headshot (Admin → Content → Photos; ESPN's
// transparent 600×436 head-and-shoulders PNGs). A prospect's id is his
// players doc id. Loaded once each, from "the pick is in" (Stage prefetches
// it) so the card has it when it turns over; the image is warmed too. resolvedHeadshots holds the finished lookups so a
// card mounting after one has the photo on its first frame.
import { useEffect, useState } from "react";
import { loadPhotosDoc } from "../../utils/photoDocs";

const headshots = new Map();
const resolvedHeadshots = new Map();
// A re-draft's players are in the NFL now: their current ESPN NFL headshots
// (data.js — the re-draft file's { [player id]: ESPN id }) over the college ones.
const ESPN_NFL = (espn) => `https://a.espncdn.com/i/headshots/nfl/players/full/${espn}.png`;
export function setHeadshotOverrides(map = {}) {
  Object.entries(map).forEach(([id, espn]) => {
    const url = ESPN_NFL(espn);
    headshots.set(id, Promise.resolve(url));
    resolvedHeadshots.set(id, url);
  });
}
export function loadHeadshot(id) {
  if (!id) return Promise.resolve("");
  if (!headshots.has(id)) {
    // The same read as his pick graphic's placed shots (utils/photoDocs.js).
    headshots.set(id, loadPhotosDoc(id)
      .then((ph) => ph?.headshot?.url || "")
      .catch(() => "")
      .then((url) => {
        if (url) new Image().src = url;
        resolvedHeadshots.set(id, url);
        return url;
      }));
  }
  return headshots.get(id);
}
export function useHeadshot(id) {
  const [url, setUrl] = useState(() => resolvedHeadshots.get(id) || "");
  useEffect(() => {
    let live = true;
    setUrl(resolvedHeadshots.get(id) || "");
    loadHeadshot(id).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [id]);
  return url;
}
