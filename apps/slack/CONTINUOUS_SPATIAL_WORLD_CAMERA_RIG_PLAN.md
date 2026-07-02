# Continuous Spatial World / Camera Rig Handoff

Status: shipped, verified, and committed in `cf0094b` (`feat(slack): continuous spatial world / camera rig`).

## Concept, as shipped
- The video frame is a fixed camera viewport.
- A scene's `data-camera-world` is a larger finite plane with named `data-region`
  stations for product UI, copy walls, stat moments, and CTA beats.
- The viewer never sees the whole world at once; the storyboard declares a typed
  per-scene camera path and the host-owned runtime executes it deterministically.
- This follows the same architecture law as typed cuts: the model plans intent,
  the host owns the mechanics.

## Start Here
- `src/engine/cameraContract.ts`: typed camera schema, defaults, gap-filling
  resolver, island validation, double-ownership warnings, runtime injection.
- `src/engine/templates/sequences-camera.v1.js`: seek-safe runtime that measures
  regions/parts in world space, frames them with fit-zoom + margins, compiles
  proxy `fromTo` chains, applies parallax counter-motion, and adds the subtle
  2.5D `orbit-lite` rotation arc.
- `src/engine/compositionRunner.ts`: storyboard contract, direct-authoring
  prompt, deterministic injection of the camera island/runtime/compile call, and
  global registration of the Sequences ease library.
- `src/engine/directComposition.ts`: publication gate, manifest,
  `motion-plan.json`, checkpoints, thumbnails, and render entrypoints.
- `src/engine/layoutInspector.ts`: browser spatial QA, transit-aware heuristic
  suppression, and off-frame station filtering.
- `src/engine/motionDensity.ts`: static liveness pass that counts camera moves
  as beats and flags dead typed holds.
- `src/engine/fallbackComposition.ts`: model-free proof composition that ships a
  real camera world (`hold -> drift -> pan`) through the full gate.

## Camera Contract
- Supported typed moves: `hold`, `drift`, `pan`, `whip`, `push-in`,
  `pull-back`, `track-to-anchor`, `parallax-pass`, `orbit-lite`.
- The resolver normalizes each scene path into a contiguous segment chain that
  covers the full scene duration.
- Any timing gap is auto-filled with connective drift toward the next station,
  or a slow creep-zoom when there is nowhere new to go.
- Result: the camera never silently freezes unless a typed `hold` says so. The
  intended rhythm is "swoosh, slow down but keep moving, swoosh again" by
  construction.
- Publication is gated by static validation: island equality, per-scene
  world/region/part existence, and warnings when authored tweens fight the
  rig-owned world plane.

## Ease Library
- Registered in every composition, not just camera films.
- Available to camera paths and authored beats alike:
  `seqSwoosh`, `seqWhip`, `seqImpulse`, `seqSettle`, `seqGlide`, `seqDrift`,
  `seqAnticipate`, `seqMicrobounce`.
- All are pure, endpoint-exact, and unit-tested. `seqSettle`'s NaN bug was
  caught and fixed by those tests.

## Cross-System Upgrades
- Storyboards now scale 3-10 shots with a hard framing-density floor: roughly a
  new framing event (cut or camera move) every 3.5 seconds.
- Camera bindings are injected deterministically from the locked storyboard, so
  the source author cannot silently omit a planned move.
- `motionDensity.ts` classifies full camera moves as medium beats, drift as a
  minor beat, and flags any 1.6s+ typed hold with no internal action.
- `layoutInspector.ts` suppresses static-layout heuristics during camera
  transits and for stations currently off-frame, while framed content remains
  fully audited.
- Planning doctrine, world-scaffold rules, and ease vocabulary are taught in
  `prompts/planning-director.md`, the per-job `frame.md`, and
  `src/agent/skillContext.ts`.

## Verification That Ran
- `npm run typecheck --workspace @sequences/slack`
- `npm run test --workspace @sequences/slack` -> `183/183` passing after fixing
  seven expected regressions introduced during the build.
- `npm run direct:demo --workspace @sequences/slack`
- `npm run mcp:demo --workspace @sequences/slack`
- `npm run film:demo --workspace @sequences/slack`
- `npm run sequence:check --workspace @sequences/slack -- --demo --no-mcp --format both`
- Dedicated browser smoke through validate -> browser QA -> thumbnails for the
  camera-rig path.
- Not run: Railway/sandbox flows. Publish and deploy remain explicit separate
  steps.

## Current Useful Facts
- Authored scenes already use `data-scene`, `data-start`, `data-duration`,
  stable `data-part`, optional `spatialIntent`, optional typed `cut`, and now
  optional typed `camera`.
- Product content that moves under camera transforms belongs in
  `data-camera-world`; cursor/runtime overlays belong in `data-camera-overlay`.
- Host-owned runtimes are injected deterministically from the locked
  storyboard/source contract; authored scene-wrapper tweens can conflict with
  cut ownership and authored world-plane tweens can conflict with camera
  ownership.
- `frame.md` already gives flow layouts, semantic zones, safe-area tokens, and
  spatial character language for building the larger world.
- `motion-plan.json` now persists shots, interactions, cuts, resolved camera
  plan, runtime hashes, and motion-density summary.

## What Is Next
- Capability materialization + in-Slack audition.
- Live temporal evidence + bounded visual critic.
- Component contracts / morph continuity on top of the now-stable
  `data-part` / camera / cut foundation.
