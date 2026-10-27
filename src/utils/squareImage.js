// src/utils/squareImage.js
//
// An uploaded image → a small square data: URL, so it can live in a
// Firestore doc itself — no Storage bucket needed. WebP where the browser
// can write it (keeps transparency), else PNG. fit "cover" center-crops
// (profile pictures); "contain" keeps the whole image, centered on a
// transparent square (logos, badge icons). Used by Admin → Mock Draft's
// personality avatars and school logos, and its Badges.
export function squareImage(file, size = 160, fit = "cover") {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const ctx2d = c.getContext("2d");
      if (fit === "contain") {
        const k = size / Math.max(img.width, img.height);
        const w = img.width * k;
        const h = img.height * k;
        ctx2d.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      } else {
        const m = Math.min(img.width, img.height);
        ctx2d.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
      }
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/webp", 0.85));
    };
    img.onerror = () => reject(new Error("Not an image."));
    img.src = URL.createObjectURL(file);
  });
}
