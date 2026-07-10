import { describe, expect, it } from "vitest";
import {
  analyzeContinuousMotionSnapshots,
  continuousMotionAttentionAt,
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
});
