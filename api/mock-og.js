// api/mock-og.js
//
// The Weekly Mock's link-preview image (server/mockPreview.js), as a PNG:
//
//   GET ?year=2027            the whole mock (/mocks/2027)
//   GET ?year=2027&team=NYJ   a team's page (/mocks/nyj, /mocks/nyj/2028)
//   &v=<week id>              cache key only — the pages' og:image carries
//                             the current week's, so a new week is a new URL
//
// Reads the class's summary (config/weeklyMock, config/weeklyMock{year} —
// utils/weeklyMockNews.js summaryDocId), the week it names (weeklyMocks),
// and the teams' branding (nfl). A class with nothing published yet still
// gets an image ("coming soon" / no picks), never an error page — a link
// preview that fails is just a bare link. Cached at Vercel's edge: a week
// with v (the pages always send it), a day without.

const { renderPng, fetchLogo } = require("../server/stream-manager/thumbnail");
const { classSvg, teamSvg } = require("../server/mockPreview");

// utils/weeklyMockNews.js WEEKLY_YEARS — the first is the main class, whose
// team pages have no year in the path.
const WEEKLY_YEARS = ["2027", "2028"];
const TEAMS = new Set([
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LV", "LAC", "LAR", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SF", "SEA", "TB", "TEN", "WAS",
]);
const CLASS_PICKS = 5;
// A team drawn off its branding color, as its page's header is
// (WeeklyTeamMock.jsx HERO_LOOKS).
const COLOR_LOOKS = { PIT: "#101820" };
const summaryDocId = (year) => (year === "2027" ? "weeklyMock" : `weeklyMock${year}`);

// "Updated Oct 27", Eastern time as the site shows it.
const dated = (ts) => (ts?.toDate ? `Updated ${ts.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}` : "");

async function loadWeek(db, year) {
  const summary = (await db.collection("config").doc(summaryDocId(year)).get()).data();
  if (summary?.weekId) {
    const snap = await db.collection("weeklyMocks").doc(summary.weekId).get();
    if (snap.exists) return snap.data();
  }
  // A summary from before it named the week: the class's latest.
  const all = (await db.collection("weeklyMocks").where("year", "==", year).get()).docs.map((d) => d.data()).filter((w) => w.publishedAt);
  return all.sort((a, b) => b.publishedAt.toMillis() - a.publishedAt.toMillis())[0] || null;
}

// { [abbr]: { City, Team, Color1, logo } } for these teams, logos fetched.
async function loadTeams(db, abbrs) {
  const uniq = [...new Set(abbrs)];
  if (!uniq.length) return {};
  const snaps = await db.getAll(...uniq.map((a) => db.collection("nfl").doc(a)));
  const out = {};
  await Promise.all(snaps.map(async (s) => {
    const t = s.exists ? s.data() : {};
    const logo = t.Logo1 ? await fetchLogo(t.Logo1) : {};
    out[s.id] = { City: t.City, Team: t.Team, Color1: COLOR_LOOKS[s.id] || t.Color1, logo: logo.data ? { mime: logo.mime, b64: logo.data.toString("base64") } : null };
  }));
  return out;
}

module.exports = async function handler(req, res) {
  const year = String(req.query?.year || "");
  const team = String(req.query?.team || "").toUpperCase();
  if (!WEEKLY_YEARS.includes(year) || (team && !TEAMS.has(team))) return res.status(404).json({ error: "not found" });

  try {
    const { getFirestore } = require("../scripts/firebaseAdmin");
    const db = getFirestore();
    const week = await loadWeek(db, year);
    const picks = [...(week?.picks || [])].sort((a, b) => a.overall - b.overall);
    const rounds = week?.rounds || 7;
    let svg;
    if (team) {
      const address = `we-draft.com/mocks/${team.toLowerCase()}${year === WEEKLY_YEARS[0] ? "" : `/${year}`}`;
      const brand = (await loadTeams(db, [team]))[team];
      svg = teamSvg({ year, dated: dated(week?.publishedAt), address, team: brand, picks: picks.filter((p) => p.owner === team) });
    } else {
      const top = picks.slice(0, CLASS_PICKS);
      const brands = await loadTeams(db, top.map((p) => p.owner));
      svg = classSvg({ year, rounds, dated: dated(week?.publishedAt), address: `we-draft.com/mocks/${year}`, picks: top.map((p) => ({ ...p, team: brands[p.owner] })) });
    }
    const { png } = renderPng(svg);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", req.query?.v
      ? "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400"
      : "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600");
    return res.status(200).send(png);
  } catch (e) {
    console.error("mock-og:", e);
    return res.status(500).json({ error: "render failed" });
  }
};
