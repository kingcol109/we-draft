// server/riserImage.mjs
//
// A Draft Riser's graphic (src/utils/instagram/riser.js) drawn on the
// server, as a PNG — for api/riser-graphic.js, the one permanent image URL
// per riser the /risers/{year} page shows (and Google indexes). The same
// image work as First Pick (firstPickImage.mjs featureImage: the action
// shot cut out and trimmed, so its saved placement lands where it was set).
//
// The riser: his entry in risers/{year}, found by his slug. The shot: the
// one saved on him (riser.shot — chosen on the admin's Save), else his
// first action shot placed for First Pick (playerPhotos action[i].firstPick). null when there's nothing to draw (not a riser,
// no placed shot, his photo won't load).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { featureImage, plainImage } from "./firstPickImage.mjs";
import { riserInput, riserSvg, riserImageUrls } from "../src/utils/instagram/riser.js";
import { risersRanked, riserShot, RISER_EDITIONS, editionId, isEditionDate } from "../src/utils/risers.js";

const require = createRequire(import.meta.url);
const { renderPng, measure, pngSize } = require("./stream-manager/thumbnail");

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WD_LOGO = "wd-logo";

// → { riser, rank, shots } or null — his entry, his place on the board, his placed shots.
// edition: a past edition's date — his entry as it was published then.
export async function riserOf(db, slug, year, edition = "") {
  const snap = isEditionDate(edition)
    ? await db.collection(RISER_EDITIONS).doc(editionId(year, edition)).get()
    : await db.collection("risers").doc(String(year)).get();
  const players = snap.exists ? snap.data().players || [] : [];
  const riser = players.find((r) => r.slug === slug);
  if (!riser?.id) return null;
  const rank = risersRanked(players).findIndex((r) => r.slug === slug) + 1;
  const ph = await db.collection("playerPhotos").doc(riser.id).get();
  const shots = (ph.exists ? ph.data().action || [] : []).filter((a) => a?.url && a.firstPick);
  return { riser, rank, shots };
}

// → { png, riser, shot } or null — or { webp, … } with format "webp" (the
// page's images: ~80 KB against the PNG's ~1.2 MB; the PNG stays for social
// previews). width: drawn this wide (1080 × 1350 full).
export async function riserPng(db, slug, year, { width = 1080, format = "png", edition = "" } = {}) {
  const found = await riserOf(db, slug, year, edition);
  if (!found?.shots.length) return null;
  const { riser, rank, shots } = found;
  const shot = riserShot(riser, shots);
  const pl = await db.collection("players").doc(riser.id).get();
  const player = pl.exists ? pl.data() : {};
  const schoolName = player.School || riser.school;
  const sch = schoolName ? await db.collection("schools").where("School", "==", schoolName).limit(1).get() : null;
  const input = riserInput({ riser, player, school: sch?.docs[0]?.data() || {}, rank, year, photo: shot, brandLogo: WD_LOGO, address: `we-draft.com/risers/${year}` });

  const images = {};
  const wd = fs.readFileSync(path.join(ROOT, "src", "assets", "Logo2.png"));
  images[WD_LOGO] = { href: `data:image/png;base64,${wd.toString("base64")}`, ...pngSize(wd) };
  await Promise.all(riserImageUrls(input).filter((u) => u !== WD_LOGO).map(async (u) => {
    const im = u === input.photo ? await featureImage(u) : await plainImage(u);
    if (im) images[u] = im;
  }));
  if (!images[input.photo]) return null;
  let svg = riserSvg(input, { measure, images });
  if (width !== 1080) svg = svg.replace('width="1080" height="1350"', `width="${width}" height="${Math.round((width * 1350) / 1080)}"`);
  const { png } = renderPng(svg);
  if (format === "webp") {
    const { default: sharp } = await import("sharp");
    const webp = await sharp(png).webp({ quality: 82 }).toBuffer();
    return { webp, riser, shot };
  }
  return { png, riser, shot };
}
