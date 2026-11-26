// src/components/film/useSpeech.js
//
// The Film Manager's mic (Chrome's speech recognition) that keeps hearing
// (user, 2026-11-25: voice "got hard of hearing out of nowhere"). Chrome ends
// a continuous session on its own — after silence, after about a minute, on a
// network blip — and a long session gets worse at hearing. So while `on`:
//   • whenever a session ends, a new one starts (backing off if it keeps failing)
//   • every ~40s, between sentences, the session is swapped for a fresh one
// onFinal(text) gets each finished phrase; onInterim(text) the words so far.
import { useEffect, useRef, useState } from "react";

export default function useSpeech(on, { onFinal, onInterim, onBlocked } = {}) {
  const [listening, setListening] = useState(false);
  const cb = useRef({});
  cb.current = { onFinal, onInterim, onBlocked };
  useEffect(() => {
    if (!on) { setListening(false); return undefined; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { cb.current.onBlocked?.("Voice needs Chrome (its speech recognition)."); return undefined; }
    let alive = true;
    let rec = null;
    let born = 0;
    let talking = false;
    let fails = 0;
    let timer = null;
    const begin = () => {
      if (!alive) return;
      const r = new SR();
      r.lang = "en-US";
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      r.onresult = (e) => {
        fails = 0;
        let live = "";
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const x = e.results[i];
          if (x.isFinal) cb.current.onFinal?.(x[0].transcript); else live += x[0].transcript;
        }
        talking = !!live.trim();
        cb.current.onInterim?.(live);
      };
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") { alive = false; cb.current.onBlocked?.("The mic is blocked for this site — allow it in Chrome to use voice."); }
        else if (e.error !== "no-speech" && e.error !== "aborted") fails += 1;
      };
      r.onend = () => {
        if (rec !== r) return;
        rec = null;
        talking = false;
        cb.current.onInterim?.("");
        if (alive) timer = setTimeout(begin, Math.min(3000, 120 * 2 ** fails)); else setListening(false);
      };
      rec = r;
      born = performance.now();
      try { r.start(); setListening(true); } catch { rec = null; timer = setTimeout(begin, 600); }
    };
    begin();
    // A fresh session every ~40s, never mid-sentence (stop() still delivers what was said).
    const fresh = setInterval(() => { if (rec && !talking && performance.now() - born > 40000) { try { rec.stop(); } catch { /* ended */ } } }, 2000);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(fresh);
      const r = rec;
      rec = null;
      try { r?.abort(); } catch { /* stopped */ }
      setListening(false);
      cb.current.onInterim?.("");
    };
  }, [on]);
  return { listening };
}
