// src/utils/studio/filmFolder.js
//
// Finding the game MP4s a Premiere project points at, on the admin's own
// disk (the File System Access API — Chrome / Edge; nothing is uploaded).
// The project stores absolute paths (C:\KC Holdings\KC Entertainment\All22
// store\FSU O VS. CLEMSON D.mp4); a web page can't open a path, so the admin
// picks a folder once (say "KC Entertainment") and each path is walked from
// that folder's name down. Failing that, the file's name is looked for in
// the folder and the folders right under it.

// Pick a folder (remembered by the browser as the "film" start point).
export async function pickFolder() {
  if (!window.showDirectoryPicker) throw new Error("This browser can't open folders — use Chrome or Edge.");
  return window.showDirectoryPicker({ id: "wd-film", mode: "read" });
}

const lower = (s) => String(s || "").toLowerCase();

// The path's parts after the folder's own name: ["All22 store", "X.mp4"], or null.
export function relativeParts(path, folderName) {
  const parts = String(path || "").split(/[\\/]/).filter(Boolean);
  const i = parts.map(lower).lastIndexOf(lower(folderName));
  return i >= 0 && i < parts.length - 1 ? parts.slice(i + 1) : null;
}

async function walk(dir, parts) {
  let cur = dir;
  for (let i = 0; i < parts.length - 1; i += 1) cur = await cur.getDirectoryHandle(parts[i]); // eslint-disable-line no-await-in-loop
  return cur.getFileHandle(parts[parts.length - 1]);
}

async function findByName(dir, name, depth = 1) {
  const want = lower(name);
  const subdirs = [];
  for await (const [n, h] of dir.entries()) {
    if (h.kind === "file" && lower(n) === want) return h;
    if (h.kind === "directory" && depth > 0) subdirs.push(h);
  }
  for (const d of subdirs) {
    const hit = await findByName(d, name, depth - 1).catch(() => null); // eslint-disable-line no-await-in-loop
    if (hit) return hit;
  }
  return null;
}

// Each path → a File (or null). folders: directory handles, tried in order.
export async function resolveFiles(paths, folders) {
  const out = {};
  for (const p of paths) {
    let handle = null;
    for (const dir of folders) {
      const rel = relativeParts(p, dir.name);
      handle = rel ? await walk(dir, rel).catch(() => null) : null; // eslint-disable-line no-await-in-loop
      if (!handle) handle = await findByName(dir, p.split(/[\\/]/).pop()).catch(() => null); // eslint-disable-line no-await-in-loop
      if (handle) break;
    }
    out[p] = handle ? await handle.getFile() : null; // eslint-disable-line no-await-in-loop
  }
  return out;
}
