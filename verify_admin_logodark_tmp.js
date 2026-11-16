const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

  const shotDir = path.join(__dirname, "screenshots_wm_tmp");
  fs.mkdirSync(shotDir, { recursive: true });

  await page.goto("http://localhost:3000/admin-preview-temp", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("text=Admin Panel", { timeout: 15000 });
  await page.click("text=Branding");
  await page.waitForSelector("text=Alabama", { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(shotDir, "5_admin_branding_list.png") });

  const alabamaRow = page.locator("div", { hasText: "Alabama" }).last();
  await alabamaRow.scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: path.join(shotDir, "6_admin_branding_scrolled.png") });

  console.log("CONSOLE_ERRORS_ADMIN:", JSON.stringify(consoleErrors, null, 2));
  await browser.close();
})().catch((e) => {
  console.error("SCRIPT_FAILED:", e);
  process.exit(1);
});
