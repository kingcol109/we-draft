// src/utils/recruitSim/generate.js
//
// The whole recruiting class, generated once when a save starts (spec §3) —
// every recruit exists before Winter; scouting only reveals. Source material
// is real We-Draft roster data (./source.json, scripts/buildRecruitSimSource.js):
// names recombined by frequency, high schools drawn by how many players
// they produce (so Texas, Florida, Georgia, California… look like they do),
// and frames drawn from real young players at the position.
//
// Public: id, name, position, HS, hometown, state, region, height, weight,
// stars, website rating, national + position rank — fixed for the save.
// Hidden: traits (→ categories → true overall), potential, preferences,
// NIL ask, decision timeline. Potential is drawn after the class exists
// (correlated with Physical across the class) — it sets the jump he makes
// when he commits (./development.js).
import { rngFor, normal, pickWeighted, cumulative, drawCumulative, shuffle, clamp, knots, logKnots, intBetween } from "./rng.js";
import { TRAIT_MAP, POSITIONS, categoryValues, overallOf } from "./traits.js";
import { REGIONS, regionOfState, STATE_CENTER } from "./regions.js";

const pad = (n) => String(n).padStart(4, "0");

// source: source.json; cfg: merged config; seed.
export function generateClass(source, cfg, seed) {
  const N = cfg.classSize;
  const rand = rngFor(seed, "class");

  // ── Ranks → public ratings → stars ──
  const ratings = Array.from({ length: N }, (_, i) => Math.round(knots(cfg.ratingKnots, i + 1) * 10) / 10);
  const starsOf = (rt) => (rt >= cfg.starCuts[5] ? 5 : rt >= cfg.starCuts[4] ? 4 : rt >= cfg.starCuts[3] ? 3 : 2);

  // ── Positions: exact counts by share, shuffled across ranks ──
  const posList = [];
  const shares = POSITIONS.map((p) => cfg.positions[p] || 0);
  const total = shares.reduce((a, b) => a + b, 0);
  POSITIONS.forEach((p, i) => { const n = Math.round((shares[i] / total) * N); for (let k = 0; k < n; k += 1) posList.push(p); });
  while (posList.length < N) posList.push(POSITIONS[pickWeighted(rand, shares)]);
  posList.length = N;
  shuffle(rand, posList);

  // ── Regions → high schools ──
  // Production by region from the source, clipped into [min, max] share.
  const hsByRegion = {};
  (source.hs || []).forEach(([name, city, st, lat, lng, n]) => {
    const reg = regionOfState(st);
    if (!reg) return;
    (hsByRegion[reg] = hsByRegion[reg] || []).push({ name, city, st, loc: lat != null ? [lat, lng] : STATE_CENTER[st] || null, w: Math.pow(n, 0.8), used: 0 });
  });
  const regKeys = REGIONS.map((r) => r.key).filter((k) => hsByRegion[k]?.length);
  let regW = regKeys.map((k) => hsByRegion[k].reduce((a, h) => a + h.w, 0));
  for (let pass = 0; pass < 6; pass += 1) {
    const t = regW.reduce((a, b) => a + b, 0);
    regW = regW.map((w) => clamp(w / t, cfg.regionShare.min, cfg.regionShare.max));
  }
  const regCum = {};
  regKeys.forEach((k) => { regCum[k] = cumulative(hsByRegion[k].map((h) => h.w)); });
  const maxPerHs = 5;

  // ── Names ──
  const firstCum = cumulative((source.first || []).map(([, n]) => Math.pow(n, 0.85)));
  const lastCum = cumulative((source.last || []).map(([, n]) => Math.pow(n, 0.75)));
  const usedFull = new Set();
  const lastCount = new Map();
  const pickName = () => {
    for (let tries = 0; tries < 60; tries += 1) {
      const f = source.first[drawCumulative(rand, firstCum)]?.[0] || "Chris";
      const l = source.last[drawCumulative(rand, lastCum)]?.[0] || "Smith";
      const full = `${f} ${l}`;
      if (usedFull.has(full) || (lastCount.get(l) || 0) >= cfg.maxLastName) continue;
      usedFull.add(full);
      lastCount.set(l, (lastCount.get(l) || 0) + 1);
      return [f, l];
    }
    return ["Jordan", `Smith${usedFull.size}`];
  };

  const recruits = [];
  for (let i = 0; i < N; i += 1) {
    const r = rngFor(seed, `recruit|${i}`);
    const pos = posList[i];
    const rating = ratings[i];
    // Region, then a HS in it (a HS sends at most maxPerHs to one class).
    const region = regKeys[pickWeighted(r, regW)];
    let hs = null;
    for (let tries = 0; tries < 20 && !hs; tries += 1) {
      const h = hsByRegion[region][drawCumulative(r, regCum[region])];
      if (h && h.used < maxPerHs) hs = h;
    }
    hs = hs || hsByRegion[region][0];
    hs.used += 1;
    const [first, last] = pickName();
    // Frame: a real young player's at the position, jittered; HS seniors a bit lighter.
    const frames = source.body?.[pos] || [[74, 210]];
    const [fh, fw] = frames[Math.floor(r() * frames.length)];
    const ht = clamp(Math.round(fh + normal(r) * cfg.body.htJitter * 0.6), 64, 81);
    const wt = clamp(Math.round(fw - cfg.body.hsLighter + normal(r) * cfg.body.wtJitter), 150, 360);

    // ── True overall and traits ──
    const tn = cfg.trueNoise;
    const noise = (r() < tn.tailShare ? tn.tailSd : tn.sd) * normal(r);
    const target = clamp(rating + noise, tn.clamp[0], tn.clamp[1]);
    const rawPolish = normal(r) * cfg.rawPolishSd; // + raw athlete, − polished
    const catDrift = { ins: normal(r) * cfg.categorySd, tec: normal(r) * cfg.categorySd, phy: normal(r) * cfg.categorySd };
    const map = TRAIT_MAP[pos];
    let traits = map.map(([, c]) => target + catDrift[c] + (c === "phy" ? rawPolish : -rawPolish * 0.8) + normal(r) * cfg.traitSd);
    // Re-center so the formula lands on the target overall (two passes for the clamp).
    for (let pass = 0; pass < 3; pass += 1) {
      const shift = target - overallOf(pos, traits);
      traits = traits.map((v) => clamp(v + shift, cfg.traitClamp[0], cfg.traitClamp[1]));
    }
    traits = traits.map((v) => Math.round(v));
    const ovr = overallOf(pos, traits);
    const cats = categoryValues(pos, traits);

    // ── Preferences: stable weights over six factors (sum 1) ──
    const prefs = {};
    let ps = 0;
    cfg.prefFactors.forEach((k) => { const w = (cfg.prefBias[k] || 1) * Math.exp(normal(r) * (1 / cfg.prefShape)); prefs[k] = w; ps += w; });
    cfg.prefFactors.forEach((k) => { prefs[k] = Math.round((prefs[k] / ps) * 1000) / 1000; });

    // ── NIL expectation: by national rank, × how much he cares, ± noise ──
    const care = clamp(prefs.nil * 3, 0, 1);
    const ask = Math.round(logKnots(cfg.askKnots, i + 1) * (cfg.nilCare.low + (cfg.nilCare.high - cfg.nilCare.low) * care) * Math.exp(normal(r) * cfg.askNoise) / 1000) * 1000;

    // ── Decision timeline (spec §18) ──
    const lc = cfg.lifecycle;
    const top10 = intBetween(r, lc.top10[0], lc.top10[1]);
    const finalWk = top10 + intBetween(r, lc.finalAfter[0], lc.finalAfter[1]);
    const sh = lc.commitShares;
    // Elite prospects lean later.
    const eliteLate = rating >= 93 ? 0.08 : 0;
    const bucket = pickWeighted(r, [sh.early - eliteLate, sh.mid, sh.late + eliteLate / 2, sh.signing + eliteLate / 2]);
    const cw = lc.commitWeeks || { early: [lc.earliestCommit, 6], mid: [7, 10], late: [11, 12] };
    let commitWk = [intBetween(r, cw.early[0], cw.early[1]), intBetween(r, cw.mid[0], cw.mid[1]), intBetween(r, cw.late[0], cw.late[1]), 13][bucket];
    // Not before his top 10 is out (he can commit from it — no final needed).
    commitWk = Math.max(commitWk, Math.min(13, top10 + 1));

    recruits.push({
      i, id: `R${pad(i + 1)}`, first, last, pos, hs: hs.name, city: hs.city, st: hs.st, region, ht, wt, loc: hs.loc,
      rating, stars: starsOf(rating), rank: i + 1, posRank: 0,
      // Hidden.
      t: traits, t0: traits.slice(), ovr, ovr0: ovr, pot: 0, phy: cats.phy, prefs, ask, ask0: ask,
      tl: { top10, final: Math.min(finalWk, 12), commit: commitWk },
      chg: new Array(map.length).fill(0), chgWk: new Array(map.length).fill(0),
      // Recruitment.
      status: "open", list: null, commit: -1, commitStage: -1, demand: null,
      // Future avatar (spec §27): a persistent seed for a layered-SVG face.
      avatar: (rngFor(seed, `face|${i}`)() * 1e9) >>> 0,
    });
  }
  // Potential: z(Physical vs the class) blended with his own draw.
  const pc = cfg.potential;
  const mean = recruits.reduce((a, x) => a + x.phy, 0) / recruits.length;
  const sd = Math.sqrt(recruits.reduce((a, x) => a + (x.phy - mean) ** 2, 0) / recruits.length) || 1;
  const rho = pc.athleticCorr;
  recruits.forEach((x) => {
    const z = rho * ((x.phy - mean) / sd) + Math.sqrt(1 - rho * rho) * normal(rngFor(seed, `pot|${x.i}`));
    x.pot = clamp(Math.round(pc.center + pc.sd * z), pc.clamp[0], pc.clamp[1]);
    delete x.phy;
  });
  // Position ranks.
  const posSeen = {};
  recruits.forEach((x) => { posSeen[x.pos] = (posSeen[x.pos] || 0) + 1; x.posRank = posSeen[x.pos]; });
  return recruits;
}

