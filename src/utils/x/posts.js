// src/utils/x/posts.js
//
// X (Twitter) posts — what a post may be, with no Firebase and no DOM, so the
// composer (components/AdminX.jsx) and the future publisher (server/x/README.md)
// hold posts to the same rules. Nothing here talks to X.
//
// A post, as stored in xPosts/{id} (utils/x/store.js):
//   name, text, status ("draft" | "scheduled" | "posted"), scheduledAt (ms),
//   postedAt, media: [{ id, kind ("card" | "upload" | "instagram" | "link"),
//   url (a link's), alt, w, h }], card (the player card's settings), thumb,
//   playerIds, subject, linkedTo: [{ platform, id, label }].
//   Reserved for the publisher: the `x` field, statuses publishing / published
//   / failed.

export const X_LIMIT = 280;
export const X_URL_LENGTH = 23;
export const X_MAX_MEDIA = 4;
export const X_ALT_LIMIT = 1000;
// The earliest a post can be scheduled, as Instagram's (server/instagram/publish.js).
export const X_MIN_LEAD_MS = 5 * 60e3;

// What X links on its own — any https?:// address, or a bare domain on a common ending.
const URL_RE = /\bhttps?:\/\/[^\s]+|\b(?:[a-z0-9-]+\.)+(?:com|org|net|edu|gov|io|co|tv|ly|me|gg|app|us|uk|ca)(?:\/[^\s]*)?/gi;
// X's weights: Latin and common punctuation count 1, everything else 2.
const light = (cp) => cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247);
const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;
const graphemes = (s) => (segmenter ? [...segmenter.segment(s)].map((g) => g.segment) : [...s]);

// A post's length as X counts it: a link is always 23, an emoji (however many
// code points it's built from) is 2.
export function xLength(text) {
  let n = 0;
  const rest = String(text || "").normalize("NFC").replace(URL_RE, () => { n += X_URL_LENGTH; return ""; });
  for (const g of graphemes(rest)) {
    if (/\p{Extended_Pictographic}/u.test(g)) n += 2;
    else for (const ch of g) n += light(ch.codePointAt(0)) ? 1 : 2;
  }
  return n;
}

// Text cut to fit, at a word where it can be, with an ellipsis.
export function fitToX(text, limit = X_LIMIT) {
  const t = String(text || "").trim();
  if (xLength(t) <= limit) return t;
  const parts = graphemes(t);
  let lo = 0;
  let hi = parts.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (xLength(`${parts.slice(0, mid).join("").trimEnd()}…`) <= limit) lo = mid;
    else hi = mid - 1;
  }
  const cut = parts.slice(0, lo).join("");
  const atWord = cut.replace(/\s+\S*$/, "");
  return `${(atWord.length >= cut.length * 0.6 ? atWord : cut).trimEnd()}…`;
}

// A starting point from an Instagram caption: its opening paragraph, and its
// link line if there's room. It's a draft to rewrite, not the same post.
export function textFromCaption(caption) {
  const paras = String(caption || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const first = (paras[0] || "").replace(/\s*\n\s*/g, " ");
  const link = paras.find((p, i) => i > 0 && /we-draft\.com/i.test(p) && !p.startsWith("#"));
  const line = link ? link.split("\n").find((l) => /we-draft\.com/i.test(l)) : "";
  const both = line ? `${first}\n\n${line}` : first;
  return xLength(both) <= X_LIMIT ? both : fitToX(first);
}

// Why a post can't be saved as scheduled (or published): [] when it can.
export function scheduleProblems({ text, media = [], scheduledAt }, now = Date.now()) {
  const out = [];
  if (!String(text || "").trim() && !media.length) out.push("A post needs text or an image.");
  const n = xLength(text);
  if (n > X_LIMIT) out.push(`The text is ${n} characters; X takes ${X_LIMIT}.`);
  if (media.length > X_MAX_MEDIA) out.push(`X takes ${X_MAX_MEDIA} images at most.`);
  if (scheduledAt !== undefined && (!Number.isFinite(scheduledAt) || scheduledAt < now + X_MIN_LEAD_MS)) out.push("Pick a time at least 5 minutes from now.");
  return out;
}

// What the publisher will send for a post: the text, and each image with its
// alt text. The seam for the API phase: nothing calls it yet.
export function toXPayload(post) {
  return {
    text: String(post?.text || "").trim(),
    media: (post?.media || []).slice(0, X_MAX_MEDIA).map((m) => ({ id: m.id, kind: m.kind, url: m.url || null, alt: String(m.alt || "").slice(0, X_ALT_LIMIT) })),
  };
}
