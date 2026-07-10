import { describe, expect, it } from "vitest";
import {
  directionAccentSlot,
  directionPhraseForMoment,
  directionScoreConsumersEnabled,
  resolveFilmDirectionScore,
} from "../src/engine/directionScore.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";

function scene(
  overrides: Partial<DirectScene> & Pick<DirectScene, "id" | "startSec" | "durationSec">,
): DirectScene {
  return { title: overrides.id, purpose: "test", ...overrides };
}

describe("resolveFilmDirectionScore", () => {
  it("keeps an explicit score-consumer A/B switch", () => {
    expect(directionScoreConsumersEnabled()).toBe(true);
    process.env.SLACK_SEQUENCES_DIRECTION_SCORE = "0";
    try {
      expect(directionScoreConsumersEnabled()).toBe(false);
    } finally {
      delete process.env.SLACK_SEQUENCES_DIRECTION_SCORE;
    }
  });

  it("derives one owner, attention route, energy contour, continuity, and settle windows", () => {
    const scenes: DirectScene[] = [
      scene({
        id: "proof",
        startSec: 0,
        durationSec: 5,
        cut: { version: 1, style: "morph", focalPartOut: "proof-stat", focalPartIn: "warm-claim" },
        components: [{ version: 1, id: "proof-stat", kind: "stat-card", role: "hero" }],
        beats: [{
          version: 1,
          id: "proof-count",
          sceneId: "proof",
          component: "proof-stat",
          kind: "count",
          atSec: 1.5,
          durationSec: 1,
          value: 99,
        }],
        camera: {
          version: 1,
          path: [{
            version: 1,
            move: "push-in",
            toPart: "proof-stat",
            startSec: 1.7,
            durationSec: 1,
            zoom: 1.2,
          }],
        },
        moments: [{
          version: 1,
          id: "proof-lands",
          sceneId: "proof",
          atSec: 2.5,
          title: "Metric lands",
          visualState: "99 is visible",
          change: "The stat counted up",
          motionIntent: "ui-state",
          importance: "primary",
        }],
      }),
      scene({
        id: "warm-resolve",
        startSec: 5,
        durationSec: 5,
        spatialIntent: {
          version: 1,
          focalPart: "warm-claim",
          composition: "centered resolve",
          relationships: [],
        },
        gradeShift: { version: 1, atSec: 6.5, toGrade: "warm", fromPart: "warm-claim" },
        moments: [{
          version: 1,
          id: "world-warms",
          sceneId: "warm-resolve",
          atSec: 6.5,
          title: "World turns warm",
          visualState: "The claim sits in amber light",
          change: "The color temperature warms",
          motionIntent: "resolve",
          importance: "primary",
        }],
      }),
    ];

    const score = resolveFilmDirectionScore(scenes);
    expect(score).toEqual(resolveFilmDirectionScore(scenes));
    expect(score).toMatchObject({ version: 1, source: "host-derived", durationSec: 10 });
    expect(score.scenes.map((entry) => entry.entryRelationship)).toEqual(["establish", "carry"]);

    const proof = directionPhraseForMoment(score, "proof", "proof-lands")!;
    expect(proof).toMatchObject({
      role: "payoff",
      dominant: { system: "component", id: "component:proof-count", part: "proof-stat" },
      attention: { part: "proof-stat" },
    });
    expect(proof.competing.some((action) => action.system === "camera")).toBe(true);
    expect(proof.energy.peak).toBeGreaterThan(proof.energy.in);
    expect(proof.settleUntilSec).toBeGreaterThan(proof.dominant.endSec);

    const turn = directionPhraseForMoment(score, "warm-resolve", "world-warms")!;
    expect(turn).toMatchObject({ role: "turn", dominant: { system: "grade" } });
    expect(score.scenes[1]!.settleWindows.some((window) => window.owner === "grade"))
      .toBe(true);
  });

  it("offers garnish only after settle and suppresses it when the next phrase is too close", () => {
    const base = scene({
      id: "result",
      startSec: 0,
      durationSec: 5,
      components: [{ version: 1, id: "metric", kind: "stat-card" }],
      beats: [{
        version: 1,
        id: "metric-count",
        sceneId: "result",
        component: "metric",
        kind: "count",
        atSec: 1,
        durationSec: 1,
        value: 42,
      }],
      moments: [{
        version: 1,
        id: "metric-lands",
        sceneId: "result",
        atSec: 2,
        title: "Metric lands",
        visualState: "42",
        change: "Count completed",
        motionIntent: "ui-state",
        importance: "primary",
      }],
    });
    const openPhrase = directionPhraseForMoment(
      resolveFilmDirectionScore([base]),
      "result",
      "metric-lands",
    )!;
    expect(directionAccentSlot(openPhrase, 0.7)).toBeGreaterThan(openPhrase.settleUntilSec);

    const crowded: DirectScene = {
      ...base,
      moments: [
        ...base.moments!,
        {
          version: 1,
          id: "next-state",
          sceneId: "result",
          atSec: 2.7,
          title: "Next state",
          visualState: "A second state",
          change: "The next action begins",
          motionIntent: "reveal",
          importance: "supporting",
        },
      ],
    };
    const crowdedPhrase = directionPhraseForMoment(
      resolveFilmDirectionScore([crowded]),
      "result",
      "metric-lands",
    )!;
    expect(directionAccentSlot(crowdedPhrase, 0.7)).toBeUndefined();
  });

  it("routes camera attention through the move carrying the cue, not the prior arrival", () => {
    const route = scene({
      id: "route",
      startSec: 0,
      durationSec: 6,
      camera: {
        version: 1,
        path: [
          { version: 1, move: "pan", toRegion: "pr", startSec: 0, durationSec: 2.5 },
          { version: 1, move: "pan", toRegion: "ci", startSec: 2.5, durationSec: 2 },
          { version: 1, move: "pan", toRegion: "chat", startSec: 4.5, durationSec: 1.5 },
        ],
      },
      moments: [
        {
          version: 1,
          id: "ci-cue",
          sceneId: "route",
          atSec: 3,
          title: "Camera pans to CI",
          visualState: "CI fills the frame",
          change: "Camera pans into the CI station",
          motionIntent: "camera pan",
          importance: "primary",
        },
        {
          version: 1,
          id: "chat-cue",
          sceneId: "route",
          atSec: 4.5,
          title: "Camera starts toward chat",
          visualState: "Chat becomes the destination",
          change: "Camera pans toward chat",
          motionIntent: "camera pan",
          importance: "supporting",
        },
      ],
    });
    const score = resolveFilmDirectionScore([route]);
    expect(directionPhraseForMoment(score, "route", "ci-cue")?.attention)
      .toEqual({ region: "ci" });
    expect(directionPhraseForMoment(score, "route", "chat-cue")?.attention)
      .toEqual({ region: "chat" });
  });
});
