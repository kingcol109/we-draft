// src/utils/socialHandles.js
//
// A player's X (Twitter) handle as typed or pasted — "@Name", "x.com/Name",
// "https://twitter.com/Name?s=21" — down to the handle itself: letters,
// numbers and underscores, 15 at most (X's rules). Stored on players and
// recruits as XHandle, without the @.
export function cleanXHandle(raw) {
  let s = String(raw || "").trim();
  const url = /(?:x|twitter)\.com\/(?:#!\/)?([^/?#\s]+)/i.exec(s);
  if (url) s = url[1];
  return s.replace(/^@+/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 15);
}

export const xProfileUrl = (handle) => `https://x.com/${handle}`;
