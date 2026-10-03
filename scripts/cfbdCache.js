// scripts/cfbdCache.js
//
// Optional on-disk cache for CFBD responses in one-off scripts — the free
// CFBD tier is 1,000 calls/month, so rerunning a dry-run report shouldn't
// spend calls on data that hasn't changed. Only active when CFBD_CACHE_DIR
// is set; otherwise every call goes straight to CFBD. Never used by the
// live ingester, which always needs fresh data.

const fs = require("fs");
const path = require("path");

async function cached(name, fetcher) {
  const dir = process.env.CFBD_CACHE_DIR;
  if (!dir) return fetcher();
  const file = path.join(dir, `${name}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const data = await fetcher();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
  return data;
}

module.exports = { cached };
