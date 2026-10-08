#!/usr/bin/env node
// server/broadcast-worker/test.js
//
// End-to-end check: run the worker for a fixed time against a real game
// replaying through the broadcast page, then verify the file it wrote:
//
//   - H.264, 1920×1080, 30fps, video only (no audio stream)
//   - decodes start to finish with no errors
//   - frame count and duration match the wall-clock run (±2%), no drops
//   - the scoreboard, clock, recent plays and team stats each visibly
//     change over the run (frames every 20s, compared region by region)
//   - no Chromium left running once the worker has exited
//
//   node test.js [--game <slug>] [--replay <sec>] [--duration <sec>] [--base <url>]
//
// Needs the site running (npm start in the repo root). Output goes to
// OUTPUT_DIR (default ./output; /out in the container). Exit 0 = pass.
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { parseFlags, outputDir } = require("./config");
const { ffmpegPath } = require("./encoder");
const procStats = require("./procStats");

const f = parseFlags(process.argv.slice(2));
const GAME = f.game || process.env.GAME_ID || "clemson-vs-lsu-9-5-2026";
const REPLAY = f.replay || "4";
const DURATION = Number(f.duration || 120);
const BASE = f.base || process.env.BASE_URL || "http://localhost:3000";
const FPS = Number(f.fps || 30);
const OUT_DIR = outputDir();
const OUT = path.join(OUT_DIR, "broadcast-test.mp4");
const STILLS = path.join(OUT_DIR, "stills");
const STILL_EVERY = 20;

// Regions of the 1920×1080 frame (BroadcastScreen's fixed layout), checked
// at quarter size (480×270) for change between stills.
const REGIONS = {
  score: { rects: [{ x: 660, y: 165, w: 150, h: 120 }, { x: 1120, y: 165, w: 140, h: 120 }], minChanges: 1 }, // the two score digits
  clock: { rects: [{ x: 824, y: 190, w: 272, h: 110 }], minChanges: 3 },
  "recent plays": { rects: [{ x: 64, y: 840, w: 1150, h: 120 }], minChanges: 3 },
  "team stats": { rects: [{ x: 1246, y: 560, w: 610, h: 380 }], minChanges: 3 },
};
const Q = 4; // downscale factor
const CHANGE_MAD = 1.5; // mean abs gray-level difference that counts as a change (encoder noise is < 0.5)

function ffmpeg(args, binary = false) {
  return new Promise((resolve) => {
    execFile(ffmpegPath(), args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: binary ? "buffer" : "utf8" },
      (err, stdout, stderr) => resolve({ code: err ? err.code || 1 : 0, stdout, stderr: String(stderr) }));
  });
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };

// Mean absolute gray-level difference over a region's rects; the largest
// rect's value, so one score changing counts even if the other doesn't.
function regionDiff(a, b, region) {
  const W = 1920 / Q;
  return Math.max(...region.rects.map((r) => {
    let sum = 0, n = 0;
    for (let y = Math.floor(r.y / Q); y < Math.floor((r.y + r.h) / Q); y++) {
      for (let x = Math.floor(r.x / Q); x < Math.floor((r.x + r.w) / Q); x++) {
        sum += Math.abs(a[y * W + x] - b[y * W + x]);
        n++;
      }
    }
    return sum / n;
  }));
}

async function main() {
  // The site must be up.
  try {
    const r = await fetch(BASE, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error(`The site isn't reachable at ${BASE} (${e.message}).\nStart it first, in another terminal, from the repo root:\n\n  npm start\n`);
    process.exit(2);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.rmSync(STILLS, { recursive: true, force: true });
  fs.mkdirSync(STILLS, { recursive: true });

  console.log(`Running the worker for ${DURATION}s: ${GAME}, a play every ${REPLAY}s\n`);
  const started = Date.now();
  let log = "";
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(__dirname, "worker.js"), "--mode", "file", // never YouTube, whatever the env says
      "--game", GAME, "--base", BASE, "--replay", REPLAY, "--duration", String(DURATION), "--fps", String(FPS), "--out", OUT],
    { stdio: ["ignore", "pipe", "inherit"] });
    p.stdout.on("data", (d) => { process.stdout.write(d); log += d; });
    p.on("exit", (c) => resolve(c));
  });
  const wallSec = (Date.now() - started) / 1000;
  console.log("");
  check("worker exited cleanly", code === 0, `exit code ${code}`);
  check("Chromium launched and the page loaded", /page ready: game \d+, phase (live|pregame|halftime|final|delayed)/.test(log),
    (/page ready: .*/.exec(log) || ["no 'page ready' line"])[0]);
  const left = await procStats.playwrightChromium();
  check("no Chromium processes left after exit", left.length === 0, left.length ? `pids ${left.join(", ")}` : "none");
  if (!fs.existsSync(OUT)) { check("output file exists", false, OUT); return finish(); }

  // Stream info.
  const probe = await ffmpeg(["-hide_banner", "-i", OUT]);
  const video = /Stream #\S+.*Video: (.*)/.exec(probe.stderr)?.[1] || "";
  check("video stream is H.264", /^h264/.test(video), video.split(",")[0]);
  check("1920×1080", /\b1920x1080\b/.test(video), (/\b\d{3,5}x\d{3,5}\b/.exec(video) || [])[0]);
  const fps = Number((/([\d.]+) fps/.exec(video) || [])[1]);
  check(`${FPS} fps`, Math.abs(fps - FPS) < 0.01, `${fps} fps`);
  check("no audio stream", !/Stream #\S+.*Audio:/.test(probe.stderr));

  // Full decode: errors + frame count.
  const dec = await ffmpeg(["-hide_banner", "-v", "error", "-progress", "pipe:1", "-i", OUT, "-map", "0:v:0", "-f", "null", "-"]);
  const frames = Number([...dec.stdout.matchAll(/^frame=(\d+)/gm)].pop()?.[1] || 0);
  check("decodes with no errors", dec.code === 0 && !dec.stderr.trim(), dec.stderr.trim().split("\n")[0]);
  const videoSec = frames / FPS;
  const summary = JSON.parse(fs.readFileSync(`${OUT}.stats.json`, "utf8"));
  // The worker's encoding window is a little shorter than the whole run
  // (Chromium startup, page load); compare to frames it wrote.
  check("frame count matches the frames written", Math.abs(frames - (summary.frames.written - summary.frames.dropped)) <= 2,
    `${frames} in file, ${summary.frames.written - summary.frames.dropped} written`);
  const encodeSec = summary.frames.written / FPS;
  check("video length tracks wall clock (±2%)", Math.abs(videoSec - encodeSec) / encodeSec <= 0.02 && videoSec <= wallSec,
    `${videoSec.toFixed(1)}s of video, ${encodeSec.toFixed(1)}s encoding, ${wallSec.toFixed(1)}s total run`);
  check("no frames dropped", summary.frames.dropped === 0, `${summary.frames.dropped} dropped`);
  check("every stats sample at 30 fps out", summary.samples.every((s) => Math.abs(s.outFps - FPS) < 0.5),
    `min ${Math.min(...summary.samples.map((s) => s.outFps)).toFixed(2)}`);

  // Stills every 20s (PNG to look at + quarter-size gray to compare).
  const grays = [];
  for (let t = 5; t < videoSec - 1; t += STILL_EVERY) {
    const name = `t${String(t).padStart(4, "0")}`;
    await ffmpeg(["-hide_banner", "-v", "error", "-ss", String(t), "-i", OUT, "-frames:v", "1", "-y", path.join(STILLS, `${name}.png`)]);
    const g = await ffmpeg(["-hide_banner", "-v", "error", "-ss", String(t), "-i", OUT, "-frames:v", "1",
      "-vf", `scale=${1920 / Q}:${1080 / Q},format=gray`, "-f", "rawvideo", "-"], true);
    if (g.stdout.length === (1920 / Q) * (1080 / Q)) grays.push(g.stdout);
  }
  for (const [name, r] of Object.entries(REGIONS)) {
    let changes = 0;
    for (let i = 1; i < grays.length; i++) if (regionDiff(grays[i - 1], grays[i], r) > CHANGE_MAD) changes++;
    check(`${name} updates`, changes >= r.minChanges, `changed in ${changes} of ${Math.max(0, grays.length - 1)} ${STILL_EVERY}s intervals`);
  }

  const r = (x) => (x == null ? "?" : Math.round(x));
  console.log(`\nAverages over ${summary.samples.length} samples on ${summary.cores} logical cores (100% = one core):`
    + `\n  fps out ${summary.avgOutFps?.toFixed(2)}, new frames ${summary.avgUniqueFps?.toFixed(2)}/s avg, ${summary.peakUniqueFps}/s in the busiest second`
    + `\n  CPU  chromium ${r(summary.cpuPctAvg.chromium)}% (max ${r(summary.cpuPctMax.chromium)}%), ffmpeg ${r(summary.cpuPctAvg.ffmpeg)}% (max ${r(summary.cpuPctMax.ffmpeg)}%), node ${r(summary.cpuPctAvg.node)}%`
    + `\n  RAM  chromium ${r(summary.rssMbAvg.chromium)}MB (max ${r(summary.rssMbMax.chromium)}), ffmpeg ${r(summary.rssMbAvg.ffmpeg)}MB (max ${r(summary.rssMbMax.ffmpeg)}), node ${r(summary.rssMbAvg.node)}MB`
    + `\n  frames ${JSON.stringify(summary.frames)}`
    + `\n  stills: ${STILLS}`);
  return finish();
}

function finish() {
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${failed.length ? `FAILED (${failed.length} of ${results.length})` : `ALL ${results.length} CHECKS PASSED`} — output: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
