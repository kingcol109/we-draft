// server/broadcast-worker/config.js
//
// Worker settings from CLI flags (--name value / --name=value) with env
// fallbacks, so the same worker runs from a terminal locally and from a
// container's env later. Flags win over env.
//
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

function loadConfig(argv = process.argv.slice(2), env = process.env) {
  const f = parseFlags(argv);
  const pick = (flag, envName) => f[flag] ?? env[envName];
  const out = pick("out", "OUTPUT") || path.join(outputDir(env), "broadcast-test.mp4");
  return {
    url: broadcastUrl({
      url: pick("url", "BROADCAST_URL"),
      game: pick("game", "GAME_ID"),
      base: pick("base", "BASE_URL") || "http://localhost:3000",
      replay: pick("replay", "REPLAY"),
    }),
    out: path.resolve(out),
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
