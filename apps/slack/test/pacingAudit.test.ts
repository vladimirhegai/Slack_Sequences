import { describe, expect, it } from "vitest";
import {
  auditPacing,
  sceneIntroductionTimes,
  delayConflictingCameraMoves,
  normalizeCameraBudget,
  stretchMarginalPacingMisses,
  LAST_INTRODUCTION_MAX_FRACTION,
  PACING_TOLERANCE_SEC,
  MAX_PACING_STRETCH_SEC,
} from "../src/engine/pacingAudit.ts";
import { buildFallbackComposition } from "../src/engine/fallbackComposition.ts";
import { resolveTimeRampPlan, warpInverseOf } from "../src/engine/timeRamp.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import type { ComponentBeatIntentV1 } from "../src/engine/componentContract.ts";
import type { CameraMoveIntentV1 } from "../src/engine/cameraContract.ts";
import type { StoryboardMomentV1 } from "../src/engine/storyboardMoments.ts";

function scene(
  overrides: Partial<DirectScene> & Pick<DirectScene, "id" | "startSec" | "durationSec">,
): DirectScene {
  return {
    title: overrides.id,
    purpose: "test",
    ...overrides,
  };
}

function beat(
  sceneId: string,
  spec: Partial<ComponentBeatIntentV1> &
    Pick<ComponentBeatIntentV1, "id" | "component" | "kind" | "atSec">,
): ComponentBeatIntentV1 {
  return { version: 1, sceneId, ...spec };
}

function move(
  spec: Partial<CameraMoveIntentV1> & Pick<CameraMoveIntentV1, "move" | "startSec" | "durationSec">,
): CameraMoveIntentV1 {
  return { version: 1, toRegion: "station", ...spec };
}

function moment(sceneId: string, id: string, atSec: number): StoryboardMomentV1 {
  return {
    version: 1,
    id,
    sceneId,
    atSec,
    title: id,
    visualState: "test state",
    change: "test change",
    motionIntent: "camera-arrival",
    importance: "primary",
  };
}

describe("auditPacing camera budget", () => {
  it("caps full camera moves per scene at 1 + floor(duration/3.5)", () => {
    const churn = [scene({
      id: "busy",
      startSec: 0,
      durationSec: 4,
      camera: {
        version: 1,
        path: [
          move({ move: "pan", startSec: 0.4, durationSec: 0.8 }),
          move({ move: "track-to-anchor", toPart: "chip", startSec: 1.6, durationSec: 0.8 }),
          move({ move: "pull-back", startSec: 2.8, durationSec: 0.8 }),
        ],
      },
    })];
    const findings = auditPacing(churn);
    expect(findings.some((finding) =>
      finding.startsWith("pacing/camera-budget:") && finding.includes('"busy"')
    )).toBe(true);
    // Two full moves in the same window are inside the budget.
    const calm = [scene({
      id: "busy",
      startSec: 0,
      durationSec: 4,
      camera: {
        version: 1,
        path: [
          move({ move: "pan", startSec: 0.4, durationSec: 0.8 }),
          move({ move: "push-in", startSec: 2.4, durationSec: 0.9 }),
        ],
      },
    })];
    expect(auditPacing(calm)).toEqual([]);
  });

  it("holds and drifts never count against the budget", () => {
    const findings = auditPacing([scene({
      id: "quiet",
      startSec: 0,
      durationSec: 4,
      camera: {
        version: 1,
        path: [
          move({ move: "hold", startSec: 0, durationSec: 1 }),
          move({ move: "drift", startSec: 1, durationSec: 1.4 }),
          move({ move: "drift", startSec: 2.4, durationSec: 0.8 }),
          move({ move: "pan", startSec: 3.2, durationSec: 0.7 }),
        ],
      },
    })]);
    expect(findings).toEqual([]);
  });

  it("caps whips at 2 per film", () => {
    const whipScene = (id: string, startSec: number): DirectScene => scene({
      id,
      startSec,
      durationSec: 5,
      camera: {
        version: 1,
        path: [move({ move: "whip", startSec: startSec + 1, durationSec: 0.5 })],
      },
    });
    const findings = auditPacing([
      whipScene("a", 0),
      whipScene("b", 5),
      whipScene("c", 10),
    ]);
    expect(findings.some((finding) => finding.includes("3 whips"))).toBe(true);
    expect(auditPacing([whipScene("a", 0), whipScene("b", 5)])).toEqual([]);
  });
});

describe("auditPacing introduction development", () => {
  const components = [
    { version: 1 as const, id: "search-box", kind: "search" as const },
    { version: 1 as const, id: "alert-toast", kind: "toast" as const },
    { version: 1 as const, id: "detail-modal", kind: "modal" as const },
  ];

  it("counts component introductions from entrance beats and scene start", () => {
    const subject = scene({
      id: "s",
      startSec: 2,
      durationSec: 6,
      components,
      beats: [
        beat("s", { id: "b1", component: "alert-toast", kind: "open", atSec: 4 }),
        beat("s", { id: "b2", component: "detail-modal", kind: "open", atSec: 5 }),
      ],
    });
    // search-box has no entrance beat → introduced at scene start (2s).
    expect(sceneIntroductionTimes(subject)).toEqual([2, 4, 5]);
  });

  it("flags a scene that keeps introducing surfaces until its cut", () => {
    const findings = auditPacing([scene({
      id: "cram",
      startSec: 0,
      durationSec: 6,
      components,
      beats: [
        beat("cram", { id: "b1", component: "alert-toast", kind: "open", atSec: 4.4 }),
        beat("cram", { id: "b2", component: "detail-modal", kind: "open", atSec: 5.2 }),
      ],
    })]);
    const holds = findings.filter((finding) => finding.startsWith("pacing/holds:"));
    expect(holds).toHaveLength(1);
    expect(holds[0]).toContain('"cram" introduces 3 surface(s)');
    expect(holds[0]).toContain("hold is not a freeze");
  });

  it("stays silent when introductions land early and development follows", () => {
    const findings = auditPacing([scene({
      id: "paced",
      startSec: 0,
      durationSec: 6,
      components,
      beats: [
        beat("paced", { id: "b1", component: "alert-toast", kind: "open", atSec: 0.8 }),
        beat("paced", { id: "b2", component: "detail-modal", kind: "open", atSec: 1.6 }),
        beat("paced", { id: "b3", component: "detail-modal", kind: "highlight", atSec: 4 }),
      ],
    })]);
    expect(findings.filter((finding) => finding.startsWith("pacing/holds:"))).toEqual([]);
  });

  it("flags a late single-surface introduction (WS_Improvements item 9)", () => {
    // One dense window opened at 3.7s of a 4s scene still needs to be read;
    // the hold gate is per scene, not only multi-surface scenes.
    const findings = auditPacing([
      scene({
        id: "solo-late",
        startSec: 0,
        durationSec: 4,
        components: [{ version: 1 as const, id: "dense-window", kind: "app-window" as const }],
        beats: [beat("solo-late", {
          id: "b1", component: "dense-window", kind: "open", atSec: 3.7,
        })],
      }),
      scene({ id: "closer", startSec: 4, durationSec: 4 }),
    ]);
    const holds = findings.filter((finding) => finding.startsWith("pacing/holds:"));
    expect(holds).toHaveLength(1);
    expect(holds[0]).toContain('"solo-late" introduces 1 surface(s)');
  });

  it("exempts a short final resolve introducing one surface", () => {
    const findings = auditPacing([
      scene({ id: "body", startSec: 0, durationSec: 5 }),
      scene({
        id: "cta-card",
        startSec: 5,
        durationSec: 2.8,
        components: [{ version: 1 as const, id: "cta", kind: "button" as const }],
        beats: [beat("cta-card", { id: "b1", component: "cta", kind: "open", atSec: 7.4 })],
      }),
    ]);
    expect(findings.filter((finding) => finding.startsWith("pacing/holds:"))).toEqual([]);
  });

  it("never exempts a dense surface in the final-resolve slot", () => {
    // Same shape as the exempt CTA card, but the one late introduction is an
    // app-window — a surface the viewer must actually read, not glance at.
    const findings = auditPacing([
      scene({ id: "body", startSec: 0, durationSec: 5 }),
      scene({
        id: "dense-final",
        startSec: 5,
        durationSec: 2.8,
        components: [{ version: 1 as const, id: "ops", kind: "app-window" as const }],
        beats: [beat("dense-final", { id: "b1", component: "ops", kind: "rows", atSec: 7.4 })],
      }),
    ]);
    expect(findings.filter((finding) => finding.startsWith("pacing/holds:"))).toHaveLength(1);
  });

  it("still judges a short final scene that introduces several surfaces", () => {
    const findings = auditPacing([
      scene({ id: "body", startSec: 0, durationSec: 5 }),
      scene({
        id: "crowded-card",
        startSec: 5,
        durationSec: 3,
        components,
        beats: [
          beat("crowded-card", { id: "b1", component: "alert-toast", kind: "open", atSec: 7 }),
          beat("crowded-card", { id: "b2", component: "detail-modal", kind: "open", atSec: 7.6 }),
        ],
      }),
    ]);
    expect(findings.filter((finding) => finding.startsWith("pacing/holds:"))).toHaveLength(1);
  });
});

describe("auditPacing assemble lock hold (MD3)", () => {
  const assembleScene = (endLoad: number) =>
    scene({
      id: "hero",
      startSec: 0,
      durationSec: 4,
      components: [{ version: 1 as const, id: "hero-copy", kind: "headline" as const }],
      beats: [beat("hero", {
        id: "name-assembles",
        component: "hero-copy",
        kind: "type",
        atSec: endLoad - 1.8,
        durationSec: 1.8,
        text: "SHIPFAST",
        style: "assemble",
      })],
    });

  it("flags an assemble whose lock the reframe steals before it can rest", () => {
    // Locks at 3.2s in a 4s scene → 0.8s of hold < 1.2s required.
    const findings = auditPacing([assembleScene(3.2)]);
    expect(findings.some((finding) => finding.startsWith("pacing/assemble:"))).toBe(true);
  });

  it("passes an assemble that locks early enough to hold", () => {
    // Locks at 2.0s → 2.0s of hold ≥ 1.2s.
    const findings = auditPacing([assembleScene(2.0)]);
    expect(findings.filter((finding) => finding.startsWith("pacing/assemble:"))).toEqual([]);
  });
});

describe("auditPacing reading floor", () => {
  const searchScene = (typeBeat: ComponentBeatIntentV1, camera?: DirectScene["camera"]) =>
    scene({
      id: "read",
      startSec: 0,
      durationSec: 5,
      components: [{ version: 1 as const, id: "query", kind: "search" as const }],
      beats: [typeBeat],
      ...(camera ? { camera } : {}),
    });

  it("flags typed copy that the cut steals before it can be read", () => {
    const findings = auditPacing([searchScene(
      beat("read", {
        id: "late-type",
        component: "query",
        kind: "type",
        atSec: 2.6,
        text: "one two three four five six seven eight",
      }),
    )]);
    const reading = findings.filter((finding) => finding.startsWith("pacing/reading:"));
    expect(reading).toHaveLength(1);
    expect(reading[0]).toContain("8 word(s)");
  });

  it("passes the same line typed early enough to read", () => {
    const findings = auditPacing([searchScene(
      beat("read", {
        id: "early-type",
        component: "query",
        kind: "type",
        atSec: 0.3,
        text: "one two three four five six seven eight",
      }),
    )]);
    expect(findings.filter((finding) => finding.startsWith("pacing/reading:"))).toEqual([]);
  });

  it("never vetoes a marginal miss (live probe improve-ws32-1: a 0.2s reading shortfall)", () => {
    // 3 words at 6.5s in a 0-8s scene: typing settles ~7.0s, the cut lands at
    // 8.0s → ~1.0s available vs 1.2s required. Inside the tolerance → silent.
    const findings = auditPacing([scene({
      id: "marginal",
      startSec: 0,
      durationSec: 8,
      components: [{ version: 1 as const, id: "palette", kind: "search" as const }],
      beats: [beat("marginal", {
        id: "palette-type",
        component: "palette",
        kind: "type",
        atSec: 6.5,
        durationSec: 0.5,
        text: "rollback checkout api",
      })],
    })]);
    expect(findings.filter((finding) => finding.startsWith("pacing/reading:"))).toEqual([]);
  });

  it("counts a whip as the framing change that steals the line", () => {
    const findings = auditPacing([searchScene(
      beat("read", {
        id: "early-type",
        component: "query",
        kind: "type",
        atSec: 0.3,
        text: "one two three four five six seven eight",
      }),
      {
        version: 1,
        path: [move({ move: "whip", startSec: 3, durationSec: 0.5 })],
      },
    )]);
    const reading = findings.filter((finding) => finding.startsWith("pacing/reading:"));
    expect(reading).toHaveLength(1);
  });
});

describe("auditPacing outcome holds", () => {
  const pressScene = (atSec: number): DirectScene => scene({
    id: "press",
    startSec: 0,
    durationSec: 5,
    components: [{ version: 1 as const, id: "cta", kind: "button" as const }],
    beats: [beat("press", { id: "the-press", component: "cta", kind: "press", atSec })],
  });

  it("flags a press payoff the next framing change steals", () => {
    const findings = auditPacing([pressScene(4.4)]);
    const outcome = findings.filter((finding) => finding.startsWith("pacing/outcome:"));
    expect(outcome).toHaveLength(1);
    expect(outcome[0]).toContain("hold on outcomes longer than actions");
  });

  it("passes a press with room to settle", () => {
    expect(auditPacing([pressScene(3)])).toEqual([]);
  });

  it("treats a toast open as a payoff", () => {
    const findings = auditPacing([scene({
      id: "toastish",
      startSec: 0,
      durationSec: 4,
      components: [{ version: 1 as const, id: "saved-toast", kind: "toast" as const }],
      beats: [
        beat("toastish", { id: "pop", component: "saved-toast", kind: "open", atSec: 3.5 }),
      ],
    })]);
    expect(findings.some((finding) =>
      finding.startsWith("pacing/outcome:") && finding.includes('"pop"')
    )).toBe(true);
  });
});

describe("auditPacing in-flight camera moves (WS_Improvements item 10)", () => {
  it("treats a move still in flight at the payoff as an immediate framing conflict", () => {
    // The pan starts at 2.0s and runs to 3.5s; the press settles ~2.5s — the
    // frame is moving THROUGH the payoff even though no later move starts.
    const findings = auditPacing([scene({
      id: "inflight",
      startSec: 0,
      durationSec: 5,
      components: [{ version: 1 as const, id: "cta", kind: "button" as const }],
      beats: [beat("inflight", { id: "the-press", component: "cta", kind: "press", atSec: 2.2 })],
      camera: {
        version: 1,
        path: [move({ move: "pan", startSec: 2.0, durationSec: 1.5 })],
      },
    })]);
    expect(findings.filter((finding) => finding.startsWith("pacing/outcome:"))).toHaveLength(1);
  });

  it("ignores a move that finished before the payoff settles", () => {
    const findings = auditPacing([scene({
      id: "settled",
      startSec: 0,
      durationSec: 5,
      components: [{ version: 1 as const, id: "cta", kind: "button" as const }],
      beats: [beat("settled", { id: "the-press", component: "cta", kind: "press", atSec: 3 })],
      camera: {
        version: 1,
        path: [move({ move: "pan", startSec: 0.3, durationSec: 1.2 })],
      },
    })]);
    expect(findings.filter((finding) => finding.startsWith("pacing/outcome:"))).toEqual([]);
  });

  it("counts an in-flight move against the reading floor too", () => {
    const findings = auditPacing([scene({
      id: "read-moving",
      startSec: 0,
      durationSec: 6,
      components: [{ version: 1 as const, id: "query", kind: "search" as const }],
      beats: [beat("read-moving", {
        id: "the-type",
        component: "query",
        kind: "type",
        atSec: 1.4,
        text: "one two three four five six seven eight",
      })],
      camera: {
        version: 1,
        // In flight through the type settle and long enough that the
        // remaining still window cannot cover the reading floor.
        path: [move({ move: "pan", startSec: 1.2, durationSec: 3.6 })],
      },
    })]);
    expect(findings.filter((finding) => finding.startsWith("pacing/reading:"))).toHaveLength(1);
  });
});

describe("auditPacing swapped and headline copy (WS_Improvements item 11)", () => {
  it("gives swapped-in copy the same reading floor as typed copy", () => {
    const findings = auditPacing([scene({
      id: "swappy",
      startSec: 0,
      durationSec: 5,
      components: [{ version: 1 as const, id: "hero-line", kind: "stat-card" as const }],
      beats: [beat("swappy", {
        id: "the-swap",
        component: "hero-line",
        kind: "swap",
        atSec: 4.2,
        text: "one two three four five six seven eight",
      })],
    })]);
    const reading = findings.filter((finding) => finding.startsWith("pacing/reading:"));
    expect(reading).toHaveLength(1);
    expect(reading[0]).toContain("swaps in");
  });

  it("floors a primary headline moment that has no typed beat", () => {
    const headline = (atSec: number): DirectScene[] => [scene({
      id: "headline-scene",
      startSec: 0,
      durationSec: 5,
      moments: [{
        version: 1,
        id: "m-headline",
        sceneId: "headline-scene",
        atSec,
        title: "Headline lands",
        visualState: "hero copy on screen",
        change: "headline appears",
        motionIntent: "type-on",
        importance: "primary",
      }],
      camera: {
        version: 1,
        path: [move({ move: "push-in", startSec: 4.6, durationSec: 0.4 })],
      },
    })];
    const late = auditPacing(headline(4.5));
    expect(late.filter((finding) => finding.startsWith("pacing/reading:"))).toHaveLength(1);
    expect(late[0]).toContain("m-headline");
    expect(auditPacing(headline(2)).filter((finding) =>
      finding.startsWith("pacing/reading:")
    )).toEqual([]);
  });

  it("does not read a 'prototype' intent as a copy promise", () => {
    // Same late-landing shape as the headline test, but the intent word only
    // CONTAINS "type" — no copy is promised, so no reading floor applies.
    const findings = auditPacing([scene({
      id: "proto-scene",
      startSec: 0,
      durationSec: 5,
      moments: [{
        version: 1,
        id: "m-proto",
        sceneId: "proto-scene",
        atSec: 4.5,
        title: "Prototype lands",
        visualState: "prototype on screen",
        change: "the prototype appears",
        motionIntent: "prototype reveal",
        importance: "primary",
      }],
      camera: {
        version: 1,
        path: [move({ move: "push-in", startSec: 4.6, durationSec: 0.4 })],
      },
    })]);
    expect(findings.filter((finding) => finding.startsWith("pacing/reading:"))).toEqual([]);
  });

  it("skips the moment floor when a typed beat already carries the copy", () => {
    const findings = auditPacing([scene({
      id: "typed-headline",
      startSec: 0,
      durationSec: 6,
      components: [{ version: 1 as const, id: "hero", kind: "stat-card" as const }],
      beats: [beat("typed-headline", {
        id: "hero-type",
        component: "hero",
        kind: "type",
        atSec: 1,
        text: "ship it",
      })],
      moments: [{
        version: 1,
        id: "m-typed",
        sceneId: "typed-headline",
        atSec: 1.2,
        title: "Headline types on",
        visualState: "hero copy typing",
        change: "headline appears",
        motionIntent: "type-on",
        importance: "primary",
      }],
    })]);
    // Only the beat rule may speak here (and this beat passes it) — the
    // moment floor must not double-report.
    expect(findings.filter((finding) => finding.includes("m-typed"))).toEqual([]);
  });
});

describe("auditPacing viewer-time introduction deadline (WS_Improvements item 12)", () => {
  it("judges the 65% deadline in viewer time under a slow-motion ramp", () => {
    const build = (withRamp: boolean): DirectScene[] => {
      const body = scene({
        id: "ramped",
        startSec: 5,
        durationSec: 8,
        ...(withRamp
          ? {
              timeRamp: {
                version: 1 as const,
                atSec: 9.4,
                slowTo: 0.2,
                holdSec: 0.9,
                recoverSec: 1.2,
              },
            }
          : {}),
        components: [{ version: 1 as const, id: "panel", kind: "app-window" as const }],
        beats: [beat("ramped", { id: "b1", component: "panel", kind: "open", atSec: 10.05 })],
      });
      return [scene({ id: "opener", startSec: 0, durationSec: 5 }), body];
    };

    // Precondition: the ramp resolves, and the introduction is inside the 65%
    // cap in CONTENT time but past it in VIEWER time — the exact class the
    // fix targets. If the ramp solver's geometry changes these asserts fail
    // loudly instead of the test silently proving nothing.
    const ramped = build(true);
    const plan = resolveTimeRampPlan(ramped);
    expect(plan.ramps).toHaveLength(1);
    const toViewer = warpInverseOf(plan);
    const sceneStart = 5;
    const sceneLen = 8;
    const introAt = 10.05;
    const contentFraction = (introAt - sceneStart) / sceneLen;
    expect(contentFraction).toBeLessThan(LAST_INTRODUCTION_MAX_FRACTION);
    expect(introAt).toBeLessThanOrEqual(
      sceneStart + sceneLen * LAST_INTRODUCTION_MAX_FRACTION + PACING_TOLERANCE_SEC,
    );
    const viewerIntro = toViewer(introAt);
    const viewerCap =
      toViewer(sceneStart) +
      (toViewer(sceneStart + sceneLen) - toViewer(sceneStart)) * LAST_INTRODUCTION_MAX_FRACTION;
    expect(viewerIntro).toBeGreaterThan(viewerCap + PACING_TOLERANCE_SEC);

    // Without the ramp the same plan is silent; with it the deadline fires.
    expect(auditPacing(build(false)).filter((finding) =>
      finding.startsWith("pacing/holds:")
    )).toEqual([]);
    expect(auditPacing(ramped).filter((finding) =>
      finding.startsWith("pacing/holds:")
    )).toHaveLength(1);
  });
});

describe("auditPacing on the deterministic proof films", () => {
  it("never fires on the model-free fallback film", () => {
    const fallback = buildFallbackComposition({
      product: "Relay",
      whatShipped: "Faster reconnect logic for flaky networks",
      audience: "on-call engineers",
      lengthSec: 18,
    });
    expect(auditPacing(fallback.storyboard)).toEqual([]);
  });
});

describe("Sentinel Phase 3 — normalizeCameraBudget (normalize-before-retry)", () => {
  it("drops the lowest-energy extra move to fit the per-scene budget, keeping the peak", () => {
    // 3s scene → moveCap = 1 + floor(3/3.5) = 1. A quiet pan/track-to-anchor
    // pair plus one whip: the whip (high energy) must survive; both quiet
    // moves are cut.
    const churn = scene({
      id: "busy",
      startSec: 0,
      durationSec: 3,
      camera: {
        version: 1,
        path: [
          move({ move: "pan", startSec: 0.2, durationSec: 0.6 }),
          move({ move: "track-to-anchor", toPart: "chip", startSec: 1.2, durationSec: 0.6 }),
          move({ move: "whip", startSec: 2.4, durationSec: 0.4 }),
        ],
      },
    });
    const result = normalizeCameraBudget([churn]);
    expect(result.normalized).toHaveLength(1);
    expect(result.normalized[0]).toContain('"busy"');
    const survivingMoves = result.storyboard[0]!.camera!.path;
    expect(survivingMoves).toHaveLength(1);
    expect(survivingMoves[0]!.move).toBe("whip");
    // The clamped storyboard no longer trips the camera-budget finding.
    expect(auditPacing(result.storyboard).some((f) => f.startsWith("pacing/camera-budget:"))).toBe(false);
  });

  it("is a no-op when a scene is already inside its budget", () => {
    const calm = scene({
      id: "calm",
      startSec: 0,
      durationSec: 4,
      camera: {
        version: 1,
        path: [
          move({ move: "pan", startSec: 0.4, durationSec: 0.8 }),
          move({ move: "push-in", startSec: 2.4, durationSec: 0.9 }),
        ],
      },
    });
    const result = normalizeCameraBudget([calm]);
    expect(result.normalized).toEqual([]);
    expect(result.storyboard[0]!.camera!.path).toHaveLength(2);
  });

  it("drops camera entirely rather than leaving an empty path", () => {
    // moveCap for a 2s scene is 1; a single whip over budget-of-zero-extra
    // never happens here (cap>=1 always), so exercise the whip-cap path
    // instead: three whips total, the 3rd (in the 2s scene, alone) is cut,
    // leaving that scene's camera undefined rather than { path: [] }.
    const whipOnly = scene({
      id: "whip-only",
      startSec: 20,
      durationSec: 2,
      camera: { version: 1, path: [move({ move: "whip", startSec: 20.5, durationSec: 0.4 })] },
    });
    const a = scene({
      id: "a",
      startSec: 0,
      durationSec: 5,
      camera: { version: 1, path: [move({ move: "whip", startSec: 1, durationSec: 0.4 })] },
    });
    const b = scene({
      id: "b",
      startSec: 5,
      durationSec: 5,
      camera: { version: 1, path: [move({ move: "whip", startSec: 6, durationSec: 0.4 })] },
    });
    const result = normalizeCameraBudget([a, b, whipOnly]);
    const droppedScene = result.storyboard.find((s) => s.id === "whip-only")!;
    expect(droppedScene.camera).toBeUndefined();
  });

  it("never drops a load-bearing move (a declared moment binds inside its window)", () => {
    // 3s scene → cap 1, two quiet moves. The pan carries a declared moment at
    // its arrival, so the clamp must drop the OTHER move even though both are
    // equally low-energy — orphaning moment evidence is never a normalization.
    const guarded = scene({
      id: "guarded",
      startSec: 0,
      durationSec: 3,
      camera: {
        version: 1,
        path: [
          move({ move: "pan", startSec: 0.4, durationSec: 0.6 }),
          move({ move: "track-to-anchor", toPart: "chip", startSec: 1.8, durationSec: 0.6 }),
        ],
      },
      moments: [moment("guarded", "m-arrival", 1.0)],
    });
    const result = normalizeCameraBudget([guarded]);
    expect(result.normalized).toHaveLength(1);
    const surviving = result.storyboard[0]!.camera!.path;
    expect(surviving).toHaveLength(1);
    expect(surviving[0]!.move).toBe("pan");
    // The note is carried on the scene for STORYBOARD.md visibility.
    expect(result.storyboard[0]!.sentinelNormalizations?.length).toBe(1);
  });

  it("refuses to clamp when the budget cannot be met without load-bearing moves", () => {
    // Both moves carry moment evidence: the clamp leaves the scene alone so
    // the blocking finding goes back to the model (and the parse-side
    // convergence check keeps everything atomic).
    const pinned = scene({
      id: "pinned",
      startSec: 0,
      durationSec: 3,
      camera: {
        version: 1,
        path: [
          move({ move: "pan", startSec: 0.4, durationSec: 0.6 }),
          move({ move: "track-to-anchor", toPart: "chip", startSec: 1.8, durationSec: 0.6 }),
        ],
      },
      moments: [moment("pinned", "m-a", 1.0), moment("pinned", "m-b", 2.4)],
    });
    const result = normalizeCameraBudget([pinned]);
    expect(result.normalized).toEqual([]);
    expect(result.storyboard[0]!.camera!.path).toHaveLength(2);
    expect(auditPacing(result.storyboard).some((f) => f.startsWith("pacing/camera-budget:"))).toBe(true);
  });

  it("never drops a load-bearing 3rd whip — the film-budget finding stays for the model", () => {
    const whipScene = (id: string, startSec: number, withMoment: boolean): DirectScene => scene({
      id,
      startSec,
      durationSec: 5,
      camera: { version: 1, path: [move({ move: "whip", startSec: startSec + 1, durationSec: 0.5 })] },
      ...(withMoment ? { moments: [moment(id, `${id}-m`, startSec + 1.4)] } : {}),
    });
    const result = normalizeCameraBudget([
      whipScene("a", 0, false),
      whipScene("b", 5, false),
      whipScene("c", 10, true),
    ]);
    expect(result.normalized).toEqual([]);
    expect(result.storyboard.find((s) => s.id === "c")!.camera).toBeDefined();
    expect(auditPacing(result.storyboard).some((f) => f.includes("whips"))).toBe(true);
  });

  it("caps whips at 2 per film, keeping the earliest chronologically", () => {
    const whipScene = (id: string, startSec: number): DirectScene => scene({
      id,
      startSec,
      durationSec: 5,
      camera: { version: 1, path: [move({ move: "whip", startSec: startSec + 1, durationSec: 0.5 })] },
    });
    const result = normalizeCameraBudget([whipScene("a", 0), whipScene("b", 5), whipScene("c", 10)]);
    expect(result.normalized.some((line) => line.includes("dropped 1 whip"))).toBe(true);
    expect(result.storyboard.find((s) => s.id === "a")!.camera).toBeDefined();
    expect(result.storyboard.find((s) => s.id === "b")!.camera).toBeDefined();
    expect(result.storyboard.find((s) => s.id === "c")!.camera).toBeUndefined();
    expect(auditPacing(result.storyboard).some((f) => f.includes("whips"))).toBe(false);
  });
});

describe("Sentinel Phase 5 — delayConflictingCameraMoves (normalize-before-retry)", () => {
  it("delays a move that starts right after a payoff so the outcome holds", () => {
    // set-state settles at 2.0s; a pan starts at 2.1s — the probe set's
    // dominant "framing changes 0.0s later" shape. The host delays the pan to
    // 2.8s (beat end + OUTCOME_HOLD_SEC) and the finding disappears.
    const busy = scene({
      id: "payoff",
      startSec: 0,
      durationSec: 6,
      components: [{ version: 1 as const, id: "deploy-button", kind: "button" as const }],
      beats: [beat("payoff", {
        id: "b-press",
        component: "deploy-button",
        kind: "set-state",
        atSec: 1.2,
        durationSec: 0.8,
        toState: "success",
      })],
      camera: {
        version: 1,
        path: [move({ move: "pan", startSec: 2.1, durationSec: 1.0 })],
      },
    });
    const before = auditPacing([busy]);
    expect(before.some((f) => f.startsWith("pacing/outcome:"))).toBe(true);
    const result = delayConflictingCameraMoves([busy]);
    expect(result.normalized).toHaveLength(1);
    const delayed = result.storyboard[0]!.camera!.path[0]!;
    expect(delayed.startSec).toBeCloseTo(2.8, 3);
    expect(auditPacing(result.storyboard).some((f) => f.startsWith("pacing/outcome:"))).toBe(false);
    expect(result.storyboard[0]!.sentinelNormalizations?.length).toBe(1);
  });

  it("leaves a move already in flight when the beat lands (arrival choreography)", () => {
    const busy = scene({
      id: "arrival",
      startSec: 0,
      durationSec: 6,
      components: [{ version: 1 as const, id: "deploy-button", kind: "button" as const }],
      beats: [beat("arrival", {
        id: "b-press",
        component: "deploy-button",
        kind: "set-state",
        atSec: 1.2,
        durationSec: 0.8,
        toState: "success",
      })],
      camera: {
        version: 1,
        // Starts at 1.5s, before the beat settles at 2.0s — in flight.
        path: [move({ move: "pan", startSec: 1.5, durationSec: 1.2 })],
      },
    });
    const result = delayConflictingCameraMoves([busy]);
    expect(result.normalized).toEqual([]);
    expect(result.storyboard[0]!.camera!.path[0]!.startSec).toBe(1.5);
  });

  it("never delays a load-bearing move or one that would no longer fit the scene", () => {
    const loadBearing = scene({
      id: "pinned",
      startSec: 0,
      durationSec: 6,
      components: [{ version: 1 as const, id: "deploy-button", kind: "button" as const }],
      beats: [beat("pinned", {
        id: "b-press",
        component: "deploy-button",
        kind: "set-state",
        atSec: 1.2,
        durationSec: 0.8,
        toState: "success",
      })],
      camera: { version: 1, path: [move({ move: "pan", startSec: 2.1, durationSec: 1.0 })] },
      moments: [moment("pinned", "m-arrival", 2.6)],
    });
    expect(delayConflictingCameraMoves([loadBearing]).normalized).toEqual([]);
    const cramped = scene({
      id: "cramped",
      startSec: 0,
      durationSec: 3.2,
      components: [{ version: 1 as const, id: "deploy-button", kind: "button" as const }],
      beats: [beat("cramped", {
        id: "b-press",
        component: "deploy-button",
        kind: "set-state",
        atSec: 1.2,
        durationSec: 0.8,
        toState: "success",
      })],
      // Delayed to 2.8s the 1.0s pan would end at 3.8s — past the 3.2s scene.
      camera: { version: 1, path: [move({ move: "pan", startSec: 2.1, durationSec: 1.0 })] },
    });
    expect(delayConflictingCameraMoves([cramped]).normalized).toEqual([]);
  });
});

describe("Sentinel Phase 3 — stretchMarginalPacingMisses (normalize-before-retry)", () => {
  it("stretches a scene-boundary reading-floor miss and cascade-shifts later scenes", () => {
    // 8 words need ~2.4s; the beat ends at 2.0s and the scene (and the whole
    // film) ends at 2.5s — a 1.9s shortfall's worth of gap is too large, so
    // pick numbers that land WITHIN the stretch cap: beat ends at 2.0s in a
    // 2.5s scene, needing 1.2s min but only having 0.5s — 0.7s shortfall.
    const early = scene({
      id: "opener",
      startSec: 0,
      durationSec: 2.5,
      components: [{ version: 1 as const, id: "query", kind: "search" as const }],
      beats: [beat("opener", { id: "b1", component: "query", kind: "type", atSec: 1.5, text: "ship it" })],
    });
    const later = scene({ id: "closer", startSec: 2.5, durationSec: 3 });
    const before = auditPacing([early, later]);
    expect(before.some((f) => f.startsWith("pacing/reading:"))).toBe(true);

    const result = stretchMarginalPacingMisses([early, later]);
    expect(result.normalized).toHaveLength(1);
    expect(result.normalized[0]).toContain('"opener"');
    const [stretchedOpener, shiftedCloser] = result.storyboard;
    expect(stretchedOpener!.durationSec).toBeGreaterThan(2.5);
    // The cascade shift keeps the film contiguous: closer starts exactly
    // where opener now ends.
    expect(shiftedCloser!.startSec).toBeCloseTo(stretchedOpener!.startSec + stretchedOpener!.durationSec, 5);
    expect(auditPacing(result.storyboard).some((f) => f.startsWith("pacing/reading:"))).toBe(false);
    // The note is carried on the stretched scene for STORYBOARD.md visibility.
    expect(stretchedOpener!.sentinelNormalizations?.length).toBe(1);
  });

  it("cascade-shifts a later scene's gradeShift with its scene (MD4 desync guard)", () => {
    // Same stretchable opener as above; the later scene carries a mid-scene
    // grade shift whose atSec must ride the cascade — a shift left behind
    // would fire before its scene, breaking the moment coincidence and the
    // AA sample alignment.
    const early = scene({
      id: "opener",
      startSec: 0,
      durationSec: 2.5,
      components: [{ version: 1 as const, id: "query", kind: "search" as const }],
      beats: [beat("opener", { id: "b1", component: "query", kind: "type", atSec: 1.5, text: "ship it" })],
    });
    const later = scene({
      id: "closer",
      startSec: 2.5,
      durationSec: 4,
      gradeShift: { version: 1, atSec: 3.5, toGrade: "warm" },
    });
    const result = stretchMarginalPacingMisses([early, later]);
    expect(result.normalized).toHaveLength(1);
    const shifted = result.storyboard[1]!;
    const delta = shifted.startSec - 2.5;
    expect(delta).toBeGreaterThan(0);
    expect(shifted.gradeShift!.atSec).toBeCloseTo(3.5 + delta, 5);
  });

  it("never stretches by more than MAX_PACING_STRETCH_SEC — a larger deficit stays a real finding", () => {
    // The typed line needs ~2.4s (8 words) but the scene gives it none at
    // all (beat ends exactly at the cut) — shortfall exceeds the cap, so the
    // pass leaves it alone for the model to actually fix.
    const early = scene({
      id: "opener",
      startSec: 0,
      durationSec: 1,
      components: [{ version: 1 as const, id: "query", kind: "search" as const }],
      beats: [beat("opener", {
        id: "b1",
        component: "query",
        kind: "type",
        atSec: 0,
        text: "one two three four five six seven eight",
      })],
    });
    const result = stretchMarginalPacingMisses([early]);
    expect(result.normalized).toEqual([]);
    expect(result.storyboard[0]!.durationSec).toBe(1);
    expect(auditPacing(result.storyboard).some((f) => f.startsWith("pacing/reading:"))).toBe(true);
  });

  it("never touches a scene inside a declared (resolvable) timeRamp hold", () => {
    // A ramp only resolves when it is not scene 1 and fits its window — mirror
    // the known-good resolvable ramp shape. The late type beat WOULD be a
    // marginal miss the stretch pass closes, but the ramp guard skips it.
    const opener = scene({ id: "opener", startSec: 0, durationSec: 5 });
    const ramped = scene({
      id: "ramped",
      startSec: 5,
      durationSec: 8,
      timeRamp: { version: 1, atSec: 9.4, slowTo: 0.2, holdSec: 0.9, recoverSec: 1.2 },
      components: [{ version: 1 as const, id: "query", kind: "search" as const }],
      beats: [beat("ramped", { id: "b1", component: "query", kind: "type", atSec: 12.4, text: "ship it now" })],
    });
    // Precondition: the ramp actually resolves (else this proves nothing).
    expect(resolveTimeRampPlan([opener, ramped]).ramps.some((r) => r.sceneId === "ramped")).toBe(true);
    const result = stretchMarginalPacingMisses([opener, ramped]);
    expect(result.normalized).toEqual([]);
    expect(result.storyboard.find((s) => s.id === "ramped")!.durationSec).toBe(8);
  });
});
