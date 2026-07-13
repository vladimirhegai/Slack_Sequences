import { describe, expect, it } from "vitest";
import { withRepairProof } from "../src/engine/runner/repairs/proof.ts";

describe("deterministic repair proof", () => {
  it("returns edits with an intended-finding proof", () => {
    const result = withRepairProof({
      edits: "fixed",
      intendedFinding: "canvas_overflow",
      beforeFindingClasses: ["canvas_overflow"],
      afterFindingClasses: [],
    });

    expect(result).toEqual({
      edits: "fixed",
      proof: {
        intendedFinding: "canvas_overflow",
        changed: true,
        newFindingClasses: [],
      },
    });
  });

  it("rejects a repair that introduces a new finding class", () => {
    expect(() => withRepairProof({
      edits: "unsafe",
      intendedFinding: "canvas_overflow",
      beforeFindingClasses: ["canvas_overflow"],
      afterFindingClasses: ["canvas_overflow", "contrast_aa"],
    })).toThrow("contrast_aa");
  });
});
