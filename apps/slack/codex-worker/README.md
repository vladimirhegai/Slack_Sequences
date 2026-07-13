# Sequences Codex worker

This is the private Railway-side execution boundary for the Luna authoring
route. It runs one Codex CLI turn at a time, keeps each session in its own
workspace under `$CODEX_HOME/sequences-jobs`, and resumes only the exact thread
ID persisted for that job. Luna receives verified text inline and approved
images as CLI attachments, makes no tool calls, and returns a complete
schema-constrained artifact envelope. The trusted worker validates and
atomically materializes it. The service has no public domain.

The `/root/.codex` volume contains both `auth.json` and resumable Codex state.
Treat the volume and `LUNA_WORKER_TOKEN` as credentials. The server never reads
or returns the contents of `auth.json`, and the Codex child receives a small
allowlisted environment with no Railway, Slack, or worker-token variables.

## API

- `GET /healthz` is unauthenticated for Railway's private health check. It
  reports only readiness, selected model/reasoning, artifact protocol/schema,
  and queue occupancy.
- `POST /v1/jobs` accepts
  `{jobId,operationId,prompt,files:[{path,contentBase64,sha256?}]}` and returns
  `202` immediately.
- `POST /v1/jobs/:jobId/resume` accepts
  `{operationId,expectedRunCount,prompt,files?}`, returns `202`, and resumes the
  exact stored Codex thread (never `--last`). The expected generation rejects
  delayed stale revisions while preserving idempotent retries of the same turn.
- `GET /v1/jobs/:jobId` returns current state or the completed response.
- `DELETE /v1/jobs/:jobId` cancels a queued or running turn.

All `/v1` routes require `Authorization: Bearer $LUNA_WORKER_TOKEN`. Input
paths must be below `inputs/`. `operationId` is a SHA-256 over the prompt and
decoded input hashes plus the artifact-protocol version and immutable schema
digest; the worker recomputes it, making create/resume retries idempotent. The
host polls `GET` until it receives
`{jobId,operationId,runCount,threadId,status,model,reasoningEffort,codexVersion,rawEnvelopeSha256,materializedFingerprint,rolloutSha256,rolloutResponseItems,finalMessage,usage?,deliverables}`.
Deliverables include base64 bytes, SHA-256, and size and must be regular files
below `deliverables/`.

`artifact-envelope.schema.json` is passed through `--output-schema` on initial
and exact-thread resume turns. Every final response must be a complete
`decision: "replace"` bundle. The worker validates it independently, accepts
authored Unicode text or exact hash-bound copies of approved inert images/fonts,
writes a fresh staging tree, and atomically swaps that tree into place. Stale
deliverables and stale turn inputs never merge forward. Explicit tool/todo
events fail the job even when a valid-looking final envelope follows. Because
Codex exec JSONL omits some tool lifecycle events, the worker also scans the
entire exact persisted rollout and allows only message, reasoning, compaction,
and context-compaction response items before accepting bytes.

Startup hashes both the bundled and installed `config.toml` and executes
`codex --version`; it refuses to open the port unless the actual binary reports
the exact protocol-pinned CLI version. Health exposes that version and the
immutable permission-profile digest alongside the artifact schema digest. Both
digests also participate in operation IDs, so a retry cannot silently cross an
execution-contract change.

The deny-all filesystem profile gives unbounded `**` deny globs a finite
`glob_scan_max_depth = 16`. Codex requires that cap when Linux expands glob
matches before sandbox startup; removing it turns the emitted configuration
errors into a hard worker failure before any artifact can be accepted.

## Runtime

The image pins Node 22 and `@openai/codex@0.144.1`. The worker refuses to start
unless `LUNA_MODEL=gpt-5.6-sol` and `LUNA_REASONING_EFFORT=high`. Other defaults
are `PORT=3000`, a 30-minute `LUNA_JOB_TIMEOUT_MS`, queue depth 4, a 128 MB
per-workspace ceiling, and a 512 MB volume free-space reserve. Railway does not
permit the Linux namespace operation used by the Codex command sandbox. The
worker therefore uses a tool-less exchange; it does not add a dangerous sandbox
bypass or expose the login volume to model-authored commands. The dedicated
permissions profile denies every model-visible filesystem and network scope;
approved CLI image attachments are loaded by the host side. Tool features are
disabled where Codex exposes switches, JSONL events fail closed, and the
persisted rollout audit covers unconditional tools such as `view_image`.
Startup stops before opening the HTTP port unless `codex login status`
succeeds against the mounted `CODEX_HOME`. The login subcommand does not accept
the strict-config flag; every author turn does use `--strict-config`, so unknown
permission fields still fail closed before the model can act. The immutable
artifact-schema digest is checked at startup. Resume turns also remove and
reject symlinks or model-authored instruction layers such as `AGENTS.md`,
`.codex`, and `SKILL.md` before they can influence a later turn.

Run the dependency-free helper tests with:

```sh
npm test
```
