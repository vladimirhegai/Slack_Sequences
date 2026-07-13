---
name: studio-components
description: Add or revise a motion-native component kind in Sequences Studio, including planner vocabulary, kit markup/CSS, typed beats, host runtime behavior, Sentinel registration, Studio discovery, and contract/browser tests. Use for work on the Components tab or COMPONENT_CATALOG.
---

# Author a Studio component

1. Read `apps/slack/CLAUDE.md`, `studio/ERGONOMICS.md`, `studio/INTEGRATION.md`, and `src/engine/componentContract.ts`.
2. Run `npm run catalog --workspace @sequences/slack -- new components <kebab-id>` and use the generated checklist/snippet. Do not edit paused apps or shared packages.
3. Add the kind to `ComponentKind`, `COMPONENT_CATALOG`, and the kit markup/CSS in `componentContract.ts`. Prefer an existing beat vocabulary; add a beat only when it represents reusable state, not decoration.
4. If runtime behavior changes, update `templates/sequences-components.v1.js`. Keep seek determinism, reverse-seek restoration, and host ownership. Register every new finding code in `sentinel.ts`.
5. Confirm the catalog drives planner vocabulary, schema enum, host injection, QA, and `studio/server.ts` automatically. Update `studio/INTEGRATION.md` only for a new seam.
6. Prove with focused unit coverage in `test/componentContract.test.ts`, browser behavior in `test/componentRuntime.browser.test.ts`, and Studio visibility in `test/studioCatalogIntegration.test.ts`.

Run:

```powershell
npm run test:unit --workspace @sequences/slack -- test/componentContract.test.ts test/studioCatalogIntegration.test.ts
npm run test:browser --workspace @sequences/slack -- test/componentRuntime.browser.test.ts
npm run typecheck --workspace @sequences/slack
```

Proven means valid catalog metadata, exact schema/planner visibility, host-owned deterministic execution, browser-observed motion, and automatic appearance in Studio.
