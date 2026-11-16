import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
await page.goto("http://localhost:3001/we-pick-preview-temp", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);

await page.getByText("Pick This Game", { exact: false }).click({ force: true });
await page.waitForTimeout(500);
await page.screenshot({ path: "C:/Users/wdalp/AppData/Local/Temp/claude/c--Users-wdalp-OneDrive-Desktop-we-draft/7ac41bc1-4a4d-415e-8c98-55bd6a8c2300/scratchpad/shotQ-editor-open.png" });

// Switch to winner-only mode and pick a team
await page.getByText("Winner Only", { exact: false }).click({ force: true });
await page.waitForTimeout(300);
await page.getByRole("button", { name: "Florida State" }).click({ force: true });
await page.waitForTimeout(300);
await page.screenshot({ path: "C:/Users/wdalp/AppData/Local/Temp/claude/c--Users-wdalp-OneDrive-Desktop-we-draft/7ac41bc1-4a4d-415e-8c98-55bd6a8c2300/scratchpad/shotQ-winner-selected.png" });

await page.getByText("Save Pick", { exact: false }).click({ force: true });
await page.waitForTimeout(1500);
await page.screenshot({ path: "C:/Users/wdalp/AppData/Local/Temp/claude/c--Users-wdalp-OneDrive-Desktop-we-draft/7ac41bc1-4a4d-415e-8c98-55bd6a8c2300/scratchpad/shotQ-saved.png", fullPage: true });

await browser.close();
