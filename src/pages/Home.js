// src/pages/Home.js
//
// Thin router between the two actual Home page designs — HomeOffSeason.js
// (what's been live) and HomeInSeason.js (built out separately, not active
// until an admin says so). Which one renders is config/home.mode in
// Firestore, toggled in AdminPanel.js's Misc Branding tab — an instant,
// reversible switch, no code deploy needed either direction. Defaults to
// off-season if the config doc doesn't exist yet or the read fails for any
// reason, since that's the design that's actually been live.
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import HomeOffSeason from "./HomeOffSeason";
import HomeInSeason from "./HomeInSeason";

export default function Home() {
  // null = not yet resolved. Rendering nothing for that brief instant
  // (rather than picking a default and possibly flashing the wrong design)
  // is a fine tradeoff here — this is a single-doc read that resolves in a
  // beat, not something worth a loading skeleton over.
  const [mode, setMode] = useState(null);

  useEffect(() => {
    let alive = true;
    const fetchMode = async () => {
      try {
        const snap = await getDoc(doc(db, "config", "home"));
        const next = snap.exists() && snap.data().mode === "inseason" ? "inseason" : "offseason";
        if (alive) setMode(next);
      } catch (e) {
        if (alive) setMode("offseason");
      }
    };
    fetchMode();
    return () => { alive = false; };
  }, []);

  if (mode === null) return null;
  return mode === "inseason" ? <HomeInSeason /> : <HomeOffSeason />;
}
