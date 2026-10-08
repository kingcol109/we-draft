// server/broadcast-worker/capture.js
//
// The Chromium side: launch headless Chromium at exactly 1920×1080 @1x,
// open the broadcast page, wait for it to say it's ready, then stream its
// compositor output over the DevTools protocol (Page.startScreencast).
//
// Why screencast: Chromium pushes a JPEG every time the page actually
// repaints, straight from the compositor — no display server, no window,
// no screenshots on a timer. It works the same headless on Windows, macOS
// and in a Linux container. It only sends frames when something changes,
// so the frame pump (framePump.js) turns that into constant-rate video.
const { chromium } = require("playwright");

const CHROMIUM_ARGS = [
  "--hide-scrollbars",
  "--mute-audio",
  // /dev/shm is tiny in most containers; Chromium crashes without this.
  "--disable-dev-shm-usage",
  // A headless page is "hidden" — keep its timers and rendering at full speed.
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--force-color-profile=srgb",
];

async function openBroadcast({ url, width, height, readyTimeoutMs, log }) {
  const browser = await chromium.launch({
    // channel "chromium" = full Chromium in new headless mode (same renderer
    // as a desktop browser), rather than the stripped headless shell.
    channel: "chromium",
    headless: true,
    args: CHROMIUM_ARGS,
    // The worker shuts Chromium down itself, after the encoder has finished.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (e) => log(`page error: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") log(`page console error: ${m.text().slice(0, 300)}`); });

  await page.goto(url, { waitUntil: "load", timeout: readyTimeoutMs });
  // BroadcastPage sets window.__BROADCAST__.ready once fonts are loaded and
  // the first game state is in.
  await page.waitForFunction(() => window.__BROADCAST__ && window.__BROADCAST__.ready === true, null,
    { timeout: readyTimeoutMs, polling: 250 });
  const info = await page.evaluate(() => ({ ...window.__BROADCAST__ }));
  if (info.phase === "missing") throw new Error(`The broadcast page found no game for ${url}`);
  // Let the first state's entrance animations start before frame one.
  await page.waitForTimeout(500);
  return { browser, page, info };
}

// Streams frames to onFrame(jpegBuffer). Returns { stop, refresh }.
async function startScreencast(page, { width, height, quality }, onFrame) {
  const cdp = await page.context().newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
    // Chromium sends the next frame only after this one is acked.
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    onFrame(Buffer.from(data, "base64"));
  });
  // A still page may not repaint for a while; capture frame one directly.
  const refresh = async () => {
    const shot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality });
    onFrame(Buffer.from(shot.data, "base64"));
  };
  await refresh();
  await cdp.send("Page.startScreencast", { format: "jpeg", quality, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
  return {
    refresh,
    stop: () => cdp.send("Page.stopScreencast").catch(() => {}),
  };
}

// Chromium's process ids (browser, renderer, GPU, utility…) for stats.
async function chromiumPids(browser) {
  try {
    const s = await browser.newBrowserCDPSession();
    const { processInfo } = await s.send("SystemInfo.getProcessInfo");
    await s.detach().catch(() => {});
    return processInfo.map((p) => ({ pid: p.id, type: p.type }));
  } catch {
    return [];
  }
}

module.exports = { openBroadcast, startScreencast, chromiumPids };
