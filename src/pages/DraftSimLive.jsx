// src/pages/DraftSimLive.jsx
//
// /draftsim/live — On the Clock on the site: the same 1920×1080 frame the
// YouTube broadcast shows (src/broadcast/OnTheClockScreen.js), played from
// the same script on the same wall clock, so it's the same moment as the
// stream — but interactive: every player's name opens his page and every
// team's logo and name its NFL page, each in a new tab so the show keeps
// playing. The frame scales to the page's width; Full screen fills the
// screen with it (the browser's own full screen, or — where an element
// can't go full screen, iPhone Safari — the frame over the whole window).
//
// Chat (components/LiveChat.js, simShows/{id}/chat): anyone can read it,
// signed-in users post, from an hour before the stream until the show ends.
// On a wide frame it sits over the desk (Best Available and The Desk, the
// frame's right column), see-through so the show still reads behind it; on
// a small one it goes under the frame. ✕ closes it to a Chat button, and
// that sticks (localStorage).
//
// The show: the one on, else the next one up (onTheClockData.js
// useWatchShow — the small schedule doc), its script read once; before its
// stream starts the frame shows its countdown.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import OnTheClockScreen, { OTC_STYLE } from "../broadcast/OnTheClockScreen";
import { BROADCAST_STYLE, BROADCAST_FONTS, GOLD } from "../broadcast/broadcastStyle";
import { useFontsReady } from "../broadcast/useBroadcastShell";
import { useNow, useShow, useWatchShow, useFilledSpotlights } from "../utils/draftSim/onTheClockData";
import { showTimeline, momentAt, showTimes, easternClock, SHOW_CHAT_EARLY_MS } from "../utils/draftSim/onTheClock";
import LoadingSpinner from "../components/LoadingSpinner";
import LiveChat, { LIVE_CHAT_STYLE } from "../components/LiveChat";

const W = 1920;
const H = 1080;
const NAVY = "#050a14";
const BODY = "Arial, sans-serif";
// The frame's desk column (OnTheClockScreen .otc-desk), which the chat covers.
const DESK = { left: 1320, right: 56, top: 132, height: 804 };
const CHAT_MIN_W = 260;
const CHAT_KEY = "otc-chat-closed";

// The broadcast's fonts (the YouTube page loads them in usePageShell).
function useBroadcastFonts() {
  useEffect(() => {
    if (document.querySelector("link[data-bc-fonts]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = BROADCAST_FONTS;
    link.setAttribute("data-bc-fonts", "");
    document.head.appendChild(link);
  }, []);
}

const fullscreenEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;

export default function DraftSimLive() {
  useBroadcastFonts();
  const fontsOk = useFontsReady();
  const now = useNow(250);
  const watch = useWatchShow(now);
  const id = watch?.id || null;
  const { script: loaded, loading } = useShow(id);
  const script = useFilledSpotlights(id && loaded?.id === id ? loaded : null);
  const timeline = useMemo(() => (script ? showTimeline(script) : null), [script]);
  const m = script && timeline ? { ...momentAt(script, timeline, now), realtime: true } : null;

  // The frame's box, and the stage's scale and offset inside it.
  const boxRef = useRef(null);
  const [fit, setFit] = useState({ k: 0.5, x: 0, y: 0 });
  const [full, setFull] = useState(false); // the browser's full screen
  const [pseudo, setPseudo] = useState(false); // the fallback: over the whole window
  const filled = full || pseudo;
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    // Layout size (offsetWidth/Height), not getBoundingClientRect: the site's
    // page zoom (utils/pageZoom) scales the box it reports, the stage's
    // transform doesn't.
    const measure = () => {
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      const k = Math.min(width / W, height / H) || 0.5;
      setFit({ k, x: Math.round((width - W * k) / 2), y: Math.round((height - H * k) / 2) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [m != null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const on = () => setFull(fullscreenEl() === boxRef.current);
    document.addEventListener("fullscreenchange", on);
    document.addEventListener("webkitfullscreenchange", on);
    return () => { document.removeEventListener("fullscreenchange", on); document.removeEventListener("webkitfullscreenchange", on); };
  }, []);
  // The fallback: Esc closes it, and the page under it doesn't scroll.
  useEffect(() => {
    if (!pseudo) return undefined;
    const key = (e) => { if (e.key === "Escape") setPseudo(false); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [pseudo]);
  const toggleFull = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    if (full) { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); return; }
    if (pseudo) { setPseudo(false); return; }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) Promise.resolve(req.call(el)).catch(() => setPseudo(true));
    else setPseudo(true);
  }, [full, pseudo]);

  const times = script ? showTimes(script) : null;
  const status = !m ? "" : m.kind === "final" ? "Final" : now >= (times?.stream ?? Infinity) ? (m.kind === "preshow" ? "Starting soon" : "Live") : `Tonight · first pick ${easternClock(times.firstPick)}`;
  const live = status === "Live";

  // Chat: open from an hour before the stream until the show ends.
  const [chatClosed, setChatClosed] = useState(() => { try { return localStorage.getItem(CHAT_KEY) === "1"; } catch { return false; } });
  const closeChat = (v) => { setChatClosed(v); try { localStorage.setItem(CHAT_KEY, v ? "1" : "0"); } catch { /* private mode */ } };
  const endsAt = watch?.entry?.endsAt ?? Infinity;
  const chatOpen = !!times && now >= times.stream - SHOW_CHAT_EARLY_MS && now < endsAt;
  const chatNote = times && now < times.stream - SHOW_CHAT_EARLY_MS ? "Chat opens an hour before the show." : "Chat is closed — this show is over.";
  // Over the desk when the frame's big enough (or filling the screen), else under it.
  const overDesk = filled || fit.k >= 0.45;
  const chatRight = Math.round(fit.x + DESK.right * fit.k);
  const chatW = Math.max(Math.round((W - DESK.left - DESK.right) * fit.k), CHAT_MIN_W);
  const chatTop = Math.round(fit.y + DESK.top * fit.k);
  const chatH = Math.round(DESK.height * fit.k);
  const chat = id && m ? (
    <div className="wd-chat">
      <div className="wd-chat-h">
        <span aria-hidden="true" className={`wd-chat-dot${chatOpen ? " on" : ""}`} />{chatOpen ? "Live Chat" : "Chat"}
        <button type="button" className="wd-chat-x" onClick={() => closeChat(true)} aria-label="Close chat" title="Close chat">✕</button>
      </div>
      <LiveChat showId={id} open={chatOpen} closedNote={chatNote} className="overlay" />
    </div>
  ) : null;
  const title = script?.title || "On the Clock";

  return (
    <div style={{ background: NAVY, minHeight: "calc(100vh / var(--pz, 1))", padding: "18px 14px 40px", boxSizing: "border-box" }}>
      <Helmet>
        <title>On the Clock LIVE | We-Draft.com Draft Sim</title>
        <meta name="description" content="Watch On the Clock live: the We-Draft.com Draft Sim runs the NFL Draft with all 32 war rooms and the analyst desk. Click any player or team to open their page." />
        <link rel="canonical" href="https://we-draft.com/draftsim/live" />
      </Helmet>
      <style>{BROADCAST_STYLE}{OTC_STYLE}{`
        .wd-live-ctl { position: absolute; top: 14px; right: 14px; z-index: 20; display: flex; gap: 8px; }
        .wd-live-ctl.small { top: 6px; right: 6px; }
        .wd-live-full { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px;
          border: 1px solid rgba(255,255,255,.35); background: rgba(5,10,20,.72); color: #fff; font: 900 12px/1 ${BODY}; letter-spacing: .08em; text-transform: uppercase;
          cursor: pointer; opacity: .85; transition: opacity .15s ease; }
        .wd-live-full:hover, .wd-live-full:focus-visible { opacity: 1; }
        .wd-live-full.small { padding: 5px 7px; gap: 0; }
        .wd-live-box:fullscreen { background: #000; }
        .wd-chat { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; color: #fff; font-family: ${BODY};
          background: rgba(5,10,20,.6); border: 1px solid rgba(255,255,255,.12); border-radius: 14px;
          backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); box-shadow: 0 10px 30px rgba(0,0,0,.45); }
        .wd-chat-h { display: flex; align-items: center; gap: 8px; padding: 10px 10px 9px 14px; border-bottom: 1px solid rgba(255,255,255,.08);
          color: ${GOLD}; font: 900 13px/1 ${BODY}; letter-spacing: .1em; text-transform: uppercase; flex-shrink: 0; }
        .wd-chat-dot { width: 7px; height: 7px; border-radius: 50%; background: #6f819c; }
        .wd-chat-dot.on { background: #e5243b; box-shadow: 0 0 0 3px rgba(229,36,59,.25); }
        .wd-chat-x { margin-left: auto; background: none; border: 0; color: #9fb0c8; font-size: 15px; line-height: 1; padding: 4px 6px; border-radius: 6px; cursor: pointer; }
        .wd-chat-x:hover, .wd-chat-x:focus-visible { background: rgba(255,255,255,.1); color: #fff; }
        .wd-chat-open { display: inline-flex; align-items: center; gap: 7px; padding: 7px 13px; border-radius: 999px; border: 1px solid rgba(255,255,255,.35);
          background: rgba(5,10,20,.72); color: #fff; font: 900 12px/1 ${BODY}; letter-spacing: .08em; text-transform: uppercase; cursor: pointer; opacity: .85; }
        .wd-chat-open:hover, .wd-chat-open:focus-visible { opacity: 1; }
        ${LIVE_CHAT_STYLE}
      `}</style>

      <div style={{ maxWidth: 1600, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12, color: "#fff" }}>
          <img src="/wd-icon.png" alt="" style={{ width: 34, height: 34 }} />
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, letterSpacing: ".02em", textTransform: "uppercase", fontFamily: "'Arial Black', Arial, sans-serif" }}>On the Clock</h1>
          {status && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", fontFamily: BODY,
              background: live ? "#c8102e" : "rgba(255,255,255,.1)", color: "#fff" }}>
              {live && <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff" }} />}{status}
            </span>
          )}
          <span style={{ flex: 1, minWidth: 0, color: "#9fb0c8", fontSize: 13, fontWeight: 700, fontFamily: BODY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{script ? title : ""}</span>
          <Link to="/draftsim" style={{ color: GOLD, fontSize: 13, fontWeight: 900, fontFamily: BODY, textDecoration: "none", letterSpacing: ".04em", textTransform: "uppercase" }}>Run your own draft →</Link>
        </div>

        {watch === undefined || (id && loading) || (id && !script) ? (
          <div style={{ aspectRatio: "16 / 9", borderRadius: 12, background: "#0b1424", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {id && !loading && !script ? <Empty text="This show couldn't be loaded." /> : <LoadingSpinner label="Loading" size={40} minHeight="200px" />}
          </div>
        ) : !m ? (
          <div style={{ aspectRatio: "16 / 9", borderRadius: 12, background: "#0b1424", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Empty text="No show is scheduled right now — check back tonight." />
          </div>
        ) : (
          <div ref={boxRef} className="wd-live-box" style={{
            position: pseudo ? "fixed" : "relative", ...(pseudo ? { inset: 0, zIndex: 10060 } : { width: "100%", aspectRatio: "16 / 9" }),
            overflow: "hidden", background: "#000", borderRadius: filled ? 0 : 12, boxShadow: filled ? "none" : "0 12px 40px rgba(0,0,0,.5)",
          }}>
            <div className="bc-stage" style={{ transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.k})`, opacity: fontsOk ? 1 : 0 }}>
              <OnTheClockScreen script={script} timeline={timeline} m={m} links />
            </div>
            {/* Chat's reopen button (when it's closed over the desk) and Full screen. */}
            <div className={`wd-live-ctl${fit.k < 0.4 ? " small" : ""}`}>
              {chat && overDesk && chatClosed && (
                <button type="button" className="wd-chat-open" onClick={() => closeChat(false)}>
                  <span aria-hidden="true" className={`wd-chat-dot${chatOpen ? " on" : ""}`} />Chat
                </button>
              )}
              {/* Icon only when the frame's small (phones), so it doesn't cover the show. */}
              <button type="button" className={`wd-live-full${fit.k < 0.4 ? " small" : ""}`} onClick={toggleFull} aria-label={filled ? "Exit full screen" : "Full screen"} title={filled ? "Exit full screen" : "Full screen"}>
                <span aria-hidden="true" style={{ fontSize: 14 }}>{filled ? "✕" : "⛶"}</span>{fit.k < 0.4 ? null : filled ? "Exit full screen" : "Full screen"}
              </button>
            </div>
            {chat && overDesk && !chatClosed && (
              <div style={{ position: "absolute", zIndex: 15, top: chatTop, right: chatRight, width: chatW, height: chatH, display: "flex" }}>{chat}</div>
            )}
          </div>
        )}

        {chat && !overDesk && (chatClosed ? (
          <div style={{ marginTop: 12 }}>
            <button type="button" className="wd-chat-open" onClick={() => closeChat(false)}><span aria-hidden="true" className={`wd-chat-dot${chatOpen ? " on" : ""}`} />Show chat</button>
          </div>
        ) : (
          <div style={{ marginTop: 12, height: 400, display: "flex" }}>{chat}</div>
        ))}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", marginTop: 12, color: "#9fb0c8", fontSize: 13, fontWeight: 700, fontFamily: BODY }}>
          <span>Click any player or team to open their page in a new tab — the show keeps going.</span>
          {m && <span>Same show as the YouTube stream, pick for pick.</span>}
        </div>
      </div>
    </div>
  );
}

function Empty({ text }) {
  return (
    <div style={{ textAlign: "center", color: "#fff", fontFamily: BODY, padding: 20 }}>
      <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 12 }}>{text}</div>
      <Link to="/draftsim" style={{ color: GOLD, fontWeight: 900, textDecoration: "none" }}>Run your own draft in the Draft Sim →</Link>
    </div>
  );
}
