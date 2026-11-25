// /voice's pictures (user, 2026-11-25): the logo button's states, each kind
// of answer drawn, the change card, and where it sends you next.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Orb, Stage, linksFor } from "./VoiceStage";

jest.mock("../draftSim/simHeadshots", () => ({ useHeadshot: () => "" }));
jest.mock("../DraftArchiveList", () => ({
  useSchools: () => ({ "Florida State": { School: "Florida State", Slug: "florida-state", Color1: "#782F40", Logo1: "/fsu.png", LogoDark: "/fsu-dark.png" } }),
}));

const KROMAH = { id: "k", First: "Ousmane", Last: "Kromah", Position: "RB", School: "Florida State", Eligible: "2028", Slug: "ousmane-kromah-2028-rb", Height: "6'1\"", Weight: "215" };
const draw = (reply, extra = {}) => render(<MemoryRouter><Stage item={{ id: 1, said: "x", reply }} voiceMode="general" onPick={() => {}} onConfirm={() => {}} onNext={() => {}} onAsk={() => {}} {...extra} /></MemoryRouter>);
const hrefs = () => screen.queryAllByRole("link").map((a) => a.getAttribute("href"));

test("the logo button: one class per state", () => {
  const { rerender } = render(<Orb mode="idle" label="Tap to ask" />);
  expect(screen.getByAltText("We-Draft.com").getAttribute("src")).toBe("/wd-icon-512.png");
  expect(screen.getByRole("button", { name: "Tap to ask" }).className).toMatch(/wdv-idle/);
  rerender(<Orb mode="speaking" beat={3} label="Stop talking" />);
  expect(screen.getByRole("button", { name: "Stop talking" }).className).toMatch(/wdv-speaking/);
  rerender(<Orb mode="listening" label="Stop listening" />);
  expect(screen.getByRole("button", { name: "Stop listening" }).className).toMatch(/wdv-listening/);
});

test("a stat about a player: his snapshot, the asked number big, the line as tiles, his page + comparisons", () => {
  draw({ intent: "stats.one", say: "Ousmane Kromah: 609 rushing yards, 2026.", title: "Ousmane Kromah", player: KROMAH, rows: [["rushing yards · 2026", "609"], ["carries", "114"], ["yards per carry", "5.3"]], tone: "answer" });
  expect(screen.getByText("Ousmane Kromah: 609 rushing yards, 2026.")).toBeTruthy();
  expect(screen.getByText("609")).toBeTruthy();
  expect(screen.getByText("Florida State")).toBeTruthy();
  expect(screen.getByText("6'1\"")).toBeTruthy();
  expect(hrefs()).toEqual(expect.arrayContaining(["/player/ousmane-kromah-2028-rb", "/comparison/ousmane-kromah-2028-rb", "/team/florida-state"]));
});

test("an edit: before → after while it asks, with Yes / No; then saved", () => {
  const change = { scope: "Your evaluation", items: [{ label: "Grade", from: "Third Round", to: "Second Round" }] };
  const { unmount } = draw({ say: "Set your grade on Ousmane Kromah to Second Round (was Third Round)?", player: KROMAH, change, confirm: true, tone: "ask" }, { pending: { kind: "confirm" } });
  expect(screen.getByText("Third Round")).toBeTruthy();
  expect(screen.getByText("Second Round")).toBeTruthy();
  expect(screen.getByText(/Your evaluation · change/)).toBeTruthy();
  expect(screen.getByText("Yes (Y)")).toBeTruthy();
  unmount();
  draw({ say: "Saved. Your grade on Ousmane Kromah: Second Round.", player: KROMAH, change: { ...change, saved: true }, tone: "done" });
  expect(screen.getByText(/Your evaluation · saved/)).toBeTruthy();
  expect(hrefs()).toContain("/profile");
});

test("a CFBD-only player: snapshot says he isn't on We-Draft.com; team page and Portal Sim, no player page", () => {
  draw({ intent: "stats.one", say: "Gemari Sands: 412 rushing yards, 2026.", player: { id: "cfbd_4871013", cfbdOnly: true, cfbd: "4871013", First: "Gemari", Last: "Sands", Position: "RB", School: "Florida State" }, rows: [["rushing yards · 2026", "412"]], tone: "answer" });
  expect(screen.getByText("Not on We-Draft.com yet")).toBeTruthy();
  expect(hrefs()).toEqual(["/team/florida-state", "/portalsim/florida-state"]);
});

test("a team record: the school's logo, the team page", () => {
  draw({ intent: "team.record", say: "Florida State is 5 and 6 in 2026.", title: "Florida State", sub: "2026 · 5-6", rows: [["09/05 vs Alabama", "W 31-17"]], tone: "answer" });
  expect(screen.getAllByText("Florida State").length).toBeGreaterThan(0);
  expect(hrefs()).toContain("/team/florida-state");
});

test("admin: the readout links to Analytics; nobody else gets that link", () => {
  const r = { intent: "admin.readout", say: "Morning readout.", title: "Morning readout", rows: [["Visitors yesterday", "826"]], tone: "answer" };
  expect(linksFor(r, { voiceMode: "admin" }).map((l) => l.to)).toEqual(["/admin?section=requests", "/admin?section=analytics"]);
  expect(linksFor(r, { voiceMode: "general" })).toEqual([]);
});

test("lists of players: a row each, tap one to ask about him", () => {
  const asked = [];
  render(<MemoryRouter><Stage item={{ id: 2, said: "x", reply: { intent: "risers.hot", say: "The 2027 Draft Risers.", title: "2027 Draft Risers", people: [{ id: "k", first: "Ousmane", last: "Kromah", pos: "RB", school: "Florida State", note: "🔥 On Fire" }], links: [{ to: "/risers/2027", label: "2027 Draft Risers", primary: true }], tone: "answer" } }} voiceMode="general" onAsk={(q) => asked.push(q)} /></MemoryRouter>);
  screen.getByText("🔥 On Fire").click();
  expect(asked).toEqual(["who is Florida State's Ousmane Kromah"]);
  expect(hrefs()).toContain("/risers/2027");
});

test("games: a card each, linked to the game on /live; two players side by side", () => {
  const g = { id: "g1", slug: "clemson-vs-florida-state", status: "in_progress", period: 3, clock: "8:12", home: { school: "Florida State", points: 21 }, away: { school: "Clemson", points: 17 }, tv: "ABC" };
  const { unmount } = draw({ intent: "live.today", say: "1 game today.", title: "Today's games", games: [g], tone: "answer" });
  expect(screen.getByText("LIVE · Q3 8:12")).toBeTruthy();
  expect(hrefs()).toContain("/live/clemson-vs-florida-state");
  unmount();
  draw({ intent: "stats.compare", say: "In 2026.", title: "Ousmane Kromah vs Jesse Legree", compare: { players: [KROMAH, { id: "l", First: "Jesse", Last: "Legree", Position: "RB", School: "Florida State" }], rows: [["rushing yards", 609, 980, "609", "980"]] }, tone: "answer" });
  expect(screen.getByText("980")).toBeTruthy();
  expect(screen.getByText("vs")).toBeTruthy();
});

test("follow-up buttons under an answer about a player", () => {
  const asked = [];
  draw({ intent: "stats.one", say: "x", player: KROMAH, tone: "answer" }, { onAsk: (q) => asked.push(q) });
  screen.getByText("“his career path”").click();
  expect(asked).toEqual(["his career path"]);
});
