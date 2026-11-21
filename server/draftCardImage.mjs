// server/draftCardImage.mjs
//
// A featured NFL Targets player's draft card (src/utils/instagram/
// draftCard.js) drawn on the server — for api/draft-card.js, the permanent
// image URL the team page's Targets tab shows (components/TeamTargetsWX.jsx),
// Google Images indexes, and the team page uses as its link-preview image.
// The same image work as the Risers graphic (firstPickImage.mjs
// featureImage: the action shot cut out and trimmed, so its First Pick
// placement lands where it was set).
//
// The player: a featured entry, found by his slug, on the team's PUBLISHED
// list (nflTargets/{TEAM}). The shot: the one the team's list picked for him
// (entry.shot), else his first placed shot; none → the card's no-shot
// version (his school's logo). null when he isn't featured on a published
// list (→ a noindex 404).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { featureImage, plainImage } from "./firstPickImage.mjs";
import { draftCardInput, draftCardSvg, draftCardImageUrls } from "../src/utils/instagram/draftCard.js";

const require = createRequire(import.meta.url);
const { renderPng, measure, pngSize } = require("./stream-manager/thumbnail");

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BADGE = "wd-badge";
const WORDMARK = "wd-wordmark";
const DRAFT_LOGO = "draft-logo";
const DRAFT_LOGO_YEARS = ["2027", "2028", "2029"];

function asset(file) {
  const b = fs.readFileSync(path.join(ROOT, "src", "assets", file));
  return { href: `data:image/png;base64,${b.toString("base64")}`, ...pngSize(b) };
}

// → { png } (or { webp } with format "webp") and the entry, or null.
// width: drawn this wide (1080 × 1350 full).
export async function draftCardPng(db, slug, year, team, { width = 1080, format = "png" } = {}) {
  const T = String(team || "").toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(T)) return null;
  const list = await db.collection("nflTargets").doc(T).get();
  const data = list.exists ? list.data() : null;
  if (!data?.published || String(data.year || "") !== String(year)) return null;
  const entry = (data.featured || []).find((r) => r.slug === slug);
  if (!entry?.id) return null;

  const [ph, sch] = await Promise.all([
    db.collection("playerPhotos").doc(entry.id).get(),
    entry.school ? db.collection("schools").where("School", "==", entry.school).limit(1).get() : null,
  ]);
  const shots = (ph.exists ? ph.data().action || [] : []).filter((a) => a?.url && a.firstPick);
  const shot = shots.find((s) => s.url === entry.shot) || shots[0] || null;
  const input = draftCardInput({
    player: entry, college: sch?.docs[0]?.data() || null, year, photo: shot,
    draftLogo: DRAFT_LOGO_YEARS.includes(String(year)) ? DRAFT_LOGO : "", brandLogo: BADGE, wordmark: WORDMARK,
  });

  const images = { [BADGE]: asset("wd-badge.png"), [WORDMARK]: asset("Logo2.png") };
  if (input.draftLogo) images[DRAFT_LOGO] = asset(`class-logo-${year}.png`);
  await Promise.all(draftCardImageUrls(input).filter((u) => !images[u]).map(async (u) => {
    const im = u === input.photo ? await featureImage(u) : await plainImage(u);
    if (im) images[u] = im;
  }));
  let svg = draftCardSvg(input, { measure, images });
  if (width !== 1080) svg = svg.replace('width="1080" height="1350"', `width="${width}" height="${Math.round((width * 1350) / 1080)}"`);
  const { png } = renderPng(svg);
  if (format === "webp") {
    const { default: sharp } = await import("sharp");
    return { webp: await sharp(png).webp({ quality: 82 }).toBuffer(), entry };
  }
  return { png, entry };
}
