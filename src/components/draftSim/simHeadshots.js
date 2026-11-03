// src/components/draftSim/simHeadshots.js
//
// Headshots for the pick card and the We-Draft desk's profile cards:
// playerPhotos/{playerId}.headshot (Admin → Content → Photos; ESPN's
// transparent 600×436 head-and-shoulders PNGs). A prospect's id is his
// players doc id. Loaded once each, from "the pick is in" (Stage prefetches
// it) so the card has it when it turns over; the image is warmed too. resolvedHeadshots holds the finished lookups so a
// card mounting after one has the photo on its first frame.
import { useEffect, useState } from "react";
import { doc as fsDoc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";

const headshots = new Map();
const resolvedHeadshots = new Map();
export function loadHeadshot(id) {
  if (!id) return Promise.resolve("");
  if (!headshots.has(id)) {
    headshots.set(id, getDoc(fsDoc(db, "playerPhotos", id))
      .then((snap) => (snap.exists() ? snap.data().headshot?.url || "" : ""))
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
