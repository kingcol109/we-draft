// scripts/instagramCheck.mjs
//
// Checks the Instagram credentials (server/instagram/graph.js) against the
// live account, read-only — publishes nothing, changes nothing:
//   which setup the token is from (Unified Login SUAT: its scopes and expiry,
//   the assigned Instagram accounts), that it reads @wedraftsite and matches
//   INSTAGRAM_USER_ID, whether publishing is permitted (the publishing
//   limit), and which account and media insights metrics answer.
//
//   node scripts/instagramCheck.mjs
//
// Needs INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID (read from .env.local —
// `vercel env pull .env.local --environment=production` — then .env, if not
// already set; both gitignored). Prints neither.
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  if (!fs.existsSync(path.join(ROOT, file))) continue;
  for (const line of fs.readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    // vercel env pull writes "[SENSITIVE]" for values it can't pull: not a value.
    const v = m ? m[2].replace(/^['"]|['"]$/g, "") : "";
    if (m && !process.env[m[1]] && v !== "[SENSITIVE]") process.env[m[1]] = v;
  }
}
const { graph, credentials, tokenKind, hostFor, API_VERSION } = require("../server/instagram/graph");

const ok = (s) => console.log(`  ✓ ${s}`);
const no = (s) => console.log(`  ✗ ${s}`);
const why = (e) => `${e.message}${e.code ? ` (code ${e.code}${e.subcode ? `/${e.subcode}` : ""})` : ""}`;

// Each metric on its own call, so one that's unavailable doesn't hide the rest.
async function probe(id, list) {
  for (const [metric, params] of list) {
    try {
      const r = await graph(`/${id}/insights`, { params: { metric, ...params } });
      const d = r.data?.[0];
      const v = d?.total_value?.value ?? d?.values?.at?.(-1)?.value ?? d?.total_value?.breakdowns?.[0]?.results?.length;
      ok(`${metric.padEnd(30)} ${d ? `${typeof v === "object" ? JSON.stringify(v).slice(0, 60) : v ?? "(empty)"}` : "(no data)"}`);
    } catch (e) {
      no(`${metric.padEnd(30)} ${why(e)}`);
    }
  }
}

async function main() {
  const { token, userId } = credentials();
  const unified = tokenKind(token) !== "instagram-login";
  console.log(`Instagram API ${hostFor(token)}/${API_VERSION} · ${unified ? "Unified Login / Facebook token" : "Business Login for Instagram token"} (${token.length} chars) · INSTAGRAM_USER_ID set`);

  if (unified) {
    // The token itself: whose, which scopes, when it expires. A token can
    // usually inspect itself; if Meta wants an app token here, it says so.
    console.log("\nToken");
    try {
      const d = (await graph("/debug_token", { params: { input_token: token } })).data || {};
      (d.is_valid ? ok : no)(`valid: ${d.is_valid} · type ${d.type || "?"} · app ${d.application || d.app_id || "?"}`);
      ok(`expires: ${d.expires_at ? new Date(d.expires_at * 1000).toISOString() : "never"} · data access until: ${d.data_access_expires_at ? new Date(d.data_access_expires_at * 1000).toISOString().slice(0, 10) : "n/a"}`);
      ok(`scopes: ${(d.scopes || []).join(", ") || "(none listed)"}`);
      for (const s of ["instagram_basic", "instagram_content_publish", "instagram_manage_insights"]) (d.scopes || []).includes(s) ? ok(`has ${s}`) : no(`missing ${s}`);
    } catch (e) { no(`debug_token: ${why(e)}`); }
    try {
      const me = await graph("/me", { params: { fields: "id,name,client_business_id" } });
      ok(`/me is ${me.name ? `"${me.name}"` : "the system user"}${me.client_business_id ? " · client business ID present" : ""}`);
    } catch (e) { no(`/me: ${why(e)}`); }
    try {
      const list = (await graph("/me/assigned_instagram_accounts", { params: { fields: "id,username" } })).data || [];
      ok(`assigned Instagram accounts: ${list.map((a) => `@${a.username}`).join(", ") || "none"}`);
      (list.some((a) => String(a.id) === userId) ? ok : no)(`INSTAGRAM_USER_ID ${list.some((a) => String(a.id) === userId) ? "is" : "is NOT"} one of them`);
    } catch (e) { no(`/me/assigned_instagram_accounts: ${why(e)}`); }
  }

  console.log("\nAccount (instagram_basic)");
  const me = unified
    ? await graph(`/${userId}`, { params: { fields: "id,username,name,followers_count,follows_count,media_count" } })
    : await graph("/me", { params: { fields: "user_id,username,account_type,name,followers_count,follows_count,media_count" } });
  ok(`@${me.username}${me.account_type ? ` · ${me.account_type}` : ""} · ${me.followers_count} followers · ${me.media_count} posts`);
  if (!unified) (String(me.user_id) === userId ? ok : no)(`INSTAGRAM_USER_ID ${String(me.user_id) === userId ? "matches" : "does NOT match"} the token's account`);

  console.log("\nMedia");
  let media = [];
  try {
    media = (await graph(`/${userId}/media`, { params: { fields: "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count,thumbnail_url,media_url", limit: 5 } })).data || [];
    ok(`${media.length} recent: ${media.map((m) => `${m.media_product_type || m.media_type} ${m.timestamp?.slice(0, 10)} (${m.like_count ?? "?"}♥ ${m.comments_count ?? "?"}💬)`).join(", ") || "none"}`);
  } catch (e) { no(`media list: ${why(e)}`); }

  console.log("\nPublishing (instagram_content_publish)");
  try {
    const lim = (await graph(`/${userId}/content_publishing_limit`, { params: { fields: "config,quota_usage" } })).data?.[0] || {};
    ok(`publishing limit readable: ${lim.quota_usage ?? "?"} used of ${lim.config?.quota_total ?? "?"} per ${lim.config?.quota_duration ? `${lim.config.quota_duration / 3600}h` : "?"}`);
  } catch (e) { no(`content_publishing_limit: ${why(e)}`); }

  console.log("\nAccount insights (instagram_manage_insights), last 7 days");
  const until = Math.floor(Date.now() / 1000);
  const since = until - 7 * 86400;
  const tv = { period: "day", metric_type: "total_value", since, until };
  await probe(userId, [
    ["reach", { period: "day", metric_type: "time_series", since, until }],
    ["reach", tv],
    ["views", tv],
    ["accounts_engaged", tv],
    ["total_interactions", tv],
    ["likes", tv],
    ["comments", tv],
    ["saves", tv],
    ["shares", tv],
    ["replies", tv],
    ["profile_links_taps", tv],
    ["follows_and_unfollows", { ...tv, breakdown: "follow_type" }],
    ["follower_count", { period: "day", since, until }],
    ["profile_views", tv],
    ["online_followers", { period: "lifetime" }],
    ["follower_demographics", { period: "lifetime", metric_type: "total_value", timeframe: "this_month", breakdown: "country" }],
    ["engaged_audience_demographics", { period: "lifetime", metric_type: "total_value", timeframe: "this_month", breakdown: "age" }],
  ]);

  const m = media[0];
  if (m) {
    console.log(`\nMedia insights — latest post (${m.media_product_type || m.media_type}, ${m.timestamp?.slice(0, 10)})`);
    const reel = m.media_product_type === "REELS";
    await probe(m.id, ["reach", "views", "likes", "comments", "saved", "shares", "total_interactions", "profile_visits", "follows", "profile_activity",
      ...(reel ? ["ig_reels_avg_watch_time", "ig_reels_video_view_total_time"] : [])].map((x) => [x, {}]));
  } else {
    console.log("\nMedia insights — skipped (no posts yet)");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(`\nFailed: ${why(e)}`); process.exit(1); });
