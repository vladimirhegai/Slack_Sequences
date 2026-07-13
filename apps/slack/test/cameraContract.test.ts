import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CAMERA_FULL_MOVES,
  CAMERA_RUNTIME_FILE,
  HIGH_ENERGY_PUSH_ZOOM,
  SEQUENCES_EASES,
  alignCameraDestinationsWithLateEntrances,
  ensureCameraBlockingChassis,
  auditCameraEnergy,
  cameraMotionWindows,
  cameraRuntimeSource,
  liftCameraEnergyPeak,
  normalizeStoryboardCameraIntent,
  parseCameraPlan,
  reserveFinalCameraLanding,
  resolveCameraPlan,
  topUpRequiredRackFocus,
  normalizeConnectiveCameraSchedule,
  upgradeCrossStationDrifts,
  validateCameraContract,
} from "../src/engine/cameraContract.ts";
import { buildFallbackComposition } from "../src/engine/fallbackComposition.ts";
import { analyzeMotionDensity } from "../src/engine/motionDensity.ts";
import { delayConflictingCameraMoves } from "../src/engine/pacingAudit.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";

function scene(
  overrides: Partial<DirectScene> & Pick<DirectScene, "id" | "startSec" | "durationSec">,
): DirectScene {
  return {
    title: overrides.id,
    purpose: "test",
    ...overrides,
  };
}

const window = { startSec: 0, durationSec: 8 };

describe("normalizeStoryboardCameraIntent", () => {
  it("keeps known moves, clamps timing into the scene window, and sorts", () => {
    const camera = normalizeStoryboardCameraIntent({
      version: 1,
      path: [
        { version: 1, move: "whip", toRegion: "metrics", startSec: 3, durationSec: 0.5 },
        { version: 1, move: "hold", toRegion: "hero", startSec: 0, durationSec: 20 },
      ],
    }, window);
    expect(camera?.path.map((move) => move.move)).toEqual(["hold", "whip"]);
    expect(camera?.path[0]).toMatchObject({ startSec: 0, durationSec: 8 });
  });

  it("degrades unusable declarations to no camera plan instead of failing", () => {
    expect(normalizeStoryboardCameraIntent(undefined, window)).toBeUndefined();
    expect(normalizeStoryboardCameraIntent({ version: 1, path: [] }, window)).toBeUndefined();
    expect(normalizeStoryboardCameraIntent({
      version: 1,
      path: [{ version: 1, move: "spin", toRegion: "hero", startSec: 0, durationSec: 2 }],
    }, window)).toBeUndefined();
    // A path that never names a region or part cannot bind to the world.
    expect(normalizeStoryboardCameraIntent({
      version: 1,
      path: [{ version: 1, move: "hold", startSec: 0, durationSec: 2 }],
    }, window)).toBeUndefined();
    // track-to-anchor without a part is meaningless.
    expect(normalizeStoryboardCameraIntent({
      version: 1,
      path: [{ version: 1, move: "track-to-anchor", toRegion: "hero", startSec: 0, durationSec: 2 }],
    }, window)).toBeUndefined();
  });

  it("binds a targetless authored route to an explicit typed focal fallback", () => {
    const camera = normalizeStoryboardCameraIntent({
      version: 1,
      path: [
        { version: 1, move: "hold", startSec: 0, durationSec: 1.6 },
        { version: 1, move: "push-in", startSec: 1.6, durationSec: 2.4 },
      ],
    }, window, { toPart: "metric-ring" });
    expect(camera?.path).toMatchObject([
      { move: "hold", toPart: "metric-ring" },
      { move: "push-in", toPart: "metric-ring" },
    ]);
    // The fallback never overrides a route that already names its station.
    expect(normalizeStoryboardCameraIntent({
      version: 1,
      path: [{ version: 1, move: "pan", toRegion: "proof", startSec: 0, durationSec: 2 }],
    }, window, { toPart: "metric-ring" })?.path[0]).toMatchObject({
      toRegion: "proof",
    });
    expect(normalizeStoryboardCameraIntent({
      version: 1,
      path: [{ version: 1, move: "hold", startSec: 0, durationSec: 2 }],
    }, window, { toPart: "Bad focal!" })).toBeUndefined();
  });

  it("rejects unknown eases and non-kebab station names", () => {
    const camera = normalizeStoryboardCameraIntent({
      version: 1,
      path: [{
        version: 1,
        move: "pan",
        toRegion: "hero",
        startSec: 0,
        durationSec: 2,
        ease: "totallyMadeUp",
      }],
    }, window);
    expect(camera?.path[0]?.ease).toBeUndefined();
    expect(normalizeStoryboardCameraIntent({
      version: 1,
      path: [{ version: 1, move: "pan", toRegion: "Hero Station!", startSec: 0, durationSec: 2 }],
    }, window)).toBeUndefined();
  });

  it("normalizes orbit arcs and rack-focus modifiers with hard clamps", () => {
    const camera = normalizeStoryboardCameraIntent({
      version: 1,
      path: [
        {
          version: 1,
          move: "orbit",
          toRegion: "logo-stage",
          startSec: 0,
          durationSec: 2,
          arcDeg: 90,
          focus: { part: "brand-mark", blurMaxPx: 40 },
        },
        {
          version: 1,
          move: "drift",
          toRegion: "logo-stage",
          startSec: 2,
          durationSec: 2,
          focus: { depth: 3 },
        },
      ],
    }, window);
    expect(camera?.path[0]).toMatchObject({
      move: "orbit",
      arcDeg: 35,
      focus: { part: "brand-mark", blurMaxPx: 10 },
    });
    // Explicit depth clamps to 0..1 and gets the default blur ceiling.
    expect(camera?.path[1]?.focus).toEqual({ depth: 1, blurMaxPx: 6 });
    // arcDeg is orbit-only; a focus naming neither part nor depth degrades away.
    const stray = normalizeStoryboardCameraIntent({
      version: 1,
      path: [{
        version: 1,
        move: "pan",
        toRegion: "hero",
        startSec: 0,
        durationSec: 2,
        arcDeg: 20,
        focus: { blurMaxPx: 8 },
      }],
    }, window);
    expect(stray?.path[0]?.arcDeg).toBeUndefined();
    expect(stray?.path[0]?.focus).toBeUndefined();
  });

  it("keeps depth3d only when the merged path carries an orbit", () => {
    const withOrbit = normalizeStoryboardCameraIntent({
      version: 1,
      depth3d: true,
      path: [
        { version: 1, move: "orbit", toRegion: "logo-stage", startSec: 1, durationSec: 2 },
      ],
    }, window);
    expect(withOrbit?.depth3d).toBe(true);
    // Volunteered on an orbit-less path: degrade the flag, never the plan.
    const flat = normalizeStoryboardCameraIntent({
      version: 1,
      depth3d: true,
      path: [
        { version: 1, move: "pan", toRegion: "hero", startSec: 1, durationSec: 2 },
      ],
    }, window);
    expect(flat).toBeDefined();
    expect(flat?.depth3d).toBeUndefined();
  });

  it("recovers scene-relative camera times in later shots", () => {
    const camera = normalizeStoryboardCameraIntent({
      version: 1,
      path: [
        { version: 1, move: "pan", toRegion: "trace", startSec: 0.4, durationSec: 0.8 },
        { version: 1, move: "push-in", toRegion: "risk", startSec: 2.1, durationSec: 0.7 },
      ],
    }, { startSec: 8, durationSec: 5 });
    expect(camera?.path).toMatchObject([
      { move: "pan", toRegion: "trace", startSec: 8.4, durationSec: 0.8 },
      { move: "push-in", toRegion: "risk", startSec: 10.1, durationSec: 0.7 },
    ]);
  });
});

describe("Sentinel — alignCameraDestinationsWithLateEntrances", () => {
  it("delays an early cross-station move until its gated destination becomes readable", () => {
    const storyboard = [scene({
      id: "timeline",
      startSec: 6,
      durationSec: 5,
      components: [
        { version: 1, id: "timeline-list", kind: "list", region: "head", role: "hero" },
        { version: 1, id: "publish-btn", kind: "button", region: "foot", role: "hero" },
      ],
      beats: [{
        version: 1,
        id: "publish-open",
        sceneId: "timeline",
        component: "publish-btn",
        kind: "open",
        atSec: 9.2,
        durationSec: 0.5,
      }],
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "whip",
          fromRegion: "head",
          toRegion: "foot",
          startSec: 6,
          durationSec: 1.2,
        }],
      },
    })];
    const result = alignCameraDestinationsWithLateEntrances(storyboard);
    expect(result.normalized).toHaveLength(1);
    expect(result.storyboard[0]!.camera!.path[0]!.startSec).toBeCloseTo(8.54, 2);
    expect(result.normalized[0]).toContain("on-frame when it becomes readable");
    expect(alignCameraDestinationsWithLateEntrances(result.storyboard).normalized).toEqual([]);
  });

  it("preserves an establishing move when any destination surface is already visible", () => {
    const established = scene({
      id: "proof",
      startSec: 0,
      durationSec: 6,
      components: [
        { version: 1, id: "panel", kind: "app-window", region: "proof" },
        { version: 1, id: "metric", kind: "stat-card", region: "proof" },
      ],
      beats: [{
        version: 1,
        id: "metric-open",
        sceneId: "proof",
        component: "metric",
        kind: "open",
        atSec: 4,
        durationSec: 0.5,
      }],
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "pan",
          toRegion: "proof",
          startSec: 0,
          durationSec: 1,
        }],
      },
    });
    expect(alignCameraDestinationsWithLateEntrances([established])).toEqual({
      storyboard: [established],
      normalized: [],
    });
  });

  it("rechecks payoff holds after destination alignment moves the lens", () => {
    const storyboard = [scene({
      id: "timeline",
      startSec: 6,
      durationSec: 5,
      components: [
        { version: 1, id: "timeline-list", kind: "list", region: "head", role: "hero" },
        { version: 1, id: "publish-btn", kind: "button", region: "foot", role: "hero" },
      ],
      beats: [
        { version: 1, id: "assign", sceneId: "timeline", component: "timeline-list", kind: "set-state", atSec: 8.1, durationSec: 0.5 },
        { version: 1, id: "open", sceneId: "timeline", component: "publish-btn", kind: "open", atSec: 9.2, durationSec: 0.5 },
        { version: 1, id: "press", sceneId: "timeline", component: "publish-btn", kind: "press", atSec: 9.7, durationSec: 0.4 },
      ],
      camera: {
        version: 1,
        path: [{ version: 1, move: "whip", fromRegion: "head", toRegion: "foot", startSec: 6, durationSec: 1.2 }],
      },
    })];
    const aligned = alignCameraDestinationsWithLateEntrances(storyboard);
    expect(aligned.storyboard[0]!.camera!.path[0]!.startSec).toBeCloseTo(8.54, 2);
    const protectedResult = delayConflictingCameraMoves(aligned.storyboard);
    expect(protectedResult.storyboard[0]!.camera!.path[0]!.startSec).toBeCloseTo(9.4, 2);
    expect(protectedResult.storyboard[0]!.durationSec).toBe(5);
    expect(protectedResult.normalized[0]).toContain("payoff/copy holds");
  });
});

describe("Sentinel — ensureCameraBlockingChassis", () => {
  it("adds only the neutral transform chassis needed by host blocking", () => {
    const cameraLess = scene({
      id: "proof",
      startSec: 3,
      durationSec: 4,
      components: [{ version: 1, id: "metric", kind: "stat-card", role: "hero" }],
      spatialIntent: { version: 1, focalPart: "metric", composition: "centered", relationships: [] },
    });
    const result = ensureCameraBlockingChassis([cameraLess]);
    expect(result.normalized).toHaveLength(1);
    expect(result.storyboard[0]!.camera!.path).toEqual([{
      version: 1,
      move: "hold",
      startSec: 3,
      durationSec: 4,
      toPart: "metric",
      zoom: 1,
    }]);
    expect(ensureCameraBlockingChassis(result.storyboard).normalized).toEqual([]);
  });
});

describe("resolveCameraPlan", () => {
  it("turns resolver-owned travel into a hold while a dominant payoff settles", () => {
    const plan = resolveCameraPlan([scene({
      id: "directed-journey",
      startSec: 0,
      durationSec: 6,
      spatialIntent: {
        version: 1,
        focalPart: "proof-stat",
        composition: "metric first, destination second",
        relationships: [],
      },
      components: [{ version: 1, id: "proof-stat", kind: "stat-card" }],
      beats: [{
        version: 1,
        id: "proof-count",
        sceneId: "directed-journey",
        component: "proof-stat",
        kind: "count",
        atSec: 1.5,
        durationSec: 1,
        value: 99,
      }],
      moments: [{
        version: 1,
        id: "proof-lands",
        sceneId: "directed-journey",
        atSec: 2.5,
        title: "Proof lands",
        visualState: "99 is visible",
        change: "The number completed",
        motionIntent: "ui-state",
        importance: "primary",
      }],
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "pan",
          toRegion: "details",
          startSec: 4.5,
          durationSec: 1,
        }],
      },
    })]);

    const segments = plan.scenes[0]!.segments;
    const hold = segments.find((segment) =>
      segment.move === "hold" && segment.startSec >= 2.5 - 0.01
    );
    expect(hold).toMatchObject({ startSec: 2.5, endSec: 3.05, blend: 0 });
    expect(segments.some((segment) => segment.move === "pan" && segment.startSec === 4.5))
      .toBe(true);
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index]!.startSec).toBe(segments[index - 1]!.endSec);
    }
  });

  it("builds a contiguous chain covering the scene and fills gaps with drift", () => {
    const plan = resolveCameraPlan([
      scene({
        id: "journey",
        startSec: 0,
        durationSec: 10,
        camera: {
          version: 1,
          path: [
            { version: 1, move: "hold", toRegion: "hero", startSec: 0, durationSec: 1 },
            { version: 1, move: "whip", toRegion: "metrics", startSec: 3, durationSec: 0.5 },
          ],
        },
      }),
    ]);
    expect(plan.scenes).toHaveLength(1);
    const segments = plan.scenes[0]!.segments;
    // The fill before a whip is split: approach drift, then a short
    // seqAnticipate wind-up that dips the camera backward before the commit;
    // the direction score then gives the arrival a real settle hold.
    expect(segments.map((segment) => segment.move))
      .toEqual(["hold", "drift", "drift", "whip", "hold", "drift"]);
    // Contiguous and covering [0, 10].
    expect(segments[0]!.startSec).toBe(0);
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index]!.startSec).toBe(segments[index - 1]!.endSec);
    }
    expect(segments[segments.length - 1]!.endSec).toBe(10);
    // The gap drift approaches the upcoming framing; the tail settles, then creeps.
    expect(segments[1]).toMatchObject({ toRegion: "metrics", blend: 0.24 });
    expect(segments[2]).toMatchObject({
      move: "drift",
      ease: "seqAnticipate",
      blend: 0.06,
      toRegion: "metrics",
    });
    expect(segments[2]!.endSec - segments[2]!.startSec).toBeCloseTo(0.22, 5);
    expect(segments[4]).toMatchObject({
      move: "hold",
      startSec: 3.5,
      toRegion: "metrics",
      blend: 0,
    });
    expect(segments[5]).toMatchObject({ toRegion: "metrics", blend: 0 });
  });

  it("reserves reverse anticipation for whips, not ordinary pushes or tracks", () => {
    const plan = resolveCameraPlan([
      scene({
        id: "operated",
        startSec: 0,
        durationSec: 8,
        camera: {
          version: 1,
          path: [
            { version: 1, move: "push-in", toRegion: "hero", startSec: 2, durationSec: 1 },
            { version: 1, move: "track-to-anchor", toPart: "cta", startSec: 5, durationSec: 1 },
          ],
        },
      }),
    ]);
    const segments = plan.scenes[0]!.segments;
    expect(segments.filter((segment) => segment.ease === "seqAnticipate")).toEqual([]);
    expect(segments.some((segment) => segment.move === "drift" && segment.blend === 0.24)).toBe(true);
  });

  it("starts a delayed first move on the scene focal instead of its future destination", () => {
    const plan = resolveCameraPlan([
      scene({
        id: "proof",
        startSec: 10,
        durationSec: 5,
        spatialIntent: {
          version: 1,
          focalPart: "laurel",
          composition: "laurel first, rating second",
          relationships: ["rating supports laurel"],
        },
        camera: {
          version: 1,
          path: [{
            version: 1,
            move: "track-to-anchor",
            toPart: "rating",
            startSec: 12,
            durationSec: 1.2,
          }],
        },
      }),
    ]);
    const segments = plan.scenes[0]!.segments;
    expect(segments[0]).toMatchObject({
      move: "drift",
      fromPart: "laurel",
      toPart: "rating",
      blend: 0.24,
    });
    expect(segments.find((segment) => segment.move === "track-to-anchor"))
      .toMatchObject({ toPart: "rating" });
  });

  it("establishes an immediate first station instead of opening on a later scene focal", () => {
    const plan = resolveCameraPlan([
      scene({
        id: "signals",
        startSec: 3.5,
        durationSec: 5,
        spatialIntent: {
          version: 1,
          focalPart: "later-metric",
          composition: "feed first, metric second",
          relationships: ["the feed motivates the metric"],
        },
        camera: {
          version: 1,
          path: [{
            version: 1,
            move: "drift",
            toRegion: "signal-feed",
            startSec: 3.5,
            durationSec: 1.5,
          }, {
            version: 1,
            move: "pan",
            toRegion: "later-metric",
            startSec: 5,
            durationSec: 2,
          }],
        },
      }),
    ]);
    expect(plan.scenes[0]!.segments[0]).toMatchObject({
      move: "drift",
      fromRegion: "signal-feed",
      toRegion: "signal-feed",
    });
  });

  it("honors an explicit entry frame before the scene focal fallback", () => {
    const plan = resolveCameraPlan([
      scene({
        id: "tour",
        startSec: 0,
        durationSec: 5,
        spatialIntent: {
          version: 1,
          focalPart: "fallback",
          composition: "explicit entry wins",
          relationships: ["start before destination"],
        },
        camera: {
          version: 1,
          path: [{
            version: 1,
            move: "pan",
            fromPart: "explicit-entry",
            toPart: "destination",
            startSec: 1,
            durationSec: 1,
          }],
        },
      }),
    ]);
    expect(plan.scenes[0]!.segments[0]!.fromPart).toBe("explicit-entry");
  });

  it("applies per-move zoom and ease defaults", () => {
    const plan = resolveCameraPlan([
      scene({
        id: "s",
        startSec: 0,
        durationSec: 6,
        camera: {
          version: 1,
          path: [
            { version: 1, move: "push-in", toRegion: "hero", startSec: 0, durationSec: 2 },
            { version: 1, move: "pull-back", toRegion: "hero", startSec: 2, durationSec: 2 },
            { version: 1, move: "whip", toRegion: "cta", startSec: 4, durationSec: 2 },
          ],
        },
      }),
    ]);
    const segments = plan.scenes[0]!.segments;
    expect(segments[0]).toMatchObject({ move: "push-in", zoom: 1.22, ease: "seqSettle" });
    expect(segments[1]).toMatchObject({ move: "pull-back", zoom: 0.8, ease: "seqSettle" });
    // whip durations are clamped hard — a 2s whip is not a whip.
    const whip = segments.find((segment) => segment.move === "whip")!;
    expect(whip.endSec - whip.startSec).toBeLessThanOrEqual(1.1);
    expect(whip.ease).toBe("seqWhip");
  });

  it("produces no plan for scenes without camera intents", () => {
    expect(resolveCameraPlan([scene({ id: "plain", startSec: 0, durationSec: 5 })]).scenes)
      .toEqual([]);
  });

  it("carries orbit arc + focus through resolve and the island round-trip", () => {
    const plan = resolveCameraPlan([
      scene({
        id: "hero",
        startSec: 0,
        durationSec: 6,
        camera: {
          version: 1,
          path: [
            { version: 1, move: "orbit", toRegion: "logo-stage", startSec: 0, durationSec: 2 },
            {
              version: 1,
              move: "push-in",
              toRegion: "logo-stage",
              startSec: 3,
              durationSec: 1.5,
              focus: { part: "brand-mark", blurMaxPx: 8 },
            },
          ],
        },
      }),
    ]);
    const orbit = plan.scenes[0]!.segments.find((segment) => segment.move === "orbit")!;
    expect(orbit).toMatchObject({ arcDeg: 28, zoom: 1.06, ease: "seqGlide" });
    const push = plan.scenes[0]!.segments.find((segment) => segment.move === "push-in")!;
    expect(push.focus).toEqual({ part: "brand-mark", blurMaxPx: 8 });
    // Gap fills never inherit the focus modifier.
    expect(
      plan.scenes[0]!.segments.filter((segment) => segment.move === "drift" && segment.focus),
    ).toEqual([]);
    const parsed = parseCameraPlan(
      `<script type="application/json" id="sequences-camera">${JSON.stringify(plan)}</script>`,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.plan).toEqual(plan);
  });

  it("carries host sparse-framing corrections through the island round-trip", () => {
    const plan = resolveCameraPlan([
      scene({
        id: "hero",
        startSec: 0,
        durationSec: 4,
        camera: {
          version: 1,
          path: [{
            version: 1,
            move: "pan",
            toRegion: "hero-card",
            startSec: 0.4,
            durationSec: 1,
            zoom: 1.34,
            framingCorrection: "camera-sparse-zoom",
          }],
        },
      }),
    ]);
    const segment = plan.scenes[0]!.segments.find((entry) => entry.move === "pan")!;
    expect(segment.framingCorrection).toBe("camera-sparse-zoom");
    const parsed = parseCameraPlan(
      `<script type="application/json" id="sequences-camera">${JSON.stringify(plan)}</script>`,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.plan).toEqual(plan);
  });

  it("carries depth3d through resolve and a byte-equal island round-trip", () => {
    const scenes = [
      scene({
        id: "hero",
        startSec: 0,
        durationSec: 6,
        camera: {
          version: 1,
          depth3d: true,
          path: [
            { version: 1, move: "orbit", toRegion: "logo-stage", startSec: 0, durationSec: 2 },
          ],
        },
      }),
    ];
    const plan = resolveCameraPlan(scenes);
    expect(plan.scenes[0]!.depth3d).toBe(true);
    const parsed = parseCameraPlan(
      `<script type="application/json" id="sequences-camera">${JSON.stringify(plan)}</script>`,
    );
    expect(parsed.errors).toEqual([]);
    expect(JSON.stringify(parsed.plan)).toBe(JSON.stringify(plan));
    // A depth3d intent whose orbit did not survive resolution stays flat.
    const flat = resolveCameraPlan([
      scene({
        id: "hero",
        startSec: 0,
        durationSec: 6,
        camera: {
          version: 1,
          depth3d: true,
          path: [
            { version: 1, move: "pan", toRegion: "logo-stage", startSec: 0, durationSec: 2 },
          ],
        },
      }),
    ]);
    expect(flat.scenes[0]!.depth3d).toBeUndefined();
  });
});

describe("auditCameraEnergy", () => {
  const gentleCamera = (region: string): DirectScene["camera"] => ({
    version: 1,
    path: [{ version: 1, move: "pan", toRegion: region, startSec: 0.5, durationSec: 1.2 }],
  });

  it("flags a 12s+ film with no high-energy camera move or energetic cut", () => {
    const findings = auditCameraEnergy([
      scene({ id: "a", startSec: 0, durationSec: 6, camera: gentleCamera("hero") }),
      scene({ id: "b", startSec: 6, durationSec: 6, camera: gentleCamera("metrics") }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/no high-energy peak/);
  });

  it("accepts a whip, a hard push-in, or an energetic cut as the peak", () => {
    const whip: DirectScene["camera"] = {
      version: 1,
      path: [{ version: 1, move: "whip", toRegion: "metrics", startSec: 1, durationSec: 0.5 }],
    };
    expect(auditCameraEnergy([
      scene({ id: "a", startSec: 0, durationSec: 6, camera: whip }),
      scene({ id: "b", startSec: 6, durationSec: 6 }),
    ])).toEqual([]);
    const hardPush: DirectScene["camera"] = {
      version: 1,
      path: [{ version: 1, move: "push-in", toRegion: "hero", zoom: 1.35, startSec: 1, durationSec: 1 }],
    };
    expect(auditCameraEnergy([
      scene({ id: "a", startSec: 0, durationSec: 6, camera: hardPush }),
      scene({ id: "b", startSec: 6, durationSec: 6 }),
    ])).toEqual([]);
    expect(auditCameraEnergy([
      scene({
        id: "a",
        startSec: 0,
        durationSec: 6,
        cut: { version: 1, style: "zoom-through" },
      }),
      scene({ id: "b", startSec: 6, durationSec: 6 }),
    ])).toEqual([]);
  });

  it("accepts a 3D orbit as the high-energy peak", () => {
    const orbit: DirectScene["camera"] = {
      version: 1,
      path: [{ version: 1, move: "orbit", toRegion: "logo-stage", startSec: 1, durationSec: 2 }],
    };
    expect(auditCameraEnergy([
      scene({ id: "a", startSec: 0, durationSec: 6, camera: orbit }),
      scene({ id: "b", startSec: 6, durationSec: 6 }),
    ])).toEqual([]);
  });

  it("does not require a peak from a short film", () => {
    expect(auditCameraEnergy([
      scene({ id: "a", startSec: 0, durationSec: 4, camera: gentleCamera("hero") }),
      scene({ id: "b", startSec: 4, durationSec: 4 }),
    ])).toEqual([]);
  });

  it("accepts four full moves sharing a QUIET verb (WS6: consistent panning is coherence)", () => {
    const pan = (region: string, at: number): NonNullable<DirectScene["camera"]>["path"][number] => ({
      version: 1,
      move: "pan",
      toRegion: region,
      startSec: at,
      durationSec: 1,
    });
    expect(auditCameraEnergy([
      scene({
        id: "a",
        startSec: 0,
        durationSec: 8,
        camera: { version: 1, path: [pan("one", 0), pan("two", 2), pan("three", 4), pan("four", 6)] },
        cut: { version: 1, style: "zoom-through" },
      }),
      scene({ id: "b", startSec: 8, durationSec: 6 }),
    ])).toEqual([]);
  });

  it("flags four full moves sharing a HIGH-ENERGY verb (WS6: four whips is noise, not a peak)", () => {
    const whip = (region: string, at: number): NonNullable<DirectScene["camera"]>["path"][number] => ({
      version: 1,
      move: "whip",
      toRegion: region,
      startSec: at,
      durationSec: 0.5,
    });
    const findings = auditCameraEnergy([
      scene({
        id: "a",
        startSec: 0,
        durationSec: 8,
        camera: { version: 1, path: [whip("one", 0), whip("two", 2), whip("three", 4), whip("four", 6)] },
      }),
      scene({ id: "b", startSec: 8, durationSec: 6 }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/all 4 full camera moves are "whip"/);
  });
});

describe("Sentinel — liftCameraEnergyPeak (normalize-before-retry)", () => {
  const push = (region: string, zoom?: number): NonNullable<DirectScene["camera"]> => ({
    version: 1,
    path: [
      {
        version: 1,
        move: "push-in",
        toRegion: region,
        ...(zoom !== undefined ? { zoom } : {}),
        startSec: 1,
        durationSec: 1,
      },
    ],
  });

  it("lifts a mild push-in to the peak so a 12s+ peak-less film clears camera/energy", () => {
    // A default push-in resolves to zoom 1.22 (in [1.15, 1.3)).
    const storyboard = [
      scene({ id: "a", startSec: 0, durationSec: 6, camera: push("hero") }),
      scene({ id: "b", startSec: 6, durationSec: 7 }),
    ];
    expect(auditCameraEnergy(storyboard).some((f) => f.startsWith("camera/energy"))).toBe(true);
    const result = liftCameraEnergyPeak(storyboard);
    expect(result.normalized).toHaveLength(1);
    expect(result.storyboard[0]!.camera!.path[0]!.zoom).toBe(HIGH_ENERGY_PUSH_ZOOM);
    expect(auditCameraEnergy(result.storyboard).some((f) => f.startsWith("camera/energy"))).toBe(false);
  });

  it("is a no-op when the film already has a high-energy peak (a whip)", () => {
    const whip: NonNullable<DirectScene["camera"]> = {
      version: 1,
      path: [{ version: 1, move: "whip", toRegion: "m", startSec: 1, durationSec: 0.5 }],
    };
    const storyboard = [
      scene({ id: "a", startSec: 0, durationSec: 6, camera: whip }),
      scene({ id: "b", startSec: 6, durationSec: 7, camera: push("hero") }),
    ];
    expect(liftCameraEnergyPeak(storyboard).normalized).toEqual([]);
  });

  it("never lifts when an energetic cut already carries the peak", () => {
    const storyboard = [
      scene({
        id: "a",
        startSec: 0,
        durationSec: 6,
        camera: push("hero"),
        cut: { version: 1, style: "zoom-through" },
      }),
      scene({ id: "b", startSec: 6, durationSec: 7 }),
    ];
    expect(liftCameraEnergyPeak(storyboard).normalized).toEqual([]);
  });

  it("leaves a genuine energy deficit as a finding (only pans/drifts — nothing liftable)", () => {
    const pan: NonNullable<DirectScene["camera"]> = {
      version: 1,
      path: [{ version: 1, move: "pan", toRegion: "m", startSec: 1, durationSec: 1 }],
    };
    const storyboard = [
      scene({ id: "a", startSec: 0, durationSec: 6, camera: pan }),
      scene({ id: "b", startSec: 6, durationSec: 7 }),
    ];
    const result = liftCameraEnergyPeak(storyboard);
    expect(result.normalized).toEqual([]);
    expect(auditCameraEnergy(result.storyboard).some((f) => f.startsWith("camera/energy"))).toBe(true);
  });

  it("does not touch a short (<12s) film", () => {
    const storyboard = [
      scene({ id: "a", startSec: 0, durationSec: 4, camera: push("hero") }),
      scene({ id: "b", startSec: 4, durationSec: 4 }),
    ];
    expect(liftCameraEnergyPeak(storyboard).normalized).toEqual([]);
  });

  it("lifts the largest-zoom candidate — the smallest nudge that reaches the peak", () => {
    const storyboard = [
      scene({ id: "a", startSec: 0, durationSec: 6, camera: push("hero", 1.18) }),
      scene({ id: "b", startSec: 6, durationSec: 7, camera: push("metrics", 1.25) }),
    ];
    const result = liftCameraEnergyPeak(storyboard);
    expect(result.storyboard[0]!.camera!.path[0]!.zoom).toBe(1.18); // untouched
    expect(result.storyboard[1]!.camera!.path[0]!.zoom).toBe(HIGH_ENERGY_PUSH_ZOOM); // lifted
  });
});

describe("Sentinel — topUpRequiredRackFocus", () => {
  it("attaches a required focus pull to the strongest existing part landing", () => {
    const storyboard = [
      scene({
        id: "journey",
        startSec: 0,
        durationSec: 8,
        spatialIntent: {
          version: 1,
          focalPart: "release-map",
          composition: "map",
          relationships: [],
        },
        camera: {
          version: 1,
          path: [
            { version: 1, move: "pan", toRegion: "map", startSec: 0, durationSec: 2 },
            {
              version: 1,
              move: "track-to-anchor",
              toPart: "risk-node",
              startSec: 3,
              durationSec: 1.5,
            },
          ],
        },
        moments: [{
          version: 1,
          id: "risk-lands",
          sceneId: "journey",
          atSec: 4.5,
          title: "Risk lands",
          visualState: "Risk isolated",
          change: "Camera isolates risk",
          motionIntent: "camera arrival",
          importance: "primary",
        }],
      }),
    ];
    const result = topUpRequiredRackFocus(storyboard);
    expect(result.normalized).toHaveLength(1);
    expect(result.storyboard[0]!.camera!.path[1]!.focus).toEqual({
      part: "risk-node",
      blurMaxPx: 6,
    });
    expect(result.storyboard[0]!.sentinelNormalizations?.at(-1)).toContain("rack-focus");
  });

  it("is idempotent and never invents a move or focus target", () => {
    const focused = scene({
      id: "focused",
      startSec: 0,
      durationSec: 4,
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "push-in",
          toPart: "hero",
          startSec: 0,
          durationSec: 1,
          focus: { part: "hero", blurMaxPx: 4 },
        }],
      },
    });
    expect(topUpRequiredRackFocus([focused]).normalized).toEqual([]);
    expect(topUpRequiredRackFocus([
      scene({ id: "no-target", startSec: 0, durationSec: 4 }),
    ]).normalized).toEqual([]);
  });
});

describe("Sentinel — normalizeConnectiveCameraSchedule", () => {
  it("lets Probe 7 connective drift yield to decisive moves and restores chronological order", () => {
    const storyboard = [scene({
      id: "service-map",
      startSec: 4,
      durationSec: 9,
      camera: {
        version: 1,
        // A pacing retime moved push-in later without reordering the array;
        // the authored drift now spans both decisive moves.
        path: [
          { version: 1, move: "pan", toRegion: "map", startSec: 4, durationSec: 1.2 },
          { version: 1, move: "push-in", toRegion: "node", startSec: 8, durationSec: 1.5 },
          { version: 1, move: "drift", startSec: 7.2, durationSec: 4 },
          { version: 1, move: "parallax-pass", toRegion: "node", startSec: 9.5, durationSec: 2 },
        ],
      },
    })];

    const result = normalizeConnectiveCameraSchedule(storyboard);
    expect(result.normalized).toHaveLength(1);
    expect(result.storyboard[0]!.camera!.path.map((move) => move.move)).toEqual([
      "pan",
      "drift",
      "push-in",
      "parallax-pass",
    ]);
    expect(result.storyboard[0]!.camera!.path[1]).toMatchObject({
      startSec: 7.2,
      durationSec: 0.8,
    });
    const parallax = resolveCameraPlan(result.storyboard).scenes[0]!.segments.find(
      (segment) => segment.move === "parallax-pass",
    )!;
    expect(parallax.endSec - parallax.startSec).toBeCloseTo(2, 3);
    expect(normalizeConnectiveCameraSchedule(result.storyboard).normalized).toEqual([]);
  });

  it("moves connective drift to the far side of a full move it starts inside", () => {
    const storyboard = [scene({
      id: "orbit",
      startSec: 13,
      durationSec: 8,
      camera: {
        version: 1,
        path: [
          { version: 1, move: "orbit-lite", toRegion: "chip", startSec: 16.2, durationSec: 3 },
          { version: 1, move: "drift", startSec: 18, durationSec: 3 },
        ],
      },
    })];
    const result = normalizeConnectiveCameraSchedule(storyboard);
    expect(result.storyboard[0]!.camera!.path[1]).toMatchObject({
      move: "drift",
      startSec: 19.2,
      durationSec: 1.8,
    });
  });
});

describe("Sentinel — cross-station connective travel", () => {
  it("promotes a drift to a new component station but preserves same-station drift", () => {
    const storyboard = [scene({
      id: "close",
      startSec: 0,
      durationSec: 5,
      components: [
        { version: 1, id: "metric", kind: "stat-card", region: "metric-station" },
        { version: 1, id: "cta", kind: "button", region: "cta-station" },
      ],
      camera: {
        version: 1,
        path: [
          { version: 1, move: "push-in", toRegion: "metric-station", startSec: 0, durationSec: 2 },
          { version: 1, move: "drift", toPart: "metric", startSec: 2, durationSec: 1 },
          { version: 1, move: "drift", toRegion: "cta-station", startSec: 3, durationSec: 2 },
        ],
      },
    })];
    const result = upgradeCrossStationDrifts(storyboard);
    expect(result.storyboard[0]!.camera!.path.map((move) => move.move)).toEqual([
      "push-in", "drift", "pan",
    ]);
    expect(result.normalized[0]).toContain("declared destination can enter frame");
    expect(upgradeCrossStationDrifts(result.storyboard).normalized).toEqual([]);
  });
});

describe("Sentinel — reserveFinalCameraLanding", () => {
  it("reserves a destination dwell when a substantial final move lands on the cut", () => {
    const storyboard = [scene({
      id: "route",
      startSec: 0,
      durationSec: 6,
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "pan",
          toRegion: "chat",
          startSec: 4.5,
          durationSec: 1.5,
        }],
      },
    })];
    const result = reserveFinalCameraLanding(storyboard);
    expect(result.normalized).toHaveLength(1);
    expect(result.storyboard[0]!.camera!.path[0]!.durationSec).toBe(1.08);
    expect(result.storyboard[0]!.sentinelNormalizations?.[0]).toContain("destination dwell");
    expect(reserveFinalCameraLanding(result.storyboard).normalized).toEqual([]);
  });

  it("reasserts the dwell after a later retime moves a reserved route back onto the cut", () => {
    const note =
      'reserved 0.42s of destination dwell after the push-in landing on "readiness-ring"';
    const storyboard = [scene({
      id: "threshold",
      startSec: 7.2,
      durationSec: 3.6,
      sentinelNormalizations: [note],
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "push-in",
          toPart: "readiness-ring",
          startSec: 8.1,
          durationSec: 2.68,
        }],
      },
    })];
    const result = reserveFinalCameraLanding(storyboard);
    expect(result.normalized).toHaveLength(1);
    expect(result.storyboard[0]!.camera!.path[0]).toMatchObject({
      startSec: 8.1,
      durationSec: 2.28,
    });
    expect(
      result.storyboard[0]!.camera!.path[0]!.startSec +
      result.storyboard[0]!.camera!.path[0]!.durationSec,
    ).toBeCloseTo(10.38, 5);
    expect(result.storyboard[0]!.sentinelNormalizations?.filter((entry) => entry === note))
      .toHaveLength(1);
  });

  it("preserves explicit holds, short impact moves, and dive envelopes", () => {
    const explicitHold = scene({
      id: "held",
      startSec: 0,
      durationSec: 4,
      camera: {
        version: 1,
        path: [
          { version: 1, move: "pan", toRegion: "hero", startSec: 1, durationSec: 2 },
          { version: 1, move: "hold", toRegion: "hero", startSec: 3, durationSec: 1 },
        ],
      },
    });
    const shortWhip = scene({
      id: "whip",
      startSec: 4,
      durationSec: 1,
      camera: {
        version: 1,
        path: [{ version: 1, move: "whip", toRegion: "risk", startSec: 4.5, durationSec: 0.5 }],
      },
    });
    const dive = scene({
      id: "dive",
      startSec: 5,
      durationSec: 3,
      camera: {
        version: 1,
        path: [{ version: 1, move: "dive", toPart: "search", startSec: 5, durationSec: 3 }],
      },
    });
    const result = reserveFinalCameraLanding([explicitHold, shortWhip, dive]);
    expect(result.normalized).toEqual([]);
    expect(result.storyboard).toEqual([explicitHold, shortWhip, dive]);
  });
});

describe("validateCameraContract", () => {
  const cameraScene = scene({
    id: "journey",
    startSec: 0,
    durationSec: 8,
    camera: {
      version: 1,
      path: [
        { version: 1, move: "hold", toRegion: "hero", startSec: 0, durationSec: 1 },
        { version: 1, move: "pan", toRegion: "metrics", startSec: 4, durationSec: 1 },
      ],
    },
  });

  function html(options: {
    island?: string;
    world?: boolean;
    regions?: string[];
    runtime?: boolean;
    compileCall?: boolean;
    extraScript?: string;
  } = {}): string {
    const island = options.island ??
      JSON.stringify(resolveCameraPlan([cameraScene]));
    return `<!doctype html><html><head>
      <script src="gsap.min.js"></script>
      ${options.runtime === false ? "" : `<script src="${CAMERA_RUNTIME_FILE}"></script>`}
    </head><body>
      <main data-composition-id="c" data-width="1920" data-height="1080" data-duration="8">
        <section id="journey" data-scene="journey" data-start="0" data-duration="8">
          ${options.world === false ? "" : `<div data-camera-world>${
            (options.regions ?? ["hero", "metrics"])
              .map((region) => `<div data-region="${region}"></div>`)
              .join("")
          }</div>`}
        </section>
      </main>
      <script type="application/json" id="sequences-camera">${island}</script>
      <script>${options.extraScript ?? ""}
        const tl = gsap.timeline({ paused: true });
        ${options.compileCall === false ? "" : "SequencesCamera.compile(tl, document.querySelector('[data-composition-id]'));"}
        window.__timelines["c"] = tl;
      </script>
    </body></html>`;
  }

  it("accepts a bound plan", () => {
    const result = validateCameraContract(html(), [cameraScene]);
    expect(result.errors).toEqual([]);
  });

  it("is silent when neither storyboard nor HTML declare a camera", () => {
    const plain = scene({ id: "journey", startSec: 0, durationSec: 8 });
    const result = validateCameraContract(
      "<html><body><section data-scene='journey'></section></body></html>",
      [plain],
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("blocks a storyboard camera plan with no island", () => {
    const result = validateCameraContract(
      "<html><body><section data-scene='journey'><div data-camera-world></div></section></body></html>",
      [cameraScene],
    );
    expect(result.errors.some((error) => error.includes("no sequences-camera JSON island"))).toBe(true);
  });

  it("blocks an island that differs from the resolved storyboard plan", () => {
    const tampered = JSON.stringify({ version: 1, scenes: [] });
    const result = validateCameraContract(html({ island: tampered }), [cameraScene]);
    expect(result.errors.some((error) => error.includes("differs from the storyboard"))).toBe(true);
  });

  it("blocks missing worlds, regions, runtime, and compile call", () => {
    expect(validateCameraContract(html({ world: false }), [cameraScene]).errors
      .some((error) => error.includes("no data-camera-world"))).toBe(true);
    expect(validateCameraContract(html({ regions: ["hero"] }), [cameraScene]).errors
      .some((error) => error.includes('region "metrics"'))).toBe(true);
    expect(validateCameraContract(html({ runtime: false }), [cameraScene]).errors
      .some((error) => error.includes(CAMERA_RUNTIME_FILE))).toBe(true);
    expect(validateCameraContract(html({ compileCall: false }), [cameraScene]).errors
      .some((error) => error.includes("SequencesCamera.compile"))).toBe(true);
  });

  it("ignores data-region strings in trailing scripts after a closed scene", () => {
    const result = validateCameraContract(
      html({
        regions: ["hero"],
        extraScript: 'const template = `<div data-region="metrics"></div>`;',
      }),
      [cameraScene],
    );
    expect(result.errors.some((error) => error.includes('region "metrics"'))).toBe(true);
  });

  it("validates focus parts scene-scoped and warns when no depth layers exist", () => {
    const focusScene = scene({
      id: "journey",
      startSec: 0,
      durationSec: 8,
      camera: {
        version: 1,
        path: [
          { version: 1, move: "hold", toRegion: "hero", startSec: 0, durationSec: 1 },
          {
            version: 1,
            move: "push-in",
            toRegion: "metrics",
            startSec: 4,
            durationSec: 1,
            focus: { part: "draft-line", blurMaxPx: 6 },
          },
        ],
      },
    });
    const island = JSON.stringify(resolveCameraPlan([focusScene]));
    // The focus part is missing from the scene → error; no depth layers → warning.
    const missing = validateCameraContract(html({ island }), [focusScene]);
    expect(missing.errors.some((error) => error.includes('part "draft-line"'))).toBe(true);
    expect(missing.warnings.some((warning) => warning.includes("rack-focus"))).toBe(true);
    // With the part and a data-depth layer both present, the plan is clean.
    const bound = html({ island }).replace(
      '<div data-region="metrics"></div>',
      '<div data-region="metrics" data-depth="0.3"><span data-part="draft-line"></span></div>',
    );
    const result = validateCameraContract(bound, [focusScene]);
    expect(result.errors).toEqual([]);
    expect(result.warnings.filter((warning) => warning.includes("rack-focus"))).toEqual([]);
  });

  it("warns when depth3d is planned but the scene has no depth layers", () => {
    const depthScene = scene({
      id: "journey",
      startSec: 0,
      durationSec: 8,
      camera: {
        version: 1,
        depth3d: true,
        path: [
          { version: 1, move: "orbit", toRegion: "hero", startSec: 1, durationSec: 2 },
        ],
      },
    });
    const island = JSON.stringify(resolveCameraPlan([depthScene]));
    const flat = validateCameraContract(html({ island }), [depthScene]);
    expect(flat.errors).toEqual([]);
    expect(flat.warnings.some((warning) => warning.includes("depth3d"))).toBe(true);
    const layered = html({ island }).replace(
      '<div data-region="hero"></div>',
      '<div data-region="hero" data-depth="0.7"></div>',
    );
    const bound = validateCameraContract(layered, [depthScene]);
    expect(bound.errors).toEqual([]);
    expect(bound.warnings.filter((warning) => warning.includes("depth3d"))).toEqual([]);
  });

  it("warns when an authored tween targets the world plane", () => {
    const result = validateCameraContract(
      html({ extraScript: "gsap.timeline({paused:true}).to(\"[data-camera-world]\", { x: 40 }, 1);" }),
      [cameraScene],
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("owns that transform"))).toBe(true);
  });
});

describe("cameraMotionWindows", () => {
  it("covers full moves only — hold and drift stay auditable", () => {
    const plan = resolveCameraPlan([
      scene({
        id: "journey",
        startSec: 0,
        durationSec: 10,
        camera: {
          version: 1,
          path: [
            { version: 1, move: "hold", toRegion: "hero", startSec: 0, durationSec: 1 },
            { version: 1, move: "whip", toRegion: "metrics", startSec: 3, durationSec: 0.5 },
          ],
        },
      }),
    ]);
    const windows = cameraMotionWindows(plan);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.start).toBeCloseTo(2.95, 5);
    expect(windows[0]!.end).toBeCloseTo(3.55, 5);
    expect(cameraMotionWindows(undefined)).toEqual([]);
  });
});

describe("parseCameraPlan", () => {
  it("round-trips the resolved plan through the island", () => {
    const plan = resolveCameraPlan([
      scene({
        id: "journey",
        startSec: 0,
        durationSec: 8,
        camera: {
          version: 1,
          path: [{ version: 1, move: "pan", toRegion: "hero", startSec: 0, durationSec: 2 }],
        },
      }),
    ]);
    const parsed = parseCameraPlan(
      `<script type="application/json" id="sequences-camera">${JSON.stringify(plan)}</script>`,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.plan).toEqual(plan);
  });

  it("reports malformed islands", () => {
    expect(parseCameraPlan(
      '<script type="application/json" id="sequences-camera">{nope</script>',
    ).errors[0]).toContain("invalid");
    expect(parseCameraPlan(
      '<script type="application/json" id="sequences-camera">{"version":2,"scenes":[]}</script>',
    ).errors[0]).toContain("version");
  });
});

describe("sequences-camera runtime ease library", () => {
  function loadEases(): Map<string, (t: number) => number> {
    const registered = new Map<string, (t: number) => number>();
    const source = cameraRuntimeSource();
    const fakeWindow = {
      gsap: {
        registerEase: (name: string, fn: (t: number) => number) => registered.set(name, fn),
      },
    };
    // The template is an IIFE over `window`; document is only touched inside
    // compile(), which this test never calls.
    new Function("window", "document", source)(fakeWindow, {});
    return registered;
  }

  it("registers every contract ease with sane endpoints", () => {
    const eases = loadEases();
    for (const name of SEQUENCES_EASES) {
      const ease = eases.get(name);
      expect(ease, `${name} must be registered`).toBeTypeOf("function");
      expect(ease!(0)).toBeCloseTo(0, 5);
      expect(ease!(1)).toBeCloseTo(1, 5);
      // seqPop is the deliberate loud overshoot (~10%); every other curve stays
      // within the seqMicrobounce/seqStamp restraint band.
      const overshootCeiling = name === "seqPop" ? 1.12 : 1.06;
      for (let t = 0; t <= 1.0001; t += 0.01) {
        const value = ease!(t);
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(-0.12); // seqAnticipate dips, bounded
        expect(value).toBeLessThan(overshootCeiling);
      }
    }
  });

  it("gives seqGlide and seqDrift residual end velocity and keeps seqSwoosh monotonic", () => {
    const eases = loadEases();
    const glide = eases.get("seqGlide")!;
    const drift = eases.get("seqDrift")!;
    expect((glide(1) - glide(0.98)) / 0.02).toBeGreaterThan(0.05);
    expect((drift(1) - drift(0.98)) / 0.02).toBeGreaterThan(0.3);
    const swoosh = eases.get("seqSwoosh")!;
    for (let t = 0.01; t <= 1; t += 0.01) {
      expect(swoosh(t)).toBeGreaterThanOrEqual(swoosh(t - 0.01) - 1e-9);
    }
  });

  it("exposes a frozen SequencesCamera global", () => {
    const registered = new Map<string, (t: number) => number>();
    const fakeWindow: Record<string, unknown> = {
      gsap: { registerEase: (name: string, fn: (t: number) => number) => registered.set(name, fn) },
    };
    new Function("window", "document", cameraRuntimeSource())(fakeWindow, {});
    const rig = fakeWindow.SequencesCamera as { version: number; compile: unknown };
    expect(rig.version).toBe(1);
    expect(rig.compile).toBeTypeOf("function");
  });
});

describe("fallback composition camera integration", () => {
  it("ships a bound camera world that passes the static contract", () => {
    const draft = buildFallbackComposition({
      product: "Relay",
      whatShipped: "Live handoff for support threads",
      audience: "support teams",
      lengthSec: 15,
    });
    expect(draft.html).toContain(`src="${CAMERA_RUNTIME_FILE}"`);
    expect(draft.html).toContain('id="sequences-camera"');
    expect(draft.html).toContain("SequencesCamera.compile");
    expect(draft.html).toContain('data-region="proof-context"');
    const result = validateCameraContract(draft.html, draft.storyboard);
    expect(result.errors).toEqual([]);
    // The authored proof entrance rides a library ease.
    expect(draft.html).toContain('ease:"seqSettle"');
  });
});

describe("motion density camera awareness", () => {
  const worldScene = (path: NonNullable<DirectScene["camera"]>["path"]): DirectScene =>
    scene({
      id: "journey",
      startSec: 0,
      durationSec: 6,
      camera: { version: 1, path },
    });

  it("counts full camera moves as beats and drift as connective motion", () => {
    const scenes = [
      worldScene([
        { version: 1, move: "whip", toRegion: "metrics", startSec: 2.5, durationSec: 0.5 },
      ]),
      scene({ id: "b", startSec: 6, durationSec: 4 }),
      scene({ id: "c", startSec: 10, durationSec: 4 }),
    ];
    const report = analyzeMotionDensity("<html></html>", scenes, 14);
    const cameraBeats = report.activities.filter((activity) =>
      activity.source.startsWith("camera:")
    );
    expect(cameraBeats.some((activity) => activity.source === "camera:whip" && activity.kind === "medium"))
      .toBe(true);
    expect(cameraBeats.some((activity) => activity.source === "camera:drift" && activity.kind === "small"))
      .toBe(true);
  });

  it("flags a long typed hold with nothing happening inside it", () => {
    const scenes = [
      worldScene([
        { version: 1, move: "hold", toRegion: "hero", startSec: 0, durationSec: 5.5 },
      ]),
      scene({ id: "b", startSec: 6, durationSec: 4 }),
      scene({ id: "c", startSec: 10, durationSec: 4 }),
    ];
    const report = analyzeMotionDensity("<html></html>", scenes, 14);
    expect(report.warnings.some((warning) => warning.includes("motion/pulse"))).toBe(true);
  });

  it("has CAMERA_FULL_MOVES excluding hold and drift", () => {
    expect(CAMERA_FULL_MOVES.has("pan")).toBe(true);
    expect(CAMERA_FULL_MOVES.has("hold" as never)).toBe(false);
    expect(CAMERA_FULL_MOVES.has("drift" as never)).toBe(false);
  });
});

describe("runtime source hygiene", () => {
  it("keeps the runtime template deterministic (no clocks, timers, or randomness)", () => {
    const source = fs.readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../src/engine/templates",
        CAMERA_RUNTIME_FILE,
      ),
      "utf8",
    );
    expect(source).not.toMatch(/Date\.now|performance\.now|Math\.random|setTimeout|setInterval|requestAnimationFrame/);
  });
});

describe("compound camera moves", () => {
  it("merges pan-then-push-in on the same region into one compound move", () => {
    const camera = normalizeStoryboardCameraIntent({
      version: 1,
      path: [
        { version: 1, move: "pan", toRegion: "metric-wall", startSec: 1, durationSec: 1 },
        { version: 1, move: "push-in", toRegion: "metric-wall", startSec: 2.2, durationSec: 1.4, zoom: 1.35 },
      ],
    }, window);
    expect(camera?.path).toHaveLength(1);
    expect(camera?.path[0]).toMatchObject({
      move: "pan",
      toRegion: "metric-wall",
      startSec: 1,
      durationSec: 2.6,
      zoom: 1.35,
    });
  });

  it("adopts the push-in default zoom and carries its focus modifier", () => {
    const camera = normalizeStoryboardCameraIntent({
      version: 1,
      path: [
        { version: 1, move: "track-to-anchor", toPart: "hero-stat", startSec: 0, durationSec: 1 },
        {
          version: 1,
          move: "push-in",
          toPart: "hero-stat",
          startSec: 1,
          durationSec: 1,
          focus: { part: "hero-stat", blurMaxPx: 6 },
        },
      ],
    }, window);
    expect(camera?.path).toHaveLength(1);
    expect(camera?.path[0]?.zoom).toBeCloseTo(1.22);
    expect(camera?.path[0]?.focus).toMatchObject({ part: "hero-stat" });
  });

  it("never merges different targets, distant pairs, or whip reframes", () => {
    const differentTargets = normalizeStoryboardCameraIntent({
      version: 1,
      path: [
        { version: 1, move: "pan", toRegion: "hero", startSec: 0, durationSec: 1 },
        { version: 1, move: "push-in", toRegion: "metrics", startSec: 1, durationSec: 1 },
      ],
    }, window);
    expect(differentTargets?.path).toHaveLength(2);
    const distant = normalizeStoryboardCameraIntent({
      version: 1,
      path: [
        { version: 1, move: "pan", toRegion: "hero", startSec: 0, durationSec: 1 },
        { version: 1, move: "push-in", toRegion: "hero", startSec: 3, durationSec: 1 },
      ],
    }, window);
    expect(distant?.path).toHaveLength(2);
    const whip = normalizeStoryboardCameraIntent({
      version: 1,
      path: [
        { version: 1, move: "whip", toRegion: "hero", startSec: 0, durationSec: 0.5 },
        { version: 1, move: "push-in", toRegion: "hero", startSec: 0.5, durationSec: 1 },
      ],
    }, window);
    expect(whip?.path).toHaveLength(2);
  });

  it("counts a zoomed compound pan as the film's high-energy peak", () => {
    const storyboard = [
      {
        id: "a",
        title: "a",
        purpose: "test",
        startSec: 0,
        durationSec: 14,
        camera: normalizeStoryboardCameraIntent({
          version: 1,
          path: [
            { version: 1, move: "pan", toRegion: "hero", startSec: 1, durationSec: 1 },
            { version: 1, move: "push-in", toRegion: "hero", startSec: 2, durationSec: 1.5, zoom: 1.35 },
          ],
        }, { startSec: 0, durationSec: 14 }),
      },
    ] as DirectScene[];
    expect(auditCameraEnergy(storyboard).filter((finding) => finding.includes("high-energy"))).toEqual([]);
  });
});
