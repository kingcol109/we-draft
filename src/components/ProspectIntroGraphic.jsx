// src/components/ProspectIntroGraphic.jsx
//
// The high school prospect card (utils/instagram/prospectIntro.js) drawn in
// the browser — on "Meet the Class of 2030" (pages/ClassIntro.jsx), the
// Early Look (pages/EarlyLook.jsx) and as their admin previews. These pages
// aren't released yet, so there's no server image (as the risers have) —
// when they launch, a server endpoint can draw the same SVG.
//
// What it gathers: his college (schools by name — logo, colors), his high
// school (highSchools by name + state — its logo), his state's outline
// (utils/usStatesGeo.js, straight) and, when he has one, an action shot
// placed for First Pick (playerPhotos — class of 2030 players only).
import { useEffect, useRef, useState } from "react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../firebase";
import WdLogo from "../assets/Logo2.png";
import { STATE_ABBR, stateName } from "../utils/highSchoolMatch";

const schoolCache = new Map();
export const schoolDoc = (name) => {
  if (!name) return Promise.resolve(null);
  if (!schoolCache.has(name)) {
    schoolCache.set(name, getDocs(query(collection(db, "schools"), where("School", "==", name), limit(1)))
      .then((s) => (s.docs[0] ? s.docs[0].data() : null)).catch(() => null));
  }
  return schoolCache.get(name);
};
const hsCache = new Map();
const hsDoc = (name, state) => {
  if (!name) return Promise.resolve(null);
  const st = stateName(state);
  const key = `${name}|${st}`;
  if (!hsCache.has(key)) {
    hsCache.set(key, getDocs(query(collection(db, "highSchools"), where("Name", "==", name)))
      .then((s) => {
        const docs = s.docs.map((d) => d.data());
        return docs.find((d) => !st || d.State === st) || (docs.length === 1 ? docs[0] : null);
      }).catch(() => null));
  }
  return hsCache.get(key);
};
export const stateAbbrOf = (s) => {
  const v = String(s || "").trim();
  return v.length === 2 ? v.toUpperCase() : STATE_ABBR[v] || STATE_ABBR[stateName(v)] || "";
};

// Draws it → an object URL ("" if it can't be drawn).
// entry: { first, last, pos, hs, state, school | commit }; shot: a placed
// action shot or null.
export async function drawProspect({ kind, entry, tag, kicker, address, shot = null }) {
  const [kit, g, geo] = await Promise.all([
    import("./SocialMakerKit"), import("../utils/instagram/prospectIntro"), import("../utils/usStatesGeo"),
  ]);
  const [college, hs] = await Promise.all([schoolDoc(entry.school || entry.commit || ""), hsDoc(entry.hs, entry.state)]);
  const abbr = stateAbbrOf(entry.state);
  const shape = abbr ? geo.usStates()[abbr] : null;
  const input = g.prospectInput({ kind, entry, tag, kicker, college, hs, stateShape: shape ? { abbr, ...shape } : null, photo: shot, brandLogo: WdLogo, address });
  const env = await kit.envFor(input, input.photo ? { [input.photo]: kit.loadFeatureImage(input.photo, true) } : {}, g.prospectImageUrls(input));
  return URL.createObjectURL(new Blob([g.prospectSvg(input, env)], { type: "image/svg+xml" }));
}

// { ref, src, college } — draws once the card is near the screen (a page has
// ~40 of them). key: redraw when it changes.
export function useProspectGraphic({ kind, entry, tag, kicker, address, shot = null, key = "" }) {
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
  useEffect(() => {
    if (!near) return undefined;
    let live = true;
    let made = "";
    drawProspect({ kind, entry, tag, kicker, address, shot }).then((u) => { made = u; if (live) setSrc(u); }).catch(() => {});
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [near, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ref, src };
}
