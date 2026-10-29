// src/hooks/useStuckSpinnerWatchdog.js
//
// The site-wide version of useMobileStuckPageWatchdog.js, for every page:
// on a phone, a page-level loading spinner (LoadingSpinner.js sized to the
// viewport — a route's chunk downloading, or a page's own data) still up
// after STUCK_MS, or still up when a backgrounded tab comes back, gets one
// real reload. Mobile browsers suspend requests when a tab is backgrounded
// and never resolve them; a reload is the fix. Once per URL (a
// sessionStorage guard, cleared when the page finishes loading), so a
// genuinely slow page gets one retry, never a loop. Mounted once, in App.js.
import { useEffect } from "react";

export const STUCK_MS = 5000;
const MOBILE_MAX_WIDTH = 768;

// Page-level spinners on screen right now, and who's listening.
let spinners = 0;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(spinners));

// A page-level spinner mounting → its unmount (LoadingSpinner's effect).
export function trackPageSpinner() {
  spinners += 1;
  notify();
  return () => { spinners = Math.max(0, spinners - 1); notify(); };
}

const guardKey = () => `wd_stuck_${window.location.pathname}`;

export function useStuckSpinnerWatchdog() {
  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth >= MOBILE_MAX_WIDTH) return undefined;
    let timer = null;
    const tried = () => { try { return sessionStorage.getItem(guardKey()) === "1"; } catch { return false; } };
    const reload = () => {
      if (!spinners || tried()) return;
      try { sessionStorage.setItem(guardKey(), "1"); } catch { /* best effort — reload either way */ }
      window.location.reload();
    };
    const update = (n) => {
      if (n > 0) {
        if (!timer) timer = setTimeout(() => { timer = null; reload(); }, STUCK_MS);
      } else {
        clearTimeout(timer);
        timer = null;
        // Loaded: a later hang on this page gets its own retry.
        try { sessionStorage.removeItem(guardKey()); } catch { /* nothing to clear */ }
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible" && spinners) reload(); };
    listeners.add(update);
    document.addEventListener("visibilitychange", onVisible);
    update(spinners);
    return () => {
      listeners.delete(update);
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(timer);
    };
  }, []);
}
