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
// feed: the analyst desk's posts (utils/portalSim/desk.js), newest first —
// built from what each step adds to the engine's log.
import { useCallback, useMemo, useRef, useState } from "react";
import { deskPosts } from "../../utils/portalSim/desk";
import {
  initPortalSim, openNflWindow, endNflWindow, endRetainWindow, endWindow,
  userOffer, retractOffer, userRetain, clearRetain, teamView, portalPlayers,
  toggleEval, boardCount, boardLimit, isEvalWindow, userRelease, openLivePortal, assignCoach, repeatStaff, moveOnBoard, boardInOrder, endMarket, staffSuggestions,
} from "../../utils/portalSim/engine";

// The desk stays on screen but quiet for now (user, 2026-11-14: "keep it
// there but don't roll any messages") — true turns its posts back on.
const DESK_LIVE = false;

export default function usePortalSim({ data, team, seed, live = false, frequency = "default", windows = 7 }) {
  const [state, setState] = useState(() => initPortalSim(data.pool, { config: data.config, tiers: data.tiers, factors: data.factors, targets: data.targets, userTeams: [team], seed, live, frequency, windows }));
  const [phase, setPhase] = useState("ready");
  const [recap, setRecap] = useState(null);
  const [error, setError] = useState("");
  const [feed, setFeed] = useState([]);
  const desk = useRef({ team, records: data.records, last: { id: null }, seq: 0 });
  const post = useCallback((s, events) => {
    if (!DESK_LIVE) return;
    const posts = deskPosts(s, events, desk.current);
    if (posts.length) setFeed((f) => [...posts, ...f]);
  }, []);

  // Start: opening window 1 opens and the user can negotiate right away.
  // The real portal (user, 2026-11-18) skips both opening windows — the
  // real decisions are made — and opens on a recap of who left and why.
  const start = useCallback(() => {
    if (live) {
      const r = openLivePortal(state);
      post(r.state, r.summary.events);
      setState(r.state);
      setRecap(r.summary);
      setPhase("window");
      return;
    }
    const next = openNflWindow(state);
    setState(next);
    post(next, next.log.slice(state.log.length));
    setRecap(null);
    setPhase("window");
  }, [state, post, live]);
  const apply = useCallback((r) => {
    if (r.error) { setError(r.error); return false; }
    setError("");
    if (r.committed) post(r.state, r.state.log.slice(state.log.length));
    setState(r.state);
    // "committed": the offer landed on the spot (engine userOffer).
    return r.committed ? "committed" : true;
  }, [state, post]);
  const offer = useCallback((pid, terms) => apply(userOffer(state, team, pid, terms)), [state, team, apply]);
  const retract = useCallback((pid) => setState((s) => retractOffer(s, team, pid)), [team]);
  // Your board (user, 2026-11-15): Contact — up to board.sizes[window] portal players
  // you're evaluating (engine toggleEval); interest builds from the day
  // they're on it. Kept on players after they sign, for Results.
  const toggleStar = useCallback((pid) => apply(toggleEval(state, team, pid)), [state, team, apply]);
  const starred = useMemo(() => new Set(Object.values(state.players).filter((p) => p.evals?.[team] != null).map((p) => p.id)), [state.players, team]);
  const board = useMemo(() => {
    // Signed board players keep their spot (engine boardCount).
    const count = boardCount(state, team);
    const max = boardLimit(state);
    return { count, limit: max, full: count >= max, evalPeriod: isEvalWindow(state) };
  }, [state, team]);
  const retain = useCallback((pid, terms) => apply(userRetain(state, team, pid, terms)), [state, team, apply]);
  // Your coaches (user, 2026-11-18): put one on a board player (null: off
  // him) — engine assignCoach. staff: { role: pid }; recs: your staff's
  // recommendations { pid: rec }.
  const assign = useCallback((role, pid) => apply(assignCoach(state, team, role, pid)), [state, team, apply]);
  const staff = state.teams[team]?.staff || {};
  const lastStaff = state.teams[team]?.lastStaff || null;
  const recs = state.recs?.[team] || {};
  // Coaches come home every window; this puts them back on last window's
  // players (still on your board).
  const repeat = useCallback(() => setState((s) => repeatStaff(s, team)), [team]);
  // Your board, in your order (a new contact goes last); move(pid, index).
  const boardList = useMemo(() => boardInOrder(state, team), [state, team]);
  const move = useCallback((pid, to) => setState((s) => moveOnBoard(s, team, pid, to)), [team]);
  // Where you stood with each board player as you ended the last window.
  const rankWas = state.rankWas?.[team] || {};
  // Your staff's full list: a few names at every position, always (engine
  // staffSuggestions) — { pos: [pid] }.
  const suggestions = useMemo(() => staffSuggestions(state, team), [state, team]);
  // Recommendations you passed on (the pick stays with him — just moved
  // to the bottom).
  const [passed, setPassed] = useState(() => new Set());
  const pass = useCallback((pid) => setPassed((prev) => { const n = new Set(prev); if (n.has(pid)) n.delete(pid); else n.add(pid); return n; }), []);
  // Release one of yours into the portal (engine userRelease).
  const release = useCallback((pid) => apply(userRelease(state, team, pid)), [state, team, apply]);
  const unretain = useCallback((pid) => setState((s) => clearRetain(s, team, pid)), [team]);
  // End the window: "Simming" for a beat, then straight into the next window
  // with what changed in this one.
  const end = useCallback(() => {
    setPhase("simming");
    setTimeout(() => {
      const run = state.phase === "nfl" ? endNflWindow : state.phase === "retain" ? endRetainWindow : state.phase === "market" ? endMarket : endWindow;
      const r = run(state);
      const events = r.state.log.slice(state.log.length);
      if (run === endWindow) {
        events.push({ kind: "wrap", w: state.window, n: r.summary.commits.length, u: r.summary.unsigned.length, last: r.state.phase === "done" });
      }
      post(r.state, events);
      setState(r.state);
      setRecap(r.summary);
      setPhase(r.state.phase === "done" ? "done" : "window");
    }, 500);
  }, [state, post]);
  const dismissRecap = useCallback(() => setRecap(null), []);
  // The player card (components/portalSim/PlayerCard.jsx) — which player's open.
  const [card, setCard] = useState(null);
  const openCard = useCallback((pid) => { setError(""); setCard(pid); }, []);
  const closeCard = useCallback(() => setCard(null), []);

  const view = useMemo(() => teamView(state, team), [state, team]);
  const portal = useMemo(() => portalPlayers(state), [state]);
  return { state, stage: state.phase, phase, recap, error, view, portal, feed, start, offer, retract, retain, unretain, release, assign, staff, lastStaff, repeat, recs, suggestions, passed, pass, boardList, move, rankWas, end, dismissRecap, starred, toggleStar, board, card, openCard, closeCard, clearError: () => setError("") };
}
