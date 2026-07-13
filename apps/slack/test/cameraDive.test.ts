import { describe, expect, it } from "vitest";
import {
  DIVE_LEG_MAX_SEC,
  cameraMotionWindows,
  diveWindows,
  normalizeStoryboardCameraIntent,
  resolveCameraPlan,
} from "../src/engine/cameraContract.ts";
import {
  auditDiveInteractions,
  deriveDiveWindows,
} from "../src/engine/compositionRunner.ts";
import {
  auditPacing,
  framingChangeEvents,
  nextFramingChangeAfter,
} from "../src/engine/pacingAudit.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";

function scene(
  overrides: Partial<DirectScene> & Pick<DirectScene, "id" | "startSec" | "durationSec">,
): DirectScene {
  return { title: overrides.id, purpose: "test", ...overrides };
}

const window8 = { startSec: 0, durationSec: 8 };

/** A dense-frame scene: one palette surface, one typed beat inside a dive. */
function diveScene(overrides: Partial<DirectScene> = {}): DirectScene {
  return scene({
    id: "workbench",
    startSec: 0,
    durationSec: 8,
    components: [
      { version: 1, id: "palette-input", kind: "command-palette", region: "workbench-ui" },
    ],
    beats: [{
      version: 1,
      id: "type-query",
      sceneId: "workbench",
      component: "palette-input",
      kind: "type",
      atSec: 3,
      durationSec: 1.2,
      text: "deploy checkout service",
    }],
    camera: {
      version: 1,
      path: [
        { version: 1, move: "hold", toRegion: "workbench-ui", startSec: 0, durationSec: 2 },
        {
          version: 1,
          move: "dive",
          toPart: "palette-input",
          startSec: 2.2,
          durationSec: 5,
          zoom: 1.3,
        },
      ],
    },
    ...overrides,
  });
}

describe("dive normalization (MD5)", () => {
  it("accepts dive with a toPart, clamps zoom into 1.0-1.4, drops model-authored legs", () => {
    const camera = normalizeStoryboardCameraIntent({
      version: 1,
      path: [{
        version: 1,
        move: "dive",
        toPart: "palette-input",
        startSec: 1,
        durationSec: 4,
        zoom: 2.6,
        // The host owns this arithmetic — model-authored legs are ignored.
        inSec: 0.01,
        outSec: 3.5,
      }],
    }, window8);
    expect(camera?.path[0]).toMatchObject({ move: "dive", toPart: "palette-input", zoom: 1.4 });
    expect(camera?.path[0]?.inSec).toBeUndefined();
    expect(camera?.path[0]?.outSec).toBeUndefined();
  });

  it("degrades a dive without a toPart to no move", () => {
    expect(normalizeStoryboardCameraIntent({
      version: 1,
      path: [{ version: 1, move: "dive", toRegion: "hero", startSec: 0, durationSec: 4 }],
    }, window8)).toBeUndefined();
  });
});

describe("diveWindows", () => {
  it("floors short-dive legs so they don't snap, and caps long-dive legs at the max", () => {
    // The quarter-window leg for a 2s dive (0.5s) is floored to DIVE_LEG_MIN_SEC
    // so a short dive eases in/out instead of snapping (probe-audit-03 softening).
    expect(diveWindows({ durationSec: 2 })).toEqual({ inSec: 0.7, outSec: 0.7 });
    expect(diveWindows({ durationSec: 6 })).toEqual({
      inSec: DIVE_LEG_MAX_SEC,
      outSec: DIVE_LEG_MAX_SEC,
    });
  });

  it("rescales oversized legs so at least 20% of the window stays held", () => {
    const legs = diveWindows({ durationSec: 2, inSec: 1.2, outSec: 1.2 });
    expect(legs.inSec + legs.outSec).toBeLessThanOrEqual(2 * 0.8 + 1e-6);
    expect(legs.inSec).toBeCloseTo(legs.outSec);
  });
});

describe("deriveDiveWindows (the L2 arithmetic normalizer)", () => {
  it("times the hold to cover the beat plus its reading floor", () => {
    const { storyboard, normalized } = deriveDiveWindows([diveScene()]);
    const dive = storyboard[0]!.camera!.path.find((move) => move.move === "dive")!;
    expect(normalized).toHaveLength(1);
    // Push-in must land before the beat starts at 3.0s (dive starts 2.2s).
    expect(dive.inSec).toBeDefined();
    expect(2.2 + dive.inSec!).toBeLessThanOrEqual(3.0 + 1e-6);
    // Pull-back must not start before the copy's reading floor expires:
    // beat ends 4.2s + max(1.2, 0.3×3 words)=1.2s → hold through 5.4s.
    expect(dive.outSec).toBeDefined();
    expect(7.2 - dive.outSec!).toBeGreaterThanOrEqual(5.4 - 1e-6);
  });

  it("degrades a dive with nothing acting on its target to a push-in", () => {
    const bare = diveScene({ beats: [] });
    const { storyboard, normalized } = deriveDiveWindows([bare]);
    const path = storyboard[0]!.camera!.path;
    expect(path.find((move) => move.move === "dive")).toBeUndefined();
    expect(path.find((move) => move.move === "push-in")).toMatchObject({
      toPart: "palette-input",
      zoom: 1.3,
    });
    expect(normalized[0]).toContain("degraded to push-in");
  });

  it("extends the held window so a covered payoff gets its outcome hold before the pull-back (quillsign regression)", () => {
    // motion-quality-verify-2-quillsign burned two storyboard attempts: the
    // host-derived pull-back leg fired exactly at a covered set-state payoff,
    // minting the very `pacing/outcome` finding the model cannot repair (it
    // does not own the legs). The derivation must hold >=0.8s past the payoff,
    // growing the dive when the scene has free time.
    const payoffScene = diveScene({
      id: "one-gesture",
      durationSec: 10,
      components: [
        { version: 1, id: "sign-button", kind: "button", region: "workbench-ui" },
      ],
      beats: [{
        version: 1,
        id: "button-loading",
        sceneId: "one-gesture",
        component: "sign-button",
        kind: "set-state",
        atSec: 4.8,
        durationSec: 0.5,
        toState: "loading",
      }],
      camera: {
        version: 1,
        path: [
          { version: 1, move: "hold", toRegion: "workbench-ui", startSec: 0, durationSec: 2 },
          {
            version: 1,
            move: "dive",
            toPart: "sign-button",
            startSec: 2,
            durationSec: 3.5,
            zoom: 1.3,
          },
        ],
      },
    });
    const { storyboard, normalized } = deriveDiveWindows([payoffScene]);
    const dive = storyboard[0]!.camera!.path.find((move) => move.move === "dive")!;
    // Payoff ends at 5.3s; the pull-back (the next framing change) must wait
    // out the 0.8s outcome hold, so the window itself grows past 5.5s.
    expect(dive.durationSec).toBeGreaterThan(3.5);
    const pullBackStart = dive.startSec + dive.durationSec - dive.outSec!;
    expect(pullBackStart).toBeGreaterThanOrEqual(5.3 + 0.8 - 1e-6);
    expect(normalized[0]).toContain("outcome hold");
    // The gate itself must agree — no `pacing/outcome` finding on the plan
    // the host derived.
    const findings = auditPacing(storyboard);
    expect(findings.filter((finding) => finding.includes("pacing/outcome"))).toEqual([]);
  });

  it("counts an interaction on the dive target as motivation", () => {
    const withInteraction = diveScene({
      beats: [],
      interactions: [{
        version: 1,
        id: "click-palette",
        sceneId: "workbench",
        cursorId: "pointer",
        targetPart: "palette-input",
        action: "click",
        startSec: 3.4,
        arriveSec: 3.8,
        pressSec: 3.9,
        releaseSec: 4.05,
        from: "frame:bottom-right",
        path: "human",
        feedback: "press",
      } as NonNullable<DirectScene["interactions"]>[number]],
    });
    const { storyboard } = deriveDiveWindows([withInteraction]);
    expect(
      storyboard[0]!.camera!.path.find((move) => move.move === "dive"),
    ).toBeDefined();
  });

  it("retargets a sibling dive to the explicit interaction in the same station", () => {
    const sibling = diveScene({
      components: [
        { version: 1, id: "release-card", kind: "stat-card", region: "focus-station" },
        { version: 1, id: "approve-btn", kind: "button", region: "focus-station" },
      ],
      beats: [{
        version: 1, id: "card-state", sceneId: "workbench", component: "release-card",
        kind: "set-state", atSec: 3, durationSec: 0.5, toState: "ready",
      }],
      interactions: [{
        version: 1, id: "approve", sceneId: "workbench", cursorId: "cursor",
        targetPart: "approve-btn", action: "click", startSec: 3.2, arriveSec: 3.7,
        pressSec: 3.8, releaseSec: 4, from: "frame:bottom-right", path: "arc",
        aimX: 0.5, aimY: 0.5, feedback: "press-ripple",
      }],
      camera: {
        version: 1,
        path: [{
          version: 1, move: "dive", toRegion: "focus-station", toPart: "release-card",
          startSec: 2.2, durationSec: 5, zoom: 1.3,
          focus: { part: "release-card", blurMaxPx: 6 },
        }],
      },
    });
    const result = deriveDiveWindows([sibling]);
    const dive = result.storyboard[0]!.camera!.path[0]!;
    expect(dive).toMatchObject({ move: "dive", toPart: "approve-btn" });
    expect(dive.focus?.part).toBe("approve-btn");
    expect(result.normalized.some((line) => line.includes("retargeted"))).toBe(true);
    expect(auditDiveInteractions(result.storyboard)).toEqual([]);
  });
});

describe("auditDiveInteractions", () => {
  it("rejects a cursor working a DIFFERENT surface through the dive window", () => {
    const conflicted = diveScene({
      interactions: [{
        version: 1,
        id: "click-elsewhere",
        sceneId: "workbench",
        cursorId: "pointer",
        targetPart: "other-button",
        action: "click",
        startSec: 3.4,
        arriveSec: 3.8,
        from: "frame:bottom-right",
        path: "human",
        feedback: "press",
      } as NonNullable<DirectScene["interactions"]>[number]],
    });
    const findings = auditDiveInteractions([conflicted]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("click-elsewhere");
    expect(findings[0]).toContain("palette-input");
  });

  it("never flags the designed dive-and-press pattern (interaction on the dive target)", () => {
    const designed = diveScene({
      interactions: [{
        version: 1,
        id: "press-palette",
        sceneId: "workbench",
        cursorId: "pointer",
        targetPart: "palette-input",
        action: "click",
        startSec: 3.4,
        arriveSec: 3.8,
        from: "frame:bottom-right",
        path: "human",
        feedback: "press",
      } as NonNullable<DirectScene["interactions"]>[number]],
    });
    expect(auditDiveInteractions([designed])).toEqual([]);
  });
});

describe("dive-aware pacing (hold = development time)", () => {
  it("emits two framing-change events for a dive and none inside its hold", () => {
    const events = framingChangeEvents([{
      version: 1,
      move: "dive",
      toPart: "palette-input",
      startSec: 2,
      durationSec: 5,
      inSec: 0.8,
      outSec: 0.8,
    }]);
    expect(events).toHaveLength(2);
    // A beat settling at 3.5s (inside the hold) is framed until the
    // pull-back at 6.2s — not "changed" by the dive being in flight.
    expect(nextFramingChangeAfter(events, 3.5, 8)).toBeCloseTo(6.2);
    // Before the dive, the push-in at 2s is the next change.
    expect(nextFramingChangeAfter(events, 1, 8)).toBe(2);
  });

  it("passes auditPacing when a typed beat develops the dive's held frame", () => {
    const { storyboard } = deriveDiveWindows([diveScene()]);
    const pacing = auditPacing(storyboard).filter((finding) =>
      finding.includes("type-query")
    );
    expect(pacing).toEqual([]);
  });
});

describe("dive resolution + motion windows", () => {
  it("resolves the dive as ONE segment carrying its host-derived legs", () => {
    const { storyboard } = deriveDiveWindows([diveScene()]);
    const plan = resolveCameraPlan(storyboard);
    const dive = plan.scenes[0]!.segments.find((segment) => segment.move === "dive")!;
    expect(dive).toBeDefined();
    expect(dive.inSec).toBeGreaterThan(0);
    expect(dive.outSec).toBeGreaterThan(0);
    expect(dive.toPart).toBe("palette-input");
    // Only the two legs are camera transit; the hold is a stable framing.
    const windows = cameraMotionWindows(plan);
    const inHold = windows.some((window) =>
      window.start < 4.5 && window.end > 4.5
    );
    expect(inHold).toBe(false);
  });
});
