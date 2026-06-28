/**
 * The choreography solver (T2) — deterministic constraint-based scheduling of
 * intra-scene timing. ~150 lines that single-handedly kill "everything
 * animates at once / animated PowerPoint".
 *
 * Rules implemented (plan §3.5 + review amendments):
 *  - Entrance order = visual-hierarchy rank (or explicit choreography.order).
 *  - 65% overlap budget: the next entrance begins at ~65% of the previous
 *    one's duration — no dead air between entrances.
 *  - Stagger floor: sibling entrances at least `stagger` frames apart.
 *  - Simultaneity cap: ≤3 concurrently animating layers (continuous motions
 *    are sub-perceptual and exempt).
 *  - Settle gap: a minimum hold after the last entrance before the first
 *    exit. Violations are reported as diagnostics; the LINTER fixes them by
 *    extending the scene (fixes are commands, the solver stays pure).
 *  - One-loud-motion sanity: the hero's entrance should be the longest;
 *    a violation is a profile-authoring bug surfaced as a diagnostic.
 */
import type { Scene } from "./schema.ts";
import {
  CHOREO_DEFAULTS,
  DURATION_TOKENS,
  STAGGER_TOKENS,
  scaleFrames30,
  type DurationToken,
  type StaggerToken,
} from "./tokens.ts";
import type { MaterializedLayer, MotionProfile, ResolvedMotion } from "./registry/types.ts";

export interface ScheduledMotion {
  layerId: string;
  phase: "enter" | "exit" | "emphasis" | "continuous";
  motion: ResolvedMotion;
  /** Scene-relative start frame. */
  startFrame: number;
  durationFrames: number;
}

export interface SceneDiagnostics {
  /** Frames the scene is short for entrances + settle gap (+ exits). 0 = fine. */
  settleShortfallFrames: number;
  lastEnterEndFrame: number;
  firstExitStartFrame: number | null;
  /** True if a non-hero entrance outlasts the hero's (profile bug). */
  heroNotLoudest: boolean;
  /** Peak number of simultaneously animating layers (excl. continuous). */
  peakConcurrency: number;
}

export interface SceneSchedule {
  sceneId: string;
  motions: ScheduledMotion[];
  diagnostics: SceneDiagnostics;
}

function durFrames(token: DurationToken, fps: number): number {
  return scaleFrames30(DURATION_TOKENS[token], fps);
}

export function solveScene(
  scene: Scene,
  layers: MaterializedLayer[],
  profile: MotionProfile,
  fps = 30,
): SceneSchedule {
  const staggerToken: StaggerToken = scene.choreography.stagger ?? profile.defaults.stagger;
  const stagger = scaleFrames30(STAGGER_TOKENS[staggerToken], fps);
  const overlap = profile.defaults.overlapBudget;
  const settleGap = durFrames(scene.choreography.settleGap ?? profile.defaults.settleGap, fps);
  const cap = CHOREO_DEFAULTS.simultaneityCap;
  const sceneDur = scene.durationFrames;

  // Entrance order: explicit choreography order first, remainder by rank.
  const byRank = [...layers].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  const explicit = (scene.choreography.order ?? []).filter((id) =>
    layers.some((l) => l.id === id),
  );
  const ordered = [
    ...explicit.map((id) => byRank.find((l) => l.id === id)!),
    ...byRank.filter((l) => !explicit.includes(l.id)),
  ];

  const motions: ScheduledMotion[] = [];
  const enterIntervals: Array<{ start: number; end: number }> = [];
  let prevStart = 0;
  let prevDur = 0;
  let lastEnterEnd = 0;
  let first = true;

  for (const layer of ordered) {
    const enter = layer.motions.enter;
    if (!enter) continue;
    const dur = durFrames(enter.duration, fps);
    let start: number;
    if (first) {
      start = 0;
      first = false;
    } else {
      // Overlapping action: begin at ~65% of the previous entrance, but never
      // closer than the stagger floor.
      start = prevStart + Math.max(stagger, Math.round(prevDur * overlap));
    }
    // Simultaneity cap: delay until a slot frees up.
    const concurrentEnds = () =>
      enterIntervals
        .filter((iv) => iv.start <= start && iv.end > start)
        .map((iv) => iv.end)
        .sort((a, b) => a - b);
    let active = concurrentEnds();
    while (active.length >= cap) {
      start = active[0]!;
      active = concurrentEnds();
    }
    enterIntervals.push({ start, end: start + dur });
    motions.push({
      layerId: layer.id,
      phase: "enter",
      motion: enter,
      startFrame: start,
      durationFrames: dur,
    });
    lastEnterEnd = Math.max(lastEnterEnd, start + dur);
    prevStart = start;
    prevDur = dur;
  }

  // Exits: all end exactly at scene end, staggered tight in reverse rank.
  const exiting = [...ordered].reverse().filter((l) => l.motions.exit);
  let firstExitStart: number | null = null;
  exiting.forEach((layer, i) => {
    const exit = layer.motions.exit!;
    const dur = durFrames(exit.duration, fps);
    const start = sceneDur - dur - i * scaleFrames30(STAGGER_TOKENS.tight, fps);
    motions.push({
      layerId: layer.id,
      phase: "exit",
      motion: exit,
      startFrame: start,
      durationFrames: dur,
    });
    firstExitStart = firstExitStart === null ? start : Math.min(firstExitStart, start);
  });

  // Continuous motions span the whole scene.
  for (const layer of layers) {
    const continuous = layer.motions.continuous;
    if (!continuous) continue;
    motions.push({
      layerId: layer.id,
      phase: "continuous",
      motion: continuous,
      startFrame: 0,
      durationFrames: sceneDur,
    });
  }

  // Emphasis lands during the hold by default, or at an explicit scene frame.
  for (const layer of layers) {
    const emphasis = layer.motions.emphasis;
    if (!emphasis) continue;
    const durationFrames = durFrames(emphasis.duration, fps);
    const defaultStart = Math.max(
      lastEnterEnd,
      Math.round((lastEnterEnd + (firstExitStart ?? sceneDur)) / 2 - durationFrames / 2),
    );
    const startFrame = Math.max(
      0,
      Math.min(emphasis.atFrame ?? defaultStart, Math.max(0, sceneDur - durationFrames)),
    );
    motions.push({
      layerId: layer.id,
      phase: "emphasis",
      motion: emphasis,
      startFrame,
      durationFrames,
    });
  }

  // Diagnostics.
  const settleBoundary = firstExitStart ?? sceneDur;
  const settleShortfallFrames = Math.max(0, lastEnterEnd + settleGap - settleBoundary);

  const hero = layers.find((l) => l.rank === 1);
  const heroDur = hero?.motions.enter ? durFrames(hero.motions.enter.duration, fps) : 0;
  // Decor is exempt: slow background fades are quiet by nature, not "loud".
  const heroNotLoudest = layers.some(
    (l) =>
      l.rank !== 1 &&
      l.role !== "decor" &&
      l.kind !== "number" &&
      l.motions.enter !== undefined &&
      durFrames(l.motions.enter.duration, fps) > heroDur,
  );

  let peakConcurrency = 0;
  for (const iv of enterIntervals) {
    const concurrent = enterIntervals.filter(
      (other) => other.start < iv.end && other.end > iv.start && other.start <= iv.start,
    ).length;
    peakConcurrency = Math.max(peakConcurrency, concurrent);
  }

  return {
    sceneId: scene.id,
    motions,
    diagnostics: {
      settleShortfallFrames,
      lastEnterEndFrame: lastEnterEnd,
      firstExitStartFrame: firstExitStart,
      heroNotLoudest,
      peakConcurrency,
    },
  };
}
