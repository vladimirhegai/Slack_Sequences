/**
 * Eye-trace continuity scoring (WS2) — pure functions over browser-measured
 * boundary geometry, in the `cutDiscovery.ts` style: layout QA measures, this
 * module decides, the inspector reports.
 *
 * The craft rule (Murch's eye-trace): know where the audience is looking at
 * the cut, and put the next subject THERE — or carry the eye with an explicit
 * directional/zoom move. A `hard` cut that teleports the subject across the
 * frame breaks comprehension; probe-cutfix-3's operator read it as "I
 * constantly look all over the place".
 *
 * Two findings come out of this module:
 *
 * - `eye_trace_jump` (boundary): the outgoing attention target's viewport
 *   center vs the incoming attention target's center, measured by the
 *   existing `DirectBoundaryInventory` pass (just before the cut / at entry
 *   settle, under the real camera transform). Judged only on cut styles that
 *   do NOT carry or reset the eye.
 * - `eye_trace_pingpong` (within scene, advisory): consecutive beats whose
 *   targets yank the gaze across most of the frame in under ~1.2s.
 *
 * Everything here is a pure function of measured rects + the storyboard, so
 * thresholds are unit-testable without a browser.
 */
import { resolveTimeRampPlan, warpInverseOf } from "./timeRamp.ts";
import type { DirectScene } from "./directComposition.ts";
import type {
  BoundaryPartMeasurement,
  DirectBoundaryInventory,
} from "./layoutInspector.ts";

/** Displacement (fraction of the frame diagonal) above which a jump breaks eye trace. */
export const EYE_TRACE_JUMP_FRACTION = 0.38;
/** Both endpoints must be at least this on-frame for their centers to mean anything. */
export const EYE_TRACE_MIN_ON_FRAME = 0.3;
/** Within-scene: consecutive beat targets further apart than this ping-pong. */
export const PING_PONG_FRACTION = 0.5;
/** Within-scene: only beat pairs closer than this in time are ping-pong candidates. */
export const PING_PONG_WINDOW_SEC = 1.2;
/**
 * Beats closer than this are a deliberate simultaneous ensemble (the
 * component runtime settles them in a 45ms cascade) — not two eye targets.
 */
export const PING_PONG_MIN_GAP_SEC = 0.25;
/** Bound the extra QA seeks the ping-pong measurement may spend per film. */
export const PING_PONG_MAX_PAIRS = 6;

/**
 * Cut styles that legitimately carry the eye across the boundary (directional
 * velocity match, zoom register, a bridged focal element) or reset it (the
 * flash blanks the retina, so there is no gaze position to preserve). `hard`
 * and undeclared boundaries (authored crossfades) do neither — they are the
 * styles this audit judges.
 */
const EYE_CARRYING_CUT_STYLES = new Set([
  "cut-left",
  "cut-right",
  "cut-up",
  "cut-down",
  "zoom-through",
  "inverse-zoom",
  "object-match",
  "shape-match",
  "flash-white",
]);

export interface EyeTraceAttention {
  /** Where the eye is just before the cut (data-part name). */
  outPart?: string;
  /** Where the incoming shot first asks the eye to be (data-part name). */
  inPart?: string;
}

/**
 * Resolve the attention targets for one boundary from declared intent:
 * outgoing = the cut's focal-out part, else the last beat's component, else
 * the scene's declared focal part; incoming = the cut's focal-in part, else
 * the entry-framed station's hero component, else the first beat's target.
 */
export function resolveBoundaryAttention(
  from: DirectScene,
  to: DirectScene,
): EyeTraceAttention {
  const lastBeat = [...(from.beats ?? [])].sort((a, b) => a.atSec - b.atSec).pop();
  const outPart =
    from.cut?.focalPartOut ?? lastBeat?.component ?? from.spatialIntent?.focalPart;

  const components = to.components ?? [];
  const entryMove = to.camera?.path?.[0];
  const entryRegion = entryMove?.fromRegion ?? entryMove?.toRegion;
  const stationComponents = entryRegion
    ? components.filter((component) => component.region === entryRegion)
    : components;
  const hero = (stationComponents.length ? stationComponents : components)
    .find((component) => component.role === "hero");
  const firstBeat = [...(to.beats ?? [])].sort((a, b) => a.atSec - b.atSec)[0];
  const inPart = from.cut?.focalPartIn ?? hero?.id ?? firstBeat?.component;

  return {
    ...(outPart ? { outPart } : {}),
    ...(inPart ? { inPart } : {}),
  };
}

export interface EyeTraceJumpFinding {
  fromScene: string;
  toScene: string;
  atSec: number;
  cutStyle: string;
  outPart: string;
  inPart: string;
  outCenter: { x: number; y: number };
  inCenter: { x: number; y: number };
  /** Gaze displacement as a fraction of the frame diagonal. */
  displacementFraction: number;
}

function measuredCenter(
  side: BoundaryPartMeasurement[],
  part: string,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number } | undefined {
  const measurement = side.find((entry) => entry.part === part);
  if (!measurement || measurement.onFrameRatio < EYE_TRACE_MIN_ON_FRAME) return undefined;
  // A partially off-frame part's true center may sit outside the viewport;
  // the eye can only rest on the visible portion, so clamp into the frame.
  return {
    x: Math.min(frameWidth, Math.max(0, measurement.left + measurement.width / 2)),
    y: Math.min(frameHeight, Math.max(0, measurement.top + measurement.height / 2)),
  };
}

/**
 * Score every boundary the inventory measured. Conservative by construction:
 * a boundary is silent unless BOTH attention targets resolved from declared
 * intent AND both were actually measured mostly on frame — a missing part is
 * some other audit's finding, not evidence of an eye jump.
 */
export function scoreEyeTraceBoundaries(args: {
  scenes: DirectScene[];
  boundaries: DirectBoundaryInventory[];
  frameWidth: number;
  frameHeight: number;
}): EyeTraceJumpFinding[] {
  const findings: EyeTraceJumpFinding[] = [];
  const diagonal = Math.hypot(args.frameWidth, args.frameHeight);
  if (!Number.isFinite(diagonal) || diagonal <= 0) return findings;
  const sceneById = new Map(args.scenes.map((scene) => [scene.id, scene]));
  for (const boundary of args.boundaries) {
    const from = sceneById.get(boundary.fromScene);
    const to = sceneById.get(boundary.toScene);
    if (!from || !to) continue;
    const cutStyle = from.cut?.style ?? "hard";
    if (EYE_CARRYING_CUT_STYLES.has(cutStyle)) continue;
    const attention = resolveBoundaryAttention(from, to);
    if (!attention.outPart || !attention.inPart) continue;
    const outCenter = measuredCenter(
      boundary.outgoing,
      attention.outPart,
      args.frameWidth,
      args.frameHeight,
    );
    const inCenter = measuredCenter(
      boundary.incoming,
      attention.inPart,
      args.frameWidth,
      args.frameHeight,
    );
    if (!outCenter || !inCenter) continue;
    const displacementFraction =
      Math.hypot(inCenter.x - outCenter.x, inCenter.y - outCenter.y) / diagonal;
    if (displacementFraction <= EYE_TRACE_JUMP_FRACTION) continue;
    findings.push({
      fromScene: boundary.fromScene,
      toScene: boundary.toScene,
      atSec: boundary.atSec,
      cutStyle,
      outPart: attention.outPart,
      inPart: attention.inPart,
      outCenter: { x: Math.round(outCenter.x), y: Math.round(outCenter.y) },
      inCenter: { x: Math.round(inCenter.x), y: Math.round(inCenter.y) },
      displacementFraction: Math.round(displacementFraction * 1000) / 1000,
    });
  }
  return findings;
}

export interface PingPongCandidate {
  sceneId: string;
  firstBeatId: string;
  secondBeatId: string;
  firstPart: string;
  secondPart: string;
  firstAtSec: number;
  secondAtSec: number;
  /** Beat gap as the viewer experiences it (content gap warped through any time ramp). */
  viewerGapSec: number;
  /** Content time at which the inspector measures the FIRST target (just after its beat). */
  firstMeasureAtSec: number;
  /** Content time at which the inspector measures the SECOND target (just after its beat). */
  secondMeasureAtSec: number;
}

/**
 * Consecutive-beat pairs whose targets differ and whose spacing lands in the
 * ping-pong window — judged in VIEWER time, since a slow-motion ramp can
 * stretch a 1.0s content gap well past the window the eye actually
 * experiences. The inspector measures each target just after ITS OWN beat
 * (two seeks per pair — camera motion, swaps, or component motion between the
 * beats can relocate or hide the first target by the time the second fires),
 * capped at PING_PONG_MAX_PAIRS per film.
 */
export function pingPongCandidates(scenes: DirectScene[]): PingPongCandidate[] {
  const candidates: PingPongCandidate[] = [];
  const toViewer = warpInverseOf(resolveTimeRampPlan(scenes));
  for (const scene of scenes) {
    const beats = [...(scene.beats ?? [])].sort((a, b) => a.atSec - b.atSec);
    const sceneEnd = scene.startSec + scene.durationSec;
    const clampIntoScene = (time: number): number =>
      Math.min(time, Math.max(scene.startSec, sceneEnd - 0.05));
    for (let index = 1; index < beats.length; index += 1) {
      const first = beats[index - 1]!;
      const second = beats[index]!;
      if (first.component === second.component) continue;
      const gap = toViewer(second.atSec) - toViewer(first.atSec);
      if (gap < PING_PONG_MIN_GAP_SEC || gap > PING_PONG_WINDOW_SEC) continue;
      candidates.push({
        sceneId: scene.id,
        firstBeatId: first.id,
        secondBeatId: second.id,
        firstPart: first.component,
        secondPart: second.component,
        firstAtSec: first.atSec,
        secondAtSec: second.atSec,
        viewerGapSec: Math.round(gap * 100) / 100,
        // Sample each target while its own beat is fresh, never past the
        // other beat's landing (the first sample must not slide into the
        // second beat's window).
        firstMeasureAtSec: clampIntoScene(Math.min(first.atSec + 0.15, second.atSec)),
        secondMeasureAtSec: clampIntoScene(second.atSec + 0.15),
      });
      if (candidates.length >= PING_PONG_MAX_PAIRS) return candidates;
    }
  }
  return candidates;
}

export interface PingPongFinding extends PingPongCandidate {
  displacementFraction: number;
}

/** Judge one measured candidate pair; undefined = silent. */
export function scorePingPongPair(
  candidate: PingPongCandidate,
  centers: {
    first?: { x: number; y: number };
    second?: { x: number; y: number };
  },
  frameWidth: number,
  frameHeight: number,
): PingPongFinding | undefined {
  if (!centers.first || !centers.second) return undefined;
  const diagonal = Math.hypot(frameWidth, frameHeight);
  if (!Number.isFinite(diagonal) || diagonal <= 0) return undefined;
  const displacementFraction =
    Math.hypot(centers.second.x - centers.first.x, centers.second.y - centers.first.y) /
    diagonal;
  if (displacementFraction <= PING_PONG_FRACTION) return undefined;
  return {
    ...candidate,
    displacementFraction: Math.round(displacementFraction * 1000) / 1000,
  };
}
