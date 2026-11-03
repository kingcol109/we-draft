import { scoutingReport, spotlightInput, spotlightSlides, heightText, measurementsOf } from "./spotlight";

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

test("two slides; the ADVANCE SCOUTING badge only when asked", () => {
  const report = scoutingReport({ player, evaluations: [] });
  const withBadge = spotlightSlides(spotlightInput({ player, report, advance: true }), env);
  expect(withBadge.map((s) => s.name)).toEqual(["cover", "scouting-report"]);
  expect(withBadge[0].svg).toContain("ADVANCE");
  expect(withBadge[0].svg).toContain(">2029<");
  expect(withBadge[0].svg).toContain("245 LBS");
  expect(withBadge[1].svg).toContain("COMMUNITY GRADE");
  expect(withBadge[1].svg).toContain("WE-DRAFT.COM/PLAYER/MARK-BOWMAN-2029-TE");
  const plain = spotlightSlides(spotlightInput({ player: { ...player, Eligible: "2027" }, report }), env);
  expect(plain[0].svg).not.toContain("ADVANCE");
  expect(plain[0].svg).toContain("2027 NFL DRAFT PROSPECT");
});
