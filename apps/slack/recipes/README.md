# Recipe sources — legacy-route motion-pattern library

This directory is the **source of truth for the explicit `legacy-provider`
route's recipes**: proven, signature motion patterns (word roulettes, iris
fills, choreographed payoffs) that the legacy planner may instantiate verbatim
at Level 1 (see `src/engine/recipeContract.ts` and `studio/INTEGRATION.md`).
The default Luna route does not receive this catalog or inject its fragments;
Luna authors the film's local DOM/CSS/SVG asset system directly. Recipes remain
available for Studio work, deterministic demos, and operator-controlled legacy
rollback.

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

## Library (shipped)

- `last-word-roulette` — locked sentence, final-word wheel spin, payoff snap.
- `iris-cta-close` — accent iris floods the end card, CTA pill ignites with a
  pop (kills the "closing CTA too small/timid" probe-feedback class).
- `metric-odometer` — hero stat digits roll on masked odometer columns with a
  wave landing (the KPI proof shot models fake with instant numbers).
- `checklist-cascade` — rows cascade in, checkmarks DRAW on in rhythm,
  completion bar sweeps (onboarding/launch-list accumulation payoff).
- `ambient-hero-opener` — a frame-filling product hero settles while
  wallpaper, depth decor, and key light keep a finite living canvas behind
  stable copy.
- `overlap-dashboard-entrance` — one dashboard assembles through a tightly
  overlapped rise/follow chain, then develops into a chart payoff.
- `outgoing-morph-seam` — a resolved product surface clears detail,
  compresses into a pill, and carries momentum into a shape-match boundary.

Authoring conventions proven by these recipes (follow them — they are why the
gate reports zero warnings): tween targets are INLINE STRING LITERALS with
`{{uid}}` filled by the host (the pinned GSAP parser resolves literals, never
concatenations), and the timing spine derives from `{{start}}`/`{{settleSec}}`
numeric literal slots so every position constant-folds at parse time. Size
for a 1920×1080 frame — hero patterns that look right in a browser tab are
usually too small on the film canvas. And mind GSAP's `fromTo`
immediate-render: a `fromTo` paints its FROM state at timeline build, not at
its position. For entrances (from `opacity: 0`) that is exactly what hides
the element early — but a mid-scene accent whose from-state is VISIBLE (a
ring pulse, a flash) must pass `immediateRender: false` or it parks a ghost
on the frame from scene start (the iris-cta-close ring incident). The gate's
endpoint thumbnails will NOT catch this — eyeball the first frame.

## Post-hackathon catalog backlog (not active refactor scope)

The active S6.9-S6.13 stabilization work freezes new Studio/catalog expansion.
The ideas below are optional future work, not a current plan section and not a
reason to delay the first judge-ready MP4.

cursor demo click-through · bento-grid feature reveal · pricing table build +
tier highlight · command-palette power-user flow · before/after wipe ·
terminal-to-chart transform · headline word-swap positioning loop.
(Notification stack cascade and KPI dashboard grid are covered by the
`notification-stack` / `dashboard-grid` PLUGINS — don't duplicate them as
recipes.)
