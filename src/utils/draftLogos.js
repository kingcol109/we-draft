// src/utils/draftLogos.js
//
// Career Path's status logos, served from public/logos/:
//   nfl-draft-{year}.png   the NFL Draft logo, one per year (2027 added
//                          2026-11-13) — a declared player's newest stop.
//                          Add a year by dropping its file in and listing it.
//   transfer-portal.svg    the transfer portal arrows — a player in the portal.
const YEARS = new Set([2027]);

export const draftLogo = (year) => (YEARS.has(Number(year)) ? `/logos/nfl-draft-${Number(year)}.png` : "");
export const PORTAL_LOGO = "/logos/transfer-portal.svg";
