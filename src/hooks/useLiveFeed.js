// src/hooks/useLiveFeed.js
//
// Data hooks for /live's My Feed.
//
//   useLiveGameDocs(ids)  — real-time liveGames/{id} docs for a handful of
//                           games (each carries its full `feedPlays` list).
//                           One listener per game, capped at MAX_GAMES.
//   useRankedSixIds(uid, weeks) — schedule26 ids of the user's official
//                           We-Pick Ranked 6 (wePickSubmissions/{week}/
//                           entries/{uid}.gameIds) for the given weeks.
//   useGamePlays(ids)     — the most recent plays of a few games, live (the
//                           Feed's "every play" modes).
//   useCfbdSchools(on)    — every school linked to a CFBD team, for the
//                           follow-a-team search (loaded once, when on).
//   searchCfbdPlayers(q)  — name search over cfbdPlayers, for following.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";

const MAX_GAMES = 20;

export function useLiveGameDocs(ids) {
  const key = [...new Set(ids)].sort().slice(0, MAX_GAMES).join(",");
  const [byId, setById] = useState(() => new Map());
  useEffect(() => {
    const list = key ? key.split(",") : [];
    setById(new Map());
    const unsubs = list.map((id) => onSnapshot(
      doc(db, "liveGames", id),
      (s) => setById((prev) => {
        const next = new Map(prev);
        if (s.exists()) next.set(id, { id, ...s.data() }); else next.delete(id);
        return next;
      }),
      () => {},
    ));
    return () => unsubs.forEach((u) => u());
  }, [key]);
  return byId;
}

const MAX_EVERY_GAMES = 8;
const EVERY_PLAYS_PER_GAME = 50;

export function useGamePlays(ids) {
  const key = [...new Set(ids)].slice(0, MAX_EVERY_GAMES).sort().join(",");
  const [byId, setById] = useState(() => new Map());
  useEffect(() => {
    const list = key ? key.split(",") : [];
    setById(new Map());
    const unsubs = list.map((id) => onSnapshot(
      query(collection(db, "liveGames", id, "plays"), orderBy("seq", "desc"), limit(EVERY_PLAYS_PER_GAME)),
      (s) => setById((prev) => new Map(prev).set(id, s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      () => {},
    ));
    return () => unsubs.forEach((u) => u());
  }, [key]);
  return byId;
}

let schoolsCache = null;
export function useCfbdSchools(on) {
  const [schools, setSchools] = useState(schoolsCache || []);
  useEffect(() => {
    if (!on || schoolsCache) return undefined;
    let alive = true;
    getDocs(query(collection(db, "schools"), where("CFBDTeamId", "!=", null))).then((s) => {
      schoolsCache = s.docs.map((d) => {
        const x = d.data();
        return {
          id: x.CFBDTeamId, name: x.School || d.id, short: x.Short || "", mascot: x.Mascot || "",
          conference: x.Conference || "", logo: x.LogoDark || x.Logo1 || x.Logo2 || null, alt: x.CFBDName || "",
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
      if (alive) setSchools(schoolsCache);
    }).catch(() => {});
    return () => { alive = false; };
  }, [on]);
  return schools;
}

// "julian say" → players whose full name starts with "Julian Say"; a single
// word also matches last names ("sayin" → Julian Sayin). Name fields are
// stored capitalized, so the query is capitalized word by word.
export async function searchCfbdPlayers(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length || text.trim().length < 2) return [];
  const cap = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const prefix = (field, v) => query(collection(db, "cfbdPlayers"), where(field, ">=", v), where(field, "<=", `${v}\uf8ff`), limit(12));
  const qs = [prefix("name", cap)];
  if (words.length === 1) qs.push(prefix("lastName", cap));
  else qs.push(prefix("lastName", words.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")));
  const snaps = await Promise.all(qs.map((q) => getDocs(q).catch(() => null)));
  const byId = new Map();
  const first = words.length > 1 ? words[0].toLowerCase() : null;
  for (const s of snaps) {
    s?.docs.forEach((d) => {
      const x = d.data();
      if (first && !(x.name || "").toLowerCase().startsWith(first)) return;
      byId.set(d.id, {
        id: d.id, name: x.name, team: x.team || null, teamId: x.teamId ?? null,
        position: x.position || null, jersey: x.jersey ?? null, season: x.rosterSeason || x.lastSeason || 0,
      });
    });
  }
  return [...byId.values()].sort((a, b) => b.season - a.season || a.name.localeCompare(b.name)).slice(0, 12);
}

export function useRankedSixIds(uid, weeks) {
  const weekKey = [...new Set(weeks.filter(Boolean))].sort().join("|");
  const [byWeek, setByWeek] = useState({});
  useEffect(() => {
    setByWeek({});
    if (!uid || !weekKey) return undefined;
    const unsubs = weekKey.split("|").map((week) => onSnapshot(
      doc(db, "wePickSubmissions", week, "entries", uid),
      (s) => setByWeek((prev) => ({ ...prev, [week]: s.exists() ? s.data().gameIds || [] : [] })),
      () => {},
    ));
    return () => unsubs.forEach((u) => u());
  }, [uid, weekKey]);
  return useMemo(() => new Set(Object.values(byWeek).flat()), [byWeek]);
}
