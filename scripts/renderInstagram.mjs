// scripts/renderInstagram.mjs
//
// The Instagram posts (src/utils/instagram/posts.js) drawn on the server:
// the same SVG the admin page makes, rendered to PNG with resvg and the
// bundled Bebas Neue — the path an API endpoint would take. Reads Firestore
// with the Admin SDK, as the admin page reads it with the client SDK.
//
//   node scripts/renderInstagram.mjs mock 2027 [--theme light] [--shot 0] [--no-feature] [--out dir]
//   node scripts/renderInstagram.mjs mock --post <instagramPosts id> [--out dir]
//     (a saved Weekly Mock post as saved: its week, look, featured picks and
//     their photos' framing)
//   node scripts/renderInstagram.mjs player <playerId> [--photo 0] [--kicker "..."] [--out dir]
//   node scripts/renderInstagram.mjs spotlight <playerId> [--photo 0] [--look spotlight] [--accent #f6a21d] [--badge plate] [--no-stats] [--out dir]
//   node scripts/renderInstagram.mjs portal <playerId> [--from School] [--carousel] [--photo 0] [--out dir]
//   node scripts/renderInstagram.mjs short <playerId> [--lines "9 TKL|1 SACK"] [--kicker "VS LSU"] [--out dir]
//   node scripts/renderInstagram.mjs transfer <playerId> [--from School] [--to School] [--carousel] [--photo 0] [--out dir]
//
// Writes the PNGs (and the caption) into --out (default ./instagram-out).
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import zlib from "zlib";
import { knockOut, hasBackdrop, opaqueBounds } from "../src/utils/instagram/knockout.js";
import { spotlightSlides, spotlightInput, spotlightCaption, spotlightImageUrls, scoutingReport, spotlightFrame, espnStats } from "../src/utils/instagram/spotlight.js";
import { NFL_TEAMS } from "../src/utils/coachHistory.js";
import { mockSlides, mockInput, mockCaption, playerPost, playerInput, playerCaption, imageUrls } from "../src/utils/instagram/posts.js";
import { shortInput, shortFrame, shortEnd, shortImageUrls } from "../src/utils/instagram/short.js";
import { transferSlides, transferInput, transferCaption, transferImageUrls, transferFrame } from "../src/utils/instagram/transfer.js";

const require = createRequire(import.meta.url);
const { getFirestore } = require("./firebaseAdmin");
const { Resvg } = require("@resvg/resvg-js");
const { measure, fetchLogo, pngSize } = require("../server/stream-manager/thumbnail");

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONT_FILE = path.join(ROOT, "server", "stream-manager", "assets", "BebasNeue-Regular.ttf");
const WD_LOGO = "wd-logo";
const WD_BADGE = "wd-badge";
const CLASS_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB"];
// Needs GOOGLE_SERVICE_ACCOUNT_KEY (read from .env if not already set).
if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY && fs.existsSync(path.join(ROOT, ".env"))) {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}
const summaryDocId = (year) => (String(year) === "2027" ? "weeklyMock" : `weeklyMock${year}`);

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const kind = args[0];
const id = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
const out = path.resolve(flag("out", "instagram-out"));

// Every url → { href (data URI), w, h }; ones that won't load are left out.
async function loadImages(urls, big = new Set()) {
  const images = {};
  const logo = fs.readFileSync(path.join(ROOT, "src", "assets", "Logo2.png"));
  images[WD_LOGO] = { href: `data:image/png;base64,${logo.toString("base64")}`, ...pngSize(logo) };
  const badge = fs.readFileSync(path.join(ROOT, "src", "assets", "wd-badge.png"));
  images[WD_BADGE] = { href: `data:image/png;base64,${badge.toString("base64")}`, ...pngSize(badge) };
  for (const y of [2027, 2028, 2029]) {
    const f = path.join(ROOT, "src", "assets", `class-logo-${y}.png`);
    if (fs.existsSync(f)) { const b = fs.readFileSync(f); images[`class-logo-${y}`] = { href: `data:image/png;base64,${b.toString("base64")}`, ...pngSize(b) }; }
  }
  await Promise.all(urls.filter((u) => u !== WD_LOGO && u !== WD_BADGE && !u.startsWith("class-logo-")).map(async (u) => {
    // An action shot can be far bigger than fetchLogo's cap for logos.
    const r = big.has(u) ? await fetchBig(u) : await fetchLogo(u.replace(/^http:/, "https:"));
    if (!r.data) { console.warn(`  image skipped (${r.error}): ${u}`); return; }
    let size = {};
    try { size = r.mime === "image/png" ? pngSize(r.data) : r.mime === "image/jpeg" ? jpegSize(r.data) : {}; } catch { /* unreadable header */ }
    images[u] = { href: `data:${r.mime};base64,${r.data.toString("base64")}`, ...size };
  }));
  return images;
}

// A JPEG's width / height (its SOF marker).
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    const m = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return {};
}

async function fetchBig(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const data = Buffer.from(await r.arrayBuffer());
    return { data, mime: r.headers.get("content-type") || "image/png" };
  } catch (e) {
    return { error: e.message };
  }
}

// RGBA pixels → a PNG (no filter, one deflate).
function encodePng(px, w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(px.buffer, px.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// An action shot at most `max` tall, its plain backdrop taken out
// (knockout.js) → { href, w, h }. resvg decodes it to pixels.
function cutout(im, max = 1400) {
  const size = im.w && im.h ? im : { w: 1080, h: 1920 };
  const h = Math.min(max, size.h);
  const w = Math.round((size.w / size.h) * h);
  const rendered = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><image href="${im.href}" width="${w}" height="${h}" preserveAspectRatio="none"/></svg>`, { fitTo: { mode: "original" } }).render();
  const px = new Uint8Array(rendered.pixels);
  if (hasBackdrop(px, w, h)) knockOut(px, w, h);
  // Trimmed to the player (a cut-out shot's empty edges too), so he fills the frame.
  const b = opaqueBounds(px, w, h) || { x: 0, y: 0, w, h };
  const out = new Uint8Array(b.w * b.h * 4);
  for (let y = 0; y < b.h; y++) out.set(px.subarray(((b.y + y) * w + b.x) * 4, ((b.y + y) * w + b.x + b.w) * 4), y * b.w * 4);
  return { href: `data:image/png;base64,${encodePng(out, b.w, b.h).toString("base64")}`, w: b.w, h: b.h };
}

const render = (svg) => new Resvg(svg, { font: { fontFiles: [FONT_FILE], loadSystemFonts: false, defaultFontFamily: "Bebas Neue" }, fitTo: { mode: "original" } }).render().asPng();

async function headshots(db, ids) {
  const out = {};
  const refs = ids.map((i) => db.collection("playerPhotos").doc(i));
  for (let i = 0; i < refs.length; i += 100) {
    const snaps = await db.getAll(...refs.slice(i, i + 100));
    snaps.forEach((s) => { if (s.exists && s.data().headshot?.url) out[s.id] = s.data().headshot.url; });
  }
  return out;
}

async function collegeLogos(db, year) {
  const out = {};
  const snaps = await db.getAll(...CLASS_POSITIONS.map((p) => db.collection("compSnapshots").doc(`class_${year}_${p}`)));
  snaps.forEach((s) => (s.exists ? s.data().rows || [] : []).forEach((r) => { out[r.i] = { lg: r.lg || "", ld: r.ld || "" }; }));
  return out;
}

async function branding(db) {
  const snap = await db.collection("compSnapshots").doc("_nflBranding").get();
  if (snap.exists && snap.data().teams) return snap.data().teams;
  const live = await db.collection("nfl").get();
  return Object.fromEntries(live.docs.map((d) => [d.id, d.data()]));
}

const dated = (ts) => (ts?.toDate ? ts.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }) : "");

async function main() {
  const db = getFirestore();
  fs.mkdirSync(out, { recursive: true });
  if (kind === "mock") {
    const post = flag("post");
    const st = post ? (await db.collection("instagramPosts").doc(post).get()).data()?.state : null;
    if (post && !st) throw new Error(`No saved post ${post}.`);
    const year = st?.year || id || "2027";
    const weekId = st?.weekId || (await db.collection("config").doc(summaryDocId(year)).get()).data()?.weekId;
    if (!weekId) throw new Error(`No published ${year} Weekly Mock.`);
    const week = (await db.collection("weeklyMocks").doc(weekId).get()).data();
    const r1 = (week.picks || []).filter((p) => p.round === 1 && p.player).map((p) => p.player.id);
    // Each round-1 slide's featured pick: a saved post's, else the first of
    // its picks with an action shot (--shot: which of his; --no-feature: none).
    const features = st ? Object.fromEntries(Object.entries(st.features || {}).filter(([, f]) => f)) : {};
    if (!st && !args.includes("--no-feature")) {
      const first = (week.picks || []).filter((p) => p.round === 1 && p.player).sort((a, b) => a.overall - b.overall);
      const snaps = await db.getAll(...first.map((p) => db.collection("playerPhotos").doc(p.player.id)));
      const action = first.map((p, k) => ({ p, action: (snaps[k].exists && snaps[k].data().action) || [] }));
      [[1, 0, 16], [2, 16, first.length]].forEach(([part, from, to]) => {
        const hit = action.slice(from, to).find((a) => a.action.length);
        const shot = hit?.action[Number(flag("shot", 0))] || hit?.action[0];
        if (shot) features[part] = { overall: hit.p.overall, photo: shot.url, focus: shot.orientation === "left" ? "right" : shot.orientation === "right" ? "left" : "center" };
      });
    }
    const input = mockInput({ features,
      week, branding: await branding(db), headshots: await headshots(db, r1), collegeLogos: await collegeLogos(db, year),
      theme: st?.theme || flag("theme", "dark"), dated: st?.dated ?? dated(week.publishedAt), brandLogo: WD_LOGO,
      ...(st ? { kicker: st.kicker, title: st.title, simAd: st.simAd } : {}),
    });
    const photos = Object.values(features).map((f) => f.photo);
    const env = { measure, images: await loadImages([WD_LOGO, ...imageUrls(input)], new Set(photos)) };
    const cut = st ? st.cutout !== false : !args.includes("--no-cutout");
    photos.forEach((u) => { if (env.images[u] && cut) env.images[u] = cutout(env.images[u]); });
    const slides = mockSlides(input, env);
    slides.forEach((s, i) => fs.writeFileSync(path.join(out, `mock-${year}-${String(i + 1).padStart(2, "0")}-${s.name}.png`), render(s.svg)));
    fs.writeFileSync(path.join(out, `mock-${year}-caption.txt`), mockCaption(input));
    console.log(`${slides.length} slides → ${out}`);
  } else if (kind === "player") {
    const p = (await db.collection("players").doc(id).get()).data();
    if (!p) throw new Error(`No player ${id}.`);
    const school = (await db.collection("schools").where("School", "==", p.School || "").limit(1).get()).docs[0]?.data() || {};
    const photos = (await db.collection("playerPhotos").doc(id).get()).data() || {};
    const photo = (photos.action || [])[Number(flag("photo", 0))] || null;
    const input = playerInput({ player: p, school, photo, kicker: flag("kicker", `${p.Eligible || ""} NFL DRAFT PROSPECT`.trim()), brandLogo: WD_LOGO });
    const env = { measure, images: await loadImages([WD_LOGO, ...imageUrls(input)], new Set([input.photo].filter(Boolean))) };
    fs.writeFileSync(path.join(out, `player-${id}.png`), render(playerPost(input, env)));
    fs.writeFileSync(path.join(out, `player-${id}-caption.txt`), playerCaption(input));
    console.log(`player-${id}.png → ${out}`);
  } else if (kind === "spotlight") {
    const p = { id, ...(await db.collection("players").doc(id).get()).data() };
    if (!p.First) throw new Error(`No player ${id}.`);
    const [schoolSnap, photoSnap, evalSnap, classSnap, fitsSnap, teams] = await Promise.all([
      db.collection("schools").where("School", "==", p.School || "").limit(1).get(),
      db.collection("playerPhotos").doc(id).get(),
      db.collection("players").doc(id).collection("evaluations").get(),
      db.collection("compSnapshots").doc(`class_${p.Eligible}_${p.Position}`).get(),
      db.collection("compSnapshots").doc("_nflFits").get(),
      branding(db),
    ]);
    const photos = photoSnap.data() || {};
    // His national ranks (the stats slide), from his linked CFBD player.
    const seasonRanks = (await db.collection("cfbdPlayers").where("wedraftPlayerId", "==", id).limit(1).get()).docs[0]?.data().seasonRanks || null;
    const report = scoutingReport({
      player: p, evaluations: evalSnap.docs.map((d) => d.data()), classSnap: classSnap.exists ? classSnap.data() : null,
      nflFits: fitsSnap.data()?.rows?.[id] || [], branding: teams, teamNames: NFL_TEAMS,
    });
    const input = spotlightInput({
      player: p, school: schoolSnap.docs[0]?.data() || {}, photo: (photos.action || [])[Number(flag("photo", 0))] || null,
      headshot: photos.headshot?.url || "", jersey: photos.jersey || "", report, advance: Number(p.Eligible) > 2027, brandLogo: WD_LOGO, badgeLogo: WD_BADGE,
      classLogo: ["2027", "2028", "2029"].includes(String(p.Eligible)) ? `class-logo-${p.Eligible}` : "",
      look: flag("look", "wash"), accent: flag("accent", ""), badge: flag("badge", "crest"),
      // His college stats from ESPN (the stats slide), by the id his headshot was matched on.
      stats: photos.headshot?.espnId && !args.includes("--no-stats")
        ? espnStats(await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/football/college-football/athletes/${photos.headshot.espnId}/stats`).then((r) => (r.ok ? r.json() : null)).catch(() => null), p.Position, seasonRanks)
        : null,
    });
    const env = { measure, images: await loadImages([WD_LOGO, ...spotlightImageUrls(input)], new Set([input.photo].filter(Boolean))) };
    if (env.images[input.photo]) env.images[input.photo] = cutout(env.images[input.photo]);
    spotlightSlides(input, env).forEach((s, i) => fs.writeFileSync(path.join(out, `spotlight-${id}-${i + 1}-${s.name}.png`), render(s.svg)));
    fs.writeFileSync(path.join(out, `spotlight-${id}-highlight-frame.png`), render(spotlightFrame(input, env)));
    fs.writeFileSync(path.join(out, `spotlight-${id}-caption.txt`), spotlightCaption(input));
    console.log(`spotlight-${id} → ${out}`);
  } else if (kind === "portal" || kind === "transfer") {
    const p = { id, ...(await db.collection("players").doc(id).get()).data() };
    if (!p.First) throw new Error(`No player ${id}.`);
    const schoolDoc = async (name) => (await db.collection("schools").where("School", "==", name || "").limit(1).get()).docs[0]?.data() || {};
    const fromName = flag("from", p.PortalOriginalSchool || p.PriorSchool || p.School);
    const toName = flag("to", kind === "transfer" ? p.School : "");
    const [from, to, photoSnap, evalSnap, classSnap] = await Promise.all([
      schoolDoc(fromName), schoolDoc(toName), db.collection("playerPhotos").doc(id).get(),
      db.collection("players").doc(id).collection("evaluations").get(),
      db.collection("compSnapshots").doc(`class_${p.Eligible}_${p.Position}`).get(),
    ]);
    const report = scoutingReport({ player: p, evaluations: evalSnap.docs.map((d) => d.data()), classSnap: classSnap.exists ? classSnap.data() : null, teamNames: NFL_TEAMS });
    const input = transferInput({
      kind, player: p, from, fromName, to, toName, photo: (photoSnap.data()?.action || [])[Number(flag("photo", 0))] || null, report,
      carousel: args.includes("--carousel"), kicker: flag("kicker", ""), headline: flag("headline", ""), note: flag("note", ""), brandLogo: WD_LOGO, badgeLogo: WD_BADGE,
    });
    const env = { measure, images: await loadImages([WD_LOGO, ...transferImageUrls(input)], new Set([input.photo].filter(Boolean))) };
    if (env.images[input.photo]) env.images[input.photo] = cutout(env.images[input.photo]);
    transferSlides(input, env).forEach((s, i) => fs.writeFileSync(path.join(out, `${kind}-${id}-${i + 1}-${s.name}.png`), render(s.svg)));
    fs.writeFileSync(path.join(out, `${kind}-${id}-highlight-frame.png`), render(transferFrame(input, env)));
    fs.writeFileSync(path.join(out, `${kind}-${id}-caption.txt`), transferCaption(input));
    console.log(`${kind}-${id} → ${out}`);
  } else if (kind === "short") {
    // The Short's frame and end screen (1080×1920).
    const p = { id, ...(await db.collection("players").doc(id).get()).data() };
    if (!p.First) throw new Error(`No player ${id}.`);
    const school = (await db.collection("schools").where("School", "==", p.School || "").limit(1).get()).docs[0]?.data() || {};
    const input = shortInput({ player: p, school, lines: flag("lines", "").split("|"), kicker: flag("kicker", ""), badgeLogo: WD_BADGE });
    const env = { measure, images: await loadImages(shortImageUrls(input)) };
    fs.writeFileSync(path.join(out, `short-${id}-frame.png`), render(shortFrame(input, env)));
    fs.writeFileSync(path.join(out, `short-${id}-end.png`), render(shortEnd(input, env)));
    console.log(`short-${id} → ${out}`);
  } else {
    console.log("usage: node scripts/renderInstagram.mjs mock <year> | player <playerId> | spotlight <playerId> | portal <playerId> | transfer <playerId> | short <playerId> [--lines \"9 TKL|1 SACK\"] [--kicker ...]");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
