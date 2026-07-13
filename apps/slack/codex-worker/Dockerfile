FROM node:22-bookworm-slim

ARG CODEX_VERSION=0.144.1
RUN npm install --global "@openai/codex@${CODEX_VERSION}" \
    && npm cache clean --force

ENV NODE_ENV=production \
    CODEX_HOME=/root/.codex \
    CODEX_CLI_VERSION=0.144.1 \
    PORT=3000

WORKDIR /opt/sequences-codex-worker
COPY package.json server.mjs worker-lib.mjs config.toml start.sh ./
RUN chmod 755 start.sh \
    && mkdir -p /root/.codex/sequences-jobs \
    && chmod 700 /root/.codex /root/.codex/sequences-jobs

VOLUME ["/root/.codex"]
EXPOSE 3000

ENTRYPOINT ["/opt/sequences-codex-worker/start.sh"]
