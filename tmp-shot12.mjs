import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
await page.goto("http://localhost:3001/preview-temp-game/new-mexico-state-vs-florida-state-8-29-2026", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.evaluate(() => window.scrollTo(0, 1150));
await page.waitForTimeout(300);
await page.screenshot({ path: "C:/Users/wdalp/AppData/Local/Temp/claude/c--Users-wdalp-OneDrive-Desktop-we-draft/7ac41bc1-4a4d-415e-8c98-55bd6a8c2300/scratchpad/shot12-mobile-scoreinputs.png" });
await browser.close();
