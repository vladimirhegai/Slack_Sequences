import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  contrastRatio,
  extractBrandTokens,
  isNeutral,
  mapFontToEmbedded,
  safeTextOn,
} from "../src/engine/brandTokens.ts";
import { FRAME_PRESETS, presetById } from "../src/engine/framePresets.ts";
import {
  buildJobFrame,
  loadJobFrame,
  rankPresets,
  readFrameMeta,
  remapPreset,
  renderFrameMd,
} from "../src/engine/frameDesign.ts";

describe("brand token extraction (deterministic)", () => {
  it("pulls a hex accent and product URL from an evidence pack", () => {
    const tokens = extractBrandTokens(
      "Relay ships observability. Brand signals: primary accent #1E2BFA on white, fonts Inter and Space Grotesk, URL https://relay.dev, logo relay-logo.svg.",
    );
    expect(tokens.accent).toBe("#1E2BFA");
    expect(tokens.url).toBe("https://relay.dev");
    expect(tokens.logo).toMatch(/relay-logo\.svg/);
    expect(tokens.colors).toContain("#1E2BFA");
  });

  it("maps brand fonts to embedded families", () => {
    const tokens = extractBrandTokens("We use Söhne... actually fonts: Space Grotesk display, Inter body.");
    // Space Grotesk → Outfit (embedded geometric), Inter stays Inter.
    expect(tokens.bodyFont ?? tokens.displayFont).toBeDefined();
    expect(mapFontToEmbedded("Space Grotesk")).toBe("Outfit");
    expect(mapFontToEmbedded("Helvetica Neue")).toBe("Inter");
    expect(mapFontToEmbedded("Bodoni Moda")).toBe("Playfair Display");
  });

  it("treats near-white/near-black/grey as neutral, not accent", () => {
    expect(isNeutral("#FFFFFF")).toBe(true);
    expect(isNeutral("#0A0A0A")).toBe(true);
    expect(isNeutral("#888888")).toBe(true);
    expect(isNeutral("#1E2BFA")).toBe(false);
  });

  it("picks a legible text colour for a surface", () => {
    expect(safeTextOn("#0B0F14")).toBe("#FFFFFF");
    expect(safeTextOn("#FDFAF3")).toBe("#111111");
    expect(contrastRatio("#FFFFFF", "#0B0F14")).toBeGreaterThan(4.5);
  });
});

describe("preset registry + ranking", () => {
  it("offers 3–5 curated SaaS presets, each on embedded fonts", () => {
    expect(FRAME_PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(FRAME_PRESETS.length).toBeLessThanOrEqual(5);
    const embedded = new Set([
      "Montserrat", "Oswald", "League Gothic", "Archivo Black", "Space Mono",
      "IBM Plex Mono", "JetBrains Mono", "Source Code Pro", "Inter", "Roboto",
      "Open Sans", "Lato", "Nunito", "Poppins", "Outfit", "Playfair Display",
      "EB Garamond", "Noto Sans JP",
    ]);
    for (const preset of FRAME_PRESETS) {
      expect(embedded.has(preset.type.display)).toBe(true);
      expect(embedded.has(preset.type.body)).toBe(true);
      expect(embedded.has(preset.type.mono)).toBe(true);
      expect(preset.rules.length).toBeLessThanOrEqual(5);
    }
  });

  it("ranks a dev-tool brief toward the crisp-dev preset", () => {
    const ranked = rankPresets("Launch our developer CLI with sub-100ms API latency", "crisp-saas");
    expect(ranked[0]?.id).toBe("crisp-dev");
  });

  it("ranks a bold consumer launch toward bold-launch", () => {
    const ranked = rankPresets("Big bold consumer campaign drop reveal", "bold-launch");
    expect(ranked[0]?.id).toBe("bold-launch");
  });
});

describe("deterministic remap", () => {
  it("applies a usable brand accent and recomputes safe accent text", () => {
    const preset = presetById("clean-corporate")!;
    const tokens = extractBrandTokens("accent #C2185B");
    const design = remapPreset(preset, tokens, null, []);
    expect(design.colors.accent).toBe("#C2185B");
    expect(design.colors.accentText).toBe(safeTextOn("#C2185B"));
    expect(design.brandMatched).toBe(true);
  });

  it("keeps the preset accent when the brand accent is too low-contrast", () => {
    const preset = presetById("bold-launch")!; // white canvas
    const tokens = extractBrandTokens("accent #FEFEFE");
    const design = remapPreset(preset, tokens, null, []);
    // #FEFEFE is neutral so it isn't even an accent candidate → house accent kept.
    expect(design.colors.accent).toBe(preset.colors.accent);
  });

  it("renders a compact operational frame.md with all required sections", () => {
    const preset = presetById("dark-premium")!;
    const design = remapPreset(preset, extractBrandTokens(""), null, ["keep dark basis"]);
    const md = renderFrameMd(design, "Acme");
    expect(md).toContain("# frame.md — Dark Premium for Acme");
    expect(md).toContain("## Visual thesis");
    expect(md).toContain("## Semantic colours");
    expect(md).toContain("## Typography");
    expect(md).toContain("Background family:");
    expect(md).toContain("## Do / Don't");
    expect(md).toContain("keep dark basis");
    expect(md).toContain("sequences-frame:");
  });
});

describe("buildJobFrame end-to-end (no model, no network)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "frame-test-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes frame.md, falls back to a house preset, and round-trips metadata", async () => {
    const result = await buildJobFrame({
      projectDir: dir, // no provider → deterministic top rank
      brief: "Launch our developer CLI with fast deploys",
      tone: "crisp-saas",
      evidence: "Brand signals: accent #3B82F6, fonts Inter. URL: not found.",
    });
    expect(fs.existsSync(path.join(dir, "frame.md"))).toBe(true);
    expect(result.presetId).toBe("crisp-dev");
    const loaded = loadJobFrame(dir);
    expect(loaded).toContain("# frame.md");
    const meta = readFrameMeta(dir);
    expect(meta?.presetId).toBe("crisp-dev");
    expect(meta?.label).toBe(result.label);
  });
});
