// src/broadcast/useBroadcastShell.js
//
// What every broadcast page (/broadcast/:slug, /broadcast/national) needs
// around its 1920×1080 frame: the bare page shell, the fonts, the fit to
// the window, and the capture worker's ready/phase report on <html> and
// window.__BROADCAST__ (see pages/BroadcastPage.js for the contract).
import { useEffect, useLayoutEffect, useState } from "react";
import { BROADCAST_FONTS } from "./broadcastStyle";
import { BROADCAST_W, BROADCAST_H } from "../utils/broadcast";
import { suspendPageZoom } from "../utils/pageZoom";

// The page itself: no site padding, no scrollbars, no page zoom, the
// broadcast's fonts — all put back when leaving.
export function usePageShell(stream) {
  useLayoutEffect(() => {
    const restoreZoom = suspendPageZoom();
    const b = document.body.style;
    const h = document.documentElement.style;
    const prev = { bp: b.paddingTop, bm: b.margin, bo: b.overflow, bbg: b.background, bc: b.cursor, ho: h.overflow, hbg: h.background };
    b.paddingTop = "0"; b.margin = "0"; b.overflow = "hidden"; b.background = "#000";
    h.overflow = "hidden"; h.background = "#000";
    if (stream) b.cursor = "none";
    let link = document.querySelector("link[data-bc-fonts]");
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = BROADCAST_FONTS;
      link.setAttribute("data-bc-fonts", "");
      document.head.appendChild(link);
    }
    return () => {
      Object.assign(b, { paddingTop: prev.bp, margin: prev.bm, overflow: prev.bo, background: prev.bbg, cursor: prev.bc });
      Object.assign(h, { overflow: prev.ho, background: prev.hbg });
      restoreZoom();
    };
  }, [stream]);
}

// Fonts loaded (or given up on after 8s — never block the stream on them).
export function useFontsReady() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => alive && setOk(true), 8000);
    Promise.all([
      document.fonts?.load?.('400 100px "Bebas Neue"'),
      document.fonts?.load?.('700 40px "Barlow Condensed"'),
      document.fonts?.load?.('800 40px "Barlow Condensed"'),
    ].filter(Boolean)).then(() => document.fonts?.ready).finally(() => { if (alive) { clearTimeout(t); setOk(true); } });
    return () => { alive = false; clearTimeout(t); };
  }, []);
  return ok;
}

// The frame's scale and offset: fit the window, centered. At exactly
// 1920×1080 (the capture size) that's 1 and 0,0 — no resampling.
export function useFit() {
  const calc = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const k = Math.min(w / BROADCAST_W, h / BROADCAST_H);
    return { k, x: Math.round((w - BROADCAST_W * k) / 2), y: Math.round((h - BROADCAST_H * k) / 2) };
  };
  const [fit, setFit] = useState(calc);
  useEffect(() => {
    const on = () => setFit(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return fit;
}

export const stageTransform = (fit) => (fit.k === 1 && !fit.x && !fit.y ? "none" : `translate(${fit.x}px, ${fit.y}px) scale(${fit.k})`);

// The capture worker's view of the page: data-broadcast-* on <html> and
// window.__BROADCAST__ ({ ready, phase, stale, gameId }).
export function useCaptureReport({ ready, phase, stale, gameId }) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.broadcastReady = ready ? "1" : "0";
    root.dataset.broadcastPhase = phase;
    root.dataset.broadcastStale = stale ? "1" : "0";
    window.__BROADCAST__ = { ready, phase, stale, gameId };
  }, [ready, phase, stale, gameId]);
  useEffect(() => () => {
    const root = document.documentElement;
    delete root.dataset.broadcastReady;
    delete root.dataset.broadcastPhase;
    delete root.dataset.broadcastStale;
    delete window.__BROADCAST__;
  }, []);
}
