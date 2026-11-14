// src/utils/previewLinks.js
//
// Private preview links — a player's page for whoever has the link, made in
// Admin → Social → Pitch for the Instagram outreach:
//
//   we-draft.com/player/<slug>?preview=<token>
//
// previewLinks/{token}  { playerId, slug, name, fits: [{ abbr, logo }],
//                         posOf, classOf, number, active, createdAt, imageWidth,
//                         imageHeight } — anyone can get() one by its token,
//                         nobody but an admin can list them (firestore.rules),
//                         so only the link's holder can open it.
// previewImages/{token} { jpeg (base64) } — the pitch graphic, admin-only;
//                         api/preview-og.js serves it as the link's preview
//                         image (middleware.js hands it to link-preview bots).
//
// With a valid link the page opens even for an unreleased class (App.js
// UnreleasedGate) and shows the pitch graphic's sample scouting report
// (PreviewContext → PlayerProfile.js): Early First Round, the sample
// strengths, no weaknesses, the link's NFL fits, #1 in their position and
// class, under a SAMPLE watermark. The token is kept for the visit
// (sessionStorage, per slug), so clicking around and back still works.
import { createContext, useContext, useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";

export const PreviewContext = createContext(null);
// The open preview link ({ token, fits, posOf, classOf, … }) or null.
export const usePreviewMode = () => useContext(PreviewContext);

const TOKEN_RE = /^[a-z0-9]{12,40}$/;
const storeKey = (slug) => `wdPreview:${slug}`;
const stored = (slug) => { try { return sessionStorage.getItem(storeKey(slug)) || ""; } catch { return ""; } };
const remember = (slug, token) => { try { sessionStorage.setItem(storeKey(slug), token); } catch { /* storage blocked */ } };

function tokenFor(slug) {
  if (!slug) return "";
  const fromUrl = new URLSearchParams(window.location.search).get("preview") || "";
  const t = (fromUrl || stored(slug)).trim().toLowerCase();
  return TOKEN_RE.test(t) ? t : "";
}

// → { status: "none" | "checking" | "ok", link }. "none" at once when
// there's no token, so ordinary visits never wait on a read.
export function usePreviewLink(slug) {
  const [state, setState] = useState(() => ({ status: tokenFor(slug) ? "checking" : "none", link: null }));
  useEffect(() => {
    const token = tokenFor(slug);
    if (!token) { setState({ status: "none", link: null }); return undefined; }
    setState({ status: "checking", link: null });
    let live = true;
    getDoc(doc(db, "previewLinks", token))
      .then((s) => {
        const d = s.exists() ? s.data() : null;
        const ok = !!d && d.active !== false && d.slug === slug;
        if (ok) remember(slug, token);
        if (live) setState(ok ? { status: "ok", link: { token, ...d } } : { status: "none", link: null });
      })
      .catch(() => { if (live) setState({ status: "none", link: null }); });
    return () => { live = false; };
  }, [slug]);
  return state;
}

export const previewUrl = (slug, token) => `https://we-draft.com/player/${slug}?preview=${token}`;

const newToken = () => {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
};

// Admin: a new link for this player with the graphic as its preview image.
// image: { dataUrl (image/jpeg), width, height }. → the token.
export async function createPreviewLink({ player, fits, posOf, classOf, number, image }) {
  const token = newToken();
  const jpeg = String(image.dataUrl).split(",")[1] || "";
  await setDoc(doc(db, "previewImages", token), { jpeg, createdAt: serverTimestamp() });
  await setDoc(doc(db, "previewLinks", token), {
    playerId: player.id, slug: player.Slug, name: `${player.First || ""} ${player.Last || ""}`.trim(),
    fits: fits.map((f) => ({ abbr: f.abbr, logo: f.logo || "" })),
    posOf: posOf || 1, classOf: classOf || 1,
    // The jersey number typed for the graphic — the page's hero shows it.
    number: String(number || "").replace(/[^0-9]/g, "").slice(0, 2),
    imageWidth: image.width, imageHeight: image.height,
    active: true, createdAt: serverTimestamp(),
  });
  return token;
}

// Admin: this player's links, newest first.
export async function listPreviewLinks(playerId) {
  const s = await getDocs(query(collection(db, "previewLinks"), where("playerId", "==", playerId)));
  return s.docs.map((d) => ({ token: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

export const revokePreviewLink = (token) => updateDoc(doc(db, "previewLinks", token), { active: false });
