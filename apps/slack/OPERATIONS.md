# Operations

## Production identity

| Item | Value |
| --- | --- |
| Public repository | `vladimirhegai/Slack_Sequences` |
| Railway project | `Sequences Slack Hackathon` |
| Slack service | `sequences-slack` (public + private) |
| Luna service | `codex-worker` (private only) |
| Live URL | `https://sequences-slack-production.up.railway.app` |
| Slack health | `/healthz` -> `200 ready` |
| Codex volume | `/root/.codex` on `codex-worker` |
| Publish (private monorepo only) | `bash scripts/publish-public.sh "message"` |

GitHub autodeploy is off. Publishing source and deploying Railway are separate.
Deploy only the exact clean `.publish` snapshot produced from committed `HEAD`;
never upload a dirty monorepo working tree.

The public `vladimirhegai/Slack_Sequences` mirror intentionally omits the
private monorepo's publisher script. When reading this file in that mirror,
the repository root is already the published snapshot; `scripts/publish-public.sh`
and `.publish` apply only to release operators working from the private
monorepo.

Railway hosts:

- `sequences-slack`: Bolt/Socket Mode, OAuth, fact/asset intake, deterministic
  Sequences validation, Chromium/FFmpeg, render, and Slack delivery;
- `codex-worker`: private authenticated HTTP service, persisted ChatGPT login,
  serialized `gpt-5.6-sol`/high Codex CLI sessions.

Neither service exposes a public MCP endpoint. The worker must not have a public
domain.

## Slack app manifest

`apps/slack/manifest.json` is the source of truth. Slack slash-command names
cannot contain spaces, so one `/sequences` command dispatches `assets`, `assets
clear`, `demo`, `debug`, `mcp-test`, and normal create behavior.

Socket Mode owns events/interactivity. OAuth still requires this exact redirect:

```text
https://sequences-slack-production.up.railway.app/slack/oauth_redirect
```

After a scope change, update Slack's App Manifest, reinstall the app, and replace
rotated tokens in Railway. A Railway deploy does not apply the manifest.

## Local verification

Do not run a second Socket Mode process with production/sandbox tokens. From the
monorepo root:

```powershell
npm run typecheck
npm run typecheck --workspace @sequences/slack
npm run test:luna --workspace @sequences/slack
npm run test:unit --workspace @sequences/slack
npm run test:browser --workspace @sequences/slack
npm run luna:replay --workspace @sequences/slack -- <job-or-report-path>
npm run replay:all --workspace @sequences/slack
npm run mcp:demo --workspace @sequences/slack
npm run sequence:check --workspace @sequences/slack -- --demo --no-mcp --format both
npm test --prefix apps/slack/codex-worker
```

The demo, undo, render, debug, `assets clear`, and `mcp-test` paths are model-free.
`/sequences assets` includes one Luna UI-pack turn after deterministic intake.
An authorized Luna probe is one ordinary `/sequences` job or one direct worker
job with a new job ID. Preserve worker receipts, exact raw source, motion intent,
browser QA, thumbnails, revisions, MP4, and hashes. Do not call OpenRouter and do
not rerun merely to clear taste advisories.

`luna:replay` is contract-aware: direction, synthetic-direction, film, and
asset-pack bundles all receive generic receipt/raw/materialized integrity
checks, while only film bundles enter static and browser composition gates.
Worker run counts must increase monotonically but may contain gaps when a failed
protocol turn was preserved under `worker-failures` instead of materialized.

Historical S6.9-S6.13 OpenRouter probe evidence remains in `REFACTOR_PLAN.md`,
`REFACTOR_HANDOFF.md`, and the operator-owned `PROBE_LOG.md`. It is not the
current runbook.

## Luna production probe findings (2026-07-13)

The production route was exercised with job `luna-prod-probe-6808f5d-01` using
`gpt-5.6-luna` at high reasoning and no prepared assets. It completed as
direction → synthetic UI pack → build rejection → one same-thread repair →
rendered self-review → accepted revision 2 → MP4. `fallback=null`; browser
runtime validation passed; ten temporal thumbnails and a real 16-second
1920×1080 H.264 MP4 were produced. The no-assets film was coherent but sparser
than an asset-prepared film, which is expected.

The downloaded evidence replays model-free with four persisted runs and a green
terminal static/browser validation. The first `sequence-check.json` said
`fail` because the reporting script revalidated the accepted Luna source
without its persisted `declaredPrimarySelectors`; the browser gate had already
accepted the exact timeline. The probe harness now carries those selectors into
post-run validation. This was a reporting defect, not a production film
failure.

The probe simulated the pipeline after Slack field collection; it did not
impersonate Slack or upload a file into a real channel. Socket Mode, worker
health, render, and delivery code are deployed and tested, but a human live
`/sequences` command remains the final Slack-native delivery check.

### What a future session must not infer

- A green Studio catalog page does not prove Luna selected a component, asset,
  plugin, recipe, look, or camera pattern.
- A validated Luna UI pack proves reusable visual vocabulary, not typed Studio
  lowering. Its component IDs and morph anchors are model-authored pack data.
- A runtime-valid `warn` is not a hard failure. Inspect the MP4/temporal strip
  and preserve taste residue as evidence; do not buy another paid turn merely
  to clear advisory motion findings.

The next implementation target is a bounded, hashed Luna capability capsule
derived from the typed Studio catalogs. Keep it optional, allow Luna to decline
entries, lower accepted IDs through existing host contracts, and persist
requested/accepted/declined IDs plus engine fences. See the coupling audit in
`LUNA_WORKFLOW.md` and `studio/INTEGRATION.md` before changing prompts or
contracts.

## Required Railway variables

Use `.env.railway.example`. Essential `sequences-slack` groups:

- Slack Socket Mode/OAuth credentials and public redirect URL;
- `OPENAI_API_KEY` for the independent Slack-hosted-MCP context bot;
- `SLACK_SEQUENCES_AUTHOR_ROUTE=luna-direct`;
- private worker URL, shared token, and timeout;
- persistent `/data` volume supplied by the Dockerfile/service.

Essential `codex-worker` groups:

```text
PORT=3000
LUNA_WORKER_TOKEN=<same independent 32+ character secret>
LUNA_MODEL=gpt-5.6-sol
LUNA_REASONING_EFFORT=high
LUNA_JOB_TIMEOUT_MS=1800000
LUNA_MAX_QUEUE_DEPTH=4
LUNA_MAX_WORKSPACE_BYTES=134217728
LUNA_MIN_FREE_BYTES=536870912
CODEX_HOME=/root/.codex
```

Mount its persistent volume at `/root/.codex`. `auth.json` is plaintext and must
be treated as a password. Startup runs `codex login status` and refuses readiness
when login/config is unavailable. Railway denies the Linux namespace operation
used by Codex's command sandbox; never bypass it or expose the auth volume with a
dangerous sandbox mode. Production uses tool-less artifact protocol v2: inputs
are embedded/attached, every tool event fails the turn, and the worker binds
each operation to a host-declared artifact contract and exact base fingerprint
before transactional keep/inherit/replace materialization. The Codex permission profile denies
all model-visible filesystem/network access, and the worker scans the exact
persisted rollout to catch tool calls omitted from exec JSONL. Readiness also fails when the exact
Sol/high model identity, artifact schema digest, or free-space reserve is wrong.

Do not route ordinary authoring through `SLACK_SEQUENCES_PROVIDER`; Luna is
selected by `SLACK_SEQUENCES_AUTHOR_ROUTE=luna-direct`. `OPENROUTER_API_KEY`
may remain provisioned only when the owner intentionally keeps an emergency
rollback credential, but it must not be presented as an automatic fallback and
the route must remain Luna. Keep `OPENAI_API_KEY`; it belongs to context
retrieval, not Luna.

Emergency rollback is explicit and variables-only:

```text
SLACK_SEQUENCES_AUTHOR_ROUTE=legacy-provider
SLACK_SEQUENCES_PROVIDER=openrouter-api
OPENROUTER_API_KEY=...
```

A failed Luna job never crosses that seam automatically. Delete the temporary
OpenRouter key again after rollback ends.

## First deployment / route switch

Only with explicit owner authorization:

1. Verify the dirty boundary and commit only intended Luna files.
2. Publish committed `HEAD` to the public snapshot.
3. Set worker variables (including manual `PORT=3000`) with `--skip-deploys`.
4. Set Slack worker URL/token/route with `--skip-deploys`.
5. Deploy and verify `codex-worker` first.
6. Run a bounded authenticated worker job and prove it has zero tool events,
   a clean persisted-rollout hash, valid raw-envelope/materialized fingerprints,
   and an exact-thread generation-bound resume.
7. Deploy `sequences-slack` from the same clean snapshot.
8. Confirm its startup log contains `[luna] worker ready`, then check public
   `/healthz`.
9. Run `/sequences assets` and one ordinary `/sequences` flow through thumbnail,
   self-review, render, and Slack upload.
10. After Luna passes, either remove the legacy credential/provider variables,
    or retain them as an owner-controlled emergency rollback while keeping the
    author route explicitly `luna-direct`. Never treat their presence as a
    fallback policy.

Private-monorepo release commands (service IDs/names are already linked locally):

```powershell
git status --short
git rev-parse HEAD
bash scripts/publish-public.sh "feat(luna): make Codex CLI the default author"

railway up .publish/apps/slack/codex-worker --path-as-root --detach `
  --service codex-worker --environment production
railway deployment list --service codex-worker --environment production --limit 5
railway logs --service codex-worker --environment production --lines 100

railway up .publish --path-as-root --detach `
  --service sequences-slack --environment production
railway deployment list --service sequences-slack --environment production --limit 5
railway logs --service sequences-slack --environment production --lines 100

$baseUrl = "https://sequences-slack-production.up.railway.app"
Invoke-WebRequest "$baseUrl/healthz" | Select-Object StatusCode, Content
```

### Railway CLI hazards learned during the Luna probe

- Deploy the worker from the exact `.publish/apps/slack/codex-worker` root with
  `--path-as-root`; deploy Slack from `.publish`. A worker upload from the
  public root can archive the wrong process and interrupt the real worker.
- Deploy the worker first, wait for `SUCCESS` and its `gpt-5.6-sol`/high log,
  then deploy Slack. Do not use `railway down` as a pending-deploy cancel; it
  can remove the active healthy deployment instead.
- Railway's SSH argument parser strips ordinary shell quoting. For a probe,
  use a hyphenated no-space brief or pass structured input through a file; do
  not spend paid calls debugging a command that never reached the worker.
- A local SSH client timeout does not necessarily terminate the remote Luna
  process. Verify the persisted job directory, then clean up the temporary SSH
  key in Railway and on the operator machine.

Set the shared bearer token through stdin or a non-echoing shell variable; never
print it in command output, logs, docs, or receipts. Railway private networking
uses HTTP at:

```text
http://${{codex-worker.RAILWAY_PRIVATE_DOMAIN}}:${{codex-worker.PORT}}
```

## Rehearsal

1. `/sequences debug on` for argument-free stage/tool receipts.
2. `/sequences assets`, upload 1-5 product screenshots, optionally add notes,
   and wait for the deterministic capture receipt.
3. `/sequences` with facts, audience, value, and CTA; do not prescribe shots or
   camera moves.
4. Observe `Luna director` -> composition gate -> thumbnails -> `Luna
   self-review` -> render.
5. Confirm storyboard thumbnails and the final MP4 arrive in Slack. Human-review
   motion and the code between representative frames; a green report alone is
   insufficient.
6. Run a structural revision and confirm the exact persisted thread resumes.

`/sequences demo` remains the model-free backup. A live process health check
does not prove OAuth, private networking, Codex auth/model access, browser
validation, rendering, upload, or film quality; the end-to-end rehearsal does.

## Recovery

- Worker not ready: inspect `codex-worker` logs, volume mount, `config.toml`, and
  `codex login status`; never start an interactive login loop in production.
- Slack startup fails on Luna health: verify private DNS URL, manual worker
  `PORT`, and the shared token, then redeploy the same source.
- Worker `401`: rotate/set the same token on both services without printing it.
- Codex auth expired: reauthenticate on the worker's mounted `CODEX_HOME`; the
  CLI refreshes `auth.json` in place, so serialize auth/session activity.
- Worker returns `tool_use_forbidden`: preserve the raw JSONL event log and fail
  visibly. Do not add a sandbox bypass, materialize the final response, or cross
  into the legacy route.
- Worker returns `codex_error_item` naming `glob_scan_max_depth`: preserve the
  failed job, verify the bundled profile still caps Linux `**` expansion, and
  redeploy the hash-bound profile. Do not retry the same failed job ID or remove
  deny globs to silence the error.
- Worker rejects the artifact envelope: use the safe failure receipt. Only an
  audited artifact-protocol failure may advance the exact thread once;
  security, tool, rollout-integrity, path, and hash failures stay terminal.
  Replay schema/path/hash validation model-free before changing prompts or contracts.
- Authored source fails a hard gate: preserve the raw run directory and replay
  with `luna:replay`. Fix an engine defect at its lowest deterministic owner.
  The same-thread repair receives every blocking line plus bounded
  selector/property before/after browser evidence in one batch; do not send the
  film through the legacy committee.
- `200 ready` but commands fail: run `/sequences mcp-test`, inspect Slack logs,
  and verify per-user OAuth plus `OPENAI_API_KEY`.
- Wrong code: compare public repo commit, `.publish` commit, and Railway
  deployment; redeploy the exact snapshot.
- Exposed credential: rotate the affected secret, update Railway, redeploy, and
  retest the relevant boundary.

Never solve a runtime incident by starting a second Socket Mode process.
