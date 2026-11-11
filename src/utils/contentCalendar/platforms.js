// src/utils/contentCalendar/platforms.js
//
// The Content Calendar's platform layer (components/ContentCalendarManager.js):
// which platform an entry belongs to, and how a platform's own record becomes
// a calendar entry. Nothing is copied onto the calendar — instagramPosts and
// xPosts are read and turned into entries here on every load, so an entry
// can't disagree with its post. Pure: no Firebase, no DOM.
//
// Times are Eastern, like the rest of the admin: a post scheduled for 11pm ET
// on the 5th sits on the 5th, wherever the browser is. Date-only fields
// (videos.Date, contentCalendar.date) keep their own UTC-midnight convention
// in the calendar itself.

export const ET = "America/New_York";

export const PLATFORMS = {
  youtube: { key: "youtube", label: "YouTube", tag: "YT", color: "#dc2626" },
  instagram: { key: "instagram", label: "Instagram", tag: "IG", color: "#c13584", fill: "linear-gradient(90deg, #f58529, #c13584 55%, #833ab4)" },
  x: { key: "x", label: "X", tag: "X", color: "#111827" },
  // Not tied to one of the three: articles, and plans typed as a plain "post".
  other: { key: "other", label: "Other", tag: "", color: "#64748b" },
};
export const PLATFORM_FILTERS = [{ key: "all", label: "All" }, ...["youtube", "instagram", "x", "other"].map((k) => ({ key: k, label: PLATFORMS[k].label }))];

// A planned or pulled-in entry's platform, from its content type.
export const platformOfType = (type) => (type === "video" || type === "short" ? "youtube" : "other");
export const matchesFilter = (entry, filter) => !filter || filter === "all" || entry.platform === filter;

// A stored time (ms, a Firestore Timestamp, a Date, or an ISO string like
// Instagram's publishedAt) → ms, or null.
export function msOf(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === "string") { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  return null;
}

const etParts = (ms) => {
  const out = {};
  new Intl.DateTimeFormat("en-US", { timeZone: ET, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(ms)).forEach((p) => { out[p.type] = p.value; });
  return out;
};
// "YYYY-MM-DD" of an instant, in Eastern.
export function dateKeyET(ms) {
  if (ms == null) return "";
  const p = etParts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}
export const fmtET = (ms) => (ms ? `${new Date(ms).toLocaleString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET` : "");
// Just the clock, for a chip: "9:30 PM".
export const timeET = (ms) => (ms ? new Date(ms).toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" }) : "");

// Eastern's offset from UTC at an instant, in ms (negative).
function etOffset(ms) {
  const p = etParts(ms);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
// The instant the same Eastern clock time falls on another day ("YYYY-MM-DD")
// — what a chip dragged to a new day means, across a daylight-saving change too.
export function moveToDay(ms, dateKey) {
  const p = etParts(ms);
  const [y, m, d] = dateKey.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, +p.hour, +p.minute, +p.second);
  const once = wall - etOffset(wall);
  return wall - etOffset(once);
}

const IG_TYPE_LABELS = { custom: "Post", mock: "Weekly Mock", spotlight: "Spotlight", player: "Player post", portal: "Portal: entered", transfer: "Portal: transferred", short: "Short" };
const IG_STATUS = {
  scheduled: "Scheduled", publishing: "Publishing", published: "Published", posted: "Published (by hand)", failed: "Failed",
};

// One instagramPosts doc → its entry, or null when it has no time yet: a
// draft isn't on the publishing schedule until it's scheduled.
export function instagramEntry(post) {
  const ig = post?.ig || {};
  const s = post?.status || "draft";
  let whenMs = null;
  if (s === "published") whenMs = msOf(ig.publishedAt) ?? msOf(ig.scheduledAt);
  else if (s === "posted") whenMs = msOf(post.postedAt);
  else if (s === "scheduled" || s === "publishing" || s === "failed") whenMs = msOf(ig.scheduledAt) ?? msOf(ig.error?.at);
  if (whenMs == null) return null;
  return {
    id: `instagram:${post.id}`, refId: post.id, source: "instagram", platform: "instagram", type: "post",
    subjectLabel: post.name || "Instagram post", dateKey: dateKeyET(whenMs), whenMs,
    status: s, statusLabel: IG_STATUS[s] || s, kindLabel: IG_TYPE_LABELS[post.type] || post.type || "Post",
    thumb: post.thumb || "", body: post.caption || "", permalink: ig.permalink || "",
    // Only a post that's still waiting can be moved; the server has the rest.
    movable: s === "scheduled", problem: s === "failed" ? ig.error?.message || "Publishing failed." : "", raw: post,
  };
}

// One xPosts doc → its entry, or null when it has no time. X isn't connected
// yet: a scheduled post whose time has come says so instead of looking posted
// (server/x/README.md).
export function xEntry(post, now = Date.now()) {
  const s = post?.status || "draft";
  let whenMs = null;
  if (s === "scheduled" || s === "publishing" || s === "failed") whenMs = msOf(post.scheduledAt);
  else if (s === "posted") whenMs = msOf(post.postedAt) ?? msOf(post.scheduledAt);
  else if (s === "published") whenMs = msOf(post.x?.publishedAt) ?? msOf(post.scheduledAt);
  if (whenMs == null) return null;
  const due = s === "scheduled" && whenMs <= now;
  return {
    id: `x:${post.id}`, refId: post.id, source: "x", platform: "x", type: "post",
    subjectLabel: post.name || "X post", dateKey: dateKeyET(whenMs), whenMs,
    status: s, statusLabel: due ? "Due: post by hand" : ({ scheduled: "Scheduled", posted: "Posted", published: "Published", publishing: "Publishing", failed: "Failed" })[s] || s,
    kindLabel: "X post", thumb: post.thumb || "", body: post.text || "", permalink: post.x?.permalink || "",
    movable: s === "scheduled", due, problem: s === "failed" ? post.x?.error?.message || "Publishing failed." : "", raw: post,
  };
}

// A day's chips: timed ones in order, then the ones with only a date, in the
// order they came.
export function sortDay(entries) {
  return entries.map((e, i) => [e, i]).sort(([a, i], [b, j]) => {
    if (a.whenMs != null && b.whenMs != null) return a.whenMs - b.whenMs || i - j;
    if (a.whenMs != null) return -1;
    if (b.whenMs != null) return 1;
    return i - j;
  }).map(([e]) => e);
}

// The same piece of content elsewhere. Each platform keeps its own record,
// text and time; an X post lists what it goes with (linkedTo: [{ platform, id,
// label }]), since a scheduled or published Instagram post is locked in
// firestore.rules. Read both ways here: → the other records tied to an entry,
// as [{ platform, id, label, entry (when it's on the calendar) }].
export function linksOf(entry, entries) {
  if (!entry) return [];
  const byRef = (platform, id) => entries.find((e) => e.platform === platform && e.refId === id) || null;
  const out = [];
  const add = (platform, id, label) => {
    if (out.some((o) => o.platform === platform && o.id === id)) return;
    if (platform === entry.platform && id === entry.refId) return;
    const hit = byRef(platform, id);
    out.push({ platform, id, label: hit?.subjectLabel || label || id, entry: hit });
  };
  const own = (e) => (Array.isArray(e?.raw?.linkedTo) ? e.raw.linkedTo : []);
  own(entry).forEach((l) => add(l.platform, l.id, l.label));
  entries.filter((e) => own(e).some((l) => l.platform === entry.platform && l.id === entry.refId)).forEach((e) => {
    add(e.platform, e.refId, e.subjectLabel);
    // What else that post goes with.
    own(e).forEach((l) => add(l.platform, l.id, l.label));
  });
  return out;
}
