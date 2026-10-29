// src/components/draftSim/useSimBadges.js
//
// A Draft Sim run's badges (utils/draftSim/badges.js, badgeRules.js), for
// pages/DraftSim.jsx's LiveSim: after every pick and trade, any badge the
// user's class has just earned pops up (toasts) — once a run, and never
// again once it's on their profile. When the draft's done (and whenever
// they sign in from the end screen), awardBadges saves them and adds the
// profile badges (sims run, streaks, …), which pop up then. runEarned: the
// badges this run unlocked, for the end screen; total: how many there are to earn.
import { useCallback, useEffect, useRef, useState } from "react";
import { loadBadges, loadEarned, loadEvaluated, awardBadges } from "../../utils/draftSim/badges";
import { runBadges } from "../../utils/draftSim/badgeRules";

// valueBoard: the community board (not My Board) — see badgeRules.js.
export default function useSimBadges({ sim, year, valueBoard, uid, admin }) {
  const [badges, setBadges] = useState(null);
  const [earned, setEarned] = useState(null);
  const [evaluated, setEvaluated] = useState(null);
  const [queue, setQueue] = useState([]);
  const [runEarned, setRunEarned] = useState([]);
  const shown = useRef(new Set());

  useEffect(() => {
    let live = true;
    loadBadges(admin).then((b) => live && setBadges(b)).catch((e) => { console.warn("Sim badges:", e?.code || e); if (live) setBadges({}); });
    return () => { live = false; };
  }, [admin]);
  useEffect(() => {
    let live = true;
    setEarned(uid ? null : {});
    setEvaluated(null);
    if (!uid) return () => { live = false; };
    loadEarned(uid).then((e) => live && setEarned(e)).catch(() => live && setEarned({}));
    loadEvaluated(uid).then((s) => live && setEvaluated(s)).catch(() => {});
    return () => { live = false; };
  }, [uid]);

  const pop = useCallback((ids, already = {}) => {
    const fresh = ids.filter((id) => badges?.[id] && !already[id] && !shown.current.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => shown.current.add(id));
    const list = fresh.map((id) => badges[id]);
    setQueue((q) => [...q, ...list]);
    setRunEarned((r) => [...r, ...list]);
  }, [badges]);

  // After every pick and trade.
  useEffect(() => {
    if (!badges || !earned) return;
    pop(runBadges(sim, { year, valueBoard, evaluated }), earned);
  }, [sim, badges, earned, evaluated, year, valueBoard, pop]);

  // Done, signed in: saved once a run (for whoever's signed in then).
  const awarded = useRef(null);
  useEffect(() => {
    if (!sim.done || !uid || !badges || !earned || awarded.current === uid) return;
    awarded.current = uid;
    awardBadges(uid, { state: sim, year, runIds: runBadges(sim, { year, valueBoard, evaluated }), badges }).then((ids) => pop(ids, earned));
  }, [sim, uid, badges, earned, evaluated, year, valueBoard, pop]);

  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { queue, dismiss, runEarned, total: badges ? Object.keys(badges).length : 0 };
}
