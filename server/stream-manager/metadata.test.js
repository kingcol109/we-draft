// server/stream-manager/metadata.test.js — YouTube title / description
// drafts (metadata.js) through api/stream-manager.js, and their use when a
// real broadcast is created (broadcasts.js youtubeCreate), on fake
// Firestore. Every YouTube and Compute Engine function is stubbed to record
// (and, outside the broadcast-creation tests, refuse) any call, and fetch
// only answers the Firebase ID-token lookup.

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { Timestamp } = require("firebase-admin/firestore");
const { fakeFirestore } = require("./__fakes__/firestore");

let db;
require.cache[path.resolve(__dirname, "../../scripts/firebaseAdmin.js")] = {
  id: "firebaseAdmin", loaded: true, exports: { getFirestore: () => db },
};
const realFetch = global.fetch;
const outbound = [];
global.fetch = async (url, opts) => {
  if (String(url).includes("identitytoolkit")) {
    const t = JSON.parse(opts.body).idToken;
    const uid = { "tok-admin": "admin1", "tok-user": "user1" }[t];
    return { ok: !!uid, status: uid ? 200 : 400, json: async () => ({ users: uid ? [{ localId: uid }] : [] }) };
  }
  outbound.push(String(url));
  throw new Error(`unexpected fetch ${url}`);
};
const logs = [];
const realLog = console.log, realErr = console.error;
console.log = (...a) => logs.push(a.join(" "));
console.error = (...a) => logs.push(a.join(" "));

const yt = require("./youtube");
const compute = require("./compute");
const bc = require("./broadcasts");
const orch = require("./orchestrator");
const md = require("./metadata");
const smApi = require("../../api/stream-manager");

// Any YouTube / VM call is recorded; by default each one throws.
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
const NOW = KICK - 3 * 86400e3;
const seed = (more = {}) => fakeFirestore({
  "users/admin1": { role: "admin" },
  "users/user1": { role: "user" },
  "schedule26/s1": { Home: "Wake Forest", Away: "North Carolina", KickoffAt: { toMillis: () => KICK }, CFBDGameId: 401001, Slug: "north-carolina-vs-wake-forest", Week: "Week 8" },
  "schedule26/s2": { Home: "LSU", Away: "Clemson", KickoffAt: { toMillis: () => KICK }, CFBDGameId: 401002, Slug: "clemson-vs-lsu" },
  "schedule26/unlinked": { Home: "A", Away: "B", KickoffAt: { toMillis: () => KICK } },
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
const docPaths = () => [...db.store.keys()].sort();
const save = (body, auth) => call({ auth, body: { action: "metadata-save", scheduleId: "s1", ...body } });
const get = (scheduleId = "s1", auth) => call({ auth, body: { action: "metadata-get", scheduleId } });

beforeEach(() => {
  db = seed();
  ytCalls.length = 0; vmCalls.length = 0; outbound.length = 0;
  forbidExternal();
});
after(() => {
  Object.assign(yt, realYt); Object.assign(compute, realVm);
  global.fetch = realFetch; console.log = realLog; console.error = realErr;
});
const assertNothingExternal = () => {
  assert.deepEqual(ytCalls, [], "no YouTube call");
  assert.deepEqual(vmCalls, [], "no VM call");
  assert.deepEqual(outbound, [], "no outbound HTTP");
};

// ── Validation ──

test("validation: title required, ≤100 characters, no < or >", () => {
  assert.match(md.validateMetadata({ title: "  ", description: "" }).errors.title, /required/);
  assert.equal(md.validateMetadata({ title: "x".repeat(100) }).errors.title, undefined);
  assert.match(md.validateMetadata({ title: "x".repeat(101) }).errors.title, /100 characters or fewer \(it's 101\)/);
  // characters, not UTF-16 units: 100 emoji are 100 characters
  assert.equal(md.validateMetadata({ title: "🏈".repeat(100) }).errors.title, undefined);
  assert.match(md.validateMetadata({ title: "A <b> title" }).errors.title, /< or >/);
});

test("validation: description ≤5000 UTF-8 bytes, no < or >, line breaks kept", () => {
  assert.equal(md.validateMetadata({ title: "t", description: "a".repeat(5000) }).errors.description, undefined);
  assert.match(md.validateMetadata({ title: "t", description: "a".repeat(5001) }).errors.description, /5000 bytes or fewer \(it's 5001\)/);
  // 2,000 × "é" is 2,000 characters but 4,000 bytes; 2,501 is over
  assert.equal(md.validateMetadata({ title: "t", description: "é".repeat(2500) }).errors.description, undefined);
  assert.match(md.validateMetadata({ title: "t", description: "é".repeat(2501) }).errors.description, /5002/);
  assert.match(md.validateMetadata({ title: "t", description: "x > y" }).errors.description, /< or >/);
  const v = md.validateMetadata({ title: " Big  game \n", description: "\r\nLine 1\r\n\r\nLine 3\n  indented\n" });
  assert.equal(v.title, "Big game");
  assert.equal(v.description, "Line 1\n\nLine 3\n  indented");
});

// ── Authorization ──

test("metadata actions are admin-only; unauthorized writes are rejected and write nothing", async () => {
  const before = docPaths();
  for (const action of ["metadata-get", "metadata-save"]) {
    assert.equal((await call({ auth: "Bearer tok-user", body: { action, scheduleId: "s1", title: "T" } })).statusCode, 403);
    assert.equal((await call({ auth: null, body: { action, scheduleId: "s1", title: "T" } })).statusCode, 401);
    assert.equal((await call({ auth: "Bearer forged", body: { action, scheduleId: "s1", title: "T" } })).statusCode, 401);
  }
  assert.deepEqual(docPaths(), before);
  assert.equal(db.data("broadcastMetadata/401001"), undefined);
  assertNothingExternal();
});

// ── Editor reads ──

test("opening the editor for an unenabled game with no broadcast record: generated text, no draft, nothing written", async () => {
  const before = docPaths();
  const r = await get();
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.draft, null);
  assert.deepEqual(r.body.broadcast, { exists: false, youtubeCreated: false });
  assert.deepEqual(r.body.limits, { titleMax: 100, descriptionMaxBytes: 5000 });
  assert.equal(r.body.game.gameId, "401001");
  assert.equal(r.body.defaults.title, "North Carolina vs Wake Forest LIVE Score and Play by Play");
  assert.match(r.body.defaults.description, /^Watch the North Carolina take on the Wake Forest LIVE with We-Draft Live/);
  assert.match(r.body.defaults.description, /\n📅 Date: Saturday, October 17, 2026\n⏰ Kickoff: 3:30 PM ET\n/);
  assert.match(r.body.defaults.description, /#NorthCarolinaFootball #WakeForestFootball #NCvsWF #CollegeFootball$/);
  assert.deepEqual(docPaths(), before, "a read writes nothing");
  assertNothingExternal();
});

test("an unlinked or unknown schedule game can't have a draft", async () => {
  assert.equal((await get("unlinked")).statusCode, 400);
  assert.equal((await get("nope")).statusCode, 404);
  assert.equal((await get("../x")).statusCode, 400);
  assert.equal((await save({ scheduleId: "unlinked", title: "T" })).statusCode, 400);
});

// ── Generated text ──

test("the generated title and description follow the template exactly", () => {
  const v = md.buildGenerated({
    away: { school: "Florida State", short: "FSU", mascot: "Seminoles", rank: 23 },
    home: { school: "Louisville", short: "Louisville", mascot: "Cardinals", rank: 24 },
    kickoffAt: KICK,
  });
  assert.equal(v.title, "Florida State vs Louisville LIVE Score and Play by Play");
  assert.equal(v.description, `Watch the (#23) Florida State Seminoles take on the (#24) Louisville Cardinals LIVE with We-Draft Live, your destination for college football coverage.
Follow the matchup with live game information, scoring updates, and a dynamic football broadcast experience.
🏈 Matchup: Florida State vs Louisville
📅 Date: Saturday, October 17, 2026
⏰ Kickoff: 3:30 PM ET
Follow We-Draft for more college football coverage, player evaluations, and NFL Draft scouting.
🌐 Website: https://we-draft.com
📺 YouTube: https://www.youtube.com/@kingcoldsports
Subscribe for more college football content throughout the season.
#FloridaStateFootball #LouisvilleFootball #FSUvsLOU #CollegeFootball`);
  assert.deepEqual(v.errors, {});
});

test("generated text: unranked teams, no mascot, time TBA, hashtags from any school name", () => {
  const v = md.buildGenerated({ away: { school: "Texas A&M", mascot: "Aggies", rank: null }, home: { school: "San José State", mascot: null }, kickoffAt: KICK, timeTbd: true });
  assert.match(v.description, /^Watch the Texas A&M Aggies take on the San José State LIVE/);
  assert.match(v.description, /⏰ Kickoff: TBA\n/);
  assert.match(v.description, /#TexasAMFootball #SanJoseStateFootball #TAMvsSJS #CollegeFootball$/);
  assert.match(md.buildGenerated({ away: { school: "A" }, home: { school: "B" }, kickoffAt: null }).description, /📅 Date: TBA\n⏰ Kickoff: TBA/);
  assert.equal(md.hashtag("Miami (OH)"), "#MiamiOHFootball");
});

test("matchup hashtag: short names when they're short, else initials, else the first three letters", () => {
  assert.equal(md.matchupTag({ school: "Florida State", short: "FSU" }, { school: "Louisville", short: "Louisville" }), "#FSUvsLOU");
  assert.equal(md.teamAbbr({ school: "Boston College" }), "BC");
  assert.equal(md.teamAbbr({ school: "Texas A&M", short: "TAMU" }), "TAMU");
  assert.equal(md.teamAbbr({ school: "Miami (OH)", short: "M-OH" }), "MOH");
  assert.equal(md.teamAbbr({ school: "LSU" }), "LSU");
});

test("generated text: ranks from the live game, else the week's poll; mascots from the schools", async () => {
  db = seed({
    "schools/a": { School: "North Carolina", Mascot: "Tar Heels" },
    "schools/b": { School: "Wake Forest", Mascot: "Demon Deacons" },
    "liveGames/401001": { away: { rank: 12 }, home: { rank: null } },
    "rankings/Week 8": { Top25: [{ School: "Wake Forest", Rank: 19 }, { School: "North Carolina", Rank: 3 }] },
  });
  const r = await get();
  assert.match(r.body.defaults.description, /^Watch the \(#12\) North Carolina Tar Heels take on the \(#19\) Wake Forest Demon Deacons LIVE/);
  assertNothingExternal();
});

// ── Saving ──

test("save then reload: stored under the CFBD game id with who / when, and versioned", async () => {
  const r = await save({ title: "UNC at Wake: Live", description: "Line one\n\nLine three", baseVersion: 0 });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.gameId, "401001");
  const d = db.data("broadcastMetadata/401001");
  assert.equal(d.gameId, "401001");
  assert.equal(d.scheduleId, "s1");
  assert.equal(d.title, "UNC at Wake: Live");
  assert.equal(d.description, "Line one\n\nLine three");
  assert.equal(d.updatedBy, "admin1");
  assert.equal(d.createdBy, "admin1");
  assert.equal(d.version, 1);
  assert.equal("thumbnail" in d, false, "thumbnails live in broadcastThumbnails, not the text draft");

  const back = await get();
  assert.equal(back.body.draft.title, "UNC at Wake: Live");
  assert.equal(back.body.draft.description, "Line one\n\nLine three");
  assert.equal(back.body.draft.version, 1);
  assert.equal(back.body.draft.updatedBy, "admin1");
  assert.ok(back.body.draft.updatedAt > 0);
  // the other game is untouched
  assert.equal((await get("s2")).body.draft, null);

  assert.equal((await save({ title: "Second", description: "", baseVersion: 1 })).statusCode, 200);
  assert.equal(db.data("broadcastMetadata/401001").version, 2);
  assert.equal(db.data("broadcastMetadata/401001").title, "Second");
  assertNothingExternal();
});

test("a save from an editor opened on an older version is refused", async () => {
  await save({ title: "First", baseVersion: 0 });
  const stale = await save({ title: "From an old tab", baseVersion: 0 });
  assert.equal(stale.statusCode, 409);
  assert.match(stale.body.error, /saved somewhere else/);
  assert.equal(db.data("broadcastMetadata/401001").title, "First");
});

test("an invalid save is refused field by field and writes nothing", async () => {
  const r = await save({ title: "x".repeat(101), description: "<script>" });
  assert.equal(r.statusCode, 400);
  assert.match(r.body.fields.title, /100 characters/);
  assert.match(r.body.fields.description, /< or >/);
  assert.equal(db.data("broadcastMetadata/401001"), undefined);
});

test("saving changes only the draft: no YouTube, VM, agent, worker, automation, broadcast or schedule change", async () => {
  db = seed({
    "streamManager/orchestrator": { capacity: 0, slotsInUse: 0 },
    "streamManager/agent": { lastSeenAt: 1, containers: [] },
    "liveGames/401001": { status: "scheduled", slug: "north-carolina-vs-wake-forest" },
  });
  const before = new Map([...db.store.entries()].map(([k, v]) => [k, JSON.stringify(v)]));
  assert.equal((await save({ title: "Draft only", description: "d" })).statusCode, 200);
  const changed = [...db.store.keys()].filter((k) => before.get(k) !== JSON.stringify(db.store.get(k)));
  assert.deepEqual(changed, ["broadcastMetadata/401001"]);
  assert.equal([...db.store.keys()].some((k) => k.startsWith("broadcasts/")), false, "no broadcast record created");
  assertNothingExternal();
});

test("a draft never changes an existing broadcast — even one already created on YouTube", async () => {
  const rec = {
    gameId: "401001", status: "scheduled",
    youtube: { title: "Original", description: "orig", broadcastId: "yt1", lifecycleStatus: "ready" },
    worker: { status: "idle" }, auto: { phase: "selected", open: true, enabled: true },
  };
  db = seed({ "broadcasts/g401001": rec });
  const r = await get();
  assert.deepEqual(r.body.broadcast, { exists: true, youtubeCreated: true });
  await save({ title: "New title", description: "new" });
  assert.deepEqual(db.data("broadcasts/g401001"), rec);
  assertNothingExternal();
});

test("opening and saving drafts never enables automation", async () => {
  await get();
  await save({ title: "T" });
  assert.equal((await call({ body: { action: "metadata-save", scheduleId: "s1", title: "T", enabled: true, rehearsal: false } })).statusCode, 200);
  assert.equal([...db.store.keys()].filter((k) => k.startsWith("broadcasts/")).length, 0);
});

// ── Broadcast creation ──

function realYoutube() {
  const made = [];
  yt.accessToken = async () => "access-token-never-logged";
  yt.getStream = async (_t, id) => ({ id, title: id, streamStatus: "ready", healthStatus: "noData" });
  yt.listStreams = async () => [];
  yt.insertBroadcast = async (_t, args) => { made.push(args); return { id: `b${made.length}`, lifeCycleStatus: "ready", privacyStatus: args.privacyStatus, boundStreamId: null }; };
  yt.bindBroadcast = async (_t, id, streamId) => ({ id, lifeCycleStatus: "ready", privacyStatus: "unlisted", boundStreamId: streamId });
  return made;
}
function creationDb(more = {}) {
  return seed({
    "schools/a": { School: "North Carolina", Mascot: "Tar Heels" },
    "schools/b": { School: "Wake Forest", Mascot: "Demon Deacons" },
    "streamManager/youtube": { connected: true, channelId: "UC1", workerStreamId: "streamA" },
    "liveGames/401001": { status: "scheduled", slug: "north-carolina-vs-wake-forest", away: { rank: 12 } },
    "liveGames/401002": { status: "scheduled", slug: "clemson-vs-lsu" },
    ...more,
  });
}
const enable = async (scheduleId = "s1", extra = {}) => (await orch.selectGame(db, "admin1", { scheduleId, ...extra }, NOW)).id;
const future = async (id) => db.doc(`broadcasts/${id}`).update({ scheduledStart: Timestamp.fromMillis(Date.now() + 86400e3) });

test("a real broadcast created by automation uses the saved draft (and leaves the draft alone)", async () => {
  db = creationDb();
  await save({ title: "Tar Heels at Demon Deacons — LIVE", description: "Line 1\n\nLine 3" });
  const draft = db.data("broadcastMetadata/401001");
  const id = await enable();
  await future(id);
  const made = realYoutube();
  await bc.youtubeCreate(db, { id, streamId: "streamA", useDraft: true });
  assert.equal(made.length, 1);
  assert.equal(made[0].title, "Tar Heels at Demon Deacons — LIVE");
  assert.equal(made[0].description, "Line 1\n\nLine 3");
  const rec = db.data(`broadcasts/${id}`);
  assert.equal(rec.youtube.title, "Tar Heels at Demon Deacons — LIVE");
  assert.equal(rec.youtube.metadataSource, "draft");
  assert.equal(rec.youtube.metadataVersion, 1);
  assert.deepEqual(db.data("broadcastMetadata/401001"), draft, "creating the broadcast never rewrites the draft");
});

test("no draft: the generated title / description, with ranks and mascots as of creation", async () => {
  db = creationDb();
  const id = await enable();
  await future(id);
  const made = realYoutube();
  await bc.youtubeCreate(db, { id, streamId: "streamA", useDraft: true });
  assert.equal(made[0].title, "North Carolina vs Wake Forest LIVE Score and Play by Play");
  assert.match(made[0].description, /^Watch the \(#12\) North Carolina Tar Heels take on the Wake Forest Demon Deacons LIVE/);
  const rec = db.data(`broadcasts/${id}`);
  assert.equal(rec.youtube.metadataSource, "generated");
  assert.equal(rec.youtube.title, made[0].title);
  assert.equal(db.data("broadcastMetadata/401001"), undefined, "generating never saves a draft");
});

test("one game's draft is never used for another game", async () => {
  db = creationDb();
  await save({ title: "Wake Forest draft" });
  const id = await enable("s2");
  await future(id);
  const made = realYoutube();
  await bc.youtubeCreate(db, { id, streamId: "streamA", useDraft: true });
  assert.equal(made[0].title, "Clemson vs LSU LIVE Score and Play by Play");
  // a doc under one id that names another game is ignored
  await db.doc("broadcastMetadata/401002").set({ gameId: "401001", title: "Mislabeled", description: "" });
  assert.equal(await md.draftForBroadcast(db, "401002"), null);
});

test("an invalid stored draft falls back to the generated text", async () => {
  db = creationDb({ "broadcastMetadata/401001": { gameId: "401001", title: "x".repeat(150), description: "", version: 3 } });
  const id = await enable();
  await future(id);
  const made = realYoutube();
  await bc.youtubeCreate(db, { id, streamId: "streamA", useDraft: true });
  assert.equal(made[0].title, "North Carolina vs Wake Forest LIVE Score and Play by Play");
});

test("when the schedule game is gone, the record's own text is used", async () => {
  db = creationDb();
  const id = await enable();
  await future(id);
  db.store.delete("schedule26/s1");
  const made = realYoutube();
  await bc.youtubeCreate(db, { id, streamId: "streamA", useDraft: true });
  assert.equal(made[0].title, "We-Draft Live: North Carolina vs Wake Forest");
  assert.equal(db.data(`broadcasts/${id}`).youtube.metadataSource, "record");
});

test("a manual Create on YouTube (no useDraft) keeps the record's own title", async () => {
  db = creationDb();
  await save({ title: "Draft title" });
  const id = await enable();
  await future(id);
  const made = realYoutube();
  await bc.youtubeCreate(db, { id });
  assert.equal(made[0].title, "We-Draft Live: North Carolina vs Wake Forest");
});

// (The orchestrator passing useDraft: true is checked in orchestrator.test.js's
// kickoff workflow.)

test("rehearsal records and drafts stay separate from real broadcast records", async () => {
  db = creationDb();
  await save({ title: "Real draft" });
  const draft = db.data("broadcastMetadata/401001");
  const rid = await enable("s1", { rehearsal: true });
  assert.equal(rid, "r401001");
  const r = db.data("broadcasts/r401001");
  assert.equal(r.rehearsal, true);
  assert.notEqual(r.youtube.title, "Real draft", "a rehearsal never takes the draft");
  // the editor doesn't count a rehearsal as a broadcast
  assert.deepEqual((await get()).body.broadcast, { exists: false, youtubeCreated: false });
  const made = realYoutube();
  await assert.rejects(bc.youtubeCreate(db, { id: rid, streamId: "streamA", useDraft: true }), /rehearsal record/);
  assert.equal(made.length, 0);
  assert.deepEqual(db.data("broadcastMetadata/401001"), draft);
  assert.equal(db.data("broadcasts/g401001"), undefined, "no real record appeared");
});

// ── National coverage metadata ──

const ts = (ms) => ({ toMillis: () => ms });
// A week after the seed's own games, so only these are in the window.
const KN = KICK + 7 * 86400e3;
const W0 = KN - 4 * 3600e3;
const W1 = KN + 8 * 3600e3;
const natWindow = { startAt: new Date(W0).toISOString(), endAt: new Date(W1).toISOString() };
const natSeed = (more = {}) => seed({
  "schedule26/n1": { Home: "Louisville", Away: "Florida State", KickoffAt: ts(KN + 3600e3), CFBDGameId: 501, GameOfWeek: true, Week: "Week 8" },
  "schedule26/n2": { Home: "Ohio State", Away: "Penn State", KickoffAt: ts(KN - 3600e3), CFBDGameId: 502, Featured: true, Week: "Week 8" },
  "schedule26/n3": { Home: "Navy", Away: "Army", KickoffAt: ts(KN + 2 * 3600e3), CFBDGameId: 503, Week: "Week 8" },
  "schedule26/late": { Home: "Late", Away: "Night", KickoffAt: ts(W1 + 3600e3), CFBDGameId: 504, Featured: true, Week: "Week 8" },
  "schools/fsu": { School: "Florida State", Short: "FSU" },
  "schools/lou": { School: "Louisville", Short: "Louisville" },
  ...more,
});
const natGet = () => call({ body: { action: "metadata-get", national: true, ...natWindow } });

test("national: the generated title and description follow the template, with the window's top game as a hashtag", () => {
  const v = md.buildNationalGenerated({ top: { away: { school: "Florida State", short: "FSU" }, home: { school: "Louisville", short: null } } });
  assert.equal(v.title, "College Football LIVE | Scores, Highlights & Action Around the Country");
  assert.equal(v.description, `College football action from across the country — all in one place. 🏈

Welcome to the We-Draft Live National Stream, where we follow the action around college football and bring you updates from games across the country throughout the day.

From major matchups to unexpected momentum swings, stay connected to the national college football landscape with We-Draft Live.

📊 Follow college football: https://we-draft.com
📺 More football coverage: https://www.youtube.com/@kingcoldsports

Subscribe for college football coverage, player evaluations, and NFL Draft scouting throughout the season.

#CollegeFootball #CollegeFootballLive #WeDraftLive #FSUvsLOU`);
  assert.deepEqual(v.errors, {});
  assert.match(md.buildNationalGenerated({ top: null }).description, /#CollegeFootball #CollegeFootballLive #WeDraftLive$/);
});

test("national: the window's games come from the schedule — Game of the Week leads, then Featured; the rest are counted", async () => {
  db = natSeed();
  const ni = await md.nationalInputs(db, { start: W0, end: W1 });
  assert.deepEqual(ni.games.map((g) => g.scheduleId), ["n2", "n1", "n3"], "kickoff order, only inside the window");
  assert.deepEqual(ni.tiles.map((g) => g.scheduleId), ["n1", "n2"]);
  assert.equal(ni.more, 1);
  assert.equal(ni.top.scheduleId, "n1");
  assert.equal(md.matchupTag(ni.top.away, ni.top.home), "#FSUvsLOU");
});

test("national: no Game of the Week or Featured game → the best-ranked matchup; nothing ranked → no top game", async () => {
  db = natSeed({
    "schedule26/n1": { Home: "Louisville", Away: "Florida State", KickoffAt: ts(KN + 3600e3), CFBDGameId: 501, Week: "Week 8" },
    "schedule26/n2": { Home: "Ohio State", Away: "Penn State", KickoffAt: ts(KN - 3600e3), CFBDGameId: 502, Week: "Week 8" },
    "rankings/Week 8": { Top25: [{ School: "Ohio State", Rank: 2 }, { School: "Penn State", Rank: 7 }, { School: "Louisville", Rank: 24 }] },
  });
  const ni = await md.nationalInputs(db, { start: W0, end: W1 });
  assert.deepEqual(ni.tiles.map((g) => g.scheduleId), ["n2", "n1"], "both-ranked first, then one-ranked");
  db.store.delete("rankings/Week 8");
  const none = await md.nationalInputs(db, { start: W0, end: W1 });
  assert.equal(none.top, null);
  assert.equal(none.more, 3);
  assert.match(md.buildNationalGenerated(none).description, /#WeDraftLive$/);
});

test("national: opening the editor reads the generated text for the window and writes nothing", async () => {
  db = natSeed();
  const before = docPaths();
  const r = await natGet();
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.game, null);
  assert.deepEqual(r.body.national, { startAt: W0, endAt: W1 });
  assert.equal(r.body.draft, null);
  assert.equal(r.body.defaults.title, "College Football LIVE | Scores, Highlights & Action Around the Country");
  assert.match(r.body.defaults.description, /#WeDraftLive #FSUvsLOU$/);
  assert.deepEqual(r.body.broadcast, { exists: false, youtubeCreated: false });
  assert.deepEqual(docPaths(), before);
  assertNothingExternal();
});

test("national: a bad window is refused", async () => {
  const bad = async (startAt, endAt) => (await call({ body: { action: "metadata-get", national: true, startAt, endAt } })).statusCode;
  assert.equal(await bad("nope", natWindow.endAt), 400);
  assert.equal(await bad(natWindow.endAt, natWindow.startAt), 400);
  assert.equal(await bad(new Date(W0).toISOString(), new Date(W0 + 21 * 3600e3).toISOString()), 400);
});

test("national: saving stores broadcastMetadata/national only — no broadcast, schedule, YouTube or VM change", async () => {
  db = natSeed();
  const before = new Map([...db.store.entries()].map(([k, v]) => [k, JSON.stringify(v)]));
  const r = await call({ body: { action: "metadata-save", national: true, ...natWindow, title: "National title", description: "Line 1\n\nLine 3", baseVersion: 0 } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const changed = [...db.store.keys()].filter((k) => before.get(k) !== JSON.stringify(db.store.get(k)));
  assert.deepEqual(changed, ["broadcastMetadata/national"]);
  const d = db.data("broadcastMetadata/national");
  assert.equal(d.gameId, "national");
  assert.equal(d.kind, "national");
  assert.equal(d.description, "Line 1\n\nLine 3");
  assert.equal((await natGet()).body.draft.title, "National title");
  // a game's editor never sees it
  assert.equal((await get("s1")).body.draft, null);
  assertNothingExternal();
});

test("national: a created national broadcast takes the saved draft, else the window's generated text", async () => {
  db = natSeed({ "streamManager/youtube": { connected: true, channelId: "UC1", workerStreamId: "streamA" } });
  const { id } = await orch.selectNational(db, "admin1", { startAt: new Date(W0).toISOString(), endAt: new Date(W1).toISOString() }, W0 - 86400e3);
  await db.doc(`broadcasts/${id}`).update({ scheduledStart: Timestamp.fromMillis(Date.now() + 86400e3) });
  assert.equal(db.data(`broadcasts/${id}`).youtube.title, "College Football LIVE | Scores, Highlights & Action Around the Country");
  let made = realYoutube();
  await bc.youtubeCreate(db, { id, streamId: "streamA", useDraft: true });
  assert.equal(made[0].title, "College Football LIVE | Scores, Highlights & Action Around the Country");
  assert.match(made[0].description, /#WeDraftLive #FSUvsLOU$/);
  assert.equal(db.data(`broadcasts/${id}`).youtube.metadataSource, "generated");

  // a second window, with a saved draft
  await call({ body: { action: "metadata-save", national: true, ...natWindow, title: "Saturday Showcase", description: "d" } });
  const w2 = { startAt: new Date(W1 + 3600e3).toISOString(), endAt: new Date(W1 + 5 * 3600e3).toISOString() };
  const { id: id2 } = await orch.selectNational(db, "admin1", w2, W0 - 86400e3);
  await db.doc(`broadcasts/${id2}`).update({ scheduledStart: Timestamp.fromMillis(Date.now() + 86400e3) });
  made = realYoutube();
  await bc.youtubeCreate(db, { id: id2, streamId: "streamA", useDraft: true });
  assert.equal(made[0].title, "Saturday Showcase");
  assert.equal(db.data(`broadcasts/${id2}`).youtube.metadataSource, "draft");
});

test("national: a rehearsal window never takes the draft and never reaches YouTube", async () => {
  db = natSeed({ "streamManager/youtube": { connected: true, channelId: "UC1", workerStreamId: "streamA" } });
  await call({ body: { action: "metadata-save", national: true, ...natWindow, title: "Real national", description: "" } });
  const { id } = await orch.selectNational(db, "admin1", { ...natWindow, rehearsal: true }, W0 - 86400e3);
  assert.match(id, /^rn/);
  assert.notEqual(db.data(`broadcasts/${id}`).youtube.title, "Real national");
  const made = realYoutube();
  await assert.rejects(bc.youtubeCreate(db, { id, streamId: "streamA", useDraft: true }), /rehearsal record/);
  assert.equal(made.length, 0);
});

test("secrets never reach the logs", () => {
  for (const l of logs) assert.ok(!l.includes("access-token-never-logged") && !l.includes("tok-admin"), l);
});
