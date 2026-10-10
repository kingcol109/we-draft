// server/stream-manager/thumbnail.test.js — the generated game thumbnail
// (thumbnail.js): matchup data, logo choice, size, missing assets, and that
// generating / saving one is draft-only (metadata.js, api/stream-manager.js).
// Logos are real PNGs drawn here and served by a stubbed fetch; every
// YouTube and VM function is stubbed to record (and refuse) any call.

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");
const { fakeFirestore } = require("./__fakes__/firestore");

let db;
require.cache[path.resolve(__dirname, "../../scripts/firebaseAdmin.js")] = {
  id: "firebaseAdmin", loaded: true, exports: { getFirestore: () => db },
};

// Real image bytes for the fake logo hosts.
const png = (w, h, fill) => Buffer.from(new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${fill}"/></svg>`).render().asPng());
const LOGOS = {
  "https://cdn.example.com/unc-dark.png": png(400, 300, "#ffffff"),
  "https://cdn.example.com/unc-1.png": png(400, 300, "#7bafd4"),
  "https://cdn.example.com/wake-1.png": png(200, 400, "#9e7e38"),
  "https://cdn.example.com/wake-dark.png": null, // 404
  "https://a.espncdn.com/i/teamlogos/ncaa/500-dark/154.png": png(500, 500, "#000000"),
};
const realFetch = global.fetch;
const fetched = [];
const outbound = [];
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("identitytoolkit")) {
    const t = JSON.parse(opts.body).idToken;
    const uid = { "tok-admin": "admin1", "tok-user": "user1" }[t];
    return { ok: !!uid, status: uid ? 200 : 400, json: async () => ({ users: uid ? [{ localId: uid }] : [] }) };
  }
  fetched.push(u);
  if (u in LOGOS && LOGOS[u]) {
    const b = LOGOS[u];
    return { ok: true, status: 200, headers: { get: () => String(b.length) }, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
  }
  if (u.startsWith("https://cdn.example.com/") || u.startsWith("https://a.espncdn.com/")) return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
  outbound.push(u);
  throw new Error(`unexpected fetch ${u}`);
};
const logs = [];
const realLog = console.log, realErr = console.error;
console.log = (...a) => logs.push(a.join(" "));
console.error = (...a) => logs.push(a.join(" "));

const yt = require("./youtube");
const compute = require("./compute");
const t = require("./thumbnail");
const bc = require("./broadcasts");
const smApi = require("../../api/stream-manager");

const ytCalls = [];
const vmCalls = [];
const YT_FNS = ["accessToken", "getStream", "listStreams", "insertWorkerStream", "insertBroadcast", "bindBroadcast", "getBroadcast", "transitionBroadcast", "mineChannel", "setThumbnail"];
const realYt = Object.fromEntries(YT_FNS.map((k) => [k, yt[k]]));
const realVm = { start: compute.start, stop: compute.stop, status: compute.status };
function forbidExternal() {
  for (const k of YT_FNS) yt[k] = async () => { ytCalls.push(k); throw new Error(`YouTube ${k} must not be called`); };
  for (const k of Object.keys(realVm)) compute[k] = async () => { vmCalls.push(k); throw new Error(`VM ${k} must not be called`); };
}

const KICK = Date.parse("2026-10-17T19:30:00Z"); // Sat Oct 17, 3:30 PM ET
const seed = (more = {}) => fakeFirestore({
  "users/admin1": { role: "admin" },
  "users/user1": { role: "user" },
  "schedule26/s1": { Home: "Wake Forest", Away: "North Carolina", KickoffAt: { toMillis: () => KICK }, CFBDGameId: 401001, Slug: "north-carolina-vs-wake-forest", Time: "15:30" },
  "schedule26/s2": { Home: "Ghost U", Away: "Nowhere State", KickoffAt: { toMillis: () => KICK }, CFBDGameId: 401002, Time: "TBA" },
  "schools/unc": { School: "North Carolina", Short: "UNC", Color1: "#7BAFD4", Color2: "#13294B", Logo1: "https://cdn.example.com/unc-1.png", LogoDark: "https://cdn.example.com/unc-dark.png", CFBDTeamId: 153 },
  "schools/wake": { School: "Wake Forest", Short: "WAKE", Color1: "#9E7E38", Color2: "#000000", Logo1: "https://cdn.example.com/wake-1.png", LogoDark: "https://cdn.example.com/wake-dark.png" },
  "liveGames/401001": { status: "scheduled", home: { providerTeamId: 154 }, away: { providerTeamId: 153 } },
  ...more,
});

async function call({ auth = "Bearer tok-admin", body } = {}) {
  const res = {
    statusCode: 200, body: undefined, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await smApi({ method: "POST", query: {}, headers: auth ? { authorization: auth } : {}, body }, res);
  return res;
}
const snapshot = () => new Map([...db.store.entries()].map(([k, v]) => [k, JSON.stringify(v)]));
const changedSince = (before) => [...db.store.keys()].filter((k) => before.get(k) !== JSON.stringify(db.store.get(k))).sort();
const pngOf = (dataUrl) => Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");

beforeEach(() => {
  db = seed();
  fetched.length = 0; outbound.length = 0; ytCalls.length = 0; vmCalls.length = 0;
  forbidExternal();
});
after(() => {
  Object.assign(yt, realYt); Object.assign(compute, realVm);
  global.fetch = realFetch; console.log = realLog; console.error = realErr;
});
const assertNoYoutubeOrVm = () => {
  assert.deepEqual(ytCalls, [], "no YouTube call");
  assert.deepEqual(vmCalls, [], "no VM call");
  assert.deepEqual(outbound, [], "nothing fetched beyond team logos");
};

// ── Logo choice ──

test("logo candidates: dark-background logos first, then the primary, then ESPN by CFBD id — no duplicates", () => {
  const c = t.logoCandidates({ Logo1: "https://x/1.png", LogoDark: "https://x/d.png", LogoBlack: "https://x/b.png", CFBDTeamId: 154 });
  assert.deepEqual(c.map((x) => x.source), ["LogoDark", "LogoBlack", "Logo1", "espn-dark", "espn"]);
  assert.equal(c[3].url, "https://a.espncdn.com/i/teamlogos/ncaa/500-dark/154.png");
  assert.deepEqual(t.logoCandidates({ Logo1: "https://x/1.png", LogoDark: "https://x/1.png" }).map((x) => x.source), ["LogoDark"]);
  // the school's own CFBD id wins over the live game's; a bad id is ignored
  assert.match(t.logoCandidates({ CFBDTeamId: 1 }, 2)[0].url, /\/1\.png$/);
  assert.match(t.logoCandidates({}, 2)[0].url, /\/2\.png$/);
  assert.deepEqual(t.logoCandidates({}, "2/../x"), []);
});

test("only https logo addresses on public hosts are fetched", () => {
  for (const ok of ["https://a.espncdn.com/x.png", "https://firebasestorage.googleapis.com/v0/b/x"]) assert.equal(t.safeLogoUrl(ok), true, ok);
  for (const bad of ["http://a.espncdn.com/x.png", "https://localhost/x.png", "https://127.0.0.1/x.png", "https://[::1]/x.png", "https://10.0.0.5/x", "https://user:pw@host.com/x", "https://metadata.google.internal/x", "file:///etc/passwd", "not a url"]) {
    assert.equal(t.safeLogoUrl(bad), false, bad);
  }
});

test("image types resvg can draw are recognized; WebP and others aren't", () => {
  assert.equal(t.imageType(png(2, 2, "#fff")), "image/png");
  assert.equal(t.imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
  assert.equal(t.imageType(Buffer.from("GIF89a....")), "image/gif");
  assert.equal(t.imageType(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), "image/svg+xml");
  assert.equal(t.imageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), null);
  assert.equal(t.imageType(Buffer.from("<html>nope</html>")), null);
});

// ── Matchup data ──

test("the matchup comes from the saved schedule: away on the left, home on the right, with each school's colors and logos", async () => {
  const { game, spec, notes } = await t.gameSpec(db, "s1");
  assert.equal(game.gameId, "401001");
  assert.equal(spec.away.name, "North Carolina");
  assert.equal(spec.home.name, "Wake Forest");
  assert.equal(spec.away.color, "#7BAFD4");
  assert.equal(spec.home.color, "#9E7E38");
  assert.equal(spec.kickoffAt, KICK);
  assert.equal(spec.timeTbd, false);
  // UNC: its dark-background logo; Wake: its dark logo 404s → the primary
  assert.equal(spec.away.logo.source, "LogoDark");
  assert.equal(spec.away.logo.url, "https://cdn.example.com/unc-dark.png");
  assert.equal(spec.home.logo.source, "Logo1");
  assert.deepEqual(fetched, ["https://cdn.example.com/unc-dark.png", "https://cdn.example.com/wake-dark.png", "https://cdn.example.com/wake-1.png"]);
  assert.deepEqual(notes, []);
  // the SVG puts the away team in the left panel
  const svg = t.buildSvg(spec);
  assert.ok(svg.indexOf(">NORTH CAROLINA<") < svg.indexOf(">WAKE FOREST<"));
  assert.match(svg, /<text x="320" y="545"[^>]*>NORTH CAROLINA</);
  assert.match(svg, /<text x="960" y="545"[^>]*>WAKE FOREST</);
  assert.match(svg, />SATURDAY, OCT 17 · 3:30 PM ET</);
});

test("ESPN's logo by the live game's team id when the school doc has no logo or id", async () => {
  db = seed({ "schools/wake": { School: "Wake Forest", Color1: "#9E7E38" } });
  const { spec } = await t.gameSpec(db, "s1");
  assert.equal(spec.home.logo.source, "espn-dark");
  assert.equal(spec.home.logo.url, "https://a.espncdn.com/i/teamlogos/ncaa/500-dark/154.png");
});

// ── Image ──

test("the image is a 1280×720 PNG, and the same inputs give the same image", async () => {
  const a = await t.generate(db, "s1");
  assert.deepEqual(t.pngSize(a.png), { w: 1280, h: 720 });
  assert.equal(a.width, 1280);
  assert.equal(a.height, 720);
  const b = await t.generate(db, "s1");
  assert.equal(a.sha256, b.sha256);
  await db.doc("schools/unc").update({ Color1: "#13294B" });
  assert.notEqual((await t.generate(db, "s1")).sha256, a.sha256, "a different color is a different image");
});

test("the We-Draft logo is the real Logo2.png, embedded unchanged at its own aspect ratio", async () => {
  const { spec } = await t.gameSpec(db, "s1");
  const svg = t.buildSvg(spec);
  const file = fs.readFileSync(path.join(__dirname, "../../src/assets/Logo2.png"));
  assert.ok(svg.includes(`href="data:image/png;base64,${file.toString("base64")}"`));
  const { w, h } = t.pngSize(file);
  const m = new RegExp(`<image x="40" y="\\d+" width="(\\d+)" height="(\\d+)" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${file.toString("base64").slice(0, 40).replace(/[+/]/g, "\\$&")}`).exec(svg);
  assert.ok(m, "the logo image element");
  assert.ok(Math.abs(Number(m[1]) / Number(m[2]) - w / h) < 0.01, "aspect ratio kept");
  assert.equal(svg.includes("We-Draft.com<"), false, "never rebuilt as text");
});

test("team logos keep their proportions inside the panel box", async () => {
  const { spec } = await t.gameSpec(db, "s1");
  const imgs = [...t.buildSvg(spec).matchAll(/<image x="([\d.]+)" y="([\d.]+)" width="360" height="320" preserveAspectRatio="xMidYMid meet"/g)];
  assert.equal(imgs.length, 2);
  for (const m of imgs) {
    assert.ok(Number(m[1]) >= 0 && Number(m[1]) + 360 <= 1280);
    assert.ok(Number(m[2]) >= 0 && Number(m[2]) + 320 <= 610, "above the bottom bar");
  }
});

test("names fit their panel: long ones shrink, very long ones use the short name or are cut", () => {
  const box = { maxW: 470, size: 84, minSize: 34, shortBelow: 50 };
  const nc = t.fitText("North Carolina", "UNC", box);
  assert.equal(nc.text, "NORTH CAROLINA");
  assert.ok(t.measure(nc.text, nc.size) <= 470);
  const long = t.fitText("The University of Very Long Name Football Program", "VLN", box);
  assert.equal(long.text, "VLN");
  const noShort = t.fitText("The University of Very Long Name Football Program Extended", null, box);
  assert.equal(noShort.size, 34);
  assert.ok(noShort.text.endsWith("…"));
  assert.ok(t.measure(noShort.text, 34) <= 470);
});

test("colors: near-white primaries, look-alike teams and bad values are handled", () => {
  assert.deepEqual(t.panelColors({ color: "#7BAFD4" }, { color: "#9E7E38" }), { away: "#7bafd4", home: "#9e7e38" });
  assert.equal(t.panelColors({ color: "#FFFFFF", color2: "#13294B" }, { color: "#9E7E38" }).away, "#13294b");
  const same = t.panelColors({ color: "#840029" }, { color: "#881C1C", color2: "#000000" });
  assert.equal(same.home, "#000000", "look-alike home side takes its second color");
  const bad = t.panelColors({ color: "red" }, { color: null });
  assert.equal(bad.away, "#0055a5");
  assert.equal(bad.home, "#26334d");
});

// ── Missing assets ──

test("no branding and no loadable logo: still a full 1280×720 image, with initials and default colors", async () => {
  const r = await t.generate(db, "s2");
  assert.deepEqual(t.pngSize(r.png), { w: 1280, h: 720 });
  assert.equal(r.inputs.away.logo, null);
  assert.equal(r.inputs.home.logo, null);
  assert.ok(r.notes.some((n) => /Nowhere State: no school branding found/.test(n)));
  assert.ok(r.notes.some((n) => /Ghost U: no logo could be loaded.*initials/.test(n)));
  const { spec } = await t.gameSpec(db, "s2");
  const svg = t.buildSvg(spec);
  assert.match(svg, />NS</);
  assert.match(svg, />GU</);
  assert.match(svg, /SATURDAY, OCT 17 · TIME TBA/);
  assert.equal(t.kickoffLabel(null), "KICKOFF TBA");
});

test("a logo that isn't an image or is too large is skipped for the next one", async () => {
  const big = { ok: true, status: 200, headers: { get: () => String(10 * 1024 * 1024) }, arrayBuffer: async () => new ArrayBuffer(0) };
  const html = { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => new TextEncoder().encode("<html></html>").buffer };
  const good = LOGOS["https://cdn.example.com/unc-1.png"];
  const fakeFetch = async (u) => (u.endsWith("/a.png") ? big : u.endsWith("/b.png") ? html : { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => good.buffer.slice(good.byteOffset, good.byteOffset + good.length) });
  const r = await t.firstLogo([{ source: "A", url: "https://h.com/a.png" }, { source: "B", url: "https://h.com/b.png" }, { source: "C", url: "https://h.com/c.png" }], fakeFetch);
  assert.equal(r.logo.source, "C");
  assert.deepEqual(r.tried, ["A: too large", "B: not a PNG, JPEG, GIF or SVG"]);
});

// ── Draft-only through the API ──

test("generate: a preview only — nothing stored, no YouTube or VM call", async () => {
  const before = snapshot();
  const r = await call({ body: { action: "metadata-thumbnail-generate", scheduleId: "s1" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(t.pngSize(pngOf(r.body.dataUrl)), { w: 1280, h: 720 });
  assert.equal(r.body.gameId, "401001");
  assert.match(r.body.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(changedSince(before), []);
  assertNoYoutubeOrVm();
});

test("save: stores only broadcastThumbnails/{CFBDGameId} — no broadcast, automation, YouTube or VM change", async () => {
  const gen = (await call({ body: { action: "metadata-thumbnail-generate", scheduleId: "s1" } })).body;
  const before = snapshot();
  const r = await call({ body: { action: "metadata-thumbnail-save", scheduleId: "s1", sha256: gen.sha256 } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(changedSince(before), ["broadcastThumbnails/401001"]);
  const d = db.data("broadcastThumbnails/401001");
  assert.equal(d.gameId, "401001");
  assert.equal(d.scheduleId, "s1");
  assert.equal(d.sha256, gen.sha256);
  assert.equal(d.width, 1280);
  assert.equal(d.updatedBy, "admin1");
  assert.equal(d.version, 1);
  assert.ok(Buffer.isBuffer(d.png) && d.png.equals(pngOf(gen.dataUrl)), "the stored PNG is the previewed one");
  assert.equal(d.inputs.away.logo.source, "LogoDark");
  assert.equal([...db.store.keys()].some((k) => k.startsWith("broadcasts/")), false);
  assertNoYoutubeOrVm();

  // the editor reads it back; the other game has none
  const got = await call({ body: { action: "metadata-get", scheduleId: "s1" } });
  assert.equal(got.body.thumbnail.sha256, gen.sha256);
  assert.ok(pngOf(got.body.thumbnail.dataUrl).equals(d.png));
  assert.equal((await call({ body: { action: "metadata-get", scheduleId: "s2" } })).body.thumbnail, null);
});

test("save refuses an image that no longer matches the preview, and a missing preview", async () => {
  const gen = (await call({ body: { action: "metadata-thumbnail-generate", scheduleId: "s1" } })).body;
  await db.doc("schools/wake").update({ Color1: "#000000" });
  const r = await call({ body: { action: "metadata-thumbnail-save", scheduleId: "s1", sha256: gen.sha256 } });
  assert.equal(r.statusCode, 409);
  assert.match(r.body.error, /generate it again/);
  assert.equal((await call({ body: { action: "metadata-thumbnail-save", scheduleId: "s1" } })).statusCode, 400);
  assert.equal(db.data("broadcastThumbnails/401001"), undefined);
});

test("thumbnail actions are admin-only", async () => {
  const before = snapshot();
  for (const action of ["metadata-thumbnail-generate", "metadata-thumbnail-save", "youtube-thumbnail"]) {
    assert.equal((await call({ auth: "Bearer tok-user", body: { action, scheduleId: "s1", id: "g401001", sha256: "a".repeat(64) } })).statusCode, 403);
    assert.equal((await call({ auth: null, body: { action, scheduleId: "s1" } })).statusCode, 401);
  }
  assert.deepEqual(changedSince(before), []);
  assert.deepEqual(fetched, [], "not even a logo fetch");
});

// ── Upload Thumbnail (on demand) ──

async function savedThumb() {
  const gen = (await call({ body: { action: "metadata-thumbnail-generate", scheduleId: "s1" } })).body;
  await call({ body: { action: "metadata-thumbnail-save", scheduleId: "s1", sha256: gen.sha256 } });
  return gen.sha256;
}
const record = (more = {}) => ({ gameId: "401001", status: "scheduled", youtube: { broadcastId: "abcDEF12345", channelId: "UC1", title: "T" }, worker: {}, ...more });

test("Upload Thumbnail sends the saved PNG to the record's YouTube broadcast — and only then", async () => {
  const sha = await savedThumb();
  db.store.set("streamManager/youtube", { connected: true, channelId: "UC1" });
  db.store.set("broadcasts/g401001", record());
  assert.deepEqual(ytCalls, [], "saving uploaded nothing");
  const sent = [];
  yt.accessToken = async () => "access-token-never-logged";
  yt.setThumbnail = async (token, videoId, buf) => { sent.push({ token, videoId, buf }); return { url: null }; };
  const r = await call({ body: { action: "youtube-thumbnail", id: "g401001" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].videoId, "abcDEF12345");
  assert.ok(sent[0].buf.equals(db.data("broadcastThumbnails/401001").png));
  assert.equal(db.data("broadcasts/g401001").youtube.thumbnailSha256, sha);
});

test("Upload Thumbnail refuses rehearsals, uncreated broadcasts, and games or national coverage without a saved thumbnail", async () => {
  db.store.set("broadcasts/r401001", record({ rehearsal: true }));
  db.store.set("broadcasts/n1", record({ kind: "national", gameId: null }));
  db.store.set("broadcasts/g401001", record({ youtube: { broadcastId: null } }));
  db.store.set("broadcasts/g401009", record({ gameId: "401009" }));
  const err = async (id) => (await call({ body: { action: "youtube-thumbnail", id } })).body.error;
  assert.match(await err("r401001"), /rehearsal/);
  assert.match(await err("n1"), /National coverage has no saved thumbnail/);
  assert.match(await err("g401001"), /No YouTube broadcast yet/);
  assert.match(await err("g401009"), /no saved thumbnail/);
  assert.deepEqual(ytCalls, []);
});

// ── Automatic upload ──

// A YouTube that creates / binds broadcasts and records thumbnail uploads.
function fakeYoutube({ thumbFails = false } = {}) {
  const sent = [];
  yt.accessToken = async () => "access-token-never-logged";
  yt.getStream = async (_t, id) => ({ id, title: id, streamStatus: "ready" });
  yt.insertBroadcast = async () => ({ id: "newVid12345", lifeCycleStatus: "created", boundStreamId: null, privacyStatus: "unlisted" });
  yt.bindBroadcast = async (_t, id, streamId) => ({ id, lifeCycleStatus: "ready", boundStreamId: streamId, privacyStatus: "unlisted" });
  yt.setThumbnail = async (_t, videoId, buf) => {
    if (thumbFails) throw Object.assign(new Error("YouTube thumbnails/set failed: The authenticated user doesn't have permissions (forbidden)"), { status: 400 });
    sent.push({ videoId, buf }); return { url: null };
  };
  return sent;
}
const future = () => ({ toMillis: () => Date.now() + 3600e3 });

test("automation's YouTube create sets the saved thumbnail; a manual create doesn't", async () => {
  const sha = await savedThumb();
  db.store.set("streamManager/youtube", { connected: true, channelId: "UC1" });
  db.store.set("broadcasts/g401001", record({ scheduledStart: future(), youtube: { broadcastId: null, title: "T", description: "", privacyStatus: "unlisted" } }));
  db.store.set("broadcasts/manual1", record({ scheduledStart: future(), youtube: { broadcastId: null, title: "T", description: "", privacyStatus: "unlisted" } }));
  const sent = fakeYoutube();
  const r = await bc.youtubeCreate(db, { id: "g401001", streamId: "streamA", useDraft: true });
  assert.deepEqual(r.thumbnail, { uploaded: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].videoId, "newVid12345");
  assert.ok(sent[0].buf.equals(db.data("broadcastThumbnails/401001").png));
  assert.equal(db.data("broadcasts/g401001").youtube.thumbnailSha256, sha);
  await bc.youtubeCreate(db, { id: "manual1", streamId: "streamA" });
  assert.equal(sent.length, 1, "manual create: no automatic upload");
});

test("a failed thumbnail upload never fails the broadcast create; it's recorded", async () => {
  await savedThumb();
  db.store.set("streamManager/youtube", { connected: true, channelId: "UC1" });
  db.store.set("broadcasts/g401001", record({ scheduledStart: future(), youtube: { broadcastId: null, title: "T", description: "", privacyStatus: "unlisted" } }));
  fakeYoutube({ thumbFails: true });
  const r = await bc.youtubeCreate(db, { id: "g401001", streamId: "streamA", useDraft: true });
  assert.equal(r.ok, true);
  assert.equal(r.broadcastId, "newVid12345");
  assert.match(r.thumbnail.error, /permissions/);
  const d = db.data("broadcasts/g401001");
  assert.equal(d.youtube.broadcastId, "newVid12345");
  assert.match(d.youtube.thumbnailError, /permissions/);
  assert.equal(d.youtube.error ?? null, null, "the broadcast itself isn't in error");
});

test("saving a thumbnail sets it on the game's existing YouTube broadcast — once; never on rehearsals or ended ones", async () => {
  db.store.set("streamManager/youtube", { connected: true, channelId: "UC1" });
  db.store.set("broadcasts/g401001", record({ youtube: { broadcastId: "abcDEF12345", channelId: "UC1", lifecycleStatus: "live" } }));
  db.store.set("broadcasts/r401001", record({ rehearsal: true, youtube: { broadcastId: null } }));
  db.store.set("broadcasts/old1", record({ youtube: { broadcastId: "oldVid12345", lifecycleStatus: "complete" } }));
  const sent = fakeYoutube();
  const gen = (await call({ body: { action: "metadata-thumbnail-generate", scheduleId: "s1" } })).body;
  const r = await call({ body: { action: "metadata-thumbnail-save", scheduleId: "s1", sha256: gen.sha256 } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.youtube, [{ id: "g401001", uploaded: true }]);
  assert.deepEqual(sent.map((x) => x.videoId), ["abcDEF12345"]);
  // The same image again isn't re-sent.
  const again = await call({ body: { action: "metadata-thumbnail-save", scheduleId: "s1", sha256: gen.sha256 } });
  assert.deepEqual(again.body.youtube, [{ id: "g401001", skipped: "already uploaded" }]);
  assert.equal(sent.length, 1);
});

test("a YouTube failure on save still saves the thumbnail", async () => {
  db.store.set("streamManager/youtube", { connected: true, channelId: "UC1" });
  db.store.set("broadcasts/g401001", record({ youtube: { broadcastId: "abcDEF12345", channelId: "UC1", lifecycleStatus: "ready" } }));
  fakeYoutube({ thumbFails: true });
  const gen = (await call({ body: { action: "metadata-thumbnail-generate", scheduleId: "s1" } })).body;
  const r = await call({ body: { action: "metadata-thumbnail-save", scheduleId: "s1", sha256: gen.sha256 } });
  assert.equal(r.statusCode, 200);
  assert.equal(db.data("broadcastThumbnails/401001").sha256, gen.sha256);
  assert.match(r.body.youtube[0].error, /permissions/);
});

test("the orchestrator itself never touches thumbnails (only broadcasts.js does)", () => {
  const orch = fs.readFileSync(path.join(__dirname, "orchestrator.js"), "utf8");
  assert.equal(/setThumbnail|youtubeThumbnail|thumbnail/i.test(orch), false);
});

// ── National thumbnail ──

const ts = (ms) => ({ toMillis: () => ms });
const NW = { start: KICK - 4 * 3600e3, end: KICK + 8 * 3600e3 };
const natWin = { national: true, startAt: new Date(NW.start).toISOString(), endAt: new Date(NW.end).toISOString() };
function natDb(more = {}) {
  return seed({
    "schedule26/s1": { Home: "Wake Forest", Away: "North Carolina", KickoffAt: ts(KICK), CFBDGameId: 401001, Featured: true },
    "schedule26/g2": { Home: "Ghost U", Away: "Nowhere State", KickoffAt: ts(KICK - 3600e3), CFBDGameId: 401002, GameOfWeek: true },
    "schedule26/g3": { Home: "Navy", Away: "Army", KickoffAt: ts(KICK + 3600e3), CFBDGameId: 401003 },
    "schedule26/g4": { Home: "Air Force", Away: "Colorado State", KickoffAt: ts(KICK + 2 * 3600e3), CFBDGameId: 401004 },
    "schedule26/out": { Home: "Out", Away: "Side", KickoffAt: ts(NW.end + 3600e3), CFBDGameId: 401009, Featured: true },
    "schedule26/s2": { Home: "Ghost U", Away: "Nowhere State", KickoffAt: ts(NW.end + 7200e3), CFBDGameId: 401002, Time: "TBA" },
    ...more,
  });
}

test("national thumbnail: its own 1280×720 template — the logo on top, COLLEGE FOOTBALL, the gold NATIONAL COVERAGE · LIVE label", async () => {
  db = natDb();
  const r = await t.generateNational(db, NW);
  assert.deepEqual(t.pngSize(r.png), { w: 1280, h: 720 });
  assert.equal(r.inputs.templateVersion, "national-1");
  const { spec } = await t.nationalSpec(db, NW);
  const svg = t.buildNationalSvg(spec);
  const file = fs.readFileSync(path.join(__dirname, "../../src/assets/Logo2.png"));
  const logo = new RegExp(`<image x="\\d+" y="34" width="(\\d+)" height="64" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${file.toString("base64").slice(0, 40).replace(/[+/]/g, "\\$&")}`).exec(svg);
  assert.ok(logo, "the real logo at the top");
  assert.ok(Math.abs(Number(logo[1]) / 64 - t.pngSize(file).w / t.pngSize(file).h) < 0.02, "aspect ratio kept");
  assert.match(svg, />COLLEGE FOOTBALL</);
  assert.match(svg, />NATIONAL COVERAGE</);
  assert.match(svg, />LIVE</);
  assert.match(svg, /fill="#f6a21d"/);
  assert.match(svg, /fill="#0055a5"|stop-color="#0055a5"/);
  assert.match(svg, /SATURDAY, OCTOBER 17/);
  assert.equal(/ VS |>VS</.test(svg), false, "not a single-matchup layout");
});

test("national thumbnail: tiles for the window's Game of the Week and Featured games only, equal in size, then +N more", async () => {
  db = natDb();
  const r = await t.generateNational(db, NW);
  assert.deepEqual(r.inputs.tiles.map((x) => x.scheduleId), ["g2", "s1"], "GOTW first, then Featured; nothing outside the window");
  assert.equal(r.inputs.games, 4);
  assert.equal(r.inputs.more, 2);
  const { spec } = await t.nationalSpec(db, NW);
  const svg = t.buildNationalSvg(spec);
  const outlines = [...svg.matchAll(/<polygon points="([\d.]+),432 ([\d.]+),432 [\d.]+,608 [\d.]+,608" fill="[^"]+" stroke="#f6a21d"/g)];
  assert.equal(outlines.length, 3, "two team tiles + the more tile");
  const widths = new Set(outlines.map((m) => Math.round(Number(m[2]) - Number(m[1]))));
  assert.equal(widths.size, 1, "every tile the same size");
  assert.match(svg, />\+2</);
  assert.match(svg, />MORE GAMES</);
  // UNC's logo and Wake's are drawn; nothing invented (no scores, no ranks)
  assert.equal(r.inputs.tiles[1].away.logo.source, "LogoDark");
  assert.equal(/#\d/.test(svg.replace(/#[0-9a-fA-F]{6}/g, "")), false);
});

test("national thumbnail: missing logos show initials; a window with no games shows no tiles", async () => {
  db = natDb();
  const { spec, notes } = await t.nationalSpec(db, NW);
  assert.ok(notes.some((n) => /Nowhere State: no logo could be loaded/.test(n)));
  assert.match(t.buildNationalSvg(spec), /data-tile="0a">NS</);
  db = seed();
  const empty = await t.generateNational(db, { start: KICK + 30 * 86400e3, end: KICK + 30 * 86400e3 + 3600e3 });
  assert.deepEqual(t.pngSize(empty.png), { w: 1280, h: 720 });
  assert.deepEqual(empty.inputs.tiles, []);
  assert.equal(empty.inputs.more, 0);
  assert.ok(empty.notes.some((n) => /No games in this window/.test(n)));
});

test("national thumbnail: generating stores nothing; saving stores broadcastThumbnails/national only — no YouTube, VM or broadcast", async () => {
  db = natDb();
  let before = snapshot();
  const gen = await call({ body: { action: "metadata-thumbnail-generate", ...natWin } });
  assert.equal(gen.statusCode, 200, JSON.stringify(gen.body));
  assert.equal(gen.body.gameId, "national");
  assert.deepEqual(changedSince(before), []);
  before = snapshot();
  const saved = await call({ body: { action: "metadata-thumbnail-save", ...natWin, sha256: gen.body.sha256 } });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.deepEqual(changedSince(before), ["broadcastThumbnails/national"]);
  const d = db.data("broadcastThumbnails/national");
  assert.equal(d.kind, "national");
  assert.deepEqual(d.window, { startAt: NW.start, endAt: NW.end });
  assert.ok(d.png.equals(pngOf(gen.body.dataUrl)));
  assert.equal([...db.store.keys()].some((k) => k.startsWith("broadcasts/")), false);
  assertNoYoutubeOrVm();
  assert.equal((await call({ body: { action: "metadata-get", ...natWin } })).body.thumbnail.sha256, gen.body.sha256);
  // a game's thumbnail is separate
  assert.equal(db.data("broadcastThumbnails/401001"), undefined);
});

test("national thumbnail: a schedule change after the preview means generate again", async () => {
  db = natDb();
  const gen = (await call({ body: { action: "metadata-thumbnail-generate", ...natWin } })).body;
  await db.doc("schedule26/g3").update({ Featured: true });
  const r = await call({ body: { action: "metadata-thumbnail-save", ...natWin, sha256: gen.sha256 } });
  assert.equal(r.statusCode, 409);
  assert.equal(db.data("broadcastThumbnails/national"), undefined);
});

test("national thumbnail: Upload Thumbnail sends it to a created national broadcast — only on request", async () => {
  db = natDb();
  const gen = (await call({ body: { action: "metadata-thumbnail-generate", ...natWin } })).body;
  await call({ body: { action: "metadata-thumbnail-save", ...natWin, sha256: gen.sha256 } });
  assert.deepEqual(ytCalls, []);
  db.store.set("streamManager/youtube", { connected: true, channelId: "UC1" });
  db.store.set("broadcasts/n1", record({ kind: "national", gameId: null }));
  const sent = [];
  yt.accessToken = async () => "access-token-never-logged";
  yt.setThumbnail = async (_t, videoId, buf) => { sent.push({ videoId, buf }); return { url: null }; };
  assert.equal((await call({ body: { action: "youtube-thumbnail", id: "n1" } })).statusCode, 200);
  assert.ok(sent[0].buf.equals(db.data("broadcastThumbnails/national").png));
});

test("secrets never reach the logs", () => {
  for (const l of logs) assert.ok(!l.includes("access-token-never-logged") && !l.includes("tok-admin"), l);
});
