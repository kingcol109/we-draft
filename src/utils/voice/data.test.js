// /voice reads: your board once per session, your evaluation from it, a
// school's games by query (not the whole schedule) — counted.
jest.mock("../../firebase", () => ({ db: {} }));
jest.mock("../siteSnapshots", () => ({ getSiteSnapshot: jest.fn(async () => null) }));
jest.mock("../film/data", () => ({ playsForPlayer: jest.fn(async () => []), gamesByIds: jest.fn(async () => []) }));
jest.mock("firebase/firestore", () => {
  const calls = { getDocs: 0, getDoc: 0, setDoc: 0 };
  const docSnap = (id, data) => ({ id, data: () => data });
  return {
    __calls: calls,
    collection: (...path) => ({ path: path.slice(1).join("/") }),
    doc: (...path) => ({ path: path.slice(1).join("/") }),
    query: (c, ...w) => ({ path: c.path, where: w }),
    where: (field, op, value) => ({ field, value }),
    limit: () => ({}),
    serverTimestamp: () => "ts",
    addDoc: async () => ({}), updateDoc: async () => {}, deleteDoc: async () => {},
    setDoc: async () => { calls.setDoc += 1; },
    getDoc: async (ref) => { calls.getDoc += 1; return { exists: () => true, id: ref.path.split("/").pop(), data: () => ({ grade: "Second Round" }) }; },
    getDocs: async (q) => {
      calls.getDocs += 1;
      if (q.path === "users/me/evaluations") return { docs: [docSnap("k", { grade: "Early First Round" }), docSnap("s", { grade: "Watchlist" })] };
      if (q.path === "schedule26") {
        const w = q.where[0];
        return { docs: [docSnap("g", { [w.field]: w.value, [w.field === "Home" ? "Away" : "Home"]: "Alabama", Final: true, HomeScore: 1, AwayScore: 2, Slug: `fsu-${w.field}`, Date: "2026-09-19" })] };
      }
      return { docs: [] };
    },
  };
});
// eslint-disable-next-line import/first
import { makeVoiceData } from "./data";
// eslint-disable-next-line import/first
import { __calls as calls } from "firebase/firestore";

test("your board: one read for the session; your evaluation comes from it; a save updates it", async () => {
  const d = makeVoiceData({ user: { uid: "me" } });
  await d.myBoard();
  await d.myBoard();
  expect(calls.getDocs).toBe(1);
  expect(await d.myEval("k")).toMatchObject({ grade: "Early First Round" });
  expect(await d.myEval("nobody")).toBeNull();
  expect(calls.getDoc).toBe(0);
  await d.saveMyEval({ id: "k", First: "Ousmane", Last: "Kromah" }, { grade: "Second Round", strengths: [], weaknesses: [], nflFit: "" });
  expect(calls.getDoc).toBe(0); // the save didn't re-read
  expect((await d.myEval("k")).grade).toBe("Second Round");
  expect((await d.myBoard()).find((e) => e.playerId === "k").grade).toBe("Second Round");
  expect(calls.getDocs).toBe(1);
});

test("a school's games: its home and away games only, once", async () => {
  const before = calls.getDocs;
  const d = makeVoiceData({ user: { uid: "me" } });
  const games = await d.schoolGames("Florida State");
  await d.schoolGames("Florida State");
  expect(calls.getDocs - before).toBe(2);
  expect(games.map((g) => g.opponent)).toEqual(["Alabama", "Alabama"]);
});
