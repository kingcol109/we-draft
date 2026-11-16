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

  const shotDir = path.join(__dirname, "screenshots_e2e_tmp");
  fs.mkdirSync(shotDir, { recursive: true });

  // ===== 1. Create a real performance via the admin UI =====
  await page.goto("http://localhost:3000/admin-preview-temp", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("text=Admin Panel", { timeout: 15000 });
  await page.click("text=Performances");
  await page.fill("input[placeholder='Search player by name...']", "Keith Abney");
  await page.waitForTimeout(500);
  await page.click("text=Keith Abney II");
  await page.waitForTimeout(1200);
  await page.click("text=vs Morgan State");
  await page.waitForTimeout(300);
  await page.click("text=+ New Performance");
  await page.waitForTimeout(300);

  const longTitle = page.locator("input").nth(1); // 0 = player search box, 1 = long title
  await longTitle.fill("Keith Abney II Locks Down Morgan State's Top Target in Opener");
  const shortTitle = page.locator("input").nth(2);
  await shortTitle.fill("Abney Shuts It Down");
  await page.selectOption("select >> nth=1", "Dominant"); // 0 = Status, 1 = Grade
  await page.fill("textarea", "E2E verification write-up body text — checking that it round-trips correctly through Firestore and renders on the public performance page.");
  // Set status to Published so it shows on the player profile
  await page.selectOption("select >> nth=0", "published");
  await page.screenshot({ path: path.join(shotDir, "1_filled_form.png") });

  await page.click("text=Create Performance");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(shotDir, "2_after_create.png") });

  console.log("STEP1_CONSOLE_ERRORS:", JSON.stringify(consoleErrors));

  // ===== 2. Visit the player profile and check the sidebar =====
  await page.goto("http://localhost:3000/player/keith-abney-ii-2026-db", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("text=In The News", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shotDir, "3_player_profile_sidebar.png") });

  const perfLink = page.locator("a", { hasText: "Abney Shuts It Down" }).first();
  const perfLinkVisible = await perfLink.isVisible().catch(() => false);
  console.log("PERF_LINK_VISIBLE:", perfLinkVisible);

  if (perfLinkVisible) {
    await perfLink.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(shotDir, "4_performance_detail_page.png") });
  }

  console.log("STEP2_CONSOLE_ERRORS:", JSON.stringify(consoleErrors));
  await browser.close();
})().catch((e) => {
  console.error("SCRIPT_FAILED:", e);
  process.exit(1);
});
