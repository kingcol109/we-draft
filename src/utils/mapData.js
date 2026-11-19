// src/utils/mapData.js
//
// The data behind the interactive maps (pages/MapPage.jsx), precomputed
// into compSnapshots by scripts/buildMapSnapshots.mjs:
//
//   _mapDraft — /map/draft: every FBS school's NFL draftees, 2000 on
//     { version, from, to, total, schools: [{
//         k (portal slug), s (school), lat, lng, cf (conference), l (Logo1),
//         ld (LogoDark), c1, c2, n (draftees), r1 (first-rounders),
//         pos { [pos]: n }, rd [round 1..7 counts], yr { [year]: n },
//         top [{ n, p, y, r, k (pick), t (NFL team), sl (player page) }] }] }
//
//   _mapRecruits_{slug} — /map/{slug}: a school's high school recruits by
//     class (CFBD /recruiting/players)
//     { version, k, s, from, to, rows: [{
//         n, h (high school), c (city), st (state code), f (state FIPS),
//         y (class), s (stars), r (rating), rk (national rank), p (position),
//         la, lo (hometown), sl? (We-Draft page), d? ("Rd 1 · 2021") }] }
//
// Pure — no Firebase (the build script runs it under Node).
import { portalTeamSlug, FBS_CONFERENCES } from "./portalTeams.js";

const norm = (s) => String(s || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");
const num = (v) => (Number.isFinite(Number(v)) && String(v).trim() !== "" ? Number(v) : null);

export const fbsSchools = (schools) => schools.filter((s) => s.School && FBS_CONFERENCES.includes(s.Conference) && s.Latitude && s.Longitude);

// drafted: historical rows + the latest class as historical rows
// (historicalStats draftedPlayersAsHistorical) — { School, Position, Year,
// Round, Pick, "NFL Team", Player | First/Last, Slug? }
export function buildDraftMapDoc({ drafted, schools, version }) {
  const fbs = fbsSchools(schools);
  const bySchool = Object.fromEntries(fbs.map((s) => [s.School, []]));
  drafted.forEach((r) => { if (bySchool[r.School]) bySchool[r.School].push(r); });
  const years = drafted.map((r) => Number(r.Year)).filter(Boolean);
  const out = fbs.map((s) => {
    const rows = bySchool[s.School];
    const pos = {}, yr = {}, rd = [0, 0, 0, 0, 0, 0, 0];
    rows.forEach((r) => {
      if (r.Position) pos[r.Position] = (pos[r.Position] || 0) + 1;
      yr[r.Year] = (yr[r.Year] || 0) + 1;
      const round = num(r.Round);
      if (round >= 1 && round <= 7) rd[round - 1] += 1;
    });
    const top = [...rows]
      .filter((r) => num(r.Round))
      .sort((a, b) => num(a.Round) - num(b.Round) || (num(a.Pick) || 999) - (num(b.Pick) || 999) || Number(b.Year) - Number(a.Year))
      .slice(0, 10)
      .map((r) => ({
        n: r.Player || `${r.First || ""} ${r.Last || ""}`.trim(), p: r.Position || "", y: Number(r.Year),
        r: num(r.Round), k: num(r.Pick), t: r["NFL Team"] || "", ...(r.Slug ? { sl: r.Slug } : {}),
      }));
    return {
      k: portalTeamSlug(s.School), s: s.School, lat: Number(s.Latitude), lng: Number(s.Longitude), cf: s.Conference,
      l: s.Logo1 || "", ld: s.LogoDark || "", c1: s.Color1 || "", c2: s.Color2 || "",
      n: rows.length, r1: rd[0], pos, rd, yr, top,
    };
  });
  return { version, from: Math.min(...years), to: Math.max(...years), total: out.reduce((a, s) => a + s.n, 0), schools: out };
}

// recruits: CFBD /recruiting/players rows (every class). players / drafted
// link a recruit to his We-Draft page and his draft — same name, and the
// school among his stops (players) or the school he was drafted from.
export function buildRecruitMapDocs({ recruits, schools, players = [], drafted = [], version }) {
  const fbs = fbsSchools(schools);
  const pages = {};
  players.forEach((p) => {
    if (!p.Slug) return;
    const key = norm(`${p.First} ${p.Last}`);
    const at = new Set([p.School, ...(p.CareerStops || []).map((x) => x.School)].filter(Boolean));
    (pages[key] = pages[key] || []).push({ slug: p.Slug, at });
  });
  const drafts = {};
  drafted.forEach((r) => {
    const key = norm(r.Player || `${r.First || ""} ${r.Last || ""}`);
    (drafts[key] = drafts[key] || []).push(r);
  });
  const docs = [];
  fbs.forEach((s) => {
    const mine = recruits.filter((x) => x.committedTo === s.School && x.year);
    if (!mine.length) return;
    const rows = mine.map((x) => {
      const key = norm(x.name);
      const page = (pages[key] || []).find((p) => p.at.has(s.School));
      const d = (drafts[key] || []).find((r) => r.School === s.School && Number(r.Year) > x.year && Number(r.Year) <= x.year + 7);
      const fips = String(x.hometownInfo?.fipsCode || "").slice(0, 2);
      return {
        n: x.name, h: x.school || "", c: x.city || "", st: x.stateProvince || "", f: fips,
        y: x.year, s: x.stars || 0, r: x.rating ? Math.round(x.rating * 10000) / 10000 : 0, rk: x.ranking || 0, p: x.position || "",
        la: x.hometownInfo?.latitude != null ? Math.round(x.hometownInfo.latitude * 1000) / 1000 : null,
        lo: x.hometownInfo?.longitude != null ? Math.round(x.hometownInfo.longitude * 1000) / 1000 : null,
        ...(page ? { sl: page.slug } : {}),
        ...(d ? { d: `Rd ${d.Round} · ${d.Year}` } : {}),
      };
    }).sort((a, b) => b.y - a.y || b.r - a.r);
    const ys = rows.map((r) => r.y);
    docs.push({ id: `_mapRecruits_${portalTeamSlug(s.School)}`, data: { version, k: portalTeamSlug(s.School), s: s.School, from: Math.min(...ys), to: Math.max(...ys), rows } });
  });
  return docs;
}
