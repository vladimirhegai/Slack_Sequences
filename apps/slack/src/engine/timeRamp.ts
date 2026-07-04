/**
 * Typed, executable speed-ramping contract (time remapping).
 *
 * Premium motion uses time itself for emphasis: fast into a landing, slow
 * motion as the key metric resolves, snap back. This contract mirrors the cut
 * architecture: the planner declares one bounded `timeRamp` dip per scene, a
 * deterministic solver compiles it into strictly monotonic piecewise-linear
 * warp knots, and a host-owned runtime (`sequences-time.v1.js`) wraps the
 * registered timeline in a nested master whose single proxy tween seeks the
 * content timeline at `warp(masterTime)`.
 *
 * The two load-bearing invariants (do not relitigate):
 * - **Net-zero-per-scene**: `warp(t) = t` at every scene boundary, and exactly
 *   on `[sceneStart, rampStart]` / `[rampEnd, sceneEnd]` — cut exit/entry
 *   windows are pure identity regions, so `cutContract.ts` is a non-consumer.
 * - **Monotonic + invertible**: every knot slope is positive and bounded, so
 *   `warpInverse` exists and QA can convert between output (viewer) time and
 *   content (timeline) time exactly. Both Node QA and the browser runtime
 *   interpolate the SAME knot table (the island JSON) — the solver logic is
 *   never duplicated in JS.
 *
 * A declaration that cannot be solved inside its scene degrades to no ramp —
 * ramps are enhancements, never a veto.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCutPlan } from "./cutContract.ts";
import type { DirectScene } from "./directComposition.ts";

export const TIME_RUNTIME_VERSION = 1;
export const TIME_RUNTIME_FILE = "sequences-time.v1.js";

const RUNTIME_SOURCE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "templates",
  TIME_RUNTIME_FILE,
);

/** A scene's declaration of its one slow-motion dip. */
export interface SceneTimeRampIntentV1 {
  version: 1;
  /** Absolute composition seconds where the dip departs identity speed. */
  atSec: number;
  /** Dip playback rate, 0.2–0.6 (content seconds per viewer second). */
  slowTo: number;
  /** Slow-motion hold, 0.3–0.9 viewer seconds. */
  holdSec?: number;
  /** Catch-up window that repays the borrowed time, 0.3–1.2 viewer seconds. */
  recoverSec?: number;
}

/** A fully solved ramp the runtime can interpolate mechanically. */
export interface TimeRampIntentV1 {
  version: 1;
  sceneId: string;
  atSec: number;
  slowTo: number;
  holdSec: number;
  recoverSec: number;
  /**
   * Strictly monotonic piecewise-linear warp knots `[outputSec, contentSec]`,
   * identical at both endpoints (net-zero). Output (viewer/master) time is the
   * x axis; content (timeline) time is the y axis.
   */
  knots: Array<[number, number]>;
}

export interface TimeRampPlanV1 {
  version: 1;
  ramps: TimeRampIntentV1[];
}

/** Slope-corner blend duration; keeps the dip from reading as a stutter. */
const RAMP_BLEND_SEC = 0.18;
/** Sub-knots per blend corner (piecewise-linear approximation of the ease). */
const BLEND_STEPS = 4;
/** Catch-up faster than this reads as a glitch — stretch recovery or drop. */
export const MAX_CATCH_UP_SLOPE = 2.5;
/** Identity margin after the scene starts before a ramp may begin. */
const WINDOW_START_MARGIN_SEC = 0.3;
/** Identity margin before the scene's cut exit window (plus the exit itself). */
const WINDOW_END_MARGIN_SEC = 0.6;
/** Rhythm, not chaos: at most this many dips per film. */
export const MAX_RAMPS_PER_FILM = 2;

const SLOW_TO_MIN = 0.2;
const SLOW_TO_MAX = 0.6;
const HOLD_MIN = 0.3;
const HOLD_MAX = 0.9;
const RECOVER_MIN = 0.3;
const RECOVER_MAX = 1.2;
const HOLD_DEFAULT = 0.6;
const RECOVER_DEFAULT = 0.9;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Normalize a storyboard scene's typed ramp declaration. Junk values, missing
 * timing, or a rate outside the dip band degrade to no ramp rather than
 * failing the storyboard. Scene-relative atSec values (models often restart
 * timing at zero inside each scene) are re-based like storyboard moments.
 */
export function normalizeStoryboardTimeRamp(
  value: unknown,
  scene: { startSec: number; durationSec: number },
): SceneTimeRampIntentV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  if (!finite(object.atSec) || !finite(object.slowTo)) return undefined;
  const rawAtSec = object.atSec;
  const sceneEnd = scene.startSec + scene.durationSec;
  const atSec =
    scene.startSec > 0 &&
    rawAtSec >= 0 &&
    rawAtSec < scene.startSec &&
    rawAtSec <= scene.durationSec
      ? scene.startSec + rawAtSec
      : rawAtSec;
  if (atSec < scene.startSec - 0.01 || atSec > sceneEnd + 0.01) return undefined;
  return {
    version: 1,
    atSec: round4(atSec),
    slowTo: round4(clamp(object.slowTo, SLOW_TO_MIN, SLOW_TO_MAX)),
    ...(finite(object.holdSec)
      ? { holdSec: round4(clamp(object.holdSec, HOLD_MIN, HOLD_MAX)) }
      : {}),
    ...(finite(object.recoverSec)
      ? { recoverSec: round4(clamp(object.recoverSec, RECOVER_MIN, RECOVER_MAX)) }
      : {}),
  };
}

interface SlopePhase {
  durationSec: number;
  slopeStart: number;
  slopeEnd: number;
}

/**
 * The catch-up slope that makes the window net-zero: total content time over
 * the window equals total output time. Derived from the trapezoid areas of the
 * piecewise-linear slope profile (blend-in, hold, blend-up, catch-up,
 * blend-out).
 */
function solveCatchUp(
  blendSec: number,
  holdSec: number,
  recoverSec: number,
  slowTo: number,
): number {
  const window = blendSec * 3 + holdSec + recoverSec;
  const numerator = window -
    blendSec * (1 + slowTo) / 2 -
    holdSec * slowTo -
    blendSec * slowTo / 2 -
    blendSec / 2;
  return numerator / (blendSec / 2 + recoverSec + blendSec / 2);
}

/** The recovery duration at which the catch-up slope equals `target`. */
function recoverForCatchUp(
  blendSec: number,
  holdSec: number,
  slowTo: number,
  target: number,
): number {
  return (
    blendSec * (1 - slowTo) / 2 +
    holdSec * (1 - slowTo) +
    blendSec * (2 - slowTo - target) / 2 +
    blendSec * (1 - target) / 2
  ) / (target - 1);
}

/**
 * Integrate the slope profile into warp knots. Blend phases (linearly varying
 * slope) are densified into BLEND_STEPS sub-knots; the trapezoid rule is exact
 * on linear slopes, so the accumulated content time at the final knot equals
 * the output time analytically — the endpoint is then forced to exact
 * identity so floating point can never leak a net drift into the scene.
 */
function knotsFor(t0: number, phases: SlopePhase[]): Array<[number, number]> {
  const knots: Array<[number, number]> = [[t0, t0]];
  let output = t0;
  let content = t0;
  for (const phase of phases) {
    const steps = phase.slopeStart === phase.slopeEnd ? 1 : BLEND_STEPS;
    for (let step = 0; step < steps; step += 1) {
      const width = phase.durationSec / steps;
      const slopeA = phase.slopeStart + (phase.slopeEnd - phase.slopeStart) * (step / steps);
      const slopeB = phase.slopeStart + (phase.slopeEnd - phase.slopeStart) * ((step + 1) / steps);
      output += width;
      content += width * (slopeA + slopeB) / 2;
      knots.push([round4(output), round4(content)]);
    }
  }
  const last = knots[knots.length - 1]!;
  last[1] = last[0]; // exact net-zero at the window's end
  return knots;
}

/**
 * Resolve per-scene declarations into the concrete warp plan. Scene 1 never
 * ramps, at most MAX_RAMPS_PER_FILM dips survive (in scene order), the window
 * is clamped to `[sceneStart + 0.3, sceneEnd − exitSec − 0.6]` (exitSec from
 * the scene's resolved outgoing cut, so ramps never overlap cut windows), and
 * a catch-up steeper than MAX_CATCH_UP_SLOPE first stretches recovery within
 * bounds and then drops the ramp entirely.
 */
export function resolveTimeRampPlan(scenes: DirectScene[]): TimeRampPlanV1 {
  const ramps: TimeRampIntentV1[] = [];
  const exitByScene = new Map(
    resolveCutPlan(scenes).cuts.map((cut) => [cut.fromScene, cut.exitSec]),
  );
  for (const [index, scene] of scenes.entries()) {
    if (index === 0 || !scene.timeRamp) continue;
    if (ramps.length >= MAX_RAMPS_PER_FILM) break;
    const intent = scene.timeRamp;
    const slowTo = clamp(intent.slowTo, SLOW_TO_MIN, SLOW_TO_MAX);
    const holdSec = clamp(intent.holdSec ?? HOLD_DEFAULT, HOLD_MIN, HOLD_MAX);
    let recoverSec = clamp(intent.recoverSec ?? RECOVER_DEFAULT, RECOVER_MIN, RECOVER_MAX);
    const sceneEnd = scene.startSec + scene.durationSec;
    const windowStart = scene.startSec + WINDOW_START_MARGIN_SEC;
    const windowEnd = sceneEnd - (exitByScene.get(scene.id) ?? 0) - WINDOW_END_MARGIN_SEC;
    const t0 = round4(Math.max(intent.atSec, windowStart));
    const fixedSec = RAMP_BLEND_SEC * 3 + holdSec;
    // Fit the window: shrink recovery toward its floor before giving up.
    if (t0 + fixedSec + recoverSec > windowEnd) {
      recoverSec = windowEnd - t0 - fixedSec;
    }
    if (recoverSec < RECOVER_MIN) continue;
    let catchUp = solveCatchUp(RAMP_BLEND_SEC, holdSec, recoverSec, slowTo);
    if (catchUp > MAX_CATCH_UP_SLOPE) {
      // Stretch recovery within the scene's identity margins to soften the
      // snap-back; if the scene simply cannot repay the dip, drop the ramp.
      const needed = recoverForCatchUp(RAMP_BLEND_SEC, holdSec, slowTo, MAX_CATCH_UP_SLOPE);
      const available = windowEnd - t0 - fixedSec;
      if (needed > available + 1e-9) continue;
      recoverSec = Math.min(RECOVER_MAX, needed);
      catchUp = solveCatchUp(RAMP_BLEND_SEC, holdSec, recoverSec, slowTo);
      if (catchUp > MAX_CATCH_UP_SLOPE + 1e-9) continue;
    }
    if (catchUp <= 1) continue;
    recoverSec = round4(recoverSec);
    ramps.push({
      version: 1,
      sceneId: scene.id,
      atSec: t0,
      slowTo: round4(slowTo),
      holdSec: round4(holdSec),
      recoverSec,
      knots: knotsFor(t0, [
        { durationSec: RAMP_BLEND_SEC, slopeStart: 1, slopeEnd: slowTo },
        { durationSec: holdSec, slopeStart: slowTo, slopeEnd: slowTo },
        { durationSec: RAMP_BLEND_SEC, slopeStart: slowTo, slopeEnd: catchUp },
        { durationSec: recoverSec, slopeStart: catchUp, slopeEnd: catchUp },
        { durationSec: RAMP_BLEND_SEC, slopeStart: catchUp, slopeEnd: 1 },
      ]),
    });
  }
  return { version: 1, ramps };
}

function interpolate(
  knots: Array<[number, number]>,
  value: number,
  axis: 0 | 1,
): number | undefined {
  const other = axis === 0 ? 1 : 0;
  const first = knots[0]!;
  const last = knots[knots.length - 1]!;
  if (value <= first[axis] || value >= last[axis]) return undefined;
  for (let index = 1; index < knots.length; index += 1) {
    const b = knots[index]!;
    if (value <= b[axis]) {
      const a = knots[index - 1]!;
      const span = b[axis] - a[axis];
      const fraction = span > 0 ? (value - a[axis]) / span : 0;
      return a[other] + (b[other] - a[other]) * fraction;
    }
  }
  return undefined;
}

/** Output (viewer/master) time → content (timeline) time. Identity off-ramp. */
export function warpOf(plan: TimeRampPlanV1 | undefined): (outputSec: number) => number {
  const ramps = plan?.ramps ?? [];
  if (!ramps.length) return (outputSec) => outputSec;
  return (outputSec) => {
    for (const ramp of ramps) {
      const content = interpolate(ramp.knots, outputSec, 0);
      if (content !== undefined) return content;
    }
    return outputSec;
  };
}

/** Content (timeline) time → output (viewer/master) time. Identity off-ramp. */
export function warpInverseOf(
  plan: TimeRampPlanV1 | undefined,
): (contentSec: number) => number {
  const ramps = plan?.ramps ?? [];
  if (!ramps.length) return (contentSec) => contentSec;
  return (contentSec) => {
    for (const ramp of ramps) {
      const output = interpolate(ramp.knots, contentSec, 1);
      if (output !== undefined) return output;
    }
    return contentSec;
  };
}

/**
 * The slow-motion hold window of a solved ramp in both time bases. The plan
 * gate uses the content window to prove the dip is *motivated* (a declared
 * moment must land inside it).
 */
export function timeRampHoldWindow(ramp: TimeRampIntentV1): {
  outputStartSec: number;
  outputEndSec: number;
  contentStartSec: number;
  contentEndSec: number;
} {
  const outputStartSec = ramp.atSec + RAMP_BLEND_SEC;
  const outputEndSec = outputStartSec + ramp.holdSec;
  const warp = warpOf({ version: 1, ramps: [ramp] });
  return {
    outputStartSec: round4(outputStartSec),
    outputEndSec: round4(outputEndSec),
    contentStartSec: round4(warp(outputStartSec)),
    contentEndSec: round4(warp(outputEndSec)),
  };
}

export function timeRampRuntimeSource(): string {
  return fs.readFileSync(RUNTIME_SOURCE_PATH, "utf8");
}

export function timeRampRuntimeHash(): string {
  return createHash("sha256").update(timeRampRuntimeSource()).digest("hex");
}

export function parseTimeRampPlan(html: string): { plan?: TimeRampPlanV1; errors: string[] } {
  const match = html.match(
    /<script\b[^>]*\bid\s*=\s*(["'])sequences-time\1[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return { errors: [] };
  let value: unknown;
  try {
    value = JSON.parse(match[2]!.trim());
  } catch (error) {
    return {
      errors: [
        `sequences-time JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { errors: ["sequences-time must be an object"] };
  }
  const object = value as Record<string, unknown>;
  const errors: string[] = [];
  if (object.version !== 1) errors.push("sequences-time.version must be 1");
  if (!Array.isArray(object.ramps)) {
    errors.push("sequences-time.ramps must be an array");
    return { errors };
  }
  const ramps = object.ramps.flatMap((entry, index): TimeRampIntentV1[] => {
    const errorsBefore = errors.length;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`ramp[${index}] must be an object`);
      return [];
    }
    const ramp = entry as Record<string, unknown>;
    const sceneId = typeof ramp.sceneId === "string" ? ramp.sceneId.trim() : "";
    if (!sceneId) errors.push(`ramp[${index}] needs a sceneId`);
    if (
      !finite(ramp.atSec) || !finite(ramp.slowTo) ||
      !finite(ramp.holdSec) || !finite(ramp.recoverSec)
    ) {
      errors.push(`ramp[${index}] needs finite atSec/slowTo/holdSec/recoverSec`);
    }
    const knots = Array.isArray(ramp.knots)
      ? ramp.knots.filter((knot): knot is [number, number] =>
          Array.isArray(knot) && knot.length === 2 && finite(knot[0]) && finite(knot[1]))
      : [];
    if (!Array.isArray(ramp.knots) || knots.length !== ramp.knots.length || knots.length < 2) {
      errors.push(`ramp[${index}] needs at least two [outputSec, contentSec] knots`);
    }
    for (let knot = 1; knot < knots.length; knot += 1) {
      if (knots[knot]![0] <= knots[knot - 1]![0] || knots[knot]![1] <= knots[knot - 1]![1]) {
        errors.push(`ramp[${index}] knots must be strictly monotonic in both time bases`);
        break;
      }
    }
    // Compare counts, not prefixes (see parseCutPlan: `cut[1]` vs `cut[10]`).
    if (errors.length > errorsBefore) return [];
    return [{
      version: 1,
      sceneId,
      atSec: ramp.atSec as number,
      slowTo: ramp.slowTo as number,
      holdSec: ramp.holdSec as number,
      recoverSec: ramp.recoverSec as number,
      knots,
    }];
  });
  return errors.length ? { errors } : { plan: { version: 1, ramps }, errors: [] };
}

export interface TimeRampContractResult {
  plan?: TimeRampPlanV1;
  errors: string[];
  warnings: string[];
}

/**
 * Static publication gate for the warp plan: the island must equal the
 * resolved plan byte-for-byte, the runtime must be loaded, and the registered
 * timeline must be the wrapped master (`__seqWarped`) — a film whose island
 * promises a dip that the registration never applies would silently play at
 * flat speed while QA converted times for a warp that is not there.
 */
export function validateTimeRampContract(
  html: string,
  scenes: DirectScene[],
): TimeRampContractResult {
  const parsed = parseTimeRampPlan(html);
  const errors = [...parsed.errors];
  const warnings: string[] = [];
  const expected = resolveTimeRampPlan(scenes);
  if (!parsed.plan && expected.ramps.length === 0) return { errors, warnings };
  if (!parsed.plan) {
    errors.push("storyboard declares a timeRamp but index_html has no sequences-time JSON island");
    return { errors, warnings };
  }
  if (JSON.stringify(parsed.plan) !== JSON.stringify(expected)) {
    errors.push("sequences-time island differs from the storyboard's resolved time-ramp plan");
  }
  if (expected.ramps.length) {
    if (
      !html.includes(`src="${TIME_RUNTIME_FILE}"`) &&
      !html.includes(`src='${TIME_RUNTIME_FILE}'`)
    ) {
      errors.push(`time-ramped composition must load local ${TIME_RUNTIME_FILE}`);
    }
    if (!/\bSequencesTime\.wrap\s*\(/.test(html)) {
      errors.push("time-ramped composition must wrap its timeline via SequencesTime.wrap(tl)");
    }
    if (!/window\.__timelines\s*\[[^\]]+\]\s*=\s*__seqWarped\s*;/.test(html)) {
      errors.push(
        "time-ramped composition must register the wrapped master " +
          "(window.__timelines[id] = __seqWarped)",
      );
    }
  }
  return { plan: parsed.plan, errors: [...new Set(errors)], warnings };
}
