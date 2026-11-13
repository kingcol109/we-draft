// src/components/PostGallery.jsx
//
// An article's gallery (articles.gallery — a post put on the site from Admin
// → Content → Instagram, utils/instagram/sitePost.js): its slides and clips
// in order, as a carousel. Swipe or scroll it sideways (it snaps a slide at
// a time) — on a phone that's the only way, plus the dots; on a computer a
// blue chevron outside the post on either side does it with a click. A clip plays in
// place with its own controls, and pauses when it's swiped away.
import { useEffect, useRef, useState } from "react";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

export default function PostGallery({ items = [], title = "", isMobile = false }) {
  const track = useRef(null);
  const [at, setAt] = useState(0);
  const n = items.length;
  // The shape of the first slide sets the frame's (a post's is 4:5, a Short's 9:16).
  const first = items.find((it) => it.w && it.h);
  const ratio = first ? `${first.w} / ${first.h}` : "4 / 5";
  const tall = first && first.h / first.w > 1.5;
  const maxW = tall ? 380 : 560;

  // Which slide is showing, from where the track's scrolled to.
  useEffect(() => {
    const el = track.current;
    if (!el) return undefined;
    const onScroll = () => setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  // A clip that's scrolled away stops.
  useEffect(() => {
    track.current?.querySelectorAll("video").forEach((v) => { if (Number(v.dataset.i) !== at && !v.paused) v.pause(); });
  }, [at]);
  const go = (i) => {
    const el = track.current;
    if (el) el.scrollTo({ left: Math.max(0, Math.min(n - 1, i)) * el.clientWidth, behavior: "smooth" });
  };

  if (!n) return null;
  // A plain blue chevron just outside the post, hidden at either end.
  const arrow = (dir) => {
    const off = dir < 0 ? at === 0 : at === n - 1;
    return (
      <button aria-label={dir < 0 ? "Previous slide" : "Next slide"} onClick={() => go(at + dir)} disabled={off} className="wd-gallery-arrow"
        style={{
          position: "absolute", top: "50%", [dir < 0 ? "right" : "left"]: "calc(100% + 6px)", transform: "translateY(-50%)",
          width: "40px", height: "64px", border: "none", background: "transparent", padding: 0, color: BLUE,
          cursor: off ? "default" : "pointer", visibility: off ? "hidden" : "visible", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
        <svg width="26" height="44" viewBox="0 0 26 44" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={dir < 0 ? "M20 4 L6 22 L20 40" : "M6 4 L20 22 L6 40"} />
        </svg>
      </button>
    );
  };

  return (
    // A computer: room either side for the chevrons.
    <div style={{ maxWidth: isMobile || n < 2 ? `${maxW}px` : `min(${maxW}px, calc(100% - 100px))`, margin: "0 auto 24px" }}>
      <style>{".wd-gallery-track::-webkit-scrollbar { display: none; } .wd-gallery-arrow { opacity: 0.75; transition: opacity 0.15s; } .wd-gallery-arrow:hover { opacity: 1; }"}</style>
      <div style={{ position: "relative" }}>
      <div style={{ position: "relative", borderRadius: "12px", overflow: "hidden", border: `2px solid ${BLUE}`, background: "#05070b" }}>
        <div ref={track} className="wd-gallery-track"
          style={{ display: "flex", overflowX: "auto", scrollSnapType: "x mandatory", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
          {items.map((it, i) => (
            <div key={i} style={{ flex: "0 0 100%", scrollSnapAlign: "center", aspectRatio: ratio, display: "flex", alignItems: "center", justifyContent: "center", background: "#05070b" }}>
              {it.type === "video" ? (
                <video data-i={i} src={it.url} controls playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
              ) : (
                <img src={it.url} alt={`${title}${n > 1 ? ` — ${i + 1} of ${n}` : ""}`} loading={i === 0 ? "eager" : "lazy"} draggable={false}
                  style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", userSelect: "none" }} />
              )}
            </div>
          ))}
        </div>
        {n > 1 && (
          <div style={{ position: "absolute", top: "10px", right: "10px", zIndex: 2, background: "rgba(0,0,0,0.6)", color: "#fff", borderRadius: "12px", padding: "3px 10px", fontSize: "12px", fontWeight: 800 }}>
            {at + 1} / {n}
          </div>
        )}
      </div>
      {n > 1 && !isMobile && arrow(-1)}
      {n > 1 && !isMobile && arrow(1)}
      </div>
      {n > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: "7px", marginTop: "10px" }}>
          {items.map((_, i) => (
            <button key={i} aria-label={`Slide ${i + 1}`} onClick={() => go(i)}
              style={{ width: i === at ? "22px" : "9px", height: "9px", borderRadius: "5px", border: "none", padding: 0, cursor: "pointer", background: i === at ? GOLD : "#c9d3e0", transition: "width 0.2s, background 0.2s" }} />
          ))}
        </div>
      )}
    </div>
  );
}
