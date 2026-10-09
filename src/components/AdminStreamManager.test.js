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
    renderPicker({ orchDoc: { lastTickAt: NOW - 30e3, slotStreamIds: ["a", "b"], maxConcurrent: 2, capacity: 2, slotsInUse: 1 }, agentDoc: { lastSeenAt: NOW - 5e3 } });
    expect(screen.getByText(/Last run 30s ago/)).toBeInTheDocument();
    expect(screen.getByText(/VM agent online/)).toBeInTheDocument();
    expect(screen.getByText(/Slots 1\/2 in use/)).toBeInTheDocument();
    expect(screen.queryByText(/No Worker Stream is configured/)).toBeNull();
  });
});

// ── Cancelled status: display, filters, counts ──
describe("cancelled broadcasts", () => {
  const { overallStatus, isDone, filterBroadcasts, statusCounts, AutoSchedule } = require("./AdminStreamManager");
  const within = require("@testing-library/react").within;
  const rows = [
    { id: "a", status: "scheduled", scheduledStart: 3 },
    { id: "b", status: "live", scheduledStart: 1 },
    { id: "c", status: "cancelled", auto: { phase: "cancelled" }, scheduledStart: 2 },
    // saved before the cancelled status existed (Florida State vs Louisville)
    { id: "d", status: "scheduled", auto: { phase: "cancelled", enabled: true }, scheduledStart: 4 },
    { id: "e", status: "ended", scheduledStart: 5 },
    { id: "f", status: "error", auto: { phase: "cancelled" }, scheduledStart: 6 }, // cancelled but YouTube still on air
  ];

  test("cancelled records show as Cancelled, including legacy ones stored as scheduled", () => {
    expect(overallStatus(rows[2])).toBe("cancelled");
    expect(overallStatus(rows[3])).toBe("cancelled");
    expect(overallStatus(rows[0])).toBe("scheduled");
    expect(overallStatus(rows[5])).toBe("error"); // needs attention, not hidden
  });

  test("cancelled is done: under Ended, not Upcoming", () => {
    expect(rows.filter(isDone).map((r) => r.id)).toEqual(["c", "d", "e"]);
    expect(filterBroadcasts(rows, "upcoming").map((r) => r.id)).toEqual(["b", "a", "f"]);
    expect(filterBroadcasts(rows, "ended").map((r) => r.id)).toEqual(["c", "d", "e"]);
    expect(filterBroadcasts(rows, "all")).toHaveLength(6);
  });

  test("header counts don't count cancelled as Scheduled", () => {
    expect(statusCounts(rows)).toEqual({ live: 1, preparing: 0, scheduled: 1, error: 1 });
  });

  test("the picker shows a cancelled game as Cancelled with Retry (not Enable)", () => {
    const NOW = Date.UTC(2026, 9, 10, 15, 0);
    const games = [{ id: "s1", Home: "Louisville", Away: "Florida State", KickoffAt: NOW + 3600e3, CFBDGameId: 401858254 }];
    render(<AutoSchedule games={games} rows={[{ id: "g401858254", gameId: "401858254", status: "scheduled", auto: { phase: "cancelled", open: false, enabled: true } }]} now={NOW} />);
    const row = screen.getByTestId("game-s1");
    expect(within(row).getByText("Cancelled")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(within(row).queryByRole("button", { name: "Enable" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Disable" })).toBeNull();
  });
});

// ── Zero capacity, DRY_RUN and rehearsals ──
describe("capacity and rehearsal display", () => {
  const { AutoSchedule, SlotSettings, autoState, overallStatus, statusCounts, filterBroadcasts } = require("./AdminStreamManager");
  const within = require("@testing-library/react").within;
  const NOW = Date.UTC(2026, 9, 10, 15, 0);
  const games = [{ id: "s1", Home: "LSU", Away: "Clemson", KickoffAt: NOW + 3600e3, CFBDGameId: 401001 }];

  beforeEach(() => {
    global.fetch = jest.fn((url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return reply(200, { ok: true, id: "r401001", rehearsal: true }); });
  });

  test("zero capacity is shown as 0, never as one default slot, with an actionable error", () => {
    render(<AutoSchedule games={games} rows={[]} now={NOW} orchDoc={{ lastTickAt: NOW, capacity: 0, slotsInUse: 0, maxConcurrent: 1 }} agentDoc={{ lastSeenAt: NOW }} />);
    expect(screen.getByText(/Slots 0\/0 in use/)).toBeInTheDocument();
    expect(screen.getByText(/No Worker Stream is configured \(0 stream slots\)/)).toBeInTheDocument();
    expect(screen.getByText(/use Rehearse to test without YouTube/)).toBeInTheDocument();
  });

  test("before the orchestrator has reported, capacity is unknown, not 1", () => {
    render(<AutoSchedule games={games} rows={[]} now={NOW} orchDoc={{ lastTickAt: NOW }} agentDoc={null} />);
    expect(screen.getByText(/Slots 0\/\? in use/)).toBeInTheDocument();
  });

  test("slot settings say 0 slots when no Worker Stream is selected", () => {
    const { rerender } = render(<SlotSettings orchDoc={{ capacity: 0 }} />);
    expect(screen.getByText("No Worker Stream selected — 0 slots")).toBeInTheDocument();
    rerender(<SlotSettings orchDoc={{ capacity: 1 }} />);
    expect(screen.getByText(/Default: 1 slot/)).toBeInTheDocument();
  });

  test("a DRY_RUN agent is flagged", () => {
    render(<AutoSchedule games={games} rows={[]} now={NOW} orchDoc={{ lastTickAt: NOW, capacity: 1 }} agentDoc={{ lastSeenAt: NOW, dryRun: true }} />);
    expect(screen.getByText(/VM agent online · DRY RUN/)).toBeInTheDocument();
    expect(screen.getByText(/real broadcasts are blocked, and rehearsals run with a simulated worker/)).toBeInTheDocument();
  });

  test("Rehearse asks first and sends rehearsal: true", async () => {
    window.confirm.mockReturnValueOnce(false);
    render(<AutoSchedule games={games} rows={[]} now={NOW} orchDoc={{ lastTickAt: NOW, capacity: 0 }} />);
    const row = screen.getByTestId("game-s1");
    fireEvent.click(within(row).getByRole("button", { name: "Rehearse" }));
    expect(calls).toEqual([]);
    fireEvent.click(within(row).getByRole("button", { name: "Rehearse" }));
    expect(window.confirm.mock.calls[1][0]).toMatch(/never touches YouTube/);
    await screen.findByText(/Rehearsal scheduled — nothing goes to YouTube/);
    expect(calls.map((c) => c.body)).toEqual([{ action: "auto-select", scheduleId: "s1", rehearsal: true }]);
  });

  test("a rehearsal is always labelled as one and never counts as a real live broadcast", () => {
    const r = { id: "r401001", gameId: "401001", rehearsal: true, status: "rehearsal", auto: { phase: "live", open: true, active: true } };
    expect(autoState(r).label).toBe("Rehearsal · Live");
    expect(overallStatus(r)).toBe("rehearsal");
    expect(statusCounts([r])).toEqual({ live: 0, preparing: 0, scheduled: 0, error: 0 });
    expect(filterBroadcasts([r], "upcoming")).toHaveLength(1);
    render(<AutoSchedule games={games} rows={[r]} now={NOW} orchDoc={{ lastTickAt: NOW, capacity: 0 }} />);
    const row = screen.getByTestId("game-s1");
    expect(within(row).getByText("Rehearsal · Live")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "End Broadcast" })).toBeInTheDocument();
  });

  test("a held (blocked) game shows Blocked with the server's reason", () => {
    const r = { id: "g401001", gameId: "401001", status: "scheduled", auto: { phase: "selected", open: true, kickoffAt: NOW + 3600e3, error: "No Worker Stream is configured (0 stream slots) — pick one…" } };
    render(<AutoSchedule games={games} rows={[r]} now={NOW} orchDoc={{ lastTickAt: NOW, capacity: 0 }} />);
    const row = screen.getByTestId("game-s1");
    expect(within(row).getByText("Blocked")).toBeInTheDocument();
    expect(within(row).getByText(/pick one…/)).toBeInTheDocument();
  });
});

test("Retry is disabled for a failed broadcast whose YouTube end is unconfirmed", () => {
  const { AutoSchedule } = require("./AdminStreamManager");
  const within = require("@testing-library/react").within;
  const NOW = Date.UTC(2026, 9, 10, 15, 0);
  const games = [{ id: "s1", Home: "LSU", Away: "Clemson", KickoffAt: NOW + 3600e3, CFBDGameId: 401001 }];
  const rec = (auto) => ({ id: "g401001", gameId: "401001", status: "error", auto: { phase: "failed", open: false, ...auto } });
  const { rerender } = render(<AutoSchedule games={games} rows={[rec({ ytUnconfirmed: true, error: "Couldn't confirm the YouTube broadcast ended" })]} now={NOW} />);
  const btn = () => within(screen.getByTestId("game-s1")).getByRole("button", { name: "Retry" });
  expect(btn()).toBeDisabled();
  expect(btn().title).toMatch(/never confirmed/);
  rerender(<AutoSchedule games={games} rows={[rec({ ytUnconfirmed: false })]} now={NOW} />);
  expect(btn()).toBeEnabled();
});
