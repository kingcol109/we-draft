// src/components/DraftCardGraphic.jsx
//
// The generic We-Draft.com draft card (utils/instagram/draftCard.js) drawn
// in the browser — the NFL draft targets WX lists (TeamTargetsWX.jsx) and
// their admin (AdminNflTargets.jsx). His action shot: the one picked in
// admin (entry.shot), else his first placed for First Pick (Content →
// Photos); none → his school's logo is the art.
import { useEffect, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import WdLogo from "../assets/wd-badge.png";
import WdWordmark from "../assets/Logo2.png";
import Draft2027 from "../assets/class-logo-2027.png";
import Draft2028 from "../assets/class-logo-2028.png";
import Draft2029 from "../assets/class-logo-2029.png";
import { schoolDoc } from "./ProspectIntroGraphic";
import { placedShots } from "./RiserGraphic";

// The year's draft logo (none → the card uses We-Draft.com's badge).
const DRAFT_LOGOS = { 2027: Draft2027, 2028: Draft2028, 2029: Draft2029 };

const photoCache = new Map();
export const playerShots = (id) => {
  if (!id) return Promise.resolve([]);
  if (!photoCache.has(id)) {
    photoCache.set(id, getDoc(doc(db, "playerPhotos", id)).then((s) => placedShots(s.exists() ? s.data() : null)).catch(() => []));
  }
  return photoCache.get(id);
};

// → an object URL ("" if it can't be drawn). player: { id, first, last,
// pos, school, shot? }; shotUrl: draw with this shot instead.
export async function drawDraftCard({ player, year, shotUrl = "" }) {
  const [kit, g, shots, college] = await Promise.all([
    import("./SocialMakerKit"), import("../utils/instagram/draftCard"), playerShots(player.id), schoolDoc(player.school || ""),
  ]);
  const want = shotUrl || player.shot || "";
  const shot = shots.find((s) => s.url === want) || shots[0] || null;
  const input = g.draftCardInput({ player, college, year, photo: shot, draftLogo: DRAFT_LOGOS[year] || "", brandLogo: WdLogo, wordmark: WdWordmark });
  const env = await kit.envFor(input, input.photo ? { [input.photo]: kit.loadFeatureImage(input.photo, true) } : {}, g.draftCardImageUrls(input));
  return URL.createObjectURL(new Blob([g.draftCardSvg(input, env)], { type: "image/svg+xml" }));
}

// { ref, src } — drawn once the card is near the screen. skip: don't draw
// (the page has the server's image — api/draft-card.js — and only falls back here).
export function useDraftCard({ player, year, skip = false }) {
  const ref = useRef(null);
  const [near, setNear] = useState(false);
  const [src, setSrc] = useState("");
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return undefined;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return undefined; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const key = `${player?.id}|${player?.school}|${player?.shot || ""}`;
  useEffect(() => {
    if (skip || !near || !player?.id) return undefined;
    let live = true;
    let made = "";
    drawDraftCard({ player, year }).then((u) => { made = u; if (live) setSrc(u); }).catch(() => {});
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [near, key, year, skip]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ref, src };
}
