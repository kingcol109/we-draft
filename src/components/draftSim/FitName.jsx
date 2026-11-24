// src/components/draftSim/FitName.jsx
//
// A prospect's name for the sim's tight rows: "Malik Washington" when it
// fits — a little smaller if that's what it takes (down to MIN_SCALE) —
// "M. Washington" when it doesn't.

import { useLayoutEffect, useRef, useState } from "react";

const MIN_SCALE = 0.78;
// A name that's the full one when it fits its box (scaled down to fit, as
// far as MIN_SCALE), else the short one (the same; ellipsized if even that
// doesn't). Measured at the box's own size; re-checked as it resizes.
export default function FitName({ full, short, style }) {
  const ref = useRef(null);
  const [fit, setFit] = useState({ text: "full", scale: 1 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const width = (text) => {
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;";
      probe.style.font = getComputedStyle(el).font;
      probe.textContent = text;
      el.appendChild(probe);
      const w = probe.offsetWidth;
      probe.remove();
      return w;
    };
    const check = () => {
      const room = el.clientWidth;
      if (!room) return;
      const wf = width(full);
      if (wf <= room) { setFit({ text: "full", scale: 1 }); return; }
      if (room / wf >= MIN_SCALE) { setFit({ text: "full", scale: room / wf }); return; }
      const ws = width(short);
      setFit({ text: "short", scale: Math.max(MIN_SCALE, Math.min(1, room / ws)) });
    };
    check();
    if (typeof ResizeObserver === "undefined") return undefined;
    let frame = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(check); });
    ro.observe(el);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); };
  }, [full, short]);
  return (
    <span ref={ref} title={full} style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textTransform: "uppercase", ...style }}>
      <span style={fit.scale < 1 ? { fontSize: `${fit.scale}em` } : undefined}>{fit.text === "full" ? full : short}</span>
    </span>
  );
}

// A prospect's FitName: full name, else first initial + last.
export const PlayerName = ({ p, style }) => <FitName full={`${p.First} ${p.Last}`} short={`${(p.First || "")[0] || ""}. ${p.Last}`} style={style} />;
