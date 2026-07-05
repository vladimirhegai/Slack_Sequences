import { describe, expect, it } from "vitest";
import {
  cutMotionWindows,
  normalizeStoryboardCutIntent,
  parseCutPlan,
  resolveCutPlan,
  shapeHintsRhyme,
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

  it("normalizes shape-match with silhouette hints and requires both parts", () => {
    expect(normalizeStoryboardCutIntent({
      style: "shape-match",
      focalPartOut: "inbox-window",
      focalPartIn: "draft-card",
      shapeOut: "window",
      shapeIn: "card",
    })).toEqual({
      version: 1,
      style: "shape-match",
      focalPartOut: "inbox-window",
      focalPartIn: "draft-card",
      shapeOut: "window",
      shapeIn: "card",
    });
    // Hints are optional and unknown hints are dropped, never fatal.
    expect(normalizeStoryboardCutIntent({
      style: "shape-match",
      focalPartOut: "a",
      focalPartIn: "b",
      shapeOut: "rhombus",
    })).toEqual({ version: 1, style: "shape-match", focalPartOut: "a", focalPartIn: "b" });
    expect(normalizeStoryboardCutIntent({ style: "shape-match", focalPartOut: "a" }))
      .toBeUndefined();
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
<section data-scene="two" id="two"><span data-part="chip">chip</span></section>
<section data-scene="three" id="three"><span data-part="panel">panel</span></section>
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
    expect(result.errors.some((error) =>
      error.includes('incoming part "panel" must exist as a data-part inside scene "three"')
    )).toBe(true);
  });

  it("rejects a focal part that exists only in the WRONG scene", () => {
    // The runtime binds scene-scoped; a whole-document check would pass this
    // and detonate in browser QA (the 2026-07-03 morph-proof failure).
    const plan = resolveCutPlan(scenes);
    const html = htmlFor(plan).replace(
      /<section data-scene="two" id="two"><span data-part="chip">chip<\/span><\/section>\n<section data-scene="three" id="three"><span data-part="panel">panel<\/span><\/section>/,
      '<section data-scene="two" id="two"><span data-part="chip">chip</span>' +
        '<span data-part="panel">panel</span></section>\n' +
        '<section data-scene="three" id="three"></section>',
    );
    const result = validateCutContract(html, scenes);
    expect(result.errors.some((error) =>
      error.includes('incoming part "panel" must exist as a data-part inside scene "three"')
    )).toBe(true);
  });

  it("carries shape-match fields through resolve and parse round-trips", () => {
    const shaped: DirectScene[] = [
      scene({
        id: "one",
        startSec: 0,
        durationSec: 4,
        cut: {
          version: 1,
          style: "shape-match",
          focalPartOut: "chip",
          focalPartIn: "panel",
          shapeOut: "pill",
          shapeIn: "bar",
        },
      }),
      scene({ id: "two", startSec: 4, durationSec: 4 }),
    ];
    const plan = resolveCutPlan(shaped);
    expect(plan.cuts[0]).toMatchObject({
      style: "shape-match",
      focalPartOut: "chip",
      focalPartIn: "panel",
      shapeOut: "pill",
      shapeIn: "bar",
    });
    const parsed = parseCutPlan(
      `<script type="application/json" id="sequences-cuts">${JSON.stringify(plan)}</script>`,
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.plan).toEqual(plan);
    expect(parseCutPlan(
      '<script type="application/json" id="sequences-cuts">' +
        JSON.stringify({
          version: 1,
          cuts: [{
            version: 1,
            style: "shape-match",
            fromScene: "one",
            toScene: "two",
            atSec: 4,
            travelPx: 230,
            exitSec: 0.22,
            entrySec: 0.5,
          }],
        }) +
        "</script>",
    ).errors).toContain("cut[0] shape-match needs focalPartOut and focalPartIn");
  });

  it("warns when a bridged cut lands on a part outside the incoming entry framing", () => {
    const shaped: DirectScene[] = [
      scene({
        id: "one",
        startSec: 0,
        durationSec: 4,
        cut: {
          version: 1,
          style: "shape-match",
          focalPartOut: "chip",
          focalPartIn: "panel",
        },
      }),
      scene({
        id: "two",
        startSec: 4,
        durationSec: 5,
        components: [{ version: 1, id: "panel", kind: "stat-card", region: "metric-wall" }],
        camera: {
          version: 1,
          path: [
            { version: 1, move: "hold", toRegion: "hero-claim", startSec: 4, durationSec: 1 },
          ],
        },
      }),
    ];
    const plan = resolveCutPlan(shaped);
    const html = `<!doctype html><html><head>
<script src="gsap.min.js"></script>
<script src="sequences-cuts.v1.js"></script>
</head><body>
<section data-scene="one" id="one"><span data-part="chip">chip</span></section>
<section data-scene="two" id="two"><div data-camera-world>
<div data-region="hero-claim"></div>
<div data-region="metric-wall"><span data-part="panel">panel</span></div>
</div></section>
<script type="application/json" id="sequences-cuts">${JSON.stringify(plan)}</script>
<script>const tl = gsap.timeline({ paused: true });
SequencesCuts.compile(tl, document.querySelector("[data-scene]").parentElement);
</script>
</body></html>`;
    const result = validateCutContract(html, shaped);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) =>
      warning.includes('opens framed on "hero-claim"')
    )).toBe(true);
    // Framing the bridge's landing station clears the warning.
    const framed = shaped.map((entry) =>
      entry.id === "two"
        ? {
            ...entry,
            camera: {
              version: 1 as const,
              path: [{
                version: 1 as const,
                move: "hold" as const,
                toRegion: "metric-wall",
                startSec: 4,
                durationSec: 1,
              }],
            },
          }
        : entry
    );
    const framedResult = validateCutContract(html, framed);
    expect(framedResult.warnings.filter((warning) => warning.includes("opens framed"))).toEqual([]);
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

describe("shapeHintsRhyme", () => {
  it("rhymes within a silhouette family and rejects cross-family pairs", () => {
    // Strips rhyme with strips…
    expect(shapeHintsRhyme("pill", "bar")).toBe(true);
    expect(shapeHintsRhyme("pill", "pill")).toBe(true);
    // …blocks with blocks…
    expect(shapeHintsRhyme("window", "card")).toBe(true);
    expect(shapeHintsRhyme("circle", "card")).toBe(true);
    expect(shapeHintsRhyme("circle", "window")).toBe(true);
    // …and cross-family pairs are the known-hopeless class.
    expect(shapeHintsRhyme("pill", "card")).toBe(false);
    expect(shapeHintsRhyme("circle", "bar")).toBe(false);
    expect(shapeHintsRhyme("bar", "window")).toBe(false);
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
