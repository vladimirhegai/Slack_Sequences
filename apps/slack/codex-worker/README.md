# Sequences Codex worker

This is the private Railway-side execution boundary for the Luna authoring
route. It runs one Codex CLI turn at a time, keeps each session in its own
workspace under `$CODEX_HOME/sequences-jobs`, and resumes only the exact thread
ID persisted for that job. It has no public domain.

The `/root/.codex` volume contains both `auth.json` and resumable Codex state.
Treat the volume and `LUNA_WORKER_TOKEN` as credentials. The server never reads
or returns the contents of `auth.json`, and the Codex child receives a small
allowlisted environment with no Railway, Slack, or worker-token variables.

## API

- `GET /healthz` is unauthenticated for Railway's private health check. It
  reports only readiness, selected model/reasoning, and queue occupancy.
- `POST /v1/jobs` accepts
  `{jobId,operationId,prompt,files:[{path,contentBase64,sha256?}]}` and returns
  `202` immediately.
- `POST /v1/jobs/:jobId/resume` accepts `{operationId,prompt,files?}`, returns
  `202`, and resumes the exact stored Codex thread (never `--last`).
- `GET /v1/jobs/:jobId` returns current state or the completed response.
- `DELETE /v1/jobs/:jobId` cancels a queued or running turn.

All `/v1` routes require `Authorization: Bearer $LUNA_WORKER_TOKEN`. Input
paths must be below `inputs/`. `operationId` is a SHA-256 over the prompt and
decoded input hashes; the worker recomputes it, making create/resume retries
idempotent. The host polls `GET` until it receives
`{jobId,operationId,runCount,threadId,status,model,reasoningEffort,codexVersion,finalMessage,usage?,deliverables}`.
Deliverables include base64 bytes, SHA-256, and size and must be regular files
below `deliverables/`.

## Runtime

The image pins Node 22 and `@openai/codex@0.144.1`. The worker refuses to start
unless `LUNA_MODEL=gpt-5.6-luna` and `LUNA_REASONING_EFFORT=high`. Other defaults
are `PORT=3000`, a 30-minute `LUNA_JOB_TIMEOUT_MS`, queue depth 4, a 128 MB
per-workspace ceiling, and a 512 MB volume free-space reserve. The installed
Codex permissions profile gives
model-issued commands write access only to the job workspace and denies root,
the auth directory, temporary-directory aliases, `.env` files, and network.
The worker does not pass a legacy `--sandbox` flag, because the named
permissions profile is the execution boundary.
Startup stops before opening the HTTP port unless `codex login status`
succeeds against the mounted `CODEX_HOME`. The login subcommand does not accept
the strict-config flag; every author turn does use `--strict-config`, so unknown
permission fields still fail closed before the model can act. Resume turns
also remove and reject symlinks or model-authored instruction layers such as
`AGENTS.md`, `.codex`, and `SKILL.md` before they can influence a later turn.

Run the dependency-free helper tests with:

```sh
npm test
```
