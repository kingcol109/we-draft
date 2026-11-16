const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, args: ["--no-sandbox"] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

  const shotDir = path.join(__dirname, "screenshots11");
  fs.mkdirSync(shotDir, { recursive: true });

  await page.goto("http://localhost:3000/admin-preview-temp", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("text=Admin Panel", { timeout: 15000 });
  await page.click("text=Articles");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shotDir, "6_articles_section.png") });

  console.log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors, null, 2));
  await browser.close();
})().catch((e) => {
  console.error("SCRIPT_FAILED:", e);
  process.exit(1);
});
