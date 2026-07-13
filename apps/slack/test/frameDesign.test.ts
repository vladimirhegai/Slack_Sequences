import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentProvider } from "@sequences/platform/providers";
import {
  contrastRatio,
  extractBrandTokens,
  isNeutral,
  mapFontToEmbedded,
  safeTextOn,
} from "../src/engine/brandTokens.ts";
import { FRAME_PRESETS, presetById } from "../src/engine/framePresets.ts";
import {
  BACKGROUND_POLICIES,
  DESIGN_DIALECTS,
  backgroundPolicyForDialect,
  designDialectById,
  rankDesignDialects,
} from "../src/engine/designDialects.ts";
import {
  buildJobFrame,
  forbiddenDefaults,
  frameCapsule,
  loadJobFrame,
  publicFrameMd,
  rankPresets,
  readFrameMeta,
  remapPreset,
  renderFrameMd,
} from "../src/engine/frameDesign.ts";
import {
  generateLayout,
  generatePalette,
  validateTypography,
} from "../src/engine/frameTools.ts";

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

describe("motion-ready design dialects", () => {
  it("keeps generic unique ids and resolves only approved background policies", () => {
    expect(DESIGN_DIALECTS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(DESIGN_DIALECTS.map((dialect) => dialect.id)).size).toBe(DESIGN_DIALECTS.length);
    expect(new Set(BACKGROUND_POLICIES.map((policy) => policy.id)).size).toBe(BACKGROUND_POLICIES.length);
    for (const dialect of DESIGN_DIALECTS) {
      expect(dialect.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(dialect.sourceRefs.length).toBeGreaterThan(0);
      expect(backgroundPolicyForDialect(dialect).direction.length).toBeGreaterThan(40);
    }
    const gallery = designDialectById("gallery-white")!;
    expect(backgroundPolicyForDialect(gallery, "ink-rail").id).toBe(
      gallery.defaultBackgroundPolicyId,
    );
  });

  it("ranks an incident timeline toward a signal-led dark dialect", () => {
    expect(rankDesignDialects("Realtime incident alert timeline", "crisp-saas")[0]?.id)
      .toBe("hazard-dark");
  });

  it("does not match short keywords inside unrelated words", () => {
    expect(rankDesignDialects("Rapid capital planning", "crisp-saas")[0]?.id)
      .not.toBe("hazard-dark");
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

  it("keeps a coherent dialect accent when the brand accent is neutral", () => {
    const preset = presetById("bold-launch")!; // white canvas
    const tokens = extractBrandTokens("accent #FEFEFE");
    const design = remapPreset(preset, tokens, null, []);
    // #FEFEFE is neutral so it isn't an accent candidate; the selected dialect seeds it.
    expect(design.colors.accent).toBe("#E60000");
    expect(design.provenance).toContain("seed hue #E60000 from poster-signal dialect");
  });

  it("renders a compact operational frame.md with all required sections", () => {
    const preset = presetById("dark-premium")!;
    const design = remapPreset(preset, extractBrandTokens(""), null, ["keep dark basis"]);
    const md = renderFrameMd(design, "Acme");
    expect(md).toContain("# frame.md — Dark Premium for Acme");
    expect(md).toContain("## Visual thesis");
    expect(md).toContain("## Recommended semantic palette");
    expect(md).toContain("## Visual grammar");
    expect(md).toContain("## Motion signature");
    expect(md).toContain("## Typography");
    expect(md).toContain("**Background policy:**");
    expect(md).toContain("## Mood-board restraints");
    expect(md).toContain("keep dark basis");
    expect(md).toContain("sequences-frame:");
    expect(md).toContain("Art-directed starting system");
    expect(md).toContain("## Deterministic tool report");
    expect(md).toContain("## Forbidden defaults");
    expect(md).toContain("--space-safe:");
    expect(md).toContain("--grid-columns: 12");
    expect(md).toContain(".scene {");
    expect(md).toContain(".layout-split {");
    expect(md).toContain(".layout-corner-chrome {");
    expect(md).toContain(".layout-hero-band {");
    expect(md).toContain(".cluster {");
    expect(md).toContain('data-layout-anchor="frame:center');
    expect(md).toContain('data-layout-attach="#word"');
  });

  it("removes internal metadata from the reader-facing Slack copy", () => {
    const preset = presetById("bold-launch")!;
    const design = remapPreset(preset, extractBrandTokens(""), null, []);
    const internal = renderFrameMd(design, "Acme");
    const shared = publicFrameMd(internal);

    expect(internal).toContain("<!-- sequences-frame:");
    expect(internal).toContain("<!-- provenance:");
    expect(shared).not.toContain("<!-- sequences-frame:");
    expect(shared).not.toContain("<!-- provenance:");
    expect(shared).not.toContain("Art-directed starting system");
    expect(shared).not.toContain("data-layout-");
    expect(shared).not.toContain("Deterministic tool report");
    expect(shared).toContain("## Design direction");
    expect(shared).toContain("## Visual grammar");
    expect(shared).toContain("## Motion signature");
    expect(shared).toContain("## Palette");
    expect(shared).toContain("## Spatial character");
    expect(shared).toContain("## Composition cues");
    expect(shared).toContain("documented color topology");
    expect(shared).toContain("# frame.md — Bold Launch for Acme");
  });

  it("honours creative harmony/layout choices while keeping brand hue and contrast safe", () => {
    const preset = presetById("clean-corporate")!;
    const tokens = extractBrandTokens("brand accent #1E2BFA");
    const design = remapPreset(preset, tokens, null, [], {
      presetId: preset.id,
      dialectId: "poster-signal",
      basis: "dark",
      harmony: "split-complementary",
      temperature: "warm",
      contrast: "soft",
      accentUsage: "bold",
      density: "airy",
      spacing: "cinematic",
      corners: "square",
      depth: "atmospheric",
      backgroundPolicyId: "quiet-solid",
      exceptions: [],
    });
    expect(design.basis).toBe("dark");
    expect(design.direction.harmony).toBe("split-complementary");
    expect(design.direction.density).toBe("airy");
    expect(design.radius).toContain("0px");
    expect(design.background.id).toBe("quiet-solid");
    expect(design.background.direction).toContain("solid canvas");
    expect(contrastRatio(design.colors.text, design.colors.bg)).toBeGreaterThanOrEqual(7);
    expect(design.colors.accent).toBe("#1E2BFA");
  });

  it("preserves captured heading/body font order for geometric brand type", () => {
    const preset = presetById("clean-corporate")!;
    const design = remapPreset(
      preset,
      extractBrandTokens(""),
      { colors: [], accent: "#1E2BFA", fonts: ["Outfit", "Inter"] },
      [],
      {
        presetId: preset.id,
        typography: { display: "Oswald", body: "EB Garamond", mono: "Space Mono" },
        exceptions: [],
      },
    );
    expect(design.type.display).toBe("Outfit");
    expect(design.type.body).toBe("Inter");
    expect(design.type.mono).toBe("Space Mono");
  });

  it("keeps a dialect-approved single-family system through frame integration", () => {
    const preset = presetById("clean-corporate")!;
    const design = remapPreset(
      preset,
      extractBrandTokens(""),
      null,
      [],
      {
        presetId: preset.id,
        dialectId: "warm-coral",
        typeSystemId: "warmth",
        backgroundPolicyId: "quiet-solid",
        exceptions: [],
      },
    );
    expect(design.type.display).toBe("Nunito");
    expect(design.type.body).toBe("Nunito");
    expect(design.typographyCharacter.pairingMode).toBe("single-family");
  });

  it("accepts depth choices within the dialect material profile and repairs the rest", () => {
    const preset = presetById("clean-corporate")!;
    const bordered = remapPreset(
      preset,
      extractBrandTokens(""),
      null,
      [],
      {
        presetId: preset.id,
        dialectId: "gallery-white",
        depth: "bordered",
        exceptions: [],
      },
    );
    expect(bordered.shadow).toContain("borders");
    expect(bordered.repairs.some((repair) => repair.includes("requested bordered depth"))).toBe(false);

    const repaired = remapPreset(
      preset,
      extractBrandTokens(""),
      null,
      [],
      {
        presetId: preset.id,
        dialectId: "gallery-white",
        depth: "atmospheric",
        exceptions: [],
      },
    );
    expect(repaired.repairs.some((repair) => repair.includes("permits flat/bordered"))).toBe(true);
  });
});

describe("deterministic frame design tools", () => {
  it("generates distinct harmony atmospheres from the same committed accent", () => {
    const base = {
      basis: "dark" as const,
      temperature: "cool" as const,
      contrast: "crisp" as const,
      accentUsage: "balanced" as const,
    };
    const mono = generatePalette("#7C3AED", { ...base, harmony: "monochromatic" });
    const complement = generatePalette("#7C3AED", { ...base, harmony: "complementary" });
    expect(mono.value.accent).toBe(complement.value.accent);
    expect(mono.value.atmosphere).not.toBe(complement.value.atmosphere);
    expect(contrastRatio(complement.value.text, complement.value.bg)).toBeGreaterThanOrEqual(7);
  });

  it("repairs unsafe semantic text and rejects an unrelated proposed accent hue", () => {
    const result = generatePalette("#1E2BFA", {
      basis: "light",
      harmony: "analogous",
      temperature: "warm",
      contrast: "balanced",
      accentUsage: "bold",
      proposed: {
        bg: "#FFFFFF",
        text: "#EEEEEE",
        textMuted: "#F4F4F4",
        accent: "#EF4444",
      },
    });
    expect(contrastRatio(result.value.text, result.value.bg)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(result.value.textMuted, result.value.bg)).toBeGreaterThanOrEqual(4.5);
    expect(result.value.accent).not.toBe("#EF4444");
    expect(result.repairs.some((repair) => repair.includes("committed brand hue"))).toBe(true);
  });

  it("keeps only embedded fonts and separates duplicate type roles", () => {
    const preset = presetById("clean-corporate")!;
    const result = validateTypography(
      { display: "Comic Sans MS", body: "Outfit", mono: "Outfit" },
      preset.type,
      {},
    );
    expect(result.value.display).toBe(preset.type.display);
    expect(result.value.body).not.toBe(result.value.display);
    expect(result.value.mono).toBe("JetBrains Mono");
    expect(result.repairs.length).toBeGreaterThan(0);
  });

  it("preserves an approved single-family display/body system", () => {
    const preset = presetById("clean-corporate")!;
    const result = validateTypography(
      { display: "Nunito", body: "Nunito", mono: "Space Mono" },
      preset.type,
      {},
      { pairingMode: "single-family" },
    );
    expect(result.value.display).toBe("Nunito");
    expect(result.value.body).toBe("Nunito");
    expect(result.repairs.some((repair) => repair.includes("separated display/body"))).toBe(false);
  });

  it("turns spatial choices into bounded, legible rhythm tokens", () => {
    const compact = generateLayout({
      density: "dense",
      spacing: "compact",
      corners: "crisp",
      depth: "bordered",
    });
    const cinematic = generateLayout({
      density: "airy",
      spacing: "cinematic",
      corners: "soft",
      depth: "elevated",
    });
    expect(compact.tokens.edge).toBeLessThan(cinematic.tokens.edge);
    expect(compact.tokens.radius).toBe(6);
    expect(cinematic.tokens.radius).toBe(14);
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
    expect(result.dialectId).toBe("hazard-dark");
    const loaded = loadJobFrame(dir);
    expect(loaded).toContain("# frame.md");
    const meta = readFrameMeta(dir);
    expect(meta?.presetId).toBe("crisp-dev");
    expect(meta?.dialectId).toBe("hazard-dark");
    expect(meta?.backgroundPolicyId).toBe("ink-rail");
    expect(meta?.label).toBe(result.label);
  });

  it("uses a bounded creative proposal instead of locking the preset answers", async () => {
    let receivedPrompt = "";
    const provider: AgentProvider = {
      id: "openai-api",
      label: "test",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete: async (prompt) => {
        receivedPrompt = prompt;
        return JSON.stringify({
          presetId: "clean-corporate",
          dialectId: "poster-signal",
          thesis: "Warm precision with generous editorial pacing.",
          basis: "dark",
          harmony: "complementary",
          temperature: "warm",
          contrast: "soft",
          accentUsage: "restrained",
          typeSystemId: "impact",
          palette: { bg: "#171410", surface: "#211D18" },
          typography: {
            display: "Oswald",
            body: "EB Garamond",
            mono: "Space Mono",
            note: "Condensed authority over a literary reading face.",
          },
          density: "airy",
          spacing: "cinematic",
          corners: "square",
          depth: "atmospheric",
          backgroundPolicyId: "quiet-solid",
          rules: ["One oversized phrase owns the first read."],
          exceptions: [],
        });
      },
    };
    const result = await buildJobFrame({
      provider,
      projectDir: dir,
      brief: "Launch Acme with brand accent #F97316",
      brandName: "Acme",
    });
    expect(receivedPrompt).toContain("Deterministic tools available");
    expect(receivedPrompt).toContain("Presets are mood and composition DNA");
    expect(receivedPrompt).toContain("Motion-ready visual dialects");
    expect(receivedPrompt).not.toContain("operational background family");
    expect(result.basis).toBe("dark");
    expect(result.thesis).toContain("Warm precision");
    expect(result.frameMd).toContain("harmony: **complementary**");
    expect(result.frameMd).toContain("**Display / headlines:** Oswald");
    expect(result.frameMd).toContain("Intentional solid field");
  });

  it("routes high-impact frame taste to reasoning-enabled GLM, not Flash", async () => {
    let receivedOptions: Record<string, unknown> | undefined;
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete: async (_prompt, options) => {
        receivedOptions = options as Record<string, unknown>;
        return JSON.stringify({
          presetId: "crisp-dev",
          dialectId: "hazard-dark",
          thesis: "A precise instrument panel that resolves noise into one calm signal.",
          basis: "dark",
          harmony: "analogous",
          temperature: "cool",
          contrast: "crisp",
          accentUsage: "restrained",
          typeSystemId: "condensed",
          palette: {},
          typography: {},
          density: "balanced",
          spacing: "cinematic",
          corners: "crisp",
          depth: "atmospheric",
          backgroundPolicyId: "ink-rail",
          rules: ["One dominant signal per shot."],
          exceptions: [],
        });
      },
    };
    await buildJobFrame({
      provider,
      projectDir: dir,
      brief: "Launch RADAR for product teams",
    });
    expect(receivedOptions).toMatchObject({
      model: "z-ai/glm-5.2",
      thinkingMode: "high",
      maxTokens: 4_096,
    });
    expect(receivedOptions?.responseFormat).toMatchObject({
      type: "json_schema",
      json_schema: { name: "sequences_frame_direction" },
    });
  });

  it("lets the model choose a curated type system for the trio", async () => {
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete: async () =>
        JSON.stringify({
          presetId: "clean-corporate",
          dialectId: "broadsheet",
          thesis: "A calm geometric instrument panel.",
          basis: "light",
          harmony: "monochromatic",
          temperature: "cool",
          contrast: "crisp",
          accentUsage: "restrained",
          typeSystemId: "editorial", // Playfair Display / EB Garamond / JetBrains Mono
          palette: {},
          typography: {},
          density: "balanced",
          spacing: "balanced",
          corners: "crisp",
          depth: "bordered",
          backgroundPolicyId: "paper-rules",
          rules: ["Hairlines and type provide the structure."],
          exceptions: [],
        }),
    };
    const result = await buildJobFrame({
      provider,
      projectDir: dir, // no brand font committed → the type system supplies the trio
      brief: "Launch a premium editorial product",
    });
    expect(result.frameMd).toContain("**Display / headlines:** Playfair Display");
    expect(result.frameMd).toContain("**Body / UI:** EB Garamond");
    expect(result.frameMd).toContain("type system editorial"); // provenance
  });
});

describe("forbidden defaults (brand-informed anti-patterns)", () => {
  it("always forbids second accents, gradient washes, and chrome shadows", () => {
    const design = remapPreset(presetById("clean-corporate")!, extractBrandTokens(""), null, []);
    const rules = forbiddenDefaults(design).join(" ").toLowerCase();
    expect(rules).toContain("second competing accent");
    expect(rules).toContain("band under h.264");
    expect(rules).toContain("no drop shadows on chrome");
    expect(rules).toContain("tabular");
  });

  it("makes pure white, pure black, and solid fields dialect-aware", () => {
    const gallery = remapPreset(
      presetById("clean-corporate")!,
      extractBrandTokens(""),
      null,
      [],
      { presetId: "clean-corporate", dialectId: "gallery-white", exceptions: [] },
    );
    expect(gallery.colors.bg).toBe("#FFFFFF");
    expect(forbiddenDefaults(gallery).join(" ")).not.toContain("#FFF");
    expect(gallery.canvas.allowSolidField).toBe(true);

    const posterDark = remapPreset(
      presetById("bold-launch")!,
      extractBrandTokens(""),
      null,
      [],
      {
        presetId: "bold-launch",
        dialectId: "poster-signal",
        basis: "dark",
        backgroundPolicyId: "quiet-solid",
        exceptions: [],
      },
    );
    expect(posterDark.colors.bg).toBe("#000000");
    expect(forbiddenDefaults(posterDark).join(" ")).not.toContain("#000 canvas");

    const hazard = remapPreset(
      presetById("crisp-dev")!,
      extractBrandTokens(""),
      null,
      [],
      { presetId: "crisp-dev", dialectId: "hazard-dark", exceptions: [] },
    );
    expect(forbiddenDefaults(hazard).join(" ")).toContain("#000 canvas");
  });
});

describe("frame capsule (compact author projection)", () => {
  function fullFrame(): string {
    const design = remapPreset(
      presetById("crisp-dev")!,
      extractBrandTokens("accent #3B82F6"),
      null,
      ["Wordmark may use oversized mono."],
    );
    return renderFrameMd(design, "Radar");
  }

  it("keeps the design decisions and the spatial scaffold the author needs", () => {
    const capsule = frameCapsule(fullFrame());
    expect(capsule).toContain("# frame.md capsule");
    expect(capsule).toContain("## Visual thesis");
    expect(capsule).toContain("## Visual grammar");
    expect(capsule).toContain("## Motion signature");
    expect(capsule).toContain("**Micro:**");
    expect(capsule).toContain("## Palette");
    expect(capsule).toContain("| Canvas |");
    expect(capsule).toContain("## Type");
    expect(capsule).toContain("**Display / headlines:**");
    // The author must still define the spatial scaffold in their own <style>.
    expect(capsule).toContain("--space-safe:");
    expect(capsule).toContain(".layout-split {");
    expect(capsule).toContain("## Restraints");
    expect(capsule).toContain("## Forbidden defaults");
    expect(capsule).toContain("## Brand exceptions");
    expect(capsule).toContain("oversized mono");
  });

  it("drops the host-owned/duplicated chapters and the internal report", () => {
    const capsule = frameCapsule(fullFrame());
    // Cinematography kit is host-injected + taught in the director prompt.
    expect(capsule).not.toContain("## Cinematography (host kit)");
    // Internal provenance/tooling never reaches the author.
    expect(capsule).not.toContain("## Deterministic tool report");
    expect(capsule).not.toContain("<!-- sequences-frame:");
    expect(capsule).not.toContain("<!-- provenance:");
  });

  it("is meaningfully smaller than the full frame.md", () => {
    const full = fullFrame();
    const capsule = frameCapsule(full);
    expect(capsule.length).toBeLessThan(full.length);
  });

  it("falls back to a bounded slice for a non-frame input", () => {
    const junk = "# Frame token reference line for measurement.\n".repeat(80);
    const capsule = frameCapsule(junk);
    expect(capsule.length).toBeLessThanOrEqual(4_000);
    expect(capsule).toBe(junk.slice(0, 4_000));
  });
});
