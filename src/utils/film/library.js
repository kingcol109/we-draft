// src/utils/film/library.js
//
// The Film Manager's game film library (user, 2026-11-25): the admin's
// full-game MP4s, on their own disk — C:\KC Holdings\KC Entertainment, in
// "Al22 2026", "All22 2024", "All22 store"… Nothing is uploaded.
//
// The admin picks the root folder once; its handle is kept in this
// browser's IndexedDB (File System Access handles can be stored there), so
// later visits reopen it — Chrome asks to re-allow it (one click) unless
// "Allow on every visit" was chosen. The film folders under it are scanned
// for MP4s; each file is a game. The user keeps every file in one place
// under one name, so a game is its file name (gameIdOf).
//
// Game names follow the All-22 store's: "FLORIDA STATE O VS. CLEMSON D"
// (offense first, defense second), "FSU O VS. VIRGINIA D", "… D (1)".

// ── A tiny IndexedDB store for the folder handle ──
const DB = "wd-film";
const STORE = "kv";
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kv(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const r = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(r?.result);
    tx.onerror = () => reject(tx.error);
  });
}
export const savedRoot = () => kv("readonly", (s) => s.get("root")).catch(() => null);
const saveRoot = (h) => kv("readwrite", (s) => s.put(h, "root")).catch(() => {});

// Pick the root folder (and remember it).
export async function pickRoot() {
  if (!window.showDirectoryPicker) throw new Error("This browser can't open folders — use Chrome or Edge.");
  const h = await window.showDirectoryPicker({ id: "wd-film-root", mode: "read" });
  await saveRoot(h);
  return h;
}
// Is the saved folder usable? ("granted" / "prompt" / "denied"). ask: request it (needs a click).
export async function rootAccess(h, ask = false) {
  if (!h?.queryPermission) return "denied";
  const opts = { mode: "read" };
  const now = await h.queryPermission(opts);
  if (now === "granted" || !ask) return now;
  return h.requestPermission(opts);
}

// ── Names ──
// The film folders: All-22 folders ("Al22 2026", "All22 2024", "All22 store").
export const isFilmFolder = (name) => /^a[l1]{1,2}\s*-?\s*22\b/i.test(String(name || "").trim());
// A folder's season: the year in its name — "All22 store" is the 2025
// season's film (user, 2026-11-25).
const FOLDER_SEASONS = { "all22 store": "2025" };
export const seasonOf = (folder) => FOLDER_SEASONS[String(folder || "").trim().toLowerCase()] || (String(folder || "").match(/\b(20\d\d)\b/) || [])[1] || "";

const ACRONYMS = new Set(["FSU", "SMU", "UCF", "LSU", "USC", "BYU", "TCU", "UAB", "UNLV", "UTEP", "UTSA", "FIU", "FAU", "UCLA", "UNC", "NC", "ECU", "UMASS", "USF", "UL"]);
const ALIASES = { FSU: "Florida State", "SOUTHERN METHODIST": "SMU", "MIAMI": "Miami", "MIAMI FL": "Miami", "PITT": "Pittsburgh", "OLE MISS": "Ole Miss", "VA TECH": "Virginia Tech" };
// "EAST TEXAS A&M" → "East Texas A&M".
export function teamName(raw) {
  const s = String(raw || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const up = s.toUpperCase();
  if (ALIASES[up]) return ALIASES[up];
  return s.split(" ").map((w) => {
    const W = w.toUpperCase();
    if (ACRONYMS.has(W) || W.includes("&")) return W;
    return W.charAt(0) + W.slice(1).toLowerCase();
  }).join(" ");
}
// "FLORIDA STATE O VS. CLEMSON D (1).mp4" → { offense: "Florida State", defense: "Clemson" }.
// Also the numbered style: "12- 2026 Nebraska O vs Ohio State.mp4" (week, season, no trailing D).
// A tag in parentheses — "(PLAYOFF)", "(CONFERENCE CHAMPIONSHIP GAME)" — comes back as note.
export function parseGameName(file) {
  let base = String(file || "").replace(/\.[^.]+$/, "").replace(/^\d{1,2}\s*-\s*/, "").replace(/^20\d\d\s+/, "").trim();
  let note = "";
  for (let m = base.match(/\s*\(([^)]*)\)\s*$/); m; m = base.match(/\s*\(([^)]*)\)\s*$/)) {
    if (!/^\d+$/.test(m[1].trim())) note = note || m[1].trim().toLowerCase();
    base = base.slice(0, m.index).trim();
  }
  const m = base.match(/^(.*?)\s+O\s+VS[.-]?\s*(.*?)(?:\s+D)?$/i);
  if (m) return { offense: teamName(m[1]), defense: teamName(m[2]), ...(note ? { note } : {}) };
  const v = base.match(/^(.*?)\s+(?:VS\.?|AT|@)\s+(.*)$/i);
  if (v) return { offense: teamName(v[1]), defense: teamName(v[2]), ...(note ? { note } : {}) };
  return { offense: "", defense: "" };
}
// A game's id: its file name, slugged (unique — one file, one name, one place).
export const gameIdOf = (file) => String(file || "").replace(/\.[^.]+$/, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// ── Scanning ──
// The film folders right under the root (and the root itself if it is one).
export async function filmFolders(root) {
  const out = [];
  if (isFilmFolder(root.name)) out.push({ name: root.name, handle: root });
  for await (const [n, h] of root.entries()) if (h.kind === "directory" && isFilmFolder(n)) out.push({ name: n, handle: h });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
// Every MP4 in the film folders (and one level of subfolders): [{ id, file, folder, handle }].
export async function scanGames(root) {
  const games = [];
  const walk = async (dir, folder, depth) => {
    for await (const [n, h] of dir.entries()) {
      if (h.kind === "file" && /\.(mp4|m4v|mov)$/i.test(n)) games.push({ id: gameIdOf(n), file: n, folder, handle: h });
      else if (h.kind === "directory" && depth > 0) await walk(h, folder, depth - 1); // eslint-disable-line no-await-in-loop
    }
  };
  for (const f of await filmFolders(root)) await walk(f.handle, f.name, 1); // eslint-disable-line no-await-in-loop
  return games;
}
// ── Film linked by hand (user, 2026-11-25): a file picked for a game side in
// Cut plays. Its handle is kept here too, so it opens again even when it
// lives outside the film folders. ──
export const saveFileHandle = (id, h) => kv("readwrite", (s) => s.put(h, `file:${id}`)).catch(() => {});
export const savedFileHandle = (id) => kv("readonly", (s) => s.get(`file:${id}`)).catch(() => null);
// Pick one film file on this computer.
export async function pickFilmFile() {
  if (!window.showOpenFilePicker) throw new Error("This browser can't open files — use Chrome or Edge.");
  const [h] = await window.showOpenFilePicker({ id: "wd-film-file", multiple: false, types: [{ description: "Game film", accept: { "video/*": [".mp4", ".m4v", ".mov"] } }] });
  return h;
}
// Its path under the root folder (["All22 store", "x.mp4"]), or null when it's elsewhere.
export const pathUnder = async (root, h) => (root?.resolve ? root.resolve(h).catch(() => null) : null);
async function linkedFile(id) {
  const fh = await savedFileHandle(id);
  if (!fh) return null;
  const opts = { mode: "read" };
  if ((await fh.queryPermission?.(opts)) !== "granted" && (await fh.requestPermission?.(opts)) !== "granted") return null;
  return fh.getFile();
}

// A game's File: through the scan's handle, else its folder / file under the root, else a file linked by hand.
export async function gameFile(root, game, handles = {}) {
  const h = handles[game.id];
  if (h) return h.getFile();
  if (root) {
    const dir = game.folder && game.folder !== root.name ? await root.getDirectoryHandle(game.folder).catch(() => null) : root;
    const fh = dir ? await dir.getFileHandle(game.file).catch(() => null) : null;
    if (fh) return fh.getFile();
  }
  return linkedFile(game.id);
}
