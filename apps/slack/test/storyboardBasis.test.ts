import { describe, expect, it } from "vitest";
import {
  assertStoryboardBasisMatchesFrame,
  parseStoryboardResponse,
  storyboardProductionBasis,
} from "../src/engine/runner/storyboardAudit.ts";
import { storyboardResponseFormat } from "../src/engine/runner/storyboardResponseFormat.ts";

const lightFrame = '<!-- sequences-frame: {"basis":"light"} -->\nBasis: **light**';

describe("storyboard production basis gate", () => {
  it("rejects the SignalDock-shaped array before plan validation or authoring", () => {
    const oldRejectedArtifact = `<storyboard_json>${JSON.stringify([
      { id: "cold-open", title: "Open", purpose: "Orient the viewer" },
    ])}</storyboard_json>`;
    expect(() => parseStoryboardResponse(oldRejectedArtifact, {}, { frameMd: lightFrame }))
      .toThrow(/productionBasis is missing.*light.*before authoring/i);
  });

  it("rejects a declared dark basis against a committed light frame", () => {
    const raw = JSON.stringify({ productionBasis: "dark", storyboard: [] });
    expect(() => assertStoryboardBasisMatchesFrame(raw, lightFrame))
      .toThrow(/production basis "dark" contradicts.*committed "light" basis/i);
  });

  it("accepts the committed basis and exposes it from both response shapes", () => {
    assertStoryboardBasisMatchesFrame(
      JSON.stringify({ productionBasis: "light", storyboard: [] }),
      lightFrame,
    );
    expect(storyboardProductionBasis(JSON.stringify({ productionBasis: "dark", storyboard: [] })))
      .toBe("dark");
    expect(storyboardProductionBasis(
      `<storyboard_json>${JSON.stringify({ production_basis: "light", storyboard: [] })}</storyboard_json>`,
    )).toBe("light");
  });

  it("requires the basis in the structured response schema", () => {
    const format = storyboardResponseFormat();
    if (format.type !== "json_schema") throw new Error("expected JSON schema response format");
    expect(format.json_schema.schema.required).toEqual(["productionBasis", "storyboard"]);
  });
});
