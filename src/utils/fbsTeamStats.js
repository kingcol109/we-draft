// src/utils/fbsTeamStats.js
//
// Every FBS team's season stats with national ranks — cfbLeaders/teams
// (scripts/syncCfbdTeamStats.js): yards (total / passing / rushing) and
// points per game, gained and allowed, turnover margin, 3rd down %. One
// read, kept for the visit. Used by /live's game previews (LivePage.js,
// Tale of the tape) and the broadcast's pregame ticker (BroadcastScreen.js).

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

let loaded = null;
// A Map of CFBD team id → { v, r } (values, ranks — "12" or "T-12"), or
// null until it's read.
export function useFbsTeamStats() {
  const [byId, setById] = useState(null);
  useEffect(() => {
    let alive = true;
    loaded ||= getDoc(doc(db, "cfbLeaders", "teams"))
      .then((d) => new Map((d.exists() ? d.data().teams || [] : []).map((t) => [Number(t.id), t])))
      .catch(() => { loaded = null; return new Map(); });
    loaded.then((m) => { if (alive) setById(m); });
    return () => { alive = false; };
  }, []);
  return byId;
}

// A team stat as shown: 3rd down as a %, turnover margin signed (+0.80).
export const fmtTeamStat = (k, v) => (k === "toMargin" ? `${v > 0 ? "+" : ""}${v.toFixed(2)}` : k.startsWith("thirdPct") ? `${v.toFixed(1)}%` : v.toFixed(1));
