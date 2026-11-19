// src/components/RiserGraphic.jsx
//
// A Draft Riser's graphic (utils/instagram/riser.js) in the browser: on
// /risers/{year} (Risers.jsx) for each riser with an action shot placed for
// First Pick, and as the preview in Admin → Content → Rising Page.
//
// On the live site the page shows the server's image (api/riser-graphic.js —
// one permanent URL per riser, for Google). Local dev has no api/, so there
// (and in the admin's preview) it's drawn here the way the server draws it:
// same module, same image work (SocialMakerKit loadFeatureImage).
import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../firebase";
import WdLogo from "../assets/Logo2.png";
import { riserImageUrl, riserShot } from "../utils/risers";

export const LOCAL = typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
// His action shots placed for First Pick (the ones the graphic can use).
export const placedShots = (photos) => (photos?.action || []).filter((a) => a?.url && a.firstPick);

// Draws it here → an object URL ("" when his photo won't load). shot: a
// placed action shot (else the one saved on him — riserShot).
export async function drawRiser({ riser, rank, year, shots, shot = null }) {
  const pick = shot || riserShot(riser, shots);
  if (!pick) return "";
  const [pl, kit, rs] = await Promise.all([
    getDoc(doc(db, "players", riser.id)).catch(() => null),
    import("./SocialMakerKit"),
    import("../utils/instagram/riser"),
  ]);
  const player = pl?.exists() ? pl.data() : {};
  const schoolName = player.School || riser.school;
  const sch = schoolName ? await getDocs(query(collection(db, "schools"), where("School", "==", schoolName), limit(1))).catch(() => null) : null;
  const input = rs.riserInput({ riser, player, school: sch?.docs[0]?.data() || {}, rank, year, photo: pick, brandLogo: WdLogo, address: `we-draft.com/risers/${year}` });
  const env = await kit.envFor(input, { [input.photo]: kit.loadFeatureImage(input.photo, true) }, rs.riserImageUrls(input));
  if (!env.images[input.photo]) return "";
  return URL.createObjectURL(new Blob([rs.riserSvg(input, env)], { type: "image/svg+xml" }));
}

// { src, srcSet, webpSrcSet, onError } for a riser — src "" when he has no graphic.
// photos: his playerPhotos doc (undefined while loading); version: the
// board's last save (ms), so the image URL changes only when it's re-saved.
// edition: a past edition's date — its graphic as published then.
export function useRiserGraphic({ riser, rank, year, photos, version = "", edition = "" }) {
  const shots = placedShots(photos);
  const has = shots.length > 0;
  const [local, setLocal] = useState("");
  const [failed, setFailed] = useState(false);
  const key = `${riser?.slug}|${riser?.type}|${riser?.shot}|${JSON.stringify(riser?.stats || [])}|${shots.map((s) => s.url).join(",")}`;
  useEffect(() => {
    setFailed(false);
    if (!LOCAL || !has) { setLocal(""); return undefined; }
    let live = true;
    let made = "";
    drawRiser({ riser, rank, year, shots }).then((u) => { made = u; if (live) { setLocal(u); if (!u) setFailed(true); } }).catch(() => live && setFailed(true));
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [key, year]); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = has && !failed && (!LOCAL || !!local);
  return {
    // PNG (the fallback <img>), and the WebP set the page's <picture> prefers.
    src: ok ? (LOCAL ? local : riserImageUrl(riser.slug, year, false, version, "png", edition)) : "",
    srcSet: ok && !LOCAL ? `${riserImageUrl(riser.slug, year, true, version, "png", edition)} 600w, ${riserImageUrl(riser.slug, year, false, version, "png", edition)} 1080w` : "",
    webpSrcSet: ok && !LOCAL ? `${riserImageUrl(riser.slug, year, true, version, "webp", edition)} 600w, ${riserImageUrl(riser.slug, year, false, version, "webp", edition)} 1080w` : "",
    onError: () => setFailed(true),
  };
}
