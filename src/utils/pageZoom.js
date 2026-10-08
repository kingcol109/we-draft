// Auto-fit for mid-size PC screens. Desktop layouts are built for ~1600px
// of width; laptops with Windows display scaling (125–150%) report only
// 1024–1536 CSS px, so the desktop layout overflows. Below DESIGN_WIDTH we
// apply CSS `zoom` to <html> so the page renders like the user zoomed out
// (min 80%). Touch devices and narrow (mobile-layout) widths are untouched.
//
// Side effects of `zoom` that code must account for (Chrome 128+/Firefox 126+):
//  - getBoundingClientRect / clientX / innerWidth are in *screen* px, but px
//    written to style (left/top/width) get multiplied by the zoom. Convert
//    measured values with toCssPx(), and use viewportCssWidth/Height().
//  - vh units are multiplied too; CSS uses calc(100vh / var(--pz, 1)).
//  - Image export (html2canvas / html-to-image) should run via withoutPageZoom().

const DESIGN_WIDTH = 1600;
const MIN_ZOOM = 0.8;
const MIN_ZOOM_WIDTH = 1024; // below this the site's tablet/mobile layouts take over

let coordScale = 1; // ratio of measured (screen) px to CSS px
let vhScale = 1;    // ratio of rendered vh to real viewport height
let suspended = false;

function targetZoom() {
  if (typeof window === "undefined") return 1;
  const fine = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
  const w = window.innerWidth;
  if (!fine || w < MIN_ZOOM_WIDTH || w >= DESIGN_WIDTH) return 1;
  return Math.max(MIN_ZOOM, Math.round((w / DESIGN_WIDTH) * 100) / 100);
}

// Measure rather than assume, so browsers with legacy zoom semantics
// (where measurements aren't scaled) get a no-op correction.
function measure() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:0;top:0;width:100px;height:100vh;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  coordScale = r.width / 100 || 1;
  vhScale = window.innerHeight ? r.height / window.innerHeight || 1 : 1;
  document.documentElement.style.setProperty("--pz", String(vhScale));
}

function apply() {
  if (suspended) return;
  const z = targetZoom();
  const root = document.documentElement;
  const current = parseFloat(root.style.zoom) || 1;
  if (z !== current) root.style.zoom = z === 1 ? "" : String(z);
  measure();
  if (z !== current) window.dispatchEvent(new Event("pagezoomchange"));
}

export function initPageZoom() {
  if (typeof window === "undefined" || !document.body) return;
  apply();
  window.addEventListener("resize", apply);
  window.matchMedia?.("(hover: hover) and (pointer: fine)").addEventListener?.("change", apply);
}

// Current page zoom as seen by measurements (1 when not zoomed).
export const getPageScale = () => coordScale;

// Convert a measured value (getBoundingClientRect, clientX, innerWidth) to
// CSS px suitable for writing into style.
export const toCssPx = (px) => px / coordScale;

// getBoundingClientRect() converted to CSS px.
export function cssRect(el) {
  const r = el.getBoundingClientRect();
  const k = coordScale;
  return { left: r.left / k, right: r.right / k, top: r.top / k, bottom: r.bottom / k, width: r.width / k, height: r.height / k };
}

// dnd-kit computes transforms from pointer movement in screen px; scale them
// to CSS px so a dragged item tracks the cursor.
export const unzoomTransform = (t) => (t && coordScale !== 1 ? { ...t, x: t.x / coordScale, y: t.y / coordScale } : t);

export const viewportCssWidth = () => window.innerWidth / coordScale;
export const viewportCssHeight = () => window.innerHeight / coordScale;

// Run an image export with zoom temporarily removed so the capture library
// sees consistent geometry. Restores the zoom afterward.
export async function withoutPageZoom(fn) {
  const root = document.documentElement;
  const prev = root.style.zoom;
  if (!prev) return fn();
  suspended = true;
  root.style.zoom = "";
  measure();
  try {
    return await fn();
  } finally {
    suspended = false;
    root.style.zoom = prev;
    apply();
  }
}
