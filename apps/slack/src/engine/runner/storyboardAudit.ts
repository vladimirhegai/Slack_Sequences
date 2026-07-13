import { loadCapabilityIndex } from "../../agent/capabilityIndex.ts";
import type {
  DirectCompositionDraft,
  DirectScene,
  WorldLayoutCellV1,
} from "../directComposition.ts";
import {
  cohereInteractionFocusItems,
  normalizeStoryboardInteractionIntents,
  normalizeStoryboardSpatialIntent,
} from "../interactionContract.ts";
import {
  auditCutCoherence,
  canonicalCutStyle,
  normalizeStoryboardCutIntent,
  shapeHintsRhyme,
} from "../cutContract.ts";
import {
  CAMERA_FULL_MOVES,
  auditCameraEnergy,
  alignCameraDestinationsWithLateEntrances,
  ensureCameraBlockingChassis,
  diveLegCap,
  liftCameraEnergyPeak,
  normalizeConnectiveCameraSchedule,
  upgradeCrossStationDrifts,
  normalizeStoryboardCameraIntent,
  reserveFinalCameraLanding,
  topUpRequiredRackFocus,
} from "../cameraContract.ts";
import {
  continuityGraphEnabled,
  normalizeStoryboardContinuity,
} from "../continuityGraph.ts";
import {
  MAX_RAMPS_PER_FILM,
  normalizeStoryboardTimeRamp,
  resolveTimeRampPlan,
  timeRampHoldWindow,
} from "../timeRamp.ts";
import { sourceTime, timeConversionService } from "../time.ts";
import {
  auditComponentComplexity,
  auditSurfaceExits,
  autoStyleCompactPops,
  componentKindsMorphCompatible,
  componentSupportsBeat,
  dedupeRedundantBeats,
  degradeExcessAssembles,
  degradeOpenPopStyles,
  morphPartnerKinds,
  normalizeStoryboardComponentBeats,
  normalizeStoryboardComponentEntranceFamily,
  normalizeStoryboardComponents,
  reconcileMetricComponentKinds,
  resolveComponentPlan,
  retimeLateLoadBearingEntrances,
  topUpHeldInteractionResultDevelopment,
  trimOverBudgetComponents,
  type ComponentBeatIntentV1,
  type ComponentBeatKind,
  type ComponentKind,
} from "../componentContract.ts";
import {
  deriveGradeShifts,
  dropUnusableGradeShifts,
  normalizeStoryboardGradeShift,
} from "../gradeShift.ts";
import {
  normalizeStoryboardMoments,
  plannedMomentFloor,
  topUpStoryboardMoments,
  validatePlannedMoments,
  type StoryboardMomentV1,
} from "../storyboardMoments.ts";
import {
  ASSEMBLE_HOLD_SEC,
  FRAMING_FLOOR_MIN_FILM_SEC,
  OUTCOME_HOLD_SEC,
  PACING_TOLERANCE_SEC,
  PAYOFF_BEAT_KINDS,
  READING_MAX_SEC,
  READING_MIN_SEC,
  READING_SEC_PER_WORD,
  auditPacing,
  delayConflictingCameraMoves,
  delayEarlySwapBeats,
  framingChangeEvents,
  nextFramingChangeAfter,
  normalizeCameraBudget,
  requiredFramingCount,
  retimeCameraOverInteractions,
  spaceStackedCameraMoves,
  stretchMarginalPacingMisses,
  topUpFramingFloor,
  withNormalizationNotes,
} from "../pacingAudit.ts";
import { recordSentinelNormalization } from "../sentinelTelemetry.ts";
import { parseFrameBasis, type FrameBasis } from "../frameValidation.ts";
import { pluginsEnabled, recipesEnabled } from "../sentinelFlags.ts";
import {
  normalizeStoryboardRecipeDeclarations,
  reconcileRecipeDeclarations,
} from "../recipeContract.ts";
import {
  normalizeStoryboardPluginDeclarations,
  reconcileAndLowerPlugins,
} from "../pluginContract.ts";
import { findingSignature } from "./findingSignatures.ts";
import {
  extractIndexHtmlSource,
  extractStoryboardSource,
  tagged,
} from "./parse.ts";

/** Detect new finding classes and quantitatively worsened dead-moment gaps. */
export function normalizationIntroducedFindings(
  normalized: string[],
  original: string[],
): string[] {
  const classKey = (finding: string): string => finding.replace(/\d+(?:\.\d+)?/g, "#");
  const momentGap = (finding: string): number | undefined => {
    if (!finding.startsWith("storyboard/moments: no planned moment between")) return undefined;
    const match = finding.match(/\((\d+(?:\.\d+)?)s\)\s*[—-]/);
    return match ? Number(match[1]) : undefined;
  };
  const originalKeys = new Set(original.map(classKey));
  const originalGapMax = Math.max(
    ...original.map(momentGap).filter((value): value is number => value !== undefined),
    -Infinity,
  );
  return normalized.filter((finding) =>
    !originalKeys.has(classKey(finding)) ||
    (momentGap(finding) ?? -Infinity) > originalGapMax + 0.01
  );
}

/** Prefix an otherwise-valid digit-leading scene slug; reject all other junk. */
export function normalizeStoryboardSceneId(value: unknown): string {
  if (typeof value !== "string") return "";
  const id = value.trim();
  if (/^[a-z][a-z0-9-]{0,63}$/.test(id)) return id;
  return /^[0-9][a-z0-9-]{0,57}$/.test(id) ? `scene-${id}` : id;
}

/**
 * Normalize a scene's optional world-layout station map. Kept only when the
 * scene declares a camera path (a station map without a camera is dead
 * weight); junk regions, non-integer or out-of-range cells, and duplicate
 * regions/cells are dropped entry-by-entry — layout guidance degrades to
 * free placement rather than failing the storyboard.
 */
export function normalizeWorldLayout(
  value: unknown,
  hasCameraPath: boolean,
): WorldLayoutCellV1[] {
  if (!hasCameraPath || !Array.isArray(value)) return [];
  const seenRegions = new Set<string>();
  const seenCells = new Set<string>();
  const entries: WorldLayoutCellV1[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const region = typeof item.region === "string" &&
        /^[a-z][a-z0-9-]{0,63}$/.test(item.region.trim())
      ? item.region.trim()
      : "";
    const cell = Array.isArray(item.cell) && item.cell.length === 2 ? item.cell : undefined;
    const cx = Number(cell?.[0]);
    const cy = Number(cell?.[1]);
    if (
      !region || seenRegions.has(region) ||
      !Number.isInteger(cx) || !Number.isInteger(cy) ||
      Math.abs(cx) > 2 || Math.abs(cy) > 2 ||
      seenCells.has(`${cx},${cy}`)
    ) {
      continue;
    }
    seenRegions.add(region);
    seenCells.add(`${cx},${cy}`);
    const fitScale = Number(item.fitScale);
    entries.push({
      region,
      cell: [cx, cy],
      ...(Number.isFinite(fitScale) && fitScale >= 0.55 && fitScale < 1
        ? { fitScale: Math.round(fitScale * 1000) / 1000 }
        : {}),
    });
  }
  return entries;
}

export interface WorldLayoutCompletion {
  sceneId: string;
  addedRegions: string[];
  declaredCellCount: number;
}

export interface CompletedStoryboardWorldLayouts {
  scenes: DirectScene[];
  completions: WorldLayoutCompletion[];
}

const WORLD_LAYOUT_CELL_CANDIDATES: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1], [-1, 1], [-2, 1],
  [-2, 0], [-1, 0], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1],
  [2, 2], [1, 2], [0, 2], [-1, 2], [-2, 2], [-2, -2], [-1, -2],
  [0, -2], [1, -2], [2, -2],
];

/**
 * A focal progress ring and its subordinate progress rail are one metric
 * station. Planners reliably describe that relationship but sometimes omit
 * both `region` fields, which makes the host scaffold emit the roots loose on
 * the camera plane and leaves their relative placement entirely to source
 * authoring. ProofRail H put the rail below the viewport as a result.
 *
 * Fill only missing region paperwork for this exact two-role relationship;
 * never merge conflicting declared regions or unrelated component kinds.
 */
function coLocateHeroMetricStation(scene: DirectScene): DirectScene {
  if (!scene.camera?.path.length || !scene.components?.length) return scene;
  const focal = scene.components.find((component) =>
    component.id === scene.spatialIntent?.focalPart &&
    component.role === "hero" &&
    component.kind === "progress-ring"
  );
  if (!focal) return scene;
  const supports = scene.components.filter((component) =>
    component.id !== focal.id &&
    component.role === "support" &&
    component.kind === "progress"
  );
  if (!supports.length) return scene;
  const declaredRegions = new Set(
    [focal, ...supports].flatMap((component) => component.region ? [component.region] : []),
  );
  if (declaredRegions.size > 1) return scene;
  const suffix = "-station";
  const region = [...declaredRegions][0] ??
    `${focal.id.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
  const metricIds = new Set([focal.id, ...supports.map((component) => component.id)]);
  if (metricIds.size !== scene.components.length) return scene;
  const components = scene.components.map((component) =>
    metricIds.has(component.id) && !component.region
      ? { ...component, region }
      : component
  );
  if (components.every((component, index) => component === scene.components![index])) return scene;
  const note =
    `world-layout-derive: co-located hero metric and ${supports.length} support rail(s) ` +
    `inside region ${region}`;
  return {
    ...scene,
    components,
    sentinelNormalizations: [...(scene.sentinelNormalizations ?? []), note],
  };
}

/**
 * A typed metric opener that reveals one hero ring and then draws its one
 * subordinate rail needs a monotonic camera route. A full-scene connective
 * drift leaves the component pop/draw as the dominant centroid signal; two
 * small authored settles then read as a direction reversal and the hairline
 * can remain below the temporal-change floor. Promote only the first scene's
 * exact ring+rail, one-target-drift pattern to one restrained push-in. Later
 * schedule normalizers still own protected holds and final landing reserve.
 */
function promoteHeroMetricOpenerDrift(scene: DirectScene, sceneIndex: number): DirectScene {
  if (
    sceneIndex !== 0 ||
    scene.startSec > 0.05 ||
    scene.durationSec < 2.5 ||
    scene.camera?.path.length !== 1 ||
    !scene.components?.length
  ) {
    return scene;
  }
  const focal = scene.components.find((component) =>
    component.id === scene.spatialIntent?.focalPart &&
    component.role === "hero" &&
    component.kind === "progress-ring"
  );
  if (!focal) return scene;
  const supports = scene.components.filter((component) =>
    component.id !== focal.id &&
    component.role === "support" &&
    component.kind === "progress"
  );
  if (supports.length !== 1 || scene.components.length !== 2) return scene;
  const [move] = scene.camera.path;
  if (
    !move ||
    move.move !== "drift" ||
    move.toPart !== focal.id ||
    move.fromPart && move.fromPart !== focal.id
  ) {
    return scene;
  }
  const focalReveal = scene.beats?.some((beat) =>
    beat.component === focal.id && beat.kind === "open" &&
    beat.atSec <= scene.startSec + 1.25
  );
  const supportReveal = scene.beats?.some((beat) =>
    beat.component === supports[0]!.id &&
    (beat.kind === "open" || beat.kind === "progress")
  );
  if (!focalReveal || !supportReveal) return scene;
  const startSec = Math.max(move.startSec, scene.startSec + 0.5);
  const durationSec = Math.max(0.35, scene.startSec + scene.durationSec - startSec);
  const note =
    `camera-opener-converge: promoted the targeted metric drift to a restrained push-in ` +
    `so the ring/rail reveal has one monotonic route`;
  return {
    ...scene,
    camera: {
      ...scene.camera,
      path: [{
        ...move,
        move: "push-in",
        startSec,
        durationSec: Math.round(durationSec * 1000) / 1000,
        zoom: Math.max(move.zoom ?? 1, 1.12),
        ease: "seqGlide",
      }],
    },
    sentinelNormalizations: [...(scene.sentinelNormalizations ?? []), note],
  };
}

/**
 * Complete every camera scene's station map without moving an authored cell.
 *
 * This is deliberately pure and idempotent so parsed plans, paid-plan cache
 * hits, and persisted replay recovery all pass through the same migration.
 * Camera path order owns the preferred horizontal journey; component regions
 * and already-declared regions are then filled into the nearest free cell.
 */
export function completeStoryboardWorldLayouts(
  scenes: DirectScene[],
): CompletedStoryboardWorldLayouts {
  const completions: WorldLayoutCompletion[] = [];
  const completedScenes = scenes.map((sourceScene, sceneIndex) => {
    const scene = promoteHeroMetricOpenerDrift(
      coLocateHeroMetricStation(sourceScene),
      sceneIndex,
    );
    if (!scene.camera?.path?.length) return scene;
    const ordered: string[] = [];
    const addRegion = (region: string | undefined): void => {
      if (region && !ordered.includes(region)) ordered.push(region);
    };
    for (const move of scene.camera.path) {
      addRegion(move.fromRegion);
      addRegion(move.toRegion);
      // A toPart often names a component while its station name lives on the
      // component declaration. Pull that region into the same complete map.
      for (const part of [move.fromPart, move.toPart, move.focus?.part]) {
        addRegion(scene.components?.find((component) => component.id === part)?.region);
      }
    }
    for (const component of scene.components ?? []) addRegion(component.region);
    for (const entry of scene.worldLayout ?? []) addRegion(entry.region);
    if (!ordered.length) return scene;

    const declared = scene.worldLayout ?? [];
    const declaredRegions = new Set(declared.map((entry) => entry.region));
    const missing = ordered.filter((region) => !declaredRegions.has(region));
    if (!missing.length) return scene;

    const used = new Set(declared.map((entry) => entry.cell.join(",")));
    const additions: WorldLayoutCellV1[] = [];
    for (const region of missing) {
      const desired = WORLD_LAYOUT_CELL_CANDIDATES[
        Math.min(ordered.indexOf(region), WORLD_LAYOUT_CELL_CANDIDATES.length - 1)
      ]!;
      const desiredKey = desired.join(",");
      const candidate = !used.has(desiredKey)
        ? desired
        : WORLD_LAYOUT_CELL_CANDIDATES
          .filter((cell) => !used.has(cell.join(",")))
          .sort((a, b) =>
            Math.abs(a[0] - desired[0]) + Math.abs(a[1] - desired[1]) -
              (Math.abs(b[0] - desired[0]) + Math.abs(b[1] - desired[1])) ||
            WORLD_LAYOUT_CELL_CANDIDATES.indexOf(a) - WORLD_LAYOUT_CELL_CANDIDATES.indexOf(b)
          )[0];
      if (!candidate) break;
      const cell: [number, number] = [candidate[0], candidate[1]];
      used.add(cell.join(","));
      additions.push({ region, cell });
    }
    if (!additions.length) return scene;

    const addedRegions = additions.map((entry) => entry.region);
    completions.push({
      sceneId: scene.id,
      addedRegions,
      declaredCellCount: declared.length,
    });
    return {
      ...scene,
      worldLayout: [...declared, ...additions],
      sentinelNormalizations: [
        ...(scene.sentinelNormalizations ?? []),
        `world-layout-derive: completed viewport cells for ${addedRegions.join(", ")}`,
      ],
    };
  });
  return { scenes: completedScenes, completions };
}

export function reportWorldLayoutCompletions(completions: WorldLayoutCompletion[]): void {
  if (!completions.length) return;
  recordSentinelNormalization("world-layout-derive", completions.length);
  for (const completion of completions) {
    process.stderr.write(
      `[storyboard] scene "${completion.sceneId}": completed worldLayout cells for ` +
        `${completion.addedRegions.join(", ")} ` +
        `(${completion.declaredCellCount
          ? "partial station map"
          : "plan declared camera regions but no layout"})\n`,
    );
  }
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
      )
    : [];
}

/**
 * Rescue a findings retry that expresses an in-shot development patch as a
 * new scene embedded inside the existing scene's authored time window.
 *
 * The fold is intentionally closed-world: the embedded scene may only reuse
 * the containing scene's exact component ids/kinds and focal part, add
 * in-window beats/moments, and carry hold/drift camera. Any new surface,
 * interaction, plugin, recipe, full reframe, or escaped cue makes it a real
 * creative scene and leaves it to ordinary contiguous rebasing/validation.
 */
export function mergeEmbeddedDevelopmentScenes(
  input: unknown[],
): { storyboard: unknown[]; normalized: string[] } {
  const storyboard: unknown[] = [];
  const normalized: string[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item) || !storyboard.length) {
      storyboard.push(item);
      continue;
    }
    const current = item as Record<string, unknown>;
    const previous = storyboard.at(-1);
    if (!previous || typeof previous !== "object" || Array.isArray(previous)) {
      storyboard.push(item);
      continue;
    }
    const parent = previous as Record<string, unknown>;
    const parentStart = Number(parent.startSec);
    const parentDuration = Number(parent.durationSec);
    const childStart = Number(current.startSec);
    const childDuration = Number(current.durationSec);
    const parentEnd = parentStart + parentDuration;
    const childEnd = childStart + childDuration;
    const parentComponents = recordArray(parent.components);
    const childComponents = recordArray(current.components);
    const parentKinds = new Map(parentComponents.map((component) => [
      String(component.id ?? ""),
      String(component.kind ?? ""),
    ]));
    const childBeats = recordArray(current.beats);
    const childMoments = recordArray(current.moments);
    const childMoves = recordArray(
      current.camera && typeof current.camera === "object" && !Array.isArray(current.camera)
        ? (current.camera as Record<string, unknown>).path
        : undefined,
    );
    const parentFocal = parent.spatialIntent && typeof parent.spatialIntent === "object" &&
        !Array.isArray(parent.spatialIntent)
      ? String((parent.spatialIntent as Record<string, unknown>).focalPart ?? "")
      : "";
    const childFocal = current.spatialIntent && typeof current.spatialIntent === "object" &&
        !Array.isArray(current.spatialIntent)
      ? String((current.spatialIntent as Record<string, unknown>).focalPart ?? "")
      : "";
    const childCutStyle = current.cut && typeof current.cut === "object" && !Array.isArray(current.cut)
      ? String((current.cut as Record<string, unknown>).style ?? "")
      : "";
    const hasTimedModifier = (key: "timeRamp" | "gradeShift"): boolean => {
      const modifier = current[key];
      return Boolean(
        modifier && typeof modifier === "object" && !Array.isArray(modifier) &&
        Number.isFinite(Number((modifier as Record<string, unknown>).atSec)),
      );
    };
    const empty = (key: string): boolean => recordArray(current[key]).length === 0;
    // A trailing final-CTA hold that introduces no surface, state, or action
    // is not a new scene. Cutting to a second tiny copy of the same CTA is the
    // slide-deck pattern continuity blocking is meant to prevent.
    const childLabel = [
      current.title,
      current.purpose,
      current.incomingIdea,
      current.foreground,
    ].map((entry) => String(entry ?? "")).join(" ");
    const adjacent = Number.isFinite(childStart) && Number.isFinite(childDuration) &&
      Math.abs(childStart - parentEnd) <= 0.06 && childDuration > 0 && childDuration <= 4;
    const heldFocal = Boolean(childFocal && parentKinds.has(childFocal));
    const holdOnlyMoments = childMoments.every((moment) =>
      /\b(?:hold|resolve|steady|ready|end\s*frame)\b/i.test(
        [moment.title, moment.change, moment.motionIntent]
          .map((entry) => String(entry ?? ""))
          .join(" "),
      )
    );
    const trailingSameTargetHold =
      adjacent && heldFocal && /\b(?:final|cta|hold|end\s*frame)\b/i.test(childLabel) &&
      (childComponents.length === 0 || childComponents.every((component) =>
        parentKinds.get(String(component.id ?? "")) === String(component.kind ?? "")
      )) &&
      childBeats.length === 0 && childMoves.length > 0 &&
      childMoves.every((move) => move.move === "hold" || move.move === "drift") &&
      holdOnlyMoments && empty("interactions") && empty("plugins") && empty("recipes") &&
      (childCutStyle === "" || childCutStyle === "hard") &&
      !hasTimedModifier("timeRamp") && !hasTimedModifier("gradeShift");
    if (trailingSameTargetHold) {
      parent.durationSec = Math.round((childEnd - parentStart) * 1000) / 1000;
      const parentId = String(parent.id ?? "parent");
      const existingMoments = recordArray(parent.moments);
      const existingMomentIds = new Set(existingMoments.map((moment) => String(moment.id ?? "")));
      const carriedHoldMoments = childMoments
        .filter((moment) => !existingMomentIds.has(String(moment.id ?? "")))
        .map((moment) => ({
          ...moment,
          version: 1,
          sceneId: parentId,
          importance: "supporting",
          motionIntent: "camera-arrival",
          title: "Operated CTA hold begins",
          visualState: "The existing CTA remains readable while the camera stays alive",
          change: "The camera begins a living hold on " + childFocal,
        }));
      parent.moments = [...existingMoments, ...carriedHoldMoments];
      const parentCamera = parent.camera && typeof parent.camera === "object" &&
          !Array.isArray(parent.camera)
        ? parent.camera as Record<string, unknown>
        : { version: 1 };
      const parentMoves = recordArray(parentCamera.path);
      parent.camera = {
        ...parentCamera,
        version: 1,
        path: [
          ...parentMoves,
          ...childMoves.map((move) => ({
            ...move,
            ...(!move.toPart && !move.toRegion ? { toPart: childFocal } : {}),
          })),
        ],
      };
      if (current.outgoingCut !== undefined) parent.outgoingCut = current.outgoingCut;
      const childId = String(current.id ?? "final-hold");
      const note =
        'absorbed trailing same-target hold scene "' + childId + '" into "' + parentId +
        '" (held ' + childFocal + " for " + childDuration.toFixed(2) +
        "s without a duplicate cut)";
      parent.sentinelNormalizations = [
        ...(Array.isArray(parent.sentinelNormalizations)
          ? parent.sentinelNormalizations.filter((entry): entry is string => typeof entry === "string")
          : []),
        note,
      ];
      normalized.push(note);
      process.stderr.write("[storyboard] trailing-hold-fold: " + note + "\n");
      continue;
    }
    const contained = Number.isFinite(parentStart) && Number.isFinite(parentDuration) &&
      Number.isFinite(childStart) && Number.isFinite(childDuration) &&
      childStart > parentStart + 0.05 && childEnd <= parentEnd + 0.05;
    const reusesSurfaces = childComponents.length > 0 && childComponents.every((component) => {
      const id = String(component.id ?? "");
      return Boolean(id) && parentKinds.get(id) === String(component.kind ?? "");
    });
    const inParentWindow = (entry: Record<string, unknown>): boolean => {
      const atSec = Number(entry.atSec);
      return Number.isFinite(atSec) && atSec >= childStart - 0.01 && atSec <= parentEnd + 0.01;
    };
    const beatsReuseSurfaces = childBeats.length > 0 && childBeats.every((beat) =>
      parentKinds.has(String(beat.component ?? "")) && inParentWindow(beat)
    );
    const momentsStayInside = childMoments.every(inParentWindow);
    const connectiveCameraOnly = childMoves.every((move) =>
      move.move === "hold" || move.move === "drift"
    );
    if (
      !contained || !reusesSurfaces || !beatsReuseSurfaces || !momentsStayInside ||
      !connectiveCameraOnly || !empty("interactions") || !empty("plugins") || !empty("recipes") ||
      !parentFocal || childFocal !== parentFocal ||
      (childCutStyle !== "" && childCutStyle !== "hard") ||
      hasTimedModifier("timeRamp") || hasTimedModifier("gradeShift")
    ) {
      storyboard.push(item);
      continue;
    }
    const mergeUnique = (left: unknown, right: Record<string, unknown>[], key: string): unknown[] => {
      const combined: unknown[] = Array.isArray(left) ? [...left] : [];
      const ids = new Set(recordArray(left).map((entry) => String(entry[key] ?? "")));
      for (const entry of right) {
        const id = String(entry[key] ?? "");
        if (!id || ids.has(id)) continue;
        ids.add(id);
        combined.push(entry);
      }
      return combined;
    };
    parent.beats = mergeUnique(parent.beats, childBeats, "id");
    parent.moments = mergeUnique(parent.moments, childMoments, "id");
    const parentId = String(parent.id ?? "parent");
    const childId = String(current.id ?? "development");
    const note =
      `folded embedded duplicate-surface scene "${childId}" into "${parentId}" ` +
      `(${childBeats.length} beat(s), ${childMoments.length} moment(s))`;
    parent.sentinelNormalizations = [
      ...(Array.isArray(parent.sentinelNormalizations)
        ? parent.sentinelNormalizations.filter((entry): entry is string => typeof entry === "string")
        : []),
      note,
    ];
    normalized.push(note);
    process.stderr.write(`[storyboard] embedded-development-fold: ${note}\n`);
  }
  return { storyboard, normalized };
}

export function storyboardProductionBasis(raw: string): FrameBasis | undefined {
  const source = raw.match(/<storyboard_json>\s*([\s\S]*?)\s*<\/storyboard_json>/i)?.[1] ?? raw;
  try {
    const value = JSON.parse(
      source.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
    ) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const object = value as Record<string, unknown>;
      const basis = object.productionBasis ?? object.production_basis ?? object.basis;
      return basis === "light" || basis === "dark" ? basis : undefined;
    }
    if (Array.isArray(value)) {
      const firstObject = value.find((entry) => entry && typeof entry === "object") as
        | Record<string, unknown>
        | undefined;
      const basis = firstObject?.productionBasis ?? firstObject?.production_basis;
      return basis === "light" || basis === "dark" ? basis : undefined;
    }
  } catch {
    // The normal parser owns the actionable JSON/truncation error.
  }
  return undefined;
}

export function assertStoryboardBasisMatchesFrame(raw: string, frameMd: string): void {
  const storyboardBasis = storyboardProductionBasis(raw);
  const frameBasis = parseFrameBasis(frameMd);
  if (!frameBasis || storyboardBasis === frameBasis) return;
  if (!storyboardBasis) {
    throw new Error(
      `storyboard/basis: productionBasis is missing; declare the storyboard's ` +
        `"${frameBasis}" basis committed by frame.md before authoring`,
    );
  }
  throw new Error(
    `storyboard/basis: production basis "${storyboardBasis}" contradicts frame.md's ` +
      `committed "${frameBasis}" basis; return productionBasis "${frameBasis}" before authoring`,
  );
}

function parseStoryboard(raw: string): DirectScene[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`storyboard_json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    value = (value as Record<string, unknown>).storyboard;
  }
  if (!Array.isArray(value)) throw new Error("storyboard_json must be an array or storyboard envelope");
  const embeddedDevelopment = mergeEmbeddedDevelopmentScenes(value);
  const normalizedValue = embeddedDevelopment.storyboard;
  if (embeddedDevelopment.normalized.length) {
    recordSentinelNormalization(
      "embedded-development-fold",
      embeddedDevelopment.normalized.length,
    );
  }
  // Host-owned scene-timing arithmetic: shots are contiguous BY CONSTRUCTION.
  // Models routinely fumble the startSec addition (a live rescue attempt died
  // solely on "shot must start at 2.70s" findings), so every startSec is
  // re-based sequentially from the accumulated durations and each duration is
  // clamped into the contract range — a model never spends a paid attempt on
  // addition the host can do.
  let rebasedCursor = 0;
  let reconciledMetricKinds = 0;
  let prefixedSceneIds = 0;
  const scenes = normalizedValue.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`storyboard_json[${index}] must be an object`);
    const scene = item as Record<string, unknown>;
    const rawId = typeof scene.id === "string" ? scene.id.trim() : "";
    const id = normalizeStoryboardSceneId(rawId);
    if (id !== rawId) {
      prefixedSceneIds += 1;
      process.stderr.write(`[storyboard] sentinel-normalized: scene-id-prefix: ${rawId} -> ${id}\n`);
    }
    const title = typeof scene.title === "string" ? scene.title.trim() : "";
    const purpose = typeof scene.purpose === "string" ? scene.purpose.trim() : "";
    const authoredStart = Number(scene.startSec);
    const authoredDuration = Number(scene.durationSec);
    if (!id || !title || !purpose || !Number.isFinite(authoredStart) || !Number.isFinite(authoredDuration)) {
      throw new Error(`storyboard_json[${index}] is missing id/title/purpose/finite timing`);
    }
    const durationSec = Math.round(Math.min(15, Math.max(1.5, authoredDuration)) * 100) / 100;
    const startSec = rebasedCursor;
    rebasedCursor = Math.round((rebasedCursor + durationSec) * 100) / 100;
    if (
      Math.abs(authoredStart - startSec) > 0.05 ||
      Math.abs(authoredDuration - durationSec) > 0.001
    ) {
      process.stderr.write(
        `[storyboard] re-based shot "${id}" timing: ` +
          `${authoredStart.toFixed(2)}s/${authoredDuration.toFixed(2)}s -> ` +
          `${startSec.toFixed(2)}s/${durationSec.toFixed(2)}s (host-owned arithmetic)\n`,
      );
    }
    const spatialIntent = normalizeStoryboardSpatialIntent(scene.spatialIntent);
    const cut = normalizeStoryboardCutIntent(scene.cut);
    // Nested beat/camera/interaction/moment/ramp times were authored against
    // the model's OWN startSec. Normalize them in that frame — so each
    // normalizer's scene-relative recovery heuristic judges the model's
    // numbers, not the host's — then shift every absolute time by the
    // re-basing delta below, so repairing the scene's arithmetic never
    // silently re-times the choreography inside it.
    const authoredFrame = { startSec: authoredStart, durationSec };
    const timeRamp = normalizeStoryboardTimeRamp(scene.timeRamp, authoredFrame);
    const gradeShift = normalizeStoryboardGradeShift(scene.gradeShift, authoredFrame);
    let components = normalizeStoryboardComponents(scene.components);
    const focalComponent = components.find((component) => component.id === spatialIntent?.focalPart);
    const heroComponents = components.filter((component) => component.role === "hero");
    const cameraSubject = focalComponent ??
      (heroComponents.length === 1 ? heroComponents[0] : undefined) ??
      (components.length === 1 ? components[0] : undefined);
    const camera = normalizeStoryboardCameraIntent(
      scene.camera,
      authoredFrame,
      cameraSubject ? { toPart: cameraSubject.id } : {},
    );
    const worldLayout = normalizeWorldLayout(scene.worldLayout, Boolean(camera?.path.length));
    const componentEntranceFamily = normalizeStoryboardComponentEntranceFamily(
      scene.componentEntranceFamily,
    );
    const displayObject = scene.displayType && typeof scene.displayType === "object"
      ? scene.displayType as Record<string, unknown>
      : undefined;
    const displayType: DirectScene["displayType"] = displayObject?.version === 1 &&
        displayObject.kind === "ghost-word" && typeof displayObject.text === "string" &&
        Number.isFinite(Number(displayObject.atSec))
      ? {
          version: 1,
          kind: "ghost-word",
          text: displayObject.text.trim().slice(0, 40),
          atSec: Number(displayObject.atSec),
          ...(typeof displayObject.focalPart === "string" && displayObject.focalPart.trim()
            ? { focalPart: displayObject.focalPart.trim() }
            : {}),
        }
      : undefined;
    const continuity = continuityGraphEnabled()
      ? normalizeStoryboardContinuity(scene.continuity)
      : [];
    const beats = normalizeStoryboardComponentBeats(
      scene.beats,
      { sceneId: id, ...authoredFrame },
      components,
    );
    const metricKinds = reconcileMetricComponentKinds(components, beats);
    components = metricKinds.components;
    reconciledMetricKinds += metricKinds.normalized.length;
    for (const note of metricKinds.normalized) {
      process.stderr.write(`[storyboard] sentinel-normalized: ${note}\n`);
    }
    const interactions = normalizeStoryboardInteractionIntents(scene.interactions, {
      sceneId: id,
      ...authoredFrame,
    });
    const moments = normalizeStoryboardMoments(scene.moments, {
      sceneId: id,
      ...authoredFrame,
    });
    // Recipe declarations carry no absolute times (fragment motion is
    // scene-relative by construction), so they need no re-base shift below.
    const recipes = recipesEnabled()
      ? normalizeStoryboardRecipeDeclarations(scene.recipes)
      : [];
    // Plugin declarations are likewise time-free typed forms: the host derives
    // every beat time from the (re-based) scene window at lowering.
    const plugins = pluginsEnabled()
      ? normalizeStoryboardPluginDeclarations(scene.plugins)
      : [];
    // The authored and rebased windows have identical length (duration is
    // clamped once, above), so a pure shift keeps every time in-window and
    // preserves relative ordering within each intent.
    const rebaseDelta = Math.round((startSec - authoredStart) * 1000) / 1000;
    if (Math.abs(rebaseDelta) > 0.0005) {
      const shift = (value: number): number =>
        Math.round((value + rebaseDelta) * 1000) / 1000;
      if (timeRamp) timeRamp.atSec = shift(timeRamp.atSec);
      if (gradeShift) gradeShift.atSec = shift(gradeShift.atSec);
      if (displayType) displayType.atSec = shift(displayType.atSec);
      for (const move of camera?.path ?? []) move.startSec = shift(move.startSec);
      for (const beat of beats) beat.atSec = shift(beat.atSec);
      for (const interaction of interactions) {
        interaction.startSec = shift(interaction.startSec);
        interaction.arriveSec = shift(interaction.arriveSec);
        if (interaction.pressSec !== undefined) interaction.pressSec = shift(interaction.pressSec);
        if (interaction.releaseSec !== undefined) {
          interaction.releaseSec = shift(interaction.releaseSec);
        }
        if (interaction.holdUntilSec !== undefined) {
          interaction.holdUntilSec = shift(interaction.holdUntilSec);
        }
      }
      for (const moment of moments) moment.atSec = shift(moment.atSec);
    }
    return {
      id,
      title,
      purpose,
      ...(typeof scene.incomingIdea === "string"
        ? { incomingIdea: scene.incomingIdea.trim() }
        : {}),
      ...(typeof scene.foreground === "string"
        ? { foreground: scene.foreground.trim() }
        : {}),
      ...(typeof scene.background === "string"
        ? { background: scene.background.trim() }
        : {}),
      ...(typeof scene.cameraIntent === "string"
        ? { cameraIntent: scene.cameraIntent.trim() }
        : {}),
      ...(typeof scene.continuityAnchor === "string"
        ? { continuityAnchor: scene.continuityAnchor.trim() }
        : {}),
      startSec,
      durationSec,
      ...(typeof scene.blueprint === "string" ? { blueprint: scene.blueprint } : {}),
      ...(Array.isArray(scene.rules)
        ? { rules: scene.rules.filter((rule): rule is string => typeof rule === "string") }
        : {}),
      ...(Array.isArray(scene.capabilityIds)
        ? {
            capabilityIds: scene.capabilityIds
              .filter((capability): capability is string => typeof capability === "string")
              .map((capability) => capability.trim())
              .filter(Boolean),
          }
        : {}),
      ...(typeof scene.outgoingCut === "string" ? { outgoingCut: scene.outgoingCut } : {}),
      ...(cut ? { cut } : {}),
      ...(timeRamp ? { timeRamp } : {}),
      ...(gradeShift ? { gradeShift } : {}),
      ...(camera ? { camera } : {}),
      ...(worldLayout.length ? { worldLayout } : {}),
      ...(components.length ? { components } : {}),
      ...(componentEntranceFamily ? { componentEntranceFamily } : {}),
      ...(continuity.length ? { continuity } : {}),
      ...(beats.length ? { beats } : {}),
      ...(displayType ? { displayType } : {}),
      ...(recipes.length ? { recipes } : {}),
      ...(plugins.length ? { plugins } : {}),
      ...(spatialIntent ? { spatialIntent } : {}),
      ...(interactions.length ? { interactions } : {}),
      ...(moments.length ? { moments } : {}),
      ...(Array.isArray(scene.sentinelNormalizations) || metricKinds.normalized.length
        ? {
            sentinelNormalizations: [
              ...(Array.isArray(scene.sentinelNormalizations)
                ? scene.sentinelNormalizations
                  .filter((entry): entry is string => typeof entry === "string")
                : []),
              ...metricKinds.normalized,
            ],
          }
        : {}),
    };
  });
  if (reconciledMetricKinds) {
    recordSentinelNormalization("component-kind-reconcile", reconciledMetricKinds);
  }
  if (prefixedSceneIds) {
    recordSentinelNormalization("scene-id-prefix", prefixedSceneIds);
  }
  const usedInteractionIds = new Set<string>();
  const deduped = scenes.map((scene) => ({
    ...scene,
    ...(scene.interactions?.length
      ? {
          interactions: scene.interactions.map((interaction) => {
            let id = interaction.id;
            let suffix = 2;
            while (usedInteractionIds.has(id)) {
              id = `${interaction.id}-${suffix}`;
              suffix += 1;
            }
            usedInteractionIds.add(id);
            return id === interaction.id ? interaction : { ...interaction, id };
          }),
        }
      : {}),
  }));
  // Plugin lowering (seventh contract, Sentinel L2): declared generator forms
  // become typed components (stamped pluginUid) + beats merged into their
  // scenes NOW, before the dive/pop/grade/moment machinery, so every
  // downstream derivation and gate judges the plan the runtime will execute.
  // Degrade-never-veto: unknown kinds no-op, bad params default/clamp/drop.
  const pluginLowering = pluginsEnabled()
    ? reconcileAndLowerPlugins(deduped)
    : { scenes: deduped, notes: [] };
  for (const line of pluginLowering.notes) {
    process.stderr.write(`[storyboard] plugin-reconcile: ${line}\n`);
  }
  if (pluginLowering.notes.length) {
    recordSentinelNormalization("plugin-reconcile", pluginLowering.notes.length);
  }
  // Complete world layout (fix-probe-1 + BeaconOps lesson): a camera scene
  // whose plan names regions but declares NO worldLayout used to reach the skeleton as
  // rect-less stations — the author freestyled geometry (a 7680px "wall"
  // station put every plugin tile in a quarter-frame void at fit zoom, and
  // stations shipped without position:absolute). Synthesizing one
  // viewport-sized cell per path region (first-appearance order) makes the
  // existing worldStationRects/cameraWorldStyle machinery emit sane station
  // rects by construction. A PARTIAL declaration is just as dangerous: one
  // pinned dependency station previously suppressed normalization for the
  // overview/root-cause siblings, leaving a graph below a 1080px world. Keep
  // declared cells and deterministically fill every remaining path/component
  // region. Scenes without camera regions are untouched.
  const worldLayoutCompletion = completeStoryboardWorldLayouts(
    pluginLowering.scenes as DirectScene[],
  );
  reportWorldLayoutCompletions(worldLayoutCompletion.completions);
  const withWorldLayout = worldLayoutCompletion.scenes;
  // Dive legs are host arithmetic (MD5, lever-10 philosophy): the model
  // declares only the intent + total window; the in/hold/out split is derived
  // here from the overlapping beat windows and stored on the move.
  const dives = deriveDiveWindows(withWorldLayout);
  for (const line of dives.normalized) {
    process.stderr.write(`[storyboard] dive-window derived: ${line}\n`);
  }
  if (dives.normalized.length) {
    recordSentinelNormalization("dive-window", dives.normalized.length);
  }
  // MD6 + MD3 + MD4 host auto-derivations, then their taste governors — all
  // deterministic degrade-never-veto normalizers (SENTINEL L2), run last at
  // parse so the shipped plan already carries the styled fields AND obeys the
  // caps. Each derivation FILLS the optional field a production planner (GLM)
  // under-reaches for, from data the storyboard already carries; the governor
  // that runs immediately after stays the single owner of the discipline. This
  // is the fix for the md-audit-probe gap: GLM lays down the structure
  // (headline, compact opens, "world turns warm" moments) but never the styles.
  const autoPops = autoStyleCompactPops(dives.storyboard);
  for (const line of autoPops.applied) {
    process.stderr.write(`[storyboard] auto-pop styled: ${line}\n`);
  }
  if (autoPops.applied.length) recordSentinelNormalization("auto-pop-style", autoPops.applied.length);
  const pops = degradeOpenPopStyles(autoPops.scenes);
  for (const line of pops.dropped) {
    process.stderr.write(`[storyboard] open-pop degraded: ${line}\n`);
  }
  if (pops.dropped.length) recordSentinelNormalization("open-pop", pops.dropped.length);
  const autoHighlights = autoStyleSemanticHighlights(pops.scenes);
  for (const line of autoHighlights.applied) {
    process.stderr.write(`[storyboard] auto-highlight styled: ${line}\n`);
  }
  if (autoHighlights.applied.length) {
    recordSentinelNormalization("auto-highlight-style", autoHighlights.applied.length);
  }
  const autoHeadlines = autoStyleHeadlineReveals(autoHighlights.storyboard);
  for (const line of autoHeadlines.applied) {
    process.stderr.write(`[storyboard] auto-headline styled: ${line}\n`);
  }
  if (autoHeadlines.applied.length) {
    recordSentinelNormalization("auto-headline-style", autoHeadlines.applied.length);
  }
  const assembles = degradeExcessAssembles(autoHeadlines.storyboard);
  for (const line of assembles.dropped) {
    process.stderr.write(`[storyboard] assemble degraded: ${line}\n`);
  }
  if (assembles.dropped.length) {
    recordSentinelNormalization("assemble-cap", assembles.dropped.length);
  }
  const autoGrades = deriveGradeShifts(assembles.scenes);
  for (const line of autoGrades.derived) {
    process.stderr.write(`[storyboard] ${line}\n`);
  }
  if (autoGrades.derived.length) {
    recordSentinelNormalization("auto-grade-shift", autoGrades.derived.length);
  }
  const grades = dropUnusableGradeShifts(autoGrades.storyboard);
  for (const line of grades.dropped) {
    process.stderr.write(`[storyboard] ${line}\n`);
  }
  if (grades.dropped.length) recordSentinelNormalization("grade-shift", grades.dropped.length);
  // Recipe declarations are governed by the same L2 discipline: unknown/stale
  // ids drop, params default/clamp/drop, the per-film budget trims — a bad
  // declaration degrades to the Level-0 knowledge the planner already
  // retrieved, never a paid retry (degrade-never-veto).
  if (!recipesEnabled()) return grades.storyboard;
  const recipeReconcile = reconcileRecipeDeclarations(grades.storyboard);
  for (const line of recipeReconcile.notes) {
    process.stderr.write(`[storyboard] recipe-reconcile: ${line}\n`);
  }
  if (recipeReconcile.notes.length) {
    recordSentinelNormalization("recipe-reconcile", recipeReconcile.notes.length);
  }
  return recipeReconcile.scenes;
}

/**
 * Fill a missing highlight style only when the storyboard already names the
 * visual verb. Live plans routinely promise a "measured underline" in the beat
 * id and bound moment while omitting the optional `style`, which silently
 * compiles as the default ring. This is semantic reconciliation, not invention:
 * explicit styles always win and ambiguous highlights remain untouched.
 */
export function autoStyleSemanticHighlights(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; applied: string[] } {
  const applied: string[] = [];
  const scenes = storyboard.map((scene) => {
    if (!(scene.beats ?? []).some((beat) => beat.kind === "highlight" && !beat.style)) {
      return scene;
    }
    const beats = scene.beats!.map((beat) => {
      if (beat.kind !== "highlight" || beat.style) return beat;
      const nearbyEvidence = (scene.moments ?? [])
        .filter((moment) => Math.abs(moment.atSec - beat.atSec) <= 0.8)
        .map((moment) => [moment.id, moment.title, moment.visualState, moment.change].join(" "))
        .join(" ");
      const semantics = `${beat.id} ${nearbyEvidence}`;
      const style = /\bunderlin(?:e|ed|es|ing)\b/i.test(semantics)
        ? "underline"
        : /\bsweep(?:s|ing)?\b/i.test(semantics)
          ? "sweep"
          : undefined;
      if (!style) return beat;
      applied.push(
        `scene "${scene.id}": highlight "${beat.id}" on "${beat.component}" -> ${style}`,
      );
      return { ...beat, style };
    });
    return { ...scene, beats };
  });
  return { storyboard: scenes, applied };
}

/** Content time at which the viewer has experienced `span` seconds past `fromSec`
 * (identity without a time ramp; monotone binary search through the warp). */
function contentTimeAfterViewerSpan(
  toViewer: (time: number) => number,
  fromSec: number,
  span: number,
  capSec: number,
): number {
  const target = toViewer(fromSec) + span;
  if (toViewer(capSec) <= target) return capSec;
  let low = fromSec;
  let high = capSec;
  for (let index = 0; index < 24; index += 1) {
    const mid = (low + high) / 2;
    if (toViewer(mid) < target) low = mid;
    else high = mid;
  }
  return high;
}

/**
 * MD5 L2 normalizer: derive each dive's push-in/pull-back legs so the held
 * window exactly covers the beats/interactions acting on the dive's target —
 * plus the reading floor for any typed/swapped copy among them (judged in
 * viewer time, like `auditPacing`). The clamp guaranteeing a real hold
 * (`diveWindows`) is shared with the resolver, so audits, island, and runtime
 * all see one arithmetic. A dive with NOTHING acting on its target during the
 * window is a zoom to a surface where nothing happens — it degrades to a
 * plain push-in with a warning (degrade-never-veto), never a rejection.
 */
export function deriveDiveWindows(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  if (!storyboard.some((scene) => scene.camera?.path.some((move) => move.move === "dive"))) {
    return { storyboard, normalized };
  }
  const conversion = timeConversionService(resolveTimeRampPlan(storyboard));
  const toViewer = (value: number): number => conversion.toViewer(sourceTime(value));
  const resolvedBeats = new Map(
    resolveComponentPlan(storyboard).scenes.map((scene) => [scene.sceneId, scene.beats]),
  );
  const scenes = storyboard.map((scene) => {
    const path = scene.camera?.path;
    if (!path?.some((move) => move.move === "dive")) return scene;
    const beats = resolvedBeats.get(scene.id) ?? [];
    const notes: string[] = [];
    const newPath = path.map((move) => {
      if (move.move !== "dive" || !move.toPart) return move;
      const interactionEnd = (interaction: NonNullable<DirectScene["interactions"]>[number]): number =>
        interaction.holdUntilSec ?? interaction.releaseSec ?? interaction.arriveSec;
      const originalTarget = move.toPart;
      const alternateTargets = [...new Set(
        (scene.interactions ?? [])
          .filter((interaction) =>
            interaction.targetPart !== originalTarget &&
            interactionEnd(interaction) > move.startSec + 0.01 &&
            interaction.startSec < move.startSec + move.durationSec - 0.01
          )
          .map((interaction) => interaction.targetPart),
      )];
      const componentRegion = new Map(
        (scene.components ?? []).map((component) => [component.id, component.region]),
      );
      const sharedRegionTarget = alternateTargets.length === 1 &&
          componentRegion.get(originalTarget) !== undefined &&
          componentRegion.get(originalTarget) === componentRegion.get(alternateTargets[0]!)
        ? alternateTargets[0]
        : undefined;
      // A cursor action is the decisive subject. When the planner dives into
      // a sibling inside the SAME declared station, deterministically retarget
      // the lens to the explicit interaction target. This is the exact
      // LumaFlow attempt-1 shape: retrying the model merely produced this same
      // answer on attempt 2. Different stations or multiple targets remain
      // ambiguous and continue to fail `auditDiveInteractions`.
      const effectiveMove = sharedRegionTarget
        ? {
            ...move,
            toPart: sharedRegionTarget,
            ...(move.focus ? { focus: { ...move.focus, part: sharedRegionTarget } } : {}),
          }
        : move;
      if (sharedRegionTarget) {
        const note =
          `dive at ${move.startSec.toFixed(2)}s retargeted from "${originalTarget}" to ` +
          `explicit interaction target "${sharedRegionTarget}" in shared region ` +
          `"${componentRegion.get(originalTarget)}"`;
        notes.push(note);
        normalized.push(`scene "${scene.id}": ${note}`);
      }
      const start = effectiveMove.startSec;
      let end = effectiveMove.startSec + effectiveMove.durationSec;
      const overlappingBeats = beats.filter((beat) =>
        beat.component === effectiveMove.toPart &&
        beat.endSec > start + 0.01 && beat.startSec < end - 0.01
      );
      const overlappingInteractions = (scene.interactions ?? []).filter((interaction) =>
        interaction.targetPart === effectiveMove.toPart &&
        interactionEnd(interaction) > start + 0.01 && interaction.startSec < end - 0.01
      );
      if (!overlappingBeats.length && !overlappingInteractions.length) {
        const note =
          `dive at ${start.toFixed(2)}s targets "${effectiveMove.toPart}" but no beat/interaction ` +
          `acts on it inside the window — degraded to push-in`;
        notes.push(note);
        normalized.push(`scene "${scene.id}": ${note}`);
        const { inSec: _inSec, outSec: _outSec, ...rest } = effectiveMove;
        return { ...rest, move: "push-in" as const };
      }
      let holdStart = Math.min(
        ...overlappingBeats.map((beat) => beat.startSec),
        ...overlappingInteractions.map((interaction) => interaction.startSec),
      );
      let holdEnd = Math.max(
        ...overlappingBeats.map((beat) => beat.endSec),
        ...overlappingInteractions.map(interactionEnd),
      );
      // Typed/swapped copy inside the dive needs its reading floor before the
      // pull-back — the whole reason the operator wanted the camera to wait.
      for (const beat of overlappingBeats) {
        if ((beat.kind === "type" || beat.kind === "swap") && beat.text) {
          const wordCount = beat.text.trim() ? beat.text.trim().split(/\s+/).length : 0;
          const floor = Math.min(
            READING_MAX_SEC,
            Math.max(READING_MIN_SEC, READING_SEC_PER_WORD * wordCount),
          );
          holdEnd = Math.max(
            holdEnd,
            contentTimeAfterViewerSpan(toViewer, beat.endSec, floor, end),
          );
        }
      }
      holdStart = Math.max(start, Math.min(holdStart, end));
      // Outcome-hold parity with `auditPacing` (motion-quality-verify-2-quillsign):
      // the dive's own pull-back leg IS the next framing change the gate
      // measures, so a press/set-state/toast payoff the dive covers needs its
      // >=OUTCOME_HOLD_SEC settle BEFORE that leg fires. The host derives the
      // legs — leaving the hold short mints a `pacing/outcome` finding the
      // model cannot repair (both quillsign storyboard attempts died
      // re-earning it). Extend the held window, growing the dive itself when
      // the scene has free time before its next full move or its own cut.
      const componentKindById = new Map(
        (scene.components ?? []).map((component) => [component.id, component.kind]),
      );
      const laterFullMoveStarts = path
        .filter((other) =>
          other !== move && CAMERA_FULL_MOVES.has(other.move) &&
          other.startSec > effectiveMove.startSec + 0.01
        )
        .map((other) => other.startSec);
      const windowCap = Math.min(
        scene.startSec + scene.durationSec,
        ...laterFullMoveStarts,
      );
      const plannedOutLeg = Math.max(
        0.15,
        Math.min(diveLegCap(effectiveMove.durationSec), end - Math.min(holdEnd, end)),
      );
      let outcomeHoldEnd = Math.min(holdEnd, end);
      for (const beat of overlappingBeats) {
        const isToastOpen = beat.kind === "open" &&
          componentKindById.get(beat.component) === "toast";
        if (!PAYOFF_BEAT_KINDS.has(beat.kind) && !isToastOpen) continue;
        outcomeHoldEnd = Math.max(
          outcomeHoldEnd,
          contentTimeAfterViewerSpan(
            toViewer,
            beat.endSec,
            OUTCOME_HOLD_SEC,
            Math.max(beat.endSec, windowCap - plannedOutLeg),
          ),
        );
      }
      let extendedNote = "";
      if (outcomeHoldEnd > Math.min(holdEnd, end) + 0.001) {
        holdEnd = outcomeHoldEnd;
        const grownEnd = Math.min(windowCap, Math.max(end, holdEnd + plannedOutLeg));
        if (grownEnd > end + 0.001) {
          extendedNote = ` (window grown ${(grownEnd - end).toFixed(2)}s for the payoff's ` +
            `${OUTCOME_HOLD_SEC}s outcome hold)`;
          end = grownEnd;
        }
      }
      const newDuration = Math.round((end - start) * 1000) / 1000;
      holdEnd = Math.max(holdStart, Math.min(holdEnd, end));
      const legCap = diveLegCap(newDuration);
      const inSec = Math.round(Math.max(0.15, Math.min(legCap, holdStart - start)) * 1000) / 1000;
      const outSec = Math.round(Math.max(0.15, Math.min(legCap, end - holdEnd)) * 1000) / 1000;
      const note =
        `dive on "${effectiveMove.toPart}": in ${inSec.toFixed(2)}s / hold ` +
        `${(newDuration - inSec - outSec).toFixed(2)}s / out ${outSec.toFixed(2)}s ` +
        `covering ${overlappingBeats.length} beat(s) + ${overlappingInteractions.length} ` +
        `interaction(s)${extendedNote}`;
      notes.push(note);
      normalized.push(`scene "${scene.id}": ${note}`);
      return { ...effectiveMove, inSec, outSec, durationSec: newDuration };
    });
    return withNormalizationNotes(
      { ...scene, camera: { ...scene.camera!, path: newPath } },
      notes,
    );
  });
  return { storyboard: scenes, normalized };
}

/**
 * True when a headline `assemble` at `resolvedEndSec` would clear auditPacing's
 * `pacing/assemble` lock-hold — computed with the EXACT gate arithmetic
 * (framing-change events + viewer-time warp) so the host only ever promotes to
 * assemble when it can prove the hold, never minting a pacing finding the model
 * cannot fix (it did not author the style).
 */
function assembleHoldSatisfied(
  scene: DirectScene,
  resolvedEndSec: number,
  toViewer: (time: number) => number,
): boolean {
  const sceneEnd = scene.startSec + scene.durationSec;
  const fullMoves = (scene.camera?.path ?? []).filter((move) => CAMERA_FULL_MOVES.has(move.move));
  const holdUntil = nextFramingChangeAfter(framingChangeEvents(fullMoves), resolvedEndSec, sceneEnd);
  const hold = Math.max(0, toViewer(holdUntil) - toViewer(resolvedEndSec));
  return hold + PACING_TOLERANCE_SEC >= ASSEMBLE_HOLD_SEC;
}

/**
 * MD3 host auto-derivation (the taste ladder, MOTION_DESIGN_PLAN §0): hero copy
 * on a `headline` component wants a refined reveal, but a production planner
 * (GLM z-ai/glm-5.2) declares the `headline` + its `type` beat and leaves the
 * OPTIONAL `style` blank, so the wordmark always arrives as a plain typewriter
 * (md-audit-probe-4). The HOST fills it from data the storyboard already
 * carries: every style-less headline `type` beat defaults to `rise` (the
 * refined staggered reveal), and the SINGLE strongest resolve — the latest
 * headline type beat that coincides with a `primary` moment AND can prove the
 * assemble lock-hold ([[assembleHoldSatisfied]]) — is promoted to `assemble`,
 * the film's loudest text gesture. The 1-per-film / headline-only / on-primary
 * cap stays owned by [[degradeExcessAssembles]], which runs immediately after
 * (SENTINEL L2, degrade-never-veto). Never overrides an explicit style; adds
 * zero planner surface.
 */
export function autoStyleHeadlineReveals(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; applied: string[] } {
  const applied: string[] = [];
  const headlineIdsByScene = storyboard.map(
    (scene) =>
      new Set(
        (scene.components ?? [])
          .filter((component) => component.kind === "headline")
          .map((component) => component.id),
      ),
  );
  const isCandidate = (
    beat: NonNullable<DirectScene["beats"]>[number],
    sceneIndex: number,
  ): boolean =>
    beat.kind === "type" && !beat.style && headlineIdsByScene[sceneIndex]!.has(beat.component);
  if (!storyboard.some((scene, index) => (scene.beats ?? []).some((beat) => isCandidate(beat, index)))) {
    return { storyboard, applied };
  }

  const resolvedBeats = new Map(
    resolveComponentPlan(storyboard).scenes.map((scene) => [scene.sceneId, scene.beats]),
  );
  const conversion = timeConversionService(resolveTimeRampPlan(storyboard));
  const toViewer = (value: number): number => conversion.toViewer(sourceTime(value));

  // First pass: the single strongest assemble candidate across the film — the
  // latest lock among headline type beats on a primary moment with a provable hold.
  let best: { sceneIndex: number; beatId: string; endSec: number } | undefined;
  storyboard.forEach((scene, index) => {
    const resolved = resolvedBeats.get(scene.id) ?? [];
    const primaries = (scene.moments ?? []).filter((moment) => moment.importance === "primary");
    for (const beat of scene.beats ?? []) {
      if (!isCandidate(beat, index)) continue;
      const window = resolved.find((entry) => entry.id === beat.id);
      if (!window) continue;
      const onPrimary = primaries.some(
        (moment) => moment.atSec >= window.startSec - 0.6 && moment.atSec <= window.endSec + 0.6,
      );
      if (!onPrimary || !assembleHoldSatisfied(scene, window.endSec, toViewer)) continue;
      if (!best || window.endSec > best.endSec) {
        best = { sceneIndex: index, beatId: beat.id, endSec: window.endSec };
      }
    }
  });

  // Second pass: style every style-less headline type beat — `assemble` for the
  // one winner, `rise` for the rest.
  const scenes = storyboard.map((scene, index) => {
    if (!(scene.beats ?? []).some((beat) => isCandidate(beat, index))) return scene;
    const beats = scene.beats!.map((beat) => {
      if (!isCandidate(beat, index)) return beat;
      const style =
        best && best.sceneIndex === index && best.beatId === beat.id ? "assemble" : "rise";
      applied.push(`scene "${scene.id}": headline type "${beat.id}" on "${beat.component}" → ${style}`);
      return { ...beat, style };
    });
    return { ...scene, beats };
  });
  return { storyboard: scenes, applied };
}

export interface StoryboardPlanRequirements {
  targetDurationSec?: number;
  requestedComponentKinds?: ComponentKind[];
  minRequestedComponentKinds?: number;
  minComponentBeats?: number;
  minCameraMoves?: number;
  requireMultiStationWorld?: boolean;
  requireObjectMatch?: boolean;
  requireShapeMatch?: boolean;
  requireRackFocus?: boolean;
  requireTimeRamp?: boolean;
  requireOrbit?: boolean;
  requireSharedElementCut?: boolean;
}

export function auditDisplayTypeBudget(storyboard: DirectScene[]): string[] {
  const findings: string[] = [];
  const displayTypeScenes = storyboard.filter((scene) => scene.displayType);
  if (displayTypeScenes.length > 1) {
    findings.push(
      `display_type_budget_exceeded: one ghost-word display moment per film, not ` +
        `${displayTypeScenes.length} (${displayTypeScenes.map((scene) => scene.id).join(", ")})`,
    );
  }
  for (const scene of displayTypeScenes) {
    const display = scene.displayType!;
    const sceneEnd = scene.startSec + scene.durationSec;
    if (!display.text.trim() || display.text.length > 40 || display.text.trim().split(/\s+/).length > 4) {
      findings.push(
        `display_type_invalid: shot "${scene.id}" ghost-word must contain 1-4 words ` +
          `and at most 40 characters`,
      );
    }
    if (display.atSec < scene.startSec + 0.1 || display.atSec > sceneEnd - 0.1) {
      findings.push(
        `display_type_invalid: shot "${scene.id}" ghost-word atSec must sit inside ` +
          `the scene's settled window`,
      );
    }
    const focal = display.focalPart ?? scene.spatialIntent?.focalPart;
    if (!focal) {
      findings.push(
        `display_type_invalid: shot "${scene.id}" ghost-word needs focalPart or ` +
          `spatialIntent.focalPart so it remains subordinate to the scene subject`,
      );
    }
  }
  return findings;
}

export function validateStoryboardPlan(
  storyboard: DirectScene[],
  requirements: StoryboardPlanRequirements = {},
): string[] {
  const errors: string[] = [];
  if (storyboard.length < 3 || storyboard.length > 10) {
    errors.push("storyboard must contain 3-10 distinct shots");
  }
  const knownCapabilities = new Set(
    loadCapabilityIndex().capabilities.map((capability) => capability.id),
  );
  const ids = new Set<string>();
  const interactionIds = new Set<string>();
  const beatIds = new Set<string>();
  let expectedStart = 0;
  for (const [index, scene] of storyboard.entries()) {
    if (!/^[a-z][a-z0-9-]*$/.test(scene.id)) {
      errors.push(`shot ${index + 1} id must be stable kebab-case`);
    }
    if (ids.has(scene.id)) errors.push(`shot id "${scene.id}" is duplicated`);
    ids.add(scene.id);
    if (Math.abs(scene.startSec - expectedStart) > 0.05) {
      errors.push(`shot "${scene.id}" must start at ${expectedStart.toFixed(2)}s`);
    }
    if (scene.durationSec < 1.5 || scene.durationSec > 15) {
      errors.push(`shot "${scene.id}" duration must be 1.5-15 seconds`);
    }
    for (const field of [
      "incomingIdea",
      "foreground",
      "background",
      "cameraIntent",
      "continuityAnchor",
      "outgoingCut",
    ] as const) {
      if (!scene[field]?.trim()) errors.push(`shot "${scene.id}" is missing ${field}`);
    }
    for (const capability of scene.capabilityIds ?? []) {
      if (!knownCapabilities.has(capability)) {
        errors.push(`shot "${scene.id}" cites unknown capability "${capability}"`);
      }
    }
    if (scene.spatialIntent && !scene.spatialIntent.focalPart.trim()) {
      errors.push(`shot "${scene.id}" needs a stable focalPart`);
    }
    const componentKinds = new Map(
      (scene.components ?? []).map((component) => [component.id, component.kind]),
    );
    for (const beat of scene.beats ?? []) {
      if (beatIds.has(beat.id)) {
        errors.push(`component beat id "${beat.id}" is duplicated`);
      }
      beatIds.add(beat.id);
      const kind = componentKinds.get(beat.component);
      if (kind && !componentSupportsBeat(kind, beat.kind)) {
        errors.push(
          `beat "${beat.id}" uses "${beat.kind}" on a ${kind} component, which does not ` +
            `support it — pick a supported beat or a different component kind`,
        );
      }
      if (beat.morphTo && !componentKinds.has(beat.morphTo)) {
        errors.push(
          `beat "${beat.id}" morphs to undeclared component "${beat.morphTo}" — declare the ` +
            `twin component in the same shot`,
        );
      } else if (beat.kind === "morph" && beat.morphTo && kind) {
        const targetKind = componentKinds.get(beat.morphTo);
        if (targetKind && !componentKindsMorphCompatible(kind, targetKind)) {
          errors.push(
            `beat "${beat.id}" cannot morph ${kind}→${targetKind}: the subjects do not ` +
              `share a semantic morph family — use open/close, swap, or a typed scene cut`,
          );
        }
      }
    }
    for (const interaction of scene.interactions ?? []) {
      if (interactionIds.has(interaction.id)) {
        errors.push(`interaction id "${interaction.id}" is duplicated`);
      }
      interactionIds.add(interaction.id);
      if (interaction.sceneId !== scene.id) {
        errors.push(`interaction "${interaction.id}" must use sceneId "${scene.id}"`);
      }
      const sceneEnd = scene.startSec + scene.durationSec;
      const interactionEnd =
        interaction.holdUntilSec ?? interaction.releaseSec ?? interaction.arriveSec;
      if (interaction.startSec < scene.startSec || interactionEnd > sceneEnd) {
        errors.push(`interaction "${interaction.id}" timing escapes shot "${scene.id}"`);
      }
      if (
        interaction.pressSec !== undefined &&
        interaction.pressSec - interaction.arriveSec < 0.08
      ) {
        errors.push(`interaction "${interaction.id}" needs at least 80ms settle before press`);
      }
    }
    expectedStart = scene.startSec + scene.durationSec;
  }
  if (expectedStart < 6 || expectedStart > 60) {
    errors.push("storyboard total duration must be 6-60 seconds");
  }
  errors.push(...auditDisplayTypeBudget(storyboard));
  // Duration is deliberately NOT a gate (owner call 2026-07-09): a time miss
  // must never burn an attempt. The target instead shapes the film by
  // construction — `storyboardShapeScaffold` puts host-computed per-segment
  // second allocations in the planning prompt. A large miss only logs.
  const targetSec = requirements.targetDurationSec;
  if (targetSec !== undefined && targetSec >= 6 && expectedStart < targetSec * 0.72) {
    process.stderr.write(
      `[storyboard] advisory: plan totals ${expectedStart.toFixed(1)}s against a ~${targetSec}s ` +
        `target (template scaffold should prevent this; never a retry)\n`,
    );
  }
  // Camera-era density floor: a framing is a shot or a full camera move
  // (pan/whip/push-in/pull-back/track-to-anchor/parallax-pass/orbit-lite/orbit).
  // The viewer must get a new framing roughly every 3.5 seconds — either by
  // cutting or by moving the camera across the scene's spatial world.
  const cameraMoves = storyboard.reduce(
    (count, scene) =>
      count +
      (scene.camera?.path.filter((move) => CAMERA_FULL_MOVES.has(move.move)).length ?? 0),
    0,
  );
  const framings = storyboard.length + cameraMoves;
  const requiredFramings = requiredFramingCount(expectedStart);
  if (expectedStart >= FRAMING_FLOOR_MIN_FILM_SEC && framings < requiredFramings) {
    errors.push(
      `a ${expectedStart.toFixed(0)}s film needs at least ${requiredFramings} distinct framings ` +
        `(shots plus typed camera moves); it has ${framings} — add shots or develop a ` +
        `scene's one primary target/context through an additional camera pose. Do not tour ` +
        `supporting evidence to satisfy this floor`,
    );
  }
  if (requirements.minCameraMoves && cameraMoves < requirements.minCameraMoves) {
    errors.push(
      `the brief explicitly requests spatial camera choreography; plan at least ` +
        `${requirements.minCameraMoves} FULL typed camera moves ` +
        `(pan/whip/push-in/pull-back/track-to-anchor/parallax-pass/orbit/dive — drift and ` +
        `hold do NOT count), not ${cameraMoves}`,
    );
  }
  if (
    requirements.requireOrbit &&
    !storyboard.some((scene) =>
      scene.camera?.path.some((move) => move.move === "orbit" || move.move === "orbit-lite")
    )
  ) {
    errors.push(
      "the brief explicitly requests a true orbit/orbit-lite peak, but no typed camera " +
        "path contains orbit or orbit-lite — prose cameraIntent does not execute",
    );
  }
  if (
    requirements.requireMultiStationWorld &&
    !storyboard.some((scene) =>
      (scene.camera?.path.filter((move) => CAMERA_FULL_MOVES.has(move.move)).length ?? 0) >= 2
    )
  ) {
    errors.push(
      "the brief requests one large spatial UI world; at least one shot must travel through " +
        "multiple stations with two or more FULL typed camera moves in its own path. " +
        "Full moves are pan/whip/push-in/pull-back/track-to-anchor/parallax-pass/orbit/dive — " +
        "drift and hold are connective and do NOT count. Recipe: give one 5s+ shot " +
        "worldLayout cells for 2-3 regions, then pan to the second region at ~1s and " +
        "track-to-anchor a part in the third at ~3s",
    );
  }
  if (
    requirements.requireObjectMatch &&
    !storyboard.some((scene) =>
      scene.cut?.style === "match" && scene.cut.focalPartOut && scene.cut.focalPartIn
    )
  ) {
    errors.push(
      "the brief explicitly requests a match cut that carries an object across the " +
        "boundary, but none is planned with both focal part names",
    );
  }
  if (
    requirements.requireSharedElementCut &&
    !storyboard.some((scene) =>
      scene.cut?.style === "morph" ||
      (scene.cut?.style === "match" && scene.cut.focalPartOut && scene.cut.focalPartIn)
    )
  ) {
    errors.push(
      "the brief explicitly requests a shared-element morph or match, but no boundary " +
        "declares an executable morph or a match with both focal part names",
    );
  }
  if (
    requirements.requireShapeMatch &&
    !storyboard.some((scene) => scene.cut?.style === "morph")
  ) {
    errors.push("the brief explicitly requests a morph transition, but none is planned");
  }
  if (
    requirements.requireRackFocus &&
    !storyboard.some((scene) => scene.camera?.path.some((move) => move.focus))
  ) {
    errors.push(
      "the brief explicitly requests a rack-focus pull, but no camera move carries a " +
        '"focus" modifier — attach focus:{part|depth, blurMaxPx} to the move that lands on the payoff',
    );
  }
  // Speed-ramp discipline: dips are rhythm, not chaos. Never shot 1, max 2 per
  // film, every declared dip must solve inside its shot's identity margins,
  // and the slow-motion hold must be *motivated* by a declared moment.
  const rampScenes = storyboard.filter((scene) => scene.timeRamp);
  if (storyboard[0]?.timeRamp) {
    errors.push("shot 1 must open at native speed — move the timeRamp dip to a later shot");
  }
  if (rampScenes.length > MAX_RAMPS_PER_FILM) {
    errors.push(
      `at most ${MAX_RAMPS_PER_FILM} timeRamp dips per film — keep the one or two most ` +
        `important resolves and drop the rest`,
    );
  }
  const rampPlan = resolveTimeRampPlan(storyboard);
  for (const [rampIndex, scene] of rampScenes.entries()) {
    if (scene === storyboard[0]) continue;
    const resolved = rampPlan.ramps.find((ramp) => ramp.sceneId === scene.id);
    if (!resolved) {
      // Ramps past the per-film cap are unresolved by design; the cap error
      // above already names the real problem.
      if (rampIndex >= MAX_RAMPS_PER_FILM) continue;
      errors.push(
        `shot "${scene.id}" declares a timeRamp that cannot be solved inside the shot: the dip ` +
          `plus recovery must fit between ${(scene.startSec + 0.3).toFixed(1)}s and the shot's ` +
          `cut window with a 0.6s identity margin, and the catch-up must stay under 2.5× — ` +
          `move atSec earlier, shorten holdSec, or lengthen the shot`,
      );
      continue;
    }
    const hold = timeRampHoldWindow(resolved);
    const motivated = (scene.moments ?? []).some((moment) =>
      moment.atSec >= hold.contentStartSec - 0.35 &&
      moment.atSec <= hold.contentEndSec + 0.35
    );
    if (!motivated) {
      errors.push(
        `shot "${scene.id}" timeRamp dip must be motivated: declare a storyboard moment whose ` +
          `atSec falls inside the slow-motion hold (${hold.contentStartSec.toFixed(2)}–` +
          `${hold.contentEndSec.toFixed(2)}s) — slow motion without a subject reads as a stall`,
      );
    }
  }
  if (requirements.requireTimeRamp && !rampScenes.length) {
    errors.push(
      "the brief explicitly requests a speed ramp / slow-motion dip, but no shot declares a " +
        "timeRamp — add one on the film's most important resolve (never shot 1)",
    );
  }
  const presentComponentKinds = new Set(
    storyboard.flatMap((scene) => (scene.components ?? []).map((component) => component.kind)),
  );
  const requestedComponentKinds = requirements.requestedComponentKinds ?? [];
  const coveredRequestedKinds = requestedComponentKinds.filter((kind) =>
    presentComponentKinds.has(kind)
  );
  if (
    requirements.minRequestedComponentKinds &&
    coveredRequestedKinds.length < requirements.minRequestedComponentKinds
  ) {
    const missing = requestedComponentKinds.filter((kind) => !presentComponentKinds.has(kind));
    errors.push(
      `the brief explicitly requests motion-native product components; plan at least ` +
        `${requirements.minRequestedComponentKinds} requested kinds, but only ` +
        `${coveredRequestedKinds.length} are present (missing: ${missing.join(", ")})`,
    );
  }
  const componentBeats = storyboard.reduce(
    (count, scene) => count + (scene.beats?.length ?? 0),
    0,
  );
  if (requirements.minComponentBeats && componentBeats < requirements.minComponentBeats) {
    errors.push(
      `the brief explicitly requests component choreography; plan at least ` +
        `${requirements.minComponentBeats} typed component beats, not ${componentBeats}`,
    );
  }
  const foregrounds = new Set(storyboard.map((scene) => scene.foreground?.toLowerCase()));
  const cameras = new Set(storyboard.map((scene) => scene.cameraIntent?.toLowerCase()));
  if (foregrounds.size < Math.min(3, storyboard.length)) {
    errors.push("storyboard repeats the same foreground composition across shots");
  }
  if (cameras.size < 2) {
    errors.push("storyboard needs at least two distinct camera/framing intentions");
  }
  // Moments are the real review contract: scenes are containers, moments are
  // what the viewer gets. Reject plans that miss the floor, cluster at
  // entrances, repeat visual states, or leave dead intervals — before any
  // source budget is spent.
  errors.push(...validatePlannedMoments(storyboard, expectedStart));
  // Plan-time silhouette sanity: a shape-match declared with cross-family
  // hints is known-hopeless (the runtime would degrade it at bind time), so
  // it gets fixed in a cheap storyboard findings-retry instead of burning
  // author attempts on a cut that can never compile.
  errors.push(...auditShapeMatchHints(storyboard));
  // Camera-energy audit: every 12s+ film needs at least one high-energy
  // element, and four-plus full moves may not share one HIGH-ENERGY verb.
  errors.push(...auditCameraEnergy(storyboard));
  // Transition-language coherence (WS6): a style zoo — a different cut per
  // seam — reads as "messy"; a launch film reuses 1-2 signature transitions.
  errors.push(...auditCutCoherence(storyboard));
  // Complexity governor: a plan the author cannot build (too many component
  // surfaces for the duration) fails HERE, where a retry costs one storyboard
  // call, not downstream where it burns every author attempt.
  errors.push(...auditComponentComplexity(storyboard));
  // Hold-what-matters pacing (WS3): introduced surfaces need development
  // time, typed copy needs reading time, payoffs need outcome holds, and
  // camera density has a ceiling as well as a floor.
  errors.push(...auditPacing(storyboard));
  // MD5: a dive re-frames twice inside its window; a cursor working a
  // DIFFERENT surface through that window aims at a moving frame. Both
  // windows are typed, so refuse the combination here where a retry costs
  // one storyboard call (the dive-on-its-own-target pattern is designed-for
  // and never flagged).
  errors.push(...auditDiveInteractions(storyboard));
  // Exit discipline (WS4): a scene that opens a second content surface over a
  // still-live one in the same station stacks clutter — retire the outgoing
  // surface or give the incoming one its own station.
  errors.push(...auditSurfaceExits(storyboard));
  return [...new Set(errors)];
}

/**
 * Plan-time silhouette sanity for declared shape-match cuts (WS1). The
 * storyboard's shapeOut/shapeIn hints carry no runtime geometry, but a
 * cross-family pair (pill→card, circle→bar) provably cannot survive the
 * runtime's 2.5× aspect audit — the declared morph would silently ship as
 * zoom-through while every artifact still advertises it. Surface the
 * mismatch as a validation finding so a cheap storyboard retry fixes the
 * pair while the plan is still paper.
 */
export function auditShapeMatchHints(storyboard: DirectScene[]): string[] {
  const findings: string[] = [];
  for (const [index, scene] of storyboard.entries()) {
    const next = storyboard[index + 1];
    const cut = scene.cut;
    // Canonicalize so cached storyboards still carrying "shape-match" get the
    // same plan-time sanity as fresh morph declarations.
    const style = cut ? canonicalCutStyle(cut.style).style : undefined;
    if (!next || !cut || style !== "morph" || !cut.shapeOut || !cut.shapeIn) continue;
    if (shapeHintsRhyme(cut.shapeOut, cut.shapeIn)) continue;
    findings.push(
      `morph ${scene.id}->${next.id} declares silhouette hints ` +
        `${cut.shapeOut}->${cut.shapeIn}, which cannot rhyme (a ${cut.shapeOut} and a ` +
        `${cut.shapeIn} differ beyond the runtime's 2.5x aspect cap at any plausible size, ` +
        `so the cut would degrade to a swipe at bind time) — re-point the morph at ` +
        `endpoints whose silhouettes match (pill<->bar, or card<->window<->circle), fix the ` +
        `hints if the real parts do rhyme, or declare a swipe instead`,
    );
  }
  return findings;
}

/**
 * MD5 plan-stage guard: a dive window may not overlap a cursor interaction's
 * screen-space approach unless the interaction targets the dived surface —
 * the hold then covers the interaction window by construction
 * (`deriveDiveWindows` includes interaction windows on the dive target).
 */
export function auditDiveInteractions(storyboard: DirectScene[]): string[] {
  const findings: string[] = [];
  for (const scene of storyboard) {
    const dives = (scene.camera?.path ?? []).filter((move) => move.move === "dive");
    if (!dives.length || !scene.interactions?.length) continue;
    for (const interaction of scene.interactions) {
      const end =
        interaction.holdUntilSec ?? interaction.releaseSec ?? interaction.arriveSec;
      for (const dive of dives) {
        if (dive.toPart === interaction.targetPart) continue;
        if (
          interaction.startSec < dive.startSec + dive.durationSec + 0.001 &&
          end > dive.startSec - 0.001
        ) {
          findings.push(
            `interaction "${interaction.id}" overlaps the dive on "${dive.toPart}" in scene ` +
              `"${scene.id}" (${dive.startSec.toFixed(1)}s-` +
              `${(dive.startSec + dive.durationSec).toFixed(1)}s) while targeting ` +
              `"${interaction.targetPart}" — a cursor cannot work one surface while the camera ` +
              `dives into another; aim the interaction at the dived surface, or retime one of them`,
          );
        }
      }
    }
  }
  return findings;
}

/**
 * Degrade-never-veto rung for the hint audit above: on the final storyboard
 * attempt a still-mismatched volunteered shape-match downgrades to
 * zoom-through with honest prose instead of blocking the film. Brief-required
 * shape-match never lands here — its finding stays blocking so the retry
 * loop (and the rescue rung) remain the delivery mechanism.
 */
export function degradeMismatchedShapeHintCuts(
  storyboard: DirectScene[],
): { scenes: DirectScene[]; degraded: string[] } {
  const degraded: string[] = [];
  const scenes = storyboard.map((scene, index) => {
    const next = storyboard[index + 1];
    const cut = scene.cut;
    const style = cut ? canonicalCutStyle(cut.style).style : undefined;
    if (!next || !cut || style !== "morph" || !cut.shapeOut || !cut.shapeIn) return scene;
    if (shapeHintsRhyme(cut.shapeOut, cut.shapeIn)) return scene;
    degraded.push(`${scene.id}->${next.id} (${cut.shapeOut}->${cut.shapeIn})`);
    return {
      ...scene,
      // Keep any authored boundary timing so the executed window stays put —
      // the same policy as the QA-time rewrite (rewriteDegradedCutStoryboard);
      // only the style and its focal/hint paperwork change. The degrade target
      // is a swipe (MD1): no focal geometry exists at plan time, so the axis
      // falls back to right-travel — the shipped film stays inside the
      // 3-transition language either way.
      cut: {
        version: 1 as const,
        style: "swipe" as const,
        axis: "right" as const,
        ...(cut.travelPx !== undefined ? { travelPx: cut.travelPx } : {}),
        ...(cut.exitSec !== undefined ? { exitSec: cut.exitSec } : {}),
        ...(cut.entrySec !== undefined ? { entrySec: cut.entrySec } : {}),
      },
      outgoingCut:
        `Swipe into the next shot (a declared morph with non-rhyming ` +
        `silhouette hints ${cut.shapeOut}->${cut.shapeIn} was degraded at plan time).`,
    };
  });
  return { scenes, degraded };
}

/**
 * A cross-scene morph needs compatible runtime DOM, not only compatible
 * silhouette hints. Different component kinds are rendered by independent
 * host skeletons, so a volunteered stat-card -> progress-ring morph can pass
 * paper validation and then deterministically degrade in browser QA. Preserve
 * same-kind morphs; turn cross-kind volunteered morphs into honest swipes at
 * plan time. Brief-required shape matching remains blocking and never enters
 * this repair rung.
 */
export function degradeCrossKindComponentMorphCuts(
  storyboard: DirectScene[],
): { scenes: DirectScene[]; degraded: string[] } {
  const degraded: string[] = [];
  const scenes = storyboard.map((scene, index) => {
    const next = storyboard[index + 1];
    const cut = scene.cut;
    const style = cut ? canonicalCutStyle(cut.style).style : undefined;
    if (!next || !cut || style !== "morph" || !cut.focalPartOut || !cut.focalPartIn) {
      return scene;
    }
    const outgoing = scene.components?.find((component) => component.id === cut.focalPartOut);
    const incoming = next.components?.find((component) => component.id === cut.focalPartIn);
    if (!outgoing || !incoming || outgoing.kind === incoming.kind) return scene;
    degraded.push(
      `${scene.id}->${next.id} (${outgoing.kind}:${outgoing.id}->${incoming.kind}:${incoming.id})`,
    );
    return {
      ...scene,
      cut: {
        version: 1 as const,
        style: "swipe" as const,
        axis: "right" as const,
        ...(cut.travelPx !== undefined ? { travelPx: cut.travelPx } : {}),
        ...(cut.exitSec !== undefined ? { exitSec: cut.exitSec } : {}),
        ...(cut.entrySec !== undefined ? { entrySec: cut.entrySec } : {}),
      },
      outgoingCut:
        `Swipe into the next shot (a cross-kind ${outgoing.kind}->${incoming.kind} ` +
        `morph was degraded at plan time because the host DOM structures differ).`,
    };
  });
  return { scenes, degraded };
}

/**
 * Degrade support-map beat violations at parse instead of vetoing the plan
 * (fallback-elimination lever): the planner keeps reaching for a reasonable
 * beat on the wrong component kind (`type` on a list, `rows` on a stat-card)
 * and two live attempts burned SOLELY on those findings. Convert the beat to
 * the nearest supported analog — text arrivals become a universal `swap`,
 * `rows` becomes `count` where the kind counts, anything else becomes a
 * universal `highlight` pulse — mechanically recoverable paperwork never
 * consumes a paid retry. A LOAD-BEARING beat (a declared moment anchors
 * inside its window) keeps the blocking finding instead: silently changing
 * evidence a moment binds to would corrupt the review contract.
 */
export function degradeUnsupportedComponentBeats(
  storyboard: DirectScene[],
): { scenes: DirectScene[]; degraded: string[] } {
  const degraded: string[] = [];
  const scenes = storyboard.map((scene) => {
    const kinds = new Map((scene.components ?? []).map((entry) => [entry.id, entry.kind]));
    if (!scene.beats?.length || !kinds.size) return scene;
    const beats = scene.beats.map((beat) => {
      const kind = kinds.get(beat.component);
      if (!kind || componentSupportsBeat(kind, beat.kind)) return beat;
      const windowEnd = beat.atSec + (beat.durationSec ?? 1.2) + 0.35;
      const loadBearing = (scene.moments ?? []).some((moment) =>
        moment.atSec >= beat.atSec - 0.35 && moment.atSec <= windowEnd
      );
      // A text arrival degrades to `swap` — the SAME text on the SAME
      // component at the SAME second — so a moment anchored on it keeps its
      // evidence beat and its claim: this one is safe even load-bearing (the
      // 2026-07-06 probe set repeatedly died on load-bearing `type` on an
      // app-window). A numeric fill (`progress`/`rows` carrying a value) on a
      // kind that counts degrades to `count` the same way — same number, same
      // second, same numeric-development claim (`sentinel-p6-camera-r2`'s
      // rescue died on a load-bearing `progress` on a stat-card). Every other
      // analog changes the visual channel, so a load-bearing beat there keeps
      // its blocking finding.
      const isTextAnalog = (beat.kind === "type" || beat.kind === "stream") && beat.text;
      const isNumericAnalog =
        (beat.kind === "progress" || beat.kind === "rows") &&
        typeof beat.value === "number" &&
        componentSupportsBeat(kind, "count");
      // LumaFlowQC1's scene-scoped repair changed "dashboard populates" into
      // `rows` on the dashboard action button. A button cannot own child rows,
      // but its active-state transition is the same control, time, and semantic
      // turn; the model's eventual full re-plan chose this exact repair. It is
      // therefore safe even when a moment binds to the beat.
      const isButtonRowsAnalog = beat.kind === "rows" && kind === "button";
      // App-window roots already receive their entrance from the host entrance
      // family; an `open` beat on that chassis can only mean reveal/populate
      // its window content. `rows` is the supported same-root, same-time analog
      // chosen by PatchworkQC6's successful retry, so do it before paying one.
      const isAppWindowOpenAnalog = beat.kind === "open" && kind === "app-window";
      if (
        loadBearing && !isTextAnalog && !isNumericAnalog &&
        !isButtonRowsAnalog && !isAppWindowOpenAnalog
      ) return beat;
      const analog: ComponentBeatKind =
        isTextAnalog
          ? "swap"
          : isNumericAnalog
            ? "count"
            : isButtonRowsAnalog
              ? "set-state"
              : isAppWindowOpenAnalog
                ? "rows"
              : "highlight";
      degraded.push(
        `scene "${scene.id}" beat "${beat.id}": "${beat.kind}" is unsupported on a ` +
          `${kind} component — degraded to "${analog}"`,
      );
      return isButtonRowsAnalog
        ? { ...beat, kind: analog, toState: "active" } as ComponentBeatIntentV1
        : { ...beat, kind: analog };
    });
    return { ...scene, beats };
  });
  return { scenes, degraded };
}

/**
 * Reconcile morph beats whose twin component was never declared (Phase-5
 * hardening: the 2026-07-06 `sentinel-p5-camera-b` rescue attempt died SOLELY
 * on `morphs to undeclared component`). Same conservative ladder as
 * interaction-target reconciliation:
 * 1. The source kind has exactly ONE legal catalog morph partner → DECLARE the
 *    twin with that kind (id and pairing are both the model's own; only the
 *    kind is filled from a one-choice table). The morph the model asked for
 *    actually happens.
 * 2. Ambiguous partner and the beat is not load-bearing → degrade the beat to
 *    a `highlight` pulse (delete/degrade, never invent).
 * 3. Ambiguous AND load-bearing → keep the blocking finding (silently changing
 *    evidence a moment binds to would corrupt the review contract).
 */
export function reconcileUndeclaredMorphTargets(
  storyboard: DirectScene[],
): { scenes: DirectScene[]; changed: string[] } {
  const changed: string[] = [];
  const scenes = storyboard.map((scene) => {
    if (!scene.beats?.length) return scene;
    const declared = new Map((scene.components ?? []).map((entry) => [entry.id, entry]));
    let components = scene.components ?? [];
    const notes: string[] = [];
    const beats = scene.beats.map((beat) => {
      if (beat.kind !== "morph" || !beat.morphTo) return beat;
      const source = declared.get(beat.component);
      const target = declared.get(beat.morphTo);
      const windowEnd = beat.atSec + (beat.durationSec ?? 1.2) + 0.35;
      const loadBearing = (scene.moments ?? []).some((moment) =>
        moment.atSec >= beat.atSec - 0.35 && moment.atSec <= windowEnd
      );
      if (target) {
        if (!source || componentKindsMorphCompatible(source.kind, target.kind)) return beat;
        // Rectangle similarity is not meaning. Never rubber-sheet an unrelated
        // modal into a metric (or copy into a percentage) merely because both
        // roots fit inside a card-like box. A primary beat stays retryable so
        // the planner chooses a real transition; incidental garnish degrades.
        if (loadBearing) return beat;
        const note =
          `beat "${beat.id}": ${source.kind}→${target.kind} is not a semantic morph ` +
          `family — degraded to "highlight" (use a cut/open for unrelated subjects)`;
        notes.push(note);
        changed.push(`scene "${scene.id}" ${note}`);
        const { morphTo: _twin, ...rest } = beat;
        return { ...rest, kind: "highlight" as ComponentBeatKind };
      }
      const partners = source ? morphPartnerKinds(source.kind) : [];
      if (source && partners.length === 1) {
        const twin: (typeof components)[number] = {
          version: 1,
          id: beat.morphTo,
          kind: partners[0]!,
          ...(source.region ? { region: source.region } : {}),
        };
        components = [...components, twin];
        declared.set(twin.id, twin);
        const note =
          `beat "${beat.id}": declared the missing morph twin "${beat.morphTo}" as the ` +
          `${source.kind} kind's only legal partner (${partners[0]})`;
        notes.push(note);
        changed.push(`scene "${scene.id}" ${note}`);
        return beat;
      }
      if (loadBearing) return beat;
      const note =
        `beat "${beat.id}": morph targets undeclared twin "${beat.morphTo}" with no ` +
        `unique catalog partner — degraded to "highlight" (declare BOTH twins to keep a morph)`;
      notes.push(note);
      changed.push(`scene "${scene.id}" ${note}`);
      const { morphTo: _twin, ...rest } = beat;
      return { ...rest, kind: "highlight" as ComponentBeatKind };
    });
    if (!notes.length) return scene;
    return withNormalizationNotes({ ...scene, components, beats }, notes);
  });
  return { scenes, changed };
}

/**
 * Retime an unmotivated or unsolvable timeRamp dip onto the scene's own
 * declared moments instead of vetoing the plan (Phase-5 hardening: the
 * 2026-07-06 `sentinel-p5-longcopy` probe burned three attempts on "declare a
 * moment whose atSec falls inside the slow-motion hold (23.62–23.94s)" — a
 * sub-second target the model must hit blind against the solver's own
 * geometry, which is host arithmetic, not creative judgment). Scans candidate
 * atSec values across the scene window (0.1s grid, nearest-to-declared first)
 * and commits the FIRST candidate whose ramp both resolves and covers a
 * declared moment; a scene with no moments, or no working candidate, is left
 * untouched (the volunteered drop / required finding path is unchanged).
 * Retiming only ever moves the dip the model already declared — it never
 * invents a dip or a moment.
 */
export function retimeUnmotivatedTimeRamps(
  storyboard: DirectScene[],
): { scenes: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  let scenes = [...storyboard];
  const motivatedBy = (
    ramp: ReturnType<typeof resolveTimeRampPlan>["ramps"][number],
    moments: StoryboardMomentV1[],
  ): boolean => {
    const hold = timeRampHoldWindow(ramp);
    return moments.some((moment) =>
      moment.atSec >= hold.contentStartSec - 0.35 && moment.atSec <= hold.contentEndSec + 0.35
    );
  };
  for (const [index, scene] of scenes.entries()) {
    if (index === 0 || !scene.timeRamp || typeof scene.timeRamp.atSec !== "number") continue;
    const moments = scene.moments ?? [];
    if (!moments.length) continue;
    const plan = resolveTimeRampPlan(scenes);
    const resolved = plan.ramps.find((ramp) => ramp.sceneId === scene.id);
    if (resolved && motivatedBy(resolved, moments)) continue;
    const declaredAt = scene.timeRamp.atSec;
    const windowStart = scene.startSec + 0.3;
    const windowEnd = scene.startSec + scene.durationSec - 0.9;
    const candidates: number[] = [];
    for (let t = windowStart; t <= windowEnd + 1e-9; t += 0.1) {
      candidates.push(Math.round(t * 100) / 100);
    }
    candidates.sort((a, b) => Math.abs(a - declaredAt) - Math.abs(b - declaredAt));
    for (const candidate of candidates) {
      const trial = scenes.map((entry, entryIndex) =>
        entryIndex === index
          ? { ...entry, timeRamp: { ...entry.timeRamp!, atSec: candidate } }
          : entry
      );
      const trialResolved = resolveTimeRampPlan(trial).ramps.find(
        (ramp) => ramp.sceneId === scene.id,
      );
      if (!trialResolved || !motivatedBy(trialResolved, moments)) continue;
      const note =
        `retimed the timeRamp dip from ${declaredAt.toFixed(2)}s to ${candidate.toFixed(2)}s ` +
        `so its slow-motion hold covers a declared moment`;
      scenes = trial.map((entry, entryIndex) =>
        entryIndex === index ? withNormalizationNotes(entry, [note]) : entry
      );
      normalized.push(`scene "${scene.id}": ${note}`);
      break;
    }
  }
  return { scenes, normalized };
}

/**
 * Drop VOLUNTEERED timeRamp dips that break the ramp contract instead of
 * letting them veto the whole plan. GLM reaches for the vocabulary even when
 * the brief never asks for slow motion, and a mis-placed dip (unsolvable
 * window, no motivating moment, shot 1, over the per-film cap) used to burn
 * all three storyboard attempts on findings about an optional enhancement —
 * the 2026-07-04 live incident. When the brief explicitly demands a ramp
 * (`requireTimeRamp`), the blocking findings stay: the retry loop is the
 * delivery mechanism there.
 */
export function dropUnusableVolunteeredTimeRamps(storyboard: DirectScene[]): DirectScene[] {
  const scenes = [...storyboard];
  for (let pass = 0; pass < scenes.length; pass += 1) {
    const plan = resolveTimeRampPlan(scenes);
    let dropped = false;
    for (const [index, scene] of scenes.entries()) {
      if (!scene.timeRamp) continue;
      let reason = "";
      if (index === 0) {
        reason = "shot 1 opens at native speed";
      } else {
        const resolved = plan.ramps.find((ramp) => ramp.sceneId === scene.id);
        if (!resolved) {
          reason = "the dip cannot be solved inside the shot (window or per-film cap)";
        } else {
          const hold = timeRampHoldWindow(resolved);
          const motivated = (scene.moments ?? []).some((moment) =>
            moment.atSec >= hold.contentStartSec - 0.35 &&
            moment.atSec <= hold.contentEndSec + 0.35
          );
          if (!motivated) reason = "no declared moment inside the slow-motion hold";
        }
      }
      if (reason) {
        const { timeRamp: _dropped, ...rest } = scene;
        scenes[index] = rest;
        dropped = true;
        process.stderr.write(
          `[storyboard] dropped volunteered timeRamp on "${scene.id}": ${reason}\n`,
        );
      }
    }
    if (!dropped) break;
  }
  return scenes;
}

/**
 * A storyboard rejection that carries the exact plan the findings describe
 * (post any committed normalization), so the findings-retry can hand the model
 * its own artifact back for a MINIMAL edit instead of a from-scratch redesign
 * — the 2026-07-06 probe set showed every from-scratch retry minting fresh
 * violations (whack-a-mole) across both planner models.
 */
export class StoryboardValidationError extends Error {
  readonly storyboard: DirectScene[];
  /**
   * The raw finding list — the SAME array the message joins with "; ". Consumers
   * that need per-finding attribution (the scene-scoped repair rung) must read
   * this and NOT re-split the message: individual findings can themselves
   * contain "; " (e.g. `components/complexity: … build them; keep <= 2 (…)`), so
   * splitting the joined message over-fragments a finding into scene-less pieces
   * that poison scene attribution (the piece lands in the `__film__` bucket and
   * wrongly cancels the repair).
   */
  readonly findings: string[];
  constructor(errors: string[], storyboard: DirectScene[]) {
    super(`invalid storyboard plan: ${errors.join("; ")}`);
    this.name = "StoryboardValidationError";
    this.storyboard = storyboard;
    this.findings = errors;
  }
}

export const acceptedStoryboardDegradations = new WeakMap<DirectScene[], string[]>();

export type StoryboardFindingDecision = "hard" | "advisory";

/** Paid storyboard retries are reserved for malformed or unexecutable plans. */
export function storyboardFindingDecision(
  finding: string,
  requirements: StoryboardPlanRequirements = {},
): StoryboardFindingDecision {
  const line = finding.trim();
  if (
    line.startsWith("display_type_budget_exceeded") ||
    line.startsWith("camera/energy:") ||
    line.startsWith("camera/idea-budget:") ||
    line.startsWith("cuts/coherence:") ||
    line.startsWith("components/complexity:") ||
    line.startsWith("components/exit:") ||
    line.startsWith("pacing/") ||
    /^a \d+s film needs at least \d+ distinct framings\b/.test(line) ||
    line === "storyboard repeats the same foreground composition across shots" ||
    line === "storyboard needs at least two distinct camera/framing intentions" ||
    line.startsWith("shot 1 must open at native speed") ||
    /^at most \d+ timeRamp dips per film\b/.test(line) ||
    /timeRamp dip must be motivated:/.test(line)
  ) return "advisory";
  if (line.startsWith("storyboard/moments:")) {
    return /moment id .* is duplicated|moment .* escapes scene/.test(line)
      ? "hard"
      : "advisory";
  }
  if (/^morph .* declares silhouette hints .* cannot rhyme/.test(line)) {
    return requirements.requireShapeMatch ? "hard" : "advisory";
  }
  return "hard";
}

export function parseStoryboardResponse(
  raw: string,
  requirements: StoryboardPlanRequirements = {},
  options: {
    /** The committed per-job frame; basis is checked before scene authoring. */
    frameMd?: string;
    degradeShapeHintMismatches?: boolean;
    /** Accept pacing/* findings as advisories instead of vetoes (late attempts). */
    degradePacingFindings?: boolean;
    /** Hackathon create policy: all non-execution findings are advisory from attempt one. */
    degradeAdvisoryFindings?: boolean;
  } = {},
): DirectScene[] {
  const degradations: string[] = [];
  if (options.frameMd) assertStoryboardBasisMatchesFrame(raw, options.frameMd);
  const knownCapabilities = new Set(
    loadCapabilityIndex().capabilities.map((capability) => capability.id),
  );
  let storyboard = parseStoryboard(extractStoryboardSource(raw)).map((scene) => ({
    ...scene,
    ...(scene.capabilityIds
      ? { capabilityIds: scene.capabilityIds.filter((id) => knownCapabilities.has(id)) }
      : {}),
  }));
  // Ramp arithmetic is host-owned: an unmotivated or unsolvable dip first gets
  // retimed onto the scene's own declared moments (commits only when the
  // retimed ramp provably resolves + motivates — a per-scene convergence
  // check). Only then are still-broken VOLUNTEERED dips dropped; brief-demanded
  // ramps that no retime can save keep their blocking findings.
  const rampRetime = retimeUnmotivatedTimeRamps(storyboard);
  if (rampRetime.normalized.length) {
    storyboard = rampRetime.scenes;
    for (const line of rampRetime.normalized) {
      process.stderr.write(`[storyboard] sentinel-normalized: ${line}\n`);
    }
    recordSentinelNormalization("timeramp-retime", rampRetime.normalized.length);
  }
  if (!requirements.requireTimeRamp) {
    const beforeRampScenes = new Set(
      storyboard.filter((scene) => scene.timeRamp).map((scene) => scene.id),
    );
    storyboard = dropUnusableVolunteeredTimeRamps(storyboard);
    for (const sceneId of beforeRampScenes) {
      if (!storyboard.find((scene) => scene.id === sceneId)?.timeRamp) {
        degradations.push(`storyboard-time-ramp-dropped:${sceneId}`);
      }
    }
  }
  if (!requirements.requireShapeMatch) {
    const crossKindCuts = degradeCrossKindComponentMorphCuts(storyboard);
    if (crossKindCuts.degraded.length) {
      storyboard = crossKindCuts.scenes;
      for (const line of crossKindCuts.degraded) {
        process.stderr.write(`[storyboard] degraded cross-kind morph to swipe: ${line}\n`);
        degradations.push(`storyboard-cross-kind-cut-degraded:${findingSignature(line)}`);
      }
    }
  }
  // Support-map beat violations degrade to the nearest supported analog
  // (load-bearing beats keep their blocking finding) — see
  // degradeUnsupportedComponentBeats.
  const beatDegradation = degradeUnsupportedComponentBeats(storyboard);
  if (beatDegradation.degraded.length) {
    storyboard = beatDegradation.scenes;
    for (const line of beatDegradation.degraded) {
      process.stderr.write(`[storyboard] ${line}\n`);
      degradations.push(`storyboard-component-beat-degraded:${findingSignature(line)}`);
    }
  }
  // Early attempts keep the hint-mismatch finding blocking so a cheap
  // findings-retry fixes the pair; the FINAL attempt degrades a volunteered
  // hopeless morph to a swipe instead of blocking the film
  // (degrade-never-veto). Brief-required morph never degrades here.
  if (options.degradeShapeHintMismatches && !requirements.requireShapeMatch) {
    const degradation = degradeMismatchedShapeHintCuts(storyboard);
    if (degradation.degraded.length) {
      storyboard = degradation.scenes;
      for (const line of degradation.degraded) {
        process.stderr.write(
          `[storyboard] degraded hint-mismatched morph to swipe: ${line}\n`,
        );
        degradations.push(`storyboard-shape-cut-degraded:${findingSignature(line)}`);
      }
    }
  }
  // Double-triggered motion (repeated pulses, overlapping same-channel beats,
  // press beats under a cursor press) degrades to single triggers before
  // moments bind to beat evidence.
  const focusCoherence = cohereInteractionFocusItems(storyboard);
  if (focusCoherence.normalized.length) {
    storyboard = focusCoherence.scenes;
    for (const line of focusCoherence.normalized) {
      process.stderr.write(`[storyboard] sentinel-normalized: ${line}\n`);
    }
    recordSentinelNormalization("interaction-focus", focusCoherence.normalized.length);
  }
  const deduped = dedupeRedundantBeats(storyboard);
  if (deduped.dropped.length) {
    storyboard = deduped.scenes;
    for (const line of deduped.dropped) {
      process.stderr.write(`[storyboard] ${line}\n`);
      degradations.push(`storyboard-redundant-beat-dropped:${findingSignature(line)}`);
    }
  }
  // Sentinel Phase 3: mechanical fixes (delete/degrade/retime/nudge, never
  // invent content) run before the plan gate sees the storyboard, so arithmetic
  // the host can already do never burns a paid storyboard retry: trim an
  // over-count set-dressing component, clamp an over-budget camera scene, top up
  // the framing floor when short by exactly one move, lift a mild zoom to the
  // energy-peak threshold, delay a hold-cutting move, and stretch a marginal
  // pacing miss. They run BEFORE the moment top-up so topped-up moments anchor
  // only on surviving/added camera moves and final timing, and commit ATOMICALLY
  // below: the normalized plan is kept only when it validates clean — a fix that
  // mints a DIFFERENT blocking finding (the framing-density floor, an explicit
  // brief requirement like minCameraMoves, moment spacing, the 60s film cap)
  // reverts to the model's own artifact so the findings-retry describes what the
  // model actually wrote (the degradeVolunteeredBridgedCuts precedent).
  const preNormalization = storyboard;
  const morphFix = reconcileUndeclaredMorphTargets(storyboard);
  const entranceRetime = retimeLateLoadBearingEntrances(morphFix.scenes);
  // Component trim first — dropping a set-dressing surface changes both the
  // component-complexity count and the pacing introduction ratio the camera
  // normalizers see. Camera budget next (it drops moves, changing which beats
  // even reach the reading/outcome checks); then the framing-floor top-up (add
  // a move only after any over-budget drops) and the energy lift (see the final
  // move set); finally the delay + marginal-miss stretch.
  const blockingChassis = continuityGraphEnabled()
    ? ensureCameraBlockingChassis(entranceRetime.scenes)
    : { storyboard: entranceRetime.scenes, normalized: [] };
  let committedBlockingChassisNormalizations = blockingChassis.normalized.length;
  const componentTrim = trimOverBudgetComponents(blockingChassis.storyboard);
  const heldResultDevelopment = topUpHeldInteractionResultDevelopment(componentTrim.storyboard);
  const crossStationTravel = upgradeCrossStationDrifts(heldResultDevelopment.scenes);
  const cameraBudget = normalizeCameraBudget(crossStationTravel.storyboard);
  const framingTopUp = topUpFramingFloor(cameraBudget.storyboard);
  const energyLift = liftCameraEnergyPeak(framingTopUp.storyboard);
  const rackFocusTopUp = requirements.requireRackFocus
    ? topUpRequiredRackFocus(energyLift.storyboard)
    : { storyboard: energyLift.storyboard, normalized: [] };
  let committedRackFocusTopUps = rackFocusTopUp.normalized.length;
  let atomicNormalizationCommitted = true;
  const landingReserve = reserveFinalCameraLanding(rackFocusTopUp.storyboard);
  // Align destination travel before resolving protected reading/payoff holds.
  // Probe 5 proved the reverse ordering could move a previously-safe whip into
  // a primary set-state hold after the conflict pass had already finished.
  const destinationAlignment = alignCameraDestinationsWithLateEntrances(landingReserve.storyboard);
  const moveDelay = delayConflictingCameraMoves(destinationAlignment.storyboard);
  // Choreography spacing next (2026-07-08 probe set): moves out of interaction
  // arrive→result windows, then entry/stack settles — both pure retimes over
  // the surviving move set, before the marginal-miss stretch sees final times.
  const interactionHold = retimeCameraOverInteractions(moveDelay.storyboard);
  const moveSpacing = spaceStackedCameraMoves(interactionHold.storyboard);
  // Early-swap read-hold next (2026-07-08 probe-audit-01): delay a swap that
  // re-writes a cut's just-landed copy, over the post-spacing move set, before
  // the marginal-miss stretch sees final times.
  const earlySwap = delayEarlySwapBeats(moveSpacing.storyboard);
  const pacingStretch = stretchMarginalPacingMisses(earlySwap.storyboard);
  const connectiveSchedule = normalizeConnectiveCameraSchedule(pacingStretch.storyboard);
  // Every timing normalizer above can move the final full route after the
  // first landing-reserve pass. ProofRail H delayed a 7.7s push to 8.1s while
  // preserving its duration, moving its arrival from 10.38s to 10.78s and
  // sampling the focal inside the outgoing cut. Reassert the reserve against
  // the FINAL schedule before camera blocking compiles its landing evidence.
  const finalLandingReserve = reserveFinalCameraLanding(connectiveSchedule.storyboard);
  // Camera schedule normalizers can legitimately drop the only full move in a
  // scene. Reassert the host-owned transform chassis after that final drop so
  // continuity blocking never receives a scene it cannot frame.
  const finalBlockingChassis = continuityGraphEnabled()
    ? ensureCameraBlockingChassis(finalLandingReserve.storyboard)
    : { storyboard: finalLandingReserve.storyboard, normalized: [] };
  committedBlockingChassisNormalizations += finalBlockingChassis.normalized.length;
  const normalizationLines = [
    ...morphFix.changed,
    ...blockingChassis.normalized,
    ...entranceRetime.normalized,
    ...componentTrim.normalized,
    ...heldResultDevelopment.normalized,
    ...crossStationTravel.normalized,
    ...cameraBudget.normalized,
    ...framingTopUp.normalized,
    ...energyLift.normalized,
    ...rackFocusTopUp.normalized,
    ...landingReserve.normalized,
    ...moveDelay.normalized,
    ...destinationAlignment.normalized,
    ...interactionHold.normalized,
    ...moveSpacing.normalized,
    ...earlySwap.normalized,
    ...pacingStretch.normalized,
    ...connectiveSchedule.normalized,
    ...finalLandingReserve.normalized,
    ...finalBlockingChassis.normalized,
  ];
  if (normalizationLines.length) storyboard = finalBlockingChassis.storyboard;

  // Moment paperwork the plan already proves is filled in by the host, not
  // retried: a marginal dead interval that has a typed beat/camera/cut in it
  // was the dominant live storyboard-stage veto (2026-07-04 incident).
  const topUpMoments = (plan: DirectScene[]): DirectScene[] => {
    const topped = topUpStoryboardMoments(plan, CAMERA_FULL_MOVES);
    if (!topped.added.length) return plan;
    process.stderr.write(
      `[storyboard] topped up ${topped.added.length} moment(s) from typed evidence: ` +
        `${topped.added.map((moment) => `${moment.id}@${moment.atSec.toFixed(1)}s`).join(", ")}\n`,
    );
    return topped.storyboard;
  };
  // Degrade-never-veto for pacing on LATE attempts: pacing findings are
  // polish-grade (they never abort a compile or ship a dead film), and two
  // live probes (2026-07-05) showed both planner models playing whack-a-mole
  // with marginal holds across every retry — each attempt redesigns the
  // storyboard, fixes the old findings, and mints new marginal ones, until
  // the run dies at plan time over a rushed toast while triggering the far
  // worse deterministic fallback. Attempts 1-2 keep full blocking pressure
  // (the findings-retry is still the delivery mechanism); from the primary
  // rung's final attempt onward a plan that is clean EXCEPT for pacing ships
  // with the findings logged as advisories.
  const resolveErrors = (plan: DirectScene[]): string[] => {
    let errors = validateStoryboardPlan(plan, requirements);
    if (options.degradePacingFindings || options.degradeAdvisoryFindings) {
      // Exit-discipline (WS4) and cut-coherence (WS6) findings are polish-grade
      // in exactly the same sense as pacing — a stacked overlay or a style zoo
      // never aborts a compile or ships a dead film — so they ride the same
      // late-attempt demotion to keep a plan clean except for polish from
      // triggering the far worse fallback.
      const isPolish = (finding: string): boolean =>
        options.degradeAdvisoryFindings
          ? storyboardFindingDecision(finding, requirements) === "advisory"
          : finding.startsWith("pacing/") ||
            finding.startsWith("components/exit:") ||
            finding.startsWith("cuts/coherence:");
      const polish = errors.filter(isPolish);
      if (polish.length) {
        errors = errors.filter((finding) => !isPolish(finding));
        for (const line of polish) {
          process.stderr.write(
            `[storyboard] finding accepted as advisory${
              options.degradeAdvisoryFindings ? " without a paid retry" : " on the final attempt"
            }: ${line}\n`,
          );
          degradations.push(
            `${options.degradeAdvisoryFindings
              ? "storyboard-advisory"
              : "storyboard-polish-advisory"}:${findingSignature(line)}`,
          );
        }
      }
    }
    return errors;
  };

  storyboard = topUpMoments(storyboard);
  let errors = resolveErrors(storyboard);
  if (normalizationLines.length && errors.length) {
    // The normalized plan still fails validation. COMMIT anyway when every
    // remaining finding belongs to a class the model's OWN plan already had
    // (digit-stripped comparison, so re-timed instances of the same class
    // match): the arithmetic fixes stand, the retry list shrinks to the real
    // deficits, and the findings describe the plan the retry baseline carries.
    // REVERT when the normalization MINTED a finding class the model never
    // earned (minCameraMoves after a clamp, moment spacing after a stretch…)
    // — the model's own findings are the honest retry input then. This is the
    // 2026-07-06 probe lesson: the old commit-only-if-fully-clean rule meant
    // normalizations never committed (every probe plan also carried a moments
    // deficit) and the model had to re-fix host-fixable arithmetic each retry.
    const originalPlan = topUpMoments(preNormalization);
    const originalErrors = resolveErrors(originalPlan);
    const introduced = normalizationIntroducedFindings(errors, originalErrors);
    if (introduced.length) {
      process.stderr.write(
        `[storyboard] sentinel-normalization reverted (it would mint or worsen a ` +
          `finding: ${introduced[0]})\n`,
      );
      storyboard = originalPlan;
      errors = originalErrors;
      normalizationLines.length = 0;
      atomicNormalizationCommitted = false;
      // The continuity chassis is an L1 execution seam, not creative
      // arithmetic: camera blocking cannot run without a transformable world.
      // Reapply it after an unrelated atomic rollback just like the monotonic
      // required-focus modifier below. Otherwise a camera-budget/timing
      // rollback can silently recreate the no-camera-world failure that the
      // chassis exists to make impossible.
      const recoveredChassis = continuityGraphEnabled()
        ? ensureCameraBlockingChassis(storyboard)
        : { storyboard, normalized: [] };
      storyboard = recoveredChassis.storyboard;
      errors = resolveErrors(storyboard);
      normalizationLines.push(...recoveredChassis.normalized);
      committedBlockingChassisNormalizations = recoveredChassis.normalized.length;
      // A rack-focus top-up is an explicit brief-contract repair on an
      // existing move/part, independent of the arithmetic group that was just
      // reverted. Probe 5 had a valid target, received the modifier, then lost
      // it because an unrelated camera retime minted a moment-gap class; the
      // final attempt consequently failed only for the now-missing focus.
      // Reapply this monotonic modifier to the reverted model plan and validate
      // that honest baseline. It cannot add, drop, or retime a beat/move/scene.
      if (requirements.requireRackFocus) {
        const recoveredFocus = topUpRequiredRackFocus(storyboard);
        storyboard = recoveredFocus.storyboard;
        errors = resolveErrors(storyboard);
        normalizationLines.push(...recoveredFocus.normalized);
        committedRackFocusTopUps = recoveredFocus.normalized.length;
      } else {
        committedRackFocusTopUps = 0;
      }
    }
  }
  if (normalizationLines.length) {
    for (const line of normalizationLines) {
      process.stderr.write(`[storyboard] sentinel-normalized: ${line}\n`);
    }
    if (atomicNormalizationCommitted && morphFix.changed.length) {
      recordSentinelNormalization("morph-twin-reconcile", morphFix.changed.length);
    }
    if (atomicNormalizationCommitted && entranceRetime.normalized.length) {
      recordSentinelNormalization("entrance-retime", entranceRetime.normalized.length);
    }
    if (committedBlockingChassisNormalizations) {
      recordSentinelNormalization(
        "camera-blocking-chassis",
        committedBlockingChassisNormalizations,
      );
    }
    if (atomicNormalizationCommitted && componentTrim.normalized.length) {
      recordSentinelNormalization("component-trim", componentTrim.normalized.length);
    }
    if (atomicNormalizationCommitted && heldResultDevelopment.normalized.length) {
      recordSentinelNormalization(
        "held-result-development",
        heldResultDevelopment.normalized.length,
      );
    }
    if (atomicNormalizationCommitted && cameraBudget.normalized.length) {
      recordSentinelNormalization("camera-budget-clamp", cameraBudget.normalized.length);
    }
    if (atomicNormalizationCommitted && framingTopUp.normalized.length) {
      recordSentinelNormalization("framing-floor-topup", framingTopUp.normalized.length);
    }
    if (atomicNormalizationCommitted && energyLift.normalized.length) {
      recordSentinelNormalization("camera-energy-lift", energyLift.normalized.length);
    }
    if (committedRackFocusTopUps) {
      recordSentinelNormalization("rack-focus-topup", committedRackFocusTopUps);
    }
    if (
      atomicNormalizationCommitted &&
      landingReserve.normalized.length + finalLandingReserve.normalized.length
    ) {
      recordSentinelNormalization(
        "camera-landing-reserve",
        landingReserve.normalized.length + finalLandingReserve.normalized.length,
      );
    }
    if (atomicNormalizationCommitted && moveDelay.normalized.length) {
      recordSentinelNormalization("camera-move-delay", moveDelay.normalized.length);
    }
    if (atomicNormalizationCommitted && destinationAlignment.normalized.length) {
      recordSentinelNormalization("camera-destination-align", destinationAlignment.normalized.length);
    }
    if (atomicNormalizationCommitted && interactionHold.normalized.length) {
      recordSentinelNormalization("interaction-hold-retime", interactionHold.normalized.length);
    }
    if (atomicNormalizationCommitted && moveSpacing.normalized.length) {
      recordSentinelNormalization("move-spacing", moveSpacing.normalized.length);
    }
    if (atomicNormalizationCommitted && earlySwap.normalized.length) {
      recordSentinelNormalization("early-swap-delay", earlySwap.normalized.length);
    }
    if (atomicNormalizationCommitted && pacingStretch.normalized.length) {
      recordSentinelNormalization("pacing-stretch", pacingStretch.normalized.length);
    }
    if (atomicNormalizationCommitted && connectiveSchedule.normalized.length) {
      recordSentinelNormalization("camera-connective-yield", connectiveSchedule.normalized.length);
    }
  }
  if (errors.length) throw new StoryboardValidationError(errors, storyboard);
  acceptedStoryboardDegradations.set(storyboard, [...new Set(degradations)]);
  return storyboard;
}

export function parseCompositionResponse(raw: string): DirectCompositionDraft {
  return {
    storyboard: parseStoryboard(tagged(raw, "storyboard_json")),
    html: extractIndexHtmlSource(raw),
  };
}
