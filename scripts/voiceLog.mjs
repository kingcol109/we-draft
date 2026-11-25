// scripts/voiceLog.mjs
//
// /voice's conversation log (voiceLog — src/utils/voice/log.js) as a
// transcript, to go over in VS Code what was asked and answered on the iPad.
// READ-ONLY unless --prune.
//
//   node -r dotenv/config scripts/voiceLog.mjs                  # the last 3 hours
//   node -r dotenv/config scripts/voiceLog.mjs --since 1d       # 30m / 2h / 1d / today
//   node -r dotenv/config scripts/voiceLog.mjs --device ipad    # one device (text match)
//   node -r dotenv/config scripts/voiceLog.mjs --misses         # only what it couldn't answer
//   node -r dotenv/config scripts/voiceLog.mjs --follow         # keep watching: print new ones as they come
//   node -r dotenv/config scripts/voiceLog.mjs --prune          # DELETE entries older than 30 days
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { getFirestore } = require("./firebaseAdmin");

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const has = (name) => args.includes(name);
const ICON = { voice: "🎙", wake: "👂", typed: "⌨", tap: "👆", refresh: "↻" };
const ET = "America/New_York";

function sinceDate(s) {
  if (s === "today") {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(new Date());
    return new Date(`${day}T00:00:00-05:00`);
  }
  const m = /^(\d+)\s*(m|h|d)$/.exec(String(s || "3h"));
  if (!m) throw new Error(`--since: use 30m, 2h, 1d or today (got "${s}")`);
  return new Date(Date.now() - Number(m[1]) * { m: 60e3, h: 3600e3, d: 86400e3 }[m[2]]);
}
const time = (d) => d.toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit", second: "2-digit" });
const when = (d) => d.toLocaleString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

let lastSession = null;
function print(r) {
  const at = r.at?.toDate ? r.at.toDate() : new Date();
  if (r.session !== lastSession) {
    console.log(`\n── ${r.device || "unknown device"} · ${r.mode || "general"} · ${when(at)} (session ${r.session || "?"}) ──`);
    lastSession = r.session;
  }
  const meta = [r.intent || "no question type", r.playerName, r.ms != null ? `${(r.ms / 1000).toFixed(1)}s` : null].filter(Boolean).join(" · ");
  console.log(`${time(at)} ${ICON[r.source] || "·"} "${r.said}"`);
  console.log(`          → ${r.say}`);
  console.log(`          [${meta}]${r.miss ? "  ✗ MISS" : ""}${r.asked ? "  ? asked to confirm" : ""}`);
}
const keep = (r) => (!has("--misses") || r.miss) && (!opt("--device") || String(r.device || "").toLowerCase().includes(opt("--device").toLowerCase()));

async function main() {
  const db = getFirestore();
  const col = db.collection("voiceLog");

  if (has("--prune")) {
    const cutoff = new Date(Date.now() - 30 * 86400e3);
    const old = await col.where("at", "<", cutoff).get();
    for (let i = 0; i < old.docs.length; i += 400) {
      const batch = db.batch();
      old.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit(); // eslint-disable-line no-await-in-loop
    }
    console.log(`Deleted ${old.size} entries older than 30 days.`);
    return;
  }

  const since = sinceDate(opt("--since"));
  const snap = await col.where("at", ">=", since).orderBy("at", "asc").get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(keep);
  console.log(`voiceLog since ${when(since)}: ${rows.length} exchange${rows.length === 1 ? "" : "s"}${has("--misses") ? " (misses only)" : ""}, ${rows.filter((r) => r.miss).length} missed.`);
  rows.forEach(print);
  if (!has("--follow")) return;

  // Watch: print each new one as it lands (Ctrl+C to stop).
  console.log("\nWatching for new exchanges…");
  const seen = new Set(snap.docs.map((d) => d.id));
  let from = rows.length ? rows[rows.length - 1].at.toDate() : since;
  await new Promise(() => {
    col.where("at", ">=", from).orderBy("at", "asc").onSnapshot((s) => {
      s.docChanges().forEach((c) => {
        if (c.type !== "added" || seen.has(c.doc.id)) return;
        seen.add(c.doc.id);
        const r = { id: c.doc.id, ...c.doc.data() };
        if (r.at && keep(r)) { print(r); from = r.at.toDate(); }
      });
    }, (e) => { console.error("watch error:", e.message); process.exit(1); });
  });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
