import { describe, expect, it } from "vitest";
import { solveScene } from "../src/solver.ts";
import { materializeScene } from "../src/materialize.ts";
import { PROFILES } from "../src/registry/index.ts";
import { createDefaultProject } from "../src/defaults.ts";
import { testAsset } from "./helpers.ts";
import { CHOREO_DEFAULTS, STAGGER_TOKENS } from "../src/tokens.ts";
import type { Project, Scene } from "../src/schema.ts";

function sceneWithBullets(bullets: string[], durationFrames = 150): {
  project: Project;
  scene: Scene;
} {
  const project = createDefaultProject({ title: "Solver Test" });
  const shot = testAsset("shot", "assets/shot.svg");
  project.assets.push(shot);
  const scene: Scene = {
    id: "feat",
    archetype: "feature-reveal",
    durationFrames,
    slots: { headline: "Headline here", media: { assetId: shot.id }, bullets },
    choreography: {},
    overrides: {},
  };
  project.scenes.splice(1, 0, scene);
  return { project, scene };
}

describe("choreography solver (T2)", () => {
  it("schedules entrances in rank order with the stagger floor respected", () => {
    const { project, scene } = sceneWithBullets(["One", "Two", "Three"]);
    const layers = materializeScene(project, scene);
    const schedule = solveScene(scene, layers, PROFILES["crisp-saas"]!);
    const enters = schedule.motions.filter((m) => m.phase === "enter");

    const rankOf = (layerId: string) => layers.find((l) => l.id === layerId)!.rank;
    const starts = enters.map((m) => m.startFrame);
    for (let i = 1; i < enters.length; i++) {
      expect(rankOf(enters[i]!.layerId)).toBeGreaterThan(rankOf(enters[i - 1]!.layerId));
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(STAGGER_TOKENS.tight);
    }
  });

  it("applies the 65% overlap budget: next entrance starts before previous ends", () => {
    const { project, scene } = sceneWithBullets(["One", "Two"]);
    const layers = materializeScene(project, scene);
    const schedule = solveScene(scene, layers, PROFILES["crisp-saas"]!);
    const enters = schedule.motions.filter((m) => m.phase === "enter");
    // No dead air: each entrance (after the first) begins before the previous
    // one has fully finished, unless the cap forced a delay.
    for (let i = 1; i < enters.length; i++) {
      const prev = enters[i - 1]!;
      expect(enters[i]!.startFrame).toBeLessThanOrEqual(prev.startFrame + prev.durationFrames);
    }
  });

  it("never exceeds the simultaneity cap, for any bullet count", () => {
    for (let n = 0; n <= 3; n++) {
      const bullets = Array.from({ length: n }, (_, i) => `Bullet ${i}`);
      const { project, scene } = sceneWithBullets(bullets);
      const layers = materializeScene(project, scene);
      for (const profile of Object.values(PROFILES)) {
        const schedule = solveScene(scene, layers, profile);
        expect(schedule.diagnostics.peakConcurrency).toBeLessThanOrEqual(
          CHOREO_DEFAULTS.simultaneityCap,
        );
      }
    }
  });

  it("is deterministic: same input, same schedule", () => {
    const { project, scene } = sceneWithBullets(["A", "B", "C"]);
    const layers = materializeScene(project, scene);
    const a = solveScene(scene, layers, PROFILES["warm-startup"]!);
    const b = solveScene(scene, layers, PROFILES["warm-startup"]!);
    expect(a).toEqual(b);
  });

  it("reports settle shortfall on a too-short scene instead of mutating it", () => {
    const { project, scene } = sceneWithBullets(["One", "Two", "Three"], 30);
    const layers = materializeScene(project, scene);
    const schedule = solveScene(scene, layers, PROFILES["warm-startup"]!);
    expect(schedule.diagnostics.settleShortfallFrames).toBeGreaterThan(0);
    // Solver is pure — the scene duration is untouched.
    expect(scene.durationFrames).toBe(30);
  });

  it("exits end exactly at scene end (warm-startup has exits)", () => {
    const { project, scene } = sceneWithBullets(["One"]);
    const warmProject = { ...project, motionProfile: "warm-startup" };
    const layers = materializeScene(warmProject, scene);
    const schedule = solveScene(scene, layers, PROFILES["warm-startup"]!);
    const exits = schedule.motions.filter((m) => m.phase === "exit");
    expect(exits.length).toBeGreaterThan(0);
    const latestEnd = Math.max(...exits.map((m) => m.startFrame + m.durationFrames));
    expect(latestEnd).toBe(scene.durationFrames);
  });

  it("honors explicit choreography order over rank", () => {
    const { project, scene } = sceneWithBullets(["One"]);
    scene.choreography = { order: ["bullet-0", "headline"] };
    const layers = materializeScene(project, scene);
    const schedule = solveScene(scene, layers, PROFILES["crisp-saas"]!);
    const enters = schedule.motions.filter((m) => m.phase === "enter");
    expect(enters[0]!.layerId).toBe("bullet-0");
    expect(enters[1]!.layerId).toBe("headline");
  });
});
