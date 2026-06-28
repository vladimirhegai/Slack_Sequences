import { describe, expect, it } from "vitest";
import {
  createDefaultProject,
  deriveDirections,
  matchZeroTokenTweak,
  parsePlan,
  structuredBriefToPlan,
  tightenPlanCopy,
} from "../src/index.ts";
import { testAsset } from "./helpers.ts";

describe("zero-token planning and tweaks", () => {
  it("turns a structured brief into a valid plan without a provider", () => {
    const project = createDefaultProject();
    const screenshot = testAsset("screen", "assets/screen.png");
    project.assets.push(screenshot);
    const plan = structuredBriefToPlan(project, {
      productName: "Pulse",
      audience: "founders",
      promise: "See revenue risk before it compounds",
      features: ["Live funnel health", "Alerts with context", "One click reports"],
      cta: "Start free",
      vibe: 82,
    });
    expect(plan.motionProfile).toBe("bold-launch");
    expect(parsePlan(plan, { project })).toEqual(plan);
  });

  it("derives three direction variants from one plan", () => {
    const project = createDefaultProject();
    const base = structuredBriefToPlan(project, {
      productName: "Pulse",
      audience: "teams",
      promise: "Ship faster with proof",
      features: ["Fast setup"],
      cta: "Try Pulse",
      vibe: 50,
    });
    const directions = deriveDirections(base, project);
    expect(directions).toHaveLength(3);
    expect(new Set(directions.map((direction) => direction.plan.motionProfile)).size).toBe(3);
  });

  it("tightens copy to archetype budgets deterministically", () => {
    const plan = tightenPlanCopy({
      motionProfile: "crisp-saas",
      scenes: [
        {
          archetype: "hook-opener",
          slots: { headline: "one two three four five six seven eight nine" },
        },
      ],
    });
    expect(String(plan.scenes[0]!.slots.headline).split(" ")).toHaveLength(7);
  });

  it("matches common tweaks to typed commands without tokens", () => {
    const project = createDefaultProject();
    expect(matchZeroTokenTweak(project, "make it slower", { sceneId: "hook" })?.commands[0]).toMatchObject({
      type: "SetSceneDuration",
      sceneId: "hook",
    });
    expect(
      matchZeroTokenTweak(project, "add a pulse glow", {
        sceneId: "hook",
        layerId: "headline",
      })?.commands[0],
    ).toMatchObject({
      type: "AddMotion",
      phase: "emphasis",
      primitive: "emphasis.pulseGlow",
    });
    expect(matchZeroTokenTweak(project, "make it indescribably zorbular")).toBeNull();
  });
});
