// src/utils/voice/log.js
//
// /voice's conversation log (user, 2026-11-25): every exchange — what was
// asked, what it answered — saved to voiceLog so it can be gone over later
// in VS Code (scripts/voiceLog.mjs prints it as a transcript; --follow
// watches it live) and on the page (Review → Log). Admin-only to read
// (firestore.rules). Each entry expires after 30 days (expireAt — a
// Firestore TTL policy on voiceLog.expireAt deletes it; the script's
// --prune does the same by hand).
//
// Pure: builds the entry; data.js logExchange() writes it.

export const LOG_DAYS = 30;
const cut = (s, n) => String(s ?? "").slice(0, n);

/**
 * "iPad · Safari" / "Windows · Chrome" / "Android · Chrome" — from the browser's
 * user agent. An iPad's Safari says "Macintosh"; a touch screen gives it away.
 */
export function deviceOf(ua = "", touchPoints = 0) {
  const u = String(ua);
  const mac = /Macintosh|Mac OS X/.test(u);
  const os = /iPad/.test(u) || (mac && touchPoints > 1) ? "iPad"
    : /iPhone/.test(u) ? "iPhone" : /Android/.test(u) ? "Android" : /Windows/.test(u) ? "Windows" : mac ? "Mac" : /CrOS/.test(u) ? "Chromebook" : /Linux/.test(u) ? "Linux" : "Other";
  const browser = /Edg\//.test(u) ? "Edge" : /CriOS|Chrome\//.test(u) && !/Edg\//.test(u) ? "Chrome" : /FxiOS|Firefox\//.test(u) ? "Firefox" : /Safari\//.test(u) ? "Safari" : "Other";
  return `${os} · ${browser}`;
}

/**
 * One exchange → the voiceLog doc (without uid / at, which data.js adds).
 * meta: { source: "voice" | "typed" | "wake" | "tap" | "refresh", ms, session, device, mode }
 */
export function logEntry(said, reply = {}, meta = {}, now = Date.now()) {
  const p = reply.player || null;
  const who = p ? `${p.First || p.first || ""} ${p.Last || p.last || ""}`.trim() : "";
  return {
    said: cut(said, 400),
    say: cut(reply.say, 2000),
    intent: reply.intent || null,
    tone: reply.tone || null,
    miss: reply.tone === "miss",
    asked: !!reply.confirm, // a write waiting on yes / no
    player: p?.id || null,
    playerName: cut(who, 80) || null,
    title: cut(reply.title, 120) || null,
    rows: Array.isArray(reply.rows) ? reply.rows.length : 0,
    source: meta.source || "typed",
    ms: Number.isFinite(meta.ms) ? Math.round(meta.ms) : null,
    session: cut(meta.session, 40) || null,
    device: cut(meta.device, 60) || null,
    mode: meta.mode || "general",
    expireAt: new Date(now + LOG_DAYS * 86400000),
  };
}
