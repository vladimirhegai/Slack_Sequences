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
import { slackSequencesEnvRawValue } from "./featureFlags.ts";

const DEFAULT_SAMPLE_HZ = 5;
const DEFAULT_MAX_SAMPLES = 150;
const MOVING_SPEED = 0.008;
/** Host wallpaper/light/furniture is intentionally subtler than component motion. */
const AMBIENT_MOVING_SPEED = 1e-9;
/** Low-amplitude operated camera movement still keeps a held frame alive. */
const LIVENESS_SPEED = 0.002;
/** Longer rendered stillness reads as a stopped slide, even between valid beats. */
const QUIET_WINDOW_MIN_SEC = 0.8;
export const QUIET_WINDOW_REVIEW_SEC = 1.4;
/** A rendered freeze must exceed this span; an exact 1.5s hold is not a finding. */
export const RENDERED_DEAD_FRAME_MIN_SEC = 1.5;
export const RENDERED_DEAD_FRAME_CODE = "motion_dead_frame" as const;
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
  /** SVG/trim-path progress, when the subject exposes it. */
  strokeDashoffset?: number;
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
  /**
   * Camera-world transform speed, kept separate from focal DOM motion. A
   * headline reveal or count reflow may move the focal box while the lens is
   * correctly holding; camera-blocking rest evidence must not confuse them.
   */
  cameraSpeed?: number;
  independentMotionCount: number;
}

export interface ContinuousMotionMarkerV1 {
  time: number;
  sceneId: string;
  phraseId?: string;
  value: number;
}

export interface ContinuousMotionQuietWindowV1 {
  sceneId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
}

/** One rendered pixel-delta sample describes the whole preceding interval. */
export interface RenderedChangeCurvePointV1 {
  fromTime: number;
  time: number;
  delta: number;
}

export interface AuthoredHoldIntervalV1 {
  sceneId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface RenderedDeadFrameWindowV1 {
  code: typeof RENDERED_DEAD_FRAME_CODE;
  /** First owning scene, retained as the repair-routing key. */
  sceneId: string;
  /** Every scene crossed while the rendered frame remained near-identical. */
  sceneIds: string[];
  startSec: number;
  endSec: number;
  durationSec: number;
  peakDelta: number;
}

/**
 * Advisory liveness evidence derived from rendered pixels, not authored tween
 * declarations. Declared camera holds remain visible in excludedHoldIntervals
 * so a reviewer can audit exactly which quiet spans were excused.
 */
export interface RenderedDeadFrameEvidenceV1 {
  version: 1;
  advisory: true;
  code: typeof RENDERED_DEAD_FRAME_CODE;
  deltaThreshold: number;
  /** Windows are emitted only when durationSec is strictly greater than this. */
  minimumWindowSec: number;
  excludedHoldIntervals: AuthoredHoldIntervalV1[];
  windows: RenderedDeadFrameWindowV1[];
  summary: {
    eligibleDurationSec: number;
    deadDurationSec: number;
    deadFrameRatio: number;
    windowCount: number;
    maxWindowSec: number;
  };
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
  quietWindows: ContinuousMotionQuietWindowV1[];
  settleWindows: ContinuousSettleEvidenceV1[];
  scenes: ContinuousSceneSummaryV1[];
  /** Present when the temporal pixel-change pass has enriched this evidence. */
  renderedDeadFrames?: RenderedDeadFrameEvidenceV1;
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
    quietWindowCount: number;
    maxQuietWindowSec: number;
  };
  advisories: string[];
}

export type ContinuousMotionQualityCode =
  | "motion_jerk_excess"
  | "motion_reversal_excess"
  | "motion_settle_late";

export interface ContinuousMotionQualityFindingV1 {
  code: ContinuousMotionQualityCode;
  sceneId: string;
  time: number;
  message: string;
  fixHint: string;
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
    ((after.strokeDashoffset ?? 0) - (before.strokeDashoffset ?? 0)) * 0.01 / dt,
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
      const threshold = id.startsWith("ambient:") ? AMBIENT_MOVING_SPEED : MOVING_SPEED;
      if (magnitude(vector) > threshold) voices.push(vector);
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

interface RenderedInterval {
  sceneId: string;
  startSec: number;
  endSec: number;
}

interface RenderedDeltaInterval extends RenderedInterval {
  delta: number;
}

interface ActiveRenderedDeadFrame {
  sceneIds: string[];
  startSec: number;
  endSec: number;
  delta: number;
}

function mergeRenderedIntervals(intervals: RenderedInterval[]): RenderedInterval[] {
  const merged: RenderedInterval[] = [];
  for (const interval of [...intervals].sort((a, b) =>
    a.sceneId.localeCompare(b.sceneId) || a.startSec - b.startSec || a.endSec - b.endSec
  )) {
    const previous = merged[merged.length - 1];
    if (
      previous && previous.sceneId === interval.sceneId &&
      interval.startSec <= previous.endSec + 1e-6
    ) {
      previous.endSec = Math.max(previous.endSec, interval.endSec);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/** Explicit storyboard holds, clamped to their owning scene and film. */
export function authoredHoldIntervals(
  scenes: DirectScene[],
  durationSec = Math.max(0, ...scenes.map((scene) => scene.startSec + scene.durationSec)),
): AuthoredHoldIntervalV1[] {
  const intervals = scenes.flatMap((scene): RenderedInterval[] => {
    const sceneStart = Math.max(0, scene.startSec);
    const sceneEnd = Math.min(durationSec, scene.startSec + scene.durationSec);
    if (sceneEnd <= sceneStart) return [];
    return (scene.camera?.path ?? []).flatMap((move): RenderedInterval[] => {
      if (move.move !== "hold") return [];
      const startSec = Math.max(sceneStart, move.startSec);
      const endSec = Math.min(sceneEnd, move.startSec + move.durationSec);
      return endSec > startSec ? [{ sceneId: scene.id, startSec, endSec }] : [];
    });
  });
  return mergeRenderedIntervals(intervals).map((interval) => ({
    sceneId: interval.sceneId,
    startSec: round(interval.startSec, 3),
    endSec: round(interval.endSec, 3),
    durationSec: round(interval.endSec - interval.startSec, 3),
  }));
}

function subtractHolds(
  interval: RenderedDeltaInterval,
  holds: AuthoredHoldIntervalV1[],
): RenderedDeltaInterval[] {
  const pieces: RenderedDeltaInterval[] = [];
  let cursor = interval.startSec;
  for (const hold of holds) {
    if (hold.sceneId !== interval.sceneId || hold.endSec <= cursor + 1e-6) continue;
    if (hold.startSec >= interval.endSec - 1e-6) break;
    if (hold.startSec > cursor + 1e-6) {
      pieces.push({
        ...interval,
        startSec: cursor,
        endSec: Math.min(interval.endSec, hold.startSec),
      });
    }
    cursor = Math.max(cursor, hold.endSec);
    if (cursor >= interval.endSec - 1e-6) break;
  }
  if (cursor < interval.endSec - 1e-6) {
    pieces.push({ ...interval, startSec: cursor });
  }
  return pieces;
}

/**
 * Finds rendered freezes outside explicit camera holds. The input point's
 * fromTime makes the measured span exact instead of inferring a first interval
 * from sample cadence. Declared holds split a candidate; a visually unchanged
 * scene boundary remains consecutive evidence and records both scene ids.
 */
export function analyzeRenderedDeadFrames(
  curve: RenderedChangeCurvePointV1[],
  scenes: DirectScene[],
  durationSec: number,
  options: { deltaThreshold?: number; minimumWindowSec?: number } = {},
): RenderedDeadFrameEvidenceV1 {
  const deltaThreshold = Math.max(0, options.deltaThreshold ?? 0.0002);
  const minimumWindowSec = Math.max(0, options.minimumWindowSec ?? RENDERED_DEAD_FRAME_MIN_SEC);
  const holds = authoredHoldIntervals(scenes, durationSec);
  const orderedScenes = [...scenes].sort((a, b) => a.startSec - b.startSec);
  const eligible: RenderedDeltaInterval[] = [];

  for (const point of [...curve].sort((a, b) => a.fromTime - b.fromTime || a.time - b.time)) {
    if (!Number.isFinite(point.fromTime) || !Number.isFinite(point.time) ||
        !Number.isFinite(point.delta) || point.time <= point.fromTime) continue;
    const sampleStart = Math.max(0, point.fromTime);
    const sampleEnd = Math.min(durationSec, point.time);
    if (sampleEnd <= sampleStart) continue;
    for (const scene of orderedScenes) {
      const startSec = Math.max(sampleStart, scene.startSec);
      const endSec = Math.min(sampleEnd, scene.startSec + scene.durationSec);
      if (endSec <= startSec) continue;
      eligible.push(...subtractHolds(
        { sceneId: scene.id, startSec, endSec, delta: point.delta },
        holds,
      ));
    }
  }

  eligible.sort((a, b) =>
    a.startSec - b.startSec || a.endSec - b.endSec || a.sceneId.localeCompare(b.sceneId)
  );
  const windows: RenderedDeadFrameWindowV1[] = [];
  let active: ActiveRenderedDeadFrame | undefined;
  const flush = (): void => {
    if (!active) return;
    const duration = active.endSec - active.startSec;
    if (duration > minimumWindowSec + 1e-6) {
      windows.push({
        code: RENDERED_DEAD_FRAME_CODE,
        sceneId: active.sceneIds[0]!,
        sceneIds: active.sceneIds,
        startSec: round(active.startSec, 3),
        endSec: round(active.endSec, 3),
        durationSec: round(duration, 3),
        peakDelta: round(active.delta, 6),
      });
    }
    active = undefined;
  };
  for (const interval of eligible) {
    if (interval.delta >= deltaThreshold) {
      flush();
      continue;
    }
    if (
      active && Math.abs(active.endSec - interval.startSec) <= 1e-6
    ) {
      active.endSec = interval.endSec;
      active.delta = Math.max(active.delta, interval.delta);
      if (!active.sceneIds.includes(interval.sceneId)) active.sceneIds.push(interval.sceneId);
    } else {
      flush();
      active = {
        sceneIds: [interval.sceneId],
        startSec: interval.startSec,
        endSec: interval.endSec,
        delta: interval.delta,
      };
    }
  }
  flush();

  const sampledIntervals = mergeRenderedIntervals(eligible);
  const eligibleDurationSec = sampledIntervals.reduce(
    (sum, interval) => sum + interval.endSec - interval.startSec,
    0,
  );
  const deadDurationSec = windows.reduce((sum, window) => sum + window.durationSec, 0);
  return {
    version: 1,
    advisory: true,
    code: RENDERED_DEAD_FRAME_CODE,
    deltaThreshold: round(deltaThreshold, 6),
    minimumWindowSec: round(minimumWindowSec, 3),
    excludedHoldIntervals: holds,
    windows,
    summary: {
      eligibleDurationSec: round(eligibleDurationSec, 3),
      deadDurationSec: round(deadDurationSec, 3),
      deadFrameRatio: round(eligibleDurationSec > 0 ? deadDurationSec / eligibleDurationSec : 0, 4),
      windowCount: windows.length,
      maxWindowSec: round(Math.max(0, ...windows.map((window) => window.durationSec)), 3),
    },
  };
}

function renderedQuietWindows(samples: ContinuousMotionSampleV1[]): ContinuousMotionQuietWindowV1[] {
  const windows: ContinuousMotionQuietWindowV1[] = [];
  let active: { sceneId: string; startSec: number; endSec: number } | undefined;
  const flush = (): void => {
    if (active && active.endSec - active.startSec >= QUIET_WINDOW_MIN_SEC - 1e-6) {
      windows.push({
        sceneId: active.sceneId,
        startSec: round(active.startSec, 3),
        endSec: round(active.endSec, 3),
        durationSec: round(active.endSec - active.startSec, 3),
      });
    }
    active = undefined;
  };
  for (let index = 1; index < samples.length; index += 1) {
    const before = samples[index - 1]!;
    const after = samples[index]!;
    const sameScene = before.sceneId === after.sceneId;
    const alive = after.independentMotionCount > 0 || (after.focal.speed ?? 0) >= LIVENESS_SPEED;
    if (!sameScene || alive) {
      flush();
      continue;
    }
    if (!active) active = { sceneId: after.sceneId, startSec: before.time, endSec: after.time };
    else active.endSec = after.time;
  }
  flush();
  return windows;
}

function settleEvidence(
  scoreWindows: Array<DirectionSettleWindowV1 & { sceneId: string }>,
  samples: ContinuousMotionSampleV1[],
): ContinuousSettleEvidenceV1[] {
  return scoreWindows.map((window) => {
    const samePhrase = samples.filter((sample) =>
      sample.sceneId === window.sceneId &&
      sample.phraseId === window.phraseId &&
      sample.time >= window.startSec - 0.001 &&
      sample.time <= window.endSec + 0.45
    );
    // An exact phrase boundary belongs to the NEXT direction phrase. Carry
    // one same-target endpoint sample across that boundary so a component or
    // camera that visibly rests at the end is not marked late merely because
    // the semantic phrase id advanced between two 5 Hz samples. Never borrow
    // a different target: that is real handoff motion, not settle evidence.
    const last = samePhrase[samePhrase.length - 1];
    const endpoint = last
      ? samples.find((sample) =>
          sample.sceneId === window.sceneId &&
          sample.time > last.time + 0.001 &&
          sample.time <= window.endSec + 0.45 &&
          sample.attention?.kind === last.attention?.kind &&
          sample.attention?.id === last.attention?.id
        )
      : undefined;
    const candidates = endpoint ? [...samePhrase, endpoint] : samePhrase;
    let settledAt: number | undefined;
    // A cut's 80-200ms settle window often has only one side of a target
    // handoff, so it cannot supply two same-target velocity samples. D1/0e
    // judges outgoing cut motion directly; exclude cut windows from the
    // continuous settle denominator instead of recording a false miss at
    // peakSpeed 0.
    const measured = window.owner !== "cut" && candidates.some((sample) => sample.focal.found);
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
    if (
      settledAt === undefined && measured && candidates.length === 1 &&
      candidates[0]!.time >= window.endSec - 0.05 &&
      candidates[0]!.focal.speed !== undefined &&
      candidates[0]!.focal.speed! <= SETTLED_SPEED
    ) {
      // The one endpoint velocity already summarizes the interval leading
      // into the window end; accepting it avoids demanding a sample after a
      // scene/cut boundary where the target no longer exists.
      settledAt = candidates[0]!.time;
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

/**
 * Cross-film calibrated polish thresholds for 5 Hz browser-QA evidence.
 * These findings pressure strictOk/least-bad selection but never change the
 * hard runtime `ok` boundary. One finding per class keeps scene-slot repair
 * focused and prevents marker-count spam.
 */
export function continuousMotionQualityFindings(
  evidence: ContinuousMotionEvidenceV1,
  durationSec: number,
): ContinuousMotionQualityFindingV1[] {
  const findings: ContinuousMotionQualityFindingV1[] = [];
  const duration = Math.max(0.1, durationSec);
  const markersByScene = <T extends { sceneId: string; time: number }>(markers: T[]) => {
    const counts = new Map<string, { count: number; first: number }>();
    for (const marker of markers) {
      const current = counts.get(marker.sceneId) ?? { count: 0, first: marker.time };
      current.count += 1;
      current.first = Math.min(current.first, marker.time);
      counts.set(marker.sceneId, current);
    }
    return [...counts].sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first)[0];
  };

  // A single eased gesture commonly remains above the derivative marker for
  // two or three adjacent samples. Counting each sample made the verdict vary
  // with sample density and charged one minimum-jerk route as several defects.
  // Collapse cadence-adjacent markers into physical gesture clusters; repeated
  // jolts separated in time still accumulate and trigger the quality finding.
  const jerkClusterGapSec = Math.max(0.3, 2.25 / Math.max(1, evidence.sampleHz));
  const jerkClusters: ContinuousMotionMarkerV1[] = [];
  let lastJerkMarker: ContinuousMotionMarkerV1 | undefined;
  for (const marker of [...evidence.jerkMarkers].sort((a, b) =>
    a.time - b.time || a.sceneId.localeCompare(b.sceneId)
  )) {
    const previous = jerkClusters[jerkClusters.length - 1];
    if (
      previous && lastJerkMarker?.sceneId === marker.sceneId &&
      marker.time - lastJerkMarker.time <= jerkClusterGapSec
    ) {
      // Retain the cluster's earliest routing time but its worst measured value.
      previous.value = Math.max(previous.value, marker.value);
      lastJerkMarker = marker;
      continue;
    }
    jerkClusters.push({ ...marker });
    lastJerkMarker = marker;
  }
  const jerkDensity = jerkClusters.length / duration;
  if (jerkClusters.length >= 4 && jerkDensity > 0.15) {
    const worst = markersByScene(jerkClusters);
    findings.push({
      code: "motion_jerk_excess",
      sceneId: worst?.[0] ?? evidence.scenes[0]?.sceneId ?? "unknown",
      time: worst?.[1].first ?? jerkClusters[0]?.time ?? 0,
      message:
        `${jerkClusters.length} distinct high-jerk focal gestures over ` +
        `${duration.toFixed(1)}s (${jerkDensity.toFixed(2)}/s) exceed the calibrated motion profile.`,
      fixHint:
        "Remove the corrective camera move or competing transform nearest the marker cluster; " +
        "keep one minimum-jerk route and a readable landing.",
    });
  }

  const reversalLimit = Math.max(1, Math.floor(duration / 20));
  if (evidence.summary.reversalCount > reversalLimit) {
    const worst = markersByScene(evidence.reversals);
    findings.push({
      code: "motion_reversal_excess",
      sceneId: worst?.[0] ?? evidence.scenes[0]?.sceneId ?? "unknown",
      time: worst?.[1].first ?? evidence.reversals[0]?.time ?? 0,
      message:
        `${evidence.summary.reversalCount} focal direction reversals exceed the ` +
        `${reversalLimit}-reversal allowance for a ${duration.toFixed(1)}s film.`,
      fixHint:
        "Merge same-target reframes and let connective drift yield to the decisive move; " +
        "do not pan away and correct back during a readable phrase.",
    });
  }

  const measured = evidence.settleWindows.filter((window) => window.measured);
  const settled = measured.filter((window) => window.settledByWindowEnd);
  if (measured.length >= 4 && settled.length / measured.length < 0.55) {
    const missed = measured.filter((window) => !window.settledByWindowEnd);
    const byScene = new Map<string, { count: number; first: number }>();
    for (const window of missed) {
      const current = byScene.get(window.sceneId) ?? { count: 0, first: window.startSec };
      current.count += 1;
      current.first = Math.min(current.first, window.startSec);
      byScene.set(window.sceneId, current);
    }
    const worst = [...byScene].sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first)[0];
    findings.push({
      code: "motion_settle_late",
      sceneId: worst?.[0] ?? measured[0]?.sceneId ?? "unknown",
      time: worst?.[1].first ?? measured[0]?.startSec ?? 0,
      message:
        `Only ${settled.length}/${measured.length} measured direction phrases settled by ` +
        `their readable-window end (${Math.round(settled.length / measured.length * 100)}%).`,
      fixHint:
        "Shorten or remove overlapping late motion so the focal reaches its rest pose before " +
        "the reading window ends; keep follow-through on a separate ambient layer.",
    });
  }
  return findings;
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
    const beforeCamera = before.layers.camera;
    const afterCamera = after.layers.camera;
    if (dt > 0 && before.sceneId === after.sceneId && beforeCamera && afterCamera) {
      const scaleBefore = Math.max(
        1e-6,
        Math.sqrt(Math.abs(beforeCamera.scaleX * beforeCamera.scaleY)),
      );
      const scaleAfter = Math.max(
        1e-6,
        Math.sqrt(Math.abs(afterCamera.scaleX * afterCamera.scaleY)),
      );
      sample.cameraSpeed = round(Math.hypot(
        (afterCamera.x - beforeCamera.x) / diagonal / dt,
        (afterCamera.y - beforeCamera.y) / diagonal / dt,
        Math.log(scaleAfter / scaleBefore) * FOCAL_SCALE_WEIGHT / dt,
      ));
    }
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
    // Exact cue/settle/cut boundaries can sit only 10–150ms from the regular
    // cadence. This simple finite difference is calibrated on uniform samples;
    // applying it across those nonuniform inserts fabricates derivative spikes
    // even for smooth GSAP travel. Keep velocity evidence, but derive
    // acceleration/jerk only from near-cadence intervals.
    const minimumDerivativeStep = 0.9 / Math.max(1, sampleHz);
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
  const quietWindows = renderedQuietWindows(samples);
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
    quietWindowCount: quietWindows.length,
    maxQuietWindowSec: round(Math.max(0, ...quietWindows.map((window) => window.durationSec)), 3),
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
  if (summary.maxQuietWindowSec >= QUIET_WINDOW_REVIEW_SEC) {
    advisories.push(
      `${summary.quietWindowCount} rendered quiet window(s); longest ` +
        `${summary.maxQuietWindowSec.toFixed(2)}s without camera, content, or micro motion`,
    );
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
    quietWindows,
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
        const localState = (element: Element): Local => {
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
            width: element instanceof HTMLElement ? element.offsetWidth : element.getBoundingClientRect().width,
            height: element instanceof HTMLElement ? element.offsetHeight : element.getBoundingClientRect().height,
            ...(Number.isFinite(Number.parseFloat(style.strokeDashoffset))
              ? { strokeDashoffset: Number.parseFloat(style.strokeDashoffset) }
              : {}),
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
          // The living-canvas contract keeps readable product copy still while
          // wallpaper, furniture, and light carry ambient life. Sample those
          // host-owned layers or a visibly moving hold is mislabeled quiet.
          const ambientElements = Array.from(
            scene.querySelectorAll("[data-sequences-ambient]"),
          ) as HTMLElement[];
          for (const [index, element] of ambientElements.slice(0, 16).entries()) {
            layers[`ambient:${element.getAttribute("data-sequences-ambient") ?? index}:${index}`] =
              localState(element);
          }
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
          // Internal component motion is story motion too. Sampling only the
          // outer data-part root made row cascades, count slots, progress fills,
          // and SVG draw-ons look falsely static.
          const internal = Array.from(scene.querySelectorAll(
            "[data-cmp-item],.cmp-row,.cmp-item,.cmp-card,.cmp-msg," +
            "[data-cmp-value],[data-cmp-fill],svg path,svg line,svg polyline,svg circle",
          ));
          for (const [index, element] of internal.slice(0, 100).entries()) {
            subjects[`internal:${index}`] = localState(element);
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
  return slackSequencesEnvRawValue("SLACK_SEQUENCES_CONTINUOUS_MOTION") !== "0";
}
