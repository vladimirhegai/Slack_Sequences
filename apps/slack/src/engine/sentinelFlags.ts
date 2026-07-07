/**
 * Sentinel feature flags — the kill-switch surface for the
 * correctness-by-construction rework (SENTINEL_PLAN.md §4.5). Every new
 * behavior is gated here so the legacy path stays one env var away until the
 * Phase-5 probes flip the defaults. Read through these helpers, never
 * `process.env` directly, so SENTINEL.md has a single source of truth.
 */

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
  return process.env.SLACK_SEQUENCES_SENTINEL_SKELETON !== "0";
}

/**
 * Phase 2 — scene-addressable authoring (film_style + per-scene slots) so
 * validation/truncation/retries are scene-scoped. Default ON since the
 * 2026-07-06 Phase-5 completion probes; `SLACK_SEQUENCES_SENTINEL_SLOTS=0`
 * force-reverts to whole-doc for one release.
 */
export function sentinelSlotsEnabled(): boolean {
  return process.env.SLACK_SEQUENCES_SENTINEL_SLOTS !== "0";
}

/**
 * Phase 3 — skip the continuity critic when the banked draft is already
 * pristine (strictOk + zero browser quality penalty + no static repair
 * warnings). Default ON; `SLACK_SEQUENCES_CRITIC_SKIP_CLEAN=0` restores
 * always-run. Read here (not `process.env` at the call site) so SENTINEL.md's
 * flag table stays the single source of truth.
 */
export function criticSkipCleanEnabled(): boolean {
  return process.env.SLACK_SEQUENCES_CRITIC_SKIP_CLEAN !== "0";
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
  return process.env.SLACK_SEQUENCES_RECIPES !== "0";
}
