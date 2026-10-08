#!/usr/bin/env node
// server/broadcast-worker/worker.js
//
// We-Draft broadcast worker: /broadcast/:gameId → Chromium → FFmpeg →
// continuous 1920×1080 H.264 (video only).
//
//   node worker.js --game clemson-vs-lsu-9-5-2026 --replay 4
//   BROADCAST_URL=http://localhost:3000/broadcast/<slug>?mode=stream node worker.js
//
// Runs until stopped (Ctrl+C / SIGTERM) or --duration seconds. Every
// --stats seconds it logs frame rates and the CPU/memory of Chromium,
// FFmpeg and itself; on exit it writes a summary next to the output
// (<out>.stats.json). Exit code 0 = stopped cleanly, 1 = something failed
// (a supervisor should restart it), 130 = interrupted.
//
// Options: see config.js.
const fs = require("fs");
const { performance } = require("perf_hooks");
const { loadConfig } = require("./config");
const { openBroadcast, startScreencast, chromiumPids } = require("./capture");
const { FramePump } = require("./framePump");
const { startEncoder } = require("./encoder");
const procStats = require("./procStats");

const WATCHDOG_MS = 10_000;
const WATCHDOG_FAILS = 3;
const IDLE_REFRESH_MS = 30_000;

const t0 = Date.now();
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)} +${Math.round((Date.now() - t0) / 1000)}s] ${msg}`);
const mb = (b) => Math.round(b / 1048576);

// true if p settled within ms (errors count as settled), false on timeout.
function settle(p, ms) {
  let t;
  return Promise.race([Promise.resolve(p).then(() => true, () => true), new Promise((r) => { t = setTimeout(() => r(false), ms); })])
    .finally(() => clearTimeout(t));
}

function withTimeout(p, ms, what) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} timed out`)), ms); })])
    .finally(() => clearTimeout(t));
}

async function main() {
  const cfg = loadConfig();
  log(`broadcast: ${cfg.url}`);
  log(`output:    ${cfg.out} (${cfg.width}x${cfg.height} @ ${cfg.fps}fps, H.264 ${cfg.bitrateKbps}kbps, no audio)`);

  let browser, page, enc, pump, cast;
  let stopping = false;
  const timers = [];
  const samples = [];
  let phase = null;
  let stale = null;
  let pids = []; // Chromium's processes, refreshed with the stats

  // Every step is time-boxed: a frozen renderer must not hold the exit
  // code hostage (a supervisor restarts on it).
  async function shutdown(code, reason) {
    if (stopping) return;
    stopping = true;
    timers.forEach(clearInterval);
    log(`stopping: ${reason}`);
    pump?.stop();
    if (cast) await settle(cast.stop(), 3000);
    if (enc) {
      const r = await enc.finish();
      log(`ffmpeg exited (code ${r.code}${r.signal ? `, ${r.signal}` : ""})`);
      if (r.code !== 0 && code === 0) code = 1;
    }
    if (browser && !(await settle(browser.close(), 10000))) log("Chromium didn't close within 10s");
    const left = await procStats.alive(pids.map((p) => p.pid));
    if (left.length) {
      log(`killing ${left.length} leftover Chromium process(es): ${left.join(", ")}`);
      for (const pid of left) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
    }
    if (pids.length) log(`Chromium processes left: ${(await procStats.alive(pids.map((p) => p.pid))).length}`);
    if (pump) writeSummary(cfg, pump, samples, code, reason);
    log(`exit ${code}`);
    process.exit(code);
  }
  process.on("SIGINT", () => shutdown(130, "SIGINT"));
  process.on("SIGTERM", () => shutdown(0, "SIGTERM"));

  // 1. Chromium + the broadcast page, ready.
  try {
    ({ browser, page } = await openBroadcast({ ...cfg, log }));
  } catch (e) {
    log(`could not open the broadcast: ${e.message}`);
    await browser?.close().catch(() => {});
    process.exit(1);
  }
  const info = await page.evaluate(() => ({ ...window.__BROADCAST__ }));
  phase = info.phase;
  log(`page ready: game ${info.gameId}, phase ${info.phase}`);
  browser.on("disconnected", () => shutdown(1, "Chromium disconnected"));
  page.on("crash", () => shutdown(1, "page crashed"));

  // 2. FFmpeg.
  enc = startEncoder(cfg, log);
  enc.exited.then(({ code, signal }) => {
    if (!stopping) shutdown(1, `ffmpeg exited unexpectedly (code ${code}${signal ? `, ${signal}` : ""})`);
  });

  // 3. Frames: screencast → pump (constant fps) → FFmpeg.
  pump = new FramePump({ fps: cfg.fps, sink: enc });
  let lastSourceAt = performance.now();
  cast = await startScreencast(page, cfg, (buf) => { lastSourceAt = performance.now(); pump.push(buf); });
  pump.start();
  pids = await chromiumPids(browser);
  // One parseable line for supervisors and the fault tests (faults.js).
  log(`pids ${JSON.stringify({ worker: process.pid, ffmpeg: enc.proc.pid, chromium: pids })}`);
  log("encoding");

  // Watchdog: the renderer must keep answering; a page that stops repainting
  // for a long stretch gets a fresh capture in case the screencast stalled.
  let fails = 0;
  timers.push(setInterval(async () => {
    try {
      const s = await withTimeout(page.evaluate(() => ({ ...window.__BROADCAST__ })), 5000, "page check");
      fails = 0;
      if (s.phase !== phase) { log(`phase: ${phase} → ${s.phase}`); phase = s.phase; }
      if (s.stale !== stale) { if (stale != null || s.stale) log(`live data ${s.stale ? "STALE" : "fresh"}`); stale = s.stale; }
      if (performance.now() - lastSourceAt > IDLE_REFRESH_MS) {
        await withTimeout(cast.refresh(), 5000, "refresh capture");
        log("no repaint for 30s — refreshed the frame");
      }
    } catch (e) {
      fails++;
      log(`watchdog: ${e.message} (${fails}/${WATCHDOG_FAILS})`);
      if (fails >= WATCHDOG_FAILS) shutdown(1, "page unresponsive");
    }
  }, WATCHDOG_MS));

  // Stats.
  let prev = { at: performance.now(), c: pump.counters(), cpu: new Map() };
  timers.push(setInterval(async () => {
    if (stopping) return;
    if (samples.length % 6 === 0) {
      const fresh = await chromiumPids(browser);
      if (fresh.length) pids = fresh;
    }
    const groups = { chromium: pids.map((p) => p.pid), ffmpeg: [enc.proc.pid], node: [process.pid] };
    const stats = await procStats.sample(Object.values(groups).flat());
    const now = performance.now();
    const dt = (now - prev.at) / 1000;
    const c = pump.counters();
    const rate = (k) => (c[k] - prev.c[k]) / dt;
    const usage = {};
    for (const [g, list] of Object.entries(groups)) {
      let cpu = 0, rss = 0, n = 0;
      for (const pid of list) {
        const s = stats.get(pid);
        if (!s) continue;
        n++;
        rss += s.rss;
        if (prev.cpu.has(pid)) cpu += s.cpuSec - prev.cpu.get(pid);
      }
      usage[g] = { cpuPct: (cpu / dt) * 100, rssMb: mb(rss), procs: n };
    }
    const sample = {
      t: Math.round((Date.now() - t0) / 1000),
      outFps: rate("written"), uniqueFps: rate("unique"), peakUniqueFps: pump.takePeak(), sourceFps: rate("source"),
      catchup: c.catchup - prev.c.catchup, dropped: c.dropped - prev.c.dropped,
      encSpeed: enc.progress.speed, encFps: Number(enc.progress.fps) || null,
      backlogMb: mb(enc.backlog()), usage, phase,
    };
    const warm = prev.cpu.size > 0;
    prev = { at: now, c, cpu: new Map([...stats].map(([pid, s]) => [pid, s.cpuSec])) };
    if (!warm) return; // first sample only seeds CPU baselines
    samples.push(sample);
    const u = (g) => `${g} ${Math.round(usage[g].cpuPct)}% ${usage[g].rssMb}MB`;
    log(`stats: out ${sample.outFps.toFixed(1)}fps (new frames ${sample.uniqueFps.toFixed(1)}/s, peak ${sample.peakUniqueFps}/s, screencast ${sample.sourceFps.toFixed(1)}/s)`
      + ` catch-up ${sample.catchup} dropped ${sample.dropped} | ffmpeg speed ${sample.encSpeed || "?"}`
      + ` | cpu/mem: ${u("chromium")} (${usage.chromium.procs} procs), ${u("ffmpeg")}, ${u("node")} | phase ${phase}`);
  }, cfg.statsSec * 1000));

  if (cfg.durationSec > 0) setTimeout(() => shutdown(0, `duration ${cfg.durationSec}s reached`), cfg.durationSec * 1000);
}

function writeSummary(cfg, pump, samples, code, reason) {
  const c = pump.counters();
  const avg = (f) => (samples.length ? samples.reduce((a, s) => a + f(s), 0) / samples.length : null);
  const max = (f) => (samples.length ? Math.max(...samples.map(f)) : null);
  const groups = ["chromium", "ffmpeg", "node"];
  const summary = {
    url: cfg.url,
    out: cfg.out,
    exitCode: code,
    reason,
    seconds: Math.round((Date.now() - t0) / 1000),
    cores: require("os").cpus().length,
    frames: c,
    avgOutFps: avg((s) => s.outFps),
    avgUniqueFps: avg((s) => s.uniqueFps),
    avgSourceFps: avg((s) => s.sourceFps),
    peakUniqueFps: max((s) => s.peakUniqueFps),
    cpuPctAvg: Object.fromEntries(groups.map((g) => [g, avg((s) => s.usage[g].cpuPct)])),
    cpuPctMax: Object.fromEntries(groups.map((g) => [g, max((s) => s.usage[g].cpuPct)])),
    rssMbAvg: Object.fromEntries(groups.map((g) => [g, avg((s) => s.usage[g].rssMb)])),
    rssMbMax: Object.fromEntries(groups.map((g) => [g, max((s) => s.usage[g].rssMb)])),
    samples,
  };
  try {
    if (!/^[a-z]+:\/\//i.test(cfg.out)) fs.writeFileSync(`${cfg.out}.stats.json`, JSON.stringify(summary, null, 2));
  } catch { /* best effort */ }
  log(`frames: ${c.written} written (${c.unique} new, ${c.written - c.unique - c.dropped} repeats), ${c.catchup} catch-up, ${c.dropped} dropped, max late ${Math.round(c.maxLateMs)}ms`);
}

main().catch((e) => {
  log(`fatal: ${e.stack || e.message}`);
  process.exit(1);
});
