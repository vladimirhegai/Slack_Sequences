# Phase 3 implementation and audit log

Status: **historical Phase 3 execution log**. It accurately records S3.1-S3.4
and LP-1 as they existed on 2026-07-11/12. Later incident work added S3.5-S3.7
and is documented in `REFACTOR_PLAN.md` and `PROBE_LOG.md`; do not infer the
current first unchecked step or probe policy from this file.

Date: 2026-07-11
Scope requested: Phase 3 camera phrase work and LP-1 validation.

## Specification reconciliation

The user request names S3.1-S3.5. The checked-in `REFACTOR_PLAN.md` defines
Phase 3 as S3.1-S3.4 followed by the LP-1 checkpoint; no S3.5 entry exists in
the repository. This implementation treats LP-1 as the fifth deliverable and
does not invent an undocumented refactor step.

## Safety and ownership constraints loaded

- Read root `CLAUDE.md`, `apps/slack/CLAUDE.md`, the complete Phase 3 section
  of `REFACTOR_PLAN.md`, `REFACTOR_HANDOFF.md` section 4, `SENTINEL.md`,
  `OPERATIONS.md`, and `.claude/skills/sequences/SKILL.md`.
- Existing user-owned change detected in `apps/slack/PROBE_LOG.md`; it is
  preserved and will not be included in step commits unless LP-1 needs a new,
  separately attributable ledger entry.
- Existing untracked `.tmp/` is left alone except for a new cache-distinct
  LP-1 input if the checkpoint reaches the paid-probe stage.
- No publish or deploy is authorized or planned.

## Baseline architecture audit

- `cameraContract.ts` owns authored move normalization and compiles it into
  `CameraPlanV1` segments.
- `cameraBlocking.ts` independently turns direction-score and continuity data
  into `CameraBlockingPhraseV1` objects. Those objects already contain target,
  contextual framing, occupancy, arrival anchor, corridor, dwell, and handoff
  information, but omit source pose, explicit travel/settle/departure
  intervals, evidence owner, and route ownership.
- `sequences-camera.v1.js` reads both the camera and blocking JSON islands. In
  continuity mode it routes the lens from blocking phrases, with additional
  runtime-only primary/supporting filtering and same-target collapse.
- `layoutInspector.ts` parses the blocking island for primary landing and
  occupancy checks, but also falls back to independently derived camera
  segments for sparse-framing samples.
- `eyeTrace.ts` derives incoming attention from the raw first authored camera
  move rather than the route the runtime executes.
- `pacingAudit.ts` budgets raw full-move counts using scene duration and its L2
  normalizer deletes low-energy authored moves. Phase 3 requires replacing
  that count budget with one primary route/idea per scene.

## Planned migration seam

1. Introduce `cameraPhrase.ts` as the typed semantic owner and compile the
   existing authored-camera plus direction/continuity inputs into it once.
2. Preserve the existing blocking-island id as a wire-compatibility adapter,
   while making its payload the canonical phrase plan used by runtime and QA.
3. Move deterministic same-pose/same-target collapse out of browser runtime
   selection and into the typed compiler; register `camera-phrase-collapse`.
4. Make layout and eye-trace resolve attention, landing samples, occupancy,
   anchors, and tolerances from the canonical phrase fields.
5. Replace raw move-count budgeting with primary-route ownership and an
   actionable finding naming the competing scene ideas.

## Execution log

Implementation and verification entries will be appended below as each
S3.x commit is completed.

### S3.1 — canonical phrase compilation

- Added `src/engine/cameraPhrase.ts` with the required phrase fields: focal
  target, optional contextual framing target, source/arrival semantic poses,
  travel/settle/dwell/departure intervals, importance, evidence owner,
  occupancy and screen-anchor contracts, and typed route ownership.
- `resolveCameraBlockingPlan` now performs the join with the already-resolved
  authored `CameraPlanV1`. A matching non-connective authored segment owns the
  route; graph identity/handoffs own continuity routes; remaining direction
  requests are host-derived.
- Kept `CameraBlockingPhraseV1` and `CameraBlockingPlanV1` as deprecated type
  aliases and kept the existing JSON island id. This is deliberate wire
  compatibility while runtime/QA consumers migrate in S3.2-S3.3.
- Added unit coverage for authored, continuity, and host-derived compilation.
- Verification: Slack typecheck passed; 87 focused unit tests passed; 14
  camera/blocking/continuity browser tests passed; `film:demo` rendered all
  four cuts, reported zero eligible dead-frame windows, and completed without
  changing the runtime route.
- No paid calls, publish, or deploy.

### S3.2 — deterministic collapse before runtime

- Added a pure collapse pass to the phrase compiler. Once a scene declares a
  primary route, supporting direction evidence stays local unless it owns an
  independently authored destination. Consecutive phrases with the same
  target/context and a sub-threshold semantic pose are merged, extending the
  readable dwell and retaining `collapsedPhraseIds` provenance.
- The canonical summary now distinguishes input phrases, executed phrases,
  and collapsed phrases. The source normalizer emits
  `camera-phrase-collapse` only when it changes the host island, preserving
  idempotent replay telemetry.
- Exact SignalDock evidence from
  `.data/projects/architecture-stress-5-20260711/composition/manifest.json`:
  14 input phrases became 7 routes — `scattered-signals=1`,
  `gather-workspace=2`, `dependency-approval=2`, `resolve-94=2`.
- Added a minimized 14-phrase regression encoding the same ownership and
  repeated-target shape.
- `replay:all` initially failed all seven source hashes, as expected: the
  canonical camera island intentionally gained new fields and fewer routes.
  Artifact hashes and all storyboard hashes were unchanged. Refroze only the
  seven deterministic source replay hashes, then reran 13/13 successfully.
- Verification: Slack typecheck; 34 focused phrase/blocking/normalizer/
  Sentinel tests; exact replay 13 passed, 0 skipped, 0 failed.
- No gate was loosened, and no paid call, publish, or deploy occurred.

### S3.3 — one runtime/QA interpretation

- Moved phrase-island parsing and all landing acceptance tolerances into
  `cameraPhrase.ts`. Legacy persisted islands remain readable through the
  compatibility parser and receive the frozen defaults.
- `layoutInspector` now samples at the phrase's declared settled dwell and
  applies the phrase plan's opacity, visibility, occupancy, and sample-inset
  values. Both layout landing findings and continuous blocking evidence use
  the same 0.9x/1.1x occupancy measurement band, closing the GatePilot
  disagreement where one QA path accepted a landing and the other rejected it.
- Eye trace now chooses outgoing/incoming attention from the last/first
  executed phrase route. Explicit cut focal endpoints remain authoritative;
  raw authored camera paths are used only as a legacy fallback when no phrase
  plan exists.
- Deleted browser-side primary/supporting selection and repeated-target merge
  from `sequences-camera.v1.js`. The runtime executes the compiler's phrase
  array without deriving a second route model.
- First browser run: 8/10 passed. Two continuity fixtures still injected raw,
  uncollapsed phrase lists, and applying the QA maximum slack to runtime zoom
  let a product shell grow to 60%. Resolution: route those fixtures through
  `collapseCameraPhrases`; keep runtime targeting the nominal occupancy
  contract and use tolerance only for measured QA acceptance. The next run
  passed all 10/10.
- Verification: Slack typecheck; 129 focused unit/layout tests; 10 targeted
  camera-blocking/continuity/eye-trace browser tests; exact artifact replay
  13 passed, 0 skipped, 0 failed. Source hashes were refrozen only for the new
  canonical tolerance block/runtime bytes; storyboard and artifact hashes did
  not change.
- No new finding class, paid call, publish, or deploy.

### S3.4 — budget visual ideas, not move counts

- Removed the `1 + floor(duration/3.5)` per-scene move cap and its L2
  low-energy move deletion. Duration is not a proxy for story coherence, and
  selecting which idea to discard is creative rather than a safe normalizer.
- Added the blocking static finding `camera/idea-budget` to Sentinel. It runs
  over the post-collapse phrase plan, keeps the route matching
  `spatialIntent.focalPart`, and explicitly names the other target(s) to cut or
  split into their own scenes. Supporting evidence is directed to local
  component motion inside the kept framing.
- Preserved `normalizeCameraBudget` as a compatibility seam only for the
  mechanical film-wide third-whip clamp. Updated the old tests to prove it no
  longer deletes per-scene camera evidence.
- SignalDock exact validation now returns exactly three findings and no other
  class: keep `confidence-numeral-52`, cut `incident-workspace`; keep
  `approve-button`, cut `confidence-numeral-71`; keep
  `confidence-numeral-94`, cut `restore-cta`.
- The minimized SignalDock-shaped test retains the 14-input → 7-route collapse
  and proves the three actionable idea findings contain target names rather
  than a numeric limit.
- Replay consequence: four previously parsed rejected-storyboard artifacts
  now correctly replay as expected idea-budget rejections (LaunchRelay x2,
  PulseForge, SignalDock). Only their expected outcome/error hashes changed;
  all raw artifacts and all source replay hashes remain frozen.
- Verification: Slack typecheck; 175 focused pacing/camera/Sentinel tests;
  exact replay 13 passed, 0 skipped, 0 failed.
- No paid call, publish, or deploy.

### Full-suite fixture migration after S3.4

- The first full unit checkpoint exposed eight failures, all in
  `directComposition.test.ts`. They were not runtime regressions: four tests
  still asserted the removed numeric `pacing/camera-budget` deletion, and four
  interaction/world-layout fixtures accidentally asked the lens to visit
  multiple evidence stations while testing unrelated behavior.
- Replaced the obsolete numeric-budget assertions with phrase-level contract
  assertions: competing authored routes are rejected by
  `camera/idea-budget`, the finding names what to keep/cut, and the host does
  not delete authored camera moves to satisfy a numeric move requirement.
- Preserved the rack-focus and continuity-chassis coverage. The rack-focus
  case now proves its host top-up survives local supporting-motion collapse;
  the continuity case proves the generated opening chassis survives when a
  later scene earns an idea-budget finding.
- Reframed the interaction fixture around its CTA target, and reframed the
  world-layout fixtures as one lens route plus multiple component stations.
  This keeps their original timing/cache/layout assertions while expressing
  secondary evidence as local component motion inside one framing.
- The first focused rerun had four remaining failures because a region camera
  route and the continuity graph's first component target compiled as distinct
  phrases. Aligned each fixture's `spatialIntent.focalPart` and camera
  `toPart`, retaining component regions solely for layout completion. The next
  focused run passed all 181 tests.
- No production gate or tolerance changed during this migration.

### Pre-LP-1 checkpoint

- Slack typecheck passed.
- The complete unit project passed. `directComposition.test.ts` contributed
  181 passing tests, including the migrated Phase 3 fixtures.
- The first browser-project run was intentionally launched alongside the unit
  and replay workloads. It reached two existing wall-clock limits (one 5s
  continuity test and one 30s plugin test) without a semantic assertion. Both
  files passed alone (10/10; the timed-out tests completed in 2.2s and 15.3s),
  proving resource contention. The uncontended full browser rerun passed 22
  files and 52 tests.
- Exact artifact replay passed 13, skipped 0, failed 0.
- `film:demo` rendered its five-scene, four-cut deterministic film; all cut
  boundaries retained outgoing motion/incoming settle evidence and eligible
  runtime reported zero dead-frame windows over 1.5s.
- LP-1 remained unspent until all of the above local evidence was green.

### LP-1 attempt A — failed loudly; mechanical false positive found

- Ran the authorized paid probe as job
  `phase3-lp1-camera-20260711-a` with OpenRouter, fallback off, continuity on,
  audit composition, MCP transport, render, and temporal evidence requested.
- The run failed at storyboard planning after five attempts; fail-loud mode
  published no storyboard or video. Triage recorded `runtimeValid=false`, no
  fallback/degradation, 6 logical / 8 physical calls (including frame-design
  hedging), and no browser QA classes because authoring never began.
- Attempts 3 and 4 exposed a Phase 3 false positive: the idea gate reported
  `"confidence-ring in release-workspace"` as competing with the identical
  idea. The two phrases had distinct semantic poses and therefore correctly
  remained separate runtime visits, but S3.4 incorrectly treated visit count
  as idea count.
- Exact strict replay reproduced the same finding without another model call.
  The final attempt cleared the idea findings but still failed independent
  pre-existing framing-count and moment-gap gates.
- Fix: `auditCameraIdeaBudgetPlan` now de-duplicates routes by semantic
  target + contextual framing before counting ideas, while leaving both
  runtime phrases intact. Added a regression with two same-target/context
  phrases at materially different zoom poses; the phrase plan retains two
  visits and the idea audit returns no finding.
- Post-fix verification: focused camera/pacing tests passed 101/101; exact
  attempt-3 replay dropped only the duplicate workspace finding; Slack
  typecheck passed; the complete unit project passed 78 files / 1,303 tests;
  and frozen replay remained green.

### LP-1 attempt B — failed loudly; framing-floor integration defect found

- Ran cache-distinct retry `phase3-lp1-camera-20260711-b` with the same
  fail-loud environment and a five-shot brief. It again stopped at storyboard
  planning with no published video. Triage recorded 7 logical / 10 physical
  calls, including two transient request failures and one hedge; no fallback,
  degradation, or browser QA class was recorded.
- The duplicate semantic-idea finding from attempt A did not recur. Every
  idea-budget finding named genuinely different focal targets/context, so the
  S3.4 rejection itself was correct.
- The retry exposed a separate mechanical integration defect: continuity
  installs a single target-owned `hold` chassis before `topUpFramingFloor`,
  but the framing top-up accepted only scenes with no camera path. A neutral
  host chassis therefore made a one- or two-framing deficit impossible for the
  host to close. The old framing-floor message then told the planner to travel
  across a larger camera world, directly encouraging the competing evidence
  routes S3.4 correctly rejects.
- `topUpFramingFloor` now treats one target-owned hold as an upgradable neutral
  chassis, replaces it with a bounded push-in to the same target, and thus
  adds a pose without inventing a second semantic idea. Its finding guidance
  now says to add shots or develop the same primary target/context through an
  additional pose, explicitly forbidding a supporting-evidence tour.
- Added a regression proving two continuity-owned holds can satisfy a
  two-framing deficit while retaining their original `toPart` destinations.
  Focused pacing/phrase tests passed 87/87 and typecheck passed. The complete
  unit project then passed 78 files / 1,304 tests, and replay remained green.

### LP-1 attempt C — failed loudly; plugin ownership defect found

- Ran cache-distinct seven-scene retry `phase3-lp1-camera-20260711-c` after
  the framing fix. The seven scenes cleared the film-wide framing floor and
  all camera idea checks except one. The primary model timed out; the rescue
  model produced two storyboard attempts. Triage recorded 4 logical / 8
  physical calls, three failed physical requests, one hedge, no fallback or
  degradation, and no browser QA because the plan never reached authoring.
- The sole final finding was `owner-avatar in team-strip` versus
  `owner-strip-2`. Plugin reconciliation had renamed a declared `team-strip`
  after a part collision, then generated a second avatar stack beside the
  typed, load-bearing `owner-avatar`. Direction correctly treated the plugin
  unit as its own camera target, making the reconciliation artifact block the
  otherwise one-idea scene.
- Fix: when a team-strip's single generated avatar stack duplicates a typed,
  load-bearing avatar stack in the same station, plugin reconciliation now
  retires the optional plugin (and any stale lowered child) in favor of the
  typed component that already owns camera/spatial/continuity evidence.
  Notification stacks retain their existing behavior; this rule is specific
  to the one-child team-strip form.
- Exact strict replay of attempt C's final rejected artifact then parsed
  successfully without editing its bytes. Focused plugin/camera tests passed
  73/73; typecheck passed; the complete unit project passed 78 files / 1,305
  tests; and frozen replay remained green.

### LP-1 attempt D — failed loudly; authored-station ownership defect found

- A new seven-scene, plugin-constrained retry
  `phase3-lp1-camera-20260711-d` cleared the framing floor and plugin issue but
  every storyboard attempt converged on one remaining finding: focal
  `owner-stack` versus supporting `dependency-list in owner-station`. Triage
  recorded 8 logical / 9 physical calls, one hedge, no request failures, no
  fallback/degradation, and no browser QA because planning remained fail-loud.
- The model explicitly authored one push-in to `owner-station`, named
  `owner-stack` as the sole focal/hero, and marked the dependency moment
  supporting. The compiler did not give a generic focal component its declared
  region as contextual framing, so the region-authored segment was claimed by
  the supporting trace phrase instead. Collapse then preserved it as an
  independently authored route—the opposite of the written plan.
- Fix: any spatial focal with a declared region now receives that region as
  its contextual framing target. The authored station move therefore belongs
  to the focal phrase; supporting targets in the same region share its
  destination and collapse locally. A minimized owner/dependency regression
  asserts one executed focal phrase and zero idea findings.
- Exact attempt-D replay now accepts the unchanged seven-scene artifact. The
  same contextual-framing correction intentionally changes four LaunchRelay
  replay expectations: two storyboards no longer carry an idea-budget false
  positive (their remaining pacing-only residue is advisory on final-attempt
  replay), and two strict source islands gain the corrected focal context.
  Artifact bytes are unchanged; only deterministic replay hashes/outcomes are
  refrozen.
- Focused phrase/blocking tests passed 20/20. Typecheck passed; the complete
  unit project passed 78 files / 1,306 tests; exact replay passed 13 with zero
  skips/failures after the intentional LaunchRelay refreeze.

### LP-1 attempt E — PASSED (checkpoint met)

- Ran cache-distinct seven-scene retry `phase3-lp1-camera-20260711-e`
  (fallback off, continuity on, audit composition, MCP, render, temporal)
  after the attempt-D contextual-framing fix. The launching session ended
  while the probe ran; the next session picked it up live and let it finish.
  Total wall clock 12:23–12:47 AM (~24 min).
- Storyboard: **accepted on the first logical attempt** (1 logical / 4
  physical — two transient request failures and one hedge were environmental).
  The accepted plan is exactly the brief's shape: 7 scenes, one focal subject
  each, ≤1 lens route per scene, one plugin in scene 2 only. Two L2
  degradations (time-ramp drop + redundant-beat drop on `approval-button`)
  were bounded and correct.
- Source: attempt 1 browser-rejected with exactly one finding
  (`motion_jerk_excess`, `gathered-workspace` t=3.60s, 4 high-jerk focal
  gestures / 0.18 per second); attempt 2 patch re-reported the identical
  signature and the ladder early-shipped with `stagnant-polish-early-ship`
  penalty 5. Disposition `published-degraded`, `runtimeValid=true`,
  `qualityResidue=1`, 9 logical / 13 physical calls, 20.2s MP4 rendered.
- **LP-1 triage vs LP-0 (SignalDock), all four gate criteria pass:**
  - Phrase collapse: 2 full camera moves across 7 scenes, ≤1 primary route
    per scene (LP-0: 14 phrases / 4 scenes). Blocking overlay shows one
    phrase banner per scene with on-target landing crosshairs.
  - Primary readable landings **7/7** (LP-0: 4/8).
  - Occupancy in range **7/7**, per-scene 7.1–19.8% (LP-0: 9/14).
  - QA classes: one warning, `motion_jerk_excess` — registry-known, no new
    class (LP-0: 8 warnings). Peak speed 0.776 diag/s (LP-0: 2.798), 3 jerk
    markers (LP-0: 30), 0% dead eligible runtime (LP-0: 26.7%).
- Sentinel follow-through on the repeated finding: the exact rejected
  artifact replays clean through the strict static path
  (`source:replay` — statically valid, 9 known `overlapping_gsap_tweens`
  advisories); the jerk signature is a browser continuous-motion class whose
  prescribed fix ("remove the corrective camera move or competing transform,
  keep one minimum-jerk route") is precisely S8.4's gesture-settle contract.
  Logged as known residue feeding S8.4; artifacts preserved under
  `planning/attempts/` and `qa-cache/`.
- Motion pass residue (Phase 8 material, NOT camera classes): count-up
  numerals render at the frame edge outside their cards in `signal-45` and
  `resolved-89`; `owner-verification` is near-black with small low-contrast
  rows; swipe covers show loud full-frame wallpaper tiling → S8.1/S8.6.
  No reset flicker regressions; state work remains Phase 4.
- Post-probe verification at HEAD: typecheck, full unit suite (78 files /
  1,306 tests), and exact `replay:all` (13/0/0) all green.
- **Phase 3 is complete.** PROBE_LOG.md carries the LP-1 ledger entry; the
  REFACTOR_PLAN.md Step Journal has the checkpoint pointer.
