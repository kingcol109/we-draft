// src/hooks/useMobileStuckPageWatchdog.js
//
// Mobile browsers routinely suspend an in-flight request when a tab gets
// backgrounded (screen lock, app switch, a notification banner) without
// ever rejecting the underlying promise — the fetch just never resolves
// once the tab comes back, and the page has no way to tell "still
// fetching" apart from "silently abandoned." A manual refresh sidesteps
// it entirely (fresh connection, fresh request), which is exactly what
// this hook automates: if the tab was hidden and becomes visible again
// while `loading` is still true, or if it's simply been stuck too long
// regardless, force a real reload rather than trusting a retry over
// whatever connection state the backgrounding left behind.
//
// Mobile-only by design (pass `enabled` as your own isMobile flag, or
// omit it and this checks window.innerWidth itself) — desktop tabs
// aren't suspended the same way, and a stuck load there is far more
// likely a real bug worth surfacing than a connection worth papering
// over with a silent reload.
//
// `key` scopes the sessionStorage guard (typically the route's own
// slug/id) so a genuinely slow — not stuck — load gets exactly one
// automatic retry, never a reload loop; the guard clears again once
// `loading` goes false, so a later, separate hang on the same page still
// gets its own retry.
//
// First written inline for PlayerProfile.js's own player-doc fetch, then
// extracted here so every page with this same "load one thing by slug,
// spinner until it lands" shape can share it.
import { useEffect } from "react";

export function useMobileStuckPageWatchdog(loading, key, { enabled, timeoutMs = 3000 } = {}) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isMobile = enabled !== undefined ? enabled : window.innerWidth < 768;
    if (!isMobile || !key) return;

    const guardKey = `wd_watchdog_${key}`;
    if (!loading) {
      try { sessionStorage.removeItem(guardKey); } catch { /* private mode etc — nothing to clear */ }
      return;
    }
    let alreadyTried = false;
    try { alreadyTried = sessionStorage.getItem(guardKey) === "1"; } catch { /* assume not tried */ }
    if (alreadyTried) return;

    const forceReload = () => {
      try { sessionStorage.setItem(guardKey, "1"); } catch { /* best effort — still reload either way */ }
      window.location.reload();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && loading) forceReload();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const timer = setTimeout(forceReload, timeoutMs);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimeout(timer);
    };
  }, [loading, key, enabled, timeoutMs]);
}
