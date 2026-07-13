import { describe, expect, expectTypeOf, it } from "vitest";
import fc from "fast-check";
import {
  addSourceTime,
  cascadeRetime,
  duration,
  sceneLocalFromSource,
  sceneLocalTime,
  sourceFromSceneLocal,
  sourceTime,
  timeConversionService,
  viewerTime,
  type SourceTime,
  type ViewerTime,
} from "../src/engine/time.ts";
import type { TimeRampPlanV1 } from "../src/engine/timeRamp.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { resolveCutPlan } from "../src/engine/cutContract.ts";

const plan: TimeRampPlanV1 = {
  version: 1,
  ramps: [{
    version: 1,
    sceneId: "payoff",
    atSec: 4,
    slowTo: 0.4,
    holdSec: 0.6,
    recoverSec: 0.9,
    knots: [[4, 4], [4.5, 4.2], [5, 4.4], [5.5, 5.25], [6, 6]],
  }],
};

const finiteTime = fc.double({ min: -20, max: 30, noNaN: true, noDefaultInfinity: true });

describe("branded time types", () => {
  it("keeps source and viewer domains distinct at compile time", () => {
    expectTypeOf(sourceTime(1)).toEqualTypeOf<SourceTime>();
    expectTypeOf(viewerTime(1)).toEqualTypeOf<ViewerTime>();
    expectTypeOf(sourceTime(1)).not.toEqualTypeOf<ViewerTime>();
  });

  it("rejects invalid durations and scene-local times", () => {
    expect(() => duration(-0.01)).toThrow(/non-negative/);
    expect(() => sceneLocalTime(Number.NaN)).toThrow(/finite/);
  });

  it("converts scene-local time and preserves typed arithmetic", () => {
    const start = sourceTime(8);
    const absolute = sourceFromSceneLocal(start, sceneLocalTime(1.25));
    expect(absolute).toBe(9.25);
    expect(sceneLocalFromSource(start, absolute)).toBe(1.25);
    expect(addSourceTime(start, duration(2))).toBe(10);
  });
});

describe("time conversion service properties", () => {
  const conversion = timeConversionService(plan);

  it("is identity at and outside ramp boundaries", () => {
    for (const seconds of [-2, 4, 6, 12]) {
      expect(conversion.toViewer(sourceTime(seconds))).toBe(seconds);
      expect(conversion.toSource(viewerTime(seconds))).toBe(seconds);
    }
  });

  it("is strictly monotonic in both directions", () => {
    fc.assert(fc.property(finiteTime, finiteTime, (a, b) => {
      fc.pre(a < b);
      expect(conversion.toViewer(sourceTime(a))).toBeLessThan(conversion.toViewer(sourceTime(b)));
      expect(conversion.toSource(viewerTime(a))).toBeLessThan(conversion.toSource(viewerTime(b)));
    }));
  });

  it("round-trips both time domains", () => {
    fc.assert(fc.property(finiteTime, (seconds) => {
      const source = sourceTime(seconds);
      const viewer = viewerTime(seconds);
      expect(conversion.toSource(conversion.toViewer(source))).toBeCloseTo(source, 10);
      expect(conversion.toViewer(conversion.toSource(viewer))).toBeCloseTo(viewer, 10);
    }));
  });

  it("preserves conversion when a cascade translates plan and time equally", () => {
    fc.assert(fc.property(
      fc.double({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: 0, max: 8, noNaN: true, noDefaultInfinity: true }),
      (offset, delta) => {
        const shifted: TimeRampPlanV1 = {
          version: 1,
          ramps: plan.ramps.map((ramp) => ({
            ...ramp,
            atSec: ramp.atSec + delta,
            knots: ramp.knots.map(([viewer, source]) => [viewer + delta, source + delta]),
          })),
        };
        const shiftedConversion = timeConversionService(shifted);
        const original = conversion.toViewer(sourceTime(offset));
        const translated = shiftedConversion.toViewer(sourceTime(offset + delta));
        expect(translated - delta).toBeCloseTo(original, 10);
        const originalSource = conversion.toSource(viewerTime(offset));
        const translatedSource = shiftedConversion.toSource(viewerTime(offset + delta));
        expect(translatedSource - delta).toBeCloseTo(originalSource, 10);
      },
    ));
  });
});

describe("cascadeRetime", () => {
  const scenes: DirectScene[] = [
    {
      id: "setup", title: "Setup", purpose: "setup", startSec: 0, durationSec: 4,
      cut: { version: 1, style: "swipe", axis: "right", exitSec: 0.3, entrySec: 0.4 },
      moments: [{
        version: 1, id: "setup-moment", sceneId: "setup", atSec: 3,
        title: "Setup", visualState: "ready", change: "ready",
        motionIntent: "resolve", importance: "primary",
      }],
    },
    {
      id: "payoff", title: "Payoff", purpose: "payoff", startSec: 4, durationSec: 5,
      displayType: { version: 1, kind: "ghost-word", text: "SHIP", atSec: 4.2 },
      timeRamp: { version: 1, atSec: 5, slowTo: 0.4 },
      gradeShift: { version: 1, atSec: 5.5, toGrade: "warm" },
      camera: {
        version: 1,
        path: [{ version: 1, move: "push-in", startSec: 5, durationSec: 0.8, toRegion: "hero" }],
      },
      components: [{ version: 1, id: "hero", kind: "headline", role: "hero" }],
      beats: [{ version: 1, id: "beat", sceneId: "payoff", component: "hero", kind: "animate", atSec: 5.2 }],
      interactions: [{
        version: 1, id: "click", sceneId: "payoff", cursorId: "cursor",
        targetPart: "hero", action: "click", startSec: 5, arriveSec: 5.2,
        pressSec: 5.3, releaseSec: 5.4, holdUntilSec: 5.8,
        from: "frame:center", path: "direct", aimX: 0.5, aimY: 0.5,
        feedback: "press",
      }],
      moments: [{
        version: 1, id: "payoff-moment", sceneId: "payoff", atSec: 5.8,
        title: "Payoff", visualState: "shipped", change: "shipped",
        motionIntent: "resolve", importance: "primary",
        evidence: { kind: "camera", detail: "camera:push", startSec: 5, endSec: 5.8 },
      }],
    },
  ];

  it("stretches one boundary and shifts all later absolute time owners atomically", () => {
    const before = structuredClone(scenes);
    const result = cascadeRetime(scenes, "setup", duration(1.25));
    expect(scenes).toEqual(before);
    expect(result.mapping.boundary).toBe(4);
    expect(result.mapping.shift(sourceTime(4))).toBe(5.25);
    expect(result.plan[0]!.durationSec).toBe(5.25);
    expect(result.plan[0]!.moments![0]!.atSec).toBe(3);
    expect(result.plan[0]!.cut).toEqual(scenes[0]!.cut);

    const shifted = result.plan[1]!;
    expect(shifted.startSec).toBe(5.25);
    expect(shifted.displayType!.atSec).toBe(5.45);
    expect(shifted.timeRamp!.atSec).toBe(6.25);
    expect(shifted.gradeShift!.atSec).toBe(6.75);
    expect(shifted.camera!.path[0]!.startSec).toBe(6.25);
    expect(shifted.beats![0]!.atSec).toBe(6.45);
    expect(shifted.interactions![0]).toMatchObject({
      startSec: 6.25, arriveSec: 6.45, pressSec: 6.55, releaseSec: 6.65,
      holdUntilSec: 7.05,
    });
    expect(shifted.moments![0]).toMatchObject({
      atSec: 7.05,
      evidence: { startSec: 6.25, endSec: 7.05 },
    });
    expect(resolveCutPlan(result.plan).cuts[0]!.atSec).toBe(5.25);
  });

  it("rejects an unknown scene without partially changing the plan", () => {
    expect(() => cascadeRetime(scenes, "missing", duration(1))).toThrow(/does not exist/);
    expect(scenes[1]!.startSec).toBe(4);
  });
});
