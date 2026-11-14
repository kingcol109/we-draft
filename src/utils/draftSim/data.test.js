import { loadSimData, loadExpandedBoard } from "./data";

const mockRow = (i, cr) => ({ i, F: "F", L: i, s: "School", sl: `slug-${i}`, cr });
const mockSnapshots = {
  class_2027_QB: { rows: [mockRow("q1", 1), mockRow("q2", 3)], hidden: { qh: { cr: 2, g: 1.5, lg: "", F: "Hidden", L: "Qb", s: "Maryland", sl: "hidden-qb" } } },
  class_2027_WR: { rows: [mockRow("w1", 2)], hidden: { wh: { cr: 4, g: 3, lg: "" } } },
  _grades: { rows: {} },
};

jest.mock("../../firebase", () => ({ db: {} }));
jest.mock("../siteSnapshots", () => ({ getSiteSnapshot: (id) => Promise.resolve(mockSnapshots[id] || (id.startsWith("class_") ? { rows: [] } : null)) }));
jest.mock("../../components/UpcomingPicks", () => ({ fetchDraft: () => Promise.resolve({ picks: [] }), UPCOMING_DRAFTS: [{ year: "2027" }] }));
jest.mock("../draftProfileData", () => ({ fetchProspects: () => Promise.resolve([]), fetchNflBranding: () => Promise.resolve({}) }));
jest.mock("firebase/firestore", () => ({
  doc: jest.fn(), getDoc: () => Promise.resolve({ exists: () => false }), collection: jest.fn(), query: jest.fn(), where: jest.fn(), orderBy: jest.fn(), limit: jest.fn(),
  // The class's hidden players (the fallback for one the snapshot has no name for).
  getDocs: () => Promise.resolve({ docs: [
    { id: "qh", data: () => ({ First: "Hidden", Last: "Qb", Position: "QB", School: "Maryland", Slug: "hidden-qb" }) },
    { id: "wh", data: () => ({ First: "Hidden", Last: "Wr", Position: "WR", School: "Ohio State", Slug: "hidden-wr", Height: "6-3", Weight: "205" }) },
  ] }),
}));

test("expanded board: the site board plus its hidden players, each at his own class rank", async () => {
  const data = await loadSimData("2027");
  expect(data.board.map((p) => p.id)).toEqual(["q1", "w1", "q2"]);
  const board = await loadExpandedBoard("2027");
  expect(board.map((p) => p.id)).toEqual(["q1", "qh", "w1", "q2", "wh"]);
  const wr = board.find((p) => p.id === "wh");
  expect(wr).toMatchObject({ hidden: true, First: "Hidden", Last: "Wr", Position: "WR", height: 75, weight: 205, cr: 4 });
  // The site board itself is untouched.
  expect(data.board).toHaveLength(3);
});

test("the year after, projected: every team's own pick in each of seven rounds, in this year's round-1 order", () => {
  const { projectedNextOrder } = require("./data");
  const order = [
    { Pick: 1, Round: 1, Team: "NYJ", Traded: "DAL" }, { Pick: 2, Round: 1, Team: "DAL" }, { Pick: 3, Round: 1, Team: "KC" },
    { Pick: 4, Round: 2, Team: "KC" }, { Pick: 5, Round: 2, Team: "NYJ" }, { Pick: 6, Round: 2, Team: "DAL" },
  ];
  const next = projectedNextOrder(order);
  expect(next).toHaveLength(21);
  expect(next.slice(0, 3)).toEqual([
    { Pick: 1, Round: 1, Team: "NYJ", Traded: null }, { Pick: 2, Round: 1, Team: "DAL", Traded: null }, { Pick: 3, Round: 1, Team: "KC", Traded: null },
  ]);
  expect(next[20]).toEqual({ Pick: 21, Round: 7, Team: "KC", Traded: null });
});
