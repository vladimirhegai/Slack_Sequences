import { describe, expect, it } from "vitest";
import {
  auditCutCoherence,
  canonicalCutStyle,
  cutMotionWindows,
  isEnergeticCutIntent,
  normalizeStoryboardCutIntent,
  parseCutPlan,
  resolveCutPlan,
  shapeHintsRhyme,
  swipeAxisTowards,
  validateCutContract,
  type CutPlanV1,
} from "../src/engine/cutContract.ts";
import type { CutStyle } from "../src/engine/cutContract.ts";
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
  it("canonicalizes legacy directional names into swipe + axis and clamps parameters", () => {
    expect(normalizeStoryboardCutIntent({
      style: "cut-right",
      travelPx: 9999,
      exitSec: 0.01,
      entrySec: 5,
    })).toEqual({
      version: 1,
      style: "swipe",
      axis: "right",
      travelPx: 420,
      exitSec: 0.12,
      entrySec: 0.9,
    });
  });

  it("accepts the canonical swipe with axis and optional cover", () => {
    expect(normalizeStoryboardCutIntent({ style: "swipe", axis: "up", cover: true }))
      .toEqual({ version: 1, style: "swipe", axis: "up", cover: true });
    // Missing/unknown axis degrades to right-travel, never fails the plan.
    expect(normalizeStoryboardCutIntent({ style: "swipe", axis: "sideways" }))
      .toEqual({ version: 1, style: "swipe", axis: "right" });
    // cover is only ever the literal true.
    expect(normalizeStoryboardCutIntent({ style: "swipe", axis: "left", cover: "yes" }))
      .toEqual({ version: 1, style: "swipe", axis: "left" });
  });

  it("degrades unusable declarations to no cut instead of failing", () => {
    expect(normalizeStoryboardCutIntent({ style: "spin-o-rama" })).toBeUndefined();
    expect(normalizeStoryboardCutIntent({ style: "morph" })).toBeUndefined();
    expect(normalizeStoryboardCutIntent({ style: "morph", focalPartOut: "a" })).toBeUndefined();
    expect(normalizeStoryboardCutIntent(null)).toBeUndefined();
    expect(normalizeStoryboardCutIntent("cut-left")).toBeUndefined();
  });

  it("keeps a match with incomplete parts as the hard-form promise", () => {
    // object-match canonicalizes to match; with one/zero parts it is a hard
    // cut whose eye-trace budget QA tightens, not a dropped declaration.
    expect(normalizeStoryboardCutIntent({ style: "object-match" }))
      .toEqual({ version: 1, style: "match" });
    expect(normalizeStoryboardCutIntent({ style: "match", focalPartIn: "hero-panel" }))
      .toEqual({ version: 1, style: "match", focalPartIn: "hero-panel" });
    expect(normalizeStoryboardCutIntent({
      style: "match",
      focalPartOut: "chip",
      focalPartIn: "panel",
    })).toEqual({ version: 1, style: "match", focalPartOut: "chip", focalPartIn: "panel" });
  });

  it("keeps hard as an explicit editorial decision with no parameters", () => {
    expect(normalizeStoryboardCutIntent({ style: "hard", travelPx: 100 }))
      .toEqual({ version: 1, style: "hard" });
  });

  it("canonicalizes shape-match to morph with silhouette hints and requires both parts", () => {
    expect(normalizeStoryboardCutIntent({
      style: "shape-match",
      focalPartOut: "inbox-window",
      focalPartIn: "draft-card",
      shapeOut: "window",
      shapeIn: "card",
    })).toEqual({
      version: 1,
      style: "morph",
      focalPartOut: "inbox-window",
      focalPartIn: "draft-card",
      shapeOut: "window",
      shapeIn: "card",
    });
    // Hints are optional and unknown hints are dropped, never fatal.
    expect(normalizeStoryboardCutIntent({
      style: "morph",
      focalPartOut: "a",
      focalPartIn: "b",
      shapeOut: "rhombus",
    })).toEqual({ version: 1, style: "morph", focalPartOut: "a", focalPartIn: "b" });
    expect(normalizeStoryboardCutIntent({ style: "shape-match", focalPartOut: "a" }))
      .toBeUndefined();
  });
});

describe("resolveCutPlan", () => {
  it("resolves per-scene declarations into concrete canonical boundaries", () => {
    const plan = resolveCutPlan(scenes);
    expect(plan.cuts.map((cut) => [cut.fromScene, cut.toScene, cut.style, cut.atSec])).toEqual([
      ["one", "two", "swipe", 4],
      ["two", "three", "match", 9],
    ]);
    expect(plan.cuts[0]).toMatchObject({ axis: "left", travelPx: 230, exitSec: 0.3, entrySec: 0.42 });
    expect(plan.cuts[1]).toMatchObject({
      focalPartOut: "chip",
      focalPartIn: "panel",
      exitSec: 0.4,
    });
  });

  it("carries the swipe cover flag into the resolved plan", () => {
    const plan = resolveCutPlan([
      scene({
        id: "a",
        startSec: 0,
        durationSec: 3,
        cut: { version: 1, style: "swipe", axis: "down", cover: true },
      }),
      scene({ id: "b", startSec: 3, durationSec: 3 }),
    ]);
    expect(plan.cuts[0]).toMatchObject({ style: "swipe", axis: "down", cover: true });
  });

  it("resolves a hard-form match (incomplete parts) to no runtime cut", () => {
    // The seam is a plain hard cut; the promise lives in QA's tightened
    // eye-trace budget, not in boundary motion.
    const plan = resolveCutPlan([
      scene({
        id: "a",
        startSec: 0,
        durationSec: 3,
        cut: { version: 1, style: "match", focalPartIn: "hero-panel" },
      }),
      scene({ id: "b", startSec: 3, durationSec: 3 }),
    ]);
    expect(plan.cuts).toEqual([]);
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

  it("clamps the bridged outgoing lead on a short scene", () => {
    const plan = resolveCutPlan([
      scene({
        id: "short",
        startSec: 0,
        durationSec: 0.5,
        cut: {
          version: 1,
          style: "morph",
          focalPartOut: "chip",
          focalPartIn: "panel",
        },
      }),
      scene({ id: "next", startSec: 0.5, durationSec: 1 }),
    ]);
    expect(plan.cuts[0]!.exitSec).toBeCloseTo(0.2);
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

  it("carries morph fields through resolve and parse round-trips", () => {
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
      style: "morph",
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

describe("canonicalCutStyle", () => {
  it("maps every legacy name onto the 3-transition language", () => {
    expect(canonicalCutStyle("cut-left")).toEqual({ style: "swipe", axis: "left" });
    expect(canonicalCutStyle("cut-down")).toEqual({ style: "swipe", axis: "down" });
    expect(canonicalCutStyle("shape-match")).toEqual({ style: "morph" });
    expect(canonicalCutStyle("object-match")).toEqual({ style: "match" });
    expect(canonicalCutStyle("swipe")).toEqual({ style: "swipe", axis: "right" });
    expect(canonicalCutStyle("swipe", "up")).toEqual({ style: "swipe", axis: "up" });
    // Zoom/flash registers stay executable but undocumented.
    expect(canonicalCutStyle("zoom-through")).toEqual({ style: "zoom-through" });
    expect(canonicalCutStyle("hard")).toEqual({ style: "hard" });
  });
});

describe("swipeAxisTowards", () => {
  it("carries the eye toward the incoming focal center", () => {
    // Target to the RIGHT → incoming enters from the right → leftward travel.
    expect(swipeAxisTowards({ x: 200, y: 500 }, { x: 1600, y: 520 })).toBe("left");
    expect(swipeAxisTowards({ x: 1600, y: 500 }, { x: 200, y: 520 })).toBe("right");
    // Target BELOW (screen y grows downward) → enters from the bottom → up.
    expect(swipeAxisTowards({ x: 900, y: 200 }, { x: 940, y: 900 })).toBe("up");
    expect(swipeAxisTowards({ x: 900, y: 900 }, { x: 940, y: 200 })).toBe("down");
    expect(swipeAxisTowards(undefined, { x: 1, y: 1 })).toBe("right");
  });
});

describe("isEnergeticCutIntent", () => {
  it("counts bridges, cover swipes, and legacy zoom/flash registers", () => {
    expect(isEnergeticCutIntent({
      version: 1, style: "morph", focalPartOut: "a", focalPartIn: "b",
    })).toBe(true);
    expect(isEnergeticCutIntent({
      version: 1, style: "match", focalPartOut: "a", focalPartIn: "b",
    })).toBe(true);
    expect(isEnergeticCutIntent({ version: 1, style: "swipe", axis: "left", cover: true }))
      .toBe(true);
    expect(isEnergeticCutIntent({ version: 1, style: "zoom-through" })).toBe(true);
    // Quiet seams: plain swipe, hard-form match, hard.
    expect(isEnergeticCutIntent({ version: 1, style: "swipe", axis: "left" })).toBe(false);
    expect(isEnergeticCutIntent({ version: 1, style: "match", focalPartIn: "b" })).toBe(false);
    expect(isEnergeticCutIntent({ version: 1, style: "hard" })).toBe(false);
    expect(isEnergeticCutIntent(undefined)).toBe(false);
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

describe("auditCutCoherence", () => {
  const cutScene = (id: string, at: number, style: CutStyle): DirectScene =>
    scene({ id, startSec: at, durationSec: 3, cut: { version: 1, style } });

  it("accepts the golden film's four premium cuts across four boundaries", () => {
    expect(auditCutCoherence([
      cutScene("a", 0, "cut-left"),
      cutScene("b", 3, "flash-white"),
      cutScene("c", 6, "object-match"),
      cutScene("d", 9, "inverse-zoom"),
      scene({ id: "e", startSec: 12, durationSec: 3 }),
    ])).toEqual([]);
  });

  it("flags five distinct non-hard styles across five boundaries as a zoo", () => {
    const findings = auditCutCoherence([
      cutScene("a", 0, "cut-left"),
      cutScene("b", 3, "zoom-through"),
      cutScene("c", 6, "flash-white"),
      cutScene("d", 9, "object-match"),
      cutScene("e", 12, "inverse-zoom"),
      scene({ id: "f", startSec: 15, durationSec: 3 }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/cuts\/coherence/);
    expect(findings[0]).toContain("5 distinct");
  });

  it("counts the whole swipe family (all axes, legacy directional names) as ONE language", () => {
    expect(auditCutCoherence([
      cutScene("a", 0, "cut-left"),
      cutScene("b", 3, "cut-up"),
      { ...cutScene("c", 6, "swipe"), cut: { version: 1, style: "swipe", axis: "down" } },
      cutScene("d", 9, "flash-white"),
      cutScene("e", 12, "object-match"),
      cutScene("f", 15, "inverse-zoom"),
      scene({ id: "g", startSec: 18, durationSec: 3 }),
    ])).toEqual([]);
  });

  it("accepts a consistent language (signatures repeated) and never counts hard cuts", () => {
    expect(auditCutCoherence([
      cutScene("a", 0, "cut-left"),
      cutScene("b", 3, "zoom-through"),
      cutScene("c", 6, "cut-left"),
      cutScene("d", 9, "hard"),
      cutScene("e", 12, "zoom-through"),
      cutScene("f", 15, "cut-left"),
      scene({ id: "g", startSec: 18, durationSec: 3 }),
    ])).toEqual([]);
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
