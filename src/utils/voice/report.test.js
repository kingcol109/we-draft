// Dictating a scouting report by voice (user, 2026-11-26: "let user dictate a scouting report").
import { respond, newState } from "./engine";
import { bulletText, reportText } from "./intentsReport";

const people = [
  { id: "k", first: "Ousmane", last: "Kromah", pos: "RB", school: "Florida State", cls: "2028" },
  { id: "j", first: "Judah", last: "Milan", pos: "WR", school: "Georgia", cls: "2028" },
];
const docs = {
  k: { id: "k", First: "Ousmane", Last: "Kromah", Position: "RB", School: "Florida State", Eligible: "2028" },
  j: { id: "j", First: "Judah", Last: "Milan", Position: "WR", School: "Georgia", Eligible: "2028" },
};
function ctxOf(mine = {}) {
  const saved = [];
  return {
    saved, uid: "me",
    people: async () => people,
    cfbdPeople: async () => [],
    player: async (id) => docs[id] || null,
    myEval: async (id) => mine[id] || null,
    saveMyEval: async (d, next, extra) => { saved.push({ id: d.id, ...next, ...extra }); mine[d.id] = { ...next, ...extra }; },
    logMiss: () => {},
  };
}
async function talk(lines, ctx, st0 = newState()) {
  let st = st0;
  const outs = [];
  for (const l of lines) { const o = await respond(l, st, ctx); outs.push(o); st = o.state; }
  return { outs, last: outs[outs.length - 1], state: st };
}

test("start it, say three points, take one back, finish, confirm — saved as the page's bullets", async () => {
  const ctx = ctxOf();
  const { outs, last, state } = await talk([
    "I'm going to leave a scouting report for Judea Milan",
    "smooth route runner who sells vertical comma then breaks hard",
    "needs to get stronger at the catch point",
    "scratch that",
    "needs to play stronger at the catch point",
    "elite body control on back shoulder throws",
    "done",
  ], ctx);
  expect(outs[0].reply.intent).toBe("my.report");
  expect(outs[0].reply.speak).toBe("Go ahead. Say done when you're finished.");
  expect(outs[1].reply.speak).toBe("Got it.");
  expect(outs[3].reply.speak).toBe("Took that out.");
  expect(last.reply.speak).toBe("Save your report on Judah Milan? It's 3 points.");
  expect(state.pending.kind).toBe("confirm");
  expect(ctx.saved).toHaveLength(0); // nothing until the yes
  const yes = await respond("yes", state, ctx);
  expect(yes.reply.say).toMatch(/^Saved your scouting report on Judah Milan\. You don't have a grade on him yet\./);
  expect(ctx.saved[0].evaluation).toBe("• Smooth route runner who sells vertical, then breaks hard.\n• Needs to play stronger at the catch point.\n• Elite body control on back shoulder throws.");
  expect(ctx.saved[0].grade).toBe("");
});

test("an existing report: added to, keeping the grade — or rewritten when asked", async () => {
  const ctx = ctxOf({ k: { grade: "Second Round", strengths: ["Vision"], weaknesses: [], nflFit: "", evaluation: "• Patient runner." } });
  const st = (await talk(["who is ousmane kromah"], ctx)).state;
  const add = await talk(["dictate a scouting report", "runs through arm tackles", "done", "yes"], ctx, st);
  expect(add.outs[0].reply.say).toMatch(/^I'll add to the report you have on Ousmane Kromah\./);
  expect(ctx.saved[0]).toMatchObject({ grade: "Second Round", strengths: ["Vision"], evaluation: "• Patient runner.\n• Runs through arm tackles." });
  const redo = await talk(["rewrite my scouting report for kromah", "one cut runner", "done", "yes"], ctx);
  expect(redo.outs[0].reply.say).toMatch(/^This replaces the report you have on Ousmane Kromah\./);
  expect(ctx.saved[1].evaluation).toBe("• One cut runner.");
});

test("while dictating, nothing is taken as a question; read it back, start over, cancel", async () => {
  const ctx = ctxOf();
  const { outs, state } = await talk(["write a scouting report on kromah", "how many rushing yards does he have is not the issue", "read it back", "start over", "cancel"], ctx);
  expect(outs[1].reply.speak).toBe("Got it.");
  expect(outs[2].reply.speak).toBe("How many rushing yards does he have is not the issue. Keep going, or say done.");
  expect(outs[3].reply.body).toBe("(nothing yet)");
  expect(outs[4].reply.say).toBe("Okay, I didn't save the report on Ousmane Kromah.");
  expect(state.pending).toBeNull();
  expect(ctx.saved).toHaveLength(0);
});

test("\"done\" with nothing said saves nothing; a slur isn't kept", async () => {
  const ctx = ctxOf();
  expect((await talk(["leave a report on kromah", "done"], ctx)).last.reply.say).toMatch(/^You didn't add anything/);
  const bad = await talk(["leave a report on kromah", "plays like a fuck"], ctx);
  expect(bad.last.reply.say).toBe("I can't save that line. Say it another way.");
  expect(bad.state.pending.lines).toHaveLength(0);
});

test("signed out: sign in first", async () => {
  const ctx = { ...ctxOf(), uid: null };
  expect((await talk(["dictate a scouting report on kromah"], ctx)).last.reply.say).toBe("Sign in first. That's your own evaluation.");
});

test("spoken punctuation, capitals, end marks", () => {
  expect(bulletText("new bullet great feet period")).toBe("Great feet.");
  expect(bulletText("is he a three down back question mark")).toBe("Is he a three down back?");
  expect(reportText("", ["A.", "B."], "replace")).toBe("• A.\n• B.");
});
