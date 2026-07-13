---
name: studio-looks
description: Add or revise a Sequences design dialect or production background policy with coherent palette, type, material, motion, camera, transition, frame-design retrieval, Studio presentation, and integration tests. Use for work on the Looks tab, DESIGN_DIALECTS, or background policies.
---

# Author a Studio look

1. Read `apps/slack/CLAUDE.md`, `studio/ERGONOMICS.md`, `studio/INTEGRATION.md`, `src/engine/designDialects.ts`, and `src/engine/frameDesign.ts`.
2. Run `npm run catalog --workspace @sequences/slack -- new looks <kebab-id>`.
3. Add one complete dialect to `DESIGN_DIALECTS`: canvas policy, accessible palette, material profile, embedded type system, visual grammar, distinct macro/camera/micro/transition motion, tones, keywords, rules, and provenance refs.
4. Keep source references as research provenance only. Do not copy marks, proprietary UI, or unlicensed media. Production backgrounds require catalog metadata and a license notice.
5. Confirm frame design can select it from tones/keywords and Studio renders it from the same catalog. Register any new finding class in `sentinel.ts`.
6. Add coverage in `test/designDialects.test.ts` (or nearest frame-design suite) and `test/studioCatalogIntegration.test.ts`.

Run the focused tests, `npm run typecheck --workspace @sequences/slack`, then inspect the Looks tab at `npm run studio --workspace @sequences/slack`.

Proven means selection metadata is reachable, contrast/type rules are coherent, the motion language differs from existing dialects, and no parallel Studio-only copy exists.
