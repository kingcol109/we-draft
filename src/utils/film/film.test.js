import { gameIdOf, isFilmFolder, parseGameName, seasonOf, teamName } from "./library";
import { legacyCuts, sameCut } from "./legacy";
import { washAt, cropOf } from "../../components/film/FilmPlayer";

jest.mock("../../firebase", () => ({ db: {} }));

describe("film library names", () => {
  test("the All-22 folders, and their seasons", () => {
    ["Al22 2026", "All22 2024", "All22 store"].forEach((n) => expect(isFilmFolder(n)).toBe(true));
    ["YouTube", "Misc", "SR Bowl 26", "Research"].forEach((n) => expect(isFilmFolder(n)).toBe(false));
    expect(seasonOf("Al22 2026")).toBe("2026");
    expect(seasonOf("All22 store")).toBe("2025");
  });
  test("game names: offense, then defense", () => {
    expect(parseGameName("FLORIDA STATE O VS. CLEMSON D.mp4")).toEqual({ offense: "Florida State", defense: "Clemson" });
    expect(parseGameName("FSU O VS. VIRGINIA D.mp4")).toEqual({ offense: "Florida State", defense: "Virginia" });
    expect(parseGameName("FLORIDA STATE O VS- PITTSBURGH D.mp4")).toEqual({ offense: "Florida State", defense: "Pittsburgh" });
    expect(parseGameName("FLORIDA STATE O VS. MIAMI D (1).mp4")).toEqual({ offense: "Florida State", defense: "Miami" });
    expect(parseGameName("FLORIDA STATE O VS. SOUTHERN METHODIST D.mp4").defense).toBe("SMU");
    expect(teamName("EAST TEXAS A&M")).toBe("East Texas A&M");
    expect(parseGameName("12- 2026 Nebraska O vs Ohio State.mp4")).toEqual({ offense: "Nebraska", defense: "Ohio State" });
    expect(parseGameName("10- 2026 Oregon O vs Ohio State.mp4")).toEqual({ offense: "Oregon", defense: "Ohio State" });
  });
  test("a game's id is its file name", () => {
    expect(gameIdOf("FLORIDA STATE O VS. EAST TEXAS A&M D.mp4")).toBe("florida-state-o-vs-east-texas-aandm-d");
    expect(gameIdOf("FLORIDA STATE O VS. MIAMI D (1).mp4")).not.toBe(gameIdOf("FLORIDA STATE O VS. MIAMI D.mp4"));
  });
});

describe("legacy Premiere import", () => {
  const seq = (plays) => ({ sequences: [{ id: "s", name: "kromah 2026", plays }] });
  const film = (start, end, inPt, extra = {}) => ({ file: "FSU O VS. CLEMSON D.mp4", path: "C:\\KC\\All22 store\\FSU O VS. CLEMSON D.mp4", start, end, in: inPt, out: inPt + (end - start), motion: { scale: 100 }, ...extra });
  const F720 = { w: 1280, h: 720 };
  test("each cut on game film is a play; a circle over it is its spot (full-size film: same place)", () => {
    const cuts = legacyCuts(seq([
      film(0, 8, 100, { size: F720, frame: F720 }), film(8, 15, 300, { size: F720, frame: F720 }),
      { file: "circle.png", start: 9, end: 11, motion: { x: 0.43, y: 0.2, scale: 11 }, size: { w: 648, h: 651 }, frame: F720 },
    ]));
    expect(cuts).toHaveLength(2);
    expect(cuts[0].spot).toBeNull();
    expect(cuts[1].spot.t).toBe(303); // the mark's END (it shows from the play's start until then)
    expect(cuts[1].spot.kind).toBe("circle");
    expect(cuts[1].spot.x).toBeCloseTo(0.43 - (3 * 0.11) / 1280, 3); // the ring's middle (3 px left of the PNG's)
    expect(cuts[1].spot.y).toBeCloseTo(0.2, 2);
    expect(cuts[1].spot.size).toBeCloseTo((311 * 0.11) / 720, 3);
    expect(cuts[1].mark).toBe("circle");
  });
  test("film scaled to fit its sequence (960×540 at 133%, 1920×1080 at 67%): the mark lands at the same film point", () => {
    const at = (size, scale, frame) => legacyCuts(seq([film(0, 8, 100, { size, frame, motion: { scale } }), { file: "circle.png", start: 0, end: 2, motion: { x: 0.25, y: 0.75, scale: 10 }, size: { w: 648, h: 651 }, frame }]))[0].spot;
    const up = at({ w: 960, h: 540 }, 133.333, F720);
    const down = at({ w: 1920, h: 1080 }, 66.667, F720);
    [up, down].forEach((s) => { expect(s.x).toBeCloseTo(0.25, 2); expect(s.y).toBeCloseTo(0.75, 2); });
    // Fit, not a wash: the film's own frame, not zoomed in.
    expect(up.size).toBeCloseTo(down.size, 3);
  });
  test("a zoomed-in fit crops: the mark moves toward the middle of the film", () => {
    const s = legacyCuts(seq([film(0, 8, 100, { size: F720, frame: F720, motion: { scale: 200 } }), { file: "circle.png", start: 0, end: 2, motion: { x: 0.25, y: 0.5, scale: 10 }, size: { w: 648, h: 651 }, frame: F720 }]))[0].spot;
    expect(s.x).toBeCloseTo(0.375, 2);
  });
  test("a mark outside the film's nest goes through the nest", () => {
    const nest = { id: "n1", motion: { x: 0.5, y: 0.5, scale: 50 }, size: F720, frame: F720 };
    const s = legacyCuts(seq([film(0, 8, 100, { size: F720, frame: F720, nested: true, nest }), { file: "circle.png", start: 0, end: 2, motion: { x: 0.5, y: 0.5, scale: 10 }, size: { w: 648, h: 651 }, frame: F720 }]))[0].spot;
    expect(s.x).toBeCloseTo(0.5, 2);
    const off = legacyCuts(seq([film(0, 8, 100, { size: F720, frame: F720, nested: true, nest }), { file: "circle.png", start: 0, end: 2, motion: { x: 0.375, y: 0.5, scale: 10 }, size: { w: 648, h: 651 }, frame: F720 }]))[0].spot;
    expect(off.x).toBeCloseTo(0.25, 2); // a quarter-size nest: a 1/8 step outside is 1/4 of the film
  });
  test("a trim leftover: not its own play; the circle goes to the full cut (Amare Thomas, Houston vs UCF)", () => {
    const UCF = "HOUSTON O VS. CENTRAL FLORIDA D.mp4";
    const piece = (start, end, inPt) => ({ ...film(start, end, inPt, { size: { w: 1280, h: 720 }, frame: { w: 960, h: 540 }, motion: { x: 0.5, y: 0.5, scale: 75 } }), file: UCF, path: `C:\\KC\\All22 store\\${UCF}` });
    const cuts = legacyCuts(seq([
      piece(37.57, 38.47, 1172.54), // 0.9 s from later in the play — left over
      piece(38.47, 48.42, 1171.47), // the play, from pre-snap
      { file: "circle.png", start: 37.57, end: 38.64, motion: { x: 0.635, y: 0.157, scale: 12 }, size: { w: 648, h: 651 }, frame: { w: 960, h: 540 } },
    ]));
    expect(cuts).toHaveLength(1);
    expect(cuts[0].in).toBeCloseTo(1171.47);
    expect(cuts[0].spot.t).toBeCloseTo(1171.64); // where the circle leaves
    expect(cuts[0].spot.x).toBeCloseTo(0.635, 2);
  });
  test("a circle spanning two plays goes to the one it covers most", () => {
    const cuts = legacyCuts(seq([film(0, 8, 100, { size: F720, frame: F720 }), film(8, 16, 500, { size: F720, frame: F720 }), { file: "circle.png", start: 7.8, end: 10, motion: { x: 0.5, y: 0.5, scale: 10 }, size: { w: 648, h: 651 }, frame: F720 }]));
    expect(cuts[0].spot).toBeNull();
    expect(cuts[1].spot.t).toBeCloseTo(502);
  });
  test("an arrow's spot is its tip; animated motion is flagged", () => {
    const cuts = legacyCuts(seq([film(0, 8, 100, { size: F720, frame: F720, motion: { scale: 100, keyed: true } }), { file: "arrow.png", start: 0, end: 2, motion: { x: 0.5, y: 0.5, scale: 20 }, size: { w: 384, h: 470 }, frame: F720 }]));
    expect(cuts[0].mark).toBe("arrow");
    expect(cuts[0].spot.kind).toBe("arrow");
    expect(cuts[0].spot.y).toBeCloseTo(0.5 + ((455 - 235) * 0.2) / 720, 3);
    expect(cuts[0].animated).toBe(true);
  });
  test("the same cut twice is kept once; an existing play is matched", () => {
    const cuts = legacyCuts(seq([film(0, 8, 100), film(20, 28, 100.1)]));
    expect(cuts).toHaveLength(1);
    expect(sameCut([{ gameId: cuts[0].gameId, in: 100.2 }], cuts[0])).toBeTruthy();
    expect(sameCut([{ gameId: cuts[0].gameId, in: 101 }], cuts[0])).toBeNull();
  });
});

describe("washed plays", () => {
  test("keyframes interpolate and hold at the ends", () => {
    const keys = [{ t: 10, x: 0.3, y: 0.5, z: 1 }, { t: 12, x: 0.7, y: 0.5, z: 3 }];
    expect(washAt(keys, 5)).toEqual(keys[0]);
    expect(washAt(keys, 20)).toEqual(keys[1]);
    const mid = washAt(keys, 11);
    expect(mid.x).toBeCloseTo(0.5);
    expect(mid.z).toBeCloseTo(2);
    expect(washAt([], 3)).toEqual({ x: 0.5, y: 0.5, z: 1 });
  });
  test("the crop stays inside the frame", () => {
    expect(cropOf({ x: 0.5, y: 0.5, z: 2 }, 1280, 720)).toEqual({ sx: 320, sy: 180, sw: 640, sh: 360 });
    expect(cropOf({ x: 0, y: 0, z: 2 }, 1280, 720)).toEqual({ sx: 0, sy: 0, sw: 640, sh: 360 });
  });
});
