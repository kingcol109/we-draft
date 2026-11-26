// src/utils/studio/prproj.js
//
// Reads a Premiere Pro project (.prproj) for the Breakdown Studio (user,
// 2026-11-25): the user already cuts each player's plays out of full-game
// MP4s into sequences in that player's Premiere project, and the studio
// reuses that work instead of re-marking anything.
//
// A .prproj is gzipped XML: a flat list of objects that point at each other
// by ObjectRef (ObjectID) / ObjectURef (ObjectUID). The chain for a play:
//   Sequence → TrackGroups → VideoTrackGroup → Tracks → VideoClipTrack
//     → ClipItems → VideoClipTrackItem (Start / End on the timeline)
//     → SubClip → VideoClip (InPoint / OutPoint in the source)
//     → VideoMediaSource → Media (ActualMediaFilePath — the game's MP4)
// Times are Premiere ticks: 254,016,000,000 a second. A sequence's name is
// on the MasterClip whose VideoSequenceSource points at it. Nested
// sequences (a track item whose clip is another sequence) are flattened
// into their plays. Pure: give it the XML text and a DOMParser.

export const TICKS = 254016000000;
const sec = (t) => (t == null || t === "" ? 0 : Number(t) / TICKS);

// gzip bytes → text (the browser's DecompressionStream; a plain-XML project passes through).
export async function prprojText(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return new TextDecoder().decode(u8);
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

// The file's name from a Windows or POSIX path.
export const baseName = (p) => String(p || "").split(/[\\/]/).pop();

/**
 * → { sequences: [{ id, name, duration, fps, plays: [{ start, end, in, out, file, path, name, track }] }], files: [path] }
 * Seconds throughout. plays: the video track items, in timeline order
 * (all tracks; track = its index, 0 = V1), nested sequences flattened.
 */
export function parsePrproj(xml, DOMParserImpl = typeof window !== "undefined" ? window.DOMParser : undefined) {
  const doc = new DOMParserImpl().parseFromString(xml, "text/xml");
  const root = doc.documentElement;
  const byId = {};
  const byUid = {};
  for (const el of root.children) {
    const id = el.getAttribute("ObjectID");
    const uid = el.getAttribute("ObjectUID");
    if (id) byId[id] = el;
    if (uid) byUid[uid] = el;
  }
  const ref = (el) => {
    if (!el) return null;
    const r = el.getAttribute("ObjectRef");
    if (r) return byId[r] || null;
    const u = el.getAttribute("ObjectURef");
    return u ? byUid[u] || null : null;
  };
  // A direct child by tag (one level), or a path of them.
  const kid = (el, ...tags) => tags.reduce((cur, t) => (cur ? [...cur.children].find((c) => c.tagName === t) || null : null), el);
  const text = (el, ...tags) => kid(el, ...tags)?.textContent ?? "";

  // Sequence UID → name, via the MasterClips.
  const names = {};
  for (const el of root.children) {
    if (el.tagName !== "MasterClip") continue;
    const name = text(el, "Name");
    const clips = kid(el, "Clips");
    [...(clips?.children || [])].forEach((c) => {
      const clip = ref(c);
      const src = ref(kid(clip, "Clip", "Source"));
      if (src?.tagName === "VideoSequenceSource") {
        const seqEl = kid(src, "SequenceSource", "Sequence");
        const uid = seqEl?.getAttribute("ObjectURef");
        if (uid && name) names[uid] = name;
      }
    });
  }

  // "0,0,1280,720" → { w, h }.
  const rectOf = (v) => { const p = String(v || "").split(",").map(Number); return p.length === 4 && p[2] > 0 && p[3] > 0 ? { w: p[2], h: p[3] } : null; };
  const media = (clip) => {
    const src = ref(kid(clip, "Clip", "Source"));
    if (!src) return { kind: "none" };
    if (src.tagName === "VideoSequenceSource") return { kind: "sequence", uid: kid(src, "SequenceSource", "Sequence")?.getAttribute("ObjectURef") };
    const m = ref(kid(src, "MediaSource", "Media"));
    // Its real pixel size (the media's video stream).
    const size = rectOf(text(ref(kid(m, "VideoStream")), "FrameRect"));
    return { kind: "media", path: text(m, "ActualMediaFilePath") || text(m, "FilePath"), size };
  };

  // A track item's Motion effect: Position (normalized x:y in the sequence's
  // frame), Scale (%), and whether either is keyframed. The Film Manager
  // reads circles / arrows from it, and a play's zoom (the nesting quirk).
  const motionOf = (item) => {
    const chain = ref(kid(item, "ClipTrackItem", "ComponentOwner", "Components"));
    const comps = [...(kid(chain, "ComponentChain", "Components")?.children || [])].map(ref).filter(Boolean);
    for (const c of comps) {
      const nm = text(c, "Component", "DisplayName") || text(c, "Component", "MatchName");
      if (!/motion/i.test(nm)) continue;
      const params = [...(kid(c, "Component", "Params")?.children || [])].map(ref).filter(Boolean);
      const param = (n) => params.find((x) => text(x, "Name") === n);
      const pos = param("Position");
      const sc = param("Scale");
      const [x, y] = String(text(pos, "StartKeyframe")).split(",")[1]?.split(":").map(Number) || [];
      const scale = Number(String(text(sc, "StartKeyframe")).split(",")[1]);
      const keyed = !!String(text(pos, "Keyframes")).trim() || !!String(text(sc, "Keyframes")).trim();
      // The anchor: the point of the clip (normalized to it) placed at Position.
      const [ax, ay] = String(text(param("Anchor Point"), "StartKeyframe")).split(",")[1]?.split(":").map(Number) || [];
      return { x: Number.isFinite(x) ? x : null, y: Number.isFinite(y) ? y : null, scale: Number.isFinite(scale) ? scale : null, keyed, ax: Number.isFinite(ax) ? ax : 0.5, ay: Number.isFinite(ay) ? ay : 0.5 };
    }
    return null;
  };

  const seqCache = {};
  const playsOf = (uid, depth = 0) => {
    if (seqCache[uid]) return seqCache[uid];
    const seq = byUid[uid];
    const out = { plays: [], duration: 0, fps: 30, frame: null };
    if (!seq || depth > 4) return out;
    const groups = [...(kid(seq, "TrackGroups")?.children || [])].map((g) => ref(kid(g, "Second"))).filter(Boolean);
    const vgroup = groups.find((g) => g.tagName === "VideoTrackGroup");
    if (!vgroup) return out;
    const fr = Number(text(vgroup, "TrackGroup", "FrameRate"));
    if (fr) out.fps = Math.round((TICKS / fr) * 1000) / 1000;
    // The sequence's frame (its items' Position is normalized to it).
    out.frame = rectOf(text(vgroup, "FrameRect"));
    const tracks = [...(kid(vgroup, "TrackGroup", "Tracks")?.children || [])];
    tracks.forEach((t, ti) => {
      const track = ref(t);
      const items = [...(kid(track, "ClipTrack", "ClipItems", "TrackItems")?.children || [])];
      items.forEach((it) => {
        const item = ref(it);
        if (!item || item.tagName !== "VideoClipTrackItem") return;
        const start = sec(text(item, "ClipTrackItem", "TrackItem", "Start"));
        const end = sec(text(item, "ClipTrackItem", "TrackItem", "End"));
        const sub = ref(kid(item, "ClipTrackItem", "SubClip"));
        const clip = ref(kid(sub, "Clip"));
        const inPt = sec(text(clip, "Clip", "InPoint"));
        const outPt = sec(text(clip, "Clip", "OutPoint"));
        out.duration = Math.max(out.duration, end);
        const m = media(clip);
        if (m.kind === "media" && m.path) {
          out.plays.push({ start, end, in: inPt, out: inPt + (end - start), srcOut: outPt, path: m.path, file: baseName(m.path), name: text(sub, "Name") || baseName(m.path), track: ti, motion: motionOf(item), size: m.size, frame: out.frame });
        } else if (m.kind === "sequence" && m.uid) {
          // A nested sequence: its plays, shifted to here and trimmed to this item.
          const inner = playsOf(m.uid, depth + 1).plays;
          const nest = motionOf(item);
          const innerFrame = playsOf(m.uid, depth + 1).frame;
          // The nest itself: where (and how big) it sits in this sequence — a
          // clip whose size is its own frame. The innermost is kept.
          const nestInfo = { id: item.getAttribute("ObjectID"), motion: nest, size: innerFrame, frame: out.frame };
          inner.forEach((p) => {
            const a = Math.max(p.start, inPt);
            const b = Math.min(p.end, inPt + (end - start));
            if (b - a <= 0.01) return;
            out.plays.push({ ...p, start: start + (a - inPt), end: start + (b - inPt), in: p.in + (a - p.start), out: p.in + (b - p.start), track: ti, nested: true, innerTrack: p.track, nestScale: nest?.scale ?? null, nest: p.nest || nestInfo });
          });
        }
      });
    });
    out.plays.sort((a, b) => a.start - b.start || a.track - b.track);
    seqCache[uid] = out;
    return out;
  };

  const sequences = [];
  for (const el of root.children) {
    if (el.tagName !== "Sequence") continue;
    const uid = el.getAttribute("ObjectUID");
    const s = playsOf(uid);
    sequences.push({ id: uid, name: names[uid] || "Sequence", duration: s.duration, fps: s.fps, plays: s.plays });
  }
  const files = [...new Set(sequences.flatMap((s) => s.plays.map((p) => p.path)))];
  return { sequences, files };
}
