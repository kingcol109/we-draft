// src/utils/clipboardImage.js
//
// Copying an image's actual pixels (not its URL) to the clipboard, so it
// pastes straight into Canva/Photoshop/etc. Used by the admin panel's
// Branding logo fields and Admin → Ads (AdminAdsManager.js).

// Many of the logo URLs stored in schools/nfl are bare "imgur.com/xxx.png"
// links — Imgur happily serves the raw image bytes from that host (that's
// why the <img> previews render fine), but it caps that domain's
// Access-Control-Allow-Origin to https://imgur.com itself, which blocks the
// cross-origin canvas read a clipboard-image-copy needs. The i.imgur.com
// CDN subdomain serves the identical bytes with a permissive CORS header,
// so rewrite to it before fetching. No-op for every other host.
export function corsFriendlyImageUrl(url) {
  return url.replace(/^(https?:\/\/)imgur\.com\//i, "$1i.imgur.com/");
}

// ── Draws a (possibly cross-origin) logo URL onto a canvas and exports it
// as a PNG blob, so it can be written to the clipboard as actual image data
// rather than just a URL string — the point being to paste straight into
// Canva/Photoshop/etc. Requires the image host to serve CORS headers
// (Access-Control-Allow-Origin); if it doesn't, the canvas comes back
// "tainted" and toBlob throws a SecurityError, which the caller treats as a
// normal copy failure rather than crashing. ──
export function loadImageAsPngBlob(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        canvas.getContext("2d").drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Canvas failed to export the image."));
        }, "image/png");
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("Image failed to load for clipboard copy."));
    img.src = corsFriendlyImageUrl(url);
  });
}

// navigator.clipboard.write() is called synchronously (with a pending
// Promise<Blob> as the value) rather than after an awaited fetch, since
// some browsers only honor clipboard writes that happen within the
// original click's user-activation window — so call this straight from the
// click handler.
export function copyImageToClipboard(url) {
  try {
    return navigator.clipboard.write([
      new window.ClipboardItem({ "image/png": loadImageAsPngBlob(url) }),
    ]);
  } catch (e) {
    return Promise.reject(e);
  }
}
