import { simPage, simMeta } from "./DraftSimMeta";

test("sim page tags: team and year from the URL", () => {
  const meta = (params) => simMeta(simPage(params));
  expect(meta({})).toMatchObject({ title: "2027 Mock Draft Simulator | Make Every Pick in the Draft", url: "https://we-draft.com/draftsim" });
  expect(meta({ team: "nyj" })).toMatchObject({
    title: "New York Jets 2027 Mock Draft Simulator", url: "https://we-draft.com/draftsim/nyj",
    description: expect.stringMatching(/^Make all the picks for the New York Jets in the 2027 NFL Draft/),
  });
  expect(meta({ team: "2028" })).toMatchObject({ title: "2028 Mock Draft Simulator | Make Every Pick in the Draft", url: "https://we-draft.com/draftsim/2028" });
  expect(meta({ year: "2028", team: "tb" })).toMatchObject({ title: "Tampa Bay Buccaneers 2028 Mock Draft Simulator", url: "https://we-draft.com/draftsim/2028/tb" });
  // A bad team: the page redirects to setup; the tags are setup's.
  expect(meta({ team: "xyz" }).title).toBe("2027 Mock Draft Simulator | Make Every Pick in the Draft");
});
