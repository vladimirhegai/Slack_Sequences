import { describe, expect, it } from "vitest";
import {
  cutMotionWindows,
  normalizeStoryboardCutIntent,
  parseCutPlan,
  resolveCutPlan,
  validateCutContract,
  type CutPlanV1,
} from "../src/engine/cutContract.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { quietWindowsFromCurve } from "../src/engine/temporalInspector.ts";

function scene(overrides: Partial<DirectScene> & Pick<DirectScene, "id" | "startSec" | "durationSec">): DirectScene {
  return {
    title: overrides.id,
    purpose: "test",
    ...overrides,
  };
}

const scenes: DirectScene[] = [
  scene({ id: "one", startSec: 0, durationSec: 4, cut: { version: 1, style: "cut-left" } }),
  scene({
    id: "two",
    startSec: 4,
    durationSec: 5,
    cut: { version: 1, style: "object-match", focalPartOut: "chip", focalPartIn: "panel" },
  }),
  scene({ id: "three", startSec: 9, durationSec: 3, cut: { version: 1, style: "flash-white" } }),
];

describe("normalizeStoryboardCutIntent", () => {
  it("keeps known styles and clamps parameters", () => {
    expect(normalizeStoryboardCutIntent({
      style: "cut-right",
      travelPx: 9999,
      exitSec: 0.01,
      entrySec: 5,
    })).toEqual({ version: 1, style: "cut-right", travelPx: 420, exitSec: 0.12, entrySec: 0.9 });
  });

  it("degrades unusable declarations to no cut instead of failing", () => {
    expect(normalizeStoryboardCutIntent({ style: "spin-o-rama" })).toBeUndefined();
    expect(normalizeStoryboardCutIntent({ style: "object-match" })).toBeUndefined();
    expect(normalizeStoryboardCutIntent({ style: "object-match", focalPartOut: "a" })).toBeUndefined();
    expect(normalizeStoryboardCutIntent(null)).toBeUndefined();
    expect(normalizeStoryboardCutIntent("cut-left")).toBeUndefined();
  });

  it("keeps hard as an explicit editorial decision with no parameters", () => {
    expect(normalizeStoryboardCutIntent({ style: "hard", travelPx: 100 }))
      .toEqual({ version: 1, style: "hard" });
  });
});

describe("resolveCutPlan", () => {
  it("resolves per-scene declarations into concrete boundaries", () => {
    const plan = resolveCutPlan(scenes);
    expect(plan.cuts.map((cut) => [cut.fromScene, cut.toScene, cut.style, cut.atSec])).toEqual([
      ["one", "two", "cut-left", 4],
      ["two", "three", "object-match", 9],
    ]);
    expect(plan.cuts[0]).toMatchObject({ travelPx: 230, exitSec: 0.3, entrySec: 0.42 });
    expect(plan.cuts[1]).toMatchObject({ focalPartOut: "chip", focalPartIn: "panel" });
  });

  it("ignores the final scene's declaration and hard cuts", () => {
    const plan = resolveCutPlan([
      scene({ id: "a", startSec: 0, durationSec: 3, cut: { version: 1, style: "hard" } }),
      scene({ id: "b", startSec: 3, durationSec: 3, cut: { version: 1, style: "zoom-through" } }),
    ]);
    expect(plan.cuts).toEqual([]);
  });

  it("clamps exit and entry windows to the scenes they animate", () => {
    const plan = resolveCutPlan([
      scene({
        id: "short",
        startSec: 0,
        durationSec: 0.5,
        cut: { version: 1, style: "cut-up", exitSec: 0.6, entrySec: 0.9 },
      }),
      scene({ id: "next", startSec: 0.5, durationSec: 0.6 }),
    ]);
    expect(plan.cuts[0]!.exitSec).toBeCloseTo(0.2);
    expect(plan.cuts[0]!.entrySec).toBeCloseTo(0.3);
  });
});

function htmlFor(plan: CutPlanV1, extras = ""): string {
  return `<!doctype html><html><head>
<script src="gsap.min.js"></script>
<script src="sequences-cuts.v1.js"></script>
</head><body>
<div data-composition-id="test" data-duration="12">
<section data-scene="one" id="one"><span data-part="chip">chip</span></section>
<section data-scene="two" id="two"><span data-part="chip">chip</span><span data-part="panel">panel</span></section>
<section data-scene="three" id="three"></section>
</div>
<script type="application/json" id="sequences-cuts">${JSON.stringify(plan)}</script>
<script>const tl = gsap.timeline({ paused: true });${extras}
SequencesCuts.compile(tl, document.querySelector("[data-composition-id]"));
window.__timelines["test"] = tl;</script>
</body></html>`;
}

describe("validateCutContract", () => {
  it("accepts a bound plan that matches the storyboard exactly", () => {
    const result = validateCutContract(htmlFor(resolveCutPlan(scenes)), scenes);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("requires the island, runtime, and compile call when cuts are declared", () => {
    const bare = `<!doctype html><html><body>
<section data-scene="one"></section><section data-scene="two"></section>
</body></html>`;
    const result = validateCutContract(bare, scenes);
    expect(result.errors).toContain(
      "storyboard declares typed cuts but index_html has no sequences-cuts JSON island",
    );
  });

  it("rejects an island that drifted from the storyboard's resolved plan", () => {
    const drifted = resolveCutPlan(scenes);
    drifted.cuts[0]!.atSec = 99;
    const result = validateCutContract(htmlFor(drifted), scenes);
    expect(result.errors).toContain(
      "sequences-cuts island differs from the storyboard's resolved cut plan",
    );
  });

  it("requires object-match focal parts to exist in the source", () => {
    const plan = resolveCutPlan(scenes);
    const html = htmlFor(plan).replace(/<span data-part="panel">panel<\/span>/, "");
    const result = validateCutContract(html, scenes);
    expect(result.errors.some((error) => error.includes('"panel" is absent'))).toBe(true);
  });

  it("warns when an authored tween competes with the runtime for a wrapper", () => {
    const html = htmlFor(resolveCutPlan(scenes), `tl.to("#one", { x: 40 }, 3.8);`);
    const result = validateCutContract(html, scenes);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes('"#one"'))).toBe(true);
  });

  it("is silent when no typed cuts exist", () => {
    const plain: DirectScene[] = [
      scene({ id: "a", startSec: 0, durationSec: 3 }),
      scene({ id: "b", startSec: 3, durationSec: 3 }),
    ];
    expect(validateCutContract("<!doctype html><html></html>", plain))
      .toEqual({ errors: [], warnings: [] });
  });
});

describe("parseCutPlan", () => {
  it("reports malformed islands instead of guessing", () => {
    expect(parseCutPlan(
      '<script type="application/json" id="sequences-cuts">{nope</script>',
    ).errors[0]).toMatch(/invalid/);
    expect(parseCutPlan(
      '<script type="application/json" id="sequences-cuts">{"version":2,"cuts":[]}</script>',
    ).errors).toContain("sequences-cuts.version must be 1");
  });
});

describe("cutMotionWindows", () => {
  it("covers exit and entry spans with a small tolerance", () => {
    const windows = cutMotionWindows(resolveCutPlan(scenes));
    expect(windows[0]!.start).toBeCloseTo(4 - 0.3 - 0.05);
    expect(windows[0]!.end).toBeCloseTo(4 + 0.42 + 0.05);
    expect(cutMotionWindows(undefined)).toEqual([]);
  });
});

describe("quietWindowsFromCurve", () => {
  it("groups frozen spans and ignores brief dips", () => {
    const curve = [
      { time: 1, delta: 0.01 },
      { time: 2, delta: 0.0001 },
      { time: 3, delta: 0.0001 },
      { time: 4, delta: 0.01 },
      { time: 5, delta: 0.0001 },
      { time: 6, delta: 0.01 },
    ];
    expect(quietWindowsFromCurve(curve, 0.0002, 1.5)).toEqual([{ start: 1, end: 3 }]);
  });
});
