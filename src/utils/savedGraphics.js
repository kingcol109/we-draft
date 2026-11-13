// src/utils/savedGraphics.js
//
// Whiteboard graphics a user saved to their account
// (users/{uid}/savedGraphics/{auto id}), from the share dialog
// (pages/Whiteboard.js ShareGraphicDialog); the profile's Boards tab lists
// them (components/profileHub/SavedGraphics.jsx). A save keeps what the
// graphic showed — its settings and the players on it, pills and all — so
// it redraws the same later however the board has changed since. Only the
// headshots and school logos are looked up again.
//
// Also the image lookups the graphic needs (headshots from playerPhotos,
// dark-background school logos), cached for the page session.
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, where } from "firebase/firestore";
import { db } from "../firebase";
import { drawWhiteboardGraphic, canvasToBlob } from "./whiteboardGraphic";

export const headshotCache = new Map();
export const logoCache = new Map();

export async function loadHeadshots(ids) {
  const need = ids.filter((id) => !headshotCache.has(id));
  await Promise.all(need.map((id) => getDoc(doc(db, "playerPhotos", id))
    .then((s) => headshotCache.set(id, s.exists() ? s.data().headshot?.url || "" : ""))
    .catch(() => headshotCache.set(id, ""))));
}

export async function loadLogos(schools) {
  const need = [...new Set(schools.filter((s) => s && !logoCache.has(s)))];
  for (let i = 0; i < need.length; i += 30) {
    const chunk = need.slice(i, i + 30);
    const snap = await getDocs(query(collection(db, "schools"), where("School", "in", chunk))).catch(() => null);
    chunk.forEach((s) => logoCache.set(s, ""));
    // The graphic's background is dark: a school's dark-background logo first.
    (snap?.docs || []).forEach((d) => { const x = d.data(); logoCache.set(x.School, x.LogoDark || x.Logo1 || x.Logo2 || ""); });
  }
}

// spec: drawWhiteboardGraphic's arguments (players without images). Loads
// the images the rows show, draws, → a PNG Blob.
export async function renderGraphic(spec) {
  const count = spec.mode === "top5" ? 5 : spec.mode === "top10" || spec.list ? 10 : 0;
  const top = spec.players.slice(0, count);
  await Promise.all([loadHeadshots(top.map((p) => p.id)), loadLogos(top.map((p) => p.School))]);
  const players = spec.players.map((p) => ({ ...p, headshot: headshotCache.get(p.id) || "", logo: logoCache.get(p.School) || "" }));
  return canvasToBlob(await drawWhiteboardGraphic({ ...spec, players }));
}

// The player fields a saved graphic keeps.
const KEEP = ["id", "First", "Last", "School", "SchoolShort", "round", "starred", "flagged", "posLabel", "color", "pills"];
const slim = (p) => Object.fromEntries(KEEP.filter((k) => p[k] !== undefined && p[k] !== "").map((k) => [k, p[k]]));

// spec as for renderGraphic, plus title (the list's name, for the profile).
// Keeps only the players the graphic shows.
export async function saveGraphic(uid, spec, title) {
  const count = spec.mode === "top5" ? 5 : spec.mode === "top10" || spec.list ? 10 : spec.players.length;
  const { players, ...rest } = spec;
  const ref = await addDoc(collection(db, "users", uid, "savedGraphics"), {
    kind: "whiteboard", title, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
    players: players.slice(0, count).map(slim), createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function listSavedGraphics(uid, max = 24) {
  const snap = await getDocs(query(collection(db, "users", uid, "savedGraphics"), orderBy("createdAt", "desc"), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export const deleteSavedGraphic = (uid, id) => deleteDoc(doc(db, "users", uid, "savedGraphics", id));
