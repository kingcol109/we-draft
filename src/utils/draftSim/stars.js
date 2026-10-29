// src/utils/draftSim/stars.js
//
// A team's stars — its NFL players tagged Franchise or Difference Maker in
// Admin → Research (compSnapshots/_teamStars, data.js loadStars):
//   { [team]: [{ n (name), k (need key — QB, WR, OT, EDGE…), t (franchise |
//   difference), ro? (role keys) }] }, franchise first.
// The war room and the desk name them where a pick links to one — a
// weapon for the star quarterback, a blocker for him or the star back, a
// second star in the same room, a first-round QB behind one. Only stars
// are ever named: nobody's called out as needing replacing.
import { needKeysFor } from "./engine";

const of = (stars, team) => stars?.[team] || [];
const at = (stars, team, keys) => of(stars, team).filter((s) => keys.includes(s.k));

// An edge rusher, or a defensive lineman tagged as a pass rusher — and the
// stars who rush the passer with them.
const rushes = (p) => p.Position === "EDGE" || (p.Position === "DL" && (p.roles || []).includes("RUSHDL"));
const rushStar = (s) => s.k === "EDGE" || (s.k === "IDL" && (s.ro || []).includes("RUSHDL"));

// The room a prospect joins, as the desk says it.
const ROOM = { QB: "quarterback room", RB: "backfield", WR: "receiver room", TE: "tight end room", OL: "offensive line", DL: "defensive front", EDGE: "pass rush", LB: "linebacker room", DB: "secondary" };
export const roomWord = (p) => (rushes(p) ? "pass rush" : ROOM[p.Position] || "room");

// Every link a pick has to the team's stars, likeliest first →
// [{ kind, star }]:
//   qbShade  a first-round quarterback with a star one already there
//   weapon   a receiver or tight end for the star quarterback
//   protect  an offensive lineman for the star quarterback
//   lanes    an offensive lineman for the star running back
//   rush     a pass rusher to go with a star one
//   pair     anyone else into a star's room
export function starLinks(stars, team, p, round) {
  if (!p || !of(stars, team).length) return [];
  const qb = at(stars, team, ["QB"])[0];
  const rb = at(stars, team, ["RB"])[0];
  const links = [];
  if (p.Position === "QB") return qb && round === 1 ? [{ kind: "qbShade", star: qb }] : [];
  if (qb && ["WR", "TE"].includes(p.Position)) links.push({ kind: "weapon", star: qb });
  if (qb && p.Position === "OL") links.push({ kind: "protect", star: qb });
  if (rb && p.Position === "OL") links.push({ kind: "lanes", star: rb });
  const room = at(stars, team, needKeysFor(p).map((k) => k.key))[0];
  const rusher = rushes(p) ? of(stars, team).find(rushStar) : null;
  if (rusher) links.push({ kind: "rush", star: rusher });
  else if (room) links.push({ kind: "pair", star: room });
  return links;
}

// A star's variables for a line: { star, starLast, room }.
export const starVars = (link, p) => ({ star: link.star.n, starLast: String(link.star.n).split(" ").filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(w)).pop() || "", room: roomWord(p) });
