/**
 * Continuous Spatial World / Camera Rig — the typed camera contract.
 *
 * The video frame is a fixed viewport; a scene's `data-camera-world` is a
 * larger finite plane with named `data-region` stations (product UI, copy,
 * stats, CTA moments) scattered across it. The viewer never sees the whole
 * plane at once: the storyboard declares a bounded typed camera *path* per
 * scene (hold, drift, pan, whip, push-in, pull-back, track-to-anchor,
 * parallax-pass, orbit-lite, orbit) and a deterministic host runtime
 * (`sequences-camera.v1.js`) compiles it into seek-safe, velocity-designed
 * tweens on the world plane, with parallax counter-motion on
 * `data-depth`/`data-parallax` layers. Segments may carry a rack-focus
 * modifier that pulls a tweened focal plane between those depth layers.
 *
 * The contract mirrors the cut/interaction architecture: planner declares
 * intent, the resolver normalizes it into a contiguous segment chain (gaps are
 * auto-filled with `drift`/creep segments so the camera never freezes without
 * a typed `hold`), the host injects the JSON island + runtime + compile call,
 * and static validation proves the binding before publication. A path that
 * cannot be normalized degrades to no camera plan — the rig is an
 * enhancement, never a veto.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DirectScene } from "./directComposition.ts";

export const CAMERA_RUNTIME_VERSION = 1;
export const CAMERA_RUNTIME_FILE = "sequences-camera.v1.js";

const RUNTIME_SOURCE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "templates",
  CAMERA_RUNTIME_FILE,
);

export type CameraMoveStyle =
  | "hold"
  | "drift"
  | "pan"
  | "whip"
  | "push-in"
  | "pull-back"
  | "track-to-anchor"
  | "parallax-pass"
  | "orbit-lite"
  | "orbit";

export const CAMERA_MOVES: ReadonlySet<CameraMoveStyle> = new Set<CameraMoveStyle>([
  "hold",
  "drift",
  "pan",
  "whip",
  "push-in",
  "pull-back",
  "track-to-anchor",
  "parallax-pass",
  "orbit-lite",
  "orbit",
]);

/** Moves that visibly re-frame the shot (everything except hold/drift). */
export const CAMERA_FULL_MOVES: ReadonlySet<CameraMoveStyle> = new Set<CameraMoveStyle>([
  "pan",
  "whip",
  "push-in",
  "pull-back",
  "track-to-anchor",
  "parallax-pass",
  "orbit-lite",
  "orbit",
]);

/** Orbit arc clamps: enough to read as an arc, never enough to lose the page. */
export const ORBIT_ARC_MIN_DEG = 8;
export const ORBIT_ARC_MAX_DEG = 35;
export const ORBIT_ARC_DEFAULT_DEG = 28;

/** Rack-focus blur ceiling; software rasterization pays per blurred pixel. */
export const FOCUS_BLUR_MAX_PX = 10;
export const FOCUS_BLUR_DEFAULT_PX = 6;

/**
 * Curated motion-graphics ease vocabulary registered by the camera runtime at
 * script load, usable by both the camera plan and authored GSAP beats.
 */
export const SEQUENCES_EASES = [
  "seqSwoosh", //     sharp symmetric in-out; high peak velocity, feathered ends
  "seqWhip", //       violent leave, feathered landing — the swoosh cut cousin
  "seqImpulse", //    velocity spike at t=0 with a long confident decay
  "seqSettle", //     committed acceleration into an overshoot-free hard arrival
  "seqGlide", //      eased but never fully stops (residual end velocity)
  "seqDrift", //      near-linear connective motion with softened ends
  "seqAnticipate", // small backward dip, then commit
  "seqMicrobounce", // ~3% single overshoot settle for UI beats (not cameras)
] as const;

const EASE_PATTERN = new RegExp(
  `^(?:${SEQUENCES_EASES.join("|")}|(?:power[1-4]|expo|sine|circ)\\.(?:in|out|inOut)|none|linear)$`,
);

/**
 * Rack-focus modifier on a camera segment. The runtime resolves a focal
 * depth (from a named part's enclosing depth layer, or an explicit 0..1
 * depth) and blurs every `data-depth`/`data-parallax` layer proportionally
 * to its distance from the tweened focal plane. Pure enhancement: a scene
 * with no depth layers, or an unresolvable part, compiles no filter tweens.
 */
export interface CameraFocusIntentV1 {
  /** data-part whose depth layer receives focus. */
  part?: string;
  /** Explicit focal depth 0..1 when no part is named (1 = the content plane). */
  depth?: number;
  /** Max blur for the farthest layer, px (clamped to FOCUS_BLUR_MAX_PX). */
  blurMaxPx: number;
}

/** One declared camera move inside a scene's path (times are absolute). */
export interface CameraMoveIntentV1 {
  version: 1;
  move: CameraMoveStyle;
  /** data-region framed by this move's end state. */
  toRegion?: string;
  /** data-part framed tightly instead of a region (track-to-anchor). */
  toPart?: string;
  /** Entry framing for the first move of a path only. */
  fromRegion?: string;
  fromPart?: string;
  /** Multiplier on the comfortable fit zoom for the target (1 = fit). */
  zoom?: number;
  /** orbit: total arc swept around the framed subject, degrees. */
  arcDeg?: number;
  /** Optional rack-focus pull attached to this move's window. */
  focus?: CameraFocusIntentV1;
  startSec: number;
  durationSec: number;
  ease?: string;
}

/** A scene's declared camera path. */
export interface SceneCameraIntentV1 {
  version: 1;
  path: CameraMoveIntentV1[];
  /**
   * Level-2 camera depth: data-depth layers separate in Z (translateZ under
   * preserve-3d) while an orbit arcs, instead of the flat world-plane
   * rotation. Opt-in per scene, meaningful only with an orbit move.
   */
  depth3d?: true;
}

/** A resolved, contiguous camera segment the runtime binds mechanically. */
export interface CameraSegmentV1 {
  move: CameraMoveStyle;
  startSec: number;
  endSec: number;
  /** Fraction of the way toward the target this segment travels (drift < 1). */
  blend: number;
  zoom: number;
  ease: string;
  toRegion?: string;
  toPart?: string;
  fromRegion?: string;
  fromPart?: string;
  /** orbit only: total arc swept, degrees. */
  arcDeg?: number;
  /** Rack-focus pull bound to this segment's window. */
  focus?: CameraFocusIntentV1;
}

export interface SceneCameraPlanV1 {
  sceneId: string;
  segments: CameraSegmentV1[];
  /** Layers separate in Z while an orbit arcs (level-2 depth, opt-in). */
  depth3d?: true;
}

export interface CameraPlanV1 {
  version: 1;
  scenes: SceneCameraPlanV1[];
}

interface MoveDefaults {
  ease: string;
  zoom: number;
  minSec: number;
  maxSec: number;
}

const MOVE_DEFAULTS: Record<CameraMoveStyle, MoveDefaults> = {
  hold: { ease: "none", zoom: 1, minSec: 0.2, maxSec: 15 },
  drift: { ease: "seqDrift", zoom: 1, minSec: 0.2, maxSec: 15 },
  // pan/track max is sized for COMPOUND windows (reframe + zoom merged into
  // one move), not just the raw reframe.
  pan: { ease: "seqSwoosh", zoom: 1, minSec: 0.4, maxSec: 6 },
  whip: { ease: "seqWhip", zoom: 1, minSec: 0.25, maxSec: 1.1 },
  "push-in": { ease: "seqSettle", zoom: 1.22, minSec: 0.5, maxSec: 6 },
  "pull-back": { ease: "seqSettle", zoom: 0.8, minSec: 0.5, maxSec: 6 },
  "track-to-anchor": { ease: "seqSwoosh", zoom: 1, minSec: 0.5, maxSec: 6 },
  "parallax-pass": { ease: "seqGlide", zoom: 1, minSec: 0.8, maxSec: 6 },
  "orbit-lite": { ease: "seqGlide", zoom: 1.06, minSec: 0.8, maxSec: 6 },
  orbit: { ease: "seqGlide", zoom: 1.06, minSec: 0.8, maxSec: 6 },
};

/**
 * Reframe verbs that merge with an immediately-following push-in/pull-back on
 * the same target into ONE compound move (travel + zoom simultaneously).
 * Whip is excluded: its violence depends on the short window, and a whip may
 * simply carry `zoom` itself.
 */
const COMPOUND_REFRAME_MOVES: ReadonlySet<CameraMoveStyle> = new Set<CameraMoveStyle>([
  "pan",
  "track-to-anchor",
  "parallax-pass",
]);
/** Max gap between a reframe and its zoom for the pair to read as one move. */
const COMPOUND_MERGE_GAP_SEC = 0.4;

/** How far a gap-filling drift travels toward the next framing. */
const DRIFT_BLEND = 0.24;
/** Gaps shorter than this merge into a neighbor instead of a drift fill. */
const FILL_EPSILON_SEC = 0.11;
/** Wind-up micro-segment carved out of the drift before a committed move. */
const ANTICIPATION_SEC = 0.22;
/** Minimum gap-fill length that can afford a wind-up split. */
const ANTICIPATION_MIN_GAP_SEC = 0.35;
/** Moves that earn an anticipation wind-up before they commit. */
const ANTICIPATION_MOVES: ReadonlySet<CameraMoveStyle> = new Set<CameraMoveStyle>([
  "whip",
  "push-in",
  "track-to-anchor",
]);

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.8;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function stableName(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^[a-z][a-z0-9-]{0,63}$/.test(raw) ? raw : "";
}

/**
 * Normalize a focus modifier. A focus that names neither a part nor a depth
 * cannot resolve a focal plane and degrades to no modifier. Key order is
 * stable (part, depth, blurMaxPx) because validation compares plans by
 * JSON.stringify.
 */
function normalizeFocus(value: unknown): CameraFocusIntentV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  const part = stableName(object.part);
  const depth = finite(object.depth) ? clamp(object.depth, 0, 1) : undefined;
  if (!part && depth === undefined) return undefined;
  return {
    ...(part ? { part } : {}),
    ...(depth !== undefined && !part ? { depth: round(depth) } : {}),
    blurMaxPx: finite(object.blurMaxPx)
      ? round(clamp(object.blurMaxPx, 1, FOCUS_BLUR_MAX_PX))
      : FOCUS_BLUR_DEFAULT_PX,
  };
}

/**
 * Normalize a storyboard scene's typed camera declaration. Unknown moves,
 * malformed timing, or a path with no resolvable framing degrade to no camera
 * plan rather than failing the storyboard — the film stays buildable.
 */
export function normalizeStoryboardCameraIntent(
  value: unknown,
  scene: { startSec: number; durationSec: number },
): SceneCameraIntentV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  if (!Array.isArray(object.path)) return undefined;
  const sceneEnd = scene.startSec + scene.durationSec;
  const path = object.path.flatMap((entry): CameraMoveIntentV1[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const move = typeof item.move === "string" ? item.move.trim() as CameraMoveStyle : "";
    if (!move || !CAMERA_MOVES.has(move)) return [];
    if (!finite(item.startSec) || !finite(item.durationSec)) return [];
    // Planner schemas ask for absolute composition time, but models commonly
    // emit a perfectly usable scene-relative offset for later shots. The old
    // clamp combined an absolute start with the unshifted relative end, which
    // collapsed every such move to zero duration and silently erased the whole
    // camera path. Recover unambiguous offsets inside the scene window.
    const rawStart = item.startSec;
    const candidateStart =
      scene.startSec > 0 &&
      rawStart >= 0 &&
      rawStart < scene.startSec &&
      rawStart <= scene.durationSec
        ? scene.startSec + rawStart
        : rawStart;
    const startSec = clamp(candidateStart, scene.startSec, sceneEnd);
    const endSec = clamp(candidateStart + item.durationSec, startSec, sceneEnd);
    if (endSec - startSec < 0.15) return [];
    const toRegion = stableName(item.toRegion);
    const toPart = stableName(item.toPart);
    const fromRegion = stableName(item.fromRegion);
    const fromPart = stableName(item.fromPart);
    if (move === "track-to-anchor" && !toPart) return [];
    const ease = typeof item.ease === "string" && EASE_PATTERN.test(item.ease.trim())
      ? item.ease.trim()
      : undefined;
    const focus = normalizeFocus(item.focus);
    return [{
      version: 1,
      move,
      startSec: round(startSec),
      durationSec: round(endSec - startSec),
      ...(toRegion ? { toRegion } : {}),
      ...(toPart ? { toPart } : {}),
      ...(fromRegion ? { fromRegion } : {}),
      ...(fromPart ? { fromPart } : {}),
      ...(finite(item.zoom) ? { zoom: clamp(item.zoom, ZOOM_MIN, ZOOM_MAX) } : {}),
      ...(move === "orbit" && finite(item.arcDeg)
        ? { arcDeg: round(clamp(item.arcDeg, ORBIT_ARC_MIN_DEG, ORBIT_ARC_MAX_DEG)) }
        : {}),
      ...(focus ? { focus } : {}),
      ...(ease ? { ease } : {}),
    }];
  }).sort((a, b) => a.startSec - b.startSec);
  if (!path.length) return undefined;
  // A path no move of which names a framing target cannot bind to the world.
  if (!path.some((move) => move.toRegion || move.toPart)) return undefined;
  const merged = mergeCompoundMoves(path);
  // depth3d is meaningful only while an orbit arcs; a volunteered flag on an
  // orbit-less path degrades silently rather than vetoing the plan.
  return {
    version: 1,
    path: merged,
    ...(object.depth3d === true && merged.some((move) => move.move === "orbit")
      ? { depth3d: true as const }
      : {}),
  };
}

/**
 * Planners routinely stage "pan to the region, then push in on it" as two
 * serial moves, which plays as travel → dead stop → zoom — the awkward-pause
 * tell. A reframe immediately followed by a push-in/pull-back on the SAME
 * target is one compound camera move (travel and zoom together, like an
 * operated camera), so merge the pair: the reframe verb and ease survive,
 * the zoom (and any focus modifier) comes from the zoom move, and the window
 * spans both declarations.
 */
function mergeCompoundMoves(path: CameraMoveIntentV1[]): CameraMoveIntentV1[] {
  const merged: CameraMoveIntentV1[] = [];
  for (const move of path) {
    const previous = merged[merged.length - 1];
    const previousTarget = previous ? (previous.toPart ?? previous.toRegion) : undefined;
    const moveTarget = move.toPart ?? move.toRegion;
    if (
      previous &&
      (move.move === "push-in" || move.move === "pull-back") &&
      COMPOUND_REFRAME_MOVES.has(previous.move) &&
      previousTarget &&
      // An untargeted zoom inherits the reframe's target — same subject.
      (!moveTarget || moveTarget === previousTarget) &&
      move.startSec - (previous.startSec + previous.durationSec) <= COMPOUND_MERGE_GAP_SEC
    ) {
      previous.durationSec = round(move.startSec + move.durationSec - previous.startSec);
      previous.zoom = move.zoom ?? MOVE_DEFAULTS[move.move].zoom;
      if (move.focus && !previous.focus) previous.focus = move.focus;
      continue;
    }
    merged.push({ ...move });
  }
  return merged;
}

interface TargetRef {
  toRegion?: string;
  toPart?: string;
}

function targetOf(intent: CameraMoveIntentV1): TargetRef | undefined {
  if (intent.toPart) return { toPart: intent.toPart };
  if (intent.toRegion) return { toRegion: intent.toRegion };
  return undefined;
}

/**
 * Resolve per-scene camera declarations into contiguous segment chains that
 * cover each declaring scene's full window. Untargeted hold/drift moves
 * inherit the neighboring framing; every timeline gap is filled with a
 * connective `drift` (toward the next framing, or a slow creep when there is
 * nowhere new to go) so the camera never silently freezes.
 */
export function resolveCameraPlan(scenes: DirectScene[]): CameraPlanV1 {
  const planScenes: SceneCameraPlanV1[] = [];
  for (const scene of scenes) {
    const intent = scene.camera;
    if (!intent?.path.length) continue;
    const sceneEnd = round(scene.startSec + scene.durationSec);
    // Forward-inherit targets for untargeted hold/drift, then backfill the
    // leading moves from the first explicit framing.
    const firstTargeted = intent.path.find((move) => targetOf(move));
    if (!firstTargeted) continue;
    let currentTarget: TargetRef = targetOf(firstTargeted)!;
    const targeted = intent.path.map((move) => {
      const target = targetOf(move) ?? currentTarget;
      currentTarget = target;
      return { move, target };
    });

    const segments: CameraSegmentV1[] = [];
    let cursor = round(scene.startSec);
    const pushFill = (endSec: number, target: TargetRef, blend: number): void => {
      segments.push({
        move: "drift",
        startSec: cursor,
        endSec: round(endSec),
        blend,
        zoom: 1,
        ease: MOVE_DEFAULTS.drift.ease,
        ...target,
      });
      cursor = round(endSec);
    };
    for (const entry of targeted) {
      const defaults = MOVE_DEFAULTS[entry.move.move];
      let startSec = Math.max(cursor, round(entry.move.startSec));
      const endSec = Math.min(
        sceneEnd,
        round(entry.move.startSec + clamp(entry.move.durationSec, defaults.minSec, defaults.maxSec)),
      );
      if (endSec - startSec < 0.15) continue;
      if (startSec - cursor > FILL_EPSILON_SEC) {
        const gap = startSec - cursor;
        if (ANTICIPATION_MOVES.has(entry.move.move) && gap >= ANTICIPATION_MIN_GAP_SEC) {
          // Split the connective fill: approach, then a short seqAnticipate
          // wind-up. The ease dips negative early, so the runtime lerps the
          // camera backward past its start before the move commits — a real
          // camera wind-up ahead of the whip/push.
          pushFill(startSec - ANTICIPATION_SEC, entry.target, DRIFT_BLEND);
          segments.push({
            move: "drift",
            startSec: cursor,
            endSec: round(startSec),
            blend: 0.06,
            zoom: 1,
            ease: "seqAnticipate",
            ...entry.target,
          });
          cursor = round(startSec);
        } else {
          // Approach the upcoming framing slowly, then let the move itself
          // accelerate — the "slow, still moving, then swoosh" connective.
          pushFill(startSec, entry.target, CAMERA_FULL_MOVES.has(entry.move.move) ? DRIFT_BLEND : 0);
        }
      } else {
        startSec = cursor;
      }
      const isFirst = segments.length === 0;
      segments.push({
        move: entry.move.move,
        startSec,
        endSec,
        blend: entry.move.move === "hold" || entry.move.move === "drift"
          ? (entry.move.move === "hold" ? 0 : DRIFT_BLEND)
          : 1,
        zoom: clamp(entry.move.zoom ?? defaults.zoom, ZOOM_MIN, ZOOM_MAX),
        ease: entry.move.ease ?? defaults.ease,
        ...entry.target,
        ...(isFirst && entry.move.fromRegion ? { fromRegion: entry.move.fromRegion } : {}),
        ...(isFirst && entry.move.fromPart ? { fromPart: entry.move.fromPart } : {}),
        ...(entry.move.move === "orbit"
          ? { arcDeg: entry.move.arcDeg ?? ORBIT_ARC_DEFAULT_DEG }
          : {}),
        ...(entry.move.focus ? { focus: entry.move.focus } : {}),
      });
      cursor = endSec;
    }
    if (!segments.length) continue;
    if (sceneEnd - cursor > FILL_EPSILON_SEC) {
      const last = segments[segments.length - 1]!;
      pushFill(sceneEnd, {
        ...(last.toRegion ? { toRegion: last.toRegion } : {}),
        ...(last.toPart ? { toPart: last.toPart } : {}),
      }, 0);
    } else if (cursor !== sceneEnd) {
      segments[segments.length - 1]!.endSec = sceneEnd;
    }
    planScenes.push({
      sceneId: scene.id,
      segments,
      ...(intent.depth3d && segments.some((segment) => segment.move === "orbit")
        ? { depth3d: true as const }
        : {}),
    });
  }
  return { version: 1, scenes: planScenes };
}

export function cameraRuntimeSource(): string {
  return fs.readFileSync(RUNTIME_SOURCE_PATH, "utf8");
}

/**
 * Inject the camera/ease runtime script tag after the host GSAP tag. Injected
 * into every composition (not only camera films) because the runtime registers
 * the Sequences ease library at load. Idempotent.
 */
export function injectCameraRuntimeTag(html: string): string {
  if (
    html.includes(`src="${CAMERA_RUNTIME_FILE}"`) ||
    html.includes(`src='${CAMERA_RUNTIME_FILE}'`)
  ) {
    return html;
  }
  return html.replace(
    /(<script\b[^>]*\bsrc\s*=\s*(["'])gsap\.min\.js\2[^>]*>\s*<\/script>)/i,
    `$1\n<script src="${CAMERA_RUNTIME_FILE}"></script>`,
  );
}

export function cameraRuntimeHash(): string {
  return createHash("sha256").update(cameraRuntimeSource()).digest("hex");
}

export interface CameraContractResult {
  plan?: CameraPlanV1;
  errors: string[];
  warnings: string[];
}

export function parseCameraPlan(html: string): { plan?: CameraPlanV1; errors: string[] } {
  const match = html.match(
    /<script\b[^>]*\bid\s*=\s*(["'])sequences-camera\1[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return { errors: [] };
  let value: unknown;
  try {
    value = JSON.parse(match[2]!.trim());
  } catch (error) {
    return {
      errors: [
        `sequences-camera JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { errors: ["sequences-camera must be an object"] };
  }
  const object = value as Record<string, unknown>;
  const errors: string[] = [];
  if (object.version !== 1) errors.push("sequences-camera.version must be 1");
  if (!Array.isArray(object.scenes)) {
    errors.push("sequences-camera.scenes must be an array");
    return { errors };
  }
  const sceneEntries = object.scenes.flatMap((entry, index): SceneCameraPlanV1[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`camera scene[${index}] must be an object`);
      return [];
    }
    const sceneObject = entry as Record<string, unknown>;
    const sceneId = typeof sceneObject.sceneId === "string" ? sceneObject.sceneId.trim() : "";
    if (!sceneId) errors.push(`camera scene[${index}] needs a sceneId`);
    if (!Array.isArray(sceneObject.segments) || !sceneObject.segments.length) {
      errors.push(`camera scene[${index}] needs segments`);
      return [];
    }
    const segments = sceneObject.segments.flatMap((raw, segmentIndex): CameraSegmentV1[] => {
      const label = `camera scene[${index}].segments[${segmentIndex}]`;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push(`${label} must be an object`);
        return [];
      }
      const segment = raw as Record<string, unknown>;
      const move = typeof segment.move === "string" ? segment.move as CameraMoveStyle : "hold";
      if (!CAMERA_MOVES.has(move)) errors.push(`${label} move "${String(segment.move)}" is unsupported`);
      if (
        !finite(segment.startSec) || !finite(segment.endSec) ||
        !finite(segment.blend) || !finite(segment.zoom)
      ) {
        errors.push(`${label} needs finite startSec/endSec/blend/zoom`);
      }
      const ease = typeof segment.ease === "string" ? segment.ease : "";
      if (!EASE_PATTERN.test(ease)) errors.push(`${label} ease "${ease}" is not a known ease`);
      if (errors.some((error) => error.startsWith(label))) return [];
      const toRegion = stableName(segment.toRegion);
      const toPart = stableName(segment.toPart);
      const fromRegion = stableName(segment.fromRegion);
      const fromPart = stableName(segment.fromPart);
      const focus = normalizeFocus(segment.focus);
      return [{
        move,
        startSec: segment.startSec as number,
        endSec: segment.endSec as number,
        blend: segment.blend as number,
        zoom: segment.zoom as number,
        ease,
        ...(toRegion ? { toRegion } : {}),
        ...(toPart ? { toPart } : {}),
        ...(fromRegion ? { fromRegion } : {}),
        ...(fromPart ? { fromPart } : {}),
        ...(move === "orbit" && finite(segment.arcDeg)
          ? { arcDeg: clamp(segment.arcDeg, ORBIT_ARC_MIN_DEG, ORBIT_ARC_MAX_DEG) }
          : {}),
        ...(focus ? { focus } : {}),
      }];
    });
    return sceneId && segments.length
      ? [{
          sceneId,
          segments,
          ...(sceneObject.depth3d === true ? { depth3d: true as const } : {}),
        }]
      : [];
  });
  return errors.length
    ? { errors }
    : { plan: { version: 1, scenes: sceneEntries }, errors: [] };
}

/**
 * Slice the document into per-scene scopes (data-scene tag through its close).
 * Shared by the camera and cut contracts: bindings that the runtimes resolve
 * scene-scoped must be validated scene-scoped, or a part that exists in the
 * WRONG scene passes static validation and detonates in browser QA.
 */
export function sceneScopes(html: string): Array<{ id: string; scope: string }> {
  const tags = [...html.matchAll(
    /<[a-z][\w:-]*\b[^>]*\bdata-scene\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi,
  )];
  return tags.map((tag, index) => {
    const tagName = tag[0].match(/^<([a-z][\w:-]*)\b/i)?.[1];
    const nextScene = tags[index + 1]?.index ?? html.length;
    let end = nextScene;
    if (tagName) {
      const close = new RegExp(`</${tagName}\\s*>`, "i")
        .exec(html.slice(tag.index + tag[0].length, nextScene));
      if (close?.index !== undefined) {
        end = tag.index + tag[0].length + close.index + close[0].length;
      }
    }
    return {
      id: (tag[1] ?? tag[2] ?? tag[3] ?? "").trim(),
      scope: html.slice(tag.index, end),
    };
  });
}

function attributePattern(attribute: string, value: string): RegExp {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${attribute}\\s*=\\s*(["'])${escaped}\\1`, "i");
}

/**
 * Static publication gate for the camera plan. Errors block publication (the
 * island exists but cannot bind); warnings flag probable double ownership of
 * the world plane so the repair pass can resolve it deliberately.
 */
export function validateCameraContract(
  html: string,
  scenes: DirectScene[],
): CameraContractResult {
  const parsed = parseCameraPlan(html);
  const errors = [...parsed.errors];
  const warnings: string[] = [];
  const expected = resolveCameraPlan(scenes);
  if (!parsed.plan && expected.scenes.length === 0) return { errors, warnings };
  if (!parsed.plan) {
    errors.push(
      "storyboard declares typed camera paths but index_html has no sequences-camera JSON island",
    );
    return { errors, warnings };
  }
  if (
    !html.includes(`src="${CAMERA_RUNTIME_FILE}"`) &&
    !html.includes(`src='${CAMERA_RUNTIME_FILE}'`)
  ) {
    errors.push(`camera composition must load local ${CAMERA_RUNTIME_FILE}`);
  }
  if (!/\bSequencesCamera\.compile\s*\(/.test(html)) {
    errors.push("camera composition must call SequencesCamera.compile(timeline, root)");
  }
  if (JSON.stringify(parsed.plan) !== JSON.stringify(expected)) {
    errors.push("sequences-camera island differs from the storyboard's resolved camera plan");
  }
  const scopes = new Map(sceneScopes(html).map((scene) => [scene.id, scene.scope]));
  for (const scenePlan of parsed.plan.scenes) {
    const scope = scopes.get(scenePlan.sceneId);
    if (!scope) {
      errors.push(`camera plan references unknown scene "${scenePlan.sceneId}"`);
      continue;
    }
    if (!/\bdata-camera-world\b/i.test(scope)) {
      errors.push(
        `scene "${scenePlan.sceneId}" declares a camera path but has no data-camera-world plane`,
      );
      continue;
    }
    for (const segment of scenePlan.segments) {
      for (const region of [segment.toRegion, segment.fromRegion]) {
        if (region && !attributePattern("data-region", region).test(scope)) {
          errors.push(
            `scene "${scenePlan.sceneId}" camera targets region "${region}" but no data-region="${region}" exists in that scene`,
          );
        }
      }
      for (const part of [segment.toPart, segment.fromPart, segment.focus?.part]) {
        if (part && !attributePattern("data-part", part).test(scope)) {
          errors.push(
            `scene "${scenePlan.sceneId}" camera targets part "${part}" but no data-part="${part}" exists in that scene`,
          );
        }
      }
    }
    // depth3d is enhancement-never-veto (no layers → the orbit stays flat),
    // but a planned 3D separation that compiles to nothing wastes the shot.
    if (scenePlan.depth3d && !/\bdata-(?:depth|parallax)\s*=/i.test(scope)) {
      warnings.push(
        `scene "${scenePlan.sceneId}" plans depth3d but has no data-depth/data-parallax layers, ` +
          `so the orbit stays flat — mark 2-4 depth planes with data-depth="0..1"`,
      );
    }
    // Focus is enhancement-never-veto (no layers → no filter tweens), but a
    // planned rack that silently does nothing wastes the shot; surface it.
    if (
      scenePlan.segments.some((segment) => segment.focus) &&
      !/\bdata-(?:depth|parallax)\s*=/i.test(scope)
    ) {
      warnings.push(
        `scene "${scenePlan.sceneId}" plans a rack-focus pull but has no data-depth/data-parallax ` +
          `layers, so the focus modifier compiles to nothing — mark the scene's depth planes with ` +
          `data-depth="0..1"`,
      );
    }
    // The camera rig owns the world plane's transform. An authored tween on
    // the same element is the classic two-owners bug; surface it rather than
    // letting the timelines fight.
    if (
      /\.(?:to|from|fromTo)\(\s*(["'])[^"']*\[data-camera-world\][^"']*\1/.test(html) ||
      /\.(?:to|from|fromTo)\(\s*(["'])[^"']*data-camera-world[^"']*\1/.test(html)
    ) {
      warnings.push(
        `scene "${scenePlan.sceneId}" has an authored tween on its data-camera-world plane while a ` +
          `typed camera path owns that transform; move that motion to elements inside a region`,
      );
    }
  }
  return { plan: parsed.plan, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

/** Zoom at or above which a push-in counts as a high-energy commitment. */
const HIGH_ENERGY_PUSH_ZOOM = 1.3;
const ENERGETIC_CUT_STYLES = new Set([
  "zoom-through",
  "inverse-zoom",
  "flash-white",
  "object-match",
  "shape-match",
]);

/**
 * Deterministic camera-energy audit, run at storyboard validation. Films read
 * as "too smooth, no action" when every reframe uses the same gentle verb —
 * these findings are blocking, precisely worded, and trivially fixable in one
 * findings-retry, which is how the storyboard prompt's energy-curve guidance
 * gets enforced rather than merely suggested.
 */
export function auditCameraEnergy(storyboard: DirectScene[]): string[] {
  const findings: string[] = [];
  const durationSec = storyboard.reduce(
    (end, scene) => Math.max(end, scene.startSec + scene.durationSec),
    0,
  );
  const fullMoves = storyboard.flatMap((scene) =>
    (scene.camera?.path ?? []).filter((move) => CAMERA_FULL_MOVES.has(move.move))
  );
  const hasHighEnergyMove = fullMoves.some((move) =>
    move.move === "whip" ||
    move.move === "orbit" ||
    // Any full move that commits to a hard zoom counts — including a compound
    // pan/track that zooms while it travels (the merged pan-then-push-in).
    (move.zoom ?? MOVE_DEFAULTS[move.move].zoom) >= HIGH_ENERGY_PUSH_ZOOM
  );
  const hasEnergeticCut = storyboard.some(
    (scene) => scene.cut && ENERGETIC_CUT_STYLES.has(scene.cut.style),
  );
  if (durationSec >= 12 && !hasHighEnergyMove && !hasEnergeticCut) {
    findings.push(
      `camera/energy: a ${durationSec.toFixed(0)}s film has no high-energy peak — no whip or orbit, ` +
        `no push-in with zoom >= ${HIGH_ENERGY_PUSH_ZOOM}, and no zoom-through/inverse-zoom/` +
        `flash-white/object-match/shape-match cut anywhere. Give the energy curve's peak scene one ` +
        `whip, an orbit, or a push-in with "zoom":1.35, or make one boundary an energetic cut style`,
    );
  }
  if (fullMoves.length >= 4) {
    const verbs = new Set(fullMoves.map((move) => move.move));
    if (verbs.size === 1) {
      findings.push(
        `camera/energy: all ${fullMoves.length} full camera moves use the same verb ` +
          `"${fullMoves[0]!.move}" — vary the vocabulary (pan for lateral reframes, whip or ` +
          `push-in at peaks, pull-back for reveals, track-to-anchor for detail landings) so ` +
          `peaks and valleys read differently`,
      );
    }
  }
  return findings;
}

/**
 * Windows (start, end) during which the camera is visibly re-framing the shot
 * (full moves only — hold/drift are gentle enough for layout heuristics).
 */
export function cameraMotionWindows(
  plan: CameraPlanV1 | undefined,
): Array<{ start: number; end: number }> {
  if (!plan) return [];
  return plan.scenes.flatMap((scene) =>
    scene.segments
      .filter((segment) => CAMERA_FULL_MOVES.has(segment.move))
      .map((segment) => ({
        start: segment.startSec - 0.05,
        end: segment.endSec + 0.05,
      }))
  );
}
