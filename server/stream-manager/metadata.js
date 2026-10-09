// server/stream-manager/metadata.js
//
// YouTube title / description drafts for upcoming game broadcasts (Admin →
// Stream Manager → Auto Schedule → Edit Metadata). A draft is prepared ahead
// of time — e.g. pasted in from text generated elsewhere — and is used when
// the orchestrator later creates the game's real YouTube broadcast
// (broadcasts.js youtubeCreate with useDraft).
//
//   broadcastMetadata/{CFBDGameId}
//     gameId, scheduleId         which game (the key is the CFBD id; the
//                                schedule26 doc stays the source of truth for
//                                matchup, kickoff and slug)
//     home, away                 the matchup when it was saved (display only)
//     title, description         validated against YouTube's limits
//     version                    +1 per save (an edit made from an older copy is refused)
//     createdAt/By, updatedAt/By
//
//   broadcastThumbnails/{CFBDGameId}   the game's generated thumbnail
//     gameId, scheduleId         (thumbnail.js — drawn from a fixed template,
//     png (bytes), width, height, bytes, sha256      no AI, no image service)
//     inputs { away, home: { name, color, logo: { source, url } }, kickoffAt, templateVersion }
//     notes                      what was missing (e.g. a logo → initials)
//     version, createdAt/By, updatedAt/By
//   Kept apart from the text draft so either can be saved without the other.
//   A 1280×720 PNG from the template is well under Firestore's 1 MiB doc
//   limit; one that isn't is refused rather than stored.
//
// Saving a draft (or a thumbnail) writes that one doc and nothing else: no YouTube call, no
// broadcasts record, no automation, VM, agent, worker, slot or schedule
// change. A YouTube broadcast that already exists is never changed by it.
// Written only here (Admin SDK); firestore.rules has no rule for the
// collection, so clients can't read or write it directly.

const { Timestamp } = require("firebase-admin/firestore");
const { httpError } = require("./youtube");

const COLLECTION = "broadcastMetadata";
const THUMBS = "broadcastThumbnails";
const MAX_THUMB_BYTES = 900 * 1024;
// YouTube's limits: title 1–100 characters, description up to 5000 bytes
// (UTF-8), and neither may contain < or >.
const LIMITS = { titleMax: 100, descriptionMaxBytes: 5000 };

const SCHEDULE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const GAME_ID_RE = /^\d{1,20}$/;

const chars = (s) => [...s].length;
const utf8Bytes = (s) => Buffer.byteLength(s, "utf8");

// Line breaks are kept (CRLF → LF); only the ends are trimmed.
function normalize({ title, description } = {}) {
  return {
    title: String(title ?? "").replace(/\s+/g, " ").trim(),
    description: String(description ?? "").replace(/\r\n?/g, "\n").trim(),
  };
}

// { title, description, errors: { title?, description? } } — errors empty when valid.
function validateMetadata(input) {
  const { title, description } = normalize(input);
  const errors = {};
  if (!title) errors.title = "Title is required.";
  else if (chars(title) > LIMITS.titleMax) errors.title = `Title must be ${LIMITS.titleMax} characters or fewer (it's ${chars(title)}).`;
  else if (/[<>]/.test(title)) errors.title = "Title can't contain < or >.";
  if (utf8Bytes(description) > LIMITS.descriptionMaxBytes) errors.description = `Description must be ${LIMITS.descriptionMaxBytes} bytes or fewer (it's ${utf8Bytes(description)}).`;
  else if (/[<>]/.test(description)) errors.description = "Description can't contain < or >.";
  return { title, description, errors };
}

const toMs = (v) => (v?.toMillis ? v.toMillis() : v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v) || null);

// The schedule26 game an editor is for — the only way a draft's game id is
// chosen, so a draft can't be saved under another game's id.
async function scheduleGame(db, scheduleId) {
  const id = String(scheduleId || "");
  if (!SCHEDULE_ID_RE.test(id)) throw httpError(400, "Pick a game from the schedule.");
  const s = (await db.collection("schedule26").doc(id).get()).data();
  if (!s) throw httpError(404, "That game isn't in the CFB schedule.");
  const gameId = String(s.CFBDGameId ?? "");
  if (!GAME_ID_RE.test(gameId)) throw httpError(400, "This game isn't linked to We-Draft Live (no CFBD game id) — set it in Admin → CFB Schedule.");
  return { scheduleId: id, gameId, home: s.Home || null, away: s.Away || null, kickoffAt: toMs(s.KickoffAt), slug: s.Slug || null, week: s.Week || null };
}


// ── Generated title / description ──
// Every game gets these automatically: the editor starts from them, and an
// automated broadcast uses them when no draft was saved. Built from the
// saved schedule (matchup, kickoff), the schools (mascots) and the current
// polls (ranks — the live game's rank, else the week's rankings Top 25).
//
//   Florida State vs Louisville LIVE Score and Play by Play
//
//   Watch the (#23) Florida State Seminoles take on the (#24) Louisville
//   Cardinals LIVE with We-Draft Live, … (template below)

const ET = "America/New_York";
const genDate = (ms) => (ms ? new Date(ms).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: ET }) : "TBA");
const genTime = (ms, tbd) => (ms && !tbd ? `${new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET })} ET` : "TBA");
// "#FloridaStateFootball" — letters and digits only ("Texas A&M" → TexasAM, "San José State" → SanJoseState).
const hashtag = (school) => `#${String(school || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1)).join("")}Football`;
// "(#23) Florida State Seminoles" / "Florida State Seminoles"
const fullName = (t) => {
  const mascot = t.mascot && !String(t.school).toLowerCase().includes(String(t.mascot).toLowerCase()) ? ` ${t.mascot}` : "";
  return `${t.rank ? `(#${t.rank}) ` : ""}${t.school}${mascot}`;
};

function buildGenerated({ away, home, kickoffAt, timeTbd }) {
  const title = `${away.school} vs ${home.school} LIVE Score and Play by Play`;
  const description = [
    `Watch the ${fullName(away)} take on the ${fullName(home)} LIVE with We-Draft Live, your destination for college football coverage.`,
    "Follow the matchup with live game information, scoring updates, and a dynamic football broadcast experience.",
    `🏈 Matchup: ${away.school} vs ${home.school}`,
    `📅 Date: ${genDate(kickoffAt)}`,
    `⏰ Kickoff: ${genTime(kickoffAt, timeTbd)}`,
    "Follow We-Draft for more college football coverage, player evaluations, and NFL Draft scouting.",
    "🌐 Website: https://we-draft.com",
    "📺 YouTube: https://www.youtube.com/@kingcoldsports",
    "Subscribe for more college football content throughout the season.",
    `${hashtag(away.school)} ${hashtag(home.school)} #CollegeFootball`,
  ].join("\n");
  return validateMetadata({ title, description });
}

const rankNum = (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 25 ? Number(v) : null);
const rankingsWeekKey = (week) => { const w = String(week || "").trim(); return w.toLowerCase() === "week 0" ? "Week 1" : w; };

// The inputs for one schedule game (scheduleGame's shape).
async function generatedInputs(db, g) {
  const sched = (await db.collection("schedule26").doc(g.scheduleId).get()).data() || {};
  const live = (await db.collection("liveGames").doc(g.gameId).get()).data() || {};
  let poll = null;
  const pollRank = async (school) => {
    if (!poll) {
      const key = rankingsWeekKey(g.week);
      poll = new Map();
      if (key) ((await db.collection("rankings").doc(key).get()).data()?.Top25 || []).forEach((e) => { if (e?.School) poll.set(e.School, e.Rank); });
    }
    return rankNum(poll.get(school));
  };
  const team = async (side, school) => {
    const s = (await db.collection("schools").where("School", "==", String(school || "")).limit(1).get()).docs[0]?.data() || {};
    const rank = rankNum(live[side]?.rank) ?? (await pollRank(school));
    return { school: school || "TBD", mascot: s.Mascot || live[side]?.mascot || null, rank };
  };
  return {
    away: await team("away", g.away),
    home: await team("home", g.home),
    kickoffAt: g.kickoffAt,
    timeTbd: /tba|tbd/i.test(String(sched.Time || "")) || live.startTimeTBD === true,
  };
}

// { title, description } for a schedule game, ready to use.
async function generatedMetadata(db, g) {
  const v = buildGenerated(await generatedInputs(db, g));
  return { title: v.title, description: v.description };
}

// For youtubeCreate: the generated text for a broadcast record's game (its
// automation's schedule game, else the schedule doc with its CFBD id), or null.
async function generatedForBroadcast(db, rec) {
  let scheduleId = rec.auto?.scheduleId || null;
  if (!scheduleId) {
    const snap = await db.collection("schedule26").where("CFBDGameId", "==", Number(rec.gameId)).limit(1).get();
    scheduleId = snap.docs[0]?.id || null;
  }
  if (!scheduleId) return null;
  const g = await scheduleGame(db, scheduleId);
  if (g.gameId !== String(rec.gameId)) return null;
  const v = buildGenerated(await generatedInputs(db, g));
  return Object.keys(v.errors).length ? null : { title: v.title, description: v.description };
}

const draftView = (d) => (d ? {
  title: d.title, description: d.description, version: d.version || 0,
  updatedAt: toMs(d.updatedAt), updatedBy: d.updatedBy || null,
} : null);
const pngBuffer = (v) => (Buffer.isBuffer(v) ? v : v?.toUint8Array ? Buffer.from(v.toUint8Array()) : v instanceof Uint8Array ? Buffer.from(v) : null);
const thumbView = (t) => {
  const png = t && pngBuffer(t.png);
  return png ? {
    sha256: t.sha256, width: t.width, height: t.height, bytes: png.length, version: t.version || 0,
    updatedAt: toMs(t.updatedAt), updatedBy: t.updatedBy || null, inputs: t.inputs || null, notes: t.notes || [],
    dataUrl: `data:image/png;base64,${png.toString("base64")}`,
  } : null;
};

// The game's saved thumbnail doc, only when it's really this game's.
async function readThumbnail(db, gameId) {
  const snap = await db.collection(THUMBS).doc(String(gameId)).get();
  const t = snap.exists ? snap.data() : null;
  return t && String(t.gameId) === String(gameId) && pngBuffer(t.png) ? t : null;
}

// A stored draft, only when it's really this game's.
async function readDraft(db, gameId) {
  const snap = await db.collection(COLLECTION).doc(String(gameId)).get();
  const d = snap.exists ? snap.data() : null;
  return d && String(d.gameId) === String(gameId) ? d : null;
}

// metadata-get { scheduleId } — read-only. broadcast: whether a real
// broadcast for this game already has a YouTube broadcast (which a draft
// never changes).
async function getMetadata(db, body = {}) {
  const g = await scheduleGame(db, body.scheduleId);
  const d = await readDraft(db, g.gameId);
  const recs = (await db.collection("broadcasts").where("gameId", "==", g.gameId).get()).docs.map((x) => x.data()).filter((b) => b.rehearsal !== true);
  const yt = recs.find((b) => b.youtube?.broadcastId);
  return {
    game: g,
    draft: draftView(d),
    thumbnail: thumbView(await readThumbnail(db, g.gameId)),
    defaults: await generatedMetadata(db, g),
    limits: LIMITS,
    broadcast: { exists: recs.length > 0, youtubeCreated: !!yt },
  };
}

// metadata-save { scheduleId, title, description, baseVersion } — writes
// broadcastMetadata/{gameId} only. baseVersion: the version the editor
// opened (0 = none saved); a save over a newer one is refused.
async function saveMetadata(db, uid, body = {}, now = Date.now()) {
  const g = await scheduleGame(db, body.scheduleId);
  const v = validateMetadata(body);
  const bad = Object.values(v.errors);
  if (bad.length) throw Object.assign(httpError(400, bad.join(" ")), { fields: v.errors });
  const ref = db.collection(COLLECTION).doc(g.gameId);
  const saved = await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data();
    if (cur && String(cur.gameId) !== g.gameId) throw httpError(409, "The stored draft belongs to another game.");
    const version = cur?.version || 0;
    if (body.baseVersion != null && Number(body.baseVersion) !== version) {
      throw httpError(409, "This draft was saved somewhere else since you opened it — close the editor and reopen it to see the latest.");
    }
    const at = Timestamp.fromMillis(now);
    const doc = {
      gameId: g.gameId, scheduleId: g.scheduleId, home: g.home, away: g.away,
      title: v.title, description: v.description,
      version: version + 1,
      createdAt: cur?.createdAt || at, createdBy: cur?.createdBy || uid,
      updatedAt: at, updatedBy: uid,
    };
    tx.set(ref, doc);
    return doc;
  });
  return { ok: true, gameId: g.gameId, draft: draftView(saved) };
}

// metadata-thumbnail-generate { scheduleId } — renders a preview from the
// template (thumbnail.js). Stores nothing; calls no YouTube API.
async function generateThumbnail(db, body = {}, opts = {}) {
  const r = await require("./thumbnail").generate(db, body.scheduleId, opts);
  return {
    gameId: r.game.gameId, sha256: r.sha256, width: r.width, height: r.height, bytes: r.png.length,
    inputs: r.inputs, notes: r.notes, dataUrl: `data:image/png;base64,${r.png.toString("base64")}`,
  };
}

// metadata-thumbnail-save { scheduleId, sha256 } — renders again and stores
// it in broadcastThumbnails/{gameId}, only when it's the image the admin
// previewed (sha256): if anything it's drawn from changed since (a logo, a
// color, the kickoff), nothing is saved and the preview is to be
// regenerated. Never uploads it anywhere.
async function saveThumbnail(db, uid, body = {}, now = Date.now(), opts = {}) {
  if (!/^[0-9a-f]{64}$/.test(String(body.sha256 || ""))) throw httpError(400, "Generate a thumbnail and check the preview before saving it.");
  const r = await require("./thumbnail").generate(db, body.scheduleId, opts);
  if (r.sha256 !== body.sha256) throw httpError(409, "The thumbnail came out different from the preview (a logo, color or kickoff changed) — generate it again and check the new preview.");
  if (r.png.length > MAX_THUMB_BYTES) throw httpError(413, `The thumbnail is ${Math.round(r.png.length / 1024)} KB — over the ${MAX_THUMB_BYTES / 1024} KB that can be stored.`);
  const ref = db.collection(THUMBS).doc(r.game.gameId);
  const saved = await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data();
    if (cur && String(cur.gameId) !== r.game.gameId) throw httpError(409, "The stored thumbnail belongs to another game.");
    const at = Timestamp.fromMillis(now);
    const doc = {
      gameId: r.game.gameId, scheduleId: r.game.scheduleId,
      png: r.png, width: r.width, height: r.height, bytes: r.png.length, sha256: r.sha256,
      inputs: r.inputs, notes: r.notes, templateVersion: r.inputs.templateVersion,
      version: (cur?.version || 0) + 1,
      createdAt: cur?.createdAt || at, createdBy: cur?.createdBy || uid,
      updatedAt: at, updatedBy: uid,
    };
    tx.set(ref, doc);
    return doc;
  });
  return { ok: true, gameId: r.game.gameId, thumbnail: thumbView(saved) };
}

// For an explicit upload to a created YouTube broadcast (broadcasts.js
// youtubeThumbnail): the game's saved PNG, or null.
async function thumbnailForBroadcast(db, gameId) {
  if (!GAME_ID_RE.test(String(gameId || ""))) return null;
  const t = await readThumbnail(db, gameId);
  return t ? { png: pngBuffer(t.png), sha256: t.sha256, version: t.version || 0 } : null;
}

// For youtubeCreate: the game's saved draft when it's valid, else null (the
// record's own title / description are used — the current default).
async function draftForBroadcast(db, gameId) {
  if (!GAME_ID_RE.test(String(gameId || ""))) return null;
  const d = await readDraft(db, gameId);
  if (!d) return null;
  const v = validateMetadata(d);
  if (Object.keys(v.errors).length) return null;
  return { title: v.title, description: v.description, version: d.version || 0 };
}

module.exports = {
  COLLECTION, THUMBS, LIMITS, MAX_THUMB_BYTES, validateMetadata, scheduleGame,
  buildGenerated, generatedMetadata, generatedForBroadcast, hashtag,
  getMetadata, saveMetadata, draftForBroadcast,
  generateThumbnail, saveThumbnail, thumbnailForBroadcast,
};
