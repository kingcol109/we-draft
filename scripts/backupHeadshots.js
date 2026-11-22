// scripts/backupHeadshots.js
//
// "In case of emergency" copies of every We-Draft.com player's headshot
// (user, 2026-11-22) — only players with a playerPhotos doc, not every
// college player. The site keeps loading headshots from where they live
// (mostly ESPN, scripts/importEspnHeadshots.js); this keeps our own copy in
// Firebase Storage in case that source changes its addresses, blocks us, or
// goes away. Imgur headshots are skipped — scripts/backupImgur.js has them.
//
//   node --env-file=.env scripts/backupHeadshots.js          back up what's new or changed
//   node --env-file=.env scripts/backupHeadshots.js --dry    count only, no writes
//
// Saved to the private bucket (storage.rules closes it to every client) as
//   headshot-backup/{playerId}-{kind}.{ext}     kind: college | nfl | other
// (a second photo of the same kind: {playerId}-{kind}-2.{ext}, …), with the
// original link (source) and kind in the file's metadata. The kind comes
// from the link (ESPN's college-football/… vs nfl/… headshots).
//
// NOTHING IS EVER REPLACED OR DELETED (user, 2026-11-22): when a player's
// headshot link changes — his NFL photo replacing his college one — the new
// photo is saved next to the old, so his college headshot stays ours to use
// later. Files from the first run ({playerId}.{ext}, all ESPN college
// photos) are renamed to the labeled form once.
//
// A manifest is rewritten each run:
//   headshot-backup/_manifest.json
//     { builtAt, count, bytes, missing: [{ id, name, url }],
//       players: { [playerId]: { name, slug, current, copies: [{ kind, src,
//       path, bytes, type }] } } }
// "missing" are links the source no longer serves (nothing to copy).
//
// Reads Firestore (playerPhotos) only; writes only under headshot-backup/.

const path = require("path");
const { getFirestore, getBucket } = require(path.resolve(__dirname, "firebaseAdmin.js"));

const BUCKET = process.env.INSTAGRAM_STAGING_BUCKET || "we-draft.firebasestorage.app";
const ROOT = "headshot-backup";
const DRY = process.argv.includes("--dry");
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

const kindOf = (url) => (/\/college-football\//i.test(url) ? "college" : /\/nfl\//i.test(url) ? "nfl" : "other");

async function main() {
  const db = getFirestore();
  const bucket = getBucket(BUCKET);

  // Every player's headshot that isn't on Imgur.
  const want = new Map(); // playerId → { name, slug, src }
  (await db.collection("playerPhotos").get()).docs.forEach((d) => {
    const x = d.data();
    const src = x.headshot?.url;
    if (!src || /imgur\.com/i.test(src)) return;
    want.set(d.id, { name: x.name || "", slug: x.slug || "", src });
  });
  console.log(`${want.size} non-Imgur headshots in playerPhotos`);

  // Everything saved, per player: [{ path, kind, source, bytes, type }].
  const [files] = await bucket.getFiles({ prefix: `${ROOT}/` });
  const saved = new Map();
  const add = (id, entry) => { if (!saved.has(id)) saved.set(id, []); saved.get(id).push(entry); };
  const legacy = [];
  for (const f of files) {
    const name = f.name.slice(ROOT.length + 1);
    if (!name || name.startsWith("_") || name.includes("/")) continue;
    const meta = { source: f.metadata.metadata?.source || "", bytes: Number(f.metadata.size) || 0, type: f.metadata.contentType || "" };
    const labeled = name.match(/^(.+)-(college|nfl|other)(?:-\d+)?\.(\w+)$/);
    if (labeled) { add(labeled[1], { path: f.name, kind: labeled[2], ...meta }); continue; }
    const flat = name.match(/^(.+)\.(\w+)$/);
    if (flat) legacy.push({ file: f, id: flat[1], ext: flat[2], ...meta });
  }

  // First-run files → labeled names (a move within the bucket, contents untouched).
  if (legacy.length) console.log(`${legacy.length} first-run copies to label${DRY ? " (dry run)" : ""}`);
  for (const l of legacy) {
    const kind = kindOf(l.source);
    const dest = `${ROOT}/${l.id}-${kind}.${l.ext}`;
    if (!DRY) {
      await l.file.move(dest);
      await bucket.file(dest).setMetadata({ metadata: { source: l.source, kind } });
    }
    add(l.id, { path: dest, kind, source: l.source, bytes: l.bytes, type: l.type });
  }

  const todo = [...want.keys()].filter((id) => !(saved.get(id) || []).some((s) => s.source === want.get(id).src));
  const added = todo.filter((id) => saved.has(id)).length;
  console.log(`${saved.size} players backed up, ${todo.length} headshots to copy (${added} new photos for players already saved — kept alongside)${DRY ? " (dry run — nothing written)" : ""}`);
  if (DRY) return;

  const missing = [];
  let done = 0;
  const copy = async (id) => {
    const { name, src } = want.get(id);
    try {
      const r = await fetch(src, { headers: { "User-Agent": "Mozilla/5.0 (backup)" } });
      if (!r.ok) { missing.push({ id, name, url: src }); return; }
      const type = (r.headers.get("content-type") || "").split(";")[0];
      const buf = Buffer.from(await r.arrayBuffer());
      const kind = kindOf(src);
      // A free name: {id}-{kind}.ext, else -2, -3… — never an existing file.
      const taken = new Set((saved.get(id) || []).map((s) => s.path));
      let file = `${ROOT}/${id}-${kind}.${EXT[type] || "bin"}`;
      for (let n = 2; taken.has(file) || (await bucket.file(file).exists())[0]; n += 1) file = `${ROOT}/${id}-${kind}-${n}.${EXT[type] || "bin"}`;
      await bucket.file(file).save(buf, { contentType: type || "application/octet-stream", resumable: false, metadata: { metadata: { source: src, kind } } });
      add(id, { path: file, kind, source: src, bytes: buf.length, type });
    } catch (e) {
      console.warn(`  failed ${name || id}: ${e.message}`);
      missing.push({ id, name, url: src });
    }
    done += 1;
    if (done % 100 === 0) console.log(`  ${done}/${todo.length}`);
  };
  for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map(copy));

  // Every saved copy goes in the manifest — players since removed from
  // playerPhotos included (their copies are kept too).
  const players = {};
  let bytes = 0;
  let count = 0;
  for (const [id, copies] of saved) {
    const w = want.get(id);
    copies.forEach((c) => { bytes += c.bytes; count += 1; });
    players[id] = { name: w?.name || "", slug: w?.slug || "", current: w?.src || null, copies: copies.map((c) => ({ kind: c.kind, src: c.source, path: c.path, bytes: c.bytes, type: c.type })) };
  }
  const manifest = { builtAt: new Date().toISOString(), count, bytes, missing, players };
  await bucket.file(`${ROOT}/_manifest.json`).save(JSON.stringify(manifest, null, 1), { contentType: "application/json", resumable: false });
  console.log(`${count} headshots kept for ${saved.size} players (${(bytes / 1048576).toFixed(1)} MB); ${missing.length} missing at the source`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
