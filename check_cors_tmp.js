const { chromium } = require("playwright-core");
(async () => {
  const browser = await chromium.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  const page = await browser.newPage();
  await page.goto("http://localhost:3000");
  const result = await page.evaluate(async () => {
    try {
      const res = await fetch("https://i.imgur.com/PsXpbKr.png", { mode: "cors" });
      return { ok: res.ok, headers: [...res.headers.entries()] };
    } catch (e) { return { error: e.message }; }
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
