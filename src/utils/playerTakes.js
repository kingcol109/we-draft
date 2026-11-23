// src/utils/playerTakes.js
//
// Kenneth Cold's written player takes for the Draft Sim desk
// (config/draftSimAnalysis.players: { [playerId]: { normal: [line, …] } }),
// shared by Admin → Mock Draft → Personalities (AdminMockDraft.jsx) and
// Admin → Go (AdminGo.jsx) so the two can't drift. A line is its text, or
// { text, mock?, noSim? } (utils/draftSim/analysts.js).
//
// A save writes only the players given (players.{id} via FieldPath), so two
// admins — or an old tab — don't wipe each other's work, then hands back
// everyone's takes as saved and applies them to the sim's desk.
import { deleteField, doc, FieldPath, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { applyPlayerTakes, lineText, takeLinesOf, TAKE_KEY, VARIABLES, VARIABLE_GROUPS } from "./draftSim/analysts";

export const TAKES_REF = () => doc(db, "config", "draftSimAnalysis");

// mock — the Weekly Mock's pick notes may use it too; noSim — off the sim.
export const takeLine = (text, { mock, noSim } = {}) => (mock || noSim ? { text, ...(mock ? { mock: true } : {}), ...(noSim ? { noSim: true } : {}) } : text);
export const withLine = (x, patch) => takeLine(patch.text ?? lineText(x), { mock: x.mock, noSim: x.noSim, ...patch });
// A player's takes as stored: blank lines dropped, old situations folded in.
export const cleanTakes = (t = {}) => {
  const lines = takeLinesOf(t).map((l) => withLine(l, { text: lineText(l).trim() }));
  return lines.length ? { [TAKE_KEY]: lines } : {};
};
// Every line (blank ones being written included), old situations after his own.
export const linesOf = (t = {}) => [TAKE_KEY, "reach", "steal", "depth"].flatMap((k) => t[k] || []);
export const takeCount = (t = {}) => takeLinesOf(t).length;

// Every variable a line can use: VARIABLES plus the palette's (the CFBD
// stat-line keys), and the trade side's other coordinators.
const KNOWN = new Set([...Object.keys(VARIABLES), ...VARIABLE_GROUPS.flatMap(([, keys]) => keys), "fromOc", "fromDc"]);
export const unknownVars = (text) => (String(text || "").match(/\{([\w ]+)\}/g) || []).map((v) => v.slice(1, -1)).filter((v) => !KNOWN.has(v));

// Straight from Firestore (not the sim's page-session cache). → { [id]: takes }
export async function loadTakes() {
  const snap = await getDoc(TAKES_REF());
  return snap.exists() ? snap.data().players || {} : {};
}

// changes: { [playerId]: takes } — a player with no lines left is removed.
// → everyone's takes as saved (this save's and any other admin's).
export async function saveTakes(changes) {
  const ids = Object.keys(changes);
  const pairs = ids.flatMap((id) => {
    const t = cleanTakes(changes[id]);
    return [new FieldPath("players", id), Object.keys(t).length ? t : deleteField()];
  });
  try {
    await updateDoc(TAKES_REF(), ...pairs, "updatedAt", serverTimestamp());
  } catch (e) {
    if (e.code !== "not-found") throw e;
    // First save ever: no doc to update yet.
    const players = Object.fromEntries(ids.map((id) => [id, cleanTakes(changes[id])]).filter(([, t]) => Object.keys(t).length));
    await setDoc(TAKES_REF(), { players, updatedAt: serverTimestamp() });
  }
  const fresh = await loadTakes();
  applyPlayerTakes(fresh);
  return fresh;
}
