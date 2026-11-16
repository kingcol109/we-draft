const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1300, height: 950 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

  const shotDir = path.join(__dirname, "screenshots_perf_v2_tmp");
  fs.mkdirSync(shotDir, { recursive: true });

  // ===== 1. Set a score on the Morgan State @ Arizona State (Week 1) game =====
  await page.goto("http://localhost:3000/admin-preview-temp", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("text=Admin Panel", { timeout: 15000 });
  await page.click("text=CFB Schedule");
  await page.waitForTimeout(600);
  await page.selectOption("select", { label: "Week 1" });
  await page.waitForTimeout(500);
  await page.click("text=Morgan State at Arizona State");
  await page.waitForTimeout(300);
  const awayScore = page.locator("input[type='number']").nth(0);
  const homeScore = page.locator("input[type='number']").nth(1);
  await awayScore.fill("10");
  await homeScore.fill("35");
  await page.click("text=Save Changes");
  await page.waitForTimeout(800);

  // ===== 2. Author a performance for that game =====
  await page.click("text=Performances");
  await page.fill("input[placeholder='Search player by name...']", "Keith Abney");
  await page.waitForTimeout(500);
  await page.click("text=Keith Abney II");
  await page.waitForTimeout(1200);
  await page.click("text=vs Morgan State");
  await page.waitForTimeout(300);
  await page.click("text=+ New Performance");
  await page.waitForTimeout(300);

  await page.locator("input").nth(1).fill("Keith Abney II Seals Down the Secondary Against Morgan State");
  await page.locator("input").nth(2).fill("Abney Locks It Down");
  await page.selectOption("select >> nth=1", "Great"); // grade
  await page.fill("textarea", "Verification write-up v2 — testing slug generation, week hub listing, and live score display.");
  await page.selectOption("select >> nth=0", "published"); // status
  await page.click("text=Create Performance");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(shotDir, "1_created.png") });

  // ===== 3. Check the /performances hub =====
  await page.goto("http://localhost:3000/performances", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(shotDir, "2_hub_default_week.png") });

  // Select Week 1 explicitly (default may already be Week 0)
  await page.selectOption("select", { label: "Week 1" }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(shotDir, "3_hub_week1.png") });

  const link = page.locator("a", { hasText: "Abney Locks It Down" }).first();
  const visible = await link.isVisible().catch(() => false);
  console.log("HUB_LINK_VISIBLE:", visible);
  const href = visible ? await link.getAttribute("href") : null;
  console.log("HUB_LINK_HREF:", href);

  if (visible) {
    await link.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(shotDir, "4_detail_page.png") });
  }

  console.log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors, null, 2));
  await browser.close();
})().catch((e) => {
  console.error("SCRIPT_FAILED:", e);
  process.exit(1);
});
