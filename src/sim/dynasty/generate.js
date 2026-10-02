// src/sim/dynasty/generate.js
// ── League generator: 32 teams × 53 players, deterministic from a seed.
//
// Talent is layered so it looks like the real league:
//   • each team has a talent level (normal across the league) that lifts or
//     sinks its whole roster a few points
//   • each roster slot has an expected level — starters around 75 OVR,
//     the first backup ~6 below, deep reserves 13–15 below
//   • each player's own talent is normal around that
//   • each attribute is normal around his position's starter mean, moved
//     by his talent and by his body (heavier = slower and stronger, taller
//     = better in contested catches), with its own noise on top
// Every rating is 1–99, eased above 90 so 99s stay rare. Names are a random first name and a
// random last name from the site's player databases, never a real pairing. ──

import { POSITION_ATTRS, ROSTER_SHAPE, OVR_WEIGHTS, starterMean, overall } from "./attributes.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Above 90 a rating eases toward 99 instead of piling up there: a 99 is a
// once-in-a-league outlier, not every fast receiver.
const soften = (v) => (v <= 90 ? v : 90 + 9.5 * (1 - Math.exp(-(v - 90) / 9)));

// Height (in) / weight (lb) by position: mean, SD — from the site's
// historical draft/combine database (DB split into CB and S, OL into
// tackle / guard / center).
export const DEFAULT_MEASURABLES = {
  QB: { h: [74.8, 1.7], w: [220, 10] },
  RB: { h: [70.7, 1.8], w: [214, 14.6] },
  WR: { h: [72.6, 2.3], w: [200, 15.8] },
  TE: { h: [76.6, 1.2], w: [251, 7.9] },
  OT: { h: [77.6, 1.2], w: [315, 11] },
  OG: { h: [76.3, 1.1], w: [316, 11] },
  C: { h: [75.6, 1.1], w: [305, 10] },
  EDGE: { h: [75.9, 1.3], w: [265, 17] },
  DL: { h: [75.1, 1.5], w: [308, 17.3] },
  LB: { h: [73.9, 1.5], w: [239, 12.1] },
  CB: { h: [71.5, 1.5], w: [192, 8.5] },
  S: { h: [72.5, 1.4], w: [206, 9] },
  K: { h: [72, 2.8], w: [202, 18] },
  P: { h: [73.8, 2.1], w: [212, 16] },
  LS: { h: [75, 1], w: [240, 8] },
};

// Rating points above/below an average starter, by depth-chart slot.
const BACKUP_DROP = [-6, -10, -13, -15, -16];
const TEAM_SPREAD = 3; // rating points per SD of team talent
const PLAYER_SD = 6.5; // spread of individual talent around his slot
const ATTR_SD = 6; // attribute-level noise (profiles differ: a burner with bad hands)

// How much of a player's talent shows up in an attribute: fully in what
// defines his position (the OVR-weighted ones), partly in the rest.
function loading(pos, attr) {
  const w = (OVR_WEIGHTS[pos] || {})[attr] || 0;
  return 0.45 + 0.55 * Math.min(1, w / 1.5);
}

// Body → ratings, per unit above the position's average body.
function bodyShift(attr, dw, dh) {
  switch (attr) {
    case "longSpeed": return -0.22 * dw;
    case "explosiveness": return -0.1 * dw;
    case "cod": return -0.12 * dw - 0.6 * dh;
    case "saq": return -0.08 * dw - 0.4 * dh;
    case "strength": return 0.28 * dw;
    case "contestedCatch": return 1.6 * dh + 0.05 * dw;
    case "contactBalance": return 0.12 * dw - 0.4 * dh;
    case "passBlockPower": case "powerRush": case "runBlock": case "runDefense": return 0.1 * dw;
    default: return 0;
  }
}

const NUMBERS = {
  QB: [1, 19], RB: [20, 49], WR: [10, 19, 80, 89], TE: [80, 89, 40, 49], OT: [60, 79], OG: [60, 79], C: [50, 79],
  EDGE: [90, 99, 50, 59], DL: [90, 99, 70, 79], LB: [40, 59], CB: [20, 39], S: [20, 49], K: [1, 19], P: [1, 19], LS: [40, 69],
};

function jersey(pos, used, rng) {
  const r = NUMBERS[pos];
  const pool = [];
  for (let i = 0; i < r.length; i += 2) for (let n = r[i]; n <= r[i + 1]; n++) if (!used.has(n)) pool.push(n);
  const all = [];
  for (let n = 1; n <= 99; n++) if (!used.has(n)) all.push(n);
  const src = pool.length ? pool : all;
  const n = src[Math.floor(rng() * src.length)];
  used.add(n);
  return n;
}

// First/last pools from the name databases. Suffixes (Jr, III) come off so
// they can't end up on a random first name; real first+last pairs are kept
// out so no generated player is a real person.
const SUFFIX = /\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i;
export function namePools(people) {
  const firsts = new Set();
  const lasts = new Set();
  const real = new Set();
  for (const p of people) {
    const f = String(p.first || "").trim();
    const l = String(p.last || "").trim().replace(SUFFIX, "");
    if (/^[A-Za-z][A-Za-z'.-]{1,14}$/.test(f)) firsts.add(f);
    if (/^[A-Za-z][A-Za-z' .-]{1,18}$/.test(l)) lasts.add(l);
    real.add(`${f} ${l}`.toLowerCase());
  }
  return { firsts: [...firsts].sort(), lasts: [...lasts].sort(), real };
}

// college: ages 18–23 and years in the program (Fr → Sr) instead of an NFL
// career.
export function generateLeague({ teams, names, measurables = DEFAULT_MEASURABLES, seed = 2026, college = false }) {
  const rng = mulberry32(seed);
  const taken = new Set();
  const newName = () => {
    for (let i = 0; i < 50; i++) {
      const first = names.firsts[Math.floor(rng() * names.firsts.length)];
      const last = names.lasts[Math.floor(rng() * names.lasts.length)];
      const key = `${first} ${last}`.toLowerCase();
      if (names.real.has(key) || taken.has(key)) continue;
      taken.add(key);
      return { first, last };
    }
    throw new Error("name pool exhausted");
  };

  const out = {};
  for (const abbr of teams) {
    const teamZ = clamp(gauss(rng), -2.2, 2.2);
    const used = new Set();
    const players = [];
    let n = 0;
    for (const [pos, shape] of Object.entries(ROSTER_SHAPE)) {
      const M = measurables[pos];
      const group = [];
      for (let slot = 0; slot < shape.count; slot++) {
        const drop = slot < shape.starters ? 0 : BACKUP_DROP[Math.min(BACKUP_DROP.length - 1, slot - shape.starters)];
        const talent = drop + TEAM_SPREAD * teamZ + PLAYER_SD * gauss(rng);
        // Body: height and weight correlate (r ≈ 0.5).
        const zh = gauss(rng);
        const zw = 0.5 * zh + Math.sqrt(0.75) * gauss(rng);
        const height = Math.round(clamp(M.h[0] + M.h[1] * zh, M.h[0] - 3 * M.h[1], M.h[0] + 3 * M.h[1]));
        const weight = Math.round(clamp(M.w[0] + M.w[1] * zw, M.w[0] - 3 * M.w[1], M.w[0] + 3 * M.w[1]));
        const dh = height - M.h[0];
        const dw = weight - M.w[0];
        const ratings = {};
        for (const a of POSITION_ATTRS[pos]) {
          const v = starterMean(pos, a) + talent * loading(pos, a) + bodyShift(a, dw, dh) + ATTR_SD * gauss(rng);
          ratings[a] = Math.round(clamp(soften(v), 1, 99));
        }
        // Age: backups skew young (rookies, second-years), starters are in
        // their prime, a few veterans hang on.
        let age;
        let exp;
        if (college) {
          // Starters are upperclassmen more often than not.
          exp = Math.round(clamp((slot < shape.starters ? 2.4 : 1.1) + 1.1 * gauss(rng), 0, 4));
          age = 18 + exp + (rng() < 0.35 ? 1 : 0);
        } else {
          age = Math.round(clamp((slot < shape.starters ? 27 : 24.5) + 2.6 * gauss(rng), 21, pos === "K" || pos === "P" || pos === "LS" ? 40 : 36));
          exp = Math.max(0, Math.min(age - 21, Math.round(age - 22.5 + gauss(rng))));
        }
        const { first, last } = newName();
        group.push({
          id: `${abbr}-${String(++n).padStart(2, "0")}`,
          first, last, pos, number: jersey(pos, used, rng),
          age, exp, height, weight, ratings, ovr: overall(pos, ratings),
        });
      }
      // Depth chart order at a position: best first.
      group.sort((a, b) => b.ovr - a.ovr).forEach((p, i) => (p.depth = i + 1));
      players.push(...group);
    }
    out[abbr] = { abbr, talent: +teamZ.toFixed(2), players };
  }
  return { version: 1, seed, college, generatedAt: new Date().toISOString(), teams: out };
}
