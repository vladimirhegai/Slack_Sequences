import type { TimeRampPlanV1 } from "./timeRamp.ts";
import { warpInverseOf, warpOf } from "./timeRamp.ts";
import type { DirectScene } from "./directComposition.ts";

declare const sourceTimeBrand: unique symbol;
declare const viewerTimeBrand: unique symbol;
declare const durationBrand: unique symbol;
declare const sceneLocalTimeBrand: unique symbol;

/** Absolute seconds on the authored content timeline. */
export type SourceTime = number & { readonly [sourceTimeBrand]: "SourceTime" };
/** Absolute seconds experienced by the viewer after time remapping. */
export type ViewerTime = number & { readonly [viewerTimeBrand]: "ViewerTime" };
/** A non-negative span in seconds, independent of a time domain. */
export type Duration = number & { readonly [durationBrand]: "Duration" };
/** Seconds elapsed from the start of a scene on the source timeline. */
export type SceneLocalTime = number & { readonly [sceneLocalTimeBrand]: "SceneLocalTime" };

function finiteSeconds(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

function nonNegativeSeconds(value: number, label: string): number {
  finiteSeconds(value, label);
  if (value < 0) throw new RangeError(`${label} must be non-negative`);
  return value;
}

export const sourceTime = (seconds: number): SourceTime =>
  finiteSeconds(seconds, "SourceTime") as SourceTime;
export const viewerTime = (seconds: number): ViewerTime =>
  finiteSeconds(seconds, "ViewerTime") as ViewerTime;
export const duration = (seconds: number): Duration =>
  nonNegativeSeconds(seconds, "Duration") as Duration;
export const sceneLocalTime = (seconds: number): SceneLocalTime =>
  nonNegativeSeconds(seconds, "SceneLocalTime") as SceneLocalTime;

export function addSourceTime(time: SourceTime, span: Duration): SourceTime {
  return sourceTime(time + span);
}

export function subtractSourceTime(time: SourceTime, span: Duration): SourceTime {
  return sourceTime(time - span);
}

export function addViewerTime(time: ViewerTime, span: Duration): ViewerTime {
  return viewerTime(time + span);
}

export function subtractViewerTime(time: ViewerTime, span: Duration): ViewerTime {
  return viewerTime(time - span);
}

export function addSceneLocalTime(time: SceneLocalTime, span: Duration): SceneLocalTime {
  return sceneLocalTime(time + span);
}

export function subtractSceneLocalTime(time: SceneLocalTime, span: Duration): SceneLocalTime {
  return sceneLocalTime(time - span);
}

export function sourceDuration(from: SourceTime, to: SourceTime): Duration {
  return duration(to - from);
}

export function viewerDuration(from: ViewerTime, to: ViewerTime): Duration {
  return duration(to - from);
}

export function sourceFromSceneLocal(start: SourceTime, local: SceneLocalTime): SourceTime {
  return sourceTime(start + local);
}

export function sceneLocalFromSource(start: SourceTime, time: SourceTime): SceneLocalTime {
  return sceneLocalTime(time - start);
}

export interface TimeConversionService {
  toViewer(time: SourceTime): ViewerTime;
  toSource(time: ViewerTime): SourceTime;
}

export interface CascadeTimeMapping {
  readonly sceneId: string;
  readonly delta: Duration;
  readonly boundary: SourceTime;
  /** Translate an absolute time owned by a scene after the stretched scene. */
  shift(time: SourceTime): SourceTime;
}

export interface CascadeRetimeResult {
  plan: DirectScene[];
  mapping: CascadeTimeMapping;
}

function roundMillis(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function shiftSceneAbsoluteTimes(scene: DirectScene, delta: Duration): DirectScene {
  if (delta === 0) return scene;
  const shift = (value: number): number => roundMillis(value + delta);
  return {
    ...scene,
    startSec: shift(scene.startSec),
    ...(scene.displayType
      ? { displayType: { ...scene.displayType, atSec: shift(scene.displayType.atSec) } }
      : {}),
    ...(scene.timeRamp
      ? { timeRamp: { ...scene.timeRamp, atSec: shift(scene.timeRamp.atSec) } }
      : {}),
    ...(scene.gradeShift
      ? { gradeShift: { ...scene.gradeShift, atSec: shift(scene.gradeShift.atSec) } }
      : {}),
    ...(scene.camera
      ? {
          camera: {
            ...scene.camera,
            path: scene.camera.path.map((move) => ({
              ...move,
              startSec: shift(move.startSec),
            })),
          },
        }
      : {}),
    ...(scene.beats
      ? { beats: scene.beats.map((beat) => ({ ...beat, atSec: shift(beat.atSec) })) }
      : {}),
    ...(scene.interactions
      ? {
          interactions: scene.interactions.map((interaction) => ({
            ...interaction,
            startSec: shift(interaction.startSec),
            arriveSec: shift(interaction.arriveSec),
            ...(interaction.pressSec !== undefined
              ? { pressSec: shift(interaction.pressSec) }
              : {}),
            ...(interaction.releaseSec !== undefined
              ? { releaseSec: shift(interaction.releaseSec) }
              : {}),
            ...(interaction.holdUntilSec !== undefined
              ? { holdUntilSec: shift(interaction.holdUntilSec) }
              : {}),
          })),
        }
      : {}),
    ...(scene.moments
      ? {
          moments: scene.moments.map((moment) => ({
            ...moment,
            atSec: shift(moment.atSec),
            ...(moment.evidence
              ? {
                  evidence: {
                    ...moment.evidence,
                    startSec: shift(moment.evidence.startSec),
                    endSec: shift(moment.evidence.endSec),
                  },
                }
              : {}),
          })),
        }
      : {}),
  };
}

/**
 * Stretch one scene boundary and atomically translate every later absolute
 * timestamp. Cut declarations carry relative entry/exit durations, so they
 * intentionally survive unchanged; their resolved absolute `atSec` is
 * re-derived from the shifted scene boundary by `resolveCutPlan`.
 */
export function cascadeRetime(
  plan: readonly DirectScene[],
  sceneId: string,
  delta: Duration,
): CascadeRetimeResult {
  const index = plan.findIndex((scene) => scene.id === sceneId);
  if (index < 0) throw new RangeError(`cascade scene "${sceneId}" does not exist`);
  const target = plan[index]!;
  const boundary = sourceTime(target.startSec + target.durationSec);
  const mapping: CascadeTimeMapping = {
    sceneId,
    delta,
    boundary,
    shift: (time) => sourceTime(roundMillis(time + delta)),
  };
  if (delta === 0) return { plan: [...plan], mapping };
  return {
    mapping,
    plan: plan.map((scene, sceneIndex) => {
      if (sceneIndex < index) return scene;
      if (sceneIndex === index) {
        return { ...scene, durationSec: roundMillis(scene.durationSec + delta) };
      }
      return shiftSceneAbsoluteTimes(scene, delta);
    }),
  };
}

/**
 * Build the sole typed boundary between source and viewer time. The existing
 * ramp contract remains the numerical authority so introducing brands cannot
 * alter persisted plans or runtime output.
 */
export function timeConversionService(
  plan?: TimeRampPlanV1,
): TimeConversionService {
  const sourceOfViewer = warpOf(plan);
  const viewerOfSource = warpInverseOf(plan);
  return {
    toViewer: (time) => viewerTime(viewerOfSource(time)),
    toSource: (time) => sourceTime(sourceOfViewer(time)),
  };
}
