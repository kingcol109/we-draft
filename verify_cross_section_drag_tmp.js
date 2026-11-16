const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, args: ["--no-sandbox"] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

  const shotDir = path.join(__dirname, "screenshots9");
  fs.mkdirSync(shotDir, { recursive: true });

  await page.goto("http://localhost:3000/admin-preview-temp", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("text=Admin Panel", { timeout: 15000 });
  await page.click("text=Trends");
  await page.waitForSelector("text=Showing on Player Pages", { timeout: 15000 });
  await page.waitForTimeout(1200);

  const handles = page.locator('[title="Drag to reorder"]');
  console.log("Handles found:", await handles.count());

  // Drag Christopher Vizzina's handle (last, in bench) up onto Sterling Webb's
  // row (last row in top5) to move him into the shown section.
  const vizzinaHandle = handles.nth(5); // 0-4 = top5, 5 = bench's Vizzina
  const sterlingHandle = handles.nth(4);
  const vizzinaBox = await vizzinaHandle.boundingBox();
  const sterlingBox = await sterlingHandle.boundingBox();

  await page.mouse.move(vizzinaBox.x + vizzinaBox.width / 2, vizzinaBox.y + vizzinaBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(vizzinaBox.x + vizzinaBox.width / 2, vizzinaBox.y - 30, { steps: 5 });
  await page.mouse.move(sterlingBox.x + sterlingBox.width / 2, sterlingBox.y + 5, { steps: 10 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(800);

  await page.screenshot({ path: path.join(shotDir, "4_after_cross_section_drag.png") });
  console.log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors, null, 2));
  await browser.close();
})().catch((e) => {
  console.error("SCRIPT_FAILED:", e);
  process.exit(1);
});
