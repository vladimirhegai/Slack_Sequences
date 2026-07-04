# BREAKTHROUGH — Speed ramping / time remapping

Status: **BUILT 2026-07-04.** `timeRamp` is the fifth host-owned contract:
`engine/timeRamp.ts` (net-zero knot solver, warp/warpInverse, static gate) +
`templates/sequences-time.v1.js` (island-driven master wrapper at the
registration seam, injected LAST in `applyDeterministicSourceRepairs`). QA
converts time bases only at the physical-seek choke points; motionDensity and
storyboardMoments judge viewer time. Proven by `test/timeRamp.test.ts`,
`test/timeRamp.browser.test.ts` (seek-order determinism + genuine warp), a
deterministic ramp in both the fallback film and `film:demo` through the
`VERIFY_RENDER=1` MP4 gate, and a paid live create. See ROADMAP
"Speed ramping + shape-match discovery (2026-07-04)". The design below is the
plan it was built from; where details differ, the code and ROADMAP win.

Original plan (2026-07-03): re-designed after a code + renderer audit and a
live GLM 5.2 probe (see "Evidence"). Two design decisions —
**net-zero-per-scene warp** and a **nested master timeline** — collapse the
original "breaks all consumers' arithmetic at once" blast radius to a short,
enumerable list.

## Problem (unchanged)

Premium motion uses time itself for emphasis: fast into a landing, slow
motion as the key metric resolves, snap back. Today every declared second maps
affinely onto the master GSAP timeline; eases bend motion inside fixed
durations but the film's clock never bends.

## The two load-bearing design decisions

### 1. Net-zero-per-scene warp

Require `warp(t) = t` at every scene boundary: a ramp *borrows* time inside
its scene (slow-motion dip) and *repays* it before the scene ends (faster
catch-up — which is exactly the "snaps back to speed" of the reference look).
Consequences, all verified against the code:

- Total film duration is unchanged → root `data-duration`, the Slack ETA
  model, and the 6-60s storyboard contract are untouched.
- Scene windows (`data-start`/`data-duration`) are identical in both time
  bases → the thumbnail scene-visibility toggle
  (`directComposition.ts:1042-1046`) and all boundary arithmetic stay correct.
- Cut boundaries sit at scene edges, and normalization (below) keeps ramp
  windows clear of the exit/entry windows → **`cutContract.ts` needs no
  change at all** (the original plan listed it; drop it).

### 2. Nested master timeline, not "a timeline built in warped time"

Verified: the renderer discovers `window.__timelines[compositionId]` and
drives frames by seeking it (`tl.totalTime(t, true)` / `tl.seek(t, true)` in
`@hyperframes/producer` dist). So wrap at the registration seam and leave the
authored world alone:

- The author (and all four host runtimes — cuts, camera, components,
  interactions) build and compile against the **content timeline** exactly as
  today. Zero changes to any contract runtime's arithmetic.
- Host injection rewrites the registration line — the same proven mechanism
  used to inject `SequencesCuts.compile` (`compositionRunner.ts:1427-1443`) —
  into:
  `var __seqWarped = SequencesTime.wrap(tl); window.__timelines[id] = __seqWarped;`
  The RHS must stay a **bare identifier**: the producer's registration lint
  matches `window.__timelines[...] = <identifier>`.
- `SequencesTime.wrap(tl)` (new `templates/sequences-time.v1.js`): reads a
  `sequences-time` JSON island of piecewise-linear warp knots; if absent,
  returns `tl` unchanged (identity — every non-ramped film is byte-for-byte
  unaffected). Otherwise builds `gsap.timeline({ paused: true })` of the same
  total duration containing one `ease: "none"` proxy tween whose `onUpdate`
  seeks the content timeline at `warp(masterTime)`. Child time is a pure
  function of master position → frame N renders identically regardless of
  seek order. Live `timeScale` tweens remain banned (they compose
  multiplicatively under seek, not integrally — the original plan's instinct
  was right; keep the precomputed-curve rule).
- Precedent that `onUpdate` fires under the producer's frame driver: the
  camera runtime moves the world exclusively via proxy-tween `onUpdate`
  (`sequences-camera.v1.js`), and camera films render correctly today. Still,
  the dedicated browser test (below) must prove it for the wrapper.

## Typed declaration + normalization

One dip per scene, max 2 per film, never scene 1:

```
timeRamp: { atSec, slowTo (0.2-0.6), holdSec (0.3-0.9), recoverSec (0.3-1.2) }
```

`resolveTimeRampPlan(scenes)` (new `engine/timeRamp.ts`, sibling of
`resolveCutPlan`) compiles declarations into strictly monotonic
piecewise-linear knots: identity → decelerate to slope `slowTo` → hold →
accelerate above 1 to repay the borrowed time → identity by a fixed margin
before scene end. Degrade rules (drop the ramp, never the scene):

- window must fit inside `[sceneStart + 0.3, sceneEnd − exitSec − 0.6]`
  (exitSec from the scene's resolved cut) — ramps never overlap cut windows;
- if repayment needs a catch-up slope > ~2.5×, stretch recovery within bounds
  or drop;
- require a declared `StoryboardMomentV1` whose `atSec` falls inside the hold
  window — the dip must be *motivated*; check in `validateStoryboardPlan`.

Smooth the slope transitions by densifying knots (a few blend knots per
corner); piecewise-linear stays trivially invertible, which matters because
QA needs `warpInverse` constantly. Persist the resolved plan in
`motion-plan.json` and gate the island against it exactly like
cuts/camera (`island differs from the storyboard's resolved plan` pattern).

## The real remaining risk: QA time-base drift

With the two decisions above, only consumers that convert between **viewer
(output) time** and **content time** change. `engine/timeRamp.ts` exports
`warp`/`warpInverse` (the shared map — both Node and the browser runtime
compile from the same knots). The complete list, verified:

- `motionDensity.ts` — **the critical one.** Quiet-gap math must run in
  output time: a 1.0s content gap inside a 0.3× dip is 3.3s of viewer dead
  air. Convert activity windows via `warpInverse` before `mergedGaps`.
- `storyboardMoments.ts` — spacing/dead-interval floors judge the viewer's
  experience → output time; evidence *binding* tolerance compares declared
  `atSec` to timeline activities → content time. Keep the two conversions
  explicit.
- `directComposition.ts` `thumbnailCaptures` — settled-moment capture times
  are content time; the page seeks the registered (master) timeline → convert
  with `warpInverse`. The scene-visibility toggle needs no change (boundaries
  are fixed points).
- `layoutInspector.ts` — browser QA seeks the master (output time); its
  cut/camera suppression windows and interaction sample times come from
  content-time plans → convert the windows once where they are assembled
  (`:1415-1422`).
- `temporalInspector.ts` — developer-facing; annotate strips with both times.
- Render path — untouched (producer seeks the master; the wrapper does the
  rest).

Mitigation for silent drift (kept from the original plan): a lint/test that
greps for raw `startSec`/`durationSec` arithmetic against seek calls in the
files above once they import the map.

## Files that change (corrected list)

- **New:** `engine/timeRamp.ts` (schema, normalization, resolver, warp +
  inverse, shared by Node QA and validation), `templates/sequences-time.v1.js`
  (island parse + `wrap`).
- `compositionRunner.ts` — storyboard schema/prompt vocabulary +
  registration-rewrite injection + island injection.
- `directComposition.ts` — validation wiring (resolved-plan gate), runtime
  file allowlist (`referencedLocalPaths` check + `copyRuntimeAndAssets` +
  checkpoint/undo sidecar lists), thumbnail seek conversion.
- `motionDensity.ts`, `storyboardMoments.ts`, `layoutInspector.ts`,
  `temporalInspector.ts` — time-base conversions above.
- **Not** `cutContract.ts` (net-zero + window constraint make it a
  non-consumer).
- Tests: unit tests for the knot solver (net-zero property, monotonicity,
  inverse round-trip); a **seek-order browser test** — seek the master at a
  shuffled frame sequence across a ramp and assert pixel/transform equality
  with in-order seeks; a `motionDensity` test proving a content-quiet dip is
  flagged in output time.
- The model-free fallback/`film:demo` fixture should ship one deterministic
  ramp — the fallback film is this codebase's proof path for every contract
  (camera world precedent), and it exercises render + Docker gates without a
  model.

## Order of work

1. `timeRamp.ts` solver + unit tests (pure Node, no browser).
2. Runtime + registration rewrite + seek-order browser test.
3. QA conversions (motionDensity → moments → thumbnails → layoutInspector),
   each with a focused test.
4. Prompt vocabulary + storyboard validation; then one paid live create.
5. `film:demo` fixture ramp + render/Docker gate (`VERIFY_RENDER=1`).

## Risks

- Silent QA drift if one consumer skips the map — worse than no feature. The
  conversion list above is exhaustive *today*; re-verify against new
  consumers at implementation time (grep for `.seek(` and `startSec`
  arithmetic).
- The wrapper adds one indirection every rendered frame (`onUpdate` → child
  seek). Cost is one extra timeline render per frame — measure in the
  `VERIFY_RENDER` benchmark, but camera films already do far more work per
  `onUpdate`.
- GSAP nuance: the child must never be registered in `__timelines` (double
  driving) and must stay `paused: true`; the master must be the only
  registered timeline. The injection must also keep
  `gsap.timeline({paused:true})` present for the static invariant check —
  both timelines satisfy it naturally.
- Audio (future): any soundtrack work needs the same remap — note it in the
  runtime's header comment.
- Scope discipline: ONE dip per scene, cap 2 per film — rhythm, not chaos.

## Evidence (2026-07-03 live probe, z-ai/glm-5.2 via OpenRouter)

Two independent storyboard probes offered the `timeRamp` vocabulary with the
net-zero rules. Both runs: GLM placed exactly one ramp, on the
metric-landing scene (the film's most important resolve), with sane values
(`slowTo` 0.3, window ending ≥2s before scene end, never scene 1), and put a
declared moment at/near the hold window. The planner half of this feature is
low-risk; the engineering is the deterministic wrapper + the QA time-base
conversions.
