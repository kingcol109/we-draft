import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

// UserBoards (My Draft Board) — authenticated preview, sidebars + My Feed button
const page1 = await browser.newPage({ viewport: { width: 1900, height: 1300 } });
await page1.goto("http://localhost:3001/preview-temp-boards", { waitUntil: "domcontentloaded" });
await page1.waitForTimeout(4000);
await page1.screenshot({ path: "v5_userboards_authed.png" });

// My Feed — authenticated preview, empty-follows state
const page2 = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page2.goto("http://localhost:3001/preview-temp-feed", { waitUntil: "domcontentloaded" });
await page2.waitForTimeout(3000);
await page2.screenshot({ path: "v6_myfeed_authed.png" });

// Navbar dropdown hover — authenticated preview
const page3 = await browser.newPage({ viewport: { width: 1600, height: 500 } });
await page3.goto("http://localhost:3001/preview-temp-navbar", { waitUntil: "domcontentloaded" });
await page3.waitForTimeout(1500);
// The fake-authed Navbar is the SECOND nav on the page (first is the real signed-out one from MainLayout)
const navs = await page3.$$("nav");
const targetNav = navs[navs.length - 1];
const myBoardsLink = await targetNav.$("a[href='/boards']");
if (myBoardsLink) {
  await myBoardsLink.hover();
  await page3.waitForTimeout(400);
}
await page3.screenshot({ path: "v7_navbar_authed_dropdown.png" });

await browser.close();
console.log("done");
