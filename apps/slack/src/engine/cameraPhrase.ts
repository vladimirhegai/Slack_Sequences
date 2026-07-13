/**
 * Canonical camera semantic model.
 *
 * Authored camera segments describe choreography while direction/continuity
 * blocking describes what must be readable. This module joins those inputs
 * once into the phrases executed by the browser runtime and inspected by QA.
 * It deliberately contains no DOM geometry: poses are semantic constraints
 * whose concrete x/y/scale values are measured at runtime.
 */
import type { CameraPlanV1, CameraSegmentV1 } from "./cameraContract.ts";
import type { ContinuityEntityKind } from "./continuityGraph.ts";
import type { DirectionPhraseV1 } from "./directionScore.ts";

export interface CameraPhraseTargetV1 {
  kind: "part" | "region" | "selector";
  id: string;
  entityId?: string;
  entityKind?: ContinuityEntityKind;
}

export interface CameraPhraseAnchorV1 {
  x: number;
  y: number;
  name: "center" | "left-third" | "right-third" | "top-third" | "bottom-third" |
    "top-right" | "bottom-right";
}

export interface CameraPhrasePoseV1 {
  target?: { kind: "part" | "region"; id: string };
  anchor: CameraPhraseAnchorV1;
  lens: "fit" | "detail" | "wide";
  zoom: number;
}

export type CameraPhraseRouteOwnershipV1 = "authored" | "continuity" | "host-derived";

export interface CameraPhraseEvidenceOwnerV1 {
  kind: "camera-segment" | "continuity-edge" | "direction-phrase";
  id: string;
}

export interface CameraPhraseV1 {
  id: string;
  sceneId: string;
  phraseId: string;
  role: DirectionPhraseV1["role"];
  importance: "primary" | "supporting";
  routeOwnership: CameraPhraseRouteOwnershipV1;
  evidenceOwner: CameraPhraseEvidenceOwnerV1;
  startSec: number;
  arrivalSec: number;
  endSec: number;
  target: CameraPhraseTargetV1;
  /** Camera frames this contextual station while evidence follows `target`. */
  framingTarget?: { kind: "part" | "region"; id: string };
  occupancy: { min: number; preferred: number; max: number };
  framingOccupancy?: { min: number; preferred: number; max: number };
  sourcePose: CameraPhrasePoseV1;
  arrivalPose: CameraPhrasePoseV1;
  corridor: { from: CameraPhraseAnchorV1; to: CameraPhraseAnchorV1; padding: number };
  travel: { startSec: number; endSec: number };
  settle: { startSec: number; endSec: number };
  dwell: { startSec: number; endSec: number; readableSec: number };
  departure: { startSec: number; endSec: number };
  /** Phrase ids deterministically folded into this executed route. */
  collapsedPhraseIds?: string[];
  nextHandoff?: { entityId: string; toScene: string; toPart: string; atSec: number };
}

export interface CameraPhrasePlanV1 {
  version: 1;
  enabled: true;
  solver: {
    curve: "minimum-jerk-quintic";
    measuredDom: true;
    maxNormalizedVelocity: number;
    maxNormalizedAcceleration: number;
    maxNormalizedJerk: number;
  };
  tolerances: CameraPhraseTolerancesV1;
  scenes: Array<{ sceneId: string; phrases: CameraPhraseV1[] }>;
  summary: {
    phraseCount: number;
    explicitTargetCount: number;
    primaryPhraseCount: number;
    primaryWithReadableLandingCount: number;
    inputPhraseCount: number;
    collapsedPhraseCount: number;
    authoredRouteCount: number;
    continuityRouteCount: number;
    hostDerivedRouteCount: number;
  };
}

export interface CameraPhraseTolerancesV1 {
  opacityMin: number;
  visibleFractionMin: number;
  occupancyMinFactor: number;
  occupancyMaxFactor: number;
  anchorErrorMax: number;
  restSpeedMax: number;
  readableDwellMinSec: number;
  landingSampleInsetSec: number;
  segmentMatchSec: number;
}

export const CAMERA_PHRASE_TOLERANCES: CameraPhraseTolerancesV1 = Object.freeze({
  opacityMin: 0.35,
  visibleFractionMin: 0.85,
  occupancyMinFactor: 0.9,
  occupancyMaxFactor: 1.1,
  anchorErrorMax: 0.14,
  restSpeedMax: 0.018,
  readableDwellMinSec: 0.35,
  landingSampleInsetSec: 0.08,
  segmentMatchSec: 0.02,
});

/** Legacy persisted plans predate the explicit tolerance block. */
export function cameraPhraseTolerances(
  plan: Pick<CameraPhrasePlanV1, "tolerances"> | { tolerances?: Partial<CameraPhraseTolerancesV1> },
): CameraPhraseTolerancesV1 {
  return { ...CAMERA_PHRASE_TOLERANCES, ...(plan.tolerances ?? {}) };
}

/** Blocking resolver output before authored-route ownership is joined. */
export type CameraPhraseSeedV1 = Omit<
  CameraPhraseV1,
  "routeOwnership" | "evidenceOwner" | "sourcePose" | "travel" | "settle" | "departure"
> & {
  settleUntilSec: number;
};

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function segmentTarget(segment: CameraSegmentV1, from = false): CameraPhrasePoseV1["target"] {
  const part = from ? segment.fromPart : segment.toPart;
  const region = from ? segment.fromRegion : segment.toRegion;
  if (part) return { kind: "part", id: part };
  if (region) return { kind: "region", id: region };
  return undefined;
}

function targetMatches(
  segment: CameraSegmentV1,
  phrase: CameraPhraseSeedV1,
): boolean {
  if (segment.toPart === phrase.target.id) return true;
  if (segment.toRegion === phrase.target.id) return true;
  return Boolean(
    phrase.framingTarget?.kind === "part" && segment.toPart === phrase.framingTarget.id ||
    phrase.framingTarget?.kind === "region" && segment.toRegion === phrase.framingTarget.id
  );
}

function authoredSegmentFor(
  plan: CameraPlanV1,
  phrase: CameraPhraseSeedV1,
): CameraSegmentV1 | undefined {
  const segments = plan.scenes.find((scene) => scene.sceneId === phrase.sceneId)?.segments ?? [];
  return segments
    .filter((segment) =>
      targetMatches(segment, phrase) &&
      segment.startSec <= phrase.arrivalSec + 0.02 &&
      segment.endSec >= phrase.startSec - 0.02
    )
    .sort((a, b) =>
      Math.abs(a.endSec - phrase.arrivalSec) - Math.abs(b.endSec - phrase.arrivalSec)
    )[0];
}

function routeOwnership(
  segment: CameraSegmentV1 | undefined,
  phrase: CameraPhraseSeedV1,
): CameraPhraseRouteOwnershipV1 {
  if (segment && segment.move !== "hold" && segment.move !== "drift") return "authored";
  if (phrase.nextHandoff || phrase.target.entityId) return "continuity";
  return "host-derived";
}

function evidenceOwner(
  segment: CameraSegmentV1 | undefined,
  phrase: CameraPhraseSeedV1,
): CameraPhraseEvidenceOwnerV1 {
  if (segment && segment.move !== "hold" && segment.move !== "drift") {
    return {
      kind: "camera-segment",
      id: `${phrase.sceneId}:${segment.move}@${round(segment.startSec)}`,
    };
  }
  if (phrase.nextHandoff) {
    return {
      kind: "continuity-edge",
      id: `${phrase.nextHandoff.entityId}:${phrase.sceneId}->${phrase.nextHandoff.toScene}`,
    };
  }
  return { kind: "direction-phrase", id: phrase.phraseId };
}

const SUB_THRESHOLD_ROUTE_DISTANCE = 0.025;

function targetKey(target: CameraPhraseTargetV1 | { kind: "part" | "region"; id: string }): string {
  return `${target.kind}:${target.id}`;
}

function destinationKeys(phrase: CameraPhraseV1): Set<string> {
  return new Set([
    targetKey(phrase.target),
    ...(phrase.framingTarget ? [targetKey(phrase.framingTarget)] : []),
  ]);
}

function sharesDestination(a: CameraPhraseV1, b: CameraPhraseV1): boolean {
  const aKeys = destinationKeys(a);
  return [...destinationKeys(b)].some((key) => aKeys.has(key));
}

function sameRoute(a: CameraPhraseV1, b: CameraPhraseV1): boolean {
  return targetKey(a.target) === targetKey(b.target) &&
    (a.framingTarget ? targetKey(a.framingTarget) : "") ===
      (b.framingTarget ? targetKey(b.framingTarget) : "");
}

function semanticRouteDistance(a: CameraPhraseV1, b: CameraPhraseV1): number {
  if (a.arrivalPose.lens !== b.arrivalPose.lens) return Infinity;
  const anchorDistance = Math.hypot(
    a.arrivalPose.anchor.x - b.arrivalPose.anchor.x,
    a.arrivalPose.anchor.y - b.arrivalPose.anchor.y,
  );
  const zoomDistance = Math.abs(Math.log(
    Math.max(0.001, a.arrivalPose.zoom) / Math.max(0.001, b.arrivalPose.zoom),
  )) * 0.25;
  return Math.hypot(anchorDistance, zoomDistance);
}

function mergePhrases(a: CameraPhraseV1, b: CameraPhraseV1): CameraPhraseV1 {
  const dwellEnd = Math.max(a.dwell.endSec, b.dwell.endSec);
  return {
    ...a,
    importance: a.importance === "primary" || b.importance === "primary" ? "primary" : "supporting",
    endSec: Math.max(a.endSec, b.endSec),
    settle: {
      startSec: Math.min(a.settle.startSec, b.settle.startSec),
      endSec: Math.max(a.settle.endSec, b.settle.endSec),
    },
    dwell: {
      startSec: Math.min(a.dwell.startSec, b.dwell.startSec),
      endSec: dwellEnd,
      readableSec: round(Math.max(a.dwell.readableSec, b.dwell.readableSec, dwellEnd - a.arrivalSec)),
    },
    departure: {
      startSec: dwellEnd,
      endSec: Math.max(a.departure.endSec, b.departure.endSec),
    },
    collapsedPhraseIds: [
      ...(a.collapsedPhraseIds ?? []),
      b.phraseId,
      ...(b.collapsedPhraseIds ?? []),
    ],
    ...(a.nextHandoff || b.nextHandoff ? { nextHandoff: b.nextHandoff ?? a.nextHandoff } : {}),
  };
}

export interface CameraPhraseCollapseOptions {
  /** Typed scene subject that owns the lens when continuity routes collide. */
  preferredTarget?: string;
  /** Typed interaction targets that must remain visible through their action. */
  interactionTargets?: readonly string[];
}

function phraseNamesTarget(phrase: CameraPhraseV1, target: string | undefined): boolean {
  return Boolean(
    target &&
    (phrase.target.id === target || phrase.framingTarget?.id === target),
  );
}

function competingPrimaryOverlap(a: CameraPhraseV1, b: CameraPhraseV1): boolean {
  if (a.importance !== "primary" || b.importance !== "primary") return false;
  if (sharesDestination(a, b)) return false;
  if (a.routeOwnership === "authored" && b.routeOwnership === "authored") return false;
  return Math.min(a.dwell.endSec, b.dwell.endSec) -
    Math.max(a.dwell.startSec, b.dwell.startSec) >= 0.1;
}

function competingRoutePriority(
  phrase: CameraPhraseV1,
  options: CameraPhraseCollapseOptions,
): number {
  const interactionTargets = new Set(options.interactionTargets ?? []);
  return (phrase.routeOwnership === "authored" ? 100 : 0) +
    (phraseNamesTarget(phrase, options.preferredTarget) ? 20 : 0) +
    ([phrase.target.id, phrase.framingTarget?.id]
      .some((target) => Boolean(target && interactionTargets.has(target!))) ? 10 : 0);
}

function absorbCompetingPhrase(
  winner: CameraPhraseV1,
  suppressed: CameraPhraseV1,
): CameraPhraseV1 {
  return {
    ...winner,
    collapsedPhraseIds: [
      ...(winner.collapsedPhraseIds ?? []),
      suppressed.phraseId,
      ...(suppressed.collapsedPhraseIds ?? []),
    ],
  };
}

/**
 * Reduce direction paperwork to routes the runtime can actually execute.
 * Supporting evidence remains local when a primary route exists, except for
 * an independently authored destination. Same-target poses below the semantic
 * movement threshold fold into one longer readable phrase.
 */
export function collapseCameraPhrases(
  phrases: readonly CameraPhraseV1[],
  options: CameraPhraseCollapseOptions = {},
): { phrases: CameraPhraseV1[]; collapsed: number } {
  const primary = phrases.filter((phrase) => phrase.importance === "primary");
  const routed = primary.length
    ? phrases.filter((phrase) =>
        phrase.importance === "primary" ||
        phrase.routeOwnership === "authored" &&
          !primary.some((candidate) => sharesDestination(phrase, candidate))
      )
    : [...phrases];
  const collapsed: CameraPhraseV1[] = [];
  for (const phrase of routed) {
    let conflictIndex = -1;
    if (options.preferredTarget || options.interactionTargets?.length) {
      for (let index = collapsed.length - 1; index >= 0; index -= 1) {
        if (competingPrimaryOverlap(collapsed[index]!, phrase)) {
          conflictIndex = index;
          break;
        }
      }
    }
    if (conflictIndex >= 0) {
      const previous = collapsed[conflictIndex]!;
      const previousPriority = competingRoutePriority(previous, options);
      const phrasePriority = competingRoutePriority(phrase, options);
      // Without typed or authored ownership, preserve both promises and let
      // normal hard QA expose the ambiguity. A deterministic suppression is
      // allowed only when the existing contract names the winner.
      if (previousPriority !== phrasePriority && Math.max(previousPriority, phrasePriority) > 0) {
        collapsed[conflictIndex] = previousPriority > phrasePriority
          ? absorbCompetingPhrase(previous, phrase)
          : absorbCompetingPhrase(phrase, previous);
        continue;
      }
    }
    const previous = collapsed[collapsed.length - 1];
    if (
      previous && sameRoute(previous, phrase) &&
      semanticRouteDistance(previous, phrase) <= SUB_THRESHOLD_ROUTE_DISTANCE
    ) {
      collapsed[collapsed.length - 1] = mergePhrases(previous, phrase);
    } else {
      collapsed.push(phrase);
    }
  }
  return { phrases: collapsed, collapsed: phrases.length - collapsed.length };
}

/**
 * Join authored camera routes and direction/continuity blocking seeds into the
 * single semantic artifact injected for runtime and QA.
 */
export function compileCameraPhrasePlan(args: {
  cameraPlan: CameraPlanV1;
  solver: CameraPhrasePlanV1["solver"];
  scenes: Array<{
    sceneId: string;
    phrases: CameraPhraseSeedV1[];
    preferredTarget?: string;
    interactionTargets?: readonly string[];
  }>;
}): CameraPhrasePlanV1 {
  let previousPose: CameraPhrasePoseV1 | undefined;
  let collapsedPhraseCount = 0;
  const scenes = args.scenes.map((scene) => {
    const compiled = scene.phrases.map((seed): CameraPhraseV1 => {
      const segment = authoredSegmentFor(args.cameraPlan, seed);
      const arrivalPose: CameraPhrasePoseV1 = {
        target: seed.framingTarget ??
          (seed.target.kind === "selector"
            ? undefined
            : { kind: seed.target.kind, id: seed.target.id }),
        anchor: seed.arrivalPose.anchor,
        lens: seed.arrivalPose.lens,
        zoom: seed.arrivalPose.zoom,
      };
      const sourceTarget = (segment ? segmentTarget(segment, true) : undefined) ??
        previousPose?.target;
      const sourcePose: CameraPhrasePoseV1 = {
        ...(sourceTarget ? { target: sourceTarget } : {}),
        anchor: seed.corridor.from,
        lens: previousPose?.lens ?? "fit",
        zoom: previousPose?.zoom ?? 1,
      };
      const travelStart = round(Math.min(seed.arrivalSec, segment?.startSec ?? seed.startSec));
      const settleEnd = round(Math.min(
        seed.dwell.endSec,
        Math.max(seed.arrivalSec, seed.settleUntilSec),
      ));
      const phrase: CameraPhraseV1 = {
        ...seed,
        routeOwnership: routeOwnership(segment, seed),
        evidenceOwner: evidenceOwner(segment, seed),
        sourcePose,
        arrivalPose,
        travel: { startSec: travelStart, endSec: seed.arrivalSec },
        settle: { startSec: seed.arrivalSec, endSec: settleEnd },
        departure: {
          startSec: seed.dwell.endSec,
          endSec: Math.max(seed.dwell.endSec, seed.endSec),
        },
      };
      delete (phrase as CameraPhraseV1 & { settleUntilSec?: number }).settleUntilSec;
      previousPose = arrivalPose;
      return phrase;
    });
    const collapsed = collapseCameraPhrases(compiled, {
      preferredTarget: scene.preferredTarget,
      interactionTargets: scene.interactionTargets,
    });
    collapsedPhraseCount += collapsed.collapsed;
    return { sceneId: scene.sceneId, phrases: collapsed.phrases };
  });
  const phrases = scenes.flatMap((scene) => scene.phrases);
  const inputPhraseCount = args.scenes.reduce((count, scene) => count + scene.phrases.length, 0);
  const primary = phrases.filter((phrase) => phrase.importance === "primary");
  return {
    version: 1,
    enabled: true,
    solver: args.solver,
    tolerances: CAMERA_PHRASE_TOLERANCES,
    scenes,
    summary: {
      phraseCount: phrases.length,
      explicitTargetCount: phrases.filter((phrase) => Boolean(phrase.target.id)).length,
      primaryPhraseCount: primary.length,
      primaryWithReadableLandingCount: primary.filter((phrase) => phrase.dwell.readableSec >= 0.35).length,
      inputPhraseCount,
      collapsedPhraseCount,
      authoredRouteCount: phrases.filter((phrase) => phrase.routeOwnership === "authored").length,
      continuityRouteCount: phrases.filter((phrase) => phrase.routeOwnership === "continuity").length,
      hostDerivedRouteCount: phrases.filter((phrase) => phrase.routeOwnership === "host-derived").length,
    },
  };
}

export function parseCameraPhrasePlan(html: string): CameraPhrasePlanV1 | undefined {
  const match = html.match(
    /<script\b[^>]*\bid\s*=\s*(["'])sequences-camera-blocking\1[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match?.[2]) return undefined;
  try {
    const value = JSON.parse(match[2]) as Partial<CameraPhrasePlanV1>;
    return value.version === 1 && value.enabled === true && Array.isArray(value.scenes)
      ? value as CameraPhrasePlanV1
      : undefined;
  } catch {
    return undefined;
  }
}
