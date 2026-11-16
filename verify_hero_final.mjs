import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto("http://localhost:3001/game/smu-vs-florida-state-9-7", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
await p.screenshot({ path: "hero_4_final_desktop.png" });
await browser.close();
console.log("done");
