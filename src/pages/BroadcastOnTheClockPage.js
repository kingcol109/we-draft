// src/pages/BroadcastOnTheClockPage.js
//
// /broadcast/ontheclock — On the Clock, the nightly Draft Sim broadcast, in
// the broadcast's 1920×1080 frame (src/broadcast/OnTheClockScreen.js),
// played from its script (simShows/{id}, utils/draftSim/onTheClock.js).
//
//   /broadcast/ontheclock               the show that's on now (or up next)
//   ?show=<id>                          that show
//   ?mode=stream                        capture: exactly 1920×1080, no cursor
//   &at=<seconds>                       preview: jump to that many seconds
//                                       into the show (negative: the pre-show),
//                                       then play on from there
//   ?demo=<format>[&seed=n&rounds=n]           preview: draft a show in this page
//                                       (nothing saved), starting as it opens
//   ?local=1                            preview: the show saved to
//                                       public/ontheclock-local.json (dev only —
//                                       scripts/onTheClockLocal.mjs writes it)
// Previews (demo / local / at, never mode=stream) get the preview bar:
// play/pause, speed, previous / next beat, jumps and a scrubber
// (keys: space, ← →).
//
// Reports itself to the capture worker like the other broadcast pages
// (pages/BroadcastPage.js): data-broadcast-* on <html> and
// window.__BROADCAST__, phase one of loading | empty | preshow | live | final,
// gameId "ontheclock:<id>".
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import OnTheClockScreen, { OTC_STYLE } from "../broadcast/OnTheClockScreen";
import { BROADCAST_STYLE } from "../broadcast/broadcastStyle";
import { usePageShell, useFontsReady, useFit, stageTransform, useCaptureReport } from "../broadcast/useBroadcastShell";
import { useShow, useCurrentShow, useNow, generateShow } from "../utils/draftSim/onTheClockData";
import { showTimeline, momentAt } from "../utils/draftSim/onTheClock";
import OnTheClockPreviewBar from "../broadcast/OnTheClockPreviewBar";
import { useShowVotes } from "../utils/draftSim/onTheClockVotes";

export default function BroadcastOnTheClockPage() {
  const [params] = useSearchParams();
  const stream = params.get("mode") === "stream";
  usePageShell(stream);
  const fontsOk = useFontsReady();
  const fit = useFit();
  const at = params.get("at");
  const demoKey = params.get("demo");
  const local = params.get("local") === "1";
  const preview = !!(demoKey || local || at != null);
  const now = useNow(preview ? 100 : 250);
  const [opened] = useState(() => Date.now());

  const demoSeed = params.get("seed");
  const demoRounds = Number(params.get("rounds")) || null;
  const [demo, setDemo] = useState(null);
  useEffect(() => {
    if (!demoKey) return;
    generateShow({ formatKey: demoKey, rounds: demoRounds, seed: demoSeed ? Number(demoSeed) : undefined, startAt: opened, id: "demo" })
      .then((s) => { window.__OTC_SCRIPT__ = s; setDemo(s); })
      .catch((e) => { console.error("On the Clock demo", e); setDemo(false); });
  }, [demoKey, demoSeed, demoRounds, opened]);
  useEffect(() => {
    if (!local) return;
    fetch(`/ontheclock-local.json?${Date.now()}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then(setDemo).catch((e) => { console.error("On the Clock local show", e); setDemo(false); });
  }, [local]);

  const offline = !!(demoKey || local);
  const id = offline ? null : params.get("show");
  const one = useShow(id);
  const current = useCurrentShow(now);
  const script = offline ? demo || null : id ? one.script : current;
  const loading = offline ? demo === null : id ? one.loading : current === undefined;
  const timeline = useMemo(() => (script ? showTimeline(script) : null), [script]);

  // The preview's own clock: ms into the show, played at `speed`, pausable.
  const [vc, setVc] = useState(() => ({ t: (at != null ? Number(at) : local ? -10 : 0) * 1000, wall: Date.now(), speed: 1, paused: false }));
  const vt = vc.paused ? vc.t : vc.t + (now - vc.wall) * vc.speed;
  const seek = useCallback((t) => setVc((c) => ({ ...c, t, wall: Date.now() })), []);
  const control = useCallback((patch) => setVc((c) => {
    const cur = c.paused ? c.t : c.t + (Date.now() - c.wall) * c.speed;
    return { ...c, ...patch, t: patch.t ?? cur, wall: Date.now() };
  }), []);

  const clock = preview && script ? script.startAt + vt : now;
  const m = script && timeline ? { ...momentAt(script, timeline, clock), realtime: !preview || (!vc.paused && vc.speed === 1) } : null;
  const votes = useShowVotes(offline ? null : script?.id);

  const phase = loading ? "loading" : !script ? "empty" : m.kind === "preshow" ? "preshow" : m.kind === "final" ? "final" : "live";
  useCaptureReport({ ready: fontsOk && !loading, phase, stale: false, gameId: `ontheclock:${script?.id || ""}` });

  useEffect(() => {
    document.title = script ? `${script.title} · We-Draft.com` : "On the Clock · We-Draft.com";
  }, [script]);

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#000" }}>
      <style>{BROADCAST_STYLE}{OTC_STYLE}</style>
      <div className="bc-stage" style={{ transform: stageTransform(fit), opacity: fontsOk ? 1 : 0 }}>
        {m ? <OnTheClockScreen script={script} timeline={timeline} m={m} votes={votes} /> : (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 20 }}>
            <img src="/wd-icon.png" alt="" style={{ width: 140, height: 140 }} />
            <div className="bc-disp" style={{ fontSize: 120 }}>On the Clock</div>
            <div style={{ fontSize: 32, color: "#9fb0c8" }}>{loading ? "Loading…" : demo === false && local ? "No local show — run: node scripts/onTheClockLocal.mjs" : "No show scheduled. Back tonight."}</div>
          </div>
        )}
      </div>
      {preview && !stream && m && <OnTheClockPreviewBar script={script} timeline={timeline} m={m} vc={vc} t={vt} seek={seek} control={control} />}
    </div>
  );
}
