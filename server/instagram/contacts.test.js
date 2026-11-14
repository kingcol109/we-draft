// server/instagram/contacts.test.js — player ↔ Instagram associations and
// the messaging webhook (server/instagram/contacts.js,
// api/instagram-webhook.js), with Firestore and Meta faked.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { fakeFirestore } = require("../stream-manager/__fakes__/firestore");
const c = require("./contacts");

// Timestamps with fromMillis, as the Admin SDK's.
class Ts { constructor(m) { this.m = m; } toMillis() { return this.m; } static fromMillis(m) { return new Ts(m); } }
let clock = 1_800_000_000_000;
const now = () => new Ts(clock);

const seed = () => fakeFirestore({
  "players/p1": { First: "Colin", Last: "Simmons", Position: "EDGE", School: "Texas", Eligible: "2027", Slug: "colin-simmons-2027-edge" },
  "players/p2": { First: "Arch", Last: "Manning", Position: "QB", School: "Texas", Eligible: "2027", Slug: "arch-manning-2027-qb" },
});
const ctx = (db, graph = null) => c.context(db, { uid: "admin1", now, graph, accountId: "IG_US" });
// Meta as it behaves for us: conversations list each participant with their
// IGSID and username; the User Profile API refuses (#230) unless profile() says otherwise.
const fakeGraph = ({ convs = {}, profile } = {}) => async (path) => {
  if (path === "/IG_US/conversations") {
    return { data: Object.entries(convs).map(([id, username]) => ({ updated_time: new Date(clock).toISOString(), participants: { data: [{ id: "IG_US", username: "wedraftsite" }, { id, username }] } })) };
  }
  if (profile) return profile(path);
  throw Object.assign(new Error("(#230) User consent is required to access user profile"), { metaCode: 230 });
};
const contacts = (db) => [...db.store.keys()].filter((k) => /^instagramContacts\/[^/]+$/.test(k)).map((k) => ({ id: k.split("/")[1], ...db.data(k) }));
const history = (db, id) => [...db.store.keys()].filter((k) => k.startsWith(`instagramContacts/${id}/history/`)).map((k) => db.data(k));

test("usernames: @, profile links and case are normalized; junk is refused", () => {
  assert.deepEqual(c.normalizeUsername("@Colin.Simmons"), { display: "Colin.Simmons", lower: "colin.simmons" });
  assert.deepEqual(c.normalizeUsername("https://www.instagram.com/colin_s/?igsh=abc"), { display: "colin_s", lower: "colin_s" });
  for (const bad of ["", "has space", "x".repeat(31), ".lead", "trail.", "a..b", "emoji😀"]) assert.equal(c.normalizeUsername(bad), null, bad);
});

test("a manual association is pending with no IGSID; the same username can't go on a second player", async () => {
  const db = seed();
  const r = await c.saveContact(ctx(db), { playerId: "p1", username: "@ColinSimmons" });
  const [rec] = contacts(db);
  assert.equal(rec.id, r.contactId);
  assert.equal(rec.accountStatus, "pending");
  assert.equal(rec.instagramScopedUserId, null);
  assert.equal(rec.active, true);
  assert.equal(rec.playerName, "Colin Simmons");
  assert.equal(history(db, rec.id)[0].action, "created");
  await assert.rejects(c.saveContact(ctx(db), { playerId: "p2", username: "colinsimmons" }), (e) => e.status === 409 && e.code === "username_taken");
  // The same player again: nothing new.
  const again = await c.saveContact(ctx(db), { playerId: "p1", username: "colinsimmons" });
  assert.equal(again.unchanged, true);
  assert.equal(contacts(db).length, 1);
});

test("a new account replaces the player's active one, which is kept as inactive", async () => {
  const db = seed();
  const a = await c.saveContact(ctx(db), { playerId: "p1", username: "old_handle" });
  const b = await c.saveContact(ctx(db), { playerId: "p1", username: "new_handle", verificationMethod: "player_provided" });
  const old = db.data(`instagramContacts/${a.contactId}`);
  assert.equal(old.active, false);
  assert.equal(old.accountStatus, "inactive");
  assert.equal(old.deactivatedReason, "replaced");
  assert.equal(old.replacedBy, b.contactId);
  assert.equal(contacts(db).filter((x) => x.active).length, 1);
  // The freed username can now go on someone else.
  await c.saveContact(ctx(db), { playerId: "p2", username: "old_handle" });
});

test("edit renames with history; disconnect keeps the record; verify needs an IGSID", async () => {
  const db = seed();
  const { contactId } = await c.saveContact(ctx(db), { playerId: "p1", username: "typo_hndle" });
  await c.saveContact(ctx(db), { contactId, username: "typo_handle", notes: "fixed" });
  const rec = db.data(`instagramContacts/${contactId}`);
  assert.equal(rec.instagramUsername, "typo_handle");
  assert.deepEqual(rec.usernameHistory.map((h) => h.username), ["typo_hndle", "typo_handle"]);
  assert.equal(rec.playerId, "p1");
  await assert.rejects(c.verifyContact(ctx(db), { contactId }), (e) => e.code === "no_igsid");
  await c.disconnectContact(ctx(db), { contactId, reason: "wrong guy" });
  assert.equal(db.data(`instagramContacts/${contactId}`).accountStatus, "inactive");
  assert.deepEqual(history(db, contactId).map((h) => h.action), ["created", "edited", "disconnected"]);
});

const sign = (raw, secret) => `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
const delivery = (events) => ({ object: "instagram", entry: [{ id: "IG_US", time: 1, messaging: events }] });
const inbound = (mid, from, text) => ({ sender: { id: from }, recipient: { id: "IG_US" }, timestamp: clock, message: { mid, text } });

test("webhook: a message is stored once; the sender is suggested (not linked) for a pending username", async () => {
  const db = seed();
  const { contactId } = await c.saveContact(ctx(db), { playerId: "p1", username: "colinsimmons" });
  const graph = fakeGraph({ convs: { IGSID_1: "ColinSimmons" } });
  const body = delivery([inbound("m1", "IGSID_1", "hey")]);
  const r1 = await c.processWebhook(ctx(db, graph), body);
  const r2 = await c.processWebhook(ctx(db, graph), body); // Meta retries
  assert.equal(r1.inbound, 1);
  assert.equal(r2.duplicate, 1);
  const msg = db.data("instagramMessages/m1");
  assert.equal(msg.igsid, "IGSID_1");
  assert.equal(msg.direction, "in");
  assert.equal(msg.playerId, null);
  const s = db.data("instagramSenders/IGSID_1");
  assert.equal(s.messageCount, 1);
  assert.equal(s.username, "ColinSimmons");
  assert.equal(s.review.state, "needs_review");
  assert.equal(s.review.suggestedContactId, contactId);
  // Nothing linked until an admin says so.
  assert.equal(db.data(`instagramContacts/${contactId}`).instagramScopedUserId, null);

  // Admin confirms: IGSID saved, connected, earlier message attributed.
  const link = await c.linkSender(ctx(db), { igsid: "IGSID_1", contactId });
  assert.equal(link.messagesAttributed, 1);
  const rec = db.data(`instagramContacts/${contactId}`);
  assert.equal(rec.instagramScopedUserId, "IGSID_1");
  assert.equal(rec.accountStatus, "connected");
  assert.equal(rec.instagramUsername, "ColinSimmons");
  assert.equal(db.data("instagramMessages/m1").playerId, "p1");
  assert.equal((await c.contactForIgsid(db, "IGSID_1")).playerId, "p1");

  // New messages are attributed on arrival; verify now works.
  clock += 1000;
  await c.processWebhook(ctx(db, graph), delivery([inbound("m2", "IGSID_1", "again")]));
  assert.equal(db.data("instagramMessages/m2").playerId, "p1");
  await c.verifyContact(ctx(db), { contactId });
  assert.equal(db.data(`instagramContacts/${contactId}`).accountStatus, "verified");

  // The same IGSID can't be linked to a second player.
  await assert.rejects(c.linkSender(ctx(db), { igsid: "IGSID_1", playerId: "p2" }), (e) => e.code === "igsid_taken");
});

test("webhook: a renamed account's username follows its IGSID; the ID never changes", async () => {
  const db = seed();
  const { contactId } = await c.saveContact(ctx(db), { playerId: "p2", username: "arch" });
  const convs = { IGSID_9: "arch" };
  const graph = fakeGraph({ convs });
  await c.processWebhook(ctx(db, graph), delivery([inbound("m1", "IGSID_9", "yo")]));
  await c.linkSender(ctx(db), { igsid: "IGSID_9", contactId });
  convs.IGSID_9 = "arch16";
  clock += 2 * 24 * 3600e3; // past the daily profile refresh
  await c.processWebhook(ctx(db, graph), delivery([inbound("m2", "IGSID_9", "new name")]));
  const rec = db.data(`instagramContacts/${contactId}`);
  assert.equal(rec.instagramScopedUserId, "IGSID_9");
  assert.equal(rec.instagramUsername, "arch16");
  assert.deepEqual(rec.usernameHistory.map((h) => h.username), ["arch", "arch16"]);
  assert.ok(history(db, contactId).some((h) => h.action === "username_changed"));
});

test("webhook: an unknown sender is unmatched; an admin can link them to a player directly", async () => {
  const db = seed();
  await c.processWebhook(ctx(db, fakeGraph({ convs: { IGSID_5: "someone_new" } })), delivery([inbound("m1", "IGSID_5", "hi")]));
  assert.equal(db.data("instagramSenders/IGSID_5").review.state, "unmatched");
  const r = await c.linkSender(ctx(db), { igsid: "IGSID_5", playerId: "p2" });
  const rec = db.data(`instagramContacts/${r.contactId}`);
  assert.equal(rec.playerId, "p2");
  assert.equal(rec.verificationMethod, "inbound_message");
  assert.equal(rec.instagramUsername, "someone_new");
  assert.equal(rec.accountStatus, "connected");
});

test("webhook: echoes are outbound to the recipient; a failed profile read leaves the username unknown", async () => {
  const db = seed();
  const graph = fakeGraph(); // not in any conversation, and the profile call refuses
  await c.processWebhook(ctx(db, graph), delivery([
    inbound("m1", "IGSID_7", "hello"),
    { sender: { id: "IG_US" }, recipient: { id: "IGSID_7" }, timestamp: clock, message: { mid: "m2", text: "thanks!", is_echo: true } },
  ]));
  assert.equal(db.data("instagramMessages/m2").direction, "out");
  assert.equal(db.data("instagramMessages/m2").igsid, "IGSID_7");
  const s = db.data("instagramSenders/IGSID_7");
  assert.equal(s.username, null);
  assert.equal(s.profileError.code, 230);
  assert.equal(s.messageCount, 1);
});

test("webhook endpoint: handshake, signature, and nothing stored for a bad signature", async () => {
  process.env.META_APP_SECRET = "app-secret";
  process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = "verify-me";
  const handler = require("../../api/instagram-webhook");
  const res = () => {
    const r = { code: 0, body: null, headers: {} };
    r.setHeader = (k, v) => { r.headers[k] = v; };
    r.status = (x) => { r.code = x; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = (b) => { r.body = b; return r; };
    return r;
  };
  let r = res();
  await handler({ method: "GET", query: { "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "123" }, headers: {} }, r);
  assert.equal(r.code, 200);
  assert.equal(r.body, "123");
  r = res();
  await handler({ method: "GET", query: { "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "123" }, headers: {} }, r);
  assert.equal(r.code, 403);

  const db = seed();
  const raw = Buffer.from(JSON.stringify(delivery([inbound("m1", "IGSID_1", "hey")])));
  r = res();
  await handler({ method: "POST", rawBody: raw, headers: { "x-hub-signature-256": sign(raw, "wrong") } }, r, { db, graph: null, now });
  assert.equal(r.code, 401);
  assert.equal(db.data("instagramMessages/m1"), undefined);
  r = res();
  await handler({ method: "POST", rawBody: raw, headers: { "x-hub-signature-256": sign(raw, "app-secret") } }, r, { db, graph: null, now });
  assert.equal(r.code, 200);
  assert.equal(r.body.counts.inbound, 1);
  assert.equal(db.data("instagramMessages/m1").text, "hey");
});

test("profile lookup falls back to the User Profile API for someone not in a conversation", async () => {
  const db = seed();
  const graph = fakeGraph({ profile: async (path) => { assert.equal(path, "/IGSID_8"); return { username: "newer_dm", name: "N" }; } });
  await c.processWebhook(ctx(db, graph), delivery([inbound("m1", "IGSID_8", "hi")]));
  const s = db.data("instagramSenders/IGSID_8");
  assert.equal(s.username, "newer_dm");
  assert.equal(s.profileVia, "profile");
});

test("DM sync: everyone in the conversations becomes a sender; pending usernames are suggested; reruns are safe", async () => {
  const db = seed();
  const { contactId } = await c.saveContact(ctx(db), { playerId: "p1", username: "colinsimmons" });
  const graph = fakeGraph({ convs: { IGSID_1: "ColinSimmons", IGSID_2: "a_fan", IGSID_3: "another_fan" } });
  const r1 = await c.syncConversations(ctx(db, graph));
  assert.deepEqual({ senders: r1.senders, created: r1.created, suggested: r1.suggested, more: r1.more }, { senders: 3, created: 3, suggested: 1, more: false });
  const s = db.data("instagramSenders/IGSID_1");
  assert.equal(s.review.state, "needs_review");
  assert.equal(s.review.suggestedContactId, contactId);
  assert.equal(s.source, "dm_sync");
  assert.equal(s.messageCount, 0);
  assert.equal(db.data(`instagramContacts/${contactId}`).instagramScopedUserId, null); // still the admin's call
  await c.dismissSender(ctx(db), { igsid: "IGSID_2" });
  const r2 = await c.syncConversations(ctx(db, graph));
  assert.equal(r2.created, 0);
  assert.equal(db.data("instagramSenders/IGSID_2").review.state, "dismissed");
  assert.equal(db.data("instagramSenders/IGSID_1").review.state, "needs_review");
  assert.ok(db.data("igAnalytics/dmSync").lastRunAt);
});
