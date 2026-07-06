# SENTINEL_REPORT.md — implementer's report

Companion to [SENTINEL_PLAN.md](SENTINEL_PLAN.md). Structured per plan §8 and
updated per phase. Every claim that needs evidence names its file/command; a
probe that fell back is recorded here with its `FAILURE.md` path, never retried
silently into a clean table.

**Implementer:** Claude (Opus 4.8). **Started:** 2026-07-05.

Verification legend for "commands run": ✅ ran clean · ⚠️ ran with caveat · ⏳
not yet run (paid probe / infra layer). Which layers actually ran is summarized
at the end of each phase.

---

## Phase 0 — telemetry baseline

**Status:** code complete + instrument proven on a real (model-free) run. Paid
baseline numbers deferred to the probe step (see Open items).

### What changed (files + why)

- **`src/engine/sentinelTelemetry.ts`** (new) — one `planning/sentinel-run.json`
  per job: per-stage wall-clock + attempts, model-call count, prompt/completion
  chars, findings-by-layer (L0→L5), deterministic-normalization tags, tier-1 /
  tier-2 wall-clock, and the run disposition
  (`published | published-degraded | fallback | fail-loud`). Collection uses
  `AsyncLocalStorage` (`beginSentinelRun` via `enterWith`) so the deep model-call
  and repair seams never grow a `projectDir` parameter. Diagnostic-only: no
  context ⇒ every record is a silent no-op; a disk fault never disturbs a build.
- **`src/engine/sentinelFlags.ts`** (new) — the single source of truth for the
  Sentinel kill-switches (`sentinelSkeletonEnabled` / `sentinelSlotsEnabled`),
  both default OFF until Phase 5 flips them.
- **`src/engine/compositionRunner.ts`** — `completeWithRetry` /
  `completeReasoningWithRetry` record one logical (de-hedged) model call each
  with prompt/completion chars; `applyDeterministicSourceRepairs` records L2
  normalizations for the six paperwork classes Phase 1 targets
  (island-strip, contract-binding, camera-world-plane, component-binding,
  component-alias, interaction-binding, runtime-order); `authorComposition`
  attributes each rejected attempt to `static` (L3) / `browser` (L4) and counts
  paid re-authors as `model-retry` (L5).
- **`src/orchestrator.ts`** — `createVideo` enters a Sentinel run at the top of
  both the model-authoring branch and the preset/demo branch, records tier-1
  (authoring→submit) and tier-2 (incl. MP4) wall-clock, attaches the stage
  receipts, and finalizes the disposition — including `fail-loud` on both throw
  paths. Reuses the existing `stages`/`performance.now()` timings; **ETA
  behavior (`stageTimings.ts`) is untouched.**
- **`scripts/sentinelReport.ts` + `npm run sentinel:report`** (new) — aggregates
  every `sentinel-run.json` (+ sibling `author-run.json`) under a directory into
  the mission metric table (markdown or `--json`), with a `--label` for
  before/after captures and a per-run detail table.

### Deviations from the plan

- **Tier wall-clock basis.** The plan lists "wall-clock to tier-1 (thumbnails
  posted)" and "tier-2 (MP4)". `createVideo` returns after tier-1 in the live
  two-tier flow, and `render_preview`/`render` live inside `buildPreviews`, so
  `tier1Ms` is measured as **authoring→submit** (the model-bound portion that
  dominates tier-1 wall-clock; the thumbnail `render_preview` is fast and
  infra-bound, already timed in `stage-timings.json`). `tier2Ms` is the full
  elapsed including MP4 when a run renders in one call (as `sequence:check`
  does). This is labeled in the report and is honest about what it measures.
- The plan suggested `scripts/sentinel-report.mjs`; implemented as a `tsx`
  script (`sentinelReport.ts`) to match the repo's script convention and reuse
  `SLACK_SEQUENCES_DATA_DIR` resolution.

### Flags added

`SLACK_SEQUENCES_SENTINEL_SKELETON` (Phase 1),
`SLACK_SEQUENCES_SENTINEL_SLOTS` (Phase 2) — both default OFF.

### Tests / commands run

- `npm run typecheck --workspace @sequences/slack` — ✅ exit 0.
- `npm run sequence:check --workspace @sequences/slack -- --demo --no-mcp
  --format json --job-id sentinel-phase0-demo` — ✅ produced a real
  `planning/sentinel-run.json` (disposition `published`, 0 model calls — the
  demo is model-free).
- `npm run sentinel:report --workspace @sequences/slack -- <project-dir>` — ✅
  produced the metric table from that real run (shown below).
- Regression subset (orchestrator, authorReliability, directComposition,
  stageTimings): ✅ 158/158 passed.

Evidence path:
`.data/projects/sentinel-phase0-demo/planning/sentinel-run.json`.

### Acceptance verdict

**PASS (instrument).** The report script produces the metric table for a real
`createVideo` run. Model-path fields (storyboard/source attempts, model calls,
author prompt chars, layer/normalization counts) populate only on a paid run;
those baseline numbers are captured in the Metrics table below once the probe
step runs. `stageTimings.ts` (ETA) behavior unchanged.

---

## Phase 1 — kill model-owned paperwork (PRIORITY, shippable)

**Status:** code + tests complete, full suite green, `film:demo` byte-stable.
Flag-gated behind `SLACK_SEQUENCES_SENTINEL_SKELETON` (default OFF until Phase 5).

### What changed (files + why)

1. **Host plan islands are host-owned, always** (unconditional, not flag-gated —
   the L2 fix for 2026-07-05 incident 2). `compositionRunner.ts`:
   `stripAllHostPlanIslands` + `HOST_PLAN_ISLAND_IDS` remove **every**
   model-authored `sequences-{interactions,cuts,camera,components,time}` island
   before the per-plan injection re-emits the canonical island. The old
   `stripUnusedHostPlanIslands` only removed islands with *no* matching plan, so
   a shadow island that mirrored a real plan (wrong `version`, non-array
   `scenes`) survived to validation. Now nothing the model hand-writes about an
   island can reach the gate. `stripUnusedHostPlanIslands` is retained/exported
   (still unit-tested) but no longer on the pipeline.
2. **Camera-world plane + stations in the skeleton** (flag-gated, incident 1a).
   `buildSceneSkeleton`/`buildSceneSkeletons` emit, for a camera scene, the
   `data-camera-world` plane sized by `cameraWorldStyle` and each `data-region`
   station at its exact `worldStationRects` rect (the same math
   `worldLayoutGuidance` renders as prose), plus a screen-space
   `data-camera-overlay` when the scene has interactions.
3. **Component roots + focal-part carriers in the skeleton** (flag-gated,
   incident 1b). `componentContract.ts`: `componentSkeletonMarkup` stamps the
   catalog exemplar (correct tag, `cmp cmp-<kind>` class, `data-component`, valid
   interior) with the component's real id as `data-part`. Region-bearing
   components nest in their station; cut/camera focal parts that name no
   component get a bare `data-part` carrier. `component_root_missing`,
   `component_beat_unbound`, and the cut/camera focal-part classes become
   unrepresentable.
4. **Runtime script block / registration seam** — see Deviations. The obligation
   already lives at L2 (`ensureRuntimeScriptOrdering`, unconditional); kept there.
5. **`gsap.timeline({ paused: true })` false-reject fixed** (`directComposition.ts`).
   `hasPausedTimeline` replaces the `[^}]*` regex with a brace-balanced scan, so
   `gsap.timeline({ defaults: { ease: "none" }, paused: true })` no longer
   false-rejects a valid composition (FALLBACKS.md "Known open risks" — now
   closed).
6. **Prompt** (`planning-director.md`) — the interactions "copy those interaction
   objects into a JSON island and call compile" instruction and the "load
   `sequences-interactions.v1.js`" runtime rule are replaced with a one-line
   "the host injects/owns every contract island, runtime, and compile call —
   never author them" statement (their obligation moved to L2). See Deviations
   for why the larger scaffold-prose deletions are staged to the Phase-5 flip.

### Deviations from the plan

- **Item 4 (runtime block in skeleton).** Not emitted in the prompt skeleton.
  The obligation is already fully owned at L2 by `ensureRuntimeScriptOrdering`
  (unconditional — it collapses/orders all five runtime `<script src>` tags and
  injects missing ones after GSAP), and neither incident was a script-order
  failure. Emitting a large runtime literal for the model to reproduce would
  *add* a failure surface for no gain, so the L2 mechanism stays the owner and
  the load-bearing "Load GSAP as `<script src="gsap.min.js">`" / "one paused
  timeline registered under the composition id" rules are kept (GSAP itself is
  not host-injected). Rationale: minimal deviation, no incident class left open.
- **Prompt deletions are staged.** The scaffold (items 2-3) is flag-gated OFF by
  default, so the world-building / component-root prose is still needed by the
  default (flag-OFF) path; deleting it now would degrade the shipping default.
  Only the island-authoring obligation (item 1, unconditional L2) was removed
  from the prompt in Phase 1. The larger scaffold-prose deletions land with the
  Phase-5 default flip, when the skeleton is authoritative. Net Phase-1 prompt
  delta is therefore ~neutral (a rewrite, not a shrink): 36,950 → 37,010 bytes.
- **Skeleton flag ON is unit-proven, not yet paid-probed.** The builder is proven
  by direct unit tests; the full flag-ON model path is validated by a Phase-5
  paid probe (pending).

### Flags added

`SLACK_SEQUENCES_SENTINEL_SKELETON` (default OFF; `=1` enables the scaffold).

### Tests added (names)

`test/authorReliability.test.ts`, new describe blocks:
- **"Sentinel Phase 1 — skeleton scaffold makes paperwork classes
  unrepresentable"**: incident-1 replay asserts the skeleton emits the plane +
  stations (with exact rects) + component root and that
  `reconcileCameraWorldPlanes`/`reconcileComponentBindings`/`reconcileContractBindings`
  report **0 repairs** on a doc built from the skeleton; a contrast test proves
  bare shells lack both (the class was real); a test asserts the component root
  stamps the real id + kit class and does not leak the exemplar id.
- **"Sentinel Phase 1 — host plan islands are host-owned, always"**:
  `stripAllHostPlanIslands` removes all five islands unconditionally; incident-2
  replay proves a shadow `sequences-camera` island (non-array `scenes`) is
  replaced by the canonical plan (exactly one island, `scenes` is a real array)
  and a shadow `sequences-interactions` island (`version: 9`) is removed when the
  plan declares no interactions.
- **"hasPausedTimeline — Sentinel Phase 1 false-reject fix"**: accepts nested-config
  + bare paused forms, rejects a non-paused nested-config timeline.

### Commands run

- `npm run typecheck --workspace @sequences/slack` — ✅ exit 0.
- `npm run test --workspace @sequences/slack` — ✅ **483/483** across 40 files
  (all browser gates included).
- `npm run film:demo --workspace @sequences/slack` — ✅ passes; the model-free
  path shares none of the changed code (`applyDeterministicSourceRepairs`,
  `creationPrompt`, `buildSceneSkeletons` are not on it) and the `gsap` gate
  only relaxed, so it is byte-stable.

### Acceptance verdict

**PASS.** Both 2026-07-05 incident replays pass on attempt 1 with **zero
repairs** logged for the camera-world, component-root, and island classes.
`SLACK_SEQUENCES_SENTINEL_SKELETON=0` reverts to bare shells (default). Legacy
paths intact; full suite + `film:demo` green.

---

## Phase 2 — scene-scoped authoring (slots)

**Status:** cut-line shipped (slot artifact boundary + host assembly + validation
attribution + truncation-tail recovery), flag-gated behind
`SLACK_SEQUENCES_SENTINEL_SLOTS` (default OFF). Full slot-scoped *validation*
retry is the reassess item (see Deviations). Full suite green (491/491),
`film:demo` byte-stable.

### What changed (files + why)

- **`src/engine/sceneSlots.ts`** (new) — the artifact-boundary change:
  - `extractSceneSlots(raw)` parses `<film_style>` + per-scene `<scene_html id>` /
    `<scene_script id>`, tolerant of a truncated tail (an unclosed slot marks
    `truncated` and is dropped; completed slots are kept).
  - `assembleSlotComposition(...)` deterministically builds the canonical
    document: chassis + shared `<style>` + host-owned `<section>` wrappers
    (id/timing/track) around each interior + one paused timeline that invokes
    each scene's statements in its own `(function (tl) { … })(tl)` scope +
    host-owned `window.__timelines` init/registration/seek. Byte-stable for
    fixed inputs; `applyDeterministicSourceRepairs` then injects runtimes,
    islands, compile calls, and kits exactly as for a whole-doc composition.
  - `attributeFindingsToScenes(findings, ids)` maps each rejection to the
    scene(s) it names (arrows `a->b` attribute to both; a dashed id never
    matches inside a longer one; film-level findings land under `__film__`).
- **`src/engine/compositionRunner.ts`**:
  - `buildSceneSkeletonInterior` extracted from `buildSceneSkeleton` (+
    `sceneSkeletonOpenTag`, `skeletonContext`), and `buildSceneSlotInteriors`
    exposes the per-scene interior templates the slot prompt shows.
  - `slotSceneTemplates` / `slotResponseContract` — the slot prompt (host owns
    the wrappers/chassis/timeline; author returns film_style + interiors +
    per-scene statement blocks). `creationPrompt` grows a `slots` mode.
  - `authorSlotDraft` runs the first authoring pass as slots: request → parse →
    **truncation-tail recovery** (re-request only the missing scenes, keeping
    every completed one — the `slotContinuationPrompt`) → assemble. Wired into
    `authorCompositionLoop` behind `useSlots` (`sentinelSlotsEnabled()` &&
    locked storyboard && first full pass). `logSlotFindingAttribution` reports
    findings-by-scene on a slot rejection.
- **`src/engine/sentinelFlags.ts`** — `sentinelSlotsEnabled()`.

### Deviations from the plan

- **Retries after the first slot pass stay whole-doc (the §3 cut-line).** The
  plan's full slot-scoped *validation* retry (re-request only failing scenes in
  parallel, cap 2, then a whole-doc terminal rung) is **not** implemented; a slot
  attempt that fails validation falls through to the existing whole-doc ladder
  (compact patch / full re-author on the assembled document). This ships "slot
  validation attribution but whole-doc retries," which the plan explicitly names
  as the shippable Phase-2 cut-line. The parallel slot-scoped validation retry is
  the reassess item — the artifact boundary + attribution it needs are now in
  place (`attributeFindingsToScenes`, `authorSlotDraft`).
- **Truncation recovery is implemented** (Phase 2.4): `authorSlotDraft` keeps
  completed scenes and re-requests only the missing tail once before falling
  back, rather than deleting `MAX_AUTHOR_SEGMENTS` (which stays for the whole-doc
  path until the slot path is default-on and probe-confirmed).

### Flags added

`SLACK_SEQUENCES_SENTINEL_SLOTS` (default OFF; `=1` enables slot authoring).

### Tests added (names)

- **`test/sceneSlots.test.ts`** (7): `extractSceneSlots` (parse, truncation,
  fence-strip); `assembleSlotComposition` (canonical wrappers/timeline,
  determinism, missing-scene reporting); `attributeFindingsToScenes`.
- **`test/sceneSlots.browser.test.ts`** (1): a two-scene slot response is
  assembled + repaired and passes the **real gate** — `validateDirectComposition`
  clean and `inspectDirectComposition` ok. (This caught a real bug: the assembly
  must `window.__timelines = window.__timelines || {}` before registration —
  now fixed and asserted by the gate.)

### Commands run

- `npm run typecheck --workspace @sequences/slack` — ✅ exit 0.
- `npm run test --workspace @sequences/slack` — ✅ **491/491** across 42 files.
- `npm run film:demo --workspace @sequences/slack` — ✅ identical output
  (lint clean · 3 static warnings · 48 samples · 6 warnings), byte-stable.

### Acceptance verdict

**PARTIAL (cut-line met).** The scene-addressable artifact boundary, host
assembly, per-scene validation attribution, and truncation-tail recovery are in
and gated; an assembled composition passes the real browser gate. The plan's
headline cost-lever metric ("a seeded single-scene failure costs one ~4k call")
requires the full slot-scoped validation retry, which is deferred to the
reassess along with its paid-probe confirmation.

---

## Metrics table (baseline vs post-Phase-5)

Populated from `npm run sentinel:report`. Per the user's decision, **one**
baseline probe (flags OFF) + **one** final probe (flags ON) were run on the §7.1
dense-UI brief (command-palette + modal + stat-card + button + terminal),
`--provider openrouter-api --no-mcp --render`, fail-loud ON. The full 3-brief ×
2 set is left for the Phase-5 pass.

Note: "Baseline" here is **not** truly pre-Sentinel — Phase 1's unconditional
island-strip is active even with flags OFF (it is not flag-gated). The baseline
below already shows it firing 10× (`island-strip: 10`), i.e. the model authored
10 host islands that would have reached validation pre-Sentinel (the incident-2
fallback risk). "Final" = `SENTINEL_SKELETON=1 SENTINEL_SLOTS=1`.

| Metric | Target | Baseline (flags OFF) | Final (flags ON) |
| --- | --- | --- | --- |
| Disposition | published | **published, no fallback** | **fail-loud** (see below) |
| Hard authoring failures (fail-loud) | 0 | 0 | 1 |
| Visible fallbacks | 0 | 0 | 0 (failed loud, not fallback) |
| Storyboard attempts / run (avg) | ≤ 1.5 | 3 | 4 |
| Source-author attempts / run (avg) | ≤ 1.5 | 3 | 4 (exhausted → rescue) |
| Wall-clock to tier-1 (avg) | ≤ 8 min | 22.1 min | n/a (never reached tier 1) |
| Wall-clock to tier-2 (avg) | ≤ 14 min | 24.1 min | n/a |
| Author prompt size (max chars) | ≤ 45,000 | 105,516 | 107,535 |
| Model calls / clean run (avg) | ≤ 5 | 8 | 9 (failed run) |

Baseline layer breakdown: normalize **26** (island-strip 10, interaction-binding
14, runtime-order 2), static 1, browser 2, model-retry 2; scaffold 0 (flags OFF).
Final layer breakdown: normalize **36** (island-strip 10, interaction-binding 23,
runtime-order 3), static 1, browser 3, model-retry 3; scaffold 0.
Project dirs (immutable): baseline `.data/projects/sentinel-baseline-denseui`;
final `.data/projects/sentinel-final-denseui`.

### Final probe — honest failure (flags ON)

**The flags-ON run FAILED (fail-loud) at source-author** —
`FAILURE.md`: `.data/projects/sentinel-final-denseui/FAILURE.md`. This is
reported, not retried into a clean table. What happened, from the persisted
artifacts:

- The Phase-2 **slot path was exercised live** (author attempts 1 and 3 logged
  `scene slots`; the per-scene attribution worked —
  `slot findings by scene — command-palette-hook:2 deploy-and-stream:2`).
- Author attempts 1/3 (slots) and 2 (compact patch) were rejected on
  **`near_blank_film` / `near_blank_scene`** — the scenes rendered as blank
  frames. The source-rescue rung (tencent/hy3-preview, whole-doc) also failed →
  fail-loud.
- **Root cause (evidence-backed).** The assembled slot document
  (`planning/attempts/author-1-static-rejected.html`) has **no `.scene` stage
  CSS**: the model's `<film_style>` supplied design tokens but omitted the
  structural rule (`.scene { position:absolute; inset:0; … }` and composition-root
  sizing) that the whole-doc path authors implicitly. Without it the
  `<section class="scene clip">` wrappers and their `data-camera-world` planes
  (4800×2160 absolute) are not stage-positioned, so content lands off-frame and
  every scene samples blank.
- **The shipping default is unaffected.** SLOTS/SKELETON default OFF; the same
  brief on the default path (the baseline) **published cleanly with no
  fallback**. The failure is entirely inside the opt-in Sentinel path.
- **Concrete fix for the resume** (not applied — user paused): the stage layout
  is host-owned, so `assembleSlotComposition` should inject a minimal
  deterministic stage `<style>` (`.scene` absolute/inset, root sizing,
  camera-world containment) into the assembled `<head>` — exactly as the cinema
  and component kits are injected — so scene positioning never depends on the
  model's `film_style`. This is a Phase-1-style "host owns structure" move and is
  the gate on flipping SLOTS on. Isolating whether SKELETON-only (slots off) is
  clean needs one more probe.

**Conclusion:** the baseline confirms the shipping default is healthy on the
hardest §7 brief (published, no fallback); the final probe shows the opt-in
slot path is **not yet judge-ready** and correctly stays flag-OFF. Phase 5's
default flip is appropriately blocked until the stage-CSS fix lands and a probe
confirms it.

> **SUPERSEDED (2026-07-06):** the stage-CSS fix landed in commit `0864c19` and
> the confirming probe was run this session — see **"Carryover A — the flip-gate
> probe, confirmed"** below. The flags-ON slot path now **publishes clean** on
> this exact brief (`sentinel-carryoverA-denseui`), so the "Final (flags ON) =
> fail-loud" row in the table above reflects the pre-fix state only. This table
> is retained as an honest historical record, not the current state.

**What the baseline proves about the plan's diagnosis** (the §1 doom loop, now
measured): storyboard-plan alone was **~16.9 min across 3 attempts** — by far the
dominant cost — and the author prompt was **105,516 chars** (2.3× the 45k
target). These are exactly what Phase 3 (normalize-before-retry + ladder/latency
retune) and Phase 4 (prompt-budget test) target and are **not yet built** (the
user paused after Phase 2). The Sentinel *paperwork* fixes (Phases 1-2) do not
by themselves move storyboard latency or prompt size; those two metrics move
only with Phase 3-4.

---

## Prompt diff summary

`prompts/planning-director.md` byte counts:

| | bytes | lines |
| --- | --- | --- |
| before Phase 1 | 36,950 | 625 |
| after Phase 1 | 37,010 | 624 |

Phase-1 delta is a rewrite (island-authoring instruction → host-owned reminder),
not a shrink — the scaffold-prose deletions are staged to the Phase-5 flip (see
Phase 1 Deviations). Assembled author prompt (fixture job): enforced by Phase-4
`test/promptBudget.test.ts` (≤ 45k) — ⏳ pending Phase 4.

---

## Incident replays (2026-07-05)

Both incidents pass on attempt 1 with **zero repairs** for their classes, proven
by `test/authorReliability.test.ts` (all 64 file tests green):

- **Incident 1** (`incident 1 replay: skeleton emits the camera-world plane +
  component root; zero repairs`): the skeleton for the camera scene contains
  `data-camera-world` + both `data-region` stations at their exact rects, and the
  component scene contains `data-part="cmd-palette"` / `data-component`; a doc
  built from the skeleton yields `reconcileCameraWorldPlanes`,
  `reconcileComponentBindings`, and `reconcileContractBindings` **repairs = 0**.
- **Incident 2** (`incident 2 replay: a model-authored shadow sequences-camera
  island is replaced with the canonical plan`): a shadow `sequences-camera`
  island with `"scenes":"not-an-array"` becomes exactly one canonical island
  whose `scenes` is a real array after `applyDeterministicSourceRepairs`; a
  shadow `sequences-interactions` island (`version: 9`) is removed when the plan
  declares no interactions.

Evidence: `apps/slack/test/authorReliability.test.ts`; run with
`npm run test --workspace @sequences/slack`.

---

## Open items

The user directed **Phase 2 only, then reassess**, and after Phase 2 chose to
**pause** (report finalized with one baseline + one final probe). The following
are therefore deliberately deferred, not dropped:

- **Slot-path stage CSS (the gate on flipping SLOTS on).** `assembleSlotComposition`
  must inject a host-owned minimal stage `<style>` (`.scene` absolute/inset, root
  sizing, `data-camera-world` containment) so scenes are positioned regardless of
  the model's `film_style`. The final probe failed loud precisely because this was
  missing (blank frames). This is the first thing to do when Phase 2 resumes,
  followed by a confirming probe. Until then SLOTS must stay default OFF.
- **Phase 3 — storyboard normalization + ladder/latency retune** (NOT built).
  The baseline measured the exact problem it targets: storyboard-plan ~16.9 min
  over 3 attempts, driven by *pacing/reading* and *moment-spacing* rejections
  (mechanically normalizable — reading-floor shift, moment top-up already exists
  partially). Highest-value remaining work for the Jul 13 latency target.
- **Phase 4 — contract manifest (`sentinel.ts`) + prompt-budget test +
  SENTINEL.md** (NOT built). The baseline author prompt was 105,516 chars (2.3×
  the 45k target); `test/promptBudget.test.ts` would enforce the ceiling. The
  closed-world finding-prefix CI test and the feature-addition protocol doc are
  the "airtight system + how to extend it" deliverable — still owed.
- **Phase 5 — flip defaults ON + full §7 probe set + Docker/Railway smoke** (NOT
  done). Flags remain default OFF; the legacy path is the shipping default.
- **Phase 2 full slot-scoped validation retry** — the cut-line shipped; the
  parallel per-scene re-request (the headline cost lever) is deferred (its
  attribution + assembly substrate are in place).

Probe artifacts (immutable):
- Baseline (flags OFF): `.data/projects/sentinel-baseline-denseui` — published,
  no fallback.
- Final (flags ON): `.data/projects/sentinel-final-denseui` — **failed loud**;
  `FAILURE.md` at `.data/projects/sentinel-final-denseui/FAILURE.md` (root cause
  + fix in "Final probe — honest failure" above).

---

## Auditor review + fixes (2026-07-05, Claude Fable)

Audit of the five Sentinel commits (`8e34aee`…`240c600`) against SENTINEL_PLAN.md,
the diff, and the persisted probe artifacts.

**Verdict:** Phase 0 PASS · Phase 1 PASS (both incident replays verified in the
suite; the staged-prompt-deletion and L2-runtime-block deviations are sound
calls) · Phase 2 cut-line met, and the reported flip-gate defect was real —
root-caused correctly from `attempts/author-1-static-rejected.html`. The report
was honest, with one stale contradiction (its closing line still said "no probe
failed loud" from the pre-probe commit — corrected above).

**Fixes applied by the auditor** (this commit):

1. **Slot stage floor + host-owned scene-window visibility** — the flip gate.
   `assembleSlotComposition` now injects `<style id="sequences-slot-stage">`
   (root sizing, `.scene{position:absolute;inset:0;opacity:0}`, `.clip`
   containment, overlay positioning) BEFORE the model's `film_style`, and emits
   host-owned `tl.set` reveal/clear pairs per scene AFTER the authored scene
   blocks (host wins insertion-order ties at window edges — an authored wrapper
   set can never leave a scene stuck hidden). Mirrors the proven
   `fallbackComposition.ts` convention. The slot prompt + continuation prompt
   now say the host owns stage + visibility (no wrapper opacity sets).
2. **`attributeFindingsToScenes` colon boundary.** Colon-delimited signatures —
   the exact shape of the live failure receipts
   (`component_root_missing:palette-ship:cmd-palette`) — previously fell into
   `__film__`; `:` joined the left token boundary.
3. **Skeleton overlay positioned inline.** The Phase-1 shell's
   `<div data-camera-overlay>` carried no style; copied verbatim it would sit in
   static flow and push the world plane. Now
   `style="position:absolute;inset:0;pointer-events:none"`.
4. **Tests hardened to prove the chassis, not the fixture.**
   `test/sceneSlots.browser.test.ts` now supplies NO structural CSS and NO
   wrapper visibility sets (the `sentinel-final-denseui` condition) and still
   passes the real gate (`validateDirectComposition` clean +
   `inspectDirectComposition` ok). `test/sceneSlots.test.ts` adds stage-floor /
   visibility-emission assertions and the colon-signature attribution case.

**Verification:** slack typecheck ✅ · full slack suite ✅ (all files, incl.
both slot tests + browser QA) · fix commit noted below.

**Remaining gate on flipping SLOTS on:** one paid probe (the §7.1 dense-UI
brief, `SENTINEL_SKELETON=1 SENTINEL_SLOTS=1`, fail-loud) must publish. The
stage-CSS root cause is fixed and browser-proven; the probe confirms it
end-to-end. A separate SKELETON-only probe isolates the two flags.

---

## Carryover A — the flip-gate probe, confirmed (2026-07-06, resumed session)

**Verdict: PASS.** The paid probe the auditor's fix was waiting on now
publishes clean. This unblocks Phase 3-5.

**Probe 1 — both flags on** (`SLACK_SEQUENCES_SENTINEL_SKELETON=1
SLACK_SEQUENCES_SENTINEL_SLOTS=1`, `SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK=0`,
fresh `--job-id sentinel-carryoverA-denseui`, the same §7.1 dense-UI shape as
`sentinel-final-denseui` — command-palette runs deploy, palette + modal +
stat-card + button + terminal):

- `sequence:check` → `"status": "pass"`, `authoringMode: "hyperframes-direct"`,
  `fallbackStage: null`, no `FAILURE.md` written.
- 19/19 moments bound, 10 thumbnails, MP4 rendered
  (`.data/projects/sentinel-carryoverA-denseui/renders/cursorflow-20260706-025452.mp4`).
- The Phase-2 slot path was exercised live: `[author] attempt 1/3 · prompt
  107428 chars · scene slots · deepseek/deepseek-v4-pro`. Unlike the prior
  `sentinel-final-denseui` run, **no scene rendered blank** — the host-owned
  stage `<style>` (`sequences-slot-stage`) and reveal/clear `tl.set` pairs from
  the auditor's fix positioned every scene correctly. Attempt 1 (slots) was
  rejected on ordinary browser-QA findings (`interaction_not_visible`,
  `layout_intent_missing`, one `near_blank_scene` warning — not the film-level
  `near_blank_film` hard error that killed the prior run), attempt 2 was a
  compact patch, attempt 3 forced a full re-author (per the existing
  "no browser-valid draft banked" escalation), then the critic applied 5
  repair directives and the film published. This is the *existing* Phase-2
  cut-line behavior (slot-scoped validation attribution, whole-doc retries)
  working as designed — not a new capability.
- `planning/sentinel-run.json`: `disposition: "published"`. `storyboard-plan`
  1,310,607ms (~21.8 min) over 4 attempts (primary rung exhausted on a
  transient OpenRouter timeout/empty-completion pair, not a normalizable
  content issue → rescue rung, 1 rejected + 1 accepted). `source-author`
  324,582ms (~5.4 min) over 3 attempts. `promptChars.maxAuthor: 107,428`
  (2.4× the 45k target — consistent with baseline's 105,516). Layer counts:
  normalize 26 (island-strip 8, interaction-binding 16, runtime-order 2),
  static 1, browser 2, model-retry 2, scaffold 0 (not separately telemetered
  — the skeleton fires unconditionally once the flag is on, ahead of the L2
  repair pass it replaces, so `sentinelTelemetry` doesn't yet carry a
  distinct scaffold counter; see Phase 4 Open items).

**Probe 2 — SKELETON only** (`SLACK_SEQUENCES_SENTINEL_SKELETON=1`, `SLOTS`
unset/OFF, fresh `--job-id sentinel-carryoverA-skeletononly-denseui`, same
brief): isolates whether the skeleton alone (without slot authoring) is
independently clean. **PASS** — `sequence:check` → `"status": "pass"`,
`authoringMode: "hyperframes-direct"`, `fallbackStage: null`, no `FAILURE.md`,
18/18 moments bound, MP4 rendered
(`.data/projects/sentinel-carryoverA-skeletononly-denseui/renders/cursorflow-20260706-031518.mp4`).
`planning/sentinel-run.json`: `disposition: "published"`, `skeletonEnabled:
true`, `slotsEnabled: false`. This run was **cleaner than the both-flags run**:
storyboard-plan succeeded in 3 primary attempts (742,188ms ≈ 12.4 min) with
**no rescue rung** (the both-flags run needed rescue only because of a
transient OpenRouter timeout/empty-completion pair on the primary rung, not a
content issue). Source-author 315,342ms (~5.3 min) over 3 attempts,
`promptChars.maxAuthor: 113,602`. Layer counts: normalize 23 (island-strip 10,
interaction-binding 11, runtime-order 2), static 2, browser 1, model-retry 2.
The authored draft carried a runtime-invalid optional interaction that was
quarantined (an author-quality issue independent of the scaffold), and the film
still published — the skeleton itself produced no binding failures.

**Conclusion (Carryover A: PASS).** The stage-CSS fix from the prior auditor
commit is confirmed end-to-end on the hardest §7 brief for **both** flag
combinations: SKELETON+SLOTS and SKELETON-alone each publish `hyperframes-direct`
with zero fallback. SLOTS is judge-ready. Both probes also re-confirm the plan's
diagnosis that Phases 1-2 do **not** move the two dominant costs: storyboard-plan
still runs 12–22 min and the author prompt is still 107–114k chars (2.4–2.5× the
45k target). Those are exactly what Phase 3 (storyboard latency) and Phase 4
(prompt-budget enforcement) target.

> **Caveat for the auditor:** both Carryover A probes were launched at the
> start of this session, i.e. against the code as of commit `0864c19` (the
> flip-gate fix), **before** the Phase 3 normalization/critic-gating code below
> was written. They therefore validate the flip gate, **not** Phase 3. Phase 3
> is validated by unit + integration tests, the full suite, and `film:demo`
> byte-stability — **not** by a paid probe (paid-probe validation of Phase 3 is
> part of the descoped Phase 5 probe set; see the Phase 3 section).

---

## Session 2 scope note (2026-07-06, Claude Opus 4.8)

This resumed session was **explicitly narrowed to Carryover A + Phase 3 only.**
Phases 4 and 5 are **NOT** done and are not started — they remain fully open per
the "Open items" list above. This section documents Phase 3 for audit; the
partial/deferred items inside Phase 3 are called out precisely so nothing reads
as more complete than it is.

## Phase 3 — storyboard normalization + critic gating

**Status:** the two **safe, deterministically-verifiable** levers landed and are
tested — (3.1) normalize-before-retry at the storyboard gate, and (3.4) critic
gating on already-clean drafts. The three levers that the plan itself makes
**contingent on paid-probe measurement** — (3.2) storyboard ladder 3→2, (3.3)
`REASONING_STORYBOARD_MAX_TOKENS` 30,720→20,480, (3.5) one-slot-retry-before-
least-bad — are **deliberately deferred** because their validation belongs to
the descoped Phase 5 probe set. Rationale per item below. Full suite green
(**507/507**, up from 493), `film:demo` byte-stable.

### 3.1 Normalize-before-retry at the storyboard gate — LANDED

The Sentinel decision rule (SENTINEL_PLAN §3 Phase 3.1): a fix that
**deletes / degrades / retimes without inventing content** ⇒ normalize
deterministically and log it; a **creative deficit** ⇒ still goes back to the
model. Two new deterministic normalizers implement exactly that, run in
`parseStoryboardResponse` **before** `validateStoryboardPlan` (so the arithmetic
the host can already do never burns a paid storyboard retry):

- **`normalizeCameraBudget`** (`src/engine/pacingAudit.ts`) — clamps camera-move
  counts to `auditPacing`'s own ceilings. (a) Per-scene: drops the lowest-energy
  extra full moves down to `1 + floor(durationSec / CAMERA_BUDGET_WINDOW_SEC)`;
  a dropped move leaves a gap the camera resolver already auto-fills with a
  drift, which is the finding's own suggested fix. (b) Film-wide: keeps the
  earliest `MAX_WHIPS_PER_FILM` (=2) whips chronologically and drops the rest
  ("drop the 3rd+ whip"). Energy rank mirrors `auditCameraEnergy`'s own
  high-energy test (whip/orbit, or a push/pull committing to
  `HIGH_ENERGY_PUSH_ZOOM`), so a clamp never sacrifices the film's one required
  peak. A clamp that would empty a scene's path drops `camera` entirely (never
  a `{ path: [] }`), matching the contract's degrade-never-veto philosophy.
- **`stretchMarginalPacingMisses`** (`src/engine/pacingAudit.ts`) — closes a
  **marginal** `pacing/reading` or `pacing/outcome` shortfall
  (≤ `MAX_PACING_STRETCH_SEC` = 1.0s) by extending the scene's own cut boundary
  by the shortfall and cascade-shifting every later scene's absolute times by
  the same delta. Only shortfalls constrained by the scene's **own end** (not an
  internal camera move already in flight) are stretched — an internal-move
  conflict is a creative layout call left to the model. Scenes inside a declared
  (resolvable) `timeRamp` hold are skipped, because a raw content-time stretch
  there would not deliver the viewer-time hold the finding demands. Detection
  runs in each scene's original (unshifted) time frame — where the resolved
  beats live — and the cumulative shift is applied only when emitting the output
  scene; a uniform later shift preserves every within-scene distance, so
  detection is shift-invariant (this was a real bug caught in review: an earlier
  draft compared shifted `sceneEnd` against unshifted beat times).

Both are wired at `compositionRunner.ts` `parseStoryboardResponse`, camera
budget first (it changes which beats even reach the reading/outcome checks),
then the stretch. Every normalization is logged to stderr as
`[storyboard] sentinel-normalized: …` and recorded in telemetry via `recordSentinelNormalization("camera-budget-clamp")`
/ `("pacing-stretch")` — two new normalization tags on the existing
`sentinelTelemetry` counter.

**Small supporting export:** `cameraContract.ts` now exports
`HIGH_ENERGY_PUSH_ZOOM` and a `cameraMoveZoom(move)` helper (declared-else-default
zoom) so the energy-rank logic shares one source of truth with `auditCameraEnergy`
rather than duplicating the constant.

**Why this is safe to ship default-on (no flag):** it can only *delete a move* or
*extend a cut by <1s* — it never authors content, never relaxes a gate (the gates
run unchanged on the normalized plan), and the model retains all creative
authority (a genuine over-density or a >1s deficit still goes back as a finding).
It is the exact "host owns the arithmetic" move the plan sanctions at L2.

### 3.4 Critic gating on already-clean drafts — LANDED (kill-switch, default on)

`applyContinuityCritique` (`compositionRunner.ts`) now skips the continuity
critic when the draft is already pristine, via the exported pure predicate
**`criticSkippableCleanDraft(browserQa)`**: a browser-QA pass ran (not an infra
outage) **and** it is `strictOk` (no polish finding requested a repair) **and**
`browserQualityPenalty(browserQa) === 0` (no weighted issue, no `browser_warning:`
console warning). Every declared moment is necessarily bound too — an unbound
moment fails `validateDirectComposition` upstream, so any draft reaching the
critic has already cleared the moment contract; the predicate does not need to
re-check it. This saves the critic's 1–2 paid calls (~1–2 min) on a good run.
Conservative by construction: anything less than pristine still runs the critic —
which is exactly the draft the critic exists to improve.

Kill switch `SLACK_SEQUENCES_CRITIC_SKIP_CLEAN=0` restores always-run;
`SLACK_SEQUENCES_CREATIVE_CRITIC=0` semantics are unchanged (still disables the
critic entirely).

**Honest limitation:** default-on is a genuine behavior change to the live model
path, and it is **not** paid-probe-validated this session (the golden `film:demo`
is model-free and never exercises the critic, so it cannot validate this lever).
The predicate is unit-tested and the gate is maximally conservative and instantly
revertable via the kill switch. An auditor who wants zero unvalidated live-path
change can set `SLACK_SEQUENCES_CRITIC_SKIP_CLEAN=0` until a Phase-5 probe
confirms no quality regression; I judged default-on correct because the plan
lists it as a sanctioned cost lever and the gate only fires on a draft every
deterministic gate already passed.

### Deferred within Phase 3 (require paid-probe measurement — Phase 5 scope)

These three are **not** implemented. Each is deferred because the plan itself
conditions it on probe evidence this session cannot produce (paid probes are
Phase 5, descoped), and each **reduces a safety/quality margin** if shipped blind:

- **3.2 Storyboard ladder 3→2** (`compositionRunner.ts:4640`, `maxAttempts: 3`).
  The plan gates this on "(only after 1 lands)" **and** probe confirmation that
  normalization absorbs the arithmetic rejections. Dropping a primary rung
  reduces resilience to transient provider faults — and the both-flags Carryover
  A probe exhausted its primary rung on exactly such transient faults
  (timeout + empty completion), then recovered via the rescue rung. Cutting the
  rung blind would have made that run *more* likely to fail loud, not less. Left
  at 3.
- **3.3 `REASONING_STORYBOARD_MAX_TOKENS` 30,720→20,480**
  (`compositionRunner.ts:144`). The plan is explicit: "**only if** probe
  storyboards stay clean at 2 rungs … Measure, don't guess — keep it if quality
  moves." With no A/B probe, a blind drop risks truncating a good long think
  into a worse plan. Left at 30,720.
- **3.5 One-slot-retry-before-least-bad shipping policy.** This needs a *new*
  single-scene slot-retry entry point (none exists — Phase 2 shipped attribution
  only, per its own report) that issues a *new paid model call*, and it only
  fires on the SLOTS path, which defaults OFF and whose default-flip is the
  descoped Phase 5. Building an unvalidated new paid-call path that is dormant in
  the shipping default has low value and real audit risk. The substrate it would
  reuse (`authorSlotDraft`, `attributeFindingsToScenes`, `assembleSlotComposition`)
  is in place from Phase 2; the retry entry point is the remaining work.

### Flags added (Phase 3)

`SLACK_SEQUENCES_CRITIC_SKIP_CLEAN` (default ON; `=0` restores always-run the
critic). No other flags. `SENTINEL_SKELETON` / `SENTINEL_SLOTS` unchanged
(still default OFF — the Phase 5 default-flip is descoped).

### Tests added (names)

- **`test/pacingAudit.test.ts`** (+7): describe **"Sentinel Phase 3 —
  normalizeCameraBudget"** (drops lowest-energy extra keeping the peak; no-op
  when within budget; drops camera entirely rather than an empty path; caps
  whips at 2 keeping the earliest) and **"Sentinel Phase 3 —
  stretchMarginalPacingMisses"** (stretches a boundary reading miss + cascade
  shift; never stretches beyond `MAX_PACING_STRETCH_SEC` — a larger deficit
  stays a real finding; never touches a scene inside a resolvable `timeRamp`
  hold, with a precondition assert that the ramp actually resolves).
- **`test/directComposition.test.ts`** (+7): describe **"Sentinel Phase 3 —
  storyboard normalization is wired into parseStoryboardResponse"** (an
  over-budget camera scene is clamped and parses instead of throwing
  `pacing/camera-budget`; a marginal boundary reading miss is stretched and the
  later scene shifts to stay contiguous) and **"Sentinel Phase 3 —
  criticSkippableCleanDraft"** (skips on a pristine draft; runs when not
  strictOk / when a weighted issue is present / when a `browser_warning:` is
  present / when browser QA did not execute or is absent).

### Commands run (Phase 3)

- `npm run typecheck --workspace @sequences/slack` — ✅ exit 0.
- `npm run test --workspace @sequences/slack` — ✅ **507/507** across 42 files
  (up from 493; +14 new tests, all browser gates included).
- `npm run film:demo --workspace @sequences/slack` — ✅ byte-stable
  (`lint: clean · 3 static warning(s) · 48 samples · 6 warning(s)` — identical
  signature to the pre-Phase-3 baseline; the model-free golden path never
  reaches `parseStoryboardResponse` or the critic, so it is unaffected).
- **No paid probe** exercised the Phase 3 code — see the acceptance caveat.

### Acceptance verdict (Phase 3)

**PARTIAL — the safe levers landed and are green; the measurement-gated levers
are deferred.** The plan's Phase 3 acceptance ("probe-set storyboard attempts
avg ≤1.5; no quality regression on the golden film; report shows normalization
log lines instead of retries") is met only in the parts a non-probe session can
prove: `film:demo` shows **no golden-film regression** (byte-stable), and the
normalization emits `sentinel-normalized:` log lines + telemetry tags instead of
retries (proven by unit + integration tests). The **"storyboard attempts avg
≤1.5"** clause requires the descoped paid probe set and is **not** demonstrated;
it is the first thing to run when Phase 3 validation resumes (a clean-plan probe
should now show `sentinel-normalized:` lines where the Carryover A runs showed
`pacing/*` retries — e.g. the both-flags run's attempt-1 rejection carried a
`pacing/outcome` finding my stretch pass now absorbs, though that same attempt
also carried a non-normalizable `terminal-open` component-kind error, so it
would not have been saved outright).

### Prompt diff (Phase 3)

`prompts/planning-director.md` is **unchanged** (37,010 bytes / 624 lines — the
post-Phase-1 count). Phase 3 adds no prose and deletes none; prompt shrinkage is
Phase 5's job (descoped). The assembled author prompt is still ~107–114k chars
(measured in both Carryover A probes) — the ≤45k enforcement is Phase 4's
`test/promptBudget.test.ts` (descoped).

---

## Auditor review — Phase 3 (2026-07-05)

Audited `dc8c591` (everything after `0864c19`) against SENTINEL_PLAN §3
Phase 3 and the landmine list; three real bugs found and fixed in the audit
commit. All fixes are in the deterministic parse path — no gate loosened, no
threshold moved, no prompt changed.

### Verdict per plan item

1. **3.1 normalize-before-retry — LANDED, with three audit fixes (below).**
   The two normalizers are the right shape (delete/degrade/retime only, never
   invent), energy rank correctly mirrors `auditCameraEnergy` so a per-scene
   clamp can never delete a scene's only peak, the stretch correctly skips
   ramped scenes and is safe in content time elsewhere (ramps are net-zero, so
   viewer time ≡ content time outside them), and the plan's "merge the serial
   pan+push-in pair" clause was **already satisfied before Phase 3**:
   `parseCamera` applies `mergeCompoundMoves` at parse, and `auditPacing`
   counts the merged path (its own comment says so). Verified, not new work.
2. **3.2 ladder 3→2 — DEFERRED, correctly.** Rungs unchanged (`maxAttempts: 3`),
   so the `pacing/*`/`components/exit`/`cuts/coherence` late-attempt demotion
   boundary and all attempt accounting are untouched — the landmine class
   cannot fire. The deferral matches the plan's own gating ("only after 1
   lands", probe-confirmed) and the probe evidence (the both-flags Carryover A
   run survived only because the primary rung absorbed two transient provider
   faults).
3. **3.3 token budget — DEFERRED, correctly.** `REASONING_STORYBOARD_MAX_TOKENS`
   still 30,720; the plan explicitly names keeping it a valid outcome.
4. **3.4 critic gating — CORRECT as landed.** The predicate is measured on the
   result actually being shipped: `applyContinuityCritique` runs after the
   author loop and after `applyShapeMatchUpgrade`, so `result.browserQa` is
   the post-repair, post-upgrade QA of the banked draft — not attempt-1 state.
   The revision path cannot be affected (`revisionInstruction` returns before
   the new check). `SLACK_SEQUENCES_CREATIVE_CRITIC=0` still short-circuits
   first. One recommendation, not fixed: the predicate ignores static-repair
   warnings (which the least-bad pick does weight via
   `browserQualityPenalty`'s second argument); a draft that needed static
   repairs but measures pristine will skip the critic. Plumbing those
   warnings to the critique seam is a small follow-up if a probe ever shows a
   repaired-but-pristine draft that the critic would have improved.
5. **3.5 slot-retry-before-least-bad — DEFERRED, correctly** (no slot-retry
   entry point exists; SLOTS defaults OFF; Phase-5 scope). Deferral rationale
   in the implementer's section is accurate.

### Bugs found and fixed (audit commit)

1. **Normalization was not atomic (the biggest landmine, confirmed).** Both
   normalizers committed unconditionally before validation, so a fix for the
   pacing arithmetic could mint a NEW blocking finding the model never earned:
   dropping moves can violate the framing-density floor,
   `requirements.minCameraMoves`, `requireMultiStationWorld`, or
   `requireRackFocus`; the stretch can push a film past the 60s cap or open a
   moment-spacing gap past `MAX_MOMENT_INTERVAL_SEC`. Worst case was a LATE
   attempt: a plan clean-except-pacing that would have shipped under the
   polish demotion could instead die on a normalization-minted finding — a
   regression of exactly the `improve-ws32-1` class. **Fix:**
   `parseStoryboardResponse` now commits the normalized plan only when it
   validates clean (after the late-attempt demotion filter); otherwise it
   logs `sentinel-normalization reverted`, restores the model's own artifact,
   and re-validates that — the `degradeVolunteeredBridgedCuts`
   commit-only-if-clean precedent. Telemetry now records only committed
   normalizations. Regression test: a clamp that would violate
   `minCameraMoves: 3` reverts and throws the model's own
   `pacing/camera-budget` finding (`directComposition.test.ts`).
2. **Normalizers ran AFTER `topUpStoryboardMoments`, and could drop
   moment-bearing moves.** Top-up anchors host-added moments on camera
   arrivals; the clamp could then delete the anchoring move (and a
   model-declared moment could equally anchor on a dropped move) — the plan
   validates clean but publication-time evidence binding fails, burning paid
   author attempts (primary moments) or silently re-anchoring (supporting).
   **Fix:** normalizers now run before top-up (top-up anchors only on
   surviving moves and post-stretch times), and `normalizeCameraBudget` got a
   load-bearing guard: a move whose window overlaps any declared moment's
   evidence-search window (`EVIDENCE_BEFORE_SEC`/`EVIDENCE_AFTER_SEC`, now
   exported from `storyboardMoments.ts`) is never dropped — if the budget
   cannot be met without one, the scene keeps its blocking finding (same rule
   as `degradeUnsupportedComponentBeats`' load-bearing beats). Three new
   tests in `pacingAudit.test.ts` prove both directions.
3. **The plan's "keep every normalization visible in STORYBOARD.md" was
   unmet**, and this report claimed it was met ("visible in STORYBOARD.md /
   the run log" — normalizations only went to stderr + telemetry; stderr is
   not STORYBOARD.md). **Fix:** `DirectScene` gains host-only
   `sentinelNormalizations?: string[]` (never model-parseable), the
   normalizers annotate each affected scene, `storyboardMarkdown` renders
   `- Sentinel normalized: …` lines, and the author-prompt serialization
   strips the field (operator paperwork, not authoring instructions). The
   false report sentence above has been corrected in place.

### Landmine checklist

- **Storyboard cache contract v10 — deliberately NOT bumped; here is why that
  is sound.** `validateStoryboardPlan` semantics are unchanged; cached
  artifacts are post-parse plans re-validated on read; and the normalizers
  only mutate plans that FAIL validation — which are never cached. A stale
  v10 plan therefore cannot replay under different semantics. (The additive
  `sentinelNormalizations` field is optional and absent from old artifacts,
  which is correct — they were never normalized.) If a future change makes
  normalization fire on validation-clean plans, bump then.
- **QA_CACHE_VERSION 8 — correctly unchanged** (no browser-QA sampling change
  in this diff).
- **Nested-time integrity — sound.** `withShiftedSceneTimes` shifts
  beat/camera/interaction/moment/ramp times with their scene (the v10 lesson
  applied); detection runs pre-shift where the resolved beats live; ramped
  scenes are excluded; viewer-time equivalence holds for non-ramped scenes
  because ramps are net-zero inside their shot.
- **Sanctioned levers — clean.** The full `0864c19..dc8c591` diff contains no
  threshold drift in `pacingAudit.ts`/`layoutInspector.ts`/`eyeTrace.ts`
  (additions only), an export-only change in `cameraContract.ts`, and no
  prompt edits.
- **Telemetry — plumbing verified** (`recordSentinelNormalization` →
  `sentinel-run.json` `normalizations` + `layers.normalize`); no live probe
  has exercised the Phase-3 tags yet, as the implementer's caveat honestly
  states. The two Carryover A `sentinel-run.json` files show only
  pre-existing tags (island-strip / interaction-binding / runtime-order),
  consistent with those probes predating Phase 3.

### Carryover A claims — verified against artifacts

Both immutable job dirs inspected (no re-probe needed):
`sentinel-run.json` disposition `published` in both; storyboard-plan 4
attempts / 1,310,607ms and 3 attempts / 742,188ms; `promptChars.maxAuthor`
107,428 and 113,602; layer counts exactly as reported; MP4s present;
`planning/attempts/` corroborates the narrative (both-flags storyboard
attempt 1 rejected with the `terminal-open` support error **plus** the
`pacing/outcome` finding the acceptance verdict cites; author attempts
browser-rejected → patch static-rejected → full). STORYBOARD.md moment rows:
**19 bound / 0 unbound** and **18 bound / 0 unbound** — matching "19/19,
18/18". No FAILURE.md in either dir.

### Verification (audit commit)

- `npm run typecheck --workspace @sequences/slack` — ✅.
- `npm run test --workspace @sequences/slack` — **511 tests** (507 + 4 new:
  3 load-bearing-guard tests, 1 atomic-revert test; plus annotation
  assertions added to existing tests). One flake on the first full run:
  `perfPipeline.test.ts` "browser QA cache" timed out at its 40s ceiling
  under parallel suite load and **passed in isolation at 33.5s** — a
  pre-existing timing margin, unrelated to this diff.
- `npm run film:demo` — signature identical to baseline
  (`lint: clean · 3 static warning(s) · browser QA: 48 samples · 6 warning(s)`).
  The model-free golden path never reaches `parseStoryboardResponse`.
- No paid probe run (artifact inspection sufficed; Phase-3 live validation
  remains the first Phase-5 probe's job, unchanged).

### Go/no-go for Phase 4/5

**GO.** Phase 3's landed levers are now atomic, ordered correctly, visible in
STORYBOARD.md, and telemetered; the deferred levers are cleanly deferred with
their preconditions written down. Phase 4 (contract registry + prompt budget +
SENTINEL.md) can proceed on this base; Phase 5's first probe should confirm
the `sentinel-normalized:*` tags appear in a live `sentinel-run.json` and that
storyboard attempts drop toward the ≤1.5 target before any ladder/token
retune.

---

## Session 3 scope note (2026-07-06, Claude Opus 4.8)

This session implements **Phase 4 in full** and takes **Phase 5 to its budget
gate**. Phase 4 is code + docs + tests complete and green. Phase 5's paid probes
are gated on OpenRouter credit and operator sign-off (probes cost real money);
that gate is documented in the Phase 5 section below. Nothing in this session
loosens a gate, raises an attempt rung, or flips a default — the
`SENTINEL_SKELETON`/`SENTINEL_SLOTS` defaults remain OFF pending the probe set.

## Phase 4 — the contract manifest + the ruleset

**Status:** COMPLETE. All five plan items landed; typecheck clean, full suite
green in isolation (525 tests, +14 new), `film:demo` byte-stable.

### What changed (files + why)

1. **`src/engine/sentinel.ts`** (new) — the typed contract registry. One
   `SentinelContractRow` per obligation × layer (`id`, `group`, `layer`,
   `blocking`, `findingPrefixes`, `promptCostChars`, `test`, `addedBecause`),
   ordered cheapest-ownership-first (scaffold → normalize → static → browser).
   Covers all fourteen umbrella obligations the plan names (cuts, camera,
   components, interactions, pacing, moments, liveness, eye-trace, exits,
   coherence, layout, markup-audit, runtime, frame) plus the two Phase-3
   normalize levers. The two scaffold rows (`camera.world-plane`,
   `components.root`) list their L3/L4 backstop codes so the closed-world test is
   green with the skeleton flag in EITHER position; the four normalize rows carry
   no `findingPrefixes` because they PREVENT another row's findings. The
   `camera-budget-clamp` / `pacing-stretch` rows spell out the atomic
   commit-or-revert and load-bearing-move guard in `addedBecause`, matching the
   code as the Phase-3 audit left it. The module is pure data + pure helpers
   (`allRegisteredFindingPrefixes`, `isRegisteredFinding`, `extractFindingCodes`,
   `FINDING_SOURCE_FILES`, `NON_FINDING_LITERALS`) — it imports no runtime engine
   code, so the manifest can never itself break a build.
2. **`test/sentinel.test.ts`** (new, 10 tests) — the closed-world guarantee.
   `extractFindingCodes` matches a finding-shaped token that sits immediately
   after an opening quote/backtick and is followed by `:` or the closing
   delimiter (a targeted wrapped-token match, NOT a full string tokenizer — a
   naive scanner desyncs on apostrophes in comments/prose and silently swallows
   real literals; this was a real bug caught in iteration). The suite asserts:
   every emitted finding code across the 14 finding-source files is registered
   (forward closed-world); every registered prefix is actually emitted (no dead
   rows); a negative control proves the mechanism rejects an unregistered code;
   `NON_FINDING_LITERALS` masks nothing registered; unique ids; valid
   layers/dispositions; every row names a real test file; empty `findingPrefixes`
   only on `deterministic-repair` rows; all fourteen obligation groups present.
3. **`test/promptBudget.test.ts`** (new, 4 tests incl. 1 `.todo`) — the prompt
   ceiling. `planning-director.md ≤ 40,711 bytes` (37,010 + 10%) is ENFORCED and
   passing (currently 37,010). The assembled author prompt for a fixture job is
   built through the REAL assembler (`creationPrompt`, now exported) with a
   deterministic fallback storyboard + `create` RAG context; it measures **81,099
   chars** (`slots: true`). The **≤ 45,000 target is marked `it.todo`** with a
   written reduction plan (SENTINEL.md "Prompt budget") because it is structurally
   unreachable this phase — a `proves the structural floor` test documents in code
   that the base director prompt (~37k) + `create` RAG budget (28k) already exceed
   45k. A clearly-labeled anti-growth regression guard holds the assembled prompt
   at ≤ 88,000 (headroom over the 81k fixture, NOT the target) so the ceiling was
   not silently raised.
4. **`src/engine/sentinelTelemetry.ts` + `compositionRunner.ts`** — the L1
   scaffold counter (Phase 4 item 5 carryover). `recordSentinelScaffold` records
   the count of host-guaranteed bindings (camera planes + stations + component
   roots) the skeleton/slots path makes unrepresentable, idempotent-by-max so
   re-emitting on a retry doesn't inflate; `countScaffoldedBindings` computes it
   and `creationPrompt` records it once when `slots || sentinelSkeletonEnabled()`.
   Before this, L1 read 0 in the Carryover A telemetry even with the skeleton
   active. `creationPrompt` is now `export`ed (for the budget test).
5. **`SENTINEL.md`** (new, beside FALLBACKS.md) — the auditable system doc: the
   layer model, the placement decision tree, the feature-addition protocol
   (verbatim from plan §3 Phase 4 item 4), the contract table (hand-synced with
   `sentinel.ts`, guarded by the closed-world test), the budgets (attempt ladders,
   token/char budgets, the prompt-budget reduction plan, wall-clock targets), the
   telemetry files + scaffold counter, and EVERY Sentinel flag
   (`SENTINEL_SKELETON`, `SENTINEL_SLOTS`, `CRITIC_SKIP_CLEAN`) plus the existing
   kill-switch family it joins.
6. **Doc pointers** — FALLBACKS.md gets the "new classes go through SENTINEL.md
   placement first; this catalog is the L2 ledger, not the default" pointer (top +
   footer); `apps/slack/CLAUDE.md` gains a Sentinel section + deep-docs link;
   the `.claude/skills/slack-map` skill gains a Sentinel section (local-only per
   the gitignore/publish rule); ROADMAP.md logs the whole rework (Phases 0-5) in
   the dated WS style.

### Deviations from the plan

- **`promptCostChars` is hand-estimated, advisory, not asserted.** Computing the
  exact prompt-prose cost per obligation is not mechanized this phase; the values
  are the pre-shrink estimates and are documented as such in `sentinel.ts`. They
  are informational (they inform the reduction plan), not a test gate.
- **The registry is one row per (obligation × layer), not one per umbrella.** The
  plan lists 14 umbrella obligations; several are enforced at more than one layer
  (camera at scaffold+static+browser, components at scaffold+static, moments/exits
  at static+browser). Modeling each as a single-layer row keeps the `layer` field
  honest (the §2 rule: "every obligation lives at exactly one layer") and the
  `group` field carries the umbrella. Net ~23 rows.
- **No prompt prose was deleted this phase.** The only sanctioned deletions
  (scaffold-redundant prose) require the skeleton to be default-ON, which is the
  Phase-5 flip; deleting them now (flag default OFF, bare shells) would degrade the
  shipping default. Deferred to the flip, where the reduction plan's item 1 lands.
  This is why the ≤45k target is a `.todo`, not a shrink — see SENTINEL.md.

### Flags added

None. Phase 4 is registry + tests + docs; it adds no runtime behavior flag.

### Tests added (names)

- `test/sentinel.test.ts` — 10 tests (closed-world coverage + structural
  invariants). Run: `npx vitest run --root ../.. apps/slack/test/sentinel.test.ts`.
- `test/promptBudget.test.ts` — 4 tests (3 pass + 1 `.todo`).

### Commands run

- `npm run typecheck --workspace @sequences/slack` — ✅ exit 0.
- `npm run test --workspace @sequences/slack` — parallel run shows **519 passed /
  1 todo** and 5 browser-file timeouts under parallel Chrome contention
  (componentRuntime.browser, fallbackComposition, layoutInspector, perfPipeline,
  and one diagnostics browser-service check). **All five pass in isolation**
  (`--no-file-parallelism`): the 4 browser files → 25/25 passed; diagnostics
  passed on a lighter run. This is the documented "known timeout flake under load,
  passes in isolation" class, not a regression. Real suite total: **525 tests**
  (511 + 14 new).
- `npm run film:demo --workspace @sequences/slack` — ✅ byte-stable
  (`lint: clean · 3 static warning(s) · browser QA: 48 samples · 6 warning(s)` —
  identical signature; the model-free golden path shares none of the changed code).

### Acceptance verdict (Phase 4)

**PASS.** The contract registry exists and is load-bearing (an unregistered
finding class fails CI, proven by the negative control and by the `eye_trace`
iteration). The prompt-budget test enforces `planning-director.md` and tracks the
≤45k target honestly as a `.todo` with a written, non-ceiling-raising plan. The L1
scaffold counter closes the probe-report carryover. SENTINEL.md is the auditable
"airtight system + how to extend it," and FALLBACKS.md/CLAUDE.md/slack-map/ROADMAP
point at it.

---

## Phase 5 — budget gate (BLOCKED on credit / operator sign-off)

**Status: BLOCKED at the very first Phase-5 step (the mandated budget check).**
No paid probe was run this session.

### Budget check (2026-07-06)

Queried OpenRouter with the `apps/slack/.env` key (value not exposed):

- `GET /api/v1/credits` → `{"total_credits": 35, "total_usage": 32.47}` ⇒
  **≈ $2.53 of account credit remaining.**
- `GET /api/v1/key` → `limit: null` (the per-key cap that produced the
  2026-07-06 "403 key limit exceeded" is gone), `usage: 23.20`,
  `usage_daily: 1.10`, `usage_monthly: 20.57`.

### Why this blocks the §7 probe set

The §7 canonical set is 3 dense briefs, flags ON, fail-loud, plus a revise+undo
probe. The Carryover A artifacts show a single dense probe running storyboard-plan
**12–22 min over 3–4 reasoning attempts** (30,720-token thinks) + source-author
~5 min + critic. Three such runs with retries — and DeepSeek-v4-pro + GLM
storyboard + rescue models — would very likely exceed $2.53, and a probe that runs
out of credit mid-run leaves an **immutable half-baked job dir** (dirs are
immutable per the plan) and wasted spend. Spending the last of the credit on a set
that cannot complete is not a responsible use of the operator's money.

### What is consequently deferred (all probe-gated by the plan)

- The §7 probe set (Phase 5.2) — the live acceptance of Phases 1-3.
- The deferred Phase-3 levers (3.2 ladder 3→2, 3.3 token 30,720→20,480, 3.5
  one-slot-retry-before-least-bad) — each is explicitly gated on probe evidence.
- One revise + one undo on a probe job (Phase 5.4).
- The default flip (Phase 5.5) — sanctioned only after the probes publish clean.
- The ship ladder + `railway up` (Phase 5.6) — outward-facing, operator-gated.

### Recommendation

Top up the OpenRouter account (even $10–15 comfortably covers the 3-brief set +
revise/undo with headroom), then resume at Phase 5.2. Until then the shipping
default is unchanged and healthy (`SENTINEL_SKELETON`/`SENTINEL_SLOTS` default OFF;
Carryover A already proved BOTH flag combinations publish clean on the hardest §7
brief), so nothing regresses by waiting. Phase 4 is independently complete and
green and can be committed/published now as a checkpoint if desired (docs +
registry + tests only — no runtime behavior change, no default flipped).
