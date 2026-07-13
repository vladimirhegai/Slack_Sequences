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
import {
  directionScoreConsumersEnabled,
  directionSettleWindows,
  resolveFilmDirectionScore,
  type DirectionSettleWindowV1,
} from "./directionScore.ts";

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
  | "orbit"
  | "dive";

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
  "dive",
]);

/** Moves that visibly re-frame the shot (everything except hold/drift).
 * A `dive` counts as ONE full move against every budget even though it
 * reframes twice — that is its entire point: it replaces the three-segment
 * push-in→hold→pull-back choreography the planner reliably fumbles. */
export const CAMERA_FULL_MOVES: ReadonlySet<CameraMoveStyle> = new Set<CameraMoveStyle>([
  "pan",
  "whip",
  "push-in",
  "pull-back",
  "track-to-anchor",
  "parallax-pass",
  "orbit-lite",
  "orbit",
  "dive",
]);

/** Dive envelope bounds (MD5): the in/out legs and the minimum hold between. */
export const DIVE_LEG_MAX_SEC = 0.8;
export const DIVE_LEG_FRACTION = 0.25;
export const DIVE_MIN_HOLD_FRACTION = 0.2;
/**
 * Minimum in/out leg for a dive whose legs are NOT constrained tighter by a
 * beat landing right after the push-in (probe-audit-03 read harsh on short
 * dives). Raised from the quarter-window fallback so a short dive eases in/out
 * instead of snapping; capped by the fraction ceiling and the hold budget so it
 * never eats the held middle a tightly-timed dive derives.
 */
export const DIVE_LEG_MIN_SEC = 0.7;

/** The fallback leg length for a dive of this total duration, floored so short
 * dives don't snap (DIVE_LEG_MIN_SEC) but never past the fraction ceiling. */
export function diveLegCap(durationSec: number): number {
  return Math.max(DIVE_LEG_MIN_SEC, Math.min(DIVE_LEG_MAX_SEC, durationSec * DIVE_LEG_FRACTION));
}
export const DIVE_ZOOM_MIN = 1.0;
export const DIVE_ZOOM_MAX = 1.4;
export const DIVE_ZOOM_DEFAULT = 1.18;

/**
 * A dive's in/out leg durations. The host derives them at parse time from the
 * overlapping beat windows (`deriveDiveWindows`, an L2 normalizer) and stores
 * them on the move; absent values (code-built scenes, cached pre-derivation
 * plans) fall back to the symmetric 25%-of-window legs. Always clamped so at
 * least DIVE_MIN_HOLD_FRACTION of the window remains held.
 */
export function diveWindows(
  move: Pick<CameraMoveIntentV1, "durationSec" | "inSec" | "outSec">,
): { inSec: number; outSec: number } {
  const legCap = diveLegCap(move.durationSec);
  let inSec = finite(move.inSec) ? move.inSec : legCap;
  let outSec = finite(move.outSec) ? move.outSec : legCap;
  const maxLegs = move.durationSec * (1 - DIVE_MIN_HOLD_FRACTION);
  const total = inSec + outSec;
  if (total > maxLegs && total > 0) {
    const scale = maxLegs / total;
    inSec *= scale;
    outSec *= scale;
  }
  return { inSec: round(Math.max(0.15, inSec)), outSec: round(Math.max(0.15, outSec)) };
}

/** Orbit arc clamps: enough to read as an arc, never enough to lose the page. */
export const ORBIT_ARC_MIN_DEG = 8;
export const ORBIT_ARC_MAX_DEG = 35;
export const ORBIT_ARC_DEFAULT_DEG = 28;

/** Rack-focus blur ceiling; software rasterization pays per blurred pixel. */
export const FOCUS_BLUR_MAX_PX = 10;
export const FOCUS_BLUR_DEFAULT_PX = 6;

/**
 * Minimum destination dwell when a substantial final reframe would otherwise
 * land exactly on the scene cut. Kept below the moment binder's 0.45s look-back
 * so existing camera evidence remains bindable; the resolver fills the freed
 * tail with its gentle destination drift rather than a frozen frame.
 */
export const CAMERA_LANDING_RESERVE_SEC = 0.42;
const CAMERA_MIN_RETIMED_TRAVEL_SEC = 0.35;

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
  "seqPop", //        back-out ~10% overshoot, fast attack — typed compact-pop exception
  "seqStamp", //      arrive ~4% oversized and settle down — seals/badges landing
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
  /** dive: host-derived push-in leg, seconds (never model-authored). */
  inSec?: number;
  /** dive: host-derived pull-back leg, seconds (never model-authored). */
  outSec?: number;
  /** Optional rack-focus pull attached to this move's window. */
  focus?: CameraFocusIntentV1;
  /** Host-applied correction that must remain browser-auditable after zoom. */
  framingCorrection?: "camera-sparse-zoom";
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
  /** dive only: push-in / pull-back leg durations, seconds. */
  inSec?: number;
  outSec?: number;
  /** Rack-focus pull bound to this segment's window. */
  focus?: CameraFocusIntentV1;
  /** Host-applied correction that must remain browser-auditable after zoom. */
  framingCorrection?: "camera-sparse-zoom";
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
  // durationSec is the TOTAL dive window (in + hold + out), so it earns more
  // room than a single-leg move.
  dive: { ease: "seqSettle", zoom: DIVE_ZOOM_DEFAULT, minSec: 1.2, maxSec: 10 },
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
/**
 * Moves that earn an anticipation wind-up before they commit. A whip can
 * motivate a tiny reverse load; applying it to ordinary pushes and tracking
 * moves made the camera visibly change its mind before routine reframes.
 */
const ANTICIPATION_MOVES: ReadonlySet<CameraMoveStyle> = new Set<CameraMoveStyle>([
  "whip",
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
  fallbackTarget: { toPart?: string; toRegion?: string } = {},
): SceneCameraIntentV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  if (!Array.isArray(object.path)) return undefined;
  const sceneEnd = scene.startSec + scene.durationSec;
  const fallbackToPart = stableName(fallbackTarget.toPart);
  const fallbackToRegion = stableName(fallbackTarget.toRegion);
  const pathHasExplicitTarget = object.path.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const item = entry as Record<string, unknown>;
    return Boolean(stableName(item.toPart) || stableName(item.toRegion));
  });
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
    let toRegion = stableName(item.toRegion);
    let toPart = stableName(item.toPart);
    // A targetless route is still fully resolvable when the typed scene has one
    // declared focal surface. Preserve the authored move and bind it to that
    // host-validated part/region instead of dropping the whole path and later
    // manufacturing a neutral hold (ProofArc F scene-repair artifact).
    if (!pathHasExplicitTarget && !toRegion && !toPart) {
      toPart = fallbackToPart;
      toRegion = toPart ? "" : fallbackToRegion;
    }
    const fromRegion = stableName(item.fromRegion);
    const fromPart = stableName(item.fromPart);
    if (move === "track-to-anchor" && !toPart) return [];
    // A dive frames one product surface tightly; without a part to frame it
    // has no target to work inside — degrade to no move, never a veto.
    if (move === "dive" && !toPart) return [];
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
      ...(finite(item.zoom)
        ? {
            zoom: move === "dive"
              ? clamp(item.zoom, DIVE_ZOOM_MIN, DIVE_ZOOM_MAX)
              : clamp(item.zoom, ZOOM_MIN, ZOOM_MAX),
          }
        : {}),
      ...(move === "orbit" && finite(item.arcDeg)
        ? { arcDeg: round(clamp(item.arcDeg, ORBIT_ARC_MIN_DEG, ORBIT_ARC_MAX_DEG)) }
        : {}),
      // inSec/outSec are HOST-derived (deriveDiveWindows, an L2 normalizer) —
      // a model-authored value here is arithmetic the host owns; ignore it.
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
 * Canonicalize post-retime paths before the resolver turns them into segments.
 * Connective drift/hold is subordinate to decisive full moves: if a planner or
 * pacing retime leaves connective motion spanning a full move, trim it to the
 * nearest free interval (or drop a sub-150ms remnant). Also restore chronological
 * ordering after retimers mutate `startSec` in place. Probe 7 otherwise squeezed
 * a 2s parallax pass into 300ms because an earlier array entry had been delayed
 * past it, producing the film's largest jerk spike.
 */
export function normalizeConnectiveCameraSchedule(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  const scenes = storyboard.map((scene) => {
    const path = scene.camera?.path;
    if (!path?.length) return scene;
    const decorated = path.map((move, index) => ({ move, index }));
    const fullMoves = decorated
      .filter((entry) => CAMERA_FULL_MOVES.has(entry.move.move))
      .sort((a, b) => a.move.startSec - b.move.startSec || a.index - b.index);
    let trimmed = 0;
    let dropped = 0;
    const adjusted = decorated.flatMap(({ move, index }) => {
      if (move.move !== "drift" && move.move !== "hold") return [{ move, index }];
      let start = move.startSec;
      let end = move.startSec + move.durationSec;
      for (const full of fullMoves) {
        const fullStart = full.move.startSec;
        const fullEnd = full.move.startSec + full.move.durationSec;
        if (end <= fullStart + 1e-6 || start >= fullEnd - 1e-6) continue;
        if (start < fullStart - 1e-6) {
          end = fullStart;
          break;
        }
        start = fullEnd;
      }
      const durationSec = round(end - start);
      if (durationSec < 0.15) {
        dropped += 1;
        return [];
      }
      const changed = Math.abs(start - move.startSec) > 1e-6 ||
        Math.abs(durationSec - move.durationSec) > 1e-6;
      if (changed) trimmed += 1;
      return [{
        index,
        move: changed ? { ...move, startSec: round(start), durationSec } : move,
      }];
    });
    const ordered = adjusted.sort((a, b) =>
      a.move.startSec - b.move.startSec || a.index - b.index
    );
    const reordered = ordered.some((entry, index) => entry.index !== index);
    if (!trimmed && !dropped && !reordered) return scene;
    const note =
      `canonicalized camera schedule after retiming (` +
      `${trimmed} connective trim(s), ${dropped} sub-150ms drop(s), ` +
      `${reordered ? "chronological reorder" : "order already chronological"})`;
    normalized.push(`scene "${scene.id}": ${note}`);
    return {
      ...scene,
      camera: { ...scene.camera!, path: ordered.map((entry) => entry.move) },
      sentinelNormalizations: [...(scene.sentinelNormalizations ?? []), note],
    };
  });
  return { storyboard: scenes, normalized };
}

/**
 * A drift is a 24% connective blend, not a station transfer. If its explicit
 * target belongs to a different world station, the viewer can never reach the
 * requested component (MeterlyQC4's CTA remained fully off-frame). Promote
 * that exact cross-station case to a budgeted full move before camera-budget
 * normalization. Same-station part changes keep their subtle drift.
 */
export function upgradeCrossStationDrifts(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  const scenes = storyboard.map((scene) => {
    const path = scene.camera?.path;
    if (!path?.length) return scene;
    const stationForPart = (part: string | undefined): string | undefined =>
      part
        ? scene.components?.find((component) => component.id === part)?.region ?? `part:${part}`
        : undefined;
    const targetStation = (move: CameraMoveIntentV1): string | undefined =>
      move.toRegion ?? stationForPart(move.toPart);
    let currentStation = path[0]!.fromRegion ?? stationForPart(path[0]!.fromPart) ??
      targetStation(path[0]!);
    let upgraded = 0;
    const nextPath = path.map((move) => {
      const target = targetStation(move) ?? currentStation;
      const crossStation = Boolean(currentStation && target && currentStation !== target);
      const next = move.move === "drift" && crossStation
        ? {
            ...move,
            move: (move.toPart ? "track-to-anchor" : "pan") as CameraMoveStyle,
          }
        : move;
      if (next !== move) upgraded += 1;
      currentStation = target;
      return next;
    });
    if (!upgraded) return scene;
    const note =
      `promoted ${upgraded} cross-station drift(s) to full camera travel so the ` +
      `declared destination can enter frame`;
    normalized.push(`scene "${scene.id}": ${note}`);
    return {
      ...scene,
      camera: { ...scene.camera!, path: nextPath },
      sentinelNormalizations: [...(scene.sentinelNormalizations ?? []), note],
    };
  });
  return { storyboard: scenes, normalized };
}

const DESTINATION_ENTRANCE_BEATS = new Set([
  "type",
  "open",
  "rows",
  "morph",
  "swap",
]);

/**
 * Align an authored full move with the first visible content in its destination
 * station. A planner can correctly name a late cross-station CTA while placing
 * the move at scene start; the blocking director then returns to earlier
 * primary content and the CTA remains completely off-frame when it appears.
 * Delay only that mechanically certain shape: every component in the named
 * destination is entrance-gated, the move currently finishes at least 0.75s
 * before the first entrance, and the same move still fits inside its scene.
 */
export function alignCameraDestinationsWithLateEntrances(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  const scenes = storyboard.map((scene) => {
    const path = scene.camera?.path;
    if (!path?.length || !scene.components?.length || !scene.beats?.length) return scene;
    const sceneEnd = scene.startSec + scene.durationSec;
    let aligned = 0;
    const nextPath = path.map((move) => {
      if (!CAMERA_FULL_MOVES.has(move.move) || move.move === "dive") return move;
      const destinationComponents = move.toPart
        ? scene.components!.filter((component) => component.id === move.toPart)
        : move.toRegion
          ? scene.components!.filter((component) => component.region === move.toRegion)
          : [];
      if (!destinationComponents.length) return move;
      const destinationIds = new Set(destinationComponents.map((component) => component.id));
      const loadBearingDestination = destinationComponents.some((component) => component.role === "hero") ||
        (scene.moments ?? []).some((moment) =>
          moment.importance === "primary" &&
          moment.evidence?.kind === "component" &&
          [...destinationIds].some((id) => moment.evidence?.detail.includes(id))
        );
      // Ordinary supporting phrases do not own the lens. Camera blocking
      // reconciles an explicit full-move destination when it becomes primary;
      // moving the authored path itself for a supporting surface can create a
      // new conflict with the actual hero's readable hold (RouteBoard Probe 5).
      if (!loadBearingDestination) return move;
      const introductions = destinationComponents.map((component) =>
        scene.beats!
          .filter((beat) =>
            beat.component === component.id && DESTINATION_ENTRANCE_BEATS.has(beat.kind)
          )
          .sort((a, b) => a.atSec - b.atSec)[0]?.atSec
      );
      // If any destination surface is already authored visible at scene start,
      // the early establishing move is coherent and remains untouched.
      if (introductions.some((at) => at === undefined)) return move;
      const firstIntroduction = Math.min(...introductions as number[]);
      const currentEnd = move.startSec + move.durationSec;
      if (firstIntroduction - currentEnd < 0.75) return move;
      const desiredEnd = Math.min(
        sceneEnd - 0.25,
        firstIntroduction + Math.min(0.55, move.durationSec * 0.45),
      );
      const desiredStart = Math.max(scene.startSec, desiredEnd - move.durationSec);
      if (desiredStart <= move.startSec + 0.01) return move;
      aligned += 1;
      return { ...move, startSec: round(desiredStart) };
    });
    if (!aligned) return scene;
    const note =
      `aligned ${aligned} full camera destination(s) with their late component entrance so ` +
      `the addressed surface is on-frame when it becomes readable`;
    normalized.push(`scene "${scene.id}": ${note}`);
    return {
      ...scene,
      camera: { ...scene.camera!, path: nextPath },
      sentinelNormalizations: [...(scene.sentinelNormalizations ?? []), note],
    };
  });
  return { storyboard: scenes, normalized };
}

/**
 * Continuity camera blocking needs a transformable camera world even when the
 * planner delegates every route to the host and declares no authored move.
 * Add a neutral full-scene hold on the declared focal/first hero so the normal
 * camera contract injects the world plane, runtime, and compile call. Blocking
 * phrases still own every actual x/y/zoom route.
 */
export function ensureCameraBlockingChassis(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  const scenes = storyboard.map((scene) => {
    if (scene.camera?.path?.length || !(scene.components?.length || scene.moments?.length)) {
      return scene;
    }
    const target = scene.spatialIntent?.focalPart ??
      scene.components?.find((component) => component.role === "hero")?.id ??
      scene.components?.[0]?.id;
    if (!target) return scene;
    const note = `added a neutral camera chassis on "${target}" so host blocking owns the scene route`;
    normalized.push(`scene "${scene.id}": ${note}`);
    return {
      ...scene,
      camera: {
        version: 1 as const,
        path: [{
          version: 1 as const,
          move: "hold" as const,
          startSec: scene.startSec,
          durationSec: scene.durationSec,
          toPart: target,
          zoom: 1,
        }],
      },
      sentinelNormalizations: [...(scene.sentinelNormalizations ?? []), note],
    };
  });
  return { storyboard: scenes, normalized };
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
  const direction = resolveFilmDirectionScore(scenes);
  for (const scene of scenes) {
    const intent = scene.camera;
    if (!intent?.path.length) continue;
    const sceneEnd = round(scene.startSec + scene.durationSec);
    // Forward-inherit targets for untargeted hold/drift, then backfill the
    // leading moves from the first explicit framing.
    const firstTargeted = intent.path.find((move) => targetOf(move));
    if (!firstTargeted) continue;
    // A later first move names where the camera is GOING, not necessarily the
    // opening frame. Without an explicit from target the old resolver started
    // on that future destination, turning the lead-in drift and the move into
    // a no-op while the scene's promised focal could sit off-frame. The
    // storyboard already owns one deterministic entry anchor: spatialIntent's
    // focal part.
    const entryTarget: TargetRef | undefined = firstTargeted.fromPart
      ? { toPart: firstTargeted.fromPart }
      : firstTargeted.fromRegion
        ? { toRegion: firstTargeted.fromRegion }
        : firstTargeted.startSec > scene.startSec + FILL_EPSILON_SEC &&
            scene.spatialIntent?.focalPart
          ? { toPart: scene.spatialIntent.focalPart }
          : targetOf(firstTargeted);
    let currentTarget: TargetRef = targetOf(firstTargeted)!;
    const targeted = intent.path.map((move) => {
      const target = targetOf(move) ?? currentTarget;
      currentTarget = target;
      return { move, target };
    });

    const segments: CameraSegmentV1[] = [];
    const settleWindows = directionScoreConsumersEnabled()
      ? directionSettleWindows(direction, scene.id)
      : [];
    let cursor = round(scene.startSec);
    const pushFillSegment = (
      endSec: number,
      target: TargetRef,
      blend: number,
      move: "drift" | "hold" = "drift",
    ): void => {
      if (endSec - cursor <= FILL_EPSILON_SEC) return;
      const startsPlan = segments.length === 0;
      segments.push({
        move,
        startSec: cursor,
        endSec: round(endSec),
        blend: move === "hold" ? 0 : blend,
        zoom: 1,
        ease: move === "hold" ? MOVE_DEFAULTS.hold.ease : MOVE_DEFAULTS.drift.ease,
        ...target,
        ...(startsPlan && entryTarget?.toRegion ? { fromRegion: entryTarget.toRegion } : {}),
        ...(startsPlan && entryTarget?.toPart ? { fromPart: entryTarget.toPart } : {}),
      });
      cursor = round(endSec);
    };
    /**
     * Partition an automatic connective into drift and explicit holds from the
     * film direction score. Declared camera moves are untouched; only the
     * resolver-owned creep/approach yields while a payoff or cut landing reads.
     */
    const pushFill = (endSec: number, target: TargetRef, blend: number): void => {
      const fillStart = cursor;
      const holds = settleWindows
        .filter((window): window is DirectionSettleWindowV1 =>
          window.endSec > fillStart + FILL_EPSILON_SEC &&
          window.startSec < endSec - FILL_EPSILON_SEC
        )
        .map((window) => ({
          startSec: Math.max(fillStart, window.startSec),
          endSec: Math.min(endSec, window.endSec),
        }))
        .sort((a, b) => a.startSec - b.startSec);
      if (!holds.length) {
        pushFillSegment(endSec, target, blend);
        return;
      }
      const holdDuration = holds.reduce(
        (total, hold) => total + Math.max(0, hold.endSec - Math.max(cursor, hold.startSec)),
        0,
      );
      const movingDuration = Math.max(FILL_EPSILON_SEC, endSec - fillStart - holdDuration);
      for (const hold of holds) {
        if (hold.startSec > cursor + FILL_EPSILON_SEC) {
          const duration = hold.startSec - cursor;
          pushFillSegment(
            hold.startSec,
            target,
            blend > 0 ? blend * duration / movingDuration : 0,
          );
        }
        if (hold.endSec > cursor + FILL_EPSILON_SEC) {
          pushFillSegment(hold.endSec, target, 0, "hold");
        }
      }
      if (endSec > cursor + FILL_EPSILON_SEC) {
        const duration = endSec - cursor;
        pushFillSegment(
          endSec,
          target,
          blend > 0 ? blend * duration / movingDuration : 0,
        );
      }
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
      const legs = entry.move.move === "dive"
        ? diveWindows({ ...entry.move, durationSec: endSec - startSec })
        : undefined;
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
        ...(isFirst && entryTarget?.toRegion ? { fromRegion: entryTarget.toRegion } : {}),
        ...(isFirst && entryTarget?.toPart ? { fromPart: entryTarget.toPart } : {}),
        ...(entry.move.move === "orbit"
          ? { arcDeg: entry.move.arcDeg ?? ORBIT_ARC_DEFAULT_DEG }
          : {}),
        ...(legs ? { inSec: legs.inSec, outSec: legs.outSec } : {}),
        ...(entry.move.focus ? { focus: entry.move.focus } : {}),
        ...(entry.move.framingCorrection === "camera-sparse-zoom"
          ? { framingCorrection: "camera-sparse-zoom" as const }
          : {}),
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
        ...(move === "dive" && finite(segment.inSec) && finite(segment.outSec)
          ? { inSec: segment.inSec, outSec: segment.outSec }
          : {}),
        ...(focus ? { focus } : {}),
        ...(segment.framingCorrection === "camera-sparse-zoom"
          ? { framingCorrection: "camera-sparse-zoom" as const }
          : {}),
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
export const HIGH_ENERGY_PUSH_ZOOM = 1.3;

/** The effective zoom a move resolves to (declared, else its move-kind default). */
export function cameraMoveZoom(move: CameraMoveIntentV1): number {
  return move.zoom ?? MOVE_DEFAULTS[move.move].zoom;
}
/**
 * Verbs that are intrinsically a peak (WS6): repeating one of these on every
 * reframe is noise. A repeated push-in is NOT here — its energy depends on the
 * zoom, and a consistent gentle push reads as coherence, not churn.
 */
const HIGH_ENERGY_REPEAT_VERBS: ReadonlySet<CameraMoveStyle> = new Set<CameraMoveStyle>([
  "whip",
  "orbit",
]);
const ENERGETIC_CUT_STYLES = new Set([
  "zoom-through",
  "inverse-zoom",
  "flash-white",
  "object-match",
  "shape-match",
  // Canonical 3-transition names (MD1): a morph always bridges; match and
  // swipe are judged with their fields below (bridged / cover only).
  "morph",
]);

/** Whether a scene's cut counts as the film's energetic boundary (MD1-aware).
 * Local (not imported from cutContract) to avoid a module cycle — cutContract
 * already imports `sceneScopes` from this module. */
function energeticCut(cut: NonNullable<DirectScene["cut"]>): boolean {
  if (ENERGETIC_CUT_STYLES.has(cut.style)) return true;
  if (cut.style === "match") return Boolean(cut.focalPartOut && cut.focalPartIn);
  if (cut.style === "swipe") return cut.cover === true;
  return false;
}

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
    (scene) => scene.cut && energeticCut(scene.cut),
  );
  if (durationSec >= 12 && !hasHighEnergyMove && !hasEnergeticCut) {
    findings.push(
      `camera/energy: a ${durationSec.toFixed(0)}s film has no high-energy peak — no whip or orbit, ` +
        `no push-in with zoom >= ${HIGH_ENERGY_PUSH_ZOOM}, and no morph, bridged match, or ` +
        `cover swipe boundary anywhere. Give the energy curve's peak scene one ` +
        `whip, an orbit, or a push-in with "zoom":1.35, or make one boundary an energetic cut ` +
        `(a morph, a match carrying both focal parts, or a swipe with "cover":true)`,
    );
  }
  if (fullMoves.length >= 4) {
    const verbs = new Set(fullMoves.map((move) => move.move));
    // WS6: repeating a QUIET verb (pan/drift/track/pull-back) is coherence,
    // not a defect — a film that pans consistently reads calm and intentional.
    // Only a repeated HIGH-ENERGY verb is noise: four whips (or four orbits)
    // in a row spend the peak on every seam, so nothing reads as the peak.
    if (verbs.size === 1 && HIGH_ENERGY_REPEAT_VERBS.has(fullMoves[0]!.move)) {
      findings.push(
        `camera/energy: all ${fullMoves.length} full camera moves are "${fullMoves[0]!.move}" — ` +
          `a high-energy verb repeated every reframe reads as noise, not energy, because nothing ` +
          `stands out as the peak. Keep the ${fullMoves[0]!.move} for one or two real peaks and let ` +
          `pan/drift/track-to-anchor/pull-back carry the connective reframes`,
      );
    }
  }
  return findings;
}

/**
 * Zoom below `HIGH_ENERGY_PUSH_ZOOM` but committed enough that nudging it up to
 * the peak threshold is a normalization (the model already chose a mild zoom),
 * not an invention. The energy lift only touches a move already in this band.
 */
export const MILD_ENERGY_ZOOM_MIN = 1.15;

/** Full moves whose zoom carries their energy — the only kinds the lift bumps. */
const ZOOM_ENERGY_MOVES: ReadonlySet<CameraMoveStyle> = new Set<CameraMoveStyle>([
  "push-in",
  "pull-back",
  "dive",
]);

/**
 * Sentinel L2 normalize-before-retry: a 12s+ film with no high-energy peak is
 * the exact `camera/energy` shape `auditCameraEnergy` blocks. When the film
 * ALREADY commits to a mild zoom-in — a push-in/pull-back/dive whose effective
 * zoom sits in [MILD_ENERGY_ZOOM_MIN, HIGH_ENERGY_PUSH_ZOOM) — raise the single
 * largest such move to HIGH_ENERGY_PUSH_ZOOM so the film earns its required
 * peak. This DEGRADES a value the model already declared by a bounded amount
 * (the audit's OWN remediation advice is "a push-in with zoom:1.35"); it never
 * invents a move, a target, or a verb, and it adds no move, so the per-scene
 * camera budget and framing-density floor are untouched — a normalization (L2),
 * not a creative rewrite.
 *
 * It fires ONLY when there is also no energetic cut (matching
 * `auditCameraEnergy`'s own peak test), so it can never fight a film whose peak
 * already lives on a boundary, and only when a liftable candidate exists (a
 * peak-less film with only pans/drifts is a genuine energy deficit that stays a
 * model finding). It runs inside the parse-side atomic commit-or-revert, so if
 * the nudge somehow minted a finding the plan reverts to the model's artifact.
 */
export function liftCameraEnergyPeak(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  const durationSec = storyboard.reduce(
    (end, scene) => Math.max(end, scene.startSec + scene.durationSec),
    0,
  );
  if (durationSec < 12) return { storyboard, normalized };
  const fullMoves = storyboard.flatMap((scene) =>
    (scene.camera?.path ?? []).filter((move) => CAMERA_FULL_MOVES.has(move.move))
  );
  const hasHighEnergyMove = fullMoves.some(
    (move) =>
      move.move === "whip" || move.move === "orbit" || cameraMoveZoom(move) >= HIGH_ENERGY_PUSH_ZOOM,
  );
  const hasEnergeticCut = storyboard.some((scene) => scene.cut && energeticCut(scene.cut));
  if (hasHighEnergyMove || hasEnergeticCut) return { storyboard, normalized };

  // The liftable candidate with the largest effective zoom (closest to the
  // threshold — the smallest, least-visible nudge that reaches the peak).
  let best: { sceneIndex: number; moveIndex: number; zoom: number } | undefined;
  storyboard.forEach((scene, sceneIndex) => {
    (scene.camera?.path ?? []).forEach((move, moveIndex) => {
      if (!ZOOM_ENERGY_MOVES.has(move.move)) return;
      const zoom = cameraMoveZoom(move);
      if (zoom < MILD_ENERGY_ZOOM_MIN || zoom >= HIGH_ENERGY_PUSH_ZOOM) return;
      if (!best || zoom > best.zoom) best = { sceneIndex, moveIndex, zoom };
    });
  });
  if (!best) return { storyboard, normalized };
  const target = best;

  const scenes = storyboard.map((scene, sceneIndex) => {
    if (sceneIndex !== target.sceneIndex || !scene.camera) return scene;
    const move = scene.camera.path[target.moveIndex]!;
    const path = scene.camera.path.map((entry, moveIndex) =>
      moveIndex === target.moveIndex ? { ...entry, zoom: HIGH_ENERGY_PUSH_ZOOM } : entry,
    );
    const note =
      `lifted the ${move.move} zoom from ${target.zoom.toFixed(2)} to ${HIGH_ENERGY_PUSH_ZOOM} ` +
      `to give the ${durationSec.toFixed(0)}s film its required high-energy peak`;
    normalized.push(`scene "${scene.id}": ${note}`);
    return {
      ...scene,
      camera: { ...scene.camera, path },
      sentinelNormalizations: [...(scene.sentinelNormalizations ?? []), note],
    };
  });
  return { storyboard: scenes, normalized };
}

/**
 * Satisfy an explicit rack-focus brief from camera intent the planner already
 * supplied. A focus pull is a modifier, not a new action: when no move carries
 * one, attach it to the strongest existing non-whip move that can name a real
 * part (its own `toPart`, otherwise the scene focal). No move/part means the
 * request remains a genuine planner deficit. This runs inside the storyboard
 * normalizers' atomic commit/revert boundary.
 */
export function topUpRequiredRackFocus(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  if (storyboard.some((scene) => scene.camera?.path.some((move) => move.focus))) {
    return { storyboard, normalized };
  }
  const preferredMoves = new Set<CameraMoveStyle>([
    "track-to-anchor",
    "push-in",
    "pull-back",
    "parallax-pass",
    "orbit-lite",
    "orbit",
    "dive",
  ]);
  let best: {
    sceneIndex: number;
    moveIndex: number;
    part: string;
    score: number;
  } | undefined;
  storyboard.forEach((scene, sceneIndex) => {
    (scene.camera?.path ?? []).forEach((move, moveIndex) => {
      if (!CAMERA_FULL_MOVES.has(move.move) || move.move === "whip") return;
      const part = move.toPart ?? scene.spatialIntent?.focalPart;
      if (!part) return;
      const arrival = move.startSec + move.durationSec;
      const primaryNearArrival = (scene.moments ?? []).some((moment) =>
        moment.importance === "primary" && Math.abs(moment.atSec - arrival) <= 1,
      );
      const score = Number(Boolean(move.toPart)) * 6 +
        Number(preferredMoves.has(move.move)) * 3 +
        Number(primaryNearArrival) * 2 +
        sceneIndex / Math.max(1, storyboard.length);
      if (!best || score > best.score) best = { sceneIndex, moveIndex, part, score };
    });
  });
  if (!best) return { storyboard, normalized };
  const target = best;
  const scenes = storyboard.map((scene, sceneIndex) => {
    if (sceneIndex !== target.sceneIndex || !scene.camera) return scene;
    const selected = scene.camera.path[target.moveIndex]!;
    const path = scene.camera.path.map((move, moveIndex) =>
      moveIndex === target.moveIndex
        ? { ...move, focus: { part: target.part, blurMaxPx: 6 } }
        : move
    );
    const note =
      `attached the required rack-focus pull to the ${selected.move} landing on ` +
      `"${target.part}"`;
    normalized.push(`scene "${scene.id}": ${note}`);
    return {
      ...scene,
      camera: { ...scene.camera, path },
      sentinelNormalizations: [...(scene.sentinelNormalizations ?? []), note],
    };
  });
  return { storyboard: scenes, normalized };
}

/**
 * Let the audience actually see the destination of a final camera move.
 * Planner paths frequently spend the entire remaining scene travelling and
 * arrive on the cut, which makes a spatial journey read like blank connective
 * motion. Shorten only a substantial, non-dive final full move that ends on
 * the scene boundary; the camera resolver turns the reclaimed tail into its
 * normal low-amplitude destination drift. No cue, target, scene duration, or
 * ordering changes, and short impact moves remain untouched.
 */
export function reserveFinalCameraLanding(
  storyboard: DirectScene[],
): { storyboard: DirectScene[]; normalized: string[] } {
  const normalized: string[] = [];
  const scenes = storyboard.map((scene) => {
    if (!scene.camera?.path.length) return scene;
    const sceneEnd = scene.startSec + scene.durationSec;
    let candidateIndex = -1;
    let candidateEnd = -Infinity;
    scene.camera.path.forEach((move, index) => {
      if (!CAMERA_FULL_MOVES.has(move.move) || move.move === "dive") return;
      const end = move.startSec + move.durationSec;
      if (end > candidateEnd) {
        candidateIndex = index;
        candidateEnd = end;
      }
    });
    if (candidateIndex < 0 || Math.abs(candidateEnd - sceneEnd) > 0.03) return scene;
    const selected = scene.camera.path[candidateIndex]!;
    if (selected.durationSec < CAMERA_LANDING_RESERVE_SEC + CAMERA_MIN_RETIMED_TRAVEL_SEC) {
      return scene;
    }
    const durationSec = round(sceneEnd - CAMERA_LANDING_RESERVE_SEC - selected.startSec);
    if (durationSec < CAMERA_MIN_RETIMED_TRAVEL_SEC || durationSec >= selected.durationSec - 0.01) {
      return scene;
    }
    const path = scene.camera.path.map((move, index) =>
      index === candidateIndex ? { ...move, durationSec } : move
    );
    const target = selected.toPart ?? selected.toRegion ?? "declared framing";
    const note =
      `reserved ${CAMERA_LANDING_RESERVE_SEC.toFixed(2)}s of destination dwell after the ` +
      `${selected.move} landing on "${target}"`;
    normalized.push(`scene "${scene.id}": ${note}`);
    return {
      ...scene,
      camera: { ...scene.camera, path },
      sentinelNormalizations: [...new Set([...(scene.sentinelNormalizations ?? []), note])],
    };
  });
  return { storyboard: scenes, normalized };
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
      .flatMap((segment) => {
        // A dive's held middle is a stable framing — layout heuristics stay
        // live there; only the two legs are camera transit.
        if (segment.move === "dive") {
          const legs = diveWindows({
            durationSec: segment.endSec - segment.startSec,
            ...(segment.inSec !== undefined ? { inSec: segment.inSec } : {}),
            ...(segment.outSec !== undefined ? { outSec: segment.outSec } : {}),
          });
          return [
            { start: segment.startSec - 0.05, end: segment.startSec + legs.inSec + 0.05 },
            { start: segment.endSec - legs.outSec - 0.05, end: segment.endSec + 0.05 },
          ];
        }
        return [{
          start: segment.startSec - 0.05,
          end: segment.endSec + 0.05,
        }];
      })
  );
}
