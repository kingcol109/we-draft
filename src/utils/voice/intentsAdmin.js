// src/utils/voice/intentsAdmin.js
//
// /voice/admin, about the voice itself (user, 2026-11-25):
//   - "mark that": the last answer is saved to fix later (voiceMarks), with
//     an optional note ("mark that, too long"). Review → Marked lists them.
//   - pronunciation: "you're saying Kromah wrong" / "how do you say his last
//     name" → it says the name the current way and asks how it should sound;
//     say it (or type it as it sounds: "kroh-mah"), it reads it back that
//     way, and "lock it" saves it (voicePronunciations) — every spoken answer
//     uses it from then on. The steps after the first are the engine's
//     "pronounce" pending (engine.js pronounceStep).
import { miss } from "./reply";
import { findPlayer, nameScore } from "./names";
import { nameTarget, pronKey } from "./pronounce";

const HIM = /^(?:he|him|his|it|that|this guy|that guy)$/;

export const ADMIN_VOICE_INTENTS = [
  {
    id: "voice.mark",
    mode: "admin",
    title: "Mark an answer to fix later",
    examples: ["mark that", "mark that, too long"],
    patterns: [/^mark (?:the last answer|that answer|this answer|the answer|that one|that|this|it)(?: (?:as |because |note |with a note |saying |for |it's |its |it was |was )?(?<note>.+))?$/],
    run: async ({ note }, ctx, text, state) => {
      const a = state?.lastAnswer;
      if (!a) return miss("There's no answer to mark yet.");
      await ctx.markAnswer({ said: a.said, say: a.say, intent: a.intent || null, player: a.player || null, note: note || "", mode: state.mode });
      return { say: note ? `Marked, with your note: ${note}.` : "Marked.", tone: "done", noRecord: true };
    },
  },
  {
    id: "voice.pronounce",
    mode: "admin",
    title: "Fix how a name is said",
    examples: ["you're saying Kromah wrong", "how do you say Kromah", "fix how you say his last name"],
    patterns: [
      /^(?:how do you|how should you|how would you|how do i) (?:say|pronounce) (?<target>.+)$/,
      /^(?:fix|correct|change|update|set|redo) (?:the )?(?:pronunciation|how you say|how you pronounce|the way you say|way you say|how you're saying) (?:of |for )?(?<target>.+)$/,
      /^(?:you're|youre|you are) (?:saying|pronouncing|mispronouncing|butchering) (?<target>.+?)(?: wrong| incorrectly| wrongly)?$/,
      /^(?:that's|thats|that is) not how you (?:say|pronounce) (?<target>.+)$/,
      /^(?<target>.+?) (?:is|was) (?:mispronounced|pronounced wrong|said wrong)$/,
      /^(?:pronounce|pronunciation (?:of|for)) (?<target>.+)$/,
    ],
    run: async ({ target }, ctx, text, state) => {
      const { part, rest } = nameTarget(target);
      let player = null;
      if (!rest || HIM.test(rest)) player = state?.last || null;
      else {
        const f = findPlayer(rest, await ctx.people(), state?.aliases || {});
        player = f.player || null;
        if (!player && f.choices) return miss(`More than one player fits "${rest}". Say his school first, like "Florida State's Ousmane Kromah".`);
      }
      let word;
      let full;
      let which = part || "full";
      if (player) {
        const first = player.first || player.First || "";
        const last = player.last || player.Last || "";
        full = `${first} ${last}`.trim();
        // One word said: the part of his name it is.
        if (!part && rest && rest.split(" ").length === 1) which = nameScore(rest, { first: "~", last }) >= nameScore(rest, { first: "~", last: first }) ? "last" : "first";
        word = which === "first" ? first : which === "last" ? last : full;
      } else if (rest) {
        // Not a player: the words themselves (a school, a coach…).
        word = String(target).trim().replace(/\b\w/g, (c) => c.toUpperCase());
        full = word;
      } else return miss("Whose name? Say it, like \"you're saying Kromah wrong\".");
      const cur = ctx.pronMap?.()[pronKey(word)];
      return {
        say: `${cur ? `Right now I say it "${cur.say}".` : `Right now I say it like this: ${word}.`} How should ${word} sound? Say it, or type it the way it sounds, like "kroh-mah".`,
        speak: `Right now I say it like this: ${word}. How should it sound?`,
        title: `Pronounce: ${word}`, sub: cur ? `now said "${cur.say}"` : "the voice's own reading",
        tone: "ask", noRecord: true,
        pending: { kind: "pronounce", word, full, playerId: player?.id || null, candidate: null },
      };
    },
  },
];

