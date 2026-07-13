import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DirectScene } from "./directComposition.ts";

export const INTERACTION_RUNTIME_VERSION = 1;
export const INTERACTION_RUNTIME_FILE = "sequences-interactions.v1.js";

const RUNTIME_SOURCE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "templates",
  INTERACTION_RUNTIME_FILE,
);

export type FrameAnchor =
  | "frame:center"
  | "frame:top-left"
  | "frame:top-right"
  | "frame:bottom-left"
  | "frame:bottom-right"
  | "frame:left-third"
  | "frame:right-third";

export interface SpatialIntentV1 {
  version: 1;
  focalPart: string;
  composition: string;
  frameAnchor?: FrameAnchor;
  opticalBias?: { x: number; y: number };
  relationships: string[];
}

export type InteractionAction = "move" | "hover" | "click" | "focus" | "drag";
export type InteractionPath = "direct" | "arc" | "human" | "custom";
export type InteractionFeedback = "none" | "press" | "ripple" | "press-ripple" | "custom";

export interface InteractionWaypoint {
  /** Normalized composition coordinate. */
  x: number;
  /** Normalized composition coordinate. */
  y: number;
}

export interface InteractionIntentV1 {
  version: 1;
  id: string;
  sceneId: string;
  cursorId: string;
  targetPart: string;
  /** 1-based semantic child inside a list/table component target. */
  item?: number;
  action: InteractionAction;
  startSec: number;
  arriveSec: number;
  pressSec?: number;
  releaseSec?: number;
  holdUntilSec?: number;
  from: FrameAnchor | `part:${string}`;
  path: InteractionPath;
  bend?: number;
  ease?: string;
  aimX: number;
  aimY: number;
  offsetX?: number;
  offsetY?: number;
  hitInsetPx?: number;
  feedback: InteractionFeedback;
  ripplePart?: string;
  dragTargetPart?: string;
  cursorScale?: number;
  targetScale?: number;
  waypoints?: InteractionWaypoint[];
}

export interface InteractionPlanV1 {
  version: 1;
  interactions: InteractionIntentV1[];
}

export interface InteractionContractResult {
  plan?: InteractionPlanV1;
  errors: string[];
}

export function parseSpatialIntent(
  value: unknown,
  label = "spatialIntent",
): { intent?: SpatialIntentV1; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { errors: [`${label} must be an object`] };
  }
  const object = value as Record<string, unknown>;
  if (object.version !== 1) errors.push(`${label}.version must be 1`);
  const focalPart = typeof object.focalPart === "string" ? object.focalPart.trim() : "";
  const composition = typeof object.composition === "string" ? object.composition.trim() : "";
  if (!focalPart) errors.push(`${label}.focalPart is required`);
  if (!composition) errors.push(`${label}.composition is required`);
  const relationships = Array.isArray(object.relationships)
    ? object.relationships
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 8)
    : [];
  if (!Array.isArray(object.relationships)) errors.push(`${label}.relationships must be an array`);
  const frameAnchor = typeof object.frameAnchor === "string"
    ? object.frameAnchor as FrameAnchor
    : undefined;
  if (frameAnchor && !FRAME_ANCHORS.has(frameAnchor)) {
    errors.push(`${label}.frameAnchor is unsupported`);
  }
  let opticalBias: { x: number; y: number } | undefined;
  if (object.opticalBias !== undefined) {
    const bias = object.opticalBias as Record<string, unknown>;
    if (!bias || !finite(bias.x) || !finite(bias.y)) {
      errors.push(`${label}.opticalBias must contain finite x/y`);
    } else {
      opticalBias = { x: bias.x, y: bias.y };
    }
  }
  return errors.length
    ? { errors }
    : {
        intent: {
          version: 1,
          focalPart,
          composition,
          ...(frameAnchor ? { frameAnchor } : {}),
          ...(opticalBias ? { opticalBias } : {}),
          relationships,
        },
        errors: [],
      };
}

export function parseInteractionIntents(
  value: unknown,
  label = "interactions",
): { interactions: InteractionIntentV1[]; errors: string[] } {
  if (!Array.isArray(value)) return { interactions: [], errors: [`${label} must be an array`] };
  const errors: string[] = [];
  const interactions = value.flatMap((entry, index) => {
    const parsed = parseInteraction(entry, index, errors);
    return parsed ? [parsed] : [];
  });
  return {
    interactions,
    errors: errors.map((error) => error.replace(/^interaction/, label)),
  };
}

const ACTIONS = new Set<InteractionAction>(["move", "hover", "click", "focus", "drag"]);
const PATHS = new Set<InteractionPath>(["direct", "arc", "human", "custom"]);
const FEEDBACK = new Set<InteractionFeedback>([
  "none",
  "press",
  "ripple",
  "press-ripple",
  "custom",
]);
const FRAME_ANCHORS = new Set<FrameAnchor>([
  "frame:center",
  "frame:top-left",
  "frame:top-right",
  "frame:bottom-left",
  "frame:bottom-right",
  "frame:left-third",
  "frame:right-third",
]);

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stableToken(value: unknown): string {
  const raw = trimmed(value);
  if (/^[a-z][a-z0-9-]{0,63}$/.test(raw)) return raw;
  const slug = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  if (!slug) return "";
  return /^[a-z]/.test(slug) ? slug : `part-${slug}`.slice(0, 64);
}

export function normalizeStoryboardSpatialIntent(
  value: unknown,
): SpatialIntentV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  const rawFocalPart = trimmed(object.focalPart);
  const focalPart = stableToken(rawFocalPart);
  if (!focalPart) return undefined;
  const composition = trimmed(object.composition) || `Focus composition on ${rawFocalPart}`;
  const relationships = Array.isArray(object.relationships)
    ? object.relationships
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 8)
    : [];
  const frameAnchor = FRAME_ANCHORS.has(object.frameAnchor as FrameAnchor)
    ? object.frameAnchor as FrameAnchor
    : undefined;
  const bias = object.opticalBias as Record<string, unknown> | undefined;
  const opticalBias = bias && finite(bias.x) && finite(bias.y)
    ? { x: bias.x, y: bias.y }
    : undefined;
  return {
    version: 1,
    focalPart,
    composition,
    ...(frameAnchor ? { frameAnchor } : {}),
    ...(opticalBias ? { opticalBias } : {}),
    relationships,
  };
}

interface StoryboardInteractionContext {
  sceneId: string;
  startSec: number;
  durationSec: number;
}

function normalizeStoryboardTiming(
  object: Record<string, unknown>,
  action: InteractionAction,
  feedback: InteractionFeedback,
  context: StoryboardInteractionContext,
): Pick<
  InteractionIntentV1,
  "startSec" | "arriveSec" | "pressSec" | "releaseSec" | "holdUntilSec"
> | undefined {
  if (
    !Number.isFinite(context.startSec) ||
    !Number.isFinite(context.durationSec) ||
    context.durationSec <= 0.4
  ) {
    return undefined;
  }
  const low = context.startSec + Math.min(0.05, context.durationSec * 0.03);
  const high = context.startSec + context.durationSec -
    Math.min(0.05, context.durationSec * 0.03);
  const span = high - low;
  const needsPress =
    action === "click" ||
    action === "focus" ||
    action === "drag" ||
    feedback === "press" ||
    feedback === "ripple" ||
    feedback === "press-ripple";
  const hasHold = finite(object.holdUntilSec);
  const minimumGap = Math.min(0.1, span / (needsPress ? 8 : 4));
  const rawStart = finite(object.startSec) ? object.startSec : undefined;
  const sceneOffset =
    rawStart !== undefined &&
    context.startSec > 0 &&
    rawStart >= 0 &&
    rawStart < context.startSec &&
    rawStart <= context.durationSec
      ? context.startSec
      : 0;
  const shifted = (value: unknown): number | undefined =>
    finite(value) ? value + sceneOffset : undefined;

  let startSec = rawStart !== undefined
    ? clamp(rawStart + sceneOffset, low, high - minimumGap)
    : low + span * 0.12;
  const rawArrive = shifted(object.arriveSec);
  let arriveSec = rawArrive !== undefined
    ? Math.max(rawArrive, startSec + minimumGap)
    : startSec + span * 0.28;
  const rawPress = shifted(object.pressSec);
  let pressSec = needsPress
    ? rawPress !== undefined
      ? Math.max(rawPress, arriveSec + minimumGap)
      : arriveSec + Math.max(0.12, minimumGap)
    : undefined;
  const rawRelease = shifted(object.releaseSec);
  let releaseSec = needsPress
    ? rawRelease !== undefined
      ? Math.max(rawRelease, pressSec! + minimumGap)
      : pressSec! + Math.max(0.14, minimumGap)
    : undefined;
  const rawHold = shifted(object.holdUntilSec);
  let holdUntilSec = hasHold
    ? Math.max(rawHold!, releaseSec ?? arriveSec)
    : undefined;

  const end = holdUntilSec ?? releaseSec ?? arriveSec;
  if (end > high) {
    const shift = end - high;
    startSec -= shift;
    arriveSec -= shift;
    if (pressSec !== undefined) pressSec -= shift;
    if (releaseSec !== undefined) releaseSec -= shift;
    if (holdUntilSec !== undefined) holdUntilSec -= shift;
  }
  if (startSec < low) {
    startSec = low + span * 0.08;
    arriveSec = low + span * (needsPress ? 0.44 : 0.68);
    if (needsPress) {
      pressSec = Math.max(arriveSec + minimumGap, low + span * 0.56);
      releaseSec = Math.max(pressSec + minimumGap, low + span * 0.7);
      if (hasHold) holdUntilSec = Math.max(releaseSec, low + span * 0.84);
    } else if (hasHold) {
      holdUntilSec = Math.max(arriveSec, low + span * 0.84);
    }
  }
  return {
    startSec,
    arriveSec,
    ...(pressSec !== undefined ? { pressSec } : {}),
    ...(releaseSec !== undefined ? { releaseSec } : {}),
    ...(holdUntilSec !== undefined ? { holdUntilSec } : {}),
  };
}

/**
 * Storyboard interactions are optional model-authored enhancements. Normalize
 * recoverable schema/timing drift and omit an unusable entry instead of
 * aborting the core video build. The resulting intents still pass the strict
 * runtime contract before any composition can be published.
 */
export function normalizeStoryboardInteractionIntents(
  value: unknown,
  context: StoryboardInteractionContext,
): InteractionIntentV1[] {
  if (!Array.isArray(value)) return [];
  const interactions = value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const object = entry as Record<string, unknown>;
    const targetPart = stableToken(object.targetPart);
    const action = ACTIONS.has(object.action as InteractionAction)
      ? object.action as InteractionAction
      : undefined;
    if (!targetPart || !action) return [];
    const feedback = FEEDBACK.has(object.feedback as InteractionFeedback)
      ? object.feedback as InteractionFeedback
      : action === "click" || action === "focus"
        ? "press"
        : "none";
    const dragTargetPart =
      action === "drag" ? stableToken(object.dragTargetPart) : "";
    if (action === "drag" && !dragTargetPart) return [];
    const timing = normalizeStoryboardTiming(object, action, feedback, context);
    if (!timing) return [];
    const rawFrom = trimmed(object.from);
    const fromPart = rawFrom.startsWith("part:") ? stableToken(rawFrom.slice(5)) : "";
    const from = FRAME_ANCHORS.has(rawFrom as FrameAnchor)
      ? rawFrom as FrameAnchor
      : fromPart
        ? `part:${fromPart}` as const
        : "frame:bottom-right";
    const rawPath = PATHS.has(object.path as InteractionPath)
      ? object.path as InteractionPath
      : "human";
    const waypoints = Array.isArray(object.waypoints)
      ? object.waypoints.flatMap((waypoint) => {
          if (
            !waypoint ||
            typeof waypoint !== "object" ||
            !finite((waypoint as Record<string, unknown>).x) ||
            !finite((waypoint as Record<string, unknown>).y)
          ) {
            return [];
          }
          const point = waypoint as { x: number; y: number };
          return [{ x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) }];
        })
      : [];
    const path = rawPath === "custom" && !waypoints.length ? "human" : rawPath;
    const suppliedRipplePart = stableToken(object.ripplePart);
    const ripplePart =
      feedback === "ripple" || feedback === "press-ripple"
        ? /(?:^|-)(?:ripple|pulse|wave)(?:-|$)/.test(suppliedRipplePart)
          ? suppliedRipplePart
          : `${targetPart}-ripple`
        : "";
    const candidate = {
      version: 1,
      id: stableToken(object.id) || `${context.sceneId}-${action}-${index + 1}`,
      sceneId: context.sceneId,
      cursorId: stableToken(object.cursorId) || "pointer",
      targetPart,
      ...(finite(object.item)
        ? { item: clamp(Math.round(object.item), 1, 48) }
        : {}),
      action,
      ...timing,
      from,
      path,
      ...(finite(object.bend)
        ? {
            bend: clamp(
              object.bend,
              path === "human" ? -0.35 : -0.6,
              path === "human" ? 0.35 : 0.6,
            ),
          }
        : {}),
      ...(trimmed(object.ease) ? { ease: trimmed(object.ease) } : {}),
      aimX: finite(object.aimX) ? clamp(object.aimX, 0.15, 0.85) : 0.5,
      aimY: finite(object.aimY) ? clamp(object.aimY, 0.15, 0.85) : 0.5,
      ...(finite(object.offsetX) ? { offsetX: clamp(object.offsetX, -24, 24) } : {}),
      ...(finite(object.offsetY) ? { offsetY: clamp(object.offsetY, -24, 24) } : {}),
      ...(finite(object.hitInsetPx)
        ? { hitInsetPx: clamp(object.hitInsetPx, 0, 24) }
        : {}),
      feedback,
      ...(ripplePart ? { ripplePart } : {}),
      ...(dragTargetPart ? { dragTargetPart } : {}),
      ...(finite(object.cursorScale)
        ? { cursorScale: clamp(object.cursorScale, 0.5, 1) }
        : {}),
      ...(finite(object.targetScale)
        ? { targetScale: clamp(object.targetScale, 0.75, 1) }
        : {}),
      ...(waypoints.length ? { waypoints } : {}),
    };
    return parseInteractionIntents([candidate]).interactions;
  });
  // A click/focus/drag intent already includes its own approach movement. Some
  // strict-schema responses redundantly emit a separate move/hover intent over
  // the same interval; compiling both would make two timelines fight over one
  // cursor. Preserve the richer actionable intent and drop only that mechanical
  // duplicate.
  return interactions.filter((interaction) => {
    if (interaction.action !== "move" && interaction.action !== "hover") return true;
    return !interactions.some((candidate) =>
      candidate !== interaction &&
      candidate.cursorId === interaction.cursorId &&
      candidate.targetPart === interaction.targetPart &&
      candidate.item === interaction.item &&
      (
        candidate.action === "click" ||
        candidate.action === "focus" ||
        candidate.action === "drag"
      ) &&
      Math.max(candidate.startSec, interaction.startSec) <
        Math.min(candidate.arriveSec, interaction.arriveSec) &&
      Math.abs(candidate.arriveSec - interaction.arriveSec) <= 0.25
    );
  });
}

/**
 * One action may be expressed by several host systems (cursor, selected row,
 * highlight/underline FX). Collapse their focus onto one semantic child so a
 * pointer cannot land on row 2 while a ring or underline calls out row 3.
 * This only copies an already-declared item; it never invents a target.
 */
export function cohereInteractionFocusItems(
  storyboard: DirectScene[],
): { scenes: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  const scenes = storyboard.map((scene) => {
    if (!scene.interactions?.length || !scene.beats?.length) return scene;
    let interactions = scene.interactions;
    let beats = scene.beats;
    let changed = false;
    for (const intent of interactions) {
      const actionAt = intent.pressSec ?? intent.arriveSec;
      const end = intent.holdUntilSec ?? intent.releaseSec ?? intent.arriveSec;
      const focusIndexes = beats.flatMap((beat, index) =>
        beat.component === intent.targetPart &&
          (beat.kind === "select" || beat.kind === "highlight") &&
          beat.atSec >= intent.startSec - 0.45 &&
          beat.atSec <= end + 0.75
          ? [index]
          : []
      );
      if (!focusIndexes.length) continue;
      const nearestDeclared = focusIndexes
        .map((index) => beats[index]!)
        .filter((beat) => beat.item !== undefined)
        .sort((a, b) => Math.abs(a.atSec - actionAt) - Math.abs(b.atSec - actionAt))[0];
      const item = intent.item ?? nearestDeclared?.item;
      if (item === undefined) continue;
      const nextIntent = intent.item === item ? intent : { ...intent, item };
      if (nextIntent !== intent) {
        interactions = interactions.map((entry) => entry === intent ? nextIntent : entry);
        changed = true;
      }
      const mismatched = focusIndexes.filter((index) => beats[index]!.item !== item);
      if (mismatched.length) {
        const mismatchSet = new Set(mismatched);
        beats = beats.map((beat, index) =>
          mismatchSet.has(index) ? { ...beat, item } : beat
        );
        changed = true;
      }
      if (nextIntent !== intent || mismatched.length) {
        normalized.push(
          `scene "${scene.id}": focused interaction "${intent.id}" and ` +
            `${focusIndexes.length} selection/highlight beat(s) on ` +
            `${intent.targetPart} item ${item}`,
        );
      }
    }
    if (!changed) return scene;
    return {
      ...scene,
      interactions,
      beats,
      sentinelNormalizations: [
        ...(scene.sentinelNormalizations ?? []),
        "interaction-focus: cursor and focus FX share one semantic item",
      ],
    };
  });
  return { scenes, normalized };
}

function optionalFinite(
  object: Record<string, unknown>,
  key: string,
  errors: string[],
  label: string,
): number | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (!finite(value)) {
    errors.push(`${label}.${key} must be finite`);
    return undefined;
  }
  return value;
}

function parseInteraction(
  value: unknown,
  index: number,
  errors: string[],
): InteractionIntentV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`interaction[${index}] must be an object`);
    return undefined;
  }
  const object = value as Record<string, unknown>;
  const label = `interaction[${index}]`;
  const requiredStrings = [
    "id",
    "sceneId",
    "cursorId",
    "targetPart",
    "action",
    "from",
    "path",
    "feedback",
  ] as const;
  for (const key of requiredStrings) {
    if (typeof object[key] !== "string" || !String(object[key]).trim()) {
      errors.push(`${label}.${key} must be a non-empty string`);
    }
  }
  for (const key of ["startSec", "arriveSec", "aimX", "aimY"] as const) {
    if (!finite(object[key])) errors.push(`${label}.${key} must be finite`);
  }
  if (object.version !== 1) errors.push(`${label}.version must be 1`);
  if (typeof object.action === "string" && !ACTIONS.has(object.action as InteractionAction)) {
    errors.push(`${label}.action is unsupported`);
  }
  if (typeof object.path === "string" && !PATHS.has(object.path as InteractionPath)) {
    errors.push(`${label}.path is unsupported`);
  }
  if (typeof object.feedback === "string" && !FEEDBACK.has(object.feedback as InteractionFeedback)) {
    errors.push(`${label}.feedback is unsupported`);
  }
  const from = typeof object.from === "string" ? object.from : "";
  if (
    from &&
    !FRAME_ANCHORS.has(from as FrameAnchor) &&
    (!from.startsWith("part:") || !from.slice(5).trim())
  ) {
    errors.push(`${label}.from must be a frame anchor or part:<name>`);
  }
  const aimX = finite(object.aimX) ? object.aimX : 0.5;
  const aimY = finite(object.aimY) ? object.aimY : 0.5;
  if (aimX < 0 || aimX > 1 || aimY < 0 || aimY > 1) {
    errors.push(`${label}.aimX/aimY must be normalized from 0 to 1`);
  }
  const pressSec = optionalFinite(object, "pressSec", errors, label);
  const releaseSec = optionalFinite(object, "releaseSec", errors, label);
  const holdUntilSec = optionalFinite(object, "holdUntilSec", errors, label);
  const bend = optionalFinite(object, "bend", errors, label);
  const offsetX = optionalFinite(object, "offsetX", errors, label);
  const offsetY = optionalFinite(object, "offsetY", errors, label);
  const hitInsetPx = optionalFinite(object, "hitInsetPx", errors, label);
  const cursorScale = optionalFinite(object, "cursorScale", errors, label);
  const targetScale = optionalFinite(object, "targetScale", errors, label);
  const item = optionalFinite(object, "item", errors, label);
  if (bend !== undefined && (bend < -1 || bend > 1)) errors.push(`${label}.bend must be -1..1`);
  if (hitInsetPx !== undefined && hitInsetPx < 0) errors.push(`${label}.hitInsetPx must be >= 0`);
  if (cursorScale !== undefined && (cursorScale < 0.5 || cursorScale > 1)) {
    errors.push(`${label}.cursorScale must be 0.5..1`);
  }
  if (targetScale !== undefined && (targetScale < 0.75 || targetScale > 1)) {
    errors.push(`${label}.targetScale must be 0.75..1`);
  }
  if (item !== undefined && (!Number.isInteger(item) || item < 1 || item > 48)) {
    errors.push(`${label}.item must be an integer from 1..48`);
  }
  let waypoints: InteractionWaypoint[] | undefined;
  if (object.waypoints !== undefined) {
    if (!Array.isArray(object.waypoints)) {
      errors.push(`${label}.waypoints must be an array`);
    } else {
      waypoints = object.waypoints.flatMap((entry, waypointIndex) => {
        if (
          !entry ||
          typeof entry !== "object" ||
          !finite((entry as Record<string, unknown>).x) ||
          !finite((entry as Record<string, unknown>).y)
        ) {
          errors.push(`${label}.waypoints[${waypointIndex}] must contain finite x/y`);
          return [];
        }
        const point = entry as { x: number; y: number };
        if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
          errors.push(`${label}.waypoints[${waypointIndex}] must be normalized`);
        }
        return [{ x: point.x, y: point.y }];
      });
    }
  }
  if (object.path === "custom" && (!waypoints || waypoints.length === 0)) {
    errors.push(`${label}.custom path requires normalized waypoints`);
  }
  const startSec = finite(object.startSec) ? object.startSec : 0;
  const arriveSec = finite(object.arriveSec) ? object.arriveSec : 0;
  if (arriveSec <= startSec) errors.push(`${label}.arriveSec must be after startSec`);
  const needsPress = object.action === "click" || object.action === "focus" || object.action === "drag";
  if (needsPress && (pressSec === undefined || releaseSec === undefined)) {
    errors.push(`${label}.${String(object.action)} requires pressSec and releaseSec`);
  }
  const feedbackNeedsPress =
    object.feedback === "press" ||
    object.feedback === "ripple" ||
    object.feedback === "press-ripple";
  if (feedbackNeedsPress && (pressSec === undefined || releaseSec === undefined)) {
    errors.push(`${label}.${String(object.feedback)} requires pressSec and releaseSec`);
  }
  if (pressSec !== undefined && pressSec < arriveSec) {
    errors.push(`${label}.pressSec must be at or after arriveSec`);
  }
  if (releaseSec !== undefined && (pressSec === undefined || releaseSec <= pressSec)) {
    errors.push(`${label}.releaseSec must be after pressSec`);
  }
  if (holdUntilSec !== undefined && holdUntilSec < (releaseSec ?? arriveSec)) {
    errors.push(`${label}.holdUntilSec must follow the interaction`);
  }
  const dragTargetPart = typeof object.dragTargetPart === "string"
    ? object.dragTargetPart.trim()
    : "";
  if (object.action === "drag" && !dragTargetPart) {
    errors.push(`${label}.drag requires dragTargetPart`);
  }
  const targetPart = typeof object.targetPart === "string" ? object.targetPart.trim() : "";
  const suppliedRipplePart = typeof object.ripplePart === "string"
    ? object.ripplePart.trim()
    : "";
  // A ripple name is mechanical rather than creative. Some structured-output
  // providers omit the conditionally-required field even after selecting
  // ripple feedback; deriving the stable scene-scoped part keeps the storyboard
  // usable and gives the author an exact binding to create.
  const ripplePart =
    object.feedback === "ripple" || object.feedback === "press-ripple"
      ? suppliedRipplePart || (targetPart ? `${targetPart}-ripple` : "")
      : suppliedRipplePart;
  if (errors.some((error) => error.startsWith(label))) return undefined;
  return {
    version: 1,
    id: String(object.id).trim(),
    sceneId: String(object.sceneId).trim(),
    cursorId: String(object.cursorId).trim(),
    targetPart,
    ...(item !== undefined ? { item } : {}),
    action: object.action as InteractionAction,
    startSec,
    arriveSec,
    ...(pressSec !== undefined ? { pressSec } : {}),
    ...(releaseSec !== undefined ? { releaseSec } : {}),
    ...(holdUntilSec !== undefined ? { holdUntilSec } : {}),
    from: from as FrameAnchor | `part:${string}`,
    path: object.path as InteractionPath,
    ...(bend !== undefined ? { bend } : {}),
    ...(typeof object.ease === "string" && object.ease.trim() ? { ease: object.ease.trim() } : {}),
    aimX,
    aimY,
    ...(offsetX !== undefined ? { offsetX } : {}),
    ...(offsetY !== undefined ? { offsetY } : {}),
    ...(hitInsetPx !== undefined ? { hitInsetPx } : {}),
    feedback: object.feedback as InteractionFeedback,
    ...(ripplePart ? { ripplePart } : {}),
    ...(dragTargetPart ? { dragTargetPart } : {}),
    ...(cursorScale !== undefined ? { cursorScale } : {}),
    ...(targetScale !== undefined ? { targetScale } : {}),
    ...(waypoints ? { waypoints } : {}),
  };
}

export function interactionRuntimeSource(): string {
  return fs.readFileSync(RUNTIME_SOURCE_PATH, "utf8");
}

export function interactionRuntimeHash(): string {
  return createHash("sha256").update(interactionRuntimeSource()).digest("hex");
}

export function parseInteractionPlan(html: string): InteractionContractResult {
  const match = html.match(
    /<script\b[^>]*\bid\s*=\s*(["'])sequences-interactions\1[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return { errors: [] };
  let value: unknown;
  try {
    value = JSON.parse(match[2]!.trim());
  } catch (error) {
    return {
      errors: [
        `sequences-interactions JSON is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { errors: ["sequences-interactions must be an object"] };
  }
  const object = value as Record<string, unknown>;
  const errors: string[] = [];
  if (object.version !== 1) errors.push("sequences-interactions.version must be 1");
  if (!Array.isArray(object.interactions)) {
    errors.push("sequences-interactions.interactions must be an array");
    return { errors };
  }
  const interactions = object.interactions.flatMap((entry, index) => {
    const parsed = parseInteraction(entry, index, errors);
    return parsed ? [parsed] : [];
  });
  const ids = new Set<string>();
  for (const interaction of interactions) {
    if (ids.has(interaction.id)) errors.push(`duplicate interaction id "${interaction.id}"`);
    ids.add(interaction.id);
  }
  return errors.length
    ? { errors }
    : { plan: { version: 1, interactions }, errors: [] };
}

function partPattern(part: string): RegExp {
  const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\bdata-part\\s*=\\s*(["'])${escaped}\\1`, "i");
}

export function validateInteractionContract(
  html: string,
  scenes: DirectScene[],
  durationSec: number,
): InteractionContractResult {
  const parsed = parseInteractionPlan(html);
  const errors = [...parsed.errors];
  const storyboardInteractions = scenes.flatMap((scene) => scene.interactions ?? []);
  if (!parsed.plan && storyboardInteractions.length === 0) return { errors };
  if (!parsed.plan) {
    errors.push("storyboard declares interactions but index_html has no sequences-interactions JSON island");
    return { errors };
  }
  if (!html.includes(`src="${INTERACTION_RUNTIME_FILE}"`) &&
      !html.includes(`src='${INTERACTION_RUNTIME_FILE}'`)) {
    errors.push(`interaction composition must load local ${INTERACTION_RUNTIME_FILE}`);
  }
  if (!/\bSequencesInteractions\.compile\s*\(/.test(html)) {
    errors.push("interaction composition must call SequencesInteractions.compile(timeline, root)");
  }
  if (storyboardInteractions.length !== parsed.plan.interactions.length) {
    errors.push(
      `storyboard declares ${storyboardInteractions.length} interactions but HTML binds ` +
        `${parsed.plan.interactions.length}`,
    );
  }
  const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));
  const declaredById = new Map(storyboardInteractions.map((intent) => [intent.id, intent]));
  for (const interaction of parsed.plan.interactions) {
    const scene = scenesById.get(interaction.sceneId);
    if (!scene) {
      errors.push(`interaction "${interaction.id}" references unknown scene "${interaction.sceneId}"`);
      continue;
    }
    const end = interaction.holdUntilSec ?? interaction.releaseSec ?? interaction.arriveSec;
    if (
      interaction.startSec < scene.startSec - 0.001 ||
      end > scene.startSec + scene.durationSec + 0.001 ||
      end > durationSec + 0.001
    ) {
      errors.push(`interaction "${interaction.id}" timing escapes scene "${scene.id}"`);
    }
    // A cursor aimed at a plane mid-3D-orbit still hits (targets are measured
    // live and getBoundingClientRect projects the rotation), but precision
    // and legibility degrade badly on a rotated plane. Both windows are
    // typed, so refuse the combination deterministically.
    const orbitOverlap = (scene.camera?.path ?? []).find((move) =>
      move.move === "orbit" &&
      interaction.startSec < move.startSec + move.durationSec + 0.001 &&
      end > move.startSec - 0.001
    );
    if (orbitOverlap) {
      errors.push(
        `interaction "${interaction.id}" overlaps an orbit camera move in scene "${scene.id}" ` +
          `(${orbitOverlap.startSec}s-${(orbitOverlap.startSec + orbitOverlap.durationSec).toFixed(2)}s) — ` +
          `cursor work on a 3D-rotated plane is not allowed; retime the interaction or the orbit`,
      );
    }
    if (!partPattern(interaction.targetPart).test(html)) {
      errors.push(`interaction "${interaction.id}" target part "${interaction.targetPart}" is absent`);
    }
    if (
      !new RegExp(
        `\\bdata-cursor-id\\s*=\\s*(["'])${
          interaction.cursorId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        }\\1`,
        "i",
      ).test(html)
    ) {
      errors.push(`interaction "${interaction.id}" cursor "${interaction.cursorId}" is absent`);
    }
    if (interaction.ripplePart && !partPattern(interaction.ripplePart).test(html)) {
      errors.push(`interaction "${interaction.id}" ripple part "${interaction.ripplePart}" is absent`);
    }
    if (interaction.dragTargetPart && !partPattern(interaction.dragTargetPart).test(html)) {
      errors.push(
        `interaction "${interaction.id}" drag target part "${interaction.dragTargetPart}" is absent`,
      );
    }
    const declared = declaredById.get(interaction.id);
    if (!declared) {
      errors.push(`HTML binds undeclared interaction "${interaction.id}"`);
    } else {
      const normalizedDeclared = parseInteractionIntents([declared]).interactions[0];
      if (
        !normalizedDeclared ||
        JSON.stringify(normalizedDeclared) !== JSON.stringify(interaction)
      ) {
        errors.push(
          `HTML binding for interaction "${interaction.id}" differs from locked storyboard`,
        );
      }
    }
  }
  return { plan: parsed.plan, errors: [...new Set(errors)] };
}
