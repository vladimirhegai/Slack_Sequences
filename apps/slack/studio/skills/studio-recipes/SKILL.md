---
name: studio-recipes
description: Create, polish, gate, export, or re-prove a Sequences Studio motion recipe from a single .recipe.html source, including retrieval triggers, parameter slots, deterministic GSAP, production injection, QA thumbnails, and exported RecipeV2 artifacts. Use for work on the Recipes tab or sequences-recipes library.
---

# Author a Studio recipe

1. Read `apps/slack/CLAUDE.md`, `recipes/README.md`, `studio/ERGONOMICS.md`, and `studio/INTEGRATION.md`.
2. Run `npm run recipes --workspace @sequences/slack -- new <kebab-id>` and edit only the created `recipes/<id>.recipe.html` source.
3. Build a legible final CSS state first. Animate with one paused deterministic GSAP timeline; use bounded, fast SaaS-commercial timing and leave a readable settle.
4. Declare narrow params and honest positive/negative sanity briefs. Never author host islands, camera/cursor runtimes, network access, timers, or infinite repeats.
5. Run gate, inspect every thumbnail and the live preview, then export. Commit source and generated `skills/sequences-recipes/<id>/` together.

Run:

```powershell
npm run recipes --workspace @sequences/slack -- gate <id>
npm run recipes --workspace @sequences/slack -- export <id>
npm run test:unit --workspace @sequences/slack -- test/recipeSource.test.ts test/recipeContract.test.ts
```

Proven means the exact production injection path passes static and browser QA, thumbnails show coherent motion, reverse seeking is stable, retrieval sanity passes, and exported hashes/fences match the source.
