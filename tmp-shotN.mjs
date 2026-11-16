import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
await page.goto("http://localhost:3001/admin-preview-temp", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.getByText("Branding", { exact: false }).first().click({ force: true });
await page.waitForTimeout(1200);
// Use a search to find a small, low-traffic FCS-appropriate school rather than Alabama
await page.locator('input[placeholder="Search school, mascot, or conference..."]').fill("Abilene Christian");
await page.waitForTimeout(500);
await page.getByText("Abilene Christian", { exact: false }).first().click({ force: true });
await page.waitForTimeout(500);
await page.getByText("This is an FCS team", { exact: false }).click({ force: true });
await page.getByText("Save Changes", { exact: false }).click({ force: true });
await page.waitForTimeout(1200);
await page.screenshot({ path: "C:/Users/wdalp/AppData/Local/Temp/claude/c--Users-wdalp-OneDrive-Desktop-we-draft/7ac41bc1-4a4d-415e-8c98-55bd6a8c2300/scratchpad/shotN-fcs-saved.png" });
await browser.close();
