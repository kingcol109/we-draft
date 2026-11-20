// src/components/SeniorBowlPerfGraphic.jsx
//
// A Senior Bowl Top Performer's graphic (utils/instagram/seniorBowlPerf.js)
// in the browser: on /events/senior-bowl/{year}/performances and as the
// preview in Admin → Content → Senior Bowl. Like RiserGraphic.jsx: the live
// site shows the server's image (api/senior-bowl-graphic.js — one permanent
// URL per performer); local dev (no api/) and the admin draw it here, the
// same way the server does.
import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../firebase";
import WdLogo from "../assets/Logo2.png";
import { perfImageUrl, perfShot } from "../utils/seniorBowlPerf";
import { LOCAL, placedShots } from "./RiserGraphic";

const EVENT_LOGO = "/logos/senior-bowl.png";

// Draws it here → an object URL ("" when his photo won't load).
export async function drawPerf({ perf, year, shots, shot = null }) {
  const pick = shot || perfShot(perf, shots);
  if (!pick) return "";
  const [pl, kit, g] = await Promise.all([
    getDoc(doc(db, "players", perf.id)).catch(() => null),
    import("./SocialMakerKit"),
    import("../utils/instagram/seniorBowlPerf"),
  ]);
  const player = pl?.exists() ? pl.data() : {};
  const schoolName = player.School || perf.school;
  const sch = schoolName ? await getDocs(query(collection(db, "schools"), where("School", "==", schoolName), limit(1))).catch(() => null) : null;
  const input = g.perfInput({ perf, player, school: sch?.docs[0]?.data() || {}, year, photo: pick, eventLogo: EVENT_LOGO, brandLogo: WdLogo });
  const env = await kit.envFor(input, { [input.photo]: kit.loadFeatureImage(input.photo, true) }, g.perfImageUrls(input));
  if (!env.images[input.photo]) return "";
  return URL.createObjectURL(new Blob([g.perfSvg(input, env)], { type: "image/svg+xml" }));
}

// { src, srcSet, webpSrcSet, onError } — src "" when he has no graphic.
// version: the list's last save (ms); edition: a past edition's date.
export function usePerfGraphic({ perf, year, photos, version = "", edition = "" }) {
  const shots = placedShots(photos);
  const has = shots.length > 0;
  const [local, setLocal] = useState("");
  const [failed, setFailed] = useState(false);
  const key = `${perf?.slug}|${perf?.team}|${perf?.shot}|${shots.map((s) => s.url).join(",")}`;
  useEffect(() => {
    setFailed(false);
    if (!LOCAL || !has) { setLocal(""); return undefined; }
    let live = true;
    let made = "";
    drawPerf({ perf, year, shots }).then((u) => { made = u; if (live) { setLocal(u); if (!u) setFailed(true); } }).catch(() => live && setFailed(true));
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [key, year]); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = has && !failed && (!LOCAL || !!local);
  const url = (small, fmt) => perfImageUrl(perf.slug, year, small, version, fmt, edition);
  return {
    src: ok ? (LOCAL ? local : url(false, "png")) : "",
    srcSet: ok && !LOCAL ? `${url(true, "png")} 600w, ${url(false, "png")} 1080w` : "",
    webpSrcSet: ok && !LOCAL ? `${url(true, "webp")} 600w, ${url(false, "webp")} 1080w` : "",
    onError: () => setFailed(true),
  };
}
