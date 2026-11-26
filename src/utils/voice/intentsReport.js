// src/utils/voice/intentsReport.js
//
// /voice: dictate a scouting report (user, 2026-11-26 — "let user dictate a scouting report";
// the log had "I'm going to leave a scouting report for Judea Milan").
//
//   "I'm going to leave a scouting report for Kromah" / "dictate a scouting report on him"
//     → "Go ahead. Say done when you're finished."
//   each thing said after that → one bullet ("• Patient runner with real burst.") — the
//     player page's own write-up style, so it shows and edits the same there
//   "scratch that" drops the last one · "read it back" · "start over" · "cancel"
//   "done" → "Save your report on Ousmane Kromah? 3 points." → yes saves it to YOUR evaluation
//     (both copies, the page's way: ctx.saveMyEval with { evaluation }).
// An evaluation that already has a write-up gets the new points added after it, unless the
// person said "new" / "rewrite" / "start over". Nothing is saved until the yes.
import { WHO, nameOf, card, miss, loaded, plural } from "./reply";
import { plain } from "./text";

const BANNED = ["faggot", "nigger", "monkey", "nigga", "fuck"]; // the player page's list
const MAX_CHARS = 4000;
const REPORT = "(?:scouting report|report|evaluation|eval|write up|writeup|breakdown)";

const DONE = /^(?:done|i'm done|im done|i am done|all done|that's it|thats it|that's all|thats all|that is all|finish|finished|finish it|end|end report|end the report|stop dictating|save|save it|save that|save the report|wrap it up|that'll do|that will do)$/;
const UNDO = /^(?:scratch that|undo|undo that|delete that|remove that|take that out|strike that|delete the last (?:line|one|bullet|point|sentence)|remove the last (?:line|one|bullet|point|sentence)|take out the last (?:line|one|bullet|point))$/;
const READ = /^(?:read it back|read that back|read it|read back|read me what i have|read what i have|what do i have|what do i have so far|where was i|what have i got)$/;
const RESTART = /^(?:start over|clear it|start again|from the top|erase it|wipe it|clear the report|erase all of it)$/;
const CANCEL = /^(?:cancel|never mind|nevermind|forget it|quit|discard it|throw it out|don't save it|do not save it|stop)$/;

const ACKS = ["Got it.", "Okay.", "Next.", "Go on.", "Got that."];

/** One dictated line → a bullet's text: spoken punctuation, a capital, an end mark. "" when empty. */
export function bulletText(said) {
  let t = String(said || "").trim()
    .replace(/\s+(?:comma)\b/gi, ",")
    .replace(/\s+(?:period|full stop)\b/gi, ".")
    .replace(/\s+question mark\b/gi, "?")
    .replace(/\s+exclamation (?:point|mark)\b/gi, "!")
    .replace(/^(?:new (?:bullet|point|line)|next (?:bullet|point)|bullet(?: point)?|point)[,:]?\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  t = `${t[0].toUpperCase()}${t.slice(1)}`;
  return /[.!?]$/.test(t) ? t : `${t}.`;
}
/** The write-up that would be saved: the old one (when adding) and the new bullets. */
export function reportText(prev, lines, mode) {
  const bullets = lines.map((l) => `• ${l}`).join("\n");
  const old = String(prev || "").trim();
  return mode === "add" && old ? `${old}\n${bullets}` : bullets;
}

const view = (p, extra = {}) => {
  const text = reportText(p.prev, p.lines, p.mode);
  return {
    title: `Scouting report: ${p.name}`,
    sub: `${plural(p.lines.length, "point")} dictated${p.mode === "add" && p.prev ? " · adding to your report" : ""} · say "done" to save`,
    body: text || "(nothing yet)",
    tips: ["done", "scratch that", "read it back", "start over", "cancel"],
    noRecord: true,
    tone: "ask",
    ...extra,
  };
};

/** A line said while dictating → { reply, state }. */
export async function dictateStep(text, state, ctx) {
  const p = state.pending;
  const t = plain(String(text || "").replace(/[.!?,]+$/, ""));
  const keep = (reply, pending = p) => ({ reply, state: { ...state, pending } });
  if (CANCEL.test(t)) return keep({ say: `Okay, I didn't save the report on ${p.name}.`, tone: "answer", noRecord: true }, null);
  if (RESTART.test(t)) return keep(view({ ...p, lines: [], mode: "replace" }, { say: "Cleared. Go ahead from the top.", speak: "Cleared. Go ahead." }), { ...p, lines: [], mode: "replace" });
  if (UNDO.test(t)) {
    if (!p.lines.length) return keep(view(p, { say: "There's nothing to take out yet." }));
    const lines = p.lines.slice(0, -1);
    return keep(view({ ...p, lines }, { say: `Took out "${p.lines[p.lines.length - 1]}"`, speak: "Took that out." }), { ...p, lines });
  }
  if (READ.test(t)) {
    if (!p.lines.length) return keep(view(p, { say: "Nothing yet. Go ahead." }));
    return keep(view(p, { say: `Here's what you have. ${p.lines.join(" ")}`, speak: `${p.lines.join(" ")} Keep going, or say done.` }));
  }
  if (DONE.test(t)) {
    if (!p.lines.length) return keep({ say: `You didn't add anything, so I left your report on ${p.name} as it was.`, tone: "answer", noRecord: true }, null);
    const d = await loaded({ id: p.playerId }, ctx);
    if (!d) return keep(miss(`I couldn't load ${p.name} to save it.`), null);
    const final = reportText(p.prev, p.lines, p.mode);
    const items = [{ label: "Scouting report", from: String(p.prev || ""), to: final }];
    const change = { scope: "Your evaluation", items, isNew: !p.hadEval };
    const apply = async () => {
      const prev = await ctx.myEval(d.id);
      await ctx.saveMyEval(d, { grade: prev?.grade || "", strengths: prev?.strengths || [], weaknesses: prev?.weaknesses || [], nflFit: prev?.nflFit || "" }, { evaluation: final });
      const noGrade = !prev?.grade;
      return {
        say: `Saved your scouting report on ${p.name}.${noGrade ? ` You don't have a grade on him yet. Say "give him a second round grade", or whatever you have him at.` : ""}`,
        speak: `Saved your report on ${p.name}.${noGrade ? " You don't have a grade on him yet." : ""}`,
        ...card(d, { sub: "your scouting report" }), body: final, change: { ...change, saved: true }, tone: "done",
      };
    };
    const n = plural(p.lines.length, "point");
    return {
      reply: {
        say: `Save your scouting report on ${p.name}? ${p.mode === "add" && p.prev ? `That adds ${n} to what you had.` : `It's ${n}.`}`,
        speak: `Save your report on ${p.name}? ${p.mode === "add" && p.prev ? `That adds ${n}.` : `It's ${n}.`}`,
        ...card(d, { sub: "your scouting report" }), body: final, change, tone: "ask", confirm: true,
      },
      state: { ...state, pending: { kind: "confirm", apply } },
    };
  }
  // Content: one bullet.
  const line = bulletText(text);
  if (!line) return keep(view(p, { say: "Go ahead." }));
  if (BANNED.some((w) => line.toLowerCase().includes(w))) return keep(view(p, { say: "I can't save that line. Say it another way." }));
  const lines = [...p.lines, line];
  if (reportText(p.prev, lines, p.mode).length > MAX_CHARS) return keep(view(p, { say: `That's as long as a report can be. Say "done" to save it.` }));
  const next = { ...p, lines };
  const ack = ACKS[(lines.length - 1) % ACKS.length];
  return keep(view(next, { say: ack, speak: ack }), next);
}

export const REPORT_INTENTS = [
  {
    id: "my.report",
    mode: "general",
    signIn: true,
    title: "Dictate a scouting report",
    examples: ["I'm going to leave a scouting report for Kromah", "dictate a scouting report on Kromah", "add to my scouting report on him", "rewrite my scouting report for Kromah"],
    patterns: [
      // "I'm going to leave / I want to write / let me dictate a (new) scouting report for X"
      new RegExp(`^(?:(?:i'm|im|i am) (?:going to|gonna|about to)|i want to|i'd like to|let me|i need to|i wanna|can i|time to)? ?(?<verb>leave|write|dictate|record|do|give|start|make|put together|draft|add|rewrite|redo) (?:you )?(?:a |an |my |the )?(?<fresh>new |fresh )?${REPORT} (?:for|on|about|of) ${WHO}$`),
      new RegExp(`^(?:start|begin|open|new) (?:a |an |my )?(?:new )?${REPORT} (?:for|on|about) ${WHO}$`),
      new RegExp(`^(?<verb>add|append) (?:to|onto) my ${REPORT} (?:for|on|about|of) ${WHO}$`),
      new RegExp(`^(?<verb>rewrite|redo|replace) my ${REPORT} (?:for|on|about|of) ${WHO}$`),
      // About him: "dictate a scouting report", "let me leave a report on him"
      new RegExp(`^(?:(?:i'm|im|i am) (?:going to|gonna)|i want to|let me|i'd like to)? ?(?<verb>leave|write|dictate|record|start|add|rewrite) (?:a |an |my |the )?(?<fresh>new )?${REPORT}$`),
    ],
    fixed: [{}, {}, {}, {}, { who: "his" }],
    run: async ({ player, verb = "", fresh }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const prevEval = await ctx.myEval(d.id);
      const prev = String(prevEval?.evaluation || "").trim();
      const mode = fresh || /^(?:rewrite|redo|replace)$/.test(verb) || !prev ? "replace" : "add";
      const name = nameOf(d);
      const pending = { kind: "dictate", playerId: d.id, name, prev, mode, lines: [], hadEval: !!prevEval };
      const how = mode === "add" ? `I'll add to the report you have on ${name}.` : prev ? `This replaces the report you have on ${name}.` : `A scouting report on ${name}.`;
      return {
        say: `${how} Go ahead, one point at a time. Say "done" when you're finished, "scratch that" to take the last one out, or "read it back".`,
        speak: `Go ahead. Say done when you're finished.`,
        ...card(d, { sub: "dictating a scouting report" }),
        body: reportText(prev, [], mode) || "(nothing yet)",
        tips: ["done", "scratch that", "read it back", "start over", "cancel"],
        pending, tone: "ask", noRecord: true,
      };
    },
  },
];
