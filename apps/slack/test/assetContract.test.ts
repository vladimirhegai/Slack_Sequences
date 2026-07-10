import { describe, expect, it } from "vitest";
import {
  SPRING_PRESETS,
  springEase,
  springLinearEasing,
  springPosition,
  springSamples,
  springSettleSec,
} from "../src/engine/motionSpring.ts";
import {
  assetPluginSpecs,
  assetsRhyme,
  coerceAssetParams,
  compileAssetAnimation,
  defineAsset,
  renderAssetInstance,
  type AssetDefinitionV1,
} from "../src/engine/assetContract.ts";
import { ASSET_LIBRARY, getAsset } from "../src/engine/assets/index.ts";
import { deriveTopic } from "../src/engine/seedContent.ts";
import { createSeededRandom } from "../src/engine/pluginKernel.ts";
import type { PluginLowerContext } from "../src/engine/pluginContract.ts";

/* ------------------------------------------------------------- springs */

describe("motionSpring", () => {
  it("step response starts at 0 and settles at 1 for every preset", () => {
    for (const preset of Object.keys(SPRING_PRESETS) as (keyof typeof SPRING_PRESETS)[]) {
      expect(springPosition(preset, 0)).toBe(0);
      const settle = springSettleSec(preset);
      expect(settle).toBeGreaterThan(0.1);
      expect(settle).toBeLessThan(3);
      expect(springPosition(preset, settle)).toBeCloseTo(1, 2);
    }
  });

  it("underdamped springs overshoot; critically damped never do", () => {
    const bounceMax = Math.max(...springSamples("bounce", 240));
    const popMax = Math.max(...springSamples("pop", 240));
    const snapMax = Math.max(...springSamples("snap", 240));
    expect(bounceMax).toBeGreaterThan(1.2); // a real bounce, not an ease-out
    expect(popMax).toBeGreaterThan(1.05);
    expect(snapMax).toBeLessThanOrEqual(1.0001);
  });

  it("bounce crosses the target more than once (visible oscillation)", () => {
    const samples = springSamples("bounce", 480);
    let crossings = 0;
    for (let i = 1; i < samples.length; i += 1) {
      if ((samples[i - 1]! - 1) * (samples[i]! - 1) < 0) crossings += 1;
    }
    expect(crossings).toBeGreaterThanOrEqual(3);
  });

  it("normalized ease pins both endpoints exactly", () => {
    const ease = springEase("pop");
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it("emits a valid CSS linear() easing and is deterministic", () => {
    const easing = springLinearEasing("settle");
    expect(easing).toMatch(/^linear\(0, /);
    expect(easing).toMatch(/1 100%\)$/);
    expect(springLinearEasing("settle")).toBe(easing);
  });
});

/* ------------------------------------------------------------ contract */

const testAsset: AssetDefinitionV1 = defineAsset({
  version: 1,
  id: "test-chip",
  title: "Test chip",
  purpose: "Contract fixture",
  family: "pill",
  params: [
    { name: "accent", kind: "color", description: "a", default: "#6ea8ff", cssVar: "--tc-accent" },
    { name: "size", kind: "number", description: "s", default: 100, min: 40, max: 200, cssVar: "--tc-size", unit: "px" },
    { name: "label", kind: "text", description: "l", default: "Chip", maxChars: 10 },
    { name: "tone", kind: "enum", description: "t", default: "soft", options: ["soft", "loud"], attr: "tone" },
  ],
  animations: [
    {
      name: "expand",
      purpose: "bouncy grow",
      spring: "bounce",
      tracks: [{ property: "scale", from: 1, to: 1.2 }],
    },
    {
      name: "size-in",
      purpose: "param-driven track",
      spring: "settle",
      tracks: [{ property: "--tc-size", from: 0, to: "$size" }],
    },
  ],
  style: ".asset-test-chip{width:var(--tc-size,100px)}",
  render: ({ params, escapeHtml }) => `<span class="tc-label">${escapeHtml(String(params.label))}</span>`,
});

describe("assetContract", () => {
  it("definition-time validation rejects text params in CSS", () => {
    expect(() =>
      defineAsset({
        ...testAsset,
        id: "bad-chip",
        params: [{ name: "label", kind: "text", description: "l", default: "x", cssVar: "--x" }],
      }),
    ).toThrow(/text never enters CSS/);
  });

  it("coercion clamps, defaults, and rejects unsafe colors", () => {
    const { params, notes } = coerceAssetParams(testAsset, {
      accent: "red;} body{background:url(evil)", // CSS injection attempt
      size: 9999,
      label: "A very long label indeed",
      tone: "shouty",
    });
    expect(params.accent).toBe("#6ea8ff"); // reset to default
    expect(params.size).toBe(200); // clamped
    expect(String(params.label).length).toBeLessThanOrEqual(10);
    expect(params.tone).toBe("soft");
    expect(notes.length).toBeGreaterThanOrEqual(3);
  });

  it("renders deterministically with custom props, attrs, and escaped copy", () => {
    const a = renderAssetInstance(testAsset, { label: "<b>Hi</b>", tone: "loud" }, { partId: "hero" });
    const b = renderAssetInstance(testAsset, { label: "<b>Hi</b>", tone: "loud" }, { partId: "hero" });
    expect(a.markup).toBe(b.markup); // pure function of params
    expect(a.markup).toContain('data-asset="test-chip"');
    expect(a.markup).toContain('data-part="hero"');
    expect(a.markup).toContain('data-tone="loud"');
    expect(a.markup).toContain("--tc-size:100px");
    expect(a.markup).toContain("&lt;b&gt;Hi&lt;/b&gt;");
    expect(a.markup).not.toContain("<b>Hi</b>");
  });

  it("compiles animations with spring easing and resolves $param refs", () => {
    const { params } = coerceAssetParams(testAsset, { size: 150 });
    const compiled = compileAssetAnimation(testAsset.animations[1]!, params);
    expect(compiled.to["--tc-size"]).toBe("150");
    expect(compiled.easing).toMatch(/^linear\(/);
    expect(compiled.durationMs).toBeGreaterThan(100);
    const expand = compileAssetAnimation(testAsset.animations[0]!, params);
    expect(expand.from.transform).toBe("scale(1)");
    expect(expand.to.transform).toBe("scale(1.2)");
    expect(Math.max(...expand.easeSamples)).toBeGreaterThan(1.2); // the bounce survives
  });

  it("silhouette rhyme groups match the cut contract's families", () => {
    expect(assetsRhyme("pill", "bar")).toBe(true);
    expect(assetsRhyme("card", "circle")).toBe(true);
    expect(assetsRhyme("pill", "circle")).toBe(false);
  });
});

/* -------------------------------------------------------- plugin bridge */

function lowerContext(params: Record<string, string | number>): PluginLowerContext {
  return {
    sceneId: "s1",
    startSec: 0,
    durationSec: 6,
    id: "hero-metric",
    uid: "s1-hero-metric",
    params,
    topic: deriveTopic("probe"),
    rng: createSeededRandom("probe"),
  };
}

describe("asset plugin bridge", () => {
  it("exposes each library asset as an asset-<id> plugin kind", () => {
    const specs = assetPluginSpecs(ASSET_LIBRARY);
    expect(specs.map((spec) => spec.kind)).toContain("asset-glass-metric");
    for (const spec of specs) {
      expect(spec.planningLine).toContain(spec.kind);
      expect(spec.params.every((param) => param.default !== undefined)).toBe(true);
    }
  });

  it("lowering is pure and emits the internal asset component + animate beats", () => {
    const spec = assetPluginSpecs(ASSET_LIBRARY).find((entry) => entry.kind === "asset-glass-metric")!;
    const a = spec.lower(lowerContext({ value: "12k", ring: 64 }));
    const b = spec.lower(lowerContext({ value: "12k", ring: 64 }));
    expect(a.markup).toBe(b.markup); // strip-and-reinject prerequisite
    // 2026-07-09 asset runtime: the lowering declares ONE host-only `asset`
    // component for the unit root plus its host-derived spring choreography
    // (enter + payoffs) as typed `animate` beats — never free-form content.
    expect(a.components).toEqual([
      { version: 1, id: "hero-metric-core", kind: "asset", pluginUid: "s1-hero-metric" },
    ]);
    expect(a.beats.map((beat) => [beat.kind, beat.animation])).toEqual([
      ["animate", "enter"],
      ["animate", "ring-fill"],
    ]);
    expect(a.markup).toContain('data-part="hero-metric-core"');
    expect(a.markup).toContain("12k");
  });
});

/* ------------------------------------------------------------- library */

describe("asset library", () => {
  it("registers glass-metric with tweakable params and spring animations", () => {
    const asset = getAsset("glass-metric")!;
    expect(asset).toBeDefined();
    const instance = renderAssetInstance(asset, { accent: "#ff8a5c", size: 300, ring: 42 });
    expect(instance.markup).toContain("--gm-accent:#ff8a5c");
    expect(instance.markup).toContain("--gm-size:300px");
    expect(instance.markup).toContain("--gm-ring:42");
    expect(instance.style).toContain("@property --gm-ring");
    const names = instance.animations.map((animation) => animation.name);
    expect(names).toEqual(expect.arrayContaining(["enter", "expand", "pulse", "ring-fill"]));
    const ringFill = instance.animations.find((animation) => animation.name === "ring-fill")!;
    expect(ringFill.to["--gm-ring"]).toBe("42");
    const expand = instance.animations.find((animation) => animation.name === "expand")!;
    expect(Math.max(...expand.easeSamples)).toBeGreaterThan(1.1); // bouncy, not linear
  });

  it("defaults theme through brand tokens so frame.md rethemes assets for free", () => {
    const asset = getAsset("glass-metric")!;
    const instance = renderAssetInstance(asset, {});
    expect(instance.markup).toContain("--gm-accent:var(--accent)");
    expect(instance.style).toContain("var(--surface");
    expect(instance.style).toContain("var(--muted");
  });
});
