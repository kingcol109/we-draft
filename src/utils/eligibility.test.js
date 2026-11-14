import {
  currentDraftClass, activePortalSeason, nextFebFirstUTC, firstClassFor, lastClassFor, classTag, inFinalYear, movedInto, eligibilityInfo, inHighSchool,
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

describe("eligibilityInfo (Nov 2026)", () => {
  const now = at("2026-11-13T12:00:00Z");
  const js = (extra) => ({ First: "Jeremiah", Last: "Smith", ...extra });
  test("eligibility left", () => {
    expect(eligibilityInfo(js({ Eligible: "2027", RecruitYear: "2024" }), now))
      .toBe("Jeremiah Smith has 2 seasons of college eligibility left after this season. This means he can declare for the NFL Draft as early as 2027, and as late as 2029.");
    expect(eligibilityInfo(js({ Eligible: "2027", RecruitYear: "2023" }), now))
      .toBe("Jeremiah Smith has 1 season of college eligibility left after this season. This means he can declare for the NFL Draft as early as 2027, and as late as 2028.");
    expect(eligibilityInfo(js({ Eligible: "2029", RecruitYear: "2026" }), now))
      .toBe("Jeremiah Smith has 4 seasons of college eligibility left after this season. This means he can declare for the NFL Draft as early as 2029, and as late as 2031.");
  });
  test("no eligibility left", () => {
    expect(eligibilityInfo(js({ Eligible: "2027", RecruitYear: "2022" }), now))
      .toBe("Jeremiah Smith will have no college eligibility remaining after 2026 and will be in the 2027 draft class.");
    expect(eligibilityInfo(js({ Eligible: "2027", RecruitYear: "2020" }), now)).toMatch(/no college eligibility remaining after 2026/);
  });
  test("declared", () => {
    expect(eligibilityInfo(js({ Eligible: "2027", RecruitYear: "2024", Declared: true }), now))
      .toBe("Jeremiah Smith has forgone 2 years of college eligibility and has declared for the 2027 NFL Draft.");
    expect(eligibilityInfo(js({ Eligible: "2027", RecruitYear: "2023", Declared: true }), now))
      .toBe("Jeremiah Smith has forgone 1 year of college eligibility and has declared for the 2027 NFL Draft.");
    expect(eligibilityInfo(js({ Eligible: "2027", RecruitYear: "2022", Declared: true }), now))
      .toBe("Jeremiah Smith has declared for the 2027 NFL Draft.");
  });
  test("passed on the draft", () => {
    const back = (reason) => js({ Eligible: "2028", RecruitYear: "2024", ClassHistory: [{ from: "2027", to: "2028", reason }] });
    expect(eligibilityInfo(back("returning"), now))
      .toBe("Jeremiah Smith did not declare for the NFL Draft in 2027. He will return to college with 2 more years of eligibility.");
    expect(eligibilityInfo(back("transfer"), now)).toMatch(/did not declare/);
    // an admin correction isn't a decision to return
    expect(eligibilityInfo(back("fix"), now)).toMatch(/^Jeremiah Smith has 2 seasons/);
  });
  test("high school senior (a promoted 2027 recruit)", () => {
    const p = { First: "Jaiden", Last: "Bryant", RecruitYear: "2027", Eligible: "2030", School: "Miami" };
    expect(inHighSchool(p, now)).toBe(true);
    expect(eligibilityInfo(p, now)).toBe("Jaiden Bryant is a high school senior in the class of 2027 and is committed to Miami. He can declare for the NFL Draft as early as 2030, and as late as 2032.");
    // Once the class rolls over (May 2027) they're a college freshman.
    expect(inHighSchool(p, at("2027-06-01T12:00:00Z"))).toBe(false);
    expect(eligibilityInfo(p, at("2027-06-01T12:00:00Z"))).toMatch(/seasons of college eligibility left/);
    expect(inHighSchool(js({ RecruitYear: "2026", Eligible: "2029" }), now)).toBe(false);
  });
  test("nothing to say", () => {
    expect(eligibilityInfo(js({ Eligible: "2027" }), now)).toBe(null);
    expect(eligibilityInfo(js({ Eligible: "2026", RecruitYear: "2022" }), now)).toBe(null);
  });
});
