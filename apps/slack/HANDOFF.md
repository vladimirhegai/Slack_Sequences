# HANDOFF — next Fable session (written 2026-07-03, hardened same day)

Previous sessions implemented `BREAKTHROUGH_match_cut.md` **v1** (shape-match
cuts) and `BREAKTHROUGH_camera_depth.md` **level 1 + rack focus** (orbit,
`data-depth`, `focus` modifier), commit `9d24e47`, published to
`Slack_Sequences`, deployed to Railway (healthy). A hardening pass then
re-verified every seam named below against the live code and fixed one latent
bug (`parseCutPlan` dropped `cut[1]` when `cut[10]`+ erred — prefix collision;
count-based check now, suite green 272/272).

**Where this file disagrees with a BREAKTHROUGH doc, this file wins** — it is
newer and every anchor below was re-checked against the code on 2026-07-03.

## Shipped since: the blank-film guard (2026-07-03 evening)

A live `/sequences` create published an **empty film**: the storyboard
promised a full-frame dashboard, the authored HTML never put it on frame, and
QA passed because focal validation only checked nonzero size + opacity
(never viewport intersection), off-frame camera-world findings are
deliberately suppressed, and the author pipeline publishes any runtime-valid
draft after repairs. Fixed in `layoutInspector.ts`:

- `measureContentCoverage` — DOM-rect grid coverage (32×18 cell centers) of
  meaning-bearing content (text / media / `data-part`) per QA sample.
  **Deliberately not screenshot pixels**: the cinema kit guarantees grain +
  vignette on every frame, which defeats naive pixel-variance blankness;
  DOM coverage is deterministic and cheap. Known accepted blind spots:
  ancestor `overflow:hidden` clipping and background-colored text still
  count as coverage — the incident class (absent/off-frame content) is what
  this catches.
- A scene ≥1.2s whose every eligible sample (scene body, outside
  cut/camera/component motion windows) is under 0.5% coverage →
  `near_blank_scene` **warning** (feeds the repair loop). Blank scenes
  totalling ≥30% of the film, or one blank scene ≥4s → `near_blank_film`
  **blocking error** in `browserQa.errors` — after bounded repairs the create
  throws and the **labeled deterministic fallback ships instead of an empty
  result** (no new routing; that is the existing `authorComposition` →
  orchestrator contract).
- Focal audit (`auditFocalParts`): severity info→**warning**, plus
  `spatial_focal_offframe` (<50% on-frame at the hero frame) and
  `spatial_focal_minor` (<0.5% of frame area) — both skipped when the part
  rides a transformed camera world (the rig may frame it later; the
  near-blank guard covers a camera that frames nothing).
- Tests: blank-scene warning, blank-film block, minimalist-title-card
  negative (`test/layoutInspector.test.ts`); thresholds are named constants
  above `normalizeHyperframesIssue`. Full gate re-run green (275 tests,
  film:demo, mcp:demo, direct:demo, sequence:check).

**Goal A interplay:** coverage sampling rides the existing sample loop and
`seekTo`, so the time-ramp conversion (below) covers it for free. If you
tune thresholds, re-run film:demo + the title-card test first — the guard
must never flag a deliberate minimalist beat.

## Read first, in this order

1. [CLAUDE.md](CLAUDE.md) — the two bots, isolation rule, determinism
   boundary, **verification ladder** (you will re-run it), publish-vs-deploy.
2. [BREAKTHROUGH_speed_ramping.md](BREAKTHROUGH_speed_ramping.md) — Goal A
   background. Design decisions stand; the QA-conversion plan is superseded
   by "the seekTo choke point" below.
3. [BREAKTHROUGH_match_cut.md](BREAKTHROUGH_match_cut.md) — v1 is DONE; only
   "v2 — discovery" remains, and its delivery mechanism is redesigned below
   (the critic cannot re-declare a cut; measured host-side upgrade can).
4. [ROADMAP.md](ROADMAP.md) "Shape-match cuts + camera depth (2026-07-03,
   second pass)" — inventory of what v1 shipped and its proof.

## Goal A — speed ramping / time remapping (the big one)

The two load-bearing decisions are made — do not relitigate:

- **Net-zero-per-scene warp** (`warp(t) = t` at every scene boundary). Bonus
  property to exploit: the solver requires identity *slope and value* from
  ramp-window end to scene end, so `warp(t) = t` exactly on
  `[sceneStart, rampStart]` and `[rampEnd, sceneEnd]` — cut exit/entry
  windows are pure identity regions, which is why `cutContract.ts` is a
  non-consumer.
- **Nested master timeline** wrapped at the registration seam:
  `var __seqWarped = SequencesTime.wrap(tl); window.__timelines[id] = __seqWarped;`
  The master is a paused `gsap.timeline` of equal duration whose single
  `ease:"none"` proxy tween seeks the content timeline at `warp(masterTime)`
  in `onUpdate` (precedent: the camera rig drives the world exclusively via
  proxy-tween `onUpdate` and renders correctly). If the `sequences-time`
  island is absent, `wrap` returns `tl` unchanged — non-ramped films are
  byte-identical in behavior.

### Verified implementation map (line numbers checked 2026-07-03)

**⚠️ Injection ordering — the one trap that will cost you a day.** All four
existing compile-call injections anchor on the regex
`window.__timelines[...] = <contentTimelineName>;` —
interactions `compositionRunner.ts:1379-1395`, cuts `:1440-1456`, camera
`:1503-1519`, components `:1570-1586` (plus the key-normalization rewrite at
`:1300-1303`). The moment you rewrite the registration RHS to `__seqWarped`,
none of those anchors match. **The time-wrap rewrite must be the LAST
injection step** inside `applyDeterministicSourceRepairs`
(`compositionRunner.ts:1208`; the injections above are all inside it). Add a
regression test that runs a storyboard with cuts + camera + components +
interactions + a ramp through the repair pass and asserts all five compile
calls landed.

- **New `engine/timeRamp.ts`** — mirror `cutContract.ts` exactly: schema type
  (`SceneTimeRampIntentV1`), `normalizeStoryboardTimeRamp`, `resolveTimeRampPlan`,
  `TIME_RUNTIME_FILE`/`timeRampRuntimeSource()`/hash, `parseTimeRampPlan`,
  `validateTimeRampContract` (island byte-equality against the resolved plan,
  same as `cutContract.ts:324`), and **`warp`/`warpInverse`** compiled from
  the same knots on both sides (Node QA + browser runtime must share the knot
  math — generate the runtime's knot table from the island only, never
  duplicate solver logic in JS).
- **New `templates/sequences-time.v1.js`** — island parse + `wrap`. Must pass
  the source-hygiene grep (no `Date.now|setTimeout|Math.random|rAF`). Child
  timeline must never be registered and must stay `paused:true`. Header
  comment: any future audio needs the same remap.
- `compositionRunner.ts` — `timeRamp` joins `parseStoryboard` at `:1793`
  (sibling of `normalizeStoryboardCutIntent`); structured-output schema in
  `storyboardResponseFormat` (`:111`, model the `cut` property at `:145-160`);
  requirement flag in `StoryboardPlanRequirements` (`:1876`) +
  `inferStoryboardPlanRequirements` (`:2279`) + `validateStoryboardPlan`
  (`:1888`) — the moment-motivated-dip check lives here; prompt vocabulary in
  `basePrompt` (`:2390+`); **bump `contract: 5` → `6` at `:2363`**; island +
  runtime-tag + registration-rewrite injection (copy the cut pattern at
  `:1406-1463`, island before the first inline timeline script, runtime tag
  after `gsap.min.js`).
- `directComposition.ts` — four allowlist/copy seams for the new runtime
  file: validation allowlist `:483-489`, `copyRuntimeAndAssets` `:548`,
  checkpoint copy `:830`, sidecar restore list `:856-862`. Wire
  `validateTimeRampContract` beside `validateCutContract` at `:449`. Persist
  the resolved plan in `motion-plan.json` (written at `:741`, checkpointed
  `:824`, sidecar `:858`). Static invariants at `:358` (inline
  `gsap.timeline({paused:true})`) and `:361-381` (registration) both still
  pass with the rewritten registration — verified by reading them; prove it
  in the browser test anyway.

### The seekTo choke point (supersedes the doc's QA-conversion plan)

The complete set of places that physically seek the registered timeline,
verified by grep (`\.seek\(` over `src/`):

1. `layoutInspector.ts:301` — local `seekTo` helper (all QA sampling).
2. `temporalInspector.ts:98` — local `seekTo` helper (cut sheets, strips).
3. `directComposition.ts:1066-1080` — `generateDirectThumbnails` evaluate.
4. `thumbs.ts:139` — legacy Plan path only (`/sequences demo`); ramps can
   never occur there — leave it, with a one-line comment saying why.
5. `fallbackComposition.ts:379` — `tl.seek(0)`; 0 is a fixed point.

**Convert output↔content time inside those helpers and nowhere else**: every
caller keeps passing content time; `seekTo` applies `warpInverse` before the
physical seek. Consequences, all verified: the layoutInspector suppression
windows (`:1440-1448`) compare content-time `issue.time` against content-time
cut/camera/component windows — **no change needed** (the old doc's plan to
convert windows at assembly, and its `:1415-1422` pointer, are both stale —
that region is interaction-replay code now). The thumbnail scene-visibility
toggle inside the same evaluate is safe automatically: warp maps each scene
window onto itself monotonically, so the converted seek time stays inside the
same scene.

The two places that need *genuine* output-time math (a 1.0s content gap
inside a 0.3× dip is 3.3s of viewer dead air):

- `motionDensity.ts` — convert activity window endpoints via `warpInverse`
  before `mergedGaps` (`:359`) and `longestSceneQuietGap` (`:395`).
- `storyboardMoments.ts` — spacing/dead-interval floors
  (`validatePlannedMoments` `:151`, `intervalErrors` `:217`) judge the viewer
  → output time; evidence *binding* compares declared `atSec` to timeline
  activities → content time. Keep the two conversions explicit and named.

`temporalInspector.ts` is developer-facing: route through its `seekTo` and
annotate strips with both time bases; don't over-engineer.

### Order of work (follow literally)

1. `timeRamp.ts` solver + unit tests (pure Node: net-zero property,
   monotonicity, inverse round-trip, degrade rules — catch-up slope >2.5×
   drops the ramp, window clamped to
   `[sceneStart+0.3, sceneEnd−exitSec−0.6]`, moment-motivated hold).
2. Runtime + registration rewrite (LAST in the injection order) + the
   all-five-contracts injection regression test + a **seek-order browser
   test**: shuffled frame sequence across a ramp, assert transform equality
   with in-order seeks (copy the shape of `cameraDepth.browser.test.ts`).
3. `seekTo` conversions + motionDensity/moments output-time math, each with a
   focused test (one proving a content-quiet dip is flagged in output time).
4. Prompt vocabulary + schema + validation + cache bump; then one paid live
   create (planner adoption is already probe-proven — GLM placed sane ramps
   twice; save the paid call for last).
5. Deterministic ramp in `fallbackComposition.ts` + `film:demo` fixture, then
   the render/Docker gate (`VERIFY_RENDER=1 npm run film:demo`) — the
   fallback film is the proof path for every contract.

Budget note: the declaration stays ONE dip per scene, max 2 per film, never
scene 1 — rhythm, not chaos. Where the doc and your judgment differ on knot
smoothing (blend-knot count, exact margins), your judgment wins; the
invariants that are not negotiable are net-zero, monotonicity, invertibility,
and identity outside the ramp window.

## Goal B — shape-match v2: measure-then-upgrade

v1 is *declare-then-hope* and the live probe showed the failure: GLM planned
a perfect pill→bar pair, DeepSeek authored the bar 11× too wide, the
bind-time audit degraded it to zoom-through. Film sound, premium cut gone.
v2 inverts: measure the authored film, then upgrade a boundary that
*provably* rhymes.

### Mechanics discovered by reading the critic path — read this before designing

The old plan ("emit advisory findings, the critic directs a re-declaration
patch") **cannot work as written**. Verified mechanics:

- Critic directives are free-form strings (`CRITIC_RESPONSE_FORMAT`
  `compositionRunner.ts:3566`, `parseCritique` `:3587`) applied by DeepSeek
  as *source patches* (`applyContinuityCritique` `:3694`).
- The patch is then re-run through `applyDeterministicSourceRepairs` with the
  **locked** storyboard (`:3745`) and validated against it — and
  `validateCutContract` requires the `sequences-cuts` island to equal
  `resolveCutPlan(storyboard)` byte-for-byte (`cutContract.ts:324`). A patch
  that edits the island desyncs and bounces; a patch that doesn't leaves the
  cut unchanged. The critic prompt also forbids restructuring. This is
  exactly why the live run's critic patch was rejected atomically.
- But: `lockedSceneGraphError` (`:666`) checks only scene count/ids/timing —
  **cut declarations are not part of the locked graph**. The host may mutate
  `scene.cut` and re-inject deterministically.

### Recommended design — deterministic host-side upgrade (no model in the loop)

1. **Inventory** (in `layoutInspector.ts` `inspectDirectComposition`): for
   each boundary, seek `atSec − 0.15` and collect every visible
   `data-part` in the outgoing scene (name, viewport rect, resolved
   border-radius, subtree node count); seek `atSec + entrySec` for the
   incoming scene. Reuse the measurement idioms from `shapeMatchAudit` +
   `radiusPx` (`templates/sequences-cuts.v1.js:229-284`). Return it on the
   inspection result as a new field. Note this is *strictly better* data than
   the bind-time audit, which measures load state.
2. **Score** (new `engine/cutDiscovery.ts`, pure Node, unit-testable):
   candidate pairs per boundary. Suggested policy — creative freedom on the
   weights, keep the caps: aspect-ratio distance (hard cap 2.0×, tighter than
   the runtime's 2.5× so our own choice never triggers the degrade),
   both mostly on-frame, node count ≤60 each, area ratio bounded, radius
   similarity as the rhyme score; prefer parts that are component ids or the
   scene's `continuityAnchor`. **Only upgrade boundaries currently `hard` or
   directional** — never replace zoom/flash/object-match some planner chose
   deliberately. Max ONE upgraded boundary per film: premium cuts read
   premium because they are rare.
3. **Upgrade**: mutate that scene's `cut` to
   `{version:1, style:"shape-match", focalPartOut, focalPartIn}` (through
   `normalizeStoryboardCutIntent` so it is typed), re-run
   `applyDeterministicSourceRepairs` + `validateDirectComposition` + browser
   QA **with the mutated storyboard**, and — critically — pass the mutated
   storyboard to everything downstream (moments, motion-plan.json,
   STORYBOARD.md, the persisted `planning/storyboard.json`): a stale
   storyboard artifact that disagrees with the shipped island is the desync
   bug wearing a new hat. If QA regresses, keep the pre-upgrade draft
   (enhancement-never-veto, same as every contract).
4. Hook point: in `requestDirectComposition` (`:3768`) around
   `applyContinuityCritique` — I suggest **before** the critic, so the critic
   reviews the film that will actually ship; optionally list the upgrade in
   its evidence pack so it can veto by directing a repair. The runtime's
   bind-time audit remains the final safety net.

If you strongly prefer the critic-in-the-loop variant, the constraint is:
directives must gain a *typed* micro-grammar the host parses (e.g.
`upgrade-cut <fromScene> <partOut> <partIn>`), the host performs step 3
itself, and DeepSeek never touches island or storyboard. That is more moving
parts for a judgment the score already encodes; I recommend the deterministic
path with critic veto.

Tests: unit tests for scoring/policy; a browser test with a `hard` boundary
whose scenes carry a measurable rhyming pair (assert upgrade + flight) and a
deliberately mismatched film (assert no upgrade). Test styling via classes,
not `data-part` attribute selectors — bridge clones strip `data-part`.

## Not goals (fenced off deliberately)

- Camera depth **level 2** (per-layer `translateZ` under `preserve-3d`) —
  requires relocating whip blur off the world element first; own plan needed.
- Live `timeScale` tweens for ramping — banned; not seek-safe.
- Sound/audio — but `sequences-time.v1.js` gets the header note.

## How this codebase works (10-line orientation)

- Everything premium is a **host-owned typed contract**: planner (GLM)
  declares typed intent in the storyboard → a resolver in
  `src/engine/*Contract.ts` normalizes it → `compositionRunner.ts` injects a
  JSON island + versioned runtime (`src/engine/templates/sequences-*.v1.js`)
  + compile call from the *locked* storyboard → static validation proves the
  island matches the resolver's output byte-for-byte → browser QA
  (`layoutInspector.ts`) proves it runs. Four exist: cuts, camera,
  components, interactions. Speed ramping becomes the fifth; copy the pattern
  (`cutContract.ts` is the cleanest template).
- **Enhancement-never-veto**: an unbindable declaration degrades (to `hard`,
  to no camera plan, to zoom-through), never fails the film.
- **Deterministic seek** is the one hard law: every runtime value must be a
  pure function of timeline time (fromTo + `immediateRender:false`, proxy
  tweens with `onUpdate`; no clocks/timers/rAF state). A source-hygiene test
  greps the templates for `Date.now|setTimeout|Math.random|rAF`.
- Model prompts: storyboard vocabulary lives in `compositionRunner.ts`
  (`basePrompt` `:2390+`, plus the structured-output JSON schema `:111` —
  **both** must change together); authoring rules live in
  `prompts/planning-director.md`; per-storyboard deterministic guidance in
  `lockedLayoutGuidance()` (`:3081`).

## Lessons learned (will save you hours)

1. **Brief-derived requirements beat prose.** GLM only reaches for a new
   typed feature reliably when `inferStoryboardPlanRequirements` turns brief
   phrases into blocking `validateStoryboardPlan` errors (see
   `requireShapeMatch`/`requireRackFocus`). Free-form "focus onto the
   rollback control" got reinterpreted as `track-to-anchor`.
2. **Bump the storyboard cache `contract` version** (`:2363`, now v5)
   whenever the storyboard shape changes, or stale cached plans mask your
   change.
3. **Vitest root gotcha**: never `npx vitest run --root ../..` from the
   monorepo root — it sweeps in the gitignored `.publish/` mirror and breaks
   `@hyperframes/core` resolution. Always
   `npm run test --workspace @sequences/slack -- <files>` (note: the runner
   may execute the full suite anyway; it's ~60s including browser tests).
4. **`sequence:check` job dirs are immutable** — a retried live probe needs a
   fresh `--job-id` (and re-spends the concept call).
5. **Paid live probe recipe**: set `$env:OPENROUTER_API_KEY`, then
   `npm run sequence:check --workspace @sequences/slack -- --product ...
   --what "<brief>" --provider openrouter-api --no-mcp --job-id <id>
   --format both`. ~5–10 min. Inspect
   `.data/projects/<id>/planning/storyboard.json` (what GLM declared) and the
   report's `authoringMode`/`fallbackStage` (whether it really published).
6. **Floating point is a production hazard here**: the pinned linter rejected
   `7.4 + 4.2 = 11.600000000000001` as an overlapping clip and burned an
   entire authoring repair loop on a phantom the repair model could not see.
   Fixed via `isFloatingPointClipOverlap` in `directComposition.ts`. When a
   repair loop fails 3× on the *same* finding, suspect the finding.
7. **DeepSeek does not keep silhouette/geometry discipline** from prose
   guidance alone — that is *why* v2 upgrades from measured geometry instead
   of trusting authored geometry.
8. **Test styling via classes, not `data-part` attribute selectors** — bridge
   clones strip `data-part`, so attribute-styled fixtures produce invisible
   bridges.
9. Finish = commit → `bash scripts/publish-public.sh "<msg>"` (publishes
   HEAD; commit first) → `railway up` (publish does NOT deploy) → poll
   `railway deployment list` for the new id (old instance answers `ready` on
   `/healthz`, so health alone proves nothing about the new build).
10. **Injection anchors are load-bearing**: four compile-call injections and
    the key normalization all pattern-match the registration line. Any change
    to how the timeline is registered must come after them (see Goal A) and
    be covered by the all-five-contracts regression test.

## Verification bar for both goals

Slack source gate (CLAUDE.md §1) green + a focused browser test proving
seek-order determinism of the new runtime + one paid live create before
claiming planner adoption (Goal B's recommended design needs **no** planner
adoption — its live create only proves the pipeline end-to-end). For speed
ramping additionally run the render/Docker gate
(`VERIFY_RENDER=1 npm run film:demo`) since it touches the frame driver, and
ship one deterministic ramp in the fallback film — the fallback is the proof
path for every contract.
