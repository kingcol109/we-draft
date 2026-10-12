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
    { id: V1, videoId: V1, legacyDocId: "leg1", type: "long", yt: { title: "YouTube Title", publishedAt: "2026-10-01T16:00:00Z", durationSec: 540, thumbnails: { medium: "https://i.ytimg.com/yt1.jpg" } }, stats: { views: 1000, likes: 10, comments: 2 }, analytics: { last7: { views: 120 }, lifetime: { views: 720, minutesWatched: 1440, avgViewDurationSec: 120, subsGained: 7 }, fetchedAt: Date.now() }, reach: { impressions: 2000, clicks: 100, ctr: 0.05, firstDay: "2026-10-01", days: {} } },
    { id: V2, videoId: V2, legacyDocId: null, type: "long", yt: { title: "Jesse Legree vs Sam Smith film", description: "", publishedAt: "2026-10-05T16:00:00Z", thumbnails: { medium: "https://i.ytimg.com/yt2.jpg" } }, stats: { views: 200 }, analytics: { last7: { views: 30 } } },
  ],
  videos: [{ id: "leg1", GenTitle: "Custom Site Title", GenThumb: "https://imgur.com/custom.png", items: [{ type: "player", playerId: "p1", title: "", thumb: "" }], playerIds: ["p1"] }],
  players: [{ id: "p1", First: "Jesse", Last: "Legree", Slug: "jesse-legree-2027-db", Eligible: "2027", Position: "DB" }, { id: "p2", First: "Sam", Last: "Smith", Slug: "sam-smith-2026-db", Eligible: "2026", Position: "DB" }],
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
    if (body.action === "studio-import") return ok(body.preview
      ? { preview: true, matched: 1, unmatched: 0, skipped: 1, impressions: 20000, ctr: 0.05, columns: { id: "Content", impressions: "Impressions", ctr: "Impressions click-through rate (%)" }, unmatchedSample: [] }
      : { message: "Imported Studio impressions/CTR for 1 videos." });
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

test("Players tab is gone; Videos can be filtered by draft class", async () => {
  render(<AdminYouTubeAnalytics />);
  expect(await screen.findByText("Custom Site Title")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Players" })).not.toBeInTheDocument();
  const [classSelect] = screen.getAllByTitle("Draft class of the tagged players");
  // Only classes that tagged videos have are offered.
  expect([...classSelect.options].map((o) => o.value)).toEqual(["", "2027", "__none"]);
  fireEvent.change(classSelect, { target: { value: "__none" } });
  expect(screen.queryByText("Custom Site Title")).not.toBeInTheDocument(); // tagged with a 2027 player
  expect(screen.getByText("Jesse Legree vs Sam Smith film")).toBeInTheDocument();
  fireEvent.change(classSelect, { target: { value: "2027" } });
  expect(screen.getByText("Custom Site Title")).toBeInTheDocument();
  expect(screen.queryByText("Jesse Legree vs Sam Smith film")).not.toBeInTheDocument();
});

test("Research: watch % = avg view ÷ length, CTR from reach totals, grouped by draft class", async () => {
  render(<AdminYouTubeAnalytics />);
  fireEvent.click(await screen.findByRole("button", { name: "Research" }));
  const groupCell = () => screen.queryAllByRole("cell").find((td) => td.textContent === "2027 class");
  await waitFor(() => expect(groupCell()).toBeTruthy());
  expect(screen.getAllByRole("cell").some((td) => td.textContent === "No player tagged")).toBe(true); // V2 is untagged
  expect(screen.getAllByText("22%").length).toBeGreaterThan(0); // 120s of a 9:00 video
  expect(screen.getAllByText("5.0%").length).toBeGreaterThan(0);
  const [classSelect] = screen.getAllByTitle("Draft class of the tagged players");
  fireEvent.change(classSelect, { target: { value: "__none" } });
  expect(groupCell()).toBeUndefined();
});

test("Studio import: preview first, then a confirmed import; lifetime CTR combines Studio + later API days", async () => {
  // V2 gets a Studio total plus API days after its end date.
  const v2 = mockData.ytVideos[1];
  v2.yt.durationSec = 600;
  v2.analytics = { ...v2.analytics, lifetime: { views: 100, minutesWatched: 100, avgViewDurationSec: 60 } };
  v2.studioReach = { impressions: 9000, clicks: 270, ctr: 0.03, from: null, to: "2026-10-12" };
  v2.reach = { impressions: 5000, clicks: 400, ctr: 0.08, firstDay: "2026-09-15", lastDay: "2026-10-14", days: {}, after: { cutoff: "2026-10-12", impressions: 1000, clicks: 30 } };
  jest.spyOn(window, "confirm").mockReturnValue(true);
  render(<AdminYouTubeAnalytics />);
  fireEvent.click(await screen.findByRole("button", { name: "Research" }));
  // Lifetime CTR for V2 = (270 + 30) / (9000 + 1000) = 3.0%, not the API-only 8%.
  await waitFor(() => expect(screen.getAllByRole("cell").some((td) => td.textContent === "3.0%")).toBe(true));
  expect(screen.getAllByRole("cell").some((td) => td.textContent === "8.0%")).toBe(false);

  const file = new File(["Content,Impressions,Impressions click-through rate (%)\n"], "Table data.csv", { type: "text/csv" });
  fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } }); // eslint-disable-line testing-library/no-node-access
  const previewBtn = screen.getByRole("button", { name: "Preview" });
  await waitFor(() => expect(previewBtn).not.toBeDisabled());
  expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  fireEvent.click(previewBtn);
  expect(await screen.findByText(/videos matched/)).toBeInTheDocument();
  expect(calls.filter((c) => c.body.action === "studio-import").map((c) => c.body.preview)).toEqual([true]);
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  expect(await screen.findByText(/Imported Studio/)).toBeInTheDocument();
  const sent = calls.filter((c) => c.body.action === "studio-import");
  expect(sent.map((c) => c.body.preview)).toEqual([true, false]);
  expect(sent[1].body).toMatchObject({ fileName: "Table data.csv", from: null });
  jest.restoreAllMocks();
});
