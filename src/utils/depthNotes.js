// src/utils/depthNotes.js
//
// Depth chart notes — the admin's own read of NFL position groups and
// players, written in Admin → Research's Team view (AdminResearch.js), and
// read by the team need suggestions (utils/teamNeedSuggestions.js).
// Admin-only (firestore.rules), like the PFF data it sits beside:
//   nflDepthNotes/{abbr}   { groups: { [group]: note },
//                            wants: { [group]: [trait] },
//                            order: { [group]: [pffId] },
//                            roleOrder: { [role]: [pffId] }, updatedAt }
//                          — stays with the team. For each of its position
//                          groups (Research's GROUPS keys: QB, OL, IDL…): a
//                          note, the traits it wants (from the same traits/
//                          lists as college Strengths / Weaknesses —
//                          TRAIT_DOC), and the admin's depth order, starters
//                          first (none: PFF's snaps decide; anyone gone from
//                          the team just drops out of it) — and the same for
//                          each role (engine ROLES keys), its first the one
//                          who plays it. Kept apart from the groups' so a
//                          role's order never moves a position's starters.
//   nflPlayerTags/{pffId}  { n, talent, dev, roles, strengths, weaknesses,
//                            note, team, g, updatedAt } — one
//                          player's tags and note, keyed by his PFF player id
//                          (pffNflRosters players[].id), so they follow him
//                          when he changes teams. n / team / g: his name, the
//                          team and group he was tagged at — for reading the
//                          doc on its own; where he plays now comes from the
//                          depth charts.
// roles: the jobs he does within his position (engine ROLES keys — Slot
// WR, Nose Tackle…); Research lists each role as its own group, and the
// role needs go by who has it.
// Each player has at most one talent tag and one development tag, and up
// to MAX_TRAITS strengths and weaknesses (never the same trait as both) —
// the college rules (AdminPanel.js handleToggleTrait).
import { doc, getDocs, collection, setDoc, deleteDoc, deleteField, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

// tier: how good — what the need suggestions weigh (higher = better).
export const TALENT_TAGS = [
  { key: "franchise", label: "Franchise", color: "#7a3cff", tier: 7 },
  { key: "difference", label: "Difference Maker", color: "#15803d", tier: 6 },
  { key: "plus", label: "Plus Starter", color: "#0055a5", tier: 5 },
  { key: "average", label: "Average Starter", color: "#3b82c4", tier: 4 },
  { key: "highDepth", label: "High-End Depth", color: "#b7791f", tier: 3 },
  { key: "avgDepth", label: "Average Depth", color: "#8a6d3b", tier: 2 },
  { key: "lowDepth", label: "Low-End Depth", color: "#8a97ab", tier: 1 },
];
export const DEV_TAGS = [
  { key: "high", label: "High-End Developmental", short: "High Dev", color: "#0f766e" },
  { key: "medium", label: "Medium Developmental", short: "Med Dev", color: "#14b8a6" },
  { key: "low", label: "Low Developmental", short: "Low Dev", color: "#8a97ab" },
];
export const MAX_TRAITS = 5;
// Each Research group's traits/{doc} (+ traits/Generic).
export const TRAIT_DOC = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", OL: "OL", IDL: "DL", EDGE: "EDGE", LB: "LB", CB: "DB", S: "DB" };

// Every trait list → { [doc]: [trait] }.
export async function loadTraits() {
  const snap = await getDocs(collection(db, "traits"));
  return Object.fromEntries(snap.docs.map((d) => [d.id, [...(d.data().traits || [])].sort()]));
}
// A group's traits: its position's, then the generic ones.
export const traitsFor = (traits, group) => [...new Set([...(traits[TRAIT_DOC[group]] || []), ...(traits.Generic || [])])];

export const talentTag = (key) => TALENT_TAGS.find((t) => t.key === key) || null;
export const devTag = (key) => DEV_TAGS.find((t) => t.key === key) || null;

// Every team's notes → { [abbr]: { groups, wants, order, roleOrder } }.
export async function loadTeamNotes() {
  const snap = await getDocs(collection(db, "nflDepthNotes"));
  return Object.fromEntries(snap.docs.map((d) => [d.id, {
    groups: d.data().groups || {}, wants: d.data().wants || {}, order: d.data().order || {}, roleOrder: d.data().roleOrder || {},
  }]));
}

// Every tagged player → { [pffId]: { n, talent, dev, note, team, g } }.
export async function loadPlayerTags() {
  const snap = await getDocs(collection(db, "nflPlayerTags"));
  return Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
}

const teamField = (abbr, field, group, value) => setDoc(doc(db, "nflDepthNotes", abbr), { [field]: { [group]: value ?? deleteField() }, updatedAt: serverTimestamp() }, { merge: true });
// A group's note ("" clears it).
export const saveGroupNote = (abbr, group, note) => teamField(abbr, "groups", group, (note || "").trim() || null);
// The traits a group wants ([] clears them).
export const saveGroupWants = (abbr, group, list) => teamField(abbr, "wants", group, list?.length ? list : null);
// A group's depth order, starters first (null: back to PFF's).
export const saveGroupOrder = (abbr, group, ids) => teamField(abbr, "order", group, ids?.length ? ids.map(String) : null);
// A role's order, the one who plays it first (null: back to the default).
export const saveRoleOrder = (abbr, role, ids) => teamField(abbr, "roleOrder", role, ids?.length ? ids.map(String) : null);

// The stored form of a player's entry ({ n, talent, dev, roles, strengths,
// weaknesses, note, team, g }); null when there's nothing in it.
export function cleanPlayerTags(entry) {
  const clean = {
    n: entry.n || "", talent: entry.talent || null, dev: entry.dev || null, roles: entry.roles || [],
    strengths: (entry.strengths || []).slice(0, MAX_TRAITS), weaknesses: (entry.weaknesses || []).slice(0, MAX_TRAITS),
    note: (entry.note || "").trim(), team: entry.team || "", g: entry.g || "",
  };
  return !clean.talent && !clean.dev && !clean.note && !clean.roles.length && !clean.strengths.length && !clean.weaknesses.length ? null : clean;
}

// A player's tags and note — an empty entry removes his doc.
export function savePlayerTags(id, entry) {
  const clean = cleanPlayerTags(entry);
  const ref = doc(db, "nflPlayerTags", String(id));
  return clean ? setDoc(ref, { ...clean, updatedAt: serverTimestamp() }) : deleteDoc(ref);
}
