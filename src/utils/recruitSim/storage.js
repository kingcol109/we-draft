// src/utils/recruitSim/storage.js
//
// Saves live in the browser (IndexedDB) — a single-player game, no server
// (spec §29). A save is the engine state minus derived tables (typed arrays
// store natively). Completed classes are kept separately as small summaries
// (school, grade, rank, signees) so they can be reviewed — and later synced
// to a We-Draft account if wanted.
const DB = "we-draft-recruitsim";
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no indexedDB")); return; }
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("saves")) d.createObjectStore("saves");
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
      if (!d.objectStoreNames.contains("classes")) d.createObjectStore("classes", { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(store, mode, fn) {
  return open().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

// A save + its list-row meta ({ id, school, slug, stage, updated }).
export async function writeSave(id, storable, meta) {
  await tx("saves", "readwrite", (s) => s.put(storable, id));
  await tx("meta", "readwrite", (s) => s.put({ ...meta, id }, id));
}
export function readSave(id) {
  return tx("saves", "readonly", (s) => s.get(id));
}
export async function listSaves() {
  try {
    const rows = await tx("meta", "readonly", (s) => s.getAll());
    return (rows || []).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  } catch { return []; }
}
export async function deleteSave(id) {
  await tx("saves", "readwrite", (s) => s.delete(id));
  await tx("meta", "readwrite", (s) => s.delete(id));
}
// Finished classes: { slug, school, finished, rank, field, grade, signees: [[name, pos, stars, rating, rank]] }.
export function saveClass(summary) {
  return tx("classes", "readwrite", (s) => s.add(summary)).catch(() => null);
}
export async function listClasses() {
  try { return (await tx("classes", "readonly", (s) => s.getAll())) || []; } catch { return []; }
}
