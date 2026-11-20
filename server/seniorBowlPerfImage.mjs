// server/seniorBowlPerfImage.mjs
//
// A Senior Bowl Top Performer's graphic (src/utils/instagram/seniorBowlPerf.js)
// drawn on the server — for api/senior-bowl-graphic.js, the one permanent
// image URL per performer the performances page shows (and Google indexes).
// Same image work as the Draft Risers (riserImage.mjs): the action shot cut
// out and trimmed so its saved First Pick placement lands where it was set.
// null when there's nothing to draw (not on the list, no placed shot, his
// photo won't load).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { featureImage, plainImage } from "./firstPickImage.mjs";
import { perfInput, perfSvg, perfImageUrls } from "../src/utils/instagram/seniorBowlPerf.js";
import { perfShot, SBP_DOC, SBP_EDITIONS, perfEditionId, isPerfEditionDate } from "../src/utils/seniorBowlPerf.js";

const require = createRequire(import.meta.url);
const { renderPng, measure, pngSize } = require("./stream-manager/thumbnail");

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WD_LOGO = "wd-logo";
const EVENT_LOGO = "sb-logo";
const dataUri = (file) => {
  const buf = fs.readFileSync(file);
  return { href: `data:image/png;base64,${buf.toString("base64")}`, ...pngSize(buf) };
};

// → { perf, shots } or null. edition: a past edition's date.
export async function perfOf(db, slug, year, edition = "") {
  const snap = isPerfEditionDate(edition)
    ? await db.collection(SBP_EDITIONS).doc(perfEditionId(year, edition)).get()
    : await db.collection(SBP_DOC).doc(String(year)).get();
  const players = snap.exists ? snap.data().players || [] : [];
  const perf = players.find((r) => r.slug === slug);
  if (!perf?.id) return null;
  const ph = await db.collection("playerPhotos").doc(perf.id).get();
  const shots = (ph.exists ? ph.data().action || [] : []).filter((a) => a?.url && a.firstPick);
  return { perf, shots };
}

// → { png | webp, perf, shot } or null. width: drawn this wide (1080 × 1350 full).
export async function perfPng(db, slug, year, { width = 1080, format = "png", edition = "" } = {}) {
  const found = await perfOf(db, slug, year, edition);
  if (!found?.shots.length) return null;
  const { perf, shots } = found;
  const shot = perfShot(perf, shots);
  const pl = await db.collection("players").doc(perf.id).get();
  const player = pl.exists ? pl.data() : {};
  const schoolName = player.School || perf.school;
  const sch = schoolName ? await db.collection("schools").where("School", "==", schoolName).limit(1).get() : null;
  const input = perfInput({ perf, player, school: sch?.docs[0]?.data() || {}, year, photo: shot, eventLogo: EVENT_LOGO, brandLogo: WD_LOGO });

  const images = {
    [WD_LOGO]: dataUri(path.join(ROOT, "src", "assets", "Logo2.png")),
    [EVENT_LOGO]: dataUri(path.join(ROOT, "public", "logos", "senior-bowl.png")),
  };
  await Promise.all(perfImageUrls(input).filter((u) => u !== WD_LOGO && u !== EVENT_LOGO).map(async (u) => {
    const im = u === input.photo ? await featureImage(u) : await plainImage(u);
    if (im) images[u] = im;
  }));
  if (!images[input.photo]) return null;
  let svg = perfSvg(input, { measure, images });
  if (width !== 1080) svg = svg.replace('width="1080" height="1350"', `width="${width}" height="${Math.round((width * 1350) / 1080)}"`);
  const { png } = renderPng(svg);
  if (format === "webp") {
    const { default: sharp } = await import("sharp");
    return { webp: await sharp(png).webp({ quality: 82 }).toBuffer(), perf, shot };
  }
  return { png, perf, shot };
}
