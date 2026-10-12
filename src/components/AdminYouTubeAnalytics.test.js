// Admin → YouTube Analytics, rendered against faked Firestore reads and a
// faked /api/youtube-analytics. Checks the legacy record wins on title and
// thumbnail, public vs analytics numbers, unassociated suggestions (never
// auto-applied) and that sync / tag clicks go through the API.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AdminYouTubeAnalytics from "./AdminYouTubeAnalytics";

const V1 = "AAAAAAAAAA1", V2 = "BBBBBBBBBB2";
const mockData = {
  "ytAnalytics/status": { channelId: "UCx", channel: { title: "We-Draft" }, connection: { connected: true, tokenSource: "stored" }, analyticsSummary: { through: "2026-10-10" }, sync: { videos: { state: "ok", lastSuccessAt: Date.now() - 3600e3, counts: { new: 1, updated: 2 } } } },
  ytVideos: [
    { id: V1, videoId: V1, legacyDocId: "leg1", type: "long", yt: { title: "YouTube Title", publishedAt: "2026-10-01T16:00:00Z", thumbnails: { medium: "https://i.ytimg.com/yt1.jpg" } }, stats: { views: 1000, likes: 10, comments: 2 }, analytics: { last7: { views: 120 }, lifetime: { views: 720, minutesWatched: 1440, subsGained: 7 }, fetchedAt: Date.now() } },
    { id: V2, videoId: V2, legacyDocId: null, type: "long", yt: { title: "Jesse Legree vs Sam Smith film", description: "", publishedAt: "2026-10-05T16:00:00Z", thumbnails: { medium: "https://i.ytimg.com/yt2.jpg" } }, stats: { views: 200 }, analytics: { last7: { views: 30 } } },
  ],
  videos: [{ id: "leg1", GenTitle: "Custom Site Title", GenThumb: "https://imgur.com/custom.png", items: [{ type: "player", playerId: "p1", title: "", thumb: "" }], playerIds: ["p1"] }],
  players: [{ id: "p1", First: "Jesse", Last: "Legree", Slug: "jesse-legree-2027-db" }, { id: "p2", First: "Sam", Last: "Smith", Slug: "sam-smith-2027-db" }],
  recruits: [], ytChannelDaily: [{ date: "2026-10-10", views: 46, subsGained: 3, subsLost: 1 }], ytPlayerStats: [],
};

jest.mock("../firebase", () => ({ auth: { currentUser: { getIdToken: async () => "firebase-id-token" } }, db: {} }));
jest.mock("firebase/firestore", () => ({
  collection: (_db, ...p) => ({ path: p.join("/") }),
  doc: (_db, ...p) => ({ path: p.join("/") }),
  query: (c) => c,
  where: () => null,
  getDocs: async (c) => ({ docs: (mockData[c.path] || []).map((x) => ({ id: x.id, data: () => x })) }),
  onSnapshot: (ref, cb) => {
    const v = mockData[ref.path];
    if (Array.isArray(v)) cb({ docs: v.map((x) => ({ id: x.id, data: () => x })) });
    else cb({ exists: () => !!v, data: () => v });
    return () => {};
  },
}));

let calls;
beforeEach(() => {
  calls = [];
  global.fetch = jest.fn(async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, auth: opts.headers.Authorization, body });
    const ok = (b) => ({ status: 200, ok: true, json: async () => b });
    if (body.action === "config") return ok({ clientId: true, clientSecret: true, apiKey: true, tokenKey: true, cronSecret: true, redirectUri: "https://we-draft.com/api/youtube-analytics" });
    if (body.action === "sync") return ok({ state: "ok", message: "done", counts: {} });
    if (body.action === "associate") return ok({ where: "analytics", playerIds: ["p1"] });
    return ok({});
  });
});

test("legacy title and custom thumbnail win; public vs analytics numbers shown", async () => {
  render(<AdminYouTubeAnalytics />);
  expect(await screen.findByText("Custom Site Title")).toBeInTheDocument();
  expect(screen.queryByText("YouTube Title")).not.toBeInTheDocument();
  const imgs = screen.getAllByRole("presentation").map((i) => i.getAttribute("src")); // thumbnails have alt=""
  expect(imgs).toContain("https://imgur.com/custom.png");
  expect(imgs).not.toContain("https://i.ytimg.com/yt1.jpg");
  expect(screen.getByText("1,200")).toBeInTheDocument(); // total public views
  expect(screen.getByText("150")).toBeInTheDocument(); // 7-day analytics views
});

test("unassociated: suggestions are offered, and only a click tags", async () => {
  render(<AdminYouTubeAnalytics />);
  fireEvent.click(await screen.findByText(/Unassociated \(1\)/));
  const sugg = await screen.findByText(/\+ Jesse Legree/);
  expect(screen.getByText(/\+ Sam Smith/)).toBeInTheDocument();
  expect(calls.some((c) => c.body.action === "associate")).toBe(false);
  fireEvent.click(sugg);
  await waitFor(() => expect(calls.find((c) => c.body.action === "associate")?.body).toEqual({ action: "associate", videoId: V2, add: ["p1"], remove: [] }));
});

test("sync buttons call the API with the admin's token", async () => {
  render(<AdminYouTubeAnalytics />);
  await screen.findByText("Sync Videos");
  fireEvent.click(screen.getAllByRole("button", { name: "Run" })[0]); // cards are in order: Videos, Analytics, History
  await waitFor(() => expect(calls.find((c) => c.body.action === "sync")).toMatchObject({ url: "/api/youtube-analytics", auth: "Bearer firebase-id-token", body: { op: "videos" } }));
});
