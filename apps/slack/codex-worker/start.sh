#!/bin/sh
set -eu
umask 077

: "${CODEX_HOME:=/root/.codex}"
export CODEX_HOME

mkdir -p "$CODEX_HOME/sequences-jobs"
chmod 700 "$CODEX_HOME" "$CODEX_HOME/sequences-jobs"
install -m 600 /opt/sequences-codex-worker/config.toml "$CODEX_HOME/config.toml"

if ! codex --strict-config login status >/dev/null 2>&1; then
  echo "[luna-worker] Codex config or login is unavailable in CODEX_HOME" >&2
  exit 1
fi

exec node /opt/sequences-codex-worker/server.mjs
