---
name: studio-plugins
description: Add or revise a parameterized Sequences host plugin generator, including bounded params, deterministic seeded content, lowering to typed components/beats, budgets, planner/schema derivation, host injection, duplicate absorption, Studio examples, Sentinel registration, and tests. Use for work on the Plugins tab or PLUGIN_CATALOG.
---

# Author a Studio plugin

1. Read `apps/slack/CLAUDE.md`, `studio/ERGONOMICS.md`, the Plugin pipeline section of `studio/INTEGRATION.md`, and `src/engine/pluginContract.ts`.
2. Run `npm run catalog --workspace @sequences/slack -- new plugins <kebab-id>`.
3. Add one `PLUGIN_CATALOG` spec with a crisp purpose, bounded params, a concrete `planningLine`, and a pure deterministic `lower(ctx)` implementation. Use `ctx.rng`/`seedContent.ts`, never `Math.random`.
4. Lower into existing component kinds and typed beats; return one coherent markup unit with stable part ids. Respect per-film component/plugin budgets, camera-arrival entrance timing, duplicate absorption, and exact-copy suppression.
5. Catalog membership automatically drives schema enum, planner vocabulary, module-load lowering probe, host injection, and Studio. Add a visible declaration example when the defaults are not self-explanatory. Register new findings in `sentinel.ts`.
6. Prove normalization, defaults, bounds, deterministic lowering, injection, and browser behavior in `test/pluginContract.test.ts`, `test/pluginRuntime.browser.test.ts`, and `test/studioCatalogIntegration.test.ts`.

Example declaration:

```json
{"version":1,"kind":"dashboard-grid","id":"proof","region":"metric-wall","params":{"tiles":4,"emphasis":"mixed","topic":"deploy speed"}}
```

Run focused unit/browser tests and `npm run typecheck --workspace @sequences/slack`. Proven means one declaration survives parse, lowers within budget, injects one host unit, seeks deterministically, and appears in Studio with usable example JSON.
