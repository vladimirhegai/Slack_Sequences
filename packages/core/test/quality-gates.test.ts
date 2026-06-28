import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  applyAutoFixes,
  compile,
  createDefaultProject,
  lintProject,
  percentile,
  ProjectStore,
  structuralSimilarity,
} from "../src/index.ts";

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("Phase-1 quality gates", () => {
  it("SSIM identifies exact, near, and materially different buffers", () => {
    const base = Uint8Array.from({ length: 512 }, (_, index) => index % 256);
    const near = Uint8Array.from(base, (value, index) => Math.max(0, value - (index % 31 === 0 ? 1 : 0)));
    const far = Uint8Array.from(base, (value) => 255 - value);
    expect(structuralSimilarity(base, base)).toBeCloseTo(1, 8);
    expect(structuralSimilarity(base, near)).toBeGreaterThan(0.999);
    expect(structuralSimilarity(base, far)).toBeLessThan(0.2);
  });

  it("random valid graph variants compile and have no post-autofix errors", () => {
    const rng = random(0x5e0e11ce);
    const layouts = ["center", "left"];
    for (let iteration = 0; iteration < 60; iteration++) {
      const project = createDefaultProject();
      project.scenes[0]!.durationFrames = 60 + Math.floor(rng() * 90);
      project.scenes[0]!.layout = layouts[Math.floor(rng() * layouts.length)]!;
      project.scenes[0]!.choreography = {
        stagger: rng() > 0.5 ? "tight" : "base",
        settleGap: rng() > 0.5 ? "quick" : "base",
      };
      const store = new ProjectStore(project);
      applyAutoFixes(store);
      const compiled = compile(store.project);
      expect(compiled.manifest.durationFrames).toBeGreaterThan(0);
      expect(lintProject(store.project).filter((finding) => finding.severity === "error")).toEqual([]);
    }
  });

  it("command-to-compile p95 stays below the Phase-1 300ms budget", () => {
    const project = createDefaultProject();
    const samples: number[] = [];
    for (let index = 0; index < 30; index++) {
      const store = new ProjectStore(project);
      const started = performance.now();
      expect(
        store.apply({
          type: "SetSceneDuration",
          sceneId: "hook",
          durationFrames: 96 + (index % 3),
        }).ok,
      ).toBe(true);
      compile(store.project);
      samples.push(performance.now() - started);
    }
    expect(percentile(samples, 0.95)).toBeLessThan(300);
  });
});
