import { describe, expect, it } from "vitest";
import {
  collapseCameraPhrases,
  compileCameraPhrasePlan,
  type CameraPhraseSeedV1,
  type CameraPhraseV1,
} from "../src/engine/cameraPhrase.ts";
import type { CameraPlanV1 } from "../src/engine/cameraContract.ts";
import { auditCameraIdeaBudgetPlan } from "../src/engine/cameraBlocking.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";

const anchor = { x: 0.5, y: 0.5, name: "center" as const };

function seed(overrides: Partial<CameraPhraseSeedV1> = {}): CameraPhraseSeedV1 {
  return {
    id: "proof:proof-01:blocking",
    sceneId: "proof",
    phraseId: "proof-01",
    role: "payoff",
    importance: "primary",
    startSec: 1,
    arrivalSec: 2,
    endSec: 4,
    target: { kind: "part", id: "metric", entityId: "shared-metric", entityKind: "metric" },
    occupancy: { min: 0.04, preferred: 0.22, max: 0.36 },
    arrivalPose: { anchor, lens: "detail", zoom: 1.4 },
    corridor: { from: anchor, to: anchor, padding: 0.08 },
    dwell: { startSec: 2, endSec: 3.4, readableSec: 1.4 },
    settleUntilSec: 2.3,
    nextHandoff: { entityId: "shared-metric", toScene: "resolve", toPart: "metric", atSec: 4 },
    ...overrides,
  };
}

const solver = {
  curve: "minimum-jerk-quintic" as const,
  measuredDom: true as const,
  maxNormalizedVelocity: 1.9,
  maxNormalizedAcceleration: 5.8,
  maxNormalizedJerk: 60,
};

describe("CameraPhrase compiler", () => {
  it("joins an authored route with blocking intervals and evidence ownership", () => {
    const cameraPlan: CameraPlanV1 = {
      version: 1,
      scenes: [{
        sceneId: "proof",
        segments: [{
          move: "push-in",
          startSec: 1.1,
          endSec: 2,
          blend: 1,
          zoom: 1.4,
          ease: "seqSettle",
          fromPart: "shell",
          toPart: "metric",
        }],
      }],
    };
    const plan = compileCameraPhrasePlan({
      cameraPlan,
      solver,
      scenes: [{ sceneId: "proof", phrases: [seed()] }],
    });
    const phrase = plan.scenes[0]!.phrases[0]!;
    expect(phrase.routeOwnership).toBe("authored");
    expect(phrase.evidenceOwner).toEqual({
      kind: "camera-segment",
      id: "proof:push-in@1.1",
    });
    expect(phrase.sourcePose).toMatchObject({ target: { kind: "part", id: "shell" } });
    expect(phrase.arrivalPose).toMatchObject({ target: { kind: "part", id: "metric" }, zoom: 1.4 });
    expect(phrase.travel).toEqual({ startSec: 1.1, endSec: 2 });
    expect(phrase.settle).toEqual({ startSec: 2, endSec: 2.3 });
    expect(phrase.dwell).toEqual({ startSec: 2, endSec: 3.4, readableSec: 1.4 });
    expect(phrase.departure).toEqual({ startSec: 3.4, endSec: 4 });
    expect(plan.summary.authoredRouteCount).toBe(1);
  });

  it("marks graph requests as continuity-owned and plain direction as host-derived", () => {
    const plan = compileCameraPhrasePlan({
      cameraPlan: { version: 1, scenes: [] },
      solver,
      scenes: [{
        sceneId: "proof",
        phrases: [
          seed(),
          seed({
            id: "proof:proof-02:blocking",
            phraseId: "proof-02",
            target: { kind: "part", id: "caption" },
            nextHandoff: undefined,
          }),
        ],
      }],
    });
    expect(plan.scenes[0]!.phrases.map((phrase) => phrase.routeOwnership)).toEqual([
      "continuity",
      "host-derived",
    ]);
    expect(plan.summary).toMatchObject({ continuityRouteCount: 1, hostDerivedRouteCount: 1 });
  });

  it("keeps one typed owner when overlapping primary continuity routes demand different stations", () => {
    const competing = [
      seed({
        id: "proof:context:blocking",
        phraseId: "proof-context",
        startSec: 1,
        arrivalSec: 1.28,
        endSec: 2.3,
        target: { kind: "part", id: "context-feed", entityId: "trace", entityKind: "trace" },
        framingTarget: { kind: "region", id: "context-station" },
        dwell: { startSec: 1.28, endSec: 2.28, readableSec: 1 },
        settleUntilSec: 1.5,
      }),
      seed({
        id: "proof:chat:blocking",
        phraseId: "proof-chat",
        startSec: 1.1,
        arrivalSec: 1.34,
        endSec: 2.3,
        target: {
          kind: "part",
          id: "slack-chat",
          entityId: "product-shell",
          entityKind: "product-shell",
        },
        framingTarget: { kind: "region", id: "slack-station" },
        dwell: { startSec: 1.34, endSec: 2.05, readableSec: 0.71 },
        settleUntilSec: 1.55,
      }),
    ];
    const plan = compileCameraPhrasePlan({
      cameraPlan: { version: 1, scenes: [] },
      solver,
      scenes: [{
        sceneId: "proof",
        phrases: competing,
        preferredTarget: "slack-chat",
        interactionTargets: ["slack-chat"],
      }],
    });
    expect(plan.scenes[0]!.phrases).toHaveLength(1);
    expect(plan.scenes[0]!.phrases[0]).toMatchObject({
      target: { id: "slack-chat" },
      collapsedPhraseIds: ["proof-context"],
    });

    const advisoryPlan = compileCameraPhrasePlan({
      cameraPlan: { version: 1, scenes: [] },
      solver,
      scenes: [{ sceneId: "proof", phrases: competing }],
    });
    expect(advisoryPlan.scenes[0]!.phrases).toHaveLength(2);
    expect(auditCameraIdeaBudgetPlan([{
      id: "proof",
      title: "Slack action",
      purpose: "Show the brief and its permission-scoped context",
      startSec: 0,
      durationSec: 3,
      spatialIntent: {
        version: 1,
        focalPart: "slack-chat",
        composition: "chat first, context second",
        relationships: ["slack-chat drives context-feed"],
      },
    }], advisoryPlan)[0]).toContain('Keep "slack-chat in slack-station"');
  });

  it("preserves sequential primary routes because each has its own readable window", () => {
    const plan = compileCameraPhrasePlan({
      cameraPlan: { version: 1, scenes: [] },
      solver,
      scenes: [{
        sceneId: "proof",
        preferredTarget: "metric",
        phrases: [
          seed({ dwell: { startSec: 1, endSec: 1.8, readableSec: 0.8 } }),
          seed({
            id: "proof:resolve:blocking",
            phraseId: "proof-resolve",
            startSec: 1.9,
            arrivalSec: 2.1,
            endSec: 3.5,
            target: { kind: "part", id: "cta", entityId: "cta", entityKind: "cta" },
            dwell: { startSec: 2.1, endSec: 3.2, readableSec: 1.1 },
            settleUntilSec: 2.3,
          }),
        ],
      }],
    });
    expect(plan.scenes[0]!.phrases.map((phrase) => phrase.target.id)).toEqual(["metric", "cta"]);
  });

  it("budgets repeated semantic visits as one idea even when their poses must remain distinct", () => {
    const plan = compileCameraPhrasePlan({
      cameraPlan: { version: 1, scenes: [] },
      solver,
      scenes: [{
        sceneId: "proof",
        phrases: [
          seed({
            framingTarget: { kind: "region", id: "workspace" },
            arrivalPose: { anchor, lens: "detail", zoom: 1 },
          }),
          seed({
            id: "proof:proof-02:blocking",
            phraseId: "proof-02",
            startSec: 2.5,
            arrivalSec: 3,
            endSec: 5,
            framingTarget: { kind: "region", id: "workspace" },
            arrivalPose: { anchor, lens: "detail", zoom: 1.4 },
            dwell: { startSec: 3, endSec: 4.5, readableSec: 1.5 },
            settleUntilSec: 3.3,
          }),
        ],
      }],
    });
    expect(plan.scenes[0]!.phrases).toHaveLength(2);
    expect(auditCameraIdeaBudgetPlan([{
      id: "proof",
      title: "Proof",
      purpose: "Develop one confidence idea",
      startSec: 0,
      durationSec: 5,
      spatialIntent: {
        version: 1,
        focalPart: "metric",
        composition: "metric in workspace",
        relationships: [],
      },
    }], plan)).toEqual([]);
  });

  it("budgets local interaction evidence inside one shared product framing as one idea", () => {
    const plan = compileCameraPhrasePlan({
      cameraPlan: { version: 1, scenes: [] },
      solver,
      scenes: [{
        sceneId: "proof",
        phrases: [
          seed({
            framingTarget: { kind: "region", id: "relay-surface" },
          }),
          seed({
            id: "proof:proof-02:blocking",
            phraseId: "proof-02",
            role: "develop",
            importance: "supporting",
            startSec: 2.5,
            arrivalSec: 2.8,
            endSec: 4,
            target: { kind: "part", id: "last-check", entityId: "cta", entityKind: "cta" },
            framingTarget: { kind: "region", id: "relay-surface" },
            arrivalPose: {
              anchor: { x: 0.78, y: 0.62, name: "bottom-right" },
              lens: "detail",
              zoom: 1,
            },
            dwell: { startSec: 2.8, endSec: 3.5, readableSec: 0.7 },
            settleUntilSec: 3,
            nextHandoff: undefined,
          }),
        ],
      }],
    });
    const localAction = compileCameraPhrasePlan({
      cameraPlan: { version: 1, scenes: [] },
      solver,
      scenes: [{ sceneId: "proof", phrases: [seed({
        id: "proof:proof-02:blocking",
        phraseId: "proof-02",
        role: "develop",
        importance: "supporting",
        startSec: 2.5,
        arrivalSec: 2.8,
        endSec: 4,
        target: { kind: "part", id: "last-check", entityId: "cta", entityKind: "cta" },
        framingTarget: { kind: "region", id: "relay-surface" },
        arrivalPose: {
          anchor: { x: 0.78, y: 0.62, name: "bottom-right" },
          lens: "detail",
          zoom: 1,
        },
        dwell: { startSec: 2.8, endSec: 3.5, readableSec: 0.7 },
        settleUntilSec: 3,
        nextHandoff: undefined,
      })] }],
    }).scenes[0]!.phrases[0]!;
    const auditPlan = {
      ...plan,
      scenes: [{ sceneId: "proof", phrases: [plan.scenes[0]!.phrases[0]!, localAction] }],
    };
    expect(auditPlan.scenes[0]!.phrases).toHaveLength(2);
    expect(auditCameraIdeaBudgetPlan([{
      id: "proof",
      title: "Owner verifies",
      purpose: "Carry the metric into one product surface and verify locally",
      startSec: 0,
      durationSec: 4,
      spatialIntent: {
        version: 1,
        focalPart: "metric",
        composition: "metric and local action inside relay surface",
        relationships: ["last-check develops inside the relay-surface framing"],
      },
    }], auditPlan)).toEqual([]);
  });

  it("budgets two representations of one continuity entity as one idea", () => {
    const meter = compileCameraPhrasePlan({
      cameraPlan: { version: 1, scenes: [] },
      solver,
      scenes: [{ sceneId: "proof", phrases: [seed({
        target: { kind: "part", id: "score-meter", entityId: "metric", entityKind: "metric" },
      })] }],
    });
    const ring = compileCameraPhrasePlan({
      cameraPlan: { version: 1, scenes: [] },
      solver,
      scenes: [{ sceneId: "proof", phrases: [seed({
        id: "proof:proof-02:blocking",
        phraseId: "proof-02",
        startSec: 2.5,
        arrivalSec: 3,
        endSec: 4,
        target: { kind: "part", id: "score-ring", entityId: "metric", entityKind: "metric" },
        framingTarget: { kind: "region", id: "metric-resolve" },
        nextHandoff: undefined,
      })] }],
    }).scenes[0]!.phrases[0]!;
    const auditPlan = {
      ...meter,
      scenes: [{ sceneId: "proof", phrases: [meter.scenes[0]!.phrases[0]!, ring] }],
    };
    expect(auditCameraIdeaBudgetPlan([{
      id: "proof",
      title: "Confidence resolves",
      purpose: "Morph one metric from a card into a ring",
      startSec: 0,
      durationSec: 4,
      spatialIntent: {
        version: 1,
        focalPart: "score-ring",
        composition: "one metric changes representation",
        relationships: ["score-meter morphs into score-ring"],
      },
    }], auditPlan)).toEqual([]);
  });

  it("collapses SignalDock-shaped direction paperwork from 14 phrases to 7 routes", () => {
    const phrase = (
      sceneId: string,
      id: string,
      importance: "primary" | "supporting",
      routeOwnership: CameraPhraseV1["routeOwnership"],
      target: string,
      framing?: string,
    ): CameraPhraseV1 => ({
      id: `${sceneId}:${id}:blocking`,
      sceneId,
      phraseId: `${sceneId}:${id}`,
      role: "develop",
      importance,
      routeOwnership,
      evidenceOwner: { kind: "direction-phrase", id },
      startSec: 0,
      arrivalSec: 0.5,
      endSec: 2,
      target: { kind: "part", id: target },
      ...(framing ? { framingTarget: { kind: "region" as const, id: framing } } : {}),
      occupancy: { min: 0.04, preferred: 0.2, max: 0.4 },
      sourcePose: { anchor, lens: "detail", zoom: 1 },
      arrivalPose: { target: { kind: "part", id: target }, anchor, lens: "detail", zoom: 1 },
      corridor: { from: anchor, to: anchor, padding: 0.08 },
      travel: { startSec: 0, endSec: 0.5 },
      settle: { startSec: 0.5, endSec: 0.7 },
      dwell: { startSec: 0.5, endSec: 1.5, readableSec: 1 },
      departure: { startSec: 1.5, endSec: 2 },
    });
    const phraseScenes = [
      [
        phrase("scattered", "01", "primary", "continuity", "metric-38", "metric-anchor"),
        phrase("scattered", "02", "supporting", "host-derived", "trace"),
      ],
      [
        phrase("gather", "01", "supporting", "continuity", "metric-52", "metric"),
        phrase("gather", "02", "primary", "continuity", "workspace"),
        phrase("gather", "03", "primary", "authored", "metric-52", "metric"),
        phrase("gather", "04", "supporting", "host-derived", "owners"),
      ],
      [
        phrase("approval", "01", "supporting", "continuity", "table", "table"),
        phrase("approval", "02", "primary", "continuity", "metric-71", "confidence"),
        phrase("approval", "03", "supporting", "authored", "approve", "table"),
        phrase("approval", "04", "primary", "host-derived", "approve", "table"),
        phrase("approval", "05", "primary", "host-derived", "approve", "table"),
      ],
      [
        phrase("resolve", "01", "primary", "continuity", "metric-94", "confidence"),
        phrase("resolve", "02", "primary", "continuity", "restore", "cta"),
        phrase("resolve", "03", "supporting", "continuity", "restore", "cta"),
      ],
    ];
    const results = phraseScenes.map((scene) => collapseCameraPhrases(scene));
    expect(results.reduce((count, result) => count + result.phrases.length, 0)).toBe(7);
    expect(results.reduce((count, result) => count + result.collapsed, 0)).toBe(7);
    expect(results[2]!.phrases[1]!.collapsedPhraseIds).toEqual(["approval:05"]);

    const storyboard: DirectScene[] = [
      { id: "scattered", title: "Scattered", purpose: "one metric", startSec: 0, durationSec: 4,
        spatialIntent: { version: 1, focalPart: "metric-38", composition: "center", relationships: [] } },
      { id: "gather", title: "Gather", purpose: "one metric", startSec: 4, durationSec: 5.5,
        spatialIntent: { version: 1, focalPart: "metric-52", composition: "center", relationships: [] } },
      { id: "approval", title: "Approval", purpose: "one action", startSec: 9.5, durationSec: 6.5,
        spatialIntent: { version: 1, focalPart: "approve", composition: "center", relationships: [] } },
      { id: "resolve", title: "Resolve", purpose: "one metric", startSec: 16, durationSec: 7,
        spatialIntent: { version: 1, focalPart: "metric-94", composition: "center", relationships: [] } },
    ];
    const findings = auditCameraIdeaBudgetPlan(storyboard, {
      version: 1,
      enabled: true,
      solver,
      tolerances: {
        opacityMin: 0.35,
        visibleFractionMin: 0.85,
        occupancyMinFactor: 0.9,
        occupancyMaxFactor: 1.1,
        anchorErrorMax: 0.14,
        restSpeedMax: 0.018,
        readableDwellMinSec: 0.35,
        landingSampleInsetSec: 0.08,
        segmentMatchSec: 0.02,
      },
      scenes: storyboard.map((scene, index) => ({
        sceneId: scene.id,
        phrases: results[index]!.phrases,
      })),
      summary: {
        phraseCount: 7,
        explicitTargetCount: 7,
        primaryPhraseCount: 7,
        primaryWithReadableLandingCount: 7,
        inputPhraseCount: 14,
        collapsedPhraseCount: 7,
        authoredRouteCount: 1,
        continuityRouteCount: 5,
        hostDerivedRouteCount: 1,
      },
    });
    expect(findings).toHaveLength(3);
    expect(findings[0]).toContain('Keep "metric-52 in metric"');
    expect(findings[0]).toContain('cut the lens route to "workspace"');
    expect(findings[1]).toContain('Keep "approve in table"');
    expect(findings[2]).toContain('Keep "metric-94 in confidence"');
    expect(findings.join("\n")).not.toContain("at most");
  });
});
