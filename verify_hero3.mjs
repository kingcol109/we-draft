import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

const p1 = await browser.newPage({ viewport: { width: 1450, height: 1000 } });
await p1.goto("http://localhost:3001/game/new-mexico-state-vs-florida-state-8-29", { waitUntil: "domcontentloaded" });
await p1.waitForTimeout(3000);
await p1.screenshot({ path: "gh2_1_desktop.png" });

const p2 = await browser.newPage({ viewport: { width: 400, height: 950 } });
await p2.goto("http://localhost:3001/game/new-mexico-state-vs-florida-state-8-29", { waitUntil: "domcontentloaded" });
await p2.waitForTimeout(3000);
await p2.screenshot({ path: "gh2_2_mobile.png" });

await browser.close();
console.log("done");
