// src/components/portalSim/usePortalSim.js
//
// Runs one Portal Sim for pages/PortalSim.jsx — the engine state
// (utils/portalSim/engine.js) and the flow around it, like
// components/draftSim/useDraftSim.js does for the Draft Sim. Phases:
//   intro    "The portal opens" — window 1's declarations and entries,
//            waits for start()
//   window   the user's turn: offers to portal players
//   simming  other schools make their offers and players decide
//   recap    what happened in that window — waits for next()
//   done     the last window's closed
import { useCallback, useMemo, useState } from "react";
import { initPortalSim, openPortal, endWindow, userOffer, retractOffer, teamView, portalPlayers } from "../../utils/portalSim/engine";

export default function usePortalSim({ data, team, seed, live = false }) {
  const [state, setState] = useState(() => openPortal(initPortalSim(data.pool, { config: data.config, tiers: data.tiers, userTeams: [team], seed, live })));
  const [phase, setPhase] = useState("intro");
  const [recap, setRecap] = useState(null);
  const [error, setError] = useState("");

  const start = useCallback(() => setPhase("window"), []);
  const offer = useCallback((pid, terms) => {
    const r = userOffer(state, team, pid, terms);
    if (r.error) { setError(r.error); return false; }
    setError("");
    setState(r.state);
    return true;
  }, [state, team]);
  const retract = useCallback((pid) => setState((s) => retractOffer(s, team, pid)), [team]);
  // End the window: let the stage read "Simming" for a beat, then run it.
  const end = useCallback(() => {
    setPhase("simming");
    setTimeout(() => {
      const r = endWindow(state);
      setState(r.state);
      setRecap(r.summary);
      setPhase("recap");
    }, 500);
  }, [state]);
  const next = useCallback(() => { setRecap(null); setPhase(state.phase === "done" ? "done" : "window"); }, [state.phase]);

  const view = useMemo(() => teamView(state, team), [state, team]);
  const portal = useMemo(() => portalPlayers(state), [state]);
  return { state, phase, recap, error, view, portal, start, offer, retract, end, next, clearError: () => setError("") };
}
