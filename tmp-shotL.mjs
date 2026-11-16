import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.goto("http://localhost:3001/game/new-mexico-state-vs-florida-state-8-29-2026", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
await page.screenshot({ path: "C:/Users/wdalp/AppData/Local/Temp/claude/c--Users-wdalp-OneDrive-Desktop-we-draft/7ac41bc1-4a4d-415e-8c98-55bd6a8c2300/scratchpad/shotL-sidebar.png" });
await browser.close();
