import {
  currentDraftClass, activePortalSeason, nextFebFirstUTC, firstClassFor, lastClassFor, classTag, inFinalYear, movedInto,
} from "./eligibility";

const at = (iso) => new Date(iso);

test("current draft class rolls over in May", () => {
  expect(currentDraftClass(at("2026-11-13T12:00:00Z"))).toBe("2027");
  expect(currentDraftClass(at("2027-01-20T12:00:00Z"))).toBe("2027");
  expect(currentDraftClass(at("2027-04-30T12:00:00Z"))).toBe("2027");
  expect(currentDraftClass(at("2027-05-01T12:00:00Z"))).toBe("2028");
});

test("portal season stays put through January", () => {
  expect(activePortalSeason(at("2026-11-13T12:00:00Z"))).toBe(2027);
  expect(activePortalSeason(at("2027-01-05T12:00:00Z"))).toBe(2027);
  expect(activePortalSeason(at("2027-04-20T12:00:00Z"))).toBe(2027);
  expect(activePortalSeason(at("2027-08-01T12:00:00Z"))).toBe(2028);
});

test("next Feb 1", () => {
  expect(nextFebFirstUTC(at("2026-11-13T12:00:00Z")).toISOString()).toBe("2027-02-01T00:00:00.000Z");
  expect(nextFebFirstUTC(at("2027-03-01T12:00:00Z")).toISOString()).toBe("2028-02-01T00:00:00.000Z");
});

test("first / last class", () => {
  expect(firstClassFor("2024")).toBe(2027);
  expect(lastClassFor(2022, "2027")).toBe(2027);
  expect(lastClassFor(2024, "2027")).toBe(2029);
  // recruited before the five-year rule, still playing: the current class
  expect(lastClassFor(2020, "2027")).toBe(2027);
  expect(firstClassFor(null)).toBe(null);
});

test("tags", () => {
  expect(classTag("2027", 2024)).toBe("True");
  expect(classTag("2028", 2024)).toBe("+1");
  expect(classTag("2027", 2022)).toBe("+2");
  expect(classTag("2027", 2025)).toBe("Early");
  expect(classTag("2027", "")).toBe(null);
});

test("final year", () => {
  expect(inFinalYear("2027", 2022, "2027")).toBe(true);
  expect(inFinalYear("2027", 2021, "2027")).toBe(true);
  expect(inFinalYear("2027", 2023, "2027")).toBe(false);
  expect(inFinalYear("2028", 2022, "2027")).toBe(false);
});

test("movedInto", () => {
  const p = { Eligible: "2028", ClassHistory: [{ from: "2027", to: "2028", reason: "returning" }] };
  expect(movedInto(p)).toBe(true);
  expect(movedInto({ Eligible: "2028" })).toBe(false);
});
