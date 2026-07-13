import { describe, expect, it } from "vitest";
import type { DirectBrowserQaResult, DirectLayoutIssue } from "../src/engine/layoutInspector.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { correctEyeTracePingPong } from "../src/engine/eyeTraceRepair.ts";

function finding(overrides: Partial<NonNullable<DirectLayoutIssue["eyeTracePingPong"]>> = {}): DirectLayoutIssue {
  const evidence = {
    sceneId: "close",
    firstBeatId: "subtitle",
    secondBeatId: "metric",
    firstPart: "cta-sub",
    secondPart: "hero-metric",
    firstAtSec: 16.65,
    secondAtSec: 17,
    viewerGapSec: 0.35,
    displacementFraction: 0.66,
    firstCenter: { x: 1500, y: 820 },
    secondCenter: { x: 520, y: 360 },
    ...overrides,
  };
  return {
    code: "eye_trace_pingpong",
    severity: "warning",
    time: evidence.secondAtSec,
    selector: `[data-part="${evidence.secondPart}"]`,
    message: "measured ping-pong",
    source: "sequences",
    eyeTracePingPong: evidence,
  };
}

function qa(issue: DirectLayoutIssue): DirectBrowserQaResult {
  return {
    ok: true,
    strictOk: false,
    samples: [],
    issues: [issue],
    interactions: [],
    errors: [],
    warnings: [],
  };
}

function roamlyScene(): DirectScene {
  return {
    id: "close",
    title: "Close",
    purpose: "Metric and CTA",
    startSec: 15.6,
    durationSec: 5.8,
    components: [
      { version: 1, id: "cta-sub", kind: "headline", role: "support" },
      { version: 1, id: "hero-metric", kind: "stat-card", role: "hero" },
    ],
    beats: [
      {
        version: 1,
        id: "subtitle",
        sceneId: "close",
        component: "cta-sub",
        kind: "type",
        text: "One calm click.",
        atSec: 16.65,
        durationSec: 1.76,
      },
      {
        version: 1,
        id: "metric",
        sceneId: "close",
        component: "hero-metric",
        kind: "count",
        value: 99,
        atSec: 17,
        durationSec: 1.6,
      },
    ],
  };
}

describe("bounded eye-trace schedule repair", () => {
  it("compresses the measured Roamly pair into one intentional ensemble", () => {
    const result = correctEyeTracePingPong([roamlyScene()], qa(finding()));
    expect(result.corrected).toEqual(["close:subtitle->metric"]);
    expect(result.storyboard[0]!.beats?.find((beat) => beat.id === "subtitle")?.atSec)
      .toBeCloseTo(16.8, 3);
    expect(result.storyboard[0]!.beats?.find((beat) => beat.id === "metric")?.atSec).toBe(17);
    expect(result.storyboard[0]!.sentinelNormalizations?.at(-1)).toContain("eye-trace ensemble");
  });

  it("retimes a later beat after an earlier interaction on the same component has settled", () => {
    const scene = roamlyScene();
    scene.interactions = [{
      version: 1,
      id: "earlier-subtitle-click",
      sceneId: "close",
      cursorId: "default",
      targetPart: "cta-sub",
      action: "click",
      startSec: 15.6,
      arriveSec: 15.8,
      pressSec: 15.9,
      releaseSec: 16,
      from: "frame:left-third",
      path: "direct",
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press-ripple",
    }];
    const result = correctEyeTracePingPong([scene], qa(finding()));
    expect(result.corrected).toEqual(["close:subtitle->metric"]);
    expect(result.storyboard[0]!.beats?.find((beat) => beat.id === "subtitle")?.atSec)
      .toBeCloseTo(16.8, 3);
  });

  it("resolves an A-B-A sequence before handing attention to B", () => {
    const scene = roamlyScene();
    scene.beats!.push({
      version: 1,
      id: "subtitle-resolved",
      sceneId: "close",
      component: "cta-sub",
      kind: "set-state",
      toState: "resolved",
      atSec: 17.2,
      durationSec: 0.5,
    });
    const result = correctEyeTracePingPong([scene], qa(finding()));
    expect(result.corrected).toEqual(["close:subtitle->metric"]);
    expect(result.storyboard[0]!.beats?.find((beat) => beat.id === "subtitle")?.atSec)
      .toBe(16.65);
    expect(result.storyboard[0]!.beats?.find((beat) => beat.id === "subtitle-resolved")?.atSec)
      .toBe(16.95);
    expect(result.storyboard[0]!.sentinelNormalizations?.at(-1)).toContain("A-B-A ping-pong");
  });

  it("separates the second beat when the first is stateful and cannot be retimed", () => {
    const scene = roamlyScene();
    scene.startSec = 0;
    scene.durationSec = 6;
    scene.components![0] = { version: 1, id: "cta-sub", kind: "button", role: "support" };
    scene.beats = [
      { ...scene.beats![0]!, kind: "press", atSec: 2, durationSec: 0.5 },
      { ...scene.beats![1]!, atSec: 2.4, durationSec: 1 },
    ];
    const issue = finding({ firstAtSec: 2, secondAtSec: 2.4, viewerGapSec: 0.4 });
    const result = correctEyeTracePingPong([scene], qa(issue));
    expect(result.storyboard[0]!.beats?.find((beat) => beat.id === "subtitle")?.atSec).toBe(2);
    expect(result.storyboard[0]!.beats?.find((beat) => beat.id === "metric")?.atSec)
      .toBeGreaterThanOrEqual(3.32);
  });

  it("declines a retime that would sever a moment evidence binding", () => {
    const scene = roamlyScene();
    scene.moments = [{
      version: 1,
      id: "subtitle-proof",
      sceneId: "close",
      atSec: 15.9,
      title: "Subtitle lands",
      visualState: "subtitle is readable",
      change: "the supporting promise appears",
      motionIntent: "type",
      importance: "supporting",
    }];
    // The first beat cannot shift past 16.65 without losing this moment, and
    // the metric is also interaction-owned, so neither bounded route is safe.
    scene.interactions = [{
      version: 1,
      id: "metric-click",
      sceneId: "close",
      cursorId: "default",
      targetPart: "hero-metric",
      action: "click",
      startSec: 16.7,
      arriveSec: 17,
      pressSec: 17.1,
      releaseSec: 17.2,
      from: "frame:right-third",
      path: "arc",
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press-ripple",
    }];
    const before = [scene];
    const result = correctEyeTracePingPong(before, qa(finding()));
    expect(result.corrected).toEqual([]);
    expect(result.storyboard).toBe(before);
    expect(result.storyboard[0]!.beats?.map((beat) => beat.atSec)).toEqual([16.65, 17]);
  });
});
