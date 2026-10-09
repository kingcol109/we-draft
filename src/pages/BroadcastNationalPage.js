// src/pages/BroadcastNationalPage.js
//
// /broadcast/national — the We-Draft Live national broadcast: no one game,
// but the big plays and storylines from every game across the country, in
// the game broadcast's 1920×1080 frame (src/broadcast/NationalScreen.js).
// Data: liveSlate/current plus the live games' docs for their insight
// cards (hooks/useNationalState.js); nothing calls CFBD.
//
// Streamed to YouTube the same way as a game: Stream Manager → Auto
// Schedule → National Coverage schedules a window, and the orchestrator
// (server/stream-manager/orchestrator.js selectNational) has the VM's
// worker open this page with ?mode=stream.
//
//   /broadcast/national                preview: the frame scaled to fit the window
//   /broadcast/national?mode=stream    capture: exactly 1920×1080, no cursor
//   &event=latest                      fire the newest big play's graphic (testing)
//   &spotlight=now                     the prospect spotlight right away
//   &spotlight=<slug>                  …with that player (if he's in a live game's leaders)
//   &gameday=1                         the We-Draft Gameday preview whenever nothing's live
//                                      (otherwise it's on Saturdays from 6 AM ET to the first kickoff)
//
// Reports itself to the capture worker the same way /broadcast/:slug does
// (pages/BroadcastPage.js): data-broadcast-ready / -phase / -stale on
// <html> and window.__BROADCAST__, with phase one of
// loading | live | idle | empty (utils/broadcastNational.js nationalPhase)
// and gameId "national".
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useNationalState } from "../hooks/useNationalState";
import NationalScreen from "../broadcast/NationalScreen";
import { BROADCAST_STYLE, NATIONAL_STYLE } from "../broadcast/broadcastStyle";
import { usePageShell, useFontsReady, useFit, stageTransform, useCaptureReport } from "../broadcast/useBroadcastShell";

export default function BroadcastNationalPage() {
  const [params] = useSearchParams();
  const stream = params.get("mode") === "stream";
  usePageShell(stream);
  const fontsOk = useFontsReady();
  const fit = useFit();
  const [opts] = useState(() => ({
    testEvent: params.get("event") === "latest" ? "latest" : null,
    spotlightNow: params.get("spotlight") === "now" ? true : params.get("spotlight") || false,
    gameday: params.get("gameday") === "1",
  }));
  const s = useNationalState(opts);

  const ready = fontsOk && s.phase !== "loading";
  useCaptureReport({ ready, phase: s.phase, stale: s.health.stale, gameId: "national" });

  useEffect(() => {
    document.title = s.liveCount ? `${s.liveCount} live · We-Draft Live National Broadcast` : s.gameday ? "We-Draft Gameday" : "We-Draft Live National Broadcast";
  }, [s.liveCount, s.gameday]);

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#000" }}>
      <style>{BROADCAST_STYLE}{NATIONAL_STYLE}</style>
      <div className="bc-stage" style={{ transform: stageTransform(fit), opacity: fontsOk ? 1 : 0 }}>
        <NationalScreen s={s} />
      </div>
    </div>
  );
}
