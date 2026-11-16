import { buildBoard, initSim, makePick, teamHaul, resolveNeeds, stepCpu } from "./engine";
import { gradeTake } from "./analysts";
const POS = ["QB", "WR", "EDGE", "OL", "DB", "RB", "LB", "DL", "TE"];
const deepBoard = buildBoard(Array.from({ length: 700 }, (_, i) => ({ id: `b${i}`, First: "F", Last: `B${i}`, Position: POS[i % POS.length], School: "S", Slug: `b${i}`, cr: i + 1 })));
const draftAs = (picks, ids, needs = {}) => { let st = initSim({ order: picks.map(([Pick, Round]) => ({ Pick, Round, Team: "AAA" })), board: deepBoard, needs: { AAA: resolveNeeds(needs) }, rounds: 7 }); ids.forEach((id) => { st = makePick(st, id).state; }); return teamHaul(st, "AAA"); };
const ctx = { teamName: (t) => t, nickname: (t) => t, rand: () => 0.1 };
test("cal", () => {
  const needs = { QB: { labels: ["Upgrade Needed"] }, CB: { labels: ["Upgrade Needed"] } };
  const show = (n, h) => console.log(n, h.letter, h.score.toFixed(2), "value", h.value.toFixed(2), "needs", h.needs.score.toFixed(2), "|", gradeTake(h, ctx)?.text);
  show("steals no needs", draftAs([[20, 1], [52, 2], [84, 3]], ["b1", "b10", "b19"], needs));
  show("needs met fair", draftAs([[20, 1], [52, 2], [84, 3]], ["b18", "b49", "b82"], needs));
  show("one joke r1", draftAs([[5, 1], [37, 2], [69, 3], [101, 4], [133, 5], [165, 6], [197, 7]], ["b600", "b36", "b68", "b100", "b132", "b164", "b196"]));
  // A whole CPU draft: 32 teams x 7 rounds on the deep board, needs random-ish.
  const teams = Array.from({ length: 32 }, (_, i) => `T${i}`);
  const order = [1,2,3,4,5,6,7].flatMap((r) => teams.map((t, i) => ({ Pick: (r - 1) * 32 + i + 1, Round: r, Team: t })));
  const keys = ["QB","WR","EDGE","OT","CB","RB","LB","IDL","TE","S","IOL"];
  const n = Object.fromEntries(teams.map((t, i) => [t, resolveNeeds({ [keys[i % 11]]: { labels: ["Upgrade Needed"] }, [keys[(i * 3 + 1) % 11]]: { labels: ["Upgrade Wanted"] }, [keys[(i * 5 + 2) % 11]]: { labels: ["Aging Talent"] } })]));
  let s = initSim({ order, board: deepBoard, needs: n, rounds: 7, seed: 5 });
  while (!s.done) s = stepCpu(s).state;
  const letters = teams.map((t) => teamHaul(s, t).letter);
  const c = {}; letters.forEach((l) => { c[l] = (c[l] || 0) + 1; });
  console.log("CPU league", JSON.stringify(c));
});
