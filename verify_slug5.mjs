import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
page.on("dialog", (d) => d.accept());

await page.goto("http://localhost:3001/admin-preview-temp", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.getByText("CFB Schedule", { exact: true }).click();
await page.waitForTimeout(1200);
await page.locator("button:has-text('NEW')").click();
await page.waitForTimeout(600);

const inputs = await page.$$("input[placeholder='Type or select a school...']");
await inputs[0].fill("Duke");
await page.waitForTimeout(500);
await page.keyboard.press("Escape");
await inputs[1].fill("Wake Forest");
await page.waitForTimeout(500);
await page.keyboard.press("Escape");

const dateInput = await page.$("input[type='date']");
await dateInput.fill("2026-11-14");
await page.waitForTimeout(300);

await page.locator("button:has-text('CREATE GAME')").click();
await page.waitForTimeout(1500);
await page.screenshot({ path: "verify_slug_created.png", fullPage: true });

await browser.close();
console.log("done");
