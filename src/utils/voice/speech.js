// src/utils/voice/speech.js
//
// /voice: the browser's own speech — listening (SpeechRecognition: Chrome
// on a PC, Safari on the iPad, both free) and talking (speechSynthesis).
// One question per listen; the page starts it from the mic button / Space.
// Hands-free (a wake word, "Hey We-Draft") is the next layer on top of this.

// Words unchanged this long = done talking (Safari's own pause is 1.5–3 s).
const QUIET_MS = 900;
export const canListen = () => typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

/**
 * Listen for one question.
 * on: { interim(text), final(text), end(), error(code) } → stop()
 */
// A tap's listening that ends this fast with nothing heard was cut off (iPad:
// "it turns off as soon as I tap it") — start it again, up to RETRIES times.
const CUT_OFF_MS = 1500;
const RETRIES = 2;

/**
 * Listen for one question. on: { interim(text), final(text), end(), error(code),
 * report({ phase: "start" | "cut-off" | "error" | "end", error?, ms, retry, heard }) }
 * → stop()
 */
export function listen(on) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { on.error?.("unsupported"); return () => {}; }
  let rec = null;
  let done = false;
  let stopped = false;
  let retry = 0;
  let heard = false;
  let t0 = 0;
  const begin = () => {
    rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    t0 = Date.now();
    rec.onstart = () => on.report?.({ phase: "start", retry, ms: 0 });
    rec.onresult = onResult;
    rec.onerror = (e) => {
      on.report?.({ phase: "error", error: e.error, retry, ms: Date.now() - t0, heard });
      // A cut-off ("aborted" / "no-speech" right away) gets retried in onend; the rest are real.
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") { stopped = true; on.error?.(e.error); }
    };
    rec.onend = () => {
      if (done || stopped) { on.end?.(); return; }
      const ms = Date.now() - t0;
      if (!heard && ms < CUT_OFF_MS && retry < RETRIES) {
        retry += 1;
        on.report?.({ phase: "cut-off", retry, ms });
        setTimeout(() => { if (!stopped && !done) { try { begin(); } catch { on.end?.(); } } }, 250);
        return;
      }
      on.report?.({ phase: "end", retry, ms, heard });
      on.end?.();
    };
    try { rec.start(); } catch (e) { on.report?.({ phase: "error", error: e.message, retry, ms: 0 }); on.error?.(e.message); }
  };
  // Speed (user, 2026-11-25): Safari waits through a long silence before calling a
  // result final. Once the words have stopped changing for QUIET_MS, that's the question.
  let settle = null;
  const finish = (text) => {
    if (done || !text) return;
    done = true;
    clearTimeout(settle);
    try { rec.abort(); } catch { /* stopped */ }
    on.final?.(text);
  };
  function onResult(e) {
    let text = "";
    let final = false;
    for (let i = 0; i < e.results.length; i += 1) { text += e.results[i][0].transcript; if (e.results[i].isFinal) final = true; }
    if (text.trim()) heard = true;
    clearTimeout(settle);
    if (!final && text.trim()) settle = setTimeout(() => finish(text.trim()), QUIET_MS);
    // Final: let go of the mic first — iOS keeps the audio set up for recording
    // (answers play quietly or not at all) until recognition has stopped.
    if (final) finish(text.trim()); else on.interim?.(text.trim());
  }
  begin();
  return () => { stopped = true; try { rec?.stop(); } catch { /* already stopped */ } };
}

/**
 * Say it. Cancels anything still being said.
 * on: { start(), end(), word() } — the page's logo pulses while it talks,
 * a beat on each word (word() isn't fired by every voice; start / end are).
 */
// ── Which voice (user, 2026-11-25: a voice picker) — chosen per device, remembered ──
const VOICE_KEY = "wd.voice.voiceName";
export const preferredVoiceName = () => { try { return localStorage.getItem(VOICE_KEY) || ""; } catch { return ""; } };
export function setPreferredVoice(name) { try { if (name) localStorage.setItem(VOICE_KEY, name); else localStorage.removeItem(VOICE_KEY); } catch { /* private window */ } }
// The better-sounding ones, listed first: Edge's "Natural" voices, Google's, Apple's Siri / Premium / Enhanced.
const NATURAL = /natural|neural|online|premium|enhanced|siri|google/i;
// The voice to use: the one picked on this device, else a US English one (on the device first).
function chooseVoice(vs) {
  const want = preferredVoiceName();
  return (want && vs.find((v) => v.name === want)) || vs.find((v) => /^en[-_]US$/i.test(v.lang) && v.localService) || vs.find((v) => /^en[-_]US$/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
}

// The device's voices load in the background (iOS especially); speaking before
// they're in can fail silently. → an English voice, waiting up to 1.5 s for the list.
function voiceReady() {
  const synth = window.speechSynthesis;
  const pick = () => {
    const vs = synth.getVoices() || [];
    return { voices: vs.length, voice: chooseVoice(vs) };
  };
  const now = pick();
  if (now.voices) return Promise.resolve(now);
  return new Promise((done) => {
    const t = setTimeout(() => done(pick()), 1500);
    synth.addEventListener?.("voiceschanged", () => { clearTimeout(t); done(pick()); }, { once: true });
  });
}

/** The browser's English voices for the picker, natural-sounding first: [{ name, lang, natural, local }]. */
export function englishVoices() {
  if (!canSpeak()) return Promise.resolve([]);
  return voiceReady().then(() => (window.speechSynthesis.getVoices() || [])
    .filter((v) => /^en/i.test(v.lang))
    .map((v) => ({ name: v.name, lang: v.lang, natural: NATURAL.test(v.name), local: !!v.localService }))
    .sort((a, b) => (b.natural - a.natural) || (/en[-_]US/i.test(b.lang) - /en[-_]US/i.test(a.lang)) || a.name.localeCompare(b.name)));
}

/**
 * on.report({ phase: "start" | "end" | "error" | "never", error?, voices, voiceName, standalone, ms })
 * — what the browser actually did with it (the page logs it: "why isn't it talking?").
 */
export function speak(text, on = {}) {
  if (!canSpeak() || !text) { on.end?.(); on.report?.({ phase: "error", error: canSpeak() ? "no-text" : "no-speech-synthesis" }); return; }
  const synth = window.speechSynthesis;
  const t0 = Date.now();
  const base = { standalone: typeof navigator !== "undefined" && !!navigator.standalone };
  voiceReady().then(({ voices, voice }) => {
    const info = { ...base, voices, voiceName: voice ? voice.name : null };
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    if (voice) u.voice = voice;
    u.rate = 1.05;
    u.volume = 1;
    let started = false;
    u.onstart = () => { started = true; on.start?.(); on.report?.({ ...info, phase: "start", ms: Date.now() - t0 }); };
    u.onend = () => { on.end?.(); on.report?.({ ...info, phase: "end", ms: Date.now() - t0 }); };
    u.onerror = (e) => { on.end?.(); on.report?.({ ...info, phase: "error", error: e?.error || "unknown", ms: Date.now() - t0 }); };
    u.onboundary = (e) => { if (e.name === "word" || e.name == null) on.word?.(); };
    // iOS Safari drops an utterance queued right after cancel(), and can be left
    // paused: cancel only when something is playing, then speak a beat later; resume first.
    const busy = synth.speaking || synth.pending;
    if (busy) synth.cancel();
    setTimeout(() => {
      try { synth.resume(); } catch { /* fine */ }
      synth.speak(u);
      // Neither started nor errored: the browser swallowed it.
      setTimeout(() => { if (!started) on.report?.({ ...info, phase: "never", speaking: synth.speaking, pending: synth.pending, paused: synth.paused, ms: Date.now() - t0 }); }, 4000);
    }, busy ? 150 : 0);
  });
}
export const hush = () => { if (canSpeak()) window.speechSynthesis.cancel(); };

/** iPad / iPhone (an iPad's Safari says "Macintosh"; a touch screen gives it away). Every iOS browser is Safari underneath. */
export const isIOS = () => typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints || 0) > 1));

// iOS won't speak until a REAL utterance is spoken inside a tap (the log showed
// a blank one doesn't count: answers were swallowed until "Voice is on." was
// tapped). A short word at volume 0 — silent, but spoken.
let unlocked = false;
export const speechUnlocked = () => unlocked;
export function unlockSpeech() {
  if (unlocked || !canSpeak()) return;
  unlocked = true;
  try {
    const synth = window.speechSynthesis;
    synth.resume();
    const u = new SpeechSynthesisUtterance("ok");
    u.volume = 0;
    u.rate = 2;
    synth.speak(u);
  } catch { /* fine */ }
}
/** Say a short line right now, inside a tap — the "is the voice working?" check. */
export function speakTest(text = "Voice is on.", report = null) {
  unlocked = true;
  if (!canSpeak()) { report?.({ phase: "error", error: "no-speech-synthesis", test: true }); return false; }
  const synth = window.speechSynthesis;
  try { synth.cancel(); synth.resume(); } catch { /* fine */ }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.volume = 1;
  const voice = chooseVoice(synth.getVoices() || []);
  if (voice) u.voice = voice;
  const info = { test: true, voices: (synth.getVoices() || []).length, voiceName: voice ? voice.name : null, standalone: typeof navigator !== "undefined" && !!navigator.standalone };
  let started = false;
  u.onstart = () => { started = true; report?.({ ...info, phase: "start" }); };
  u.onerror = (e) => report?.({ ...info, phase: "error", error: e?.error || "unknown" });
  synth.speak(u); // right here, inside the tap — iOS's rule
  setTimeout(() => { if (!started) report?.({ ...info, phase: "never", speaking: synth.speaking, pending: synth.pending, paused: synth.paused }); }, 4000);
  return true;
}

// ── The wake word: "Hey We-Draft" (user, 2026-11-25) ──
// How it's heard: "hey we draft", "hey wedraft", "hey we-draft", "hey wee
// draft", "okay we draft"… — the browser's transcript, lowercased. Not "a
// draft" or "the draft": a greeting word has to come first.
export const WAKE = /\b(?:hey|hay|hi|okay|ok|yo)[\s,.-]+(?:we|wee|wii|whee|we've|weed|wheat)?[\s-]*(?:draft|drafts|draught|raft)(?:\s*dot\s*com)?\b[\s,.!?-]*/i;
/** The words after the wake word in a transcript, "" when it's just the wake word, null when it isn't there. */
export function afterWake(text) {
  const m = String(text || "").match(WAKE);
  return m ? String(text).slice(m.index + m[0].length).trim() : null;
}

/**
 * Always listening for "Hey We-Draft" (Chrome on a computer / Android keeps
 * the mic open; Safari on the iPad doesn't — error "not-allowed" or the
 * recognizer never restarting → on.unsupported()).
 *   "Hey We-Draft, how's Kromah playing?" → on.question(the rest)
 *   "Hey We-Draft" … (a pause) … "how's Kromah playing?" → on.wake(), then on.question(next thing said within 8 s)
 * paused() → true while the page is talking / busy: what's heard then is ignored
 * (it would hear itself). on: { wake(), question(text), heard(text), unsupported(reason), state(s) }
 * → { stop(), wake() } — wake(): open the 8-second window now (the logo was tapped).
 */
export function wakeListen(on, paused = () => false) {
  const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SR) { on.unsupported?.("no-speech-recognition"); return { stop() {}, wake() {} }; }
  let stopped = false;
  let rec = null;
  let awakeUntil = 0;
  let fails = 0;
  let startedAt = 0;
  // Starts in the last minute with nothing heard: Safari ends it every few
  // seconds (the on-off clicking) — that's "won't stay on", not a hiccup.
  let starts = [];
  let heardAny = false;
  const WINDOW = 8000;
  const openWindow = () => { awakeUntil = Date.now() + WINDOW; on.wake?.(); };
  const start = () => {
    if (stopped) return;
    rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      heardAny = true;
      if (paused()) return;
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const text = e.results[i][0].transcript.trim();
        const final = e.results[i].isFinal;
        const rest = afterWake(text);
        if (Date.now() < awakeUntil) {
          // Awake: this is the question (minus a repeated wake word).
          on.heard?.(rest ?? text);
          if (final && (rest ?? text)) { awakeUntil = 0; on.question?.(rest ?? text); }
        } else if (rest != null) {
          if (final && rest.split(" ").length >= 2) on.question?.(rest);
          else if (final || !rest) { if (Date.now() >= awakeUntil) openWindow(); }
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { stopped = true; on.unsupported?.(e.error); }
    };
    rec.onend = () => {
      if (stopped) return;
      // Ended right after starting, over and over: this browser won't keep it open.
      fails = Date.now() - startedAt < 1500 ? fails + 1 : 0;
      starts = starts.filter((t) => Date.now() - t < 60000);
      if (fails >= 5 || (starts.length >= 6 && !heardAny)) { stopped = true; on.unsupported?.("keeps-stopping"); return; }
      setTimeout(start, fails ? 500 * fails : 250);
    };
    startedAt = Date.now();
    starts.push(startedAt);
    try { rec.start(); on.state?.("standby"); } catch (err) { if (!stopped) setTimeout(start, 1000); }
  };
  start();
  return {
    stop() { stopped = true; try { rec?.abort(); } catch { /* stopped */ } },
    wake() { openWindow(); },
  };
}
