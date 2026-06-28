import { describe, expect, it } from "vitest";
import { validateProject } from "../src/validate.ts";
import { createDefaultProject } from "../src/defaults.ts";
import { testAsset } from "./helpers.ts";

describe("project validation", () => {
  it("accepts the default project", () => {
    const result = validateProject(createDefaultProject());
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects a missing required slot", () => {
    const project = createDefaultProject();
    delete project.scenes[0]!.slots["headline"];
    const result = validateProject(project);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("required slot"))).toBe(true);
  });

  it("rejects unknown asset references in media slots", () => {
    const project = createDefaultProject();
    project.scenes[0]!.slots["headline"] = "ok";
    project.scenes.splice(1, 0, {
      id: "feat",
      archetype: "feature-reveal",
      durationFrames: 120,
      slots: { headline: "X", media: { assetId: "ghost" } },
      choreography: {},
      overrides: {},
    });
    const result = validateProject(project);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('unknown asset "ghost"'))).toBe(true);
  });

  it("rejects an unknown layout for the archetype", () => {
    const project = createDefaultProject();
    project.scenes[0]!.layout = "diagonal";
    const result = validateProject(project);
    expect(result.ok).toBe(false);
  });

  it("rejects overrides addressing nonexistent layers", () => {
    const project = createDefaultProject();
    project.scenes[0]!.overrides["ghost-layer"] = { colorToken: "accent" };
    const result = validateProject(project);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("ghost-layer"))).toBe(true);
  });

  it("rejects role-incorrect primitive swaps (enter slot, exit primitive)", () => {
    const project = createDefaultProject();
    project.scenes[0]!.overrides["headline"] = { enterPrimitive: "exit.slideExit" };
    const result = validateProject(project);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("not enter"))).toBe(true);
  });

  it("rejects unknown slot names", () => {
    const project = createDefaultProject();
    project.scenes[0]!.slots["sparkles"] = "nope";
    const result = validateProject(project);
    expect(result.ok).toBe(false);
  });

  it("rejects raw off-schema motion numerics (T1 by construction)", () => {
    const project = createDefaultProject();
    // @ts-expect-error — exactly the kind of thing an unconstrained agent emits
    project.scenes[0]!.overrides["headline"] = { enterDuration: 0.4 };
    const result = validateProject(project);
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate asset ids and paths", () => {
    const project = createDefaultProject();
    const shot = testAsset("shot", "assets/shot.png");
    project.assets.push(
      shot,
      { ...testAsset("other-hash", "assets/other.png"), id: shot.id },
      { ...testAsset("other", "assets/shot.png") },
    );
    const result = validateProject(project);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("duplicate asset id"))).toBe(true);
    expect(result.issues.some((i) => i.message.includes("duplicate asset path"))).toBe(true);
  });

  it("rejects asset paths outside assets/ and unsafe transform origins", () => {
    const project = createDefaultProject();
    project.assets.push(testAsset("escape", "../../outside.png"));
    // @ts-expect-error deliberately malformed persisted project data
    project.scenes[0]!.overrides["headline"] = { box: { origin: "center;background:red" } };
    const result = validateProject(project);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.includes("assets.0.path"))).toBe(true);
    expect(result.issues.some((i) => i.path.includes("origin"))).toBe(true);
  });

  it("rejects duplicate and unknown choreography order entries", () => {
    const project = createDefaultProject();
    project.scenes[0]!.choreography.order = ["headline", "headline", "ghost"];
    const result = validateProject(project);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('duplicate layer "headline"'))).toBe(true);
    expect(result.issues.some((i) => i.message.includes('no layer "ghost"'))).toBe(true);
  });

  it("rejects duplicate enabled extension ids", () => {
    const project = createDefaultProject();
    project.extensions.enabled = ["crisp-saas", "crisp-saas"];
    const result = validateProject(project);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('duplicate extension "crisp-saas"'))).toBe(
      true,
    );
  });

  it("allows disabling an extension already referenced by the graph", () => {
    const project = createDefaultProject();
    project.scenes[0]!.overrides.headline = { emphasisPrimitive: "emphasis.pop" };
    project.extensions.enabled = [
      "hook-opener",
      "feature-reveal",
      "stat-callout",
      "logo-sting-cta",
      "ui-walkthrough",
      "social-proof",
      "stat-chart",
      "crisp-saas",
      "pushIn",
      "pullBack",
    ];
    const result = validateProject(project);
    expect(result.ok).toBe(true);
  });

  it("rejects custom-layer CSS that can escape or fetch from an inline style", () => {
    const project = createDefaultProject() as unknown as Record<string, unknown>;
    const scenes = project.scenes as Array<Record<string, unknown>>;
    scenes[0]!.customLayers = [
      {
        id: "unsafe-shape",
        role: "decor",
        rank: 9,
        kind: "shape",
        content: { css: 'red";background:url(https://evil.example)' },
        box: { x: 0, y: 0, w: 100, h: 100, origin: "center center" },
      },
    ];
    const result = validateProject(project);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes("safe CSS"))).toBe(true);
  });
});
