// Admin → Stream Manager → Worker VM panel, against a faked /api/stream-manager.
// No Google Cloud call is (or could be) made: fetch is a stub that records
// every request.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VmPanel } from "./AdminStreamManager";

jest.mock("../firebase", () => ({
  auth: { currentUser: { getIdToken: async () => "firebase-id-token" } },
  db: {},
}));
jest.mock("firebase/firestore", () => ({}));

const STATES = { PROVISIONING: "starting", STAGING: "starting", RUNNING: "running", STOPPING: "stopping", TERMINATED: "stopped" };
let vm, calls, settleAfter, failStatus, liveGuard;

const instance = () => ({
  name: "we-draft-broadcast-01", zone: "us-east1-c", machineType: "e2-standard-4",
  status: vm.status, state: STATES[vm.status], lastStartTimestamp: null, lastStopTimestamp: null,
});
const reply = (status, body) => Promise.resolve({ status, ok: status < 300, json: async () => body });

beforeEach(() => {
  vm = { status: "TERMINATED", polls: 0 };
  calls = [];
  settleAfter = 1;
  failStatus = null;
  liveGuard = false;
  global.fetch = jest.fn((url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, auth: opts.headers.Authorization, body });
    if (failStatus) return reply(failStatus.code, { error: failStatus.error });
    switch (body.action) {
      case "vm-status":
        if (["STAGING", "STOPPING"].includes(vm.status) && ++vm.polls >= settleAfter) {
          vm.status = vm.status === "STAGING" ? "RUNNING" : "TERMINATED";
          vm.polls = 0;
        }
        return reply(200, { instance: instance() });
      case "vm-start":
        if (vm.status === "RUNNING") return reply(200, { ok: true, result: "already-running", instance: instance() });
        vm.status = "STAGING";
        return reply(200, { ok: true, result: "starting", operation: { id: "op-1", status: "RUNNING" }, instance: instance() });
      case "vm-stop":
        if (liveGuard && body.confirmLive !== true) {
          return reply(409, { error: "A broadcast is live — stopping the worker VM will end the stream. Send confirmLive: true to stop anyway." });
        }
        vm.status = "STOPPING";
        return reply(200, { ok: true, result: "stopping", operation: { id: "op-2", status: "RUNNING" }, instance: instance() });
      default:
        return reply(400, { error: "unknown action" });
    }
  });
  jest.spyOn(window, "confirm").mockReturnValue(true);
  jest.spyOn(window, "prompt").mockReturnValue(null);
});

afterEach(() => jest.restoreAllMocks());

const actions = () => calls.map((c) => c.body.action);
const renderPanel = (props) => render(<VmPanel pollMs={5} timeoutMs={500} {...props} />);
const button = (name) => screen.getByRole("button", { name });

test("on open it only reads status, through the API with the admin's ID token", async () => {
  renderPanel();
  expect(await screen.findByText("we-draft-broadcast-01")).toBeInTheDocument();
  expect(screen.getByText(/us-east1-c · e2-standard-4/)).toBeInTheDocument();
  expect(screen.getByText("TERMINATED")).toBeInTheDocument();
  expect(screen.getByText("Stopped")).toBeInTheDocument();
  expect(actions()).toEqual(["vm-status"]);
  for (const c of calls) {
    expect(c.url).toBe("/api/stream-manager");
    expect(c.auth).toBe("Bearer firebase-id-token");
  }
  expect(button("Start VM")).toBeEnabled();
  expect(button("Stop VM")).toBeDisabled();
});

test("Refresh Status re-reads status", async () => {
  renderPanel();
  await screen.findByText("we-draft-broadcast-01");
  fireEvent.click(button("Refresh Status"));
  await waitFor(() => expect(actions()).toEqual(["vm-status", "vm-status"]));
});

test("Start VM asks first, and does nothing if cancelled", async () => {
  window.confirm.mockReturnValue(false);
  renderPanel();
  await screen.findByText("we-draft-broadcast-01");
  fireEvent.click(button("Start VM"));
  expect(window.confirm).toHaveBeenCalled();
  expect(actions()).toEqual(["vm-status"]);
});

test("Start VM starts, then polls until the VM is running", async () => {
  settleAfter = 2;
  renderPanel();
  await screen.findByText("we-draft-broadcast-01");
  fireEvent.click(button("Start VM"));
  expect(await screen.findByText("Worker VM is running.")).toBeInTheDocument();
  expect(actions()).toEqual(["vm-status", "vm-start", "vm-status", "vm-status"]);
  expect(screen.getByText("Running")).toBeInTheDocument();
  expect(button("Start VM")).toBeDisabled();
  expect(button("Stop VM")).toBeEnabled();
});

test("polling gives up after the timeout with a clear message", async () => {
  settleAfter = Infinity; // stuck in STAGING
  renderPanel({ timeoutMs: 60 });
  await screen.findByText("we-draft-broadcast-01");
  fireEvent.click(button("Start VM"));
  expect(await screen.findByText(/still isn't running/)).toBeInTheDocument();
  expect(button("Refresh Status")).toBeEnabled();
});

test("Stop VM asks first, then stops and polls until stopped — without confirmLive", async () => {
  vm.status = "RUNNING";
  renderPanel();
  await screen.findByText("we-draft-broadcast-01");
  fireEvent.click(button("Stop VM"));
  expect(await screen.findByText("Worker VM is stopped.")).toBeInTheDocument();
  const stop = calls.find((c) => c.body.action === "vm-stop");
  expect(stop.body.confirmLive).toBeUndefined();
  expect(window.prompt).not.toHaveBeenCalled();
});

test("Stop VM's confirmation warns when a broadcast is live", async () => {
  vm.status = "RUNNING";
  window.confirm.mockReturnValue(false);
  renderPanel({ liveCount: 1 });
  await screen.findByText("we-draft-broadcast-01");
  fireEvent.click(button("Stop VM"));
  expect(window.confirm.mock.calls[0][0]).toMatch(/1 broadcast is LIVE/);
  expect(actions()).toEqual(["vm-status"]);
});

test("the backend's live guard is never bypassed without typing STOP", async () => {
  vm.status = "RUNNING";
  liveGuard = true;
  for (const typed of [null, "", "stop", "yes"]) {
    window.prompt.mockReturnValue(typed);
    calls = [];
    const { unmount } = renderPanel({ liveCount: 1 });
    await screen.findByText("we-draft-broadcast-01");
    fireEvent.click(button("Stop VM"));
    expect(await screen.findByText(/Stop cancelled/)).toBeInTheDocument();
    expect(calls.filter((c) => c.body.action === "vm-stop").map((c) => c.body.confirmLive)).toEqual([undefined]);
    expect(vm.status).toBe("RUNNING");
    unmount();
  }
});

test("typing STOP after the live guard sends confirmLive once", async () => {
  vm.status = "RUNNING";
  liveGuard = true;
  window.prompt.mockReturnValue("STOP");
  renderPanel({ liveCount: 1 });
  await screen.findByText("we-draft-broadcast-01");
  fireEvent.click(button("Stop VM"));
  expect(await screen.findByText("Worker VM is stopped.")).toBeInTheDocument();
  expect(window.prompt.mock.calls[0][0]).toMatch(/broadcast is live/);
  expect(calls.filter((c) => c.body.action === "vm-stop").map((c) => c.body.confirmLive)).toEqual([undefined, true]);
});

test("backend errors are shown and the controls stay safe", async () => {
  failStatus = { code: 500, error: "Worker VM control isn't configured on the server: GCE_ZONE is missing or not a valid zone (e.g. us-east1-b)." };
  renderPanel();
  expect(await screen.findByText(/GCE_ZONE is missing/)).toBeInTheDocument();
  expect(screen.getByText("Status unavailable.")).toBeInTheDocument();
  expect(button("Start VM")).toBeDisabled();
  expect(button("Stop VM")).toBeDisabled();
  expect(button("Refresh Status")).toBeEnabled();
});

test("a failed start shows the server's message and doesn't poll", async () => {
  renderPanel();
  await screen.findByText("we-draft-broadcast-01");
  failStatus = { code: 502, error: "Compute Engine refused the worker VM service account — check its role on we-draft-broadcast-01." };
  fireEvent.click(button("Start VM"));
  expect(await screen.findByText(/Compute Engine refused/)).toBeInTheDocument();
  expect(actions()).toEqual(["vm-status", "vm-start"]);
});

test("a network failure shows a readable message", async () => {
  global.fetch.mockImplementationOnce(() => Promise.reject(new TypeError("Failed to fetch")));
  renderPanel();
  expect(await screen.findByText(/Couldn't reach the server/)).toBeInTheDocument();
});

// ── Auto Schedule picker ──
// Rendered with props (schedule26 games, statuses, broadcast records); the
// fetch stub records the API calls it makes.
describe("AutoSchedule", () => {
  const { AutoSchedule } = require("./AdminStreamManager");
  const NOW = Date.UTC(2026, 9, 10, 15, 0);
  const H = 3600e3;
  const games = [
    { id: "s2", Home: "Texas", Away: "Ohio State", KickoffAt: NOW + 5 * H, CFBDGameId: 401002, Week: "Week 7" },
    { id: "s1", Home: "LSU", Away: "Clemson", KickoffAt: NOW + 2 * H, CFBDGameId: 401001, Week: "Week 7" },
    { id: "s3", Home: "Navy", Away: "Army", KickoffAt: NOW + 3 * H, CFBDGameId: null, Week: "Week 7" },
    { id: "s4", Home: "Iowa", Away: "Ohio", KickoffAt: NOW - 3 * H, CFBDGameId: 401004, Final: true },
    { id: "s5", Home: "Far", Away: "Future", KickoffAt: NOW + 30 * 86400e3, CFBDGameId: 401005 },
  ];
  const rec = (gameId, auto, extra = {}) => ({ id: `g${gameId}`, gameId: String(gameId), auto: { open: true, ...auto }, ...extra });
  const renderPicker = (props = {}) => render(<AutoSchedule games={games} rows={[]} now={NOW} statusById={{ 401004: "final" }} orchDoc={null} agentDoc={null} {...props} />);
  const row = (id) => screen.getByTestId(`game-${id}`);
  const within = require("@testing-library/react").within;

  beforeEach(() => {
    global.fetch = jest.fn((url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ url, auth: opts.headers.Authorization, body });
      return reply(200, { ok: true, id: "g401001" });
    });
  });

  test("lists upcoming schedule games in kickoff order, starting nothing", () => {
    renderPicker();
    const rows = screen.getAllByTestId(/^game-/).map((r) => r.dataset.testid);
    expect(rows).toEqual(["game-s4", "game-s1", "game-s3", "game-s2"]); // s5 is outside 7 days
    expect(within(row("s1")).getByText("Clemson at LSU")).toBeInTheDocument();
    expect(within(row("s4")).getByText("Final")).toBeInTheDocument();
    expect(within(row("s1")).getByText("Not enabled")).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  test("unlinked and final games can't be enabled", () => {
    renderPicker();
    expect(within(row("s3")).getByRole("button", { name: "Enable" })).toBeDisabled();
    expect(within(row("s3")).getByText(/not linked/)).toBeInTheDocument();
    expect(within(row("s4")).getByRole("button", { name: "Enable" })).toBeDisabled();
  });

  test("Enable asks first, then only sends auto-select", async () => {
    window.confirm.mockReturnValueOnce(false);
    renderPicker();
    fireEvent.click(within(row("s1")).getByRole("button", { name: "Enable" }));
    expect(calls).toEqual([]);
    fireEvent.click(within(row("s1")).getByRole("button", { name: "Enable" }));
    expect(window.confirm.mock.calls[1][0]).toMatch(/Nothing starts now/);
    expect(await screen.findByText(/Enabled — it will start automatically/)).toBeInTheDocument();
    expect(calls.map((c) => c.body)).toEqual([{ action: "auto-select", scheduleId: "s1" }]);
    expect(calls[0].auth).toBe("Bearer firebase-id-token");
  });

  test("shows each broadcast state with what it's waiting on or why it failed", () => {
    renderPicker({
      rows: [
        rec(401001, { phase: "worker", waiting: "Waiting for the agent to launch the worker…" }),
        rec(401002, { phase: "failed", open: false, error: "YouTube never received the worker's stream" }),
      ],
    });
    expect(within(row("s1")).getByText("Starting")).toBeInTheDocument();
    expect(within(row("s1")).getByText(/launch the worker/)).toBeInTheDocument();
    expect(within(row("s2")).getByText("Failed")).toBeInTheDocument();
    expect(within(row("s2")).getByText(/never received/)).toBeInTheDocument();
    expect(within(row("s2")).getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  test("Disable on a scheduled game cancels without confirmEnd", async () => {
    renderPicker({ rows: [rec(401001, { phase: "selected", kickoffAt: NOW + 2 * H })] });
    expect(within(row("s1")).getByText("Scheduled")).toBeInTheDocument();
    fireEvent.click(within(row("s1")).getByRole("button", { name: "Disable" }));
    await screen.findByText("Disabled.");
    expect(calls.map((c) => c.body)).toEqual([{ action: "auto-cancel", id: "g401001" }]);
  });

  test("ending a live broadcast needs its own confirmation and sends confirmEnd", async () => {
    renderPicker({ rows: [rec(401001, { phase: "live" })] });
    expect(within(row("s1")).getByText("Live")).toBeInTheDocument();
    window.confirm.mockReturnValueOnce(false);
    fireEvent.click(within(row("s1")).getByRole("button", { name: "End Broadcast" }));
    expect(calls).toEqual([]);
    fireEvent.click(within(row("s1")).getByRole("button", { name: "End Broadcast" }));
    expect(window.confirm.mock.calls[1][0]).toMatch(/ON AIR/);
    await screen.findByText(/Ending/);
    expect(calls.map((c) => c.body)).toEqual([{ action: "auto-cancel", id: "g401001", confirmEnd: true }]);
  });

  test("Retry re-enables a failed game", async () => {
    renderPicker({ rows: [rec(401001, { phase: "failed", open: false, error: "x" })] });
    fireEvent.click(within(row("s1")).getByRole("button", { name: "Retry" }));
    await screen.findByText("Re-enabled.");
    expect(calls.map((c) => c.body)).toEqual([{ action: "auto-retry", id: "g401001" }]);
  });

  test("server errors are shown", async () => {
    global.fetch = jest.fn(() => reply(400, { error: "This game isn't linked to We-Draft Live (no CFBD game id) — set it in Admin → CFB Schedule." }));
    renderPicker();
    fireEvent.click(within(row("s1")).getByRole("button", { name: "Enable" }));
    expect(await screen.findByText(/isn't linked to We-Draft Live/)).toBeInTheDocument();
  });

  test("orchestrator and agent health are shown", () => {
    renderPicker({ orchDoc: { lastTickAt: NOW - 30e3, slotStreamIds: ["a", "b"], maxConcurrent: 2 }, agentDoc: { lastSeenAt: NOW - 5e3 } });
    expect(screen.getByText(/Last run 30s ago/)).toBeInTheDocument();
    expect(screen.getByText(/VM agent online/)).toBeInTheDocument();
    expect(screen.getByText(/Slots 0\/2 in use/)).toBeInTheDocument();
  });
});
