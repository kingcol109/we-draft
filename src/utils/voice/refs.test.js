// How a player is introduced (user, 2026-11-25): "FSU running back Ousmane Kromah" etc.
import { nameFor, teamOf } from "./refs";

const teams = [
  { school: "Florida State", short: "FSU", mascot: "Seminoles" },
  { school: "Ohio State", short: "OSU", mascot: "Buckeyes" },
  { school: "Texas", short: "TEX", mascot: "Longhorns" },
];
const KROMAH = { First: "Ousmane", Last: "Kromah", Position: "RB", School: "Florida State" };
const ctxWith = (rolls, over = {}) => { let i = 0; return { vary: true, memory: {}, teams: async () => teams, random: () => rolls[i++ % rolls.length], ...over }; };

test("plain mode and follow-ups: just the name", async () => {
  expect(await nameFor(KROMAH, { teams: async () => teams })).toBe("Ousmane Kromah");
  expect(await nameFor(KROMAH, ctxWith([0.9], { same: true }))).toBe("Ousmane Kromah");
});
test("varying: about half the time just the name, else one of the team forms — never the same form twice in a row", async () => {
  expect(await nameFor(KROMAH, ctxWith([0.1]))).toBe("Ousmane Kromah");
  const ctx = ctxWith([0.9, 0]);
  const seen = [];
  for (let i = 0; i < 4; i += 1) seen.push(await nameFor(KROMAH, ctx)); // eslint-disable-line no-await-in-loop
  seen.forEach((s) => expect(["Florida State running back Ousmane Kromah", "FSU running back Ousmane Kromah", "Seminoles running back Ousmane Kromah"]).toContain(s));
  seen.slice(1).forEach((s, i) => expect(s).not.toBe(seen[i]));
});
test("short names: not the ones that mean several schools out loud", async () => {
  expect(await teamOf({ teams: async () => teams }, "Florida State")).toEqual({ short: "FSU", mascot: "Seminoles" });
  expect(await teamOf({ teams: async () => teams }, "Ohio State")).toEqual({ short: "", mascot: "Buckeyes" });
});
