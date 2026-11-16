import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });

// Signed-in form on the force-open FSU game
const p1 = await browser.newPage({ viewport: { width: 1300, height: 900 } });
await p1.goto("http://localhost:3001/preview-temp-game/new-mexico-state-vs-florida-state-8-29-2026", { waitUntil: "domcontentloaded" });
await p1.waitForTimeout(2800);
await p1.screenshot({ path: "picks_2_signedin_form.png" });

// A different, NOT force-opened game to confirm the lock message shows
const p2 = await browser.newPage({ viewport: { width: 1300, height: 900 } });
await p2.goto("http://localhost:3001/preview-temp-game/umass-vs-rutgers-9-3", { waitUntil: "domcontentloaded" });
await p2.waitForTimeout(2800);
await p2.screenshot({ path: "picks_3_locked.png" });

await browser.close();
console.log("done");
