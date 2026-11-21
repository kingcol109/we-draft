// server/highSchools/hsGeo.js
//
// The /hs hub and /hs/{state} pages' data (pages/HighSchoolHub.jsx), built
// inside buildHsIndex from counts it already has — no extra reads. Each page
// view is ONE document read; the heatmap points come pre-projected (Albers
// USA, us-atlas's 975 × 610 frame — utils/albersUsa.js), so the page only
// draws.
//
//   hsAlumni/_hub        { totals, states: [{ a, cfb, nfl, sc, sn, lead }],
//                          top: { cfb, nfl } (national top 25 schools),
//                          heat: [[x, y, cfb, nfl]] (schools binned to 3 px) }
//   hsAlumni/_state_{ST} { cfb, nfl, sc, sn, located, nflLogos,
//                          schools: [[name, cfb, nfl, x, y, slug, logo, city,
//                                     colors, picks, players, posMix,
//                                     colleges]] }
//   cfb / nfl: { ALL, QB, … } — players by position group.
//   colors: [Color1, Color2] from the school's branding, or null.
//   picks: its 5 highest NFL draft picks [[year, overall, round, name, pos,
//          team abbr]] (top rows in _hub carry the same as c / pk).
//   players: its top 5 current college players [[name, pos, college]],
//          ordered by transfer stars (then recruiting rating) — the stars
//          themselves are never written (top rows in _hub: pl).
//   posMix: its college players by position group, [QB, RB, WR, TE, OL, DL,
//          LB, DB, ST] counts (hsIndex GROUPS order); null with none.
//   colleges: where they play, [[college, n]] most first (top 6) — the
//          card front's "where they play" (top rows in _hub: pm / co).
//   sideCfb / sidePicks (state docs and _hub): the right column — the 15
//          top current college players from the state (nation), ordered by
//          transfer stars (never written) [[name, pos, college, high school, slug?]],
//          and its 15 highest picks [[year, overall, round, name, pos, team,
//          high school, slug?]] — slug: the player's We-Draft page when he
//          has one (the column links his name).
//   nflLogos: { abbr: [LogoDark || Logo1, Logo1] } for the teams in the doc;
//   collegeLogos: { school: [LogoDark || Logo1, Logo1] } likewise.
//
// Where a school is: the median hometown of its current college players
// (CFBD roster coordinates); else its city (our highSchools.City, or a
// school named for its town) placed at the median of the hometowns of
// players who went to high school in that city. Unplaced schools still count
// in every number; they're just not on the map.

const BIN = 3;

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const centerOf = (pts) => (pts?.length ? [median(pts.map((p) => p[0])), median(pts.map((p) => p[1]))] : null);
const cityKey = (city, stName) => `${String(city || "").trim().toLowerCase()}|${stName}`;

function addGroups(into, from) {
  Object.entries(from || {}).forEach(([g, v]) => { into[g] = (into[g] || 0) + v; });
}

// counts: key "Name|State" → { cfb: {ALL…}, nfl: {ALL…} }
// samples: key → [[lat, lng]]  (current players' hometowns)
// citySamples: "city|State" → [[lat, lng]]
// docByKey: key → highSchools doc; slugOf(doc) → page slug
// top: { cfb: rows, nfl: rows } national leaderboard rows (ALL)
function buildHsGeoDocs({ counts, samples, citySamples, docByKey, slugOf, top, base, STATE_ABBR, albersUsa, picksByKey, nflTeams, playersByKey, collegeLogo, GROUPS }) {
  const posMix = (key) => {
    const c = counts.get(key)?.cfb;
    return c?.ALL ? (GROUPS || []).map((g) => c[g] || 0) : null;
  };
  const collegesOf = (key) => {
    const tally = new Map();
    (playersByKey?.get(key) || []).forEach((x) => { if (x[4]) tally.set(x[4], (tally.get(x[4]) || 0) + 1); });
    const out = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6);
    return out.length ? out : null;
  };
  const topPlayers = (key) => (playersByKey?.get(key) || []).slice().sort((a, b) => b[0] - a[0] || b[1] - a[1]).slice(0, 5).map((x) => [x[2], x[3], x[4]]);
  const collegeLogosFor = (lists, at = 2) => {
    const out = {};
    lists.forEach((list) => (list || []).forEach((x) => { const l = x[at] && collegeLogo?.get(x[at]); if (l && !out[x[at]]) out[x[at]] = l; }));
    return out;
  };
  const topPicks = (key) => (picksByKey?.get(key) || []).sort((a, b) => a[1] - b[1] || b[0] - a[0]).slice(0, 5).map((x) => x.slice(0, 6));
  const colorsOf = (d) => (d?.Color1 ? [d.Color1, d.Color2 || d.Color1] : null);
  const nflById = new Map((nflTeams || []).map((t) => [t.abbr, t]));
  const logosFor = (pickLists) => {
    const out = {};
    pickLists.forEach((list) => (list || []).forEach((p) => {
      const t = p[5] && nflById.get(p[5]);
      if (t && !out[p[5]]) out[p[5]] = [t.LogoDark || t.Logo1 || null, t.Logo1 || null];
    }));
    return out;
  };
  const byState = new Map(); // abbr → { cfb, nfl, sc, sn, schools: [] }
  const heat = new Map();
  let totCfb = 0;
  let totNfl = 0;
  let totSchools = 0;

  for (const [key, c] of counts) {
    const [name, stName] = key.split("|");
    const a = STATE_ABBR[stName];
    if (!a) continue;
    if (!byState.has(a)) byState.set(a, { cfb: {}, nfl: {}, sc: 0, sn: 0, schools: [] });
    const s = byState.get(a);
    addGroups(s.cfb, c.cfb);
    addGroups(s.nfl, c.nfl);
    const vc = c.cfb.ALL || 0;
    const vn = c.nfl.ALL || 0;
    if (vc) s.sc += 1;
    if (vn) s.sn += 1;
    totCfb += vc;
    totNfl += vn;
    totSchools += 1;

    const d = docByKey.get(key);
    const city = d?.City || null;
    const ll = centerOf(samples.get(key))
      || (city && centerOf(citySamples.get(cityKey(city, stName))))
      || centerOf(citySamples.get(cityKey(name, stName)));
    const xy = ll ? albersUsa(ll[0], ll[1], a) : null;
    const pk = topPicks(key);
    const pl = topPlayers(key);
    s.schools.push([name, vc, vn, xy ? xy[0] : null, xy ? xy[1] : null, d?.Logo1 ? slugOf(d) : null, d?.Logo1 || null, city,
      colorsOf(d), pk.length ? pk : null, pl.length ? pl : null, posMix(key), collegesOf(key)]);
    if (xy) {
      const bx = Math.round(xy[0] / BIN);
      const by = Math.round(xy[1] / BIN);
      const hk = `${bx},${by}`;
      const h = heat.get(hk) || [bx * BIN, by * BIN, 0, 0];
      h[2] += vc;
      h[3] += vn;
      heat.set(hk, h);
    }
  }

  // The right column's lists, over a set of school keys.
  const SIDE = 15;
  const sideOf = (keys) => {
    const pl = [];
    const pk = [];
    keys.forEach((key) => {
      const hs = key.split("|")[0];
      (playersByKey?.get(key) || []).forEach((x) => pl.push([x[0], x[1], x[2], x[3], x[4], hs, x[5]]));
      (picksByKey?.get(key) || []).forEach((x) => pk.push([...x.slice(0, 6), hs, ...(x[6] ? [x[6]] : [])]));
    });
    return {
      sideCfb: pl.sort((a, b) => b[0] - a[0] || b[1] - a[1]).slice(0, SIDE).map((x) => [x[2], x[3], x[4], x[5], ...(x[6] ? [x[6]] : [])]),
      sidePicks: pk.sort((a, b) => a[1] - b[1] || b[0] - a[0]).slice(0, SIDE),
    };
  };
  const keysByState = new Map();
  for (const key of counts.keys()) {
    const a = STATE_ABBR[key.split("|")[1]];
    if (!a) continue;
    if (!keysByState.has(a)) keysByState.set(a, []);
    keysByState.get(a).push(key);
  }

  const leadOf = (schools, i) => {
    const best = schools.reduce((b, x) => (x[i] > (b?.[i] || 0) ? x : b), null);
    return best ? [best[0], best[i], best[5]] : null;
  };
  const states = [...byState.entries()].map(([a, s]) => ({
    a, cfb: s.cfb, nfl: s.nfl, sc: s.sc, sn: s.sn,
    lead: { cfb: leadOf(s.schools, 1), nfl: leadOf(s.schools, 2) },
  }));

  // National top lists: + colors and highest picks.
  const keyOfRow = (r) => `${r.k}|${Object.keys(STATE_ABBR).find((n) => STATE_ABBR[n] === r.st) || r.st}`;
  const topOut = {};
  Object.entries(top).forEach(([m, rows]) => {
    topOut[m] = rows.map((r) => {
      const key = keyOfRow(r);
      const pk = topPicks(key);
      const pl = topPlayers(key);
      const c = colorsOf(docByKey.get(key));
      const pm = posMix(key);
      const co = collegesOf(key);
      return { ...r, ...(c ? { c } : {}), ...(pk.length ? { pk } : {}), ...(pl.length ? { pl } : {}), ...(pm ? { pm } : {}), ...(co ? { co } : {}) };
    });
  });
  const natSide = sideOf([...keysByState.values()].flat());
  const docs = [["_hub", {
    scope: "hub", ...base, ...natSide,
    totals: { cfb: totCfb, nfl: totNfl, schools: totSchools },
    states, top: topOut, heat: [...heat.values()],
    nflLogos: { ...logosFor(Object.values(topOut).flat().map((r) => r.pk)), ...logosFor([natSide.sidePicks]) },
    collegeLogos: {
      ...collegeLogosFor([natSide.sideCfb]),
      ...collegeLogosFor(Object.values(topOut).flat().map((r) => r.pl)),
      ...collegeLogosFor(Object.values(topOut).flat().map((r) => r.co), 0),
    },
  }]];
  for (const [a, s] of byState) {
    s.schools.sort((x, y) => y[1] - x[1] || y[2] - x[2] || x[0].localeCompare(y[0]));
    const side = sideOf(keysByState.get(a) || []);
    docs.push([`_state_${a}`, {
      scope: a, ...base, ...side, cfb: s.cfb, nfl: s.nfl, sc: s.sc, sn: s.sn,
      located: s.schools.filter((x) => x[3] != null).length, schools: s.schools,
      nflLogos: { ...logosFor(s.schools.map((x) => x[9])), ...logosFor([side.sidePicks]) },
      collegeLogos: { ...collegeLogosFor(s.schools.map((x) => x[10])), ...collegeLogosFor(s.schools.map((x) => x[12]), 0), ...collegeLogosFor([side.sideCfb]) },
    }]);
  }
  return docs;
}

module.exports = { buildHsGeoDocs, cityKey };
