# Recipe Studio — foundation + hard-parts build report

Date: 2026-07-07 · Agent: Claude (session 1 of 2) · Plan:
`docs/RECIPE_STUDIO_PLAN.md` (v2, private monorepo) · Follow-up work:
see the handoff prompt given to the operator.

This session built the **foundation and the hard parts** of the Recipe Studio
system: the recipe format, the clean integration into live generation (the
"click export → the agent can and will use it" loop), the Sentinel
integration, the studio's gate/export server, and the golden first recipe
proven end-to-end. The studio's canvas UI, agents, and effects library are
deliberately left for the follow-up agent (see "What is NOT built").

---

## 1. What was built

### 1.1 `src/engine/recipeContract.ts` — the sixth host-owned contract (~950 lines)

The load-bearing file. RecipeV2 format + Level-1 host instantiation:

- **Format**: `skills/sequences-recipes/<id>/` with `recipe.json` (machine
  header: id/title/tags/triggerPatterns/durationWindow/componentKinds/typed
  param slots/engine version fences/fragmentHash/revision), `recipe.md`
  (retrieval knowledge), `fragment.html` (the instantiation unit: one
  `<style data-recipe-style>`, one `<template data-recipe-markup>` with
  `{{param}}` slots, one `<script data-recipe-motion>` whose body runs as
  `(tl, root, start, duration, uid)` against the ONE paused master timeline),
  `demo.html` (the gate-passed proof composition), `preview/` (thumbnails).
- **Typed param slots**: `text` (maxChars cap — reading-floor friendly),
  `number` (min/max clamp), `color-token` (**only** `var(--…)` token
  references — raw hexes are rejected, so instantiated recipes are
  automatically on-brand per job), `enum`, `part-ref`. Defaults make params
  optional; a required param with no usable value drops the declaration.
- **Instantiation** (`resolveRecipePlan` → `injectRecipeContract`): markup is
  injected inside the declared scene (or its declared `data-region` station)
  in a host-marked wrapper (`.seq-recipe`, `data-sequences-host`,
  `data-sequences-recipe`, `data-recipe-uid`); style goes to `<head>` once per
  recipe; motion is an IIFE between `/*<seq-recipe uid>*/` markers anchored
  BEFORE the timeline registration (and before `SequencesTime.wrap` when a
  ramp wrapped it). **Strip-and-reinject on every pass**: the author model can
  never edit the mechanism — tampering is reverted by construction, proven by
  test. HTML params are HTML-escaped; motion params are JS-escaped
  (quotes, `</script>`).
- **Version fencing**: `recipe.json.engine.kitVersions` records every
  runtime/kit version the recipe was proven against
  (`currentEngineFences()`); a drifted fence or a `fragmentHash` mismatch
  marks the recipe **stale** — skipped at retrieval and instantiation, shown
  as "re-prove" in the studio. Re-proving is `npm run studio:golden` (or
  gate+export in the UI).
- **Validation** (`validateRecipeContract`, wired into
  `validateDirectComposition`): `recipe_unknown` / `recipe_island_missing` /
  `recipe_motion_missing` / `recipe_slot_unfilled` — host-plumbing
  self-checks (the fx disposition), reachable only if the injection seam
  breaks.
- **Library root override** `SLACK_SEQUENCES_RECIPES_DIR` — exists solely so
  the studio can gate an unexported workspace recipe through the identical
  production path.

### 1.2 Live-generation integration (`compositionRunner.ts` + `skillContext.ts`)

The "agent can and WILL use it" loop:

- **Retrieval** (`src/agent/skillContext.ts`): the library is scored against
  the brief (`triggerPatterns` regex ×3 + tag + componentKind overlap), cap
  `MAX_RECIPES_PER_FILM` (2), stale recipes never surface. Matching recipes
  LEAD the selected-knowledge section with a **declare-by-default
  instruction** ("declaring it is the DEFAULT… decline only when it genuinely
  conflicts with the brief") plus each recipe's param table and an exact
  declaration example. When nothing matches, a one-line library index still
  lets the planner opt in. `RetrievedSkillContext` gains
  `recipeIds`/`recipesVersion`.
- **Storyboard schema**: scenes may declare
  `recipes:[{version:1,id,region?,params:[{name,value}]}]` — added to the
  structured-output JSON schema, the response-contract prose, and
  `parseStoryboard` (params accepted as pair-array or record).
- **Sentinel L2 governor** (`reconcileRecipeDeclarations`, parse tail):
  unknown/stale ids drop, params default/clamp/drop, per-film budget trims,
  duplicate ids collapse — all with `sentinelNormalizations` notes visible in
  STORYBOARD.md, telemetry tags `recipe-reconcile`/`recipe-inject`.
  **Degrade-never-veto**: a bad declaration costs influence (the knowledge
  already reached the planner at Level 0), never a paid retry.
- **Injection**: `injectRecipeContract` runs inside
  `applyDeterministicSourceRepairs` after the fx island, before the kits and
  the time-wrap (which stays LAST). Every repair pass re-injects verbatim.
- **Caching**: storyboard cache contract **v13 → v14**; the cache key now
  includes the library content hash (`recipesVersion`) + offered `recipeIds`,
  so exporting/re-proving a recipe invalidates plans that could now use it.
- **Kill switch**: `SLACK_SEQUENCES_RECIPES=0`
  (`sentinelFlags.recipesEnabled()`), default ON per the operator's
  "agents should use recipes" priority; an empty library behaves identically
  to OFF.
- **Author-side teaching**: the skill context's data-attributes section tells
  the source author a recipe-declaring scene gets a host-injected fragment —
  author around it, never re-create it.

### 1.3 Sentinel registration (`src/engine/sentinel.ts`)

- Row `normalize.recipe-reconcile` (L2, deterministic-repair) and row
  `recipes.contract` (L3 static, blocking self-check codes).
- `recipeContract.ts` added to `FINDING_SOURCE_FILES`; the closed-world scan
  passes (`test/sentinel.test.ts` — a new `recipe_*` code cannot ship
  unregistered).

### 1.4 Recipe Studio foundation (`apps/slack/studio/`)

`npm run studio --workspace @sequences/slack` → `http://127.0.0.1:4321`
(opens a browser; `--no-open` to suppress). Refuses to start under
`RAILWAY_ENVIRONMENT`; not in the Docker CMD; zero new dependencies
(`http.createServer` + one static page of vanilla JS).

- `workspaces.ts` — mutable workspaces under `apps/slack/.data/studio/<id>/`
  (gitignored; job dirs stay immutable). A workspace IS an engine project
  dir: `workspace.json` (typed state: demo params, manifest draft, gate
  record, sanity briefs) + `fragment.html` + `recipe.md` + `composition/` +
  `revisions/` checkpoints (undo = replay). Create blank or seeded from any
  library recipe.
- `scaffold.ts` — deterministic, zero-token demo compiler: a two-scene proof
  film (stage + end slate) whose stage scene declares the workspace recipe;
  the fragment is injected by the REAL `applyDeterministicSourceRepairs`, so
  the studio never re-implements injection.
- `gate.ts` — the referee: stages the workspace recipe into a temp library
  dir (`SLACK_SEQUENCES_RECIPES_DIR`), then runs the production gate —
  `validateDirectComposition` → `commitDirectComposition` (static gate +
  **real browser QA**) → `generateDirectThumbnails`. The gate record binds to
  the fragment hash: editing after a green gate re-arms it.
- `exportRecipe.ts` — RecipeV2 export: green gate required, writes
  recipe.json (current engine fences + content-addressed fragmentHash +
  revision bump) + recipe.md + fragment.html + demo.html + preview/, reloads
  the library, and runs the **retrieval sanity check** (should-match briefs
  must score, two canned negatives must not) so over/under-matching trigger
  patterns are caught in the wizard, not in production.
- `server.ts` + `ui/index.html` — the cockpit: workspace list, library
  gallery (stale badges), 1920×1080 preview iframe with deterministic
  scrubbing (`__timelines` seek) and play loop, gate findings feed, thumbnail
  strip, fragment/manifest/recipe.md editors, Generate + Export buttons.
- `selfCheck.ts` (`npm run studio:golden`) — the scripted end-to-end proof:
  create/reuse workspace → gate → export → live-retrieval round-trip check.
- `INTEGRATION.md` — the seam table future agents must maintain.

### 1.5 The golden recipe — proven end-to-end

`skills/sequences-recipes/last-word-roulette/`: locked sentence, masked
final-word wheel (3 candidate ticks on committed inOut steps), payoff snap on
`seqSettle`, accent underline draw + one glow breath. 7 typed params (lead,
word1–3, payoff, accent color-token, settleSec). Timing derives from
`settleSec` and clamps into any scene window.

Proof executed (2026-07-07, this machine):

- `npm run studio:golden` → **gate green** (full static validation + real
  browser QA + 3 moment thumbnails), exported revision 3 with fences + hash;
- retrieval sanity: both roulette briefs score (16 and 3), both negative
  briefs score 0;
- live retrieval round-trip: `retrieveHyperframesSkillContext("create",
  <roulette brief>)` surfaces the recipe with the declare-by-default block;
- thumbnails inspected by eye: mid-wheel frame and payoff frame (baseline
  aligned, underline + glow tracking the payoff word) both correct.

### 1.6 Tests + verification

- New `test/recipeContract.test.ts` (24 tests): manifest validation, fragment
  parsing (comment-stripping regression), declaration normalization (both
  param shapes), the L2 governor (defaults/clamps/budget/stale/required-param
  drop/hex rejection), param escaping (HTML + JS), injection (anchoring
  before registration, region targeting, idempotence, **tamper reversion**,
  stale-injection removal), self-check codes, balanced-div stripping, and the
  shipped golden library (loads clean, not stale, scores correctly, surfaces
  through live retrieval, index-only on a non-matching brief).
- `test/skillContext.test.ts` inventory test now excludes the locally-curated
  `sequences-recipes/` dir from the upstream-skills manifest pin (its
  integrity is owned by the recipe tests).
- Ran: slack typecheck ✓ · full slack suite 707 tests ✓ (after the manifest
  fix) · `test/sentinel.test.ts` closed-world ✓ · `npm run studio:golden`
  end-to-end ✓ · `npm run film:demo` (golden film unchanged) ✓.
  Layers NOT run: Docker gate, Railway/live-Slack flows, and a **paid live
  create** with a recipe-naming brief (deliberately deferred — see below).

## 2. Creative decisions the operator should know about

1. **Recipes are a host-owned contract, not retrieved prose.** The defense is
   structural: strip-and-reinject makes the mechanism unreachable, rather
   than detecting edits after the fact.
2. **All recipe declaration failures are Sentinel L2** (drop/default/clamp
   with visible notes) — never findings-retries. Six days before the
   hackathon deadline, the recipe path can influence films but cannot veto
   one or burn a paid attempt. The `recipe_*` codes exist only as
   host-plumbing self-checks.
3. **Default ON** (`SLACK_SEQUENCES_RECIPES=0` to kill): the operator wants
   agents using recipes by default; retrieval places matched recipes ABOVE
   blueprints with declare-by-default language.
4. **The studio gates through a staged library override**
   (`SLACK_SEQUENCES_RECIPES_DIR`) so unexported recipes take the identical
   production path — no parallel referee.
5. **Version fences are runtime/kit versions only** (not the storyboard
   contract number, which is recorded informationally): a proven fragment's
   validity depends on the runtimes/kits it binds to, and re-proving is
   mechanical.
6. **The demo scaffold is two scenes** (engine minimum), stage + slate, kept
   under the 10s/12s liveness/moment thresholds so a recipe proof judges the
   recipe, not synthetic paperwork.

## 3. What is NOT built (the follow-up agent's scope)

- The **canvas editor** (world view, stations, drag/retime, camera transition
  editor, component browser, timeline, inspector) — M1/M2 of the plan.
- **Chat + agents** (OpenRouter GLM/DeepSeek, Claude Code/Codex CLI
  subprocess agents, AGENT.md generation, file-watch → auto-re-gate, image /
  storyboard-frame attachments) — M3.
- The **agent-drafted describe pass** in the export wizard (metadata
  suggestions from workspace + chat history) — the export mechanics and the
  operator-editable metadata form exist; the drafting model call does not.
- `clickAnchor` catalog metadata, text/backdrop **effect presets**
  (`studioKit.ts`), Level-2 tunable regions, the §5.6 recipe backlog beyond
  the golden recipe.
- **One paid live create** proving planner-declares → host-injects → gate
  passes on a real `/sequences` run (deliberately left as the follow-up's
  first task so the operator pays for it once, after audit).

## 4. Known limitations / notes for the auditor

- The studio server is sequential by design (one gate at a time; the library
  env override is process-global during a gate).
- `region` targeting on a declaration is best-effort: a missing station
  degrades to the scene root (screen-locked) with no finding.
- The roulette's `accent` default (`var(--cinema-key)`) resolves in live
  films only when the author's frame.md CSS defines it; the fragment's CSS
  fallback chain keeps a missing token readable (inherits scene color).
- `parseRecipeFragment` strips HTML comments before section extraction — a
  fragment's docs may mention the section tags (this bit the golden fragment
  once; regression-tested).
- The `.publish/` staging dir at the monorepo root is picked up by vitest's
  root config and re-runs a stale copy of the suite; harmless but noisy.
