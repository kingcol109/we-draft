// src/utils/seniorBowlPerf.js
//
// Senior Bowl Top Performers (user, 2026-11-20) — WX content
// (see utils/risers.js, the reference): the standouts of Senior Bowl week
// in Mobile, ranked, at /events/senior-bowl/{year}/performances
// (components/events/SeniorBowlPerformances.jsx), set in Admin → Content →
// Senior Bowl (components/AdminSeniorBowlPerf.jsx). One doc per year:
//   seniorBowlPerf/{year} {
//     players: [Perf], updatedAt
//   }
//   Perf = {
//     id (players doc id), slug, first, last, pos, school,  — copied from the
//                                    players doc on every admin save
//     team: "American" | "National" | "" — from the Senior Bowl roster
//           (events/{year}.seniorBowl), editable,
//     days: ["d1", "d2", "d3", "game"] — the days he stood out (SBP_DAYS),
//     note: the admin's write-up (blank lines split paragraphs),
//     order: 0…, shot: the placed action shot his graphic uses (chosen on
//     Save), addedAt (ms),
//   }
// Every admin Save also publishes the list as a dated edition, like the
// risers (one a day, a second Save that day replaces it):
//   seniorBowlPerfEditions/{year}_{YYYY-MM-DD} { year, date, publishedAt, players }
// The latest is always .../performances; a past one is
// .../performances/{date} (noindex), and each is a news item (loadPerfNews).
export const SBP_YEARS = ["2027"];
export const SBP_DOC = "seniorBowlPerf";
export const SBP_EDITIONS = "seniorBowlPerfEditions";
export const SBP_TEAMS = ["American", "National"];
// The days of the week he can stand out on, in order.
export const SBP_DAYS = [
  { key: "d1", label: "Day 1", short: "D1", long: "Practice Day 1" },
  { key: "d2", label: "Day 2", short: "D2", long: "Practice Day 2" },
  { key: "d3", label: "Day 3", short: "D3", long: "Practice Day 3" },
  { key: "game", label: "Game", short: "GAME", long: "Game Day" },
];
export const sbpDayLabel = (k) => SBP_DAYS.find((d) => d.key === k)?.label || "";
// His days, in week order.
export const sbpDays = (p) => SBP_DAYS.filter((d) => (p?.days || []).includes(d.key));

// The look: the Senior Bowl's own red / black / gold (utils/events.js).
export const SBP_THEME = {
  red: "#d62c26", deep: "#141414", gold: "#f5d000", ink: "#a51f1a", tint: "#fdf0ef",
  // The two teams' colors (chips, the graphic's team tag).
  American: "#d62c26", National: "#1d4ed8",
};

export function perfRanked(players) {
  return [...(players || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.addedAt ?? 0) - (b.addedAt ?? 0));
}
export const perfShot = (p, shots) => (shots || []).find((s) => s.url === p?.shot) || (shots || [])[0] || null;

export const performancesPath = (year) => `/events/senior-bowl/${year}/performances`;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isPerfEditionDate = (d) => DATE_RE.test(String(d || ""));
export const perfEditionId = (year, date) => `${year}_${date}`;
export const perfEditionPath = (year, date) => `${performancesPath(year)}/${date}`;
// The edition a moment belongs to: its date in Eastern time.
export const perfEditionDate = (when = new Date()) => when.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
export const perfEditionLabel = (date, opts = { month: "short", day: "numeric", year: "numeric" }) =>
  (isPerfEditionDate(date) ? new Date(`${date}T12:00:00`).toLocaleDateString("en-US", opts) : "");

// A top performer's graphic, at a descriptive filename (api/senior-bowl/
// [year]/[file].js → api/senior-bowl-graphic.js):
// /api/senior-bowl/2027/dante-moore-senior-bowl-top-performer.webp.
// small: the 600px copy; fmt "webp" (the page) or "png" (social, structured
// data); v: the list's last save (ms); ed: a past edition's date.
const SITE = "https://we-draft.com";
export const perfImageUrl = (slug, year, small = false, v = "", fmt = "png", ed = "") => {
  const q = [v && `v=${v}`, ed && `ed=${ed}`].filter(Boolean).join("&");
  return `${SITE}/api/senior-bowl/${year}/${encodeURIComponent(slug)}-senior-bowl-top-performer${small ? "-600" : ""}.${fmt === "webp" ? "webp" : "png"}${q ? `?${q}` : ""}`;
};

// A year's saved list (seniorBowlPerf/{year}), or null — cached for the
// visit (player and team pages read it for In The News).
const listCache = new Map();
export function loadPerfList(year) {
  const y = String(year || "");
  if (!SBP_YEARS.includes(y)) return Promise.resolve(null);
  if (!listCache.has(y)) {
    listCache.set(y, (async () => {
      const [{ doc, getDoc }, { db }] = await Promise.all([import("firebase/firestore"), import("../firebase")]);
      const s = await getDoc(doc(db, SBP_DOC, y));
      return s.exists() ? s.data() : null;
    })().catch(() => null));
  }
  return listCache.get(y);
}

// His In The News item when he's on a year's list (player pages): null
// when he isn't. "2027 Senior Bowl Top Performers: Moore".
export async function perfNewsItem(player) {
  if (!player?.id) return null;
  for (const year of SBP_YEARS) {
    const list = await loadPerfList(year);
    const p = (list?.players || []).find((x) => x.id === player.id);
    if (p && list?.updatedAt) {
      return {
        id: `sbPerf${year}`, type: "seniorBowl", aboutPlayer: true, publishedAt: list.updatedAt,
        href: performancesPath(year), title: `${year} Senior Bowl Top Performers: ${player.Last || p.last}`,
      };
    }
  }
  return null;
}

// The published editions as news items — { id, type, title, summary,
// publishedAt, href }, newest first: a year's newest links to the latest
// page, older ones to their own. [] if the read fails.
export async function loadPerfNews(max) {
  try {
    const [{ collection, getDocs, limit, orderBy, query }, { db }] = await Promise.all([import("firebase/firestore"), import("../firebase")]);
    const snap = await getDocs(query(collection(db, SBP_EDITIONS), orderBy("publishedAt", "desc"), ...(max ? [limit(max)] : [])));
    const seen = new Set();
    return snap.docs.map((d) => {
      const e = d.data();
      const year = String(e.year);
      const latest = !seen.has(year);
      seen.add(year);
      const top = perfRanked(e.players).slice(0, 3).map((r) => `${r.first} ${r.last}`);
      return {
        id: `sbPerf-${d.id}`, type: "seniorBowl", publishedAt: e.publishedAt,
        title: `${year} Senior Bowl Top Performers — ${perfEditionLabel(e.date, { month: "long", day: "numeric" })}`,
        summary: top.length ? `Leading the list: ${top.length > 1 ? `${top.slice(0, -1).join(", ")} and ${top[top.length - 1]}` : top[0]}` : "",
        href: latest ? performancesPath(year) : perfEditionPath(year, e.date),
      };
    });
  } catch {
    return [];
  }
}
