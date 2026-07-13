import { describe, expect, it } from "vitest";
import {
  normalizationIntroducedFindings,
  normalizeStoryboardSceneId,
} from "../src/engine/runner/storyboardAudit.ts";

describe("storyboard atomic normalization findings", () => {
  it("rejects a normalization that worsens an existing dead-moment gap", () => {
    const original = [
      "storyboard/moments: no planned moment between 0.5s and 3.5s (3.0s) — the viewer gets no reviewable development",
    ];
    const normalized = [
      "storyboard/moments: no planned moment between 0.5s and 6.0s (5.5s) — the viewer gets no reviewable development",
    ];
    expect(normalizationIntroducedFindings(normalized, original)).toEqual(normalized);
  });

  it("allows the same finding class when normalization improves its gap", () => {
    const original = [
      "storyboard/moments: no planned moment between 0.5s and 6.0s (5.5s) — the viewer gets no reviewable development",
    ];
    const normalized = [
      "storyboard/moments: no planned moment between 0.5s and 3.5s (3.0s) — the viewer gets no reviewable development",
    ];
    expect(normalizationIntroducedFindings(normalized, original)).toEqual([]);
  });
});

describe("storyboard scene id normalization", () => {
  it("prefixes only an otherwise-valid digit-leading kebab slug", () => {
    expect(normalizeStoryboardSceneId("37-partial-claim")).toBe("scene-37-partial-claim");
    expect(normalizeStoryboardSceneId("partial-claim")).toBe("partial-claim");
    expect(normalizeStoryboardSceneId("37 Bad Claim")).toBe("37 Bad Claim");
  });
});
