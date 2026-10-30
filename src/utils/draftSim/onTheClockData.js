// src/utils/draftSim/onTheClockData.js
//
// On the Clock's Firestore side (the script and timeline: onTheClock.js).
//   simShows/{id}        one show's script — public read, admin write
//   config/onTheClock    the admin's schedule: { enabled, startTime "21:00"
//                        (ET), nights: { [weekday 0–6]: { format, rounds } } }
// generateShow() runs the draft in this browser, from the same data the
// site's Draft Sim loads (data.js), so the desk sounds exactly like it.
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, setDoc, onSnapshot, collection, query, orderBy, limit, where } from "firebase/firestore";
import { db } from "../../firebase";
import { loadSimData, loadBestGame, maxRounds } from "./data";
import { buildShowScript, showTimeline, SHOW_FORMATS, DEFAULT_FORMAT, PRESHOW_MS, showEndsAt, showIdFor } from "./onTheClock";

export const CONFIG_REF = () => doc(db, "config", "onTheClock");
export const DEFAULT_CONFIG = { enabled: false, startTime: "21:00", nights: {} };

export async function loadConfig() {
  const snap = await getDoc(CONFIG_REF());
  return { ...DEFAULT_CONFIG, ...(snap.exists() ? snap.data() : {}) };
}
export const saveConfig = (cfg) => setDoc(CONFIG_REF(), cfg, { merge: true });

// "21:00" ET on the Eastern date of `dayMs` → ms.
export function easternTime(dayMs, hhmm) {
  const [h, m] = String(hhmm || "21:00").split(":").map(Number);
  const id = showIdFor(dayMs);
  // Try both offsets (EDT −4, EST −5); keep the one that reads back as hh:mm ET.
  for (const off of [4, 5]) {
    const ms = Date.parse(`${id}T${String(h).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}:00Z`) + off * 3600000;
    const back = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
    if (back === `${String(h).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`) return ms;
  }
  return Date.parse(`${id}T00:00:00Z`) + (h + 5) * 3600000 + (m || 0) * 60000;
}

// The night's format for a weekday (0 = Sunday) from the config.
export function nightFormat(cfg, weekday) {
  const n = cfg?.nights?.[weekday] || cfg?.nights?.[String(weekday)];
  return { format: SHOW_FORMATS[n?.format] ? n.format : DEFAULT_FORMAT, rounds: n?.rounds || null, off: !!n?.off };
}

// Runs a whole show's draft → its script (not saved).
export async function generateShow({ formatKey = DEFAULT_FORMAT, rounds, seed, startAt, id }) {
  const format = SHOW_FORMATS[formatKey] || SHOW_FORMATS[DEFAULT_FORMAT];
  const data = await loadSimData(format.year);
  const cap = maxRounds(data.board);
  return buildShowScript({
    data, formatKey, rounds: Math.min(rounds || format.rounds, cap), seed, startAt, id,
    bestGame: (pid, season) => loadBestGame(pid, season),
  });
}

export const saveShow = (script) => setDoc(doc(db, "simShows", script.id), script);

// One show, live.
export function useShow(id) {
  const [state, setState] = useState({ script: null, loading: !!id, error: null });
  useEffect(() => {
    if (!id) return undefined;
    setState({ script: null, loading: true, error: null });
    return onSnapshot(doc(db, "simShows", id),
      (s) => setState({ script: s.exists() ? s.data() : null, loading: false, error: null }),
      (e) => setState({ script: null, loading: false, error: e.message }));
  }, [id]);
  return state;
}

// The show that's on (or up next): the latest few by start time, and the
// first whose window (pre-show → end) holds now, else the next to start.
export function useCurrentShow(now) {
  const [rows, setRows] = useState(null);
  useEffect(() => onSnapshot(
    query(collection(db, "simShows"), where("startAt", ">=", Date.now() - 6 * 3600000), orderBy("startAt", "asc"), limit(5)),
    (s) => setRows(s.docs.map((d) => d.data())),
    () => setRows([]),
  ), []);
  const pick = useMemo(() => {
    if (!rows) return undefined;
    const on = rows.find((r) => now >= r.startAt - PRESHOW_MS && now < showEndsAt(r, showTimeline(r)));
    return on || rows.find((r) => r.startAt > now) || null;
  }, [rows, now]);
  return pick;
}

// A clock that ticks every `ms`.
export function useNow(ms = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
