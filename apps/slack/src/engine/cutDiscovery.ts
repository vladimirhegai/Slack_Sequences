/**
 * Shape-match discovery — measure-then-upgrade (v2 of the match-cut work).
 *
 * v1 shape-match is declare-then-hope: the planner names two parts and the
 * runtime's bind-time audit degrades the boundary when the authored geometry
 * does not rhyme. This module inverts the direction: browser QA measures the
 * *authored* film's focal-part geometry around every boundary
 * (`DirectBoundaryInventory`), and a pure, unit-testable score decides
 * whether one boundary provably rhymes well enough to upgrade — no model in
 * the loop, host-side mutation only.
 *
 * Policy guardrails (deliberate, not tunable per-call):
 * - Only boundaries currently `hard`/undeclared/directional are upgraded —
 *   never replace a zoom/flash/object-match some planner chose deliberately.
 * - The aspect cap (2.0×) is tighter than the runtime's 2.5× degrade, so our
 *   own choice can never trigger the degrade it is meant to avoid.
 * - At most two upgrades per film. The second is available only when the
 *   continuity graph's stable entity id proves it is the same product object.
 */
import type { DirectScene } from "./directComposition.ts";
import { resolveContinuityGraph } from "./continuityGraph.ts";
import type {
  BoundaryPartMeasurement,
  DirectBoundaryInventory,
} from "./layoutInspector.ts";

/** Hard cap on silhouette aspect distance (runtime degrades at 2.5×). */
const ASPECT_RATIO_CAP = 2.0;
/** Bridges are live clones; heavier subtrees double paint cost mid-flight. */
const MAX_SUBTREE_NODES = 60;
/** Both parts must be mostly on frame at their boundary sample. */
const MIN_ON_FRAME_RATIO = 0.65;
/** Area may differ (the bridge scales), but not absurdly. */
const AREA_RATIO_CAP = 6;
/** Minimum blended rhyme score for an upgrade to fire at all. */
const MIN_UPGRADE_SCORE = 0.55;

/** Cut styles a discovery upgrade may replace. `swipe` is the canonical
 * directional family (MD1); legacy names survive in cached storyboards. */
const UPGRADABLE_STYLES: ReadonlySet<string> = new Set([
  "hard",
  "swipe",
  "cut-left",
  "cut-right",
  "cut-up",
  "cut-down",
]);

export interface CutUpgradeDecision {
  fromScene: string;
  toScene: string;
  focalPartOut: string;
  focalPartIn: string;
  /** Blended rhyme score in 0..~1.2 (semantic bonus can push past 1). */
  score: number;
  sharedEntityId?: string;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Normalized roundness: 0 = square corner, 1 = fully round (pill/circle). */
function roundness(part: BoundaryPartMeasurement): number {
  const half = Math.min(part.width, part.height) / 2;
  return half > 0 ? clamp01(part.radiusPx / half) : 0;
}

function eligiblePart(part: BoundaryPartMeasurement): boolean {
  return (
    part.nodeCount <= MAX_SUBTREE_NODES &&
    part.onFrameRatio >= MIN_ON_FRAME_RATIO &&
    part.width > 0 &&
    part.height > 0
  );
}

/**
 * Rhyme score for one candidate pair. Radius similarity carries the most
 * weight (a pill landing as a bar reads because the silhouette language
 * matches), then aspect, then area. Returns undefined when a hard cap fails.
 */
export function scoreShapePair(
  outgoing: BoundaryPartMeasurement,
  incoming: BoundaryPartMeasurement,
): number | undefined {
  if (!eligiblePart(outgoing) || !eligiblePart(incoming)) return undefined;
  const aspectOut = outgoing.width / outgoing.height;
  const aspectIn = incoming.width / incoming.height;
  const aspectDistance = Math.max(aspectOut / aspectIn, aspectIn / aspectOut);
  if (aspectDistance > ASPECT_RATIO_CAP) return undefined;
  const areaOut = outgoing.width * outgoing.height;
  const areaIn = incoming.width * incoming.height;
  const areaRatio = Math.max(areaOut / areaIn, areaIn / areaOut);
  if (areaRatio > AREA_RATIO_CAP) return undefined;
  const radiusScore = 1 - Math.abs(roundness(outgoing) - roundness(incoming));
  const aspectScore = 1 - (aspectDistance - 1) / (ASPECT_RATIO_CAP - 1);
  const areaScore = clamp01(1 - (areaRatio - 1) / (AREA_RATIO_CAP - 1));
  return 0.45 * radiusScore + 0.35 * aspectScore + 0.2 * areaScore;
}

/** Parts the storyboard itself calls out — component ids, continuity anchors. */
function semanticBonus(scene: DirectScene | undefined, part: string): number {
  if (!scene) return 0;
  if (scene.components?.some((component) => component.id === part)) return 0.08;
  if (scene.continuityAnchor?.toLowerCase().includes(part.toLowerCase())) return 0.08;
  return 0;
}

function entityForPart(scene: DirectScene | undefined, part: string): string | undefined {
  if (!scene) return undefined;
  return scene.components?.find((component) => component.id === part)?.entityId ??
    scene.continuity?.find((appearance) => appearance.part === part)?.entityId;
}

/**
 * Pick the best measured boundary and, only with stable shared-entity proof,
 * one additional seam. A film with no genuine rhyme gets no upgrade — a
 * forced match cut is worse than a clean directional cut.
 */
export function discoverShapeMatchUpgrades(
  scenes: DirectScene[],
  boundaries: DirectBoundaryInventory[],
): CutUpgradeDecision[] {
  const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));
  const stateProofs = new Set(
    resolveContinuityGraph(scenes).edges
      .filter((edge) => edge.stateTransfer)
      .map((edge) => `${edge.fromScene}\0${edge.fromPart}\0${edge.toScene}\0${edge.toPart}`),
  );
  const candidates: CutUpgradeDecision[] = [];
  for (const boundary of boundaries) {
    const fromScene = scenesById.get(boundary.fromScene);
    if (!fromScene) continue;
    const style = fromScene.cut?.style ?? "hard";
    if (!UPGRADABLE_STYLES.has(style)) continue;
    for (const outgoing of boundary.outgoing) {
      for (const incoming of boundary.incoming) {
        if (!stateProofs.has(
          `${boundary.fromScene}\0${outgoing.part}\0${boundary.toScene}\0${incoming.part}`,
        )) continue;
        const base = scoreShapePair(outgoing, incoming);
        if (base === undefined) continue;
        const outgoingEntity = entityForPart(fromScene, outgoing.part);
        const incomingEntity = entityForPart(scenesById.get(boundary.toScene), incoming.part);
        const sharedEntityId = outgoingEntity && outgoingEntity === incomingEntity
          ? outgoingEntity
          : undefined;
        const score = base +
          semanticBonus(fromScene, outgoing.part) +
          semanticBonus(scenesById.get(boundary.toScene), incoming.part) +
          (sharedEntityId ? 0.25 : 0);
        if (score < MIN_UPGRADE_SCORE) continue;
        candidates.push({
          fromScene: boundary.fromScene,
          toScene: boundary.toScene,
          focalPartOut: outgoing.part,
          focalPartIn: incoming.part,
          score,
          ...(sharedEntityId ? { sharedEntityId } : {}),
        });
      }
    }
  }
  candidates.sort((a, b) =>
    b.score - a.score || a.fromScene.localeCompare(b.fromScene) ||
    a.focalPartOut.localeCompare(b.focalPartOut)
  );
  const selected: CutUpgradeDecision[] = [];
  const usedBoundaries = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.fromScene}\u0000${candidate.toScene}`;
    if (usedBoundaries.has(key)) continue;
    if (selected.length >= 1 && !candidate.sharedEntityId) continue;
    selected.push(candidate);
    usedBoundaries.add(key);
    if (selected.length >= 2) break;
  }
  return selected;
}

/** Backward-compatible single best decision for callers that want one seam. */
export function discoverShapeMatchUpgrade(
  scenes: DirectScene[],
  boundaries: DirectBoundaryInventory[],
): CutUpgradeDecision | undefined {
  return discoverShapeMatchUpgrades(scenes, boundaries)[0];
}

/** Stable reason vocabulary for runtime `cut_degraded` evidence. */
export const CUT_DEGRADATION_REASONS = [
  "paint-invisible",
  "zero-size",
  "aspect-ratio",
  "structure-mismatch",
  "semantic-family",
  "subtree-complexity",
  "off-frame",
  "missing-endpoint",
  "state-proof",
  "unknown",
] as const;

export type CutDegradationReason = typeof CUT_DEGRADATION_REASONS[number];

export interface CutDegradationEvidence {
  /** Raw runtime warning, browser finding, or persisted diagnostic string. */
  message: string;
  /** Usually a project/job id; keeps the same boundary in distinct films distinct. */
  source?: string;
}

export interface CutDegradationReasonCount {
  reason: CutDegradationReason;
  count: number;
  boundaries: string[];
}

export interface CutDegradationSummary {
  /** Unique source + boundary + reason occurrences, not duplicate encodings. */
  total: number;
  counts: CutDegradationReasonCount[];
  /** Bounded examples for newly introduced runtime reason text. */
  unclassifiedSamples: string[];
}

/** Boundary key carried by both runtime warnings and measured browser findings. */
export function cutDegradationBoundary(message: string): string | undefined {
  return message.match(/\b([a-z0-9][\w-]*->[a-z0-9][\w-]*)\b/i)?.[1];
}

/**
 * Classify one reason-bearing `cut_degraded` diagnostic. Bare codes and
 * author-run boundary signatures deliberately return undefined: they contain
 * no cause and would double-count the warning/finding that supplied it.
 */
export function classifyCutDegradationReason(
  message: string,
): CutDegradationReason | undefined {
  const text = message.trim();
  if (!/cut_degraded/i.test(text)) return undefined;
  const hasReason = /(?:compiled as|degraded it to)[^:]*:/i.test(text) ||
    /(?:no visible painted content|measured zero size|aspect ratio|mismatched structure|semantic families|subtree exceeds|mostly (?:off|outside) (?:the )?frame|part .* (?:is absent|was not found))/i.test(text);
  if (!hasReason) return undefined;
  if (/no visible painted content/i.test(text)) return "paint-invisible";
  if (/measured zero size/i.test(text)) return "zero-size";
  if (/aspect ratio/i.test(text)) return "aspect-ratio";
  if (/mismatched structure/i.test(text)) return "structure-mismatch";
  if (/semantic families/i.test(text)) return "semantic-family";
  if (/subtree exceeds|exceeds \d+ nodes/i.test(text)) return "subtree-complexity";
  if (/mostly (?:off|outside) (?:the )?frame|not sufficiently on frame/i.test(text)) {
    return "off-frame";
  }
  if (/part .* (?:is absent|was not found)/i.test(text)) return "missing-endpoint";
  if (/continuity state transfer/i.test(text)) return "state-proof";
  return "unknown";
}

/**
 * Summarize persisted degradation causes without inflating counts when one
 * boundary appears as a runtime warning, measured issue, and author signature.
 * A cause counts once per source/project + boundary; the same seam in another
 * film remains an independent observation.
 */
export function summarizeCutDegradationReasons(
  evidence: readonly CutDegradationEvidence[],
): CutDegradationSummary {
  const seen = new Set<string>();
  const byReason = new Map<CutDegradationReason, { count: number; boundaries: Set<string> }>();
  const unclassifiedSamples: string[] = [];
  for (const [index, item] of evidence.entries()) {
    const reason = classifyCutDegradationReason(item.message);
    if (!reason) continue;
    const boundary = cutDegradationBoundary(item.message) ?? `unknown-${index + 1}`;
    const key = `${item.source ?? ""}\u0000${boundary}\u0000${reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = byReason.get(reason) ?? { count: 0, boundaries: new Set<string>() };
    row.count += 1;
    row.boundaries.add(boundary);
    byReason.set(reason, row);
    if (reason === "unknown" && unclassifiedSamples.length < 5) {
      unclassifiedSamples.push(item.message.slice(0, 240));
    }
  }
  const counts = [...byReason].map(([reason, row]) => ({
    reason,
    count: row.count,
    boundaries: [...row.boundaries].sort(),
  })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  return { total: seen.size, counts, unclassifiedSamples };
}
