// src/utils/draftSim/onTheClockData.js
//
// On the Clock's Firestore side (the script and timeline: onTheClock.js).
//   simShows/{id}        one show's script — public read, admin write
//   config/onTheClock    the admin's schedule: { enabled, streamTime "20:45"
//                        (the stream goes up), startTime "21:00" (Round 1
//                        Pick 1 on the clock) — both ET — nights: { [weekday 0–6]: { format, rounds } } }
//   config/onTheClockShows  the saved shows' times (saveShow), for the
//                        pages that say a show is live (OnTheClockLive.jsx)
// generateShow() runs the draft in this browser, from the same data the
// site's Draft Sim loads (data.js), so the desk sounds exactly like it.
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, getDocs, setDoc, onSnapshot, collection, query, orderBy, limit, where } from "firebase/firestore";
import { db } from "../../firebase";
import { loadSimData, loadBestGame, maxRounds } from "./data";
import { buildShowScript, showTimeline, SHOW_FORMATS, DEFAULT_FORMAT, PRESHOW_MS, showEndsAt, showIdFor, showTimes, spotlights, spotlightOf } from "./onTheClock";

export const CONFIG_REF = () => doc(db, "config", "onTheClock");
export const DEFAULT_CONFIG = { enabled: false, streamTime: "", startTime: "21:00", nights: {} };

// "21:00" → "20:45": a time of day `min` minutes earlier (for the stream's
// default, PRESHOW_MS before the first pick).
export function minutesBefore(hhmm, min) {
  const [h, m] = String(hhmm || "21:00").split(":").map(Number);
  const t = (((h * 60 + (m || 0) - min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
export const streamTimeOf = (cfg) => cfg?.streamTime || minutesBefore(cfg?.startTime, PRESHOW_MS / 60000);

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

// The spotlights' season totals: { [slug]: s } from their schools' rosters
// (cfbRosters/{CFBDTeamId}, scripts/syncCfbdRosters.js) — the schools docs
// give each school's id (30 names a query), then one roster read a school.
export async function loadSeasonLines(prospects) {
  const names = [...new Set(prospects.map((p) => p.School).filter(Boolean))];
  const ids = {};
  for (let i = 0; i < names.length; i += 30) {
    const snap = await getDocs(query(collection(db, "schools"), where("School", "in", names.slice(i, i + 30))));
    snap.docs.forEach((d) => { const x = d.data(); if (x.CFBDTeamId != null) ids[x.School] = String(x.CFBDTeamId); });
  }
  const want = new Set(prospects.map((p) => p.Slug).filter(Boolean));
  const out = {};
  await Promise.all([...new Set(Object.values(ids))].map((id) => getDoc(doc(db, "cfbRosters", id)).then((s) => {
    (s.data()?.players || []).forEach((r) => { if (r.slug && want.has(r.slug) && r.s) out[r.slug] = r.s; });
  }).catch(() => {})));
  return out;
}

// A script saved before the spotlights kept their season lines: the same
// draw (spotlights()), with each player's line read now from his school's
// roster — the script as it is until they're in, and for any other script.
export function useFilledSpotlights(script) {
  const [fill, setFill] = useState(null);
  const needs = !!script && !script.preshow?.spotlight?.length;
  const key = script ? `${script.id}:${script.generatedAt}` : "";
  useEffect(() => {
    if (!needs) return undefined;
    let live = true;
    const spots = spotlights(script);
    const players = spots.map((s) => script.players[s.pid]).filter(Boolean).map((p) => ({ School: p.sch, Slug: p.slug }));
    loadSeasonLines(players).then((lines) => {
      if (!live) return;
      const spotlight = spots.map((s) => {
        const p = script.players[s.pid] || {};
        return { pid: s.pid, ...spotlightOf({ Position: p.pos }, lines[p.slug] || null) };
      });
      setFill({ key, preshow: { season: null, spotlight } });
    }).catch(() => {});
    return () => { live = false; };
  }, [needs, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => (needs && fill?.key === key ? { ...script, preshow: fill.preshow } : script), [script, needs, fill, key]);
}

// Runs a whole show's draft → its script (not saved).
export async function generateShow({ formatKey = DEFAULT_FORMAT, rounds, seed, startAt, streamAt = null, id }) {
  const format = SHOW_FORMATS[formatKey] || SHOW_FORMATS[DEFAULT_FORMAT];
  const data = await loadSimData(format.year);
  const cap = maxRounds(data.board);
  return buildShowScript({
    data, formatKey, rounds: Math.min(rounds || format.rounds, cap), seed, startAt, streamAt, id,
    bestGame: (pid, season) => loadBestGame(pid, season),
    seasonLines: loadSeasonLines,
  });
}

// The schedule: config/onTheClockShows { shows: { [id]: { streamAt,
// startAt, endsAt, title } } }. Saving a show writes its entry beside the script, so a page
// can tell a show is on from this one small doc (useShowLive) without
// reading the scripts (each a few hundred KB).
export const SCHEDULE_REF = () => doc(db, "config", "onTheClockShows");
export async function saveShow(script) {
  await setDoc(doc(db, "simShows", script.id), script);
  const entry = { streamAt: showTimes(script).stream, startAt: script.startAt, endsAt: showEndsAt(script, showTimeline(script)), title: script.title || "" };
  await setDoc(SCHEDULE_REF(), { shows: { [script.id]: entry } }, { merge: true });
}

// Whether a show is live at `now` — from the stream going up to the end of
// the final grades' hold — by the schedule.
export function useShowLive(now) {
  const [shows, setShows] = useState(null);
  useEffect(() => onSnapshot(SCHEDULE_REF(), (s) => setShows(s.data()?.shows || {}), () => setShows({})), []);
  return useMemo(() => Object.values(shows || {}).some((e) => now >= (e.streamAt ?? e.startAt) && now < e.endsAt), [shows, now]);
}

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
// first whose window (the stream going up → end) holds now, else the next
// to start.
export function useCurrentShow(now) {
  const [rows, setRows] = useState(null);
  useEffect(() => onSnapshot(
    query(collection(db, "simShows"), where("startAt", ">=", Date.now() - 6 * 3600000), orderBy("startAt", "asc"), limit(5)),
    (s) => setRows(s.docs.map((d) => d.data())),
    () => setRows([]),
  ), []);
  const pick = useMemo(() => {
    if (!rows) return undefined;
    const on = rows.find((r) => now >= showTimes(r).stream && now < showEndsAt(r, showTimeline(r)));
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
