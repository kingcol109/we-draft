// Admin: "mark that" and fixing how names are said (user, 2026-11-25).
import { respond, newState } from "./engine";
import { applyPronunciations, nameTarget, respelling, pronKey } from "./pronounce";

const people = [
  { id: "k", first: "Ousmane", last: "Kromah", pos: "RB", school: "Florida State", cls: "2028" },
  { id: "s", first: "Jaron-Keawe", last: "Sagapolutele", pos: "QB", school: "California", cls: "2028" },
];
function makeCtx() {
  const marks = [];
  const saved = [];
  const pron = {};
  return {
    marks, saved, uid: "me",
    people: async () => people,
    player: async (id) => { const p = people.find((x) => x.id === id); return { id, First: p.first, Last: p.last, Position: p.pos, School: p.school, Eligible: p.cls }; },
    markAnswer: async (e) => { marks.push(e); },
    pronMap: () => pron,
    savePronunciation: async (e) => { saved.push(e); pron[pronKey(e.word)] = e; },
    logMiss: () => {},
  };
}
const admin = () => newState("admin");

describe("mark that", () => {
  test("saves the last question and answer, with a note", async () => {
    const ctx = makeCtx();
    let out = await respond("what position does kromah play", admin(), ctx);
    out = await respond("mark that, too long", out.state, ctx);
    expect(out.reply.say).toBe("Marked, with your note: too long.");
    expect(ctx.marks[0]).toMatchObject({ said: "what position does kromah play", say: "Ousmane Kromah: RB.", intent: "player.field", player: "k", note: "too long", mode: "admin" });
    // Marking isn't itself the "last answer": marking again marks the same one.
    out = await respond("mark that", out.state, ctx);
    expect(ctx.marks[1]).toMatchObject({ said: "what position does kromah play", note: "" });
  });
  test("an answer it couldn't give can be marked too", async () => {
    const ctx = makeCtx();
    const out = await respond("what's the weather", admin(), ctx);
    expect((await respond("mark that answer", out.state, ctx)).reply.say).toBe("Marked.");
    expect(ctx.marks[0].said).toBe("what's the weather");
  });
  test("admin only; nothing to mark yet", async () => {
    expect((await respond("mark that", newState("general"), makeCtx())).reply.say).toMatch(/admin command/);
    expect((await respond("mark that", admin(), makeCtx())).reply.say).toBe("There's no answer to mark yet.");
  });
  test("'note that …' is still a game note, not a mark", async () => {
    const out = await respond("note that kromah had a great game", admin(), { ...makeCtx(), myEval: async () => null, schoolGames: async () => [] });
    expect(out.reply.say).not.toMatch(/^Marked/);
  });
});

describe("fixing how a name is said", () => {
  test("the words", () => {
    expect(nameTarget("his last name")).toEqual({ part: "last", rest: "" });
    expect(nameTarget("kromah's first name")).toEqual({ part: "first", rest: "kromah" });
    expect(respelling("it's kroh-mah")).toBe("kroh-mah");
    expect(respelling("say it like Crow Ma.")).toBe("Crow Ma");
  });
  test("spoken with the corrections (longest first, possessives kept, screen text untouched)", () => {
    const map = { kromah: { word: "Kromah", say: "kroh-mah" }, "ousmane kromah": { word: "Ousmane Kromah", say: "oo-smahn kroh-mah" } };
    expect(applyPronunciations("Ousmane Kromah ran for 609 yards.", map)).toBe("oo-smahn kroh-mah ran for 609 yards.");
    expect(applyPronunciations("That's Kromah's best game.", map)).toBe("That's kroh-mah's best game.");
    expect(applyPronunciations("Kromahs", map)).toBe("Kromahs"); // a different word
  });
  test("you're saying Kromah wrong → say it → hear it back → lock it", async () => {
    const ctx = makeCtx();
    let out = await respond("you're saying chroma wrong", admin(), ctx);
    expect(out.reply.say).toMatch(/^Right now I say it like this: Kromah\. How should Kromah sound\?/);
    expect(out.reply.speak).toBe("Right now I say it like this: Kromah. How should it sound?");
    out = await respond("crow ma", out.state, ctx);
    expect(out.reply.say).toBe("Kromah → \"crow ma\". Lock it, or say it another way.");
    expect(out.reply.speak).toBe("Ousmane crow ma. Lock it, or say it another way.");
    out = await respond("no", out.state, ctx);
    expect(out.reply.say).toBe("Okay. How should Kromah sound?");
    out = await respond("kroh-mah", out.state, ctx);
    out = await respond("say it again", out.state, ctx);
    expect(out.reply.speak).toBe("Ousmane kroh-mah. Lock it, or say it another way.");
    out = await respond("lock it", out.state, ctx);
    expect(out.reply.say).toBe("Locked. I'll say Kromah as \"kroh-mah\" from now on.");
    expect(ctx.saved).toEqual([{ word: "Kromah", say: "kroh-mah", playerId: "k" }]);
    expect(out.state.pending).toBeNull();
  });
  test("his last name / the full name / a word that isn't a player; cancel", async () => {
    const ctx = makeCtx();
    const st = (await respond("tell me about sagapolutele", admin(), { ...ctx, seasons: async () => null, ranks: async () => null })).state;
    let out = await respond("fix how you say his last name", st, ctx);
    expect(out.state.pending).toMatchObject({ word: "Sagapolutele", full: "Jaron-Keawe Sagapolutele" });
    out = await respond("how do you say Ousmane Kromah", admin(), ctx);
    expect(out.state.pending).toMatchObject({ word: "Ousmane Kromah" });
    out = await respond("you're saying Gardner Webb wrong", admin(), ctx);
    expect(out.state.pending).toMatchObject({ word: "Gardner Webb", playerId: null });
    out = await respond("never mind", out.state, ctx);
    expect(out.reply.say).toBe("Okay, I left Gardner Webb as it was.");
    expect(ctx.saved).toEqual([]);
  });
});
