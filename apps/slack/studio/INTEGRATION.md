# Sequences Studio ↔ engine — the coupling map

The studio (`apps/slack/studio/` — the combined components/assets/recipes
viewer + the recipe gate/export CLI) and the recipe pipeline
(`src/engine/recipeContract.ts` + `skills/sequences-recipes/`) are a **cockpit
over the engine, never a second engine**. Every seam below is a place where an
engine change can silently break the studio or the shipped recipe library.
**Rule: touching a seam in the left column requires updating the right column
— or recording a TODO here in this file.**

**Current status (2026-07-13):** the live Slack author route is Luna direct.
Studio remains the deterministic catalog cockpit and the complete typed-catalog
pipeline below remains available to the explicit `legacy-provider` rollback
route. Luna currently authors its own DOM/CSS/SVG and local asset bundle; the
host does not silently inject this legacy planner vocabulary into Luna's
creative session. Catalog expansion is still frozen during stabilization. The
exported recipe library contains seven recipes; `last-word-roulette` is
currently revision 13. Historical revision notes below record the revision
proven at that moment and should not be read as the current library version.

### Luna coupling audit

The Studio viewer and the Luna author are related through shared source
contracts, but they are not currently one selection/runtime path. The Studio
server imports the live catalogs for `/api/state`, `/api/assets`,
`/api/plugins`, `/api/looks`, `/api/camera`, and recipe operations. That proves
the cockpit is not forked. It does **not** prove that Luna receives or selects
those entries.

The Luna direct route currently receives only:

- approved screenshot bytes and deterministic palette/notes from
  `/sequences assets`;
- a host-validated, fingerprint-bound Luna UI pack containing tokens,
  code-native component states/parts, and optional inert local assets; and
- the motion-principles reference distilled from the golden film.

It deliberately does not receive `COMPONENT_CATALOG`, the built-in
`ASSET_LIBRARY`/asset-plugin inventory, exported recipes, `DESIGN_DIALECTS`, or
`CAMERA_PATTERNS`. `luna-director.md` forbids legacy `components`, `beats`,
`recipes`, `plugins`, and spatial/layout planner fields. Those catalogs remain
fully wired to the legacy-provider retrieval/lowering/injection path and to
Studio's deterministic previews. Do not mark a catalog item “used by Luna”
from Studio visibility alone; require a future persisted capability receipt.

The recommended bridge is a bounded Luna capability capsule derived from these
same catalogs. It should expose stable IDs and concise purposes/examples, let
Luna accept or decline them, and lower accepted requests through the existing
typed contracts. It must not inject the entire catalog, copy Studio markup into
every film, or revive the legacy planner committee. Record the capsule hash,
engine fences, requested IDs, accepted IDs, and declined IDs beside the Luna
bundle, then replay/browser-test both acceptance and intentional decline.

**2026-07-10 pivot:** recipes are now **agent-authored source files** —
`recipes/<id>.recipe.html` (one file per recipe, committed; format +
authoring guide in [../recipes/README.md](../recipes/README.md)). The
operator-era canvas builder, workspace store, and in-studio agent chat
(OpenRouter critic / Claude CLI spawning) were removed; the operator VIEWS
components, assets, and recipes in one tool (`npm run studio`) and coding
agents author recipes directly in the repo. The RecipeV2 export format and
every live-pipeline consumer are UNCHANGED.

## The recipe pipeline at a glance

```
coding agent writes recipes/<id>.recipe.html (meta + doc + fragment, one file)
  → npm run recipes -- gate <id>: parse source (studio/recipeSource.ts),
    stage into SLACK_SEQUENCES_RECIPES_DIR, scaffold demo,
    applyDeterministicSourceRepairs (REAL injection), validate + browser QA
    (work dir: .data/studio/<id>/, gitignored + regenerable)
  → npm run recipes -- export <id> (green gate only):
    skills/sequences-recipes/<id>/ (recipe.json + recipe.md + fragment.html +
    demo.html + preview/) with engine version fences + hash, then retrieval
    sanity + live-retrieval surface check
  → legacy-provider create: skillContext retrieval offers ≤2 matching recipes
    (Level 0)
  → legacy storyboard declares recipes:[{id,params}] per scene (schema field)
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
| `*_RUNTIME_VERSION` / `*_KIT_VERSION` constants (cut/camera/continuity/component/interaction/time/fx/cinema) | `recipeContract.currentEngineFences()`; every exported `recipe.json` `engine.kitVersions` | bumping an exported fence makes every exported recipe **stale** (skipped at retrieval + instantiation, "re-prove" badge in the studio). Continuity v1 is default-on and fenced as `continuityRuntime`; a recipe must be re-proved whenever its camera/continuity execution seam changes. Re-prove: `npm run studio:golden` per recipe (or gate+export in the UI). |
| runtime template **content** at the same island version (`templates/sequences-*.v1.js`/`.css`) | exported recipe fragments replay against the CURRENT runtimes | a behavior-changing edit that keeps the island contract (including the default-on continuity-owned route and its `=0` rollback inside `sequences-camera.v1.js`) does NOT fence-stale recipes — re-run `npm run studio:golden` to re-prove the golden recipe against the new behavior; an incompatible contract change must bump the VERSION. Backward-compatible optional fields may remain on v1 only when documented here and old/new round trips are both tested. |
| storyboard schema (`storyboardResponseFormat`, `parseStoryboard`, cache `contract:` in `compositionRunner.ts`) | the `recipes` scene field; `recipesVersion`/`recipeIds` in the storyboard cache key | keep the `recipes` property + required entry in the JSON schema; bump `contract:` on shape changes; parse must keep calling `normalizeStoryboardRecipeDeclarations` + `reconcileRecipeDeclarations`. |
| `applyDeterministicSourceRepairs` injection order (islands → … → fx → assets → **recipes** → kits → time-wrap LAST) | `injectRecipeContract` call site | recipe injection must stay BEFORE the time-wrap rewrite and be strip-and-reinject idempotent. `test/recipeContract.test.ts` proves tamper-reversion. |
| `validateDirectComposition` | `validateRecipeContract` (recipe_unknown / recipe_island_missing / recipe_motion_missing / recipe_slot_unfilled) | these are host-plumbing self-checks (fx disposition); keep them in the error aggregation. |
| `skillContext.ts` retrieval | `selectedLibraryRecipes` (cap `MAX_RECIPES_PER_FILM`), the "Proven recipes" declare-by-default section, `recipeIds`/`recipesVersion` on `RetrievedSkillContext` | recipes lead the selected section by design (operator priority). Budget changes → update `recipePlanningVocabulary` text. 2026-07-10: the vocabulary caps each recipe's doc at 1,200 chars (`markdownBudget` — param slots + declaration example never trimmed), and the recipe section's measured length participates in the blueprint/rule per-block budget (clamped 500–2,400), so a growing library can never push the motion-rule blocks past the final trim. |
| `sentinel.ts` registry | rows `normalize.recipe-reconcile` + `recipes.contract`; `recipeContract.ts` in `FINDING_SOURCE_FILES` | any new `recipe_*` finding code must be registered or `test/sentinel.test.ts` fails. |
| `sentinelFlags.recipesEnabled()` (`SLACK_SEQUENCES_RECIPES=0`) | parse, cache key, retrieval, injection | the whole Level-1 path behind one switch; default ON. |
| `componentContract.COMPONENT_CATALOG` | `recipe.json` `componentKinds` (retrieval overlap), future clickAnchor metadata (M2) | removing/renaming a kind invalidates manifests naming it (`validateRecipeManifest` warns at load). |
| `directComposition.commitDirectComposition` / `generateDirectThumbnails` | `studio/gate.ts` | the studio gate is exactly these functions; signature changes break `npm run recipes` + `studio:golden`. |
| `projectTemplates.initializeProject` | `studio/gate.ts` (a recipe's gate work dir IS a project dir) | keep gate dirs initializable without a screenshot seed. |
| `RecipeManifest` shape (`validateRecipeManifest`) | `studio/recipeSource.ts` (the `data-recipe-meta` block is the manifest draft + `demo`/`sanityBriefs`) | new manifest fields flow through source files automatically; STRIPPED fields (`engine`, `fragmentHash`) must stay export-stamped, never source-authored (`test/recipeSource.test.ts`). |
| `assetContract.renderAssetInstance` / `compileAssetAnimation` / `ASSET_LIBRARY`, `componentContract.COMPONENT_CATALOG` + kit CSS | `studio/server.ts` (`/api/state`, `/api/render`) + `studio/ui/index.html` — the components/assets viewer renders LIVE from the contracts, never a forked copy | renderer/summary signature changes break `npm run studio` (the old standalone Asset Lab merged into this server 2026-07-10; `npm run assets` is an alias). |
| `prompts/planning-director.md` byte budget (`test/promptBudget.test.ts`) | recipe teaching text lives in runtime-composed retrieval + the response-contract lines in `requestStoryboardPlan` — **not** in the prompt file | keep it that way; recipe additions must not grow the budgeted prompt. |

## Studio catalog authoring matrix (2026-07-10)

Every tab has a clean-context skill in `studio/skills/studio-<catalog>/SKILL.md`
and a `npm run catalog -- new <catalog> <id>` scaffold (`recipes` uses
`npm run recipes -- new <id>`). `test/catalogScaffold.test.ts` keeps those six
routes closed-world. This table is the entry → runtime chain audit required by
`studio/ERGONOMICS.md`; add a row before introducing another hand-wired seam.

| catalog | committed source of truth | legacy-provider discovery | schema → host execution | QA / proof | Studio consumer |
|---|---|---|---|---|---|
| Components | `componentContract.ts` `ComponentKind` + `COMPONENT_CATALOG` + kit CSS/markup | `componentPlanningVocabulary`; compact inventory in `studioLibraryVocabulary` reaches planner and author | catalog-derived component kind enum → component island/runtime | `componentContract.test.ts`, `componentRuntime.browser.test.ts`, Sentinel registry | `/api/state` maps `COMPONENT_CATALOG` |
| Assets | `src/engine/assets/<id>.ts` + `assets/index.ts` `ASSET_LIBRARY` | asset plugin vocabulary + storyboard cache key + compact inventory | asset plugin declaration → lowering → asset island/kit + compiled springs | `assetContract.test.ts`, plugin tests, Asset Lab visual proof | `/api/state` maps and renders `ASSET_LIBRARY` |
| Recipes | `recipes/<id>.recipe.html` | scored `skillContext` retrieval with declare-by-default docs | scene `recipes` → reconcile → verbatim host injection | exact production gate, browser QA, thumbnails, retrieval sanity | `/api/recipes` joins sources, gate records, exports |
| Looks | `designDialects.ts` `DESIGN_DIALECTS` + background policies | frame-design selection + compact inventory | frame plan/dialect requirements → authored CSS under frame validation | frame/design-dialect tests + Studio contrast/art-direction inspection | `/api/looks` maps `DESIGN_DIALECTS` and production backgrounds |
| Camera | `cameraPatterns.ts` `CAMERA_PATTERNS` | planning prompt expands every pattern + compact inventory | typed scene camera path → resolver → camera island/runtime | `cameraPatterns.test.ts`, `cameraContract.test.ts`, camera browser suites | `/api/camera` maps `CAMERA_PATTERNS` to seekable board |
| Plugins | `pluginContract.ts` `PLUGIN_CATALOG` | catalog-derived planning vocabulary/schema enum + compact inventory | scene `plugins` → reconcile/lower → component beats + one host markup unit | `pluginContract.test.ts`, `pluginRuntime.browser.test.ts`, module-load lowering probe | `/api/plugins` maps catalog metadata + copy-ready examples |

`test/studioCatalogIntegration.test.ts` proves that each current catalog entry
appears in the shared legacy-provider inventory and that Studio imports the
same five typed sources. It does not prove Luna receives or selects that
inventory. Recipe end-to-end consumption remains independently proven by the
recipe gate/export and retrieval tests because recipes are filesystem artifacts
rather than a TypeScript catalog.

### 2026-07-09 motion-polish re-proof

The material-shell component morph bridge, content-aware camera framing,
same-station load-bearing companion framing, and revised `seqSwoosh` changed
runtime behavior without changing an island shape/version. The golden recipe
was re-gated and exported against those current runtimes as
`last-word-roulette` revision 10 (`npm run studio:golden`).

### 2026-07-10 additive component choreography

The v1 `sequences-components` island now optionally carries scene
`entranceFamily`/`entrances` plus resolved beat `follows`/lag/depth and
directional-exit metadata. This is deliberately additive: old v1 islands and
recipe fragments remain valid and byte-identical, while
`test/componentContract.test.ts` proves new-field byte round trips and
`test/componentRuntime.browser.test.ts` proves all three entrance families,
follow timing, and directional close execution in the current v1 runtime. No
recipe fence bump or export churn is required.

## Plugin pipeline seams (2026-07-08 — `src/engine/pluginContract.ts`, the seventh contract)

Plugins are the recipe seam's sibling: parameterized host GENERATORS (not
frozen fragments) that LOWER into typed components/beats at parse and inject
one verbatim markup unit per declaration. Anything that changes a recipe seam
above probably changes the matching plugin seam too.

v1 catalog (nine built-ins in `PLUGIN_CATALOG`): `dashboard-grid`,
`notification-stack`, `lockup`, `activity-feed` (list/table seeded rows),
`terminal-log` (typed command + streamed result lines), `team-strip` (seeded
avatar stack), `flow-diagram` (node parts plus endpoint-bound typed connector
paths), `comparison-table`, and `pricing-reveal`. A new kind is a **catalog
entry only** — no seam below changes; the planning
vocabulary + schema enum derive from the catalog, and the module-load probe at
the foot of `pluginContract.ts` proves every kind lowers to real component
kinds. `seedContent.ts` domains: `devtools`/`analytics`/`comms`/`commerce`/
`design`/`ai`/`generic` (ordered signal match, `generic` fallback last).

2026-07-09 amendments (probe fixes; storyboard cache `contract: 17`): the
lowering also reads the scene's **camera path** — `cameraArrivalSec` delays
the unit's entrance anchor until the camera's first full-move landing on its
region/part (markup stays timing-independent, so byte-convergence is
unaffected even when a later normalize mutates the path); the injected wrapper
carries placement self-defense (`grid-column:1/-1;min-width:0;max-width:100%`)
against author station CSS; and scenes carry `pluginAbsorbedParts` — parts
whose duplicate free components the absorber dropped — which the injector
hides via the `sequences-plugin-absorbed` host style block. The component kit
also changed within v1 (no fence bump — pre-beat rendering only): progress
ring/bar and chart strokes render EMPTY before their beat (flash-of-full fix),
`html,body` default to the `--canvas` tint, and the default highlight ring is
a hairline + bloom instead of the 3px accent border. A recipe re-prove
(`npm run studio:golden`) is still recommended after kit visual changes
(done this session — `last-word-roulette` revision 7). Round 2 (post
fix-probe-1, cache contract 18): `resolvePluginPlan` instances carry
`copyTexts` (verbatim-rendered text params ≥8 chars) and the injector stamps +
hides same-scene exact text-node duplicates outside the wrapper
(`data-sequences-plugin-duplicate`, rules live in the same
`sequences-plugin-absorbed` style block); parseStoryboard synthesizes a
default worldLayout (one viewport cell per camera-path region) when the plan
omits it, which is what guarantees plugin stations arrive viewport-sized.

| engine seam | plugin consumer | when you change it |
|---|---|---|
| storyboard schema (`storyboardResponseFormat`, `parseStoryboard`, cache `contract:`) | the `plugins` scene field (enum over `PLUGIN_KINDS`, array-form params) | keep the `plugins` property + required entry in the JSON schema; bump `contract:` on shape changes; parse must keep calling `normalizeStoryboardPluginDeclarations` + `reconcileAndLowerPlugins` (BEFORE dive/pop/moment derivations — lowered beats feed them). |
| `applyDeterministicSourceRepairs` injection order (islands → **plugins** → component-binding reconcile → … → fx → **assets** → recipes → kits → time-wrap LAST) | `injectPluginContract` call site; `injectAssetContract` (the sequences-assets island + `sequences-assets.v1.js` + `SequencesAssets.compile` call, telemetry tag `asset-inject`) sits after fx and before recipes | plugin injection must stay BEFORE `reconcileComponentBindings` (injected roots satisfy lowered components; reconcilers must never claim author elements for host-provided parts) and be strip-and-reinject byte-convergent (`test/pluginContract.test.ts`); asset injection must stay before the time-wrap (`test/assetRuntime.test.ts`). |
| `componentContract.SceneComponentSpecV1.pluginUid` | `componentUnitCount` (complexity audits), `trimOverBudgetComponents` (never trims plugin children), `pacingAudit.sceneIntroductionTimes` (one introduction per unit) | host-only stamp — `normalizeStoryboardComponents` must never accept it from the model. |
| author-facing projections (`authorStoryboardProjection`, `buildSceneSkeletonInterior`, `slotScaffoldViolations`, `componentReferenceFor`) | plugin children hidden from the author (locked-storyboard JSON, skeletons show a do-not-author comment, no scaffold violation for host-injected roots) | if the author ever sees lowered plugin components it WILL author duplicate roots. |
| `validateDirectComposition` | `validatePluginContract` (plugin_unknown / plugin_island_missing) | host-plumbing self-checks (recipe disposition); keep in the error aggregation. |
| `sentinel.ts` registry | rows `normalize.plugin-lower` + `plugins.contract`; `pluginContract.ts` in `FINDING_SOURCE_FILES` | any new `plugin_*` finding code must be registered or `test/sentinel.test.ts` fails. |
| foundations `pluginKernel.ts` / `seedContent.ts` | every plugin's geometry + content; lowering must stay a PURE function of (scene identity, declaration) | any nondeterminism (Date.now, Math.random, unordered iteration) breaks byte-convergent re-injection and the shared planning cache. |
| `sentinelFlags.pluginsEnabled()` (`SLACK_SEQUENCES_PLUGINS=0`) | parse + injection | the whole path behind one switch; default ON. |
| pre-built asset library (`assetContract.ts` + `src/engine/assets/` + `motionSpring.ts` + `assetRuntime.ts`) | `assetPluginSpecs(ASSET_LIBRARY)` appended to `PLUGIN_CATALOG` behind `sentinelFlags.assetsEnabled()` — each asset lowering EMITS one internal `asset`-kind component (root `data-part` `<unit>-core`, stamped `pluginUid`) + host-derived typed `animate` beats (the `enter` spring at the shared camera-arrival-aware entrance anchor, payoffs +0.15s apart), all pure functions of params; `resolveAssetPlan` reads timing back FROM the resolved component plan so paperwork == execution; the kit CSS carries a minimal `.asset` unit-root baseline; the Asset Lab (`npm run assets` → `http://127.0.0.1:4747`, refuses Railway) renders through `renderAssetInstance`/`compileAssetAnimation`, never a forked copy. | renaming `PluginSpec`/`PluginLowerContext`/`PluginLowering`, changing `coerceParam`, or moving the `CATALOG_BY_KIND` construction above the asset append breaks the bridge (`test/assetContract.test.ts`); touching `ResolvedComponentBeatV1` must keep `animation` round-tripping in `parseComponentPlan` or every asset film fails byte-exact island equality (`test/assetRuntime.test.ts`). |
| kit CSS class vocabulary (`templates/sequences-components.v1.css`) | generated markup uses kit classes verbatim (`cmp-stat`, `cmp-toast`, `cmp-ring`, `cmp-headline`, `cmp-item`/`cmp-row`/`cmp-chip`, `cmp-line`/`cmp-dim`, `cmp-avatars`/`cmp-more`, …) | renaming a kit class breaks generated interiors — `test/pluginRuntime.browser.test.ts` catches it in real browser QA. |
| human-facing paperwork (`storyboardMarkdown`, `directOutline`) | one `- plugin: <kind> "<id>" (name=value…) — host-generated` line per declaration in STORYBOARD.md; a `· plugins: <kind>` suffix on the Slack outline scene row | derive the parenthetical generically from `declaration.params` (+ `station=<region>`), never special-case a kind; keep receipts argument-free (paperwork only). |

## Environment variables

| var | meaning |
|---|---|
| `SLACK_SEQUENCES_RECIPES=0` | disable the whole recipe path (retrieval, parse, injection) |
| `SLACK_SEQUENCES_RECIPES_DIR` | library root override — **studio gate staging only**, never production |
| `STUDIO_PORT` | studio server port (default 4321) |

## Studio invariants (do not relax)

1. Never on Railway: `server.ts` exits under `RAILWAY_ENVIRONMENT`; nothing in
   the Docker CMD references the studio.
2. Recipe SOURCES are the committed truth (`recipes/<id>.recipe.html`); gate
   work dirs live in `apps/slack/.data/studio/` (gitignored via `.data/`) and
   are derived/regenerable; job dirs under `.data/projects/` stay immutable.
3. Export only from a green gate whose `fragmentHash` still matches the
   source fragment (`gate.json` binds to the hash; edits re-arm the gate).
4. Every studio preview/gate runs the production validators — no laxer
   studio-only referee.
5. The exported `fragment.html` is content-addressed (`recipe.json.fragmentHash`);
   hand-editing a library fragment marks the recipe stale until re-proven —
   fix the SOURCE file and re-export instead.
6. Headless browsers launch through `src/engine/browserLifecycle.ts`
   (`launchHeadlessBrowser`) — tagged profile dirs + exit reaping;
   `npm run browsers:clean` sweeps orphans.
