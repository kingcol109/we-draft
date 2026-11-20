// src/components/SiteFullscreenButton.jsx
//
// The desktop navbar's full-screen toggle (user, 2026-11-18): the whole
// site goes full screen (the page's root element) and back. Since
// 2026-11-20 it sits right of Profile, and in full screen the navbar tucks
// away behind a ▼ tab at the top (Navbar.js). Hidden where the browser has no Fullscreen API
// (iPhone Safari). The sims' own full-screen buttons still take just the
// sim; leaving full screen anywhere (Esc) is the browser's.
import { useEffect, useState } from "react";

const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const canFullscreen = () => typeof document !== "undefined"
  && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled)
  && !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);

function enter() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  try { const r = req.call(el, { navigationUI: "hide" }); if (r?.catch) r.catch(() => {}); } catch (e) { /* refused */ }
}
function exit() {
  const ex = document.exitFullscreen || document.webkitExitFullscreen;
  try { const r = ex.call(document); if (r?.catch) r.catch(() => {}); } catch (e) { /* not full screen */ }
}

// True while the whole site (the root element) is full screen — not when a
// sim has put just itself full screen. The Navbar hides itself then.
export function useSiteFullscreen() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(fsElement() === document.documentElement);
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    sync();
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);
  return on;
}

export default function SiteFullscreenButton({ style }) {
  const on = useSiteFullscreen();
  const [able] = useState(canFullscreen);
  if (!able) return null;
  const label = on ? "Exit full screen" : "Full screen";
  return (
    <button type="button" onClick={() => (fsElement() ? exit() : enter())} aria-label={label} title={`${label} (Esc to exit)`} className="wd-nav-fs"
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, flexShrink: 0,
        borderRadius: 9, border: "1px solid rgba(255,255,255,0.35)", background: on ? "rgba(246,162,29,0.25)" : "rgba(255,255,255,0.08)",
        color: "#fff", cursor: "pointer", padding: 0, ...style,
      }}>
      <style>{".wd-nav-fs { transition: background .15s, border-color .15s; } .wd-nav-fs:hover { background: rgba(255,255,255,0.2) !important; border-color: #f6a21d !important; }"}</style>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {on
          ? <><path d="M9 3v6H3" /><path d="M15 3v6h6" /><path d="M9 21v-6H3" /><path d="M15 21v-6h6" /></>
          : <><path d="M3 9V3h6" /><path d="M21 9V3h-6" /><path d="M3 15v6h6" /><path d="M21 15v6h-6" /></>}
      </svg>
    </button>
  );
}
