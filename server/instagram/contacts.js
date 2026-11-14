// server/instagram/contacts.js
//
// Player ↔ Instagram account associations (Admin → Social), and the inbound
// side of Instagram messaging: who messaged @wedraftsite, and which
// We-Draft player that is. README.md here, "Social: player accounts".
//
// The permanent identity is the Instagram-scoped user ID (IGSID) Meta puts
// on every messaging webhook — scoped to our app + account, NOT a universal
// Instagram ID, and never derivable from a username. A username an admin
// types in is only a provisional association ("pending") until that person
// messages us and an admin confirms the match. Nothing here ever invents an
// IGSID or links a sender to a player on its own.
//
// Collections (admin read, server write — firestore.rules):
//   instagramContacts/{id}           one association: playerId ↔ account
//   instagramContacts/{id}/history   audit trail, one doc per change
//   instagramSenders/{igsid}         everyone who has messaged us
//   instagramMessages/{mid}          each message, keyed by Meta's message ID
//
// Integrity, enforced in transactions here (the page never writes):
//   - at most one active contact per player (a new one replaces the old,
//     which goes inactive — nothing is deleted)
//   - at most one active contact per username and per IGSID, across players
//   - a contact's playerId never changes; moving an account to another
//     player is a disconnect + a new contact, so history stays true

const STATUSES = ["pending", "connected", "verified", "inactive"];
// How the account was associated with the player.
const METHODS = {
  admin_manual: "Entered by admin",
  player_provided: "Player provided",
  school_roster: "School roster / bio",
  inbound_message: "Matched from Instagram message",
  other: "Other",
};
const PROFILE_TTL_MS = 24 * 3600e3; // re-read a sender's username at most daily

function httpError(status, message, extra) {
  return Object.assign(new Error(message), { status }, extra || {});
}

function defaultNow() {
  const { Timestamp } = require("firebase-admin/firestore");
  return Timestamp.now();
}
const ms = (t) => (t?.toMillis ? t.toMillis() : typeof t === "number" ? t : t instanceof Date ? t.getTime() : 0);

// "@Some.Player", "instagram.com/some.player/", "https://www.instagram.com/some.player?igsh=…"
// → { display: "Some.Player", lower: "some.player" }, or null if it isn't a
// valid Instagram username (letters, numbers, periods, underscores; ≤ 30).
function normalizeUsername(raw) {
  let s = String(raw || "").trim();
  const url = /instagram\.com\/([^/?#\s]+)/i.exec(s);
  if (url) s = url[1];
  s = s.replace(/^@+/, "").replace(/\/+$/, "").trim();
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s) || /^\.|\.$/.test(s) || /\.\./.test(s)) return null;
  return { display: s, lower: s.toLowerCase() };
}

const playerName = (p) => [p?.First, p?.Last].filter(Boolean).join(" ") || p?.Player || "";

function context(db, opts = {}) {
  return { db, now: opts.now || defaultNow, graph: opts.graph || null, uid: opts.uid || null, accountId: opts.accountId || process.env.INSTAGRAM_USER_ID || null };
}

const contactsCol = (db) => db.collection("instagramContacts");
const activeBy = (db, field, value) => contactsCol(db).where(field, "==", value).where("active", "==", true);

function historyEvent(tx, db, contactId, ev) {
  tx.set(contactsCol(db).doc(contactId).collection("history").doc(), ev);
}

// ── Admin actions ────────────────────────────────────────────────────────

// Create a player's association, or edit one (contactId). A create for a
// player who already has an active account replaces it (the old one goes
// inactive, pointing at the new one). An edit changes the username (a typo,
// or the account renamed), notes and method — never the player.
async function saveContact(ctx, body = {}) {
  const { db, now, uid } = ctx;
  const u = normalizeUsername(body.username);
  if (!u) throw httpError(400, "That isn't a valid Instagram username (letters, numbers, periods and underscores, up to 30).");
  const method = body.verificationMethod || "admin_manual";
  if (!METHODS[method]) throw httpError(400, `Unknown verification method "${method}".`);
  const notes = String(body.notes ?? "").slice(0, 2000);
  const at = now();

  return db.runTransaction(async (tx) => {
    // ── Edit ──
    if (body.contactId) {
      const ref = contactsCol(db).doc(String(body.contactId));
      const cur = await tx.get(ref);
      if (!cur.exists) throw httpError(404, "That account association no longer exists.");
      const c = cur.data();
      if (!c.active) throw httpError(409, "That association is inactive. Connect the account again instead.");
      const taken = (await tx.get(activeBy(db, "usernameLower", u.lower))).docs.find((d) => d.id !== ref.id);
      if (taken) throw httpError(409, `@${u.display} is already connected to ${taken.data().playerName || "another player"}.`, { code: "username_taken" });
      const renamed = c.usernameLower !== u.lower || c.instagramUsername !== u.display;
      const upd = {
        instagramUsername: u.display, usernameLower: u.lower, notes, verificationMethod: method,
        lastUpdated: at, updatedBy: uid,
        ...(renamed ? { usernameHistory: [...(c.usernameHistory || []), { username: u.display, at, source: "admin", by: uid }] } : {}),
      };
      tx.update(ref, upd);
      historyEvent(tx, db, ref.id, {
        action: "edited", at, by: uid,
        changes: { ...(renamed ? { username: [c.instagramUsername, u.display] } : {}), ...(c.notes !== notes ? { notes: true } : {}), ...(c.verificationMethod !== method ? { verificationMethod: [c.verificationMethod, method] } : {}) },
      });
      return { contactId: ref.id, ...c, ...upd };
    }

    // ── Create (or replace) ──
    const playerId = String(body.playerId || "");
    if (!playerId) throw httpError(400, "Pick a player.");
    const pSnap = await tx.get(db.collection("players").doc(playerId));
    if (!pSnap.exists) throw httpError(404, "That player doesn't exist.");
    const p = pSnap.data();
    const [byName, byPlayer] = await Promise.all([tx.get(activeBy(db, "usernameLower", u.lower)), tx.get(activeBy(db, "playerId", playerId))]);
    const taken = byName.docs[0];
    if (taken && taken.data().playerId !== playerId) {
      throw httpError(409, `@${u.display} is already connected to ${taken.data().playerName || "another player"}. Disconnect it there first.`, { code: "username_taken" });
    }
    if (taken) return { contactId: taken.id, ...taken.data(), unchanged: true };

    const ref = contactsCol(db).doc();
    const record = {
      playerId, playerName: playerName(p), playerSlug: p.Slug || null,
      instagramUsername: u.display, usernameLower: u.lower,
      instagramScopedUserId: null,
      accountStatus: "pending", active: true, primary: true,
      verificationMethod: method, verifiedAt: null, verifiedBy: null,
      notes, createdAt: at, createdBy: uid, lastUpdated: at, updatedBy: uid,
      usernameHistory: [{ username: u.display, at, source: "admin", by: uid }],
    };
    for (const old of byPlayer.docs) {
      tx.update(old.ref, { active: false, primary: false, accountStatus: "inactive", deactivatedAt: at, deactivatedReason: "replaced", replacedBy: ref.id, lastUpdated: at, updatedBy: uid });
      historyEvent(tx, db, old.id, { action: "replaced", at, by: uid, replacedBy: ref.id, username: u.display });
      record.replaces = old.id;
    }
    tx.set(ref, record);
    historyEvent(tx, db, ref.id, { action: "created", at, by: uid, username: u.display, verificationMethod: method, ...(record.replaces ? { replaces: record.replaces } : {}) });
    return { contactId: ref.id, ...record };
  });
}

// Inactive, never deleted. Its IGSID stays on the record for history; the
// sender stops being attributed to the player.
async function disconnectContact(ctx, body = {}) {
  const { db, now, uid } = ctx;
  const at = now();
  return db.runTransaction(async (tx) => {
    const ref = contactsCol(db).doc(String(body.contactId || "-"));
    const cur = await tx.get(ref);
    if (!cur.exists) throw httpError(404, "That account association no longer exists.");
    const c = cur.data();
    if (!c.active) return { contactId: ref.id, unchanged: true };
    const sRef = c.instagramScopedUserId ? db.collection("instagramSenders").doc(c.instagramScopedUserId) : null;
    const sender = sRef ? await tx.get(sRef) : null;
    tx.update(ref, { active: false, primary: false, accountStatus: "inactive", deactivatedAt: at, deactivatedReason: "disconnected", deactivatedNote: String(body.reason || "").slice(0, 500), lastUpdated: at, updatedBy: uid });
    if (sender?.exists && sender.data().contactId === ref.id) {
      tx.update(sRef, { contactId: null, playerId: null, review: { state: "unmatched", reason: "disconnected", at } });
    }
    historyEvent(tx, db, ref.id, { action: "disconnected", at, by: uid, reason: String(body.reason || "").slice(0, 500) });
    return { contactId: ref.id, accountStatus: "inactive" };
  });
}

// Verified = an IGSID is on the record (Instagram identity established) and
// an admin has confirmed the person behind it is the player.
async function verifyContact(ctx, body = {}) {
  const { db, now, uid } = ctx;
  const at = now();
  return db.runTransaction(async (tx) => {
    const ref = contactsCol(db).doc(String(body.contactId || "-"));
    const cur = await tx.get(ref);
    if (!cur.exists) throw httpError(404, "That account association no longer exists.");
    const c = cur.data();
    if (!c.active) throw httpError(409, "That association is inactive.");
    if (!c.instagramScopedUserId) {
      throw httpError(409, "This account has no Instagram-scoped ID yet. It can be verified once the player messages @wedraftsite and the match is confirmed under Account Management.", { code: "no_igsid" });
    }
    tx.update(ref, { accountStatus: "verified", verifiedAt: at, verifiedBy: uid, lastUpdated: at, updatedBy: uid });
    historyEvent(tx, db, ref.id, { action: "verified", at, by: uid });
    return { contactId: ref.id, accountStatus: "verified" };
  });
}

// An admin confirms who a sender is: their IGSID onto a player's contact.
//   { igsid, contactId }  — the suggested (or any) active contact
//   { igsid, playerId }   — a player: their active contact if they have one
//                           (it takes the sender's real username), else a new
//                           contact made from the sender
// The contact becomes "connected" (a verified one stays verified). The
// sender's earlier messages are then attributed to the player.
async function linkSender(ctx, body = {}) {
  const { db, now, uid } = ctx;
  const igsid = String(body.igsid || "");
  if (!igsid) throw httpError(400, "No sender.");
  const at = now();
  const result = await db.runTransaction(async (tx) => {
    const sRef = db.collection("instagramSenders").doc(igsid);
    const sSnap = await tx.get(sRef);
    if (!sSnap.exists) throw httpError(404, "That sender isn't on file (they haven't messaged @wedraftsite).");
    const s = sSnap.data();
    const holders = (await tx.get(activeBy(db, "instagramScopedUserId", igsid))).docs;

    let cRef = null; let c = null; let p = null; let playerId = null;
    if (body.contactId) {
      cRef = contactsCol(db).doc(String(body.contactId));
      const cSnap = await tx.get(cRef);
      if (!cSnap.exists || !cSnap.data().active) throw httpError(404, "That account association isn't active.");
      c = cSnap.data();
      playerId = c.playerId;
    } else {
      playerId = String(body.playerId || "");
      if (!playerId) throw httpError(400, "Pick a player or an account.");
      const pSnap = await tx.get(db.collection("players").doc(playerId));
      if (!pSnap.exists) throw httpError(404, "That player doesn't exist.");
      p = pSnap.data();
      const mine = (await tx.get(activeBy(db, "playerId", playerId))).docs[0];
      if (mine) { cRef = mine.ref; c = mine.data(); }
    }
    const other = holders.find((d) => !cRef || d.id !== cRef.id);
    if (other) throw httpError(409, `This Instagram account is already connected to ${other.data().playerName || "another player"}. Disconnect it there first.`, { code: "igsid_taken" });
    if (c?.instagramScopedUserId && c.instagramScopedUserId !== igsid) {
      throw httpError(409, `${c.playerName || "That player"}'s current account (@${c.instagramUsername}) is already linked to a different Instagram identity. Disconnect it first if this is a new account.`, { code: "contact_has_igsid" });
    }
    // The sender's username (from Meta) wins over a typed one — but not if
    // another player's active contact holds it.
    const u = normalizeUsername(s.username);
    if (u) {
      const clash = (await tx.get(activeBy(db, "usernameLower", u.lower))).docs.find((d) => !cRef || d.id !== cRef.id);
      if (clash) throw httpError(409, `@${u.display} is entered on ${clash.data().playerName || "another player"}'s account. Fix that one first.`, { code: "username_taken" });
    }

    if (cRef) {
      const renamed = u && c.usernameLower !== u.lower;
      const upd = {
        instagramScopedUserId: igsid,
        accountStatus: c.accountStatus === "verified" ? "verified" : "connected",
        connectedAt: at, connectedBy: uid, lastUpdated: at, updatedBy: uid,
        ...(u ? { instagramUsername: u.display, usernameLower: u.lower } : {}),
        ...(renamed ? { usernameHistory: [...(c.usernameHistory || []), { username: u.display, at, source: "meta", by: uid }] } : {}),
      };
      tx.update(cRef, upd);
      historyEvent(tx, db, cRef.id, { action: "linked", at, by: uid, igsid, ...(renamed ? { username: [c.instagramUsername, u.display] } : {}) });
    } else {
      cRef = contactsCol(db).doc();
      const display = u?.display || null;
      tx.set(cRef, {
        playerId, playerName: playerName(p), playerSlug: p.Slug || null,
        instagramUsername: display, usernameLower: u?.lower || null,
        instagramScopedUserId: igsid,
        accountStatus: "connected", active: true, primary: true,
        verificationMethod: "inbound_message", verifiedAt: null, verifiedBy: null,
        notes: "", createdAt: at, createdBy: uid, lastUpdated: at, updatedBy: uid, connectedAt: at, connectedBy: uid,
        usernameHistory: display ? [{ username: display, at, source: "meta", by: uid }] : [],
      });
      historyEvent(tx, db, cRef.id, { action: "created", at, by: uid, igsid, username: display, verificationMethod: "inbound_message" });
    }
    tx.update(sRef, { contactId: cRef.id, playerId, review: { state: "matched", at, by: uid } });
    return { contactId: cRef.id, playerId };
  });
  result.messagesAttributed = await attributeMessages(db, igsid, result.contactId, result.playerId);
  return result;
}

async function dismissSender(ctx, body = {}) {
  const { db, now, uid } = ctx;
  const ref = db.collection("instagramSenders").doc(String(body.igsid || "-"));
  const s = await ref.get();
  if (!s.exists) throw httpError(404, "That sender isn't on file.");
  if (s.data().contactId) throw httpError(409, "That sender is linked to a player. Disconnect the account instead.");
  await ref.update({ review: { state: "dismissed", at: now(), by: uid } });
  return { igsid: ref.id, dismissed: true };
}

// Re-read a linked account's username from Meta now (a rename shows up
// here, or on their next message).
async function refreshContact(ctx, body = {}) {
  const { db } = ctx;
  const c = await contactsCol(db).doc(String(body.contactId || "-")).get();
  if (!c.exists) throw httpError(404, "That account association no longer exists.");
  const igsid = c.data().instagramScopedUserId;
  if (!igsid) throw httpError(409, "Only an account with an Instagram-scoped ID can be refreshed from Instagram.", { code: "no_igsid" });
  return refreshSenderProfile(ctx, igsid, { force: true });
}

// Every message from a sender gets their player once they're linked (the
// earlier ones too) — the hook future interview/response records hang on.
async function attributeMessages(db, igsid, contactId, playerId) {
  const snap = await db.collection("instagramMessages").where("igsid", "==", igsid).get();
  const todo = snap.docs.filter((d) => d.data().contactId !== contactId || d.data().playerId !== playerId);
  for (let i = 0; i < todo.length; i += 400) {
    const b = db.batch();
    todo.slice(i, i + 400).forEach((d) => b.update(d.ref, { contactId, playerId }));
    await b.commit();
  }
  return todo.length;
}

// The active association for an IGSID → { contactId, playerId, … } or null.
// Future social workflows (interview responses) attribute through this.
async function contactForIgsid(db, igsid) {
  const d = (await activeBy(db, "instagramScopedUserId", String(igsid)).limit(1).get()).docs[0];
  return d ? { contactId: d.id, ...d.data() } : null;
}

// ── Webhook ──────────────────────────────────────────────────────────────

const tsFrom = (now, msValue) => {
  const t = now();
  if (!msValue || !t?.constructor?.fromMillis) return t;
  return t.constructor.fromMillis(Number(msValue));
};

// One messaging event's message (new, deleted or edited), at most once per
// Meta message ID — Meta retries deliveries, and a retry is a no-op.
async function recordMessage(ctx, ev, accountId) {
  const { db, now } = ctx;
  const m = ev.message || ev.message_edit;
  const mid = m?.mid;
  if (!mid) return "skipped";
  const echo = !!ev.message?.is_echo || (accountId && ev.sender?.id === accountId);
  const igsid = echo ? ev.recipient?.id : ev.sender?.id;
  if (!igsid) return "skipped";
  const at = now();
  return db.runTransaction(async (tx) => {
    const mRef = db.collection("instagramMessages").doc(mid);
    const sRef = db.collection("instagramSenders").doc(igsid);
    const [mSnap, sSnap, holders] = await Promise.all([tx.get(mRef), tx.get(sRef), tx.get(activeBy(db, "instagramScopedUserId", igsid))]);
    if (ev.message_edit) {
      if (!mSnap.exists) return "skipped";
      tx.update(mRef, { text: m.text ?? null, editedAt: at, editCount: m.num_edit ?? (mSnap.data().editCount || 0) + 1 });
      return "edited";
    }
    if (m.is_deleted) {
      if (!mSnap.exists) return "skipped";
      tx.update(mRef, { isDeleted: true, deletedAt: at });
      return "deleted";
    }
    if (mSnap.exists) return "duplicate";
    const contact = holders.docs[0];
    tx.set(mRef, {
      mid, igsid, direction: echo ? "out" : "in", accountId: accountId || null,
      text: m.text ?? null,
      attachments: (m.attachments || []).map((a) => ({ type: a.type || null, url: a.payload?.url || null })),
      replyToMid: m.reply_to?.mid || null, storyReplyUrl: m.reply_to?.story?.url || null,
      isUnsupported: !!m.is_unsupported, isDeleted: false,
      timestamp: tsFrom(now, ev.timestamp), receivedAt: at,
      contactId: contact?.id || null, playerId: contact?.data().playerId || null,
    });
    const s = sSnap.exists ? sSnap.data() : null;
    tx.set(sRef, {
      igsid,
      firstMessageAt: s?.firstMessageAt || at,
      ...(echo ? { lastOutboundAt: at } : { lastMessageAt: at, messageCount: (s?.messageCount || 0) + 1 }),
      contactId: contact?.id || null, playerId: contact?.data().playerId || null,
      ...(s ? {} : { username: null, name: null, review: { state: contact ? "matched" : "unmatched", at } }),
    }, { merge: true });
    return echo ? "outbound" : "inbound";
  });
}

// @wedraftsite's DM conversations, one page: each other participant's IGSID
// and username (Meta lists both). The token has instagram_manage_messages;
// the participants come back on graph.facebook.com/{ig-user-id}/conversations.
// → { rows: [{ igsid, username, updatedTime (ms) }], after }
async function conversationPage(ctx, { after = null, limit = 50 } = {}) {
  const { graph, accountId } = ctx;
  if (!graph || !accountId) throw httpError(500, "Instagram isn't configured on the server.");
  const r = await graph(`/${accountId}/conversations`, { params: { platform: "instagram", fields: "participants,updated_time", limit, after } });
  const rows = [];
  for (const c of r.data || []) {
    for (const p of c.participants?.data || []) {
      if (!p.id || p.id === accountId) continue;
      rows.push({ igsid: p.id, username: p.username || null, updatedTime: Date.parse(c.updated_time) || null });
    }
  }
  return { rows, after: r.paging?.next ? r.paging?.cursors?.after || null : null };
}

// Who an IGSID is. Meta ignores a user_id filter on conversations, so this
// scans them (39 in all as of 2026-11-13: one call) — then, if they're not
// in a conversation, the User Profile API (which refuses unless the person
// has recently messaged us: error #230).
async function lookupProfile(ctx, igsid, { maxPages = 10 } = {}) {
  let after = null;
  for (let page = 0; page < maxPages; page++) {
    const r = await conversationPage(ctx, { after });
    const hit = r.rows.find((x) => x.igsid === igsid && x.username);
    if (hit) return { username: hit.username, name: null, via: "conversations" };
    if (!r.after) break;
    after = r.after;
  }
  const p = await ctx.graph(`/${igsid}`, { params: { fields: "username,name" } });
  return { username: p.username || null, name: p.name || null, via: "profile" };
}

// Re-read who a sender is (at most daily unless forced) and apply it.
async function refreshSenderProfile(ctx, igsid, { force = false } = {}) {
  const { db, now, graph } = ctx;
  const sRef = db.collection("instagramSenders").doc(igsid);
  const before = (await sRef.get()).data() || {};
  if (!force && before.usernameFetchedAt && ms(now()) - ms(before.usernameFetchedAt) < PROFILE_TTL_MS) return { skipped: "fresh" };
  if (!graph) return { skipped: "no graph client" };
  let profile;
  try {
    profile = await lookupProfile(ctx, igsid);
  } catch (e) {
    await sRef.set({ profileError: { message: String(e.message || e).slice(0, 300), code: e.metaCode ?? null, at: now() }, usernameFetchedAt: now() }, { merge: true });
    return { error: String(e.message || e).slice(0, 300) };
  }
  return applyProfile(ctx, igsid, profile);
}

// What Meta says an IGSID's username is, acted on:
//   linked sender, new username  → the contact's username follows (history
//                                  kept); if another active contact holds
//                                  that username, it's flagged for review
//   unlinked sender              → an active contact with exactly that
//                                  username and no IGSID becomes a suggested
//                                  match for an admin to confirm — never
//                                  linked automatically
// A sender not on file yet (the DM sync) is created. extra.lastActivity (ms):
// the conversation's last activity, kept if it's newer than what's stored.
async function applyProfile(ctx, igsid, profile, extra = {}) {
  const { db, now } = ctx;
  const sRef = db.collection("instagramSenders").doc(igsid);
  const u = normalizeUsername(profile.username);
  const at = now();
  return db.runTransaction(async (tx) => {
    const sSnap = await tx.get(sRef);
    const s = sSnap.data() || {};
    const holder = (await tx.get(activeBy(db, "instagramScopedUserId", igsid))).docs[0];
    const sameName = u ? (await tx.get(activeBy(db, "usernameLower", u.lower))).docs : [];
    const renamed = u && s.username && s.username.toLowerCase() !== u.lower;
    const sUpd = {
      igsid, username: u?.display || s.username || null, name: profile.name || s.name || null,
      usernameFetchedAt: at, profileError: null, profileVia: profile.via || null,
      ...(renamed ? { usernameHistory: [...(s.usernameHistory || []), { username: u.display, at }] } : {}),
    };
    if (!sSnap.exists) {
      Object.assign(sUpd, { messageCount: 0, firstMessageAt: null, lastMessageAt: null, contactId: holder?.id || null, playerId: holder?.data().playerId || null, source: extra.source || "webhook" });
    }
    if (extra.lastActivity && extra.lastActivity > ms(s.lastMessageAt)) sUpd.lastMessageAt = tsFrom(now, extra.lastActivity);
    const out = { igsid, username: u?.display || null, created: !sSnap.exists };
    if (holder) {
      const c = holder.data();
      if (!s.review) sUpd.review = { state: "matched", at };
      if (u && c.usernameLower !== u.lower) {
        const clash = sameName.find((d) => d.id !== holder.id);
        if (clash) {
          sUpd.review = { state: "needs_review", reason: "username_conflict", conflictContactId: clash.id, conflictPlayerId: clash.data().playerId, at };
          out.conflict = clash.id;
        } else {
          tx.update(holder.ref, {
            instagramUsername: u.display, usernameLower: u.lower, lastUpdated: at, updatedBy: "meta",
            usernameHistory: [...(c.usernameHistory || []), { username: u.display, at, source: "meta" }],
          });
          historyEvent(tx, db, holder.id, { action: "username_changed", at, by: "meta", username: [c.instagramUsername, u.display] });
          out.renamed = [c.instagramUsername, u.display];
        }
      }
    } else if (s.review?.state !== "dismissed") {
      const candidates = sameName.filter((d) => !d.data().instagramScopedUserId);
      if (candidates.length === 1) {
        sUpd.review = { state: "needs_review", reason: "username_match", suggestedContactId: candidates[0].id, suggestedPlayerId: candidates[0].data().playerId, at };
        out.suggested = candidates[0].id;
      } else if (s.review?.state !== "needs_review" || !candidates.length) {
        sUpd.review = { state: "unmatched", at };
      }
    }
    tx.set(sRef, sUpd, { merge: true });
    return out;
  });
}

// Admin → Social → Sync existing DMs: everyone already in @wedraftsite's
// conversations becomes a sender (IGSID + username), and any whose username
// matches a pending account is suggested for review. Resumable: call again
// with the returned `after` while `more`. Messages themselves aren't
// imported — only new ones arrive, through the webhook.
async function syncConversations(ctx, { after = null, budgetMs = 60e3 } = {}) {
  const { db, now } = ctx;
  const started = Date.now();
  const counts = { senders: 0, created: 0, suggested: 0, renamed: 0, conflicts: 0 };
  let cursor = after;
  do {
    const page = await conversationPage(ctx, { after: cursor });
    for (const row of page.rows) {
      const r = await applyProfile(ctx, row.igsid, { username: row.username, via: "conversations" }, { source: "dm_sync", lastActivity: row.updatedTime });
      counts.senders++;
      if (r.created) counts.created++;
      if (r.suggested) counts.suggested++;
      if (r.renamed) counts.renamed++;
      if (r.conflict) counts.conflicts++;
    }
    cursor = page.after;
  } while (cursor && Date.now() - started < budgetMs);
  const result = { ...counts, more: !!cursor, after: cursor };
  await db.doc("igAnalytics/dmSync").set({ lastRunAt: now(), lastResult: counts, more: !!cursor }, { merge: true });
  return result;
}

// A whole webhook delivery. Meta batches entries and events; each message
// is handled on its own so one bad event can't block the rest.
async function processWebhook(ctx, body, { accountId } = {}) {
  const counts = { inbound: 0, outbound: 0, duplicate: 0, edited: 0, deleted: 0, skipped: 0, ignored: 0, errors: 0 };
  if (body?.object !== "instagram") return { ...counts, ignored: 1 };
  const profiles = new Set();
  for (const entry of body.entry || []) {
    for (const ev of entry.messaging || []) {
      if (!ev.message && !ev.message_edit) { counts.ignored++; continue; }
      try {
        const r = await recordMessage(ctx, ev, accountId || entry.id);
        counts[r] = (counts[r] || 0) + 1;
        if (r === "inbound") profiles.add(ev.sender.id);
      } catch (e) {
        counts.errors++;
        console.error("instagram webhook event failed:", e.message);
      }
    }
  }
  for (const igsid of profiles) {
    try { await refreshSenderProfile(ctx, igsid); } catch (e) { console.error("instagram sender profile failed:", e.message); }
  }
  return counts;
}

module.exports = {
  STATUSES, METHODS, normalizeUsername, context,
  saveContact, disconnectContact, verifyContact, linkSender, dismissSender, refreshContact,
  contactForIgsid, attributeMessages, recordMessage, refreshSenderProfile, applyProfile, lookupProfile, conversationPage, syncConversations, processWebhook,
};
