// src/utils/voice/pronounce.js
//
// /voice: how names are SAID (user, 2026-11-25). An admin corrects a name
// the voice gets wrong ("Kromah" → "kroh-mah"); the correction is used every
// time an answer is spoken. The text on screen keeps the real spelling.
//
// map: { [key]: { word, say } } — key is the written word or name, plain and
// lowercase ("kromah", "ousmane kromah"). Longer keys win ("Ousmane Kromah"
// before "Kromah"). Pure.
import { plain } from "./text";

export const pronKey = (word) => plain(word);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The text, each corrected name swapped for how it's said (possessives kept: "Kromah's" → "kroh-mah's"). */
export function applyPronunciations(text, map) {
  const entries = Object.values(map || {}).filter((e) => e?.word && e?.say).sort((a, b) => b.word.length - a.word.length);
  if (!entries.length || !text) return text || "";
  let out = String(text);
  entries.forEach((e) => {
    // The written word, any case, with its letters' accents and punctuation as written.
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc(e.word)}(?=$|[^\\p{L}\\p{N}])`, "giu");
    out = out.replace(re, (m, pre) => `${pre}${e.say}`);
  });
  return out;
}

/**
 * What the admin said they meant to fix → { part: "first" | "last" | "full" | null, rest }
 * "his last name" → { part: "last", rest: "" }; "kromah's first name" → { part: "first", rest: "kromah" }
 */
export function nameTarget(said) {
  let t = plain(said).replace(/\b(?:the way you say|how you say|how you're saying|the pronunciation of|pronunciation of|pronunciation)\b/g, " ");
  let part = null;
  if (/\bfirst name\b/.test(t)) part = "first";
  else if (/\blast name\b/.test(t)) part = "last";
  else if (/\b(?:full )?name\b/.test(t)) part = "full";
  t = t.replace(/\b(?:his|her|their|the|that|first|last|full|name|names)\b/g, " ").replace(/\s+/g, " ").trim();
  return { part, rest: t };
}

/** A respelling as said / typed: "it's kroh mah" → "kroh mah"; "say it like crow-ma" → "crow-ma". */
export const respelling = (said) => String(said || "").trim()
  .replace(/^(?:it should sound like|it's pronounced|it sounds like|sounds like|say it like|more like|how about|pronounced|say it|it's|its|it is|like|say|try)\s+/i, "")
  .replace(/^["“']+|["”'.!]+$/g, "")
  .trim();
