# Refactor handoff — architecture, reliability, and motion quality

Status: **historical architecture rationale**. `LUNA_WORKFLOW.md` is the live
authoring contract and `REFACTOR_PLAN.md` preserves the engine/refactor journal.
As of 2026-07-13, the S6.9-S6.13 OpenRouter stabilization run is historical;
do not resume this document's broad refactor sequence, S7+, or its old
open-ended probe acceptance loop.

The official route now uses one private Railway Codex worker and one persistent
`gpt-5.6-luna`/high thread from treatment through rendered self-review and user
revision. The old provider committee remains unchanged behind the explicit
`legacy-provider` rollback route and is never an automatic Luna fallback.

## Mission

The long-term mission was to refactor `apps/slack` so a plausible production
brief usually reaches a clean storyboard and source in one logical attempt,
while moving its motion language toward the restraint and clarity of
`demos/slack-ad`.

This document was written after SignalDock and before the Phase 0-6 work now
recorded in the plan/journal. Preserve it as the explanation for those
architectural decisions, not as a current status report.

Success means:

- one canonical plan reaches one canonical runtime;
- deterministic defects never consume a paid model retry;
- QA measures the same semantics the runtime executes;
- a clean result is visually directed, not merely validator-compliant;
- live probes are part of the refactor loop, with fallback disabled and honest
  logical/physical attempt accounting.

For Luna, reuse the objective mechanics and evidence but bypass the committee
that motivated this refactor: no frame planner, scaffold/slots, critic, rescue,
or source replay. Luna owns creative intent; the host owns facts, permissions,
exact bytes, deterministic seeking, browser/runtime health, and encoding.

## Current assessment

The codebase is not careless, but it is overgrown. It contains strong typed
contracts, extensive incident regressions, exact artifact replay, real browser
measurement, and unusually good degradation telemetry. The problem is
coordination: too many independently reasonable passes rewrite the same timing,
camera, component, and evidence state.

The largest hotspots are approximately:

| File | Lines | Refactor pressure |
| --- | ---: | --- |
| `src/engine/layoutInspector.ts` | 5,775 | collection, policy, scoring, repairs, and report formatting are mixed |
| `src/engine/runner/repairs.ts` | 5,580 | unrelated repair domains and string transforms share state |
| `src/engine/runner/ladder.ts` | 4,505 | providers, retries, scene repair, attempt ledger, and publication decisions are coupled |
| `src/engine/componentContract.ts` | 2,400 | parsing, lowering, scheduling, runtime generation, and compatibility logic |
| `src/engine/pluginContract.ts` | 2,359 | catalog, params, lowering, reconciliation, and framing influence |
| `src/engine/runner/storyboardAudit.ts` | 2,309 | parse pipeline and ordered normalizers with implicit dependencies |
| `src/engine/sentinel.ts` | 1,895 | valuable registry, but too much incident prose in executable data |
| `src/engine/pacingAudit.ts` | 1,717 | audits and ordered timing mutation share overlapping rules |
| `src/engine/directComposition.ts` | 1,688 | composition model plus legacy compatibility and source manipulation |
| `src/engine/cameraContract.ts` | 1,512 | intent resolution, routing, runtime, and QA-facing semantics |

There are roughly 213 TypeScript files across `src` and `test`. File size alone
is not the defect; implicit pass ordering and duplicated semantics are.

## Historical evidence from the SignalDock baseline

`architecture-stress-5-20260711` / SignalDock is the refactor seed fixture.
Keep its exact artifacts.

- Frame direction truncated at the provider and used its deterministic fallback.
- Two physical storyboard streams timed out. The accepted plan still needed one
  bounded scene-repair call after atomic normalization reversion.
- Source attempt 1 and patch attempt 2 repeated the same seven browser classes.
- The runner early-shipped penalty 32 as `published-degraded`; the critic patch
  worsened it to 34 and was correctly rejected.
- The rendered film had 8 QA warnings, 4/8 readable primary landings, 30 jerk
  markers, two long dead windows, reset flickers, cropped numerals, and a weak
  CTA composition.

Concrete seams exposed:

1. A storyboard can describe a dark production basis while frame selection
   commits a light basis; downstream code accepts the contradiction.
2. `worldLayout` placed an app-window in a third horizontal station while its
   visible children lived in other stations. Blocking then tried to land on
   the shell and missed by 77.5% of the frame diagonal.
3. Four scenes produced 14 blocking phrases, including several near-zero or
   repeated same-target phrases. The film had more camera paperwork than
   meaningful visual ideas.
4. Persistent metric components restarted their count at `0%` on each shot and
   the discovered morph enlarged/clipped the numeral. Identity paperwork did
   not imply state continuity.
5. Author CSS could make the host stat label/value collide. The repair ladder
   asked the model twice but did not alter the class.
6. `querySelector('.cmp-value::after')` returned null and was passed to GSAP.
   Static normalization catches literal dead selectors, but not this simple
   variable/dataflow form.
7. The cursor used two corrective moves before pressing. Together with camera
   and component motion this produced five simultaneous voices and excessive
   jerk. The golden pattern is one intentional arrival path.
8. Browser findings could still be called “browser-valid” and early-shipped.
   Status semantics distinguish degraded output, but internal naming obscures
   the fact that quality obligations remain.

Do not patch all eight independently. They are symptoms of duplicated
ownership between plan, normalizers, runtime blocking, authored source, and QA.

## Target architecture

### 1. Typed stage pipeline

Make each stage a typed transform with explicit input, output, invariants, and
receipts:

`Brief → FrameDecision → Storyboard → NormalizedStoryboard → SceneScaffold → AuthoredSlots → CanonicalComposition → BrowserEvidence → PublicationDecision`

Use a functional core and imperative shell. Provider calls, filesystem writes,
MCP, Chromium, and render are shell adapters. Parsing, normalization, lowering,
auditing, scoring, and publication policy should be pure functions over typed
values.

Never let a later stage silently reinterpret an earlier contract. If a stage
needs a different representation, name the adapter and validate both sides.

### 2. Normalizer registry

Replace the implicit ordered list with registered passes declaring:

- input/output contract version;
- finding classes prevented;
- preconditions and postconditions;
- idempotence proof/test;
- read/write fields;
- ordering dependencies;
- atomic group and rollback policy;
- telemetry tag and exact incident fixtures.

Build a dependency graph and fail tests on write/write conflicts without an
explicit order. Run the full audit once after each atomic group, not scattered
partial audits whose results can become stale.

### 3. One time domain API

Introduce branded `SourceTime`, `ViewerTime`, `Duration`, and `SceneLocalTime`.
All ramp-aware comparisons go through one conversion service. Scene stretching
must return a cascade map applied to scenes, moments, beats, camera segments,
interactions, grades, cuts, and evidence in one operation.

Property-test monotonicity, boundary identity, round trips, and cascade
preservation. Remove ad hoc arithmetic from individual audits.

### 4. One camera semantic model

Unify intent, blocking, runtime, and QA around a single `CameraPhrase`:

- target and optional contextual framing target;
- source/arrival pose;
- travel, settle, dwell, and departure intervals;
- importance and evidence owner;
- occupancy/anchor contract;
- route ownership (`authored`, `continuity`, or `host-derived`).

Compile authored camera paths and continuity requests into this model once.
Runtime and QA must consume the same phrases and tolerances. Collapse
same-target/zero-distance phrases before runtime. Supporting evidence may
develop the frame but cannot create a new lens route.

Budget visual ideas, not raw phrases. A four-scene film like SignalDock should
not need 14 camera phrases to tell one metric story.

### 5. State continuity, not just identity continuity

A stable `entityId` should optionally carry a typed state handoff. For a metric,
the next scene begins from the prior resolved value, not zero. A morph may ship
only when both endpoint structure and state transfer are proven. Otherwise use
an honest swipe/match cut and initialize the incoming component directly.

The same handoff model should cover button state, progress, selected row, and
app-shell state. Reverse seek must restore both endpoint state and visibility.

### 6. Split layout and repair domains

Break `layoutInspector.ts` into measurement collectors, semantic selectors,
individual checks, aggregation/scoring, and report formatting. Checks receive
immutable evidence and emit typed findings; they do not repair.

Break `runner/repairs.ts` by domain: HTML chassis, CSS safety, selector/dataflow,
timeline normalization, contract islands, and bounded layout repair. Each
repair returns edits plus a proof that the intended finding changed and no new
class appeared.

Add shallow JavaScript dataflow for obvious dead GSAP targets, including
`querySelector()` with pseudo-elements and provably absent literal selectors.
Do not grow a general JavaScript rewriter inside regexes.

### 7. Attempt ledger and publication semantics

Use one immutable ledger for logical attempts, physical requests, hedges,
timeouts, scene repairs, critic calls, and fallback/degradation. Derive CLI,
Slack, and JSON status from it.

Rename “browser-valid” states that retain blocking-quality findings. A draft may
be runtime-valid yet quality-degraded; those are different axes. One-attempt
success means no model repair, no deterministic proof-film replacement, no
material degradation, and no repeated QA class.

## Motion direction from the golden Slack demo

`demos/slack-ad` works because it is directed, not because it moves constantly.
Its reusable lessons are:

- Seven clear acts across roughly 28 seconds; every act has one dominant idea.
- Cause and effect are legible: clutter compresses into the mark, the mark leads
  to product action, the action leads to proof, and proof resolves to lockup.
- Macro camera moves are motivated by content. The key workspace move dives to
  the reply, anticipates with a blinking caret, pans with the typed text, holds
  the answer, pulls back, then reveals the reaction on a settled frame.
- Gestures have anticipation, action, settle, and a real read hold. Entrances do
  not immediately collide with departures.
- There is one main energy peak. Most other motion is connective, ambient, or a
  small confirmation.
- Repeated transition grammar creates coherence. It does not showcase every
  available cut or camera pattern.
- Background life stays on wallpaper, cards, light, and quiet drift; primary
  type is not jostled during reading.
- The ending lands by about 24 seconds and breathes until the end with only an
  almost invisible scale pulse.

Translate these into planning constraints, not a cloned style: fewer visual
ideas, motivated routes, stateful cause/effect, explicit holds, and restraint.
Do not attempt to solve taste by adding more camera moves, plugins, recipes, or
prompt adjectives.

## Original refactor sequence (historical; do not resume from here)

1. Freeze behavior with exact fixtures for LaunchRelay, PulseForge, GatePilot,
   RelayGuard, and SignalDock. Add property tests for normalizer idempotence,
   ordering, time monotonicity, and camera phrase collapse.
2. Extract the immutable attempt ledger and typed stage result without changing
   provider behavior.
3. Introduce branded time types and one cascade transform; migrate pacing and
   interaction audits.
4. Introduce canonical `CameraPhrase`; adapt current runtime and QA to it before
   deleting old paths.
5. Add typed state handoffs for metric/button/progress continuity.
6. Split layout collection/checks/reporting, then split repairs by domain.
7. Reduce prompt payload after host ownership is stable. SignalDock's repair
   prompt reached 125k characters; do not optimize prompts before eliminating
   contradictory contracts.
8. Delete compatibility paths only after exact replays, full tests, golden
   render, and live probes agree.

Commit after each migration seam. Keep commits reversible and avoid mixing
architecture moves with creative tuning.

## Original verification and live-probe loop (superseded for the hackathon)

The active S6.12 loop permits one representative probe and, only after a hard
or judge-visible failure is fixed and replayed, one rerun. It does not require a
stress probe followed by a calm probe, and it stops on the first acceptable
MP4. The steps below explain the original long-term method only.

For every migrated seam:

1. Run focused unit tests and typecheck.
2. Replay the exact rejected storyboard/source artifacts.
3. Run the full unit and browser suites.
4. Render `demos/slack-ad` and confirm the golden path did not regress.
5. Run deterministic demo/MCP checks.
6. With explicit authorization, run a cache-distinct stress probe using
   `--provider openrouter-api --mcp --render --temporal`, continuity on,
   composition audit, and fallback disabled.
7. Inspect the report, logical/physical ledger, MP4, representative strip,
   blocking overlay, and important thumbnails. Read the code for actual motion.
8. Immediately replay and fix any repeated mechanical class before another
   paid run.

After one clean stress probe, run one calm production-shaped normal probe. Fix
only real defects—attempts, fallback/degradation, off-frame/cropped subjects,
broken state, unreadable hierarchy, or clearly bad motion. Do not expand into
Studio component, asset, recipe, plugin, background, or camera-pattern product
work unless a concrete integration bug blocks the existing path.

## Original long-term acceptance gate (superseded for the hackathon)

The refactor is ready to hand back when:

- focused and full tests pass;
- exact rejected artifacts converge without a model call;
- one fresh stress probe completes in one logical storyboard and one logical
  source attempt with no fallback or material degradation;
- one fresh normal probe completes without real layout/motion defects;
- primary blocking landings are readable and in range;
- the MP4 shows one clear subject, motivated motion, settled payoffs, and a
  confident final hold comparable in discipline—not visual imitation—to the
  golden Slack demo.
