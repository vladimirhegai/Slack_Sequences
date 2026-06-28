import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bundleToPrimitive,
  installBundle,
  SeqextBundleSchema,
  uninstallBundlePrimitive,
  validateBundle,
  type SeqextBundle,
} from "../src/registry/extensionBundle.ts";
import { PRIMITIVES } from "../src/registry/primitives.ts";
import { compile } from "../src/compiler.ts";
import { extensionPreviewProject } from "../src/extensionPreview.ts";
import type { EmitContext, MaterializedLayer } from "../src/registry/types.ts";

const EXT_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "examples",
  "forge",
  "extensions",
);

function readBundle(id: string): SeqextBundle {
  const dir = path.join(EXT_ROOT, `${id}.seqext`);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const spec = JSON.parse(fs.readFileSync(path.join(dir, "spec.json"), "utf8"));
  return SeqextBundleSchema.parse({ manifest, spec });
}

function makeCtx(overrides: Partial<EmitContext> = {}): EmitContext {
  const layer: MaterializedLayer = {
    id: "hero",
    role: "hero",
    rank: 1,
    kind: "number",
    content: { text: "Ship faster", number: { value: 1280, prefix: "$", suffix: "+" } },
    box: { x: 100, y: 200, w: 800, h: 200, origin: "center center" },
    sceneId: "s1",
    motions: {},
  };
  return {
    containerSel: "#seq-l-hero",
    innerSel: "#seq-l-hero > .seq-inner",
    startSec: 0.5,
    durationSec: 0.533,
    ease: "seqEnterSnap",
    easingToken: "enter.snap",
    distancePx: 64,
    scale: 1.12,
    sceneStartSec: 0.2,
    sceneDurationSec: 4,
    layer,
    fps: 30,
    stageWidth: 1920,
    stageHeight: 1080,
    ...overrides,
  };
}

const CONTEXTS: EmitContext[] = [
  makeCtx(),
  makeCtx({ startSec: 1.2, durationSec: 0.8, fps: 30, ease: "seqEnterSnap" }),
  makeCtx({ startSec: 0, durationSec: 0.2, fps: 60, ease: "none" }),
  makeCtx({
    startSec: 3.333,
    durationSec: 1.234,
    fps: 60,
    layer: { ...makeCtx().layer, content: { number: { value: 99, prefix: "", suffix: "%" } } },
  }),
];

describe(".seqext bundles re-author the custom-step primitives byte-identically", () => {
  for (const id of ["enter.countUp", "enter.charCascade", "enter.slideUpSoft"]) {
    it(`${id}: loads, validates, and emits identical GsapSteps to the built-in`, () => {
      const bundle = readBundle(id);
      const validation = validateBundle(bundle);
      expect(validation.errors).toEqual([]);
      expect(validation.ok).toBe(true);

      const authored = bundleToPrimitive(bundle);
      const original = PRIMITIVES[id]!;
      for (const ctx of CONTEXTS) {
        const a = authored.emit(ctx);
        const b = original.emit(ctx);
        expect(a).toEqual(b);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }
    });
  }

  it("custom-step bundles declare the eases they use (linter contract)", () => {
    const steps = bundleToPrimitive(readBundle("enter.countUp")).emit(makeCtx());
    const custom = steps.find((s) => s.kind === "custom");
    expect(custom).toBeDefined();
    if (custom && custom.kind === "custom") {
      expect(custom.easesUsed).toEqual(["seqEnterSnap"]);
      expect(custom.code).toContain("toLocaleString");
    }
  });
});

describe("validateBundle gates malformed bundles", () => {
  it("rejects a skeleton that references an undeclared identifier", () => {
    const result = validateBundle({
      manifest: {
        id: "enter.bad",
        version: "1.0.0",
        summary: "A bundle that reaches for a value nobody declared, which must fail.",
        tags: { energy: "calm", style: "organic" },
      },
      spec: {
        primitiveKind: "enter",
        defaults: { duration: "base", easing: "enter.glide" },
        skeleton: [
          {
            kind: "fromTo",
            target: "$inner",
            from: { y: "$mysteryKnob" },
            to: { y: 0 },
            durationSec: "$durationSec",
            ease: "$ease",
            atSec: "$startSec",
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("mysteryKnob");
  });

  it("rejects an id not prefixed by its primitiveKind", () => {
    const result = validateBundle({
      manifest: {
        id: "wrong.name",
        version: "1.0.0",
        summary: "A perfectly fine motion whose id prefix does not match its kind.",
        tags: { energy: "calm", style: "organic" },
      },
      spec: {
        primitiveKind: "enter",
        defaults: { duration: "base", easing: "enter.glide" },
        skeleton: [
          {
            kind: "fromTo",
            target: "$inner",
            from: { opacity: 0 },
            to: { opacity: 1 },
            durationSec: "$durationSec",
            ease: "$ease",
            atSec: "$startSec",
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("primitiveKind");
  });

  it("accepts the declarative reference bundle", () => {
    expect(validateBundle(readBundle("enter.slideUpSoft")).ok).toBe(true);
  });
});

describe("installBundle makes an authored bundle a first-class, compilable primitive", () => {
  it("installs, drives the real compiler/preview path, then uninstalls cleanly", () => {
    const bundle = readBundle("enter.slideUpSoft");
    // Re-id so we don't shadow the built-in during the test.
    const cloned = SeqextBundleSchema.parse({
      manifest: { ...bundle.manifest, id: "enter.forgeProbe" },
      spec: bundle.spec,
    });
    expect(PRIMITIVES["enter.forgeProbe"]).toBeUndefined();
    try {
      installBundle(cloned);
      expect(PRIMITIVES["enter.forgeProbe"]).toBeDefined();
      // The unchanged extension-preview + compiler path now renders it.
      const result = compile(extensionPreviewProject("primitive", "enter.forgeProbe"));
      expect(result.html).toContain("data-composition-id");
      expect(result.steps.length).toBeGreaterThan(0);
    } finally {
      uninstallBundlePrimitive("enter.forgeProbe");
    }
    expect(PRIMITIVES["enter.forgeProbe"]).toBeUndefined();
  });

  it("refuses to install an invalid bundle", () => {
    expect(() => installBundle({ manifest: {}, spec: {} })).toThrow();
  });
});
