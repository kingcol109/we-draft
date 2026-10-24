import { simShareText, haulRecords } from "./share";

test("share text: the heading, the grade, each pick, then the call to action", () => {
  const hauls = [{
    team: "NYJ", letter: "A-",
    rows: [
      { pick: { overall: 9, round: 1 }, prospect: { id: "a", Slug: "a", First: "Colin", Last: "Simmons", Position: "EDGE", School: "Texas" }, letter: "A" },
      { pick: { overall: 41, round: 2, via: "DAL" }, prospect: { id: "b", First: "Joe", Last: "Smith", Position: "WR", School: "" }, letter: "B" },
    ],
  }, { team: "TB", letter: "C", rows: [] }];
  const teams = haulRecords(hauls);
  expect(teams).toHaveLength(1);
  expect(teams[0].picks[1]).toMatchObject({ overall: 41, via: "DAL", slug: "", grade: "B" });
  expect(simShareText({ year: "2027", teams, teamName: () => "New York Jets" }).split("\n")).toEqual([
    "My 2027 New York Jets Draft Sim",
    "Grade: A-",
    "9. Colin Simmons, EDGE, Texas",
    "41. Joe Smith, WR",
    "",
    "Create Your Own On We-Draft.com/draftsim",
  ]);
  expect(simShareText({ year: "2028", teams, teamName: (t) => t }).split("\n").pop()).toBe("Create Your Own On We-Draft.com/draftsim/2028");
});
