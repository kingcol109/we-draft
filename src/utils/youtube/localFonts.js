// src/utils/youtube/localFonts.js
//
// Fonts that live on the admin's computer, never in the repo: Black Lives
// and Milker (the Game Review thumbnail — gamereview.js). Both are licensed
// to the admin, so they aren't bundled or uploaded. An SVG drawn as an image
// can't reach the computer's fonts (Black Lives isn't even reachable by name:
// its style is "BlackLives", not "Regular"), so each is read once:
//   - from the computer, with Chrome's Local Font Access (it asks permission
//     once: "Use this computer's fonts"), or
//   - from its file, picked by hand,
// and kept in this browser (localStorage) to embed in every SVG
// (@font-face, a data URI) and to measure in (document.fonts).

export const LOCAL_FONTS = [
  { family: "WD Black Lives", label: "Black Lives", names: ["aBlackLives", "Black Lives", "a Black Lives"] },
  { family: "WD Milker", label: "Milker", names: ["MilkerRegular", "Milker"] },
];
const KEY = (family) => `wdFont:${family}`;

const read = (family) => { try { return localStorage.getItem(KEY(family)) || ""; } catch { return ""; } };
const write = (family, b64) => { try { localStorage.setItem(KEY(family), b64); } catch { /* too big or blocked: this visit only */ } };
const memory = {};

const toB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;

async function register(family, b64) {
  memory[family] = b64;
  write(family, b64);
  if (typeof FontFace === "undefined") return;
  if ([...document.fonts].some((f) => f.family.replace(/"/g, "") === family)) return;
  const face = new FontFace(family, fromB64(b64));
  await face.load();
  document.fonts.add(face);
}

// The fonts this browser already has → { css (the @font-face rules), missing: [labels] }.
export async function localFontCss() {
  for (const f of LOCAL_FONTS) {
    const b64 = memory[f.family] || read(f.family);
    if (b64) await register(f.family, b64).catch(() => {});
  }
  return cssNow();
}
function cssNow() {
  const have = LOCAL_FONTS.filter((f) => memory[f.family]);
  return {
    css: have.map((f) => `@font-face{font-family:"${f.family}";src:url(data:font/otf;base64,${memory[f.family]}) format("opentype");}`).join(""),
    missing: LOCAL_FONTS.filter((f) => !memory[f.family]).map((f) => f.label),
  };
}

// Chrome's Local Font Access: call from a click (it asks permission).
export const canQueryLocalFonts = () => typeof window !== "undefined" && typeof window.queryLocalFonts === "function";
export async function fontsFromComputer() {
  const all = await window.queryLocalFonts();
  for (const f of LOCAL_FONTS) {
    if (memory[f.family]) continue;
    const hit = all.find((d) => f.names.includes(d.postscriptName) || f.names.includes(d.fullName));
    if (hit) await register(f.family, toB64(await (await hit.blob()).arrayBuffer()));
  }
  return cssNow();
}

// A font's file, picked by hand.
export async function fontFromFile(family, file) {
  await register(family, toB64(await file.arrayBuffer()));
  return cssNow();
}
