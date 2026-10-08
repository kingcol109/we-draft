# We-Draft broadcast agent (runs on the worker VM)

`agent.js` runs on `we-draft-broadcast-01` under systemd. It's the only thing
that starts or stops broadcast worker containers in automatic mode:

1. Every 10s it lists its worker containers (`docker ps`, label
   `wedraft.role=broadcast-worker`).
2. It reports them to `https://we-draft.com/api/broadcast-agent`.
3. It gets back the workers that should be running (record id, game slug,
   stream slot, hard deadline) and makes Docker match.

The control plane decides **when**: the Vercel cron runs
`server/stream-manager/orchestrator.js`. The agent decides **how**, using the
existing worker image unchanged:

```
docker run -d --name wd-bc-<id> \
  -e OUTPUT_MODE=youtube -e YOUTUBE_STREAM_URL=... \
  -e YOUTUBE_STREAM_KEY_FILE=/run/secrets/youtube-key \
  -v ~/.we-draft/youtube-key[-N]:/run/secrets/youtube-key:ro \
  we-draft-broadcast-worker node worker.js --game <slug> --base https://we-draft.com --duration <secs to deadline>
```

The VM needs no inbound ports and holds no Google credentials. Stream keys
never leave the VM.

## Safety

- **Hard deadline:** each worker runs with `--duration` up to its deadline
  (6h after the worker first starts). The agent also stops anything past its
  deadline, even if it can't reach the control plane.
- **Control plane unreachable:** running workers keep running (a network
  blip never ends a live game) until their deadline.
- **Crashes:** a crashed worker restarts with backoff (10s, 20s, 40s … up to
  2 min). Exit code 2 (bad settings) is never restarted; it's reported, and
  the broadcast fails with that reason.
- **Validation:** everything from the control plane is validated (id, game
  slug, slot) before use. Docker is called with an argument list, never
  through a shell.
- **No secrets in logs:** the agent never reads, sends or logs a stream key.
  Its own token is only sent in the `Authorization` header.
- **Dry run:** `DRY_RUN=1` logs what it would do without touching Docker.
- **One agent per VM:** `~/.we-draft/agent.pid` (or `LOCK_FILE`) is a pid
  lock. A second copy, such as `node agent.js` while the service runs,
  exits 2. To test by hand, `sudo systemctl stop we-draft-agent` first.
- **Don't run manual stream tests on slot keys:** never run a manual
  `docker run … youtube-key` test while automation could be live. YouTube
  can't tell two senders on the same key apart.

## Setup (one time, on the VM)

**1. Node 18+.** The worker image already has its own Node, but the agent
runs on the host.

```
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**2. The repo and the worker image.** If the repo is already on the VM,
skip the clone.

```
sudo git clone https://github.com/kingcol109/we-draft.git /opt/we-draft
sudo chown -R $USER /opt/we-draft
docker build -t we-draft-broadcast-worker /opt/we-draft/server/broadcast-worker
```

**3. Stream keys, one file per slot.** Slot 0 is the existing
`~/.we-draft/youtube-key`, which already holds the key of the Channel's
worker stream. For a second concurrent slot, add the second stream's key as
`youtube-key-1`, and so on. Use the same commands as the worker README:

```
read -rs -p "Slot 1 stream key: " KEY && printf '%s' "$KEY" > ~/.we-draft/youtube-key-1 && unset KEY && echo
chmod 644 ~/.we-draft/youtube-key-1
```

**4. The agent token.** Generate a random 32+ character token. It must be
the same value as `STREAM_AGENT_TOKEN` in Vercel.

```
openssl rand -hex 32 > ~/.we-draft/agent-token && chmod 600 ~/.we-draft/agent-token
cat ~/.we-draft/agent-token     # copy into Vercel → STREAM_AGENT_TOKEN, then clear your terminal
```

**5. Settings file** (`/etc/we-draft-agent.env`, `chmod 600`):

```
AGENT_URL=https://we-draft.com/api/broadcast-agent
AGENT_TOKEN_FILE=/home/<user>/.we-draft/agent-token
YOUTUBE_STREAM_URL=rtmps://a.rtmps.youtube.com/live2
KEY_DIR=/home/<user>/.we-draft
BASE_URL=https://we-draft.com
OUT_DIR=/home/<user>/we-draft-out
MAX_WORKERS=1
```

Set `MAX_WORKERS` to the number of broadcasts this VM can actually run at
once (about 2 vCPUs each). It's a local cap on top of Stream Manager's
"max at once".

**6. Service.** Copy `we-draft-agent.service` to `/etc/systemd/system/`, set
`User=` to your VM user, and check that the `ExecStart` path matches where
the repo is. Then:

```
sudo systemctl daemon-reload
sudo systemctl enable --now we-draft-agent
journalctl -u we-draft-agent -f
```

The agent starts on every boot, so when the orchestrator starts the VM,
the agent is reporting within about a minute.

## Checking it without streaming

- Start with `DRY_RUN=1` in the env file. The agent polls and reports, and
  Stream Manager → Auto Schedule shows "VM agent online", but it only logs
  the `docker` commands it would run.
- `node agent.js` reads `AGENT_TOKEN_FILE` and `YOUTUBE_STREAM_URL`, and
  exits 2 if either is missing or wrong.
- Unit tests (no Docker): `npm run stream-manager:test`.
