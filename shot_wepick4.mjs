import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1000, height: 3200 } });
page.on("console", (msg) => { if (msg.type() === "error") console.log("CONSOLE ERR:", msg.text()); });
await page.goto("http://localhost:3001/we-pick-preview-temp", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.screenshot({ path: "wepick_full4.png", fullPage: true });
await browser.close();
console.log("done");
