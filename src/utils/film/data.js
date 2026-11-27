// src/utils/film/data.js
//
// The Film Manager's records (admin-only — firestore.rules filmGames /
// filmPlays). Metadata only; the video stays on the admin's disk.
//
//   filmGames/{gameId}  (gameId = library.gameIdOf(file))
//     { file, folder, season, offense, defense,
//       focus: [person], plays (count), updatedAt }
//   filmPlays/{auto}
//     { gameId, file, in, out (seconds in the game file), source: "cut" | "premiere",
//       playerIds: [key] (for "his plays" queries),
//       players: { [key]: tag }, createdAt, updatedAt }
//
// A person (anyone on the two CFBD rosters, or a We-Draft player):
//   { key, name, pos, team, wd (players doc id | null), cfbd (CFBD id | null) }
//   key: "wd_<id>" when he's a We-Draft player, else "cfbd_<id>".
// A tag (that person on that play):
//   { ...person, label: "" | LABELS, spot: { t, x, y } | null (where he is,
//     normalized to the frame, t in game seconds), note, wash: { keys:
//     [{ t, x, y, z }] } | null (the zoomed-in "washed" version — the
//     original stays the play itself), legacy: { project, sequence, scale,
//     animated, offFrame, mark } (imported from Premiere — the mark already
//     moved onto the full-size film, utils/film/legacy.js), taggedAt }
//   spot.kind "circle" | "arrow" and spot.size (a fraction of the film's height).
//   traits: [names] — his position's / the generic traits this play shows.
//   trim: { in, out } | null — HIS cut of the play (sooner / later for this
//     player); the play's own in / out are unchanged for everyone else.
//   wash is only ever a VERSION: the play itself (in / out, full frame) stays the source of truth.
import { addDoc, arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, FieldPath, getDoc, getDocs, increment, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../../firebase";

// Labels only — for finding plays later (user, 2026-11-25).
export const LABELS = ["Great", "Good", "Okay", "Neutral", "Bad", "Very bad"];
export const LABEL_COLORS = { Great: "#0055a5", Good: "#2f86d6", Okay: "#5f6b7a", Neutral: "#8a97ab", Bad: "#e8731f", "Very bad": "#a52a1e" };

const GAMES = collection(db, "filmGames");
const PLAYS = collection(db, "filmPlays");

export const personKey = (p) => (p.wd ? `wd_${p.wd}` : `cfbd_${p.cfbd}`);
export const person = (p) => ({ key: personKey(p), name: p.name || "", pos: p.pos || "", team: p.team || "", wd: p.wd || null, cfbd: p.cfbd || null });

// ── Games ──
export async function listGames() {
  const snap = await getDocs(GAMES);
  return snap.docs.filter((d) => !d.id.startsWith("_")).map((d) => ({ id: d.id, ...d.data() }));
}

// ── Everyone with film: filmGames/_players { players: { [key]: person } } —
// so the Players search finds anyone tagged (a CFBD-only player, a class
// outside the site's search list), not just the board's 2027–29 classes. ──
const INDEX = doc(GAMES, "_players");
export async function filmPeople() {
  const d = await getDoc(INDEX).catch(() => null);
  return d?.exists() ? Object.values(d.data().players || {}) : [];
}
export const indexPeople = (people) => (people.length
  ? setDoc(INDEX, { players: Object.fromEntries(people.map((p) => [personKey(p), person(p)])) }, { merge: true }).catch(() => {})
  : Promise.resolve());
export const saveGame = (id, patch) => setDoc(doc(GAMES, id), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
// New games from a scan, written in batches (existing ones are left alone).
export async function addGames(games) {
  for (let i = 0; i < games.length; i += 400) {
    const b = writeBatch(db);
    games.slice(i, i + 400).forEach((g) => b.set(doc(GAMES, g.id), { ...g, plays: 0, focus: [], updatedAt: serverTimestamp() }, { merge: true }));
    await b.commit(); // eslint-disable-line no-await-in-loop
  }
}

// ── Plays ──
const withId = (d) => ({ id: d.id, ...d.data() });
export async function playsForGame(gameId) {
  const snap = await getDocs(query(PLAYS, where("gameId", "==", gameId)));
  return snap.docs.map(withId).sort((a, b) => a.in - b.in);
}
// Some games by id (a player's plays' games — a few reads, not the whole library).
export async function gamesByIds(ids) {
  const docs = await Promise.all([...new Set(ids)].map((id) => getDoc(doc(GAMES, id)).catch(() => null)));
  return docs.filter((d) => d?.exists()).map((d) => ({ id: d.id, ...d.data() }));
}
export async function playsForGames(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await getDocs(query(PLAYS, where("gameId", "in", ids.slice(i, i + 30)))); // eslint-disable-line no-await-in-loop
    out.push(...snap.docs.map(withId));
  }
  return out;
}
export async function playsForPlayer(key) {
  const snap = await getDocs(query(PLAYS, where("playerIds", "array-contains", key)));
  return snap.docs.map(withId).sort((a, b) => String(a.gameId).localeCompare(String(b.gameId)) || a.in - b.in);
}
export async function getPlay(id) {
  const d = await getDoc(doc(PLAYS, id));
  return d.exists() ? withId(d) : null;
}

const tagOf = (p, extra = {}) => ({ ...person(p), label: "", spot: null, note: "", wash: null, ...extra, taggedAt: Date.now() });

// Cut a play (it's "hot" in the UI): its game, its in/out, anyone tagged right away.
export async function cutPlay(game, inPt, outPt, people = []) {
  const players = Object.fromEntries(people.map((p) => [personKey(p), tagOf(p)]));
  const ref = await addDoc(PLAYS, {
    gameId: game.id, file: game.file, in: inPt, out: outPt, source: "cut",
    playerIds: Object.keys(players), players, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  await updateDoc(doc(GAMES, game.id), { plays: increment(1) }).catch(() => {});
  await indexPeople(people);
  return { id: ref.id, gameId: game.id, file: game.file, in: inPt, out: outPt, source: "cut", playerIds: Object.keys(players), players };
}
// A play imported from a legacy Premiere project: tagged to its player, with the mark's spot.
export async function importPlay(game, inPt, outPt, p, extra) {
  const key = personKey(p);
  await addDoc(PLAYS, {
    gameId: game.id, file: game.file, in: inPt, out: outPt, source: "premiere",
    playerIds: [key], players: { [key]: tagOf(p, extra) }, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  await updateDoc(doc(GAMES, game.id), { plays: increment(1) }).catch(() => {});
  await indexPeople([p]);
}
export async function deletePlay(play) {
  await deleteDoc(doc(PLAYS, play.id));
  await updateDoc(doc(GAMES, play.gameId), { plays: increment(-1) }).catch(() => {});
}
export const updatePlay = (id, patch) => updateDoc(doc(PLAYS, id), { ...patch, updatedAt: serverTimestamp() });

// Tag / untag someone on a play.
export async function tagPlayer(play, p, extra = {}) {
  const key = personKey(p);
  const tag = tagOf(p, extra);
  await updateDoc(doc(PLAYS, play.id), new FieldPath("players", key), tag, "playerIds", arrayUnion(key), "updatedAt", serverTimestamp());
  await indexPeople([p]);
  return tag;
}
export async function untagPlayer(play, key) {
  await updateDoc(doc(PLAYS, play.id), new FieldPath("players", key), deleteField(), "playerIds", arrayRemove(key), "updatedAt", serverTimestamp());
}
// Change a tag's fields (label, spot, note, wash).
export async function editTag(play, key, patch) {
  const args = [];
  Object.entries(patch).forEach(([k, v]) => { args.push(new FieldPath("players", key, k), v === undefined ? deleteField() : v); });
  await updateDoc(doc(PLAYS, play.id), ...args, "updatedAt", serverTimestamp());
}

// ── Traits (user, 2026-11-25): a play can carry any of the player's position
// traits and the generic ones (traits/{position}, traits/Generic — the lists
// the evaluations use). Just traits on the play: not marked strength / weakness.
// CFBD positions → the trait list's position. ──
const TRAIT_POS = { CB: "DB", S: "DB", FS: "DB", SS: "DB", NB: "DB", SAF: "DB", OT: "OL", OG: "OL", C: "OL", G: "OL", T: "OL", IOL: "OL", DT: "DL", NT: "DL", DE: "EDGE", OLB: "LB", ILB: "LB", MLB: "LB", PK: "K", FB: "RB" };
export const traitPos = (pos) => { const p = String(pos || "").toUpperCase().trim(); return TRAIT_POS[p] || p; };
const traitCache = {};
export function traitsFor(pos) {
  const key = traitPos(pos);
  if (!traitCache[key]) {
    const read = (id) => getDoc(doc(db, "traits", id)).then((d) => (d.exists() ? d.data().traits || [] : [])).catch(() => []);
    traitCache[key] = Promise.all([key ? read(key) : [], read("Generic")]).then(([position, generic]) => ({ position, generic: generic.filter((g) => !position.includes(g)) }));
  }
  return traitCache[key];
}

// ── Which side of the ball a position plays (user, 2026-11-26) ──
// Each film is one team's offense, so voice / roster lists only need that
// team's offense and the other team's defense — no two #50s. Specialists ride
// with the offense; ATH and unknown positions stay on both sides.
const OFF_POS = /^(QB|RB|HB|TB|FB|WR|TE|OL|OT|OG|G|T|C|IOL|K|PK|P|LS)$/;
const DEF_POS = /^(DL|DT|DE|NT|EDGE|LB|ILB|OLB|MLB|WLB|SLB|CB|S|FS|SS|DB|NB|STAR)$/;
export function sideOf(pos) {
  const x = String(pos || "").toUpperCase().trim();
  return OFF_POS.test(x) ? "offense" : DEF_POS.test(x) ? "defense" : null;
}
/** A roster cut to one side of the ball (unknown / ATH kept). */
export const forSide = (list, side) => (list || []).filter((p) => { const s0 = sideOf(p.pos); return !s0 || s0 === side; });

// ── Rosters (CFBD) ──
// A team's roster from cfbdPlayers (team = CFBD's school name). Cached per team.
const rosterCache = {};
export function roster(team) {
  const t = String(team || "").trim();
  if (!t) return Promise.resolve([]);
  if (!rosterCache[t]) {
    rosterCache[t] = getDocs(query(collection(db, "cfbdPlayers"), where("team", "==", t))).then((snap) => snap.docs.map((d) => {
      const x = d.data();
      return { ...person({ name: x.name || `${x.firstName || ""} ${x.lastName || ""}`.trim(), pos: x.position || "", team: x.team || t, wd: x.wedraftPlayerId || null, cfbd: d.id }), jersey: x.jersey ?? null, season: x.rosterSeason || x.lastSeason || null };
    }).sort((a, b) => (a.jersey ?? 999) - (b.jersey ?? 999))).catch(() => []);
  }
  return rosterCache[t];
}
