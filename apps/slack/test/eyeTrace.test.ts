import { describe, expect, it } from "vitest";
import {
  EYE_TRACE_JUMP_FRACTION,
  MATCH_EYE_TRACE_JUMP_FRACTION,
  PING_PONG_MAX_PAIRS,
  pingPongCandidates,
  resolveBoundaryAttention,
  scoreEyeTraceBoundaries,
  scorePingPongPair,
} from "../src/engine/eyeTrace.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import type { CameraPhrasePlanV1 } from "../src/engine/cameraPhrase.ts";
import type {
  BoundaryPartMeasurement,
  DirectBoundaryInventory,
} from "../src/engine/layoutInspector.ts";

const FRAME = { frameWidth: 1920, frameHeight: 1080 };

function scene(
  overrides: Partial<DirectScene> & Pick<DirectScene, "id" | "startSec" | "durationSec">,
): DirectScene {
  return { title: overrides.id, purpose: "test", ...overrides };
}

function part(
  name: string,
  left: number,
  top: number,
  overrides: Partial<BoundaryPartMeasurement> = {},
): BoundaryPartMeasurement {
  return {
    part: name,
    left,
    top,
    width: 200,
    height: 100,
    radiusPx: 8,
    nodeCount: 3,
    onFrameRatio: 1,
    ...overrides,
  };
}

function boundary(
  fromScene: string,
  toScene: string,
  outgoing: BoundaryPartMeasurement[],
  incoming: BoundaryPartMeasurement[],
): DirectBoundaryInventory {
  return { fromScene, toScene, atSec: 4, outgoing, incoming };
}

describe("resolveBoundaryAttention", () => {
  it("prefers declared cut focal parts on both sides", () => {
    const from = scene({
      id: "a",
      startSec: 0,
      durationSec: 4,
      cut: { version: 1, style: "shape-match", focalPartOut: "pill", focalPartIn: "card" },
      beats: [{ version: 1, id: "b", sceneId: "a", component: "other", kind: "highlight", atSec: 3 }],
      spatialIntent: { version: 1, focalPart: "hero", composition: "test", relationships: [] },
    });
    const to = scene({ id: "b", startSec: 4, durationSec: 4 });
    expect(resolveBoundaryAttention(from, to)).toEqual({ outPart: "pill", inPart: "card" });
  });

  it("falls back to the last beat's component, then the declared focal part", () => {
    const withBeats = scene({
      id: "a",
      startSec: 0,
      durationSec: 4,
      beats: [
        { version: 1, id: "b1", sceneId: "a", component: "first", kind: "highlight", atSec: 1 },
        { version: 1, id: "b2", sceneId: "a", component: "last", kind: "highlight", atSec: 3 },
      ],
      spatialIntent: { version: 1, focalPart: "hero", composition: "test", relationships: [] },
    });
    const to = scene({ id: "b", startSec: 4, durationSec: 4 });
    expect(resolveBoundaryAttention(withBeats, to).outPart).toBe("last");
    const beatless = scene({
      id: "a",
      startSec: 0,
      durationSec: 4,
      spatialIntent: { version: 1, focalPart: "hero", composition: "test", relationships: [] },
    });
    expect(resolveBoundaryAttention(beatless, to).outPart).toBe("hero");
    expect(resolveBoundaryAttention(scene({ id: "a", startSec: 0, durationSec: 4 }), to))
      .toEqual({});
  });

  it("resolves the incoming target to the entry station's hero, then the first beat", () => {
    const from = scene({ id: "a", startSec: 0, durationSec: 4 });
    const heroInStation = scene({
      id: "b",
      startSec: 4,
      durationSec: 4,
      camera: {
        version: 1,
        path: [
          { version: 1, move: "hold", toRegion: "entry", startSec: 4, durationSec: 1 },
          { version: 1, move: "pan", toRegion: "later", startSec: 5.5, durationSec: 1 },
        ],
      },
      components: [
        { version: 1, id: "far-hero", kind: "stat-card", region: "later", role: "hero" },
        { version: 1, id: "entry-hero", kind: "stat-card", region: "entry", role: "hero" },
      ],
    });
    expect(resolveBoundaryAttention(from, heroInStation).inPart).toBe("entry-hero");
    const beatsOnly = scene({
      id: "b",
      startSec: 4,
      durationSec: 4,
      beats: [
        { version: 1, id: "b1", sceneId: "b", component: "opener", kind: "highlight", atSec: 4.5 },
      ],
    });
    expect(resolveBoundaryAttention(from, beatsOnly).inPart).toBe("opener");
  });

  it("uses the canonical executed phrases instead of a conflicting raw camera path", () => {
    const from = scene({
      id: "a",
      startSec: 0,
      durationSec: 4,
      beats: [{ version: 1, id: "old-out", sceneId: "a", component: "old-out", kind: "highlight", atSec: 3 }],
    });
    const to = scene({
      id: "b",
      startSec: 4,
      durationSec: 4,
      camera: {
        version: 1,
        path: [{ version: 1, move: "pan", toPart: "wrong-raw-target", startSec: 4, durationSec: 1 }],
      },
    });
    const phrases = {
      version: 1,
      enabled: true,
      scenes: [
        { sceneId: "a", phrases: [{
          target: { kind: "part", id: "executed-out" },
          dwell: { endSec: 3.8 },
          travel: { startSec: 2.5 },
          arrivalSec: 3,
        }] },
        { sceneId: "b", phrases: [{
          target: { kind: "part", id: "executed-in" },
          dwell: { endSec: 5.5 },
          travel: { startSec: 4 },
          arrivalSec: 4.5,
        }] },
      ],
    } as unknown as CameraPhrasePlanV1;
    expect(resolveBoundaryAttention(from, to, phrases)).toEqual({
      outPart: "executed-out",
      inPart: "executed-in",
    });
  });
});

describe("scoreEyeTraceBoundaries", () => {
  const hardCutScenes = (style?: DirectScene["cut"]): DirectScene[] => [
    scene({
      id: "a",
      startSec: 0,
      durationSec: 4,
      spatialIntent: { version: 1, focalPart: "out-part", composition: "test", relationships: [] },
      ...(style ? { cut: style } : {}),
    }),
    scene({
      id: "b",
      startSec: 4,
      durationSec: 4,
      components: [{ version: 1, id: "in-part", kind: "stat-card", role: "hero" }],
    }),
  ];
  const farApart = [boundary(
    "a",
    "b",
    [part("out-part", 100, 100)],
    [part("in-part", 1600, 880)],
  )];

  it("flags a corner-to-corner jump across a hard cut with measured centers", () => {
    const findings = scoreEyeTraceBoundaries({
      scenes: hardCutScenes({ version: 1, style: "hard" }),
      boundaries: farApart,
      ...FRAME,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.displacementFraction).toBeGreaterThan(EYE_TRACE_JUMP_FRACTION);
    expect(findings[0]!.outPart).toBe("out-part");
    expect(findings[0]!.inPart).toBe("in-part");
    expect(findings[0]!.cutStyle).toBe("hard");
    // An undeclared boundary (authored crossfade) is judged the same way.
    expect(scoreEyeTraceBoundaries({
      scenes: hardCutScenes(),
      boundaries: farApart,
      ...FRAME,
    })).toHaveLength(1);
  });

  it("exempts directional, zoom, bridged, and flash cuts — they carry or reset the eye", () => {
    for (const style of ["cut-right", "swipe", "zoom-through", "inverse-zoom", "flash-white"] as const) {
      expect(scoreEyeTraceBoundaries({
        scenes: hardCutScenes({ version: 1, style }),
        boundaries: farApart,
        ...FRAME,
      })).toEqual([]);
    }
  });

  it("judges a hard-form match at the tightened budget and exempts a bridged match", () => {
    // ~24% of the diagonal: inside the ordinary 38% hard-cut budget, but well
    // past the 20% budget the match promise is judged against.
    const midDistance = [boundary(
      "a",
      "b",
      [part("out-part", 500, 400)],
      [part("in-part", 980, 620)],
    )];
    const hardFindings = scoreEyeTraceBoundaries({
      scenes: hardCutScenes({ version: 1, style: "hard" }),
      boundaries: midDistance,
      ...FRAME,
    });
    expect(hardFindings).toEqual([]);
    const matchFindings = scoreEyeTraceBoundaries({
      scenes: hardCutScenes({ version: 1, style: "match", focalPartIn: "in-part" }),
      boundaries: midDistance,
      ...FRAME,
    });
    expect(matchFindings).toHaveLength(1);
    expect(matchFindings[0]!.cutStyle).toBe("match");
    expect(matchFindings[0]!.budgetFraction).toBe(MATCH_EYE_TRACE_JUMP_FRACTION);
    // A bridged match flies a real bridge — the bridge carries the eye.
    expect(scoreEyeTraceBoundaries({
      scenes: hardCutScenes({
        version: 1,
        style: "match",
        focalPartOut: "out-part",
        focalPartIn: "in-part",
      }),
      boundaries: farApart,
      ...FRAME,
    })).toEqual([]);
  });

  it("stays silent when the targets already share a neighborhood", () => {
    expect(scoreEyeTraceBoundaries({
      scenes: hardCutScenes({ version: 1, style: "hard" }),
      boundaries: [boundary(
        "a",
        "b",
        [part("out-part", 500, 400)],
        [part("in-part", 900, 500)],
      )],
      ...FRAME,
    })).toEqual([]);
  });

  it("stays silent when either attention target was not measured mostly on frame", () => {
    expect(scoreEyeTraceBoundaries({
      scenes: hardCutScenes({ version: 1, style: "hard" }),
      boundaries: [boundary(
        "a",
        "b",
        [part("out-part", 100, 100, { onFrameRatio: 0.1 })],
        [part("in-part", 1600, 880)],
      )],
      ...FRAME,
    })).toEqual([]);
    expect(scoreEyeTraceBoundaries({
      scenes: hardCutScenes({ version: 1, style: "hard" }),
      boundaries: [boundary("a", "b", [], [part("in-part", 1600, 880)])],
      ...FRAME,
    })).toEqual([]);
  });
});

describe("ping-pong candidates and scoring", () => {
  it("selects consecutive different-component beats inside the window", () => {
    const scenes = [scene({
      id: "s",
      startSec: 0,
      durationSec: 6,
      beats: [
        // 0.6s apart, different components → candidate.
        { version: 1, id: "b1", sceneId: "s", component: "left", kind: "highlight", atSec: 1 },
        { version: 1, id: "b2", sceneId: "s", component: "right", kind: "highlight", atSec: 1.6 },
        // Same component → never a candidate.
        { version: 1, id: "b3", sceneId: "s", component: "right", kind: "count", atSec: 2.2 },
        // 0.1s apart is a deliberate cascade ensemble, not two eye targets.
        { version: 1, id: "b4", sceneId: "s", component: "left", kind: "highlight", atSec: 2.3 },
        // 2s apart is deliberate sequencing.
        { version: 1, id: "b5", sceneId: "s", component: "right", kind: "highlight", atSec: 4.3 },
      ],
    })];
    const candidates = pingPongCandidates(scenes);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      sceneId: "s",
      firstPart: "left",
      secondPart: "right",
      viewerGapSec: 0.6,
      // Each target sampled just after ITS OWN beat — never one shared seek.
      firstMeasureAtSec: 1.15,
      secondMeasureAtSec: 1.75,
    });
  });

  it("judges the ping-pong window in viewer time under a slow-motion ramp", () => {
    // 1.0s content gap — inside the window raw, but the dip between the two
    // beats stretches it well past 1.2s for the viewer → not a candidate.
    const build = (withRamp: boolean) => [
      scene({ id: "opener", startSec: 0, durationSec: 4 }),
      scene({
        id: "s",
        startSec: 4,
        durationSec: 8,
        ...(withRamp
          ? {
              timeRamp: {
                version: 1 as const,
                atSec: 5.1,
                slowTo: 0.2,
                holdSec: 0.9,
                recoverSec: 1.2,
              },
            }
          : {}),
        beats: [
          { version: 1 as const, id: "b1", sceneId: "s", component: "left", kind: "highlight" as const, atSec: 5 },
          { version: 1 as const, id: "b2", sceneId: "s", component: "right", kind: "highlight" as const, atSec: 6 },
        ],
      }),
    ];
    expect(pingPongCandidates(build(false))).toHaveLength(1);
    expect(pingPongCandidates(build(true))).toEqual([]);
  });

  it("caps the measurement budget per film", () => {
    const beats = Array.from({ length: 24 }, (_, index) => ({
      version: 1 as const,
      id: `b${index}`,
      sceneId: "s",
      component: index % 2 ? "left" : "right",
      kind: "highlight" as const,
      atSec: 0.5 + index * 0.5,
    }));
    const candidates = pingPongCandidates([
      scene({ id: "s", startSec: 0, durationSec: 14, beats }),
    ]);
    expect(candidates).toHaveLength(PING_PONG_MAX_PAIRS);
  });

  it("scores measured centers against the frame diagonal", () => {
    const candidate = pingPongCandidates([scene({
      id: "s",
      startSec: 0,
      durationSec: 6,
      beats: [
        { version: 1, id: "b1", sceneId: "s", component: "left", kind: "highlight", atSec: 1 },
        { version: 1, id: "b2", sceneId: "s", component: "right", kind: "highlight", atSec: 1.6 },
      ],
    })])[0]!;
    const flagged = scorePingPongPair(
      candidate,
      { first: { x: 200, y: 200 }, second: { x: 1700, y: 900 } },
      1920,
      1080,
    );
    expect(flagged?.displacementFraction).toBeGreaterThan(0.5);
    expect(scorePingPongPair(
      candidate,
      { first: { x: 700, y: 500 }, second: { x: 1100, y: 600 } },
      1920,
      1080,
    )).toBeUndefined();
    expect(scorePingPongPair(
      candidate,
      { second: { x: 1100, y: 600 } },
      1920,
      1080,
    )).toBeUndefined();
  });
});
