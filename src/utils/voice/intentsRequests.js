// src/utils/voice/intentsRequests.js
//
// /voice (user, 2026-11-25):
//   - "admin note …" (admin): the words go to the admin's to-review bucket
//     (adminNotes). "voice note …" (admin): to voiceNotes, for the voice
//     itself. Both list under Review on /voice.
//   - "request John Doe from Florida State" (anyone, signed in): asks
//     We-Draft.com to add a player — a playerRequests doc, as Profile →
//     Request a Player sends. On /voice/admin the same words ("add John Doe
//     from Florida State") add him from his CFBD roster row instead.
//   - "suggestion: …" (anyone, signed in): a suggestion to We-Draft.com —
//     userReports, as Profile → Report an Issue sends.
// Requests, adds and suggestions ask first; notes save right away (like "mark").
import { miss, nameOf } from "./reply";
import { parseWho, findOnCfbd, onWeDraft, offerFor } from "./requests";
import { phrase } from "./phrase";

// The note's words as said or typed (its case and punctuation), after "admin note" / "voice note".
const noteWords = (text, kind) => String(text || "").replace(new RegExp(`^.*?\\b${kind}\\s+note\\b[\\s:,.-]*`, "i"), "").trim();

const noteIntent = (kind, title) => ({
  id: `${kind}.note`,
  mode: "admin",
  title,
  examples: [`${kind} note check the 2027 tight end rankings`],
  patterns: [new RegExp(`^(?:(?:add|new|take|make|leave|save) (?:an? )?)?${kind} note(?: (?:that|saying|to))? (?<words>.+)$`)],
  run: async ({ words }, ctx, text, state) => {
    const said = noteWords(text, kind) || words;
    if (!said) return miss(`What's the ${kind} note? Say "${kind} note" and then the note.`);
    await ctx.addNote(kind, { text: said, said: String(text || "").trim(), player: state?.last?.id || null, mode: state?.mode || null });
    return { say: phrase(ctx, "note.saved", { kind: kind === "admin" ? "Admin" : "Voice" }), title: `${kind === "admin" ? "Admin" : "Voice"} note`, body: said, tone: "done", noRecord: true };
  },
});

export const REQUEST_INTENTS = [
  noteIntent("admin", "Admin note (to review later)"),
  noteIntent("voice", "Voice note (for the voice itself)"),
  {
    // A CFBD-only player never gets here: the engine answers with the offer
    // to request / add him (intents.js WE_DRAFT_ONLY "status").
    id: "player.onWeDraft",
    mode: "general",
    title: "Is a player on We-Draft.com?",
    examples: ["is John Doe on We-Draft", "does We-Draft have Ousmane Kromah"],
    patterns: [
      /^(?:is|are) (?<who>.+?) (?:on|in) (?:we draft|wedraft)(?: yet| already| now)?$/,
      /^(?:does|do) (?:we draft|wedraft) (?:have|list|cover) (?<who>.+?)(?: yet| already)?$/,
      /^(?:is|are) (?<who>.+?) (?:a we draft player|on the we draft board|on the board)(?: yet)?$/,
    ],
    run: async ({ player }, ctx) => {
      const d = await ctx.player(player.id);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      return { say: `Yes. ${nameOf(d)} is on We-Draft.com: ${[d.School, d.Position, d.Eligible && `${d.Eligible} class`].filter(Boolean).join(", ")}.`, title: nameOf(d), sub: [d.Position, d.School, d.Eligible].filter(Boolean).join(" · "), player: d, tone: "answer" };
    },
  },
  {
    id: "request.player",
    mode: "general",
    title: "Ask We-Draft.com to add a player",
    examples: ["request John Doe from Florida State", "ask We-Draft to add Florida State's John Doe", "add John Doe from Florida State to We-Draft"],
    patterns: [
      /^(?:request|ask (?:we draft|wedraft) to add|can (?:we draft|wedraft) add|can you (?:ask (?:we draft|wedraft) to )?add|please add|add) (?:a player )?(?:named |called )?(?<name>.+?)(?: (?:to|on|onto) (?:we draft|wedraft|the site|the website|the board))?$/,
    ],
    // Not the other "add …" commands: your watchlist / board, a note, a grade.
    // (The slot is "name", not "who": he isn't on We-Draft.com, so the engine mustn't look him up.)
    accept: (s) => !/\b(?:watch ?list|my board|to my|note|strengths?|weakness(?:es)?|grade|him|them|his|her)\b/.test(s.name || ""),
    run: async ({ name: said }, ctx, text, state) => {
      const admin = state?.mode === "admin";
      if (!admin && !ctx.uid) return miss("Sign in first, and I can send the request from your account.");
      const who = await parseWho(said, ctx);
      if (!who.name) return miss("Which player? Say his name and school, like \"request John Doe from Florida State\".");
      const there = await onWeDraft(who, ctx);
      if (there) return { say: `${nameOf(there)} is already on We-Draft.com.`, title: nameOf(there), sub: [there.pos, there.school].filter(Boolean).join(" · "), focus: there, tone: "answer" };
      const hit = await findOnCfbd(who, ctx, { anySchool: admin });
      if (hit?.choices) return { say: `More than one player on CFBD fits "${said}". Say his school too.`, rows: hit.choices.slice(0, 6).map((r) => [`${r.first} ${r.last}`, [r.pos, r.school].filter(Boolean).join(" · ")]), tone: "ask" };
      return offerFor(who, hit, ctx, admin ? "admin" : "general", { recruitYear: who.recruitYear });
    },
  },
  {
    id: "feedback.suggest",
    mode: "general",
    title: "Send We-Draft.com a suggestion",
    examples: ["suggestion: add a stats tab to the team page", "send a suggestion the mock draft should show trades"],
    patterns: [
      /^(?:i have a |i've got a |ive got a |here's a |heres a |send (?:a |this )?|submit (?:a |this )?|make a |leave a )?(?:suggestion|feedback)(?: for (?:we draft|wedraft|the site|you))?(?: (?:that|is|saying))? (?<words>.+)$/,
    ],
    signIn: true,
    run: async ({ words }, ctx, text) => {
      const said = String(text || "").replace(/^.*?\b(?:suggestion|feedback)\b(?:\s+for\s+(?:we[\s-]?draft(?:\.com)?|the site|you))?(?:\s+(?:that|is|saying))?[\s:,.-]*/i, "").trim() || words;
      return {
        confirm: {
          say: `Send this suggestion to We-Draft.com? "${said}"`,
          title: "Suggestion", body: said,
          apply: async () => {
            await ctx.sendSuggestion(said);
            return { say: phrase(ctx, "suggestion.sent"), title: "Suggestion sent", tone: "done" };
          },
        },
      };
    },
  },
];
