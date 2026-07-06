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
 * paperwork classes are unrepresentable rather than repaired. Default OFF until
 * Phase 5; `SLACK_SEQUENCES_SENTINEL_SKELETON=0` force-reverts to bare shells.
 */
export function sentinelSkeletonEnabled(): boolean {
  return process.env.SLACK_SEQUENCES_SENTINEL_SKELETON === "1";
}

/**
 * Phase 2 — scene-addressable authoring (film_style + per-scene slots) so
 * validation/truncation/retries are scene-scoped. Default OFF until Phase 5;
 * `SLACK_SEQUENCES_SENTINEL_SLOTS=1` enables, `=0` force-reverts to whole-doc.
 */
export function sentinelSlotsEnabled(): boolean {
  return process.env.SLACK_SEQUENCES_SENTINEL_SLOTS === "1";
}
