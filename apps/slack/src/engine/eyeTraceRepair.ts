import type { DirectScene } from "./directComposition.ts";
import type { DirectBrowserQaResult } from "./layoutInspector.ts";
import {
  PING_PONG_MIN_GAP_SEC,
  PING_PONG_WINDOW_SEC,
} from "./eyeTrace.ts";
import { resolveComponentPlan, type ComponentBeatKind } from "./componentContract.ts";
import { EVIDENCE_AFTER_SEC, EVIDENCE_BEFORE_SEC } from "./storyboardMoments.ts";
import { resolveTimeRampPlan } from "./timeRamp.ts";
import { sourceTime, timeConversionService } from "./time.ts";

/** A tiny shift may turn two related arrivals into one intentional ensemble. */
const MAX_ENSEMBLE_SHIFT_SEC = 0.3;
/** Stay visibly below the audit's 250ms lower boundary, with seek headroom. */
const ENSEMBLE_VIEWER_GAP_SEC = PING_PONG_MIN_GAP_SEC - 0.05;
/** A separated repair may never push an authored beat more than this. */
const MAX_SEPARATION_SHIFT_SEC = 1.8;
/** Stay clearly beyond the audit boundary after viewer-time rounding. */
const SEPARATED_VIEWER_GAP_SEC = PING_PONG_WINDOW_SEC + 0.12;

const SAFE_RETIME_KINDS: ReadonlySet<ComponentBeatKind> = new Set([
  "type",
  "stream",
  "count",
  "progress",
  "chart",
  "rows",
  "highlight",
  "swap",
  "animate",
]);

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function boundMomentsStayBound(args: {
  scene: DirectScene;
  beforeStart: number;
  beforeEnd: number;
  afterStart: number;
  afterEnd: number;
}): boolean {
  const bound = (args.scene.moments ?? []).filter((moment) =>
    args.beforeEnd >= moment.atSec - EVIDENCE_BEFORE_SEC &&
    args.beforeStart <= moment.atSec + EVIDENCE_AFTER_SEC
  );
  return bound.every((moment) =>
    args.afterEnd >= moment.atSec - EVIDENCE_BEFORE_SEC &&
    args.afterStart <= moment.atSec + EVIDENCE_AFTER_SEC
  );
}

function beatOverlapsInteraction(
  scene: DirectScene,
  component: string,
  startSec: number,
  endSec: number,
): boolean {
  return (scene.interactions ?? []).some((intent) => {
    if (intent.targetPart !== component) return false;
    const interactionEnd = intent.holdUntilSec ?? intent.releaseSec ?? intent.pressSec ?? intent.arriveSec;
    return intent.startSec <= endSec + 0.05 && interactionEnd >= startSec - 0.05;
  });
}

function contentTimeForViewerGap(args: {
  start: number;
  limit: number;
  gapFrom: number;
  desiredGap: number;
  toViewer: (contentSec: number) => number;
  direction: "before" | "after";
}): number | undefined {
  // Time ramps are monotone. A 10ms bounded search is deterministic and avoids
  // assuming content seconds equal viewer seconds inside a slow-motion hold.
  const steps = Math.ceil(Math.abs(args.limit - args.start) / 0.01);
  for (let index = 0; index <= steps; index += 1) {
    const candidate = args.direction === "before"
      ? args.start + index * 0.01
      : args.start + index * 0.01;
    if (candidate > args.limit + 1e-9) break;
    const gap = args.direction === "before"
      ? args.toViewer(args.gapFrom) - args.toViewer(candidate)
      : args.toViewer(candidate) - args.toViewer(args.gapFrom);
    if (
      (args.direction === "before" && gap <= args.desiredGap + 1e-6) ||
      (args.direction === "after" && gap >= args.desiredGap - 1e-6)
    ) {
      return round(candidate);
    }
  }
  return undefined;
}

function withNote(scene: DirectScene, note: string): DirectScene {
  return {
    ...scene,
    sentinelNormalizations: [...(scene.sentinelNormalizations ?? []), note],
  };
}

export interface EyeTraceScheduleRepair {
  storyboard: DirectScene[];
  corrected: string[];
}

/**
 * L2-at-L4 repair for a measured within-scene gaze ping-pong.
 *
 * Prefer the smallest edit: delay the first beat by <=300ms so the two arrivals
 * read as one ensemble. If that is not binding-safe, separate the second beat
 * beyond the 1.2s gaze window, bounded to 1.8s. Interaction targets, stateful
 * beats, scene boundaries, and moment-evidence bindings are never moved. The
 * author loop re-runs browser QA and adopts only a strict penalty improvement,
 * so a newly exposed neighboring ping-pong rejects the candidate atomically.
 */
export function correctEyeTracePingPong(
  storyboard: DirectScene[],
  browserQa: DirectBrowserQaResult,
): EyeTraceScheduleRepair {
  const evidence = (browserQa.issues ?? [])
    .filter((issue) => issue.code === "eye_trace_pingpong" && issue.eyeTracePingPong)
    .map((issue) => issue.eyeTracePingPong!);
  if (!evidence.length) return { storyboard, corrected: [] };

  const resolvedByScene = new Map(
    resolveComponentPlan(storyboard).scenes.map((scene) => [
      scene.sceneId,
      new Map(scene.beats.map((beat) => [beat.id, beat])),
    ]),
  );
  const conversion = timeConversionService(resolveTimeRampPlan(storyboard));
  const toViewer = (value: number): number => conversion.toViewer(sourceTime(value));

  for (const finding of evidence) {
    const sceneIndex = storyboard.findIndex((scene) => scene.id === finding.sceneId);
    if (sceneIndex < 0) continue;
    const scene = storyboard[sceneIndex]!;
    const beats = scene.beats ?? [];
    const firstIndex = beats.findIndex((beat) => beat.id === finding.firstBeatId);
    const secondIndex = beats.findIndex((beat) => beat.id === finding.secondBeatId);
    if (firstIndex < 0 || secondIndex < 0) continue;
    const first = beats[firstIndex]!;
    const second = beats[secondIndex]!;
    const resolved = resolvedByScene.get(scene.id);
    const firstResolved = resolved?.get(first.id);
    const secondResolved = resolved?.get(second.id);
    if (!firstResolved || !secondResolved) continue;
    const sceneEnd = scene.startSec + scene.durationSec;

    // Aâ†’Bâ†’A inside one gaze window is the most literal ping-pong. When the
    // returning A beat is a state commit, land that commit immediately before
    // B instead of nudging A toward B and merely exposing the neighboring Bâ†’A
    // finding on the next browser pass (RouteBoardQC5: highlight list â†’ open
    // publish button â†’ resolve same list). This is a bounded reorder of an
    // existing state, with interaction and moment bindings preserved.
    const returningIndex = beats.findIndex((beat) =>
      beat.component === first.component &&
      beat.atSec > second.atSec &&
      beat.atSec - second.atSec <= PING_PONG_WINDOW_SEC + 1e-6
    );
    const returning = returningIndex >= 0 ? beats[returningIndex] : undefined;
    const returningResolved = returning ? resolved?.get(returning.id) : undefined;
    if (returning?.kind === "set-state" && returningResolved) {
      const target = round(Math.max(first.atSec + 0.05, second.atSec - 0.05));
      const duration = returningResolved.endSec - returningResolved.startSec;
      const afterEnd = target + duration;
      if (
        target < returning.atSec - 1e-6 &&
        afterEnd <= sceneEnd + 1e-6 &&
        !beatOverlapsInteraction(
          scene,
          returning.component,
          Math.min(target, returningResolved.startSec),
          Math.max(afterEnd, returningResolved.endSec),
        ) &&
        boundMomentsStayBound({
          scene,
          beforeStart: returningResolved.startSec,
          beforeEnd: returningResolved.endSec,
          afterStart: target,
          afterEnd,
        })
      ) {
        const nextBeats = beats.map((beat, index) =>
          index === returningIndex ? { ...beat, atSec: target } : beat
        ).sort((a, b) => a.atSec - b.atSec);
        const note =
          `moved returning state beat "${returning.id}" from ${returning.atSec.toFixed(2)}s to ` +
          `${target.toFixed(2)}s so ${first.component} resolves before attention hands to ` +
          `${second.component}, removing the measured A-B-A ping-pong`;
        const next = [...storyboard];
        next[sceneIndex] = withNote({ ...scene, beats: nextBeats }, note);
        return { storyboard: next, corrected: [`${scene.id}:${first.id}->${second.id}`] };
      }
    }

    if (
      SAFE_RETIME_KINDS.has(first.kind) &&
      !beatOverlapsInteraction(
        scene,
        first.component,
        firstResolved.startSec,
        firstResolved.endSec,
      )
    ) {
      const target = contentTimeForViewerGap({
        start: first.atSec,
        limit: Math.min(second.atSec - 0.01, first.atSec + MAX_ENSEMBLE_SHIFT_SEC),
        gapFrom: second.atSec,
        desiredGap: ENSEMBLE_VIEWER_GAP_SEC,
        toViewer,
        direction: "before",
      });
      if (target !== undefined && target > first.atSec + 1e-6) {
        const duration = firstResolved.endSec - firstResolved.startSec;
        const afterEnd = target + duration;
        const crossesSameComponentBeat = beats.some((beat, index) =>
          index !== firstIndex && beat.component === first.component &&
          beat.atSec > first.atSec && beat.atSec <= target
        );
        if (
          afterEnd <= sceneEnd + 1e-6 &&
          !crossesSameComponentBeat &&
          boundMomentsStayBound({
            scene,
            beforeStart: firstResolved.startSec,
            beforeEnd: firstResolved.endSec,
            afterStart: target,
            afterEnd,
          })
        ) {
          const nextBeats = [...beats];
          nextBeats[firstIndex] = { ...first, atSec: target };
          const note =
            `delayed beat "${first.id}" from ${first.atSec.toFixed(2)}s to ` +
            `${target.toFixed(2)}s so "${first.id}" + "${second.id}" land as one ` +
            `measured eye-trace ensemble instead of a ${Math.round(finding.displacementFraction * 100)}% diagonal ping-pong`;
          const next = [...storyboard];
          next[sceneIndex] = withNote({ ...scene, beats: nextBeats }, note);
          return { storyboard: next, corrected: [`${scene.id}:${first.id}->${second.id}`] };
        }
      }
    }

    if (
      SAFE_RETIME_KINDS.has(second.kind) &&
      !beatOverlapsInteraction(
        scene,
        second.component,
        secondResolved.startSec,
        secondResolved.endSec,
      )
    ) {
      const target = contentTimeForViewerGap({
        start: second.atSec,
        limit: Math.min(
          sceneEnd - (secondResolved.endSec - secondResolved.startSec),
          second.atSec + MAX_SEPARATION_SHIFT_SEC,
        ),
        gapFrom: first.atSec,
        desiredGap: SEPARATED_VIEWER_GAP_SEC,
        toViewer,
        direction: "after",
      });
      if (target !== undefined && target > second.atSec + 1e-6) {
        const duration = secondResolved.endSec - secondResolved.startSec;
        const afterEnd = target + duration;
        const crossesSameComponentBeat = beats.some((beat, index) =>
          index !== secondIndex && beat.component === second.component &&
          beat.atSec > second.atSec && beat.atSec <= target
        );
        if (
          !crossesSameComponentBeat &&
          boundMomentsStayBound({
            scene,
            beforeStart: secondResolved.startSec,
            beforeEnd: secondResolved.endSec,
            afterStart: target,
            afterEnd,
          })
        ) {
          const nextBeats = [...beats];
          nextBeats[secondIndex] = { ...second, atSec: target };
          const note =
            `delayed beat "${second.id}" from ${second.atSec.toFixed(2)}s to ` +
            `${target.toFixed(2)}s so the eye gets a readable handoff after "${first.id}" ` +
            `instead of a ${Math.round(finding.displacementFraction * 100)}% diagonal ping-pong`;
          const next = [...storyboard];
          next[sceneIndex] = withNote({ ...scene, beats: nextBeats }, note);
          return { storyboard: next, corrected: [`${scene.id}:${first.id}->${second.id}`] };
        }
      }
    }
  }

  return { storyboard, corrected: [] };
}
