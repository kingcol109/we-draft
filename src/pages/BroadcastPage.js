// src/pages/BroadcastPage.js
//
// /broadcast/:slug — the We-Draft Live broadcast renderer: the game at
// /live/:slug as a 1920×1080 TV frame, built to be opened by a headless
// browser and captured as a video stream (later phases: Chromium →
// FFmpeg → YouTube Live). Same slugs as /live (a CFBD game id works too).
//
//   /broadcast/:slug                preview: the frame scaled to fit the window
//   /broadcast/:slug?mode=stream    capture: exactly 1920×1080 at the top-left,
//                                   no scrollbars, no cursor, nothing interactive
//   &replay=<sec>[&from=<n>]        read a finished game back as if live, one
//                                   play every <sec> seconds from play n (tests, demos)
//   &replay=manual[&from=<n>]       the same, one play per click of the Next play
//                                   button (or → / Space) — starts at pregame
//   &event=TOUCHDOWN[&side=home]    fire one test graphic
//
// For the capture worker, the page reports itself on <html>:
//   data-broadcast-ready="1"        fonts loaded and the first game state is in
//   data-broadcast-phase="live"     loading | missing | pregame | delayed | live | halftime | final
//   data-broadcast-stale="1"        live data hasn't moved in a while
// and on window.__BROADCAST__ ({ ready, phase, stale, gameId }) — enough to
// know when to start encoding and when the game is over.
//
// The data comes from the same Firestore docs and the same derived state
// as /live (hooks/useBroadcastState.js); nothing here calls CFBD.
//
// /broadcast/national (pages/BroadcastNationalPage.js) is the same frame
// for every game on at once.
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useBroadcastState } from "../hooks/useBroadcastState";
import BroadcastScreen from "../broadcast/BroadcastScreen";
import { BROADCAST_STYLE } from "../broadcast/broadcastStyle";
import { EVENT_TYPES } from "../broadcast/BroadcastEvents";
import { usePageShell, useFontsReady, useFit, stageTransform, useCaptureReport } from "../broadcast/useBroadcastShell";

// slug → liveGames id (one query); an all-digits param is taken as the id
// itself when no game has that slug.
function useGameId(slug) {
  const [state, setState] = useState({ slug: null, id: null, done: false });
  useEffect(() => {
    let alive = true;
    setState({ slug, id: null, done: false });
    getDocs(query(collection(db, "liveGames"), where("slug", "==", slug), limit(1)))
      .then((snap) => (snap.empty ? (/^\d+$/.test(slug) ? slug : null) : snap.docs[0].id))
      .catch(() => (/^\d+$/.test(slug) ? slug : null))
      .then((id) => { if (alive) setState({ slug, id, done: true }); });
    return () => { alive = false; };
  }, [slug]);
  return state.slug === slug ? state : { id: null, done: false };
}

// Manual replay (testing): a small bar over the preview — never part of the
// 1920×1080 frame, never in stream mode. → / Space / N do the same.
function StepControls({ replay }) {
  const { next, step, total } = replay;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "n" || e.key === "N") { e.preventDefault(); next(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next]);
  const done = step >= total && total > 0;
  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 50, display: "flex", alignItems: "center", gap: 12, padding: "8px 10px 8px 16px",
      background: "rgba(5,10,20,0.92)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
      font: "600 14px/1.2 system-ui, sans-serif", color: "#c9d5e6" }}>
      <span>{step === 0 ? "Pregame" : `Play ${step} of ${total}`}<br /><small style={{ color: "#7f90aa" }}>Test replay · → or Space</small></span>
      <button type="button" onClick={next} disabled={done}
        style={{ padding: "10px 18px", borderRadius: 9, border: 0, cursor: done ? "default" : "pointer", font: "800 15px system-ui, sans-serif",
          background: done ? "#2a3753" : "#f6a21d", color: done ? "#7f90aa" : "#121212" }}>
        {done ? "Game over" : step === 0 ? "Kick off ▶" : "Next play ▶"}
      </button>
    </div>
  );
}

export default function BroadcastPage() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const stream = params.get("mode") === "stream";
  usePageShell(stream);
  const fontsOk = useFontsReady();
  const fit = useFit();
  const { id, done } = useGameId(slug);

  const replayParam = params.get("replay");
  const replaySec = Number(replayParam);
  const replay = replayParam === "manual" ? { manual: true, from: Math.max(0, Number(params.get("from")) || 0) }
    : replaySec > 0 ? { stepMs: Math.max(1, replaySec) * 1000, from: params.has("from") ? Math.max(0, Number(params.get("from")) || 0) : 1 } : null;
  const evType = (params.get("event") || "").toUpperCase();
  const testEvent = EVENT_TYPES.includes(evType) ? { type: evType, side: params.get("side") === "away" ? "away" : "home", subtitle: null } : null;

  // Keep the same option objects across renders (the hook keys off them).
  const [opts] = useState(() => ({ replay, testEvent }));
  const s = useBroadcastState(id, opts);
  const state = done && !id ? { ...s, phase: "missing" } : s;

  const ready = fontsOk && state.phase !== "loading";
  useCaptureReport({ ready, phase: state.phase, stale: state.health.stale, gameId: id });

  useEffect(() => {
    const g = state.game;
    document.title = g ? `${g.away?.short || g.away?.school || ""} at ${g.home?.short || g.home?.school || ""} · We-Draft Live Broadcast` : "We-Draft Live Broadcast";
  }, [state.game?.away?.school, state.game?.home?.school]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#000" }}>
      <style>{BROADCAST_STYLE}</style>
      <div className="bc-stage" style={{ transform: stageTransform(fit), opacity: fontsOk ? 1 : 0 }}>
        <BroadcastScreen s={state} />
      </div>
      {state.replay?.manual && !stream && <StepControls replay={state.replay} />}
    </div>
  );
}
