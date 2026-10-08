// server/broadcast-worker/encoder.js
//
// FFmpeg: JPEG frames on stdin at a constant rate → video-only H.264.
// Live-stream settings (YouTube's 1080p30 guidance): High profile, yuv420p,
// constant-ish bitrate capped by maxrate/bufsize, a keyframe every 2s
// exactly (no scene-cut keyframes), no audio track.
//
// The output container follows the file extension: .mp4 is written
// fragmented so the file stays playable even if the process is killed
// mid-game; .ts and .flv are streamable as-is (flv is what RTMP carries).
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const p = require("ffmpeg-static");
    if (p && fs.existsSync(p)) return p;
  } catch { /* fall through to PATH */ }
  return "ffmpeg";
}

function containerArgs(out) {
  const ext = path.extname(out).toLowerCase();
  if (ext === ".mp4" || ext === ".mov") return ["-movflags", "+frag_keyframe+empty_moov+default_base_moof", "-f", "mp4"];
  if (ext === ".ts") return ["-f", "mpegts"];
  if (ext === ".flv") return ["-f", "flv"];
  return [];
}

function encoderArgs({ fps, width, height, bitrateKbps, threads, out }) {
  const gop = Math.round(fps * 2);
  return [
    "-hide_banner", "-loglevel", "warning", "-nostats",
    "-progress", "pipe:2", "-stats_period", "5",
    // Input: a stream of JPEGs, one per output frame.
    "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "pipe:0",
    // Video only.
    "-an", "-sn", "-dn",
    "-vf", `scale=${width}:${height},format=yuv420p`,
    "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-level:v", "4.1",
    "-b:v", `${bitrateKbps}k`, "-maxrate", `${bitrateKbps}k`, "-bufsize", `${bitrateKbps * 2}k`,
    "-r", String(fps), "-g", String(gop), "-keyint_min", String(gop), "-sc_threshold", "0", "-bf", "2",
    // x264 sizes its thread pool (and memory) to the whole machine by default;
    // a fixed count keeps each stream's footprint predictable on a shared VM.
    ...(threads > 0 ? ["-threads", String(threads)] : []),
    ...containerArgs(out),
    "-y", out,
  ];
}

// Returns { proc, write, backlog, progress, finish }.
function startEncoder(cfg, log) {
  if (!/^[a-z]+:\/\//i.test(cfg.out)) fs.mkdirSync(path.dirname(cfg.out), { recursive: true });
  const bin = ffmpegPath();
  const args = encoderArgs(cfg);
  log(`ffmpeg: ${bin}`);
  // detached: its own process group, so Ctrl+C reaches only the worker,
  // which then ends FFmpeg's input cleanly and lets it finish the file.
  const proc = spawn(bin, args, { stdio: ["pipe", "ignore", "pipe"], detached: true, windowsHide: true });
  proc.stdin.on("error", () => { /* EPIPE once FFmpeg has exited; reported via 'exit' */ });

  const progress = {};
  let buf = "";
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.search(/[\r\n]/)) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const m = /^([a-z0-9_]+)=(.*)$/.exec(line);
      if (m) progress[m[1]] = m[2].trim();
      // MJPEG decodes to full-range yuvj420p; swscale converts it to TV range
      // correctly but warns about the pixel format's name every time.
      else if (!/deprecated pixel format|Last message repeated/.test(line)) log(`ffmpeg: ${line}`);
    }
  });

  const exited = new Promise((resolve) => proc.on("exit", (code, signal) => resolve({ code, signal })));

  return {
    proc,
    exited,
    progress,
    write: (frame) => { if (proc.stdin.writable) proc.stdin.write(frame); },
    backlog: () => proc.stdin.writableLength,
    // End the input and wait for FFmpeg to flush and close the file.
    async finish(timeoutMs = 20000) {
      if (proc.exitCode == null) proc.stdin.end();
      const t = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
      const r = await exited;
      clearTimeout(t);
      return r;
    },
  };
}

module.exports = { startEncoder, encoderArgs, ffmpegPath };
