// src/utils/photoDocs.js
//
// Reads the pick graphics share, each once a session: a player's
// playerPhotos doc (his headshot and his placed action shots — the Draft
// Sim's headshots, simHeadshots.js, and its pick graphics,
// FirstPickGraphic.jsx, read the same doc, so it's one read for both), an
// NFL team's nfl/{abbr} doc, a school's schools doc by name, a player's
// players doc. Each → a promise of its data, or null.
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../firebase";

const cache = new Map();
const once = (key, read) => {
  if (!cache.has(key)) cache.set(key, read().catch(() => null));
  return cache.get(key);
};

export const loadPhotosDoc = (id) => (id ? once(`photos|${id}`, () => getDoc(doc(db, "playerPhotos", id)).then((s) => (s.exists() ? s.data() : null))) : Promise.resolve(null));
export const loadNflDoc = (abbr) => (abbr ? once(`nfl|${abbr}`, () => getDoc(doc(db, "nfl", abbr)).then((s) => (s.exists() ? s.data() : null))) : Promise.resolve(null));
export const loadPlayerDoc = (id) => (id ? once(`player|${id}`, () => getDoc(doc(db, "players", id)).then((s) => (s.exists() ? s.data() : null))) : Promise.resolve(null));
export const loadSchoolDoc = (name) => (name ? once(`school|${name}`, () => getDocs(query(collection(db, "schools"), where("School", "==", name), limit(1))).then((s) => s.docs[0]?.data() || null)) : Promise.resolve(null));
