---
name: studio-camera
description: Add, revise, or tune a curated Sequences typed camera pattern with spatial stations, non-linear operated motion, readable landings, planner vocabulary, production contract resolution, Studio playback, and tests. Use for work on the Camera tab or CAMERA_PATTERNS.
---

# Author a Studio camera pattern

1. Read `apps/slack/CLAUDE.md`, `studio/ERGONOMICS.md`, `studio/INTEGRATION.md`, `src/engine/cameraPatterns.ts`, and the public types in `cameraContract.ts`. Avoid runtime/blocking edits unless the brief explicitly requires them.
2. Run `npm run catalog --workspace @sequences/slack -- new camera <kebab-id>`.
3. Add a pattern with a clear story role, 2–4 non-overlapping stations, a continuous path from second zero, and exact duration coverage. Station ids must close over every `fromRegion`/`toRegion`.
4. Favor a decisive 0.45–1.2s reframe using `seqSwoosh`, `seqWhip`, `seqSettle`, or `seqAnticipate`, followed by a short legible settle/drift. Avoid long equal-speed motion, serial pan-then-zoom, or gratuitous oscillation.
5. Confirm the planner vocabulary and Studio Camera tab derive from `CAMERA_PATTERNS`; add the id to `test/cameraPatterns.test.ts` and integration coverage.

Run:

```powershell
npm run test:unit --workspace @sequences/slack -- test/cameraPatterns.test.ts test/cameraContract.test.ts test/studioCatalogIntegration.test.ts
npm run typecheck --workspace @sequences/slack
```

Proven means the production resolver accepts it, targets are closed-world, timing is contiguous, motion has a motivated energy curve, and the Studio scrubber can seek it.
