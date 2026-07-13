import { describe, expect, it } from "vitest";
import type { DirectScene } from "../src/engine/directComposition.ts";
import type { ContinuousMotionEvidenceV1 } from "../src/engine/continuousMotion.ts";
import {
  auditCameraIdeaBudget,
  buildCameraBlockingEvidence,
  minimumJerkProgress,
  parseCameraBlockingPlan,
  resolveCameraBlockingPlan,
} from "../src/engine/cameraBlocking.ts";
import { resolveContinuityGraph } from "../src/engine/continuityGraph.ts";
import { resolveFilmDirectionScore } from "../src/engine/directionScore.ts";

function scenes(): DirectScene[] {
  return [0, 1, 2].map((index): DirectScene => ({
    id: `shot-${index + 1}`,
    title: `Shot ${index + 1}`,
    purpose: "develop the same product surface",
    startSec: index * 3,
    durationSec: 3,
    components: [{
      version: 1,
      id: `shell-${index + 1}`,
      kind: "app-window",
      role: "hero",
      entityId: "product-shell",
    }],
    beats: [{
      version: 1,
      id: `state-${index + 1}`,
      sceneId: `shot-${index + 1}`,
      component: `shell-${index + 1}`,
      kind: "set-state",
      atSec: index * 3 + 1,
      durationSec: 0.6,
      toState: "ready",
    }],
    moments: [{
      version: 1,
      id: `moment-${index + 1}`,
      sceneId: `shot-${index + 1}`,
      atSec: index * 3 + 1.6,
      title: "Product state lands",
      visualState: "Product shell is readable",
      change: "State advances",
      motionIntent: "ui-state",
      importance: "primary",
    }],
    spatialIntent: {
      version: 1,
      focalPart: `shell-${index + 1}`,
      composition: "centered product",
      relationships: [],
    },
    ...(index < 2 ? { cut: { version: 1, style: "hard" as const } } : {}),
  }));
}

describe("camera blocking director", () => {
  it("executes one typed focal route while preserving the competing-route advisory", () => {
    const scene: DirectScene = {
      id: "brief-in-slack",
      title: "Release brief in Slack",
      purpose: "Show the Slack action and permission-scoped retrieval",
      startSec: 3,
      durationSec: 5,
      components: [{
        version: 1,
        id: "slack-chat",
        kind: "chat",
        region: "slack-station",
        role: "hero",
        entityId: "product-shell",
      }, {
        version: 1,
        id: "context-feed",
        kind: "list",
        region: "context-station",
        role: "hero",
        entityId: "trace",
      }],
      beats: [{
        version: 1,
        id: "context-assembles",
        sceneId: "brief-in-slack",
        component: "context-feed",
        kind: "rows",
        atSec: 3.28,
        durationSec: 1,
      }, {
        version: 1,
        id: "brief-typed",
        sceneId: "brief-in-slack",
        component: "slack-chat",
        kind: "swap",
        atSec: 3.9,
        durationSec: 1.2,
        text: "Build our launch video",
      }],
      interactions: [{
        version: 1,
        id: "type-brief",
        sceneId: "brief-in-slack",
        cursorId: "launch-cursor",
        targetPart: "slack-chat",
        item: 1,
        action: "click",
        startSec: 3.05,
        arriveSec: 3.3,
        pressSec: 3.4,
        releaseSec: 3.5,
        from: "frame:bottom-right",
        path: "direct",
        aimX: 0.3,
        aimY: 0.75,
        feedback: "press-ripple",
      }],
      moments: [{
        version: 1,
        id: "context-retrieved",
        sceneId: "brief-in-slack",
        atSec: 3.28,
        title: "Context assembles",
        visualState: "Permission-scoped context appears",
        change: "The release material gathers",
        motionIntent: "reveal",
        importance: "primary",
      }, {
        version: 1,
        id: "cursor-types-brief",
        sceneId: "brief-in-slack",
        atSec: 3.4,
        title: "Cursor types the brief",
        visualState: "The release brief is visible in Slack",
        change: "The product action begins",
        motionIntent: "ui-state",
        importance: "primary",
      }],
      spatialIntent: {
        version: 1,
        focalPart: "slack-chat",
        composition: "Slack chat first, context feed second",
        relationships: ["slack-chat drives context-feed"],
      },
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "push-in",
          startSec: 3.9,
          durationSec: 2,
          toRegion: "slack-station",
        }, {
          version: 1,
          move: "pan",
          startSec: 6.1,
          durationSec: 1.5,
          toRegion: "context-station",
        }],
      },
    };
    const plan = resolveCameraBlockingPlan([scene], resolveContinuityGraph([scene]));
    const primaryTargets = plan.scenes[0]!.phrases
      .filter((phrase) => phrase.importance === "primary")
      .map((phrase) => phrase.target.id);
    expect(primaryTargets).toContain("slack-chat");
    expect(primaryTargets).not.toContain("context-feed");
    expect(auditCameraIdeaBudget([scene]).join("\n")).toContain(
      'Keep "slack-chat in slack-station"',
    );
  });

  it("keeps supporting evidence local when an authored move addresses the focal station", () => {
    const storyboard: DirectScene[] = [{
      id: "owner-verify",
      title: "One owner verifies",
      purpose: "Resolve ownership",
      startSec: 0,
      durationSec: 3.5,
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "push-in",
          startSec: 0.7,
          durationSec: 2.2,
          toRegion: "owner-station",
          zoom: 1.25,
        }],
      },
      components: [
        {
          version: 1,
          id: "owner-stack",
          kind: "avatar-stack",
          region: "owner-station",
          role: "hero",
        },
        {
          version: 1,
          id: "dependency-list",
          kind: "list",
          region: "owner-station",
          role: "support",
          entityId: "trace",
        },
      ],
      beats: [
        {
          version: 1,
          id: "owner-pop",
          sceneId: "owner-verify",
          component: "owner-stack",
          kind: "rows",
          atSec: 0.8,
        },
        {
          version: 1,
          id: "dependency-highlight",
          sceneId: "owner-verify",
          component: "dependency-list",
          kind: "highlight",
          atSec: 2.3,
        },
      ],
      moments: [
        {
          version: 1,
          id: "owner-resolve",
          sceneId: "owner-verify",
          atSec: 0.8,
          title: "Owner lands",
          visualState: "Owner is primary",
          change: "Owner appears",
          motionIntent: "reveal",
          importance: "primary",
        },
        {
          version: 1,
          id: "dependency-verified",
          sceneId: "owner-verify",
          atSec: 2.3,
          title: "Dependency verifies",
          visualState: "Support row highlights",
          change: "Support develops locally",
          motionIntent: "ui-state",
          importance: "supporting",
        },
      ],
      spatialIntent: {
        version: 1,
        focalPart: "owner-stack",
        composition: "owner stack and local dependency list",
        relationships: ["dependency list develops inside the owner framing"],
      },
    }];
    const plan = resolveCameraBlockingPlan(storyboard, resolveContinuityGraph(storyboard));
    expect(plan.scenes[0]!.phrases).toHaveLength(1);
    expect(plan.scenes[0]!.phrases[0]).toMatchObject({
      target: { id: "owner-stack" },
      framingTarget: { kind: "region", id: "owner-station" },
    });
    expect(auditCameraIdeaBudget(storyboard)).toEqual([]);
  });

  it("frames a hero progress ring directly when its only station peer is a support rail", () => {
    const scene: DirectScene = {
      id: "metric-opener",
      title: "Release readiness at 41%",
      purpose: "Establish one carried metric",
      startSec: 0,
      durationSec: 3.6,
      components: [
        {
          version: 1,
          id: "continuity-metric",
          kind: "progress-ring",
          region: "metric-hero",
          role: "hero",
          entityId: "metric",
        },
        {
          version: 1,
          id: "hairline-rule",
          kind: "progress",
          region: "metric-hero",
          role: "support",
          entityId: "rule",
        },
      ],
      beats: [{
        version: 1,
        id: "rule-draw",
        sceneId: "metric-opener",
        component: "hairline-rule",
        kind: "progress",
        atSec: 2,
        durationSec: 1,
        value: 1,
      }],
      moments: [{
        version: 1,
        id: "metric-lands",
        sceneId: "metric-opener",
        atSec: 0.5,
        title: "Metric lands",
        visualState: "The 41% ring is readable",
        change: "The carried metric appears",
        motionIntent: "reveal",
        importance: "primary",
      }],
      spatialIntent: {
        version: 1,
        focalPart: "continuity-metric",
        composition: "layout-center-stack",
        relationships: ["hairline-rule tracks the metric as subordinate evidence"],
      },
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "push-in",
          fromPart: "continuity-metric",
          toPart: "continuity-metric",
          startSec: 0,
          durationSec: 1,
          zoom: 1.15,
        }],
      },
    };
    const direct = resolveCameraBlockingPlan([scene], resolveContinuityGraph([scene]))
      .scenes[0]!.phrases.find((phrase) => phrase.target.id === "continuity-metric")!;
    expect(direct.framingTarget).toBeUndefined();
    expect(direct.occupancy).toEqual({ min: 0.03, preferred: 0.12, max: 0.26 });

    const withProductContext: DirectScene = {
      ...scene,
      components: [
        ...(scene.components ?? []),
        {
          version: 1,
          id: "approval-shell",
          kind: "app-window",
          region: "metric-hero",
          role: "support",
        },
      ],
    };
    const contextual = resolveCameraBlockingPlan(
      [withProductContext],
      resolveContinuityGraph([withProductContext]),
    ).scenes[0]!.phrases.find((phrase) => phrase.target.id === "continuity-metric")!;
    expect(contextual.framingTarget).toEqual({ kind: "region", id: "metric-hero" });
  });

  it("counts a hero ring and its same-station support hairline as one lens idea", () => {
    const oneStation: DirectScene = {
      id: "metric-open",
      title: "Readiness opens",
      purpose: "Establish one metric and its subordinate rail",
      startSec: 0,
      durationSec: 3.5,
      components: [
        {
          version: 1,
          id: "metric-ring",
          kind: "progress-ring",
          region: "metric-rail",
          role: "hero",
        },
        {
          version: 1,
          id: "metric-hairline",
          kind: "progress",
          region: "metric-rail",
          role: "support",
        },
      ],
      beats: [
        {
          version: 1,
          id: "ring-reveal",
          sceneId: "metric-open",
          component: "metric-ring",
          kind: "progress",
          atSec: 0.5,
          durationSec: 0.8,
          value: 0.48,
        },
        {
          version: 1,
          id: "hairline-draw",
          sceneId: "metric-open",
          component: "metric-hairline",
          kind: "progress",
          atSec: 2,
          durationSec: 0.6,
          value: 0.12,
        },
      ],
      moments: [
        {
          version: 1,
          id: "ring-moment",
          sceneId: "metric-open",
          atSec: 0.5,
          title: "Ring reveals",
          visualState: "The 48% ring is visible",
          change: "The metric arrives",
          motionIntent: "reveal",
          importance: "primary",
        },
        {
          version: 1,
          id: "hairline-moment",
          sceneId: "metric-open",
          atSec: 2,
          title: "Hairline draws",
          visualState: "The subordinate rail fills beneath the ring",
          change: "Local support evidence develops",
          motionIntent: "draw-on",
          importance: "supporting",
        },
      ],
      spatialIntent: {
        version: 1,
        focalPart: "metric-ring",
        composition: "layout-center-stack",
        relationships: ["the hairline stays subordinate inside the metric station"],
      },
      camera: {
        version: 1,
        path: [
          { version: 1, move: "drift", startSec: 0, durationSec: 1 },
          {
            version: 1,
            move: "push-in",
            startSec: 1,
            durationSec: 2.08,
            toRegion: "metric-rail",
            zoom: 1.08,
          },
        ],
      },
      worldLayout: [{ region: "metric-rail", cell: [0, 0] }],
    };
    const plan = resolveCameraBlockingPlan([oneStation], resolveContinuityGraph([oneStation]));
    expect(plan.scenes[0]!.phrases.map((phrase) => phrase.target.id)).toEqual([
      "metric-ring",
      "metric-hairline",
    ]);
    expect(plan.scenes[0]!.phrases[1]!.framingTarget).toEqual({
      kind: "region",
      id: "metric-rail",
    });
    expect(auditCameraIdeaBudget([oneStation])).toEqual([]);

    const splitStation: DirectScene = {
      ...oneStation,
      components: oneStation.components!.map((component) =>
        component.id === "metric-hairline"
          ? { ...component, region: "support-rail" }
          : component
      ),
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "push-in",
          startSec: 1,
          durationSec: 2.08,
          toPart: "metric-hairline",
          zoom: 1.08,
        }],
      },
      worldLayout: [
        { region: "metric-rail", cell: [0, 0] },
        { region: "support-rail", cell: [1, 0] },
      ],
    };
    expect(auditCameraIdeaBudget([splitStation]).some((finding) =>
      finding.startsWith("camera/idea-budget:")
    )).toBe(true);
  });

  it("frames a metric and confirmation inside one hero modal as one lens idea", () => {
    const storyboard: DirectScene[] = [{
      id: "approval-surface",
      title: "Owner confirms",
      purpose: "Carry the resolved metric into one approval surface",
      startSec: 0,
      durationSec: 4,
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "hold",
          startSec: 0,
          durationSec: 4,
          toPart: "metric-value-card",
        }],
      },
      components: [
        { version: 1, id: "approval-modal", kind: "modal", role: "hero", entityId: "product-shell" },
        { version: 1, id: "metric-value-card", kind: "stat-card", role: "hero", entityId: "release-metric" },
        { version: 1, id: "confirm-btn", kind: "button", role: "support", entityId: "cta" },
      ],
      beats: [
        {
          version: 1,
          id: "set-91-modal",
          sceneId: "approval-surface",
          component: "metric-value-card",
          kind: "count",
          atSec: 0.2,
          value: 91,
        },
        {
          version: 1,
          id: "btn-press",
          sceneId: "approval-surface",
          component: "confirm-btn",
          kind: "set-state",
          atSec: 2.4,
          toState: "pressed",
        },
      ],
      interactions: [{
        version: 1,
        id: "confirm-click",
        sceneId: "approval-surface",
        cursorId: "main-cursor",
        targetPart: "confirm-btn",
        action: "click",
        startSec: 1.8,
        arriveSec: 2.4,
        pressSec: 2.52,
        releaseSec: 2.66,
        from: "frame:bottom-right",
        path: "direct",
        aimX: 0.5,
        aimY: 0.5,
        feedback: "press-ripple",
        targetScale: 1,
      }],
      moments: [
        {
          version: 1,
          id: "modal-init",
          sceneId: "approval-surface",
          atSec: 0.2,
          title: "91% preserved",
          visualState: "Approval modal shows the incoming 91%",
          change: "Metric state enters the product surface",
          motionIntent: "ui-state",
          importance: "primary",
        },
        {
          version: 1,
          id: "confirm-press",
          sceneId: "approval-surface",
          atSec: 2.4,
          title: "Owner confirms",
          visualState: "Button confirms inside the same modal",
          change: "Approval state resolves",
          motionIntent: "ui-state",
          importance: "primary",
        },
      ],
      spatialIntent: {
        version: 1,
        focalPart: "metric-value-card",
        composition: "metric and confirmation inside one approval modal",
        relationships: ["confirm-btn develops inside approval-modal"],
      },
    }];
    const plan = resolveCameraBlockingPlan(storyboard, resolveContinuityGraph(storyboard));
    expect(plan.scenes[0]!.phrases.map((phrase) => phrase.framingTarget?.id)).toEqual([
      "approval-modal",
      "approval-modal",
    ]);
    expect(auditCameraIdeaBudget(storyboard)).toEqual([]);
  });

  it("gives every phrase a target, occupancy, arrival, corridor, dwell, and next handoff", () => {
    const storyboard = scenes();
    const graph = resolveContinuityGraph(storyboard);
    const plan = resolveCameraBlockingPlan(storyboard, graph);
    const phrases = plan.scenes.flatMap((scene) => scene.phrases);
    expect(phrases.length).toBeGreaterThanOrEqual(3);
    expect(plan.summary.explicitTargetCount).toBe(plan.summary.phraseCount);
    expect(plan.summary.primaryWithReadableLandingCount).toBe(plan.summary.primaryPhraseCount);
    expect(phrases.every((phrase) => phrase.occupancy.min > 0 && phrase.occupancy.max < 1)).toBe(true);
    expect(phrases.every((phrase) => phrase.dwell.endSec >= phrase.dwell.startSec)).toBe(true);
    expect(phrases.some((phrase) => phrase.nextHandoff?.entityId === "product-shell")).toBe(true);

    const island = `<script id="sequences-camera-blocking" type="application/json">${JSON.stringify(plan)}</script>`;
    expect(parseCameraBlockingPlan(island)?.solver.curve).toBe("minimum-jerk-quintic");
  });

  it("lands by action onset and holds through the dominant action plus settle", () => {
    const storyboard = scenes();
    const scorePhrase = resolveFilmDirectionScore(storyboard).scenes[0]!.phrases[0]!;
    const block = resolveCameraBlockingPlan(
      storyboard,
      resolveContinuityGraph(storyboard),
    ).scenes[0]!.phrases[0]!;

    expect(block.arrivalSec).toBe(Math.max(
      scorePhrase.startSec,
      Math.min(scorePhrase.cueSec, scorePhrase.dominant.startSec),
    ));
    expect(block.arrivalSec).toBe(scorePhrase.dominant.startSec);
    expect(block.arrivalSec).toBeLessThan(scorePhrase.dominant.endSec);
    expect(block.dwell.endSec).toBeGreaterThanOrEqual(scorePhrase.dominant.endSec);
    expect(block.dwell.endSec).toBeGreaterThanOrEqual(scorePhrase.settleUntilSec);
  });

  it("ends outgoing readable dwell before an animated cut takes the frame", () => {
    const storyboard = scenes();
    storyboard[0]!.cut = {
      version: 1,
      style: "swipe",
      axis: "left",
      exitSec: 0.4,
      entrySec: 0.5,
    };
    const block = resolveCameraBlockingPlan(
      storyboard,
      resolveContinuityGraph(storyboard),
    ).scenes[0]!.phrases[0]!;
    expect(block.dwell.endSec).toBeLessThanOrEqual(2.6);
    expect(block.dwell.readableSec).toBeCloseTo(block.dwell.endSec - block.arrivalSec, 5);
  });

  it("arrives before cursor travel when a later payoff beat shares the interaction target", () => {
    const storyboard: DirectScene[] = [{
      id: "cta-shot",
      title: "CTA resolve",
      purpose: "let the viewer see the CTA before the cursor starts moving",
      startSec: 0,
      durationSec: 5,
      components: [{ version: 1, id: "cta", kind: "button", role: "hero", entityId: "cta" }],
      beats: [{
        version: 1, id: "cta-state", sceneId: "cta-shot", component: "cta",
        kind: "set-state", atSec: 3.6, durationSec: 0.5, toState: "open",
      }],
      interactions: [{
        version: 1, id: "cta-click", sceneId: "cta-shot", cursorId: "default",
        targetPart: "cta", action: "click", startSec: 3.1, arriveSec: 3.6,
        pressSec: 3.7, releaseSec: 3.82,
        from: "frame:bottom-right", path: "arc", aimX: 0.5, aimY: 0.5,
        feedback: "press-ripple",
      }],
      moments: [{
        version: 1, id: "cta-payoff", sceneId: "cta-shot", atSec: 3.6,
        title: "CTA resolves", visualState: "The CTA receives its click",
        change: "The action resolves", motionIntent: "resolve", importance: "primary",
      }],
      spatialIntent: {
        version: 1, focalPart: "cta", composition: "centered CTA", relationships: [],
      },
    }];
    const score = resolveFilmDirectionScore(storyboard).scenes[0]!.phrases[0]!;
    expect(score.competing.some((action) => action.system === "interaction")).toBe(true);
    const block = resolveCameraBlockingPlan(storyboard, resolveContinuityGraph(storyboard))
      .scenes[0]!.phrases[0]!;
    expect(block.arrivalSec).toBe(3.1);
    expect(block.arrivalSec).toBeLessThan(storyboard[0]!.interactions![0]!.arriveSec);
  });

  it("treats an authored camera phrase as target intent and lands when its travel resolves", () => {
    const storyboard: DirectScene[] = [{
      id: "camera-owned",
      title: "Camera-owned phrase",
      purpose: "The graph owns travel while the authored move supplies intent",
      startSec: 0,
      durationSec: 4,
      components: [{
        version: 1,
        id: "detail",
        kind: "stat-card",
        role: "hero",
      }],
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "track-to-anchor",
          toPart: "detail",
          startSec: 0.8,
          durationSec: 1.4,
          zoom: 1.2,
        }],
      },
      moments: [{
        version: 1,
        id: "camera-arrival",
        sceneId: "camera-owned",
        atSec: 2.2,
        title: "Camera reaches detail",
        visualState: "Detail is framed",
        change: "Camera arrives",
        motionIntent: "camera-arrival",
        importance: "primary",
      }],
      spatialIntent: {
        version: 1,
        focalPart: "detail",
        composition: "detail framing",
        relationships: [],
      },
    }];
    const scorePhrase = resolveFilmDirectionScore(storyboard).scenes[0]!.phrases[0]!;
    expect(scorePhrase.dominant.system).toBe("camera");
    const block = resolveCameraBlockingPlan(
      storyboard,
      resolveContinuityGraph(storyboard),
    ).scenes[0]!.phrases[0]!;

    // With the continuity graph enabled, the authored camera move contributes
    // target/lens intent while the graph owns the travel. A camera cue is a
    // landing, not an instruction to call the move complete at its first frame.
    expect(block.arrivalSec).toBe(2.2);
    expect(block.arrivalSec).toBe(scorePhrase.dominant.endSec);
    expect(block.arrivalSec).toBe(scorePhrase.cueSec);
    expect(block.dwell.endSec).toBeGreaterThanOrEqual(scorePhrase.settleUntilSec);
  });

  it("uses UI-form-aware ranges for a full trace list and a metric", () => {
    const visualScenes: DirectScene[] = [
      {
        id: "trace-shot",
        title: "Trace",
        purpose: "read the dependency trace",
        startSec: 0,
        durationSec: 3,
        components: [{
          version: 1, id: "trace-list", kind: "list", role: "hero", entityId: "trace",
        }],
        moments: [{
          version: 1, id: "trace-read", sceneId: "trace-shot", atSec: 1,
          title: "Trace reads", visualState: "Dependency trace is readable",
          change: "Trace appears", motionIntent: "ui-state", importance: "primary",
        }],
        spatialIntent: {
          version: 1, focalPart: "trace-list", composition: "trace list", relationships: [],
        },
      },
      {
        id: "metric-shot",
        title: "Metric",
        purpose: "read the verification metric",
        startSec: 3,
        durationSec: 3,
        components: [{
          version: 1, id: "metric-card", kind: "stat-card", role: "hero", entityId: "metric",
        }],
        moments: [{
          version: 1, id: "metric-read", sceneId: "metric-shot", atSec: 4,
          title: "Metric reads", visualState: "Verification metric is readable",
          change: "Metric appears", motionIntent: "ui-state", importance: "primary",
        }],
        spatialIntent: {
          version: 1, focalPart: "metric-card", composition: "metric card", relationships: [],
        },
      },
    ];
    const plan = resolveCameraBlockingPlan(visualScenes, resolveContinuityGraph(visualScenes));
    const phrases = plan.scenes.flatMap((scene) => scene.phrases);
    const trace = phrases.find((phrase) =>
      phrase.target.entityKind === "trace" && phrase.importance === "primary"
    );
    const metric = phrases.find((phrase) =>
      phrase.target.entityKind === "metric" && phrase.importance === "primary"
    );
    expect(trace?.occupancy).toEqual({ min: 0.08, preferred: 0.16, max: 0.34 });
    expect(metric?.occupancy).toMatchObject({ min: 0.015, max: 0.24 });
  });

  it("frames a stable plugin unit instead of chasing one animated child", () => {
    const storyboard: DirectScene[] = [{
      id: "checks",
      title: "Checks",
      purpose: "show a notification cascade",
      startSec: 0,
      durationSec: 4,
      plugins: [{
        version: 1,
        kind: "notification-stack",
        id: "check-stack",
        uid: "checks-check-stack",
        params: { count: 3, tone: "mixed", topic: "rollout" },
      }],
      components: [{
        version: 1,
        id: "check-stack-toast-1",
        kind: "toast",
        role: "support",
        pluginUid: "checks-check-stack",
      }],
      beats: [{
        version: 1,
        id: "toast-1",
        sceneId: "checks",
        component: "check-stack-toast-1",
        kind: "open",
        atSec: 0.5,
        durationSec: 0.5,
      }],
      moments: [{
        version: 1,
        id: "checks-arrive",
        sceneId: "checks",
        atSec: 0.6,
        title: "Checks arrive",
        visualState: "The notification stack is readable",
        change: "The first check opens",
        motionIntent: "reveal",
        importance: "supporting",
      }],
    }];
    const block = resolveCameraBlockingPlan(
      storyboard,
      resolveContinuityGraph(storyboard),
    ).scenes[0]!.phrases[0]!;
    expect(block.target).toEqual({ kind: "part", id: "check-stack" });
    expect(block.occupancy).toEqual({ min: 0.025, preferred: 0.1, max: 0.3 });
  });

  it("uses visual form and centered composition when a headline carries CTA continuity", () => {
    const brand: DirectScene[] = [{
      id: "brand-resolve",
      title: "Brand resolve",
      purpose: "resolve a centered brand lockup",
      startSec: 0,
      durationSec: 4,
      components: [{
        version: 1,
        id: "brand-lockup-sub",
        kind: "headline",
        role: "hero",
        entityId: "cta",
        pluginUid: "brand-resolve-brand-lockup",
      }],
      moments: [{
        version: 1,
        id: "brand-lands",
        sceneId: "brand-resolve",
        atSec: 1.2,
        title: "Brand lands",
        visualState: "The complete lockup is readable",
        change: "The brand resolves",
        motionIntent: "reveal",
        importance: "primary",
      }],
      spatialIntent: {
        version: 1,
        focalPart: "brand-lockup-sub",
        composition: "layout-center-stack",
        relationships: ["wordmark and supporting line read as one lockup"],
      },
    }];
    const phrase = resolveCameraBlockingPlan(brand, resolveContinuityGraph(brand))
      .scenes[0]!.phrases.find((candidate) => candidate.importance === "primary")!;

    expect(phrase.target.entityKind).toBe("cta");
    expect(phrase.occupancy).toMatchObject({ min: 0.025, preferred: 0.08 });
    expect(phrase.framingTarget).toEqual({ kind: "part", id: "brand-lockup" });
    expect(phrase.arrivalPose.anchor).toMatchObject({ x: 0.5, y: 0.5, name: "center" });
  });

  it("keeps a primary plugin toast inside a compact status occupancy range", () => {
    const storyboard: DirectScene[] = [{
      id: "alert-open",
      title: "Alert open",
      purpose: "land one notification without turning it into a hero panel",
      startSec: 0,
      durationSec: 3,
      components: [{
        version: 1,
        id: "notices-toast-1",
        kind: "toast",
        pluginUid: "alert-open-notices",
      }],
      beats: [{
        version: 1,
        id: "notice-open",
        sceneId: "alert-open",
        component: "notices-toast-1",
        kind: "open",
        atSec: 0.3,
      }],
      moments: [{
        version: 1,
        id: "notice-lands",
        sceneId: "alert-open",
        atSec: 0.3,
        title: "Notice lands",
        visualState: "One compact product toast is readable",
        change: "The toast opens",
        motionIntent: "reveal",
        importance: "primary",
      }],
      spatialIntent: {
        version: 1,
        focalPart: "notices-toast-1",
        composition: "compact notification",
        relationships: [],
      },
    }];
    const phrase = resolveCameraBlockingPlan(storyboard, resolveContinuityGraph(storyboard))
      .scenes[0]!.phrases.find((candidate) => candidate.importance === "primary")!;

    expect(phrase.occupancy).toEqual({ min: 0.0025, preferred: 0.012, max: 0.065 });
  });

  it("uses a true minimum-jerk quintic with clean endpoint derivatives", () => {
    expect(minimumJerkProgress(0)).toBe(0);
    expect(minimumJerkProgress(1)).toBe(1);
    const epsilon = 0.0001;
    const startVelocity = (minimumJerkProgress(epsilon) - minimumJerkProgress(0)) / epsilon;
    const endVelocity = (minimumJerkProgress(1) - minimumJerkProgress(1 - epsilon)) / epsilon;
    expect(startVelocity).toBeLessThan(0.001);
    expect(endVelocity).toBeLessThan(0.001);
    expect(minimumJerkProgress(0.5)).toBeCloseTo(0.5, 8);
  });

  it("treats an explicit full-move destination as camera-load-bearing", () => {
    const storyboard: DirectScene[] = [{
      id: "timeline",
      title: "Timeline",
      purpose: "Reveal a publish action",
      startSec: 0,
      durationSec: 5,
      components: [
        { version: 1, id: "timeline-list", kind: "list", region: "head", role: "hero" },
        { version: 1, id: "publish-btn", kind: "button", region: "foot", role: "support" },
      ],
      beats: [{ version: 1, id: "publish-open", sceneId: "timeline", component: "publish-btn", kind: "open", atSec: 3.2, durationSec: 0.5 }],
      moments: [{
        version: 1,
        id: "publish",
        sceneId: "timeline",
        atSec: 3.2,
        title: "Publish appears",
        visualState: "The publish button is readable",
        change: "The action becomes available",
        motionIntent: "reveal",
        importance: "supporting",
        evidence: { kind: "component", detail: "component:open→publish-btn", startSec: 3.2, endSec: 3.7 },
      }],
      camera: { version: 1, path: [{ version: 1, move: "whip", startSec: 0, durationSec: 1.2, fromRegion: "head", toRegion: "foot" }] },
    }];
    const phrase = resolveCameraBlockingPlan(storyboard, resolveContinuityGraph(storyboard))
      .scenes[0]!.phrases.find((candidate) => candidate.target.id === "publish-btn")!;
    expect(phrase.importance).toBe("primary");
    expect(phrase.dwell.readableSec).toBeGreaterThanOrEqual(0.62);
  });

  it("does not promote supporting UI merely because it shares the hero's destination region", () => {
    const storyboard: DirectScene[] = [{
      id: "board",
      title: "Board composes",
      purpose: "Hold the composed board while its sidebar updates",
      startSec: 0,
      durationSec: 4,
      components: [
        { version: 1, id: "launch-board", kind: "app-window", region: "board-center", role: "hero" },
        { version: 1, id: "board-sidebar", kind: "sidebar", region: "board-center", role: "support" },
      ],
      beats: [
        { version: 1, id: "board-rows", sceneId: "board", component: "launch-board", kind: "rows", atSec: 0.5, durationSec: 1.5 },
        { version: 1, id: "sidebar-select", sceneId: "board", component: "board-sidebar", kind: "select", atSec: 2, durationSec: 0.6, item: 2 },
      ],
      moments: [{
        version: 1,
        id: "sidebar-updates",
        sceneId: "board",
        atSec: 2,
        title: "Sidebar selects launch channel",
        visualState: "The board stays framed while its sidebar selection changes",
        change: "The sidebar updates",
        motionIntent: "ui-state",
        importance: "supporting",
        evidence: { kind: "component", detail: "component:select→board-sidebar", startSec: 2, endSec: 2.6 },
      }],
      spatialIntent: {
        version: 1,
        focalPart: "launch-board",
        composition: "centered product board",
        relationships: ["sidebar supports the board"],
      },
      camera: { version: 1, path: [{
        version: 1,
        move: "push-in",
        startSec: 0.8,
        durationSec: 1.8,
        toRegion: "board-center",
      }] },
    }];

    const phrases = resolveCameraBlockingPlan(storyboard, resolveContinuityGraph(storyboard))
      .scenes[0]!.phrases;
    expect(phrases.find((phrase) => phrase.target.id === "board-sidebar")?.importance).toBe("supporting");
  });

  it("joins browser geometry to landings and exposes the acceptance metrics", () => {
    const storyboard = scenes();
    const graph = resolveContinuityGraph(storyboard);
    const plan = resolveCameraBlockingPlan(storyboard, graph);
    const blocks = plan.scenes.flatMap((scene) => scene.phrases);
    const samples = blocks.map((block) => ({
      time: block.arrivalSec,
      sceneId: block.sceneId,
      phraseId: block.phraseId,
      attention: { kind: "part" as const, id: block.target.id },
      focal: {
        found: true,
        visibleFraction: 1,
        occupancyFraction: block.occupancy.preferred,
        centerX: block.arrivalPose.anchor.x * 1920,
        centerY: block.arrivalPose.anchor.y * 1080,
        width: 900,
        height: 600,
        speed: 0.01,
        acceleration: 0.02,
        jerk: 0.03,
      },
      independentMotionCount: 1,
    }));
    const motion = {
      version: 1,
      advisory: true,
      sampleHz: 8,
      frame: { width: 1920, height: 1080 },
      samples,
      reversals: [],
      jerkMarkers: [],
      quietWindows: [],
      settleWindows: [],
      scenes: [],
      summary: {
        sampleCount: samples.length,
        focalFoundSamples: samples.length,
        minimumVisibleFraction: 1,
        meanVisibleFraction: 1,
        minimumOccupancyFraction: 0.2,
        meanOccupancyFraction: 0.42,
        offframeSamples: 0,
        tinyFocalSamples: 0,
        peakSpeed: 0.01,
        peakAcceleration: 0.02,
        peakJerk: 0.03,
        reversalCount: 0,
        jerkMarkerCount: 0,
        maxIndependentMotionCount: 1,
        meanIndependentMotionCount: 1,
        settleWindowCount: 0,
        measuredSettleWindowCount: 0,
        settledByWindowEndCount: 0,
        quietWindowCount: 0,
        maxQuietWindowSec: 0,
      },
      advisories: [],
    } satisfies ContinuousMotionEvidenceV1;
    const evidence = buildCameraBlockingEvidence(plan, graph, motion);
    expect(evidence.summary.threeShotEntityCount).toBe(1);
    expect(evidence.summary.primaryReadableCount).toBe(evidence.summary.primaryLandingCount);
    expect(evidence.summary.occupancyInRangeCount).toBe(evidence.summary.landingCount);
    expect(evidence.advisories).toEqual([]);

    const primaryBlock = blocks.find((block) => block.importance === "primary")!;
    const offAnchorMotion: ContinuousMotionEvidenceV1 = {
      ...motion,
      samples: motion.samples.map((sample) =>
        sample.sceneId === primaryBlock.sceneId && sample.phraseId === primaryBlock.phraseId
          ? {
              ...sample,
              focal: {
                ...sample.focal,
                centerX: sample.focal.centerX + motion.frame.width * 0.141,
              },
            }
          : sample
      ),
    };
    const offAnchor = buildCameraBlockingEvidence(plan, graph, offAnchorMotion);
    expect(offAnchor.summary.primaryReadableCount).toBe(
      offAnchor.summary.primaryLandingCount - 1,
    );
    expect(offAnchor.advisories.some((entry) => entry.includes("missed their screen anchor"))).toBe(true);

    const movingMotion: ContinuousMotionEvidenceV1 = {
      ...motion,
      samples: motion.samples.map((sample) =>
        sample.sceneId === primaryBlock.sceneId && sample.phraseId === primaryBlock.phraseId
          ? { ...sample, focal: { ...sample.focal, speed: 0.0181 } }
          : sample
      ),
    };
    const moving = buildCameraBlockingEvidence(plan, graph, movingMotion);
    expect(moving.summary.primaryReadableCount).toBe(
      moving.summary.primaryLandingCount - 1,
    );
    expect(moving.advisories.some((entry) =>
      entry.includes("above 0.018 normalized frame-diagonals/s")
    )).toBe(true);
  });

  it("records the settled in-dwell sample instead of an entrance frame", () => {
    const storyboard = scenes();
    const graph = resolveContinuityGraph(storyboard);
    const plan = resolveCameraBlockingPlan(storyboard, graph);
    const block = plan.scenes.flatMap((scene) => scene.phrases)
      .find((phrase) => phrase.importance === "primary")!;
    const sample = (time: number, found: boolean, speed: number) => ({
      time,
      sceneId: block.sceneId,
      phraseId: block.phraseId,
      attention: { kind: "part" as const, id: block.target.id },
      focal: {
        found,
        visibleFraction: found ? 1 : 0,
        occupancyFraction: found ? block.occupancy.preferred : 0,
        centerX: block.arrivalPose.anchor.x * 1920,
        centerY: block.arrivalPose.anchor.y * 1080,
        width: found ? 600 : 0,
        height: found ? 360 : 0,
        speed,
        acceleration: 0,
        jerk: 0,
      },
      independentMotionCount: found ? 1 : 0,
    });
    const lateTime = Math.max(block.arrivalSec, block.dwell.endSec - 0.08);
    const settled = {
      ...sample(lateTime, true, 0.08),
      phraseId: `${block.phraseId}:next`,
      cameraSpeed: 0,
    };
    const motion = {
      version: 1,
      advisory: true,
      sampleHz: 8,
      frame: { width: 1920, height: 1080 },
      samples: [sample(block.arrivalSec, false, 0.08), settled],
      reversals: [],
      jerkMarkers: [],
      quietWindows: [],
      settleWindows: [],
      scenes: [],
      summary: {
        sampleCount: 2, focalFoundSamples: 1, minimumVisibleFraction: 0,
        meanVisibleFraction: 0.5, minimumOccupancyFraction: 0,
        meanOccupancyFraction: block.occupancy.preferred / 2, offframeSamples: 1,
        tinyFocalSamples: 1, peakSpeed: 0.08, peakAcceleration: 0, peakJerk: 0,
        reversalCount: 0, jerkMarkerCount: 0, maxIndependentMotionCount: 1,
        meanIndependentMotionCount: 0.5, settleWindowCount: 0,
        measuredSettleWindowCount: 0, settledByWindowEndCount: 0,
        quietWindowCount: 0, maxQuietWindowSec: 0,
      },
      advisories: [],
    } satisfies ContinuousMotionEvidenceV1;

    const landing = buildCameraBlockingEvidence(plan, graph, motion).landings
      .find((candidate) => candidate.blockId === block.id)!;
    expect(landing.time).toBe(lateTime);
    expect(landing.measured).toBe(true);
    expect(landing.visibleFraction).toBe(1);
    // The target is still finishing its own entrance, but the lens is holding.
    expect(landing.speed).toBe(0);
  });

  it("waives the subject's solo occupancy floor for ensemble phrases with a framingTarget", () => {
    const storyboard = scenes();
    const graph = resolveContinuityGraph(storyboard);
    const plan = resolveCameraBlockingPlan(storyboard, graph);
    const template = plan.scenes[0]!.phrases[0]!;
    const framed = {
      ...template,
      id: "shot-1:ensemble-test:blocking",
      phraseId: "ensemble-test",
      framingTarget: { kind: "region" as const, id: "product-ui" },
      framingOccupancy: { min: 0.1, preferred: 0.22, max: 0.42 },
      occupancy: { min: 0.018, preferred: 0.055, max: 0.14 },
      nextHandoff: undefined,
    };
    plan.scenes[0]!.phrases.push(framed);
    const unframed = plan.scenes[1]!.phrases.find((block) => !block.framingTarget)!;
    expect(unframed).toBeDefined();
    const sampleFor = (block: typeof template) => ({
      time: block.arrivalSec,
      sceneId: block.sceneId,
      phraseId: block.phraseId,
      attention: { kind: "part" as const, id: block.target.id },
      focal: {
        found: true,
        visibleFraction: 1,
        // The runtime capped zoom for the ensemble context, so the subject
        // sits well below its solo floor (the verify-1 recovery-cta class).
        occupancyFraction: block.occupancy.min * 0.4,
        centerX: block.arrivalPose.anchor.x * 1920,
        centerY: block.arrivalPose.anchor.y * 1080,
        width: 300,
        height: 120,
        speed: 0.01,
        acceleration: 0.02,
        jerk: 0.03,
      },
      independentMotionCount: 1,
    });
    const motion = {
      version: 1,
      advisory: true,
      sampleHz: 8,
      frame: { width: 1920, height: 1080 },
      samples: [sampleFor(framed), sampleFor(unframed)],
      reversals: [],
      jerkMarkers: [],
      quietWindows: [],
      settleWindows: [],
      scenes: [],
      summary: {
        sampleCount: 2,
        focalFoundSamples: 2,
        minimumVisibleFraction: 1,
        meanVisibleFraction: 1,
        minimumOccupancyFraction: 0.01,
        meanOccupancyFraction: 0.02,
        offframeSamples: 0,
        tinyFocalSamples: 0,
        peakSpeed: 0.01,
        peakAcceleration: 0.02,
        peakJerk: 0.03,
        reversalCount: 0,
        jerkMarkerCount: 0,
        maxIndependentMotionCount: 1,
        meanIndependentMotionCount: 1,
        settleWindowCount: 0,
        measuredSettleWindowCount: 0,
        settledByWindowEndCount: 0,
        quietWindowCount: 0,
        maxQuietWindowSec: 0,
      },
      advisories: [],
    } satisfies ContinuousMotionEvidenceV1;
    const evidence = buildCameraBlockingEvidence(plan, graph, motion);
    const framedLanding = evidence.landings.find((landing) => landing.blockId === framed.id)!;
    const unframedLanding = evidence.landings.find((landing) => landing.blockId === unframed.id)!;
    expect(framedLanding.occupancyInRange).toBe(true);
    expect(unframedLanding.occupancyInRange).toBe(false);

    const offAnchorEnsemble: ContinuousMotionEvidenceV1 = {
      ...motion,
      samples: motion.samples.map((sample) => sample.phraseId === framed.phraseId
        ? {
            ...sample,
            focal: {
              ...sample.focal,
              occupancyFraction: framed.occupancy.max * 1.5,
              centerX: sample.focal.centerX + motion.frame.width * 0.25,
            },
          }
        : sample),
    };
    const contextual = buildCameraBlockingEvidence(plan, graph, offAnchorEnsemble);
    const contextualLanding = contextual.landings.find((landing) => landing.blockId === framed.id)!;
    expect(contextualLanding.occupancyInRange).toBe(true);
    expect(contextualLanding.framingTarget).toEqual(framed.framingTarget);
    expect(contextualLanding.anchorError).toBeGreaterThan(0.14);
    expect(contextual.summary.primaryReadableCount).toBeGreaterThan(0);
  });
});
