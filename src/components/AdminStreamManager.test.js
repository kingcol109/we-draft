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
    expect(rows).toEqual(["game-national", "game-s4", "game-s1", "game-s3", "game-s2"]); // national is pinned first; s5 is outside 7 days
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

describe("National Coverage", () => {
  const { NationalCoverage, defaultNationalWindow } = require("./AdminStreamManager");
  const within = require("@testing-library/react").within;
  const NOW = new Date(2026, 9, 8, 15, 0).getTime(); // a Thursday, local time
  const H = 3600e3;
  const nat = (id, auto, extra = {}) => ({ id, kind: "national", gameId: null, gameSlug: "national", youtube: { privacyStatus: "unlisted" }, auto: { open: true, kickoffAt: NOW + 2 * H, endAt: NOW + 10 * H, ...auto }, ...extra });

  beforeEach(() => {
    global.fetch = jest.fn((url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ url, auth: opts.headers.Authorization, body });
      return reply(200, { ok: true, id: "n1", created: true });
    });
  });

  test("the default window is the coming Saturday, 11:30 AM to 11:59 PM ET", () => {
    const et = (ms) => new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
    const { start, end } = defaultNationalWindow(Date.parse("2026-10-08T19:00:00Z")); // Thursday
    expect(et(start)).toBe("Sat, 10/10, 11:30 AM");
    expect(et(end)).toBe("Sat, 10/10, 11:59 PM");
    expect(end - start).toBeLessThan(20 * H);
    // on a Saturday it's today; in standard time too
    expect(et(defaultNationalWindow(Date.parse("2026-11-14T15:00:00Z")).start)).toBe("Sat, 11/14, 11:30 AM");
    // late Saturday night ET (already Sunday in UTC) is still Saturday
    expect(et(defaultNationalWindow(Date.parse("2026-10-11T02:00:00Z")).start)).toBe("Sat, 10/10, 11:30 AM");
  });

  test("Enable asks first, then only sends auto-national with the window", async () => {
    window.confirm.mockReturnValueOnce(false);
    render(<NationalCoverage rows={[]} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(window.confirm.mock.calls[1][0]).toMatch(/15 min after every game in the window is FINAL/);
    expect(await screen.findByText(/Scheduled — it starts automatically/)).toBeInTheDocument();
    const { start, end } = defaultNationalWindow(NOW);
    expect(calls.map((c) => c.body)).toEqual([{ action: "auto-national", startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), privacyStatus: "unlisted", confirmPublic: false }]);
  });

  test("Rehearse sends rehearsal: true; public needs the confirmation box", async () => {
    render(<NationalCoverage rows={[]} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Public" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(await screen.findByText(/Tick the public confirmation/)).toBeInTheDocument();
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Rehearse" }));
    await screen.findByText(/Rehearsal scheduled/);
    expect(calls[0].body).toMatchObject({ action: "auto-national", rehearsal: true });
  });

  test("an on-air window ends with its own confirmation and confirmEnd; game records aren't listed", async () => {
    render(<NationalCoverage rows={[nat("n1", { phase: "live" }), { id: "g1", gameId: "1", auto: { open: true, phase: "live" } }]} now={NOW} onOpen={() => {}} />);
    expect(screen.getAllByTestId(/^national-/).map((r) => r.dataset.testid)).toEqual(["national-n1"]);
    fireEvent.click(within(screen.getByTestId("national-n1")).getByRole("button", { name: "End Broadcast" }));
    expect(window.confirm.mock.calls[0][0]).toMatch(/ON AIR/);
    await screen.findByText(/Ending/);
    expect(calls.map((c) => c.body)).toEqual([{ action: "auto-cancel", id: "n1", confirmEnd: true }]);
  });

  test("Retry only while the window isn't over", () => {
    render(<NationalCoverage rows={[nat("n1", { open: false, phase: "failed" }), nat("n2", { open: false, phase: "cancelled", kickoffAt: NOW - 10 * H, endAt: NOW - H })]} now={NOW} />);
    expect(within(screen.getByTestId("national-n1")).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(within(screen.getByTestId("national-n2")).queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

// ── Edit Metadata (YouTube title / description drafts) ──
// A faked metadata-get / metadata-save; any other action would be recorded
// and refused, so these tests also prove the editor never enables
// automation, creates a broadcast or touches the VM.
describe("Edit Metadata", () => {
  const { AutoSchedule } = require("./AdminStreamManager");
  const { within } = require("@testing-library/react");
  const NOW = Date.UTC(2026, 9, 10, 15, 0);
  const games = [
    { id: "s1", Home: "Wake Forest", Away: "North Carolina", KickoffAt: NOW + 2 * 3600e3, CFBDGameId: 401001, Week: "Week 7" },
    { id: "s3", Home: "Navy", Away: "Army", KickoffAt: NOW + 3 * 3600e3, CFBDGameId: null },
  ];
  const DEFAULTS = { title: "We-Draft Live: North Carolina vs Wake Forest", description: "Kickoff: Saturday\n\nNorth Carolina at Wake Forest — live scores." };
  let drafts, youtubeCreated, saveFails;

  beforeEach(() => {
    drafts = {}; youtubeCreated = false; saveFails = null;
    global.fetch = jest.fn((url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ url, auth: opts.headers.Authorization, body });
      const gameId = body.scheduleId === "s1" ? "401001" : null;
      if (body.action === "metadata-get") {
        return reply(200, { game: { gameId }, draft: drafts[gameId] || null, defaults: DEFAULTS, limits: { titleMax: 100, descriptionMaxBytes: 5000 }, broadcast: { exists: youtubeCreated, youtubeCreated } });
      }
      if (body.action === "metadata-save") {
        if (saveFails) return reply(saveFails.code, { error: saveFails.error });
        const cur = drafts[gameId];
        drafts[gameId] = { title: body.title.trim(), description: body.description.trim(), version: (cur?.version || 0) + 1, updatedAt: NOW, updatedBy: "admin1", thumbnail: null };
        return reply(200, { ok: true, gameId, draft: drafts[gameId] });
      }
      return reply(400, { error: `unexpected action ${body.action}` });
    });
  });

  const renderPicker = () => render(<AutoSchedule games={games} rows={[]} now={NOW} statusById={{}} orchDoc={null} agentDoc={null} />);
  const open = async (id = "s1") => {
    fireEvent.click(within(screen.getByTestId(`game-${id}`)).getByRole("button", { name: "Edit Metadata" }));
    return screen.findByRole("dialog");
  };
  const titleBox = () => screen.getByLabelText("YouTube title");
  const descBox = () => screen.getByLabelText("YouTube description");
  const actions = () => calls.map((c) => c.body.action);
  const onlyMetadataCalls = () => actions().every((a) => a.startsWith("metadata-"));

  test("opens for a game that isn't enabled and has no broadcast: the defaults, read-only", async () => {
    renderPicker();
    await open();
    expect(await screen.findByDisplayValue(DEFAULTS.title)).toBeInTheDocument();
    expect(descBox().value).toBe(DEFAULTS.description);
    expect(screen.getByTestId("metadata-status")).toHaveTextContent("Generated automatically");
    expect(screen.getByText(/Generated automatically from the matchup, ranks and kickoff/)).toBeInTheDocument();
    expect(calls.map((c) => c.body)).toEqual([{ action: "metadata-get", scheduleId: "s1" }]);
    expect(calls[0].auth).toBe("Bearer firebase-id-token");
    // opening changes nothing about the game's automation
    expect(within(screen.getByTestId("game-s1")).getByText("Not enabled")).toBeInTheDocument();
  });

  test("an unlinked game has no metadata to edit", () => {
    renderPicker();
    expect(within(screen.getByTestId("game-s3")).getByRole("button", { name: "Edit Metadata" })).toBeDisabled();
  });

  test("a previously saved draft is loaded instead of the defaults", async () => {
    drafts["401001"] = { title: "My saved title", description: "Saved\n\ndescription", version: 3, updatedAt: NOW, updatedBy: "admin1" };
    renderPicker();
    await open();
    expect(await screen.findByDisplayValue("My saved title")).toBeInTheDocument();
    expect(descBox().value).toBe("Saved\n\ndescription");
    expect(screen.getByTestId("metadata-status")).toHaveTextContent("Saved");
    expect(screen.getByRole("button", { name: "Save Draft" })).toBeDisabled(); // nothing changed
  });

  test("save, then reopen: the draft comes back with its line breaks; only metadata actions are sent", async () => {
    renderPicker();
    await open();
    await screen.findByDisplayValue(DEFAULTS.title);
    fireEvent.change(titleBox(), { target: { value: "Tar Heels at Demon Deacons" } });
    fireEvent.change(descBox(), { target: { value: "Line 1\n\nLine 3" } });
    expect(screen.getByTestId("metadata-status")).toHaveTextContent("Unsaved changes");
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(await screen.findByText("Draft saved.")).toBeInTheDocument();
    expect(calls[1].body).toEqual({ action: "metadata-save", scheduleId: "s1", title: "Tar Heels at Demon Deacons", description: "Line 1\n\nLine 3", baseVersion: 0 });
    expect(screen.getByTestId("metadata-status")).toHaveTextContent("Saved");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.confirm).not.toHaveBeenCalled(); // nothing unsaved
    await open();
    expect(await screen.findByDisplayValue("Tar Heels at Demon Deacons")).toBeInTheDocument();
    expect(descBox().value).toBe("Line 1\n\nLine 3");

    // a second save sends the version it opened
    fireEvent.change(titleBox(), { target: { value: "Second" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(drafts["401001"].title).toBe("Second"));
    expect(calls[calls.length - 1].body.baseVersion).toBe(1);
    expect(actions()).toEqual(["metadata-get", "metadata-save", "metadata-get", "metadata-save"]);
    expect(onlyMetadataCalls()).toBe(true);
  });

  test("editing and cancelling asks first and saves nothing", async () => {
    renderPicker();
    await open();
    await screen.findByDisplayValue(DEFAULTS.title);
    fireEvent.change(titleBox(), { target: { value: "Changed" } });
    window.confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(window.confirm.mock.calls[0][0]).toMatch(/unsaved changes/);
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // kept open
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(actions()).toEqual(["metadata-get"]);
    expect(drafts).toEqual({});
  });

  test("unsaved changes also warn before leaving the page", async () => {
    renderPicker();
    await open();
    await screen.findByDisplayValue(DEFAULTS.title);
    const leave = () => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    expect(leave()).toBe(false);
    fireEvent.change(descBox(), { target: { value: "edited" } });
    expect(leave()).toBe(true);
    fireEvent.change(descBox(), { target: { value: DEFAULTS.description } });
    expect(leave()).toBe(false); // back to what's saved
  });

  test("title and description are validated against YouTube's limits", async () => {
    renderPicker();
    await open();
    await screen.findByDisplayValue(DEFAULTS.title);
    const save = () => screen.getByRole("button", { name: "Save Draft" });

    fireEvent.change(titleBox(), { target: { value: "x".repeat(101) } });
    expect(screen.getByText(/Title must be 100 characters or fewer \(it's 101\)/)).toBeInTheDocument();
    expect(screen.getByText("101 / 100 characters")).toBeInTheDocument();
    expect(save()).toBeDisabled();

    fireEvent.change(titleBox(), { target: { value: "   " } });
    expect(screen.getByText("Title is required.")).toBeInTheDocument();
    expect(save()).toBeDisabled();

    fireEvent.change(titleBox(), { target: { value: "Fine" } });
    fireEvent.change(descBox(), { target: { value: "a <tag>" } });
    expect(screen.getByText("Description can't contain < or >.")).toBeInTheDocument();
    expect(save()).toBeDisabled();

    // bytes, not characters: 2,501 × "é" is 5,002 bytes
    fireEvent.change(descBox(), { target: { value: "é".repeat(2501) } });
    expect(screen.getByText(/5000 bytes or fewer \(it's 5002\)/)).toBeInTheDocument();
    fireEvent.change(descBox(), { target: { value: "é".repeat(2500) } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    expect(await screen.findByText("Draft saved.")).toBeInTheDocument();
  });

  test("the preview shows the title and the description's line breaks", async () => {
    renderPicker();
    await open();
    await screen.findByDisplayValue(DEFAULTS.title);
    fireEvent.change(titleBox(), { target: { value: "Preview me" } });
    fireEvent.change(descBox(), { target: { value: "One\n\nThree" } });
    expect(screen.getByTestId("preview-title")).toHaveTextContent("Preview me");
    expect(screen.getByTestId("preview-description").textContent).toBe("One\n\nThree");
    expect(screen.getByTestId("preview-description")).toHaveStyle({ whiteSpace: "pre-wrap" });
  });

  test("Reset puts the generated text back (after asking) without saving", async () => {
    drafts["401001"] = { title: "Saved title", description: "Saved", version: 1, updatedAt: NOW };
    renderPicker();
    await open();
    await screen.findByDisplayValue("Saved title");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(window.confirm.mock.calls[0][0]).toMatch(/generated text/);
    expect(titleBox().value).toBe(DEFAULTS.title);
    expect(descBox().value).toBe(DEFAULTS.description);
    expect(screen.getByTestId("metadata-status")).toHaveTextContent("Unsaved changes");
    expect(actions()).toEqual(["metadata-get"]);
    expect(drafts["401001"].title).toBe("Saved title");
  });

  test("the editor opens above the site navbar, centered and inside the window", async () => {
    renderPicker();
    const dialog = await open();
    expect(Number(dialog.style.zIndex)).toBeGreaterThan(10002); // Navbar.js uses up to 10002
    expect(dialog).toHaveStyle({ position: "fixed", alignItems: "center" });
    expect(dialog.firstChild).toHaveStyle({ maxHeight: "calc(100vh - 48px)" });
    expect(screen.getByTestId("metadata-body")).toHaveStyle({ overflowY: "auto" });
  });

  test("a game whose YouTube broadcast exists says the draft won't change it", async () => {
    youtubeCreated = true;
    renderPicker();
    await open();
    expect(await screen.findByText(/YouTube broadcast already exists. Saving here does not change it/)).toBeInTheDocument();
  });

  test("a failed save shows the server's message and keeps the edits", async () => {
    saveFails = { code: 409, error: "This draft was saved somewhere else since you opened it — close the editor and reopen it to see the latest." };
    renderPicker();
    await open();
    await screen.findByDisplayValue(DEFAULTS.title);
    fireEvent.change(titleBox(), { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(await screen.findByText(/saved somewhere else/)).toBeInTheDocument();
    expect(titleBox().value).toBe("Mine");
    expect(screen.getByTestId("metadata-status")).toHaveTextContent("Unsaved changes");
  });
});

// ── Edit Metadata → Thumbnail ──
describe("Edit Metadata thumbnail", () => {
  const { AutoSchedule } = require("./AdminStreamManager");
  const { within } = require("@testing-library/react");
  const NOW = Date.UTC(2026, 9, 10, 15, 0);
  const games = [{ id: "s1", Home: "Wake Forest", Away: "North Carolina", KickoffAt: NOW + 2 * 3600e3, CFBDGameId: 401001 }];
  const DEFAULTS = { title: "We-Draft Live: North Carolina vs Wake Forest", description: "d" };
  const IMG = (n) => `data:image/png;base64,PNG${n}`;
  let saved, gens, notes, genFails;

  beforeEach(() => {
    saved = null; gens = 0; notes = []; genFails = null;
    global.fetch = jest.fn((url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ url, auth: opts.headers.Authorization, body });
      switch (body.action) {
        case "metadata-get":
          return reply(200, { game: { gameId: "401001" }, draft: null, thumbnail: saved, defaults: DEFAULTS, limits: { titleMax: 100, descriptionMaxBytes: 5000 }, broadcast: { exists: false, youtubeCreated: false } });
        case "metadata-thumbnail-generate":
          if (genFails) return reply(genFails.code, { error: genFails.error });
          gens++;
          return reply(200, { gameId: "401001", sha256: `${"a".repeat(63)}${gens}`, width: 1280, height: 720, bytes: 1000, notes, dataUrl: IMG(gens) });
        case "metadata-thumbnail-save":
          saved = { sha256: body.sha256, width: 1280, height: 720, version: 1, updatedAt: NOW, dataUrl: IMG(`saved-${body.sha256.slice(-1)}`) };
          return reply(200, { ok: true, gameId: "401001", thumbnail: saved });
        default:
          return reply(400, { error: `unexpected action ${body.action}` });
      }
    });
  });

  const open = async () => {
    render(<AutoSchedule games={games} rows={[]} now={NOW} statusById={{}} orchDoc={null} agentDoc={null} />);
    fireEvent.click(within(screen.getByTestId("game-s1")).getByRole("button", { name: "Edit Metadata" }));
    await screen.findByDisplayValue(DEFAULTS.title);
  };
  const actions = () => calls.map((c) => c.body.action);
  const click = (name) => fireEvent.click(screen.getByRole("button", { name }));

  test("Generate shows a preview without saving anything", async () => {
    await open();
    expect(screen.getByTestId("thumbnail-status")).toHaveTextContent("None yet");
    click("Generate Thumbnail");
    const img = await screen.findByAltText("Thumbnail preview (not saved)");
    expect(img).toHaveAttribute("src", IMG(1));
    expect(screen.getByTestId("thumbnail-status")).toHaveTextContent("Preview — not saved");
    expect(screen.getByTestId("metadata-status")).toHaveTextContent("Unsaved changes");
    expect(actions()).toEqual(["metadata-get", "metadata-thumbnail-generate"]);
    expect(saved).toBeNull();
  });

  test("Regenerate replaces the preview; Save Thumbnail stores the previewed image (by its hash), nothing else", async () => {
    await open();
    click("Generate Thumbnail");
    await screen.findByAltText("Thumbnail preview (not saved)");
    click("Regenerate");
    await waitFor(() => expect(screen.getByAltText("Thumbnail preview (not saved)")).toHaveAttribute("src", IMG(2)));
    click("Save Thumbnail");
    expect(await screen.findByText("Thumbnail saved.")).toBeInTheDocument();
    expect(calls[calls.length - 1].body).toEqual({ action: "metadata-thumbnail-save", scheduleId: "s1", sha256: `${"a".repeat(63)}2` });
    expect(screen.getByAltText("Saved thumbnail")).toHaveAttribute("src", IMG("saved-2"));
    expect(screen.getByTestId("thumbnail-status")).toHaveTextContent("Saved");
    expect(screen.getByTestId("metadata-status")).not.toHaveTextContent("Unsaved");
    expect(actions().every((a) => a.startsWith("metadata-"))).toBe(true);
    // closing now asks nothing
    click("Cancel");
    expect(window.confirm).not.toHaveBeenCalled();
  });

  test("a saved thumbnail is shown when the editor opens", async () => {
    saved = { sha256: "b".repeat(64), width: 1280, height: 720, version: 2, updatedAt: NOW, dataUrl: IMG("old") };
    await open();
    expect(screen.getByAltText("Saved thumbnail")).toHaveAttribute("src", IMG("old"));
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
  });

  test("an unsaved preview warns before closing; Discard drops it", async () => {
    await open();
    click("Generate Thumbnail");
    await screen.findByAltText("Thumbnail preview (not saved)");
    window.confirm.mockReturnValueOnce(false);
    click("Cancel");
    expect(window.confirm.mock.calls[0][0]).toMatch(/unsaved changes to this game's thumbnail/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    click("Discard");
    expect(screen.queryByAltText("Thumbnail preview (not saved)")).toBeNull();
    expect(screen.getByTestId("metadata-status")).not.toHaveTextContent("Unsaved");
  });

  test("missing logos or colors are explained under the preview; errors are shown", async () => {
    notes = ["Ghost U: no logo could be loaded — showing initials."];
    await open();
    click("Generate Thumbnail");
    expect(await screen.findByText(/no logo could be loaded — showing initials/)).toBeInTheDocument();
    genFails = { code: 400, error: "That game isn't in the CFB schedule." };
    click("Regenerate");
    expect(await screen.findByText("That game isn't in the CFB schedule.")).toBeInTheDocument();
  });

  test("saving the text draft doesn't save the thumbnail preview, and vice versa", async () => {
    await open();
    click("Generate Thumbnail");
    await screen.findByAltText("Thumbnail preview (not saved)");
    fireEvent.change(screen.getByLabelText("YouTube title"), { target: { value: "New title" } });
    global.fetch.mockImplementationOnce((url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ url, body });
      return reply(200, { ok: true, gameId: "401001", draft: { title: body.title, description: body.description, version: 1, updatedAt: NOW } });
    });
    click("Save Draft");
    expect(await screen.findByText("Draft saved.")).toBeInTheDocument();
    expect(saved).toBeNull();
    expect(screen.getByTestId("thumbnail-status")).toHaveTextContent("Preview — not saved");
  });
});

// ── National coverage pinned in Auto Schedule, with its own metadata ──
describe("National coverage in Auto Schedule", () => {
  const { AutoSchedule, defaultNationalWindow } = require("./AdminStreamManager");
  const { within } = require("@testing-library/react");
  const NOW = new Date(2026, 9, 8, 15, 0).getTime(); // a Thursday, local time
  const games = [
    { id: "s1", Home: "Wake Forest", Away: "North Carolina", KickoffAt: NOW + 2 * 3600e3, CFBDGameId: 401001 },
    { id: "s2", Home: "LSU", Away: "Clemson", KickoffAt: NOW + 3 * 3600e3, CFBDGameId: 401002 },
  ];
  const NAT = { title: "College Football LIVE | Scores, Highlights & Action Around the Country", description: "College football action from across the country — all in one place. 🏈\n\n#CollegeFootball #CollegeFootballLive #WeDraftLive #FSUvsLOU" };

  beforeEach(() => {
    global.fetch = jest.fn((url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ url, auth: opts.headers.Authorization, body });
      if (body.action === "metadata-get") {
        return reply(200, { game: null, national: { startAt: Date.parse(body.startAt), endAt: Date.parse(body.endAt) }, draft: null, thumbnail: null, defaults: NAT, limits: { titleMax: 100, descriptionMaxBytes: 5000 }, broadcast: { exists: false, youtubeCreated: false } });
      }
      if (body.action === "metadata-thumbnail-generate") return reply(200, { gameId: "national", sha256: "c".repeat(64), width: 1280, height: 720, notes: [], dataUrl: "data:image/png;base64,NAT" });
      return reply(400, { error: `unexpected action ${body.action}` });
    });
  });
  const renderPicker = (rows = []) => render(<AutoSchedule games={games} rows={rows} now={NOW} statusById={{}} orchDoc={null} agentDoc={null} />);
  const ids = () => screen.getAllByTestId(/^game-/).map((r) => r.dataset.testid);

  test("national coverage is the first row, pinned, whatever the search or filters", () => {
    renderPicker();
    expect(ids()[0]).toBe("game-national");
    expect(within(screen.getByTestId("game-national")).getByText("PINNED")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search teams…"), { target: { value: "zzz" } });
    expect(ids()).toEqual(["game-national"]);
    expect(screen.getByText(/No games in this window/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search teams…"), { target: { value: "" } });
    fireEvent.click(screen.getByLabelText("Enabled only"));
    expect(ids()).toEqual(["game-national"]);
    expect(calls).toEqual([]);
  });

  test("still pinned while the schedule loads", () => {
    render(<AutoSchedule games={null} rows={[]} now={NOW} statusById={{}} orchDoc={null} agentDoc={null} />);
    expect(ids()).toEqual(["game-national"]);
    expect(screen.getByText("Loading schedule…")).toBeInTheDocument();
  });

  test("Edit Metadata opens the national editor for the window set in the row — read-only, nothing scheduled", async () => {
    renderPicker();
    fireEvent.click(within(screen.getByTestId("game-national")).getByRole("button", { name: "Edit Metadata" }));
    expect(await screen.findByDisplayValue(NAT.title)).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("National Coverage")).toBeInTheDocument();
    const w = defaultNationalWindow(NOW);
    expect(calls.map((c) => c.body)).toEqual([{ action: "metadata-get", national: true, startAt: new Date(w.start).toISOString(), endAt: new Date(w.end).toISOString() }]);
    expect(screen.getByLabelText("YouTube description").value).toMatch(/#WeDraftLive #FSUvsLOU$/);
    expect(screen.getByText(/the window's top game \(Game of the Week, else Featured\) goes in the hashtags/)).toBeInTheDocument();
    // the thumbnail is the national one, for the same window
    fireEvent.click(screen.getByRole("button", { name: "Generate Thumbnail" }));
    expect(await screen.findByAltText("Thumbnail preview (not saved)")).toHaveAttribute("src", "data:image/png;base64,NAT");
    expect(calls[1].body).toEqual({ action: "metadata-thumbnail-generate", national: true, startAt: new Date(w.start).toISOString(), endAt: new Date(w.end).toISOString() });
    expect(calls.every((c) => c.body.action.startsWith("metadata-"))).toBe(true);
  });

  test("with a national window scheduled, the editor follows that window", async () => {
    const rec = { id: "n1", kind: "national", gameId: null, youtube: { privacyStatus: "unlisted" }, auto: { open: true, phase: "selected", kickoffAt: NOW + 3600e3, endAt: NOW + 9 * 3600e3 } };
    renderPicker([rec]);
    fireEvent.click(within(screen.getByTestId("game-national")).getByRole("button", { name: "Edit Metadata" }));
    await screen.findByDisplayValue(NAT.title);
    expect(calls[0].body).toEqual({ action: "metadata-get", national: true, startAt: new Date(NOW + 3600e3).toISOString(), endAt: new Date(NOW + 9 * 3600e3).toISOString() });
  });

  test("a game's Edit Metadata is still the game's", async () => {
    renderPicker();
    fireEvent.click(within(screen.getByTestId("game-s2")).getByRole("button", { name: "Edit Metadata" }));
    await screen.findByRole("dialog");
    expect(calls[0].body).toEqual({ action: "metadata-get", scheduleId: "s2" });
  });
});
