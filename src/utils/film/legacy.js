// src/utils/film/legacy.js
//
// Importing the legacy Premiere projects into the Film Manager (user,
// 2026-11-25): one project a player (Player Profiles\Ousmane Kromah\kromah
// real.prproj), each sequence a reel of cuts out of full games. Every cut
// becomes a play tagged to that player; labels are added afterwards.
//
// The marks: the user circles players with circle.png / circle2.png (or
// points with arrow.png) from YouTube\Misc, on the track above the film.
//
// Putting a mark back on the FILM (user, 2026-11-25): in Premiere each cut
// is scaled to fit its sequence — 960×540 film at 133% in a 1280×720
// sequence, 1920×1080 film at ~67% — and the marks are placed in that
// sequence's frame (often inside a nested sequence, with the film). That
// scaling only fits the film to the sequence; it is NOT a zoom on the
// player, so nothing from Premiere is treated as washed. The Film Manager
// shows the film at full size, so each mark is translated: from its own
// clip (the PNG's real proportions — the circle's middle, the arrow's tip)
// → its sequence → (through a nest, when the mark and the film sit in
// different ones) → the film's own frame, using each clip's Position,
// Anchor Point and Scale, the sequences' frame sizes, and the media's real
// pixel sizes (utils/studio/prproj.js). A circle keeps its size; an arrow
// its length. Animated (keyframed) motion can't be read as one placement —
// those spots are flagged (animated) to check.
import { gameIdOf } from "./library";

export const MARK_FILES = /^(circle|circle2|arrow)\.(png|psd|jpg)$/i;
const VIDEO = /\.(mp4|m4v|mov)$/i;

// The mark PNGs (measured from YouTube\Misc): the ring's middle and radius,
// the arrow's tip (bottom center) and top, in their own pixels.
export const MARK_ART = {
  circle: { w: 648, h: 651, cx: 321, cy: 324, r: 311 },
  circle2: { w: 648, h: 651, cx: 321, cy: 324, r: 311 },
  arrow: { w: 384, h: 470, tipX: 193, tipY: 455, topY: 11 },
};

const sc = (m) => (m?.scale ?? 100) / 100;
const pos = (m, k) => (m?.[k] ?? 0.5);
// A point on a clip (normalized to the clip) → its sequence (normalized to the sequence's frame).
export function clipToSeq(u, v, motion, size, frame) {
  const s = size || frame;
  return { x: pos(motion, "x") + ((u - (motion?.ax ?? 0.5)) * s.w * sc(motion)) / frame.w, y: pos(motion, "y") + ((v - (motion?.ay ?? 0.5)) * s.h * sc(motion)) / frame.h };
}
// …and back: a point in the sequence → on the clip.
export function seqToClip(x, y, motion, size, frame) {
  const s = size || frame;
  return { u: (motion?.ax ?? 0.5) + ((x - pos(motion, "x")) * frame.w) / (s.w * sc(motion)), v: (motion?.ay ?? 0.5) + ((y - pos(motion, "y")) * frame.h) / (s.h * sc(motion)) };
}

// A point of the mark's art (in its pixels) → a point on the film (normalized to the film).
function markPointOnFilm(px, py, mark, film, art) {
  const mf = mark.frame || film.frame;
  const ff = film.frame || mf;
  if (!mf || !ff) return null;
  let p = clipToSeq(px / art.w, py / art.h, mark.motion, mark.size || { w: art.w, h: art.h }, mf);
  const mNest = mark.nest?.id || null;
  const fNest = film.nest?.id || null;
  if (mNest !== fNest) {
    // Out of the mark's nest into the parent…
    if (mNest && mark.nest) p = clipToSeq(p.x, p.y, mark.nest.motion, mark.nest.size, mark.nest.frame);
    // …and into the film's nest.
    if (fNest && film.nest) { const q = seqToClip(p.x, p.y, film.nest.motion, film.nest.size, film.nest.frame); p = { x: q.u, y: q.v }; }
  }
  const q = seqToClip(p.x, p.y, film.motion, film.size, ff);
  return { u: q.u, v: q.v };
}

// The spot a mark makes on a cut's film: { t, x, y, kind, size } (x / y normalized
// to the film, size a fraction of its height, t in game seconds; from "premiere"
// so a re-import never overwrites a mark placed in the Film Manager), or null.
export function markSpot(film, mark) {
  const name = String(mark.file || "").replace(/\.[^.]+$/, "").toLowerCase();
  const art = MARK_ART[name];
  if (!art || mark.motion?.x == null || mark.motion?.y == null) return null;
  // t = where the mark ENDS (user, 2026-11-25, Xavier Griffin): a mark shows
  // from the play's start until t, so it's the moment the PNG leaves the
  // timeline — the end of its clip, kept inside the cut. (It was the PNG's
  // start, which sits on the cut's first frame — the mark never showed.)
  const span = Math.max(0, film.end - film.start) || Math.max(0, film.out - film.in);
  const t = Math.round((film.in + Math.min(span, Math.max(0, (mark.end ?? mark.start) - film.start))) * 100) / 100;
  const fw = film.size?.w || film.frame?.w || 1280;
  const fh = film.size?.h || film.frame?.h || 720;
  if (name === "arrow") {
    const tip = markPointOnFilm(art.tipX, art.tipY, mark, film, art);
    const top = markPointOnFilm(art.tipX, art.topY, mark, film, art);
    if (!tip || !top) return null;
    const len = Math.abs(tip.v - top.v); // a fraction of the film's height
    return { t, x: tip.u, y: tip.v, kind: "arrow", size: Math.round((len / 2.2) * 10000) / 10000, from: "premiere" };
  }
  const c = markPointOnFilm(art.cx, art.cy, mark, film, art);
  const e = markPointOnFilm(art.cx + art.r, art.cy, mark, film, art);
  if (!c || !e) return null;
  const r = (Math.abs(e.u - c.u) * fw) / fh;
  return { t, x: c.u, y: c.v, kind: "circle", size: Math.round(r * 10000) / 10000, from: "premiere" };
}

// → [{ seq, file, path, gameId, in, out, spot | null, mark, scale, size, animated, offFrame }]
// parsed: parsePrproj(); seqIds: the sequences to take (all with film if empty).
export function legacyCuts(parsed, seqIds = []) {
  const seqs = parsed.sequences.filter((s) => (seqIds.length ? seqIds.includes(s.id) : s.plays.some((p) => VIDEO.test(p.file))));
  const out = [];
  seqs.forEach((s) => {
    const all = s.plays.filter((p) => VIDEO.test(p.file));
    const marks = s.plays.filter((p) => MARK_FILES.test(p.file));
    // Trim leftovers (user, 2026-11-25): a sliver of film inside another cut
    // of the same game (left over when a clip was resized on the timeline —
    // the circle stays put while the film moves). Not a play of its own; its
    // circle belongs to the full cut.
    const containerOf = (c) => all.find((o) => o !== c && o.file === c.file && o.in <= c.in + 0.05 && o.out >= c.out - 0.05 && o.out - o.in > c.out - c.in + 0.1) || null;
    const film = all.filter((c) => !containerOf(c));
    const overlap = (c, m) => Math.min(c.end, m.end) - Math.max(c.start, m.start);
    // Each mark → the cut it's on: the one it covers most (a leftover counts as its full cut).
    const markFor = new Map();
    marks.forEach((m) => {
      // The film in the mark's own sequence / nest first (a stack of clips on other
      // tracks — a screen recording under it — mustn't take its circle).
      const near = all.filter((c) => overlap(c, m) > 0.01);
      const same = near.filter((c) => (c.nest?.id || null) === (m.nest?.id || null));
      const over = (same.length ? same : near).map((c) => ({ c, host: containerOf(c) || c, o: overlap(c, m) }));
      if (!over.length) return;
      const byHost = new Map();
      over.forEach(({ host, o }) => byHost.set(host, (byHost.get(host) || 0) + o));
      // A leftover beside its own full cut: the full cut (where the play starts).
      const host = [...byHost.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const prev = markFor.get(host);
      if (!prev || m.start < prev.start) markFor.set(host, m);
    });
    film.forEach((f) => {
      const m = markFor.get(f) || null;
      const spot = m ? markSpot(f, m) : null;
      const animated = !!(f.motion?.keyed || m?.motion?.keyed || f.nest?.motion?.keyed || m?.nest?.motion?.keyed);
      out.push({
        seq: s.name, file: f.file, path: f.path, gameId: gameIdOf(f.file), in: f.in, out: f.out, spot,
        mark: m ? m.file.replace(/\.[^.]+$/, "").toLowerCase() : "", scale: f.motion?.scale ?? 100, size: f.size || null,
        animated, offFrame: !!spot && (spot.x < 0 || spot.x > 1 || spot.y < 0 || spot.y > 1),
      });
    });
  });
  // The same cut in two sequences: kept once — the copy with a mark if there is one, else the first.
  const same = (a, b) => a.gameId === b.gameId && Math.abs(a.in - b.in) < 0.25;
  return out.filter((c, i) => {
    const twins = out.filter((d) => same(d, c));
    const keep = twins.find((d) => d.spot) || twins[0];
    return out.indexOf(keep) === i;
  });
}

// A play already in the library for this cut (same game, in within a quarter second).
export const sameCut = (plays, cut) => plays.find((p) => p.gameId === cut.gameId && Math.abs(p.in - cut.in) < 0.25) || null;
