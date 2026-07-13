import { describe, expect, it } from "vitest";
import {
  analyzeContinuousMotionSnapshots,
  analyzeRenderedDeadFrames,
  continuousMotionAttentionAt,
  continuousMotionQualityFindings,
  continuousMotionSampleTimes,
  type ContinuousMotionRawSnapshotV1,
} from "../src/engine/continuousMotion.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { resolveFilmDirectionScore } from "../src/engine/directionScore.ts";

const scene: DirectScene = {
  id: "proof",
  title: "Proof",
  purpose: "Show the result",
  startSec: 0,
  durationSec: 3,
  spatialIntent: {
    version: 1,
    focalPart: "hero",
    composition: "centered",
    relationships: [],
  },
  components: [{ version: 1, id: "hero", kind: "stat-card" }],
  beats: [{
    version: 1,
    id: "hero-count",
    sceneId: "proof",
    component: "hero",
    kind: "count",
    atSec: 0.4,
    durationSec: 0.6,
    value: 42,
  }],
  moments: [{
    version: 1,
    id: "hero-lands",
    sceneId: "proof",
    atSec: 1,
    title: "Hero lands",
    visualState: "42 is visible",
    change: "The metric completed",
    motionIntent: "ui state",
    importance: "primary",
  }],
};

const local = (x = 0, opacity = 1) => ({
  x,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  opacity,
  width: 200,
  height: 100,
});

function snapshot(
  time: number,
  centerX: number,
  options: {
    visible?: number;
    occupancy?: number;
    layerX?: number;
    subjectOpacity?: number;
    focalScale?: number;
  } = {},
): ContinuousMotionRawSnapshotV1 {
  const focalScale = options.focalScale ?? 1;
  return {
    time,
    sceneId: "proof",
    phraseId: "proof:01",
    attention: { kind: "part", id: "hero" },
    focal: {
      found: true,
      visibleFraction: options.visible ?? 1,
      occupancyFraction: options.occupancy ?? 0.08,
      centerX,
      centerY: 500,
      width: 200 * focalScale,
      height: 100 * focalScale,
    },
    layers: { scene: local(), camera: local(options.layerX ?? 0) },
    subjects: { hero: local(0, options.subjectOpacity ?? 1) },
  };
}

describe("continuous motion evidence", () => {
  it("keeps uniform samples plus exact direction and settle boundaries", () => {
    const times = continuousMotionSampleTimes([scene], 3, 2, 30);
    expect(times).toContain(1);
    expect(times).toContain(1.55);
    expect(times[0]).toBe(0);
    expect(times.at(-1)).toBe(3);
  });

  it("keeps the sample cap absolute even when important boundaries exceed it", () => {
    const crowded: DirectScene = {
      ...scene,
      durationSec: 30,
      moments: Array.from({ length: 80 }, (_, index) => ({
        version: 1 as const,
        id: `moment-${index}`,
        sceneId: "proof",
        atSec: 0.2 + index * 0.35,
        title: `Moment ${index}`,
        visualState: "changed",
        change: "changed",
        motionIntent: "reveal",
        importance: "supporting" as const,
      })),
    };
    const times = continuousMotionSampleTimes([crowded], 30, 8, 40);
    expect(times).toHaveLength(40);
    expect(times[0]).toBe(0);
    expect(times.at(-1)).toBe(30);
  });

  it("counts centered push/pull scale as focal motion", () => {
    const evidence = analyzeContinuousMotionSnapshots(
      [scene],
      [
        snapshot(0, 500, { focalScale: 1 }),
        snapshot(0.25, 500, { focalScale: 1.2 }),
        snapshot(0.5, 500, { focalScale: 1.4 }),
      ],
      { width: 1000, height: 1000 },
      4,
    );
    expect(evidence.summary.peakSpeed).toBeGreaterThan(0.02);
  });

  it("separates focal entrance motion from a camera-world hold", () => {
    const evidence = analyzeContinuousMotionSnapshots(
      [scene],
      [
        snapshot(0, 400, { layerX: 0 }),
        snapshot(0.25, 500, { layerX: 0 }),
      ],
      { width: 1000, height: 1000 },
      4,
    );
    expect(evidence.samples[1]!.focal.speed).toBeGreaterThan(0.1);
    expect(evidence.samples[1]!.cameraSpeed).toBe(0);
  });

  it("counts low-amplitude host ambient motion as a living hold", () => {
    const before = snapshot(0, 500);
    const after = snapshot(0.25, 500);
    before.layers["ambient:light:0"] = local(0);
    after.layers["ambient:light:0"] = local(0.5);
    const evidence = analyzeContinuousMotionSnapshots(
      [scene],
      [before, after],
      { width: 1000, height: 1000 },
      4,
    );
    expect(evidence.samples[1]!.independentMotionCount).toBe(1);
    expect(evidence.quietWindows).toEqual([]);
  });

  it("prefers phrase-directed regions over a scene's generic focal part", () => {
    const routed: DirectScene = {
      ...scene,
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "pan",
          toRegion: "ci-station",
          startSec: 0,
          durationSec: 2,
        }],
      },
      moments: [{
        ...scene.moments![0]!,
        atSec: 1,
        title: "Camera pans through CI",
        change: "Camera pans to CI",
        motionIntent: "camera pan",
      }],
    };
    const attention = continuousMotionAttentionAt(
      [routed],
      resolveFilmDirectionScore([routed]),
      1,
    );
    expect(attention?.attention).toEqual({ kind: "region", id: "ci-station" });
  });

  it("does not derive jerk from boundary micro-samples", () => {
    const evidence = analyzeContinuousMotionSnapshots(
      [scene],
      [
        snapshot(0, 100),
        snapshot(0.25, 110),
        snapshot(0.26, 180),
        snapshot(0.5, 190),
      ],
      { width: 1000, height: 1000 },
      4,
    );
    expect(evidence.summary.jerkMarkerCount).toBe(0);
  });

  it("measures focal continuity, reversals, jerk, settle, and independent voices", () => {
    const evidence = analyzeContinuousMotionSnapshots(
      [scene],
      [
        snapshot(0, 100),
        snapshot(0.25, 200, { layerX: 40 }),
        snapshot(0.5, 100, { layerX: 80, subjectOpacity: 0.5 }),
        snapshot(0.75, 100, { visible: 0.5, occupancy: 0.01, layerX: 80 }),
        snapshot(1, 150, { layerX: 80 }),
        snapshot(1.25, 151, { layerX: 80 }),
        snapshot(1.5, 151, { layerX: 80 }),
        snapshot(1.75, 151, { layerX: 80 }),
      ],
      { width: 1000, height: 1000 },
      4,
    );

    expect(evidence.advisory).toBe(true);
    expect(evidence.summary.reversalCount).toBeGreaterThanOrEqual(1);
    expect(evidence.summary.jerkMarkerCount).toBeGreaterThanOrEqual(1);
    expect(evidence.summary.minimumVisibleFraction).toBe(0.5);
    expect(evidence.summary.minimumOccupancyFraction).toBe(0.01);
    expect(evidence.summary.offframeSamples).toBe(1);
    expect(evidence.summary.tinyFocalSamples).toBe(1);
    expect(evidence.summary.maxIndependentMotionCount).toBeGreaterThanOrEqual(1);
    expect(evidence.settleWindows).toEqual([
      expect.objectContaining({
        sceneId: "proof",
        phraseId: "proof:01",
        settledByWindowEnd: true,
      }),
    ]);
    expect(evidence.advisories).toEqual(expect.arrayContaining([
      expect.stringContaining("focal sample"),
      expect.stringContaining("reversal"),
    ]));
  });

  it("reports absent focal evidence without inventing geometry", () => {
    const raw = snapshot(0, 0);
    raw.focal = { ...raw.focal, found: false };
    const evidence = analyzeContinuousMotionSnapshots(
      [scene],
      [raw],
      { width: 1920, height: 1080 },
    );
    expect(evidence.summary.focalFoundSamples).toBe(0);
    expect(evidence.summary.meanVisibleFraction).toBe(0);
  });

  it("reports rendered stillness but accepts low-amplitude operated motion", () => {
    const still = analyzeContinuousMotionSnapshots(
      [scene],
      Array.from({ length: 9 }, (_, index) => snapshot(index * 0.25, 500)),
      { width: 1000, height: 1000 },
      4,
    );
    expect(still.summary.maxQuietWindowSec).toBe(2);
    expect(still.quietWindows).toEqual([
      expect.objectContaining({ sceneId: "proof", startSec: 0, endSec: 2 }),
    ]);
    expect(still.advisories).toContainEqual(expect.stringContaining("rendered quiet window"));

    const operated = analyzeContinuousMotionSnapshots(
      [scene],
      Array.from({ length: 9 }, (_, index) => snapshot(index * 0.25, 500 + index)),
      { width: 1000, height: 1000 },
      4,
    );
    expect(operated.summary.maxQuietWindowSec).toBe(0);
  });

  it("detects only rendered dead windows strictly longer than 1.5 seconds", () => {
    const evidence = analyzeRenderedDeadFrames(
      [
        { fromTime: 0, time: 0.5, delta: 0 },
        { fromTime: 0.5, time: 1, delta: 0 },
        { fromTime: 1, time: 1.5, delta: 0 },
        { fromTime: 1.5, time: 2, delta: 0 },
        { fromTime: 2, time: 2.5, delta: 0.01 },
        { fromTime: 2.5, time: 3, delta: 0 },
        { fromTime: 3, time: 3.5, delta: 0 },
        { fromTime: 3.5, time: 4, delta: 0 },
      ],
      [{ ...scene, durationSec: 4 }],
      4,
    );

    expect(evidence).toMatchObject({
      version: 1,
      advisory: true,
      code: "motion_dead_frame",
      minimumWindowSec: 1.5,
      windows: [{
        code: "motion_dead_frame",
        sceneId: "proof",
        sceneIds: ["proof"],
        startSec: 0,
        endSec: 2,
        durationSec: 2,
      }],
      summary: {
        eligibleDurationSec: 4,
        deadDurationSec: 2,
        deadFrameRatio: 0.5,
        windowCount: 1,
        maxWindowSec: 2,
      },
    });
  });

  it("excludes and splits explicitly authored camera holds", () => {
    const held: DirectScene = {
      ...scene,
      durationSec: 5,
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "hold",
          toPart: "hero",
          startSec: 1.5,
          durationSec: 1.5,
        }],
      },
    };
    const evidence = analyzeRenderedDeadFrames(
      Array.from({ length: 10 }, (_, index) => ({
        fromTime: index * 0.5,
        time: (index + 1) * 0.5,
        delta: 0,
      })),
      [held],
      5,
    );

    expect(evidence.excludedHoldIntervals).toEqual([{
      sceneId: "proof",
      startSec: 1.5,
      endSec: 3,
      durationSec: 1.5,
    }]);
    // The 1.5s prefix is not a dead window; the 2s suffix is.
    expect(evidence.windows).toEqual([{
      code: "motion_dead_frame",
      sceneId: "proof",
      sceneIds: ["proof"],
      startSec: 3,
      endSec: 5,
      durationSec: 2,
      peakDelta: 0,
    }]);
    expect(evidence.summary).toMatchObject({
      eligibleDurationSec: 3.5,
      deadDurationSec: 2,
      deadFrameRatio: 0.5714,
    });
  });

  it("keeps a visually unchanged scene boundary inside one dead window", () => {
    const second: DirectScene = {
      ...scene,
      id: "resolve",
      title: "Resolve",
      startSec: 1,
      durationSec: 1,
    };
    const evidence = analyzeRenderedDeadFrames(
      [
        { fromTime: 0, time: 0.5, delta: 0 },
        { fromTime: 0.5, time: 1, delta: 0 },
        { fromTime: 1, time: 1.5, delta: 0 },
        { fromTime: 1.5, time: 2, delta: 0 },
      ],
      [{ ...scene, durationSec: 1 }, second],
      2,
    );

    expect(evidence.windows).toEqual([expect.objectContaining({
      sceneId: "proof",
      sceneIds: ["proof", "resolve"],
      startSec: 0,
      endSec: 2,
      durationSec: 2,
    })]);
  });

  it("carries one same-target endpoint sample across a phrase boundary", () => {
    const settle = resolveFilmDirectionScore([scene]).scenes[0]!.settleWindows[0]!;
    const first = snapshot(settle.endSec - 0.2, 500);
    first.phraseId = settle.phraseId;
    const second = snapshot(settle.endSec - 0.1, 500);
    second.phraseId = settle.phraseId;
    const endpoint = snapshot(settle.endSec + 0.1, 500);
    endpoint.phraseId = "proof:next";
    const evidence = analyzeContinuousMotionSnapshots(
      [scene],
      [first, second, endpoint],
      { width: 1000, height: 1000 },
      5,
    );

    expect(evidence.settleWindows[0]).toMatchObject({
      phraseId: settle.phraseId,
      measured: true,
      settledByWindowEnd: true,
    });
  });

  it("emits one calibrated polish finding per excessive motion class", () => {
    const base = analyzeContinuousMotionSnapshots(
      [scene],
      [snapshot(0, 500), snapshot(0.2, 500), snapshot(0.4, 500)],
      { width: 1000, height: 1000 },
      5,
    );
    const stressed = {
      ...base,
      jerkMarkers: Array.from({ length: 5 }, (_, index) => ({
        time: 1 + index * 1.2,
        sceneId: "proof",
        phraseId: "proof:01",
        value: 8,
      })),
      reversals: Array.from({ length: 2 }, (_, index) => ({
        time: 2 + index * 0.2,
        sceneId: "proof",
        phraseId: "proof:01",
        value: -0.8,
      })),
      settleWindows: Array.from({ length: 4 }, (_, index) => ({
        sceneId: "proof",
        phraseId: `proof:0${index + 1}`,
        owner: "component" as const,
        startSec: index,
        endSec: index + 0.4,
        measured: true,
        settledByWindowEnd: index === 0,
        peakSpeed: 0.1,
      })),
      summary: {
        ...base.summary,
        jerkMarkerCount: 5,
        reversalCount: 2,
        measuredSettleWindowCount: 4,
        settledByWindowEndCount: 1,
      },
    };

    expect(continuousMotionQualityFindings(stressed, 10).map((finding) => finding.code))
      .toEqual(["motion_jerk_excess", "motion_reversal_excess", "motion_settle_late"]);
    expect(continuousMotionQualityFindings(base, 10)).toEqual([]);
  });

  it("counts an adjacent high-jerk burst as one gesture, independent of sample density", () => {
    const base = analyzeContinuousMotionSnapshots(
      [scene],
      [snapshot(0, 500), snapshot(0.2, 500), snapshot(0.4, 500)],
      { width: 1000, height: 1000 },
      5,
    );
    const burst = {
      ...base,
      jerkMarkers: Array.from({ length: 6 }, (_, index) => ({
        time: 1 + index * 0.2,
        sceneId: "proof",
        phraseId: "proof:01",
        value: 8 + index,
      })),
      summary: { ...base.summary, jerkMarkerCount: 6 },
    };
    expect(continuousMotionQualityFindings(burst, 10)).toEqual([]);
  });
});
