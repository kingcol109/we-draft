// src/broadcast/TeamLogo.js
//
// Team logos on the broadcasts' dark backgrounds: the team's logo for dark
// backgrounds — our schools doc's LogoBlack (the same pick /player and
// We-Pick make on dark cards), else its LogoDark, else ESPN's dark set (CFBD
// team ids are ESPN's) — and the regular logo only when none of those loads.
//
// On the team's own color (a scorebug panel, a team-colored graphic) it's
// the other way round: LogoDark, else the regular logo — LogoBlack is often
// in the team's color (Wake Forest's is gold) and would vanish there.
//
// Games ingested before logoBlack was carried don't have it, so the page
// also reads each school's LogoBlack once, by CFBD team id.

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";

const espnDark = (id) => (id != null && id !== "" ? `https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${id}.png` : null);

let blackById = null; // CFBD team id → LogoBlack
let loading = null;
const waiting = new Set();
function loadBlack() {
  if (blackById || loading) return;
  loading = getDocs(query(collection(db, "schools"), where("CFBDTeamId", "!=", null)))
    .then((snap) => {
      const m = new Map();
      snap.docs.forEach((d) => { const x = d.data(); if (x.LogoBlack) m.set(String(x.CFBDTeamId), x.LogoBlack); });
      blackById = m;
      waiting.forEach((f) => f());
    })
    .catch(() => { blackById = new Map(); waiting.forEach((f) => f()); });
}
function useBlackLogos() {
  const [, bump] = useState(0);
  useEffect(() => {
    if (blackById) return undefined;
    const f = () => bump((x) => x + 1);
    waiting.add(f);
    loadBlack();
    return () => { waiting.delete(f); };
  }, []);
  return blackById;
}

// The logos to try, best first.
export function logosFor(team, black = blackById, onColor = false) {
  if (!team) return [];
  const id = team.providerTeamId;
  if (onColor) return [...new Set([team.logoDark, team.logo, espnDark(id)].filter(Boolean))];
  return [...new Set([
    team.logoBlack, id != null ? black?.get(String(id)) : null, team.logoDark, espnDark(id), team.logo,
  ].filter(Boolean))];
}

// A logo with a fixed box — it never shifts the layout while loading; one
// that fails to load gives way to the next choice, and with none left it
// simply disappears (or shows fallback, when given).
export function Logo({ team, className, fallback = null, onColor = false }) {
  const black = useBlackLogos();
  const srcs = logosFor(team, black, onColor);
  const key = srcs.join("|");
  const [n, setN] = useState(0);
  useEffect(() => setN(0), [key]);
  const src = srcs[n];
  if (!src) return fallback ? <img className={className} src={fallback} alt="" /> : <span className={className} style={{ display: "inline-block" }} />;
  return <img className={className} src={src} alt="" decoding="async" onError={() => setN((x) => x + 1)} />;
}
