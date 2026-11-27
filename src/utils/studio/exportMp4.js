// src/utils/studio/exportMp4.js
//
// The Breakdown Studio's export: the finished video, rendered in the
// browser and written straight to a file the admin picks — nothing is
// uploaded, nothing costs anything (user, 2026-11-25).
//
// Mediabunny (npm "mediabunny", loaded only when exporting) reads the MP4s
// and writes the result over WebCodecs — the graphics card's H.264 encoder.
// Each frame: the face cam's frame and the play's frame (decoded from the
// full-game MP4 at exactly the play's source time — sequential decoding, so
// a play is decoded once), drawn into their windows, then the breakdown
// frame and any asset over them. Audio: the face cam's, re-encoded once to
// AAC. One encode from the originals, at a high bitrate — the same single
// generation a Premiere export makes.
import { filmAt } from "./timeline";

export const EXPORT = { fps: 30, videoBitrate: 16_000_000, audioBitrate: 192_000, width: 1920, height: 1080 };

// The source rect that covers a box (center crop).
export function coverRect(sw, sh, box) {
  const s = Math.max(box.w / sw, box.h / sh);
  const w = box.w / s;
  const h = box.h / s;
  return [(sw - w) / 2, (sh - h) / 2, w, h];
}

// Draws a video frame (an HTMLVideoElement, or a mediabunny VideoSample) to cover a box.
export function drawCover(ctx, src, box) {
  if (!src) return;
  if (typeof src.draw === "function" && src.displayWidth) {
    const [sx, sy, sw, sh] = coverRect(src.displayWidth, src.displayHeight, box);
    src.draw(ctx, sx, sy, sw, sh, box.x, box.y, box.w, box.h);
    return;
  }
  const vw = src.videoWidth || src.width;
  const vh = src.videoHeight || src.height;
  if (!vw || !vh) return;
  const [sx, sy, sw, sh] = coverRect(vw, vh, box);
  ctx.drawImage(src, sx, sy, sw, sh, box.x, box.y, box.w, box.h);
}

/**
 * Renders the video to `writable` (a FileSystemWritableFileStream).
 * opts: { duration, faceFile, files: { path: File }, layout (filmLayout),
 *   boxesAt(t) → { VID, FACE, hold? } (the windows then; hold: no play on,
 *   keep the last film frame up), overlayAt(t) → Promise<CanvasImageSource|null> (the breakdown
 *   frame), assetAt(t) → Promise<CanvasImageSource|null>, onProgress({ i, n,
 *   status }), isCancelled() }
 */
export async function exportMp4(writable, opts) {
  const MB = await import("mediabunny");
  const { duration, faceFile, files, layout, boxesAt, overlayAt, assetAt, onProgress = () => {}, isCancelled = () => false } = opts;
  const { fps, width, height } = EXPORT;
  const n = Math.max(1, Math.round(duration * fps));
  onProgress({ i: 0, n, status: "Opening the files…" });

  const open = (file) => new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
  const face = open(faceFile);
  const faceVideo = await face.getPrimaryVideoTrack();
  const faceAudio = await face.getPrimaryAudioTrack();
  if (!faceVideo) throw new Error("the face cam file has no video track");

  // One reader a game file, opened when first needed.
  const sinks = {};
  const sinkFor = async (path) => {
    if (!sinks[path]) {
      const file = files[path];
      if (!file) throw new Error(`missing film: ${path.split(/[\\/]/).pop()}`);
      const track = await open(file).getPrimaryVideoTrack();
      if (!track) throw new Error(`no video in ${file.name}`);
      sinks[path] = new MB.VideoSampleSink(track);
    }
    return sinks[path];
  };

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const output = new MB.Output({ format: new MB.Mp4OutputFormat(), target: new MB.StreamTarget(writable, { chunked: true }) });
  const video = new MB.CanvasSource(canvas, { codec: "avc", bitrate: EXPORT.videoBitrate, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: fps });
  let audio = null;
  if (faceAudio) {
    audio = new MB.AudioBufferSource({ codec: "aac", bitrate: EXPORT.audioBitrate });
    output.addAudioTrack(audio);
  }
  await output.start();

  const times = (from, to) => { const a = []; for (let i = from; i < to; i += 1) a.push(i / fps); return a; };
  const faceIt = new MB.VideoSampleSink(faceVideo).samplesAtTimestamps(times(0, n));
  const audioIt = faceAudio ? new MB.AudioBufferSink(faceAudio).buffers(0, duration) : null;
  let audioAt = 0;
  let audioDone = !audioIt;
  const pumpAudio = async (until) => {
    while (!audioDone && audioAt < until) {
      const r = await audioIt.next(); // eslint-disable-line no-await-in-loop
      if (r.done) { audioDone = true; break; }
      await audio.add(r.value.buffer); // eslint-disable-line no-await-in-loop
      audioAt = r.value.timestamp + r.value.duration;
    }
  };

  // The play on screen: its sample iterator, made when it starts.
  let cur = null;
  let last = null; // the last film frame, full size
  try {
    for (let i = 0; i < n; i += 1) {
      if (isCancelled()) throw new Error("cancelled");
      const t = i / fps;
      await pumpAudio(t + 1); // eslint-disable-line no-await-in-loop
      const hit = filmAt(layout, t);
      if (!hit || hit.item !== cur?.item) {
        if (cur) await cur.it.return?.(); // eslint-disable-line no-await-in-loop
        cur = null;
        if (hit) {
          // Every output frame inside this play → its source time.
          let j = i;
          const src = [];
          while (j < n && j / fps < hit.item.end) { src.push(hit.item.in + (j / fps - hit.item.start)); j += 1; }
          const sink = await sinkFor(hit.item.src.path); // eslint-disable-line no-await-in-loop
          cur = { item: hit.item, it: sink.samplesAtTimestamps(src) };
        }
      }
      const [fr, pl, ov, as] = await Promise.all([ // eslint-disable-line no-await-in-loop
        faceIt.next(), cur ? cur.it.next() : null, overlayAt(t), assetAt(t),
      ]);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      const playSample = pl?.value || null;
      const faceSample = fr?.value || null;
      const { VID, FACE, hold } = boxesAt(t);
      if (playSample) {
        // Kept (as the last film frame) for a hold — the zoom out of the intro.
        if (!last) { last = document.createElement("canvas"); last.width = width; last.height = height; }
        drawCover(last.getContext("2d"), playSample, { x: 0, y: 0, w: width, h: height });
        drawCover(ctx, last, VID);
      } else if (hold && last) drawCover(ctx, last, VID);
      if (faceSample) drawCover(ctx, faceSample, FACE);
      playSample?.close();
      faceSample?.close();
      if (ov) ctx.drawImage(ov, 0, 0, width, height);
      if (as) ctx.drawImage(as, 0, 0, width, height);
      await video.add(t, 1 / fps); // eslint-disable-line no-await-in-loop
      if (i % 15 === 0) onProgress({ i, n, status: `Frame ${i + 1} of ${n}` });
    }
    await pumpAudio(Infinity);
    onProgress({ i: n, n, status: "Finishing the file…" });
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    if (cur) await cur.it.return?.().catch(() => {});
    await faceIt.return?.().catch(() => {});
  }
}
