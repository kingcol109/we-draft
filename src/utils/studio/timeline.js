// src/utils/studio/timeline.js
//
// The Breakdown Studio's timing (components/studio/BreakdownStudio.jsx).
// Pure — what shows at time t of the video:
//
//   The video's clock is the face cam recording (t = 0 … its length).
//   marks: when each segment starts (Intro at 0), plus — a draft verdict —
//     when each verdict item (grade, comp, fits) is revealed. The admin
//     sets them by tapping "Mark" while the recording plays.
//   The breakdown frame at t: the segment's coming-in clip for its first
//     seconds, then its finished still (sequenceOf's entries).
//   The film at t: the segment's plays, back to back from its start;
//     a segment longer than its plays loops them.
//   An asset over a play: a Scouting Card / Player ID at its start, a
//     Play Result at its end (first time through only).

// The marks to set, in order: each segment after the intro, the verdict's
// reveals inside the verdict. segKeys: segsOf(bd) keys; reveals: how many.
export function markOrder(segKeys, reveals = 0) {
  const out = [];
  segKeys.forEach((k, i) => {
    if (i > 0) out.push({ id: k, seg: k, label: k });
    if (k === "verdict") for (let r = 1; r <= reveals; r += 1) out.push({ id: `reveal${r}`, seg: k, reveal: r, label: `reveal ${r}` });
  });
  return out;
}

// Marks spread over the recording in the default segment proportions.
// times: { segKey: seconds } (DEFAULT_TIMES); revealGap: seconds after the verdict's start for the first reveal.
export function defaultMarks(segKeys, duration, times, reveals = 0, revealGap = 2) {
  const total = segKeys.reduce((s, k) => s + (times[k] || 30), 0) || 1;
  const marks = {};
  let at = 0;
  segKeys.forEach((k) => {
    marks[k] = Math.round(at * 10) / 10;
    at += ((times[k] || 30) / total) * duration;
  });
  marks[segKeys[0]] = 0;
  if (segKeys.includes("verdict") && reveals) {
    const v = marks.verdict;
    const end = segEnd(segKeys, marks, "verdict", duration);
    const span = Math.max(0, end - v - revealGap);
    for (let r = 1; r <= reveals; r += 1) marks[`reveal${r}`] = Math.round((v + revealGap + (span * (r - 1)) / reveals) * 10) / 10;
  }
  return marks;
}

const segEnd = (segKeys, marks, key, duration) => {
  const i = segKeys.indexOf(key);
  return i >= 0 && i < segKeys.length - 1 ? marks[segKeys[i + 1]] ?? duration : duration;
};

// The segment at t: { key, start, end, index }.
export function segmentAt(segKeys, marks, duration, t) {
  let idx = 0;
  segKeys.forEach((k, i) => { if (i === 0 || (marks[k] != null && t >= marks[k])) idx = i; });
  const key = segKeys[idx];
  return { key, start: idx === 0 ? 0 : marks[key], end: segEnd(segKeys, marks, key, duration), index: idx };
}

// The breakdown frame at t → a draw view { seg, step, anim?, t? }.
// entries: sequenceOf(bd) (its clips — kind "mov" — carry anim); animSec(anim) → seconds.
export function overlayViewAt({ segKeys, marks, duration, entries, animSec }, t) {
  const seg = segmentAt(segKeys, marks, duration, t);
  const movs = entries.filter((e) => e.kind === "mov" && e.seg === seg.key);
  // The latest step started by t: step 0 at the segment's start, a reveal at its mark.
  let step = 0;
  let from = seg.start;
  movs.forEach((e) => {
    if (e.step === 0) return;
    const at = marks[`reveal${e.step}`];
    if (at != null && t >= at && at >= seg.start && at < seg.end) { step = e.step; from = at; }
  });
  const clip = movs.find((e) => e.step === step);
  if (clip) {
    const len = animSec(clip.anim) || 0;
    const into = t - from;
    if (len > 0 && into < len) return { seg: seg.key, step, anim: clip.anim, t: Math.max(0, into / len) };
  }
  return { seg: seg.key, step };
}

// A segment's plays laid out: [{ ...item, play, start, end }] in timeline
// seconds, back to back from the segment's start, looping until its end.
// assign: { segKey: [{ play (index), in, out, overlay }] }; plays: the bin.
export function filmLayout({ segKeys, marks, duration, assign, plays, loop = true }) {
  const out = [];
  segKeys.forEach((k) => {
    const items = (assign?.[k] || []).filter((it) => plays[it.play] && it.out - it.in > 0.05);
    if (!items.length) return;
    const start = k === segKeys[0] ? 0 : marks[k] ?? 0;
    const end = segEnd(segKeys, marks, k, duration);
    let at = start;
    let pass = 0;
    while (at < end - 0.01) {
      for (let i = 0; i < items.length && at < end - 0.01; i += 1) {
        const it = items[i];
        const len = Math.min(it.out - it.in, end - at);
        out.push({ ...it, seg: k, index: i, pass, start: at, end: at + len, src: plays[it.play] });
        at += len;
      }
      pass += 1;
      if (!loop) break;
    }
  });
  return out;
}

// The film at t → { item, srcTime } or null.
export function filmAt(layout, t) {
  const item = layout.find((x) => t >= x.start && t < x.end);
  return item ? { item, srcTime: item.in + (t - item.start) } : null;
}

// Asset timing on a play (first pass only): → { kind, p (0–1) } or null.
export const ASSET_SECONDS = { scoutcard: 4, playerid: 2, result: 1.5 };
export function assetAt(layout, t) {
  const hit = filmAt(layout, t);
  if (!hit || hit.item.pass > 0) return null;
  const { item } = hit;
  const ov = item.overlay;
  if (!ov || !ov.kind || ov.kind === "none") return null;
  const len = Math.min(ASSET_SECONDS[ov.kind] || 2, item.end - item.start);
  const from = ov.kind === "result" ? item.end - len : item.start + Math.min(0.2, (item.end - item.start) / 4);
  if (t < from || t >= from + len) return null;
  return { kind: ov.kind, item, p: (t - from) / len, seconds: len };
}

// YouTube chapters from the marks: "0:00 Intro\n0:15 Player Background…".
export function chaptersText(segs, marks) {
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return segs.map((s, i) => `${clock(i === 0 ? 0 : marks[s.key] || 0)} ${s.chapter}`).join("\n");
}

// Auto-fill: the first plays to the intro (two), the rest split between
// strengths and weaknesses by their lengths, in the sequence's order.
export function autoAssign(segKeys, marks, duration, plays, introCount = 2) {
  const list = plays.map((p, i) => ({ play: i, in: p.in, out: p.out, overlay: { kind: "none" } }));
  const assign = {};
  if (!list.length) return assign;
  if (segKeys.includes("intro")) {
    assign.intro = list.slice(0, introCount).map((x, i) => (i === 0 ? { ...x, overlay: { kind: "scoutcard" } } : x));
  }
  const rest = list.slice(introCount);
  const len = (k) => (segKeys.includes(k) ? segEnd(segKeys, marks, k, duration) - (marks[k] ?? 0) : 0);
  const s = len("strengths");
  const w = len("weaknesses");
  const nS = s + w > 0 ? Math.round((rest.length * s) / (s + w)) : rest.length;
  if (segKeys.includes("strengths")) assign.strengths = rest.slice(0, nS);
  if (segKeys.includes("weaknesses")) assign.weaknesses = rest.slice(nS);
  return assign;
}
