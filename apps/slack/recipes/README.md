# Recipe sources — the agent-authored motion-pattern library

This directory is the **source of truth for recipes**: proven, signature
motion patterns (word roulettes, iris fills, choreographed payoffs) that live
`/sequences` creates instantiate VERBATIM at Level 1 (see
`src/engine/recipeContract.ts` and `studio/INTEGRATION.md`). Recipes exist
because model authors cannot reliably re-derive intricate patterns from prose
— a coding agent builds the pattern **once, here, as a file**, proves it
through the full production gate, and the pipeline reuses it forever.

**You (a coding agent) author recipes by writing files in this directory.**
The operator does not build recipes; they review them in the studio viewer
(`npm run studio --workspace @sequences/slack`) with their own eyes.

## The loop

```bash
# 1. write/edit apps/slack/recipes/<id>.recipe.html   (format below)
# 2. prove it — the EXACT production gate: scaffold demo, host injection,
#    static validation, real browser QA, thumbnails
npm run recipes --workspace @sequences/slack -- gate <id>
# 3. LOOK at the thumbnails with your own eyes (reports have said "pass" on
#    films the operator called a mess):
#    apps/slack/.data/studio/<id>/build/thumbs/
# 4. publish to the live library skills/sequences-recipes/<id>/
npm run recipes --workspace @sequences/slack -- export <id>
# status of everything:
npm run recipes --workspace @sequences/slack -- list
```

`export` re-gates first and fails loud on a red gate, a retrieval-sanity miss
(trigger patterns matching everything or nothing), or the recipe not
surfacing through live retrieval for its own sanity brief. Non-zero exit =
not shipped.

After any engine change that touches a recipe seam (kit/runtime versions,
storyboard schema, injection order — see `studio/INTEGRATION.md`), re-prove
the library: `npm run studio:golden` re-exports the golden
`last-word-roulette`; `npm run recipes -- export --all` re-proves everything.

## File format — one recipe, one file

`<id>.recipe.html` (kebab-case id, must equal the `id` in the meta block):

```html
<script type="application/json" data-recipe-meta>
{
  "format": 2,
  "id": "<id>",
  "title": "One-line human title",
  "description": "What the pattern does, one sentence.",
  "tags": ["kinetic-type", "payoff"],
  "triggerPatterns": ["roulette", "last word"],      // case-insensitive regexes scored against briefs
  "durationWindow": { "minSec": 3.5, "maxSec": 12 }, // optional
  "componentKinds": ["headline"],                    // optional retrieval overlap signal
  "params": [ /* typed slots — see below */ ],
  "revision": 1,                                     // export bumps from the live library
  "demo":   { "durationSec": 6, "params": { /* gate-demo values for every non-default param */ } },
  "sanityBriefs": [ "A brief that SHOULD retrieve this recipe." ]
}
</script>
<template data-recipe-doc>
# <id> — retrieval knowledge (recipe.md)
What it is, when a planner should declare it, how to stage the shot, slots.
</template>
<!-- everything below is the FRAGMENT — exported byte-for-byte as fragment.html -->
<style data-recipe-style>   /* injected once into <head> */   </style>
<template data-recipe-markup>
  <!-- injected inside the declared scene; {{param}} slots are filled by the
       host ({{uid}} is the per-instance part prefix) -->
</template>
<script data-recipe-motion>
  // body runs as (tl, root, start, duration, uid) — add tweens to the ONE
  // paused master timeline; times are absolute (offset from `start`)
</script>
```

Param slot kinds (`src/engine/recipeContract.ts` `RecipeParamSpec`):
`text` (bounded by `maxChars` — reading-floor audits depend on it), `number`
(`min`/`max` clamped), `color-token` (a `var(--…)` reference only, never a raw
hex — brand safety), `enum` (`options`), `part-ref` (kebab-case `data-part`).
A param with a `default` is optional in declarations; a required param with no
usable value drops the declaration (degrade-never-veto).

## Hard rules (the gate enforces every one)

- **Determinism is non-negotiable**: no wall-clock, no requestAnimationFrame
  state, no `Math.random`, no `repeat: -1`. Every animation is a pure function
  of timeline time — the gate seeks out of order and will catch you.
- **Polish-clean by construction**: declare layout intent
  (`data-layout-important` / `data-layout-anchor`, `data-layout-ignore` on
  decor) and keep copy AA-contrast on kit surfaces. A recipe that ships polish
  findings re-imports the exact churn recipes exist to eliminate.
- **Style via classes, never `data-part` selectors** (bridge clones strip
  `data-part`); prefix classes `rcp-` to stay collision-free.
- **No CSS filters on ancestors that might sit in a 3D world**; blur lives on
  leaf nodes and releases (≤0.45s).
- Keep fragments small (≤24k chars, the >60-node lesson): a fragment is a
  pattern, not a scene.
- `engine` fences and `fragmentHash` are stamped **at export** — never write
  them into a source file.

## Where things land (derived — never hand-edit)

- `.data/studio/<id>/` — gate work dir (demo composition, browser-QA record,
  `build/thumbs/`, `gate.json`). Gitignored, regenerable.
- `skills/sequences-recipes/<id>/` — the RecipeV2 export the live pipeline
  loads: `recipe.json` (manifest + engine fences + fragment hash),
  `recipe.md` (your doc block), `fragment.html` (your fragment bytes),
  `demo.html` (the gated proof), `preview/` (thumbnail strip). Committed.
  Hand-editing a library fragment marks it stale until re-proven.

## Backlog worth building (from the plan, §5.6)

iris-fill CTA close · cursor demo click-through · notification stack cascade ·
KPI dashboard flythrough (counter rolls) · bento-grid feature reveal · pricing
table build + tier highlight · onboarding checklist tick-through ·
command-palette power-user flow · before/after wipe · terminal-to-chart
transform · headline word-swap positioning loop.
