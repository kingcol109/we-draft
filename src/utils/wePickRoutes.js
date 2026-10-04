// src/utils/wePickRoutes.js
//
// We-Pick lives inside We-Draft Live at its own path: /live/we-pick (My
// Picks), /live/we-pick/standings, /live/we-pick/standings/Week%206,
// /live/we-pick/stats, /live/we-pick/friends. LivePage.js shows its We-Pick
// tab for any /live/we-pick… path (App.js routes /live/* to it). The old
// /we-pick… URLs and the interim /live?view=wepick&wp=…&wk=… links
// redirect here, so shared links keep working.
import { useLocation } from "react-router-dom";

export const WEPICK_TABS = ["picks", "standings", "stats", "friends"];
export const WEPICK_BASE = "/live/we-pick";

export function wePickHref(tab = "picks", week = null) {
  let path = WEPICK_BASE;
  if (tab && tab !== "picks") path += `/${tab}`;
  if (week && tab === "standings") path += `/${encodeURIComponent(week)}`;
  return path;
}

export const isWePickPath = (pathname) => pathname === WEPICK_BASE || pathname.startsWith(`${WEPICK_BASE}/`);

// The current We-Pick tab + standings week from the path.
export function useWePickRoute() {
  const { pathname } = useLocation();
  const [tab, week] = pathname.slice(WEPICK_BASE.length).split("/").filter(Boolean);
  return {
    tab: WEPICK_TABS.includes(tab) ? tab : "picks",
    week: tab === "standings" && week ? decodeURIComponent(week) : undefined,
  };
}
