// src/components/FirstPickGraphic.jsx
//
// The First Pick graphic on a team's Weekly Mock page (WeeklyTeamMock.jsx),
// for the team's first pick — only when that player has a qualifying
// action shot: one placed for the graphic in Admin → Content → Photos
// (playerPhotos action[i].firstPick). No shot placed, nothing shows — it
// never falls back to a later pick or an unplaced photo. Desktop shows it
// in the page's header (ArticleHero's aside); phones above the pick.
//
// The image itself comes from the server (api/first-pick.js →
// server/firstPickImage.mjs): one permanent URL per team page, so Google
// indexes the current graphic and only ever that one. The server draws it
// as the admin's placement editor does and picks one of his placed shots
// at random. Here: one read (his playerPhotos doc) to know there is one.
import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../firebase";
import WdLogo from "../assets/Logo2.png";

const SITE = "https://we-draft.com";
// The graphic's permanent URL for a team page (its full 1080 × 1350 — the
// one to index), and the smaller copy screens that don't need it get.
export const firstPickImageUrl = (team, year, small = false) => `${SITE}/api/first-pick?team=${String(team).toLowerCase()}&year=${year}${small ? "&w=600" : ""}`;

// Local dev (npm start) has no api/ — the live site's image URL is only
// there once deployed — so on localhost the graphic is drawn here instead,
// the way the server draws it (same module, same image work), to preview.
const LOCAL = typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
async function drawLocally(pick, team, year, shots) {
  const p = pick.player;
  const shot = shots[Math.floor(Math.random() * shots.length)];
  const [nfl, pl, sch, kit, fp] = await Promise.all([
    getDoc(doc(db, "nfl", team)).catch(() => null),
    getDoc(doc(db, "players", p.id)).catch(() => null),
    p.School ? getDocs(query(collection(db, "schools"), where("School", "==", p.School), limit(1))).catch(() => null) : null,
    import("./SocialMakerKit"),
    import("../utils/instagram/firstPick"),
  ]);
  const input = fp.firstPickInput({
    player: { ...(pl?.exists() ? pl.data() : {}), ...p }, school: sch?.docs[0]?.data() || (p.logo ? { Logo1: p.logo } : {}),
    team: nfl?.exists() ? nfl.data() : {}, abbr: team, pick: { overall: pick.overall, round: pick.round }, year, photo: shot, brandLogo: WdLogo,
    address: `we-draft.com/mocks/${team.toLowerCase()}${year === "2027" ? "" : `/${year}`}`,
  });
  const overrides = {};
  [input.photo, input.wordmark, input.bgLogo].filter(Boolean).forEach((u) => { overrides[u] = kit.loadFeatureImage(u, true); });
  const env = await kit.envFor(input, overrides, fp.firstPickImageUrls(input));
  if (!env.images[input.photo]) return "";
  return URL.createObjectURL(new Blob([fp.firstPickSvg(input, env)], { type: "image/svg+xml" }));
}

// { checked (the read's done), src, srcSet, onError } — src "" when there's
// no graphic (no placed shot, or the image wouldn't load).
// pick: { player: { id } } (the team's first pick); team: "NYJ"; year: the class.
export function useFirstPickGraphic({ pick, team, year }) {
  const id = pick?.player?.id || "";
  const [state, setState] = useState({ id: "", ok: false, checked: false, failed: false, local: "" });
  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    let made = "";
    setState({ id, ok: false, checked: false, failed: false, local: "" });
    getDoc(doc(db, "playerPhotos", id))
      .then(async (ph) => {
        const shots = (ph.exists() ? ph.data().action || [] : []).filter((a) => a?.url && a.firstPick);
        if (!live) return;
        setState({ id, ok: shots.length > 0, checked: true, failed: false, local: "" });
        if (LOCAL && shots.length) {
          made = await drawLocally(pick, team, year, shots).catch(() => "");
          if (live) setState((s) => ({ ...s, local: made, failed: !made }));
        }
      })
      .catch(() => { if (live) setState({ id, ok: false, checked: true, failed: false, local: "" }); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [id, team, year]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = state.id === id;
  const ok = !!id && mine && state.ok && !state.failed && (!LOCAL || !!state.local);
  return {
    checked: !id || (mine && state.checked),
    src: ok ? (LOCAL ? state.local : firstPickImageUrl(team, year)) : "",
    srcSet: ok && !LOCAL ? `${firstPickImageUrl(team, year, true)} 600w, ${firstPickImageUrl(team, year)} 1080w` : "",
    onError: () => setState((s) => ({ ...s, failed: true })),
  };
}

// The graphic. g: useFirstPickGraphic's; sizes: how wide it shows (srcset);
// nick: the team's ("Jets"), for the alt text.
export function FirstPickImage({ g, pick, nick, year, sizes, style }) {
  const p = pick?.player;
  if (!g?.src || !p) return null;
  return (
    <img src={g.src} srcSet={g.srcSet} sizes={sizes} width={1080} height={1350} onError={g.onError} decoding="async"
      alt={`${p.First} ${p.Last}, ${p.Position}, ${p.School}: the ${nick}' first pick, No. ${pick.overall}, in We-Draft.com's ${year} mock draft`}
      style={{ width: "100%", height: "auto", display: "block", background: "rgba(0,0,0,0.15)", ...style }} />
  );
}
