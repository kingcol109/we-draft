// src/utils/exportImages.js
//
// Logos in a share image. html-to-image can't safely use an externally
// hosted <img> — a host without CORS taints the canvas and blanks the whole
// export — so before capturing, every <img> in the card is redrawn through a
// CORS canvas and swapped for a data URL. One that can't be (no CORS header,
// failed load) gives way to its alt text or is hidden, so the worst case is the old text-only
// card, never a broken export. Cached per URL (a failure isn't, so the next
// share tries again).
//
// renderShareImage is the one way the site makes a share image — the Draft
// Sim's (draftSim/SimResults.jsx), a mock's (ShareMockButton.jsx) and
// We-Pick's (WePickHub.js): logos inlined, then html-to-image. Safari (every
// browser on an iPhone) paints the capture before the images inside it are
// decoded, so its first pass or two come back with blank logos — it renders
// a few times there and keeps the last.
import * as htmlToImage from "html-to-image";
import { corsFriendlyImageUrl } from "./clipboardImage";
import { withoutPageZoom } from "./pageZoom";

const cache = {};
function toDataUrl(url) {
  if (!cache[url]) {
    cache[url] = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = img.naturalWidth || img.width;
          c.height = img.naturalHeight || img.height;
          c.getContext("2d").drawImage(img, 0, 0);
          resolve(c.toDataURL("image/png"));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = corsFriendlyImageUrl(url);
    }).then((data) => { if (!data) delete cache[url]; return data; });
  }
  return cache[url];
}

export async function inlineImages(root) {
  if (!root) return;
  await Promise.all([...root.querySelectorAll("img")].map(async (el) => {
    const src = el.getAttribute("src") || "";
    if (src.startsWith("data:") || el.dataset.inlineFailed) return;
    const data = src ? await toDataUrl(src) : null;
    if (!data) {
      // Hidden (React still owns the node, so it stays put), with its alt
      // text — a team's abbreviation — standing in beside it.
      el.style.display = "none";
      el.dataset.inlineFailed = "1";
      if (el.alt) el.after(document.createTextNode(el.alt));
      return;
    }
    el.src = data;
    try { await el.decode(); } catch { /* still usable once loaded */ }
  }));
}

// WebKit: Safari, and every browser on an iPhone or iPad (iPadOS reports
// itself as a Mac with touch).
const isWebKit = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
    || (/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|Android/.test(ua));
};
// WebKit's passes: at least MIN, at most MAX, stopping once a pass comes
// out no bigger than the one before — a pass with blank logos is a smaller
// PNG, so the size stops growing once every logo's drawn.
const SAFARI_MIN_PASSES = 2;
const SAFARI_MAX_PASSES = 6;

// The card (an off-screen element) as a PNG data URL, logos and all.
// options: html-to-image's (pixelRatio, backgroundColor…); fonts are skipped
// — the cards use system fonts.
export async function renderShareImage(node, options = {}) {
  await inlineImages(node);
  const render = () => withoutPageZoom(() => htmlToImage.toPng(node, { skipFonts: true, ...options }));
  let url = await render();
  if (!isWebKit()) return url;
  for (let pass = 2; pass <= SAFARI_MAX_PASSES; pass += 1) {
    const next = await render();
    const grew = next.length > url.length * 1.005;
    url = next.length >= url.length ? next : url;
    if (pass >= SAFARI_MIN_PASSES && !grew) break;
  }
  return url;
}
