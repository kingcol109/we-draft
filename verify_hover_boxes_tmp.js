const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

  const shotDir = path.join(__dirname, "screenshots5");
  fs.mkdirSync(shotDir, { recursive: true });

  await page.goto("http://localhost:3000/player/london-merritt-2028-edge", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("text=LONDON", { timeout: 20000 });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: path.join(shotDir, "1_rest_state.png") });

  // Hover the LEFT box (school logo) - it's the first flex-shrink-0 box in the header row
  const boxes = page.locator("div.bg-white.flex.items-center > div.flex-shrink-0");
  const leftBox = boxes.nth(0);
  const rightBox = boxes.nth(1);

  await leftBox.hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shotDir, "2_left_box_hover.png") });

  await page.mouse.move(700, 10); // move away
  await page.waitForTimeout(400);

  await rightBox.hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shotDir, "3_right_box_flair_hover.png") });

  await page.mouse.move(700, 10);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shotDir, "4_rest_state_again.png") });

  console.log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors, null, 2));

  await browser.close();
})().catch((e) => {
  console.error("SCRIPT_FAILED:", e);
  process.exit(1);
});
