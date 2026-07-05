import { describe, expect, it } from "vitest";
import {
  auditPacing,
  sceneIntroductionTimes,
} from "../src/engine/pacingAudit.ts";
import { buildFallbackComposition } from "../src/engine/fallbackComposition.ts";
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
    expect(holds[0]).toContain('"cram" introduces 3 surfaces');
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

  it("never judges a single-surface scene", () => {
    const findings = auditPacing([scene({
      id: "solo",
      startSec: 0,
      durationSec: 3,
      components: [components[0]!],
      beats: [beat("solo", { id: "b1", component: "search-box", kind: "open", atSec: 2.6 })],
    })]);
    expect(findings.filter((finding) => finding.startsWith("pacing/holds:"))).toEqual([]);
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
