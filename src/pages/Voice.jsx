// src/pages/Voice.jsx
//
// /voice — ask We-Draft.com by voice or by typing (user, 2026-11-25). Built
// to sit on a plugged-in iPad as an always-on screen: big type, dark, one
// answer at a time with the conversation under it.
//
//   /voice         General: stats and facts anyone could ask
//   /voice/admin   Admin: general + data entry ("change Kromah's weight to
//                  225", "how many plays do I have for Kromah")
//
// Both are admin-only for now (AdminRoute in App.js); the split is so the
// general one can open up later on its own. No AI: utils/voice/engine.js
// matches sentence patterns (utils/voice/intents.js) and answers from the
// site's data in the browser (utils/voice/data.js). Writes always ask first.
//
// What it couldn't answer is logged (voiceMisses) — the Admin version's
// "Missed" button lists it, to add those questions later.
//
// Keys: Space = listen (when not typing), Enter = send, Y / N on a confirm.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "../context/AuthContext";
import { useIsAdmin } from "../utils/prospectYears";
import { respond, choose, confirm, more, newState, intentsFor, remember } from "../utils/voice/engine";
import { applyPronunciations } from "../utils/voice/pronounce";
import { forSpeech } from "../utils/voice/spoken";
import { makeVoiceData } from "../utils/voice/data";
import { logEntry, deviceOf } from "../utils/voice/log";
import { listen, speak, hush, canListen, canSpeak, wakeListen, unlockSpeech, speechUnlocked, isIOS, speakTest, iosOtherBrowser, englishVoices, onVoicesChanged, preferredVoiceName, setPreferredVoice } from "../utils/voice/speech";
import { localWakeListen, canWakeLocally } from "../utils/voice/localWake";
import { Orb, Stage } from "../components/voice/VoiceStage";

// This page visit, for the conversation log (one sitting reads as one conversation).
const SESSION = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const DEVICE = typeof navigator === "undefined" ? "" : deviceOf(navigator.userAgent, navigator.maxTouchPoints || 0);

const C = { bg: "#0b1220", panel: "#121b2e", line: "#24324d", ink: "#eef2f8", soft: "#8f9db5", gold: "#f2b632", blue: "#3b82f6", good: "#4ade80", bad: "#ff8a80" };
const ALIAS_KEY = "wd.voice.aliases";
// Who "he" is, kept across a reload (the iPad stays on the page for days).
const LAST_KEY = "wd.voice.last";
const SPEAK_KEY = "wd.voice.speak";
const BRIEF_KEY = "wd.voice.brief";
// "Hey We-Draft" always listening (user, 2026-11-25) — on / off, remembered.
const WAKE_KEY = "wd.voice.wake";
// A live game's answer re-asks itself this often while it's on screen (quietly).
const LIVE_REFRESH_MS = 30000;
// The longest an answer may take before the page gives up on it.
const ANSWER_LIMIT_MS = 15000;
// "Microsoft Aria Online (Natural) - English (United States)" → "Aria (Natural)".
const voiceLabel = (v) => { const n = String(v?.name || "").replace(/^(?:Microsoft|Google|Apple)\s+/i, "").replace(/\s+Online/i, "").replace(/\s*-\s*English.*$/i, "").trim() || v?.name || ""; return v?.quality && !new RegExp(v.quality, "i").test(n) ? `${n} (${v.quality})` : n; };
const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };
const TONE = { answer: C.ink, done: C.good, ask: C.gold, miss: C.bad };

export default function Voice() {
  const mode = useLocation().pathname.replace(/\/+$/, "").endsWith("/admin") ? "admin" : "general";
  const { user } = useAuth();
  const uid = user?.uid || null;
  const [brief, setBrief] = useState(() => load(BRIEF_KEY, false));
  const memory = useRef({}); // which wordings were just used (never the same one twice in a row)
  const base = useMemo(() => makeVoiceData({ user: uid ? { uid } : null }), [uid]);
  // An admin on /voice can still run the admin commands ("morning readout").
  const { isAdmin } = useIsAdmin();
  const voiceData = useMemo(() => ({ ...base, vary: true, brief, memory: memory.current, isAdmin: !!isAdmin }), [base, brief, isAdmin]);
  const [showMissed, setShowMissed] = useState(false);
  const [state, setState] = useState(() => ({ ...newState(mode), aliases: load(ALIAS_KEY, {}), ...load(LAST_KEY, {}) }));
  // The answer a pending question (yes / no, "which one?", "next") belongs to.
  const [pendingFor, setPendingFor] = useState(null);
  const [log, setLog] = useState([]); // [{ id, said, reply }] newest first
  const [typed, setTyped] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const [talk, setTalk] = useState(() => load(SPEAK_KEY, true));
  // The voice picker: this device's English voices and the one picked (remembered here).
  const [voices, setVoices] = useState([]);
  const [voiceName, setVoiceName] = useState(() => preferredVoiceName());
  useEffect(() => { englishVoices().then(setVoices).catch(() => {}); return onVoicesChanged(setVoices); }, []);
  const pickVoice = (name) => {
    setPreferredVoice(name);
    setVoiceName(name);
    const v = voices.find((x) => x.id === name);
    speakTest(`This is ${v ? voiceLabel(v) : "the automatic voice"}.`);
  };
  // The logo pulses while it talks, a beat on each word.
  const [speaking, setSpeaking] = useState(false);
  const [beat, setBeat] = useState(0);
  const inputRef = useRef(null);
  const stopRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  // The wake word: on / off, its listener, and the 8-second window after "Hey We-Draft".
  // Never on an iPad / iPhone: Safari won't keep the mic open (it clicks on and off).
  const [wakeOn, setWakeOn] = useState(() => !isIOS() && load(WAKE_KEY, false));
  const [awake, setAwake] = useState(false);
  const [wakeNote, setWakeNote] = useState("");
  const wakeRef = useRef(null);
  const quietRef = useRef(false); // talking or busy: the wake listener ignores what it hears
  quietRef.current = speaking || busy;

  useEffect(() => { setState((s) => ({ ...s, mode, pending: null })); }, [mode]);
  useEffect(() => { save(ALIAS_KEY, state.aliases); }, [state.aliases]);
  useEffect(() => { save(LAST_KEY, { last: state.last || null, lastAsk: state.lastAsk || null, recent: state.recent || [] }); }, [state.last, state.lastAsk, state.recent]);
  useEffect(() => { save(SPEAK_KEY, talk); if (!talk) { hush(); setSpeaking(false); } }, [talk]);
  useEffect(() => { save(BRIEF_KEY, brief); }, [brief]);
  useEffect(() => { voiceData.people(); voiceData.pronunciations(); }, [voiceData]); // warm the name list and how names are said
  // Warm what answers lean on (speed — user, 2026-11-25): the team list, this week's
  // games, and the last player asked about (his ESPN numbers), so the first questions
  // don't wait on the network.
  useEffect(() => {
    const t = setTimeout(async () => {
      voiceData.teams?.().catch(() => {});
      voiceData.liveSlate?.().catch(() => {});
      const last = stateRef.current.last;
      if (last?.id) {
        const d = await voiceData.player(last.id).catch(() => null);
        if (d) voiceData.seasons(d).catch(() => {});
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [voiceData]);
  // Every CFBD roster player's name (~840 KB, 3 reads): loaded a few seconds in, so the
  // first question about a player who isn't on the board doesn't wait for it.
  useEffect(() => {
    const t = setTimeout(() => { voiceData.cfbdPeople?.().catch(() => {}); }, 4000);
    return () => clearTimeout(t);
  }, [voiceData]);
  // An always-on screen: ask the device to keep the screen awake while the page is
  // showing (Wake Lock — iPadOS 16.4+, Chrome); asked again whenever it comes back.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.wakeLock) return undefined;
    let lock = null;
    let gone = false;
    const hold = async () => {
      if (gone || document.visibilityState !== "visible" || lock) return;
      try { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); } catch { /* not allowed now; next visit */ }
    };
    const onVis = () => { if (document.visibilityState === "visible") hold(); };
    hold();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointerdown", hold); // some browsers only grant it after a tap
    return () => { gone = true; document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pointerdown", hold); lock?.release().catch(() => {}); };
  }, []);
  // Add to Home Screen from here opens Voice, not the home page: this page's own
  // manifest (public/voice-manifest.json — starts at /voice/admin) while it's open.
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return undefined;
    const before = link.getAttribute("href");
    link.setAttribute("href", "/voice-manifest.json");
    return () => { link.setAttribute("href", before); };
  }, []);
  // iOS speaks only after a first sound from a tap.
  useEffect(() => {
    // Any tap but the logo (the logo starts the mic — speech then would fight it).
    const first = (e) => {
      if (e.target?.closest?.(".wdv-orb")) return;
      unlockSpeech();
      if (speechUnlocked()) window.removeEventListener("pointerdown", first);
    };
    window.addEventListener("pointerdown", first);
    return () => window.removeEventListener("pointerdown", first);
  }, []);

  // What the browser did with each spoken answer (started / error / never started),
  // logged so a silent device can be diagnosed from the log (user, 2026-11-25:
  // "its working but audio not playing"). The first few a visit only.
  const reports = useRef(0);
  const speechReport = (r) => {
    if (r.phase === "end" || reports.current >= 8) return;
    reports.current += 1;
    voiceData.logExchange?.(logEntry(`(speech ${r.test ? "test" : "check"})`, { say: JSON.stringify(r).slice(0, 500), intent: "speech.debug", tone: r.phase === "start" ? "answer" : "miss" }, { source: "debug", session: SESSION, device: DEVICE, mode }));
  };
  // What the mic did on each tap (started / cut off and retried / error / ended),
  // logged like the speech checks (user, 2026-11-25: "it turns off right away").
  const micReports = useRef(0);
  const micReport = (r) => {
    if (micReports.current >= 12) return;
    micReports.current += 1;
    voiceData.logExchange?.(logEntry("(mic check)", { say: JSON.stringify(r).slice(0, 500), intent: "mic.debug", tone: r.phase === "error" || r.phase === "cut-off" ? "miss" : "answer" }, { source: "debug", session: SESSION, device: DEVICE, mode }));
  };
  // meta: { source: "voice" | "typed" | "wake" | "tap", ms } — for the conversation log.
  const show = (said, out, meta = {}) => {
    voiceData.logExchange?.(logEntry(said, out.reply, { ...meta, session: SESSION, device: DEVICE, mode }));
    setState(out.state);
    const id = Date.now();
    setLog((l) => [{ id, said, reply: out.reply }, ...l].slice(0, 40));
    setPendingFor(out.state.pending ? id : null);
    // Dictating a scouting report: after each "Got it.", listen for the next point on its own
    // (the iPad's Safari only starts the mic from a tap — there, tap the logo for each one).
    const dictating = out.state.pending?.kind === "dictate";
    const keepGoing = () => { if (dictating) setTimeout(() => dictateRef.current(), 250); };
    if (talk) {
      // After a spoken question, give iOS a moment to move the audio off the mic.
      const afterMic = meta.source === "voice" || meta.source === "wake" ? 350 : 0;
      setTimeout(() => speak(applyPronunciations(forSpeech(out.reply.speak || out.reply.say), voiceData.pronMap()), {
        start: () => setSpeaking(true), end: () => { setSpeaking(false); keepGoing(); }, word: () => setBeat((b) => b + 1),
        // Swallowed (iOS before a tap has unlocked speech): offer "Tap to hear" on this answer.
        report: (r) => { speechReport(r); if (r.phase === "never" || r.phase === "error") setLog((l) => l.map((x) => (x.id === id ? { ...x, silent: true } : x))); },
      }), afterMic);
    } else keepGoing();
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  };
  // The logo: talking → stop talking; wake word on → it's listening already, so
  // open the question window; else listen once (no mic → the text box).
  const tapOrb = () => {
    if (speaking) { hush(); setSpeaking(false); return; }
    if (wakeOn && wakeRef.current) { wakeRef.current.wake(); return; }
    if (canListen()) listenRef.current();
    else inputRef.current?.focus();
  };
  const ask = async (text, source = "tap") => {
    const t = String(text || "").trim();
    if (!t || busy) return;
    setBusy(true);
    const t0 = performance.now();
    // Never stuck on "One second…": after ANSWER_LIMIT_MS, give up on this one (a late
    // answer is dropped), say so, and log it as a timeout so it can be found and fixed.
    let timer = null;
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ANSWER_LIMIT_MS); });
    try {
      const out = await Promise.race([respond(t, stateRef.current, voiceData), late]);
      if (out) show(t, out, { source, ms: performance.now() - t0 });
      else show(t, { state: stateRef.current, reply: { say: "That took too long. Try again, or ask it another way.", tone: "miss", intent: "timeout" } }, { source, ms: performance.now() - t0 });
    } catch (e) {
      show(t, { state: stateRef.current, reply: { say: `Something went wrong: ${e.message}`, tone: "miss", intent: "error" } }, { source, ms: performance.now() - t0 });
    } finally { clearTimeout(timer); setBusy(false); }
  };
  const pick = async (c) => { setBusy(true); try { show(c.label, remember(await choose(c.id, stateRef.current, voiceData), c.label), { source: "tap" }); } finally { setBusy(false); } };
  const answer = async (yes) => { setBusy(true); try { show(yes ? "Yes" : "No", await confirm(yes, stateRef.current, voiceData), { source: "tap" }); } finally { setBusy(false); } };
  // ⚑ Mark: save this exchange to fix later (same as saying "mark that").
  const markItem = async (item) => {
    if (item.marked || item.reply?.noRecord) return;
    try {
      await voiceData.markAnswer({ said: item.said, say: item.reply.say, intent: item.reply.intent || null, player: item.reply.player?.id || null, note: "", mode });
      setLog((l) => l.map((x) => (x.id === item.id ? { ...x, marked: true } : x)));
    } catch (e) { setLog((l) => [{ id: Date.now(), said: "", reply: { say: `Couldn't mark it: ${e.message}`, tone: "miss" } }, ...l]); }
  };
  const next = async () => { setBusy(true); try { show("Next", remember(await more(stateRef.current, voiceData), "Next"), { source: "tap" }); } finally { setBusy(false); } };

  const startListening = (opts = {}) => {
    if (listening) { stopRef.current?.(); return; }
    if (iosOtherBrowser()) {
      setLog((l) => [{ id: Date.now(), said: "", reply: { say: "On the iPad, the microphone only works in Safari. Open we-draft.com/voice/admin in Safari, or type your question below.", tone: "miss" } }, ...l]);
      inputRef.current?.focus();
      return;
    }
    // Only stop the voice if it's actually talking: touching speech as the mic
    // starts can cut the mic off on iOS.
    if (canSpeak() && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) hush();
    setSpeaking(false);
    setInterim("");
    setListening(true);
    stopRef.current = listen({
      report: micReport,
      interim: setInterim,
      final: (t) => { setInterim(""); ask(t, "voice"); },
      end: () => setListening(false),
      error: (code) => { setListening(false); if (code !== "no-speech" && code !== "aborted") setLog((l) => [{ id: Date.now(), said: "", reply: { say: code === "not-allowed" ? "The microphone is blocked. Allow it for this site." : `The microphone stopped (${code}).`, tone: "miss" } }, ...l]); },
    // Dictating, or a tap during a dictation: people pause to think between sentences.
    }, opts.slower || stateRef.current?.pending?.kind === "dictate" ? { slower: 1.4, nothingMs: 15000 } : {});
  };
  const listenRef = useRef(startListening);
  listenRef.current = startListening;
  // The next point of a dictated report: the wake word's window, else the mic (not on iOS — it needs a tap).
  const continueDictation = () => {
    if (stateRef.current?.pending?.kind !== "dictate" || listening) return;
    if (wakeOn && wakeRef.current) { wakeRef.current.wake(); return; }
    if (canListen() && !isIOS() && !iosOtherBrowser()) startListening({ slower: true });
  };
  const dictateRef = useRef(continueDictation);
  dictateRef.current = continueDictation;
  const orbRef = useRef(tapOrb);
  orbRef.current = tapOrb;
  const askRef = useRef(null);
  askRef.current = ask;

  // "Hey We-Draft": always listening while it's on (Chrome; the iPad's Safari
  // won't keep the mic open — then it says so and the logo is tap-to-talk).
  useEffect(() => {
    save(WAKE_KEY, wakeOn);
    if (!wakeOn) { setAwake(false); return undefined; }
    if (!canListen()) { setWakeNote("This browser can't listen. Use Chrome for “Hey We-Draft”."); setWakeOn(false); return undefined; }
    setWakeNote("");
    let closeTimer = null;
    let ctl = null;
    let gone = false;
    const handlers = {
      wake: () => { setAwake(true); setInterim(""); clearTimeout(closeTimer); closeTimer = setTimeout(() => { setAwake(false); setInterim(""); }, 8000); },
      heard: (t) => setInterim(t),
      question: (t) => { clearTimeout(closeTimer); setAwake(false); setInterim(""); askRef.current(t, "wake"); },
    };
    // Chrome's own speech service as the wake listener (the old way): it stops in a background tab.
    const startChromeWake = () => {
      ctl = wakeListen({
        ...handlers,
        unsupported: () => { setWakeNote("This browser won't keep the microphone on. “Hey We-Draft” works in Chrome; here, tap the logo."); setWakeOn(false); },
      }, () => quietRef.current);
      wakeRef.current = ctl;
    };
    // Heard on this computer (user, 2026-11-26): keeps listening with the tab in the background.
    if (canWakeLocally()) {
      ctl = localWakeListen({
        ...handlers,
        state: (s) => setWakeNote(
          s === "loading" ? "Loading the wake word (first time only, ~40 MB)…"
          : s === "needs-tap" ? "Click anywhere on the page to start listening."
          : s === "mic-lost" ? "Microphone disconnected — reconnecting…"
          : ""),
        unsupported: (why) => {
          if (gone) return;
          if (why === "not-allowed") { setWakeNote("Microphone blocked. Allow it for this site (lock icon in the address bar), then turn the wake word on again."); setWakeOn(false); return; }
          setWakeNote("Couldn't load the background wake word — listening the old way (keep this tab in front).");
          ctl?.stop();
          startChromeWake();
        },
      }, () => quietRef.current);
      wakeRef.current = ctl;
    } else {
      startChromeWake();
    }
    return () => { gone = true; clearTimeout(closeTimer); ctl?.stop(); wakeRef.current = null; };
  }, [wakeOn]);

  // A live game's answer on screen: re-ask it every 30 seconds, quietly (no
  // talking, the plain wording, nothing logged), and swap in the new numbers.
  const nowItem = log[0];
  useEffect(() => {
    if (!nowItem?.reply?.live || !nowItem.said) return undefined;
    const quiet = { ...base, vary: false, memory: {}, logMiss: () => {} };
    const t = setInterval(async () => {
      if (busyRef.current || stateRef.current.pending) return;
      try {
        const out = await respond(nowItem.said, stateRef.current, quiet);
        if (!out?.reply?.say || out.reply.tone === "miss") return;
        setLog((l) => l.map((x) => (x.id === nowItem.id ? { ...x, reply: { ...out.reply, refreshedAt: Date.now() } } : x)));
      } catch { /* try again next time */ }
    }, LIVE_REFRESH_MS);
    return () => clearInterval(t);
  }, [nowItem?.id, nowItem?.reply?.live, nowItem?.said, base]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "Space") { e.preventDefault(); orbRef.current(); }
      if (stateRef.current.pending?.kind === "confirm" && (e.key === "y" || e.key === "n")) answer(e.key === "y");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const bringBack = (x) => { setLog((l) => [x, ...l.filter((y) => y.id !== x.id)]); window.scrollTo?.({ top: 0, behavior: "smooth" }); };
  const [now, ...earlier] = log;
  const pending = state.pending;
  const orbMode = listening || awake ? "listening" : busy ? "thinking" : speaking ? "speaking" : wakeOn ? "standby" : "idle";
  const examples = intentsFor(mode).filter((i) => i.id !== "help").slice(0, 4).map((i) => i.examples[0]);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "Inter, system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
      <Helmet>
        <title>Voice · We-Draft.com</title>
        <meta name="robots" content="noindex" />
        {/* Add to Home Screen on the iPad: full screen, named "WD Voice", the circle logo. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="WD Voice" />
        <meta name="theme-color" content={C.bg} />
        <link rel="apple-touch-icon" href="/wd-icon-512.png" />
      </Helmet>

      <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: `1px solid ${C.line}`, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: "0.02em", flex: 1, minWidth: 160 }}>We-Draft.com <span style={{ color: C.gold }}>Voice</span></div>
        <nav style={{ display: "flex", gap: 4, background: C.panel, borderRadius: 999, padding: 3, border: `1px solid ${C.line}` }}>
          {[["general", "General", "/voice"], ["admin", "Admin", "/voice/admin"]].map(([m, l, to]) => (
            <Link key={m} to={to} style={{ padding: "6px 14px", borderRadius: 999, fontSize: 13, fontWeight: 800, textDecoration: "none", background: mode === m ? C.gold : "transparent", color: mode === m ? "#1a1300" : C.soft }}>{l}</Link>
          ))}
        </nav>
        {mode === "admin" && <button type="button" onClick={() => setShowMissed((x) => !x)} style={{ ...ghost, color: showMissed ? C.gold : C.ink }}>Review</button>}
        {canListen() && !isIOS() && (
          <button type="button" onClick={() => { unlockSpeech(); setWakeOn((x) => !x); }} title="Always listen for “Hey We-Draft” (works in Chrome)" style={{ ...ghost, color: wakeOn ? C.good : C.ink, borderColor: wakeOn ? C.good : C.line }}>{wakeOn ? "👂 Hey We-Draft: on" : "👂 Hey We-Draft: off"}</button>
        )}
        <button type="button" onClick={() => setBrief((x) => !x)} title="Brief: just the answer. Full: the answer plus what's notable and tips." style={{ ...ghost, color: brief ? C.gold : C.ink }}>{brief ? "Brief" : "Full"}</button>
        {canSpeak() && (
          <button type="button" onClick={() => { if (!talk) speakTest("Voice is on.", speechReport); setTalk((x) => !x); }} title="Turn the voice on or off (turning it on says “Voice is on.”)" style={{ ...ghost, color: talk ? C.ink : C.soft }}>{talk ? "🔊 Speaking" : "🔇 Muted"}</button>
        )}
        {/* Which voice — this device's English voices, the natural-sounding ones (★) first. */}
        {canSpeak() && voices.length > 1 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <select value={(voices.find((v) => v.id === voiceName || v.name === voiceName) || {}).id || voiceName} onChange={(e) => pickVoice(e.target.value)} title="The voice it answers in (remembered on this device)" aria-label="Voice"
              style={{ ...ghost, maxWidth: 220, padding: "6px 10px", background: C.panel, appearance: "auto" }}>
              <option value="">Voice: automatic</option>
              {voices.map((v) => <option key={v.id} value={v.id}>{v.natural ? "★ " : ""}{voiceLabel(v)}</option>)}
            </select>
            <button type="button" onClick={() => speakTest(`This is ${voiceName ? voiceLabel((voices.find((v) => v.id === voiceName) || voices.find((v) => v.name === voiceName)) || { name: voiceName }) : "the automatic voice"}. How's Kromah playing?`, speechReport)} title="Hear this voice" aria-label="Hear this voice" style={{ ...ghost, padding: "6px 10px" }}>▶</button>
          </span>
        )}
      </header>

      <main style={{ flex: 1, width: "100%", maxWidth: 860, margin: "0 auto", padding: "16px 16px 130px", boxSizing: "border-box", display: "grid", gap: 14, alignContent: "start" }}>
        {showMissed && <Review data={voiceData} onAsk={ask} />}

        {/* The We-Draft.com logo is the button: tap to talk; it pulses while it listens and talks. */}
        <section style={{ display: "grid", justifyItems: "center", gap: 10, padding: now ? "6px 0 2px" : "28px 0 8px" }}>
          <Orb mode={orbMode} beat={beat} size={now ? 88 : 148} onClick={tapOrb} label={speaking ? "Stop talking" : listening ? "Stop listening" : canListen() ? "Tap to ask (Space)" : "Type a question below"} />
          <div style={{ minHeight: 26, textAlign: "center", fontSize: now ? 16 : 18, fontWeight: 800, color: interim ? C.ink : C.soft, maxWidth: 640 }}>
            {listening || awake ? (interim || "Listening…") : busy ? "One second…" : speaking ? (now?.said ? `“${now.said}”` : "") : now?.said ? `“${now.said}”` : wakeOn ? "Say “Hey We-Draft”" : canListen() ? "Tap the logo and ask" : "Type a question below"}
          </div>
          {now?.silent && talk && (
            <button type="button" onClick={() => { speakTest(applyPronunciations(forSpeech(now.reply.speak || now.reply.say), voiceData.pronMap()), speechReport); setLog((l) => l.map((x) => (x.id === now.id ? { ...x, silent: false } : x))); }}
              style={{ ...ghost, borderColor: C.gold, color: C.gold, fontSize: 15, padding: "8px 16px" }}>🔊 Tap to hear</button>
          )}
          {wakeNote && <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, textAlign: "center", maxWidth: 560 }}>{wakeNote}</div>}
          {now?.reply?.live && <div style={{ fontSize: 12, fontWeight: 900, color: C.bad, letterSpacing: "0.08em" }}>● LIVE · updates every 30 seconds</div>}
        </section>

        {!now && (
          <div style={{ ...card, textAlign: "center", padding: "24px 18px" }}>
            <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 6 }}>Ask about any college player</div>
            <div style={{ color: C.soft, fontSize: 15, marginBottom: 16 }}>{mode === "admin" ? "Admin: questions, data entry, and the morning readout. Changes always ask first." : "Stats, career paths, rankings, the draft. The answer shows up here."}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {examples.map((e) => <button key={e} type="button" onClick={() => ask(e)} style={{ ...ghost, fontSize: 14 }}>“{e}”</button>)}
            </div>
          </div>
        )}

        {now && (
          <div style={{ position: "relative" }}>
            {mode === "admin" && !now.reply.noRecord && now.reply.say && (
              <button type="button" onClick={() => markItem(now)} title="Mark this answer to fix later" style={{ position: "absolute", top: -34, right: 0, ...ghost, padding: "3px 10px", fontSize: 11, color: now.marked ? C.gold : C.soft, borderColor: now.marked ? C.gold : C.line }}>{now.marked ? "⚑ Marked" : "⚑ Mark"}</button>
            )}
            <Stage key={now.id} item={now} pending={pendingFor === now.id ? pending : null} busy={busy} voiceMode={mode} onPick={pick} onConfirm={answer} onNext={next} onAsk={ask} />
          </div>
        )}

        {earlier.length > 0 && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: C.soft, textTransform: "uppercase", marginTop: 8 }}>Earlier</div>
            {/* Tap one to bring it back up top, graphics and all. */}
            {earlier.map((x) => <Answer key={x.id} item={x} onAsk={ask} onMark={mode === "admin" ? markItem : null} onOpen={() => bringBack(x)} />)}
          </div>
        )}
      </main>

      {/* Typing: the other way to ask. */}
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: `linear-gradient(transparent, ${C.bg} 35%)`, padding: "24px 16px calc(14px + env(safe-area-inset-bottom))" }}>
        <form onSubmit={(e) => { e.preventDefault(); ask(typed, "typed"); setTyped(""); }} style={{ maxWidth: 860, margin: "0 auto", display: "flex", gap: 10, alignItems: "center" }}>
          <input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type a question" enterKeyHint="send"
            style={{ flex: 1, minWidth: 0, height: 50, borderRadius: 14, border: `1px solid ${C.line}`, background: C.panel, color: C.ink, padding: "0 16px", fontSize: 16, outline: "none" }} />
          <button type="submit" disabled={!typed.trim() || busy} style={{ height: 50, padding: "0 18px", borderRadius: 14, border: "none", fontWeight: 900, fontSize: 15, background: typed.trim() ? C.blue : C.line, color: "#fff", cursor: typed.trim() ? "pointer" : "default" }}>Ask</button>
        </form>
      </div>
    </div>
  );
}

const card = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16 };
const ghost = { background: "transparent", border: `1px solid ${C.line}`, color: C.ink, borderRadius: 999, padding: "6px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" };
const big = { padding: "10px 18px", borderRadius: 12, border: "none", fontWeight: 900, fontSize: 16, cursor: "pointer" };

// One exchange: what was asked, then the answer.
function Answer({ item, big: isNow, pending, onPick, onConfirm, onAsk, onNext, busy, onMark, onOpen }) {
  const r = item.reply;
  const live = isNow && pending;
  return (
    <div
      role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} title={onOpen ? "Show this answer again" : undefined}
      onClick={onOpen} onKeyDown={onOpen ? (e) => { if (e.key === "Enter") onOpen(); } : undefined}
      style={{ ...card, padding: isNow ? 20 : 12, opacity: isNow ? 1 : 0.85, position: "relative", cursor: onOpen ? "pointer" : "default" }}>
      {onMark && !r.noRecord && r.say && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onMark(item); }} title="Mark this answer to fix later" style={{ position: "absolute", top: 8, right: 8, ...ghost, padding: "3px 10px", fontSize: 11, color: item.marked ? C.gold : C.soft, borderColor: item.marked ? C.gold : C.line }}>{item.marked ? "⚑ Marked" : "⚑ Mark"}</button>
      )}
      {item.said && <div style={{ fontSize: isNow ? 14 : 12, color: C.soft, fontWeight: 700, marginBottom: 6, paddingRight: onMark ? 80 : 0 }}>“{item.said}”</div>}
      {r.title && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: isNow ? 28 : 17, fontWeight: 900, lineHeight: 1.1 }}>
            {r.player?.Slug ? <Link to={`/player/${r.player.Slug}`} style={{ color: "inherit", textDecoration: "none" }}>{r.title}</Link> : r.title}
          </div>
          {r.sub && <div style={{ fontSize: isNow ? 14 : 12, color: C.soft, fontWeight: 700 }}>{r.sub}</div>}
        </div>
      )}
      <div style={{ fontSize: isNow ? 19 : 14, fontWeight: 700, color: TONE[r.tone] || C.ink, marginTop: r.title ? 8 : 0, lineHeight: 1.35 }}>{r.say}</div>

      {r.rows?.length > 0 && (
        <div style={{ display: "grid", gap: 1, marginTop: 12, borderRadius: 10, overflow: "hidden", border: `1px solid ${C.line}` }}>
          {r.rows.map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: isNow ? "10px 14px" : "6px 10px", background: "#0f172a" }}>
              <span style={{ color: C.soft, fontWeight: 800, fontSize: isNow ? 14 : 12 }}>{k}</span>
              <span style={{ fontWeight: 900, fontSize: isNow ? 16 : 13, textAlign: "right" }}>{v}</span>
            </div>
          ))}
        </div>
      )}

      {r.body && (
        <div style={{ marginTop: 12, padding: isNow ? "12px 14px" : "8px 10px", borderRadius: 10, background: "#0f172a", border: `1px solid ${C.line}`, fontSize: isNow ? 15 : 12, lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: isNow ? 320 : 90, overflow: "auto" }}>{r.body}</div>
      )}
      {isNow && r.tips?.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: C.soft }}>Say: {r.tips.map((x) => `“${x}”`).join(" · ")}</div>
      )}

      {r.help && (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {r.help.map((h) => (
            <div key={h.title} style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
              <div style={{ fontWeight: 900, fontSize: 15 }}>{h.title}{h.mode === "admin" && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 900, color: "#1a1300", background: C.gold, borderRadius: 999, padding: "2px 7px", verticalAlign: "middle" }}>ADMIN</span>}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {h.examples.map((e) => <button key={e} type="button" onClick={() => onAsk(e)} style={{ ...ghost, fontSize: 12 }}>“{e}”</button>)}
              </div>
            </div>
          ))}
        </div>
      )}

      {live && r.confirm && pending.kind === "confirm" && (
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button type="button" disabled={busy} onClick={() => onConfirm(true)} style={{ ...big, background: C.good, color: "#052e12" }}>Yes, change it (Y)</button>
          <button type="button" disabled={busy} onClick={() => onConfirm(false)} style={{ ...big, background: C.line, color: C.ink }}>No (N)</button>
        </div>
      )}
      {live && r.hasMore && pending.kind === "more" && (
        <div style={{ marginTop: 14 }}>
          <button type="button" disabled={busy} onClick={onNext} style={{ ...big, background: C.blue, color: "#fff" }}>Next (say “next”)</button>
        </div>
      )}
      {live && r.choices?.length > 0 && pending.kind === "choose" && (
        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          {r.choices.map((c, i) => (
            <button key={c.id} type="button" disabled={busy} onClick={() => onPick(c)} style={{ ...ghost, borderRadius: 12, textAlign: "left", fontSize: 15, padding: "10px 14px" }}>
              <span style={{ color: C.gold, fontWeight: 900, marginRight: 8 }}>{i + 1}</span>{c.label}
            </button>
          ))}
          {pending.teach && <div style={{ fontSize: 12, color: C.soft, fontWeight: 700 }}>Picking one teaches it: next time “{pending.said}” means him.</div>}
        </div>
      )}
    </div>
  );
}

// What it couldn't answer (voiceMisses), the same sentence grouped, newest
// first — to add as questions later. Done hides one.
const REASONS = {
  "not-understood": "Didn't understand", "unknown-player": "Unknown player", "no-stats": "No stats", "no-stat": "Missing stat",
  "no-opponent": "No game vs that team", "no-season": "No such season", "no-games": "No games", "no-rank": "No rank", "no-evals": "No evaluations",
  "unknown-trait": "Unknown trait", error: "Error",
  "not-on-wedraft": "Not on We-Draft.com (on CFBD)", "add-not-on-cfbd": "Add: not on CFBD", "stat-rank": "Stat rank asked",
  "no-projection": "No projection", "no-roster": "No players there", "no-measurements": "No measurements",
};
function Review({ data, onAsk }) {
  const [tab, setTab] = useState("missed");
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 4, background: C.panel, borderRadius: 999, padding: 3, border: `1px solid ${C.line}`, justifySelf: "start" }}>
        {[["log", "Log"], ["missed", "Missed"], ["marked", "Marked"], ["pron", "Pronunciations"], ["adminNotes", "Admin notes"], ["voiceNotes", "Voice notes"]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} style={{ padding: "6px 14px", borderRadius: 999, border: "none", fontSize: 13, fontWeight: 800, cursor: "pointer", background: tab === k ? C.gold : "transparent", color: tab === k ? "#1a1300" : C.soft }}>{l}</button>
        ))}
      </div>
      {tab === "log" && <ConversationLog data={data} onAsk={onAsk} />}
      {tab === "missed" && <Missed data={data} onAsk={onAsk} />}
      {tab === "marked" && <Marked data={data} onAsk={onAsk} />}
      {tab === "pron" && <Pronunciations data={data} onAsk={onAsk} />}
      {tab === "adminNotes" && <Notes key="admin" kind="admin" data={data} />}
      {tab === "voiceNotes" && <Notes key="voice" kind="voice" data={data} />}
    </div>
  );
}

// Every question and answer (voiceLog — utils/voice/log.js), newest first, one
// block per sitting (page visit), with the device. scripts/voiceLog.mjs prints
// the same thing in VS Code.
const SOURCE_ICON = { voice: "🎙", wake: "👂", typed: "⌨", tap: "👆", refresh: "↻" };
function ConversationLog({ data, onAsk }) {
  const [rows, setRows] = useState(null);
  const [missesOnly, setMissesOnly] = useState(false);
  const load = () => data.listLog(200).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return <div style={card}>Loading…</div>;
  const ms = (t) => (t?.toMillis ? t.toMillis() : t?.seconds ? t.seconds * 1000 : 0);
  const list = rows.filter((r) => !missesOnly || r.miss);
  const sessions = [];
  list.forEach((r) => {
    const last = sessions[sessions.length - 1];
    if (last && last.id === r.session) last.rows.push(r); else sessions.push({ id: r.session, device: r.device, rows: [r] });
  });
  return (
    <div style={{ ...card, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, fontSize: 17, flex: 1 }}>Conversation log <span style={{ color: C.soft, fontSize: 13 }}>({list.length})</span></div>
        <label style={{ fontSize: 12, color: C.soft, fontWeight: 700 }}><input type="checkbox" checked={missesOnly} onChange={(e) => setMissesOnly(e.target.checked)} /> Misses only</label>
        <button type="button" onClick={load} style={{ ...ghost, fontSize: 12 }}>Refresh</button>
      </div>
      {!list.length && <div style={{ color: C.soft, fontSize: 14 }}>Nothing logged yet. Every question and answer shows up here.</div>}
      {sessions.map((s, i) => (
        <div key={`${s.id}-${i}`} style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", color: C.soft, textTransform: "uppercase" }}>
            {s.device || "Unknown device"} · {ms(s.rows[s.rows.length - 1].at) ? new Date(ms(s.rows[s.rows.length - 1].at)).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : ""}
          </div>
          {s.rows.map((r) => (
            <div key={r.id} style={{ display: "grid", gap: 3, padding: "8px 10px", borderRadius: 10, background: "#0f172a", borderLeft: `3px solid ${r.miss ? C.bad : r.asked ? C.gold : C.line}` }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span title={r.source} style={{ fontSize: 13 }}>{SOURCE_ICON[r.source] || "·"}</span>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 800, fontSize: 14, overflowWrap: "anywhere" }}>“{r.said}”</span>
                <button type="button" onClick={() => onAsk(r.said)} style={{ ...ghost, fontSize: 11, padding: "2px 8px" }}>Try</button>
              </div>
              <div style={{ fontSize: 13, color: r.miss ? C.bad : C.ink, lineHeight: 1.4 }}>{r.say}</div>
              <div style={{ fontSize: 11, color: C.soft, fontWeight: 700 }}>
                {[ms(r.at) && new Date(ms(r.at)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), r.intent || "no question type", r.playerName, r.ms != null && `${(r.ms / 1000).toFixed(1)}s`].filter(Boolean).join(" · ")}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// "admin note …" / "voice note …" (user, 2026-11-25), newest first; Done hides one.
function Notes({ kind, data }) {
  const [rows, setRows] = useState(null);
  const [showDone, setShowDone] = useState(false);
  useEffect(() => { data.listNotes(kind).then(setRows).catch(() => setRows([])); }, [data, kind]);
  if (!rows) return <div style={card}>Loading…</div>;
  const ms = (t) => (t?.toMillis ? t.toMillis() : t?.seconds ? t.seconds * 1000 : 0);
  const list = rows.filter((r) => showDone || !r.done).sort((a, b) => ms(b.at) - ms(a.at));
  const done = async (r, v) => { await data.setNoteDone(kind, r.id, v); setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, done: v } : x))); };
  const name = kind === "admin" ? "Admin notes" : "Voice notes";
  return (
    <div style={{ ...card, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontWeight: 900, fontSize: 17, flex: 1 }}>{name} <span style={{ color: C.soft, fontSize: 13 }}>({list.length})</span></div>
        <label style={{ fontSize: 12, color: C.soft, fontWeight: 700 }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label>
      </div>
      {!list.length && <div style={{ color: C.soft, fontSize: 14 }}>No notes. Say "{kind} note" and then the note.</div>}
      {list.map((r) => (
        <div key={r.id} style={{ display: "grid", gap: 4, padding: "8px 10px", borderRadius: 10, background: "#0f172a", opacity: r.done ? 0.5 : 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 14, lineHeight: 1.4, overflowWrap: "anywhere" }}>{r.text}</div>
            <button type="button" onClick={() => done(r, !r.done)} style={{ ...ghost, fontSize: 12 }}>{r.done ? "Undo" : "Done"}</button>
          </div>
          <div style={{ fontSize: 11, color: C.soft, fontWeight: 700 }}>{ms(r.at) ? new Date(ms(r.at)).toLocaleString() : ""}{r.player ? ` · player ${r.player}` : ""}</div>
        </div>
      ))}
    </div>
  );
}

// Answers marked to fix ("mark that" / ⚑), newest first: what was asked, what it said, the note.
function Marked({ data, onAsk }) {
  const [rows, setRows] = useState(null);
  const [showDone, setShowDone] = useState(false);
  useEffect(() => { data.listMarks().then(setRows).catch(() => setRows([])); }, [data]);
  if (!rows) return <div style={card}>Loading…</div>;
  const ms = (t) => (t?.toMillis ? t.toMillis() : t?.seconds ? t.seconds * 1000 : 0);
  const list = rows.filter((r) => showDone || !r.done).sort((a, b) => ms(b.at) - ms(a.at));
  const done = async (r, v) => { await data.setMarkDone(r.id, v); setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, done: v } : x))); };
  return (
    <div style={{ ...card, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontWeight: 900, fontSize: 17, flex: 1 }}>Marked answers <span style={{ color: C.soft, fontSize: 13 }}>({list.length})</span></div>
        <label style={{ fontSize: 12, color: C.soft, fontWeight: 700 }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label>
      </div>
      {!list.length && <div style={{ color: C.soft, fontSize: 14 }}>Nothing marked. Say "mark that" after an answer, or tap ⚑ Mark.</div>}
      {list.map((r) => (
        <div key={r.id} style={{ display: "grid", gap: 4, padding: "8px 10px", borderRadius: 10, background: "#0f172a", opacity: r.done ? 0.5 : 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0, fontWeight: 800, fontSize: 14, overflowWrap: "anywhere" }}>“{r.said || "—"}”</div>
            {r.said && <button type="button" onClick={() => onAsk(r.said)} style={{ ...ghost, fontSize: 12 }}>Try</button>}
            <button type="button" onClick={() => done(r, !r.done)} style={{ ...ghost, fontSize: 12 }}>{r.done ? "Undo" : "Done"}</button>
          </div>
          <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.4 }}>{r.say}</div>
          <div style={{ fontSize: 11, color: C.soft, fontWeight: 700 }}>{r.note ? <span style={{ color: C.gold }}>Note: {r.note} · </span> : ""}{r.intent || "no question type"} · {r.mode}{ms(r.at) ? ` · ${new Date(ms(r.at)).toLocaleDateString()}` : ""}</div>
        </div>
      ))}
    </div>
  );
}

// How names are said: each locked one, ▶ to hear it, Redo (the voice flow), Remove.
function Pronunciations({ data, onAsk }) {
  const [map, setMap] = useState(null);
  useEffect(() => { data.pronunciations().then((m) => setMap({ ...m })); }, [data]);
  if (!map) return <div style={card}>Loading…</div>;
  const list = Object.entries(map).sort((a, b) => a[1].word.localeCompare(b[1].word));
  const remove = async (key) => { await data.deletePronunciation(key); setMap({ ...data.pronMap() }); };
  return (
    <div style={{ ...card, display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 900, fontSize: 17 }}>How names are said <span style={{ color: C.soft, fontSize: 13 }}>({list.length})</span></div>
      {!list.length && <div style={{ color: C.soft, fontSize: 14 }}>None yet. Say "you're saying Kromah wrong" to fix one.</div>}
      {list.map(([key, p]) => (
        <div key={key} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderRadius: 10, background: "#0f172a" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 14 }}>{p.word}</div>
            <div style={{ fontSize: 12, color: C.soft, fontWeight: 700 }}>said “{p.say}”</div>
          </div>
          <button type="button" onClick={() => speak(p.say)} style={{ ...ghost, fontSize: 12 }}>▶</button>
          <button type="button" onClick={() => onAsk(`fix how you say ${p.word}`)} style={{ ...ghost, fontSize: 12 }}>Redo</button>
          <button type="button" onClick={() => remove(key)} style={{ ...ghost, fontSize: 12 }}>Remove</button>
        </div>
      ))}
    </div>
  );
}

function Missed({ data, onAsk }) {
  const [rows, setRows] = useState(null);
  const [showDone, setShowDone] = useState(false);
  useEffect(() => { data.listMisses().then(setRows).catch(() => setRows([])); }, [data]);
  if (!rows) return <div style={card}>Loading…</div>;
  const ms = (t) => (t?.toMillis ? t.toMillis() : t?.seconds ? t.seconds * 1000 : 0);
  const groups = {};
  rows.filter((r) => showDone || !r.done).forEach((r) => {
    const k = `${r.reason}|${String(r.text || "").toLowerCase()}`;
    const g = (groups[k] ||= { ...r, ids: [], n: 0, last: 0 });
    g.ids.push(r.id); g.n += 1; g.last = Math.max(g.last, ms(r.at));
  });
  const list = Object.values(groups).sort((a, b) => b.last - a.last);
  const mark = async (g, done) => {
    await Promise.all(g.ids.map((id) => data.markMiss(id, done)));
    setRows((rs) => rs.map((r) => (g.ids.includes(r.id) ? { ...r, done } : r)));
  };
  return (
    <div style={{ ...card, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontWeight: 900, fontSize: 17, flex: 1 }}>What it couldn't answer <span style={{ color: C.soft, fontSize: 13 }}>({list.length})</span></div>
        <label style={{ fontSize: 12, color: C.soft, fontWeight: 700 }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label>
      </div>
      {!list.length && <div style={{ color: C.soft, fontSize: 14 }}>Nothing yet.</div>}
      {list.map((g) => (
        <div key={g.ids[0]} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderRadius: 10, background: "#0f172a", opacity: g.done ? 0.5 : 1 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14, overflowWrap: "anywhere" }}>“{g.text}”{g.n > 1 && <span style={{ color: C.gold }}> ×{g.n}</span>}</div>
            <div style={{ fontSize: 11, color: C.soft, fontWeight: 700 }}>{REASONS[g.reason] || g.reason}{g.said ? ` · heard “${g.said}”` : ""}{g.school ? ` at ${g.school}` : ""}{g.intent ? ` · ${g.intent}` : ""}{g.error ? ` · ${g.error}` : ""} · {g.mode}{g.last ? ` · ${new Date(g.last).toLocaleDateString()}` : ""}</div>
          </div>
          <button type="button" onClick={() => onAsk(g.text)} style={{ ...ghost, fontSize: 12 }}>Try</button>
          <button type="button" onClick={() => mark(g, !g.done)} style={{ ...ghost, fontSize: 12 }}>{g.done ? "Undo" : "Done"}</button>
        </div>
      ))}
    </div>
  );
}
