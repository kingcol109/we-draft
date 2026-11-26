// src/utils/voice/speech.js
//
// /voice: the browser's own speech — listening (SpeechRecognition: Chrome
// on a PC, Safari on the iPad, both free) and talking (speechSynthesis).
// One question per listen; the page starts it from the mic button / Space.
// Hands-free (a wake word, "Hey We-Draft") is the next layer on top of this.

// When the question is over (user, 2026-11-25 and again 2026-11-26: "it stops listening way too
// fast … should be at least double", "it cuts the user off too often"). The browser's own end of
// speech (~1 s in Chrome) no longer ends the question: the mic stays open until the words have
// stopped for QUIET_MS — longer when the last word can't end a sentence ("…a better job of").
export const QUIET_MS = 2600;
const QUIET_UNFINISHED_MS = 4000;
const MAX_LISTEN_MS = 30000; // one question, at most
const NOTHING_MS = 8000; // nothing said at all: give up
// Words a question can't end on ("…a better job of", "how many rushing yards did his"). Not ones a
// question often ends with ("does he have", "where is he from", "who does he compare to").
const UNFINISHED = /\b(?:and|or|but|the|a|an|of|for|about|by|than|his|her|their|my|your|our|is|was|are|were|how|what|which|who|where|when|many|much|me|against|vs|versus|between|if|um|uh|because|some|any)$/i;
/** How long to wait after these words before taking them as the question. */
export const quietFor = (text) => {
  const t = String(text || "").trim();
  return !t || t.split(/\s+/).length <= 2 || UNFINISHED.test(t) ? QUIET_UNFINISHED_MS : QUIET_MS;
};
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
export function listen(on, opts = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { on.error?.("unsupported"); return () => {}; }
  let rec = null;
  let done = false;
  let stopped = false;
  let retry = 0;
  let heard = false;
  let t0 = 0;
  let text = ""; // everything heard so far
  const ios = isIOS();
  // iOS only lets the mic start from a tap — a retry from a timer just flickers.
  const retries = ios ? 0 : RETRIES;
  const nothingMs = opts.nothingMs || NOTHING_MS;
  let settle = null;
  let cap = null;
  let idle = null;
  const finish = (said) => {
    if (done) return;
    const q = String(said || "").trim();
    if (!q) return;
    done = true;
    clearTimeout(settle); clearTimeout(cap); clearTimeout(idle);
    // Let go of the mic first — iOS keeps the audio set up for recording
    // (answers play quietly or not at all) until recognition has stopped.
    try { rec.abort(); } catch { /* stopped */ }
    on.final?.(q);
  };
  const begin = () => {
    rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    // Continuous: a pause mid-question doesn't end it — the quiet timer does. Safari on the
    // iPad keeps its own one-shot mode (its continuous mode is unreliable); its pause is longer.
    rec.continuous = !ios;
    rec.maxAlternatives = 1;
    t0 = Date.now();
    rec.onstart = () => on.report?.({ phase: "start", retry, ms: 0 });
    rec.onresult = onResult;
    rec.onerror = (e) => {
      if (done && e.error === "aborted") return; // our own stop after the question was heard
      on.report?.({ phase: "error", error: e.error, retry, ms: Date.now() - t0, heard });
      // A cut-off ("aborted" / "no-speech" right away) gets retried in onend; the rest are real.
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") { stopped = true; on.error?.(e.error); }
    };
    rec.onend = () => {
      if (done || stopped) { on.end?.(); return; }
      // The browser ended it with words heard (Safari's own end of speech, a network blip): that's the question.
      if (text.trim()) { finish(text); on.end?.(); return; }
      const ms = Date.now() - t0;
      if (!heard && ms < CUT_OFF_MS && retry < retries) {
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
  function onResult(e) {
    let all = "";
    for (let i = 0; i < e.results.length; i += 1) all += `${e.results[i][0].transcript} `;
    text = all.replace(/\s+/g, " ").trim();
    if (!text) return;
    if (!heard) { heard = true; clearTimeout(idle); cap = setTimeout(() => finish(text), MAX_LISTEN_MS); }
    on.interim?.(text);
    // Done when the words stop for a while — not at the browser's first short pause.
    clearTimeout(settle);
    settle = setTimeout(() => finish(text), quietFor(text) * (opts.slower || 1));
  }
  begin();
  // Nothing said at all: stop (Chrome's continuous mode would otherwise wait a long time).
  idle = setTimeout(() => { if (!heard && !done && !stopped) { stopped = true; try { rec?.stop(); } catch { /* stopped */ } } }, nothingMs);
  // stop(): the person tapped to stop — take what was heard so far. stop({ discard: true }): drop it.
  return (o = {}) => {
    if (!o.discard && !done && text.trim()) { finish(text); return; }
    done = done || !!o.discard;
    stopped = true; clearTimeout(settle); clearTimeout(cap); clearTimeout(idle);
    try { rec?.stop(); } catch { /* already stopped */ }
  };
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
  return (want && (vs.find((v) => v.voiceURI === want) || vs.find((v) => v.name === want))) || vs.find((v) => /^en[-_]US$/i.test(v.lang) && v.localService) || vs.find((v) => /^en[-_]US$/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
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

// iOS gives a downloaded Premium / Enhanced voice the SAME name as the basic one
// ("Ava" twice) — only voiceURI (com.apple.voice.premium.en-US.Ava) tells them apart.
const voiceQuality = (v) => (/premium/i.test(v.voiceURI || "") || /premium/i.test(v.name) ? "Premium"
  : /enhanced/i.test(v.voiceURI || "") || /enhanced/i.test(v.name) ? "Enhanced" : "");

/** The browser's English voices for the picker, natural-sounding first: [{ id, name, quality, lang, natural, local }]. id = voiceURI. */
export function englishVoices() {
  if (!canSpeak()) return Promise.resolve([]);
  return voiceReady().then(() => listEnglish());
}
function listEnglish() {
  const seen = new Set();
  return (window.speechSynthesis.getVoices() || [])
    .filter((v) => /^en/i.test(v.lang))
    .map((v) => {
      const quality = voiceQuality(v);
      return { id: v.voiceURI || v.name, name: v.name, quality, lang: v.lang, natural: !!quality || NATURAL.test(v.name), local: !!v.localService };
    })
    .filter((v) => (seen.has(v.id) ? false : seen.add(v.id)))
    .sort((a, b) => (b.natural - a.natural) || (/en[-_]US/i.test(b.lang) - /en[-_]US/i.test(a.lang)) || a.name.localeCompare(b.name));
}
/** Calls back with the fresh list whenever the device's voices change (iOS loads them late). Returns an unsubscribe. */
export function onVoicesChanged(cb) {
  if (!canSpeak()) return () => {};
  const synth = window.speechSynthesis;
  const h = () => cb(listEnglish());
  synth.addEventListener?.("voiceschanged", h);
  const t = setTimeout(h, 3000); // some iOS builds never fire the event
  return () => { clearTimeout(t); synth.removeEventListener?.("voiceschanged", h); };
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

/** Chrome / Firefox / Edge on an iPad or iPhone: their mic cuts off right away (log 2026-11-25: "aborted" in ms) — only Safari listens. */
export const iosOtherBrowser = () => typeof navigator !== "undefined" && /CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
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

// ── The wake word: "Hey We-Draft" (user, 2026-11-25; confirmed 2026-11-26 —
// "Hey Film Manager" is the film editor's own, not /voice's) ──
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
  // The question builds across results; it's asked once the words stop for quietFor() —
  // not at the recognizer's first short pause (user, 2026-11-26: cut off mid-sentence).
  let q = { done: "", now: "", timer: null };
  const resetQ = () => { clearTimeout(q.timer); q = { done: "", now: "", timer: null }; };
  const askNow = () => {
    const text = `${q.done} ${q.now}`.replace(/\s+/g, " ").trim();
    resetQ();
    awakeUntil = 0;
    if (text) on.question?.(text);
  };
  const heardQ = (piece, final) => {
    if (final) { q.done = `${q.done} ${piece}`; q.now = ""; } else q.now = piece;
    const text = `${q.done} ${q.now}`.replace(/\s+/g, " ").trim();
    on.heard?.(text);
    awakeUntil = Math.max(awakeUntil, Date.now() + 1000); // still talking: keep the window open
    clearTimeout(q.timer);
    if (text) q.timer = setTimeout(askNow, quietFor(text));
  };
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
        if (Date.now() < awakeUntil || q.timer) {
          // Awake: this is (more of) the question, minus a repeated wake word.
          if (rest ?? text) heardQ(rest ?? text, final);
        } else if (rest != null) {
          // "Hey We-Draft, how many…" in one breath: the question has started — keep listening for the rest.
          openWindow();
          if (rest) heardQ(rest, final);
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
    stop() { stopped = true; resetQ(); try { rec?.abort(); } catch { /* stopped */ } },
    wake() { openWindow(); },
  };
}
