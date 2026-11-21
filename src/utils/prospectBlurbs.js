// src/utils/prospectBlurbs.js
//
// Generic prospect write-ups (user, 2026-11-21): 1–2 sentences about a
// player that aren't about any one team — shown under his row whenever he's
// on a team's NFL Targets list (components/TeamTargetsWX.jsx), and as a
// featured player's write-up until that team has its own. Managed in
// Admin → Content → WX → NFL Targets (AdminNflTargets.jsx).
//
//   config/prospectBlurbs { blurbs: { [playerId]: { text, name, updatedAt (ms) } } }
// One doc (public read, admin write — the config rules), so the page reads
// every write-up in one go. A save touches only its own player's field.
import { deleteField, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";

const REF = () => doc(db, "config", "prospectBlurbs");
let cached = null;

// → { [playerId]: text }
export function loadBlurbs(fresh = false) {
  if (!cached || fresh) {
    cached = getDoc(REF())
      .then((s) => Object.fromEntries(Object.entries((s.exists() ? s.data().blurbs : null) || {}).map(([id, b]) => [id, String(b?.text || "")]).filter(([, t]) => t.trim())))
      .catch(() => ({}));
  }
  return cached;
}

// Saves (or, blank, removes) one player's write-up. name: for reading the doc by eye.
export async function saveBlurb(id, text, name = "") {
  const t = String(text || "").trim();
  const value = t ? { text: t, name, updatedAt: Date.now() } : deleteField();
  try {
    await updateDoc(REF(), { [`blurbs.${id}`]: value });
  } catch (e) {
    if (e?.code !== "not-found" || !t) throw e;
    await setDoc(REF(), { blurbs: { [id]: value } }, { merge: true });
  }
  if (cached) cached = cached.then((m) => { const n = { ...m }; if (t) n[id] = t; else delete n[id]; return n; });
}

// The write-up a player's shown with: the team's own (featured note) first, else the generic one.
export const writeUpFor = (entry, blurbs) => (String(entry?.note || "").trim() || blurbs?.[entry?.id] || "");
