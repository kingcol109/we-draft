// server/broadcast-worker/procStats.js
//
// CPU time and resident memory for a set of pids, so the worker can report
// what one stream costs: Linux reads /proc (containers), Windows asks
// PowerShell, macOS/BSD use ps. Missing pids are skipped.
const fs = require("fs");
const { execFile } = require("child_process");

const CLK_TCK = 100; // Linux USER_HZ; 100 on every mainstream kernel build

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (err, stdout) => resolve(err ? "" : String(stdout)));
  });
}

function linux(pids) {
  const out = new Map();
  for (const pid of pids) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const cpuSec = (Number(f[11]) + Number(f[12])) / CLK_TCK; // utime + stime
      const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
      const rssKb = Number((/VmRSS:\s+(\d+)/.exec(status) || [])[1] || 0);
      out.set(pid, { cpuSec, rss: rssKb * 1024 });
    } catch { /* gone */ }
  }
  return out;
}

async function windows(pids) {
  const out = new Map();
  const ps = `Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id) $($_.CPU) $($_.WorkingSet64)" }`;
  for (const line of (await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps])).split(/\r?\n/)) {
    const [pid, cpu, ws] = line.trim().split(" ");
    if (pid) out.set(Number(pid), { cpuSec: Number(cpu) || 0, rss: Number(ws) || 0 });
  }
  return out;
}

function psTime(t) {
  // [[dd-]hh:]mm:ss[.ss]
  const [d, rest] = t.includes("-") ? t.split("-") : [0, t];
  return rest.split(":").reduce((acc, x) => acc * 60 + Number(x), 0) + Number(d) * 86400;
}

async function posix(pids) {
  const out = new Map();
  for (const line of (await run("ps", ["-o", "pid=,time=,rss=", "-p", pids.join(",")])).split("\n")) {
    const [pid, time, rss] = line.trim().split(/\s+/);
    if (pid) out.set(Number(pid), { cpuSec: psTime(time), rss: Number(rss) * 1024 });
  }
  return out;
}

async function sample(pids) {
  const list = [...new Set(pids.filter(Boolean))];
  if (!list.length) return new Map();
  if (process.platform === "linux") return linux(list);
  if (process.platform === "win32") return windows(list);
  return posix(list);
}

// The pids (of those given) that are still running; zombies don't count.
async function alive(pids) {
  const list = [...new Set(pids.filter(Boolean))];
  if (process.platform === "linux") {
    return list.filter((pid) => {
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
        return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
      } catch { return false; }
    });
  }
  return list.filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
}

// Every running Chromium that Playwright installed (its path contains
// "ms-playwright") — leftovers after a worker exits. Inside a container that
// can only be this worker's; on a dev machine it is any worker's.
async function playwrightChromium() {
  if (process.platform === "linux") {
    const out = [];
    for (const d of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(d)) continue;
      try {
        if (fs.readFileSync(`/proc/${d}/cmdline`, "utf8").includes("ms-playwright")) out.push(Number(d));
      } catch { /* gone */ }
    }
    return alive(out);
  }
  if (process.platform === "win32") {
    const ps = "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.ExecutablePath -like '*ms-playwright*' } | ForEach-Object { $_.ProcessId }";
    return (await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps])).split(/\r?\n/).filter(Boolean).map(Number);
  }
  return (await run("ps", ["-axo", "pid=,command="])).split("\n")
    .filter((l) => l.includes("ms-playwright")).map((l) => Number(l.trim().split(/\s+/)[0]));
}

module.exports = { sample, alive, playwrightChromium };
