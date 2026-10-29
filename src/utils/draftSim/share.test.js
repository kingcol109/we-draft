import { simShareText, haulRecords, mockFromSim, mockShareText, futureMoves } from "./share";
import { buildBoard, initSim, makePick } from "./engine";

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

test("mock export: every pick in the mock editor's shape, trades and all", () => {
  const board = buildBoard(Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, First: "F", Last: `L${i}`, Position: "WR", School: "S", Slug: `s${i}`, cr: i + 1 })));
  const order = [{ Pick: 1, Round: 1, Team: "AAA" }, { Pick: 2, Round: 1, Team: "BBB" }, { Pick: 3, Round: 2, Team: "AAA", Traded: "BBB" }];
  let sim = initSim({ order, board, userTeams: ["AAA", "BBB"], rounds: 2, seed: 1 });
  sim = makePick(sim, "p3").state;
  sim = makePick(sim, "p0").state;
  const mock = mockFromSim(sim, { year: 2027, name: "My Mock", ownerId: "u1" });
  expect(mock).toMatchObject({ name: "My Mock", rounds: 2, visibility: "private", draftClass: "2027", ownerId: "u1" });
  expect(mock.picks[1]).toEqual({ pickNumber: 1, round: 1, originalTeam: "AAA", currentTeam: "AAA", tradedFrom: null, note: "", selection: { id: "p3", First: "F", Last: "L3", Position: "WR", School: "S", Slug: "s3" } });
  expect(mock.picks[3].tradedFrom).toBe("AAA");
  expect(mock.picks[3].selection).toBeNull();
});

test("mock share text: every pick, the team and the player, then the link", () => {
  const board = buildBoard([{ id: "a", First: "Arch", Last: "Manning", Position: "QB", School: "Texas", Slug: "a", cr: 1 }, { id: "b", First: "Joe", Last: "Smith", Position: "WR", School: "", Slug: "b", cr: 2 }]);
  let sim = initSim({ order: [{ Pick: 1, Round: 1, Team: "TEN" }, { Pick: 2, Round: 1, Team: "NYJ" }], board, userTeams: ["TEN", "NYJ"], rounds: 1, seed: 1 });
  sim = makePick(sim, "a").state;
  sim = makePick(sim, "b").state;
  const names = { TEN: "Tennessee Titans", NYJ: "New York Jets" };
  expect(mockShareText({ year: "2027", sim, teamName: (t) => names[t] })).toBe([
    "My 2027 NFL Mock Draft", "",
    "1. Tennessee Titans — Arch Manning, QB, Texas",
    "2. New York Jets — Joe Smith, WR",
    "", "Create Your Own On We-Draft.com/draftsim",
  ].join("\n"));
});

test("saved hauls note next year's picks added or given up, net of re-trades", () => {
  const f = (overall, round) => ({ overall: 1000 + overall, number: overall, round, year: 2028, future: true });
  const trades = [
    { partner: "LV", got: [{ overall: 7 }, f(13, 1)], gave: [{ overall: 3 }] },
    { partner: "CLE", got: [{ overall: 40 }], gave: [f(45, 2), f(13, 1)] },
    { partner: "KC", got: [f(60, 3)], gave: [{ overall: 50 }] },
  ];
  expect(futureMoves(trades)).toEqual({ got: [{ year: 2028, round: 3, team: "KC" }], gave: [{ year: 2028, round: 2, team: "CLE" }] });
  expect(futureMoves([])).toEqual({ got: [], gave: [] });
});
