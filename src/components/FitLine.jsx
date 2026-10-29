// src/components/FitLine.jsx
//
// Text on one line at the largest size (max → min px) that fits its
// container's width — re-fit whenever the container resizes. For the team
// and staff page heroes (NFLTeamPage.jsx, TeamPage.js, StaffPage.jsx), so a
// long name shrinks instead of breaking mid-word.
import { useLayoutEffect, useRef, useState } from "react";

export default function FitLine({ children, max, min, style }) {
  const ref = useRef(null);
  const [size, setSize] = useState(max);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      // Measure at max, then scale down by how far it overflows. The size
      // goes back on the element here too: a re-fit that lands on the same
      // size as before is no state change, so React wouldn't undo the max
      // measured with — the name sat at max, cut off ("CHARGE…").
      el.style.fontSize = `${max}px`;
      const ratio = el.scrollWidth ? el.clientWidth / el.scrollWidth : 1;
      const next = Math.max(min, Math.min(max, Math.floor(max * ratio)));
      el.style.fontSize = `${next}px`;
      setSize(next);
    };
    fit();
    // Re-fit a frame later, not inside the observer's callback — resizing
    // the text there re-triggers it ("ResizeObserver loop completed").
    let frame = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); });
    ro.observe(el.parentElement || el);
    // A web font landing after the first fit changes the width too.
    let live = true;
    document.fonts?.ready.then(() => { if (live) fit(); });
    return () => { live = false; cancelAnimationFrame(frame); ro.disconnect(); };
  }, [children, max, min]);
  return (
    <div ref={ref} style={{ ...style, fontSize: size, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      {children}
    </div>
  );
}
