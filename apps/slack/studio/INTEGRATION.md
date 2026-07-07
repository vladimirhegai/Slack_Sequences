# Recipe Studio ↔ engine — the coupling map

The studio (`apps/slack/studio/`) and the recipe pipeline
(`src/engine/recipeContract.ts` + `skills/sequences-recipes/`) are a **cockpit
over the engine, never a second engine**. Every seam below is a place where an
engine change can silently break the studio or the shipped recipe library.
**Rule: touching a seam in the left column requires updating the right column
— or recording a TODO here in this file.**

## The recipe pipeline at a glance

```
operator/agent edits fragment.html in a studio workspace
  → gateWorkspace(): stage into SLACK_SEQUENCES_RECIPES_DIR, scaffold demo,
    applyDeterministicSourceRepairs (REAL injection), validate + browser QA
  → export: skills/sequences-recipes/<id>/ (recipe.json + recipe.md +
    fragment.html + demo.html + preview/) with engine version fences + hash
  → live create: skillContext retrieval offers ≤2 matching recipes (Level 0)
  → GLM storyboard declares recipes:[{id,params}] per scene (schema field)
  → parseStoryboard normalizes + reconcileRecipeDeclarations (Sentinel L2:
    drop/default/clamp, degrade-never-veto)
  → applyDeterministicSourceRepairs strips + re-injects the fragment VERBATIM
    every pass (mechanism unreachable to the author model)
  → validateDirectComposition runs validateRecipeContract (self-check) and
    every existing gate over the instantiated result
```

## Seam table

| engine seam | recipe/studio consumer | when you change it |
|---|---|---|
| `*_RUNTIME_VERSION` / `*_KIT_VERSION` constants (cut/camera/component/interaction/time/fx/cinema) | `recipeContract.currentEngineFences()`; every exported `recipe.json` `engine.kitVersions` | bumping ANY version makes every exported recipe **stale** (skipped at retrieval + instantiation, "re-prove" badge in the studio). Re-prove: `npm run studio:golden` per recipe (or gate+export in the UI). |
| storyboard schema (`storyboardResponseFormat`, `parseStoryboard`, cache `contract:` in `compositionRunner.ts`) | the `recipes` scene field; `recipesVersion`/`recipeIds` in the storyboard cache key | keep the `recipes` property + required entry in the JSON schema; bump `contract:` on shape changes; parse must keep calling `normalizeStoryboardRecipeDeclarations` + `reconcileRecipeDeclarations`. |
| `applyDeterministicSourceRepairs` injection order (islands → **recipes** → kits → time-wrap LAST) | `injectRecipeContract` call site | recipe injection must stay BEFORE the time-wrap rewrite and be strip-and-reinject idempotent. `test/recipeContract.test.ts` proves tamper-reversion. |
| `validateDirectComposition` | `validateRecipeContract` (recipe_unknown / recipe_island_missing / recipe_motion_missing / recipe_slot_unfilled) | these are host-plumbing self-checks (fx disposition); keep them in the error aggregation. |
| `skillContext.ts` retrieval | `selectedLibraryRecipes` (cap `MAX_RECIPES_PER_FILM`), the "Proven recipes" declare-by-default section, `recipeIds`/`recipesVersion` on `RetrievedSkillContext` | recipes lead the selected section by design (operator priority). Budget changes → update `recipePlanningVocabulary` text. |
| `sentinel.ts` registry | rows `normalize.recipe-reconcile` + `recipes.contract`; `recipeContract.ts` in `FINDING_SOURCE_FILES` | any new `recipe_*` finding code must be registered or `test/sentinel.test.ts` fails. |
| `sentinelFlags.recipesEnabled()` (`SLACK_SEQUENCES_RECIPES=0`) | parse, cache key, retrieval, injection | the whole Level-1 path behind one switch; default ON. |
| `componentContract.COMPONENT_CATALOG` | `recipe.json` `componentKinds` (retrieval overlap), future clickAnchor metadata (M2) | removing/renaming a kind invalidates manifests naming it (`validateRecipeManifest` warns at load). |
| `directComposition.commitDirectComposition` / `generateDirectThumbnails` | `studio/gate.ts` | the studio gate is exactly these functions; signature changes break `npm run studio` + `studio:golden`. |
| `projectTemplates.initializeProject` | `studio/workspaces.ts` (a workspace IS a project dir) | keep workspaces initializable without a screenshot seed. |
| `prompts/planning-director.md` byte budget (`test/promptBudget.test.ts`) | recipe teaching text lives in runtime-composed retrieval + the response-contract lines in `requestStoryboardPlan` — **not** in the prompt file | keep it that way; recipe additions must not grow the budgeted prompt. |

## Environment variables

| var | meaning |
|---|---|
| `SLACK_SEQUENCES_RECIPES=0` | disable the whole recipe path (retrieval, parse, injection) |
| `SLACK_SEQUENCES_RECIPES_DIR` | library root override — **studio gate staging only**, never production |
| `STUDIO_PORT` | studio server port (default 4321) |

## Studio invariants (do not relax)

1. Never on Railway: `server.ts` exits under `RAILWAY_ENVIRONMENT`; nothing in
   the Docker CMD references the studio.
2. Workspaces live in `apps/slack/.data/studio/` (gitignored via `.data/`);
   job dirs under `.data/projects/` stay immutable — studio imports are copies.
3. Export only from a green gate whose `fragmentHash` still matches the
   workspace fragment.
4. Every studio preview/gate runs the production validators — no laxer
   studio-only referee.
5. The exported `fragment.html` is content-addressed (`recipe.json.fragmentHash`);
   hand-editing a library fragment marks the recipe stale until re-proven.
