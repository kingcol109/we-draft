// src/utils/youtubeMetadata.js
//
// YouTube title / description rules for the Stream Manager's metadata
// editor (components/AdminStreamManager.js MetadataEditor) — the same checks
// the server makes before saving a draft (server/stream-manager/metadata.js
// validateMetadata), so problems show while typing. The server's check is
// the one that counts.
//
// YouTube: title 1–100 characters, description up to 5000 bytes (UTF-8),
// neither with < or >.

export const LIMITS = { titleMax: 100, descriptionMaxBytes: 5000 };

export const charCount = (s) => [...String(s || "")].length;
// UTF-8 bytes, without relying on TextEncoder.
export function byteCount(s) {
  let n = 0;
  for (const ch of String(s || "")) {
    const c = ch.codePointAt(0);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

// Line breaks are kept (CRLF → LF); only the ends are trimmed.
export function normalizeMetadata({ title, description } = {}) {
  return {
    title: String(title ?? "").replace(/\s+/g, " ").trim(),
    description: String(description ?? "").replace(/\r\n?/g, "\n").trim(),
  };
}

// { title, description, errors: { title?, description? } } — errors empty when valid.
export function validateMetadata(input, limits = LIMITS) {
  const { title, description } = normalizeMetadata(input);
  const errors = {};
  const tc = charCount(title);
  const db = byteCount(description);
  if (!title) errors.title = "Title is required.";
  else if (tc > limits.titleMax) errors.title = `Title must be ${limits.titleMax} characters or fewer (it's ${tc}).`;
  else if (/[<>]/.test(title)) errors.title = "Title can't contain < or >.";
  if (db > limits.descriptionMaxBytes) errors.description = `Description must be ${limits.descriptionMaxBytes} bytes or fewer (it's ${db}).`;
  else if (/[<>]/.test(description)) errors.description = "Description can't contain < or >.";
  return { title, description, errors };
}
