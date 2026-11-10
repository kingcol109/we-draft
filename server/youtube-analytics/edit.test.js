// server/youtube-analytics/edit.test.js — King Cold Sports' edit connection
// (edit.js) with Firestore and Google faked: only the analytics channel can
// be connected, and a thumbnail only goes onto that channel's own videos,
// as a JPEG under 2 MB, recorded on the saved thumbnail.

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { fakeFirestore } = require("../stream-manager/__fakes__/firestore");

let db;
require.cache[path.resolve(__dirname, "../../scripts/firebaseAdmin.js")] = { id: "firebaseAdmin", loaded: true, exports: { getFirestore: () => db } };
process.env.YOUTUBE_CLIENT_ID = "cid";
process.env.YOUTUBE_CLIENT_SECRET = "csecret";
process.env.STREAM_MANAGER_TOKEN_KEY = "k".repeat(40);
delete process.env.YOUTUBE_CHANNEL_ID;

const KCS = "UC" + "k".repeat(22);
const OTHER = "UC" + "w".repeat(22);
const VID = "AAAAAAAAAA1";
const FOREIGN = "BBBBBBBBBB2";
const edit = require("./edit");
const api = require("../../api/youtube-analytics");

let google; // what the fake Google says, and what it was asked
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
const realFetch = global.fetch;
beforeEach(async () => {
  db = fakeFirestore();
  edit.resetEditCache();
  await db.doc("ytAnalytics/status").set({ channelId: KCS });
  google = { mine: KCS, calls: [], revoked: [] };
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    google.calls.push({ url: u, opts });
    if (u.startsWith("https://oauth2.googleapis.com/token")) {
      const body = new URLSearchParams(String(opts.body));
      if (body.get("grant_type") === "refresh_token") return json(200, { access_token: "at-2", expires_in: 3600 });
      return json(200, { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: edit.EDIT_SCOPE });
    }
    if (u.startsWith("https://oauth2.googleapis.com/revoke")) { google.revoked.push(u); return json(200, {}); }
    if (u.includes("/youtube/v3/channels")) return json(200, { items: [{ id: google.mine, snippet: { title: google.mine === KCS ? "King Cold Sports" : "We-Draft .com" } }] });
    if (u.includes("/youtube/v3/videos?")) {
      const id = new URL(u).searchParams.get("id");
      return json(200, { items: id === VID ? [{ id, snippet: { channelId: KCS, title: "Mark Bowman Film Breakdown" } }] : id === FOREIGN ? [{ id, snippet: { channelId: OTHER, title: "Not ours" } }] : [] });
    }
    if (u.includes("/upload/youtube/v3/thumbnails/set")) return json(200, { items: [{ maxres: { url: "https://i.ytimg.com/vi/x/maxresdefault.jpg" } }] });
    throw new Error(`unexpected fetch ${u}`);
  };
});
after(() => { global.fetch = realFetch; });

const req = { headers: { host: "we-draft.com", "x-forwarded-proto": "https" } };
async function signIn() {
  const url = new URL(await edit.startEditOAuth(db, req, "admin1"));
  assert.equal(url.searchParams.get("scope"), edit.EDIT_SCOPE);
  assert.equal(url.searchParams.get("redirect_uri"), "https://we-draft.com/api/youtube-analytics");
  return url.searchParams.get("state");
}
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)]).toString("base64");

test("only King Cold Sports can be connected; another channel's sign-in is revoked", async () => {
  google.mine = OTHER;
  const state = await signIn();
  assert.equal(await edit.isEditState(db, state), true);
  await assert.rejects(edit.finishEditOAuth(db, { code: "c", state }), /We-Draft \.com.*King Cold Sports/);
  assert.equal(google.revoked.length, 1);
  assert.equal((await db.doc(edit.TOKEN).get()).exists, false);

  google.mine = KCS;
  const st2 = await signIn();
  const conn = await edit.finishEditOAuth(db, { code: "c", state: st2 });
  assert.equal(conn.channelTitle, "King Cold Sports");
  const stored = (await db.doc(edit.TOKEN).get()).data();
  assert.ok(stored.refreshToken && !String(stored.refreshToken).includes("rt-1"), "the refresh token is stored encrypted");
  assert.equal((await db.doc("ytAnalytics/status").get()).data().edit.connected, true);
  assert.equal(await edit.isEditState(db, st2), false, "a state works once");
});

test("a thumbnail goes onto the channel's own video as a JPEG, and the saved one is put on it from now", async () => {
  await edit.finishEditOAuth(db, { code: "c", state: await signIn() });
  await db.doc("ytThumbnails/t1").set({ name: "Mark Bowman · Game Review" });
  await assert.rejects(edit.setVideoThumbnail(db, "admin1", { videoId: VID, jpeg: Buffer.from("PNG...").toString("base64") }), /JPEG/);
  await assert.rejects(edit.setVideoThumbnail(db, "admin1", { videoId: VID, jpeg: Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(2.1e6)]).toString("base64") }), /2 MB/);
  await assert.rejects(edit.setVideoThumbnail(db, "admin1", { videoId: FOREIGN, jpeg: JPEG }), /isn't on the King Cold Sports channel/);
  await assert.rejects(edit.setVideoThumbnail(db, "admin1", { videoId: "bad id!", jpeg: JPEG }), /Bad YouTube video id/);

  const before = Date.now();
  const r = await edit.setVideoThumbnail(db, "admin1", { videoId: VID, jpeg: JPEG, thumbId: "t1" });
  assert.equal(r.videoTitle, "Mark Bowman Film Breakdown");
  const set = google.calls.find((c) => c.url.includes("thumbnails/set"));
  assert.equal(set.opts.headers["Content-Type"], "image/jpeg");
  assert.match(set.opts.headers.Authorization, /^Bearer at-/);
  const t = (await db.doc("ytThumbnails/t1").get()).data();
  assert.equal(t.videoId, VID);
  assert.ok(t.liveFrom >= before);
  assert.equal(t.setOnYouTube.by, "admin1");
  assert.equal(t.name, "Mark Bowman · Game Review", "the rest of the record is kept");
});

test("not connected: a clear error, no YouTube call", async () => {
  await assert.rejects(edit.setVideoThumbnail(db, "admin1", { videoId: VID, jpeg: JPEG }), (e) => e.code === "edit_not_connected");
  assert.equal(google.calls.filter((c) => c.url.includes("youtube")).length, 0);
});

test("the shared sign-in return sends the edit one back to the Thumbnail tab", async () => {
  const state = await signIn();
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(code, h) { this.code = code; this.location = h.Location; }, end() {} };
  await api({ method: "GET", query: { code: "c", state }, headers: {} }, res);
  assert.equal(res.code, 302);
  assert.match(res.location, /section=thumbnail&yte=connected/);
});
