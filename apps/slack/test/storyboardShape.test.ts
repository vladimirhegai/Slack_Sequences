import { afterEach, describe, expect, it } from "vitest";
import type { AgentProvider } from "@sequences/platform/providers";
import {
  STORYBOARD_SHAPES,
  defaultShapeForBrief,
  parseStoryboardShapeHint,
  requestStoryboardShape,
  storyboardShapeScaffold,
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

describe("storyboardShapeScaffold (duration by template, never by gate)", () => {
  it("distributes the target runtime across every shape's typed segments", () => {
    for (const shape of STORYBOARD_SHAPES) {
      // Weights are a sane distribution.
      const totalWeight = shape.segments.reduce((sum, segment) => sum + segment.weight, 0);
      expect(totalWeight).toBeGreaterThan(0.95);
      expect(totalWeight).toBeLessThan(1.05);
      for (const target of [20, 24, 30, 45]) {
        const lines = storyboardShapeScaffold(shape, target);
        expect(lines[0]).toContain(`~${target}s`);
        const seconds = lines
          .map((line) => /—\s*~(\d+)s/.exec(line)?.[1])
          .filter((value): value is string => Boolean(value))
          .map(Number);
        expect(seconds).toHaveLength(shape.segments.length);
        const sum = seconds.reduce((total, value) => total + value, 0);
        // Rounding drift only — the scaffold owns the arithmetic.
        expect(Math.abs(sum - target)).toBeLessThanOrEqual(shape.segments.length);
      }
    }
  });

  it("clamps degenerate targets into the film contract range", () => {
    const shape = STORYBOARD_SHAPES[0]!;
    expect(storyboardShapeScaffold(shape, 3)[0]).toContain("~12s");
    expect(storyboardShapeScaffold(shape, 500)[0]).toContain("~60s");
  });

  it("guides instead of gating", () => {
    const text = storyboardShapeScaffold(STORYBOARD_SHAPES[1]!, 24).join("\n");
    expect(text).toContain("pacing scaffolding, not creative direction");
    expect(text).toContain("deviate");
  });
});

describe("defaultShapeForBrief (deterministic fallback pick)", () => {
  it("keyword-picks without a model and always returns a real shape", () => {
    expect(defaultShapeForBrief("teams are tired of manual deploy checklists").id)
      .toBe("problem-turn-product-cta");
    expect(defaultShapeForBrief("40% faster cold starts, 99.9% uptime").id)
      .toBe("stat-proof-tour");
    expect(defaultShapeForBrief("ship the new editor walkthrough").id)
      .toBe("hook-demo-payoff");
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
