import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import AdminPortalNews from "./AdminPortalNews";

// Firestore, in memory: the board doc, schools, photos, a CFBD line.
const writes = [];
jest.mock("../firebase", () => ({ db: {} }));
jest.mock("firebase/firestore", () => {
  const schools = [{ School: "Texas", Logo1: "tx.png", Color1: "#bf5700" }, { School: "Oregon", Logo1: "or.png" }, { School: "Ohio State" }, { School: "Pittsburgh" }, { School: "Florida State" }];
  return {
    collection: (_db, ...path) => ({ path: path.join("/") }),
    doc: (_db, ...path) => ({ path: path.join("/") }),
    query: (c) => c,
    where: () => null,
    serverTimestamp: () => "NOW",
    getDoc: async (ref) => {
      if (ref.path === "playerPhotos/p1") return { exists: () => true, data: () => ({ action: [{ url: "shot.png", firstPick: { x: 0, y: 0, scale: 1 } }] }) };
      return { exists: () => false, data: () => null };
    },
    getDocs: async (ref) => {
      if (ref.path === "schools") return { docs: schools.map((s) => ({ data: () => s })) };
      if (ref.path === "cfbRosters") return { docs: [{ id: "r1", data: () => ({ school: "Oregon", team: "Oregon", teamId: 2483, players: [
        { id: 901, first: "Someone", last: "Else", pos: "WR" },
        { id: 902, first: "Brand", last: "Newguy", pos: "CB", rc: 2024 },
      ] }) }] };
      if (ref.path === "cfbdPlayers") return { docs: [{ data: () => ({ mappingStatus: "verified", seasons: { 2026: { defensive: { SACKS: 10, TFL: 16, TOT: 32 } } } }) }] };
      return { docs: [] };
    },
    setDoc: async (ref, data) => { writes.push([ref.path, data]); },
  };
});
// The graphic is drawn elsewhere (PortalNewsGraphic.jsx); here, a stand-in.
jest.mock("./PortalNewsGraphic", () => ({
  usePortalCover: () => ({ src: "", failed: false }),
  placedShots: (ph) => (ph?.action || []).filter((a) => a?.url && a.firstPick),
}));
// CFB Universe adds (a new players doc) — a stand-in.
const universeAdds = [];
jest.mock("./CfbUniverseSearch", () => ({
  POS_MAP: { WR: "WR", CB: "DB" },
  recruitYearFor: (u) => (u.rc ? String(u.rc) : null),
  eligibleFor: () => "2027",
  addRosterPlayer: async (u, roster, opts) => {
    universeAdds.push([u.id, opts]);
    return { player: { id: "new1", First: u.first, Last: u.last, Position: opts.pos, School: u.school, Slug: "brand-newguy-2027-db" }, rosterPlayers: null };
  },
}));
jest.mock("../utils/instagram/transfer", () => ({ TRANSFER_DESIGNS: [["classic", "Mock 1 · Classic"], ["welcome", "Mock 2 · Commitment"]] }));

const players = [
  { id: "p1", First: "Colin", Last: "Simmons", Position: "EDGE", School: "Texas", Slug: "colin-simmons-2027-edge", InPortal: true, PortalOriginalSchool: "Texas", PortalEnteredAt: new Date("2026-11-19T15:00:00Z"), RecruitYear: "2024", Eligible: "2027" },
  { id: "p2", First: "Mason", Last: "Heintschel", Position: "QB", School: "Florida State", PriorSchool: "Pittsburgh", PortalCommittedAt: new Date("2026-11-18T15:00:00Z"), RecruitYear: "2025", Eligible: "2028" },
  { id: "p3", First: "Someone", Last: "Else", Position: "WR", School: "Oregon" },
];

test("suggests portal players, adds one, sets destinations and a prediction, and saves the board", async () => {
  window.confirm = () => true;
  render(<AdminPortalNews allPlayers={players} />);
  // In the portal: Simmons; Committed: Heintschel. Not someone who never moved.
  expect(await screen.findByText(/In the portal \(1\)/)).toBeTruthy();
  expect(screen.getByText(/Committed \(1\)/)).toBeTruthy();
  expect(screen.queryByText(/Someone Else/)).toBeNull();

  fireEvent.click(screen.getByText(/Colin Simmons/).closest("button"));
  // He's on the board, under Entered, with his stats from his CFBD line.
  expect(await screen.findByText(/In the Portal \(1\)/)).toBeTruthy();
  expect(screen.getByText("10")).toBeTruthy();
  expect(screen.getByText(/2 years of eligibility/)).toBeTruthy();

  fireEvent.change(screen.getByPlaceholderText("Destination 1"), { target: { value: "Oregon" } });
  fireEvent.change(screen.getByPlaceholderText("Destination 2"), { target: { value: "Ohio State" } });
  const first = screen.getByPlaceholderText("Destination 1").closest("div").parentElement;
  fireEvent.click(within(first).getByText(/Make prediction/));
  expect(screen.getByText(/Our prediction/)).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText(/Why he matters/), { target: { value: "Big news.\n\nMore." } });

  fireEvent.click(screen.getByText("Save & publish"));
  await waitFor(() => expect(writes.length).toBe(1));
  const [path, data] = writes[0];
  expect(path).toBe("portalNews/current");
  expect(data.updatedAt).toBe("NOW");
  expect(data.entries).toHaveLength(1);
  const e = data.entries[0];
  expect(e).toMatchObject({
    id: "p1", slug: "colin-simmons-2027-edge", status: "entered", from: "Texas", to: "", date: "2026-11-19",
    note: "Big news.\n\nMore.", destinations: ["Oregon", "Ohio State"], prediction: "Oregon", shot: "shot.png", order: 0,
  });
  expect(e.stats.map((s) => s.label)).toEqual(["Sacks", "TFL", "Tackles"]);
});

test("a committed player comes in under Committed, from his old school to his new one", async () => {
  writes.length = 0;
  render(<AdminPortalNews allPlayers={players} />);
  fireEvent.click(await screen.findByText(/Committed \(1\)/));
  fireEvent.click(screen.getByText(/Mason Heintschel/).closest("button"));
  expect(await screen.findByText(/Committed \(1\)$/, { selector: "div" })).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText(/What Florida State is getting/), { target: { value: "Write-up." } });
  fireEvent.click(screen.getByText("Save & publish"));
  await waitFor(() => expect(writes.length).toBe(1));
  expect(writes[0][1].entries[0]).toMatchObject({ status: "committed", from: "Pittsburgh", to: "Florida State", date: "2026-11-18", design: "welcome", destinations: [], prediction: "" });
});

test("one order per list: ↑ moves a player up his list, and Save writes that order (no numbers shown)", async () => {
  writes.length = 0;
  render(<AdminPortalNews allPlayers={four} />);
  await addAll(["Colin Simmons", "Isaac Brown", "Treydez Green"]);
  expect(rowNames("IN")).toEqual(["Colin Simmons", "Isaac Brown", "Treydez Green"]);
  // Green up one: Simmons, Green, Brown.
  fireEvent.click(within(rowOf("Treydez Green")).getByTitle("Up one"));
  expect(rowNames("IN")).toEqual(["Colin Simmons", "Treydez Green", "Isaac Brown"]);
  // The first row can't go up, the last can't go down.
  expect(within(rowOf("Colin Simmons")).getByTitle("Up one").disabled).toBe(true);
  expect(within(rowOf("Isaac Brown")).getByTitle("Down one").disabled).toBe(true);
  fireEvent.click(screen.getByText("Save & publish"));
  await waitFor(() => expect(writes.length).toBe(1));
  expect(writes[0][1].entries.map((e) => [e.last, e.order])).toEqual([["Simmons", 0], ["Green", 1], ["Brown", 2]]);
});

test("drag a player onto another to put him there", async () => {
  render(<AdminPortalNews allPlayers={four} />);
  await addAll(["Colin Simmons", "Isaac Brown", "Treydez Green"]);
  const dt = { effectAllowed: "", setData: () => {} };
  fireEvent.dragStart(rowOf("Treydez Green"), { dataTransfer: dt });
  fireEvent.dragOver(rowOf("Colin Simmons"), { dataTransfer: dt });
  fireEvent.drop(rowOf("Colin Simmons"), { dataTransfer: dt });
  expect(rowNames("IN")).toEqual(["Treydez Green", "Colin Simmons", "Isaac Brown"]);
});

test("click a player in the list to edit him; the editor is his", async () => {
  render(<AdminPortalNews allPlayers={four} />);
  await addAll(["Colin Simmons", "Isaac Brown"]);
  // The last one added is open.
  expect(screen.getByPlaceholderText(/Why he matters/)).toBeTruthy();
  fireEvent.click(screen.getByText("Done"));
  expect(screen.getByText(/Click a player above to edit him/)).toBeTruthy();
  fireEvent.click(rowOf("Colin Simmons"));
  fireEvent.change(screen.getByPlaceholderText(/Why he matters/), { target: { value: "Simmons note." } });
  fireEvent.click(rowOf("Isaac Brown"));
  expect(screen.getByPlaceholderText(/Why he matters/).value).toBe("");
  fireEvent.click(rowOf("Colin Simmons"));
  expect(screen.getByPlaceholderText(/Why he matters/).value).toBe("Simmons note.");
  // A row says what's still missing.
  expect(within(rowOf("Isaac Brown")).getByText(/Needs: write-up/)).toBeTruthy();
});

test("a player not in the portal comes in as Projected: in the IN list's order, labeled, cleared in bulk", async () => {
  writes.length = 0;
  window.confirm = () => true;
  render(<AdminPortalNews allPlayers={four} />);
  await addAll(["Colin Simmons"]);
  fireEvent.change(screen.getByPlaceholderText("Search any player…"), { target: { value: "someone" } });
  fireEvent.click((await screen.findByText(/adds as projected/)).closest("button"));
  await waitFor(() => expect(rowNames("IN")).toEqual(["Colin Simmons", "Someone Else"]));
  expect(within(rowOf("Someone Else")).getByText("PROJECTED")).toBeTruthy();
  expect(within(rowOf("Colin Simmons")).queryByText("PROJECTED")).toBeNull();
  expect(screen.getByText(/1 projected \(not in the portal yet\) · 1 actually in/)).toBeTruthy();
  // He can go first, like anyone in the list.
  fireEvent.click(within(rowOf("Someone Else")).getByTitle("Up one"));
  expect(rowNames("IN")).toEqual(["Someone Else", "Colin Simmons"]);
  fireEvent.click(screen.getByText("Save & publish"));
  await waitFor(() => expect(writes.length).toBe(1));
  expect(writes[0][1].entries.map((e) => [e.last, e.status, e.projected, e.order])).toEqual([["Else", "entered", true, 0], ["Simmons", "entered", false, 1]]);
  // The real portal fills up: off they go, all at once.
  fireEvent.click(screen.getByText("Remove 1 projected"));
  expect(rowNames("IN")).toEqual(["Colin Simmons"]);
  expect(screen.queryByText(/Remove \d+ projected/)).toBeNull();
});

test("a projected player who enters the portal: Mark entered", async () => {
  const later = four.map((p) => (p.id === "p3" ? { ...p, InPortal: true, PortalOriginalSchool: "Oregon", PortalEnteredAt: new Date("2026-11-24T15:00:00Z") } : p));
  const { rerender } = render(<AdminPortalNews allPlayers={four} />);
  fireEvent.change(await screen.findByPlaceholderText("Search any player…"), { target: { value: "someone" } });
  fireEvent.click((await screen.findByText(/adds as projected/)).closest("button"));
  await waitFor(() => expect(rowNames("IN")).toEqual(["Someone Else"]));
  expect(screen.queryByText(/Mark \d entered/)).toBeNull();
  rerender(<AdminPortalNews allPlayers={later} />);
  expect(within(rowOf("Someone Else")).getByText(/In the portal now/)).toBeTruthy();
  fireEvent.click(screen.getByText("Mark 1 entered"));
  expect(within(rowOf("Someone Else")).queryByText("PROJECTED")).toBeNull();
  expect(screen.getByDisplayValue("2026-11-24")).toBeTruthy();
});

test("order position by position: a position's players swap among themselves, everyone else keeps his slot", async () => {
  writes.length = 0;
  const edges = [
    ...four,
    { id: "e2", First: "Edge", Last: "Two", Position: "EDGE", School: "Texas", InPortal: true, PortalEnteredAt: new Date("2026-11-16T15:00:00Z") },
  ];
  render(<AdminPortalNews allPlayers={edges} />);
  await addAll(["Colin Simmons", "Isaac Brown", "Edge Two"]);
  expect(rowNames("IN")).toEqual(["Colin Simmons", "Isaac Brown", "Edge Two"]);
  fireEvent.click(screen.getByText("EDGE 2"));
  expect(rowNames("IN")).toEqual(["Colin Simmons", "Edge Two"]);
  fireEvent.click(within(rowOf("Edge Two")).getByTitle("Up one"));
  expect(rowNames("IN")).toEqual(["Edge Two", "Colin Simmons"]);
  fireEvent.click(screen.getByText("All"));
  // Brown (RB) stays second.
  expect(rowNames("IN")).toEqual(["Edge Two", "Isaac Brown", "Colin Simmons"]);
  fireEvent.click(screen.getByText("Save & publish"));
  await waitFor(() => expect(writes.length).toBe(1));
  expect(writes[0][1].entries.map((e) => [e.last, e.order])).toEqual([["Two", 0], ["Brown", 1], ["Simmons", 2]]);
});

test("only the top 3 projected at a position get a graphic; projected don't count in IN", async () => {
  const wrs = [1, 2, 3, 4].map((n) => ({ id: `w${n}`, First: "Wide", Last: `Out${n}`, Position: "WR", School: "Oregon" }));
  render(<AdminPortalNews allPlayers={[...four, ...wrs]} />);
  await addAll(["Colin Simmons"]);
  for (const n of [1, 2, 3, 4]) {
    fireEvent.change(screen.getByPlaceholderText("Search any player…"), { target: { value: `out${n}` } });
    fireEvent.click((await screen.findByText(/adds as projected/)).closest("button"));
    await waitFor(() => expect(rowNames("IN")).toContain(`Wide Out${n}`));
  }
  expect(screen.getByText(/In the Portal \(1\)/)).toBeTruthy();
  expect(["Wide Out1", "Wide Out2", "Wide Out3", "Wide Out4"].map((n) => within(rowOf(n)).queryByText("GRAPHIC") ? "G" : "H")).toEqual(["G", "G", "G", "H"]);
  // Move the 4th up past the 3rd: he gets the graphic, the 3rd loses it.
  fireEvent.click(within(rowOf("Wide Out4")).getByTitle("Up one"));
  expect(within(rowOf("Wide Out4")).getByText("GRAPHIC")).toBeTruthy();
  expect(within(rowOf("Wide Out3")).getByText("HEADSHOT")).toBeTruthy();
});

test("CFB Universe: a roster player already on We-Draft adds as himself; a new one is added to We-Draft first", async () => {
  const added = [];
  render(<AdminPortalNews allPlayers={four} generateSlug={() => "x"} onPlayerAdded={(p) => added.push(p)} />);
  fireEvent.click(await screen.findByText(/CFB Universe/));
  fireEvent.change(screen.getByPlaceholderText("Search any player…"), { target: { value: "else" } });
  fireEvent.click((await screen.findByText(/on We-Draft$/)).closest("button"));
  await waitFor(() => expect(rowNames("IN")).toEqual(["Someone Else"]));
  expect(universeAdds).toHaveLength(0);
  fireEvent.change(screen.getByPlaceholderText("Search any player…"), { target: { value: "newguy" } });
  fireEvent.click((await screen.findByText(/not on We-Draft yet/)).closest("button"));
  await waitFor(() => expect(rowNames("IN")).toEqual(["Someone Else", "Brand Newguy"]));
  expect(universeAdds[0]).toEqual([902, { pos: "DB", eligible: "2027", live: true, recruitYear: "2024" }]);
  expect(added.map((p) => p.id)).toEqual(["new1"]);
  expect(within(rowOf("Brand Newguy")).getByText("PROJECTED")).toBeTruthy();
});

const four = [
  ...players,
  { id: "p4", First: "Isaac", Last: "Brown", Position: "RB", School: "Louisville", InPortal: true, PortalOriginalSchool: "Louisville", PortalEnteredAt: new Date("2026-11-18T15:00:00Z") },
  { id: "p5", First: "Treydez", Last: "Green", Position: "TE", School: "LSU", InPortal: true, PortalOriginalSchool: "LSU", PortalEnteredAt: new Date("2026-11-17T15:00:00Z") },
];
// Adds each (from the In the portal suggestions), waiting for him to land.
async function addAll(names) {
  for (const n of names) {
    const btn = (await screen.findAllByText(new RegExp(n))).map((x) => x.closest("button")).find((b) => b && /\+ Add/.test(b.textContent));
    fireEvent.click(btn);
    await waitFor(() => expect(rowNames("IN")).toContain(n));
  }
}
// A list's rows, top to bottom (the "click to edit" rows).
const rowsIn = (side) => screen.queryAllByTitle(/click to edit, drag to reorder/).filter((r) => r.parentElement.firstChild.textContent.startsWith(side));
const rowNames = (side) => rowsIn(side).map((r) => r.title.split(" — ")[0]);
const rowOf = (name) => screen.getAllByTitle(/click to edit, drag to reorder/).find((r) => r.title.startsWith(`${name} —`));
