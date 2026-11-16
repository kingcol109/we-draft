import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
page.on("console", (msg) => { if (msg.type() === "error") console.log("CONSOLE ERR:", msg.text()); });

await page.goto("http://localhost:3001/we-pick-preview-temp", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

const inputs = page.locator('input[type="number"]');
await inputs.nth(0).fill("120"); // clamp check -> should become "12"
await inputs.nth(1).fill("14");
await page.getByText("✓ SAVE", { exact: false }).first().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: "flow3_after_save.png", fullPage: true });

// Now find and click the star (should now be visible on this game, greyed out / unranked)
const star = page.getByTitle("Click to count this pick toward Ranked").first();
const starVisible = await star.isVisible().catch(() => false);
console.log("star visible after save:", starVisible);
if (starVisible) {
  await star.click({ force: true });
  await page.waitForTimeout(2000);
}
await page.screenshot({ path: "flow3_after_star.png", fullPage: true });
console.log("done");
await browser.close();
