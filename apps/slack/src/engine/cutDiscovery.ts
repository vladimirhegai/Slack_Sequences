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
 * - Max ONE upgraded boundary per film: premium cuts read premium because
 *   they are rare.
 */
import type { DirectScene } from "./directComposition.ts";
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

/**
 * Pick at most ONE boundary to upgrade to shape-match: the best-scoring
 * measured pair across all `hard`/directional boundaries, above the score
 * floor. A film with no genuine rhyme gets no upgrade — a forced match cut
 * is worse than a clean directional cut.
 */
export function discoverShapeMatchUpgrade(
  scenes: DirectScene[],
  boundaries: DirectBoundaryInventory[],
): CutUpgradeDecision | undefined {
  const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));
  let best: CutUpgradeDecision | undefined;
  for (const boundary of boundaries) {
    const fromScene = scenesById.get(boundary.fromScene);
    if (!fromScene) continue;
    const style = fromScene.cut?.style ?? "hard";
    if (!UPGRADABLE_STYLES.has(style)) continue;
    for (const outgoing of boundary.outgoing) {
      for (const incoming of boundary.incoming) {
        const base = scoreShapePair(outgoing, incoming);
        if (base === undefined) continue;
        const score = base +
          semanticBonus(fromScene, outgoing.part) +
          semanticBonus(scenesById.get(boundary.toScene), incoming.part);
        if (score < MIN_UPGRADE_SCORE) continue;
        if (!best || score > best.score) {
          best = {
            fromScene: boundary.fromScene,
            toScene: boundary.toScene,
            focalPartOut: outgoing.part,
            focalPartIn: incoming.part,
            score,
          };
        }
      }
    }
  }
  return best;
}
