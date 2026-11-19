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
import WdLogo from "../assets/Logo2.png";
import { loadPhotosDoc, loadNflDoc, loadPlayerDoc, loadSchoolDoc } from "../utils/photoDocs";
import { lockedShot } from "../utils/instagram/firstPick";

const SITE = "https://we-draft.com";
// The graphic's permanent URL for a team page (its full 1080 × 1350 — the
// one to index), and the smaller copy screens that don't need it get.
// overall: one of the team's other picks (the full mock's cards for a team's
// second first-rounder) — its own image; without it, the team's first pick.
// week: the week's id — its image, cached for good (the shot is locked for
// the week); without it, the permanent URL (always the current week's).
export const firstPickImageUrl = (team, year, small = false, overall = 0, week = "") =>
  `${SITE}/api/first-pick?team=${String(team).toLowerCase()}&year=${year}${overall ? `&pick=${overall}` : ""}${small ? "&w=600" : ""}${week ? `&v=${encodeURIComponent(week)}` : ""}`;

// Local dev (npm start) has no api/ — the live site's image URL is only
// there once deployed — so on localhost the graphic is drawn here instead,
// the way the server draws it (same module, same image work), to preview.
const LOCAL = typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
// address: the line along the graphic's foot (default: the team's mock page).
async function drawLocally(pick, team, year, shots, week, address = "") {
  const p = pick.player;
  const shot = lockedShot(shots, week, team, pick.overall);
  // Each once a session (utils/photoDocs.js) — a team or school read once
  // however many of its picks are drawn.
  const [nfl, pl, sch, kit, fp] = await Promise.all([
    loadNflDoc(team),
    loadPlayerDoc(p.id),
    loadSchoolDoc(p.School),
    import("./SocialMakerKit"),
    import("../utils/instagram/firstPick"),
  ]);
  const input = fp.firstPickInput({
    player: { ...(pl || {}), ...p }, school: sch || (p.logo ? { Logo1: p.logo } : {}),
    team: nfl || {}, abbr: team, pick: { overall: pick.overall, round: pick.round }, year, photo: shot, brandLogo: WdLogo,
    address: address || `we-draft.com/mocks/${team.toLowerCase()}${year === "2027" ? "" : `/${year}`}`,
  });
  const overrides = { [input.photo]: kit.loadFeatureImage(input.photo, true) };
  [input.wordmark, input.bgLogo].filter(Boolean).forEach((u) => { if (u !== input.photo) overrides[u] = kit.loadFeatureImage(u, true, { ink: true }); });
  const env = await kit.envFor(input, overrides, fp.firstPickImageUrls(input));
  if (!env.images[input.photo]) return "";
  return URL.createObjectURL(new Blob([fp.firstPickSvg(input, env)], { type: "image/svg+xml" }));
}

// The graphic for any pick, drawn here in the browser — no server, no
// cost (the Draft Sim's card for the user's first pick, SimBroadcast.jsx):
// pick: { player: { id, First, Last, Position, School, logo? }, overall,
// round }; team: "NYJ"; year: the class; address: the foot's line. → an
// object URL (revoke it when done), or "" when he has no placed shot or
// his photo won't load.
export async function drawFirstPickCard({ pick, team, year, address = "" }) {
  const id = pick?.player?.id;
  if (!id) return "";
  const shots = await placedShotsOf(id);
  if (!shots.length) return "";
  return drawLocally(pick, team, year, shots, "", address).catch(() => "");
}

// A player's placed shots (playerPhotos action[i].firstPick), one read each
// per session — whether he gets a graphic is known before it's drawn.
const placedShots = new Map();
export function placedShotsOf(id) {
  if (!id) return Promise.resolve([]);
  if (!placedShots.has(id)) {
    // The same read as his headshot's (utils/photoDocs.js).
    placedShots.set(id, loadPhotosDoc(id).then((ph) => (ph?.action || []).filter((a) => a?.url && a.firstPick)).catch(() => []));
  }
  return placedShots.get(id);
}
// → whether he has a placed shot: undefined until the read's in.
export function useHasPlacedShot(id) {
  const [has, setHas] = useState(undefined);
  useEffect(() => {
    let live = true;
    setHas(undefined);
    if (!id) { setHas(false); return undefined; }
    placedShotsOf(id).then((s) => live && setHas(s.length > 0));
    return () => { live = false; };
  }, [id]);
  return has;
}

// The Draft Sim's drawn pick cards (every user pick), once each per
// session: the stage starts one at "the pick is in" (startSimPickCard), the
// Desk's post shows it (useSimPickCard). card: { id, first, last, pos,
// school, logo?, pick (overall), round, team, year }.
// Drawing one is about a second of the browser's own work (cutting him out
// of his photo), so they're drawn one at a time, each when the browser is
// idle — the sim's animations and clicks always come first.
const simPickCards = new Map();
const simPickKey = (c) => (c?.id ? `${c.year}|${c.team}|${c.pick}|${c.id}` : "");
let drawQueue = Promise.resolve();
const whenIdle = () => new Promise((resolve) => {
  if (typeof window !== "undefined" && window.requestIdleCallback) window.requestIdleCallback(() => resolve(), { timeout: 2000 });
  else setTimeout(resolve, 80);
});
export function startSimPickCard(c) {
  const key = simPickKey(c);
  if (!key || simPickCards.has(key)) return;
  const draw = () => drawFirstPickCard({
    pick: { player: { id: c.id, First: c.first, Last: c.last, Position: c.pos, School: c.school, ...(c.logo ? { logo: c.logo } : {}) }, overall: c.pick, round: c.round || 1 },
    team: c.team, year: c.year, address: "we-draft.com/draftsim",
  }).catch(() => "");
  const job = drawQueue.then(whenIdle).then(draw);
  drawQueue = job.catch(() => {});
  simPickCards.set(key, job.then((url) => { simPickCards.set(key, url); return url; }));
}
// → its object URL once drawn; "" before then, or when he has no placed
// shot. enabled: false holds off drawing it (the post isn't near the screen).
export function useSimPickCard(c, enabled = true) {
  const key = simPickKey(c);
  const [src, setSrc] = useState(() => (key && typeof simPickCards.get(key) === "string" ? simPickCards.get(key) : ""));
  useEffect(() => {
    if (!key) { setSrc(""); return undefined; }
    const ready = simPickCards.get(key);
    if (!enabled && !ready) return undefined;
    let live = true;
    startSimPickCard(c);
    Promise.resolve(simPickCards.get(key)).then((url) => live && setSrc(url || ""));
    return () => { live = false; };
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return src;
}

// { checked (the read's done), src, srcSet, onError } — src "" when there's
// no graphic (no placed shot, or the image wouldn't load).
// pick: { player: { id } } (the team's first pick); team: "NYJ"; year: the class.
// notFirst: the pick isn't the team's first — its image by its number.
// week: the week's id (weeklyMocks/{id}) — its locked image (see above).
export function useFirstPickGraphic({ pick, team, year, notFirst = false, week = "" }) {
  const id = pick?.player?.id || "";
  const [state, setState] = useState({ id: "", ok: false, checked: false, failed: false, local: "" });
  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    let made = "";
    setState({ id, ok: false, checked: false, failed: false, local: "" });
    placedShotsOf(id)
      .then(async (shots) => {
        if (!live) return;
        setState({ id, ok: shots.length > 0, checked: true, failed: false, local: "" });
        if (LOCAL && shots.length) {
          made = await drawLocally(pick, team, year, shots, week).catch(() => "");
          if (live) setState((s) => ({ ...s, local: made, failed: !made }));
        }
      })
      .catch(() => { if (live) setState({ id, ok: false, checked: true, failed: false, local: "" }); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [id, team, year, week]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = state.id === id;
  const ok = !!id && mine && state.ok && !state.failed && (!LOCAL || !!state.local);
  return {
    checked: !id || (mine && state.checked),
    src: ok ? (LOCAL ? state.local : firstPickImageUrl(team, year, false, notFirst ? pick?.overall : 0, week)) : "",
    srcSet: ok && !LOCAL ? `${firstPickImageUrl(team, year, true, notFirst ? pick?.overall : 0, week)} 600w, ${firstPickImageUrl(team, year, false, notFirst ? pick?.overall : 0, week)} 1080w` : "",
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
