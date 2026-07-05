import { describe, expect, it } from "vitest";
import {
  auditPacing,
  sceneIntroductionTimes,
  LAST_INTRODUCTION_MAX_FRACTION,
  PACING_TOLERANCE_SEC,
} from "../src/engine/pacingAudit.ts";
import { buildFallbackComposition } from "../src/engine/fallbackComposition.ts";
import { resolveTimeRampPlan, warpInverseOf } from "../src/engine/timeRamp.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import type { ComponentBeatIntentV1 } from "../src/engine/componentContract.ts";
import type { CameraMoveIntentV1 } from "../src/engine/cameraContract.ts";

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
