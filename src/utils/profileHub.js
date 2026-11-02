// src/utils/profileHub.js
//
// What the profile hub's Feed and Following tabs (components/profileHub/)
// read about the things a user follows:
//   players  users/{uid}/follows/{playerId} (the player page's Follow)
//   college  users/{uid}/liveSettings/main.teams — CFBD team ids, which are
//            ESPN's (the CFB team page's Follow and /live)
//   NFL      users/{uid}/liveSettings/nfl.teams — abbreviations (utils/nflFollows.js)
// and, for each, ESPN's public site API in the browser (CORS-open): a
// player's team and season line, a team's record and next game. Each
// response is cached for the visit.
import { collection, doc, documentId, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { fetchEspnSeason } from "../components/PlayerStatsCard";
import { loadNflFollows } from "./nflFollows";
import { ESPN_TEAM_IDS } from "./nflRoster";

// site.web.api — site.api.espn.com fails CORS in the browser.
const SITE = "https://site.web.api.espn.com/apis/site/v2/sports/football";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/football/college-football/athletes";

const cache = new Map();
const getJson = (url) => {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return cache.get(url);
};

// ids → chunks of 30 for documentId() "in" queries.
const chunks = (ids, n = 30) => {
  const out = [];
  for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n));
  return out;
};

// Everything the user follows: { players: [follow doc], college: [teamId], nfl: [abbr] }.
export async function loadFollowing(uid) {
  const [players, live, nfl] = await Promise.all([
    getDocs(collection(db, "users", uid, "follows")).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))).catch(() => []),
    getDoc(doc(db, "users", uid, "liveSettings", "main")).then((s) => (s.exists() ? s.data().teams || [] : [])).catch(() => []),
    loadNflFollows(uid).catch(() => []),
  ]);
  players.sort((a, b) => (b.followedAt?.toMillis?.() || 0) - (a.followedAt?.toMillis?.() || 0));
  return { players, college: live.map(String), nfl };
}

// { [playerId]: { espnId, headshot } } from playerPhotos.
export async function loadPhotos(ids) {
  const out = {};
  await Promise.all(chunks(ids).map(async (c) => {
    const snap = await getDocs(query(collection(db, "playerPhotos"), where(documentId(), "in", c))).catch(() => null);
    snap?.docs.forEach((d) => { const h = d.data().headshot; if (h) out[d.id] = { espnId: h.espnId ? String(h.espnId) : "", headshot: h.url || "" }; });
  }));
  return out;
}

// { [cfbdTeamId]: { slug, school } } from schools (CFBDTeamId) — the team
// page's URL and the school name articles are tagged with.
export async function loadSchoolsById(ids) {
  const out = {};
  const nums = ids.map(Number).filter(Number.isFinite);
  await Promise.all(chunks(nums).map(async (c) => {
    const snap = await getDocs(query(collection(db, "schools"), where("CFBDTeamId", "in", c))).catch(() => null);
    snap?.docs.forEach((d) => { const x = d.data(); out[String(x.CFBDTeamId)] = { slug: x.Slug || "", school: x.School || d.id }; });
  }));
  return out;
}

// A team's record, colors, logo and next (or live) game from its ESPN
// schedule. league: "college-football" | "nfl".
export async function teamSnapshot(league, espnTeamId) {
  const j = await getJson(`${SITE}/${league}/teams/${espnTeamId}/schedule`);
  if (!j?.team) return null;
  const t = j.team;
  const events = j.events || [];
  const live = events.find((e) => e.competitions?.[0]?.status?.type?.state === "in");
  const next = live || events.find((e) => !e.competitions?.[0]?.status?.type?.completed);
  const last = [...events].reverse().find((e) => e.competitions?.[0]?.status?.type?.completed);
  const side = (e) => {
    const c = e?.competitions?.[0];
    if (!c) return null;
    const me = c.competitors.find((x) => String(x.team.id) === String(espnTeamId));
    const opp = c.competitors.find((x) => String(x.team.id) !== String(espnTeamId));
    return {
      date: e.date, at: me?.homeAway === "away" ? "@" : "vs", opp: opp?.team?.shortDisplayName || opp?.team?.abbreviation || "",
      oppLogo: opp?.team?.logos?.[0]?.href || "", oppRank: opp?.curatedRank?.current && opp.curatedRank.current < 99 ? opp.curatedRank.current : null,
      myScore: me?.score?.displayValue ?? null, oppScore: opp?.score?.displayValue ?? null, status: c.status?.type?.shortDetail || "",
    };
  };
  return {
    id: String(espnTeamId), name: t.location || t.shortDisplayName || t.displayName, nick: t.name, abbr: t.abbreviation,
    color: t.color ? `#${t.color}` : "#0055a5", alt: t.alternateColor ? `#${t.alternateColor}` : "#f6a21d",
    logo: t.logo || t.logos?.[0]?.href || "", record: t.recordSummary || "", standing: t.standingSummary || "",
    live: live ? side(live) : null, next: next && !live ? side(next) : null, last: last ? side(last) : null,
  };
}
export const nflTeamSnapshot = (abbr) => (ESPN_TEAM_IDS[abbr] ? teamSnapshot("nfl", ESPN_TEAM_IDS[abbr]) : Promise.resolve(null));

// A followed player's card: his ESPN team (for colors and the next game),
// his 2026 season line and his most recent game.
export async function playerSnapshot(espnId) {
  if (!espnId) return null;
  const [ath, season, log] = await Promise.all([
    getJson(`${WEB}/${espnId}`),
    fetchEspnSeason(espnId).catch(() => null),
    getJson(`${WEB}/${espnId}/gamelog`),
  ]);
  const team = ath?.athlete?.team;
  const teamSnap = team?.id ? await teamSnapshot("college-football", team.id) : null;
  // Most recent game: the log's newest event and his line in it.
  let lastGame = null;
  if (log?.events) {
    const ev = Object.values(log.events).sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate))[0];
    const row = (log.seasonTypes || []).flatMap((t) => (t.categories || []).flatMap((c) => c.events || [])).find((e) => e.eventId === ev?.id);
    if (ev && row) {
      lastGame = {
        date: ev.gameDate, at: ev.atVs, opp: ev.opponent?.abbreviation || "", oppLogo: ev.opponent?.logo || "",
        result: ev.gameResult, score: ev.score, line: (log.labels || []).map((l, i) => [l, row.stats?.[i]]),
        groups: (log.categories || []).map((c) => [c.name, c.count]),
      };
    }
  }
  return { team: teamSnap, season, lastGame, position: ath?.athlete?.position?.abbreviation || "" };
}

// A season line's headline numbers for a position (the same groups as
// PlayerStatsCard): [[label, value], ...].
export function seasonHeadline(pos, s) {
  if (!s) return [];
  const p = (pos || "").toUpperCase();
  const n = (v) => (v == null ? 0 : Math.round(Number(v) || 0)).toLocaleString();
  const pass = s.passing || {}, rush = s.rushing || {}, rec = s.receiving || {}, def = s.defensive || {}, ints = s.interceptions || {};
  if (p === "QB") return [["Pass yds", n(pass.YDS)], ["TD", n(pass.TD)], ["INT", n(pass.INT)]];
  if (p === "RB" || p === "FB") return [["Rush yds", n(rush.YDS)], ["Rush TD", n(rush.TD)], ["Rec yds", n(rec.YDS)]];
  if (p === "WR" || p === "TE") return [["Rec", n(rec.REC)], ["Yds", n(rec.YDS)], ["TD", n(rec.TD)]];
  if (["OL", "OT", "OG", "C", "IOL"].includes(p)) return [];
  if (["DB", "CB", "S", "FS", "SS"].includes(p)) return [["Tkl", n(def.TOT)], ["PBU", n(def.PD)], ["INT", n(ints.INT)]];
  return [["Tkl", n(def.TOT)], ["TFL", Number(def.TFL || 0).toLocaleString()], ["Sacks", Number(def.SACKS || 0).toLocaleString()]];
}

// A last-game line, short: "10 rec, 83 yds, 1 TD" — the nonzero headline
// stats of the categories that matter for his position.
export function lastGameLine(pos, g) {
  if (!g) return "";
  const get = (label, group) => {
    let i = 0;
    for (const [name, count] of g.groups) {
      if (name === group) {
        const at = g.line.slice(i, i + count).findIndex(([l]) => l === label);
        return at >= 0 ? g.line[i + at][1] : null;
      }
      i += count;
    }
    return null;
  };
  const p = (pos || "").toUpperCase();
  const bits = [];
  const add = (v, unit) => { if (v != null && v !== "" && Number(String(v).replace(/,/g, "")) !== 0) bits.push(`${v} ${unit}`); };
  if (p === "QB") { add(get("CMP", "passing") && `${get("CMP", "passing")}/${get("ATT", "passing")}`, "pass"); add(get("YDS", "passing"), "pass yds"); add(get("TD", "passing"), "TD"); add(get("INT", "passing"), "INT"); }
  if (p === "RB" || p === "FB" || p === "QB") { add(get("YDS", "rushing"), "rush yds"); if (p !== "QB") add(get("TD", "rushing"), "rush TD"); }
  if (p === "WR" || p === "TE" || p === "RB") { add(get("REC", "receiving"), "rec"); add(get("YDS", "receiving"), "rec yds"); add(get("TD", "receiving"), "rec TD"); }
  if (!bits.length) { add(get("TOT", "tackles") ?? get("TOT", "defensive"), "tkl"); add(get("SACK", "tackles") ?? get("SACK", "defensive"), "sacks"); add(get("INT", "interceptions"), "INT"); add(get("PD", "interceptions") ?? get("PD", "defensive"), "PBU"); }
  return bits.join(", ");
}

export const kickoff = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString(undefined, { weekday: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} ${time}`;
};
