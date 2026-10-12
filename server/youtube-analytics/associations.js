// server/youtube-analytics/associations.js
//
// Admin-initiated changes from the YouTube Analytics tab. Nothing here runs
// during a sync; each action is one explicit admin click.
//
// Where a video's player associations live:
//   - linked to a legacy videos/{docId} (it's on the site): that doc's
//     items[] / playerIds — the same record Video Management edits. Adding a
//     player appends { type: "player", playerId, title: "", thumb: "" } and
//     leaves every other item (custom per-player titles and thumbnails,
//     recruit tags) untouched. Removing a player whose item has a custom
//     title or thumbnail is refused here — that's editorial work, done in
//     Video Management where it's visible.
//   - not on the site: ytVideos/{videoId}.playerIds (admin-only; used for
//     analytics and the player rollup).
// "Add to site" turns the second kind into the first: an explicit,
// confirmed action that creates a videos/{docId} record (public) with those
// players, then links it.

const g = require("./google");
const m = require("./metrics");
const { loadLegacy } = require("./videos");

const PLAYER_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const SITE_TAGS = ["Draft", "Recruiting", "CFB"]; // AdminPanel.js VIDEO_TAGS

function cleanIds(list, what) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > 25) throw g.httpError(400, `${what} must be a list of up to 25 player IDs.`);
  const ids = [...new Set(list.map(String))];
  if (!ids.every((x) => PLAYER_ID_RE.test(x))) throw g.httpError(400, `${what} has an invalid player ID.`);
  return ids;
}
function checkVideoId(id) {
  if (!m.ID_RE.test(String(id || ""))) throw g.httpError(400, "Bad video ID.");
  return String(id);
}

async function assertPlayersExist(db, ids) {
  const snaps = await Promise.all(ids.map((id) => db.collection("players").doc(id).get()));
  const missing = ids.filter((_, i) => !snaps[i].exists);
  if (missing.length) throw g.httpError(400, `No such player: ${missing.join(", ")}.`);
}

const isPlayerItem = (it) => it && it.type !== "recruit" && it.playerId;

async function associate(db, uid, body) {
  const videoId = checkVideoId(body.videoId);
  const add = cleanIds(body.add, "add");
  const remove = cleanIds(body.remove, "remove");
  if (!add.length && !remove.length) throw g.httpError(400, "Nothing to change.");
  if (add.some((x) => remove.includes(x))) throw g.httpError(400, "A player can't be added and removed at once.");
  await assertPlayersExist(db, add);
  const { FieldValue } = require("firebase-admin/firestore");
  const ytRef = db.collection("ytVideos").doc(videoId);

  return db.runTransaction(async (tx) => {
    const yv = (await tx.get(ytRef)).data();
    if (!yv) throw g.httpError(404, "That video isn't tracked — run Sync Videos first.");
    const now = Date.now();
    if (yv.legacyDocId) {
      const legRef = db.collection("videos").doc(yv.legacyDocId);
      const leg = (await tx.get(legRef)).data();
      if (!leg) throw g.httpError(409, "The linked site video record no longer exists — run Sync Videos.");
      let items = Array.isArray(leg.items) ? [...leg.items] : [];
      for (const pid of remove) {
        const it = items.find((x) => isPlayerItem(x) && x.playerId === pid);
        if (!it) continue;
        if ((it.title || "").trim() || (it.thumb || "").trim()) {
          throw g.httpError(409, "That player's tag has a custom title or thumbnail on the site — remove it in Videos → Video Management so nothing editorial is lost by accident.");
        }
        items = items.filter((x) => x !== it);
      }
      for (const pid of add) {
        if (!items.some((x) => isPlayerItem(x) && x.playerId === pid)) items.push({ type: "player", playerId: pid, title: "", thumb: "" });
      }
      const playerIds = items.filter(isPlayerItem).map((x) => x.playerId);
      tx.update(legRef, { items, playerIds, updatedAt: FieldValue.serverTimestamp() });
      tx.set(ytRef, { associatedBy: uid, associatedAt: now }, { merge: true });
      return { videoId, where: "site", legacyDocId: yv.legacyDocId, playerIds };
    }
    const cur = Array.isArray(yv.playerIds) ? yv.playerIds : [];
    const playerIds = [...cur.filter((x) => !remove.includes(x)), ...add.filter((x) => !cur.includes(x))];
    tx.set(ytRef, { playerIds, associatedBy: uid, associatedAt: now }, { merge: true });
    return { videoId, where: "analytics", playerIds };
  });
}

async function setIgnored(db, uid, body) {
  const videoId = checkVideoId(body.videoId);
  const ref = db.collection("ytVideos").doc(videoId);
  if (!(await ref.get()).exists) throw g.httpError(404, "That video isn't tracked.");
  const review = { status: body.ignored ? "ignored" : null, by: uid, at: Date.now() };
  await ref.set({ review }, { merge: true });
  return { videoId, review };
}

// Creates the public videos/{docId} record. Requires confirm: true.
async function publishToSite(db, uid, body) {
  const videoId = checkVideoId(body.videoId);
  if (body.confirm !== true) throw g.httpError(400, "Adding a video to the site needs confirmation.");
  const tags = Array.isArray(body.tags) ? body.tags.filter((t) => SITE_TAGS.includes(t)) : [];
  // A legacy record may have been added by hand since the last sync.
  const legacy = await loadLegacy(db);
  const existing = legacy.byYt.get(videoId);
  const ytRef = db.collection("ytVideos").doc(videoId);
  if (existing) {
    await ytRef.set({ legacyDocId: existing }, { merge: true });
    return { videoId, legacyDocId: existing, alreadyOnSite: true };
  }
  const { FieldValue } = require("firebase-admin/firestore");
  const legRef = db.collection("videos").doc();
  return db.runTransaction(async (tx) => {
    const yv = (await tx.get(ytRef)).data();
    if (!yv) throw g.httpError(404, "That video isn't tracked.");
    if (yv.legacyDocId) return { videoId, legacyDocId: yv.legacyDocId, alreadyOnSite: true };
    const playerIds = Array.isArray(yv.playerIds) ? yv.playerIds : [];
    const isShort = yv.type === "short";
    tx.set(legRef, {
      Video: isShort ? `https://youtube.com/shorts/${videoId}` : `https://youtu.be/${videoId}`,
      Date: yv.yt?.publishedAt ? new Date(yv.yt.publishedAt) : new Date(),
      Tags: isShort && !tags.length ? ["CFB"] : tags, // same default as the Video Management editor for a Short
      Short: isShort,
      GameSlug: "",
      GenTitle: yv.yt?.title || "",
      GenThumb: "",
      PublishAt: null,
      items: playerIds.map((playerId) => ({ type: "player", playerId, title: "", thumb: "" })),
      playerIds,
      recruitIds: [],
      recruitSchools: [],
      updatedAt: FieldValue.serverTimestamp(),
      createdFrom: "youtube-analytics",
    });
    // The site record is now where this video's players live.
    tx.set(ytRef, { legacyDocId: legRef.id, playerIds: [], publishedToSiteBy: uid, publishedToSiteAt: Date.now() }, { merge: true });
    return { videoId, legacyDocId: legRef.id, playerIds };
  });
}

module.exports = { associate, setIgnored, publishToSite };
