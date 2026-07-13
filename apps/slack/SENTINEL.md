# Sentinel — correctness and fallback contract

Sentinel exists to make failures cheaper, deterministic, and honest. The
executable sources are `src/engine/sentinel.ts`,
`src/engine/hostContract.ts`, and `src/engine/featureFlags.ts`; this document
explains how to change them.

## Place obligations at the lowest owner

| Layer | Owner | Rule |
| --- | --- | --- |
| L0 schema | Types/parsers | Reject malformed contracts before authoring. |
| L1 scaffold | Host generation | Emit required structure and plan islands correctly. |
| L2 normalize | Deterministic transforms | Delete, degrade, retime, rebind, or complete only when the result is exact and non-creative. |
| L3 static gate | Source/DOM analysis | Reject defects provable without a browser. |
| L4 browser gate | Rendered evidence | Measure geometry, visibility, interaction, framing, and motion. |
| L5 model retry | Bounded ladder | Repair only an unresolved hard authoring failure after lower layers are exhausted. |

The table describes the full engine and the explicit legacy-provider route.
The default Luna route currently uses L0, L3, L4, transactional commit, and
render/encoding mechanics; it bypasses the legacy L1 scaffold, creative L2
rewrites, critic/rescue ladder, and L5 repair committee. Luna declares creative
intent itself. Its L0 boundary disables optional tools, denies model-visible
filesystem/network access, rejects tool events in both exec JSONL and the exact
persisted rollout, and independently validates the complete artifact envelope before the worker atomically
materializes it. A later authored-hard-defect repair may resume the same exact
thread, but must not silently restore the committee.

Decision rule: if the host can know the answer, the host owns it. A normalizer
must be bounded, idempotent, visible in telemetry, and committed only after the
whole plan revalidates. If it introduces a new finding class, revert the atomic
group and preserve the model artifact.

Normalizer order is an executable contract, not incidental array position.
Every pass declares its read/write fields, pre/postconditions, dependencies,
atomic group, and idempotence proof. Shared writes require a dependency path;
the full invariant audit runs once at the atomic-group boundary so later edits
cannot act on stale partial-audit results. Prefer one declared owner and one
group audit over repeated L2 churn across overlapping fields.

Do not loosen a gate, increase attempts, or add prompt prose to compensate for
a mechanical defect.

## Current Luna guardrail policy

S6.9-S6.13 established the classification below. It now governs the objective
host gate around Luna and preserves visibility into all QA findings while
separating them into three decisions:

1. **Hard:** parse/schema/contract failure, runtime exception, missing or
   invalid exact timeline, nondeterministic seek, blank/load-bearing content
   failure, state reset, missing render, a load-bearing focal that remains out
   of frame, forbidden Luna tool use, invalid artifact envelope, unsafe
   path/copy binding, or failed atomic materialization. These block the first
   candidate. One bounded repair resumes the same Luna thread with exact
   mechanical evidence; a second rejection enters labeled fallback.
2. **Deterministic:** canonical markup/binding/script order and measured
   wrapper/station/camera containment. Legacy may repair once in the same source
   attempt, remeasure, and adopt only on strict improvement with no new hard
   finding. Luna host code must not rewrite creative bytes merely to clear it.
   Never change copy, story order, component choice, timing, palette,
   typography, or motion style.
3. **Advisory:** static timeline-registration syntax once the exact browser
   contract passes; washout/contrast preference, occupancy/fill preference when
   the focal is visible, camera-settle or reversal taste, supporting static
   moments, parent/child surface overlap, motion/moment/transition counts,
   density, and non-catastrophic pacing or readability. Record these honestly,
   but do not feed them to Luna repair or any legacy repair/rescue/critic prompt.

When classification is ambiguous, default to advisory unless the rendered
output is clearly broken. A runtime-valid film may therefore ship as `warn`
and still satisfy the current hackathon acceptance contract.

The direct-composition static and browser gates implement this policy for films
carrying declared primary selectors. The legacy route retains its historical
blocking behavior. Do not launch another model turn merely to clear an advisory.

## Fallback and degradation

A fallback replaces or materially degrades the authored film. Receipt-level MCP
recovery and exact host normalization are resilience, not visual fallback.

`SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK` governs both author routes. Luna
never falls through to OpenRouter or a disguised creative result: after one
same-thread repair fails, is unavailable, or the worker is unreachable, it
publishes the same explicitly labeled deterministic proof film. With the switch
off, Luna fails visibly with the job ID and `FAILURE.md`. Its optional
self-review may fail without discarding the already accepted first cut. A
completed but host-rejected turn advances the persisted worker-generation
cursor; its exact response/receipt is persisted before host interpretation and
the repair receives the rejected bundle as authoritative input.

Legacy degradation must appear in `planning/sentinel-run.json` and final status.
Luna preserves per-turn worker receipts, raw-envelope and materialized
fingerprints, exact deliverables, and session hashes under `planning/luna/`;
its fallback is also labeled in the final Slack result. Important dispositions
are:

- `published`: accepted source, no material degradation;
- `published-degraded`: an authored film shipped with explicit degradations;
- `fallback`: labeled deterministic proof film replaced authoring;
- `fail-loud`: no video was published.

Never report `published-degraded` as a clean pass.

## Attempt discipline

When a model turn burns an attempt:

1. Stop further paid retries when practical.
2. Preserve the exact raw response and rejected HTML/JSON.
3. Replay the artifact through current parsing or QA.
4. Minimize the failure into a regression.
5. Fix the lowest shared owner and rerun the exact artifact first.
6. Log the result in [PROBE_LOG.md](PROBE_LOG.md).

Default Luna create has one director turn, at most one same-thread mechanical
repair before acceptance, and one rendered self-review turn; self-review chooses
zero or one polish. Revisions resume that same thread. There are no hedges,
rescue models, critic patches, repair committees, or OpenRouter retries. The
bounded legacy ladders remain implementation details of the rollback route and
must not be raised as a Luna quality strategy.

Railway's namespace restriction is not permission to run Codex unsandboxed.
Luna turns are tool-less and schema-constrained; a tool attempt fails visibly
even if a valid-looking final envelope follows. Replay envelope/path/hash
failures model-free and never cross automatically into the legacy route.

## Executable registries

`src/engine/sentinel.ts` is the closed finding/normalizer registry. Each entry
states the obligation, layer, blocking policy, prompt cost, proof, and why that
layer owns it. `test/sentinel.test.ts` detects unregistered findings.

`src/engine/hostContract.ts` registers canonical contract bytes, parsers,
validators, adapters, and runtime injection. It does not decide orchestration
order.

`src/engine/featureFlags.ts` is the source of truth for behavior switches,
defaults, values, and rollback ownership. Source-scan tests reject unknown or
stale `SLACK_SEQUENCES_*` reads.

## Evidence and diagnostics

For a job directory, inspect:

- `planning/attempts/storyboard-*-*.raw.txt` and matching JSON;
- `planning/attempts/author-*-*.html` and matching JSON;
- `planning/author-run.json` for source attempts and terminal findings;
- `planning/sentinel-run.json` for calls, layers, normalizations, and
  degradations;
- `build/qa/sequence-check.json` for the terminal status;
- temporal strip, blocking overlay, important thumbnails, and MP4.

Use the strip for representative states, not to infer motion. Read the camera,
component, interaction, and authored GSAP code for movement between states.

Studio conversion telemetry is executable evidence, not catalog paperwork. An
asset counts only after plugin reconciliation stamps a UID and the augmented
storyboard passes its full plan gate; an unlowered declaration or a declined
duplicate must never seed the evidence-backed capsule.

Typed source ownership extends to shared internal class names and interaction
actors. Ring-only absolute geometry must be scoped to the ring root before it
can affect another `.cmp-value`; a typed interaction owns the only visible
cursor and its measured arrival feedback. Density counts distinct moving
targets, not every mechanical down/release/settle tween on one target. Browser-
sampled contrast may converge through bounded passes only while each complete
candidate strictly improves the global penalty.

## Adding or changing a rule

Before implementation:

- identify the first layer that has enough information;
- state whether the change deletes/degrades or invents creative content;
- define bounds, idempotence, ordering dependencies, and rollback behavior;
- add an exact incident fixture and negative control;
- register telemetry and the finding prefix;
- verify strict replay, focused unit/browser tests, and—when authorized—a
  cache-distinct live probe.

Prompt guidance is appropriate for taste and creative choice. It is not the
primary repair mechanism for selector syntax, timing arithmetic, contract
ownership, runtime ordering, or measured geometry.
