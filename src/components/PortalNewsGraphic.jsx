// src/components/PortalNewsGraphic.jsx
//
// A Portal News player's graphic (pages/PortalNews.jsx): the Instagram
// transfer covers (utils/instagram/transfer.js) — the portal cover for a
// player who entered, the transfer cover (his entry's design) for one who
// committed — drawn here in the browser from one of his action shots placed
// for First Pick, the way RiserGraphic.jsx draws a riser's locally.
import { useEffect, useState } from "react";
import WdLogo from "../assets/Logo2.png";
import { statsTitleOf, PORTAL_NEWS_PATH, portalImageUrl } from "../utils/portalNews";

export const LOCAL = typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

// His action shots placed for First Pick (the ones the graphic can use).
export const placedShots = (photos) => (photos?.action || []).filter((a) => a?.url && a.firstPick);
// The one his entry names, else his first.
export const newsShot = (entry, shots) => (shots || []).find((s) => s.url === entry?.shot) || (shots || [])[0] || null;

// → an object URL of his cover ("" when his photo won't load).
export async function drawPortalCover({ entry, player, from, to, shot }) {
  if (!shot) return "";
  const [kit, tr] = await Promise.all([import("./SocialMakerKit"), import("../utils/instagram/transfer")]);
  const input = tr.transferInput({
    kind: entry.status === "committed" ? "transfer" : "portal", design: entry.design || "welcome",
    player: { ...player, First: player?.First || entry.first, Last: player?.Last || entry.last, Position: player?.Position || entry.pos },
    from: from || {}, fromName: entry.from, to: to || {}, toName: entry.to || "",
    photo: shot, stats: entry.stats, statsTitle: statsTitleOf(entry),
    // No WD badge top right on the page: the card's flip hint sits there (the footer carries the brand).
    brandLogo: WdLogo, badgeLogo: "", address: `WE-DRAFT.COM${PORTAL_NEWS_PATH.toUpperCase()}`,
  });
  const env = await kit.envFor(input, { [input.photo]: kit.loadFeatureImage(input.photo, true) }, tr.transferImageUrls(input));
  if (!env.images[input.photo]) return "";
  const svg = tr.transferSlides(input, env)[0].svg;
  return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}

// { src, srcSet, webpSrcSet, failed, onError } — src "" until there's one
// (or when he has no placed shot). On the live site, for a published board
// (served), it's the server's image (api/portal-graphic.js — one permanent
// URL per player, for Google and social previews), PNG plus a WebP set the
// page's <picture> prefers; on localhost, the simulation and the admin's
// preview, it's drawn here the way the server draws it.
// photos: his playerPhotos doc (undefined while loading); player: his
// players doc; from / to: the schools docs (undefined while loading);
// version: the board's last save (ms) — the image URL changes only then.
export function usePortalCover({ entry, photos, player, from, to, served = false, version = "" }) {
  const remote = served && !LOCAL;
  const shot = newsShot(entry, placedShots(photos));
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  // Drawn once, with everything in (his players doc: null when there's none).
  const ready = photos !== undefined && player !== undefined && from !== undefined && (entry.status !== "committed" || to !== undefined);
  const key = `${entry.id}|${entry.status}|${entry.design}|${entry.from}|${entry.to}|${shot?.url}|${ready}`;
  useEffect(() => {
    setFailed(false);
    if (remote) { setSrc(""); return undefined; }
    if (!ready) return undefined;
    if (!shot) { setSrc(""); setFailed(true); return undefined; }
    let live = true;
    let made = "";
    drawPortalCover({ entry, player, from, to, shot })
      .then((u) => { made = u; if (live) { setSrc(u); if (!u) setFailed(true); } })
      .catch(() => live && setFailed(true));
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [key, remote]); // eslint-disable-line react-hooks/exhaustive-deps
  if (remote) {
    const has = photos !== undefined && !!shot && !failed;
    const u = (small, fmt) => portalImageUrl(entry.slug, small, version, fmt);
    return {
      src: has ? u(false, "png") : "",
      srcSet: has ? `${u(true, "png")} 600w, ${u(false, "png")} 1080w` : "",
      webpSrcSet: has ? `${u(true, "webp")} 600w, ${u(false, "webp")} 1080w` : "",
      failed: failed || (photos !== undefined && !shot), onError: () => setFailed(true),
    };
  }
  return { src, srcSet: "", webpSrcSet: "", failed, onError: () => setFailed(true) };
}
