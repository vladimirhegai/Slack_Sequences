/**
 * Deterministic camera blocking director.
 *
 * The direction score supplies phrase ownership; the continuity graph supplies
 * persistent identity. This module turns both into explicit screen-space
 * targets, occupancy ranges, arrival poses, travel corridors, readable dwell
 * windows, and next handoffs. The browser runtime measures actual DOM bounds
 * before solving the camera pose, so these are semantic constraints rather
 * than guessed pixel coordinates.
 */
import type { DirectScene } from "./directComposition.ts";
import { resolveCutPlan } from "./cutContract.ts";
import { resolveCameraPlan } from "./cameraContract.ts";
import { resolveFilmDirectionScore, type DirectionPhraseV1 } from "./directionScore.ts";
import {
  resolveContinuityGraph,
  type ContinuityEntityKind,
  type ContinuityGraphV1,
} from "./continuityGraph.ts";
import type { ContinuousMotionEvidenceV1 } from "./continuousMotion.ts";
import {
  compileCameraPhrasePlan,
  cameraPhraseTolerances,
  parseCameraPhrasePlan,
  type CameraPhraseAnchorV1,
  type CameraPhrasePlanV1,
  type CameraPhraseSeedV1,
  type CameraPhraseTargetV1,
  type CameraPhraseV1,
} from "./cameraPhrase.ts";

/** @deprecated Wire-compatible names retained while consumers migrate. */
export type BlockingTargetV1 = CameraPhraseTargetV1;
/** @deprecated Wire-compatible names retained while consumers migrate. */
export type ScreenAnchorV1 = CameraPhraseAnchorV1;
/** @deprecated Use CameraPhraseV1. */
export type CameraBlockingPhraseV1 = CameraPhraseV1;
/** @deprecated Use CameraPhrasePlanV1. */
export type CameraBlockingPlanV1 = CameraPhrasePlanV1;

const ANCHORS: Record<ScreenAnchorV1["name"], ScreenAnchorV1> = {
  center: { x: 0.5, y: 0.5, name: "center" },
  "left-third": { x: 0.36, y: 0.5, name: "left-third" },
  "right-third": { x: 0.64, y: 0.5, name: "right-third" },
  "top-third": { x: 0.5, y: 0.36, name: "top-third" },
  "bottom-third": { x: 0.5, y: 0.64, name: "bottom-third" },
  "top-right": { x: 0.64, y: 0.36, name: "top-right" },
  // Optical lower-right, pulled inward enough that a wide CTA lockup remains
  // inside the 7.2% delivery-safe inset after content-fit scaling.
  "bottom-right": { x: 0.58, y: 0.64, name: "bottom-right" },
};

function round(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function anchorFor(scene: DirectScene, target: BlockingTargetV1): ScreenAnchorV1 {
  const declared = scene.spatialIntent?.frameAnchor;
  if (declared === "frame:left-third" || declared === "frame:top-left" || declared === "frame:bottom-left") {
    return ANCHORS["left-third"];
  }
  if (declared === "frame:right-third" || declared === "frame:top-right" || declared === "frame:bottom-right") {
    return ANCHORS["right-third"];
  }
  // Centered lockups are a composition decision, not merely a component
  // shape. Treating every headline as editorial-left pulled centered brand
  // resolves away from their surrounding mark and made the continuity target
  // look like a tiny orphaned subtitle.
  if (/\b(?:center|centered|center-stack)\b/i.test(scene.spatialIntent?.composition ?? "")) {
    return ANCHORS.center;
  }
  const component = scene.components?.find((entry) => entry.id === target.id);
  if (component?.kind === "headline") return ANCHORS["left-third"];
  if (target.entityKind === "cta") return ANCHORS["bottom-right"];
  return ANCHORS.center;
}

function occupancyFor(
  target: BlockingTargetV1,
  scene: DirectScene,
  importance: "primary" | "supporting",
): CameraBlockingPhraseV1["occupancy"] {
  const component = scene.components?.find((entry) => entry.id === target.id);
  const plugin = scene.plugins?.find((entry) => entry.id === target.id);
  const role = component?.role;
  const kind = target.entityKind ?? (component?.kind === "app-window" ? "product-shell" : undefined);
  if (kind === "product-shell") return { min: 0.18, preferred: 0.42, max: 0.62 };
  if (plugin?.kind === "lockup") {
    return importance === "primary"
      ? { min: 0.1, preferred: 0.22, max: 0.42 }
      : { min: 0.04, preferred: 0.12, max: 0.32 };
  }
  if (plugin) {
    // Plugin children animate locally inside one designed unit. Camera blocking
    // targets that unit (notification stack, dashboard grid, tier stack, ...),
    // so its occupancy contract must describe the unit rather than fall
    // through to the compact unknown-part range.
    return importance === "primary"
      ? { min: 0.06, preferred: 0.18, max: 0.42 }
      : { min: 0.025, preferred: 0.1, max: 0.3 };
  }
  if (component?.kind === "progress" || component?.kind === "progress-ring") {
    return importance === "primary"
      ? { min: 0.02, preferred: 0.08, max: 0.22 }
      : { min: 0.012, preferred: 0.035, max: 0.12 };
  }
  if (component?.kind === "stat-card") {
    return importance === "primary"
      ? { min: 0.015, preferred: 0.06, max: 0.24 }
      : { min: 0.006, preferred: 0.025, max: 0.16 };
  }
  if (component?.kind === "search") return { min: 0.055, preferred: 0.12, max: 0.24 };
  // Visual form wins over continuity identity. A full review table tagged as
  // a trace is not a trace chip; a status pill tagged as an alert is still a
  // readable button. These budgets make product UI legible at film scale.
  if (component?.kind === "table" || component?.kind === "kanban") {
    return importance === "primary"
      ? { min: 0.12, preferred: 0.22, max: 0.42 }
      : { min: 0.06, preferred: 0.14, max: 0.32 };
  }
  if (component?.kind === "list") {
    return target.entityKind === "alert"
      ? importance === "primary"
        ? { min: 0.018, preferred: 0.045, max: 0.1 }
        : { min: 0.008, preferred: 0.025, max: 0.08 }
      : importance === "primary"
        ? { min: 0.08, preferred: 0.16, max: 0.34 }
        : { min: 0.035, preferred: 0.09, max: 0.24 };
  }
  if (component?.kind === "button") {
    return importance === "primary"
      ? { min: 0.018, preferred: 0.055, max: 0.14 }
      : { min: 0.008, preferred: 0.025, max: 0.08 };
  }
  // Toasts are compact status evidence even when a primary moment names one.
  // Falling through to the generic primary range (12-48%) made the continuity
  // solver enlarge a lowered notification-stack child like a hero surface and
  // then charged the author for the host-owned contradiction (Meridian).
  if (component?.kind === "toast") {
    return importance === "primary"
      ? { min: 0.0025, preferred: 0.012, max: 0.065 }
      : { min: 0.0015, preferred: 0.008, max: 0.05 };
  }
  // The component's visual form wins over continuity identity. A headline
  // participating in a CTA handoff is still long-form type and must be
  // framed as type, not as a compact button.
  if (component?.kind === "headline") {
    return importance === "primary"
      ? { min: 0.025, preferred: 0.08, max: 0.22 }
      : { min: 0.004, preferred: 0.02, max: 0.12 };
  }
  // Metrics and CTAs are frequently read in a two-subject payoff frame. Their
  // lower bound therefore allows a contextual landing while the preferred
  // range still asks the solver for a dedicated close view when time permits.
  if (kind === "metric") {
    return importance === "primary"
      ? { min: 0.04, preferred: 0.22, max: 0.36 }
      : { min: 0.012, preferred: 0.05, max: 0.24 };
  }
  if (kind === "cta") {
    return importance === "primary"
      ? { min: 0.01, preferred: 0.035, max: 0.12 }
      : { min: 0.006, preferred: 0.025, max: 0.08 };
  }
  // A trace can be a tiny identifier, a drawn path, or an entire dependency
  // list. Preserve the compact lower bound while admitting the latter as a
  // readable contextual subject instead of misclassifying it as over-framed.
  if (kind === "trace") {
    return importance === "primary"
      ? { min: 0.012, preferred: 0.035, max: 0.16 }
      : { min: 0.0025, preferred: 0.009, max: 0.16 };
  }
  if (kind === "alert") return { min: 0.0025, preferred: 0.009, max: 0.06 };
  // Interactions and spatial intents can name a stable authored subpart (row,
  // chip, label) rather than a declared component root. It is a compact
  // detail by construction, not a 12%-of-frame hero surface.
  if (!component && target.kind === "part") {
    return importance === "primary"
      ? { min: 0.012, preferred: 0.04, max: 0.18 }
      : { min: 0.004, preferred: 0.025, max: 0.18 };
  }
  if (role === "hero" || importance === "primary") return { min: 0.12, preferred: 0.28, max: 0.48 };
  return { min: 0.055, preferred: 0.16, max: 0.32 };
}

function targetFor(
  scene: DirectScene,
  phrase: DirectionPhraseV1,
  graph: ContinuityGraphV1,
): BlockingTargetV1 {
  const addressedPart = phrase.attention?.part ?? scene.spatialIntent?.focalPart;
  const addressedComponent = scene.components?.find((candidate) => candidate.id === addressedPart);
  const plugin = addressedComponent?.pluginUid
    ? scene.plugins?.find((candidate) => candidate.uid === addressedComponent.pluginUid)
    : undefined;
  // A plugin owns the internal cascade of its children. Let the lens frame the
  // stable designed unit while its tiles/toasts animate within it; chasing one
  // child produces partial landings and corrective camera motion.
  const part = plugin?.id ?? addressedPart;
  const region = phrase.attention?.region;
  const selector = phrase.attention?.selector;
  const kind = part ? "part" as const : region ? "region" as const : selector ? "selector" as const : "part" as const;
  const id = part ?? region ?? selector ?? scene.components?.find((component) => component.role === "hero")?.id ??
    scene.components?.[0]?.id ?? scene.spatialIntent?.focalPart ?? "composition-root";
  const entity = !plugin ? graph.entities.find((candidate) =>
    candidate.appearances.some((appearance) => appearance.sceneId === scene.id && appearance.part === id)
  ) : undefined;
  const component = scene.components?.find((candidate) => candidate.id === id);
  const inferredKind: ContinuityEntityKind | undefined = component?.kind === "app-window"
    ? "product-shell"
    : component?.kind === "stat-card" || component?.kind === "progress" ||
        component?.kind === "progress-ring" || component?.kind === "chart-bars" ||
        component?.kind === "chart-line"
      ? "metric"
      : component?.kind === "button"
        ? "cta"
        : undefined;
  return {
    kind,
    id,
    ...(entity ? { entityId: entity.id, entityKind: entity.kind } : {}),
    ...(!entity && inferredKind ? { entityKind: inferredKind } : {}),
  };
}

function nextHandoff(
  graph: ContinuityGraphV1,
  sceneId: string,
  target: BlockingTargetV1,
): CameraBlockingPhraseV1["nextHandoff"] {
  if (!target.entityId) return undefined;
  const edge = graph.edges.find((candidate) =>
    candidate.entityId === target.entityId && candidate.fromScene === sceneId
  );
  return edge
    ? { entityId: edge.entityId, toScene: edge.toScene, toPart: edge.toPart, atSec: edge.atSec }
    : undefined;
}

/** Every direction phrase receives a concrete target and readable landing. */
export function resolveCameraBlockingPlan(
  scenes: DirectScene[],
  graph: ContinuityGraphV1,
  options: { retainAdvisoryCompetingRoutes?: boolean } = {},
): CameraBlockingPlanV1 {
  const score = resolveFilmDirectionScore(scenes);
  const readableUntilByScene = new Map(
    resolveCutPlan(scenes).cuts.map((cut) => [cut.fromScene, cut.atSec - cut.exitSec]),
  );
  let previousAnchor = ANCHORS.center;
  const planScenes = score.scenes.map((scoreScene) => {
    const scene = scenes.find((entry) => entry.id === scoreScene.sceneId)!;
    const moments = new Map((scene.moments ?? []).map((moment) => [moment.id, moment]));
    const phrases = scoreScene.phrases.map((phrase): CameraPhraseSeedV1 => {
      const moment = phrase.momentId ? moments.get(phrase.momentId) : undefined;
      const target = targetFor(scene, phrase, graph);
      const component = scene.components?.find((entry) => entry.id === target.id);
      const firstComponentEntrance = (scene.beats ?? [])
        .filter((beat) => beat.component === component?.id &&
          (beat.kind === "type" || beat.kind === "open" || beat.kind === "rows" ||
            beat.kind === "morph" || beat.kind === "swap"))
        .sort((a, b) => a.atSec - b.atSec)[0]?.atSec;
      const regionIsUnambiguous = Boolean(
        component?.region &&
        (scene.components ?? []).filter((entry) => entry.region === component.region).length === 1
      );
      const explicitFullMoveDestination = component?.role !== "hero" &&
        (firstComponentEntrance === undefined || phrase.cueSec >= firstComponentEntrance - 0.05) &&
        (scene.camera?.path ?? []).some((move) =>
        move.move !== "drift" && move.move !== "hold" &&
        (move.toPart === target.id || Boolean(
          regionIsUnambiguous && move.toRegion && move.toRegion === component?.region
        ))
      );
      // If the planner explicitly sends a full move to a nominally supporting
      // component, that destination is camera-load-bearing in practice. A
      // region shared by a hero and supporting UI is not an explicit address:
      // promoting every child there made the lens abandon the hero's readable
      // dwell to chase a sidebar in the same station. Keep
      // ordinary supporting phrases from yanking the lens, but promote this
      // contradictory paperwork so the addressed station cannot remain
      // off-frame (RouteBoard Probe 5's publish button).
      const importance = explicitFullMoveDestination
        ? "primary"
        : moment?.importance ??
          (phrase.role === "payoff" || phrase.role === "resolve" ? "primary" : "supporting");
      const anchor = anchorFor(scene, target);
      const baseOccupancy = occupancyFor(target, scene, importance);
      const contextualKind = Boolean(
        component?.region && target.id === scene.spatialIntent?.focalPart
      ) || target.entityKind === "trace" || target.entityKind === "cta" ||
        target.entityKind === "metric" ||
        component?.kind === "search" || component?.kind === "progress" ||
        component?.kind === "progress-ring";
      const pluginGroup = target.kind === "part" && component?.pluginUid &&
          component.kind === "headline" && /-(?:headline|sub)$/.test(target.id)
        ? target.id.replace(/-(?:headline|sub)$/, "")
        : undefined;
      const targetPlugin = target.kind === "part"
        ? scene.plugins?.find((entry) => entry.id === target.id)
        : undefined;
      const soleProductSurface = (scene.components ?? []).filter((entry) =>
        entry.kind === "app-window" || (entry.kind === "modal" && entry.role === "hero")
      );
      const entityHeadline = component?.kind === "button" && component.entityId
        ? scene.components?.find((entry) =>
            entry.kind === "headline" && entry.entityId === component.entityId
          )
        : undefined;
      // A hero ring plus a subordinate hairline/progress rail is one close-up,
      // not an ensemble. Framing the region preserves the full-width 1px rail
      // and prevents the lens from enlarging the actual hero (CurrentProof D:
      // a valid 2% ring remained a 5%-grid sparse composition even after the
      // bounded zoom correction). A real product surface or any non-progress
      // peer still owns contextual framing below.
      const regionPeers = component?.region
        ? (scene.components ?? []).filter((entry) =>
            entry.id !== component.id && entry.region === component.region
          )
        : [];
      const heroMetricOwnsFraming = Boolean(
        component?.role === "hero" && component.kind === "progress-ring" &&
        regionPeers.length && regionPeers.every((entry) =>
          entry.role === "support" && entry.kind === "progress"
        ),
      );
      // A solo ring is the whole composition, so its preferred size must be
      // compatible with the whole-frame sparse floor. The smaller generic
      // ring range remains correct inside real contextual product surfaces.
      const occupancy = heroMetricOwnsFraming && importance === "primary"
        ? { min: 0.03, preferred: 0.12, max: 0.26 }
        : baseOccupancy;
      const framingTarget = target.kind === "part" && component?.region && contextualKind &&
          !heroMetricOwnsFraming
        ? { kind: "region" as const, id: component.region }
        : target.kind === "part" && contextualKind && soleProductSurface.length === 1 &&
            soleProductSurface[0]!.id !== target.id
          ? { kind: "part" as const, id: soleProductSurface[0]!.id }
          : entityHeadline
            ? { kind: "part" as const, id: entityHeadline.id }
        : pluginGroup
          ? { kind: "part" as const, id: pluginGroup }
          : targetPlugin
            ? { kind: "part" as const, id: targetPlugin.id }
          : undefined;
      const framingOccupancy = component?.kind === "progress" || component?.kind === "progress-ring"
        ? { min: 0.08, preferred: 0.14, max: 0.28 }
        : target.entityKind === "cta"
          ? { min: 0.1, preferred: 0.22, max: 0.42 }
          : { min: 0.16, preferred: 0.3, max: 0.56 };
      // The camera serves the action; it must not chase the action after it
      // has already resolved. Anticipate the earlier of the declared cue and
      // dominant action start, while retaining phrase order when overlapping
      // actions begin before this phrase owns the audience's attention.
      const matchingActionStart = [phrase.dominant, ...phrase.competing]
        .filter((action) =>
          action.part === target.id || action.region === target.id || action.selector === target.id
        )
        .reduce((earliest, action) => Math.min(earliest, action.startSec), Infinity);
      // Component/cursor actions need the lens ready at onset. A camera action
      // is different: its declared end (or a cue genuinely inside its travel)
      // is the landing. Treating camera start as camera arrival left the
      // graph-owned opening route with a zero-length window, so an authored
      // whip compiled as a static frame.
      const actionArrival = phrase.dominant.system === "camera"
        ? phrase.cueSec > phrase.dominant.startSec + 0.05
          ? Math.min(phrase.cueSec, phrase.dominant.endSec)
          : phrase.dominant.endSec
        : Math.min(phrase.cueSec, phrase.dominant.startSec, matchingActionStart);
      const arrivalSec = round(Math.min(
        phrase.endSec,
        Math.max(phrase.startSec, actionArrival),
      ));
      const readableFloor = importance === "primary" ? 0.62 : 0.38;
      // An outgoing cut owns the frame from the beginning of its exit window.
      // Camera QA must sample the product while the scene is still readable,
      // not after a swipe/morph has already started moving or hiding it.
      const readableUntil = readableUntilByScene.get(scene.id) ??
        scene.startSec + scene.durationSec;
      const dwellEnd = round(Math.min(
        readableUntil,
        Math.max(
          phrase.dominant.endSec,
          phrase.settleUntilSec,
          arrivalSec + readableFloor,
        ),
      ));
      const cameraMove = scene.camera?.path.find((move) =>
        move.startSec <= arrivalSec + 0.01 && move.startSec + move.durationSec >= arrivalSec - 0.01 &&
        (move.toPart === target.id || move.toRegion === target.id)
      );
      const lens = cameraMove?.move === "pull-back"
        ? "wide" as const
        : target.kind === "part" && target.entityKind !== "product-shell"
          ? "detail" as const
          : "fit" as const;
      const block: CameraPhraseSeedV1 = {
        id: `${scene.id}:${phrase.id}:blocking`,
        sceneId: scene.id,
        phraseId: phrase.id,
        role: phrase.role,
        importance,
        startSec: phrase.startSec,
        arrivalSec,
        endSec: phrase.endSec,
        target,
        ...(framingTarget ? { framingTarget } : {}),
        occupancy,
        ...(framingTarget ? { framingOccupancy } : {}),
        arrivalPose: { anchor, lens, zoom: round(cameraMove?.zoom ?? 1) },
        corridor: { from: previousAnchor, to: anchor, padding: 0.08 },
        dwell: {
          startSec: arrivalSec,
          endSec: Math.max(arrivalSec, dwellEnd),
          readableSec: round(Math.max(0, dwellEnd - arrivalSec)),
        },
        settleUntilSec: phrase.settleUntilSec,
        ...(nextHandoff(graph, scene.id, target)
          ? { nextHandoff: nextHandoff(graph, scene.id, target) }
          : {}),
      };
      previousAnchor = anchor;
      return block;
    });
    return {
      sceneId: scene.id,
      phrases,
      ...(!options.retainAdvisoryCompetingRoutes && scene.spatialIntent?.focalPart
        ? { preferredTarget: scene.spatialIntent.focalPart }
        : {}),
      ...(!options.retainAdvisoryCompetingRoutes && scene.interactions?.length
        ? { interactionTargets: scene.interactions.map((interaction) => interaction.targetPart) }
        : {}),
    };
  });
  return compileCameraPhrasePlan({
    cameraPlan: resolveCameraPlan(scenes),
    solver: {
      curve: "minimum-jerk-quintic",
      measuredDom: true,
      maxNormalizedVelocity: 1.9,
      maxNormalizedAcceleration: 5.8,
      maxNormalizedJerk: 60,
    },
    scenes: planScenes,
  });
}

/** A hero progress ring and its same-station support hairline are one semantic
 * close-up even though the ring is framed directly (to keep it legible) while
 * the rail's phrase carries the shared region as contextual framing. */
function sameHeroMetricStationIdea(
  scene: DirectScene,
  left: CameraPhraseV1,
  right: CameraPhraseV1,
): boolean {
  const leftComponent = scene.components?.find((component) => component.id === left.target.id);
  const rightComponent = scene.components?.find((component) => component.id === right.target.id);
  if (!leftComponent || !rightComponent) return false;
  const matches = (
    hero: typeof leftComponent,
    support: typeof rightComponent,
  ): boolean =>
    hero.id === scene.spatialIntent?.focalPart &&
    hero.role === "hero" &&
    hero.kind === "progress-ring" &&
    support.role === "support" &&
    support.kind === "progress" &&
    Boolean(hero.region && hero.region === support.region);
  return matches(leftComponent, rightComponent) || matches(rightComponent, leftComponent);
}

export function auditCameraIdeaBudgetPlan(
  scenes: DirectScene[],
  plan: CameraPhrasePlanV1,
): string[] {
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const findings: string[] = [];
  for (const plannedScene of plan.scenes) {
    const scene = sceneById.get(plannedScene.sceneId);
    if (!scene) continue;
    const candidateRoutes = plannedScene.phrases.filter((phrase) =>
      phrase.target.id !== "composition-root" || plannedScene.phrases.length === 1
    );
    // An idea is semantic, not a visit count. The runtime may legitimately
    // develop one subject through two meaningfully different poses (for
    // example, a contextual arrival followed by a closer read). Those
    // phrases should remain executable, but they are still one idea for this
    // gate. Preserve first-appearance order for deterministic diagnostics.
    const seenIdeas: CameraPhraseV1[] = [];
    const routes = candidateRoutes.filter((phrase) => {
      // A framing target is the semantic camera subject. Child evidence can
      // change locally inside that stable product surface without becoming a
      // second lens idea (for example, a metric followed by a button press in
      // one app window). Phrases without contextual framing remain keyed by
      // their directly addressed target.
      const subject = phrase.framingTarget ?? phrase.target;
      const alreadySeen = seenIdeas.some((seen) => {
        const seenSubject = seen.framingTarget ?? seen.target;
        return Boolean(
          phrase.target.entityId && phrase.target.entityId === seen.target.entityId
        ) || (
          subject.kind === seenSubject.kind && subject.id === seenSubject.id
        ) || sameHeroMetricStationIdea(scene, phrase, seen);
      });
      if (alreadySeen) return false;
      seenIdeas.push(phrase);
      return true;
    });
    if (routes.length <= 1) continue;
    const focalPart = scene.spatialIntent?.focalPart;
    const keep = routes.find((phrase) =>
      phrase.target.id === focalPart || phrase.framingTarget?.id === focalPart
    ) ?? routes.find((phrase) => phrase.importance === "primary") ?? routes[0]!;
    const cut = routes.filter((phrase) => phrase !== keep);
    const idea = (phrase: CameraPhraseV1): string =>
      phrase.framingTarget && phrase.framingTarget.id !== phrase.target.id
        ? `${phrase.target.id} in ${phrase.framingTarget.id}`
        : phrase.target.id;
    findings.push(
      `camera/idea-budget: scene "${scene.id}" asks the lens to tell competing ideas ` +
        `${routes.map((phrase) => `"${idea(phrase)}"`).join(", ")}. ` +
        `Keep "${idea(keep)}" as the scene's one primary camera route; cut the lens ` +
        `route${cut.length === 1 ? "" : "s"} to ` +
        `${cut.map((phrase) => `"${idea(phrase)}"`).join(", ")} and develop ` +
        `${cut.length === 1 ? "that evidence" : "those evidence beats"} with local ` +
        `component motion inside the kept framing (or move each competing idea to its own scene).`,
    );
  }
  return findings;
}

/** One scene tells one lens-directed idea; support develops inside that route. */
export function auditCameraIdeaBudget(scenes: DirectScene[]): string[] {
  if (scenes.length && scenes.every((scene) => scene.id.startsWith("fallback-"))) return [];
  return auditCameraIdeaBudgetPlan(
    scenes,
    resolveCameraBlockingPlan(scenes, resolveContinuityGraph(scenes), {
      retainAdvisoryCompetingRoutes: true,
    }),
  );
}

/** Quintic minimum-jerk interpolation: position, velocity, acceleration are continuous at endpoints. */
export function minimumJerkProgress(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return 10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5;
}

export function blockingPhraseForSegment(
  plan: CameraBlockingPlanV1,
  sceneId: string,
  segment: { startSec: number; endSec: number; toPart?: string; toRegion?: string },
): CameraBlockingPhraseV1 | undefined {
  const target = segment.toPart ?? segment.toRegion;
  const phrases = plan.scenes.find((scene) => scene.sceneId === sceneId)?.phrases ?? [];
  return phrases
    .filter((phrase) =>
      (!target || phrase.target.id === target) &&
      phrase.arrivalSec >= segment.startSec - 0.02 && phrase.arrivalSec <= segment.endSec + 0.02
    )
    .sort((a, b) => Math.abs(a.arrivalSec - segment.endSec) - Math.abs(b.arrivalSec - segment.endSec))[0] ??
    phrases
      .filter((phrase) => !target || phrase.target.id === target)
      .sort((a, b) => Math.abs(a.arrivalSec - segment.endSec) - Math.abs(b.arrivalSec - segment.endSec))[0];
}

export interface CameraBlockingLandingEvidenceV1 {
  blockId: string;
  sceneId: string;
  phraseId: string;
  time: number;
  importance: "primary" | "supporting";
  target: BlockingTargetV1;
  framingTarget?: CameraBlockingPhraseV1["framingTarget"];
  measured: boolean;
  visibleFraction: number;
  occupancyFraction: number;
  occupancyInRange: boolean;
  anchorError: number;
  speed: number;
  dwellSec: number;
}

export interface CameraBlockingEvidenceV1 {
  version: 1;
  advisory: true;
  planSummary: Pick<
    CameraBlockingPlanV1["summary"],
    "phraseCount" | "explicitTargetCount" | "primaryPhraseCount" |
      "primaryWithReadableLandingCount"
  >;
  landings: CameraBlockingLandingEvidenceV1[];
  trajectories: Array<{
    sceneId: string;
    points: Array<{ time: number; x: number; y: number; speed: number }>;
  }>;
  continuityEdges: ContinuityGraphV1["edges"];
  summary: {
    landingCount: number;
    measuredLandingCount: number;
    visibleLandingCount: number;
    occupancyInRangeCount: number;
    primaryLandingCount: number;
    primaryReadableCount: number;
    threeShotEntityCount: number;
    peakSpeed: number;
    peakAcceleration: number;
    peakJerk: number;
  };
  advisories: string[];
}

/** Join the semantic blocking plan to actual browser-sampled DOM geometry. */
export function buildCameraBlockingEvidence(
  plan: CameraBlockingPlanV1,
  graph: ContinuityGraphV1,
  motion: ContinuousMotionEvidenceV1,
): CameraBlockingEvidenceV1 {
  const tolerances = cameraPhraseTolerances(plan);
  const blocks = plan.scenes.flatMap((scene) => scene.phrases);
  const landings = blocks.map((block): CameraBlockingLandingEvidenceV1 => {
    const samples = motion.samples.filter((sample) => sample.sceneId === block.sceneId);
    const matching = samples.filter((sample) => sample.phraseId === block.phraseId);
    // A phrase's semantic end may precede its declared readable dwell end.
    // Continuous sampling then labels the later resting frame with the NEXT
    // phrase even though it is still valid evidence for this landing. Prefer
    // every sample inside the actual dwell; phrase-id matching is only a
    // fallback for sparse/legacy evidence (RouteBoardQC5 otherwise judged the
    // 3.6s incoming swipe instead of the same headline resting at 4.0s).
    const inDwell = samples.filter((sample) =>
      sample.time >= block.arrivalSec - 0.01 && sample.time <= block.dwell.endSec + 0.01
    );
    const candidates = inDwell.length ? inDwell : matching.length ? matching : samples;
    // Blocking evidence describes the settled readable landing. The camera
    // may arrive before a host-owned component entrance completes, so prefer
    // the sample nearest the end of the declared dwell rather than the first
    // frame of arrival. The dwell is bounded; a target that never resolves is
    // still recorded as missing/unreadable.
    const reviewAt = Math.max(block.arrivalSec, block.dwell.endSec - 0.08);
    const sample = [...candidates].sort((a, b) =>
      Math.abs(a.time - reviewAt) - Math.abs(b.time - reviewAt)
    )[0];
    const measured = Boolean(sample?.focal.found);
    const occupancy = sample?.focal.occupancyFraction ?? 0;
    const anchor = block.arrivalPose.anchor;
    const anchorError = sample
      ? Math.hypot(
          sample.focal.centerX / Math.max(1, motion.frame.width) - anchor.x,
          sample.focal.centerY / Math.max(1, motion.frame.height) - anchor.y,
        )
      : 1;
    return {
      blockId: block.id,
      sceneId: block.sceneId,
      phraseId: block.phraseId,
      time: sample?.time ?? reviewAt,
      importance: block.importance,
      target: block.target,
      ...(block.framingTarget ? { framingTarget: block.framingTarget } : {}),
      measured,
      visibleFraction: round(sample?.focal.visibleFraction ?? 0, 4),
      occupancyFraction: round(occupancy, 4),
      // An ensemble phrase (declared framingTarget) lets the runtime cap zoom
      // so the contextual station stays delivery-safe; the subject may then
      // legitimately sit below its solo floor. Continuous-motion samples only
      // track the subject, so the floor is waived rather than mis-charged.
      occupancyInRange: measured &&
        (block.framingTarget
          ? true
          : occupancy >= block.occupancy.min * tolerances.occupancyMinFactor &&
            occupancy <= block.occupancy.max * tolerances.occupancyMaxFactor),
      anchorError: round(anchorError, 4),
      // Camera blocking judges the lens at rest, not the target's own entrance,
      // count reflow, or highlight motion. Fresh continuous evidence exposes
      // camera-world speed explicitly; focal speed remains the compatibility
      // fallback for persisted v1 evidence captured before that field existed.
      speed: round(sample?.cameraSpeed ?? sample?.focal.speed ?? 0, 4),
      dwellSec: round(block.dwell.readableSec),
    };
  });
  const trajectories = plan.scenes.map((scene) => ({
    sceneId: scene.sceneId,
    points: motion.samples
      .filter((sample) => sample.sceneId === scene.sceneId && sample.focal.found)
      .map((sample) => ({
        time: sample.time,
        x: round(sample.focal.centerX / Math.max(1, motion.frame.width), 4),
        y: round(sample.focal.centerY / Math.max(1, motion.frame.height), 4),
        speed: round(sample.focal.speed ?? 0, 4),
      })),
  }));
  const primary = landings.filter((landing) => landing.importance === "primary");
  const summary = {
    landingCount: landings.length,
    measuredLandingCount: landings.filter((landing) => landing.measured).length,
    visibleLandingCount: landings.filter((landing) =>
      landing.visibleFraction >= tolerances.visibleFractionMin
    ).length,
    occupancyInRangeCount: landings.filter((landing) => landing.occupancyInRange).length,
    primaryLandingCount: primary.length,
    primaryReadableCount: primary.filter((landing) =>
      landing.measured && landing.visibleFraction >= tolerances.visibleFractionMin &&
      landing.occupancyInRange &&
      (landing.framingTarget || landing.anchorError <= tolerances.anchorErrorMax) &&
      landing.speed <= tolerances.restSpeedMax &&
      landing.dwellSec >= tolerances.readableDwellMinSec
    ).length,
    threeShotEntityCount: graph.summary.threeShotEntityCount,
    peakSpeed: motion.summary.peakSpeed,
    peakAcceleration: motion.summary.peakAcceleration,
    peakJerk: motion.summary.peakJerk,
  };
  const advisories: string[] = [];
  if (summary.threeShotEntityCount < 1) {
    advisories.push("no important entity is visually traceable across three shots");
  }
  if (summary.primaryReadableCount < summary.primaryLandingCount) {
    advisories.push(
      `${summary.primaryLandingCount - summary.primaryReadableCount} primary blocking landing(s) missed visibility, occupancy, anchor, at-rest, or dwell evidence`,
    );
  }
  const anchorMisses = landings.filter((landing) =>
    landing.measured && !landing.framingTarget && landing.anchorError > tolerances.anchorErrorMax
  ).length;
  if (anchorMisses) advisories.push(`${anchorMisses} landing(s) missed their screen anchor by more than 14% of frame`);
  const movingLandings = landings.filter((landing) =>
    landing.measured && landing.speed > tolerances.restSpeedMax
  ).length;
  if (movingLandings) {
    advisories.push(
      `${movingLandings} landing(s) were still moving above ${tolerances.restSpeedMax.toFixed(3)} normalized frame-diagonals/s`,
    );
  }
  return {
    version: 1,
    advisory: true,
    planSummary: plan.summary,
    landings,
    trajectories,
    continuityEdges: graph.edges,
    summary,
    advisories,
  };
}

export function parseCameraBlockingPlan(html: string): CameraBlockingPlanV1 | undefined {
  return parseCameraPhrasePlan(html);
}
