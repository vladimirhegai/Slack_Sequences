---
name: studio-assets
description: Add or revise a Sequences parametric asset using defineAsset, typed parameters, compiled spring animations, plugin lowering, planner vocabulary, Asset Lab proof, Sentinel coverage, and integration tests. Use for work on the Assets tab or ASSET_LIBRARY.
---

# Author a Studio asset

1. Read `apps/slack/CLAUDE.md`, `studio/ERGONOMICS.md`, `studio/INTEGRATION.md`, and one sibling in `src/engine/assets/`.
2. Run `npm run catalog --workspace @sequences/slack -- new assets <kebab-id>`.
3. Implement `src/engine/assets/<camelId>.ts` with `defineAsset`. Keep params bounded, markup local/offline, stable `data-part` names, and motion tracks limited to supported properties.
4. Export and register it once in `src/engine/assets/index.ts`. The array is the source for planner vocabulary, plugin bridge, cache key, QA, and Studio.
5. Use a named spring from `motionSpring.ts`; do not hand-roll time-based loops. Register new finding codes in `sentinel.ts`.
6. Add contract/render coverage in `test/assetContract.test.ts` or the closest asset suite, plus `test/studioCatalogIntegration.test.ts`.

Run:

```powershell
npm run test:unit --workspace @sequences/slack -- test/assetContract.test.ts test/studioCatalogIntegration.test.ts
npm run typecheck --workspace @sequences/slack
npm run studio --workspace @sequences/slack
```

Proven means module-load validation passes, defaults render legibly, each animation compiles deterministically, the plugin bridge can lower it, and Studio shows it without a second registry.
