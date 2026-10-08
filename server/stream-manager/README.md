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
