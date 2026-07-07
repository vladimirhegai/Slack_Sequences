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

## Canvas builder seams (M1/M2 — `studio/canvasModel.ts` + `compileCanvas.ts`)

The canvas editor is a WYSIWYG surface over the SAME host-owned contracts the
agents emit. `compileCanvas.ts` is a cockpit over the engine, never a second
engine — it reuses `applyDeterministicSourceRepairs` for ALL island injection.

| engine seam | canvas consumer | when you change it |
|---|---|---|
| `componentContract.COMPONENT_CATALOG` markup | `compileCanvas.renderCatalogComponent` (substitutes only `data-part` + copy) + the UI component browser (served via `GET /api/catalog`) | never fork the markup; a kind's markup change flows through automatically. If a kind's primary text slot changes selector, update `fillPrimaryCopy`. |
| `cameraContract` — camera times are **ABSOLUTE** composition seconds | `compileCanvas` shifts each canvas move by `scene.startSec` (the canvas model stores scene-relative, operator-facing). `CAMERA_MOVES` / `SEQUENCES_EASES` feed the editor dropdowns via `/api/catalog` | if the resolver's time base changes, fix the shift in `compileScene`. `test/studioCanvas.test.ts` guards absolute-time camera resolution. |
| `applyDeterministicSourceRepairs` (islands, runtimes, time-wrap LAST) | `compileCanvas.compileCanvasFilm` hands it `{html, storyboard}` | the compiler emits DOM + entrance tweens + declared moments only; the pass owns every island. Never inject islands in the compiler. |
| `motionDensity` liveness (front-load / quiet-gap / back-half beat) | the compiler spreads entrances across each station's window + declares moments at settled times | a sparse operator scene draws a real gate finding (by design — advice, not a silent pass). |
| `directComposition.commitDirectComposition` / `generateDirectThumbnails` | `gate.ts` `gateCanvasWorkspace` (validate → commit + browser QA → thumbnails) | same gate as recipes and live creates — no laxer referee. |

## Agent seams (M3 — `studio/agents/`)

| engine seam | agent consumer | when you change it |
|---|---|---|
| `@sequences/platform` `PROVIDERS["openrouter-api"].complete` + `CompleteOptions.images` | `agents/openrouter.ts` (in-process critic; passes ref images to vision-capable models, degrades honestly otherwise) | prompt FILES are never forked — the studio composes a chat prompt from `agents/context.ts`. |
| `PROVIDERS["claude-code-cli"]` / the `claude` binary on PATH | `agents/cli.ts` spawns `claude -p --output-format stream-json --permission-mode acceptEdits` (cwd = workspace, `--resume` per workspace) | the CLI agent's cwd is the (gitignored) workspace dir but claude can still see the parent repo — treat diff-scoping as a TODO before this is trusted unattended. |
| `modelPolicy` model ids (`OPENROUTER_CREATIVE_MODEL` / `_LIGHT_MODEL`) | `agents/openrouter.ts` provider switcher | keep the studio's model choices reading from `modelPolicy`, never hard-coded. |
| `validateDirectComposition` + commit + thumbnails | `agents/context.ts` `regateComposition` — re-gates an agent-edited composition after every CLI turn | the agent is refereed by the production gate; changing its signature breaks the re-gate. |

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
