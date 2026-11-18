// src/utils/scrollLock.js
//
// Keeps the page behind a popup from scrolling (user, 2026-11-18: in the
// Portal Sim's popups, scrolling moved whatever was behind them). Locks
// both <html> and <body> (iOS Safari ignores a body-only lock) and stops
// scroll chaining; counted, so stacked popups unlock only when the last one
// closes. Pair it with `overscrollBehavior: "contain"` on the popup's own
// scroll box.
import { useEffect } from "react";

let locks = 0;
let saved = null;

export function lockScroll() {
  if (locks === 0) {
    const html = document.documentElement;
    const body = document.body;
    saved = { ho: html.style.overflow, hb: html.style.overscrollBehavior, bo: body.style.overflow, bb: body.style.overscrollBehavior };
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
  }
  locks += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    locks = Math.max(0, locks - 1);
    if (locks === 0 && saved) {
      const html = document.documentElement;
      const body = document.body;
      html.style.overflow = saved.ho;
      html.style.overscrollBehavior = saved.hb;
      body.style.overflow = saved.bo;
      body.style.overscrollBehavior = saved.bb;
      saved = null;
    }
  };
}

// While `on`, the page behind stays put.
export function useScrollLock(on = true) {
  useEffect(() => (on ? lockScroll() : undefined), [on]);
}
