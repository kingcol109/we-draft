import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });

// 1. Pick form long-name check
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
await page.goto("http://localhost:3001/preview-temp-game/new-mexico-state-vs-florida-state-8-29-2026", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
await page.evaluate(() => window.scrollTo(0, 1080));
await page.waitForTimeout(300);
await page.screenshot({ path: "C:/Users/wdalp/AppData/Local/Temp/claude/c--Users-wdalp-OneDrive-Desktop-we-draft/7ac41bc1-4a4d-415e-8c98-55bd6a8c2300/scratchpad/shotF-pickform.png" });

// 2. Admin Rivalries tab
const page2 = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page2.goto("http://localhost:3001/admin-preview-temp", { waitUntil: "domcontentloaded" });
await page2.waitForTimeout(2500);
// Click CFB Schedule nav item
const cfbNav = await page2.getByText("CFB Schedule", { exact: false }).first();
await cfbNav.click({ force: true }).catch(() => {});
await page2.waitForTimeout(1500);
await page2.screenshot({ path: "C:/Users/wdalp/AppData/Local/Temp/claude/c--Users-wdalp-OneDrive-Desktop-we-draft/7ac41bc1-4a4d-415e-8c98-55bd6a8c2300/scratchpad/shotF-cfbschedule.png" });

// Click Rivalries tab
const rivalriesTab = await page2.getByText("Rivalries", { exact: false }).first();
await rivalriesTab.click({ force: true }).catch(() => {});
await page2.waitForTimeout(1000);
await page2.screenshot({ path: "C:/Users/wdalp/AppData/Local/Temp/claude/c--Users-wdalp-OneDrive-Desktop-we-draft/7ac41bc1-4a4d-415e-8c98-55bd6a8c2300/scratchpad/shotF-rivalries.png" });

await browser.close();
