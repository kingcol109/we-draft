// src/components/portalSim/usePortalSim.js
//
// Runs one Portal Sim for pages/PortalSim.jsx — the engine state
// (utils/portalSim/engine.js) and the flow around it, like
// components/draftSim/useDraftSim.js does for the Draft Sim. Phases:
//   ready    team picked, nothing run yet — waits for start()
//   window   the user's turn, right away: retention offers (stage "nfl" /
//            "retain", the two opening windows — own team only) or portal
//            offers. `recap` holds what changed in the window before it (the
//            page shows it above the console while the user works)
//   simming  everyone else decides
//   done     the last window's closed
// stage = the engine's phase: ready | nfl | retain | window | done.
import { useCallback, useMemo, useState } from "react";
import {
  initPortalSim, openNflWindow, endNflWindow, endRetainWindow, endWindow,
  userOffer, retractOffer, userRetain, clearRetain, teamView, portalPlayers,
} from "../../utils/portalSim/engine";

export default function usePortalSim({ data, team, seed, live = false }) {
  const [state, setState] = useState(() => initPortalSim(data.pool, { config: data.config, tiers: data.tiers, factors: data.factors, userTeams: [team], seed, live }));
  const [phase, setPhase] = useState("ready");
  const [recap, setRecap] = useState(null);
  const [error, setError] = useState("");
  // Players the user starred onto My Board (for this run).
  const [starred, setStarred] = useState(() => new Set());
  const toggleStar = useCallback((pid) => setStarred((cur) => {
    const next = new Set(cur);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    return next;
  }), []);

  // Start: opening window 1 opens and the user can negotiate right away.
  const start = useCallback(() => {
    setState((s) => openNflWindow(s));
    setRecap(null);
    setPhase("window");
  }, []);
  const apply = useCallback((r) => {
    if (r.error) { setError(r.error); return false; }
    setError("");
    setState(r.state);
    // "committed": the offer landed on the spot (engine userOffer).
    return r.committed ? "committed" : true;
  }, []);
  const offer = useCallback((pid, terms) => apply(userOffer(state, team, pid, terms)), [state, team, apply]);
  const retract = useCallback((pid) => setState((s) => retractOffer(s, team, pid)), [team]);
  const retain = useCallback((pid, terms) => apply(userRetain(state, team, pid, terms)), [state, team, apply]);
  const unretain = useCallback((pid) => setState((s) => clearRetain(s, team, pid)), [team]);
  // End the window: "Simming" for a beat, then straight into the next window
  // with what changed in this one.
  const end = useCallback(() => {
    setPhase("simming");
    setTimeout(() => {
      const run = state.phase === "nfl" ? endNflWindow : state.phase === "retain" ? endRetainWindow : endWindow;
      const r = run(state);
      setState(r.state);
      setRecap(r.summary);
      setPhase(r.state.phase === "done" ? "done" : "window");
    }, 500);
  }, [state]);
  const dismissRecap = useCallback(() => setRecap(null), []);
  // The player card (components/portalSim/PlayerCard.jsx) — which player's open.
  const [card, setCard] = useState(null);
  const openCard = useCallback((pid) => { setError(""); setCard(pid); }, []);
  const closeCard = useCallback(() => setCard(null), []);

  const view = useMemo(() => teamView(state, team), [state, team]);
  const portal = useMemo(() => portalPlayers(state), [state]);
  return { state, stage: state.phase, phase, recap, error, view, portal, start, offer, retract, retain, unretain, end, dismissRecap, starred, toggleStar, card, openCard, closeCard, clearError: () => setError("") };
}
