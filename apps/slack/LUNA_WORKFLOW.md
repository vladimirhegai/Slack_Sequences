# Official Luna workflow

Luna (`gpt-5.6-luna`, high reasoning) is the default creative author for
ordinary `/sequences` creates and structural revisions. It runs through the
authenticated Codex CLI in a private Railway worker. OpenRouter is retired from
production and is never an automatic fallback.

This is a separate creative route, not a model substitution inside the old
planner. The former frame -> storyboard -> scaffold/slot -> critic/repair
committee remains intact behind the explicit `legacy-provider` rollback mode.

## Topology

```text
Slack command / shortcut
  -> sequences-slack (facts, approved assets, host validation, render, upload)
  -> private HTTP + bearer token
  -> codex-worker (one serialized Codex CLI turn, persisted exact thread)
  -> gpt-5.6-luna / high
  -> authored deliverables
  -> sequences-slack static + real-browser gate
  -> thumbnails -> same Luna thread self-review -> optional one polish
  -> MP4 -> Slack
```

The context bot is independent: `src/slackMcpContext.ts` still uses the OpenAI
Responses API and the invoking user's Slack OAuth token. Keep its
`OPENAI_API_KEY`; it is not the video author.

## One-session creative sequence

1. **Verified intake.** The Slack host writes a fact envelope containing the
   product, launch facts, audience, target runtime, authorized workspace
   context, and unsupported-claim prohibition.
2. **Asset intake first.** `/sequences assets` remains deterministic. It stores
   approved screenshots and palette notes. On create, the host copies only
   those regular files into the isolated worker workspace and verifies their
   hashes. With no images, Luna creates a small local SVG/HTML asset system
   before authoring the film.
3. **Director treatment.** Luna owns concept, structure, visual thesis, spatial
   world, motion motif, transition grammar, camera philosophy, pacing, and one
   energy peak.
4. **Motion intent.** Before source, Luna declares semantic primary subjects,
   persistent entities, chosen boundary anchors/strategies, causal actions,
   meaningful camera arrival/settle/hold windows, the peak, and final rest.
   These are Luna's choices. The host only validates their existence/timing.
5. **Full source.** The same thread authors the storyboard, DOM/CSS/SVG assets,
   paused seekable GSAP timeline, camera, transitions, and interactions.
6. **Mechanical gate.** The host preserves exact raw bytes, verifies hashes and
   local files, validates scene windows and selectors, runs the existing static
   and real-browser gates, and transactionally commits accepted source.
7. **Rendered self-review.** The host returns thumbnails, a temporal strip,
   declared-boundary before/at/after sheets, camera
   start/arrival/settle/hold sheets with target visibility measurements, and
   spatial/mechanical sidecars to the exact thread. Luna chooses to keep the
   film or make one coherent polish pass. A failed optional polish rolls source,
   assets, thumbnails, and temporal evidence back to the first accepted cut.
8. **Final render and revision.** The host renders/uploads the MP4. A user
   revision resumes the persisted exact thread ID; it never uses `--last`.

## Creative authority versus hard ownership

Luna owns taste: story, copy within verified facts, art direction, layout,
assets, transition choice, timing, camera choice, motion style, and whether a
hard cut is better than a morph. There are no required zooms, morph counts, or
motion-density quotas in the Luna prompt.

The host owns facts, permissions, workspace isolation, source completeness,
local-only assets/fonts, deterministic seeking, runtime safety, declared
selector bindings, browser/encoding health, exact bytes/hashes, checkpointing,
and Slack delivery.

The first release intentionally reuses the existing direct-composition static
and browser gate. It does **not** use the legacy frame planner, storyboard
normalizers, scene scaffold/slots, creative critic, repair ladder, source
replay, rescue models, or OpenRouter fallback. Existing cut, camera,
continuity, interaction, environment, and rendering primitives remain
available when Luna chooses their typed contracts.

## Guardrails and repairs

Do not broadly weaken camera, blocking, cut, interaction, or runtime gates as
part of routing. Those deterministic mechanics are useful to every author.
The immediate Luna-friendly change is orchestration: bypass the legacy creative
committee and preserve Luna's raw source separately from the committed
trim/newline derivative.

Some existing direct-composition findings still encode taste as correctness
(for example quiet-gap/beat density and the minimum scene count). Audit those
later using real Luna artifacts. Move only proven taste rules to advisory for
the Luna route; keep factual, security, seeking, visibility, binding, browser,
and encoding failures hard. Repair prompts are also later work: an authored
hard defect should return to the same thread with exact mechanical evidence,
while an engine defect is fixed model-free at its lowest owner. Never restore
the old multi-model repair committee around Luna.

## Route and worker configuration

Slack service:

```text
SLACK_SEQUENCES_AUTHOR_ROUTE=luna-direct       # default when unset
SLACK_SEQUENCES_LUNA_WORKER_URL=http://codex-worker.railway.internal:3000
SLACK_SEQUENCES_LUNA_WORKER_TOKEN=<shared 32+ character secret>
SLACK_SEQUENCES_LUNA_JOB_TIMEOUT_MS=1200000
```

Worker service:

```text
PORT=3000
LUNA_WORKER_TOKEN=<same secret>
LUNA_MODEL=gpt-5.6-luna
LUNA_REASONING_EFFORT=high
LUNA_JOB_TIMEOUT_MS=1200000
LUNA_MAX_QUEUE_DEPTH=4
LUNA_MAX_WORKSPACE_BYTES=134217728
LUNA_MIN_FREE_BYTES=536870912
CODEX_HOME=/root/.codex                       # mounted persistent volume
```

Rollback is explicit and does not happen inside a failed job:

```text
SLACK_SEQUENCES_AUTHOR_ROUTE=legacy-provider
SLACK_SEQUENCES_PROVIDER=openrouter-api       # or another registered provider
OPENROUTER_API_KEY=...                        # only while rollback is active
```

## Security invariants

- `codex-worker` has no public domain and accepts one authenticated request at a
  time.
- ChatGPT login lives in plaintext `/root/.codex/auth.json` on its dedicated
  Railway volume. Treat the volume as a password.
- Model-authored commands run under the dedicated permission profile: only the
  job workspace is writable/readable as work context; root/auth, temp aliases,
  `.env` files, and network are denied.
- The child receives an allowlisted environment without Slack, OpenAI,
  OpenRouter, Railway, OAuth, or worker-token secrets.
- Inputs and deliverables are bounded regular files with contained paths and
  SHA-256 verification; symlinks are rejected.
- Turns submit asynchronously with content-bound idempotency keys, then poll;
  host timeouts cancel paid work best-effort and one worker restart may requeue
  the same operation without using `--last`.
- Every job has a workspace-size ceiling and new jobs stop before the auth
  volume crosses its free-space reserve. Completed jobs remain revision state;
  monitor volume growth and archive/delete films deliberately rather than with
  an age-only cleanup.
- Codex threads and job metadata persist under
  `$CODEX_HOME/sequences-jobs/<job-id>`.

## What `/sequences` commands do

- Ordinary `/sequences`, the message shortcut, and structural revisions: Luna.
- `/sequences assets` and `assets clear`: deterministic intake, no model.
- `/sequences demo`: curated model-free demo.
- undo, render/re-render, approve/share, debug, help, and `mcp-test`:
  deterministic host operations.

The `mcp-test` board checks the private Luna worker without spending a model
turn. Only a real create proves the complete CLI/thread/browser/render/upload
path.
