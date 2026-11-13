// src/utils/accoladeIcons.js
//
// Icons for the player page's Career Path accolades, set in AdminPanel.js
// (Branding → Misc → Conference Logos / Award Icons). One collection:
//   accoladeIcons/{kind}-{slug}   { Kind: "conference" | "award", Name,
//                                   Aliases: [..], Logo, LogoDark }
// A conference icon marks its all-conference lines ("First-Team All-SEC");
// an award icon marks a national award by name ("Heisman Trophy"), the
// All-America lines ("All-American", "First-Team All-American"), and
// national title lines ("National Champion"), and the high school's
// recruiting line ("5-Star Recruit" / "4-Star Recruit" / "3-Star Recruit").
// The "Fallback" award row's icon marks any line with no icon of its own.
import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";

export const accoladeSlug = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const norm = (s) => String(s || "").trim().toLowerCase();

// Built once per page load. → { conference: { [name]: icon }, award: { [name]: icon } }
let iconsPromise = null;
export function useAccoladeIcons() {
  const [icons, setIcons] = useState(null);
  useEffect(() => {
    let cancelled = false;
    iconsPromise = iconsPromise || getDocs(collection(db, "accoladeIcons"))
      .then((snap) => {
        const out = { conference: {}, award: {} };
        snap.docs.forEach((d) => {
          const x = d.data();
          const src = x.Logo || x.LogoDark;
          if (!src || !out[x.Kind]) return;
          [x.Name, ...(x.Aliases || [])].map(norm).filter(Boolean).forEach((k) => { out[x.Kind][k] ||= src; });
        });
        return out;
      })
      .catch(() => ({ conference: {}, award: {} }));
    iconsPromise.then((m) => { if (!cancelled) setIcons(m); });
    return () => { cancelled = true; };
  }, []);
  return icons;
}

// An honors label ("Second-Team All-Big Ten (All-Purpose)") → its conference
// ("Big Ten"), or null for an All-America line.
const HONOR = /^(?:(?:First|Second|Third)-Team |Honorable Mention |Team \d+ )?All-(.+?)(?: \(.+\))?$/;
export function honorConference(label) {
  const m = HONOR.exec(String(label || "").trim());
  if (!m || /^America/i.test(m[1])) return null;
  return m[1];
}

// The icon for one accolade: its own, else the "Fallback" award row's, else
// null (the gold ★ stays).
//   kind "honor"  — an honors label (all-conference / All-America)
//   kind "award"  — a national award name, "National Champion", "4-Star Recruit"
export function accoladeIcon(icons, kind, name) {
  if (!icons) return null;
  return ownIcon(icons, kind, name) || icons.award.fallback || null;
}
function ownIcon(icons, kind, name) {
  if (kind === "honor") {
    if (/All-America/i.test(name)) return icons.award[norm(name)] || icons.award["all-american"];
    const conf = honorConference(name);
    return (conf && icons.conference[norm(conf)]) || icons.award[norm(name)];
  }
  return icons.award[norm(name)];
}
