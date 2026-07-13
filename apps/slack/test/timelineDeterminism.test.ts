import { describe, expect, it } from "vitest";
import { timelineTransformsEquivalent } from "../src/engine/layout/report.ts";

describe("timeline seek-determinism transform comparison", () => {
  // Exact before/after matrices from the 2026-07-13 relay-launch-film incident:
  // canonical seek(1.530) reached via two equivalent paths produced rotated-
  // element matrices differing by ~4e-7 (browser/GSAP float noise). These must
  // read as the same deterministic state, not a hard timeline_contract failure.
  it("treats sub-1e-6 rotation float noise as the same rendered state", () => {
    expect(timelineTransformsEquivalent(
      "matrix(0.996194, 0.0871596, -0.0871596, 0.996194, 0, 0)",
      "matrix(0.996194, 0.0871592, -0.0871592, 0.996194, 0, 0)",
    )).toBe(true);
    expect(timelineTransformsEquivalent(
      "matrix(0.997564, 0.0697603, -0.0697603, 0.997564, 0, 0)",
      "matrix(0.997564, 0.06976, -0.06976, 0.997564, 0, 0)",
    )).toBe(true);
    expect(timelineTransformsEquivalent(
      "matrix(1.01333, -0.0708625, 0.0708625, 1.01333, 1.9744, -3.9487)",
      "matrix(1.01333, -0.0708622, 0.0708622, 1.01333, 1.9744, -3.9487)",
    )).toBe(true);
  });

  it("still fails genuine non-deterministic motion (position and rotation)", () => {
    // A 40px translation drift between the two seeks is real non-determinism.
    expect(timelineTransformsEquivalent(
      "matrix(1, 0, 0, 1, 0, 0)",
      "matrix(1, 0, 0, 1, 40, 0)",
    )).toBe(false);
    // A ~15 degree rotation difference is real non-determinism.
    expect(timelineTransformsEquivalent(
      "matrix(1, 0, 0, 1, 0, 0)",
      "matrix(0.9659, 0.2588, -0.2588, 0.9659, 0, 0)",
    )).toBe(false);
  });

  it("keeps none/identity equivalence and rejects real transforms against none", () => {
    expect(timelineTransformsEquivalent("none", "matrix(1, 0, 0, 1, 0, 0)")).toBe(true);
    expect(timelineTransformsEquivalent("none", "matrix(1, 0.0000004, -0.0000004, 1, 0, 0)")).toBe(true);
    expect(timelineTransformsEquivalent("none", "matrix(0.9659, 0.2588, -0.2588, 0.9659, 0, 0)")).toBe(false);
  });

  it("falls back to exact comparison for non-matrix transform values", () => {
    expect(timelineTransformsEquivalent("none", "none")).toBe(true);
    expect(timelineTransformsEquivalent("rotate(5deg)", "rotate(5deg)")).toBe(true);
    expect(timelineTransformsEquivalent("rotate(5deg)", "rotate(6deg)")).toBe(false);
  });
});
