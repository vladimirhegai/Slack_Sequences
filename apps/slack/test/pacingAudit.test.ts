import { describe, expect, it } from "vitest";
import {
  auditPacing,
  sceneIntroductionTimes,
  delayConflictingCameraMoves,
  delayEarlySwapBeats,
  normalizeCameraBudget,
  requiredFramingCount,
  retimeCameraOverInteractions,
  spaceStackedCameraMoves,
  stretchMarginalPacingMisses,
  topUpFramingFloor,
  ENTRY_SETTLE_SEC,
  FRAMING_TOPUP_ZOOM,
  INTERACTION_HOLD_SETTLE_SEC,
  LAST_INTRODUCTION_MAX_FRACTION,
  MOVE_SETTLE_GAP_SEC,
  PACING_TOLERANCE_SEC,
  MAX_PACING_STRETCH_SEC,
  OPENING_SUBJECT_MAX_SEC,
} from "../src/engine/pacingAudit.ts";
import { CAMERA_FULL_MOVES } from "../src/engine/cameraContract.ts";
import { buildFallbackComposition } from "../src/engine/fallbackComposition.ts";
import { resolveTimeRampPlan, warpInverseOf } from "../src/engine/timeRamp.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import type { ComponentBeatIntentV1 } from "../src/engine/componentContract.ts";
import type { CameraMoveIntentV1 } from "../src/engine/cameraContract.ts";
import type { InteractionIntentV1 } from "../src/engine/interactionContract.ts";
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
  it("does not confuse raw move count with the scene's compiled idea count", () => {
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
    expect(findings.some((finding) => finding.startsWith("pacing/camera-budget:"))).toBe(false);
    // A second raw shape with fewer moves is equally free of numeric budgeting.
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

describe("auditPacing opening subject", () => {
  const opening = (atSec: number): DirectScene => scene({
    id: "cold-hook",
    startSec: 0,
    durationSec: 4,
    components: [{ version: 1, id: "trace-chip", kind: "button", role: "hero" }],
    beats: [beat("cold-hook", {
      id: "chip-birth",
      component: "trace-chip",
      kind: "open",
      atSec,
      durationSec: 0.8,
    })],
  });

  it("blocks Probe 6's prolonged empty cold open before source authoring", () => {
    const findings = auditPacing([opening(2.8)]);
    expect(findings.some((finding) =>
      finding.startsWith("storyboard/opening-subject:") && finding.includes("2.8s")
    )).toBe(true);
  });

  it("allows the subject to establish inside the opening window", () => {
    expect(
      auditPacing([opening(OPENING_SUBJECT_MAX_SEC)]).some((finding) =>
        finding.startsWith("storyboard/opening-subject:")
      ),
    ).toBe(false);
  });

  it.each([
    ["type", 0],
    ["set-state", 0.4],
  ] as const)(
    "does not mistake a late development swap for a %s-established headline entrance",
    (initialKind, initialAtSec) => {
      const hook = scene({
        id: "cold-hook-runway",
        startSec: 0,
        durationSec: 5.5,
        components: [
          { version: 1 as const, id: "hook-headline", kind: "headline" as const, role: "hero" },
        ],
        beats: [
          beat("cold-hook-runway", {
            id: "headline-initial",
            component: "hook-headline",
            kind: initialKind,
            atSec: initialAtSec,
            durationSec: 0.8,
            ...(initialKind === "type"
              ? { text: "MISSED HANDOFF" }
              : { toState: "missed-handoff" }),
          }),
          beat("cold-hook-runway", {
            id: "headline-swap",
            component: "hook-headline",
            kind: "swap",
            atSec: 2.5,
            durationSec: 0.6,
            text: "RECOVERED BEFORE NOON",
          }),
        ],
      });

      expect(sceneIntroductionTimes(hook)).toEqual([0, 2.5]);
      expect(auditPacing([hook]).filter((finding) =>
        finding.startsWith("storyboard/opening-subject:")
      )).toEqual([]);
    },
  );

  it.each(["type", "stream"] as const)(
    "still blocks a genuinely late %s entrance that leaves its text slot blank",
    (kind) => {
      const lateText = scene({
        id: "late-copy",
        startSec: 0,
        durationSec: 4,
        components: [
          { version: 1 as const, id: "hero-copy", kind: "headline" as const, role: "hero" },
        ],
        beats: [beat("late-copy", {
          id: "copy-arrives",
          component: "hero-copy",
          kind,
          atSec: 2.8,
          durationSec: 0.8,
          text: "MISSED HANDOFF",
        })],
      });

      expect(sceneIntroductionTimes(lateText)).toEqual([2.8]);
      expect(auditPacing([lateText]).some((finding) =>
        finding.startsWith("storyboard/opening-subject:") && finding.includes("2.8s")
      )).toBe(true);
    },
  );
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

  it("counts static metric and CTA evidence inside one product chassis as one surface", () => {
    const approval = scene({
      id: "approval",
      startSec: 11.1,
      durationSec: 4,
      components: [
        {
          version: 1,
          id: "approval-shell",
          kind: "app-window",
          region: "approval-station",
          role: "support",
        },
        {
          version: 1,
          id: "approval-metric",
          kind: "stat-card",
          region: "approval-station",
          role: "hero",
        },
        {
          version: 1,
          id: "confirm-btn",
          kind: "button",
          region: "approval-station",
          role: "support",
        },
      ],
      beats: [beat("approval", {
        id: "swap-ready",
        component: "approval-metric",
        kind: "swap",
        atSec: 14.6,
        text: "Ready",
      })],
    });
    expect(sceneIntroductionTimes(approval)).toEqual([11.1, 14.6]);
    const next = scene({ id: "lockup", startSec: 15.1, durationSec: 3.4 });
    const repaired = stretchMarginalPacingMisses([approval, next]);
    expect(repaired.normalized).toHaveLength(1);
    expect(repaired.storyboard[0]!.durationSec).toBeCloseTo(5.3, 2);
    expect(repaired.storyboard[1]!.startSec).toBeCloseTo(16.4, 2);
    expect(auditPacing(repaired.storyboard).filter((finding) =>
      finding.startsWith("pacing/holds:") || finding.startsWith("pacing/reading:")
    )).toEqual([]);
  });

  it("keeps explicit child entrances and ambiguous chassis layouts independent", () => {
    const explicitChild = scene({
      id: "explicit-child",
      startSec: 0,
      durationSec: 5,
      components: [
        { version: 1, id: "shell", kind: "app-window", region: "station" },
        { version: 1, id: "cta", kind: "button", region: "station" },
      ],
      beats: [beat("explicit-child", {
        id: "cta-open",
        component: "cta",
        kind: "open",
        atSec: 2,
      })],
    });
    expect(sceneIntroductionTimes(explicitChild)).toEqual([0, 2]);

    const ambiguous = scene({
      id: "ambiguous",
      startSec: 0,
      durationSec: 5,
      components: [
        { version: 1, id: "shell-a", kind: "app-window", region: "station-a" },
        { version: 1, id: "shell-b", kind: "app-window", region: "station-b" },
        { version: 1, id: "metric", kind: "stat-card", region: "station-a" },
      ],
    });
    expect(sceneIntroductionTimes(ambiguous)).toEqual([0, 0, 0]);
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

describe("Sentinel Phase 3 — normalizeCameraBudget (whip-only compatibility)", () => {
  it("preserves per-scene moves because choosing an idea requires a findings-retry", () => {
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
    expect(result.normalized).toEqual([]);
    const survivingMoves = result.storyboard[0]!.camera!.path;
    expect(survivingMoves).toHaveLength(3);
    expect(survivingMoves.map((entry) => entry.move)).toEqual(["pan", "track-to-anchor", "whip"]);
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

  it("never deletes either load-bearing or supporting moves per scene", () => {
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
    expect(result.normalized).toEqual([]);
    const surviving = result.storyboard[0]!.camera!.path;
    expect(surviving).toHaveLength(2);
    expect(result.storyboard[0]!.sentinelNormalizations).toBeUndefined();
  });

  it("leaves overlapping move evidence intact for the idea gate", () => {
    const overlap = scene({
      id: "overlap",
      startSec: 3.4,
      durationSec: 3.8,
      camera: {
        version: 1,
        path: [
          move({ move: "pan", startSec: 3.4, durationSec: 1.4 }),
          move({ move: "track-to-anchor", toPart: "node", startSec: 4.8, durationSec: 1.2 }),
          move({ move: "whip", startSec: 6, durationSec: 0.6 }),
        ],
      },
      moments: [moment("overlap", "whip-arrival", 6)],
    });
    const result = normalizeCameraBudget([overlap]);
    expect(result.normalized).toEqual([]);
    expect(result.storyboard[0]!.camera!.path).toHaveLength(3);
    expect(result.storyboard[0]!.camera!.path.some((entry) => entry.move === "whip")).toBe(true);
  });

  it("never emits the retired raw per-scene camera budget", () => {
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
    expect(auditPacing(result.storyboard).some((f) => f.startsWith("pacing/camera-budget:"))).toBe(false);
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

  it("delays a move already in flight when it obscures the payoff hold", () => {
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
    expect(result.normalized).toHaveLength(1);
    expect(result.storyboard[0]!.camera!.path[0]!.startSec).toBe(2.8);
    expect(auditPacing(result.storyboard).some((f) => f.startsWith("pacing/outcome:")))
      .toBe(false);
  });

  it("lands one same-station camera phrase with its payoff when a delay cannot fit", () => {
    const settling = scene({
      id: "metric-settle",
      startSec: 0,
      durationSec: 3.6,
      components: [{ version: 1, id: "metric", kind: "progress-ring" }],
      beats: [beat("metric-settle", {
        id: "settle",
        component: "metric",
        kind: "set-state",
        atSec: 2.3,
        durationSec: 0.4,
        toState: "settled",
      })],
      camera: {
        version: 1,
        path: [move({
          move: "push-in",
          startSec: 0.8,
          durationSec: 2.38,
          toRegion: "station",
        })],
      },
      spatialIntent: {
        version: 1,
        focalPart: "metric",
        composition: "layout-center-stack",
        relationships: ["metric is the only station"],
      },
      worldLayout: [{ region: "station", cell: [0, 0] }],
      moments: [moment("metric-settle", "camera-push-settle", 2.3)],
    });
    expect(auditPacing([settling]).some((finding) => finding.startsWith("pacing/outcome:")))
      .toBe(true);

    const result = delayConflictingCameraMoves([settling]);
    const landed = result.storyboard[0]!.camera!.path[0]!;
    expect(landed.startSec).toBe(0.8);
    expect(landed.durationSec).toBe(1.84);
    expect(result.normalized[0]).toContain("lands with the payoff");
    expect(auditPacing(result.storyboard).some((finding) => finding.startsWith("pacing/outcome:")))
      .toBe(false);
    expect(delayConflictingCameraMoves(result.storyboard).normalized).toEqual([]);

    const { worldLayout: _worldLayout, ...withoutWorldLayout } = settling;
    const directTarget: DirectScene = {
      ...withoutWorldLayout,
      id: "metric-direct",
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "push-in",
          startSec: 0.8,
          durationSec: 2.38,
          toPart: "metric",
        }],
      },
      beats: settling.beats!.map((entry) => ({ ...entry, sceneId: "metric-direct" })),
      moments: settling.moments!.map((entry) => ({ ...entry, sceneId: "metric-direct" })),
    };
    const directResult = delayConflictingCameraMoves([directTarget]);
    expect(directResult.storyboard[0]!.camera!.path[0]!.durationSec).toBe(1.84);
    expect(auditPacing(directResult.storyboard).some((finding) =>
      finding.startsWith("pacing/outcome:")
    )).toBe(false);
  });

  it("never shortens cross-station travel to manufacture a payoff hold", () => {
    const travel = scene({
      id: "metric-travel",
      startSec: 0,
      durationSec: 3.6,
      components: [{ version: 1, id: "metric", kind: "progress-ring" }],
      beats: [beat("metric-travel", {
        id: "settle",
        component: "metric",
        kind: "set-state",
        atSec: 2.3,
        durationSec: 0.4,
        toState: "settled",
      })],
      camera: {
        version: 1,
        path: [move({
          move: "push-in",
          startSec: 0.8,
          durationSec: 2.38,
          fromRegion: "origin",
          toRegion: "station",
        })],
      },
      spatialIntent: {
        version: 1,
        focalPart: "metric",
        composition: "layout-center-stack",
        relationships: ["camera travels from origin to station"],
      },
      worldLayout: [
        { region: "origin", cell: [-1, 0] },
        { region: "station", cell: [0, 0] },
      ],
      moments: [moment("metric-travel", "camera-travel-settle", 2.3)],
    });
    const result = delayConflictingCameraMoves([travel]);
    expect(result.normalized).toEqual([]);
    expect(result.storyboard).toEqual([travel]);
    expect(auditPacing(result.storyboard).some((finding) => finding.startsWith("pacing/outcome:")))
      .toBe(true);
  });

  it("carries a single camera phrase's moment when delaying that phrase", () => {
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
      moments: [moment("pinned", "m-arrival", 1.8)],
    });
    const result = delayConflictingCameraMoves([loadBearing]);
    expect(result.normalized).toHaveLength(1);
    expect(result.storyboard[0]!.camera!.path[0]!.startSec).toBe(2.8);
    expect(result.storyboard[0]!.moments![0]!.atSec).toBe(2.5);
    expect(auditPacing(result.storyboard).some((finding) => finding.startsWith("pacing/outcome:")))
      .toBe(false);
  });

  it("does not move camera moments in a multi-phrase scene", () => {
    const ambiguous = scene({
      id: "pinned-multi",
      startSec: 0,
      durationSec: 6,
      components: [{ version: 1 as const, id: "deploy-button", kind: "button" as const }],
      beats: [beat("pinned-multi", {
        id: "b-press",
        component: "deploy-button",
        kind: "set-state",
        atSec: 1.2,
        durationSec: 0.8,
        toState: "success",
      })],
      camera: {
        version: 1,
        path: [
          move({ move: "pan", startSec: 2.1, durationSec: 1 }),
          move({ move: "push-in", startSec: 4.5, durationSec: 0.8 }),
        ],
      },
      moments: [moment("pinned-multi", "m-arrival", 1.8)],
    });
    expect(delayConflictingCameraMoves([ambiguous]).normalized).toEqual([]);
    expect(delayConflictingCameraMoves([ambiguous]).storyboard[0]!.moments![0]!.atSec).toBe(1.8);
  });

  it("drops a non-load-bearing move that crosses multiple holds when no clean slot fits", () => {
    const crowded = scene({
      id: "resolve",
      startSec: 10,
      durationSec: 6.5,
      components: [
        { version: 1 as const, id: "headline", kind: "headline" as const },
        { version: 1 as const, id: "sub", kind: "headline" as const },
        { version: 1 as const, id: "metric", kind: "stat-card" as const },
      ],
      beats: [
        beat("resolve", {
          id: "headline-type",
          component: "headline",
          kind: "type",
          atSec: 10.6,
          durationSec: 0.8,
          text: "Incident Replay",
        }),
        beat("resolve", {
          id: "sub-type",
          component: "sub",
          kind: "type",
          atSec: 11,
          durationSec: 2,
          text: "One click. Full timeline. Proven fix.",
        }),
        beat("resolve", {
          id: "metric-swap",
          component: "metric",
          kind: "swap",
          atSec: 14,
          durationSec: 0.6,
          text: "9",
        }),
      ],
      camera: {
        version: 1,
        path: [move({ move: "pull-back", startSec: 11.5, durationSec: 3 })],
      },
    });
    expect(auditPacing([crowded]).some((finding) => finding.startsWith("pacing/reading:")))
      .toBe(true);
    const result = delayConflictingCameraMoves([crowded]);
    expect(result.normalized).toEqual([
      expect.stringContaining("crossed 2 reading/payoff holds"),
    ]);
    expect(result.storyboard[0]!.camera).toBeUndefined();
    expect(auditPacing(result.storyboard).filter((finding) => finding.startsWith("pacing/reading:")))
      .toEqual([]);
  });

  it("stretches the scene's own cut when the delayed move overruns it, cascade-shifting later scenes", () => {
    // The 2026-07-07 probe shape: a payoff in a SHORT scene, the conflicting
    // move delayed to 2.8s would end at 3.8s — 0.6s past the 3.2s scene. A
    // delay alone used to skip here and the finding burned a paid retry; now
    // the cut boundary stretches by the overflow.
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
      camera: { version: 1, path: [move({ move: "pan", startSec: 2.1, durationSec: 1.0 })] },
    });
    const later = scene({ id: "closer", startSec: 3.2, durationSec: 3 });
    const before = auditPacing([cramped, later]);
    expect(before.some((f) => f.startsWith("pacing/outcome:"))).toBe(true);

    const result = delayConflictingCameraMoves([cramped, later]);
    expect(result.normalized).toHaveLength(1);
    expect(result.normalized[0]).toContain("cut boundary stretched");
    const [stretched, shifted] = result.storyboard;
    expect(stretched!.camera!.path[0]!.startSec).toBeCloseTo(2.8, 3);
    expect(stretched!.durationSec).toBeCloseTo(3.8, 3);
    // The cascade keeps the film contiguous and the later scene intact.
    expect(shifted!.startSec).toBeCloseTo(stretched!.startSec + stretched!.durationSec, 5);
    expect(auditPacing(result.storyboard).some((f) => f.startsWith("pacing/outcome:"))).toBe(false);
  });

  it("drops a crowded non-camera reframe instead of stretching an empty tail (LedgerFlow live attempt 1)", () => {
    const payout = scene({
      id: "payout",
      startSec: 10,
      durationSec: 4.5,
      components: [
        { version: 1 as const, id: "approve", kind: "button" as const },
        { version: 1 as const, id: "toast", kind: "toast" as const },
      ],
      beats: [
        beat("payout", {
          id: "press", component: "approve", kind: "press", atSec: 10.3, durationSec: 0.5,
        }),
        beat("payout", {
          id: "success", component: "approve", kind: "set-state", atSec: 11,
          durationSec: 0.4, toState: "success",
        }),
        beat("payout", {
          id: "toast-open", component: "toast", kind: "open", atSec: 11.5, durationSec: 0.8,
        }),
      ],
      camera: {
        version: 1,
        path: [move({
          move: "push-in", toRegion: "payout-station", startSec: 11,
          durationSec: 2.5, zoom: 1.3,
        })],
      },
      moments: [{
        version: 1, id: "toast-lands", sceneId: "payout", atSec: 11.5,
        title: "Approval toast lands", visualState: "Payout approved",
        change: "Result resolves", motionIntent: "resolve", importance: "primary",
      }],
    });
    const result = delayConflictingCameraMoves([payout]);
    expect(result.storyboard[0]!.durationSec).toBe(4.5);
    expect(result.storyboard[0]!.camera).toBeUndefined();
    expect(result.normalized[0]).toContain("crossed 3 reading/payoff holds");
    expect(auditPacing(result.storyboard).filter((finding) =>
      finding.startsWith("pacing/outcome:")
    )).toEqual([]);
  });

  it("drops a same-station reframe that strands long plugin copy after a host auto moment", () => {
    const lockup = scene({
      id: "ship-resolve",
      startSec: 22.4,
      durationSec: 4.89,
      components: [{
        version: 1 as const,
        id: "ship-lockup-sub",
        kind: "headline" as const,
        region: "cta-center",
        pluginUid: "ship-resolve-ship-lockup",
      }],
      beats: [beat("ship-resolve", {
        id: "ship-lockup-b2",
        component: "ship-lockup-sub",
        kind: "type",
        atSec: 23.437,
        durationSec: 1.45,
        text: "One board. One timeline. One confident ship.",
      })],
      camera: {
        version: 1,
        path: [move({
          move: "pull-back",
          startSec: 24.79,
          durationSec: 2.08,
          toRegion: "cta-center",
          zoom: 0.85,
        })],
      },
      moments: [{
        version: 1,
        id: "ship-resolve-auto-2",
        sceneId: "ship-resolve",
        atSec: 26.04,
        title: "Camera pull-back develops toward cta-center",
        visualState: "camera traveling toward cta-center",
        change: "camera pull-back travel develops the framing",
        motionIntent: "camera",
        importance: "supporting",
      }],
    });

    expect(auditPacing([lockup]).some((finding) => finding.startsWith("pacing/reading:")))
      .toBe(true);
    const result = delayConflictingCameraMoves([lockup]);
    expect(result.storyboard[0]!.camera).toBeUndefined();
    expect(result.normalized[0]).toContain("crossed 1 reading/payoff holds");
    expect(auditPacing(result.storyboard).filter((finding) =>
      finding.startsWith("pacing/reading:")
    )).toEqual([]);
  });

  it("trims a marginally long approach so stacked toast outcomes can hold (RelayGuard live attempt 2)", () => {
    const coldOpen = scene({
      id: "cold-noise-open",
      startSec: 0,
      durationSec: 4.5,
      components: [
        { version: 1 as const, id: "toast-1", kind: "toast" as const },
        { version: 1 as const, id: "toast-2", kind: "toast" as const },
        { version: 1 as const, id: "toast-3", kind: "toast" as const },
        {
          version: 1 as const,
          id: "readiness",
          kind: "stat-card" as const,
          region: "readiness-station",
        },
      ],
      beats: [
        beat("cold-noise-open", {
          id: "toast-1-open", component: "toast-1", kind: "open", atSec: 0.54,
          durationSec: 0.5,
        }),
        beat("cold-noise-open", {
          id: "toast-2-open", component: "toast-2", kind: "open", atSec: 1.35,
          durationSec: 0.5,
        }),
        beat("cold-noise-open", {
          id: "toast-3-open", component: "toast-3", kind: "open", atSec: 2.16,
          durationSec: 0.5,
        }),
      ],
      camera: {
        version: 1,
        path: [move({
          move: "push-in",
          toRegion: "readiness-station",
          startSec: 1.5,
          durationSec: 2.8,
          zoom: 1.3,
        })],
      },
      moments: [moment("cold-noise-open", "readiness-arrival", 3.5)],
    });

    expect(auditPacing([coldOpen]).filter((finding) =>
      finding.startsWith("pacing/outcome:")
    )).toHaveLength(2);
    const result = delayConflictingCameraMoves([coldOpen]);
    const approach = result.storyboard[0]!.camera!.path[0]!;
    expect(approach.startSec).toBeCloseTo(3.46, 2);
    expect(approach.durationSec).toBeCloseTo(2.54, 2);
    expect(result.storyboard[0]!.durationSec).toBeCloseTo(6, 2);
    expect(result.normalized[0]).toContain("trimmed duration 2.80s to 2.54s");
    expect(auditPacing(result.storyboard).filter((finding) =>
      finding.startsWith("pacing/outcome:")
    )).toEqual([]);
  });

  it("still skips when the overflow exceeds the stretch cap", () => {
    // Delayed to 2.8s a 2.6s pan would end at 5.4s in a 3.2s scene — a 2.2s
    // overflow is past MAX_PACING_STRETCH_SEC, a genuine layout call for the
    // model, not host arithmetic.
    const hopeless = scene({
      id: "hopeless",
      startSec: 0,
      durationSec: 3.2,
      components: [{ version: 1 as const, id: "deploy-button", kind: "button" as const }],
      beats: [beat("hopeless", {
        id: "b-press",
        component: "deploy-button",
        kind: "set-state",
        atSec: 1.2,
        durationSec: 0.8,
        toState: "success",
      })],
      camera: { version: 1, path: [move({ move: "pan", startSec: 2.1, durationSec: 2.6 })] },
    });
    expect(delayConflictingCameraMoves([hopeless]).normalized).toEqual([]);
    expect(delayConflictingCameraMoves([hopeless]).storyboard[0]!.durationSec).toBe(3.2);
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

  it("stretches a bounded late-introduction and outcome miss at the scene cut", () => {
    // RouteBoardQC5: two coherent surfaces, but the publish button landed at
    // 3.9s in a 5s scene and its press payoff ended only 0.3s before the cut.
    // Extending the cut by 0.7s satisfies both obligations without a creative
    // storyboard rewrite.
    const timeline = scene({
      id: "timeline",
      startSec: 0,
      durationSec: 5,
      components: [
        { version: 1 as const, id: "timeline-list", kind: "list" as const },
        { version: 1 as const, id: "publish-btn", kind: "button" as const },
      ],
      beats: [
        beat("timeline", {
          id: "publish-open",
          component: "publish-btn",
          kind: "open",
          atSec: 3.9,
          durationSec: 0.5,
        }),
        beat("timeline", {
          id: "publish-press",
          component: "publish-btn",
          kind: "press",
          atSec: 4.3,
          durationSec: 0.4,
        }),
      ],
    });
    const proof = scene({ id: "proof", startSec: 5, durationSec: 3 });
    expect(auditPacing([timeline, proof])).toEqual(expect.arrayContaining([
      expect.stringMatching(/^pacing\/holds:/),
      expect.stringMatching(/^pacing\/outcome:/),
    ]));

    const result = stretchMarginalPacingMisses([timeline, proof]);
    expect(result.normalized).toHaveLength(1);
    expect(result.storyboard[0]!.durationSec).toBeCloseTo(5.7, 5);
    expect(result.storyboard[1]!.startSec).toBeCloseTo(5.7, 5);
    expect(auditPacing(result.storyboard).filter((finding) =>
      finding.startsWith("pacing/holds:") || finding.startsWith("pacing/outcome:")
    )).toEqual([]);
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

  it("stretches a ramped scene in viewer time when its late surfaces need a bounded hold", () => {
    // architecture-stress-2 attempt 1: a net-zero slow-motion scene introduced
    // its third surface 2.0s before the cut, but three surfaces need 2.7s of
    // development. Scene boundaries are identity points in the ramp contract,
    // so a 0.7s cut extension buys the missing 0.7 viewer seconds exactly.
    const opener = scene({ id: "opener", startSec: 0, durationSec: 5 });
    const ramped = scene({
      id: "ramped",
      startSec: 5,
      durationSec: 5.5,
      timeRamp: { version: 1, atSec: 6.5, slowTo: 0.35, holdSec: 0.7, recoverSec: 0.8 },
      components: [
        { version: 1 as const, id: "metric", kind: "stat-card" as const },
        { version: 1 as const, id: "approve", kind: "button" as const },
        { version: 1 as const, id: "confirmed", kind: "toast" as const },
      ],
      beats: [beat("ramped", {
        id: "toast-confirms",
        component: "confirmed",
        kind: "open",
        atSec: 8.5,
        durationSec: 0.5,
      })],
    });
    // Precondition: the ramp actually resolves (else this proves nothing).
    expect(resolveTimeRampPlan([opener, ramped]).ramps.some((r) => r.sceneId === "ramped")).toBe(true);
    expect(auditPacing([opener, ramped]).some((finding) => finding.startsWith("pacing/holds:"))).toBe(true);
    const result = stretchMarginalPacingMisses([opener, ramped]);
    expect(result.normalized).toHaveLength(1);
    expect(result.storyboard.find((s) => s.id === "ramped")!.durationSec).toBeCloseTo(6.2, 2);
    expect(auditPacing(result.storyboard).some((finding) => finding.startsWith("pacing/holds:"))).toBe(false);
  });
});

describe("Sentinel — topUpFramingFloor (normalize-before-retry)", () => {
  const held = (id: string, startSec: number, durationSec: number): DirectScene =>
    scene({
      id,
      startSec,
      durationSec,
      components: [{ version: 1, id: `${id}-card`, kind: "stat-card" }],
    });
  const fullMoveCount = (storyboard: DirectScene[]): number =>
    storyboard.reduce(
      (n, s) => n + (s.camera?.path.filter((m) => CAMERA_FULL_MOVES.has(m.move)).length ?? 0),
      0,
    );

  it("adds one establishing push-in to the longest single-framing shot when short by exactly one", () => {
    // 3 shots, 14s, zero full moves → 3 framings; required = round(14/3.5) = 4.
    const storyboard = [held("a", 0, 4), held("b", 4, 4), held("c", 8, 6)];
    expect(requiredFramingCount(14)).toBe(4);
    const result = topUpFramingFloor(storyboard);
    expect(result.normalized).toHaveLength(1);
    expect(result.normalized[0]).toContain('"c"'); // the longest single-framing shot
    const chosen = result.storyboard.find((s) => s.id === "c")!;
    const added = chosen.camera!.path.filter((m) => CAMERA_FULL_MOVES.has(m.move));
    expect(added).toHaveLength(1);
    expect(added[0]!.move).toBe("push-in");
    expect(added[0]!.zoom).toBe(FRAMING_TOPUP_ZOOM);
    // The floor is now met.
    expect(result.storyboard.length + fullMoveCount(result.storyboard)).toBe(requiredFramingCount(14));
  });

  it("adds two bounded establishing moves when two held shots can meet the floor", () => {
    // total 17.5 → required round(17.5/3.5) = 5; 3 shots, no moves → short by 2.
    const storyboard = [held("a", 0, 5.5), held("b", 5.5, 6), held("c", 11.5, 6)];
    expect(requiredFramingCount(17.5)).toBe(5);
    const result = topUpFramingFloor(storyboard);
    expect(result.normalized).toHaveLength(2);
    expect(result.storyboard.length + fullMoveCount(result.storyboard)).toBe(5);
    expect(result.storyboard.find((entry) => entry.id === "b")?.camera?.path).toHaveLength(1);
    expect(result.storyboard.find((entry) => entry.id === "c")?.camera?.path).toHaveLength(1);
  });

  it("upgrades continuity-owned neutral holds without inventing a second idea", () => {
    const withChassis = (id: string, startSec: number, durationSec: number): DirectScene => ({
      ...held(id, startSec, durationSec),
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "hold",
          startSec,
          durationSec,
          toPart: `${id}-card`,
          zoom: 1,
        }],
      },
    });
    const storyboard = [
      withChassis("a", 0, 5.5),
      withChassis("b", 5.5, 6),
      withChassis("c", 11.5, 6),
    ];
    const result = topUpFramingFloor(storyboard);
    expect(result.normalized).toHaveLength(2);
    expect(result.storyboard.length + fullMoveCount(result.storyboard)).toBe(5);
    for (const id of ["b", "c"]) {
      expect(result.storyboard.find((entry) => entry.id === id)?.camera?.path).toEqual([
        expect.objectContaining({ move: "push-in", toPart: `${id}-card` }),
      ]);
    }
  });

  it("leaves a film short by three as a finding (a real content deficit)", () => {
    const storyboard = [held("a", 0, 7), held("b", 7, 7), held("c", 14, 7)];
    expect(requiredFramingCount(21)).toBe(6);
    expect(topUpFramingFloor(storyboard).normalized).toEqual([]);
  });

  it("does not push into a bare title card with no content to frame", () => {
    const bare = (id: string, startSec: number, durationSec: number): DirectScene =>
      scene({ id, startSec, durationSec });
    const storyboard = [bare("a", 0, 4), bare("b", 4, 4), bare("c", 8, 6)];
    expect(requiredFramingCount(14)).toBe(4);
    expect(topUpFramingFloor(storyboard).normalized).toEqual([]);
  });

  it("skips a shot whose opening beat would collide with the push, choosing another", () => {
    const collide = scene({
      id: "c",
      startSec: 8,
      durationSec: 6,
      components: [{ version: 1, id: "c-card", kind: "stat-card" }],
      beats: [beat("c", { id: "c-count", component: "c-card", kind: "count", atSec: 8.2, value: 3 })],
    });
    const storyboard = [held("a", 0, 3), held("b", 3, 5), collide];
    const result = topUpFramingFloor(storyboard);
    expect(result.normalized).toHaveLength(1);
    expect(result.normalized[0]).toContain('"b"'); // c (longest) skipped for its early beat
  });

  it("does not touch a film already at the framing floor", () => {
    const storyboard = [held("a", 0, 4), held("b", 4, 4), held("c", 8, 4)];
    expect(requiredFramingCount(12)).toBe(3); // 3 shots meet it exactly
    expect(topUpFramingFloor(storyboard).normalized).toEqual([]);
  });

  it("does not touch a short (<10s) film", () => {
    const storyboard = [held("a", 0, 3), held("b", 3, 3), held("c", 6, 3)];
    expect(topUpFramingFloor(storyboard).normalized).toEqual([]);
  });
});

function interaction(
  sceneId: string,
  spec: {
    id: string;
    startSec: number;
    arriveSec: number;
    pressSec?: number;
    releaseSec?: number;
    holdUntilSec?: number;
  },
): InteractionIntentV1 {
  return {
    version: 1,
    sceneId,
    cursorId: "cursor",
    targetPart: "nav-item",
    action: "click",
    from: "frame:bottom-right",
    path: "human",
    aimX: 0.5,
    aimY: 0.5,
    feedback: "press-ripple",
    ...spec,
  };
}

describe("2026-07-08 probe set — interaction holds (audit + retimeCameraOverInteractions)", () => {
  // The probe-audit-01 shape: drift 0-1s, whip 1-1.7s to the board, cursor
  // arrives 1.3s, presses 1.4s, releases 1.7s — the whip re-frames the world
  // mid-click.
  const clashing = (): DirectScene =>
    scene({
      id: "board",
      startSec: 0,
      durationSec: 4,
      camera: {
        version: 1,
        path: [
          move({ move: "drift", startSec: 0, durationSec: 1 }),
          move({ move: "whip", toRegion: "board-station", startSec: 1, durationSec: 0.7 }),
        ],
      },
      interactions: [
        interaction("board", {
          id: "lane-click",
          startSec: 0.8,
          arriveSec: 1.3,
          pressSec: 1.4,
          releaseSec: 1.7,
          holdUntilSec: 1.7,
        }),
      ],
    });

  it("auditPacing flags a full move in flight during arrive→result", () => {
    const findings = auditPacing([clashing()]);
    expect(findings.some((finding) =>
      finding.startsWith("pacing/interaction-hold:") && finding.includes('"lane-click"')
    )).toBe(true);
  });

  it("retimeCameraOverInteractions delays the move past the settled result, clearing the finding", () => {
    const result = retimeCameraOverInteractions([clashing()]);
    expect(result.normalized).toHaveLength(1);
    const whip = result.storyboard[0]!.camera!.path.find((entry) => entry.move === "whip")!;
    // result 1.7s + settle = the first stable instant after the click.
    expect(whip.startSec).toBeCloseTo(1.7 + INTERACTION_HOLD_SETTLE_SEC, 3);
    expect(auditPacing(result.storyboard).filter((finding) =>
      finding.startsWith("pacing/interaction-hold:")
    )).toEqual([]);
  });

  it("a move landing before the cursor arrives is left alone", () => {
    const fine = scene({
      id: "calm",
      startSec: 0,
      durationSec: 4,
      camera: {
        version: 1,
        path: [move({ move: "whip", startSec: 0.4, durationSec: 0.6 })],
      },
      interactions: [
        interaction("calm", { id: "late-click", startSec: 1.2, arriveSec: 1.8, pressSec: 1.9, releaseSec: 2.2 }),
      ],
    });
    expect(
      auditPacing([fine]).filter((finding) => finding.startsWith("pacing/interaction-hold:")),
    ).toEqual([]);
    expect(retimeCameraOverInteractions([fine]).normalized).toEqual([]);
  });

  it("a dive over the interaction is exempt (its held middle frames the act)", () => {
    const diving = scene({
      id: "dive-scene",
      startSec: 0,
      durationSec: 6,
      camera: {
        version: 1,
        path: [move({ move: "dive", toPart: "row", startSec: 0.5, durationSec: 4 })],
      },
      interactions: [
        interaction("dive-scene", { id: "row-click", startSec: 1.2, arriveSec: 1.8, pressSec: 2, releaseSec: 2.3 }),
      ],
    });
    expect(
      auditPacing([diving]).filter((finding) => finding.startsWith("pacing/interaction-hold:")),
    ).toEqual([]);
    expect(retimeCameraOverInteractions([diving]).normalized).toEqual([]);
  });

  it("drops a NON-load-bearing move when no retime fits; a load-bearing one keeps its finding", () => {
    // The interaction owns the frame until 4.0s (result 3.7 + settle 0.3) in a
    // 3s scene: delaying the whip there needs a 1.7s+ boundary stretch — over
    // the MAX_PACING_STRETCH_SEC cap, so no retime fits.
    const droppable = scene({
      id: "tight",
      startSec: 0,
      durationSec: 3,
      camera: {
        version: 1,
        path: [move({ move: "whip", startSec: 1, durationSec: 0.7 })],
      },
      interactions: [
        interaction("tight", {
          id: "long-press",
          startSec: 0.4,
          arriveSec: 0.9,
          pressSec: 1.1,
          releaseSec: 3.5,
          holdUntilSec: 3.7,
        }),
      ],
    });
    const dropped = retimeCameraOverInteractions([droppable]);
    expect(dropped.normalized).toHaveLength(1);
    expect(dropped.normalized[0]).toContain("dropped the whip");
    expect(dropped.storyboard[0]!.camera!.path.some((entry) => entry.move === "whip")).toBe(false);

    const loadBearing = scene({
      id: "anchored",
      startSec: 0,
      durationSec: 3,
      camera: {
        version: 1,
        path: [move({ move: "whip", startSec: 1, durationSec: 0.7 })],
      },
      interactions: [
        interaction("anchored", {
          id: "long-press",
          startSec: 0.4,
          arriveSec: 0.9,
          pressSec: 1.1,
          releaseSec: 3.5,
          holdUntilSec: 3.7,
        }),
      ],
      moments: [moment("anchored", "m-arrive", 1.5)],
    });
    expect(retimeCameraOverInteractions([loadBearing]).normalized).toEqual([]);
    expect(auditPacing([loadBearing]).some((finding) =>
      finding.startsWith("pacing/interaction-hold:")
    )).toBe(true);
  });

  it("drops an interaction-owned reframe even when the planner mislabeled cursor arrival as camera-arrival", () => {
    const review = scene({
      id: "exception-review",
      startSec: 5.5,
      durationSec: 4.5,
      camera: {
        version: 1,
        path: [move({
          move: "track-to-anchor", toPart: "exception-row", startSec: 6.7,
          durationSec: 2.3,
        })],
      },
      interactions: [interaction("exception-review", {
        id: "resolve-exception",
        startSec: 7.6,
        arriveSec: 7.9,
        pressSec: 8,
        releaseSec: 8.2,
        holdUntilSec: 8.2,
      })],
      moments: [{
        version: 1, id: "cursor-resolves", sceneId: "exception-review", atSec: 8,
        title: "Cursor resolves exception", visualState: "Cursor lands on the approve button",
        change: "The click clears the policy exception", motionIntent: "camera-arrival", importance: "primary",
      }],
    });
    const result = retimeCameraOverInteractions([review]);
    expect(result.storyboard[0]!.durationSec).toBe(4.5);
    expect(result.storyboard[0]!.camera?.path).toEqual([]);
    expect(result.normalized[0]).toContain("dropped the track-to-anchor");
    expect(auditPacing(result.storyboard).filter((finding) =>
      finding.startsWith("pacing/interaction-hold:")
    )).toEqual([]);
  });

  it("drops a clashing reframe when a resolved beat also owns its camera-labeled moment", () => {
    const ship = scene({
      id: "click-ship-clear",
      startSec: 0,
      durationSec: 6.5,
      components: [
        { version: 1 as const, id: "ship", kind: "button" as const, region: "action" },
        {
          version: 1 as const,
          id: "readiness",
          kind: "stat-card" as const,
          region: "readiness",
        },
      ],
      beats: [beat("click-ship-clear", {
        id: "readiness-count",
        component: "readiness",
        kind: "count",
        atSec: 4,
        durationSec: 1,
        value: 100,
      })],
      camera: {
        version: 1,
        path: [
          move({
            move: "track-to-anchor", toPart: "ship", startSec: 1, durationSec: 1.5,
          }),
          move({ move: "whip", toPart: "readiness", startSec: 3, durationSec: 0.8 }),
        ],
      },
      interactions: [interaction("click-ship-clear", {
        id: "ship-click",
        startSec: 1,
        arriveSec: 2.5,
        pressSec: 3,
        releaseSec: 3.3,
        holdUntilSec: 3.6,
      })],
      moments: [{
        version: 1,
        id: "readiness-clear",
        sceneId: "click-ship-clear",
        atSec: 4,
        title: "Whip lands on readiness",
        visualState: "Whip lands as readiness reaches 100",
        change: "Camera reframes the cleared state",
        motionIntent: "camera-whip",
        importance: "primary",
      }],
    });

    expect(auditPacing([ship]).some((finding) =>
      finding.startsWith("pacing/interaction-hold:")
    )).toBe(true);
    const result = retimeCameraOverInteractions([ship]);
    expect(result.storyboard[0]!.camera!.path.map((entry) => entry.move))
      .toEqual(["track-to-anchor"]);
    expect(result.normalized[0]).toContain("dropped the whip");
    expect(auditPacing(result.storyboard).filter((finding) =>
      finding.startsWith("pacing/interaction-hold:")
    )).toEqual([]);
  });
});

describe("2026-07-08 probe set — spaceStackedCameraMoves (stacked entry transitions)", () => {
  it("delays an energetic move that fires right after the scene's incoming cut", () => {
    // probe-audit-02 momentum-board: hard cut at 3.5, whip at 3.7.
    const opener = scene({ id: "hook", startSec: 0, durationSec: 3.5 });
    const stacked = scene({
      id: "board",
      startSec: 3.5,
      durationSec: 7,
      camera: {
        version: 1,
        path: [
          move({ move: "drift", startSec: 3.5, durationSec: 0.2 }),
          move({ move: "whip", toRegion: "board-region", startSec: 3.7, durationSec: 0.6 }),
        ],
      },
    });
    const result = spaceStackedCameraMoves([opener, stacked]);
    expect(result.normalized).toHaveLength(1);
    expect(result.normalized[0]).toContain("incoming cut needs a beat");
    const whip = result.storyboard[1]!.camera!.path.find((entry) => entry.move === "whip")!;
    expect(whip.startSec).toBeCloseTo(3.5 + ENTRY_SETTLE_SEC, 3);
  });

  it("the FIRST scene has no incoming cut — its opening move is free", () => {
    const opening = scene({
      id: "hook",
      startSec: 0,
      durationSec: 4,
      camera: { version: 1, path: [move({ move: "whip", startSec: 0.2, durationSec: 0.6 })] },
    });
    expect(spaceStackedCameraMoves([opening]).normalized).toEqual([]);
  });

  it("spaces two energetic moves aimed at DIFFERENT targets; same-target pairs stay merged by mergeCompoundMoves", () => {
    const churn = scene({
      id: "churn",
      startSec: 0,
      durationSec: 8,
      camera: {
        version: 1,
        path: [
          move({ move: "whip", toRegion: "a", startSec: 2, durationSec: 0.6 }),
          move({ move: "push-in", toRegion: "b", startSec: 2.7, durationSec: 1, zoom: 1.3 }),
        ],
      },
    });
    const spaced = spaceStackedCameraMoves([churn]);
    expect(spaced.normalized).toHaveLength(1);
    const push = spaced.storyboard[0]!.camera!.path.find((entry) => entry.move === "push-in")!;
    expect(push.startSec).toBeCloseTo(2.6 + MOVE_SETTLE_GAP_SEC, 3);

    const sameTarget = scene({
      id: "same",
      startSec: 0,
      durationSec: 8,
      camera: {
        version: 1,
        path: [
          move({ move: "whip", toRegion: "a", startSec: 2, durationSec: 0.6 }),
          move({ move: "push-in", toRegion: "a", startSec: 2.7, durationSec: 1, zoom: 1.3 }),
        ],
      },
    });
    expect(spaceStackedCameraMoves([sameTarget]).normalized).toEqual([]);
  });

  it("connective pans/drifts right after a cut stay free", () => {
    const opener = scene({ id: "hook", startSec: 0, durationSec: 3 });
    const gentle = scene({
      id: "board",
      startSec: 3,
      durationSec: 5,
      camera: { version: 1, path: [move({ move: "pan", startSec: 3.1, durationSec: 1 })] },
    });
    expect(spaceStackedCameraMoves([opener, gentle]).normalized).toEqual([]);
  });

  it("never delays a move INTO a payoff hold — it clears past it (probe-audit-fable-2)", () => {
    // The live-probe lesson: entry-settle wanted to move the push-in from
    // 4.8s to 5.4s, but a set-state payoff settles at 6.2s and needs its
    // >=0.8s outcome hold — a move in flight 5.4-6.4s would mint the very
    // pacing/outcome finding delayConflictingCameraMoves exists to prevent
    // (it runs BEFORE this normalizer and cannot see its retimes). The
    // spacing delay must walk clear: past 6.2 + 0.8 = 7.0s.
    const opener = scene({ id: "hook", startSec: 0, durationSec: 4.5 });
    const grid = scene({
      id: "collapse-to-grid",
      startSec: 4.5,
      durationSec: 4,
      components: [{ version: 1, id: "compressed-grid", kind: "toggle" }],
      beats: [beat("collapse-to-grid", {
        id: "grid-snap",
        component: "compressed-grid",
        kind: "set-state",
        atSec: 5.9,
        durationSec: 0.3,
        toState: "on",
      })],
      camera: {
        version: 1,
        path: [
          move({ move: "push-in", toRegion: "grid-station", startSec: 4.8, durationSec: 1, zoom: 1.3 }),
        ],
      },
    });
    const result = spaceStackedCameraMoves([opener, grid]);
    expect(result.normalized).toHaveLength(1);
    const push = result.storyboard[1]!.camera!.path[0]!;
    expect(push.startSec).toBeCloseTo(7.0, 3);
    expect(auditPacing(result.storyboard).filter((finding) =>
      finding.startsWith("pacing/outcome:")
    )).toEqual([]);
  });

  it("leaves an unfittable stack alone (spacing is polish, never a veto)", () => {
    const opener = scene({ id: "hook", startSec: 0, durationSec: 3 });
    // Whip at entry, but a second full move immediately after leaves no room
    // to delay it without passing that move.
    const jammed = scene({
      id: "jam",
      startSec: 3,
      durationSec: 4,
      camera: {
        version: 1,
        path: [
          move({ move: "whip", toRegion: "a", startSec: 3.1, durationSec: 0.6 }),
          move({ move: "pan", toRegion: "b", startSec: 3.8, durationSec: 0.8 }),
        ],
      },
    });
    const result = spaceStackedCameraMoves([opener, jammed]);
    expect(result.normalized).toEqual([]);
    expect(result.storyboard[1]!.camera!.path[0]!.startSec).toBe(3.1);
  });
});

describe("2026-07-08 probe-audit-01 — delayEarlySwapBeats (early swap read-hold)", () => {
  // The probe-audit-01 cta-resolve shape: the headline morphs in at the scene
  // start (18.6s) and a swap re-writes it 0.2s later at 18.8s.
  const ctaResolve = (overrides: Partial<DirectScene> = {}): DirectScene =>
    scene({
      id: "cta-resolve",
      startSec: 18.6,
      durationSec: 3,
      components: [{ version: 1, id: "cta-headline", kind: "headline" }],
      beats: [beat("cta-resolve", {
        id: "tagline-swap",
        component: "cta-headline",
        kind: "swap",
        atSec: 18.8,
        durationSec: 0.5,
        text: "Ship with momentum",
      })],
      ...overrides,
    });
  const intro = (): DirectScene => scene({ id: "intro", startSec: 0, durationSec: 18.6 });

  it("delays a swap firing right after a non-first scene's cut to the entry-settle point", () => {
    const result = delayEarlySwapBeats([intro(), ctaResolve()]);
    expect(result.normalized).toHaveLength(1);
    const swap = result.storyboard[1]!.beats!.find((entry) => entry.id === "tagline-swap")!;
    // 18.6 + ENTRY_SETTLE_SEC (0.9) = 19.5.
    expect(swap.atSec).toBeCloseTo(18.6 + ENTRY_SETTLE_SEC, 3);
    expect(swap.atSec).toBeCloseTo(19.5, 3);
  });

  it("audit flags the early swap, and the retime clears it", () => {
    const before = auditPacing([intro(), ctaResolve()]);
    expect(before.some((finding) =>
      finding.startsWith("pacing/reading:") && finding.includes('"tagline-swap"')
    )).toBe(true);
    const result = delayEarlySwapBeats([intro(), ctaResolve()]);
    expect(auditPacing(result.storyboard).filter((finding) =>
      finding.startsWith("pacing/reading:") && finding.includes('"tagline-swap"')
    )).toEqual([]);
  });

  it("leaves a swap in the FIRST scene alone (no incoming cut to hold)", () => {
    const firstSceneSwap = scene({
      id: "opener",
      startSec: 0,
      durationSec: 3,
      components: [{ version: 1, id: "wordmark", kind: "headline" }],
      beats: [beat("opener", { id: "early", component: "wordmark", kind: "swap", atSec: 0.2, durationSec: 0.5, text: "Cadence" })],
    });
    expect(delayEarlySwapBeats([firstSceneSwap]).normalized).toEqual([]);
    expect(auditPacing([firstSceneSwap]).filter((finding) =>
      finding.startsWith("pacing/reading:") && finding.includes('"early"')
    )).toEqual([]);
  });

  it("leaves a swap that already holds past the settle point alone", () => {
    const late = ctaResolve({
      beats: [beat("cta-resolve", { id: "late-swap", component: "cta-headline", kind: "swap", atSec: 19.8, durationSec: 0.5, text: "Ship with momentum" })],
    });
    expect(delayEarlySwapBeats([intro(), late]).normalized).toEqual([]);
  });

  it("leaves a swap alone when delaying it would break a moment binding", () => {
    // A scene-start moment (18.6s) bound to the swap: delaying to 19.5s pushes
    // the beat start past the moment's evidence-after window, so the retime is
    // declined rather than orphaning the moment.
    const bound = ctaResolve({
      moments: [moment("cta-resolve", "resolve-lands", 18.6)],
    });
    expect(delayEarlySwapBeats([intro(), bound]).normalized).toEqual([]);
  });
});
