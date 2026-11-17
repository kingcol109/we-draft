// server/firstPickImage.mjs
//
// The First Pick graphic (src/utils/instagram/firstPick.js) drawn on the
// server, as a PNG — for api/first-pick.js, the one permanent image URL a
// team's Weekly Mock page shows (and Google indexes). The same SVG the
// admin's placement editor draws (FirstPickSetup.jsx), and the same image
// work as the browser's loadFeatureImage (SocialMakerKit.jsx): the action
// shot, the wordmark and the alternate logo scaled to at most 1400 tall,
// a plain backdrop taken out (knockout.js), then trimmed to what's left —
// so a saved placement lands where it was set.
//
// The pick: the team's first in the class's current week (its summary's
// weekId — config/weeklyMock, config/weeklyMock{year}). The shot: one of
// his placed action shots (playerPhotos action[i].firstPick), at random —
// no rule; the API's cache decides how long one stays up. null when there's
// nothing to draw (no week, no pick, no placed shot, his photo won't load).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import zlib from "zlib";
import { knockOut, hasBackdrop, opaqueBounds, inkBounds } from "../src/utils/instagram/knockout.js";
import { firstPickInput, firstPickSvg, firstPickImageUrls } from "../src/utils/instagram/firstPick.js";

const require = createRequire(import.meta.url);
const { renderPng, measure, fetchLogo, pngSize } = require("./stream-manager/thumbnail");

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WD_LOGO = "wd-logo";
// SocialMakerKit.jsx FEATURE_MAX.
const FEATURE_MAX = 1400;
const MAIN_YEAR = "2027";
const summaryDocId = (year) => (year === MAIN_YEAR ? "weeklyMock" : `weeklyMock${year}`);

// MarginAds.js sanitizeImgur: imgur page links → the i.imgur.com file.
function directUrl(url) {
  const u = String(url || "").trim().replace(/^http:/, "https:");
  const direct = u.match(/^https:\/\/imgur\.com\/([A-Za-z0-9]+\.(png|jpe?g|gif|webp))$/i);
  if (direct) return `https://i.imgur.com/${direct[1]}`;
  const single = u.match(/^https:\/\/imgur\.com\/(?!a\/|gallery\/)([A-Za-z0-9]+)$/i);
  if (single) return `https://i.imgur.com/${single[1]}.png`;
  return u;
}

async function fetchBytes(url) {
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    return { data: Buffer.from(await r.arrayBuffer()), mime: r.headers.get("content-type") || "image/png" };
  } catch {
    return null;
  }
}

// RGBA pixels → a PNG.
function encodePng(px, w, h) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
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

// An image as loadFeatureImage(url, true) makes it: at most FEATURE_MAX
// tall, its plain backdrop out, trimmed to what's left → { href, w, h }.
// ink: a logo or wordmark, trimmed as loadFeatureImage's ink option does.
async function featureImage(url, { ink = false } = {}) {
  const { Resvg } = require("@resvg/resvg-js");
  const got = await fetchBytes(directUrl(url));
  if (!got) return null;
  const href0 = `data:${got.mime};base64,${got.data.toString("base64")}`;
  // Its size (PNG or JPEG — what the shots and logos are).
  let size;
  try { size = got.mime.includes("png") ? pngSize(got.data) : null; } catch { size = null; }
  if (!size) size = jpegSize(got.data);
  if (!size?.w || !size?.h) return null;
  const k = Math.min(1, FEATURE_MAX / size.h);
  const w = Math.round(size.w * k);
  const h = Math.round(size.h * k);
  const px = new Uint8Array(new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><image href="${href0}" width="${w}" height="${h}" preserveAspectRatio="none"/></svg>`, { fitTo: { mode: "original" } }).render().pixels);
  if (hasBackdrop(px, w, h)) knockOut(px, w, h);
  const b = ink ? inkBounds(px, w, h) : opaqueBounds(px, w, h);
  if (!b || (b.w >= w && b.h >= h)) return { href: `data:image/png;base64,${encodePng(px, w, h).toString("base64")}`, w, h };
  const out = new Uint8Array(b.w * b.h * 4);
  for (let y = 0; y < b.h; y++) out.set(px.subarray(((b.y + y) * w + b.x) * 4, ((b.y + y) * w + b.x + b.w) * 4), y * b.w * 4);
  return { href: `data:image/png;base64,${encodePng(out, b.w, b.h).toString("base64")}`, w: b.w, h: b.h };
}

// A JPEG's width / height (its SOF marker).
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    const m = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

// A logo as it is → { href, w?, h? }.
async function plainImage(url) {
  const r = await fetchLogo(directUrl(url));
  if (!r.data) return null;
  let size = {};
  try { size = r.mime === "image/png" ? pngSize(r.data) : {}; } catch { size = {}; }
  return { href: `data:${r.mime};base64,${r.data.toString("base64")}`, ...size };
}

async function currentWeek(db, year) {
  const summary = (await db.collection("config").doc(summaryDocId(year)).get()).data();
  if (!summary?.weekId) return null;
  const snap = await db.collection("weeklyMocks").doc(summary.weekId).get();
  return snap.exists && snap.data().publishedAt ? { id: snap.id, ...snap.data() } : null;
}

// The team's first pick this week and his placed shots: { week, pick, shots }
// — shots empty when he has none (the page shows no graphic).
export async function firstPickOf(db, team, year) {
  const week = await currentWeek(db, year);
  const pick = (week?.picks || []).filter((p) => p.owner === team && p.player?.id).sort((a, b) => a.overall - b.overall)[0] || null;
  if (!pick) return { week, pick: null, shots: [] };
  const ph = await db.collection("playerPhotos").doc(pick.player.id).get();
  const shots = (ph.exists ? ph.data().action || [] : []).filter((a) => a?.url && a.firstPick);
  return { week, pick, shots };
}

// → { png, pick, shot } or null. width: drawn this wide (the graphic is
// 1080 × 1350; a smaller copy for the page's display, the same picture).
export async function firstPickPng(db, team, year, { random = Math.random, width = 1080 } = {}) {
  const { pick, shots } = await firstPickOf(db, team, year);
  if (!pick || !shots.length) return null;
  const shot = shots[Math.floor(random() * shots.length) % shots.length];
  const [pl, sch, nfl] = await Promise.all([
    db.collection("players").doc(pick.player.id).get(),
    pick.player.School ? db.collection("schools").where("School", "==", pick.player.School).limit(1).get() : null,
    db.collection("nfl").doc(team).get(),
  ]);
  // His height and weight from his doc; the rest as the mock has him.
  const player = { ...(pl.exists ? pl.data() : {}), ...pick.player };
  const school = sch?.docs[0]?.data() || (pick.player.logo ? { Logo1: pick.player.logo } : {});
  const address = `we-draft.com/mocks/${team.toLowerCase()}${year === MAIN_YEAR ? "" : `/${year}`}`;
  const input = firstPickInput({ player, school, team: nfl.exists ? nfl.data() : {}, abbr: team, pick: { overall: pick.overall, round: pick.round }, year, photo: shot, brandLogo: WD_LOGO, address });

  const images = {};
  const wd = fs.readFileSync(path.join(ROOT, "src", "assets", "Logo2.png"));
  images[WD_LOGO] = { href: `data:image/png;base64,${wd.toString("base64")}`, ...pngSize(wd) };
  const marks = new Set([input.wordmark, input.bgLogo].filter((u) => u && u !== input.photo));
  await Promise.all(firstPickImageUrls(input).filter((u) => u !== WD_LOGO).map(async (u) => {
    const im = u === input.photo ? await featureImage(u) : marks.has(u) ? await featureImage(u, { ink: true }) : await plainImage(u);
    if (im) images[u] = im;
  }));
  // His photo wouldn't load: no graphic rather than one without him.
  if (!images[input.photo]) return null;
  let svg = firstPickSvg(input, { measure, images });
  if (width !== 1080) svg = svg.replace('width="1080" height="1350"', `width="${width}" height="${Math.round((width * 1350) / 1080)}"`);
  const { png } = renderPng(svg);
  return { png, pick, shot };
}
