import { parseGameName } from "./library";
import { filmName, filmWeeks, matchFields, matchGame, teamKey } from "./schedule";

const G = (id, week, home, away, type = "regular", extra = {}) => ({ id, week, type, date: `2025-${String(8 + Math.floor(week / 4)).padStart(2, "0")}-${String(1 + (week % 4) * 7).padStart(2, "0")}T16:00:00Z`, home, away, neutral: false, hp: 21, ap: 24, ...extra });
const season = [
  G(1, 9, "Clemson", "Florida State"),
  G(2, 8, "Ole Miss", "Georgia"), G(3, 1, "Georgia", "Ole Miss", "postseason"),
  G(4, 12, "Virginia", "Duke"), G(5, 15, "Duke", "Virginia", "regular", { neutral: true }),
  G(6, 5, "Penn State", "Oregon"), G(7, 6, "Miami (OH)", "Akron"), G(8, 3, "South Florida", "UTSA"),
  G(9, 4, "Georgia Tech", "Gardner-Webb"),
];
const film = (file) => parseGameName(file);

describe("film ↔ schedule", () => {
  test("a plain file finds its game, either side", () => {
    expect(matchGame(film("FSU O VS. CLEMSON D.mp4"), season).game.id).toBe(1);
    expect(matchGame(film("CLEMSON O VS. FLORIDA STATE D.mp4"), season).game.id).toBe(1);
  });
  test("abbreviations: PSU, Miami Ohio, USF, Garner Webb", () => {
    expect(matchGame(film("2025 PSU O VS. OREGON D.mp4"), season).game.id).toBe(6);
    expect(matchGame(film("2025 AKRON O VS. MIAMI OHIO D.mp4"), season).game.id).toBe(7);
    expect(matchGame(film("2025 USF O VS. UTSA D.mp4"), season).game.id).toBe(8);
    expect(matchGame(film("2025 GEORGIA TECH O VS. GARNER WEBB D.mp4"), season).game.id).toBe(9);
  });
  test("rematches: the tag picks the game; untagged is the regular season", () => {
    expect(film("2025 OLE MISS O VS. GEORGIA D (PLAYOFF).mp4").note).toBe("playoff");
    expect(matchGame(film("2025 OLE MISS O VS. GEORGIA D (PLAYOFF).mp4"), season).game.id).toBe(3);
    expect(matchGame(film("2025 OLE MISS O VS. GEORGIA D.mp4"), season).game.id).toBe(2);
    expect(matchGame(film("2025 DUKE O VS. VIRGINIA D (CONFERENCE CHAMPIONSHIP GAME).mp4"), season).game.id).toBe(5);
    expect(matchGame(film("2025 DUKE O VS. VIRGINIA D.mp4"), season).game.id).toBe(4);
  });
  test("no game: nothing guessed", () => {
    expect(matchGame(film("YOUNGSTOWN STATE O VS. MERCYHURST D.mp4"), season).game).toBeNull();
  });
  test("a standard name: season, week, date, matchup, side", () => {
    const f = { ...film("FSU O VS. CLEMSON D.mp4"), season: "2025", file: "FSU O VS. CLEMSON D.mp4" };
    expect(filmName({ ...f, ...matchFields(season[0]) })).toMatch(/^2025 · Week 9 · \w{3} \d+ · Florida State at Clemson — Florida State offense$/);
    expect(filmName(f)).toBe("2025 · Florida State O vs Clemson D");
  });
  test("weeks: every game of the film teams, each with its two sides", () => {
    const a = { id: "a", offense: "Florida State", cfbdGameId: 1 };
    const b = { id: "b", offense: "Clemson", cfbdGameId: 1 };
    const weeks = filmWeeks(season, [a, b], new Set(["Florida State"]));
    const row = weeks.flatMap((w) => w.rows).find((r) => r.game.id === 1);
    expect(row.away.id).toBe("a");
    expect(row.home.id).toBe("b");
    expect(weeks.flatMap((w) => w.rows)).toHaveLength(1);
    expect(teamKey("Miami Ohio")).toBe(teamKey("Miami (OH)"));
  });
});
