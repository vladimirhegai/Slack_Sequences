# ASSETS.md — the pre-built parametric asset system

**Status (2026-07-09, later):** the full system is shipped — a 13-asset
library covering all five silhouette families, the in-film spring animation
runtime (the 8th host-owned island, `sequences-assets`), the Asset Lab with
trigger badges + morph spring tweaks, and the channel-brief auto-offer.
Flag: `SLACK_SEQUENCES_ASSETS` (see the flag-state note at the bottom).
The Asset Lab works regardless: since 2026-07-10 it is the **Assets tab of
the combined Sequences Studio** — `npm run assets` (alias of `npm run studio`)
→ `http://127.0.0.1:4321` (`STUDIO_PORT` / `--port` override).

## Why this exists

Model-drawn hero visuals look lame. Probe after probe showed the same thing
the plugin system's audit found for geometry and content: the author model is
reliably bad at *drawing* — flat washes, arbitrary radii, linear ease-outs,
Item-1/2/3 filler. The fix is not a better drawing prompt; it is the same fix
Sentinel applies everywhere: **move the obligation off the model.** Visual
quality becomes a *library* property (built once, by hands and eyes, in the
Asset Lab), and the models keep only what they're good at — choosing, timing,
and parameterizing.

## The core decision: tweak pre-built, never build from scratch

Considered and rejected: a "designer model" (GLM or otherwise) generating
per-job assets from a screenshot-derived `design.md`. Rejected because every
downstream promise breaks — generated markup can't guarantee morph twins,
silhouette rhymes, spring choreography, byte-stable re-injection, or safe
CSS; we'd be re-litigating the kit_markup_incomplete class per film. Instead:

- **Assets are code, authored at design time** (`src/engine/assets/*.ts`,
  built with `defineAsset` — definition typos throw at module load).
- **Tweakability is typed params** (color / number / text / enum with
  defaults, clamps, caps) that enter the DOM ONLY as CSS custom properties
  and data-attributes on the asset root. The static per-asset stylesheet is
  byte-stable regardless of params; free text never enters CSS.
- **Brand theming is free**: asset CSS reads the same tokens as the component
  kit (`--accent`, `--surface`, `--text`, `--muted`, `--cinema-radius`) with
  fallbacks, so the per-job `frame.md` palette rethemes every asset with zero
  asset-specific work. `glass-metric`'s accent param literally defaults to
  `var(--accent)`.

The future `/sequences asset` screenshot flow then becomes **parameter
extraction + selection, not generation**: brandCapture-style tools read the
user's UI screenshots, derive tokens (accent, surface temperature, radius,
type feel), pick matching assets, and store the tuned declarations — the
model chooses values inside clamped, typed ranges, and the result previews as
images in the channel. Same knobs a human turns in the Asset Lab.

## Motion: physics, not hand-tuned curves

`motionSpring.ts` is the single motion authority for asset animations: a
closed-form damped harmonic oscillator (`{frequencyHz, dampingRatio}`).
From one spring the host derives the position curve, the natural duration
(settle time — bouncier springs automatically play longer), a normalized
ease (GSAP `registerEase`-ready samples for the film runtime), and a CSS
`linear()` easing string (WAAPI, used by the Asset Lab). Five house presets
keep the library reading as one system: `bounce` (two visible bounces —
"expand" moves), `pop` (fast attack, one ~12% overshoot — entrances),
`settle` (~3% overshoot — state changes), `snap` (critically damped), and
`gentle`. An asset's invokable animations (`enter`, `expand`, `pulse`,
`ring-fill`, …) are typed track lists (`scale`/`translate`/`rotate`/
`opacity`/registered custom properties) eased by exactly one spring —
`compileAssetAnimation` resolves `$param` references so an animation can
drive to a declared value (ring fills to `ring=42`).

Each animation also declares an in-film choreography role — `trigger:
"enter"` (the unit's arrival; at most ONE per asset, validated), `"payoff"`
(plays right after the entrance settles — fills, draws, shines), or
`"manual"` (default: Asset Lab / explicit invocation only, so looping
attention-seekers stay opt-in) — and optionally `preBeat: "from"` for payoff
animations whose custom-prop tracks BUILD toward the state the static markup
already shows (ring fills, meter fills, draws): the film runtime writes each
such track's from-value inline at compile, so a seek before the beat shows
the empty state instead of the flash-of-full tell.

## The in-film animation runtime (shipped 2026-07-09 — the 8th island)

Design decision: asset animations ride the EXISTING beat rails instead of a
parallel timing system. The plugin lowering (`assetPluginSpecs` in
`assetContract.ts`) emits ONE internal `asset`-kind component per declared
unit (root `data-part` = `<unit>-core`, stamped `pluginUid`) plus
host-derived typed **`animate` beats**: the `enter` animation at the shared
camera-arrival-aware entrance anchor (`entranceAnchorSec` in
`pluginKernel.ts`), then each `payoff` sequenced with 0.15s gaps on the
shared `"asset"` beat channel. Because these are ordinary `scene.beats`
flowing through `resolveComponentPlan`, pacing / motion-density / moments /
complexity budgets / layout-QA motion windows all bind FOR FREE.

- **Sentinel L0:** `asset` kind + `animate` beat are HOST-ONLY vocabulary —
  the storyboard schema enums (`PLANNER_COMPONENT_KINDS` /
  `PLANNER_COMPONENT_BEAT_KINDS`) exclude them, and the normalizers reject
  them from model plans, so models cannot even represent them.
- `src/engine/assetRuntime.ts`: `resolveAssetPlan` reads timing FROM the
  resolved component plan (paperwork == execution) and compiles the spring
  payload via `compileAssetAnimationGsap` (decomposed GSAP vars + sampled
  ease + preBeat inline writes); `validateAssetContract`
  (`asset_island_missing` / `asset_island_stale` / `asset_runtime_missing`)
  stands down when the flag is off.
- `templates/sequences-assets.v1.js`: `SequencesAssets.compile(tl, root)`
  linear-interpolates the sampled spring ease (overshoot survives), first
  beat per part = reveal (immediateRender pre-renders the hidden state),
  later beats = move + preBeat custom-prop writes, yoyo = repeat:1.
  Deterministic — no clocks, no random. `sequences-components.v1.js` skips
  `animate` beats BEFORE element lookup (one owner per channel).
- Injection lives in `applyDeterministicSourceRepairs` after fx, before
  recipes and the time-wrap (telemetry tag `asset-inject`); the island is in
  `HOST_PLAN_ISLAND_IDS`, staging, checkpoint sidecars, and the QA static
  fingerprint. Island equality is byte-exact: `animate` beats live in BOTH
  the components island (paperwork) and the assets island (spring payload).
- Sentinel registry rows: `normalize.asset-lower` + `assets.contract`
  (SENTINEL.md contract table). `pacingAudit` counts `animate` as an
  entrance beat kind.

Proof: `test/assetPack.test.ts` (92 generic per-asset tests),
`test/assetRuntime.test.ts` (plan byte-stability, timing mirror, validation),
`test/assetRuntime.browser.test.ts` (an all-asset film through REAL
validateDirectComposition + browser QA — zero errors, every declared moment
bound to `component` evidence from asset beats, seek-safe).

## Who may do what (the agent policy)

| Actor | May | May NOT |
| --- | --- | --- |
| Human (Asset Lab) | author new assets, tune params, prove animations/morphs | — |
| GLM planner | *declare* `asset-<id>` with params on a shot | invent asset kinds, exceed clamps |
| DeepSeek author | choreograph the unit's entrance by its wrapper `data-part` | see, author, or edit asset internals |

**Can the models create their own assets when the library lacks one? No.**
The escape hatch is the existing 23-kind component catalog + plugins — both
already gated. A missing asset degrades to governed components, never to
free-form hero markup. (If live probes show real coverage gaps, the answer is
a human authoring session in the Asset Lab — an hour of design work — not a
runtime generation path that reintroduces the quality problem permanently.)

Enforcement is structural, not prompt-based: assets ride the **plugin rails**
(`assetPluginSpecs(ASSET_LIBRARY)` appends `asset-<id>` kinds to
`PLUGIN_CATALOG` behind `sentinelFlags.assetsEnabled()`), so declarations get
the L2 governance (unknown → no-op, params default/clamp/drop, shared
`MAX_PLUGINS_PER_FILM` budget) and the host strips + re-injects the rendered
bytes on every repair pass — the author model physically cannot edit an
asset. `renderAssetInstance` is a pure function of (definition, coerced
params): same declaration, same bytes, every pass.

## Morph / match readiness

Every asset declares a silhouette `family` aligned with the cut contract's
shape-rhyme groups (`pill`·`bar` vs `card`·`circle`·`window`), and
`assetsRhyme(a, b)` answers whether a morph/match between two assets — or an
asset and a kit component — reads as a rhyme, so a cross-family morph can be
rejected at PLAN time (cheap findings-retry) instead of degrading at bind
time. The Asset Lab's morph panel previews the FLIP gesture between any two
library assets with the same settle spring the film would use, and shows the
rhyme verdict.

## The Asset Lab (`npm run assets` — the studio's Assets tab)

Terminal-launched operator webview, studio posture (localhost-only,
refuses `RAILWAY_ENVIRONMENT`, absent from the Docker CMD, zero deps):
browse the library; tweak every typed param live (color pickers, clamped
ranges, enum selects); fire each spring animation — each button carries its
**trigger badge** (enter / payoff / manual, the in-film choreography role);
retheme brand tokens (theme presets + accent picker) to prove `frame.md`
retheming; preview morph transitions with **morph tweaks** — a spring-preset
picker (all five house springs, precompiled server-side through
`compileAssetAnimation` so every option is the exact easing the contract
would compile) plus an optional duration override with an auto reset. It
renders through `renderAssetInstance` / `compileAssetAnimation` — never a
forked copy — so what the lab shows is byte-what a film would inject.

## Product workflow (step 2 shipped 2026-07-09)

1. User runs **`/sequences asset`** → a modal with a `file_input` block
   (Slack slash commands cannot carry files — the modal is the native path)
   takes up to 5 UI screenshots + optional notes.
2. `src/assetBrief.ts` extracts the palette DETERMINISTICALLY (chromium
   canvas pixel-sampling, no model): accent = dominant chromatic non-canvas
   color, background = dominant color; stores ONE brief per channel in
   `.data/asset-briefs.json` (`asset clear` forgets; nothing else from the
   channel is ever stored); posts a confirmation + an asset-kit-in-your-brand
   preview PNG. Requires the bot `files:read` scope (manifest.json,
   2026-07-09 — reinstall + refresh the bot token).
3. `/sequences <brief>` in that channel folds the brief into the create
   context (`assetBriefContext` — after hosted-MCP workspace context), so
   frame design commits the user's accent/canvas and the token-themed assets
   retheme automatically. Films default to ~24s when no length is picked
   (`DEFAULT_TARGET_LENGTH_SEC`); the target shapes the film through the
   always-on narrative/duration template scaffold in the storyboard prompt —
   never through a validation veto (a time miss never burns an attempt).
4. When the asset library rides the plugin rails (`assetsEnabled()`), the
   brief ALSO appends a declare-by-default planning offer
   (`assetBriefPlanningOffer` in `src/assetBrief.ts`): 3-4 fitting
   `asset-<id>` kinds (note-keyword nudges outrank a curated default hero
   set), the brief's accent prefilled in the example declaration, and the
   recipes-style "declaring is the DEFAULT, drop only on genuine conflict"
   posture. Degrade-never-veto — the planner may decline every one.

## The library (13 assets, all five silhouette families)

| family | assets |
| --- | --- |
| window | `browser-hero` (glass chrome + skeleton page that populates via `--bh-rise` staggered clamps) |
| card | `spark-card` (sparkline draws) · `logo-tile` (monogram + gloss sweep) · `flow-node` (pipeline stage, activation ring) |
| circle | `glass-metric` (the reference) · `laurel-badge` (SVG laurels, bounce enter) · `notify-gem` (glossy counter, sonar ping) · `team-medallion` (avatar discs converge) |
| bar | `metric-bar` (meter fills to `$fill`) · `rating-strip` (stars light via overlay clip) |
| pill | `delta-chip` (trend pill; `down` = tempered red) · `key-combo` (extruded keycaps, press travel) · `cta-button` (bloom capsule, snap press payoff) |

Mechanics held everywhere (proven generically per asset by
`test/assetPack.test.ts`): params → root custom props/data-attrs only, brand
tokens with fallbacks, ONE spring per animation (never linear), size on one
custom prop with em interiors, honest `family`, payoffs that build toward
the markup's final state declare `preBeat:"from"`.

## Shipped / not yet

- ✅ `src/engine/motionSpring.ts` — spring physics + presets + samplers.
- ✅ `src/engine/assetContract.ts` — params, rendering, animation compile
  (WAAPI + GSAP shapes), rhyme families, plugin bridge with component/beat
  lowering (`test/assetContract.test.ts`).
- ✅ The 13-asset library (`src/engine/assets/`, one `defineAsset` file each).
- ✅ The in-film animation runtime (`assetRuntime.ts` +
  `templates/sequences-assets.v1.js` — see the runtime section above).
- ✅ Asset Lab with trigger badges + morph spring/duration tweaks (since
  2026-07-10 the Assets tab of `studio/server.ts` + `studio/ui/index.html`).
- ✅ `/sequences asset` (2026-07-09): screenshot intake modal → deterministic
  palette extraction → per-channel brief → context injection on every later
  create + asset-kit preview PNG (`src/assetBrief.ts`, `test/assetBrief.test.ts`).
- ✅ Auto-offer parameterized `asset-<id>` declarations from the stored brief
  (`assetBriefPlanningOffer` — workflow step 4 above).
- ⬜ More assets as coverage gaps surface (authored in the Asset Lab, one
  file each in `src/engine/assets/`).

## Flag state

`SLACK_SEQUENCES_ASSETS` is default **ON** after asset-probe-2 published clean.
Set `SLACK_SEQUENCES_ASSETS=0` to revert one process to the asset-free path;
see SENTINEL.md's flag table and PROBE_LOG.md for the probe record.
