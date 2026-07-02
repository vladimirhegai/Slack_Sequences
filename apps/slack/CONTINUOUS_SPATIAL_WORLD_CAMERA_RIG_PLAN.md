# Continuous Spatial World / Camera Rig Handoff

## Start Here
- `src/engine/compositionRunner.ts`: storyboard contract, direct-authoring prompt, source repair loop, host runtime injection.
- `src/engine/directComposition.ts`: publication gate, manifest, `motion-plan.json`, checkpoints, thumbnails/renders.
- `src/engine/layoutInspector.ts`: browser spatial QA, relational layout audit, cut-window suppression.
- `src/engine/cutContract.ts` and `src/engine/templates/sequences-cuts.v1.js`: typed boundary ownership and cut runtime.
- `src/engine/interactionContract.ts` and `src/engine/templates/sequences-interactions.v1.js`: camera-world/camera-overlay cursor geometry.
- `src/engine/motionDensity.ts` and `src/engine/temporalInspector.ts`: static liveness and rendered motion evidence.

## Current Useful Facts
- Authored scenes already use `data-scene`, `data-start`, `data-duration`, stable `data-part`, optional `spatialIntent`, and optional typed `cut`.
- Product content that moves under camera transforms belongs in `data-camera-world`; cursor/runtime overlays belong in `data-camera-overlay`.
- Host-owned runtimes are injected deterministically from the locked storyboard/source contract; authored scene-wrapper tweens can conflict with cut ownership.
- `frame.md` already gives flow layouts, semantic zones, safe-area tokens, and spatial character language.
- `motion-plan.json` persists shots, interactions, cuts, runtime hashes, and motion-density summary.

## Verification Pointers
- `npm run typecheck --workspace @sequences/slack`
- `npm run test --workspace @sequences/slack`
- `npm run direct:demo --workspace @sequences/slack`
- `npm run film:demo --workspace @sequences/slack`
- `npm run sequence:check --workspace @sequences/slack -- --demo --no-mcp --format both`
