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
  if (bend !== undefined && (bend < -1 || bend > 1)) errors.push(`${label}.bend must be -1..1`);
  if (hitInsetPx !== undefined && hitInsetPx < 0) errors.push(`${label}.hitInsetPx must be >= 0`);
  if (cursorScale !== undefined && (cursorScale < 0.5 || cursorScale > 1)) {
    errors.push(`${label}.cursorScale must be 0.5..1`);
  }
  if (targetScale !== undefined && (targetScale < 0.75 || targetScale > 1)) {
    errors.push(`${label}.targetScale must be 0.75..1`);
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
  for (const scene of scenes) {
    if (scene.spatialIntent && !partPattern(scene.spatialIntent.focalPart).test(html)) {
      errors.push(
        `scene "${scene.id}" focal part "${scene.spatialIntent.focalPart}" is absent from index_html`,
      );
    }
  }
  return { plan: parsed.plan, errors: [...new Set(errors)] };
}
