import { describe, expect, it } from "vitest";
import { applyAutoFixes, contrastRatio, lintProject } from "../src/linter.ts";
import { ProjectStore } from "../src/store.ts";
import { createDefaultProject } from "../src/defaults.ts";
import { testAsset } from "./helpers.ts";

describe("motion linter (T3)", () => {
  it("text-readability: short scene with long copy gets an extend-duration fix", () => {
    const project = createDefaultProject();
    project.scenes[0]!.durationFrames = 60;
    project.scenes[0]!.slots["subline"] = "A much longer subline that takes time to read fully";
    const findings = lintProject(project);
    const readability = findings.find((f) => f.rule === "text-readability");
    expect(readability).toBeDefined();
    expect(readability!.fix).toMatchObject({ type: "SetSceneDuration", sceneId: "hook" });
  });

  it("copy-budget: over-budget headline warns without a fix (humans shorten copy)", () => {
    const project = createDefaultProject();
    project.scenes[0]!.slots["headline"] = "This headline has way too many words to fit the budget";
    const findings = lintProject(project);
    const budget = findings.find((f) => f.rule === "copy-budget");
    expect(budget).toBeDefined();
    expect(budget!.fix).toBeUndefined();
  });

  it("contrast: low-contrast brand colors are caught", () => {
    const project = createDefaultProject();
    project.brand.colors.text = "#1A1D26"; // near-surface on dark surface
    const findings = lintProject(project);
    expect(findings.some((f) => f.rule === "contrast")).toBe(true);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 0);
  });

  it("safe-area: an off-canvas override gets nudged back via a command fix", () => {
    const project = createDefaultProject();
    project.scenes[0]!.overrides["headline"] = { box: { x: -50, y: 10 } };
    const findings = lintProject(project);
    const safeArea = findings.find((f) => f.rule === "safe-area");
    expect(safeArea).toBeDefined();
    expect(safeArea!.fix).toMatchObject({ type: "OverrideLayerBox", layerId: "headline" });
  });

  it("safe-area: oversized text is resized as well as repositioned", () => {
    const project = createDefaultProject();
    project.scenes[0]!.overrides["headline"] = {
      box: { x: -100, y: -100, w: 3000, h: 2000 },
    };
    const finding = lintProject(project).find((item) => item.rule === "safe-area");
    expect(finding?.fix).toMatchObject({
      type: "OverrideLayerBox",
      layerId: "headline",
      box: { x: 96, y: 54, w: 1728, h: 972 },
    });
    const store = new ProjectStore(project);
    applyAutoFixes(store);
    expect(lintProject(store.project).some((item) => item.rule === "safe-area")).toBe(false);
  });

  it("scene-duration-range: clamps to archetype heuristics", () => {
    const project = createDefaultProject();
    project.scenes[0]!.durationFrames = 600; // hook-opener max is 150
    const findings = lintProject(project);
    const range = findings.find((f) => f.rule === "scene-duration-range");
    expect(range?.fix).toMatchObject({ type: "SetSceneDuration", durationFrames: 150 });
  });

  it("autofix loop converges, applies via the store (undoable), zero errors left", () => {
    const project = createDefaultProject();
    project.scenes[0]!.durationFrames = 45;
    project.scenes[0]!.slots["subline"] = "A subline with enough words to need more frames";
    const store = new ProjectStore(project);
    const result = applyAutoFixes(store);
    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.remaining.filter((f) => f.severity === "error")).toEqual([]);
    expect(result.remaining.filter((f) => f.fix)).toEqual([]);
    expect(store.canUndo).toBe(true); // autofixes are logged commands
  });

  it("default project after autofix lints clean of warnings", () => {
    const store = new ProjectStore(createDefaultProject());
    applyAutoFixes(store);
    const findings = lintProject(store.project);
    expect(findings.filter((f) => f.severity !== "info")).toEqual([]);
  });

  it("easing-whitelist: clean compile emits only token easings", () => {
    const findings = lintProject(createDefaultProject());
    expect(findings.filter((f) => f.rule === "easing-whitelist")).toEqual([]);
  });

  it("grid-snap: off-lattice override positions get a snap fix", () => {
    const project = createDefaultProject();
    project.scenes[0]!.overrides["headline"] = { box: { x: 201, y: 333 } };
    const findings = lintProject(project);
    const snap = findings.find((f) => f.rule === "grid-snap");
    expect(snap).toBeDefined();
    expect(snap!.fix).toMatchObject({
      type: "OverrideLayerBox",
      layerId: "headline",
      box: { x: 242 },
    });
  });

  it("motion-density: a crowded walkthrough scene gets a warning", () => {
    const project = createDefaultProject();
    const shot = testAsset("shot", "assets/shot.svg");
    project.assets.push(shot);
    project.scenes.push({
      id: "walk",
      archetype: "ui-walkthrough",
      durationFrames: 150,
      slots: {
        headline: "Do the thing",
        media: { assetId: shot.id },
        steps: ["One", "Two", "Three", "Four"],
      },
      choreography: {},
      overrides: {},
    });
    const findings = lintProject(project);
    expect(
      findings.some(
        (f) => f.rule === "motion-density" && f.sceneId === "walk" && f.severity === "warn",
      ),
    ).toBe(true);
  });
});
