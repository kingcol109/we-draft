// src/utils/portalTeams.js
//
// The FBS teams the Transfer Portal's team pages cover (/portal/ohio-state —
// pages/TransferPortal.jsx), keyed by a slug made from the school's name
// (schools.Slug is a short code like "osu", so it isn't used here).
//
// Pure (no Firebase) — also used by the site snapshot builder
// (utils/snapshotBuilders.js), which writes compSnapshots/_cfbTeams with
// buildPortalTeams. The page reads that doc (TransferPortal.jsx
// fetchPortalTeams).

// FBS conferences, as schools.Conference spells them.
export const FBS_CONFERENCES = ["ACC", "Big 10", "Big 12", "SEC", "Pac 12", "Independent", "AAC", "CUSA", "MAC", "Mountain West", "Sun Belt"];

// "Ohio State" → "ohio-state", "Texas A&M" → "texas-am".
export const portalTeamSlug = (name) => String(name || "").toLowerCase().replace(/&/g, "").replace(/['’.]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const pick = (s) => ({
  School: s.School || "", Short: s.Short || "", Mascot: s.Mascot || "", Conference: s.Conference || "", State: s.State || "",
  Logo1: s.Logo1 || "", LogoDark: s.LogoDark || "", Color1: s.Color1 || "", Color2: s.Color2 || "", Wordmark: s.Wordmark || "", WordmarkDark: s.WordmarkDark || "",
  teamSlug: s.Slug || "",
});

// { [slug]: team } from schools docs.
export function buildPortalTeams(schools) {
  const teams = {};
  (schools || []).filter((s) => s.School && FBS_CONFERENCES.includes(s.Conference)).forEach((s) => { teams[portalTeamSlug(s.School)] = pick(s); });
  return teams;
}
