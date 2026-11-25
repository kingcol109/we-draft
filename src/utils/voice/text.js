// src/utils/voice/text.js
//
// /voice: turning what was said (or typed) into clean words, numbers and
// measurements. Speech engines write numbers both ways ("225", "two twenty
// five", "two hundred twenty-five"), so every value goes through here.
// Pure.

// Lowercase, apostrophes kept (possessives: "kromah's"), the rest spaced out.
export const clean = (s) => String(s || "")
  .toLowerCase()
  .normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[’‘`]/g, "'")
  .replace(/(\d)\s*(?:''|")/g, "$1 inches")
  .replace(/(\d)\s*'\s*(?=\d)/g, "$1 foot ")
  .replace(/(\d)\s*'(?!\w)/g, "$1 foot")
  .replace(/[^a-z0-9'. ]/g, " ")
  .replace(/\.(?!\d)/g, " ")
  .replace(/\s+/g, " ")
  .trim();

// A name's plain letters (no apostrophes / punctuation).
export const plain = (s) => clean(s).replace(/'s\b/g, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

const ONES = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/**
 * The number words say, as a number — or null.
 * "225", "two twenty five", "two hundred twenty five", "two-twenty", "4.45"
 */
export function parseNumber(s) {
  const t = clean(s).replace(/-/g, " ").replace(/\band\b/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const words = t.split(" ");
  // Chunks: each "one"…"ninety-nine" (or digits) — "two twenty five" = [2, 25].
  const chunks = [];
  let hundreds = null;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (/^\d+(\.\d+)?$/.test(w)) { chunks.push(Number(w)); continue; }
    if (w === "hundred") {
      if (!chunks.length) return null;
      hundreds = (hundreds || 0) + chunks.pop() * 100;
      continue;
    }
    if (w === "point") {
      const rest = words.slice(i + 1).map((x) => (ONES[x] != null && ONES[x] < 10 ? String(ONES[x]) : /^\d$/.test(x) ? x : null));
      if (!rest.length || rest.includes(null)) return null;
      const whole = (hundreds || 0) + (chunks.length ? chunks.pop() : 0);
      return Number(`${whole}.${rest.join("")}`);
    }
    if (TENS[w] != null) {
      const n = ONES[words[i + 1]];
      if (n != null && n > 0 && n < 10) { chunks.push(TENS[w] + n); i += 1; } else chunks.push(TENS[w]);
      continue;
    }
    if (ONES[w] != null) { chunks.push(ONES[w]); continue; }
    return null;
  }
  if (hundreds != null) return hundreds + chunks.reduce((a, b) => a + b, 0);
  if (!chunks.length) return null;
  if (chunks.length === 1) return chunks[0];
  // "two twenty five" → 2|25 → 225; "six one" stays for heights (parseHeight).
  if (chunks.length === 2 && chunks[0] < 10 && chunks[1] >= 10 && chunks[1] < 100) return chunks[0] * 100 + chunks[1];
  return null;
}

/**
 * A height → { feet, inches, text: `6'1"` } or null.
 * "six one", "6 foot 1", "six foot one and a half", "6'1", "73 inches"
 */
export function parseHeight(s) {
  let t = clean(s).replace(/-/g, " ").replace(/\b(feet|ft)\b/g, "foot").replace(/\b(inch|in)\b/g, "inches").trim();
  let half = 0;
  if (/\band a half\b|\band one half\b/.test(t)) { half = 0.5; t = t.replace(/\band (a|one) half\b/, "").trim(); }
  const allInches = t.match(/^(.+?) inches$/);
  if (allInches && !/foot/.test(t)) {
    const n = parseNumber(allInches[1]);
    if (n == null || n < 48 || n > 96) return null;
    return heightOf(Math.floor(n / 12), (n % 12) + half);
  }
  t = t.replace(/ inches$/, "");
  let feet;
  let inches;
  const parts = t.split(/ foot ?/);
  if (parts.length === 2) {
    feet = parseNumber(parts[0]);
    inches = parts[1] ? parseNumber(parts[1]) : 0;
  } else {
    const w = t.split(" ");
    if (w.length !== 2) return null;
    feet = parseNumber(w[0]);
    inches = parseNumber(w[1]);
  }
  if (feet == null || inches == null || feet < 4 || feet > 7 || inches < 0 || inches >= 12) return null;
  return heightOf(feet, inches + half);
}
function heightOf(feet, inches) {
  const whole = Math.floor(inches);
  const frac = inches - whole === 0.5 ? " 1/2" : "";
  return { feet, inches, text: `${feet}'${whole}${frac}"` };
}

// Saying a stored height aloud: 6'1" → "six one"-ish "6 foot 1".
export const sayHeight = (h) => {
  const m = String(h || "").match(/^(\d)'(\d+)(?: (\d\/\d))?"?$/);
  return m ? `${m[1]} foot ${m[2]}${m[3] === "1/2" ? " and a half" : ""}` : String(h || "");
};
