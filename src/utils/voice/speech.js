// src/utils/voice/speech.js
//
// /voice: the browser's own speech — listening (SpeechRecognition: Chrome
// on a PC, Safari on the iPad, both free) and talking (speechSynthesis).
// One question per listen; the page starts it from the mic button / Space.
// Hands-free (a wake word, "Hey We-Draft") is the next layer on top of this.

export const canListen = () => typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

/**
 * Listen for one question.
 * on: { interim(text), final(text), end(), error(code) } → stop()
 */
export function listen(on) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { on.error?.("unsupported"); return () => {}; }
  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let done = false;
  rec.onresult = (e) => {
    let text = "";
    let final = false;
    for (let i = 0; i < e.results.length; i += 1) { text += e.results[i][0].transcript; if (e.results[i].isFinal) final = true; }
    if (final && !done) { done = true; on.final?.(text.trim()); } else if (!final) on.interim?.(text.trim());
  };
  rec.onerror = (e) => on.error?.(e.error);
  rec.onend = () => on.end?.();
  try { rec.start(); } catch (e) { on.error?.(e.message); }
  return () => { try { rec.stop(); } catch { /* already stopped */ } };
}

/**
 * Say it. Cancels anything still being said.
 * on: { start(), end(), word() } — the page's logo pulses while it talks,
 * a beat on each word (word() isn't fired by every voice; start / end are).
 */
export function speak(text, on = {}) {
  if (!canSpeak() || !text) { on.end?.(); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 1.05;
  u.onstart = () => on.start?.();
  u.onend = () => on.end?.();
  u.onerror = () => on.end?.();
  u.onboundary = (e) => { if (e.name === "word" || e.name == null) on.word?.(); };
  window.speechSynthesis.speak(u);
}
export const hush = () => { if (canSpeak()) window.speechSynthesis.cancel(); };

// iOS won't speak until a first utterance comes from a tap: say nothing, once, on the first tap.
let unlocked = false;
export function unlockSpeech() {
  if (unlocked || !canSpeak()) return;
  unlocked = true;
  try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; window.speechSynthesis.speak(u); } catch { /* fine */ }
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
      if (fails >= 5) { stopped = true; on.unsupported?.("keeps-stopping"); return; }
      setTimeout(start, fails ? 500 * fails : 250);
    };
    startedAt = Date.now();
    try { rec.start(); on.state?.("standby"); } catch (err) { if (!stopped) setTimeout(start, 1000); }
  };
  start();
  return {
    stop() { stopped = true; try { rec?.abort(); } catch { /* stopped */ } },
    wake() { openWindow(); },
  };
}
