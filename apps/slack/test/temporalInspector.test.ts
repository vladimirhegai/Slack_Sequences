import { describe, expect, it } from "vitest";
import {
  quietWindowsFromCurve,
  temporalOutgoingCutSelector,
} from "../src/engine/temporalInspector.ts";
import {
  primaryBlockingTransitTimes,
  temporalSceneSampleTimes,
} from "../src/engine/temporalSampling.ts";
import type { CameraBlockingPlanV1 } from "../src/engine/cameraBlocking.ts";

describe("temporal outgoing cut target", () => {
  it("adds an exact short transit sample to the canonical five-frame cadence", () => {
    const base = temporalSceneSampleTimes(4, 5);
    const withTransit = temporalSceneSampleTimes(4, 5, [4.63]);
    expect(base).toHaveLength(5);
    expect(base).not.toContain(4.63);
    expect(withTransit).toContain(4.63);
    expect(withTransit).toHaveLength(6);
  });

  it("includes every primary transit even in later scenes", () => {
    const plan = {
      scenes: [{
        sceneId: "scene-7",
        phrases: [
          { importance: "primary", startSec: 12, arrivalSec: 12.2 },
          { importance: "primary", startSec: 12.4, arrivalSec: 12.8 },
          { importance: "primary", startSec: 13, arrivalSec: 13.6 },
          { importance: "supporting", startSec: 14, arrivalSec: 14.5 },
        ],
      }],
    } as unknown as CameraBlockingPlanV1;
    expect(primaryBlockingTransitTimes(plan, "scene-7")).toEqual([12.1, 12.6, 13.3]);
  });

  it("uses the rendered interval start for the first quiet sample", () => {
    expect(quietWindowsFromCurve([
      { fromTime: 0, time: 0.5, delta: 0 },
      { fromTime: 0.5, time: 1, delta: 0 },
      { fromTime: 1, time: 1.5, delta: 0 },
      { fromTime: 1.5, time: 2, delta: 0.01 },
    ], 0.0002, 1.5)).toEqual([{ start: 0, end: 1.5 }]);
  });

  it("observes the runtime bridge for canonical and legacy matched cuts", () => {
    for (const style of ["match", "morph", "object-match", "shape-match"] as const) {
      expect(temporalOutgoingCutSelector({ style, fromScene: "one", toScene: "two" }))
        .toBe(
          '[data-sequences-runtime-cut="bridge"]' +
          '[data-sequences-cut-from="one"]' +
          '[data-sequences-cut-to="two"]',
        );
    }
  });

  it("observes the flash overlay or ordinary outgoing scene", () => {
    expect(temporalOutgoingCutSelector({
      style: "flash-white",
      fromScene: "one",
      toScene: "two",
    })).toBe(
      '[data-sequences-runtime-cut="flash"]' +
      '[data-sequences-cut-from="one"]' +
      '[data-sequences-cut-to="two"]',
    );
    expect(temporalOutgoingCutSelector({ style: "swipe", fromScene: "one", toScene: "two" }))
      .toBe('[data-scene="one"]');
  });

  it("returns a distinct selector for consecutive bridged boundaries", () => {
    const first = temporalOutgoingCutSelector({
      style: "morph",
      fromScene: "one",
      toScene: "two",
    });
    const second = temporalOutgoingCutSelector({
      style: "morph",
      fromScene: "two",
      toScene: "three",
    });
    expect(second).not.toBe(first);
    expect(second).toContain('[data-sequences-cut-from="two"]');
    expect(second).toContain('[data-sequences-cut-to="three"]');
  });
});
