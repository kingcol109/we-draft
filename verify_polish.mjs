import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });

// New Mexico State/Florida State — has key players on Home only, no away
const p1 = await browser.newPage({ viewport: { width: 1450, height: 1000 } });
await p1.goto("http://localhost:3001/game/new-mexico-state-vs-florida-state-8-29", { waitUntil: "domcontentloaded" });
await p1.waitForTimeout(2800);
await p1.screenshot({ path: "polish_1_asymmetric_kp.png" });

// UMass/Rutgers — no key players on either side, section should vanish entirely
const p2 = await browser.newPage({ viewport: { width: 1450, height: 900 } });
await p2.goto("http://localhost:3001/game/umass-vs-rutgers-9-3", { waitUntil: "domcontentloaded" });
await p2.waitForTimeout(2800);
await p2.screenshot({ path: "polish_2_no_kp.png", fullPage: true });

const p3 = await browser.newPage({ viewport: { width: 400, height: 950 } });
await p3.goto("http://localhost:3001/game/new-mexico-state-vs-florida-state-8-29", { waitUntil: "domcontentloaded" });
await p3.waitForTimeout(2800);
await p3.screenshot({ path: "polish_3_mobile.png" });

await browser.close();
console.log("done");
