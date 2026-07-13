import type { DirectBrowserQaResult, DirectLayoutIssue } from "../layoutInspector.ts";
import { QUIET_WINDOW_REVIEW_SEC } from "../continuousMotion.ts";
import { slackSequencesEnvRawValue } from "../featureFlags.ts";
import { SENTINEL_CONTRACT, type SentinelBlocking } from "../sentinel.ts";
import { dedupeFeedbackBySignature, findingSignature } from "./findingSignatures.ts";
import type { CompositionRunResult } from "./types.ts";

/**
 * Codes the operator reads as "messy" on the shipped film (WS6 shipping
 * policy): a clipped or near-empty camera landing, a degraded declared morph,
 * or an eye-trace jump. They outweigh a handful of minor warnings so the
 * least-bad-draft pick at attempt 3 strongly prefers a film without them —
 * never unpublishable (fallback pressure is worse), just heavily dispreferred.
 */
const HIGH_VISIBILITY_ISSUE_WEIGHTS: Record<string, number> = {
  camera_framed_clipped: 10,
  camera_framed_sparse: 6,
  camera_blocking_landing: 8,
  camera_blocking_anchor: 8,
  camera_blocking_unsettled: 6,
  spatial_focal_invisible: 8,
  spatial_focal_offframe: 8,
  cut_degraded: 6,
  eye_trace_jump: 6,
  motion_quiet_window: 6,
  motion_jerk_excess: 5,
  motion_reversal_excess: 5,
  motion_settle_late: 5,
  transition_static_outgoing: 6,
  motion_dead_frame: 6,
};

/**
 * Findings that ask for a DECLARATION, not a visual change. A banked draft is
 * not one pixel worse for lacking relational layout paperwork, so these must
 * not steer the least-bad pick or hold the attempt-2 budget broker under its
 * penalty ceiling (2026-07-07 ledger sweep: `layout_intent_missing` was the
 * single most repeated browser-rejection line, repeated VERBATIM across paid
 * patch attempts on every probe — the patch never declares the intent, and the
 * film ships with the finding as an advisory at attempt 3 anyway).
 */
const PAPERWORK_ISSUE_WEIGHTS: Record<string, number> = {
  layout_intent_missing: 0,
};

/**
 * Measured taste-polish findings that should steer the banked-draft pick but
 * remain eligible for the advisory-late delivery rung. Keep them separate
 * from HIGH_VISIBILITY_ISSUE_WEIGHTS: that table also blocks the early
 * least-bad broker, while a washout finding must never become a publication
 * veto when a bounded repair cannot improve it.
 */
const POLISH_ISSUE_WEIGHTS: Record<string, number> = {
  composition_washed_out: 3,
};

export function browserQualityPenalty(
  browserQa: DirectBrowserQaResult,
  staticRepairWarnings: string[] = [],
): number {
  const runtimeWarnings = browserQa.warnings.filter((warning) =>
    warning.startsWith("browser_warning:")
  ).length;
  return staticRepairWarnings.length * 2 + runtimeWarnings * 2 +
    measuredArtSignalPenalty(browserQa) +
    browserQa.issues.reduce(
      (total, issue) =>
        total + (
          issue.code === "moment_static_frame" && issue.momentImportance === "primary"
            ? 6
            :
          PAPERWORK_ISSUE_WEIGHTS[issue.code] ??
          POLISH_ISSUE_WEIGHTS[issue.code] ??
          HIGH_VISIBILITY_ISSUE_WEIGHTS[issue.code] ??
          (issue.severity === "error" ? 4 : issue.severity === "warning" ? 1 : 0)
        ),
      0,
    );
}

export function browserQualityNonRegression(args: {
  before: DirectBrowserQaResult | undefined;
  beforeStaticWarnings?: string[];
  after: DirectBrowserQaResult;
  afterStaticWarnings?: string[];
}): {
  accepted: boolean;
  beforePenalty?: number;
  afterPenalty?: number;
  reason?: "baseline-missing" | "infrastructure" | "hard-failure" | "quality-regression";
} {
  if (!args.before || args.before.infraError) {
    return { accepted: false, reason: "baseline-missing" };
  }
  if (args.after.infraError) return { accepted: false, reason: "infrastructure" };
  if (!args.after.ok) return { accepted: false, reason: "hard-failure" };
  const beforePenalty = browserQualityPenalty(
    args.before,
    args.beforeStaticWarnings ?? [],
  );
  const afterPenalty = browserQualityPenalty(
    args.after,
    args.afterStaticWarnings ?? [],
  );
  return afterPenalty > beforePenalty
    ? { accepted: false, beforePenalty, afterPenalty, reason: "quality-regression" }
    : { accepted: true, beforePenalty, afterPenalty };
}

/**
 * Degree-sensitive ranking pressure for art signals already measured by the
 * blocking director and continuous playback pass. This never affects `ok` and
 * deliberately ignores raw tiny-focal counts: typed occupancy ranges and the
 * whole-frame sparse audit know whether a compact subject is appropriate.
 */
export function measuredArtSignalPenalty(browserQa: DirectBrowserQaResult): number {
  let penalty = 0;
  const blocking = browserQa.cameraBlockingEvidence;
  if (blocking) {
    for (const landing of blocking.landings.filter((entry) =>
      entry.importance === "primary" && entry.measured
    )) {
      if (!landing.occupancyInRange) penalty += 2;
      // Ensemble phrases intentionally frame a region/station instead of
      // forcing the individual subject onto its solo anchor. The blocking
      // evidence and issue gate already waive that subject-only anchor check;
      // ranking must mirror the same contract or a clean contextual landing
      // still carries hidden least-bad/retry pressure (RouteBoardQC5).
      if (!landing.framingTarget && landing.anchorError > 0.14) {
        penalty += Math.min(4, Math.max(1, Math.ceil((landing.anchorError - 0.14) * 20)));
      }
      if (landing.speed > 0.018) {
        penalty += Math.min(4, Math.max(1, Math.ceil((landing.speed - 0.018) * 20)));
      }
    }
  }
  const motion = browserQa.continuousMotion;
  if (motion) {
    const measured = motion.settleWindows.filter((window) => window.measured);
    if (measured.length >= 4) {
      const settled = measured.filter((window) => window.settledByWindowEnd).length;
      const missRatio = 1 - settled / measured.length;
      if (missRatio > 0.45) penalty += Math.min(4, Math.ceil((missRatio - 0.45) * 10));
    }
    const surfacedQuietWindows = motion.quietWindows.filter((window) =>
      window.durationSec >= QUIET_WINDOW_REVIEW_SEC &&
      browserQa.issues.some((issue) =>
        issue.code === "motion_quiet_window" && issue.sceneId === window.sceneId &&
        (issue.time === undefined || Math.abs(issue.time - window.startSec) <= 0.1)
      )
    );
    // The browser inspector intentionally waives DOM-quiet windows when the
    // living environment carries rendered motion. Only degree-score windows
    // that survived that contextual gate as an actual issue; otherwise a
    // visually alive film receives hidden least-bad pressure with no finding
    // the author can see or repair.
    penalty += surfacedQuietWindows
      .reduce((sum, window) =>
        sum + Math.min(4, Math.max(1, Math.ceil(window.durationSec - 0.8))), 0);
    const deadFrames = motion.renderedDeadFrames;
    if (deadFrames) {
      penalty += deadFrames.windows.reduce(
        (sum, window) => sum + Math.min(5, Math.max(1, Math.ceil(window.durationSec - 1))),
        0,
      );
      penalty += Math.min(4, Math.ceil(deadFrames.summary.deadFrameRatio * 10));
    }
  }
  return penalty;
}

const LAYOUT_REPAIR_SCORE_WEIGHTS: Record<string, number> = {
  clipped_text: 4,
  text_box_overflow: 4,
  important_safe_area: 2,
  container_overflow: 2,
  canvas_overflow: 1,
  content_overlap: 1,
};

export function layoutRepairIssueScore(browserQa: DirectBrowserQaResult): number {
  return (browserQa.issues ?? []).reduce(
    (score, issue) => score + (LAYOUT_REPAIR_SCORE_WEIGHTS[issue.code] ?? 0),
    0,
  );
}

export function layoutRepairTargetScore(browserQa: DirectBrowserQaResult): number {
  return (browserQa.issues ?? []).reduce(
    (score, issue) =>
      score + (issue.code === "canvas_overflow" ? 1 : issue.code === "important_safe_area" ? 2 : 0),
    0,
  );
}

const LAYOUT_REPAIR_PROTECTED_CODES = new Set([
  "clipped_text",
  "text_box_overflow",
  "content_overlap",
  "container_overflow",
  "important_safe_area",
  "camera_framed_clipped",
  "camera_framed_sparse",
  "cut_degraded",
]);

function protectedLayoutIssueCounts(browserQa: DirectBrowserQaResult): Map<string, number> {
  const counts = new Map<string, number>();
  for (const issue of browserQa.issues ?? []) {
    const key = issue.code.startsWith("interaction_")
      ? "interaction_*"
      : LAYOUT_REPAIR_PROTECTED_CODES.has(issue.code)
        ? issue.code
        : undefined;
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function protectedLayoutIssuesIncreased(
  before: DirectBrowserQaResult,
  after: DirectBrowserQaResult,
): boolean {
  const beforeCounts = protectedLayoutIssueCounts(before);
  const afterCounts = protectedLayoutIssueCounts(after);
  for (const [key, count] of afterCounts) {
    if (count > (beforeCounts.get(key) ?? 0)) return true;
  }
  return false;
}

export function hasNoNewDiagnostics(before: readonly string[], after: readonly string[]): boolean {
  const remaining = new Map<string, number>();
  for (const entry of before) remaining.set(entry, (remaining.get(entry) ?? 0) + 1);
  for (const entry of after) {
    const count = remaining.get(entry) ?? 0;
    if (count <= 0) return false;
    if (count === 1) remaining.delete(entry);
    else remaining.set(entry, count - 1);
  }
  return true;
}

const SENTINEL_BLOCKING_BY_PREFIX = SENTINEL_CONTRACT.flatMap((row) =>
  row.findingPrefixes.map((prefix) => ({ prefix, blocking: row.blocking }))
);

const EARLY_LEAST_BAD_MAX_PENALTY = (() => {
  const raw = Number(slackSequencesEnvRawValue("SLACK_SEQUENCES_EARLY_LEAST_BAD_MAX_PENALTY"));
  return Number.isFinite(raw) && raw >= 0 ? raw : 4;
})();

function sentinelBlockingForFinding(finding: string): SentinelBlocking | undefined {
  const normalized = finding.trim();
  return SENTINEL_BLOCKING_BY_PREFIX.find((entry) =>
    normalized.startsWith(entry.prefix)
  )?.blocking;
}

const LOAD_BEARING_READABILITY_CODES = new Set([
  "clipped_text",
  "text_box_overflow",
  "text_occluded",
]);

function failedLoadBearingKeys(browserQa: DirectBrowserQaResult): Set<string> {
  return new Set((browserQa.loadBearingContainment ?? [])
    .filter((entry) =>
      !entry.found || entry.opacity < 0.35 ||
      entry.visibleFraction + 1e-6 < entry.requiredVisibleFraction
    )
    .map((entry) => `${entry.sceneId}\u0000${entry.part}`));
}

/**
 * The only browser findings allowed to buy another source call. Raw QA keeps
 * every advisory; this list collapses retry ownership to runtime/blankness,
 * broken typed interactions, and unresolved load-bearing containment/read.
 */
export function unresolvedHardBrowserFindings(
  browserQa: DirectBrowserQaResult,
): string[] {
  const hard: string[] = [...(browserQa.errors ?? [])];
  const failedKeys = failedLoadBearingKeys(browserQa);
  const loadBearingKeys = new Set((browserQa.loadBearingContainment ?? [])
    .map((entry) => `${entry.sceneId}\u0000${entry.part}`));
  for (const entry of browserQa.loadBearingContainment ?? []) {
    if (!failedKeys.has(`${entry.sceneId}\u0000${entry.part}`)) continue;
    const state = !entry.found
      ? "missing"
      : entry.opacity < 0.35
        ? "invisible"
        : `${(entry.visibleFraction * 100).toFixed(1)}% visible; requires ` +
          `${(entry.requiredVisibleFraction * 100).toFixed(1)}%`;
    hard.push(
      `load_bearing_containment: scene "${entry.sceneId}" part "${entry.part}" remains ${state}`,
    );
  }
  for (const issue of browserQa.issues ?? []) {
    const issuePart = issue.part ?? issue.componentRootPart;
    const key = issue.sceneId && issuePart ? `${issue.sceneId}\u0000${issuePart}` : undefined;
    const unresolvedPrimary = Boolean(key && failedKeys.has(key));
    const hardIssue =
      issue.code === "near_blank_scene" ||
      issue.code === "camera_framed_clipped" ||
      (issue.code.startsWith("interaction_") && issue.severity === "error") ||
      (LOAD_BEARING_READABILITY_CODES.has(issue.code) && Boolean(key && loadBearingKeys.has(key))) ||
      ((issue.code === "spatial_focal_missing" ||
        issue.code === "spatial_focal_invisible" ||
        issue.code === "spatial_focal_offframe") &&
        ((browserQa.loadBearingContainment ?? []).length === 0 || unresolvedPrimary));
    if (hardIssue) {
      hard.push(`${issue.code}: ${issue.message}`);
    }
  }
  return dedupeFeedbackBySignature(hard);
}

export function browserQaHasUnresolvedHardFailure(
  browserQa: DirectBrowserQaResult | undefined,
): boolean {
  return Boolean(
    browserQa &&
    !browserQa.infraError &&
    (!browserQa.ok || unresolvedHardBrowserFindings(browserQa).length > 0),
  );
}

/**
 * Browser feedback for paid source retries. An invisible PRIMARY payoff is a
 * real choreography defect and gets repair pressure. Supporting static beats
 * stay diagnostic unless the same draft is also blank/dead.
 */
export function sourceRetryFeedbackForBrowserQa(
  browserQa: DirectBrowserQaResult,
  _staticRepairWarnings: string[] = [],
): string[] {
  return unresolvedHardBrowserFindings(browserQa);
}

function staticWarningBlocksEarlyLeastBad(warning: string): boolean {
  const blocking = sentinelBlockingForFinding(warning);
  return blocking !== "advisory" && blocking !== "advisory-late";
}

function browserIssueBlocksEarlyLeastBad(issue: DirectLayoutIssue): boolean {
  if (issue.severity === "info") return false;
  if (issue.code === "moment_static_frame") return issue.momentImportance === "primary";
  if (HIGH_VISIBILITY_ISSUE_WEIGHTS[issue.code] !== undefined) return true;
  const blocking = sentinelBlockingForFinding(issue.code);
  if (blocking === "advisory" || blocking === "advisory-late") return false;
  return true;
}

/**
 * Attempt-2 budget broker: publish a banked runtime-valid draft early only
 * when the remaining findings are low-penalty advisory/polish classes. This
 * saves the third paid author pass without weakening hard runtime, blank-film,
 * interaction, or high-visibility visual gates.
 */
export function earlyLeastBadPublishReason(
  candidate: CompositionRunResult & { qualityPenalty: number },
): string | undefined {
  const browserQa = candidate.browserQa;
  if (!browserQa || !browserQa.ok || browserQa.infraError) return undefined;
  if (candidate.qualityPenalty > EARLY_LEAST_BAD_MAX_PENALTY) return undefined;
  if ((browserQa.warnings ?? []).some((warning) => warning.startsWith("browser_warning:"))) {
    return undefined;
  }
  if ((candidate.staticRepairWarnings ?? []).some(staticWarningBlocksEarlyLeastBad)) {
    return undefined;
  }
  if ((browserQa.issues ?? []).some(browserIssueBlocksEarlyLeastBad)) return undefined;
  const codes = [
    ...new Set([
      ...(browserQa.issues ?? []).map((issue) => issue.code),
      ...(candidate.staticRepairWarnings ?? []).map((warning) =>
        warning.split(/\s+/, 1)[0] ?? "static-warning"
      ),
    ]),
  ];
  return `early-least-bad-pick:penalty=${candidate.qualityPenalty};findings=${
    codes.length ? codes.join(",") : "polish"
  }`;
}

/**
 * Attempt-economy exit (2026-07-07 ledger sweep): a browser rejection whose
 * finding-signature set is IDENTICAL to the previous rejected attempt's proves
 * the paid patch between them changed nothing the gate can measure. Every
 * recent probe showed this shape — the same polish findings, verbatim, on
 * attempts 1 and 2 — after which attempt 3 shipped the banked least-bad draft
 * with those findings as advisories anyway. When that happens, ship the banked
 * draft NOW: the artifact is identical to what attempt 3 would publish, minus
 * one paid patch call and one full browser-QA cycle. Gates unchanged — this is
 * evidence-based demotion timing, not a new acceptance. Hard failures never
 * qualify (`browserQaOk` is false on runtime/interaction/blank-film errors,
 * which also never bank a least-bad candidate).
 *
 * Signatures compare DIGIT-STRIPPED (the storyboard commit-or-revert classKey
 * precedent): measured values and time windows jitter between attempts
 * (contrast 4.4→3.39 on the same element, a window shifting 0.89–1.60 →
 * 0.90–1.90), and a patch that nudged a measurement without clearing the
 * defect is still the same defect list. A patch that CLEARS or MINTS a
 * finding changes the set and keeps the ladder running.
 */
export function stagnantPolishSignature(finding: string): string {
  // The sampled-time parenthetical also changes SHAPE between attempts (a
  // point `(t=7.74s)` vs a window `(t=7.74–8.35s)`), so it is removed whole
  // before the digit strip.
  return findingSignature(finding)
    .replace(/\(t=[^)]*\)/g, "(t)")
    .replace(/\d+(?:\.\d+)?/g, "#");
}

export function stagnantPolishShipReason(args: {
  attempt: number;
  browserQaOk: boolean;
  currentSignatures: readonly string[];
  previousSignatures: ReadonlySet<string>;
  bankedPenalty: number | undefined;
}): string | undefined {
  if (args.attempt < 2 || !args.browserQaOk) return undefined;
  if (args.bankedPenalty === undefined) return undefined;
  const current = new Set(args.currentSignatures);
  if (!current.size || current.size !== args.previousSignatures.size) return undefined;
  for (const signature of current) {
    if (!args.previousSignatures.has(signature)) return undefined;
  }
  return `stagnant-polish-early-ship:penalty=${args.bankedPenalty}`;
}

/**
 * Sentinel Phase 3 critic gating: a draft the continuity critic cannot help is
 * pure latency (its 1-2 paid calls, ~1-2 min). Two disjoint cases skip it, both
 * behind `SLACK_SEQUENCES_CRITIC_SKIP_CLEAN`:
 *
 * 1. **Pristine** — a browser-QA pass ran (not an infra outage), it is
 *    `strictOk` (no polish finding requested a repair), and its quality penalty
 *    is zero (no weighted issue, no browser console warning). Every declared
 *    moment is necessarily bound too — an unbound moment fails
 *    `validateDirectComposition` upstream — so a pristine draft has nothing left
 *    to repair.
 *
 * 2. **Stagnant** (2026-07-08 critic-economy) — the run shipped a banked
 *    least-bad draft under `stagnant-polish-early-ship`, meaning two consecutive
 *    browser rejections carried an IDENTICAL finding-signature set: the paid
 *    patch between them moved nothing the gate measures. A draft that provably
 *    resisted two targeted patches will not absorb a third, and the critic's
 *    repair IS a third patch of the same shape (a compact/scene re-author under
 *    full QA). Running it would spend 1-2 paid calls to re-derive the same
 *    banked draft. This is deliberately narrow: ONLY the stagnation reason
 *    qualifies — NOT the ordinary attempt-3 `least-bad-pick` (which never proved
 *    two-patch resistance) and NOT `early-least-bad-pick` (a low-penalty draft
 *    the critic may still improve). Conservative by construction: any draft that
 *    is not provably stuck still runs the critic.
 */
export function criticSkippableCleanDraft(
  browserQa: DirectBrowserQaResult | undefined,
  staticRepairWarnings: string[] = [],
  shipReason?: string,
): boolean {
  if (!browserQa || browserQa.infraError) return false;
  if (browserQa.strictOk && browserQualityPenalty(browserQa, staticRepairWarnings) === 0) {
    return true;
  }
  return shipReason?.startsWith("stagnant-polish-early-ship") ||
    shipReason?.startsWith("runtime-valid-no-hard-bank") || false;
}
