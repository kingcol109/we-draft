const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, args: ["--no-sandbox"] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1100 } })).newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

  const shotDir = path.join(__dirname, "screenshots11");
  fs.mkdirSync(shotDir, { recursive: true });

  // Public page: confirm Kanye Udoh is NOT in the Top 5 Trending sidebar
  // (he's currently benched from our previous toggle).
  await page.goto("http://localhost:3000/player/amare-adams-2028-dl", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("text=Trending", { timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(shotDir, "3_public_sidebar_benched.png") });

  // Now flip Kanye back to "Yes" in the admin panel
  await page.goto("http://localhost:3000/admin-preview-temp", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("text=Admin Panel", { timeout: 15000 });
  await page.click("text=Trends");
  await page.waitForSelector("text=Not Shown", { timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.click("text=Kanye Udoh");
  await page.waitForSelector("text=Show on Player Pages", { timeout: 10000 });
  const selects = await page.locator("select").all();
  for (const s of selects) {
    const val = await s.inputValue();
    if (val === "yes" || val === "no") { await s.selectOption("yes"); break; }
  }
  await page.click("button:has-text('Save Trend')");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(shotDir, "4_after_toggle_back_to_yes.png") });

  // Public page again: Kanye should now be back in the sidebar
  await page.goto("http://localhost:3000/player/amare-adams-2028-dl", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("text=Trending", { timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(shotDir, "5_public_sidebar_reshown.png") });

  console.log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors, null, 2));
  await browser.close();
})().catch((e) => {
  console.error("SCRIPT_FAILED:", e);
  process.exit(1);
});
