import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on("dialog", (d) => d.accept());

await page.goto("http://localhost:3001/admin-preview-temp", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.getByText("Trends", { exact: true }).click();
await page.waitForTimeout(1200);

const input = await page.$("input[type='text']");
await input.fill("");
await page.waitForTimeout(500);
const firstPlayerRow = await page.$("div[style*='cursor: pointer']");
await firstPlayerRow.click();
await page.waitForTimeout(600);
await page.screenshot({ path: "verify_trend_default2.png" });
await browser.close();
console.log("done");
