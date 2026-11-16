import { chromium } from "playwright-core";
const OUT = "C:/Users/wdalp/AppData/Local/Temp/claude/c--Users-wdalp-OneDrive-Desktop-we-draft/7ac41bc1-4a4d-415e-8c98-55bd6a8c2300/scratchpad";
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

await page.goto("http://localhost:3001/performances/Week%2099%20(TEST)", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/v11_before_logo8bit.png`, fullPage: true });

// Confirm no pixelated image styling is applied anywhere
const pixelated = await page.evaluate(() => Array.from(document.querySelectorAll("img")).filter(i => i.style.imageRendering === "pixelated").length);
console.log("Images with imageRendering:pixelated found:", pixelated);

await browser.close();
process.exit(0);
