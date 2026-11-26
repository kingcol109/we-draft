// src/utils/voice/localWake.js
//
// The wake word, heard on this computer (user, 2026-11-26: "I need to keep it in
// the background"). Chrome's speech service ends itself every minute or so and
// gets cut off in a background tab, so the old listener faded out. This one:
//   • keeps ONE mic stream open while the wake word is on (a tab using the mic
//     isn't frozen or throttled by Chrome, so it keeps running behind other tabs
//     and windows — just not with the browser closed);
//   • runs a small speech model (Vosk, ~40 MB, /public/vosk, loaded once and
//     cached) in a worker on that stream — nothing leaves the computer until the
//     wake word is heard;
//   • after the wake word, takes the question with Chrome's speech service (best
//     with player names); when that can't start or hears nothing (a background
//     tab), the local model's own transcript of the question is used instead.
// Same interface as speech.js wakeListen(): on { wake(), question(text),
// heard(text), unsupported(reason), state(s) }, paused() → { stop(), wake() }.

import { afterWake, listen } from "./speech";

export const MODEL_URL = "/vosk/vosk-model-small-en-us-0.15.tar.gz";
const WINDOW_MS = 8000; // after the wake word, this long to start the question
// The wake phrase as the model may hear it (its grammar — everything else is "[unk]").
// "Hey We-Draft" (the film editor's "Hey Film Manager" is separate — user, 2026-11-26).
const WAKE_PHRASES = ["hey we draft", "okay we draft", "hi we draft"];
// How sure the model has to be of each wake word (0–1). Below this it's ignored
// (a TV, a sentence that happens to rhyme).
const MIN_CONF = 0.55;

export const canWakeLocally = () => typeof window !== "undefined"
  && !!(window.AudioContext || window.webkitAudioContext)
  && typeof window.AudioWorkletNode === "function"
  && !!navigator.mediaDevices?.getUserMedia
  && typeof Worker === "function" && typeof WebAssembly === "object";

let modelPromise = null;
/** The Vosk model, loaded once per page (the worker fetches it — the browser caches the file). */
export function loadWakeModel() {
  if (!modelPromise) {
    modelPromise = import("vosk-browser")
      .then(({ createModel }) => createModel(new URL(MODEL_URL, window.location.origin).href, -1))
      .catch((e) => { modelPromise = null; throw e; });
  }
  return modelPromise;
}

// Collects the mic's audio into ~85 ms chunks and posts them to the page (a worklet
// keeps running in a background tab; the old ScriptProcessor is main-thread and deprecated).
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i += 1) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(4096); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor("wd-wake-tap", Tap);
`;

/** True when a grammar result has the wake phrase in it — the model wraps it in
 * "[unk]" for the words around it ("[unk] hey we draft [unk]"). Words it's
 * unsure of (conf below MIN_CONF, when given) don't count. Exported for tests. */
export function isWakeResult(result) {
  const words = Array.isArray(result?.result) && result.result.length
    ? result.result.filter((w) => (w.conf ?? 1) >= MIN_CONF).map((w) => w.word)
    : String(result?.text ?? result?.partial ?? "").split(/\s+/);
  const said = ` ${words.filter((w) => w && w !== "[unk]").join(" ").toLowerCase()} `;
  return WAKE_PHRASES.some((p) => said.includes(` ${p} `));
}

// How the free model may spell the wake phrase without the greeting ("we draft", "wee drafts").
const LOOSE_WAKE = /^(?:.*?\b)?(?:we|wee|weed)\s*(?:draft|drafts|drafted|raft)\b[\s,.!?-]*/i;
/** What the local model heard after the wake word, in the transcript of the window. Exported for tests. */
export function questionFrom(transcript) {
  const t = String(transcript || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const rest = afterWake(t);
  if (rest != null) return rest;
  return LOOSE_WAKE.test(t) ? t.replace(LOOSE_WAKE, "").trim() : t;
}

/**
 * Always listening for the wake word, on this computer. See the file header.
 * on.state(s): "loading" (first time: downloading the model) → "standby" (listening)
 * | "needs-tap" (Chrome wants a click on the page before audio can start) | "mic-lost".
 */
export function localWakeListen(on, paused = () => false) {
  let stopped = false;
  let ctx = null;
  let stream = null;
  let node = null;
  let wakeRec = null;
  let textRec = null;
  let windowUntil = 0;
  let windowText = []; // the local model's finals since the wake word
  let partialText = "";
  let stopChrome = null;
  let chromeGotIt = false;
  let chromeHeard = false; // Chrome has heard words this window (not hung / cut off)
  let fallbackTimer = null;
  let resumeOnGesture = null;
  let askedAt = 0; // just asked: the other recognizer's copy of the same words is ignored

  const inWindow = () => Date.now() < windowUntil;
  const closeWindow = () => {
    windowUntil = 0; windowText = []; partialText = "";
    clearTimeout(fallbackTimer); fallbackTimer = null;
    if (stopChrome) { const s = stopChrome; stopChrome = null; try { s({ discard: true }); } catch { /* stopped */ } }
  };
  const ask = (text) => {
    const q = String(text || "").trim();
    closeWindow();
    if (q) { askedAt = Date.now(); on.question?.(q); }
  };
  // No question from Chrome: the local model's transcript, if it has one —
  // finished sentences only, unless the window is closing (then what's half-said).
  const fallBackToLocal = (orPartial = false) => {
    if (stopped || chromeGotIt || !windowUntil) return;
    const q = questionFrom([...windowText, orPartial ? partialText : ""].filter(Boolean).join(" "));
    if (q && q.split(" ").length >= 2) ask(q);
  };

  const openWindow = (spokenRest = "", tapped = false) => {
    if (stopped || (!tapped && Date.now() - askedAt < 2000)) return;
    closeWindow();
    windowUntil = Date.now() + WINDOW_MS;
    chromeGotIt = false;
    chromeHeard = false;
    if (spokenRest) windowText.push(spokenRest);
    on.wake?.();
    // The question: Chrome's speech service first (it knows player names).
    // Words already said with the wake word ("hey we draft, how many…") lead the question.
    const lead = spokenRest ? `${spokenRest} ` : "";
    try {
      stopChrome = listen({
        interim: (t) => { if (t) chromeHeard = true; on.heard?.(`${lead}${afterWake(t) ?? t}`.trim()); },
        final: (t) => { chromeGotIt = true; ask(`${lead}${afterWake(t) ?? t}`); },
        end: () => { stopChrome = null; if (!chromeGotIt) fallBackToLocal(true); },
        error: () => { stopChrome = null; fallBackToLocal(true); },
      // Already have the start of the question: don't wait long for more.
      }, spokenRest ? { nothingMs: 2500 } : {});
    } catch { stopChrome = null; }
    // Nothing from Chrome within the window: the local transcript. But once Chrome is hearing
    // the question, let it finish — its own quiet timer ends it (user, 2026-11-26: cut off mid-sentence).
    const check = () => {
      if (stopped || !windowUntil) return;
      if (chromeHeard && stopChrome) { fallbackTimer = setTimeout(check, 1000); return; }
      fallBackToLocal(true);
      if (windowUntil) closeWindow();
    };
    fallbackTimer = setTimeout(check, WINDOW_MS + 1500);
  };

  const start = async () => {
    if (!canWakeLocally()) { on.unsupported?.("no-local-wake"); return; }
    on.state?.("loading");
    let model;
    try { model = await loadWakeModel(); } catch (e) { if (!stopped) on.unsupported?.("model-failed"); return; }
    if (stopped) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (e) {
      if (!stopped) on.unsupported?.(e?.name === "NotAllowedError" ? "not-allowed" : "audio-capture");
      return;
    }
    if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    if (stopped) return;
    const rate = ctx.sampleRate;
    wakeRec = new model.KaldiRecognizer(rate, JSON.stringify([...WAKE_PHRASES, "[unk]"]));
    wakeRec.setWords(true);
    textRec = new model.KaldiRecognizer(rate);
    // Partial results too: awake right after "draft", not when the sentence ends.
    const onWake = (m) => {
      if (stopped || paused() || inWindow()) return;
      if (isWakeResult(m.result)) openWindow();
    };
    wakeRec.on("partialresult", onWake);
    wakeRec.on("result", onWake);
    textRec.on("partialresult", (m) => {
      if (stopped || paused()) return;
      const p = String(m.result?.partial || "");
      if (inWindow()) { partialText = p; if (!stopChrome && p) on.heard?.(questionFrom(p) || p); }
    });
    textRec.on("result", (m) => {
      if (stopped || paused()) return;
      const t = String(m.result?.text || "").trim();
      partialText = "";
      if (!t) return;
      if (inWindow()) {
        windowText.push(t);
        // Chrome isn't listening (ended / cut off in a background tab): this is the question.
        if (!stopChrome) fallBackToLocal();
        // Chrome is "listening" but hasn't heard a word (hung): a moment's grace, then this.
        else if (!chromeHeard) setTimeout(() => { if (!chromeHeard) fallBackToLocal(); }, 1200);
        return;
      }
      // Not awake yet, but the free transcript has the wake phrase (said in one
      // breath with the question, fast enough that the grammar missed it).
      if (afterWake(t) != null) {
        const rest = questionFrom(t);
        // The person may still be talking: open the window with what's been said so far, and let the rest come.
        if (Date.now() - askedAt > 2000) openWindow(rest.split(" ").length >= 2 ? rest : "");
      }
    });
    const src = ctx.createMediaStreamSource(stream);
    node = new window.AudioWorkletNode(ctx, "wd-wake-tap");
    node.port.onmessage = (e) => {
      if (stopped) return;
      const chunk = e.data;
      try { wakeRec.acceptWaveformFloat(chunk, rate); textRec.acceptWaveformFloat(chunk, rate); } catch { /* a recognizer went away */ }
    };
    // Pulled by the speakers at zero volume, so the worklet always runs.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(node); node.connect(mute); mute.connect(ctx.destination);
    // Unplugged / taken by another app → try again.
    stream.getAudioTracks().forEach((t) => {
      t.addEventListener("ended", () => { on.debug?.({ track: "ended", vis: document.visibilityState }); if (!stopped) { on.state?.("mic-lost"); teardown(); setTimeout(() => { on.debug?.({ restart: true }); start().catch((e) => on.debug?.({ restartFailed: String(e) })); }, 2000); } });
      t.addEventListener("mute", () => on.debug?.({ track: "mute", vis: document.visibilityState }));
      t.addEventListener("unmute", () => on.debug?.({ track: "unmute" }));
    });
    on.debug?.({ started: true, label: stream.getAudioTracks()[0]?.label, rate });
    await resume();
  };

  // Chrome won't run audio on a page that's never been clicked (a reload with the
  // wake word already on): wait for the first click / key, then go.
  const resume = async () => {
    if (!ctx || stopped) return;
    try { await ctx.resume(); } catch { /* needs a gesture */ }
    if (ctx.state === "running") { on.state?.("standby"); return; }
    on.state?.("needs-tap");
    if (resumeOnGesture) return;
    resumeOnGesture = () => {
      window.removeEventListener("pointerdown", resumeOnGesture, true);
      window.removeEventListener("keydown", resumeOnGesture, true);
      resumeOnGesture = null;
      ctx?.resume().then(() => { if (!stopped && ctx?.state === "running") on.state?.("standby"); }).catch(() => {});
    };
    window.addEventListener("pointerdown", resumeOnGesture, true);
    window.addEventListener("keydown", resumeOnGesture, true);
  };

  const teardown = () => {
    closeWindow();
    if (resumeOnGesture) {
      window.removeEventListener("pointerdown", resumeOnGesture, true);
      window.removeEventListener("keydown", resumeOnGesture, true);
      resumeOnGesture = null;
    }
    try { node?.port && (node.port.onmessage = null); node?.disconnect(); } catch { /* gone */ }
    try { wakeRec?.remove(); } catch { /* gone */ }
    try { textRec?.remove(); } catch { /* gone */ }
    try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* gone */ }
    try { ctx?.close(); } catch { /* gone */ }
    node = null; wakeRec = null; textRec = null; stream = null; ctx = null;
  };

  start().catch(() => { if (!stopped) on.unsupported?.("start-failed"); });
  return {
    stop() { stopped = true; teardown(); },
    wake() { openWindow("", true); },
  };
}
