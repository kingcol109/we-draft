# We-Draft broadcast worker

Turns the broadcast page into continuous video:

```
/broadcast/:slug?mode=stream → headless Chromium (1920×1080 @1x) → CDP screencast (JPEG)
  → frame pump (constant 30 fps, wall-clock paced) → FFmpeg → H.264, video only
```

It doesn't read any game data itself. It opens the page, waits for
`window.__BROADCAST__.ready`, and records what the page shows.

## Setup (once)

From the repo root:

```
npm run broadcast-worker:install
```

This installs Playwright and `ffmpeg-static` (an FFmpeg build with libx264)
into this folder and downloads Chromium. You don't need to install FFmpeg
separately. To use a different build, set `FFMPEG_PATH`.

## Run

The site has to be running. Use two terminals, both in the repo root:

```
npm start
npm run broadcast-worker -- --game clemson-vs-lsu-9-5-2026 --replay 4
```

The worker runs until you press Ctrl+C. It then closes FFmpeg's input and
waits for FFmpeg to finish the file. Output goes to
`server/broadcast-worker/output/broadcast-test.mp4` by default. MP4 output is
fragmented, so the file stays playable even if the process is killed.

Leave out `--replay` for a game that's live right now. `--url` takes a full
broadcast URL instead of `--game`. The same settings are also read from env
vars (`BROADCAST_URL`, `GAME_ID`, `OUTPUT`, …). See [config.js](config.js).

Every 10s the worker logs output fps, new frames per second (average and
busiest second), dropped frames, and CPU/memory for Chromium, FFmpeg and
Node. When it exits it writes a summary to `<output>.stats.json`.

## Test

```
npm start                                  # terminal 1
npm run broadcast-worker:test              # terminal 2 (default 120s)
npm run broadcast-worker:test -- --duration 600
```

The test runs the worker on a finished game, replayed one play every 4s.
It then checks the file:

- H.264, 1920×1080, 30 fps, no audio
- decodes with no errors
- frame count equals frames written, and video length matches wall-clock time
- no dropped frames, and every stats sample at 30 fps
- the score, clock, recent plays and team stats each visibly change
  (frames every 20s, compared region by region)
- no Chromium processes left after the worker exits

Stills are saved to `output/stills/`.

## Fault tests (health / restart)

```
npm run broadcast-worker:faults
```

Each scenario starts the worker, breaks one thing, and checks the exit code,
that FFmpeg and Chromium are gone, and that the output still plays:

| Scenario | Fault | Expected |
|---|---|---|
| chromium-killed | Chromium browser process SIGKILLed | exit 1 |
| renderer-crash | page renderer SIGKILLed | exit 1 |
| ffmpeg-killed | FFmpeg SIGKILLed | exit 1 (file plays up to the kill) |
| page-frozen | renderer SIGSTOPped | exit 1 within ~30s |
| sigterm | `docker stop` | exit 0, file finished |
| sigint | Ctrl+C | exit 130, file finished |

The last three need POSIX signals, so on Windows they're skipped. They run
in the container.

## Docker

The image is built from this folder. It uses Playwright's Ubuntu 24.04 image
(Node 22 + Chromium) plus Ubuntu's FFmpeg, with `tini` as PID 1. It runs as
the non-root user `pwuser` and writes to `/out` (mount a host directory
there).

```
npm run broadcast-worker:docker-build
```

which runs `docker build -t we-draft-broadcast-worker server/broadcast-worker`.

**10-minute test in the container** (the site running on the host with
`npm start`):

```
npm run broadcast-worker:docker-test -- --duration 600
npm run broadcast-worker:docker-test -- --duration 600 --cpus 2   # as a 2-vCPU VM
npm run broadcast-worker:docker-test -- --faults                   # fault tests in the container
```

This runs test.js (or faults.js) inside the container and samples
`docker stats` from the host. Results land in
`server/broadcast-worker/output/docker/`: the MP4, `.stats.json`, stills,
and `docker-stats.json`.

**The worker on its own**:

```
docker run --rm --name wd-broadcast   --add-host=host.docker.internal:host-gateway   -v "$PWD/server/broadcast-worker/output/docker:/out"   we-draft-broadcast-worker   node worker.js --game clemson-vs-lsu-9-5-2026 --replay 4 --base http://host.docker.internal:3000
```

Stop it with `docker stop -t 30 wd-broadcast`. That sends SIGTERM; the worker
finishes the file and exits 0. Inside a container, `localhost` is the
container itself, so a dev server on the host is reached at
`host.docker.internal`. `--add-host` makes that name work on Linux hosts
too (Docker Desktop has it already).

## Exit codes

- `0`: stopped (duration reached or SIGTERM)
- `1`: failure (page wouldn't load, Chromium/page crashed, page
  unresponsive for 30s, FFmpeg died). A supervisor should restart.
- `130`: Ctrl+C
