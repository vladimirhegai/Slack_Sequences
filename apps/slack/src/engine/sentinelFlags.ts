/**
 * Sentinel feature flags — the kill-switch surface for the
 * correctness-by-construction system (SENTINEL.md flag contract). Every new
 * behavior is gated here so the legacy path stays one env var away until the
 * Phase-5 probes flip the defaults. Read through these helpers, never
 * `process.env` directly, so SENTINEL.md has a single source of truth.
 */
import { slackSequencesEnvRawValue } from "./featureFlags.ts";

/**
 * Phase 1 — host emits scene skeletons carrying the camera-world plane,
 * component roots, focal-part carriers, and runtime script block, so those
 * paperwork classes are unrepresentable rather than repaired. Default ON since
 * the 2026-07-06 Phase-5 completion probes (dense-UI published clean 4× with
 * the skeleton, and the p6 battery re-proved the full brief set);
 * `SLACK_SEQUENCES_SENTINEL_SKELETON=0` force-reverts to bare shells for one
 * release.
 */
export function sentinelSkeletonEnabled(): boolean {
  return slackSequencesEnvRawValue("SLACK_SEQUENCES_SENTINEL_SKELETON") !== "0";
}

/**
 * Phase 2 — scene-addressable authoring (film_style + per-scene slots) so
 * validation/truncation/retries are scene-scoped. Default ON since the
 * 2026-07-06 Phase-5 completion probes; `SLACK_SEQUENCES_SENTINEL_SLOTS=0`
 * force-reverts to whole-doc for one release.
 */
export function sentinelSlotsEnabled(): boolean {
  return slackSequencesEnvRawValue("SLACK_SEQUENCES_SENTINEL_SLOTS") !== "0";
}

/**
 * Phase 3 — skip the continuity critic when the banked draft is already
 * pristine (strictOk + zero browser quality penalty + no static repair
 * warnings). Default ON; `SLACK_SEQUENCES_CRITIC_SKIP_CLEAN=0` restores
 * always-run. Read here (not `process.env` at the call site) so SENTINEL.md's
 * flag table stays the single source of truth.
 */
export function criticSkipCleanEnabled(): boolean {
  return slackSequencesEnvRawValue("SLACK_SEQUENCES_CRITIC_SKIP_CLEAN") !== "0";
}

/**
 * Route continuity-critic directives that name a shot through the scene-scoped
 * slot repair (`repairSlotDraftForFindings`) instead of a whole-document patch.
 * A small per-scene re-author validates far more often than a find/replace
 * patch against a large document — the sequence-check-1783463306190 probe
 * showed the whole-doc critique patch failing static validation and the
 * pre-critique draft shipping (two paid calls for nothing). Only fires when the
 * shipped draft came from the slot path (so a slot map exists) and EVERY
 * directive names a shot; film-level directives keep the whole-document path.
 * Adopted only on a strict non-regression guard (static + browser clean, the
 * quality penalty never rises), so a stale slot map can only miss the
 * optimization, never ship a worse film. Default ON;
 * `SLACK_SEQUENCES_CRITIC_SLOT_REPAIR=0` reverts to the whole-document critique
 * patch in one env var.
 */
export function criticSlotRepairEnabled(): boolean {
  return slackSequencesEnvRawValue("SLACK_SEQUENCES_CRITIC_SLOT_REPAIR") !== "0";
}

/**
 * Storyboard scene-scoped findings repair — the storyboard analogue of the
 * author-stage slot retry (`repairSlotDraftForFindings`). When a rejected
 * storyboard's EVERY blocking finding maps to a named scene, re-plan ONLY those
 * scenes (one bounded, low-reasoning call) against the locked timing envelope,
 * re-validate the merged plan through the full gate, and adopt it if it
 * converges — replacing the ~6-min whole-plan re-plan an attempt would cost.
 * Default ON; `SLACK_SEQUENCES_STORYBOARD_SCENE_REPAIR=0` reverts to the
 * whole-plan-only ladder in one env var (it only ever REPLACES a paid attempt
 * with a cheaper one and falls back to that same attempt on any miss, so it can
 * never reduce a run's chances — but the kill switch keeps the structural
 * change one flag from reverting).
 */
export function storyboardSceneRepairEnabled(): boolean {
  return slackSequencesEnvRawValue("SLACK_SEQUENCES_STORYBOARD_SCENE_REPAIR") !== "0";
}

/**
 * Recipe Studio Level-1 consumption — retrieval offers proven library recipes
 * to the planner and the host instantiates declared ones verbatim
 * (`recipeContract.ts`). Default ON: the operator wants recipes to be a
 * high-priority vocabulary on live creates, the whole path is
 * degrade-never-veto (a bad declaration is dropped at parse, never vetoes a
 * film), and instantiated output still passes the full gate.
 * `SLACK_SEQUENCES_RECIPES=0` reverts to the recipe-free pipeline in one env
 * var (an empty library behaves identically).
 */
export function recipesEnabled(): boolean {
  return slackSequencesEnvRawValue("SLACK_SEQUENCES_RECIPES") !== "0";
}

/**
 * Host plugins — parameterized generators the storyboard invokes as typed
 * `plugins:[{kind,params}]` forms and the host LOWERS into the existing
 * component/beat contracts plus a host-injected markup unit
 * (`pluginContract.ts`, the seventh host-owned contract). Default ON: the
 * whole path is degrade-never-veto (unknown kinds no-op, bad params
 * default/clamp/drop at parse — zero paid attempts), and lowered output still
 * passes every existing gate. `SLACK_SEQUENCES_PLUGINS=0` reverts to the
 * plugin-free pipeline in one env var (declarations then parse to nothing).
 */
export function pluginsEnabled(): boolean {
  return slackSequencesEnvRawValue("SLACK_SEQUENCES_PLUGINS") !== "0";
}

/**
 * Pre-built asset library — designer-grade parametric assets
 * (`assetContract.ts` + `src/engine/assets/`, ASSETS.md) exposed to the
 * planner as `asset-<id>` plugin kinds riding the plugin rails
 * (strip-and-reinject, default/clamp/drop governance, shared per-film
 * budget). Default ON after asset-probe-2 published clean;
 * `SLACK_SEQUENCES_ASSETS=0` reverts to the asset-free path. The Asset Lab
 * (`npm run assets`) works regardless of this flag — it reads the library
 * directly.
 */
export function assetsEnabled(): boolean {
  return slackSequencesEnvRawValue("SLACK_SEQUENCES_ASSETS") !== "0";
}
