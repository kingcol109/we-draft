// src/utils/voice/espn.js
//
// /voice: a player's ESPN numbers — the season lines and the game logs (one
// per season, each game with its opponent's full name and ESPN's game id,
// which is also CFBD's, so it ties to Film Manager games). Fetched straight
// from ESPN's public API in the browser (free, no key), cached per session.
// The same endpoints AdminSideGraphics.jsx uses; kept here so /voice never
// loads admin code.
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../../firebase";

const ESPN = "https://site.web.api.espn.com/apis";
const CFB = `${ESPN}/common/v3/sports/football/college-football/athletes`;
const cache = {};
const once = (key, fn) => {
  if (!cache[key]) { cache[key] = fn(); cache[key].catch(() => { delete cache[key]; }); }
  return cache[key];
};
const nameKey = (n) => String(n || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");

/** A school's ESPN team id (= its CFBD id), one read per school per session. */
export function schoolTeamId(school) {
  return once(`school/${school}`, async () => {
    if (!school) return null;
    const s = await getDocs(query(collection(db, "schools"), where("School", "==", school), limit(1))).catch(() => null);
    return s?.docs?.[0]?.data()?.CFBDTeamId || null;
  });
}

/** His ESPN athlete id: the one his headshot came from, else his name on his school's ESPN roster. */
export function espnAthleteId(p) {
  return once(`id/${p.id}`, async () => {
    // A CFBD-only player ("cfbd_…") has no We-Draft.com headshot to look up.
    const photo = String(p.id).startsWith("cfbd_") ? null : await getDoc(doc(db, "playerPhotos", p.id)).then((s) => (s.exists() ? s.data() : null)).catch(() => null);
    if (photo?.headshot?.espnId) return String(photo.headshot.espnId);
    const teamId = await schoolTeamId(p.School);
    if (!teamId) return null;
    const r = await fetch(`${ESPN}/site/v2/sports/football/college-football/teams/${teamId}/roster`).then((x) => x.json()).catch(() => ({}));
    const all = (r.athletes || []).flatMap((g) => g.items || []);
    const full = nameKey(`${p.First} ${p.Last}`);
    const hit = all.find((a) => nameKey(a.fullName) === full) || (all.filter((a) => nameKey(a.lastName) === nameKey(p.Last)).length === 1 ? all.find((a) => nameKey(a.lastName) === nameKey(p.Last)) : null);
    return hit ? String(hit.id) : null;
  });
}

/**
 * Season lines → { years: ["2025", "2026"], seasons: { [year]: { [cat]: { [name]: number } } },
 *   career: { [cat]: { [name]: number } } }
 */
export function espnSeasons(athleteId) {
  return once(`stats/${athleteId}`, async () => {
    const j = await fetch(`${CFB}/${athleteId}/stats`).then((r) => r.json());
    const seasons = {};
    const career = {};
    (j.categories || []).forEach((c) => {
      const names = c.names || [];
      (c.statistics || []).forEach((s) => {
        const y = String(s.season?.year || "");
        if (!y) return;
        const line = (seasons[y] ||= {});
        line[c.name] = Object.fromEntries(names.map((n, i) => [n, num(s.stats?.[i])]));
      });
      career[c.name] = Object.fromEntries(names.map((n, i) => [n, num(c.totals?.[i])]));
    });
    return { years: Object.keys(seasons).sort(), seasons, career };
  });
}

/** One season's games, oldest first: [{ id, season, date, week, post, at, opp, oppAbbr, oppRank (AP, then), result, score, line: { [cat]: { [name]: number } } }] */
export function espnGames(athleteId, season) {
  return once(`log/${athleteId}/${season}`, async () => {
    const j = await fetch(`${CFB}/${athleteId}/gamelog?season=${season}`).then((r) => r.json());
    const names = j.names || [];
    const catOf = (j.categories || []).flatMap((c) => Array(c.count || 0).fill(c.name));
    const games = new Map();
    (j.seasonTypes || []).forEach((st) => (st.categories || []).filter((c) => c.type === "event").forEach((c) => (c.events || []).forEach((ge) => {
      const e = j.events?.[ge.eventId];
      if (!e || games.has(String(ge.eventId))) return;
      const line = {};
      (ge.stats || []).forEach((v, i) => { if (catOf[i] && names[i]) (line[catOf[i]] ||= {})[names[i]] = num(v); });
      games.set(String(ge.eventId), {
        id: String(ge.eventId), season: String(season), date: e.gameDate || "", week: e.week, post: /post/i.test(st.displayName || ""),
        at: e.atVs === "@" ? "@" : "vs", opp: e.opponent?.displayName || "", oppAbbr: e.opponent?.abbreviation || "",
        oppRank: Number(e.opponent?.rank) > 0 && Number(e.opponent.rank) <= 25 ? Number(e.opponent.rank) : null,
        result: e.gameResult || "", score: e.score || "", line,
      });
    })));
    return [...games.values()].sort((a, b) => a.date.localeCompare(b.date));
  });
}

/** Every game he has, the seasons given (default: all of his). */
export async function espnAllGames(athleteId, seasons) {
  const ys = seasons || (await espnSeasons(athleteId)).years;
  const logs = await Promise.all(ys.map((y) => espnGames(athleteId, y).catch(() => [])));
  return logs.flat();
}

function num(v) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
