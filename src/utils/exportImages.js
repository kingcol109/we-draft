// src/utils/exportImages.js
//
// Logos in a share image. html-to-image can't safely use an externally
// hosted <img> — a host without CORS taints the canvas and blanks the whole
// export — so before capturing, every <img> in the card is redrawn through a
// CORS canvas and swapped for a data URL. One that can't be (no CORS header,
// failed load) gives way to its alt text or is hidden, so the worst case is the old text-only
// card, never a broken export. Cached per URL. Used by the Draft Sim's
// shares (draftSim/SimResults.jsx).
import { corsFriendlyImageUrl } from "./clipboardImage";

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
    });
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
