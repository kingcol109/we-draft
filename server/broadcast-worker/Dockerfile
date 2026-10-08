# server/broadcast-worker/Dockerfile
#
# The broadcast worker as a Linux container: headless Chromium (Playwright),
# FFmpeg, Node — no display, no GPU. Build context is this directory:
#
#   docker build -t we-draft-broadcast-worker server/broadcast-worker
#
# Run commands (worker, 10-minute test, fault tests): see README.md.
# tini is built in as PID 1, so no --init is needed.
#
# Base: Playwright's own image — Ubuntu 24.04 with Node 22, Chromium at the
# exact revision playwright@1.64.0 expects, and every library and font it
# needs. The tag must match the playwright version in package.json.
FROM mcr.microsoft.com/playwright:v1.64.0-noble

# FFmpeg from Ubuntu (libx264 included) rather than ffmpeg-static's GitHub
# download; tini as PID 1 forwards SIGTERM/SIGINT to the worker and reaps
# Chromium's child processes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tini \
 && rm -rf /var/lib/apt/lists/* \
 && ffmpeg -hide_banner -encoders | grep -q libx264

WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the browsers are already in the image (/ms-playwright)
# and FFmpeg comes from apt, so neither postinstall download is wanted.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY *.js ./

# Fail the build now, not at kickoff, if Playwright can't find its Chromium.
RUN node -e "const fs=require('fs');const p=require('playwright').chromium.executablePath();if(!fs.existsSync(p)){console.error('Chromium missing at '+p);process.exit(1)}"

ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    OUTPUT_DIR=/out
RUN mkdir -p /out && chown pwuser:pwuser /out
VOLUME /out
USER pwuser

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "worker.js"]
