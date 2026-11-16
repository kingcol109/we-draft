import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const DATA = require("C:/Users/wdalp/AppData/Local/Temp/claude/c--Users-wdalp-OneDrive-Desktop-we-draft/aa55471d-ca75-4d27-b8fa-f00fd83643fa/scratchpad/dump2.json");
jest.mock("../firebase", () => ({ db: {} }));
jest.mock("firebase/firestore", () => {
  const D = require("C:/Users/wdalp/AppData/Local/Temp/claude/c--Users-wdalp-OneDrive-Desktop-we-draft/aa55471d-ca75-4d27-b8fa-f00fd83643fa/scratchpad/dump2.json");
  const docs = (arr) => ({ docs: arr.map(({ id, ...rest }) => ({ id, data: () => rest })) });
  return {
    collection: (_db, name) => ({ name }),
    doc: (_db, ...parts) => ({ path: parts.join("/") }),
    query: (c) => c, where: () => null,
    getDocs: async (c) => docs(D.cols[c.name] || []),
    getDoc: async (r) => { const d = D.docs[r.path]; return { exists: () => !!d, data: () => d }; },
    addDoc: jest.fn(async () => ({ id: "NEWID" })), setDoc: jest.fn(async () => {}), updateDoc: jest.fn(async () => {}), serverTimestamp: () => null,
  };
});
const fs = require("firebase/firestore");
const VideoSuggester = require("./VideoSuggester").default;
jest.setTimeout(120000);

test("flags", async () => {
  window.confirm = () => true; window.alert = (m) => console.log("ALERT", m);
  fs.addDoc.mockImplementation(async () => ({ id: "NEWID" })); fs.setDoc.mockImplementation(async () => {}); fs.updateDoc.mockImplementation(async () => {});
  const added = [], updated = [];
  render(<VideoSuggester players={DATA.cols.players} videos={DATA.cols.videos} generateSlug={(f, l, p, e) => `${f}-${l}-${e}-${p}`.toLowerCase()} stateNames={{}}
    onPlayerAdded={(p) => added.push(p)} onPlayerUpdated={(p) => updated.push(p)} onCreate={() => {}} onClose={() => {}} />);
  fireEvent.click(screen.getByText("QB", { selector: "button" }));
  fireEvent.click(screen.getByText("Powerhouse", { selector: "button" }));
  fireEvent.click(screen.getByText("Suggest"));
  await waitFor(() => expect(screen.queryByText("Crunching...")).toBeNull(), { timeout: 100000 });

  const cardOf = (name) => screen.getAllByText(new RegExp(name)).map((el) => el.closest("div[style*='border-top']")).find(Boolean);
  // We-Draft player: Watch, then Watch again clears.
  const bear = cardOf("Bear Bachmeier");
  fireEvent.click(within(bear).getByText("Watch"));
  await waitFor(() => expect(fs.updateDoc).toHaveBeenCalledTimes(1));
  console.log("bear flag write", JSON.stringify(fs.updateDoc.mock.calls[0]), "active bg:", within(cardOf("Bear Bachmeier")).getByText("Watch").style.background);
  fireEvent.click(within(cardOf("Bear Bachmeier")).getByText("Watch"));
  await waitFor(() => expect(fs.updateDoc).toHaveBeenCalledTimes(2));
  console.log("bear clear write", JSON.stringify(fs.updateDoc.mock.calls[1]));

  // Outside player: Video → added, linked, then flagged.
  fireEvent.click(within(cardOf("Tayven Jackson")).getByText("Video"));
  await waitFor(() => expect(fs.updateDoc).toHaveBeenCalledTimes(3));
  const card = cardOf("Tayven Jackson");
  console.log("added", JSON.stringify(added.map((p) => [p.id, p.Slug, p.Position, p.School, p.Eligible])),
    "addDoc", fs.addDoc.mock.calls.length, "setDoc paths", JSON.stringify(fs.setDoc.mock.calls.map((c) => c[0].path)),
    "flag write", JSON.stringify(fs.updateDoc.mock.calls[2]), "updated", JSON.stringify(updated.map((p) => [p.Last, p.Flag])),
    "| button now:", within(card).getByText(/Create Video/).textContent, "| badge gone:", !within(card).queryByText("Not on We-Draft"));
});
