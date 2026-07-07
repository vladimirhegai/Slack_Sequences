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
  (thumbnails exist) and tier-2 (MP4 exists) wall-clock, attaches the stage
  receipts, and finalizes the disposition — including `fail-loud` on both throw
  paths. Reuses the existing `stages`/`performance.now()` timings; **ETA
  behavior (`stageTimings.ts`) is untouched.**
- **`scripts/sentinelReport.ts` + `npm run sentinel:report`** (new) — aggregates
  every `sentinel-run.json` (+ sibling `author-run.json`) under a directory into
  the mission metric table (markdown or `--json`), with a `--label` for
  before/after captures and a per-run detail table.

### Deviations from the plan

- **Tier wall-clock basis.** Tier 1 is stamped inside `buildPreviews` only after
  thumbnails exist; tier 2 only after the MP4 exists. Both use elapsed time from
  the Sentinel run start. Historical artifacts created before this correction
  may retain the earlier authoring→submit tier-1 interpretation.
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

## Phase 5 — probes run; flip/deploy paused for operator sign-off

**Status (updated):** the budget gate below was resolved — the operator topped up
OpenRouter to $7.53 and authorized the §7 set. **Five probes ran** (all flags ON,
fail-loud ON, fresh immutable job-ids); results + analysis in "Phase 5 — probe
results" further below. Headline: the Sentinel source-author flags are validated
where briefs reach source-author (dense-UI publishes clean, scaffold telemetry +
Phase-3 atomic revert both confirmed live), but **4 of 5 fresh briefs fail-loud at
the storyboard stage**, which is **provably flag-independent** and outside
Sentinel's scope. The default flip and `railway up` are **paused for operator
decision** (the plan's "confirm before railway up if anything looks marginal").
The deferred Phase-3 levers are **probe-confirmed to stay deferred**.

### Budget check (2026-07-06) — resolved

Original reading (pre-top-up):

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

> **RESOLVED:** the operator topped up to $7.53 and chose "run §7"; Phase 4 was
> committed (`555ba67`) and published to `Slack_Sequences/main`. All five probes
> together cost **$1.45** (~$0.29 each) — the models are cheap; budget was never
> the real constraint. Results below.

## Phase 5 — probe results (2026-07-06)

Five probes, all `sequence:check --no-mcp --provider openrouter-api`, flags
**`SENTINEL_SKELETON=1 SENTINEL_SLOTS=1`**, **`ALLOW_DETERMINISTIC_FALLBACK=0`**
(fail-loud), fresh immutable `--job-id` each. The three original §7 briefs were
written to FORCE the hard shapes the plan names; two of them
(camera-heavy, long-copy+timeRamp) fail-loud at the storyboard stage on the exact
hard-required features they forced, so two achievable re-briefs (2b, 3b) were run
to test what the flags actually change (source authoring).

| # | Job id | Brief shape | Disposition | Storyboard | Source | maxAuthor | scaffold(L1) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `sentinel-p5-denseui` | §7.1 dense-UI (palette+modal+stat+button+terminal) | **published** ✅ | 5 att / 7.2 min | 3 att / 4.2 min | 100,795 | **12** |
| 2 | `sentinel-p5-camera` | §7.2 camera-heavy, forced multi-station+morph | **fail-loud** | 6 att / 9.8 min | — | 0 | 0 |
| 3 | `sentinel-p5-longcopy` | §7.3 long-copy + 2 cursors + forced timeRamp | **fail-loud** | 5 att / 13 min | — | 0 | 0 |
| 2b | `sentinel-p5-camera-b` | camera moves + morph, single world (achievable) | **fail-loud** | 5 att / 28.7 min | — | 0 | 0 |
| 3b | `sentinel-p5-interactions` | inbox walkthrough, 2 cursors, no camera/ramp | **fail-loud** | 5 att / 25.5 min | — | 0 | 0 |

Immutable project dirs under `.data/projects/<job-id>/`; each fail-loud carries a
`FAILURE.md` + persisted `planning/attempts/`.

### What the ONE success (Probe 1) confirms live

- **The Sentinel source-author flags publish clean on the hardest source-author
  brief.** `disposition: published`, `authoringMode: hyperframes-direct`,
  `fallbackStage: null`, 11/11 moments bound, 10 thumbnails, both flags exercised
  (`skeletonEnabled: true`, `slotsEnabled: true`, slot path ran). Consistent with
  the three prior Carryover A dense-UI runs. `fullCameraMoves: 5` — the camera
  world skeleton (plane + stations, the incident-1 fix) was exercised and
  published.
- **The new L1 scaffold counter works:** `scaffold: 12` (host-guaranteed
  bindings), where Carryover A read 0. Phase 4 item 5 delivered.
- **The Phase-3 atomic commit-or-revert is validated in production.** Probe 1's
  log shows `sentinel-normalization reverted (normalized plan still fails
  validation: storyboard/moments …)` firing repeatedly and correctly — the
  pacing-stretch normalizer never masked a co-occurring `storyboard/moments`
  block. This is the audit-hardened behavior (SENTINEL_REPORT "Auditor review —
  Phase 3", bug #1) proven live, not just in unit tests.
- Costs the plan targets are unmoved by Phases 1-3 (as predicted): storyboard 5
  attempts / 7.2 min, tier-1 ≈ 11.8 min, `maxAuthor 100,795` (2.2× the 45k
  target). These are the Phase-4 prompt-budget and (future) storyboard-latency
  targets, not something Phases 1-3 claimed to move.

### The dominant finding: storyboard-stage fragility (flag-independent)

Four of five fresh briefs fail-loud at `storyboard-plan`, never reaching source
authoring. The rejections are legitimate contract violations the planner models
(`z-ai/glm-5.2` primary, `tencent/hy3-preview` rescue) repeatedly commit:

- **`storyboard/moments` dead-intervals / clustering** — every probe. A gap with
  no typed beat/camera/cut to anchor a moment on; `topUpStoryboardMoments`
  correctly won't invent one (that would be fabricating content, per the Phase-3
  decision rule), so it is a genuine "no development" veto back to the model.
- **Hard-required contract features the models can't build to spec** —
  `requireMultiStationWorld` ("at least one shot must travel through multiple
  stations with 2+ typed camera moves", fired on BOTH camera briefs including the
  gentle one) and the `timeRamp` motivation/solvability contract (Probe 3).
- **Component-kind/beat mismatches** — `type` on an `app-window` (Probe 3b), morph
  to an undeclared twin (Probe 2b) — instruction-following errors.
- **Framing-density floor** (Probe 3b: 6 < 8 framings for 28s) and
  **`cuts/coherence`** style-zoo (Probe 3).

**This is provably flag-independent** (a code fact, not just a probe inference):
`grep` confirms `sentinelSkeletonEnabled`/`sentinelSlotsEnabled` are read ONLY in
the source-author path (`creationPrompt`, the `useSlots` author-loop decision at
`compositionRunner.ts:6482`, and orchestrator arg/telemetry plumbing) — NEVER in
`requestStoryboardPlan`/`parseStoryboardResponse`/`validateStoryboardPlan`. A
flags-OFF run of the same brief fail-louds identically. So the flip cannot cause
or prevent these failures; they are the pre-existing storyboard-capability sink
the plan's §1 diagnosis named, exposed here on non-dense-UI brief shapes the
system was less tuned for. **Fixing storyboard capability is explicitly outside
Sentinel's scope** (plan §5: Sentinel does not redesign host contracts or add a
storyboard model). It is the highest-value pre-judging work item, logged here as
Open item S1.

### Deferred Phase-3 levers — probe-confirmed to STAY deferred

- **3.2 storyboard ladder 3→2: DO NOT CUT.** The plan gates the cut on "probes
  show normalization absorbing the arithmetic rejections." The probes show the
  opposite — the rejections are moment-spacing / hard-feature / component-kind
  deficits (not arithmetic), so normalization does not absorb them, and Probe 1
  needed **all five rungs** (primary 3 exhausted → rescue 2) to publish. Cutting
  the primary rung to 2 would have turned Probe 1 into a sixth fail-loud. The
  `degradePacingFindings` late-attempt boundary and attempt accounting are
  therefore untouched (no landmine touched).
- **3.3 `REASONING_STORYBOARD_MAX_TOKENS` 30,720→20,480: DO NOT DROP.** The plan
  gates the drop on "probe storyboards stay clean at 2 rungs." They do not stay
  clean at 3 rungs, let alone 2; two rescue attempts even hit the completion
  budget (Probe 2) — dropping the reasoning budget would truncate more good
  thinks into worse plans. Kept at 30,720.
- **3.5 one-slot-retry-before-least-bad: NOT EXERCISED, correctly deferred.** Its
  precondition — the least-bad shipped draft carries a measured
  `camera_framed_clipped`/`_sparse`/`cut_degraded` on a hero frame — never
  occurred: Probe 1 published clean (no least-bad situation), and the other four
  never reached source authoring. Building the new paid-call entry point blind,
  with no probe able to exercise it, has low value and real audit risk (the
  Phase-3 audit's own conclusion). Deferred.

### Revise + undo — verified by code (the plan's "verify, don't assume")

`sequence:check` has no revise entry point, but the properties the plan flags are
provable by construction: `useSlots = sentinelSlotsEnabled() && lockedStoryboard
&& !patchMode && !compact` (`compositionRunner.ts:6482`) — a revision runs in
`patchMode`, so `useSlots` is **false** on revise: **revision keeps whole-doc
patch mode**, the slot path is never entered, and `directRevisionRouter` /
`tweakRunner` are untouched. And the critic-skip predicate is evaluated after the
author loop, on the create path only — the revision path returns before it (the
Phase-3 audit's item #4 finding). Both properties hold without a live probe; a
live revise smoke is available via the Slack path / orchestrator `reviseVideo`
if the operator wants belt-and-suspenders.

### Normalization tags in a live `sentinel-run.json` — NOT yet observed committed

The plan wanted the probes to confirm `camera-budget-clamp` / `pacing-stretch`
tags appear in a live `sentinel-run.json` and STORYBOARD.md. **Across all five
probes, neither tag committed** — every engagement atomically REVERTED because a
co-occurring `storyboard/moments` (or hard-feature) block failed the normalized
plan. This is the atomic guard working exactly as designed (it must never commit a
normalization that leaves a different blocking finding), but it means the
committed-normalization path (and its STORYBOARD.md `- Sentinel normalized:` line)
is still only unit-proven, not probe-proven. A brief with an over-budget camera
count but NO moment gap would commit a `camera-budget-clamp`; none of the five
happened to be that shape. Logged as Open item S2.

### The flip + deploy decision — PAUSED for the operator

Per the plan ("confirm with the operator before `railway up` if anything looks
marginal"), and because 4/5 fresh briefs fail-loud, the default flip and deploy
are **not** done autonomously. The honest read for the decision:

- Flipping `SENTINEL_SKELETON`/`SENTINEL_SLOTS` default ON is **low-risk**: the
  flags are flag-independent-safe (they cannot affect the storyboard fail-louds),
  they are validated on the dense-UI source-author path across four runs (Probe 1
  + three Carryover A runs), and they make the two 2026-07-05 incident classes
  unrepresentable for every run that reaches source authoring. Its downside on the
  four failing briefs is nil (they fail upstream regardless).
- But the **§7 acceptance as written ("all three publish, zero fallback") is NOT
  met**, and the real judge-risk the probes surfaced — storyboard fragility on
  varied briefs — is a separate, larger, out-of-scope problem the flip does not
  address. In judging mode (`ALLOW_DETERMINISTIC_FALLBACK=1`) a storyboard
  fail-loud degrades to the labeled safe-fallback film, not a raw error, so it is
  not catastrophic, but it is not the real film either.

Nothing is flipped or deployed. Per the operator's direction, this session
**stops at the flip/deploy gate** and hands the decision (and the open items) to
the auditing agent + operator rather than acting on a marginal result.

---

## Handoff to the auditor (Fable) — 2026-07-06, end of Session 3

**What is DONE and shipped:** Phase 4 in full — commit `555ba67`, published to
`Slack_Sequences/main`. Contract registry + closed-world CI test + prompt-budget
test + L1 scaffold counter + SENTINEL.md + doc pointers. Typecheck clean, suite
525 tests green in isolation, `film:demo` byte-stable. No gate loosened, no rung
raised, no default flipped.

**What is DONE but NOT shipped (uncommitted at handoff):** this Phase-5 probe
report + budget-gate updates in `SENTINEL_REPORT.md` (docs only). Commit/publish
at the auditor's discretion — no code in it.

**Decisions left OPEN for the auditor + operator (nothing was done autonomously):**

1. **The default flip** (`SENTINEL_SKELETON`/`SENTINEL_SLOTS` → ON). Low-risk and
   flag-independent-safe, validated on dense-UI (Probe 1 + 3 Carryover A runs),
   but the §7 "all three publish" gate is unmet for flag-independent reasons.
   Recommendation on file: either keep OFF (the Carryover-A-proven healthy default,
   which already recovers the incident classes at L2) or flip-in-source-without-
   deploy — do NOT flip+deploy on a 1/5-published probe set without a call.
2. **`railway up`** — not done; the pre-judging checklist
   (`ALLOW_DETERMINISTIC_FALLBACK=1` on Railway before judges) is still owed
   regardless of the flip.

**Open items for the auditor to pick up (ranked):**

- **S1 — storyboard-stage fragility (HIGHEST value, out of Sentinel scope).**
  4/5 fresh briefs fail-loud at `storyboard-plan` on legitimate contract
  violations the planner models repeat (moment-spacing dead-intervals,
  `requireMultiStationWorld`, `timeRamp` motivation, `type`-on-`app-window`,
  framing-density). Diagnose: requirement strictness vs. model capability
  (`z-ai/glm-5.2`) vs. storyboard-prompt teaching. This — not the flip — is the
  real pre-judging risk. Evidence: `planning/attempts/storyboard-*-rejected.*` in
  the four fail-loud job dirs (`sentinel-p5-{camera,longcopy,camera-b,interactions}`).
- **S2 — committed normalization not probe-proven.** `camera-budget-clamp` /
  `pacing-stretch` atomically REVERTED in every probe (a co-occurring
  `storyboard/moments` block failed the normalized plan — the guard working). The
  *committed* path (+ its STORYBOARD.md `- Sentinel normalized:` line) is still
  only unit-proven. A brief with an over-budget camera count but NO moment gap
  would commit one; construct one if you want the live proof.
- **S3 — the two "extras" from the implementer brief, both deferred (safe, low
  value without a probe):** (a) `criticSkippableCleanDraft` ignores static-repair
  warnings that `browserQualityPenalty`'s 2nd arg weights — plumb them to the
  critique seam so a repaired-but-"pristine" draft still gets the critic; (b) no
  parse/validate semantics changed this session, so the storyboard cache contract
  was correctly NOT bumped (still v10) — re-confirm if you change parse/validate.
- **S4 — prompt budget (Phase 4 `.todo`).** The assembled author prompt is ~81k
  (fixture) / ~100k (live Probe 1) vs. the 45k target. The reduction plan is in
  SENTINEL.md "Prompt budget" (scaffold-prose deletion at the flip → RAG diet →
  storyboard-JSON diet → director-prompt split). Item 1 is unblocked the moment
  the skeleton is default-ON.

**What to re-verify against the persisted artifacts (do not trust this summary):**

- The closed-world test bites: add a fake finding code to any validator and
  confirm `test/sentinel.test.ts` fails; confirm the registry covers the emitted
  set both directions.
- The flag-independence claim: `grep -rn "sentinelSkeletonEnabled\|sentinelSlotsEnabled" src/`
  — every hit is source-author or telemetry, none in the storyboard path.
- The deferred-lever verdicts: Probe 1's `sentinel-run.json` shows storyboard
  `attempts: 5` (primary 3 exhausted → rescue 2) — cutting the ladder would have
  fail-louded it.
- Probe 1 is the one clean film:
  `.data/projects/sentinel-p5-denseui/composition/index.html` (open in a browser).

### Verification layers that ACTUALLY ran this session

- ✅ `npm run typecheck` (Phase 4).
- ✅ `npm run test` full suite — 525 tests, green **in isolation**; the 5
  parallel-run failures are Chrome-launch timeouts under load (all pass with
  `--no-file-parallelism`), the documented flake class.
- ✅ `npm run film:demo` — byte-stable signature.
- ✅ `test/sentinel.test.ts` + `test/promptBudget.test.ts` — run in isolation,
  pass (3 pass + 1 intentional `.todo` for promptBudget).
- ✅ **5 paid live probes** (`sequence:check --no-mcp`, flags ON, fail-loud) —
  1 published, 4 fail-loud at storyboard; artifacts persisted per job-id.
- ❌ **NOT run:** Docker gate, `railway up` + `/healthz`, Slack sandbox smoke,
  real hosted-MCP flow, a live revise/undo probe (verified by code instead). The
  flip is not applied, so no flag-flip diff was gated.

---

## Auditor review + Sentinel COMPLETION (2026-07-06, session 4 — Fable)

Commits `505de05` (convergence + morph quality), `55e6df9` (S3a),
`bfdc5c0` (default flip + last-resort salvage + copy fidelity), plus this
report. The operator's completion bar — multiple probes with no failures,
fewer model attempts, faster generation, higher motion-design quality — is
measured below against the immutable job dirs.

### Phase 4 — audit verdict: PASS

- **Closed-world registry test verified to bite**: a fake finding injected
  into `pacingAudit.ts` failed `test/sentinel.test.ts` with the exact
  register-or-whitelist message (source restored after). Both directions
  (unregistered-emitted, registered-but-dead) enforce.
- Registry structure, layer/blocking vocabulary, per-row test existence, and
  the 15 obligation groups check out. `promptCostChars` values are advisory
  hand-estimates (as documented) — not verified numerically.
- `test/promptBudget.test.ts` measures the assembled fixture prompt (81,099
  chars) against a regression ceiling with the 45k target as an intentional
  `.todo` — honest scoping. The L1 scaffold counter is real (probe evidence)
  and `sentinelFlags.ts` is the single flag source of truth.

### Phase 5 probes — the "out of Sentinel scope" verdict was WRONG

The implementer's flag-independence claim was code-verified and correct; the
storyboard-fragility diagnosis was correct; but the handoff's conclusion
("fixing storyboard capability is outside Sentinel's scope") was rejected by
this audit. The persisted rejected storyboards show the failures were
host-owned CONVERGENCE defects, every one fixable inside Sentinel doctrine:

1. **Findings-only retries caused the whack-a-mole.** The retry prompt never
   included the rejected plan, so every retry was a from-scratch redesign
   minting fresh violations (visible attempt-over-attempt in all four p5
   fail-loud dirs, on both planner models). Fixed:
   `StoryboardValidationError` carries the exact plan the findings describe;
   the retry demands a FIELD-FOR-FIELD reproduction with only the named
   fixes (`sentinel-p6-camera-r2` additionally showed GLM lossy-copying —
   dropping camera `toRegion` targets — so the prompt names the droppable
   fields). The rescue rung gets the same baseline.
2. **The Phase-3 atomic rule was too strict to ever commit live.**
   Commit-only-if-fully-clean meant every probe engagement REVERTED (every
   plan also carried a moments deficit) and models re-fixed host-fixable
   arithmetic each retry. Fixed: normalizations commit when every remaining
   finding belongs to a class (digit-stripped) the model's own plan already
   carried; a minted NEW class still reverts.
3. **`requireMultiStationWorld` was fabricated from weak signals** (a passing
   "camera moves" inferred a demand the finding attributed to the brief
   verbatim). Fixed: only explicit world/station language infers it; finding
   + prompt now name which verbs count (drift/hold do NOT) with a recipe —
   the p5 plans show models declaring drift/hold pairs believing they
   complied.
4. **Three new L2 normalizers** own the dominant mechanical rejection classes
   (all load-bearing-guarded, all atomic, all registered):
   `delayConflictingCameraMoves` (the `pacing/outcome` "0.0s later" spam),
   `retimeUnmotivatedTimeRamps` (the sub-second solver-geometry hold window
   models had to hit blind), `reconcileUndeclaredMorphTargets` (unique
   catalog partner declares the missing morph twin; ambiguity still blocks).
   Plus load-bearing TEXT beats degrade to `swap` and load-bearing numeric
   fills to `count` (same payload, same second — evidence survives).
5. **Last-resort moment salvage** (`normalize.moment-demote-last-resort`):
   when the author ladder exhausts with a draft blocked SOLELY by
   `storyboard/moments:` paperwork, the unbound PRIMARY moments demote to
   supporting (re-anchor-or-drop with a warning — the existing supporting
   path), and the draft ships only if static + browser gates then pass.
   This was `sentinel-p6-longcopy`'s death (5 paid author attempts on one
   unbound decorative moment). NOTE: a plan-time typed-anchor gate was
   prototyped and REVERTED — the fallback film and the 2026-07-04 paperwork
   lever both legitimately declare tween-bound moments; blocking them early
   would RAISE attempt counts. The salvage owns the class at the right layer.

### Quality — the operator's "weird morphing / flashing components" report

Both root causes found and fixed deterministically, then verified in a live
re-run of the same brief:

- `compileMorph` FLIPped onto the full-scene overlay ROOT (`.cmp-modal` is
  `inset:0`), not its visual `.cmp-dialog` — a palette "morphing into a
  modal" scaled onto a full-screen rect. It now FLIPs visual-box→visual-box
  AND performs the full open-equivalent reveal (scrim/panel/items +
  data-state): a morph IS the twin's entrance.
- The p5 film's `morph @3.10 → open @3.70` on the same modal re-ran the
  entrance over the morph reveal (two build-time fromTo tweens fighting →
  the split-second flash). `dedupeRedundantBeats` Rule 4 now drops an `open`
  on a morphed-in twin (unless a `close` intervened).
- Live proof: `sentinel-p7-denseui` (same brief) published with 1 morph and
  ZERO open-on-twin conflicts; `sentinel-p7-camera`'s brief-required
  sparkline→bars morph shipped through a host-reconciled twin.

### The completion probe battery (all fail-loud, fresh job-ids)

Round 1 (flags ON via env) and round 2 (NO flag env — the flipped DEFAULTS,
validating Phase 5.3 live):

| Probe | Brief shape | p5 baseline | This session | Storyboard | Total | Moments |
| --- | --- | --- | --- | --- | --- | --- |
| `sentinel-p6-camera-b` | gentle camera | fail-loud, 5 att / 28.7 min | **published** | 3 att / 2.5 min | 8.4 min | 10/10 |
| `sentinel-p6-interactions` | inbox + 2 cursors | fail-loud, 5 att / 25.5 min | **published** | 3 att / 2.8 min | 9.7 min | 18/18 |
| `sentinel-p7-camera` | §7.2 forced-world camera + morph | fail-loud (also failed p6 pre-fix) | **published** | **2 att** / 6.9 min | 11.4 min | 17/17 |
| `sentinel-p7-longcopy` | §7.3 long copy + 2 cursors + required ramp | fail-loud (p6: died at source) | **published** | 3 att / 11.3 min | 18.9 min | 21/21 |
| `sentinel-p7-denseui` | §7.1 dense-UI (morph-quality regression) | published (with the morph artifacts) | **published**, clean morph hygiene | 4 att / 12.5 min | 19.1 min | 19/19 |

- **Zero fallbacks, zero fail-louds across all five publishing runs**; every
  probe ran fail-loud (`ALLOW_DETERMINISTIC_FALLBACK=0`), so nothing was
  masked. The two p6 fail-louds (`sentinel-p6-camera-r2`,
  `sentinel-p6-longcopy`) were diagnosed from artifacts, fixed, and their
  re-runs published — their job dirs remain as evidence.
- **The §7 acceptance ("all three publish, zero fallback") is now MET**, on
  the flipped defaults (p7 probes ran with no flag env;
  `skeletonEnabled/slotsEnabled: true` in their sentinel-run.json).
- **Attempts and wall-clock**: storyboard attempts 2-4 (was 5-6 + fail),
  wall-clock 2.5-12.5 min (was 10-29 min + fail); the p5 "storyboard attempts
  avg ≤1.5" acceptance remains unmet as written, but the metric it proxied
  (cost of the storyboard stage) fell by 3-10× on the failing shapes, with
  publishes instead of failures.
- **The Phase-3/5 normalizers are now probe-proven COMMITTED** (closing p5
  open item S2): `timeramp-retime` (p6-camera-b, p7-denseui),
  `pacing-stretch` (p7-longcopy ×2, p7-denseui), committed-with-findings
  observed live shrinking retry lists. `camera-move-delay` and
  `morph-twin-reconcile` are unit-proven; their trigger shapes did not recur
  in the final battery.
- Deferred levers stay deferred with probe backing: 3.2 ladder 3→2 (probes
  still use the 3rd primary attempt — the demotion rung — routinely; cutting
  it would have fail-louded p7-longcopy and p7-denseui), 3.3 token budget
  (rescue attempts still hit the completion ceiling occasionally), 3.5
  slot-retry (its trigger — a hero-frame defect on a least-bad pick — did
  not occur).

### Flags / state after this session

`SLACK_SEQUENCES_SENTINEL_SKELETON` and `SLACK_SEQUENCES_SENTINEL_SLOTS`
**default ON** (`=0` reverts, one release). The legacy whole-doc author
suites pin `=0` explicitly; slot coverage lives in `sceneSlots*`,
`promptBudget`, and the probes. `SLACK_SEQUENCES_CRITIC_SKIP_CLEAN` default
ON, now weighing static repair warnings (S3a closed). Storyboard cache
contract stays v10 — every new normalizer fires only on validation-failing
plans, which are never cached; validation semantics changed only in finding
TEXT (message wording), which re-validation absorbs.

### Verification layers that actually ran (session 4)

- ✅ typecheck; ✅ full suite **539 passed + 1 todo** (under the flipped
  defaults); ✅ `film:demo` byte-stable signature (twice, incl. post-flip);
  ✅ `demo`, ✅ `mcp:demo`, ✅ `direct:demo`; ✅ closed-world bite test
  (negative control).
- ✅ **10 paid live probes** across two rounds (5 published, 2 diagnosed
  fail-louds that re-published after fixes, plus round-1 re-runs), all
  fail-loud, all artifact-verified.
- ❌ NOT run: Docker gate, `railway up`/`healthz`, Slack sandbox smoke, real
  hosted-MCP flow, a live revise/undo. **Owed before judging:** the Docker +
  sandbox ladder, and `SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK=1` on
  Railway (FALLBACKS.md pre-judging checklist).

### Remaining open items (ranked)

1. **Prompt budget (S4, Phase-4 `.todo`)**: the author prompt is still
   ~99-120k chars live vs the 45k target. The skeleton is now default-ON, so
   SENTINEL.md's reduction-plan item 1 (scaffold-prose deletion) is
   unblocked — the single biggest cost lever left.
2. **In-flight payoff conflicts** (`pacing/outcome` on a beat during a
   camera move) remain the most common surviving finding class — they demote
   honestly on the final rung today; a camera-arrival-sync normalizer is
   possible but touches the "signature move" and should be probe-designed.
3. **Slot-envelope drift** (author returns whole-doc into slot mode) costs
   ~1 author attempt occasionally; a deterministic whole-doc→slot splitter
   at parse would absorb it.

---

## Session 5 (2026-07-06, final pass) — external-audit fixes + honest closeout

An independent audit (Codex) reviewed the "Sentinel COMPLETE" declaration
against the code and the persisted probe artifacts. Its load-bearing findings
were verified true and fixed this session; its bottom line — *"a promising
reliability layer with a successful targeted rescue battery, not a completed
correctness-by-construction system"* — is accepted and reflected in
SENTINEL.md's rewritten "honest scope" thesis.

### The honest final mission table

Measured over the five completion-battery runs (p6-camera-b, p6-interactions,
p7-camera, p7-longcopy, p7-denseui) — the numbers the earlier completion
section omitted:

| Metric | Target | Observed (final battery) | Verdict |
| --- | --- | --- | --- |
| Fail-louds | 0 | 0 | **MET** |
| Visible fallbacks | 0 | 0 | **MET** |
| Storyboard attempts / run | ≤ 1.5 | 3.0 | missed (was 5+fail; 3–10× cheaper) |
| Source attempts / run | ≤ 1.5 | 3.2 | missed |
| Tier-1 wall-clock | ≤ 8 min | 13.4 min avg | missed (was 10–29 min + fail) |
| Tier-2 / MP4 | ≤ 14 min | not measured in battery | unproven |
| Max author prompt | ≤ 45k | 120,635 chars | missed (`.todo`, reduction plan stands) |
| Model calls / clean run | ≤ 5 | 9.0 | missed |

Sentinel's reliability goals are met on the targeted briefs; its cost/speed
targets are NOT met and remain open work — the completion label applies to
the phase contract's shipped scope, not the mission table as written.

### Audit findings fixed this session (all verified in code first)

1. **L1 was not correctness-by-construction** (`sceneSlots.ts` inserted model
   interiors verbatim; probes still hit `component_root_missing`). Fixed
   honestly, twice over: (a) `slotScaffoldViolations` + a **scene-scoped
   repair round** in `authorSlotDraft` — a scene that dropped a required
   camera station or component root **with no trace** (near-misses stay with
   the free L2 reconcilers) is re-requested ALONE, with findings and its own
   previous interior as the minimal-edit baseline; (b) the registry rows'
   `impossible` claim downgraded to `blocking` with the real ladder written
   out, and the **L1 telemetry counter now measures bindings present in the
   shipped document** (`countScaffoldBindingsPresent`), not planned by the
   template.
2. **Slot truncation ignored missing `<scene_script>`** (a scene with html
   but no script assembled silently static). `missingOf` is now script-aware,
   the continuation re-requests those scenes, and assembly throws if a script
   is still missing.
3. **The closed-world registry wasn't closed** — HyperFrames' spatial codes
   (`clipped_text`, `text_box_overflow`, `canvas_overflow`, `text_occluded`,
   `motion_*`) flow through `normalizeHyperframesIssue` dynamically and were
   unregistered. The vendored `LayoutIssueCode` union joined
   `FINDING_SOURCE_FILES` (+ `timeRamp.ts`), a `layout.hyperframes-spatial`
   row owns the codes, and the scaffold-hint keys are quoted so the scanner
   sees them.
4. **Telemetry now measures what the docs say**: failed model calls and hedge
   duplicates are counted (`modelCalls.failed/hedged`); L3/L4 counters count
   findings (not attempts) and the storyboard stage participates;
   `island-strip` counts only unmarked (model-authored) islands —
   host-injected islands carry `data-sequences-host="1"`; **tier 1/2 are
   recorded when the thumbnails/MP4 actually exist** (inside
   `buildPreviews`); and **`published-degraded` is real** — every shipped
   degradation (moment demotion, least-bad pick, quarantine, degraded cut,
   rescue-with-findings, browser-QA infra bypass) is recorded and
   auto-downgrades the disposition. `sentinel:report` includes fail-loud runs
   in attempt averages (the old exclusion biased away from the most expensive
   failures) and prints a "Cost honesty" line.
5. **Slot mode received contradictory instructions** — the director prompt's
   "Hard runtime contract" (return a complete document, register the
   timeline, own scene-window opacity) directly contradicted the slot
   response contract; the plausible root of the documented slot-envelope
   drift. `SLOT_MODE_DIRECTOR_REWRITES` now surgically rewrites those bullets
   in slot mode; anchors are CI-tested (`promptBudget.test.ts`) and a stale
   anchor degrades to an explicit precedence block, never a live failure.
6. **Doc drift**: FALLBACKS.md's nested-`gsap.timeline` regex risk marked
   FIXED (the brace-matching parser shipped in Phase 1); SENTINEL.md's
   contract table gained the missing `normalize.moment-demote-last-resort`
   and `layout.hyperframes-spatial` rows; `CRITIC_SKIP_CLEAN` is now read
   through `sentinelFlags.ts` as the flag table claims; the thesis line
   "retries become scene-scoped" rewritten to the truth (truncation +
   scaffold repair are scene-scoped; validation retries are document-scoped).

### Accepted, not fixed (with reasons)

- **Full scene-scoped validation retries** (the Phase-2 cut-line): still the
  right next structural move, still out of scope days before the deadline —
  the bounded slot repair above covers the highest-frequency trigger
  (dropped bindings) at ~continuation cost.
- **Prompt reduction to 45k**: untouched; the anti-growth ceiling holds and
  the reduction plan in SENTINEL.md stands. Slot-mode surgery changed
  contradictions, not size (±26 bytes).
- **Severity conversion of visual errors to warnings** (layoutInspector):
  kept as deliberate resilience policy — but such publishes are now honestly
  `published-degraded`, which is the part that was actually wrong.

### Verification (session 5)

- ✅ typecheck; ✅ full suite **557 passed + 1 todo** (new: script-aware
  continuation, scaffold-violation triage incl. near-miss/renamed-station
  negatives, slot-repair prompt shape, telemetry downgrade/cost-honesty,
  island host-marker counting, slot-prompt surgery anchors + absence of
  whole-doc instructions, gsap-call-shape repair). The QA-cache perf spec's
  OUTER timeout rose 40s→75s (it measures two real browser passes at ~41s;
  the <2s cache-hit assertion is unchanged).
- ✅ **3 paid live probes** (all fail-loud, fresh briefs/job-ids, flipped
  defaults; see below).

### Session-5 probes — the new machinery, live

| Probe | Brief shape | Outcome | SB att | Src att | Calls (fail/hedge) | Tier1 | Tier2 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sentinel-s5-slotrepair` | 5-component incident-replay console + camera world, `--render` | **published** (MP4 2.7MB, 18/18 moments, 10 thumbs) | 3 | 3 | 9 (1/7) | 11.9 min | **13.6 min** |
| `sentinel-s5-interactions` | chat+toast+kanban+ring handoff, required rack-focus | **fail-loud** (honest: 4 author attempts died on model runtime errors) | 3 | 4 | 11 (0/6) | — | — |
| `sentinel-s5-interactions-b` | same brief, post `gsap-call-shape` fix | **published-degraded** (`least-bad-pick:penalty=72`) | 3 | 3 | 10 (0/8) | 17.0 min | — |

What the probes proved live:

- **Tier-2 finally measured: 13.6 min ≤ the 14-min target** (`--render` on
  s5-slotrepair) — the mission table's last "unproven" row now has a data
  point, barely under target.
- **Both new slot mechanisms fired as true positives**: the script-aware
  continuation re-requested `runbook-ring-resolve` (interior present, script
  missing — previously assembled silently static), and the scene-scoped
  scaffold repair re-requested `runbook-ring-resolve` / `scattered-signal`
  after dropped host-contract bindings, each at continuation cost instead of
  a whole-document paid retry.
- **The disposition ledger works**: `-b` published via the least-bad seam and
  recorded `published-degraded` with `least-bad-pick:penalty=72` — the exact
  class (p7-denseui) that used to report itself clean. (s5-slotrepair ran
  BEFORE the second least-bad seam was instrumented; under today's code its
  clean `published` would read `published-degraded` too — its terminal
  shipped host-injected neutral "Item 1/2/3" rows, which is also why the
  publish-time `rows-neutral-children-shipped` scan now exists.)
- **Cost honesty is visible**: failed calls (1) and hedge duplicates (6–8 per
  run!) now appear in `modelCalls`; the hedge rate says wall-clock pressure is
  mostly upstream-provider latency, not attempt count.
- **The honest fail-loud earned its keep**: s5-interactions died on three
  distinct model runtime errors; its attempt-3 class — `fromTo(target, vars,
  <number>)` crashing GSAP compile — was mechanically decidable and became
  the L2 `normalize.gsap-call-shape` repair the same day. The re-run
  published.
- L1 scaffold now reads a REAL number per run (11 / 17 bindings preserved in
  the shipped document).

---

## 2026-07-06 post-audit implementation — correctness, cost, and scene retries

This section supersedes the open-item statements immediately above. It records
code/test evidence only; **no new paid probe was used for these changes**.

1. **GSAP call-shape repair is semantic-safe.** The stored
   `sentinel-s5-interactions` failure (`opacity:1, scale:1`) is replayed as
   `.to(...)`, not the previously implemented `.from(...)`. The rewrite requires
   the same selector's earlier opposite-state initialization; entrance-looking
   (which could instead be an exit), mixed, cue-less, and lone-final calls stay
   blocking.
2. **Scene validation retry landed.** One bounded retry can re-author only the
   scenes named by static or browser findings. It carries prior HTML + script,
   requires both replacement blocks, keeps untouched scenes byte-stable, accepts
   a static repair only when finding classes fall, accepts a browser repair only
   when its quality penalty falls, and never spends the scene call when any
   finding is film-level.
3. **Slot scaffold repair tightened.** Repeated components of the same kind are
   no longer guessed as L2 near-misses; the repair response is rechecked and
   unresolved scenes continue into the unchanged L3 gate.
4. **Telemetry now distinguishes actual work.**
   `physicalRequestTotal = successfulLogicalTotal + failedTotal + hedgedTotal`;
   `slotCalls` reports truncation/scaffold/validation subcalls; L1 reports
   present/planned coverage plus scene/L2 restoration events. Degradation
   reasons are deduplicated and storyboard ramp/beat/shape/polish demotions join
   the ledger.
5. **Hedging is bounded.** OpenRouter hedging remains enabled, but a run may
   launch at most two duplicates by default
   (`SLACK_SEQUENCES_HEDGE_MAX_PER_RUN`; configurable, `0` disables duplicates
   while retaining the main hedge feature flag).
6. **The 45k slot-prompt target is now met by test.** The deterministic fixture
   measures **44,773 chars**. Slot mode condenses host-owned director chapters
   and caps its skills projection at 5,000 chars; non-slot paths retain the full
   prompt.
7. **Registry semantics match runtime.** Main layout and HyperFrames spatial
   findings are `advisory-late`: they exert repair pressure before the final rung
   and force `published-degraded` when shipped.

Deterministic verification at implementation time:

- `npm run typecheck` — clean.
- Full Vitest invocation after promotion — **564 passed, 0 todo**; the prompt
  fixture passed at 44,773 chars.
- Stored report replay shows historical Session-5 runs launched 17, 17, and 18
  physical requests respectively (successful + failed + hedge duplicates),
  exposing why the two-hedge budget matters.

Remaining external acceptance: Docker → Railway → sandbox/Slack, with
`SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK=1` before judges. A paid probe is
still required to measure quality after prompt compaction and to live-trigger the
new scene-validation and direction-aware GSAP paths.

---

## 2026-07-06 independent audit (Opus 4.8) — two paid probes + one follow-up fix

A separate auditor (Claude Opus 4.8) re-verified the whole uncommitted tree and
ran the paid probes the section above says were still required. All static claims
reproduced exactly (typecheck clean; 564 passed / 0 todo; focused Sentinel suite
111 passed; assembled slot prompt 44,773 chars; `git diff --check` clean; report
replays 17 / 18 physical requests). Two **fresh, fail-loud** probes (flags ON):

| Probe | Brief shape | Disposition | SB att | Src att | Calls (fail/hedge) | Physical | Tier1 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sentinel-audit-denseui` | Cursorflow palette+modal+stat-card+terminal+button | **published-degraded** (10 thumbs, 17 moments, 0 unbound) | 3 | 3 | 10 (1/2) | 13 | 24.5 min |
| `sentinel-audit-interactions` | chat+toast+kanban+ring+2 cursors+timeRamp | **fail-loud** (honest; `FAILURE.md` written) | 1 | 4 | 6 (1/2) | 9 | — |

What the probes proved live on the current tree:

- **Reliability holds on the hardest UI brief.** The dense-console brief that
  historically kills source-author published a real `hyperframes-direct` film,
  zero fallback, under fail-loud — with honest degradations (2 pacing advisories,
  1 shape-cut→zoom-through, 1 interaction quarantine), deduped, auto-downgrading
  the disposition to `published-degraded`; scaffold coverage read 9/9.
- **The two-hedge budget works live** — capped at exactly 2 both runs (vs 6–8 in
  session 5), cutting physical requests to 13 / 9. Its cost/latency tradeoff is
  now visible too: the global counter spent both hedges on the concept/storyboard
  stages, leaving the slow author stage un-raced (denseui tier-1 rose to 24.5 min).
- **Fail-loud is honest.** The interactions brief exhausted the ladder (full →
  patch → full → rescue) on a *cascade of different* minor polish findings
  (2px cursor miss, contrast 4.25:1-vs-4.5:1, `content_overlap`,
  `camera_framed_sparse`), ending on the rescue model's `kit_markup_incomplete`.
  A complete `FAILURE.md` was written at
  `.data/projects/sentinel-audit-interactions/FAILURE.md`. This is the same
  stochastic frontier session 5 saw (s5-interactions failed, then `-b` published);
  it is **not** caused by the uncommitted changes (unrelated to gsap/hedge).

Key finding — and the follow-up fix:

- **The scene-scoped validation repair was inert on both runs** (`slotCalls: 0`,
  including the fail-loud it exists to rescue). Root cause: it declined whenever
  ANY finding attributed to `__film__`, and dense briefs always mix one
  film-level finding (`interaction_target_miss [cursor-*]`,
  `moment_static_frame moment:*`, `eye_trace_pingpong [data-part=*]`) into
  otherwise scene-local rejections — so the all-or-nothing guard tripped every
  attempt.
- **Fix applied (this commit):** `repairSlotDraftForFindings` now repairs the
  **scene-attributable subset** — it fires whenever at least one finding maps to
  a named scene, re-authors those scenes, and lets any film-level remainder ride
  the whole-document ladder (which banks the improved draft as the next attempt's
  scratch). The atomic acceptance (finding-class count for static, whole-film
  quality penalty for browser) already rejects any subset repair that leaves or
  worsens a film-level finding, so partial repair is never a regression. New
  regression test in `test/sceneSlots.test.ts` proves the mixed case fires on the
  subset and the all-film-level case still declines; full suite green after.

Remaining acceptance for THIS change: a paid probe to live-trigger the relaxed
scene-repair on a dense brief was **deliberately deferred** (the owner is
completing MOTION_DESIGN_PLAN with another agent before the next live run). The
efficiency targets (attempts ≤1.5, ≤5 physical requests, ≤8 min tier-1, ≤45k live
prompt) remain **unmet** on hard briefs and are the real open work — unchanged by
this pass.
