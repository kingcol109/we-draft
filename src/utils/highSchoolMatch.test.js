import { matchHighSchool, hsKey, stateName } from "./highSchoolMatch";
import { careerStopsFrom, sameStops, stopSpan, stopsText } from "./careerStops";

const docs = [
  { id: "a", Name: "St Augustine Prep", State: "New Jersey" },
  { id: "b", Name: "Chaminade-Madonna Prep", State: "Florida" },
  { id: "c", Name: "Gonzaga College", State: "District of Columbia" },
  { id: "d", Name: "Edgewater", State: "Texas" },
  { id: "e", Name: "Mater Dei", State: "California", CFBDNames: ["Santa Ana Mater Dei"] },
];

test("normalizes names", () => {
  expect(hsKey("St. Augustine Prep High School")).toBe("saint augustine prep");
  expect(stateName("FL")).toBe("Florida");
  expect(stateName("Florida")).toBe("Florida");
});

test("matches within the state", () => {
  expect(matchHighSchool("St. Augustine Prep", "NJ", docs)).toMatchObject({ doc: { id: "a" }, how: "exact" });
  expect(matchHighSchool("Chaminade-Madonna", "FL", docs)).toMatchObject({ doc: { id: "b" }, how: "close" });
  expect(matchHighSchool("Gonzaga", "DC", docs)).toMatchObject({ doc: { id: "c" }, how: "close" });
  expect(matchHighSchool("Santa Ana Mater Dei", "CA", docs)).toMatchObject({ doc: { id: "e" }, how: "alias" });
  // same name, other state: no match
  expect(matchHighSchool("Edgewater", "FL", docs)).toBe(null);
  expect(matchHighSchool("", "FL", docs)).toBe(null);
});

test("career stops from CFBD", () => {
  const row = { st: [[2023, 2024, "Florida"], [2025, 2026, "Ohio State"]], jc: null };
  const stops = careerStopsFrom(row, "2023");
  expect(stops).toEqual([{ School: "Florida", From: 2023, To: 2024 }, { School: "Ohio State", From: 2025, To: 2026 }]);
  expect(stopsText(stops)).toBe("Florida 2023–24 → Ohio State 2025–26");
  expect(sameStops(stops, [...stops])).toBe(true);
  expect(sameStops(stops, stops.slice(1))).toBe(false);
  // JUCO first: from the recruit year to the season before signing
  expect(careerStopsFrom({ st: [[2025, 2026, "USC"]], jc: { n: "Hutchinson CC", y: 2025 } }, "2023")[0])
    .toEqual({ School: "Hutchinson CC", Level: "JUCO", From: 2023, To: 2024 });
  expect(stopSpan({ From: 2025, To: 2026 }, { current: true })).toBe("2025–Present");
  expect(stopSpan({ From: 2024, To: 2024 })).toBe("2024");
});

test("national champion seasons in a stop", () => {
  const { championSeasons } = require("./careerStops");
  expect(championSeasons({ School: "Ohio State", From: 2023, To: 2025 })).toEqual([2024]);
  expect(championSeasons({ School: "Georgia", From: 2021, To: 2023 })).toEqual([2021, 2022]);
  expect(championSeasons({ School: "Indiana", From: 2023, To: 2024 })).toEqual([]);
  expect(championSeasons({ School: "Georgia" })).toEqual([]);
});

test("a national school matches its one campus from any state", () => {
  const docs = [{ id: "img", Name: "IMG Academy", State: "Florida" }, { id: "c", Name: "Central", State: "Texas" }];
  expect(matchHighSchool("IMG Academy", "TX", docs)?.doc.id).toBe("img");
  expect(matchHighSchool("IMG Academy", "VA", docs)?.doc.id).toBe("img");
  expect(matchHighSchool("IMG Academy", "FL", docs)?.doc.id).toBe("img");
  // Not yet a doc: a new one belongs in Florida, never the hometown state.
  expect(matchHighSchool("IMG Academy", "TX", [])).toBe(null);
  // Ordinary schools stay state-scoped.
  expect(matchHighSchool("Central", "OK", docs)).toBe(null);
});

test("a distinguishing word keeps two schools apart", () => {
  const docs = [
    { id: "md", Name: "Mater Dei", State: "California" },
    { id: "rb", Name: "Red Bank Regional", State: "New Jersey" },
    { id: "fu", Name: "Fork Union Military Academy", State: "Virginia" },
  ];
  expect(matchHighSchool("Mater Dei Catholic", "CA", docs)).toBe(null);
  expect(matchHighSchool("Red Bank Catholic", "NJ", docs)).toBe(null);
  expect(matchHighSchool("Fork Union Military (HS)", "VA", docs)).toMatchObject({ doc: { id: "fu" }, how: "close" });
});
