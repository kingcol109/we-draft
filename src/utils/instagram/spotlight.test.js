import { scoutingReport, spotlightInput, spotlightSlides, spotlightFrame, FRAME_WINDOW, heightText, measurementsOf, espnStats } from "./spotlight";

const env = { measure: (t, size) => String(t).length * size * 0.45, images: {} };
const player = { id: "p1", First: "Mark", Last: "Bowman", Position: "TE", School: "USC", Eligible: "2029", Height: "6'5\"", Weight: "245", Slug: "mark-bowman-2029-te" };

test("the report: average grade, traits on the side more evaluations put them, fits", () => {
  const evaluations = [
    { grade: "Early First Round", strengths: ["Hands", "Speed"], weaknesses: ["Blocking"], nflFit: "New York Jets", updatedAtMs: Date.UTC(2026, 9, 1) },
    { grade: "Second Round", strengths: ["Hands"], weaknesses: ["Speed"], nflFit: "New York Jets", updatedAtMs: Date.UTC(2026, 9, 2) },
    // Before the 2027 class's window (gradeWindow.js): not counted in the grade.
    { grade: "UDFA", updatedAtMs: Date.UTC(2025, 0, 1) },
    { grade: "Watchlist" },
  ];
  const r = scoutingReport({
    player: { ...player, Eligible: "2027" }, evaluations, nflFits: [{ t: "DEN" }],
    branding: { NYJ: { Logo1: "nyj.png" }, DEN: { Logo1: "den.png" } }, teamNames: { NYJ: "New York Jets", DEN: "Denver Broncos" },
    classSnap: { rows: [{ i: "p0", cr: 4 }, { i: "p1", cr: 9 }], classSize: 300 },
  });
  expect(r.grade.avg).toBeCloseTo(2.5);
  expect(r.grade.label).toBe("Late First Round");
  expect(r.strengths.map((s) => s.term)).toEqual(["Hands", "Speed"]);
  expect(r.weaknesses.map((s) => s.term)).toEqual(["Blocking"]);
  expect(r.fits.map((f) => f.logo)).toEqual(["den.png", "nyj.png"]);
  expect(r).toMatchObject({ evals: 4, bars: false, posRank: 2, posOf: 2, classRank: 9, classOf: 300 });
});

test("no grades is the Watchlist", () => {
  const r = scoutingReport({ player, evaluations: [] });
  expect(r.grade).toMatchObject({ label: "Watchlist", short: "W", avg: null });
});

test("measurements read as the player page shows them", () => {
  expect(heightText("6'2.5\"")).toBe("6'2 1/2\"");
  expect(measurementsOf({ Height: "6'5\"", Weight: "245", "Arm Length": "33.25" })).toEqual([
    { label: "HEIGHT", val: "6'5\"" }, { label: "WEIGHT", val: "245 LBS" }, { label: "ARM", val: "33 1/4\"" },
  ]);
});

test("the cover photo moves and scales about his feet as the admin sets it", () => {
  const photo = "shot.png";
  const images = { [photo]: { href: "data:image/png;base64,AA", w: 9, h: 16 } };
  const report = scoutingReport({ player, evaluations: [] });
  const cover = (adjust) => spotlightSlides({ ...spotlightInput({ player, report, photo: { url: photo } }), adjust }, { ...env, images })[0].svg;
  expect(cover()).not.toContain("scale(");
  expect(cover({ x: 0, y: 0, scale: 1 })).not.toContain("scale(");
  // The photo's box is 40, 96, 1000 × 930: its foot at (540, 1026).
  expect(cover({ x: 30, y: -20, scale: 1.5 })).toContain('transform="translate(570 1006) scale(1.5) translate(-540 -1026)"');
  // Held to PHOTO_SCALE.
  expect(cover({ scale: 9 })).toContain("scale(2.5)");
});

test("three slides; the ADVANCE SCOUTING badge only when asked", () => {
  const report = scoutingReport({ player, evaluations: [] });
  const withBadge = spotlightSlides(spotlightInput({ player, report, advance: true }), env);
  expect(withBadge.map((s) => s.name)).toEqual(["cover", "scouting-report", "evaluate"]);
  expect(withBadge[2].svg).toContain("MARK BOWMAN?");
  expect(withBadge[2].svg).toContain("WE-DRAFT.COM/PLAYER/MARK-BOWMAN-2029-TE");
  expect(withBadge[0].svg).toContain("ADVANCE");
  expect(withBadge[0].svg).toContain(">2029<");
  expect(withBadge[0].svg).toContain("245 LBS");
  expect(withBadge[1].svg).toContain("COMMUNITY GRADE");
  const plain = spotlightSlides(spotlightInput({ player: { ...player, Eligible: "2027" }, report }), env);
  expect(plain[0].svg).not.toContain("ADVANCE");
  expect(plain[0].svg).not.toContain("NFL DRAFT PROSPECT");
  // His class's logo top right, in place of the drawn badge.
  const logoEnv = { ...env, images: { "class-2029.png": { href: "data:image/png;base64,AA", w: 1000, h: 1000 } } };
  const withLogo = spotlightSlides(spotlightInput({ player, report, advance: true, classLogo: "class-2029.png" }), logoEnv);
  expect(withLogo[0].svg).toContain('href="data:image/png;base64,AA"');
  expect(withLogo[0].svg).not.toContain("ADVANCE");
});

test("the report shows class rank unless turned off, NFL fits only when turned on", () => {
  const images = { "den.png": { href: "data:image/png;base64,AA", w: 1, h: 1 } };
  const report = { ...scoutingReport({ player, evaluations: [] }), posRank: 3, posOf: 40, fits: [{ name: "Denver Broncos", logo: "den.png" }] };
  const slide = (opts) => spotlightSlides(spotlightInput({ player, report, ...opts }), { ...env, images })[1].svg;
  expect(slide()).toContain("CLASS RANK");
  expect(slide()).not.toContain("NFL FITS");
  expect(slide({ showRanks: false })).not.toContain("CLASS RANK");
  expect(slide({ showFits: true })).toContain("NFL FITS");
});

test("the highlight frame: no backdrop of its own, the window cut out, his name and FILM", () => {
  const svg = spotlightFrame(spotlightInput({ player, report: scoutingReport({ player, evaluations: [] }) }), env);
  const { x, y, w, h } = FRAME_WINDOW;
  expect(svg).toContain(`<mask id="window">`);
  expect(svg).toContain(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="28" fill="#000000"/>`);
  // The only full-canvas paint is inside the mask (the window stays clear).
  const body = svg.split("</defs>")[1];
  expect(body.startsWith('<g mask="url(#window)"><rect width="1080" height="1350"')).toBe(true);
  expect(body.split('<rect width="1080" height="1350"').length).toBe(2);
  expect(svg).toContain(">FILM<");
  expect(svg).toContain(">BOWMAN<");
});

test("the stats slide: ESPN's career cut to his position, after the report", () => {
  const json = {
    teams: { "lsu-tigers": { id: "99", abbreviation: "LSU" }, "auburn-tigers": { id: "2", abbreviation: "AUB" } },
    categories: [
      { name: "defensive", labels: ["TOT", "SOLO", "AST", "PD", "SACK", "FF", "INT", "YDS", "TD"], totals: ["124", "87", "37", "1", "12", "2", "2", "74", "0"],
        statistics: [
          { season: { year: 2025 }, teamSlug: "auburn-tigers", stats: ["84", "60", "24", "1", "9", "2", "1", "73", "0"] },
          { season: { year: 2024 }, teamSlug: "lsu-tigers", stats: ["3", "1", "2", "0", "0", "0", "0", "0", "0"] },
          { season: { year: 2026 }, teamId: 2, stats: ["37", "26", "11", "0", "3", "0", "1", "1", "0"] },
        ] },
      { name: "scoring", labels: ["TD"], statistics: [{ season: { year: 2026 }, stats: ["0"] }] },
    ],
  };
  const st = espnStats(json, "LB", { 2026: { defensive: { TOT: "T-554", SACKS: "9" }, interceptions: { INT: "T-30" } } });
  expect(st.table.cols).toEqual(["TOT", "SOLO", "SACK", "PD", "INT", "FF"]);
  expect(st.table.rows.map((r) => `${r.year} ${r.team}`)).toEqual(["2024 LSU", "2025 AUB", "2026 AUB"]);
  expect(st.table.career).toEqual(["124", "87", "12", "1", "2", "2"]);
  // Ranks only when they're high (top 25).
  expect(st.hero).toEqual({ year: "2026", team: "AUB", tiles: [
    { label: "TACKLES", value: "37", rank: "" }, { label: "SACKS", value: "3", rank: "9" },
    { label: "INTERCEPTIONS", value: "1", rank: "" }, { label: "PASSES DEFENDED", value: "0", rank: "" },
  ] });
  // A running back: no season table, just his career rushing.
  const rbJson = { teams: json.teams, categories: [{ name: "rushing", labels: ["CAR", "YDS", "AVG", "TD", "LNG"], totals: ["300", "1800", "6.0", "20", "80"],
    statistics: [{ season: { year: 2025 }, teamSlug: "auburn-tigers", stats: ["150", "800", "5.3", "8", "60"] }, { season: { year: 2026 }, teamSlug: "auburn-tigers", stats: ["150", "1000", "6.7", "12", "80"] }] }] };
  const rb = espnStats(rbJson, "RB", { 2026: { rushing: { YDS: "4", TD: "T-11" } } });
  expect(rb.table).toBeUndefined();
  expect(rb.career).toEqual({ title: "CAREER RUSHING", seasons: 2, tiles: [{ label: "CARRIES", value: "300" }, { label: "YARDS", value: "1800" }, { label: "YDS / CARRY", value: "6.0" }, { label: "TOUCHDOWNS", value: "20" }] });
  expect(rb.hero.tiles.map((t) => `${t.value}:${t.rank}`)).toEqual(["1000:4", "12:T-11", "6.7:", "150:"]);
  expect(spotlightSlides(spotlightInput({ player, report: scoutingReport({ player, evaluations: [] }), stats: rb }), env)[2].svg).toContain("#T-11 IN FBS");
  // No stats line for an O-lineman; no categories, no slide.
  expect(espnStats(json, "OL")).toBe(null);
  expect(espnStats({ categories: [] }, "LB")).toBe(null);

  const base = { player, report: scoutingReport({ player, evaluations: [] }) };
  expect(spotlightSlides(spotlightInput(base), env).map((s) => s.name)).toEqual(["cover", "scouting-report", "evaluate"]);
  const slides = spotlightSlides(spotlightInput({ ...base, stats: st }), env);
  expect(slides.map((s) => s.name)).toEqual(["cover", "scouting-report", "stats", "evaluate"]);
  expect(slides[2].svg).toContain(">CAREER<");
  expect(slides[2].svg).not.toContain("undefined");
  expect(slides[2].svg).not.toContain("NaN");
  // Switched off: back to three.
  expect(spotlightSlides(spotlightInput({ ...base, stats: st, showStats: false }), env)).toHaveLength(3);
});
