import { describe, expect, it } from "vitest";
import { lunaArtDirectionSeed, type LunaFactEnvelope } from "../src/engine/lunaRoute.ts";

const facts: LunaFactEnvelope = {
  version: 1,
  product: "Relay",
  brandName: "Relay",
  whatShipped: "A release signal becomes a verified deployment state.",
  targetDurationSec: 20,
  provenance: {
    source: "slack-user-and-authorized-workspace-context",
    unsupportedClaimsAllowed: false,
  },
};

describe("Luna art-direction seed", () => {
  it("pushes a no-asset brief toward a committed palette and payoff", () => {
    const seed = lunaArtDirectionSeed(facts, false);
    expect(seed).toMatchObject({ version: 1, mode: "synthetic" });
    expect(seed.note).toMatch(/No brand assets/i);
    expect(seed.paletteGuidance).toMatch(/monochrome/i);
    expect(seed.paletteGuidance).toMatch(/vivid|payoff/i);
    expect(seed.principles.length).toBeGreaterThan(0);
  });

  it("tells an asset-prepared brief to carry the approved brand identity", () => {
    const seed = lunaArtDirectionSeed(facts, true);
    expect(seed.mode).toBe("assets-prepared");
    expect(seed.note).toMatch(/Approved brand assets/i);
    expect(seed.paletteGuidance).toMatch(/approved brand palette/i);
  });

  it("preserves creative authority — the seed is declinable direction, not a template", () => {
    for (const hasAssets of [true, false]) {
      const seed = lunaArtDirectionSeed(facts, hasAssets);
      expect(seed.authority).toMatch(/honor, adapt, or decline/i);
      expect(seed.authority).toMatch(/not a template/i);
    }
  });
});
