// server/shop/http.js — shared bits for the store's API endpoints.

// Raw request bytes (webhook signatures are over the exact body). Same
// approach as api/instagram-webhook.js.
function readRaw(req, timeoutMs = 8000) {
  if (Buffer.isBuffer(req.rawBody)) return Promise.resolve(req.rawBody);
  if (typeof req.rawBody === "string") return Promise.resolve(Buffer.from(req.rawBody));
  if (typeof req.on !== "function" || req.readableEnded) return Promise.resolve(null);
  return new Promise((resolve) => {
    const chunks = [];
    const done = (v) => { clearTimeout(t); resolve(v); };
    const t = setTimeout(() => done(chunks.length ? Buffer.concat(chunks) : null), timeoutMs);
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => done(Buffer.concat(chunks)));
    req.on("error", () => done(null));
  });
}

// Errors carrying a publicMessage are safe to show; anything else is
// logged and answered generically (no internals reach the browser).
function sendError(res, e, label) {
  const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
  if (!e.publicMessage) console.error(`${label} failed:`, e.stack || e.message);
  res.status(status).json({ error: e.publicMessage || "Something went wrong. Please try again.", ...(e.extra || {}) });
}

module.exports = { readRaw, sendError };
