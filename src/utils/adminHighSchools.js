// src/utils/adminHighSchools.js
//
// The whole highSchools collection (~2,900 docs since the CFBD high school
// imports), read once per admin page load and shared by every admin screen
// that needs it: the player / recruit / historical editors' autocomplete
// (AdminPanel.js), Branding → High School, the Eligibility Manager
// (AdminEligibility.jsx), HS Research (AdminProspectResearch.jsx) and the
// CFB Universe search's "add high school" (CfbUniverseSearch.js). Each used
// to read all of it on its own — ~2,900 reads apiece.
//
// Admin writes keep the shared copy current (cacheHighSchool /
// uncacheHighSchool / replaceHighSchools), so switching screens never shows
// a stale list. Writes made elsewhere (scripts, another tab) show up on the
// next page load.
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";

let list = null;    // [{ id, ...data }] once read
let pending = null; // the read in flight

// → [{ id, ...data }]. Callers map / filter / copy rather than mutate it.
export function loadHighSchools() {
  if (list) return Promise.resolve(list);
  if (!pending) {
    pending = getDocs(collection(db, "highSchools"))
      .then((snap) => { list = snap.docs.map((d) => ({ id: d.id, ...d.data() })); return list; })
      .finally(() => { pending = null; });
  }
  return pending;
}

// Add or update one school ({ id, ...fields } — fields merge over what's
// there). Before the first read there's nothing to patch: that read sees it.
export function cacheHighSchool(row) {
  if (!list || !row?.id) return;
  const old = list.find((h) => h.id === row.id);
  list = [...list.filter((h) => h.id !== row.id), { ...old, ...row }];
}

export function uncacheHighSchool(id) {
  if (list) list = list.filter((h) => h.id !== id);
}

// After a bulk change made against a working copy (Eligibility Manager).
export function replaceHighSchools(rows) {
  list = rows.map((h) => ({ ...h }));
}
