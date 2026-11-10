// src/utils/youtube/cutupPlayer.js
//
// A player's cut-up data, shared by the video outlines: Admin → Videos →
// Graphics (AdminYouTubeGraphics.jsx — Ice Cold) and Admin → Content → X
// Posts' Player highlight (AdminXHighlight.jsx — the We-Draft outline). His
// school, his photos (playerPhotos), his ESPN career stats, the season in
// progress with its games (his ESPN game log), his jersey number.
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { espnStats, careerGroups, careerTable, espnIdFor } from "../../components/AdminSideGraphics";

const ESPN = "https://site.web.api.espn.com/apis";

// The season under way: from August to January, the fall's.
export function liveSeason(now = new Date()) {
  const m = now.getMonth();
  if (m >= 7) return String(now.getFullYear());
  if (m === 0) return String(now.getFullYear() - 1);
  return "";
}

// A player's games in a season (his ESPN game log), or 0.
async function gamesIn(athleteId, season) {
  const j = await fetch(`${ESPN}/common/v3/sports/football/college-football/athletes/${athleteId}/gamelog?season=${season}`).then((r) => r.json()).catch(() => null);
  return Object.keys(j?.events || {}).length;
}

// His jersey number (his ESPN athlete), or "".
async function jerseyOf(athleteId) {
  const j = await fetch(`${ESPN}/common/v3/sports/football/college-football/athletes/${athleteId}`).then((r) => r.json()).catch(() => null);
  return String(j?.athlete?.jersey || "");
}

// The outline's table: his career table, its AVG columns left out (the panel's narrow) unless asked.
export function outlineTable(espn, cat, pos, { avg, live }) {
  const t = careerTable(espn, cat, pos);
  if (!t) return null;
  const keep = t.cols.map((c, i) => (avg || c !== "AVG" ? i : -1)).filter((i) => i >= 0);
  const pick = (vals) => keep.map((i) => vals[i]);
  return { title: t.title, cols: pick(t.cols), rows: t.rows.map((r) => ({ ...r, vals: pick(r.vals), partial: !!live && r.year === live })), total: pick(t.total) };
}

// Everything about a player (a players doc, with id) the outlines draw →
// { player, school, photos: { action, headshot }, espn, groups (his stat
// tables), ath (his ESPN athlete), season (in progress, or ""), games,
// jersey, sub ("WR | 6'1\" 195"), logo, problem (why something's missing, or "") }.
export async function loadCutupPlayer(pl) {
  const [schoolSnap, photoSnap] = await Promise.all([
    getDocs(query(collection(db, "schools"), where("School", "==", pl.School || ""), limit(1))),
    getDoc(doc(db, "playerPhotos", pl.id)),
  ]);
  const school = schoolSnap.docs[0]?.data() || {};
  const ph = photoSnap.exists() ? photoSnap.data() : {};
  const photos = { action: ph.action || [], headshot: ph.headshot?.url || "" };
  const ath = await espnIdFor(pl, school.CFBDTeamId, ph);
  const espn = ath ? await espnStats("college-football", ath.id).catch(() => null) : null;
  const season = liveSeason();
  const [games, jersey] = await Promise.all([
    ath && season && espn?.years?.includes(season) ? gamesIn(ath.id, season) : 0,
    ath ? jerseyOf(ath.id) : "",
  ]);
  return {
    player: pl, school, photos: { ...photos, headshot: photos.headshot || ath?.headshot || "" }, espn,
    groups: careerGroups(espn, pl.Position), ath, season, games, jersey,
    sub: [pl.Position, [pl.Height, pl.Weight].filter(Boolean).join(" ")].filter(Boolean).join(" | "),
    logo: school.Logo1 || school.LogoDark || "",
    problem: !ath ? "Couldn't find him on his school's ESPN roster, so there's no stats table." : !espn?.years?.length ? "ESPN has no stats for him yet." : "",
  };
}
