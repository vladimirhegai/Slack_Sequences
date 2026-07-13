# Sequences for Slack — Railway image.
# Ships Chromium + FFmpeg for HyperFrames rendering and runs the TypeScript
# source directly with tsx (the app has no emitted JS build artifact).
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    ffmpeg \
    fonts-liberation \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

# Headless Chromium runs as root in this container and refuses to start without
# --no-sandbox (crbug.com/638180). The producer launches whatever
# PUPPETEER_EXECUTABLE_PATH points at, so wrap chromium to always inject the
# container-safe flags (--disable-dev-shm-usage avoids crashes on Railway's
# small /dev/shm).
RUN printf '#!/bin/sh\nexec /usr/bin/chromium --no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage "$@"\n' \
      > /usr/local/bin/chromium-no-sandbox \
  && chmod +x /usr/local/bin/chromium-no-sandbox

WORKDIR /app

# Never download a bundled Chromium during install — the image already has one,
# and puppeteer-core does not need it. Belt-and-suspenders against any dep that
# would try (e.g. a transitive full puppeteer).
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install dependencies as their own cached layer. Copying only the workspace
# manifests + lockfile before `npm ci` means a source-only change does NOT bust
# the install layer — `npm ci` (hundreds of packages, the slow + memory-hungry
# step that OOMs/times out small Railway builders) is reused. `COPY . .` happens
# after, so editing source no longer reinstalls the whole tree from scratch.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/platform/package.json packages/platform/
COPY apps/slack/package.json apps/slack/

# Install the whole workspace from the committed lockfile. There is no compile
# step: the slack app runs `.ts` directly via tsx, and typecheck stays in CI.
RUN npm ci

COPY . .

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chromium-no-sandbox \
    PRODUCER_LOW_MEMORY_MODE=true \
    SLACK_SEQUENCES_DATA_DIR=/data

# Prepare Railway's `/data` mount point for projects, renders, encrypted user
# tokens, and the job map. The service-level Railway volume supplies persistence.
# Run as root (the image default — note no USER directive): Railway mounts the
# volume root-owned, so a non-root user can't write /data
# (docs.railway.com/volumes/reference), and headless Chromium also needs root to
# start under the producer. RAILWAY_RUN_UID=0 is the alternative if a USER is set.
RUN mkdir -p /data

# Railway injects PORT; the HTTP server (health + OAuth) binds it on 0.0.0.0.
CMD ["npm", "run", "start", "-w", "@sequences/slack"]
