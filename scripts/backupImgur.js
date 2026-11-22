// scripts/backupImgur.js
//
// "In case of emergency" copies of every Imgur image the site uses (user,
// 2026-11-22). The site keeps loading images from Imgur; this only keeps
// our own copy of each file in Firebase Storage so nothing is lost if Imgur
// deletes one or goes away.
//
//   node --env-file=.env scripts/backupImgur.js          back up what's new
//   node --env-file=.env scripts/backupImgur.js --dry    count only, no writes
//
// How: scans every top-level Firestore collection for imgur links (any field,
// any depth), takes each unique image once, and saves it to the private
// bucket (the same one Instagram staging uses — storage.rules closes it to
// every client) as
//   imgur-backup/{imgurId}.{ext}
// with its original link in the file's metadata. Already-saved images are
// skipped, so re-running only copies new ones. A manifest is rewritten each
// run:
//   imgur-backup/_manifest.json
//     { builtAt, count, bytes, missing: [url], images: { [imgurId]: { src,
//       path, bytes, type, used: [collection] } } }
// "missing" are links Imgur no longer serves (nothing to copy).
//
// Restoring later: download the folder from the Firebase console (or gsutil
// cp -r gs://we-draft.firebasestorage.app/imgur-backup .), or re-host and
// swap links with the manifest's src → path map.
//
// Reads Firestore only; writes only under imgur-backup/ in Storage.

const path = require("path");
const { getFirestore, getBucket } = require(path.resolve(__dirname, "firebaseAdmin.js"));

const BUCKET = process.env.INSTAGRAM_STAGING_BUCKET || "we-draft.firebasestorage.app";
const ROOT = "imgur-backup";
const DRY = process.argv.includes("--dry");
const RE = /https?:\/\/(?:i\.)?imgur\.com\/([A-Za-z0-9]{5,10})(\.(?:png|jpe?g|gif|webp))?/gi;
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

async function scan(db) {
  const found = new Map(); // id → { src, used: Set }
  for (const col of await db.listCollections()) {
    let last = null;
    for (;;) {
      let q = col.orderBy("__name__").limit(1000);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      snap.docs.forEach((d) => {
        for (const m of JSON.stringify(d.data()).matchAll(RE)) {
          const id = m[1];
          if (!found.has(id)) found.set(id, { src: `https://i.imgur.com/${id}${m[2] || ".png"}`, used: new Set() });
          found.get(id).used.add(col.id);
        }
      });
      if (snap.size < 1000) break;
      last = snap.docs[snap.docs.length - 1];
    }
  }
  return found;
}

async function main() {
  const db = getFirestore();
  const bucket = getBucket(BUCKET);
  const found = await scan(db);
  console.log(`${found.size} unique imgur images in Firestore`);

  // What's already saved: id → { path, bytes, type }.
  const [files] = await bucket.getFiles({ prefix: `${ROOT}/` });
  const saved = new Map();
  files.forEach((f) => {
    const m = f.name.match(new RegExp(`^${ROOT}/([A-Za-z0-9]+)\\.(\\w+)$`));
    if (m) saved.set(m[1], { path: f.name, bytes: Number(f.metadata.size) || 0, type: f.metadata.contentType || "" });
  });
  const todo = [...found.keys()].filter((id) => !saved.has(id));
  console.log(`${saved.size} already backed up, ${todo.length} to copy${DRY ? " (dry run — nothing written)" : ""}`);
  if (DRY) return;

  const missing = [];
  let done = 0;
  const copy = async (id) => {
    const { src } = found.get(id);
    try {
      const r = await fetch(src, { headers: { "User-Agent": "Mozilla/5.0 (backup)" } });
      // Imgur answers a deleted image with a redirect to removed.png.
      if (!r.ok || /removed\.png/.test(r.url)) { missing.push(src); return; }
      const type = (r.headers.get("content-type") || "").split(";")[0];
      const buf = Buffer.from(await r.arrayBuffer());
      const file = `${ROOT}/${id}.${EXT[type] || "bin"}`;
      await bucket.file(file).save(buf, { contentType: type || "application/octet-stream", resumable: false, metadata: { metadata: { source: src } } });
      saved.set(id, { path: file, bytes: buf.length, type });
    } catch (e) {
      console.warn(`  failed ${src}: ${e.message}`);
      missing.push(src);
    }
    done += 1;
    if (done % 100 === 0) console.log(`  ${done}/${todo.length}`);
  };
  for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map(copy));

  const images = {};
  let bytes = 0;
  for (const [id, x] of found) {
    const s = saved.get(id);
    if (!s) continue;
    bytes += s.bytes;
    images[id] = { src: x.src, path: s.path, bytes: s.bytes, type: s.type, used: [...x.used].sort() };
  }
  const manifest = { builtAt: new Date().toISOString(), count: Object.keys(images).length, bytes, missing, images };
  await bucket.file(`${ROOT}/_manifest.json`).save(JSON.stringify(manifest, null, 1), { contentType: "application/json", resumable: false });
  console.log(`backed up ${manifest.count} images (${(bytes / 1048576).toFixed(1)} MB); ${missing.length} missing on imgur`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
