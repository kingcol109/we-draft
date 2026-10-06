// api/live-chat.js
//
// Posts a message to a live game's chat (components/LiveChat.js). POST
// { gameId, text }. Chat messages (liveGames/{id}/chat/{msg}) are written
// only here — firestore.rules lets anyone read them but no client create
// them — so every message passes:
//   - a signed-in user (Firebase ID token, checked with Firebase Auth's REST
//     lookup — same as api/portal-sync.js) who isn't chat-banned
//     (users/{uid}.chatBanned);
//   - the game being in progress;
//   - src/utils/chatFilter.mjs (slurs, sexual content, links, length);
//   - one message per RATE_MS per user (liveChatRate/{uid}).
//
// POST { action: "vote", gameId, msgId, vote: 1 | -1 | 0 } up/down-votes a
// message (0 clears the vote): the message's up / down counts change in the
// same transaction as the voter's own record (users/{uid}/chatVotes/{gameId}
// — { [msgId]: 1 | -1 }, readable only by them), so a vote can't double
// count. Signed in, not chat-banned, not on your own message.

const WEB_API_KEY = "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4"; // public web key (src/firebase.js)
const RATE_MS = 4000;

async function uidFromToken(idToken) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${WEB_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }),
  });
  if (!r.ok) return null;
  return (await r.json()).users?.[0]?.localId || null;
}

async function vote(req, res, uid, gameId) {
  const msgId = String(req.body?.msgId || "");
  const v = Number(req.body?.vote);
  if (!/^[A-Za-z0-9]{1,40}$/.test(msgId) || ![1, -1, 0].includes(v)) return res.status(400).json({ error: "Bad vote." });
  const { getFirestore } = require("../scripts/firebaseAdmin");
  const { FieldValue } = require("firebase-admin/firestore");
  const db = getFirestore();
  if ((await db.collection("users").doc(uid).get()).data()?.chatBanned) return res.status(403).json({ error: "You can't vote in chat." });
  const msgRef = db.collection("liveGames").doc(gameId).collection("chat").doc(msgId);
  const mineRef = db.collection("users").doc(uid).collection("chatVotes").doc(gameId);
  const result = await db.runTransaction(async (tx) => {
    const [msg, mine] = await Promise.all([tx.get(msgRef), tx.get(mineRef)]);
    if (!msg.exists) return { status: 404, error: "That message is gone." };
    if (msg.data().system) return { status: 400, error: "That's a game update." };
    if (msg.data().uid === uid) return { status: 400, error: "You can't vote on your own message." };
    const prev = mine.data()?.[msgId] || 0;
    if (prev === v) return { status: 200 };
    tx.update(msgRef, {
      up: FieldValue.increment((v === 1 ? 1 : 0) - (prev === 1 ? 1 : 0)),
      down: FieldValue.increment((v === -1 ? 1 : 0) - (prev === -1 ? 1 : 0)),
    });
    tx.set(mineRef, { [msgId]: v || FieldValue.delete() }, { merge: true });
    return { status: 200 };
  });
  return res.status(result.status).json(result.error ? { error: result.error } : { ok: true });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (!token) return res.status(401).json({ error: "Log in to chat." });
  try {
    const uid = await uidFromToken(token);
    if (!uid) return res.status(401).json({ error: "Log in to chat." });

    const gameId = String(req.body?.gameId || "");
    if (!/^\d+$/.test(gameId)) return res.status(400).json({ error: "Unknown game." });
    if (req.body?.action === "vote") return await vote(req, res, uid, gameId);
    const text = String(req.body?.text || "").trim();
    const { chatProblem } = await import("../src/utils/chatFilter.mjs");
    const problem = chatProblem(text);
    if (problem) return res.status(400).json({ error: problem });

    const { getFirestore } = require("../scripts/firebaseAdmin");
    const { FieldValue } = require("firebase-admin/firestore");
    const db = getFirestore();
    const [userSnap, gameSnap] = await Promise.all([db.collection("users").doc(uid).get(), db.collection("liveGames").doc(gameId).get()]);
    const user = userSnap.data() || {};
    if (user.chatBanned) return res.status(403).json({ error: "You can't post in chat." });
    // Open from game week (the game's liveGames doc exists — /live is
    // tracking it) through the final whistle: pregame and live.
    const status = gameSnap.data()?.status;
    if (status !== "scheduled" && status !== "in_progress") {
      return res.status(400).json({ error: status === "final" ? "Chat is closed — this game is final." : "Chat opens game week." });
    }

    // Rate limit + write together, so two quick sends can't both pass.
    const rateRef = db.collection("liveChatRate").doc(uid);
    const msgRef = db.collection("liveGames").doc(gameId).collection("chat").doc();
    const now = Date.now();
    const ok = await db.runTransaction(async (tx) => {
      const last = (await tx.get(rateRef)).data()?.at || 0;
      if (now - last < RATE_MS) return false;
      tx.set(rateRef, { at: now });
      tx.set(msgRef, {
        uid, text,
        name: (user.username || "").trim() || "Fan",
        verified: !!user.verified,
        at: FieldValue.serverTimestamp(), atMs: now,
      });
      return true;
    });
    if (!ok) return res.status(429).json({ error: "Slow down — one message every few seconds." });
    return res.status(200).json({ id: msgRef.id });
  } catch (e) {
    console.error("live-chat failed:", e.stack || e.message);
    return res.status(500).json({ error: "Couldn't send — try again." });
  }
};
