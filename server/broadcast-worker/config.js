// server/broadcast-worker/config.js
//
// Worker settings from CLI flags (--name value / --name=value) with env
// fallbacks, so the same worker runs from a terminal locally and from a
// container's env later. Flags win over env.
//
//   --mode     OUTPUT_MODE     "file" (default) or "youtube"
//   --url      BROADCAST_URL   full broadcast URL (mode=stream is added if missing)
//   --game     GAME_ID         a /live slug or CFBD id, used with --base
//   --base     BASE_URL        site origin for --game (default http://localhost:3000)
//   --replay   REPLAY          appends &replay=<sec> (finished games, testing)
//   --out      OUTPUT          output file (.mp4 fragmented, .ts, .flv);
//                              default <OUTPUT_DIR>/broadcast-test.mp4
//              OUTPUT_DIR      default ./output (the container sets /out)
//   --fps      FPS             output frame rate (default 30)
//   --bitrate  VIDEO_BITRATE   kbps (default 6000)
//   --threads  ENCODER_THREADS x264 threads (default 4; 0 = FFmpeg decides)
//   --quality  CAPTURE_QUALITY JPEG quality of captured frames, 1-100 (default 85)
//   --duration DURATION_SEC    stop after this many seconds (default 0 = run until stopped)
//   --stats    STATS_SEC       seconds between stats lines (default 10)
//   --ready-timeout READY_TIMEOUT_SEC  max wait for the page to report ready (default 90)
//
// YouTube mode (OUTPUT_MODE=youtube) streams to YouTube Live instead of
// writing a file. Env only — never flags, never in the repo:
//
//   YOUTUBE_STREAM_URL        the ingest URL from YouTube Studio (rtmp:// or rtmps://)
//   YOUTUBE_STREAM_KEY        the stream key, or
//   YOUTUBE_STREAM_KEY_FILE   a file containing it (keeps it out of env/`docker inspect`)
//
// The key only ever appears in FFmpeg's output URL; everything that logs
// or records the target uses outLabel, and FFmpeg's own messages are
// scrubbed of it (encoder.js).
const fs = require("fs");
const path = require("path");

const WIDTH = 1920;
const HEIGHT = 1080;

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] != null && !argv[i + 1].startsWith("--")) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = "true";
  }
  return flags;
}

function num(v, dflt) {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : dflt;
}

function broadcastUrl({ url, game, base, replay }) {
  let u;
  if (url) u = new URL(url);
  else if (game) u = new URL(`/broadcast/${encodeURIComponent(game)}`, base);
  else throw new Error("No broadcast given: pass --game <slug|id> or --url <broadcast url> (or GAME_ID / BROADCAST_URL).");
  u.searchParams.set("mode", "stream");
  if (replay) u.searchParams.set("replay", String(replay));
  return u.toString();
}

function outputDir(env = process.env) {
  return path.resolve(env.OUTPUT_DIR || path.join(__dirname, "output"));
}

// YouTube ingest target. Refuses to build one from incomplete settings.
function youtubeTarget(env) {
  const url = (env.YOUTUBE_STREAM_URL || "").trim();
  let key = (env.YOUTUBE_STREAM_KEY || "").trim();
  if (!key && env.YOUTUBE_STREAM_KEY_FILE) {
    try {
      key = fs.readFileSync(env.YOUTUBE_STREAM_KEY_FILE, "utf8").trim();
    } catch (e) {
      throw new Error(`OUTPUT_MODE=youtube: can't read YOUTUBE_STREAM_KEY_FILE (${e.code || e.message}).`);
    }
  }
  const missing = [!url && "YOUTUBE_STREAM_URL", !key && "YOUTUBE_STREAM_KEY (or YOUTUBE_STREAM_KEY_FILE)"].filter(Boolean);
  if (missing.length) throw new Error(`OUTPUT_MODE=youtube needs ${missing.join(" and ")}. Not starting.`);
  if (!/^rtmps?:\/\/[^/\s]+\/\S*$/i.test(url)) throw new Error("YOUTUBE_STREAM_URL must be the rtmp:// or rtmps:// ingest URL from YouTube Studio (e.g. rtmps://<host>/<app>).");
  if (/[\s/]/.test(key)) throw new Error("YOUTUBE_STREAM_KEY looks wrong (contains a space or '/'). Not starting.");
  const base = url.replace(/\/+$/, "");
  return { out: `${base}/${key}`, outLabel: `${base}/<stream key>`, secret: key };
}

function loadConfig(argv = process.argv.slice(2), env = process.env) {
  const f = parseFlags(argv);
  const pick = (flag, envName) => f[flag] ?? env[envName];
  const mode = String(pick("mode", "OUTPUT_MODE") || "file").toLowerCase();
  let target;
  if (mode === "youtube") {
    target = { ...youtubeTarget(env), format: "flv" };
    // A small run summary, never video.
    target.statsPath = path.join(outputDir(env), `youtube-${new Date().toISOString().replace(/[:.]/g, "-")}.stats.json`);
  } else if (mode === "file") {
    const out = path.resolve(pick("out", "OUTPUT") || path.join(outputDir(env), "broadcast-test.mp4"));
    target = { out, outLabel: out, secret: null, format: null, statsPath: `${out}.stats.json` };
  } else {
    throw new Error(`OUTPUT_MODE must be "file" or "youtube" (got "${mode}").`);
  }
  return {
    mode,
    ...target,
    url: broadcastUrl({
      url: pick("url", "BROADCAST_URL"),
      game: pick("game", "GAME_ID"),
      base: pick("base", "BASE_URL") || "http://localhost:3000",
      replay: pick("replay", "REPLAY"),
    }),
    width: WIDTH,
    height: HEIGHT,
    fps: num(pick("fps", "FPS"), 30),
    bitrateKbps: num(pick("bitrate", "VIDEO_BITRATE"), 6000),
    threads: num(pick("threads", "ENCODER_THREADS"), 4),
    quality: Math.min(100, Math.max(1, num(pick("quality", "CAPTURE_QUALITY"), 85))),
    durationSec: num(pick("duration", "DURATION_SEC"), 0),
    statsSec: num(pick("stats", "STATS_SEC"), 10),
    readyTimeoutMs: num(pick("ready-timeout", "READY_TIMEOUT_SEC"), 90) * 1000,
  };
}

module.exports = { loadConfig, parseFlags, outputDir };
