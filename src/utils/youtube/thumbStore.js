// src/utils/youtube/thumbStore.js
//
// Saved YouTube thumbnails (Admin → Videos → Graphics → Thumbnail) and what
// the thumbnail analytics need to judge them (AdminThumbAnalytics.jsx):
//   ytThumbnails/{id}: { template ("gamereview" | "icecold"), name, playerId,
//     playerName, school, position, eligible, headline, design (everything the
//     editor needs to draw it again), meta (what the analytics group by:
//     template, headline, its words and lines, the photo's kind, colors,
//     player in front or behind), thumb (a 480×270 JPEG data URI), videoId
//     (the YouTube video it's on — ytVideos/{videoId}), liveFrom (ms: when it
//     went up on that video; the next thumbnail on the same video ends its
//     run), createdAt, updatedAt, createdBy }.
// Admin read and write only (firestore.rules).
import { addDoc, collection, deleteDoc, deleteField, doc, getDocs, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../firebase";

const THUMBS = "ytThumbnails";

export async function loadThumbs() {
  const snap = await getDocs(query(collection(db, THUMBS), orderBy("updatedAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// → its id.
export async function saveThumb(id, data) {
  if (id) {
    await updateDoc(doc(db, THUMBS, id), { ...data, updatedAt: serverTimestamp() });
    return id;
  }
  const ref = await addDoc(collection(db, THUMBS), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return ref.id;
}

// On a video from a day (ms), or off it (videoId "").
export const linkThumb = (id, videoId, liveFrom) => updateDoc(doc(db, THUMBS, id), videoId
  ? { videoId, liveFrom, updatedAt: serverTimestamp() }
  : { videoId: deleteField(), liveFrom: deleteField(), updatedAt: serverTimestamp() });

export const deleteThumb = (id) => deleteDoc(doc(db, THUMBS, id));

// What the analytics group a thumbnail by.
export function thumbMeta({ template, headline = "", name = "", photoKind = "", colors = {}, photoBehind = false }) {
  const lines = String(headline || "").split(/\n/).map((s) => s.trim()).filter(Boolean);
  return {
    template,
    headline: lines.join(" "),
    headlineWords: lines.join(" ").split(/\s+/).filter(Boolean).length,
    headlineLines: lines.length,
    question: /\?/.test(headline),
    nameOnThumb: !!String(name).trim(),
    photoKind,
    photoBehind: !!photoBehind,
    ...colors,
  };
}

// Each thumbnail's run on its video: [from, to) in ms; to is the next
// thumbnail's liveFrom on the same video, or null (still up).
export function thumbRuns(thumbs) {
  const byVideo = {};
  thumbs.filter((t) => t.videoId && t.liveFrom).forEach((t) => { (byVideo[t.videoId] ||= []).push(t); });
  const runs = {};
  Object.values(byVideo).forEach((list) => {
    list.sort((a, b) => a.liveFrom - b.liveFrom);
    list.forEach((t, i) => { runs[t.id] = { from: t.liveFrom, to: list[i + 1]?.liveFrom ?? null }; });
  });
  return runs;
}

// A run's numbers from the video's daily rows ({ date "YYYY-MM-DD",
// impressions, impressionsCtr, views, minutesWatched, avgViewPct }): the
// days inside [from, to).
// Pacific days, as the rows are.
export const dayOf = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
export function runTotals(rows, run) {
  const from = dayOf(run.from);
  const to = run.to ? dayOf(run.to) : null;
  const inRun = rows.filter((r) => r.date >= from && (!to || r.date < to));
  const withReach = inRun.filter((r) => Number.isFinite(r.impressions));
  const impressions = withReach.reduce((s, r) => s + (r.impressions || 0), 0);
  const clicks = withReach.reduce((s, r) => s + (r.impressions || 0) * (r.impressionsCtr || 0), 0);
  const views = inRun.reduce((s, r) => s + (r.views || 0), 0);
  const minutes = inRun.reduce((s, r) => s + (r.minutesWatched || 0), 0);
  const pctViews = inRun.reduce((s, r) => s + (Number.isFinite(r.avgViewPct) ? r.views || 0 : 0), 0);
  return {
    days: inRun.length,
    reachDays: withReach.length,
    impressions,
    ctr: impressions ? clicks / impressions : null,
    views,
    // Watch time: minutes watched ÷ views; % viewed weighted by each day's views.
    minutes,
    avgViewSec: views ? (minutes * 60) / views : null,
    avgViewPct: pctViews ? inRun.reduce((s, r) => s + (Number.isFinite(r.avgViewPct) ? r.avgViewPct * (r.views || 0) : 0), 0) / pctViews : null,
    firstReachDay: withReach[0]?.date || null,
  };
}
