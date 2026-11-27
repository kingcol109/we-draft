// server/portalNewsImage.mjs
//
// A Portal News player's graphic (src/utils/instagram/transfer.js — the
// portal cover while he's in the portal, the transfer cover in his entry's
// design once he's committed) drawn on the server, as a PNG or WebP — for
// api/portal-graphic.js, the one permanent image URL per player that
// /portal/news shows (pages/PortalNews.jsx) and Google indexes. The same
// drawing the page does in the browser (components/PortalNewsGraphic.jsx
// drawPortalCover) and the same image work as the Draft Risers'
// (server/riserImage.mjs: firstPickImage.mjs featureImage, the action shot
// cut out and trimmed, so its saved placement lands where it was set).
//
// The player: his entry on the published board (portalNews/current), found
// by his slug. The shot: the one saved on him (entry.shot), else his first
// action shot placed for First Pick. null when there's nothing to draw (not
// on the board, no placed shot, his photo won't load).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { featureImage, plainImage } from "./firstPickImage.mjs";
import { transferInput, transferSlides, transferImageUrls } from "../src/utils/instagram/transfer.js";
import { PORTAL_NEWS_DOC, PORTAL_NEWS_PATH, statsTitleOf, isProjected, projectedGraphicIds, getsGraphic } from "../src/utils/portalNews.js";

const require = createRequire(import.meta.url);
const { renderPng, measure, pngSize } = require("./stream-manager/thumbnail");

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WD_LOGO = "wd-logo";

// → { entry, shot } or null — his entry on the board and the shot his graphic uses.
export async function portalNewsEntryOf(db, slug) {
  const snap = await db.collection(PORTAL_NEWS_DOC[0]).doc(PORTAL_NEWS_DOC[1]).get();
  const entries = snap.exists ? snap.data().entries || [] : [];
  const entry = entries.find((e) => e.slug === slug);
  if (!entry?.id) return null;
  // Projected past his position's top 3: no graphic (a headshot on the page).
  if (!getsGraphic(entry, projectedGraphicIds(entries))) return null;
  const ph = await db.collection("playerPhotos").doc(entry.id).get();
  const shots = (ph.exists ? ph.data().action || [] : []).filter((a) => a?.url && a.firstPick);
  const shot = shots.find((s) => s.url === entry.shot) || shots[0] || null;
  return { entry, shot };
}

// → { png } / { webp } (format "webp" — the page's images; the PNG stays for
// social previews) or null. width: drawn this wide (1080 × 1350 full).
export async function portalNewsPng(db, slug, { width = 1080, format = "png" } = {}) {
  const found = await portalNewsEntryOf(db, slug);
  if (!found?.shot) return null;
  const { entry, shot } = found;
  const school = async (name) => (name ? (await db.collection("schools").where("School", "==", name).limit(1).get()).docs[0]?.data() || {} : {});
  const [pl, from, to] = await Promise.all([
    db.collection("players").doc(entry.id).get(),
    school(entry.from),
    entry.status === "committed" ? school(entry.to) : Promise.resolve({}),
  ]);
  const player = pl.exists ? pl.data() : {};
  const input = transferInput({
    kind: entry.status === "committed" ? "transfer" : "portal", design: entry.design || "welcome",
    player: { ...player, First: player.First || entry.first, Last: player.Last || entry.last, Position: player.Position || entry.pos },
    from, fromName: entry.from, to, toName: entry.to || "",
    photo: shot, stats: entry.stats, statsTitle: statsTitleOf(entry), projected: isProjected(entry),
    brandLogo: WD_LOGO, badgeLogo: "", address: `WE-DRAFT.COM${PORTAL_NEWS_PATH.toUpperCase()}`,
  });

  const images = {};
  const wd = fs.readFileSync(path.join(ROOT, "src", "assets", "Logo2.png"));
  images[WD_LOGO] = { href: `data:image/png;base64,${wd.toString("base64")}`, ...pngSize(wd) };
  await Promise.all(transferImageUrls(input).filter((u) => u !== WD_LOGO).map(async (u) => {
    const im = u === input.photo ? await featureImage(u) : await plainImage(u);
    if (im) images[u] = im;
  }));
  if (!images[input.photo]) return null;
  let svg = transferSlides(input, { measure, images })[0].svg;
  if (width !== 1080) svg = svg.replace('width="1080" height="1350"', `width="${width}" height="${Math.round((width * 1350) / 1080)}"`);
  const { png } = renderPng(svg);
  if (format === "webp") {
    const { default: sharp } = await import("sharp");
    return { webp: await sharp(png).webp({ quality: 82 }).toBuffer(), entry };
  }
  return { png, entry };
}
