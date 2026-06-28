import { describe, expect, it } from "vitest";
import {
  PRIMITIVES,
  primitiveParamsSchema,
  registryManifest,
  TOKEN_SETS,
  TRANSITION_PLUGINS,
} from "../src/registry/index.ts";

describe("Phase-1 registry/plugin contract", () => {
  it("ships versioned manifests and thumbnails for every registry entry", () => {
    const manifest = registryManifest();
    expect(manifest.version).toBe(1);
    const ids = new Set(manifest.entries.map((entry) => entry.id));
    for (const id of Object.keys(PRIMITIVES)) expect(ids.has(id)).toBe(true);
    for (const entry of manifest.entries) {
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(entry.summary.length).toBeGreaterThan(20);
      expect(entry.thumbnail).toMatch(/^thumbs\//);
    }
  });

  it("provides strict token-only parameter schemas for every primitive", () => {
    for (const primitive of Object.values(PRIMITIVES)) {
      const schema = primitiveParamsSchema(primitive.id);
      expect(schema.safeParse({}).success).toBe(true);
      expect(schema.safeParse({ duration: 0.4 }).success).toBe(false);
      expect(schema.safeParse({ rawDistance: 42 }).success).toBe(false);
    }
  });

  it("registers token-set and HyperFrames wrapper plugins", () => {
    expect(TOKEN_SETS["tokens.sequences-core"]).toBeDefined();
    expect(TRANSITION_PLUGINS["shader.flashThroughWhite"]?.source).toBe("hyperframes");
    expect(TRANSITION_PLUGINS["shader.pixelMelt"]?.source).toBe("hyperframes");
    expect(registryManifest().entries.find((entry) => entry.id === "stat-chart")?.source).toBe(
      "hyperframes",
    );
  });
});
