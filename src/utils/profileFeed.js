// src/utils/profileFeed.js
//
// The profile hub's Feed (components/profileHub/FeedTab.jsx) and its
// "new since you last looked" count (the navbar's Profile badge, the hub's
// Feed tab):
//   Weekly Mock  a followed NFL team's weekly mock picks and what changed
//                from the week before (weeklyMocks, utils/draftSim/weeklyMock.js)
//   Game         a followed player's most recent game line (ESPN game log)
//   Video        videos tagged to a followed player (videos.playerIds)
//   Article      published articles tagged to a followed player or school
//                (articles.playerIds / articles.schools)
// Every item carries topics — "cfb", "nfl", "draft2027", "draft2028" … — and
// shows when any of them is switched on in the user's feed settings
// (users/{uid}/liveSettings/hub { topics: { [topic]: bool }, seenAt }).
// The queries are single-field array-contains-any (no index needed),
// filtered and sorted here.
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { lastGameLine, loadFollowing, loadSchoolsById } from "./profileHub";
import { teamChanges } from "./draftSim/weeklyMock";
import { loadWeeklyMockSummary, weeklyMockHref, MAIN_WEEKLY_YEAR } from "./weeklyMockNews";
import { SIM_YEARS } from "./draftSim/years";

const DAY = 864e5;
// Game lines only while they're fresh.
const GAME_DAYS = 10;
// The badge counts what's new, but never further back than this.
const BADGE_DAYS = 14;

export const HUB_TOPICS = [
  ["cfb", "College Football", "Game lines and news for the college teams and players you follow"],
  ["nfl", "NFL & Weekly Mocks", "Weekly mock updates for the NFL teams you follow"],
  ...SIM_YEARS.map((y) => [`draft${y}`, `${y} Draft`, `News and videos on the ${y} prospects you follow`]),
];
const ALL_ON = Object.fromEntries(HUB_TOPICS.map(([k]) => [k, true]));

const hubRef = (uid) => doc(db, "users", uid, "liveSettings", "hub");
export async function loadHubPrefs(uid) {
  const snap = await getDoc(hubRef(uid)).catch(() => null);
  const d = snap?.exists() ? snap.data() : {};
  return { topics: { ...ALL_ON, ...(d.topics || {}) }, seenAt: d.seenAt?.toMillis ? d.seenAt.toMillis() : 0 };
}
export const saveHubTopics = (uid, topics) => setDoc(hubRef(uid), { topics }, { merge: true });
export const markFeedSeen = (uid) => {
  clearBadgeCache(uid);
  return setDoc(hubRef(uid), { seenAt: serverTimestamp() }, { merge: true });
};
export const showsFor = (topics) => (item) => item.topics.some((t) => topics[t] !== false);

const chunks = (ids, n = 30) => { const out = []; for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n)); return out; };
export const ms = (v) => (v?.toMillis ? v.toMillis() : v?._seconds ? v._seconds * 1000 : typeof v === "string" ? Date.parse(v) || 0 : 0);
const ytId = (url = "") => (url.match(/(?:youtu\.be\/|v=|shorts\/)([\w-]{11})/) || [])[1] || "";
const classTopic = (eligible) => (eligible ? `draft${eligible}` : "cfb");

async function anyOf(coll, field, values) {
  const docs = [];
  await Promise.all(chunks(values).map(async (c) => {
    const snap = await getDocs(query(collection(db, coll), where(field, "array-contains-any", c))).catch(() => null);
    snap?.docs.forEach((d) => docs.push({ id: d.id, ...d.data() }));
  }));
  return [...new Map(docs.map((d) => [d.id, d])).values()];
}

// The class's latest two published weeks (the summary names them).
async function latestWeeks() {
  const summary = await loadWeeklyMockSummary(MAIN_WEEKLY_YEAR);
  if (!summary?.weekId) return [];
  const snaps = await Promise.all([summary.weekId, summary.prevWeekId].filter(Boolean).map((id) => getDoc(doc(db, "weeklyMocks", id))));
  return snaps.filter((s) => s.exists() && s.data().publishedAt).map((s) => ({ id: s.id, ...s.data() }));
}

// The Firestore-backed items (mocks, videos, articles). data: the hub's
// following (components/profileHub/useHubFollowing.js), or the bare
// follows for the badge — players [{ follow, photo?, snap? }], college
// [{ school, name?, logo?, color? }], nfl [{ abbr, nick?, logo?, color?, alt? }].
async function storedItems(data) {
  const items = [];
  const byPlayer = Object.fromEntries(data.players.map((p) => [p.follow.playerId || p.follow.id, p]));
  const playerIds = Object.keys(byPlayer);
  const bySchool = Object.fromEntries(data.college.filter((t) => t.school).map((t) => [t.school, t]));

  if (data.nfl.length) {
    const [latest, previous] = await latestWeeks().catch(() => []);
    if (latest) {
      data.nfl.forEach((t) => {
        const picks = (latest.picks || []).filter((p) => p.owner === t.abbr && p.player).sort((a, b) => a.overall - b.overall);
        if (!picks.length) return;
        const ch = teamChanges(latest, previous, t.abbr);
        const first = picks[0];
        const added = ch?.added?.[0];
        const nick = t.nick || t.abbr;
        items.push({
          kind: "mock", topics: ["nfl"], key: `m-${t.abbr}-${latest.id}`, at: ms(latest.publishedAt), to: weeklyMockHref(t.abbr),
          why: nick, whyLogo: t.logo, thumb: { src: t.logo, bg: `linear-gradient(135deg, ${t.color || "#0055a5"}, ${t.alt || "#f6a21d"})`, fit: "logo" },
          title: added ? `${nick} mock updated: ${added.player.First} ${added.player.Last} at No. ${added.overall}` : `${nick} mock: ${first.player.First} ${first.player.Last} at No. ${first.overall}`,
          sub: added ? `${added.player.Position}, ${added.player.School}${ch.added.length > 1 ? ` · ${ch.added.length - 1} more new pick${ch.added.length > 2 ? "s" : ""}` : ""}` : `${picks.length} picks · same first pick as last week`,
        });
      });
    }
  }

  if (playerIds.length) {
    const vids = await anyOf("videos", "playerIds", playerIds);
    vids.forEach((v) => {
      const at = ms(v.Date);
      if (!at || (v.PublishAt && ms(v.PublishAt) > Date.now())) return;
      const pid = (v.playerIds || []).find((id) => byPlayer[id]);
      const p = byPlayer[pid];
      const item = (v.items || []).find((i) => i.playerId === pid) || {};
      const id = ytId(v.Video);
      items.push({
        kind: "video", topics: [classTopic(p?.follow.playerEligible)], key: `v-${v.id}`, at, href: v.Video,
        why: p?.follow.playerName, whyLogo: p?.snap?.team?.logo, thumb: { src: id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : "", fit: "cover", play: true },
        title: item.title || v.GenTitle || "New video", sub: v.Short ? "Short · King Cold Sports" : "King Cold Sports",
      });
    });
  }

  const [byPlayers, bySchools] = await Promise.all([
    playerIds.length ? anyOf("articles", "playerIds", playerIds) : [],
    Object.keys(bySchool).length ? anyOf("articles", "schools", Object.keys(bySchool)) : [],
  ]);
  [...new Map([...byPlayers, ...bySchools].map((a) => [a.id, a])).values()].forEach((a) => {
    if (a.status !== "published" || !a.slug) return;
    const pid = (a.playerIds || []).find((id) => byPlayer[id]);
    const p = byPlayer[pid];
    const t = bySchool[(a.schools || []).find((s) => bySchool[s])];
    const topics = [...(p ? [classTopic(p.follow.playerEligible)] : []), ...(t ? ["cfb"] : [])];
    items.push({
      kind: "article", topics: topics.length ? topics : ["cfb"], key: `a-${a.id}`, at: ms(a.publishedAt), to: `/article/${a.slug}`,
      why: p ? p.follow.playerName : t?.name || t?.school, whyLogo: p ? p.snap?.team?.logo : t?.logo,
      thumb: p ? { src: p.photo?.headshot, bg: p.snap?.team?.color, fit: "headshot" } : { src: t?.logo, bg: t?.color, fit: "logo" },
      title: a.titleShort || a.title, sub: a.author ? `By ${a.author}` : "We-Draft.com",
    });
  });
  return items;
}

// The whole feed for the hub, newest first (game lines need the ESPN
// snapshots the hub already loaded).
export async function buildFeed(data) {
  const items = await storedItems(data);
  data.players.forEach((p) => {
    const g = p.snap?.lastGame;
    const line = lastGameLine(p.snap?.position || p.follow.playerPosition, g);
    if (!g || !line || Date.now() - Date.parse(g.date) > GAME_DAYS * DAY) return;
    items.push({
      kind: "game", topics: ["cfb", classTopic(p.follow.playerEligible)], key: `g-${p.follow.id}-${g.date}`, at: Date.parse(g.date),
      to: p.follow.playerSlug ? `/player/${p.follow.playerSlug}` : null,
      why: p.follow.playerName, whyLogo: p.snap?.team?.logo, thumb: { src: p.photo?.headshot, bg: p.snap?.team?.color, fit: "headshot" },
      title: `${line} ${g.at} ${g.opp}`, sub: `${p.snap?.team?.abbr || p.follow.playerSchool} ${g.result === "W" ? "won" : g.result === "L" ? "lost" : "tied"} ${g.score}`,
    });
  });
  return items.filter((i) => i.at).sort((a, b) => b.at - a.at).slice(0, 40);
}

// How many feed items are new since the user last opened the Feed — the
// Firestore-backed ones only (no ESPN calls on every page), in the topics
// they've switched on. Cached for the session for 10 minutes.
const BADGE_TTL = 10 * 60 * 1000;
const badgeKey = (uid) => `wd-feed-badge-${uid}`;
function clearBadgeCache(uid) { try { sessionStorage.removeItem(badgeKey(uid)); } catch { /* storage blocked */ } }
export async function countNewFeed(uid) {
  try {
    const hit = JSON.parse(sessionStorage.getItem(badgeKey(uid)) || "null");
    if (hit && Date.now() - hit.t < BADGE_TTL) return hit.n;
  } catch { /* storage blocked */ }
  const [prefs, f] = await Promise.all([loadHubPrefs(uid), loadFollowing(uid)]);
  const schools = await loadSchoolsById(f.college);
  const data = {
    players: f.players.map((follow) => ({ follow })),
    college: f.college.map((id) => schools[id]).filter(Boolean),
    nfl: f.nfl.map((abbr) => ({ abbr })),
  };
  const since = Math.max(prefs.seenAt, Date.now() - BADGE_DAYS * DAY);
  const n = (await storedItems(data)).filter(showsFor(prefs.topics)).filter((i) => i.at > since).length;
  try { sessionStorage.setItem(badgeKey(uid), JSON.stringify({ n, t: Date.now() })); } catch { /* storage blocked */ }
  return n;
}
