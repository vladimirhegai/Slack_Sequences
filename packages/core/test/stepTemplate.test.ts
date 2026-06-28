import { describe, expect, it } from "vitest";
import {
  emitContextEnv,
  resolveTemplate,
  resolveValue,
  templatePrimitive,
  type StepTemplate,
  type TemplatePrimitiveDef,
} from "../src/registry/stepTemplate.ts";
import type { EmitContext, MaterializedLayer, MotionPrimitive } from "../src/registry/types.ts";
import { PRIMITIVES } from "../src/registry/primitives.ts";
import { PRIMITIVE_STYLE_TOKENS } from "../src/tokens.ts";

function makeCtx(overrides: Partial<EmitContext> = {}): EmitContext {
  const layer: MaterializedLayer = {
    id: "hero",
    role: "hero",
    rank: 1,
    kind: "text",
    content: { text: "Ship faster" },
    box: { x: 100, y: 200, w: 800, h: 200, origin: "center center" },
    sceneId: "s1",
    motions: {},
  };
  return {
    containerSel: "#seq-l-hero",
    innerSel: "#seq-l-hero > .seq-inner",
    startSec: 0.5,
    durationSec: 0.533,
    ease: "seqEnterGlide",
    easingToken: "enter.glide",
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

// A spread of adversarial contexts (the seed of the §9 stress matrix).
const CONTEXTS: EmitContext[] = [
  makeCtx(),
  makeCtx({ startSec: 1.2, durationSec: 0.8, distancePx: 130, scale: 1.35, ease: "seqEnterSnap" }),
  makeCtx({ startSec: 0, durationSec: 0.2, distancePx: 8, scale: 1.03, fps: 60, ease: "none" }),
  makeCtx({ startSec: 3.333, durationSec: 1.234, distancePx: 0, scale: 1.0, ease: "power1.in" }),
];

describe("StepTemplate expression evaluator", () => {
  const env = emitContextEnv(makeCtx());
  it("passes literals through untouched", () => {
    expect(resolveValue(0, env)).toBe(0);
    expect(resolveValue(true, env)).toBe(true);
    expect(resolveValue("blur(0px)", env)).toBe("blur(0px)");
    expect(resolveValue("var(--c-accent)", env)).toBe("var(--c-accent)");
  });
  it("resolves bare identifier references to env values", () => {
    expect(resolveValue("$distancePx", env)).toBe(64);
    expect(resolveValue("$inner", env)).toBe("#seq-l-hero > .seq-inner");
    expect(resolveValue("$ease", env)).toBe("seqEnterGlide");
  });
  it("evaluates arithmetic with correct precedence and unary minus", () => {
    expect(resolveValue("$distancePx / 2 + 1", env)).toBe(33);
    expect(resolveValue("$-distancePx", env)).toBe(-64);
    expect(resolveValue("$(durationSec + 1) * 2", env)).toBe((0.533 + 1) * 2);
  });
  it("supports the rounding helpers and matches Math rounding", () => {
    expect(resolveValue("$round(1/scale,3)", env)).toBe(Math.round((1 / 1.12) * 1000) / 1000);
    expect(resolveValue("$round(durationSec/2,3)", env)).toBe(Math.round((0.533 / 2) * 1000) / 1000);
    expect(resolveValue("$min(durationSec, 0.1)", env)).toBe(0.1);
  });
  it("interpolates ${…} into surrounding text", () => {
    expect(resolveValue("blur(${round(8 * (stageHeight/1080),0)}px)", env)).toBe("blur(8px)");
  });
  it("rejects unknown identifiers and malformed expressions", () => {
    expect(() => resolveValue("$nope", env)).toThrow();
    expect(() => resolveValue("$1 + ", env)).toThrow();
    expect(() => resolveValue("$inner * 2", env)).toThrow(); // string in arithmetic
  });
});

// Re-author existing built-in primitives as token-pure skeletons and prove the
// interpreter emits byte-identical GsapSteps. This is the P0 de-risk: if the IR
// can reproduce the hand-written set exactly, Forge can author on top of it.
const REAUTHORED: TemplatePrimitiveDef[] = [
  {
    id: "enter.fadeIn",
    kind: "enter",
    summary: PRIMITIVES["enter.fadeIn"]!.summary,
    tags: { energy: "calm", style: "organic" },
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
  {
    id: "enter.slideUpSoft",
    kind: "enter",
    summary: PRIMITIVES["enter.slideUpSoft"]!.summary,
    tags: { energy: "calm", style: "organic" },
    defaults: { duration: "base", easing: "enter.glide", distance: "step" },
    skeleton: [
      {
        kind: "fromTo",
        target: "$inner",
        from: { y: "$distancePx", opacity: 0 },
        to: { y: 0, opacity: 1 },
        durationSec: "$durationSec",
        ease: "$ease",
        atSec: "$startSec",
      },
    ],
  },
  {
    id: "enter.maskRevealUp",
    kind: "enter",
    summary: PRIMITIVES["enter.maskRevealUp"]!.summary,
    tags: { energy: "punchy", style: "mechanical" },
    defaults: { duration: "base", easing: "enter.snap" },
    needsMask: true,
    constants: { maskOffset: PRIMITIVE_STYLE_TOKENS.maskRevealOffsetPercent },
    skeleton: [
      {
        kind: "fromTo",
        target: "$inner",
        from: { yPercent: "$maskOffset" },
        to: { yPercent: 0 },
        durationSec: "$durationSec",
        ease: "$ease",
        atSec: "$startSec",
      },
    ],
  },
  {
    id: "enter.scaleIn",
    kind: "enter",
    summary: PRIMITIVES["enter.scaleIn"]!.summary,
    tags: { energy: "punchy", style: "organic" },
    defaults: { duration: "base", easing: "enter.settle", scale: "pop" },
    skeleton: [
      {
        kind: "fromTo",
        target: "$inner",
        from: { scale: "$round(1/scale,3)", opacity: 0 },
        to: { scale: 1, opacity: 1 },
        durationSec: "$durationSec",
        ease: "$ease",
        atSec: "$startSec",
      },
    ],
  },
  {
    id: "exit.fadeDown",
    kind: "exit",
    summary: PRIMITIVES["exit.fadeDown"]!.summary,
    tags: { energy: "calm", style: "organic" },
    defaults: { duration: "quick", easing: "exit.fade", distance: "nudge" },
    skeleton: [
      {
        kind: "to",
        target: "$inner",
        vars: { opacity: 0, y: "$distancePx" },
        durationSec: "$durationSec",
        ease: "$ease",
        atSec: "$startSec",
      },
    ],
  },
  {
    id: "exit.slideExit",
    kind: "exit",
    summary: PRIMITIVES["exit.slideExit"]!.summary,
    tags: { energy: "punchy", style: "mechanical" },
    defaults: { duration: "quick", easing: "exit.swift", distance: "step" },
    skeleton: [
      {
        kind: "to",
        target: "$inner",
        vars: { opacity: 0, y: "$-distancePx" },
        durationSec: "$durationSec",
        ease: "$ease",
        atSec: "$startSec",
      },
    ],
  },
  {
    id: "exit.scaleAway",
    kind: "exit",
    summary: PRIMITIVES["exit.scaleAway"]!.summary,
    tags: { energy: "punchy", style: "organic" },
    defaults: { duration: "quick", easing: "exit.swift", scale: "subtle" },
    skeleton: [
      {
        kind: "to",
        target: "$inner",
        vars: { opacity: 0, scale: "$round(1/scale,3)" },
        durationSec: "$durationSec",
        ease: "$ease",
        atSec: "$startSec",
      },
    ],
  },
  {
    id: "emphasis.pop",
    kind: "emphasis",
    summary: PRIMITIVES["emphasis.pop"]!.summary,
    tags: { energy: "punchy", style: "organic" },
    defaults: { duration: "quick", easing: "enter.settle", scale: "pop" },
    skeleton: [
      {
        kind: "to",
        let: { half: "round(durationSec/2,3)" },
        target: "$inner",
        vars: { scale: "$scale" },
        durationSec: "$half",
        ease: "$ease",
        atSec: "$startSec",
      },
      {
        kind: "to",
        let: { half: "round(durationSec/2,3)" },
        target: "$inner",
        vars: { scale: 1 },
        durationSec: "$half",
        ease: "$ease",
        atSec: "$startSec + half",
      },
    ],
  },
];

describe("StepTemplate re-authors the built-in primitive set byte-identically", () => {
  for (const def of REAUTHORED) {
    const original: MotionPrimitive = PRIMITIVES[def.id]!;
    const authored = templatePrimitive(def);
    it(`${def.id}: emits identical GsapSteps across all contexts`, () => {
      expect(original).toBeDefined();
      for (const ctx of CONTEXTS) {
        const a = authored.emit(ctx);
        const b = original.emit(ctx);
        // structural equality…
        expect(a).toEqual(b);
        // …and byte-identical serialization (what flows into the compiled HTML).
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }
    });
  }

  it("preserves the registry-facing metadata of the primitive", () => {
    const fade = templatePrimitive(REAUTHORED[0]!);
    expect(fade.kind).toBe("enter");
    expect(fade.defaults).toEqual({ duration: "base", easing: "enter.glide" });
    expect(templatePrimitive(REAUTHORED[2]!).needsMask).toBe(true);
  });
});

describe("resolveTemplate is a pure function of (skeleton, env)", () => {
  it("is deterministic and never mutates inputs", () => {
    const skeleton: StepTemplate[] = REAUTHORED[1]!.skeleton;
    const env = emitContextEnv(makeCtx());
    const frozen = JSON.stringify(skeleton);
    const a = resolveTemplate(skeleton, env);
    const b = resolveTemplate(skeleton, env);
    expect(a).toEqual(b);
    expect(JSON.stringify(skeleton)).toBe(frozen);
  });
});
