#!/usr/bin/env node
// server/broadcast-worker/docker-test.js
//
// Runs on the HOST: starts the worker image with test.js (or faults.js)
// inside it, samples `docker stats` for whole-container CPU and memory
// while it runs, then checks the container is gone. Results go to the
// mounted output directory: <out>/broadcast-test.mp4 (+ .stats.json,
// stills/) from inside the container, docker-stats.json from here.
//
//   node docker-test.js [--duration 600] [--cpus 2] [--faults]
//                       [--image we-draft-broadcast-worker] [--out ./output/docker]
//                       [--base http://host.docker.internal:3000]
//
// --cpus caps the container (e.g. 2 = a 2-vCPU VM's worth) to see whether
// one stream holds 30fps on a small machine.
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { parseFlags } = require("./config");

const f = parseFlags(process.argv.slice(2));
const IMAGE = f.image || "we-draft-broadcast-worker";
const DURATION = Number(f.duration || 600);
const BASE = f.base || "http://host.docker.internal:3000";
const OUT = path.resolve(f.out || path.join(__dirname, "output", "docker"));
const NAME = `wd-broadcast-test-${process.pid}`;
const SAMPLE_MS = 5000;

const docker = (args) => new Promise((resolve) => {
  execFile("docker", args, { windowsHide: true }, (err, stdout, stderr) => resolve({ code: err ? err.code || 1 : 0, out: String(stdout).trim(), err: String(stderr).trim() }));
});

function bytes(s) {
  const m = /([\d.]+)\s*([KMGT]?i?B)/i.exec(s || "");
  if (!m) return 0;
  const k = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, KIB: 1024, MIB: 1048576, GIB: 1073741824, TIB: 1099511627776 }[m[2].toUpperCase()] || 1;
  return Number(m[1]) * k;
}

async function main() {
  const v = await docker(["version", "--format", "{{.Server.Version}} {{.Server.Os}}/{{.Server.Arch}}"]);
  if (v.code) { console.error(`Docker isn't available: ${v.err || v.out}`); process.exit(2); }
  const info = await docker(["info", "--format", "{{.NCPU}} CPUs, {{.MemTotal}} bytes"]);
  console.log(`Docker ${v.out}; engine sees ${info.out}`);
  fs.mkdirSync(OUT, { recursive: true });

  const inner = f.faults ? ["node", "faults.js", "--base", BASE] : ["node", "test.js", "--duration", String(DURATION), "--base", BASE];
  const args = ["run", "--rm", "--name", NAME,
    // host.docker.internal is built into Docker Desktop; on Linux it needs this.
    "--add-host=host.docker.internal:host-gateway",
    "-v", `${OUT}:/out`,
    ...(f.cpus ? ["--cpus", String(f.cpus)] : []),
    IMAGE, ...inner];
  console.log(`docker ${args.join(" ")}\n`);

  const samples = [];
  const proc = spawn("docker", args, { stdio: "inherit" });
  const exited = new Promise((r) => proc.on("exit", (code) => r(code)));
  let done = false;
  exited.then(() => { done = true; });
  (async () => {
    while (!done) {
      const s = await docker(["stats", "--no-stream", "--format", "{{json .}}", NAME]);
      if (!s.code && s.out) {
        try {
          const j = JSON.parse(s.out);
          samples.push({ t: samples.length * SAMPLE_MS / 1000, cpuPct: parseFloat(j.CPUPerc), memBytes: bytes(j.MemUsage.split("/")[0]), pids: Number(j.PIDs) });
        } catch { /* container starting or gone */ }
      }
      await new Promise((r) => setTimeout(r, SAMPLE_MS));
    }
  })();

  const code = await exited;
  const left = await docker(["ps", "-a", "--filter", `name=${NAME}`, "--format", "{{.ID}}"]);
  // Skip the first 30s (image start, Chromium launch, page load) for steady-state numbers.
  const steady = samples.filter((s) => s.t >= 30);
  const use = steady.length ? steady : samples;
  const avg = (k) => use.reduce((a, s) => a + s[k], 0) / (use.length || 1);
  const max = (k) => Math.max(0, ...use.map((s) => s[k]));
  const summary = {
    image: IMAGE, cpusLimit: f.cpus || null, mode: f.faults ? "faults" : "test", exitCode: code,
    containerRemoved: !left.out,
    container: { cpuPctAvg: avg("cpuPct"), cpuPctMax: max("cpuPct"), memMbAvg: avg("memBytes") / 1048576, memMbMax: max("memBytes") / 1048576, pidsMax: max("pids") },
    samples,
  };
  fs.writeFileSync(path.join(OUT, "docker-stats.json"), JSON.stringify(summary, null, 2));
  const c = summary.container;
  console.log(`\nContainer (docker stats, 100% = one core, after the first 30s): CPU avg ${c.cpuPctAvg.toFixed(0)}%, max ${c.cpuPctMax.toFixed(0)}%;`
    + ` memory avg ${c.memMbAvg.toFixed(0)}MB, max ${c.memMbMax.toFixed(0)}MB; up to ${c.pidsMax} processes`);
  console.log(`${summary.containerRemoved ? "PASS" : "FAIL"}  container removed after exit`);
  console.log(`\nInner run exited ${code}. Results: ${OUT}`);
  process.exit(code || (summary.containerRemoved ? 0 : 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
