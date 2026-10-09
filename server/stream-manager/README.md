# Stream Manager: worker VM control

`api/stream-manager.js` can start, stop and read the status of the broadcast
worker VM, `we-draft-broadcast-01`, through Compute Engine
([compute.js](compute.js)). Only the server makes these calls. The browser
never sees a credential, and a request can't choose which VM to act on,
because the target comes only from env vars.

## API

`POST /api/stream-manager` with `Authorization: Bearer <Firebase ID token>`.
The caller's `users/{uid}.role` must be `admin`. Otherwise the server returns
401/403 and makes no Compute Engine call.

| action | body | result |
|---|---|---|
| `vm-status` | none | `{ instance }` |
| `vm-start` | none | `{ ok, result: "starting" \| "already-running", operation?, instance }` |
| `vm-stop` | `{ confirmLive? }` | `{ ok, result: "stopping" \| "already-stopped", operation?, instance }` |

`instance` is `{ name, zone, status, state, machineType, lastStartTimestamp, lastStopTimestamp }`.
`status` is Compute Engine's raw value (`RUNNING`, `TERMINATED`, …). `state` is
one of `starting`, `running`, `stopping`, `stopped`, `suspended`, `repairing`
or `unknown`. Metadata, IPs, disks and service accounts are never returned.

Each call returns as soon as Google accepts it. A start or stop takes
10–60s to finish, so poll `vm-status` to see the result.

Rules:

- **Start** only runs when the VM is `TERMINATED`/`STOPPED`. If it's already
  starting or running, nothing happens. If it's stopping, suspended or
  repairing, the call returns 409.
- **Stop** only runs when the VM is running, starting or repairing. If it's
  already stopped or stopping, nothing happens. If any `broadcasts` record
  has `status == "live"`, the call returns 409 unless `confirmLive` is
  exactly `true`, because stopping the VM ends the stream.
- Config errors return 500 naming the variable, never its value. Errors from
  Compute Engine return 502, and a timeout (10s) returns 504.
- Every start or stop is logged as
  `stream-manager vm-start uid=<admin> instance=<name> from=<status> op=<operation>`.
  The key and access tokens are never logged.

## Google Cloud setup (one time)

Run these with `gcloud` as a project owner, or in Cloud Shell. First set
these values to match the VM. The Compute Engine → VM instances page shows
its zone.

```bash
PROJECT=<your-project-id>          # the project that owns we-draft-broadcast-01
ZONE=<vm-zone>                     # e.g. us-east1-b
VM=we-draft-broadcast-01
SA=we-draft-vm-control
```

**1. Create a dedicated service account.** It does nothing else. Don't
reuse the Firestore/GA4 account in `GOOGLE_SERVICE_ACCOUNT_KEY`. The server
refuses to use that one for VM control.

```bash
gcloud iam service-accounts create $SA --project $PROJECT \
  --display-name "We-Draft Stream Manager VM control"
```

**2. Create a custom role with only three permissions.** These are read
status, start and stop. The account gets no delete, no SSH, no
metadata/startup-script edits and no access to other resources.

```bash
gcloud iam roles create weDraftBroadcastVmOperator --project $PROJECT \
  --title "We-Draft broadcast VM operator" \
  --description "Start/stop/get the We-Draft broadcast worker VM" \
  --permissions compute.instances.get,compute.instances.start,compute.instances.stop \
  --stage GA
```

**3. Grant the role on the VM only, not the project.** The account can then
act on `we-draft-broadcast-01` and nothing else, so it can't even list
other VMs.

```bash
gcloud compute instances add-iam-policy-binding $VM --project $PROJECT --zone $ZONE \
  --member "serviceAccount:$SA@$PROJECT.iam.gserviceaccount.com" \
  --role "projects/$PROJECT/roles/weDraftBroadcastVmOperator"
```

**4. Create a JSON key.** Keep it off disk once it's in Vercel.

```bash
gcloud iam service-accounts keys create vm-control-key.json --project $PROJECT \
  --iam-account "$SA@$PROJECT.iam.gserviceaccount.com"
```

If your organization blocks key creation (the org policy
`iam.disableServiceAccountKeyCreation`), an org admin has to allow it for
this project. The alternative is Workload Identity Federation from Vercel,
which this code doesn't support yet.

The Compute Engine API is already enabled, since the VM exists.

## Vercel environment variables

Set these for Production (and Preview, if you want the actions to work
there). Then redeploy.

| Variable | Required | Value |
|---|---|---|
| `GCE_SERVICE_ACCOUNT_KEY` | yes | The full contents of `vm-control-key.json` as one line (mark it **Sensitive**). Escaped `\n` in `private_key` is handled. |
| `GCE_PROJECT_ID` | yes | `$PROJECT`, the project the VM is in |
| `GCE_ZONE` | yes | `$ZONE`, e.g. `us-east1-b` |
| `GCE_INSTANCE_NAME` | no | Defaults to `we-draft-broadcast-01` |

One way to produce the single line: `jq -c . vm-control-key.json`. Paste the
output into the Vercel dashboard, then delete the local file
(`rm vm-control-key.json`).

The existing variables (`GOOGLE_SERVICE_ACCOUNT_KEY`, `YOUTUBE_OAUTH_*`,
`STREAM_MANAGER_TOKEN_KEY`) don't change.

## Verify

- Locally, without credentials or a VM: `npm run stream-manager:test`. It
  runs the real handler against faked Firebase auth, Firestore and Compute
  Engine.
- After deploying, run the read-only check, `vm-status`, as an admin. Open
  Admin → Stream Manager with DevTools → Network open. Click the
  `stream-manager` request the Channel panel makes and copy its
  `Authorization: Bearer …` value. Firebase ID tokens last an hour. Then run:

  ```bash
  curl -s https://we-draft.com/api/stream-manager \
    -H "Content-Type: application/json" -H "Authorization: Bearer <ID_TOKEN>" \
    -d '{"action":"vm-status"}'
  ```

  A 502 that says "refused the worker VM service account" means step 3's
  binding is missing or on the wrong VM. A 502 that says "can't find VM"
  means `GCE_PROJECT_ID`, `GCE_ZONE` or `GCE_INSTANCE_NAME` is wrong.

## Troubleshooting

- `vm-start` can return a permission error that mentions
  `iam.serviceAccounts.actAs`. That depends on how the VM's own attached
  service account is set up. In that case, grant `roles/iam.serviceAccountUser`
  on **that VM's service account only**, not the project:
  `gcloud iam service-accounts add-iam-policy-binding <vm-runtime-sa-email> --member serviceAccount:$SA@$PROJECT.iam.gserviceaccount.com --role roles/iam.serviceAccountUser`
- If the VM uses customer-supplied encryption keys, starting it needs
  `compute.instances.startWithEncryptionKey`, which this code doesn't send.
- To rotate the key, create a new one (step 4), update the Vercel variable,
  redeploy, then delete the old key with
  `gcloud iam service-accounts keys delete <old-key-id> --iam-account ...`.

# Automatic broadcasts (Auto Schedule)

Admin → Stream Manager → **Auto Schedule** lists upcoming games from the
saved CFB schedule (`schedule26`). An admin enables individual games.
Enabling only records the choice; the server does everything else, and
only for enabled games.

## Where the data comes from

| Data | Source |
|---|---|
| Games, kickoff (`KickoffAt`), `Final`, `Slug`, `CFBDGameId` | `schedule26/{id}`, the saved CFB schedule (kept current by the CFBD sync) |
| Live status (`scheduled` / `in_progress` / `final`) | `liveGames/{CFBDGameId}`, written by the `live-ingest` cron |
| Broadcast + automation state | `broadcasts/{id}`, the existing records, with an `auto` block. One per game (`g<CFBDGameId>`, or an existing record adopted) |
| Slots, capacity, VM ownership, last run | `streamManager/orchestrator` (admin read) |
| VM agent heartbeat | `streamManager/agent` (admin read) |

## How it runs

- **`api/stream-orchestrator.js`** is a Vercel Cron that runs every minute
  (`CRON_SECRET`). Each run is one pass of
  [orchestrator.js](orchestrator.js): it reads Firestore, the VM and
  YouTube, moves each enabled broadcast at most one step, and saves. No
  function stays alive, and no browser is involved. A lease keeps two runs
  from overlapping.
- **`api/broadcast-agent.js`** is the endpoint the VM agent
  ([server/broadcast-agent](../broadcast-agent/README.md)) polls every 10s
  (`STREAM_AGENT_TOKEN`). It records which containers are running and tells
  the agent which workers to run.

Each enabled game moves through these phases:

1. **selected:** waiting for kickoff minus 15 min. The kickoff is re-read
   from `schedule26` on every run, so time changes are picked up.
2. **preparing:** takes a stream slot, then creates the YouTube broadcast
   and binds it to that slot's stream. If the broadcast already exists, it's
   re-bound instead. The VM is started now if it's stopped.
3. **vm:** waits until the VM is running and the agent is reporting.
4. **worker:** the agent launches the worker for `/broadcast/<slug>?mode=stream`.
5. **ingest:** waits for YouTube's stream status to be `active`.
6. **going-live:** moves the broadcast testing → live, and only ever with
   the stream active.
7. **live:** watches `liveGames.status`.
8. **postgame:** starts at `final` and lasts 15 min. If the game leaves
   `final` (a correction), it goes back to live and the wait starts over.
9. **ending:** completes the YouTube broadcast first, then stops the worker.
10. **completed.**

Any step can instead end in **failed** (with an actionable error) or
**cancelled**. Both can be retried.

Guards:

- **Timeouts:** the VM must be up within 10 min, the worker within 5, ingest
  within 5 and going live within 5. Otherwise the broadcast fails with what
  to check.
- **Hard maximum runtime:** 6h from the worker's start. The orchestrator
  ends the broadcast, and the agent independently stops the container.
- **Recovery:** a crashed worker is restarted by the agent while the
  broadcast stays live. A VM that stops mid-broadcast is restarted.
- **Duplicates:**
  - one record per game, enforced in a transaction;
  - YouTube create has its own lock, and the broadcast id is saved before binding;
  - one container per record (`wd-bc-<id>`);
  - slots are given out by one run at a time.
- **VM stop:** the VM stops only if the orchestrator started it, nothing is
  active, no enabled game prepares within 45 min, and it's been idle 10 min.
  It never sends `confirmLive`, so the VM live guard stays in force.
- **Manual VM controls:**
  - Stop VM now also refuses while an automatic broadcast is starting or on
    air, unless `confirmLive` is sent.
  - A forced manual stop pauses automatic VM starts for 30 min.
  - A manual Start VM hands the VM to the admin, so the orchestrator never
    idle-stops it.

## Concurrent games

One reusable YouTube stream (one key) carries one feed at a time, so each
simultaneous broadcast needs its own **stream slot**. Under Auto Schedule →
Stream Slots, pick a stream for each slot and set "max at once". On the VM,
put slot N's key in `~/.we-draft/youtube-key-N` (slot 0 is the existing
`youtube-key`). With one slot, an overlapping game waits ("waiting for a
free stream slot") and starts once the slot frees up.

## Extra configuration

| Where | Variable | Value |
|---|---|---|
| Vercel | `CRON_SECRET` | already set (shared with `live-ingest`) |
| Vercel | `STREAM_AGENT_TOKEN` | 32+ random characters, the same as the VM's `~/.we-draft/agent-token` |
| VM | `/etc/we-draft-agent.env` | see [the agent README](../broadcast-agent/README.md) |

No new Google Cloud permissions are needed. The orchestrator uses the same
`we-draft-vm-control` account (get/start/stop) and the existing YouTube
connection.

## Cancelling, deleting and repairing statuses

- **Disabling a game** in Auto Schedule ends with automation phase
  `cancelled` and overall status `cancelled`. Automation is closed and
  deactivated, and `auto.enabled` becomes `false`. The orchestrator and the
  agent never act on it again until an admin clicks **Retry** or enables the
  game again (both reuse the same record).
  - Cancelled broadcasts are listed under **Ended** and aren't counted as
    Scheduled.
  - A cancelled record whose YouTube broadcast is somehow still on air shows
    **Error** instead, so it gets noticed.
- **Delete Record** removes only the Firestore record. The server refuses
  (409) while any of these is true:
  - automation is open or active;
  - the worker is starting or running;
  - the YouTube broadcast is testing or live.

  That way a running worker or a live broadcast is never left without a
  record to manage it.
- **Repair Statuses** (broadcast list toolbar, action `refresh-statuses`)
  recomputes the stored status of closed and manual records, and turns
  `auto.enabled` off on cancelled ones.
  - It always shows the list of changes first, and writes only after you
    confirm (`apply: true`).
  - It skips open automation records, which belong to the orchestrator,
    and never deletes anything.
  - Use it once after deploying the cancelled status, to fix records
    cancelled before it existed.

## Rehearsals (server-enforced dry run)

**Rehearse** (Auto Schedule) runs a game's whole lifecycle without YouTube.
It goes selected → preparing → VM → worker → simulated testing/live → FINAL
+ 15 min → ending → completed.

- **Its own record:** `broadcasts/r<CFBDGameId>` with `rehearsal: true`. It
  is never adopted as, or converted into, a real record, and a real record
  is never used for a rehearsal.
- **No YouTube, ever:** nothing is created, bound, transitioned, completed
  or even read.
  - The orchestrator replaces every YouTube function with one that refuses.
  - `youtubeCreate` / `youtubeRefresh` refuse rehearsal records too.
  - Simulated state lives in `auto.sim`; `youtube.*` stays empty.
  - The overall status is `rehearsal` while open, and the UI labels every
    state "Rehearsal · …".
- **No Worker Stream or slot needed.**
- **The worker is simulated only:** it's sent only to an agent that reports
  `DRY_RUN=1`, where it's an in-memory simulated container. A real agent
  refuses it, and the rehearsal fails with that reason.
- **Rerunnable:** Retry and Rehearse can run it again; both keep it a
  rehearsal.

**`STREAM_REHEARSAL_ONLY=1`** (optional Vercel env var, not set by default)
is a server-wide brake:
- real games can't be enabled or retried;
- real games already enabled are held before preparation;
- no YouTube broadcast can be created or started;
- completing a broadcast that's already on air is still allowed, so it can
  end safely.

## Failures after YouTube may be on air

Failures and timeouts in the ingest and going-live phases go through
**ending**, never straight to `failed`:

1. YouTube is read.
2. If testing or live, it's completed. If `testStarting` / `liveStarting`,
   the orchestrator waits.
3. The end is confirmed by a re-read (`complete`, `revoked`, `ready` or
   `created` counts as off the air).
4. Only then is the worker stopped.

The record ends **failed** with the reason (`failReason`). If YouTube can't
be confirmed off the air within 5 min (`ENDING_YT_TIMEOUT_MS`), the worker
is stopped anyway, and the record ends **failed** with "Couldn't confirm the
YouTube broadcast ended". It's never reported as completed. Retry is refused
while the stored YouTube state is still testing or live.

## No Worker Stream = 0 slots

Without a Worker Stream (or configured slots), capacity is 0 and the
orchestrator publishes `capacity: 0`. A real game is held in **selected**
with "No Worker Stream is configured":
- no VM start;
- no YouTube call;
- it doesn't keep an idle VM warm;
- it fails at kickoff.

The same hold applies when the VM agent last reported DRY_RUN, or in
rehearsal-only mode.

### Unconfirmed endings (`auto.ytUnconfirmed`)

When the ending can't confirm YouTube went off the air, the record ends
**failed** with `ytUnconfirmed: true`. Until that's cleared, the server
refuses all of these, whatever the stored YouTube state says:
- **Retry**
- **re-enabling the game** (Enable / Rehearse on any record of it)
- **Delete Record**
- **manual YouTube create/bind**

Only **Refresh YouTube Status** clears it, and only when its read shows the
broadcast off the air (`complete`, `revoked`, `ready`, `created`). A failed
read, a missing broadcast, or a testing/live/starting state leaves the flag
set.
- Refresh never creates, binds or transitions anything.
- The record stays **failed / Error** after the flag is cleared.
- Repair Statuses never touches the flag.

While a broadcast is **ending**, the agent's worker request carries
`noRestart: true`:
- a running worker keeps feeding YouTube;
- one that crashes or exits is not relaunched, and none is started fresh;
- the 6h hard limit and normal cleanup still apply.
