import { afterEach, describe, expect, it } from "vitest";
import type { AgentProvider } from "@sequences/platform/providers";
import {
  STORYBOARD_SHAPES,
  parseStoryboardShapeHint,
  requestStoryboardShape,
} from "../src/engine/compositionRunner.ts";

/**
 * The shape selector is the first "small agent" helper: a light model picks a
 * pacing skeleton from a curated list. Its safety property is that it is
 * deterministically rejectable — anything but an exact template id degrades
 * to no hint, so a bad small model can never steer the film.
 */
describe("parseStoryboardShapeHint", () => {
  it("accepts an exact template id and truncates the rationale", () => {
    const hint = parseStoryboardShapeHint(
      `{"shape":"problem-turn-product-cta","why":"${"pain-led brief ".repeat(20)}"}`,
    );
    expect(hint?.shape.id).toBe("problem-turn-product-cta");
    expect(hint?.why.length).toBeLessThanOrEqual(160);
  });

  it("accepts a fenced or prose-wrapped JSON object", () => {
    const hint = parseStoryboardShapeHint(
      '```json\n{"shape":"hook-demo-payoff","why":"UI is the star"}\n```',
    );
    expect(hint?.shape.id).toBe("hook-demo-payoff");
  });

  it("rejects everything a badly-behaved small model can produce", () => {
    // Invented template (the classic small-model failure).
    expect(parseStoryboardShapeHint('{"shape":"epic-cinematic-journey","why":"cool"}')).toBeUndefined();
    // Creative overreach instead of a selection.
    expect(parseStoryboardShapeHint("Use neon gradients and a 3D orbit!")).toBeUndefined();
    // Malformed JSON, empty, wrong types.
    expect(parseStoryboardShapeHint('{"shape": problem}')).toBeUndefined();
    expect(parseStoryboardShapeHint("")).toBeUndefined();
    expect(parseStoryboardShapeHint('{"shape":42}')).toBeUndefined();
    expect(parseStoryboardShapeHint('["problem-turn-product-cta"]')).toBeUndefined();
  });

  it("keeps every curated shape purely structural", () => {
    // The selector must never own creative vocabulary: templates talk about
    // pacing and segment order, not visuals.
    for (const shape of STORYBOARD_SHAPES) {
      expect(shape.label).not.toMatch(/color|gradient|font|neon|camera|ease/i);
    }
    // Ids are unique — a selection is unambiguous.
    expect(new Set(STORYBOARD_SHAPES.map((shape) => shape.id)).size)
      .toBe(STORYBOARD_SHAPES.length);
  });
});

describe("requestStoryboardShape", () => {
  afterEach(() => {
    delete process.env.SLACK_SEQUENCES_SHAPE_HINT;
  });

  it("honors the kill switch without touching the provider", async () => {
    process.env.SLACK_SEQUENCES_SHAPE_HINT = "0";
    const provider = { id: "openrouter-api" } as AgentProvider;
    await expect(
      requestStoryboardShape(provider, { brief: "brief", projectDir: "unused" }),
    ).resolves.toBeUndefined();
  });

  it("degrades to no hint when the provider has no light model", async () => {
    const provider = { id: "anthropic-api" } as AgentProvider;
    await expect(
      requestStoryboardShape(provider, { brief: "brief", projectDir: "unused" }),
    ).resolves.toBeUndefined();
  });
});
