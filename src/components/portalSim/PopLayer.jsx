// src/components/portalSim/PopLayer.jsx
//
// Where the Portal Sim's popups render (user, 2026-11-22: "these popups
// don't scroll"). A popup drawn inside the sim sits under whatever the sim's
// wrappers do (animations with transforms, the fullscreen box), which can
// pin a position: fixed layer to the wrong box and leave its bottom out of
// reach. So popups render at the top of the page — or into the fullscreen
// element while the sim is fullscreen, or they'd be hidden — and scroll
// inside their own box (PopLayer's `maxHeight` helper), never the page.
import { createPortal } from "react-dom";

// The page's CSS zoom (utils/pageZoom.js) scales vh — divide it back out.
export const popMaxHeight = (gap = 40) => `calc(100vh / var(--pz, 1) - ${gap}px)`;

export default function PopLayer({ children }) {
  if (typeof document === "undefined") return children;
  return createPortal(children, document.fullscreenElement || document.body);
}
