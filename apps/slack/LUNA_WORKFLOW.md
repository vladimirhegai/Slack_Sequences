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
  -> codex-worker (embed verified inputs, attach images, persisted exact thread)
  -> gpt-5.6-luna / high
  -> schema-constrained tool-less artifact envelope
  -> worker validation + atomic deliverable materialization
  -> sequences-slack static + real-browser gate
  -> thumbnails -> same Luna thread self-review -> optional one polish
  -> MP4 -> Slack
```

The context bot is independent: `src/slackMcpContext.ts` still uses the OpenAI
Responses API and the invoking user's Slack OAuth token. Keep its
`OPENAI_API_KEY`; it is not the video author.

## Studio coupling status (verified 2026-07-13)

Luna is correctly connected to the **channel asset intake**, but not yet to
the complete typed Studio catalog. These are two different paths:

| Surface | Luna direct today | What is actually passed | Status |
| --- | --- | --- | --- |
| `/sequences assets` screenshots | Yes | Hashed approved files under `inputs/brand-assets/**`, palette/notes in `inputs/asset-brief.md` | Live |
| Luna UI pack | Yes | Host-validated `asset-pack.json`, `ui-kit.html`, `assets-manifest.json` under `inputs/ui-pack/**` | Live and fingerprint-bound |
| No-assets create | Yes | Synthetic UI-pack contract; Luna creates product-specific code-native UI | Live |
| Studio `COMPONENT_CATALOG` | No | Not sent as a planner inventory; Luna authors its own DOM/SVG and semantic hooks | Intentional gap |
| Studio built-in `ASSET_LIBRARY` / asset plugins | No | The legacy `plugins` offer is omitted from `lunaContext`; Luna may use the prepared UI pack instead | Intentional gap |
| Studio recipes | No | `recipes[]` and legacy recipe retrieval are explicitly forbidden in `luna-director.md` | Intentional gap |
| Studio looks / camera patterns | No | The direct route receives motion principles, not the legacy catalog or pattern inventory | Intentional gap |

The important distinction is that a UI-pack component (`rootSelector`, states,
parts, and optional morph anchors) is a **Luna-authored, host-validated visual
vocabulary**. It is not the same thing as a typed engine component or a Studio
recipe. The direct route's host contracts still validate runtime, cuts, camera,
interaction, and time when those declarations are present, but the host does
not silently lower Studio declarations into Luna's HTML.

The current seam is visible in code: `index.ts` passes `assetBriefContext` and
the prepared pack into `createVideo`, `lunaRoute.ts` serializes the pack and
approved screenshots as worker inputs, while `assetBriefPlanningOffer()` is
only appended to the legacy `enrichedContext`. `luna-director.md` explicitly
prohibits `components`, `beats`, `recipes`, `plugins`, and legacy spatial/layout
fields. Do not claim that a Studio catalog entry was used by a Luna film unless
the accepted evidence contains a future capability receipt for that entry.

## Next Luna improvement: a bounded capability capsule

The next high-value change is not to inject the entire Studio catalog or force
Luna into the old planner. Add a derived, per-job **Luna capability capsule**
from the same typed sources, with a small selected set of component kinds,
asset/plugin kinds, camera affordances, and recipe-like motion fragments. Each
entry should contain a stable ID, purpose, constraints, a tiny usage example,
and whether it is host-lowered or merely inspirational.

The safe sequence is:

1. Host selects a bounded capsule from the brief, approved UI pack, and visual
   direction; Luna may choose, decline, or combine entries creatively.
2. Direction may return optional capability requests by stable ID, never raw
   executable code or unconstrained planner fields.
3. The host resolves requested IDs through the existing typed contracts and
   lowers only accepted requests into ordinary components/beats/assets. Luna's
   own HTML remains authoritative for everything else.
4. Persist a capability receipt (`requested`, `accepted`, `declined`, engine
   fences, and hashes) beside the accepted bundle, then prove the lowered result
   with the same browser/temporal gates.
5. Add negative tests for unknown IDs, stale engine fences, duplicate ownership,
   and a Luna film that intentionally declines every suggestion.

This preserves Luna's creative authority while making Studio work reusable and
measurable. It also prevents the two bad extremes: a blind raw-HTML author with
no knowledge of the catalog, or a legacy planner disguised as a Luna prompt.

## Exact-thread creative sequence

1. **Verified intake.** The Slack host writes a fact envelope containing the
   product, launch facts, audience, target runtime with an accepted
   min/max duration window (the legacy brief's "pacing center" freedom,
   declared as data), authorized workspace context, and unsupported-claim
   prohibition. Luna chooses the exact duration inside the window on create;
   self-review and revision stay exact to the accepted cut.
2. **Versioned UI asset intake.** `/sequences assets` deterministically stores
   approved screenshots/palette evidence, then runs a separate Luna asset-pack
   contract. Luna recreates a bounded code-native `ui-kit.html` plus semantic
   component states, parts, morph anchors, and optional inert local assets. The
   host validates CSP, selectors, schema, hashes, and a rendered preview before
   recording the version. Raw screenshots and model-authored packs have
   separate allowlisted roots. Preview Chromium is request-intercepted and may
   load only regular files contained in the accepted pack; redirects, refresh
   navigation, and remote CSS/assets are rejected. Reuse revalidates the pack
   and its accepted fingerprint before Luna receives it. One objective
   schema/selector/security rejection may resume the exact asset thread once
   with the rejected bytes and complete hard finding; a second rejection fails
   visibly. A failed pack never loses the screenshots.
3. **Direction turn.** Ordinary `/sequences` starts one exact thread with a
   direction-only artifact contract: treatment and timed storyboard, but no
   film HTML or guessed DOM selectors. Luna owns concept, structure, visual
   thesis, spatial world, motion motif, transition grammar, camera philosophy,
   pacing, and one energy peak. Explicit user-requested beat order,
   opening/closing surfaces, and named product actions remain part of the
   brief. Direction states how active product surfaces reach a decisive hero
   scale and keeps a real product control/consequence as the payoff instead of
   restaging it as a duplicate generic CTA. A prepared channel pack is supplied
   as visual vocabulary, never a shot template. Without one, this turn also
   creates a product-specific synthetic UI pack, so no-assets runs remain
   supported.
4. **Motion intent.** Before source, Luna declares semantic primary subjects,
   persistent entities, chosen boundary anchors/strategies, causal actions,
   meaningful camera arrival/settle/hold windows, the peak, and final rest.
   These are Luna's choices. The host only validates their existence/timing.
   Boundary anchors are declared only when a boundary carries an element; a
   boundary that carries nothing (a motivated hard cut) omits them, and a
   declared anchor must exist. Browser and temporal QA measure focal
   visibility and motion against each act's declared `primarySelector`, never
   against synthesized tween attention.
5. **Build turn.** The host validates direction timing/schema first, then
   resumes the same thread with a film artifact contract. Luna authors the
   DOM/CSS/SVG assets, paused seekable GSAP timeline, motion intent, camera,
   transitions, and interactions against its direction. Railway
   does not permit the Codex Linux namespace sandbox, so Luna calls no tools; it
   returns one schema-constrained artifact envelope instead. Protocol v2 binds
   every operation to the host-declared contract and exact base fingerprint;
   unchanged files can be SHA-bound `inherit` actions and a true no-op is
   `keep`, so review/revision no longer retypes the whole bundle.
6. **Mechanical gate.** The trusted worker validates that envelope again,
   re-hashes every file, and atomically replaces its deliverables directory.
   The host preserves both the raw-envelope and materialized fingerprints, verifies hashes and
   local files, validates scene windows and selectors, runs the existing static
   and real-browser gates, and transactionally commits accepted source.
7. **Rendered self-review.** The host returns thumbnails, a temporal strip,
   declared-boundary before/at/after sheets, camera
   start/arrival/settle/hold sheets with target visibility measurements, and
   spatial/mechanical sidecars plus the exact accepted canonical bundle to the
   exact thread. Luna checks the explicit brief order, hero-subject framing,
   and whether a real product action was abandoned for a detached duplicate
   payoff; framing problems call for one subtractive crop/push polish, not
   another peak or more decoration. Luna chooses `keep` or makes one coherent
   polish pass. A failed optional polish rolls source,
   assets, thumbnails, and temporal evidence back to the first accepted cut. The
   consumed worker generation is still recorded separately from that accepted
   cut, so a later revision resumes the exact next generation while receiving
   the last accepted bundle as its authoritative source.
8. **Final render and revision.** The host renders/uploads the MP4. If encoding
   fails after an authored film passed the hard composition gate, the accepted
   storyboard remains ready and revisable while Slack reports the missing MP4
   honestly. A user revision resumes the persisted exact thread ID; it never
   uses `--last`.

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

The Luna materialization seam has four deliberately narrow compatibility
rules for host-owned mechanics:

- the v1 parser supplies a missing numeric `version: 1` in memory, while an
  explicit unknown/string/null version remains a hard failure; the persisted
  motion-intent bytes are never rewritten;
- the legacy-unambiguous final-hold key `selector` is accepted in memory as
  `primarySelector`, while raw paid bytes remain unchanged. This prevents a
  spelling-only repair from consuming the one executable repair turn;
- `data-scene` is the storyboard/runtime binding key, while the element `id`
  only needs to be stable and unique for authored selectors;
- when the declared composition ID was used as dotted
  `window.__timelines.<composition-id>` assignment syntax, the executable
  derivative rewrites that exact proved ID to bracket notation. The adapter is
  idempotent, does not repair a different key, and leaves the accepted raw HTML
  and its hash untouched.

These adapters choose no copy, story, layout, timing, camera, transition, or
motion. Their rollback is removal after persisted Luna evidence shows the
literal protocol field and canonical bracket binding are consistently emitted;
the `data-scene` binding is the permanent runtime contract.

The 2026-07-13 taste-vs-mechanics passes are keyed by the declared-intent
contract (`draft.declaredPrimarySelectors`), never by a route-name string.
Declared-intent films waive `layout_intent_missing`; continuous-motion focal
tracking binds to Luna's declared per-act primary selector; quiet windows,
front-loaded motion, beat/moment quotas, frame conformance, occupancy, fill,
contrast, transition counts, and other composition-taste findings remain
visible advisories. `pacingAudit.ts` belongs to legacy planning and is not
consulted by Luna's direct-composition gate.

Static timeline-registration source shapes are hints on this route. Chromium
is authoritative: it must find `window.__timelines[compositionId]`, prove that
exact timeline is paused and seekable, and use the host's canonical
`timeline.pause(); timeline.seek(t, false)` seam across direct, later, reset-to-zero,
and repeated seeks. Identity matrices and `transform:none` compare as the same
rendered state. Real differences remain hard and return a bounded selector /
property / before / after diff to the repair turn. Absence, a wrong ID, a running timeline,
nondeterministic seek, runtime exceptions, blank output, binding/security/CSP
failures, and encode failures stay hard. The only source adapter remains the
existing proved dotted-composition-id to bracket-notation rewrite above.

One hard mechanical rejection resumes the exact persisted worker job/thread
once with `prompts/luna-repair.md`, the complete rejected bundle, every
verbatim blocking line, and bounded structured browser evidence. Luna fixes the
whole proven batch in one turn. Generation and cursor checks require the exact
thread and allow at most one additional protocol-envelope recovery increment;
and the replacement bundle traverses the complete materialization, static, and
browser gates again. Taste advisories never enter this turn. If create or that
single repair cannot produce an accepted film, the shared
explicit opt-in `SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK=1` switch publishes the existing
honestly labeled model-free proof film; it never calls OpenRouter or disguises
fallback as Luna. Ordinary production runs fail loud by default. Failed jobs
persist an allowlisted original brief (never OAuth tokens or enriched/model
context), so a thread reply or Retry button starts a fresh Luna create rather
than trying to revise an empty project. That fresh create runs as the human who
clicked or replied, so another channel member never inherits the original
requester's Slack OAuth authority. Paid worker receipt/response bytes are
persisted before host interpretation, and surfaced Slack receipts include the
job ID.

## Route and worker configuration

Slack service:

```text
SLACK_SEQUENCES_AUTHOR_ROUTE=luna-direct       # default when unset
SLACK_SEQUENCES_LUNA_WORKER_URL=http://codex-worker.railway.internal:3000
SLACK_SEQUENCES_LUNA_WORKER_TOKEN=<shared 32+ character secret>
SLACK_SEQUENCES_LUNA_JOB_TIMEOUT_MS=1800000
```

Worker service:

```text
PORT=3000
LUNA_WORKER_TOKEN=<same secret>
LUNA_MODEL=gpt-5.6-luna
LUNA_REASONING_EFFORT=high
LUNA_JOB_TIMEOUT_MS=1800000
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
- Railway denies the Linux namespace operation required by the Codex command
  sandbox. The worker does not bypass or weaken that boundary. Luna is given all
  verified UTF-8 evidence inline and approved images as CLI attachments, and any
  shell, filesystem, network, MCP, browser, todo-list, sub-agent, or other tool
  event is a hard job failure.
- Defense is layered: the dedicated permission profile denies all model-visible
  filesystem/network scopes, optional tool features are disabled, and the worker
  scans the exact persisted Codex rollout after each turn. Only ordinary
  messages, reasoning, and compaction records are allowed; hidden function/tool
  calls fail before any bundle is materialized.
- `--output-schema` constrains the final response, but it is not the trust
  boundary: the worker independently validates schema, paths, Unicode, sizes,
  host-declared required files, exact base fingerprint, keep/inherit/replace
  actions, and hash-bound inert asset copies before atomic materialization.
- Health and operation IDs bind the exact artifact-schema and deny-all
  permission-profile hashes. Startup also executes `codex --version` and refuses
  to open the port unless the actual binary, installed profile, and protocol
  version all match exactly.
- The child receives an allowlisted environment without Slack, OpenAI,
  OpenRouter, Railway, OAuth, or worker-token secrets.
- Inputs and deliverables are bounded regular files with contained paths and
  SHA-256 verification; symlinks are rejected.
- Turns submit asynchronously with prompt/input/protocol/schema-bound idempotency
  keys and an expected prior run generation on resume, then poll;
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
- `/sequences assets`: deterministic screenshot/palette intake plus one Luna
  UI-pack authoring turn and a host-rendered preview. `assets clear` is
  deterministic and removes raw references plus all stored pack versions.
- `/sequences demo`: curated model-free demo.
- undo, render/re-render, approve/share, debug, help, and `mcp-test`:
  deterministic host operations.

The `mcp-test` board checks the private Luna worker without spending a model
turn. Only a real create proves the complete CLI/thread/browser/render/upload
path.
