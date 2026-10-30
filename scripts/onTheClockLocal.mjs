// scripts/onTheClockLocal.mjs
//
// Drafts one On the Clock show (utils/draftSim/onTheClock.js) and saves it
// to public/ontheclock-local.json, so /broadcast/ontheclock?local=1 plays
// the same draft every time while the format's being worked on. Nothing
// goes to Firestore. The show runs in a real browser on the dev server
// (?demo=…), the same code path as Admin → Generate.
//
//   npm start                                   (terminal 1)
//   node scripts/onTheClockLocal.mjs            (terminal 2)
//     --format full2027 | chaos2027 | full2028  (default full2027)
//     --seed 42   --rounds 7   --base http://localhost:3000
//
// Then open http://localhost:3000/broadcast/ontheclock?local=1
import { writeFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "server/broadcast-worker/package.json"));
const { chromium } = require("playwright");

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const format = arg("format", "full2027");
const seed = arg("seed", String(Math.floor(Math.random() * 2 ** 31)));
const rounds = arg("rounds", "");
const base = arg("base", "http://localhost:3000");

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.error("page:", m.text().slice(0, 300)); });
  const url = `${base}/broadcast/ontheclock?demo=${format}&seed=${seed}${rounds ? `&rounds=${rounds}` : ""}&at=-10`;
  console.log(`Drafting ${format} (seed ${seed}) at ${url}`);
  await page.goto(url);
  await page.waitForFunction(() => window.__OTC_SCRIPT__, null, { timeout: 180000 });
  const script = await page.evaluate(() => window.__OTC_SCRIPT__);
  // Starts "now" whenever it's opened — the preview clock counts from 0.
  script.id = "local";
  script.startAt = 0;
  const out = path.join(root, "public/ontheclock-local.json");
  writeFileSync(out, JSON.stringify(script));
  const trades = script.beats.filter((b) => b.trade).length;
  console.log(`Saved ${out}: ${script.beats.length} picks, ${trades} trades, ${(JSON.stringify(script).length / 1024).toFixed(0)} KB`);
  console.log(`Open ${base}/broadcast/ontheclock?local=1`);
} finally {
  await browser.close();
}
