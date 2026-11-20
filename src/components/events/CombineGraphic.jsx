// src/components/events/CombineGraphic.jsx
//
// A position's all-time best Combine performer graphic (made in Admin →
// Content → Combine — components/AdminCombine.jsx, saved as
// combineGraphics/{POS}) on its position page (/events/combine/{pos}, the
// Best Performer section): a flip card, his action shot in front, his
// results on the back. Drawn here in the browser with the same module the
// admin uses (utils/instagram/combineLeader.js) — shown only when the saved
// graphic is for the player who's #1 now (a rebuild can change who that is).
import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { nflAbbrFromOrg } from "../../utils/coachHistory";
import { FlipCard, FLIP_CSS } from "../ScoutCard";
import WdLogo from "../../assets/Logo2.png";

const COMBINE_LOGO = "/logos/nfl-combine.png";

// → { front, back } (object URLs) once drawn, null when there's no graphic for him.
export function useCombineGraphic(pos, performer, pool, span) {
  const [out, setOut] = useState(undefined);
  const key = `${pos}|${performer?.name}|${performer?.score}`;
  useEffect(() => {
    if (!pos || !performer) { setOut(null); return undefined; }
    let live = true;
    const made = [];
    (async () => {
      const g = await getDoc(doc(db, "combineGraphics", pos)).catch(() => null);
      const saved = g?.exists() ? g.data() : null;
      if (!saved || saved.name !== performer.name || !saved.photo) return null;
      const photoUrl = saved.photo.kind === "upload"
        ? (await getDoc(doc(db, "combineShots", saved.photo.shotId)).catch(() => null))?.data()?.data || ""
        : saved.photo.url || "";
      if (!photoUrl) return null;
      const abbr = nflAbbrFromOrg(performer.team);
      const [kit, mod, sch, team] = await Promise.all([
        import("../SocialMakerKit"),
        import("../../utils/instagram/combineLeader"),
        performer.school ? getDocs(query(collection(db, "schools"), where("School", "==", performer.school), limit(1))).catch(() => null) : null,
        abbr ? getDoc(doc(db, "nfl", abbr)).catch(() => null) : null,
      ]);
      const t = team?.data() || {};
      const input = mod.combineLeaderInput({
        pos, performer, pool, span, school: sch?.docs[0]?.data() || {}, teamLogo: t.LogoDark || t.Logo1 || "", combineLogo: COMBINE_LOGO,
        photo: { url: photoUrl, adjust: saved.adjust }, headline: saved.headline || "", brandLogo: WdLogo,
      });
      const env = await kit.envFor(input, { [input.photo]: kit.loadFeatureImage(input.photo, saved.cutout !== false) }, mod.combineLeaderImageUrls(input));
      if (!env.images[input.photo]) return null;
      const url = (svg) => { const u = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); made.push(u); return u; };
      return { front: url(mod.combineLeaderFront(input, env)), back: url(mod.combineLeaderBack(input, env)) };
    })().then((r) => live && setOut(r)).catch((e) => { console.error("Combine graphic error:", e); if (live) setOut(null); });
    return () => { live = false; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return out;
}

// The flip card: front and back, as drawn.
export function CombineGraphicCard({ graphic, name, width, isMobile }) {
  return (
    <>
      <style>{FLIP_CSS}</style>
      <FlipCard width={width} radius={isMobile ? 12 : 14} label={`${name}: flip his Combine card`} frontBg="#04203f"
        front={<img src={graphic.front} alt={`${name}, the all-time best Combine performer at his position`} style={{ width: "100%", height: "100%", display: "block" }} />}
        back={<img src={graphic.back} alt={`${name}'s Combine results and percentiles`} style={{ width: "100%", height: "100%", display: "block" }} />} />
    </>
  );
}
