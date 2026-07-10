/**
 * Advisory continuous-playback evidence for direct compositions.
 *
 * Static layout samples and before/after moment pairs prove important states,
 * but they do not describe the route between them. This module samples the
 * already-compiled browser timeline, follows the direction score's attention
 * target, and derives normalized focal velocity/acceleration/jerk, reversals,
 * settle quality, visibility/occupancy, and simultaneous independent motion.
 * It emits evidence only: none of these measurements veto publication.
 */
import type { DirectScene } from "./directComposition.ts";
import {
  resolveFilmDirectionScore,
  type DirectionPhraseV1,
  type DirectionSettleWindowV1,
} from "./directionScore.ts";

const DEFAULT_SAMPLE_HZ = 5;
const DEFAULT_MAX_SAMPLES = 150;
const MOVING_SPEED = 0.008;
const SETTLED_SPEED = 0.018;
const REVERSAL_SPEED = 0.025;
const REVERSAL_COSINE = -0.35;
const JERK_MARKER = 4.5;
const TINY_OCCUPANCY = 0.025;
/** Makes apparent-size change comparable to normalized screen-space travel. */
const FOCAL_SCALE_WEIGHT = 0.25;

export interface ContinuousMotionGeometryV1 {
  found: boolean;
  visibleFraction: number;
  occupancyFraction: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface ContinuousMotionLocalStateV1 {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  width: number;
  height: number;
}

export interface ContinuousMotionRawSnapshotV1 {
  time: number;
  sceneId: string;
  phraseId?: string;
  attention?: { kind: "part" | "region" | "selector"; id: string };
  focal: ContinuousMotionGeometryV1;
  /** Scene/camera transforms are common motion voices, not N moving children. */
  layers: Record<string, ContinuousMotionLocalStateV1>;
  /** Top-level named subjects plus host FX roots, measured in local space. */
  subjects: Record<string, ContinuousMotionLocalStateV1>;
}

export interface ContinuousMotionSampleV1 {
  time: number;
  sceneId: string;
  phraseId?: string;
  attention?: { kind: "part" | "region" | "selector"; id: string };
  focal: ContinuousMotionGeometryV1 & {
    speed?: number;
    acceleration?: number;
    jerk?: number;
  };
  independentMotionCount: number;
}

export interface ContinuousMotionMarkerV1 {
  time: number;
  sceneId: string;
  phraseId?: string;
  value: number;
}

export interface ContinuousSettleEvidenceV1 {
  sceneId: string;
  phraseId: string;
  owner: string;
  startSec: number;
  endSec: number;
  measured: boolean;
  timeToSettleSec?: number;
  settledByWindowEnd: boolean;
  peakSpeed: number;
}

export interface ContinuousSceneSummaryV1 {
  sceneId: string;
  sampleCount: number;
  focalFoundSamples: number;
  minimumVisibleFraction: number;
  minimumOccupancyFraction: number;
  peakSpeed: number;
  peakAcceleration: number;
  maxIndependentMotionCount: number;
}

export interface ContinuousMotionEvidenceV1 {
  version: 1;
  advisory: true;
  sampleHz: number;
  frame: { width: number; height: number };
  samples: ContinuousMotionSampleV1[];
  reversals: ContinuousMotionMarkerV1[];
  jerkMarkers: ContinuousMotionMarkerV1[];
  settleWindows: ContinuousSettleEvidenceV1[];
  scenes: ContinuousSceneSummaryV1[];
  summary: {
    sampleCount: number;
    focalFoundSamples: number;
    minimumVisibleFraction: number;
    meanVisibleFraction: number;
    minimumOccupancyFraction: number;
    meanOccupancyFraction: number;
    offframeSamples: number;
    tinyFocalSamples: number;
    peakSpeed: number;
    peakAcceleration: number;
    peakJerk: number;
    reversalCount: number;
    jerkMarkerCount: number;
    maxIndependentMotionCount: number;
    meanIndependentMotionCount: number;
    settleWindowCount: number;
    measuredSettleWindowCount: number;
    settledByWindowEndCount: number;
  };
  advisories: string[];
}

interface Vector {
  x: number;
  y: number;
  z: number;
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * fraction))]!;
}

function sceneAt(scenes: DirectScene[], time: number): DirectScene | undefined {
  return scenes.find((scene, index) =>
    time >= scene.startSec - 0.001 &&
    (time < scene.startSec + scene.durationSec - 0.001 || index === scenes.length - 1)
  );
}

function phraseAt(
  phrases: DirectionPhraseV1[],
  time: number,
): DirectionPhraseV1 | undefined {
  return phrases.find((phrase, index) =>
    time >= phrase.startSec - 0.001 &&
    (time < phrase.endSec - 0.001 || index === phrases.length - 1)
  );
}

function evenlySample(values: number[], limit: number): number[] {
  if (limit <= 0 || values.length === 0) return [];
  if (values.length <= limit) return values;
  if (limit === 1) return [values[0]!];
  return Array.from({ length: limit }, (_, index) =>
    values[Math.round(index * (values.length - 1) / (limit - 1))]!
  );
}

/**
 * Uniform playback samples plus direction boundaries, capped absolutely.
 * Cue and settle boundaries outrank phrase edges, which outrank uniform
 * samples. Pathological plans with more important instants than the cap are
 * thinned deterministically across the film instead of silently exceeding the
 * browser-QA latency budget.
 */
export function continuousMotionSampleTimes(
  scenes: DirectScene[],
  durationSec: number,
  sampleHz = DEFAULT_SAMPLE_HZ,
  maxSamples = DEFAULT_MAX_SAMPLES,
): number[] {
  if (!(durationSec > 0) || !(sampleHz > 0) || maxSamples < 2) return [];
  const direction = resolveFilmDirectionScore(scenes);
  const highPriority = [
    0,
    durationSec,
    ...direction.scenes.flatMap((scene) => [
      ...scene.phrases.map((phrase) => phrase.cueSec),
      ...scene.settleWindows.flatMap((window) => [window.startSec, window.endSec]),
    ]),
  ];
  const mediumPriority = direction.scenes.flatMap((scene) =>
    scene.phrases.flatMap((phrase) => [phrase.startSec, phrase.endSec])
  );
  const normalize = (values: number[]): number[] => [...new Set(values
    .filter((time) => Number.isFinite(time) && time >= 0 && time <= durationSec)
    .map((time) => round(time, 3)))]
    .sort((a, b) => a - b);
  const high = normalize(highPriority);
  if (high.length >= maxSamples) return evenlySample(high, maxSamples);

  const kept = new Set(high);
  const addTier = (values: number[]): void => {
    const candidates = normalize(values).filter((time) => !kept.has(time));
    const slots = Math.max(0, maxSamples - kept.size);
    for (const time of evenlySample(candidates, slots)) kept.add(time);
  };
  addTier(mediumPriority);
  if (kept.size >= maxSamples) return [...kept].sort((a, b) => a - b);

  const uniform: number[] = [];
  const step = 1 / sampleHz;
  for (let time = 0; time < durationSec; time += step) uniform.push(time);
  uniform.push(durationSec);
  addTier(uniform);
  return [...kept].sort((a, b) => a - b);
}

function localVector(
  before: ContinuousMotionLocalStateV1,
  after: ContinuousMotionLocalStateV1,
  dt: number,
  diagonal: number,
): number[] {
  return [
    (after.x - before.x) / diagonal / dt,
    (after.y - before.y) / diagonal / dt,
    (after.scaleX - before.scaleX) / dt,
    (after.scaleY - before.scaleY) / dt,
    (after.opacity - before.opacity) * 0.18 / dt,
    (after.width - before.width) / diagonal / dt,
    (after.height - before.height) / diagonal / dt,
  ];
}

function magnitude(values: number[]): number {
  return Math.sqrt(values.reduce((total, value) => total + value * value, 0));
}

function independentMotionCount(
  before: ContinuousMotionRawSnapshotV1,
  after: ContinuousMotionRawSnapshotV1,
  dt: number,
  diagonal: number,
): number {
  if (before.sceneId !== after.sceneId || dt <= 0) return 0;
  const voices: number[][] = [];
  const addMoving = (
    earlier: Record<string, ContinuousMotionLocalStateV1>,
    later: Record<string, ContinuousMotionLocalStateV1>,
  ): void => {
    for (const id of Object.keys(later).sort()) {
      const a = earlier[id];
      const b = later[id];
      if (!a || !b) continue;
      const vector = localVector(a, b, dt, diagonal);
      if (magnitude(vector) >= MOVING_SPEED) voices.push(vector);
    }
  };
  addMoving(before.layers, after.layers);
  addMoving(before.subjects, after.subjects);
  const clusters: number[][] = [];
  for (const voice of voices) {
    const match = clusters.find((cluster) =>
      magnitude(cluster.map((value, index) => value - (voice[index] ?? 0))) < 0.035
    );
    if (!match) clusters.push(voice);
  }
  return clusters.length;
}

function minimum(values: number[]): number {
  return values.length ? Math.min(...values) : 0;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function settleEvidence(
  scoreWindows: Array<DirectionSettleWindowV1 & { sceneId: string }>,
  samples: ContinuousMotionSampleV1[],
): ContinuousSettleEvidenceV1[] {
  return scoreWindows.map((window) => {
    const candidates = samples.filter((sample) =>
      sample.sceneId === window.sceneId &&
      sample.phraseId === window.phraseId &&
      sample.time >= window.startSec - 0.001 &&
      sample.time <= window.endSec + 0.45
    );
    let settledAt: number | undefined;
    const measured = candidates.some((sample) => sample.focal.found);
    for (let index = 0; index < candidates.length; index += 1) {
      const run = candidates.slice(index, index + 2);
      if (
        run.length === 2 &&
        run.every((sample) => sample.focal.speed !== undefined && sample.focal.speed <= SETTLED_SPEED)
      ) {
        settledAt = run[0]!.time;
        break;
      }
    }
    return {
      sceneId: window.sceneId,
      phraseId: window.phraseId,
      owner: window.owner,
      startSec: window.startSec,
      endSec: window.endSec,
      measured,
      ...(settledAt === undefined
        ? {}
        : { timeToSettleSec: round(Math.max(0, settledAt - window.startSec), 3) }),
      settledByWindowEnd: measured && settledAt !== undefined && settledAt <= window.endSec + 0.001,
      peakSpeed: round(Math.max(0, ...candidates.map((sample) => sample.focal.speed ?? 0))),
    };
  });
}

/** Pure derivation used by browser QA, the temporal inspector, and unit tests. */
export function analyzeContinuousMotionSnapshots(
  scenes: DirectScene[],
  raw: ContinuousMotionRawSnapshotV1[],
  frame: { width: number; height: number },
  sampleHz = DEFAULT_SAMPLE_HZ,
): ContinuousMotionEvidenceV1 {
  const ordered = [...raw].sort((a, b) => a.time - b.time);
  const diagonal = Math.max(1, Math.hypot(frame.width, frame.height));
  const samples: ContinuousMotionSampleV1[] = ordered.map((snapshot) => ({
    time: round(snapshot.time, 3),
    sceneId: snapshot.sceneId,
    ...(snapshot.phraseId ? { phraseId: snapshot.phraseId } : {}),
    ...(snapshot.attention ? { attention: snapshot.attention } : {}),
    focal: { ...snapshot.focal },
    independentMotionCount: 0,
  }));
  const velocities: Array<Vector | undefined> = new Array(samples.length);
  const velocitySteps: Array<number | undefined> = new Array(samples.length);
  const accelerations: Array<Vector | undefined> = new Array(samples.length);
  const reversals: ContinuousMotionMarkerV1[] = [];
  const jerkMarkers: ContinuousMotionMarkerV1[] = [];

  for (let index = 1; index < samples.length; index += 1) {
    const before = ordered[index - 1]!;
    const after = ordered[index]!;
    const sample = samples[index]!;
    const dt = after.time - before.time;
    sample.independentMotionCount = independentMotionCount(before, after, dt, diagonal);
    const sameTarget = before.sceneId === after.sceneId &&
      before.attention?.kind === after.attention?.kind &&
      before.attention?.id === after.attention?.id;
    if (!(dt > 0) || !sameTarget || !before.focal.found || !after.focal.found) continue;
    const velocity = {
      x: (after.focal.centerX - before.focal.centerX) / diagonal / dt,
      y: (after.focal.centerY - before.focal.centerY) / diagonal / dt,
      // A centered push/pull has no center travel but is still camera motion.
      // Log apparent-size change is symmetric for zoom-in/out and independent
      // of the subject's authored dimensions.
      z: Math.log(
        Math.max(1e-6, Math.sqrt(after.focal.width * after.focal.height) / diagonal) /
          Math.max(1e-6, Math.sqrt(before.focal.width * before.focal.height) / diagonal),
      ) * FOCAL_SCALE_WEIGHT / dt,
    };
    velocities[index] = velocity;
    velocitySteps[index] = dt;
    sample.focal.speed = round(Math.hypot(velocity.x, velocity.y, velocity.z));
    const previousVelocity = velocities[index - 1];
    if (!previousVelocity) continue;
    // Exact cue/settle/cut boundaries can sit only 10ms apart. First and
    // second derivatives across those nonuniform micro-steps explode even for
    // smooth GSAP travel, so keep velocity evidence but require at least half
    // an ordinary sampling interval for acceleration/jerk.
    const minimumDerivativeStep = 0.5 / Math.max(1, sampleHz);
    if (
      dt < minimumDerivativeStep ||
      (velocitySteps[index - 1] ?? 0) < minimumDerivativeStep
    ) continue;
    const acceleration = {
      x: (velocity.x - previousVelocity.x) / dt,
      y: (velocity.y - previousVelocity.y) / dt,
      z: (velocity.z - previousVelocity.z) / dt,
    };
    accelerations[index] = acceleration;
    sample.focal.acceleration = round(Math.hypot(acceleration.x, acceleration.y, acceleration.z));
    const previousSpeed = Math.hypot(previousVelocity.x, previousVelocity.y, previousVelocity.z);
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    const cosine = (
      previousVelocity.x * velocity.x +
      previousVelocity.y * velocity.y +
      previousVelocity.z * velocity.z
    ) /
      Math.max(1e-9, previousSpeed * speed);
    if (previousSpeed >= REVERSAL_SPEED && speed >= REVERSAL_SPEED && cosine <= REVERSAL_COSINE) {
      reversals.push({
        time: sample.time,
        sceneId: sample.sceneId,
        ...(sample.phraseId ? { phraseId: sample.phraseId } : {}),
        value: round(cosine),
      });
    }
    const previousAcceleration = accelerations[index - 1];
    if (!previousAcceleration) continue;
    const jerk = Math.hypot(
      acceleration.x - previousAcceleration.x,
      acceleration.y - previousAcceleration.y,
      acceleration.z - previousAcceleration.z,
    ) / dt;
    sample.focal.jerk = round(jerk);
    if (jerk >= JERK_MARKER) {
      jerkMarkers.push({
        time: sample.time,
        sceneId: sample.sceneId,
        ...(sample.phraseId ? { phraseId: sample.phraseId } : {}),
        value: round(jerk),
      });
    }
  }

  const score = resolveFilmDirectionScore(scenes);
  const settleWindows = settleEvidence(
    score.scenes.flatMap((scene) => scene.settleWindows.map((window) => ({
      ...window,
      sceneId: scene.sceneId,
    }))),
    samples,
  );
  const found = samples.filter((sample) => sample.focal.found);
  const visible = found.map((sample) => sample.focal.visibleFraction);
  const occupancy = found.map((sample) => sample.focal.occupancyFraction);
  const speeds = samples.map((sample) => sample.focal.speed ?? 0);
  const accelerationsValues = samples.map((sample) => sample.focal.acceleration ?? 0);
  const jerks = samples.map((sample) => sample.focal.jerk ?? 0);
  const motionCounts = samples.map((sample) => sample.independentMotionCount);
  const sceneSummaries = scenes.map((scene): ContinuousSceneSummaryV1 => {
    const scoped = samples.filter((sample) => sample.sceneId === scene.id);
    const scopedFound = scoped.filter((sample) => sample.focal.found);
    return {
      sceneId: scene.id,
      sampleCount: scoped.length,
      focalFoundSamples: scopedFound.length,
      minimumVisibleFraction: round(minimum(scopedFound.map((sample) => sample.focal.visibleFraction))),
      minimumOccupancyFraction: round(minimum(scopedFound.map((sample) => sample.focal.occupancyFraction))),
      peakSpeed: round(Math.max(0, ...scoped.map((sample) => sample.focal.speed ?? 0))),
      peakAcceleration: round(Math.max(0, ...scoped.map((sample) => sample.focal.acceleration ?? 0))),
      maxIndependentMotionCount: Math.max(0, ...scoped.map((sample) => sample.independentMotionCount)),
    };
  });
  const summary = {
    sampleCount: samples.length,
    focalFoundSamples: found.length,
    minimumVisibleFraction: round(minimum(visible)),
    meanVisibleFraction: round(average(visible)),
    minimumOccupancyFraction: round(minimum(occupancy)),
    meanOccupancyFraction: round(average(occupancy)),
    offframeSamples: found.filter((sample) => sample.focal.visibleFraction < 0.85).length,
    tinyFocalSamples: found.filter((sample) => sample.focal.occupancyFraction < TINY_OCCUPANCY).length,
    peakSpeed: round(Math.max(0, ...speeds)),
    peakAcceleration: round(Math.max(0, ...accelerationsValues)),
    peakJerk: round(Math.max(0, ...jerks)),
    reversalCount: reversals.length,
    jerkMarkerCount: jerkMarkers.length,
    maxIndependentMotionCount: Math.max(0, ...motionCounts),
    meanIndependentMotionCount: round(average(motionCounts)),
    settleWindowCount: settleWindows.length,
    measuredSettleWindowCount: settleWindows.filter((window) => window.measured).length,
    settledByWindowEndCount: settleWindows.filter((window) => window.settledByWindowEnd).length,
  };
  const advisories: string[] = [];
  if (summary.offframeSamples > 0) {
    advisories.push(`${summary.offframeSamples} focal sample(s) were less than 85% visible`);
  }
  if (summary.tinyFocalSamples > 0) {
    advisories.push(`${summary.tinyFocalSamples} focal sample(s) occupied less than 2.5% of frame`);
  }
  const missedSettle = settleWindows.filter((window) =>
    window.measured && !window.settledByWindowEnd
  ).length;
  if (missedSettle > 0) advisories.push(`${missedSettle} directed settle window(s) did not settle on time`);
  if (summary.maxIndependentMotionCount >= 3) {
    advisories.push(`up to ${summary.maxIndependentMotionCount} independent motion voices overlapped`);
  }
  if (reversals.length) advisories.push(`${reversals.length} focal direction reversal(s) need review`);
  if (jerkMarkers.length) {
    advisories.push(`${jerkMarkers.length} high-jerk focal sample(s) need review`);
  }
  // Keep p95 calculations exercised and available for future threshold work
  // without treating a single seek-boundary spike as the typical profile.
  const p95Acceleration = percentile(accelerationsValues, 0.95);
  if (p95Acceleration > 1.5) {
    advisories.push(`95th-percentile focal acceleration was ${round(p95Acceleration)} frame-diagonals/s²`);
  }
  return {
    version: 1,
    advisory: true,
    sampleHz,
    frame,
    samples,
    reversals,
    jerkMarkers,
    settleWindows,
    scenes: sceneSummaries,
    summary,
    advisories,
  };
}

export function continuousMotionAttentionAt(
  scenes: DirectScene[],
  score: ReturnType<typeof resolveFilmDirectionScore>,
  time: number,
): {
  scene: DirectScene;
  phrase?: DirectionPhraseV1;
  attention?: { kind: "part" | "region" | "selector"; id: string };
} | undefined {
  const scene = sceneAt(scenes, time);
  if (!scene) return undefined;
  const scoreScene = score.scenes.find((entry) => entry.sceneId === scene.id);
  const phrase = phraseAt(scoreScene?.phrases ?? [], time);
  const attention = phrase?.attention?.part
    ? { kind: "part" as const, id: phrase.attention.part }
    : phrase?.attention?.region
      ? { kind: "region" as const, id: phrase.attention.region }
      : phrase?.attention?.selector
        ? { kind: "selector" as const, id: phrase.attention.selector }
        : scene.spatialIntent?.focalPart
          ? { kind: "part" as const, id: scene.spatialIntent.focalPart }
          : undefined;
  return { scene, ...(phrase ? { phrase } : {}), ...(attention ? { attention } : {}) };
}

/** Capture and derive evidence against an already-open, compiled composition. */
export async function captureContinuousMotionEvidence(
  page: import("puppeteer-core").Page,
  scenes: DirectScene[],
  durationSec: number,
  frame: { width: number; height: number },
  options: {
    sampleHz?: number;
    maxSamples?: number;
    /** Converts content time to the registered timeline's physical time. */
    mapSeekTime?: (time: number) => number;
  } = {},
): Promise<ContinuousMotionEvidenceV1> {
  // tsx/esbuild annotates nested functions inside page.evaluate with __name;
  // browser execution contexts do not define that build helper by default.
  await page.addScriptTag({ content: "globalThis.__name ||= (target) => target;" });
  const sampleHz = options.sampleHz ?? DEFAULT_SAMPLE_HZ;
  const times = continuousMotionSampleTimes(
    scenes,
    durationSec,
    sampleHz,
    options.maxSamples ?? DEFAULT_MAX_SAMPLES,
  );
  const score = resolveFilmDirectionScore(scenes);
  const raw: ContinuousMotionRawSnapshotV1[] = [];
  for (const time of times) {
    const directed = continuousMotionAttentionAt(scenes, score, time);
    if (!directed) continue;
    const snapshot = await page.evaluate(
      (payload: {
        time: number;
        seekTime: number;
        sceneId: string;
        phraseId?: string;
        attention?: { kind: "part" | "region" | "selector"; id: string };
      }) => {
        type Local = ContinuousMotionLocalStateV1;
        // GSAP seek is synchronous. Measure in the same browser turn so this
        // advisory series does not pay the ordinary QA seek's two-RAF/settle
        // delay for every sample (which multiplied browser-suite runtime).
        const timelines = (window as unknown as {
          __timelines?: Record<string, {
            pause?: () => void;
            seek?: (time: number, suppressEvents?: boolean) => void;
          }>;
        }).__timelines ?? {};
        for (const timeline of Object.values(timelines)) {
          timeline.pause?.();
          timeline.seek?.(payload.seekTime, false);
        }
        const root = document.querySelector<HTMLElement>(
          "[data-composition-id][data-width][data-height]",
        );
        const scene: HTMLElement | undefined = root
          ? (Array.from(root.querySelectorAll("[data-scene]")) as HTMLElement[])
            .find((element: HTMLElement) => element.getAttribute("data-scene") === payload.sceneId)
          : undefined;
        const rootRect = root?.getBoundingClientRect();
        const localState = (element: HTMLElement): Local => {
          const style = getComputedStyle(element);
          const transform = style.transform;
          const values = transform === "none"
            ? []
            : transform.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
          const is3d = transform.startsWith("matrix3d");
          const a = is3d ? values[0] ?? 1 : values[0] ?? 1;
          const b = is3d ? values[1] ?? 0 : values[1] ?? 0;
          const c = is3d ? values[4] ?? 0 : values[2] ?? 0;
          const d = is3d ? values[5] ?? 1 : values[3] ?? 1;
          return {
            x: is3d ? values[12] ?? 0 : values[4] ?? 0,
            y: is3d ? values[13] ?? 0 : values[5] ?? 0,
            scaleX: Math.hypot(a, b),
            scaleY: Math.hypot(c, d),
            opacity: Number.parseFloat(style.opacity) || 0,
            width: element.offsetWidth,
            height: element.offsetHeight,
          };
        };
        const effectiveOpacity = (element: HTMLElement): number => {
          let opacity = 1;
          let node: HTMLElement | null = element;
          while (node && node !== root?.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden") return 0;
            opacity *= Number.parseFloat(style.opacity) || 0;
            node = node.parentElement;
          }
          return opacity;
        };
        const focal: ContinuousMotionGeometryV1 = {
          found: false,
          visibleFraction: 0,
          occupancyFraction: 0,
          centerX: 0,
          centerY: 0,
          width: 0,
          height: 0,
        };
        if (scene && rootRect && payload.attention) {
          const attribute = payload.attention.kind === "part" ? "data-part" : "data-region";
          let target: HTMLElement | undefined;
          if (payload.attention.kind === "selector") {
            try {
              target = scene.querySelector(payload.attention.id) as HTMLElement | undefined;
            } catch {
              target = undefined;
            }
          } else {
            target = (Array.from(scene.querySelectorAll(`[${attribute}]`)) as HTMLElement[])
              .find((element: HTMLElement) =>
                element.getAttribute(attribute) === payload.attention!.id
              );
          }
          if (target) {
            const rect = target.getBoundingClientRect();
            const left = Math.max(rootRect.left, rect.left);
            const top = Math.max(rootRect.top, rect.top);
            const right = Math.min(rootRect.right, rect.right);
            const bottom = Math.min(rootRect.bottom, rect.bottom);
            const area = Math.max(0, rect.width) * Math.max(0, rect.height);
            const visibleArea = Math.max(0, right - left) * Math.max(0, bottom - top);
            const opacity = effectiveOpacity(target);
            focal.found = area > 1;
            focal.visibleFraction = area > 0 ? Math.min(1, visibleArea / area) * opacity : 0;
            focal.occupancyFraction = rootRect.width * rootRect.height > 0
              ? Math.min(1, visibleArea / (rootRect.width * rootRect.height)) * opacity
              : 0;
            focal.centerX = rect.left - rootRect.left + rect.width / 2;
            focal.centerY = rect.top - rootRect.top + rect.height / 2;
            focal.width = rect.width;
            focal.height = rect.height;
          }
        }
        const layers: Record<string, Local> = {};
        const subjects: Record<string, Local> = {};
        if (scene) {
          layers.scene = localState(scene);
          const cameraWorld = scene.querySelector("[data-camera-world]") as HTMLElement | null;
          if (cameraWorld) layers.camera = localState(cameraWorld);
          const partElements = (Array.from(scene.querySelectorAll("[data-part]")) as HTMLElement[])
            .filter((element: HTMLElement) => {
              if (element.closest("[data-layout-ignore],[data-sequences-runtime-cut]")) return false;
              const parentPart = element.parentElement?.closest("[data-part]");
              return !parentPart || !scene.contains(parentPart);
            });
          for (const element of partElements.slice(0, 80)) {
            const id = element.getAttribute("data-part");
            if (id && !subjects[id]) subjects[id] = localState(element);
          }
          const fxElements = Array.from(
            scene.querySelectorAll("[data-sequences-fx]"),
          ) as HTMLElement[];
          for (const [index, element] of fxElements.slice(0, 12).entries()) {
            subjects[`fx:${element.getAttribute("data-sequences-fx") ?? index}:${index}`] =
              localState(element);
          }
        }
        return {
          time: payload.time,
          sceneId: payload.sceneId,
          ...(payload.phraseId ? { phraseId: payload.phraseId } : {}),
          ...(payload.attention ? { attention: payload.attention } : {}),
          focal,
          layers,
          subjects,
        } satisfies ContinuousMotionRawSnapshotV1;
      },
      {
        time,
        seekTime: options.mapSeekTime?.(time) ?? time,
        sceneId: directed.scene.id,
        ...(directed.phrase ? { phraseId: directed.phrase.id } : {}),
        ...(directed.attention ? { attention: directed.attention } : {}),
      },
    );
    raw.push(snapshot);
  }
  return analyzeContinuousMotionSnapshots(scenes, raw, frame, sampleHz);
}

export function continuousMotionEvidenceEnabled(): boolean {
  return process.env.SLACK_SEQUENCES_CONTINUOUS_MOTION !== "0";
}
