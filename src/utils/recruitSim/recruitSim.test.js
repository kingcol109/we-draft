// Recruit Sim acceptance tests (spec §32) — the engine headless, on a small
// synthetic school field so a whole season runs in a few seconds.
//   npx react-scripts test --watchAll=false src/utils/recruitSim
import source from "./source.json";
import { initSave, advance, classRankings } from "./engine";
import { STAGES, STAGE_COUNT, DEFAULT_CONFIG } from "./config";
import { TRAIT_MAP, KT, POT_SLOT, K_EXACT, isRange, overallOf, gradeOf, rangeFor, rangeLabel, categoryValues } from "./traits";
import { regionOfState } from "./regions";
import { scoutRoll } from "./scouting";
import { runSchool, bondMult, bondAt, BOND_UNIT } from "./work";
import { addToBoard, removeFromBoard, placeOnLine, setOffer, assignStaff, advanceCheck, nilOutstanding } from "./actions";
import { rngFor } from "./rng";
import { computeStandings } from "./model";
import { cpuPlan, cpuBias } from "./cpu";
import { commitRecruit } from "./lifecycle";
import { jumpSoFar, jumpOf, trendOf } from "./development";
import { classReport } from "./grading";

// 40 schools spread over the map, eight per tier.
const SPOTS = [[33.2, -87.5], [30.4, -84.3], [40.0, -83.0], [30.3, -97.7], [34.0, -118.3], [42.3, -83.7], [33.9, -83.4], [36.0, -78.9], [41.7, -86.2], [40.8, -77.9],
  [29.6, -82.3], [35.2, -101.8], [39.1, -94.6], [47.6, -122.3], [44.9, -93.2], [32.8, -96.8], [38.0, -84.5], [42.4, -71.1], [36.1, -115.1], [39.7, -105.0]];
const TEAMS = Array.from({ length: 40 }, (_, i) => ({ slug: `school-${i}`, school: `School ${i}`, conference: "Test", loc: SPOTS[i % SPOTS.length].map((v, k) => v + (k ? 0.7 : 0.4) * Math.floor(i / SPOTS.length)) }));
const TIERS = Object.fromEntries(TEAMS.map((t, i) => [t.slug, 1 + Math.floor(i / 8)]));
const make = (over = {}, seed = 11) => initSave({ source, teams: TEAMS, tiers: TIERS, factors: {}, defaultTier: () => 5, config: { classSize: 1000, ...over }, userSlug: "school-0", seed });
const toStage = (st, key) => { while (STAGES[st.stage].key !== key) advance(st); return st; };

describe("recruit generation", () => {
  const st = make({ classSize: 3000 });
  test("3,000 recruits, stable ids, public + hidden info", () => {
    expect(st.recruits).toHaveLength(3000);
    expect(new Set(st.recruits.map((x) => x.id)).size).toBe(3000);
    st.recruits.forEach((x, i) => {
      expect(x.rank).toBe(i + 1);
      expect(x.first && x.last && x.hs && x.city && x.st).toBeTruthy();
      expect(x.t).toHaveLength(TRAIT_MAP[x.pos].length);
      expect(x.ht).toBeGreaterThanOrEqual(64);
      expect(x.ht).toBeLessThanOrEqual(81);
      expect(x.wt).toBeGreaterThanOrEqual(150);
      expect(x.region).toBe(regionOfState(x.st));
      expect(Math.abs(overallOf(x.pos, x.t) - x.ovr)).toBeLessThan(1e-6);
    });
  });
  test("plausible bodies by position", () => {
    const avg = (pos, k) => { const l = st.recruits.filter((x) => x.pos === pos); return l.reduce((a, x) => a + x[k], 0) / l.length; };
    expect(avg("OL", "wt")).toBeGreaterThan(avg("DB", "wt") + 80);
    expect(avg("WR", "ht")).toBeGreaterThan(avg("RB", "ht"));
  });
  test("meaningful over- and under-rated prospects exist, most are close", () => {
    const gaps = st.recruits.map((x) => x.ovr - x.rating);
    expect(gaps.filter((g) => g >= 6).length).toBeGreaterThan(20);
    expect(gaps.filter((g) => g <= -6).length).toBeGreaterThan(20);
    expect(gaps.filter((g) => Math.abs(g) < 4).length / gaps.length).toBeGreaterThan(0.7);
  });
  test("no duplicate full names", () => {
    expect(new Set(st.recruits.map((x) => `${x.first} ${x.last}`)).size).toBe(3000);
  });
});

describe("grade ranges", () => {
  test("ranges are two adjacent families containing the true grade", () => {
    const cuts = DEFAULT_CONFIG.gradeCuts;
    for (let v = 40; v <= 100; v += 1) {
      const g = gradeOf(v, cuts);
      [0, 1].forEach((hi) => { expect(rangeLabel(rangeFor(g, hi))).toContain(g[0]); });
    }
    expect(rangeLabel(rangeFor("A+", 1))).toBe("A–B");
    expect(rangeLabel(rangeFor("F", 0))).toBe("D–F");
  });
});

describe("scouting", () => {
  test("regional rolls never reveal exact grades", () => {
    const st = make();
    const rand = rngFor(1, "t");
    for (let i = 0; i < 400; i += 1) scoutRoll(st, 3, 5, false, rand, null);
    const base = (3 * st.N + 5) * KT;
    for (let k = 0; k < TRAIT_MAP[st.recruits[5].pos].length; k += 1) expect(st.know[base + k]).not.toBe(K_EXACT);
  });
  test("individual rolls can go unknown → exact in one window", () => {
    let exactInOne = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const st = make({}, seed);
      const rand = rngFor(seed, "t");
      for (let i = 0; i < 12; i += 1) scoutRoll(st, 0, 0, true, rand, null);
      const base = 0;
      if (Array.from(st.know.slice(base, base + POT_SLOT)).includes(K_EXACT)) exactInOne += 1;
    }
    expect(exactInOne).toBeGreaterThan(15);
  });
  test("knowledge is per school", () => {
    const st = make();
    const rand = rngFor(2, "t");
    for (let i = 0; i < 12; i += 1) scoutRoll(st, 0, 7, true, rand, null);
    const other = (1 * st.N + 7) * KT;
    expect(Array.from(st.know.slice(other, other + KT)).every((k) => k === 0)).toBe(true);
  });
  test("potential: about 1 look in 500", () => {
    const st = make();
    const rand = rngFor(3, "t");
    const out = [];
    for (let k = 0; k < 15000; k += 1) scoutRoll(st, 0, k % st.N, false, rand, out);
    const pot = out.filter((c) => c.slot === POT_SLOT).length;
    expect(pot).toBeGreaterThan(12);
    expect(pot).toBeLessThan(55);
  });
  test("potential: correlated with Physical, not defined by it; spread across grades", () => {
    const st = make();
    const xs = st.recruits.map((x) => categoryValues(x.pos, x.t).phy);
    const ys = st.recruits.map((x) => x.pot);
    const m = (a) => a.reduce((p, v) => p + v, 0) / a.length;
    const mx = m(xs); const my = m(ys);
    let num = 0; let dx = 0; let dy = 0;
    xs.forEach((v, i) => { num += (v - mx) * (ys[i] - my); dx += (v - mx) ** 2; dy += (ys[i] - my) ** 2; });
    const corr = num / Math.sqrt(dx * dy);
    expect(corr).toBeGreaterThan(0.4);
    expect(corr).toBeLessThan(0.7);
    const fams = new Set(st.recruits.map((x) => gradeOf(x.pot, st.cfg.gradeCuts)[0]));
    ["A", "B", "C", "D", "F"].forEach((f) => expect(fams.has(f)).toBe(true));
  });
  test("exact grades aren't wasted on", () => {
    const st = make();
    const rand = rngFor(4, "t");
    const x = st.recruits[9];
    const base = (0 * st.N + 9) * KT;
    for (let k = 0; k < TRAIT_MAP[x.pos].length - 1; k += 1) st.know[base + k] = K_EXACT;
    let hitsLast = 0;
    for (let i = 0; i < 50; i += 1) { st.know[base + TRAIT_MAP[x.pos].length - 1] = 0; const c = scoutRoll(st, 0, 9, true, rand, null); if (c && c.slot === TRAIT_MAP[x.pos].length - 1) hitsLast += 1; }
    expect(hitsLast).toBeGreaterThan(30);
  });
  test("board scouting: 2–3 rolls per recruit per window (+1 close to campus)", () => {
    const st = toStage(make(), "spring");
    const s = st.user;
    st.schools[s].staff = [null, null, null, null, null, null];
    st.schools[s].board = [];
    for (let r = 0; r < 25; r += 1) addToBoard(st, s, r);
    const rep = { gain: {}, why: {}, scout: { board: [] }, staff: {}, cuts: [] };
    const beforeKnown = st.recruits.slice(0, 25).map((x) => Array.from(st.know.slice((s * st.N + x.i) * KT, (s * st.N + x.i) * KT + KT)).filter(Boolean).length);
    runSchool(st, s, rep);
    expect(rep.scout.board.length).toBeLessThanOrEqual(25 * 4);
    const per = {};
    rep.scout.board.forEach((c) => { per[c.r] = (per[c.r] || 0) + 1; });
    Object.values(per).forEach((n) => expect(n).toBeLessThanOrEqual(4));
    expect(beforeKnown.length).toBe(25);
  });
});

describe("staff", () => {
  test("coaches build interest; scouts reveal, build less interest, never recommend", () => {
    const st = toStage(make(), "spring");
    const s = st.user;
    const sc = st.schools[s];
    sc.board = []; sc.above = [];
    const off = st.recruits.find((x) => x.pos === "QB" && x.commit < 0).i;
    const def = st.recruits.find((x) => x.pos === "LB" && x.commit < 0 && x.i !== off).i;
    sc.staff = [null, null, null, null, null, null];
    expect(assignStaff(st, s, "HC", { kind: "recruit", r: off }).ok).toBe(true);
    expect(assignStaff(st, s, "HS", { kind: "recruit", r: def }).ok).toBe(true);
    const i0 = st.interest[s * st.N + off];
    const d0 = st.interest[s * st.N + def];
    const recBefore = st.recMask[s * st.N + def];
    runSchool(st, s, null);
    expect(st.interest[s * st.N + off]).toBeGreaterThan(i0);
    // Scouts build a little interest — less than a coach (user, 2026-11-18).
    expect(st.interest[s * st.N + def] - d0).toBeGreaterThan(0);
    expect(st.interest[s * st.N + def] - d0).toBeLessThan(st.interest[s * st.N + off] - i0);
    expect(st.recMask[s * st.N + def]).toBe(recBefore);
    const k = Array.from(st.know.slice((s * st.N + def) * KT, (s * st.N + def) * KT + KT)).filter(Boolean).length;
    expect(k).toBeGreaterThan(0);
  });
  test("winter: areas only; spring: individuals; coordinators can cross over, less well", () => {
    const st = make();
    expect(assignStaff(st, st.user, "HC", { kind: "recruit", r: 1 }).error).toBeTruthy();
    expect(assignStaff(st, st.user, "HC", { kind: "area", region: "SE", pos: "ALL" }).ok).toBe(true);
    expect(assignStaff(st, st.user, "OS", { kind: "area", region: "SE", pos: "LB" }).error).toBeTruthy();
    advance(st);
    const qb = st.recruits.find((x) => x.pos === "QB" && x.commit < 0).i;
    expect(assignStaff(st, st.user, "DC", { kind: "recruit", r: qb }).ok).toBe(true);
    expect(assignStaff(st, st.user, "DS", { kind: "recruit", r: qb }).ok).toBe(true); // scouts can cross over (5 rolls)
    expect(bondMult(st, st.user, "DC", qb)).toBeLessThan(bondMult(st, st.user, "OC", qb));
  });
  test("relationships: the same staffer on the same kid lands more every window", () => {
    const st = toStage(make(), "spring");
    const s = st.user;
    const sc = st.schools[s];
    sc.board = []; sc.above = [];
    const r = st.recruits.find((x) => x.pos === "WR" && x.commit < 0).i;
    const gains = [];
    for (let w = 0; w < 4; w += 1) {
      sc.staff = [null, null, null, null, null, null];
      assignStaff(st, s, "OC", { kind: "recruit", r });
      const i0 = st.interest[s * st.N + r];
      runSchool(st, s, null);
      gains.push(st.interest[s * st.N + r] - i0);
    }
    expect(gains[3]).toBeGreaterThan(gains[0] * 1.3);
    expect(st.bond[bondAt(st, s, r) + 1]).toBe(4 * BOND_UNIT);
  });
  test("relationships: regional contact builds them too, a quarter of one-on-one", () => {
    const st = toStage(make(), "spring");
    const s = st.user;
    st.schools[s].staff = [null, null, null, null, null, null];
    assignStaff(st, s, "HC", { kind: "area", region: "SE", pos: "ALL" });
    assignStaff(st, s, "HS", { kind: "area", region: "SE", pos: "ALL" });
    runSchool(st, s, null);
    const touched = st.recruits.filter((x) => st.bond[bondAt(st, s, x.i)] > 0);
    expect(touched.length).toBeGreaterThan(10);
    touched.forEach((x) => { expect(x.region).toBe("SE"); expect(st.bond[bondAt(st, s, x.i)]).toBe(1); });
    expect(st.recruits.some((x) => st.bond[bondAt(st, s, x.i) + 3] === 1)).toBe(true);
    expect(bondMult(st, s, "HC", touched[0].i)).toBeGreaterThan(1);
  });
  test("area coaches reach recruits in the region and sometimes recommend", () => {
    const st = make({}, 5);
    let recs = 0;
    for (let w = 0; w < 6; w += 1) {
      ["HC", "OC", "DC"].forEach((role, k) => assignStaff(st, st.user, role, { kind: "area", region: ["TX", "SE", "W"][k], pos: "ALL" }));
      const rep = { gain: {}, why: {}, scout: { board: [] }, staff: {}, cuts: [] };
      st.stage = 0;
      runSchool(st, st.user, rep);
      Object.keys(rep.gain).forEach((r) => expect(["TX", "SE", "W"]).toContain(st.recruits[r].region));
      recs += ["HC", "OC", "DC"].reduce((a, r) => a + rep.staff[r].recs.length, 0);
    }
    expect(recs).toBeGreaterThan(0);
  });
});

describe("calendar and board", () => {
  test("16 stages; Signing Day is its own stage after Fall Week 12", () => {
    expect(STAGE_COUNT).toBe(16);
    expect(STAGES[14].label).toBe("Fall Week 12");
    expect(STAGES[15].key).toBe("signing");
  });
  test("board sizes and line by window", () => {
    const st = make();
    const s = st.user;
    expect(addToBoard(st, s, 0).error).toBeTruthy(); // winter
    advance(st); // spring
    const sc = st.schools[s];
    sc.board.slice().forEach((r) => removeFromBoard(st, s, r));
    const open = st.recruits.filter((x) => x.commit < 0).map((x) => x.i);
    open.slice(0, 10).forEach((r) => expect(addToBoard(st, s, r).ok).toBe(true));
    expect(addToBoard(st, s, open[10]).error).toBeTruthy(); // spring board: 10
    expect(placeOnLine(st, s, open[0], 0).error).toBeTruthy(); // no line in spring
    advance(st); // summer
    expect(st.schools[s].staff.every((a) => a === null)).toBe(true); // staff come home each window
    expect(advanceCheck(st, s).warns.some((w) => /above the line/.test(w))).toBe(true); // the line is optional
    const more0 = st.recruits.filter((x) => x.commit < 0 && !sc.board.includes(x.i)).map((x) => x.i);
    more0.slice(0, 15).forEach((r) => expect(addToBoard(st, s, r).ok).toBe(true)); // summer: 25
    expect(addToBoard(st, s, more0[15]).error).toBeTruthy();
    for (let k = 0; k < 10; k += 1) expect(placeOnLine(st, s, sc.board[k], k).ok).toBe(true);
    expect(placeOnLine(st, s, sc.board[10], 10).error).toBeTruthy();
    sc.above.forEach((r) => setOffer(st, s, r, st.cfg.minOffer));
    expect(advanceCheck(st, s).blocks).toEqual([]);
    advance(st); // fall week 1
    expect(STAGES[st.stage].key).toBe("fall1");
    const more = st.recruits.filter((x) => x.commit < 0 && !sc.board.includes(x.i)).map((x) => x.i);
    const room = 35 - sc.board.length;
    more.slice(0, room).forEach((r) => expect(addToBoard(st, s, r).ok).toBe(true));
    expect(addToBoard(st, s, more[room]).error).toBeTruthy();
    sc.board.slice(0, 25).forEach((r, k) => placeOnLine(st, s, r, k));
    expect(sc.above.length).toBe(25);
    expect(placeOnLine(st, s, sc.board[30], 25).error).toBeTruthy();
  });
});

describe("NIL", () => {
  test("tier budgets, hard cap, release and spend", () => {
    const st = toStage(make(), "summer");
    st.schools.forEach((sc) => expect(sc.budget).toBe(DEFAULT_CONFIG.budgets[sc.tier]));
    const s = st.user;
    const sc = st.schools[s];
    sc.board.slice().forEach((r) => removeFromBoard(st, s, r));
    const open = st.recruits.filter((x) => x.commit < 0).map((x) => x.i).slice(0, 3);
    open.forEach((r, k) => { addToBoard(st, s, r); placeOnLine(st, s, r, k); });
    expect(setOffer(st, s, open[0], sc.budget + 10000).error).toBeTruthy();
    expect(setOffer(st, s, open[0], 1000000).ok).toBe(true);
    expect(setOffer(st, s, open[1], 2000000).ok).toBe(true);
    expect(nilOutstanding(sc)).toBe(3000000);
    expect(setOffer(st, s, open[2], sc.budget - 3000000 + 5000).error).toBeTruthy();
    // Removing releases.
    removeFromBoard(st, s, open[1]);
    expect(nilOutstanding(sc)).toBe(1000000);
    // Commit here → spent; commit elsewhere → released.
    commitRecruit(st, open[0], s);
    expect(sc.spent).toBe(1000000);
    expect(nilOutstanding(sc)).toBe(0);
    setOffer(st, s, open[2], 500000);
    commitRecruit(st, open[2], 1);
    expect(nilOutstanding(sc)).toBe(0);
    expect(sc.board.includes(open[2])).toBe(false);
  });
});

describe("full season", () => {
  const st = make({}, 21);
  const usc = st.schools[st.user];
  usc.bias = cpuBias(st, st.user);
  const rated0 = st.recruits.map((x) => [x.rating, x.stars, x.rank]);
  const finals = {};
  const lineAtCommit = [];
  while (st.stage < STAGE_COUNT) {
    cpuPlan(st, st.user); // the user's school on autopilot
    advance(st);
    st.events.forEach((e) => { if (e.k === "final") finals[e.r] = e.d.list; });
  }
  st.events.filter((e) => e.k === "commit").forEach((e) => lineAtCommit.push(e));

  test("CPU schools build boards, assign staff, offer NIL and sign players", () => {
    const cls = classRankings(st);
    expect(cls.filter((c) => c.n > 0).length).toBeGreaterThan(30);
    expect(st.events.filter((e) => e.k === "commit").length).toBeGreaterThan(400);
  });
  test("nobody signs below the line; finalists respected; nobody over budget or class limit", () => {
    expect(lineAtCommit.filter((e) => !(e.d.rank > 0))).toEqual([]);
    expect(lineAtCommit.filter((e) => e.d.list && finals[e.r] && !e.d.list.includes(e.s))).toEqual([]);
    st.schools.forEach((sc) => {
      expect(sc.spent + nilOutstanding(sc)).toBeLessThanOrEqual(sc.budget);
      expect(sc.commits.length).toBeLessThanOrEqual(st.cfg.classLimit);
    });
  });
  test("commitments spread through the fall and Signing Day", () => {
    const stages = new Set(lineAtCommit.map((e) => e.st));
    expect(Math.min(...stages)).toBeGreaterThanOrEqual(STAGES.findIndex((s) => s.key === "fall1"));
    expect(stages.size).toBeGreaterThan(6);
    expect(stages.has(15)).toBe(true);
  });
  test("no in-season trait changes; public ratings fixed", () => {
    st.recruits.forEach((x, i) => {
      expect([x.rating, x.stars, x.rank]).toEqual(rated0[i]);
      expect(x.t).toEqual(x.t0);
      expect(x.ovr).toBe(x.ovr0);
    });
  });
  test("commitment jump follows potential (high up, low down); everyone signed has one", () => {
    const signed = st.recruits.filter((x) => x.commit >= 0);
    signed.forEach((x) => { expect(typeof x.devJump).toBe("number"); expect(Math.abs(x.ovrDev - (x.ovr + x.devJump))).toBeLessThan(0.11); });
    st.recruits.filter((x) => x.commit < 0).forEach((x) => expect(x.devJump).toBeUndefined());
    const hi = signed.filter((x) => x.pot >= 93);
    const lo = signed.filter((x) => x.pot <= 66);
    const avg = (l) => l.reduce((a, x) => a + x.devJump, 0) / l.length;
    expect(avg(hi)).toBeGreaterThan(3);
    expect(avg(lo)).toBeLessThan(-3);
  });
  test("the jump plays out over the fall: none before, all of it by Signing Day", () => {
    st.recruits.slice(0, 300).forEach((x) => {
      expect(jumpSoFar(st, x, 0)).toBe(0);
      expect(Math.abs(jumpSoFar(st, x, 13) - jumpOf(st, x))).toBeLessThan(0.11);
    });
    st.recruits.filter((x) => Math.abs(jumpOf(st, x)) >= 4).forEach((x) => expect(Math.sign(trendOf(st, x, 12).dir)).toBe(Math.sign(jumpOf(st, x))));
  });
  test("decision dates: he names finalists a window ahead and picks one of them", () => {
    const ann = new Map();
    st.events.forEach((e) => { if (e.k === "announce") ann.set(e.r, e); });
    const viaDate = st.events.filter((e) => e.k === "commit" && e.d.how === "announce");
    expect(viaDate.length).toBeGreaterThan(st.N * 0.3);
    viaDate.forEach((e) => {
      const a = ann.get(e.r);
      expect(a).toBeTruthy();
      expect(a.d.list).toContain(e.s);
      expect(a.d.list.length).toBeLessThanOrEqual(3);
    });
  });
  test("class report card: five graded parts and an overall", () => {
    const rc = classReport(st, st.user);
    expect(rc.parts.map((p) => p.key)).toEqual(["talent", "nil", "needs", "eval", "size"]);
    rc.parts.forEach((p) => { expect(typeof p.grade).toBe("string"); expect(p.note.length).toBeGreaterThan(3); });
    expect(rc.grade).toMatch(/^[A-DF][+-]?$/);
  });
  test("ranges recorded stay consistent with live grades", () => {
    const s = st.user;
    const bad = [];
    st.recruits.forEach((x) => {
      const base = (s * st.N + x.i) * KT;
      TRAIT_MAP[x.pos].forEach((_, k) => {
        const code = st.know[base + k];
        if (isRange(code) && !rangeLabel(code - 2).includes(gradeOf(x.t[k], st.cfg.gradeCuts)[0])) bad.push([x.i, k]);
      });
    });
    expect(bad).toEqual([]);
  });
});

test("standings exist for every open recruit", () => {
  const st = make();
  computeStandings(st);
  expect(st.recruits.every((x) => Array.isArray(x.top))).toBe(true);
});
