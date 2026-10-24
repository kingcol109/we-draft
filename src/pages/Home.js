// src/pages/Home.js
//
// Thin router between the two actual Home page designs — HomeOffSeason.js
// (what's been live) and HomeInSeason.js (built out separately, not active
// until an admin says so). Which one renders is config/home.mode in
// Firestore, toggled in AdminPanel.js's Misc Branding tab — an instant,
// reversible switch, no code deploy needed either direction. Defaults to
// off-season if the config doc doesn't exist yet or the read fails for any
// reason, since that's the design that's actually been live.
//
// The shared hero (HomeHero.js) renders on the first paint — it never waits
// on config/home. The sections below it do, unless this browser has seen
// the mode before: the last-seen mode (localStorage) renders straight away
// and config/home just confirms it in the background, swapping designs only
// if an admin flipped it since.
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import HomeHero from "./HomeHero";
import HomeOffSeason from "./HomeOffSeason";
import HomeInSeason from "./HomeInSeason";
import HOME_MODERN_STYLE from "./homeModernStyle";

const MODE_KEY = "homeMode";

function cachedMode() {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === "inseason" || m === "offseason" ? m : null;
  } catch {
    return null;
  }
}

export default function Home() {
  // null = not yet known (first visit in this browser) — the hero still
  // shows, only the sections below wait.
  const [mode, setMode] = useState(cachedMode);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    let alive = true;
    const fetchMode = async () => {
      let next = "offseason";
      try {
        const snap = await getDoc(doc(db, "config", "home"));
        if (snap.exists() && snap.data().mode === "inseason") next = "inseason";
      } catch {
        // keep the off-season default
      }
      try { localStorage.setItem(MODE_KEY, next); } catch {}
      if (alive) setMode(next);
    };
    fetchMode();
    return () => { alive = false; };
  }, []);

  // Modern look (homeModernStyle.js) — on by default; ?modern=0 shows the
  // old look for comparison.
  const modern = typeof window === "undefined" || new URLSearchParams(window.location.search).get("modern") !== "0";

  return (
    <div className={modern ? "wdh" : undefined} style={{ width: "100%", padding: isMobile ? "10px 10px 60px" : "20px 4% 60px", fontFamily: "'Arial Black', Arial, sans-serif", boxSizing: "border-box" }}>
      {modern && <style>{HOME_MODERN_STYLE}</style>}
      <HomeHero mode={mode || "offseason"} />
      {mode === "inseason" && <HomeInSeason />}
      {mode === "offseason" && <HomeOffSeason />}
    </div>
  );
}
