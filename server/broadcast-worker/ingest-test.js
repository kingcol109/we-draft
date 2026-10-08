#!/usr/bin/env node
// server/broadcast-worker/ingest-test.js
//
// YouTube mode against a local stand-in for YouTube's ingest: FFmpeg
// listening as an RTMP server on 127.0.0.1, saving what it receives. A
// random throwaway key is used; no real key, nothing leaves the machine.
//
//   1. stream    the worker in OUTPUT_MODE=youtube for --duration seconds,
//                then checks what arrived:
//                  - exactly one video + one audio stream
//                  - video: H.264 High, 1920×1080, 30 fps, keyframe every 2s
//                  - audio: AAC, 48 kHz stereo, completely silent, covering
//                    the whole stream
//                  - decodes with no errors; worker exit 0; no video file
//                    written by the worker; the key in no log or summary
//   2. refused   the ingest down → worker exits 1, key not in the log
//   3. stalled   the ingest accepts and then hangs → worker exits 1
//
//   node ingest-test.js [--duration 60] [--game <slug>] [--base <url>] [--only stream]
//
// Needs the site running (npm start in the repo root). Exit 0 = pass.
const { spawn, execFile } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { parseFlags, outputDir } = require("./config");
const { ffmpegPath } = require("./encoder");

const f = parseFlags(process.argv.slice(2));
const GAME = f.game || process.env.GAME_ID || "clemson-vs-lsu-9-5-2026";
const BASE = f.base || process.env.BASE_URL || "http://localhost:3000";
const DURATION = Number(f.duration || 60);
const FPS = 30;
const DIR = path.join(outputDir(), "ingest");
const KEY = `test-${crypto.randomBytes(8).toString("hex")}`;

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function ffmpeg(args) {
  return new Promise((resolve) => {
    execFile(ffmpegPath(), args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code || 1 : 0, stdout: String(stdout), stderr: String(stderr) }));
  });
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// The worker in YouTube mode, pointed at rtmp://127.0.0.1:<port>/live2.
function runWorker(port, extra = []) {
  return new Promise((resolve) => {
    let log = "";
    const p = spawn(process.execPath, [path.join(__dirname, "worker.js"), "--mode", "youtube", "--game", GAME, "--base", BASE, "--replay", "4", ...extra], {
      env: { ...process.env, OUTPUT_DIR: DIR, YOUTUBE_STREAM_URL: `rtmp://127.0.0.1:${port}/live2`, YOUTUBE_STREAM_KEY: KEY, YOUTUBE_STREAM_KEY_FILE: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const on = (d) => { log += d; };
    p.stdout.on("data", on);
    p.stderr.on("data", on);
    p.on("exit", (code) => resolve({ code, log }));
  });
}

async function streamTest() {
  console.log(`\n1. Streaming to a local RTMP receiver for ${DURATION}s`);
  const port = await freePort();
  const received = path.join(DIR, "received.flv");
  fs.rmSync(received, { force: true });
  const rx = spawn(ffmpegPath(), ["-hide_banner", "-v", "error", "-listen", "1", "-i", `rtmp://127.0.0.1:${port}/live2/${KEY}`, "-c", "copy", "-f", "flv", "-y", received],
    { stdio: "ignore", windowsHide: true });
  const rxDone = new Promise((r) => rx.on("exit", r));
  await wait(1000);
  const before = new Set(fs.readdirSync(DIR));
  const w = await runWorker(port, ["--duration", String(DURATION)]);
  await Promise.race([rxDone, wait(15000).then(() => rx.kill("SIGKILL"))]);
  const added = fs.readdirSync(DIR).filter((x) => !before.has(x) && x !== "received.flv");
  fs.writeFileSync(path.join(DIR, "stream-worker.log"), w.log);

  check("worker exited cleanly", w.code === 0, `exit ${w.code}; "${(/stopping: (.*)/.exec(w.log) || [, "?"])[1]}"`);
  check("worker logs silent AAC", /\[youtube\].*silent AAC 128kbps/.test(w.log));
  check("worker wrote no video file, only a stats summary", added.every((x) => /^youtube-.*\.stats\.json$/.test(x)), added.join(", ") || "nothing");
  const summaries = added.map((x) => fs.readFileSync(path.join(DIR, x), "utf8")).join("");
  check("stream key in no log or summary", !w.log.includes(KEY) && !summaries.includes(KEY));
  if (!fs.existsSync(received)) { check("receiver got the stream", false, "nothing received"); return; }

  const probe = await ffmpeg(["-hide_banner", "-i", received]);
  const streams = [...probe.stderr.matchAll(/Stream #\S+: (Video|Audio|Data|Subtitle): (.*)/g)];
  const video = streams.filter((s) => s[1] === "Video");
  const audio = streams.filter((s) => s[1] === "Audio");
  check("exactly one video and one audio stream", streams.length === 2 && video.length === 1 && audio.length === 1,
    streams.map((s) => s[1]).join(" + ") || "none");
  const v = video[0]?.[2] || "";
  const a = audio[0]?.[2] || "";
  check("video H.264 High", /^h264 \(High\)/.test(v), v.split(",")[0]);
  check("video 1920×1080", /\b1920x1080\b/.test(v), (/\b\d{3,5}x\d{3,5}\b/.exec(v) || [])[0]);
  check("video 30 fps", /\b30 fps\b/.test(v), (/[\d.]+ fps/.exec(v) || [])[0]);
  check("audio AAC 48 kHz stereo", /^aac/.test(a) && /48000 Hz/.test(a) && /stereo/.test(a), a.split(",").slice(0, 3).join(","));

  const keys = await ffmpeg(["-hide_banner", "-skip_frame", "nokey", "-i", received, "-map", "0:v:0", "-vf", "showinfo", "-f", "null", "-"]);
  const kt = [...keys.stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  const gaps = kt.slice(1).map((t, i) => t - kt[i]);
  check("keyframe every 2s", gaps.length > 0 && gaps.every((g) => Math.abs(g - 2) < 0.05), `${kt.length} keyframes, gaps ${[...new Set(gaps.map((g) => g.toFixed(2)))].join("/")}s`);

  // Each stream decoded separately: errors, length, loudness.
  const dv = await ffmpeg(["-hide_banner", "-v", "error", "-progress", "pipe:1", "-i", received, "-map", "0:v:0", "-f", "null", "-"]);
  const frames = Number([...dv.stdout.matchAll(/^frame=(\d+)/gm)].pop()?.[1] || 0);
  const da = await ffmpeg(["-hide_banner", "-v", "info", "-progress", "pipe:1", "-i", received, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"]);
  const audioSec = Number([...da.stdout.matchAll(/^out_time_us=(\d+)/gm)].pop()?.[1] || 0) / 1e6;
  const videoSec = frames / FPS;
  check("decodes with no errors", dv.code === 0 && !dv.stderr.trim() && da.code === 0, dv.stderr.trim().split("\n")[0]);
  check("video length matches the run", Math.abs(videoSec - DURATION) <= 1, `${frames} frames = ${videoSec.toFixed(2)}s`);
  check("audio runs the whole stream", Math.abs(audioSec - videoSec) <= 0.5, `audio ${audioSec.toFixed(2)}s, video ${videoSec.toFixed(2)}s`);
  // AAC of digital zero decodes to zero: volumedetect reports -91 dB (its floor).
  const maxDb = Number((/max_volume: (-?[\d.]+|-inf) dB/.exec(da.stderr) || [, "NaN"])[1].replace("-inf", "-999"));
  const meanDb = (/mean_volume: (-?[\d.]+|-inf) dB/.exec(da.stderr) || [, "?"])[1];
  check("audio is completely silent", maxDb <= -90, `max ${maxDb} dB, mean ${meanDb} dB`);
}

async function refusedTest() {
  console.log("\n2. Ingest refuses the connection");
  const w = await runWorker(await freePort());
  check("worker exits 1", w.code === 1, `exit ${w.code}; "${(/stopping: (.*)/.exec(w.log) || [, "?"])[1]}"`);
  check("stream key not in the log", !w.log.includes(KEY) && /<stream key>/.test(w.log));
}

async function stalledTest() {
  console.log("\n3. Ingest accepts, then hangs");
  const sockets = new Set();
  const server = net.createServer((s) => { sockets.add(s); s.on("error", () => {}); s.pause(); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const w = await runWorker(server.address().port);
  sockets.forEach((s) => s.destroy());
  server.close();
  check("worker exits 1 on the stall", w.code === 1 && /ffmpeg stalled/.test(w.log), `exit ${w.code}; "${(/stopping: (.*)/.exec(w.log) || [, "?"])[1]}"`);
  check("stream key not in the log", !w.log.includes(KEY));
  check("no Chromium left", /Chromium processes left: 0/.test(w.log));
}

async function main() {
  try {
    const r = await fetch(BASE, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error(`The site isn't reachable at ${BASE} (${e.message}). Start it first: npm start`);
    process.exit(2);
  }
  fs.mkdirSync(DIR, { recursive: true });
  const only = f.only ? new Set(f.only.split(",")) : null;
  if (!only || only.has("stream")) await streamTest();
  if (!only || only.has("refused")) await refusedTest();
  if (!only || only.has("stalled")) await stalledTest();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? `FAILED (${failed.length} of ${results.length})` : `ALL ${results.length} CHECKS PASSED`} — ${DIR}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
