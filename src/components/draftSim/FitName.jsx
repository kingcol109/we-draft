// src/components/draftSim/FitName.jsx
//
// A prospect's name for the sim's tight rows: "Malik Washington" when it
// fits, "M. Washington" when it doesn't.

import { useLayoutEffect, useRef, useState } from "react";

// A name that's the full one when it fits its box, else the short one
// (ellipsized if even that doesn't). Re-checked as the box resizes.
export default function FitName({ full, short, style }) {
  const ref = useRef(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const check = () => {
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;";
      probe.style.font = getComputedStyle(el).font;
      probe.textContent = full;
      el.appendChild(probe);
      setFits(probe.offsetWidth <= el.clientWidth);
      probe.remove();
    };
    check();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [full]);
  return (
    <span ref={ref} title={full} style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textTransform: "uppercase", ...style }}>
      {fits ? full : short}
    </span>
  );
}

// A prospect's FitName: full name, else first initial + last.
export const PlayerName = ({ p, style }) => <FitName full={`${p.First} ${p.Last}`} short={`${(p.First || "")[0] || ""}. ${p.Last}`} style={style} />;
