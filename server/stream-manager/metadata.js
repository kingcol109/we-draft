// server/stream-manager/metadata.js
//
// YouTube title / description drafts for upcoming game broadcasts (Admin →
// Stream Manager → Auto Schedule → Edit Metadata). A draft is prepared ahead
// of time — e.g. pasted in from text generated elsewhere — and is used when
// the orchestrator later creates the game's real YouTube broadcast
// (broadcasts.js youtubeCreate with useDraft).
//
//   broadcastMetadata/{CFBDGameId}   (…/national: the national stream —
//                                kind "national", used by every national window)
//     gameId, scheduleId         which game (the key is the CFBD id; the
//                                schedule26 doc stays the source of truth for
//                                matchup, kickoff and slug)
//     home, away                 the matchup when it was saved (display only)
//     title, description         validated against YouTube's limits
//     version                    +1 per save (an edit made from an older copy is refused)
//     createdAt/By, updatedAt/By
//
//   broadcastThumbnails/{CFBDGameId | national}   the generated thumbnail
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
// saved schedule (matchup, kickoff), the schools (mascots, short names) and
// the current polls (ranks — the live game's rank, else the week's rankings
// Top 25).
//
//   Florida State vs Louisville LIVE Score and Play by Play
//
//   Watch the (#23) Florida State Seminoles take on the (#24) Louisville
//   Cardinals LIVE with We-Draft Live, … (template below)
//   … #FloridaStateFootball #LouisvilleFootball #FSUvsLOU #CollegeFootball

const ET = "America/New_York";
const genDate = (ms) => (ms ? new Date(ms).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: ET }) : "TBA");
const genTime = (ms, tbd) => (ms && !tbd ? `${new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET })} ET` : "TBA");
const plain = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
// "#FloridaStateFootball" — letters and digits only ("Texas A&M" → TexasAM, "San José State" → SanJoseState).
const hashtag = (school) => `#${plain(school).replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1)).join("")}Football`;
// A team's short tag: its short name when it's one (2–5 letters/digits —
// "FSU"), else the school's initials ("Boston College" → "BC"), else the
// first three letters of a one-word name ("Louisville" → "LOU").
function teamAbbr(t) {
  const short = plain(t.short).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (short.length >= 2 && short.length <= 5) return short;
  const words = plain(t.school).replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).filter((w) => w && !/^(of|the)$/i.test(w));
  if (words.length > 1) return words.map((w) => w[0]).join("").toUpperCase().slice(0, 5);
  return (words[0] || "TBD").slice(0, 3).toUpperCase();
}
// "#FSUvsLOU" — away first, like the title.
const matchupTag = (away, home) => `#${teamAbbr(away)}vs${teamAbbr(home)}`;
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
    `${hashtag(away.school)} ${hashtag(home.school)} ${matchupTag(away, home)} #CollegeFootball`,
  ].join("\n");
  return validateMetadata({ title, description });
}

const rankNum = (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 25 ? Number(v) : null);
const rankingsWeekKey = (week) => { const w = String(week || "").trim(); return w.toLowerCase() === "week 0" ? "Week 1" : w; };
async function pollFor(db, week) {
  const key = rankingsWeekKey(week);
  const poll = new Map();
  if (key) ((await db.collection("rankings").doc(key).get()).data()?.Top25 || []).forEach((e) => { if (e?.School) poll.set(e.School, rankNum(e.Rank)); });
  return poll;
}
const schoolByName = async (db, name) => (await db.collection("schools").where("School", "==", String(name || "")).limit(1).get()).docs[0]?.data() || {};

// The inputs for one schedule game (scheduleGame's shape).
async function generatedInputs(db, g) {
  const sched = (await db.collection("schedule26").doc(g.scheduleId).get()).data() || {};
  const live = (await db.collection("liveGames").doc(g.gameId).get()).data() || {};
  let poll = null;
  const team = async (side, school) => {
    const s = await schoolByName(db, school);
    let rank = rankNum(live[side]?.rank);
    if (rank == null) { poll ||= await pollFor(db, g.week); rank = poll.get(school) ?? null; }
    return { school: school || "TBD", short: s.Short || live[side]?.short || null, mascot: s.Mascot || live[side]?.mascot || null, rank };
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

// ── National coverage ──
// One draft and one thumbnail for the national stream
// (broadcastMetadata/national, broadcastThumbnails/national), used by every
// national window. Generated text names the window's top game: the Game of
// the Week, else the first Featured game, else the best-ranked matchup.
const NATIONAL_KEY = "national";
const NATIONAL_TITLE = "College Football LIVE | Scores, Highlights & Action Around the Country";
const NATIONAL_MAX_MS = 20 * 3600e3;
const nationalDescriptionText = (top) => [
  "College football action from across the country — all in one place. 🏈",
  "",
  "Welcome to the We-Draft Live National Stream, where we follow the action around college football and bring you updates from games across the country throughout the day.",
  "",
  "From major matchups to unexpected momentum swings, stay connected to the national college football landscape with We-Draft Live.",
  "",
  "📊 Follow college football: https://we-draft.com",
  "📺 More football coverage: https://www.youtube.com/@kingcoldsports",
  "",
  "Subscribe for college football coverage, player evaluations, and NFL Draft scouting throughout the season.",
  "",
  `#CollegeFootball #CollegeFootballLive #WeDraftLive${top ? ` ${matchupTag(top.away, top.home)}` : ""}`,
].join("\n");

function buildNationalGenerated({ top }) {
  return validateMetadata({ title: NATIONAL_TITLE, description: nationalDescriptionText(top) });
}

// { start, end } from { startAt, endAt } (ISO or ms).
function nationalWindow(body = {}) {
  const start = toMs(body.startAt);
  const end = toMs(body.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw httpError(400, "Set when national coverage starts and ends.");
  if (end <= start) throw httpError(400, "The coverage end must be after its start.");
  if (end - start > NATIONAL_MAX_MS) throw httpError(400, `National coverage can run at most ${NATIONAL_MAX_MS / 3600e3} hours.`);
  return { start, end };
}

// The window's schedule games (kickoff inside it), soonest first, and which
// of them lead: Game of the Week, then Featured — else the best-ranked
// (both teams ranked first). tiles: those (up to max); top: the first.
async function nationalInputs(db, w, max = 4) {
  const snap = await db.collection("schedule26")
    .where("KickoffAt", ">=", Timestamp.fromMillis(w.start)).where("KickoffAt", "<=", Timestamp.fromMillis(w.end)).get();
  const games = snap.docs.map((d) => {
    const s = d.data();
    return {
      scheduleId: d.id, gameId: s.CFBDGameId != null ? String(s.CFBDGameId) : null, home: s.Home || "TBD", away: s.Away || "TBD",
      kickoffAt: toMs(s.KickoffAt), week: s.Week || null, gotw: !!s.GameOfWeek, featured: !!s.Featured,
    };
  }).sort((a, b) => a.kickoffAt - b.kickoffAt || String(a.scheduleId).localeCompare(String(b.scheduleId)));
  let lead = [...games.filter((g) => g.gotw), ...games.filter((g) => g.featured && !g.gotw)];
  if (!lead.length && games.length) {
    const poll = await pollFor(db, games[0].week);
    const score = (g) => { const a = poll.get(g.away); const h = poll.get(g.home); return a && h ? a + h : a || h ? (a || h) + 50 : null; };
    lead = games.filter((g) => score(g) != null).sort((a, b) => score(a) - score(b));
  }
  const tiles = lead.slice(0, max);
  const named = async (g) => {
    const [a, h] = await Promise.all([schoolByName(db, g.away), schoolByName(db, g.home)]);
    return { ...g, awayTeam: { school: g.away, short: a.Short || null }, homeTeam: { school: g.home, short: h.Short || null } };
  };
  const top = tiles[0] ? await named(tiles[0]) : null;
  return {
    games, tiles, more: Math.max(0, games.length - tiles.length),
    top: top ? { ...top, away: top.awayTeam, home: top.homeTeam } : null,
  };
}

async function generatedNational(db, w) {
  const v = buildNationalGenerated(await nationalInputs(db, w));
  return { title: v.title, description: v.description };
}

// For youtubeCreate: the generated text for a broadcast record — national
// coverage by its window; a game by its automation's schedule game, else the
// schedule doc with its CFBD id — or null.
async function generatedForBroadcast(db, rec) {
  if (rec.kind === "national") {
    const start = rec.auto?.kickoffAt ?? rec.national?.startAt;
    const end = rec.auto?.endAt ?? rec.national?.endAt;
    if (!start || !end) return null;
    const v = buildNationalGenerated(await nationalInputs(db, { start, end }));
    return Object.keys(v.errors).length ? null : { title: v.title, description: v.description };
  }
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

// ── Drafts and thumbnails ──

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
// A draft / thumbnail key: a CFBD game id, or "national".
const validKey = (k) => GAME_ID_RE.test(String(k || "")) || k === NATIONAL_KEY;

// The saved thumbnail doc, only when it's really this key's.
async function readThumbnail(db, key) {
  const snap = await db.collection(THUMBS).doc(String(key)).get();
  const t = snap.exists ? snap.data() : null;
  return t && String(t.gameId) === String(key) && pngBuffer(t.png) ? t : null;
}

// A stored draft, only when it's really this key's.
async function readDraft(db, key) {
  const snap = await db.collection(COLLECTION).doc(String(key)).get();
  const d = snap.exists ? snap.data() : null;
  return d && String(d.gameId) === String(key) ? d : null;
}

// What an editor request is for: { national: true, startAt, endAt } — the
// national stream for that window — or { scheduleId } — that game.
async function target(db, body = {}) {
  if (body.national === true) return { key: NATIONAL_KEY, national: true, window: nationalWindow(body) };
  const g = await scheduleGame(db, body.scheduleId);
  return { key: g.gameId, game: g };
}

// metadata-get { scheduleId } | { national: true, startAt, endAt } —
// read-only. broadcast: whether a real broadcast for this game (or an open
// national window overlapping this one) already has a YouTube broadcast
// (which a draft never changes).
async function getMetadata(db, body = {}) {
  const t = await target(db, body);
  const recs = t.national
    ? (await db.collection("broadcasts").where("kind", "==", "national").get()).docs.map((x) => x.data())
      .filter((b) => b.rehearsal !== true && b.auto?.open && (b.auto.kickoffAt || 0) < t.window.end && (b.auto.endAt || 0) > t.window.start)
    : (await db.collection("broadcasts").where("gameId", "==", t.key).get()).docs.map((x) => x.data()).filter((b) => b.rehearsal !== true);
  return {
    game: t.game || null,
    national: t.national ? { startAt: t.window.start, endAt: t.window.end } : null,
    draft: draftView(await readDraft(db, t.key)),
    thumbnail: thumbView(await readThumbnail(db, t.key)),
    defaults: t.national ? await generatedNational(db, t.window) : await generatedMetadata(db, t.game),
    limits: LIMITS,
    broadcast: { exists: recs.length > 0, youtubeCreated: recs.some((b) => b.youtube?.broadcastId) },
  };
}

// metadata-save { scheduleId | national, title, description, baseVersion } —
// writes broadcastMetadata/{gameId | national} only. baseVersion: the version
// the editor opened (0 = none saved); a save over a newer one is refused.
async function saveMetadata(db, uid, body = {}, now = Date.now()) {
  const t = await target(db, body);
  const v = validateMetadata(body);
  const bad = Object.values(v.errors);
  if (bad.length) throw Object.assign(httpError(400, bad.join(" ")), { fields: v.errors });
  const ref = db.collection(COLLECTION).doc(t.key);
  const saved = await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data();
    if (cur && String(cur.gameId) !== t.key) throw httpError(409, "The stored draft belongs to another game.");
    const version = cur?.version || 0;
    if (body.baseVersion != null && Number(body.baseVersion) !== version) {
      throw httpError(409, "This draft was saved somewhere else since you opened it — close the editor and reopen it to see the latest.");
    }
    const at = Timestamp.fromMillis(now);
    const doc = {
      gameId: t.key,
      ...(t.national ? { kind: "national" } : { scheduleId: t.game.scheduleId, home: t.game.home, away: t.game.away }),
      title: v.title, description: v.description,
      version: version + 1,
      createdAt: cur?.createdAt || at, createdBy: cur?.createdBy || uid,
      updatedAt: at, updatedBy: uid,
    };
    tx.set(ref, doc);
    return doc;
  });
  return { ok: true, gameId: t.key, draft: draftView(saved) };
}

// Renders the target's thumbnail: a game's matchup template, or the national
// template for the window (thumbnail.js).
async function renderThumbnail(db, t, opts) {
  const th = require("./thumbnail");
  return t.national ? th.generateNational(db, t.window, opts) : th.generate(db, t.game.scheduleId, opts);
}

// metadata-thumbnail-generate { scheduleId | national, startAt, endAt } —
// renders a preview. Stores nothing; calls no YouTube API.
async function generateThumbnail(db, body = {}, opts = {}) {
  const t = await target(db, body);
  const r = await renderThumbnail(db, t, opts);
  return {
    gameId: t.key, sha256: r.sha256, width: r.width, height: r.height, bytes: r.png.length,
    inputs: r.inputs, notes: r.notes, dataUrl: `data:image/png;base64,${r.png.toString("base64")}`,
  };
}

// metadata-thumbnail-save { scheduleId | national…, sha256 } — renders again
// and stores it in broadcastThumbnails/{gameId | national}, only when it's
// the image the admin previewed (sha256): if anything it's drawn from changed
// since (a logo, a color, the kickoff, the window's games), nothing is saved
// and the preview is to be regenerated. Never uploads it anywhere.
async function saveThumbnail(db, uid, body = {}, now = Date.now(), opts = {}) {
  if (!/^[0-9a-f]{64}$/.test(String(body.sha256 || ""))) throw httpError(400, "Generate a thumbnail and check the preview before saving it.");
  const t = await target(db, body);
  const r = await renderThumbnail(db, t, opts);
  if (r.sha256 !== body.sha256) throw httpError(409, "The thumbnail came out different from the preview (a logo, color, kickoff or game changed) — generate it again and check the new preview.");
  if (r.png.length > MAX_THUMB_BYTES) throw httpError(413, `The thumbnail is ${Math.round(r.png.length / 1024)} KB — over the ${MAX_THUMB_BYTES / 1024} KB that can be stored.`);
  const ref = db.collection(THUMBS).doc(t.key);
  const saved = await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data();
    if (cur && String(cur.gameId) !== t.key) throw httpError(409, "The stored thumbnail belongs to another game.");
    const at = Timestamp.fromMillis(now);
    const doc = {
      gameId: t.key,
      ...(t.national ? { kind: "national", window: { startAt: t.window.start, endAt: t.window.end } } : { scheduleId: t.game.scheduleId }),
      png: r.png, width: r.width, height: r.height, bytes: r.png.length, sha256: r.sha256,
      inputs: r.inputs, notes: r.notes, templateVersion: r.inputs.templateVersion,
      version: (cur?.version || 0) + 1,
      createdAt: cur?.createdAt || at, createdBy: cur?.createdBy || uid,
      updatedAt: at, updatedBy: uid,
    };
    tx.set(ref, doc);
    return doc;
  });
  return { ok: true, gameId: t.key, thumbnail: thumbView(saved) };
}

// For an explicit upload to a created YouTube broadcast (broadcasts.js
// youtubeThumbnail): the saved PNG for a game id or "national", or null.
async function thumbnailForBroadcast(db, key) {
  if (!validKey(key)) return null;
  const t = await readThumbnail(db, key);
  return t ? { png: pngBuffer(t.png), sha256: t.sha256, version: t.version || 0 } : null;
}

// For youtubeCreate: the saved draft for a game id or "national" when it's
// valid, else null.
async function draftForBroadcast(db, key) {
  if (!validKey(key)) return null;
  const d = await readDraft(db, key);
  if (!d) return null;
  const v = validateMetadata(d);
  if (Object.keys(v.errors).length) return null;
  return { title: v.title, description: v.description, version: d.version || 0 };
}

module.exports = {
  COLLECTION, THUMBS, LIMITS, MAX_THUMB_BYTES, NATIONAL_KEY, NATIONAL_TITLE, validateMetadata, scheduleGame,
  buildGenerated, generatedMetadata, generatedForBroadcast, hashtag, teamAbbr, matchupTag,
  buildNationalGenerated, nationalDescriptionText, nationalWindow, nationalInputs, generatedNational,
  getMetadata, saveMetadata, draftForBroadcast,
  generateThumbnail, saveThumbnail, thumbnailForBroadcast,
};
