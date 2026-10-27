// src/utils/draftSim/badges.js
//
// Draft Sim badges — one-time achievements, earned once each, that pop up
// in the sim when they're earned (like Xbox achievements) and go on a
// signed-in user's profile (signed out, they still pop up, and the end
// screen asks them to make an account to keep them). Not live yet: for now
// they're only written in Admin → Mock Draft → Badges (AdminSimBadges.jsx).
//   simBadges/{id} { title, description, rarity, icon (a small data: URL or
//                    an https URL), active (false until badges go live),
//                    createdAt, updatedAt }
// Admins read and write them all; anyone else will read only active ones
// (firestore.rules).
import { collection, doc } from "firebase/firestore";
import { db } from "../../firebase";

export const badgesCol = () => collection(db, "simBadges");
export const badgeRef = (id) => doc(db, "simBadges", id);

// Rarest last. color: the badge's accent.
export const RARITIES = [
  { key: "common", label: "Common", color: "#9fb0c8" },
  { key: "uncommon", label: "Uncommon", color: "#4ade80" },
  { key: "rare", label: "Rare", color: "#58a6ff" },
  { key: "elite", label: "Elite", color: "#f6a21d" },
];
export const rarityOf = (key) => RARITIES.find((r) => r.key === key) || RARITIES[0];
export const BADGE_ICON_PX = 128;
