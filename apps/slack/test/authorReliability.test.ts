import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyDeterministicSourceRepairs,
  auditShapeMatchHints,
  buildSceneSkeletons,
  dedupeFeedbackBySignature,
  degradeMismatchedShapeHintCuts,
  degradeVolunteeredBridgedCuts,
  ensureHostCompileOrdering,
  ensureRuntimeScriptOrdering,
  findingSignature,
  HOST_PLAN_ISLAND_IDS,
  injectMissingLivenessBeats,
  mergeEmbeddedDevelopmentScenes,
  reconcileCameraWorldPlanes,
  reconcileComponentBindings,
  reconcileComponentInternalPartAliases,
  reconcileContractBindings,
  rehomeRegionComponents,
  repairMalformedFromToCalls,
  quoteBareCssVarsInInlineScripts,
  stripInvalidSvgPathPlaceholders,
  repairStrategyAfterStaticRejection,
  rewriteDegradedCutStoryboard,
  stripAllHostPlanIslands,
  stripHostKitAssetReferences,
  stripUnusedHostPlanIslands,
  topUpChartMarkup,
  topUpProgressMarkup,
  topUpRowsMarkup,
  volunteeredCutBoundaries,
} from "../src/engine/compositionRunner.ts";
import {
  normalizeInteractionActors,
  scopeRingValueGeometryStyles,
} from "../src/engine/runner/repairs/implementation.ts";
import { degradeCrossKindComponentMorphCuts } from "../src/engine/runner/storyboardAudit.ts";
import { hasPausedTimeline } from "../src/engine/directComposition.ts";
import { auditKitMarkupCompleteness } from "../src/engine/kitMarkupAudit.ts";
import { validateCameraContract } from "../src/engine/cameraContract.ts";
import { validateComponentContract } from "../src/engine/componentContract.ts";
import { resolveCutPlan, validateCutContract } from "../src/engine/cutContract.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { validateInteractionContract } from "../src/engine/interactionContract.ts";
import { analyzeMotionDensity } from "../src/engine/motionDensity.ts";

const roots: string[] = [];

describe("embedded development scene repair", () => {
  const component = (id: string, kind: string) => ({ version: 1, id, kind });
  const parent = () => ({
    id: "metric-payoff",
    startSec: 18.5,
    durationSec: 8,
    components: [component("metric-number", "stat-card"), component("ring", "progress-ring")],
    beats: [{ version: 1, id: "count", component: "metric-number", kind: "count", atSec: 19.5 }],
    moments: [{ id: "count-start", atSec: 19.5 }],
    spatialIntent: { focalPart: "metric-number" },
  });
  const continuation = (overrides: Record<string, unknown> = {}) => ({
    id: "metric-develop",
    startSec: 22.4,
    durationSec: 3.5,
    components: [component("metric-number", "stat-card"), component("ring", "progress-ring")],
    beats: [
      { version: 1, id: "label-swap", component: "metric-number", kind: "swap", atSec: 23 },
      { version: 1, id: "ring-pulse", component: "ring", kind: "highlight", atSec: 24.5 },
    ],
    moments: [
      { id: "label-develop", atSec: 23 },
      { id: "ring-develop", atSec: 24.5 },
    ],
    camera: { path: [{ move: "drift", startSec: 22.4, durationSec: 1.5 }] },
    interactions: [],
    plugins: [],
    recipes: [],
    spatialIntent: { focalPart: "metric-number" },
    ...overrides,
  });

  it("folds an embedded duplicate-surface beat patch into its containing scene", () => {
    const cta = { id: "cta", startSec: 26.5, durationSec: 6 };
    const result = mergeEmbeddedDevelopmentScenes([parent(), continuation(), cta]);
    expect(result.storyboard).toHaveLength(2);
    expect(result.normalized[0]).toContain('"metric-develop" into "metric-payoff"');
    const merged = result.storyboard[0] as Record<string, unknown>;
    expect((merged.beats as Array<{ id: string }>).map((beat) => beat.id))
      .toEqual(["count", "label-swap", "ring-pulse"]);
    expect((merged.moments as Array<{ id: string }>).map((moment) => moment.id))
      .toEqual(["count-start", "label-develop", "ring-develop"]);
    expect(merged.sentinelNormalizations).toEqual([expect.stringContaining("2 beat(s)")]);
  });

  it("does not fold creative changes or cues outside the containing window", () => {
    const cases = [
      continuation({ components: [component("new-chart", "chart")] }),
      continuation({ camera: { path: [{ move: "push-in", startSec: 23, durationSec: 1 }] } }),
      continuation({ interactions: [{ id: "click" }] }),
      continuation({ spatialIntent: { focalPart: "other" } }),
      continuation({ moments: [{ id: "late", atSec: 27 }] }),
      continuation({ cut: { style: "morph" } }),
      continuation({ gradeShift: { atSec: 23, toGrade: "warm" } }),
    ];
    for (const child of cases) {
      expect(mergeEmbeddedDevelopmentScenes([parent(), child]).normalized).toEqual([]);
    }
  });

  it("absorbs an adjacent final CTA hold into the scene that already owns that CTA", () => {
    const lockup = {
      id: "lockup-cta",
      title: "Review in Monogram",
      purpose: "reveal the lockup and CTA",
      startSec: 17,
      durationSec: 6,
      components: [
        component("lockup", "headline"),
        component("cta-button", "button"),
      ],
      beats: [{ version: 1, id: "cta-ready", component: "cta-button", kind: "set-state", atSec: 19 }],
      moments: [{ id: "lockup-ready", atSec: 19 }],
      camera: { version: 1, path: [{ move: "whip", toRegion: "cta-station", startSec: 20, durationSec: 1 }] },
      spatialIntent: { focalPart: "lockup" },
      interactions: [],
      plugins: [],
      recipes: [],
    };
    const finalHold = {
      id: "final-cta",
      title: "Final CTA Hold",
      purpose: "Final CTA hold",
      incomingIdea: "Invite the viewer",
      foreground: "Review in Monogram",
      startSec: 23,
      durationSec: 3,
      components: [],
      beats: [],
      moments: [{ id: "final-hold", atSec: 23, title: "Final CTA hold", change: "CTA holds steady", motionIntent: "resolve" }],
      camera: { version: 1, path: [{ move: "hold", startSec: 23, durationSec: 2 }] },
      spatialIntent: { focalPart: "cta-button" },
      cut: { style: "hard" },
      interactions: [],
      plugins: [],
      recipes: [],
      outgoingCut: "Hard to black",
    };
    const result = mergeEmbeddedDevelopmentScenes([lockup, finalHold]);
    expect(result.storyboard).toHaveLength(1);
    expect(result.normalized[0]).toContain("without a duplicate cut");
    const merged = result.storyboard[0] as Record<string, unknown>;
    expect(merged.durationSec).toBe(9);
    expect((merged.moments as Array<{ id: string }>).map((moment) => moment.id))
      .toEqual(["lockup-ready", "final-hold"]);
    expect((merged.moments as Array<Record<string, unknown>>).at(-1)).toMatchObject({
      sceneId: "lockup-cta",
      importance: "supporting",
      motionIntent: "camera-arrival",
      title: "Operated CTA hold begins",
    });
    expect(
      ((merged.camera as { path: Array<Record<string, unknown>> }).path).at(-1),
    ).toMatchObject({ move: "hold", toPart: "cta-button", startSec: 23 });
    expect(merged.outgoingCut).toBe("Hard to black");
  });

  it("keeps an adjacent CTA scene when it introduces a real state change", () => {
    const base = {
      id: "lockup",
      startSec: 0,
      durationSec: 4,
      components: [component("cta-button", "button")],
      camera: { path: [{ move: "hold", startSec: 0, durationSec: 4 }] },
      spatialIntent: { focalPart: "cta-button" },
    };
    const changed = {
      id: "final-cta",
      title: "Final CTA",
      purpose: "CTA hold",
      startSec: 4,
      durationSec: 3,
      components: [],
      beats: [{ id: "new-state", component: "cta-button", kind: "set-state", atSec: 4.2 }],
      moments: [{ id: "ready", atSec: 4.2, title: "CTA ready", change: "new state", motionIntent: "resolve" }],
      camera: { path: [{ move: "hold", startSec: 4, durationSec: 2 }] },
      spatialIntent: { focalPart: "cta-button" },
      interactions: [],
      plugins: [],
      recipes: [],
    };
    expect(mergeEmbeddedDevelopmentScenes([base, changed]).normalized).toEqual([]);
  });
});

afterEach(() => {
  while (roots.length) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-author-reliability-"));
  roots.push(dir);
  return dir;
}

function scene(id: string, startSec: number, overrides: Partial<DirectScene> = {}): DirectScene {
  return {
    id,
    title: id,
    purpose: `show ${id}`,
    startSec,
    durationSec: 4,
    ...overrides,
  };
}

describe("held-result source repair parity", () => {
  it("upgrades a persisted pre-normalizer plan before injecting host contracts", () => {
    const storyboard: DirectScene[] = [scene("approval", 10, {
      durationSec: 6,
      camera: {
        version: 1,
        path: [
          { version: 1, move: "push-in", startSec: 10, durationSec: 1, toRegion: "approval" },
          { version: 1, move: "drift", startSec: 11, durationSec: 5 },
        ],
      },
      components: [{ version: 1, id: "confirm", kind: "button", region: "approval" }],
      beats: [{
        version: 1,
        id: "confirm-ready",
        sceneId: "approval",
        component: "confirm",
        kind: "set-state",
        atSec: 12,
        toState: "succeed",
      }],
      interactions: [{
        version: 1,
        id: "confirm-click",
        sceneId: "approval",
        cursorId: "cursor-1",
        targetPart: "confirm",
        action: "click",
        startSec: 11,
        arriveSec: 11.5,
        pressSec: 11.7,
        releaseSec: 11.9,
        from: "frame:bottom-right",
        path: "arc",
        aimX: 0.5,
        aimY: 0.5,
        feedback: "press-ripple",
      }],
      moments: [
        {
          version: 1,
          id: "result-ready",
          sceneId: "approval",
          atSec: 12,
          title: "Result ready",
          visualState: "Confirmation succeeds",
          change: "The button reaches its ready state",
          motionIntent: "resolve",
          importance: "primary",
        },
        {
          version: 1,
          id: "ready-holds",
          sceneId: "approval",
          atSec: 15.5,
          title: "Ready holds",
          visualState: "Confirmation remains ready",
          change: "The successful result settles",
          motionIntent: "resolve",
          importance: "supporting",
        },
      ],
    })];
    const html = `<!doctype html><html><body><main data-composition-id="held" ` +
      `data-width="1920" data-height="1080" data-duration="16">` +
      `<section id="approval" data-scene="approval" data-start="10" data-duration="6">` +
      `<div data-camera-world><div data-region="approval">` +
      `<button data-part="confirm" data-component="button">Approve</button>` +
      `</div></div></section></main><script>` +
      `const tl=gsap.timeline({paused:true});window.__timelines.held=tl;</script></body></html>`;

    const repaired = applyDeterministicSourceRepairs(
      { html, storyboard },
      tempDir(),
      storyboard,
    );
    expect(repaired.storyboard[0]?.beats).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "approval-held-result-highlight",
        component: "confirm",
        kind: "highlight",
        atSec: 14.4,
      }),
    ]));
  });
});

/** The 2026-07-04 live-fallback shape: shape-match + camera stations. */
function incidentStoryboard(): DirectScene[] {
  return [
    scene("search-typing", 0, {
      cut: {
        version: 1,
        style: "shape-match",
        focalPartOut: "palette-input",
        focalPartIn: "palette-input",
      },
    }),
    scene("trace-resolve", 4, {
      camera: {
        version: 1,
        path: [
          {
            version: 1,
            move: "push-in",
            toRegion: "trace-card",
            startSec: 4.5,
            durationSec: 1.4,
          },
        ],
      },
    }),
    scene("risk-score", 8),
  ];
}

describe("findingSignature", () => {
  it("collapses the cut contract's and the kit audit's endpoint findings to one signature", () => {
    const staticFinding =
      'cut search-typing->trace-resolve incoming part "palette-input" must exist as a ' +
      'data-part inside scene "trace-resolve"';
    const kitFinding =
      "kit_markup_incomplete: cut search-typing->trace-resolve (shape-match) needs " +
      'data-part="palette-input" in scene "trace-resolve" but the parsed DOM has none — ' +
      "the cut bind would abort the compile";
    expect(findingSignature(staticFinding)).toBe(
      "cut_missing_incoming_part:search-typing->trace-resolve:palette-input",
    );
    expect(findingSignature(kitFinding)).toBe(findingSignature(staticFinding));
  });

  it("distinguishes the outgoing side by the named scene", () => {
    const kitFinding =
      "kit_markup_incomplete: cut search-typing->trace-resolve (shape-match) needs " +
      'data-part="palette-input" in scene "search-typing" but the parsed DOM has none — ' +
      "the cut bind would abort the compile";
    expect(findingSignature(kitFinding)).toBe(
      "cut_missing_outgoing_part:search-typing->trace-resolve:palette-input",
    );
  });

  it("collapses both camera-region finding wordings to one signature", () => {
    const staticFinding =
      'scene "risk-score" camera targets region "risk-ring" but no data-region="risk-ring" ' +
      "exists in that scene";
    const kitFinding =
      'kit_markup_incomplete: camera path in scene "risk-score" frames data-region="risk-ring" ' +
      "but the parsed DOM has no such element in that scene — the camera bind would abort the compile";
    expect(findingSignature(staticFinding)).toBe("camera_region_missing:risk-score:risk-ring");
    expect(findingSignature(kitFinding)).toBe(findingSignature(staticFinding));
  });

  it("collapses both encodings of a degraded boundary to one signature", () => {
    const rawWarning =
      "cut_degraded: shape-match palette-invoke->trace-resolve compiled as zoom-through: " +
      "focal silhouettes differ 7.9x in aspect ratio (cap 2.5x)";
    const polishFinding =
      'cut_degraded [data-part="palette-input-pill"] (t=8.50s): The storyboard declares a ' +
      "shape-match cut palette-invoke->trace-resolve, but the runtime degraded it to " +
      "zoom-through at bind time: focal silhouettes differ 7.9x in aspect ratio (cap 2.5x). " +
      'Measured at the boundary: outgoing "palette-input-pill" 720x56px…';
    expect(findingSignature(rawWarning)).toBe(
      "cut_degraded:palette-invoke->trace-resolve",
    );
    expect(findingSignature(polishFinding)).toBe(findingSignature(rawWarning));
  });

  it("names moment and unknown findings stably", () => {
    expect(findingSignature(
      'storyboard/moments: moment "film-settles" (20.00s, "Film settles on CTA") has no ' +
      "executable timeline evidence within 0.45s/0.75s",
    )).toBe("moment_unbound:film-settles");
    expect(findingSignature("something entirely new")).toBe("other:something entirely new");
  });
});

describe("deterministic cut/camera binding reconciliation", () => {
  /** Wrap scene markup with the cut island + runtime so the gate reaches endpoint checks. */
  function withCutPlumbing(storyboard: DirectScene[], scenesHtml: string): string {
    return [
      scenesHtml,
      '<script src="sequences-cuts.v1.js"></script>',
      `<script type="application/json" id="sequences-cuts">${
        JSON.stringify(resolveCutPlan(storyboard))
      }</script>`,
      "<script>SequencesCuts.compile(tl, root);</script>",
    ].join("\n");
  }

  it("annotates a missing incoming shape-match part when one exact-id element exists", () => {
    const storyboard = incidentStoryboard();
    const html = withCutPlumbing(
      storyboard,
      '<section data-scene="search-typing"><div data-part="palette-input"></div></section>' +
      '<section data-scene="trace-resolve"><div id="palette-input" class="cmd"></div>' +
      '<div data-region="trace-card"></div></section>' +
      '<section data-scene="risk-score"></section>',
    );
    const result = reconcileContractBindings(html, storyboard);
    expect(result.repairs).toBe(1);
    expect(result.html).toContain('id="palette-input" class="cmd" data-part="palette-input"');
    const cutErrors = validateCutContract(result.html, storyboard).errors
      .filter((error) => error.includes("incoming part"));
    expect(cutErrors).toEqual([]);
  });

  it("keeps a genuinely absent or ambiguous incoming part blocking", () => {
    const storyboard = incidentStoryboard();
    const html = withCutPlumbing(
      storyboard,
      '<section data-scene="search-typing"><div data-part="palette-input"></div></section>' +
      '<section data-scene="trace-resolve"><div class="a"></div><div class="b"></div>' +
      '<div data-region="trace-card"></div></section>' +
      '<section data-scene="risk-score"></section>',
    );
    const result = reconcileContractBindings(html, storyboard);
    expect(result.repairs).toBe(0);
    expect(result.html).toBe(html);
    expect(
      validateCutContract(html, storyboard).errors.some((error) =>
        error.includes("incoming part")
      ),
    ).toBe(true);
  });

  it("adds a missing data-region station to the one exact-name element", () => {
    const storyboard = incidentStoryboard();
    const html =
      '<section data-scene="search-typing"><div data-part="palette-input"></div></section>' +
      '<section data-scene="trace-resolve"><div id="palette-input" data-part="palette-input"></div>' +
      '<div data-part="trace-card" class="card"></div></section>' +
      '<section data-scene="risk-score"></section>';
    const result = reconcileContractBindings(html, storyboard);
    expect(result.repairs).toBe(1);
    expect(result.html).toContain('data-part="trace-card" class="card" data-region="trace-card"');
  });

  it("leaves an ambiguous station untouched and never borrows across scenes", () => {
    const storyboard = incidentStoryboard();
    const ambiguous =
      '<section data-scene="search-typing"><div data-part="palette-input"></div>' +
      '<div id="trace-card"></div></section>' +
      '<section data-scene="trace-resolve"><div id="palette-input" data-part="palette-input"></div>' +
      '<div data-part="trace-card"></div><div data-part="trace-card"></div></section>' +
      '<section data-scene="risk-score"></section>';
    const result = reconcileContractBindings(ambiguous, storyboard);
    expect(result.repairs).toBe(0);
    expect(result.html).toBe(ambiguous);
  });
});

describe("volunteered bridged-cut degradation", () => {
  const incomingFinding =
    'cut search-typing->trace-resolve incoming part "palette-input" must exist as a ' +
    'data-part inside scene "trace-resolve"';
  const persistent = new Set([findingSignature(incomingFinding)]);

  function draftHtml(): string {
    return [
      '<div data-composition-id="incident" data-width="1920" data-height="1080" data-duration="12">',
      '<section id="search-typing" data-scene="search-typing" data-start="0" data-duration="4">',
      '<div data-part="palette-input"></div></section>',
      '<section id="trace-resolve" data-scene="trace-resolve" data-start="4" data-duration="4">',
      '<div data-camera-world><div data-region="trace-card"></div></div></section>',
      '<section id="risk-score" data-scene="risk-score" data-start="8" data-duration="4"></section>',
      "</div>",
      '<script src="gsap.min.js"></script>',
      "<script>var tl = gsap.timeline({ paused: true });",
      'window.__timelines["incident"] = tl;</script>',
    ].join("\n");
  }

  it("degrades a persistently unbindable volunteered shape-match to a swipe", () => {
    const storyboard = incidentStoryboard();
    const result = degradeVolunteeredBridgedCuts({
      draft: { storyboard, html: draftHtml() },
      errors: [incomingFinding],
      storyboard,
      requirements: {},
      persistentSignatures: persistent,
      projectDir: tempDir(),
    });
    expect(result).toBeDefined();
    expect(result!.degraded).toEqual(["search-typing->trace-resolve (shape-match)"]);
    expect(result!.storyboard[0]!.cut).toEqual({ version: 1, style: "swipe", axis: "right" });
    const island = result!.draft.html.match(
      /<script[^>]*id="sequences-cuts"[^>]*>([\s\S]*?)<\/script>/,
    );
    expect(island).toBeTruthy();
    expect(island![1]).toContain('"swipe"');
    expect(island![1]).not.toContain("shape-match");
    expect(
      validateCutContract(result!.draft.html, result!.storyboard).errors,
    ).toEqual([]);
  });

  it("never degrades a brief-required shape-match", () => {
    const storyboard = incidentStoryboard();
    expect(degradeVolunteeredBridgedCuts({
      draft: { storyboard, html: draftHtml() },
      errors: [incomingFinding],
      storyboard,
      requirements: { requireShapeMatch: true },
      persistentSignatures: persistent,
      projectDir: tempDir(),
    })).toBeUndefined();
  });

  it("waits until the finding has survived a repair (persistence window)", () => {
    const storyboard = incidentStoryboard();
    expect(degradeVolunteeredBridgedCuts({
      draft: { storyboard, html: draftHtml() },
      errors: [incomingFinding],
      storyboard,
      requirements: {},
      persistentSignatures: new Set<string>(),
      projectDir: tempDir(),
    })).toBeUndefined();
  });

  it("exposes volunteered boundaries only for unrequested bridged styles", () => {
    const storyboard = incidentStoryboard();
    expect(volunteeredCutBoundaries(storyboard, {})).toEqual(
      new Set(["search-typing->trace-resolve"]),
    );
    expect(volunteeredCutBoundaries(storyboard, { requireShapeMatch: true })).toEqual(new Set());
  });
});

describe("plan-time silhouette-hint sanity (WS1)", () => {
  function hintedStoryboard(shapeOut: "pill" | "bar" | "card" | "circle" | "window", shapeIn: typeof shapeOut): DirectScene[] {
    return [
      scene("open", 0, {
        cut: {
          version: 1,
          style: "shape-match",
          focalPartOut: "query-pill",
          focalPartIn: "trace-card",
          shapeOut,
          shapeIn,
        },
      }),
      scene("land", 4),
    ];
  }

  it("flags cross-family hint pairs and passes rhyming ones", () => {
    expect(auditShapeMatchHints(hintedStoryboard("pill", "card"))).toHaveLength(1);
    expect(auditShapeMatchHints(hintedStoryboard("pill", "card"))[0]).toContain(
      "morph open->land",
    );
    expect(auditShapeMatchHints(hintedStoryboard("circle", "bar"))).toHaveLength(1);
    expect(auditShapeMatchHints(hintedStoryboard("pill", "bar"))).toEqual([]);
    expect(auditShapeMatchHints(hintedStoryboard("window", "card"))).toEqual([]);
    expect(auditShapeMatchHints(hintedStoryboard("circle", "card"))).toEqual([]);
  });

  it("stays silent when hints are absent (they are an optional self-check)", () => {
    const storyboard = incidentStoryboard();
    expect(auditShapeMatchHints(storyboard)).toEqual([]);
  });

  it("degrades a hopeless pair to a swipe with honest prose", () => {
    const { scenes, degraded } = degradeMismatchedShapeHintCuts(
      hintedStoryboard("pill", "card"),
    );
    expect(degraded).toEqual(["open->land (pill->card)"]);
    expect(scenes[0]!.cut).toEqual({ version: 1, style: "swipe", axis: "right" });
    expect(scenes[0]!.outgoingCut).toContain("degraded at plan time");
    expect(auditShapeMatchHints(scenes)).toEqual([]);
  });

  it("leaves rhyming declarations untouched", () => {
    const storyboard = hintedStoryboard("pill", "bar");
    const { scenes, degraded } = degradeMismatchedShapeHintCuts(storyboard);
    expect(degraded).toEqual([]);
    expect(scenes).toEqual(storyboard);
  });

  it("keeps authored boundary timing when degrading, like the QA-time rewrite", () => {
    const storyboard = hintedStoryboard("pill", "card");
    storyboard[0]!.cut = {
      ...storyboard[0]!.cut!,
      travelPx: 240,
      exitSec: 0.3,
      entrySec: 0.6,
    };
    const { scenes } = degradeMismatchedShapeHintCuts(storyboard);
    expect(scenes[0]!.cut).toEqual({
      version: 1,
      style: "swipe",
      axis: "right",
      travelPx: 240,
      exitSec: 0.3,
      entrySec: 0.6,
    });
  });
});

describe("deterministic rows-markup top-up (fallback-elimination lever 1)", () => {
  const rowsScene = (kind: "table" | "kanban" | "chat" | "list"): DirectScene[] => [
    scene("triage", 0, {
      components: [{ version: 1, id: "sev-board", kind }],
      beats: [{
        version: 1,
        id: "reveal-rows",
        sceneId: "triage",
        component: "sev-board",
        kind: "rows",
        atSec: 1.2,
      }],
    }),
  ];

  it("injects three neutral kit children into a childless rows target", () => {
    const html =
      '<section data-scene="triage"><div data-part="sev-board" data-component="table" ' +
      'class="cmp cmp-table material"><div class="cmp-table-head">Alerts</div></div></section>';
    const result = topUpRowsMarkup(html, rowsScene("table"));
    expect(result.repaired).toEqual(["sev-board"]);
    expect(result.html.match(/class="cmp-row"/g)).toHaveLength(3);
    // Injected before the root's close tag, inside the component.
    expect(result.html.indexOf('class="cmp-row"')).toBeGreaterThan(
      result.html.indexOf("cmp-table-head"),
    );
    // Idempotent: a second pass sees revealable children and stays out.
    expect(topUpRowsMarkup(result.html, rowsScene("table")).repaired).toEqual([]);
  });

  it("chooses the kind-appropriate child class", () => {
    const html =
      '<div data-part="sev-board" data-component="kanban" class="cmp cmp-kanban"></div>';
    const result = topUpRowsMarkup(html, rowsScene("kanban"));
    expect(result.repaired).toEqual(["sev-board"]);
    expect(result.html).toContain('class="cmp-card material"');
  });

  it("leaves targets with revealable children and ambiguous roots alone", () => {
    const populated =
      '<div data-part="sev-board" class="cmp cmp-table">' +
      '<div class="cmp-row"><span>#1</span></div></div>';
    expect(topUpRowsMarkup(populated, rowsScene("table")).repaired).toEqual([]);
    const ambiguous =
      '<div data-part="sev-board" class="cmp"></div><div data-part="sev-board" class="cmp"></div>';
    expect(topUpRowsMarkup(ambiguous, rowsScene("table")).repaired).toEqual([]);
  });

  it("recognizes authored semantic rows instead of injecting neutral duplicates", () => {
    const html = `<section data-scene="triage"><div data-part="sev-board" data-component="table">` +
      `<div class="inbox-row">Alpha</div><div class="inbox-row">Beta</div>` +
      `<div class="inbox-row">Gamma</div></div></section>`;
    const result = topUpRowsMarkup(html, rowsScene("table"));
    expect(result.repaired).toEqual([]);
    expect(result.html).toBe(html);
    expect(result.html).not.toContain("data-sequences-neutral");
  });

  it("survives nested same-tag children when locating the root close tag", () => {
    const html =
      '<div data-part="sev-board" data-component="chat" class="cmp cmp-chat">' +
      "<div><div>header</div></div></div><div>after</div>";
    const result = topUpRowsMarkup(html, rowsScene("chat"));
    expect(result.repaired).toEqual(["sev-board"]);
    const afterIndex = result.html.indexOf("<div>after</div>");
    expect(result.html.lastIndexOf('class="cmp-msg"')).toBeLessThan(afterIndex);
  });

  it("tops up a childless select target the same way (codexfix-probe-1 class)", () => {
    // The live probe burned 3 author attempts + the rescue rung on a
    // command-palette with no .cmp-item children for its select beat; the
    // runtime clamps beat.item into range, so injected children always bind.
    const selectScene: DirectScene[] = [
      scene("palette", 0, {
        components: [{ version: 1, id: "trace-palette", kind: "command-palette" }],
        beats: [{
          version: 1,
          id: "select-trace",
          sceneId: "palette",
          component: "trace-palette",
          kind: "select",
          atSec: 1.4,
          item: 2,
        }],
      }),
    ];
    const html =
      '<div data-part="trace-palette" data-component="command-palette" ' +
      'class="cmp cmp-palette material"><input class="cmp-input"/></div>';
    const result = topUpRowsMarkup(html, selectScene);
    expect(result.repaired).toEqual(["trace-palette"]);
    expect(result.html.match(/class="cmp-item"/g)).toHaveLength(3);
    expect(topUpRowsMarkup(result.html, selectScene).repaired).toEqual([]);
  });

  it("labels topped-up rows with real plan copy, not 'Item N' (T5)", () => {
    // Priority: the component's own beat text, then moment titles, then the
    // foreground fragments — never generic placeholders.
    const html =
      '<section data-scene="board"><div data-part="board-list" data-component="list" ' +
      'class="cmp cmp-list"></div></section>';
    const scenes: DirectScene[] = [scene("board", 0, {
      components: [{ version: 1, id: "board-list", kind: "list" }],
      beats: [{ version: 1, id: "rows", sceneId: "board", component: "board-list", kind: "rows", atSec: 1 }],
      foreground: "'deploy blocked on auth', 'PR 234 ready', 'waiting on API spec'",
    })];
    const result = topUpRowsMarkup(html, scenes);
    expect(result.repaired).toEqual(["board-list"]);
    // The quoted foreground fragments ship as row copy, quotes stripped.
    expect(result.html).toContain("deploy blocked on auth");
    expect(result.html).toContain("PR 234 ready");
    expect(result.html).toContain("waiting on API spec");
    expect(result.html).not.toContain("Item 1");
    // The source is recorded for the degradation ledger.
    expect(result.html).toContain('data-sequences-rows-source="foreground"');
    // Still marked host-invented placeholder STRUCTURE (a degradation on ship).
    expect(result.html.match(/data-sequences-neutral="1"/g)).toHaveLength(3);
  });

  it("prefers the component's own beat text over moments/foreground", () => {
    const html =
      '<section data-scene="feed"><div data-part="feed" data-component="chat" ' +
      'class="cmp cmp-chat"></div></section>';
    const scenes: DirectScene[] = [scene("feed", 0, {
      components: [{ version: 1, id: "feed", kind: "chat" }],
      beats: [
        { version: 1, id: "type-1", sceneId: "feed", component: "feed", kind: "type", atSec: 1, text: "Deploy shipped" },
        { version: 1, id: "rows", sceneId: "feed", component: "feed", kind: "rows", atSec: 2 },
      ],
      moments: [{ version: 1, id: "m", sceneId: "feed", atSec: 1, title: "A moment title", visualState: "x", change: "y", motionIntent: "type-on", importance: "primary" }],
      foreground: "some, foreground, fragments",
    })];
    const result = topUpRowsMarkup(html, scenes);
    expect(result.html).toContain("Deploy shipped");
    expect(result.html).toContain('data-sequences-rows-source="beat-text"');
  });

  it("falls back to the neutral noun only when the plan carries no copy", () => {
    const html =
      '<section data-scene="bare"><div data-part="bare" data-component="table" ' +
      'class="cmp cmp-table"></div></section>';
    const scenes: DirectScene[] = [scene("bare", 0, {
      components: [{ version: 1, id: "bare", kind: "table" }],
      beats: [{ version: 1, id: "rows", sceneId: "bare", component: "bare", kind: "rows", atSec: 1 }],
    })];
    const result = topUpRowsMarkup(html, scenes);
    expect(result.html).toContain("Row 1");
    expect(result.html).toContain('data-sequences-rows-source="neutral"');
  });
});

function compositionDoc(body: string): string {
  return `<!doctype html><html><head></head><body>
<main data-composition-id="c" data-width="1920" data-height="1080" data-duration="4">
${body}
</main></body></html>`;
}

describe("deterministic chart-markup top-up (kit_markup_incomplete absorption)", () => {
  const chartScene = (kind: "chart-bars" | "chart-line"): DirectScene[] => [
    scene("metrics", 0, {
      components: [{ version: 1, id: "growth", kind }],
      beats: [{
        version: 1,
        id: "grow",
        sceneId: "metrics",
        component: "growth",
        kind: "chart",
        atSec: 1.5,
      }],
    }),
  ];

  it("injects four neutral kit bars into a chartless bar chart", () => {
    const html =
      '<section data-scene="metrics"><div data-part="growth" data-component="chart-bars" ' +
      'class="cmp cmp-chart-bars material"></div></section>';
    const result = topUpChartMarkup(html, chartScene("chart-bars"));
    expect(result.repaired).toEqual(["growth"]);
    expect(result.html.match(/<i[^>]*data-sequences-neutral="chart"/g)).toHaveLength(4);
    expect(result.html).toContain('class="cmp-hero"');
    // Idempotent: bars now present, a second pass stays out.
    expect(topUpChartMarkup(result.html, chartScene("chart-bars")).repaired).toEqual([]);
  });

  it("injects an svg polyline stroke for a line chart", () => {
    const html =
      '<div data-part="growth" data-component="chart-line" class="cmp cmp-chart-line"></div>';
    const result = topUpChartMarkup(html, chartScene("chart-line"));
    expect(result.repaired).toEqual(["growth"]);
    expect(result.html).toContain('class="cmp-stroke"');
    expect(result.html).toContain('data-sequences-neutral="chart"');
    expect(topUpChartMarkup(result.html, chartScene("chart-line")).repaired).toEqual([]);
  });

  it("leaves charts that already have bars or a stroke alone", () => {
    const bars =
      '<div data-part="growth" data-component="chart-bars" class="cmp cmp-chart-bars">' +
      '<i style="height:40%"></i></div>';
    expect(topUpChartMarkup(bars, chartScene("chart-bars")).repaired).toEqual([]);
    const stroke =
      '<div data-part="growth" data-component="chart-line" class="cmp cmp-chart-line">' +
      '<svg><polyline points="0,10 10,0"/></svg></div>';
    expect(topUpChartMarkup(stroke, chartScene("chart-line")).repaired).toEqual([]);
  });

  it("declines a content-bearing root — a stray nested <i> icon stays a finding", () => {
    const html =
      '<div data-part="growth" data-component="chart-bars" class="cmp cmp-chart-bars">' +
      '<div class="cmp-head"><i class="icon-trend"></i> Revenue</div></div>';
    expect(topUpChartMarkup(html, chartScene("chart-bars")).repaired).toEqual([]);
  });

  it("declines an ambiguous (duplicated) root", () => {
    const html =
      '<div data-part="growth" class="cmp"></div><div data-part="growth" class="cmp"></div>';
    expect(topUpChartMarkup(html, chartScene("chart-bars")).repaired).toEqual([]);
  });

  it("clears the exact kit_markup_incomplete finding it targets (round-trip vs the audit)", () => {
    const scenes = chartScene("chart-bars");
    const before = compositionDoc(
      '<section data-scene="metrics" data-start="0" data-duration="4">' +
        '<div data-part="growth" class="cmp cmp-chart-bars"></div></section>',
    );
    expect(auditKitMarkupCompleteness(before, scenes).errors.some((error) =>
      error.includes("kit_markup_incomplete") && error.includes("chart"))).toBe(true);
    const after = topUpChartMarkup(before, scenes).html;
    expect(auditKitMarkupCompleteness(after, scenes).errors).toEqual([]);
  });
});

describe("deterministic progress-markup top-up (kit_markup_incomplete absorption)", () => {
  const progressScene = (kind: "progress" | "progress-ring"): DirectScene[] => [
    scene("deploy", 0, {
      components: [{ version: 1, id: "build", kind }],
      beats: [{
        version: 1,
        id: "fill",
        sceneId: "deploy",
        component: "build",
        kind: "progress",
        atSec: 1.5,
      }],
    }),
  ];

  it("injects a data-cmp-fill bar into a fill-less horizontal progress", () => {
    const html =
      '<div data-part="build" data-component="progress" class="cmp cmp-progress"></div>';
    const result = topUpProgressMarkup(html, progressScene("progress"));
    expect(result.repaired).toEqual(["build"]);
    expect(result.html).toContain("data-cmp-fill");
    expect(result.html).toContain('data-sequences-neutral="progress"');
    expect(topUpProgressMarkup(result.html, progressScene("progress")).repaired).toEqual([]);
  });

  it("injects an svg ring arc into an empty progress-ring", () => {
    const html =
      '<div data-part="build" data-component="progress-ring" class="cmp cmp-ring"></div>';
    const result = topUpProgressMarkup(html, progressScene("progress-ring"));
    expect(result.repaired).toEqual(["build"]);
    expect(result.html).toContain('class="cmp-ring-fg"');
    expect(topUpProgressMarkup(result.html, progressScene("progress-ring")).repaired).toEqual([]);
  });

  it("declines a partial ring — a background track but no fg arc stays a finding", () => {
    const html =
      '<div data-part="build" data-component="progress-ring" class="cmp cmp-ring">' +
      '<svg viewBox="0 0 120 120"><circle class="cmp-ring-bg" cx="60" cy="60" r="52"/></svg></div>';
    expect(topUpProgressMarkup(html, progressScene("progress-ring")).repaired).toEqual([]);
  });

  it("leaves an already-filled progress alone", () => {
    const html =
      '<div data-part="build" data-component="progress" class="cmp cmp-progress">' +
      "<i data-cmp-fill></i></div>";
    expect(topUpProgressMarkup(html, progressScene("progress")).repaired).toEqual([]);
  });

  it("fills one repeated continuity component independently in every scene", () => {
    const scenes = ["metric-41", "metric-68", "metric-91"].map((id, index) =>
      scene(id, index * 3, {
        components: [{ version: 1, id: "hairline-rule", kind: "progress" }],
        beats: [{
          version: 1,
          id: `rule-progress-${index + 1}`,
          sceneId: id,
          component: "hairline-rule",
          kind: "progress",
          atSec: index * 3 + 0.5,
        }],
      })
    );
    const before = compositionDoc(scenes.map((entry) =>
      `<section data-scene="${entry.id}" data-start="${entry.startSec}" ` +
      `data-duration="3"><div data-part="hairline-rule" ` +
      `data-component="progress"></div></section>`
    ).join(""));
    const result = topUpProgressMarkup(before, scenes);
    expect(result.repaired).toEqual(["hairline-rule", "hairline-rule", "hairline-rule"]);
    expect(result.html.match(/data-sequences-neutral="progress"/g)).toHaveLength(3);
    expect(auditKitMarkupCompleteness(result.html, scenes).errors).toEqual([]);
    expect(topUpProgressMarkup(result.html, scenes).repaired).toEqual([]);
  });

  it("declines duplicate progress roots inside the same scene", () => {
    const scenes = progressScene("progress");
    const html = compositionDoc(
      '<section data-scene="deploy" data-start="0" data-duration="4">' +
      '<div data-part="build" data-component="progress"></div>' +
      '<div data-part="build" data-component="progress"></div></section>',
    );
    const result = topUpProgressMarkup(html, scenes);
    expect(result.repaired).toEqual([]);
    expect(result.html).toBe(html);
  });

  it("clears the exact kit_markup_incomplete finding it targets (round-trip vs the audit)", () => {
    const scenes = progressScene("progress");
    const before = compositionDoc(
      '<section data-scene="deploy" data-start="0" data-duration="4">' +
        '<div data-part="build" class="cmp cmp-progress"></div></section>',
    );
    expect(auditKitMarkupCompleteness(before, scenes).errors.some((error) =>
      error.includes("kit_markup_incomplete") && error.includes("progress"))).toBe(true);
    const after = topUpProgressMarkup(before, scenes).html;
    expect(auditKitMarkupCompleteness(after, scenes).errors).toEqual([]);
  });
});

describe("repair-feedback dedupe by finding signature", () => {
  it("collapses both encodings of one degraded boundary, keeping the detailed one", () => {
    const raw =
      "cut_degraded: shape-match a->b compiled as zoom-through: focal silhouettes differ " +
      "7.9x in aspect ratio (cap 2.5x)";
    const measured =
      'cut_degraded [data-part="pill"] (t=4.0s): The storyboard declares a shape-match cut ' +
      "a->b, but the runtime degraded it to zoom-through at bind time: focal silhouettes " +
      'differ 7.9x in aspect ratio (cap 2.5x). Measured at the boundary: outgoing "pill" ' +
      '720x56px vs incoming "card" 520x380px.';
    const other = "pacing/reading: scene \"s\" beat \"b\" finishes typing 8 word(s) late";
    expect(dedupeFeedbackBySignature([raw, other, measured])).toEqual([measured, other]);
  });

  it("keeps distinct findings in first-seen order", () => {
    const findings = [
      'interaction_target_miss [data-cursor-id="c1"] misses its target',
      'interaction_not_visible [data-cursor-id="c2"] target hidden',
      'interaction_target_miss [data-cursor-id="c1"] misses its target',
    ];
    const deduped = dedupeFeedbackBySignature(findings);
    expect(deduped).toEqual([findings[0], findings[1]]);
  });
});

describe("degraded-cut paperwork reconciliation (WS1 honest artifacts)", () => {
  const degradedWarning =
    "cut_degraded: shape-match search-typing->trace-resolve compiled as zoom-through: " +
    "focal silhouettes differ 7.9x in aspect ratio (cap 2.5x)";

  it("rewrites the shipped cut and its advertising prose from the QA result", () => {
    const shipped = incidentStoryboard();
    shipped[0]!.outgoingCut = "The pill shape-matches into the trace card boundary.";
    const { storyboard, rewritten } = rewriteDegradedCutStoryboard(shipped, [degradedWarning]);
    expect(rewritten).toEqual(["search-typing->trace-resolve (shape-match)"]);
    expect(storyboard[0]!.cut).toEqual({ version: 1, style: "zoom-through" });
    expect(storyboard[0]!.outgoingCut).toContain("Zoom-through");
    expect(storyboard[0]!.outgoingCut).toContain("degraded at bind time");
    expect(storyboard[0]!.outgoingCut).toContain("7.9x");
    expect(storyboard[0]!.outgoingCut).not.toContain("shape-matches into");
  });

  it("keeps authored boundary timing so the executed window stays put", () => {
    const shipped = incidentStoryboard();
    shipped[0]!.cut = { ...shipped[0]!.cut!, exitSec: 0.3, entrySec: 0.6 };
    const { storyboard } = rewriteDegradedCutStoryboard(shipped, [degradedWarning]);
    expect(storyboard[0]!.cut).toEqual({
      version: 1,
      style: "zoom-through",
      exitSec: 0.3,
      entrySec: 0.6,
    });
  });

  it("ignores warnings for boundaries without a declared bridged cut", () => {
    const shipped = incidentStoryboard();
    const { storyboard, rewritten } = rewriteDegradedCutStoryboard(shipped, [
      "cut_degraded: shape-match trace-resolve->risk-score compiled as zoom-through: reason",
    ]);
    expect(rewritten).toEqual([]);
    expect(storyboard).toEqual(shipped);
  });

  it("is a no-op without degradation warnings", () => {
    const shipped = incidentStoryboard();
    const { storyboard, rewritten } = rewriteDegradedCutStoryboard(shipped, [
      "browser_warning: something unrelated",
    ]);
    expect(rewritten).toEqual([]);
    expect(storyboard).toBe(shipped);
  });
});

describe("repair strategy after a static rejection", () => {
  const cutSignature = "cut_missing_incoming_part:search-typing->trace-resolve:palette-input";
  const otherSignature = "component_root_missing:search-typing:command-palette";

  it("keeps compact repair while findings strictly improve", () => {
    expect(repairStrategyAfterStaticRejection({
      patchMode: true,
      signatures: new Set([otherSignature]),
      previousSignatures: new Set([cutSignature]),
      degradableBoundaries: new Set(),
    })).toBe("compact-repair");
  });

  it("switches to a full re-author when a non-degradable signature survives the patch", () => {
    expect(repairStrategyAfterStaticRejection({
      patchMode: true,
      signatures: new Set([otherSignature]),
      previousSignatures: new Set([otherSignature]),
      degradableBoundaries: new Set(["search-typing->trace-resolve"]),
    })).toBe("full-reauthor");
  });

  it("stays compact when the only survivor is a degradable volunteered cut", () => {
    expect(repairStrategyAfterStaticRejection({
      patchMode: true,
      signatures: new Set([cutSignature]),
      previousSignatures: new Set([cutSignature]),
      degradableBoundaries: new Set(["search-typing->trace-resolve"]),
    })).toBe("compact-repair");
  });

  it("never escalates a full-author rejection (there is no scratch to abandon)", () => {
    expect(repairStrategyAfterStaticRejection({
      patchMode: false,
      signatures: new Set([otherSignature]),
      previousSignatures: new Set([otherSignature]),
      degradableBoundaries: new Set(),
    })).toBe("compact-repair");
  });
});

// The Cursorflow dense-UI live fallback (2026-07-05): source-author exhausted
// every attempt on two mechanically recoverable hard errors — a hallucinated
// host-kit asset reference and a declared component whose data-part element the
// author left unlabeled — that the deterministic repair layer now recovers.
describe("stripHostKitAssetReferences", () => {
  it("removes the hallucinated sequences-cinema.v1.js and inline CSS kits, keeps staged runtimes", () => {
    const html = [
      '<script src="gsap.min.js"></script>',
      '<script src="sequences-components.v1.js"></script>',
      '<script src="sequences-camera.v1.js"></script>',
      '<script src="sequences-cinema.v1.js"></script>',
      '<link rel="stylesheet" href="sequences-cinema.v1.css">',
      '<link rel="stylesheet" href="sequences-components.v1.css">',
    ].join("\n");
    const { html: out, removed } = stripHostKitAssetReferences(html);
    expect(removed).toContain("sequences-cinema.v1.js");
    expect(removed).toContain("sequences-cinema.v1.css");
    expect(removed).toContain("sequences-components.v1.css");
    expect(out).not.toContain("sequences-cinema.v1.js");
    expect(out).not.toContain("sequences-cinema.v1.css");
    expect(out).not.toContain("sequences-components.v1.css");
    expect(out).toContain('src="gsap.min.js"');
    expect(out).toContain('src="sequences-components.v1.js"');
    expect(out).toContain('src="sequences-camera.v1.js"');
  });

  it("leaves a document with only staged runtime references byte-identical", () => {
    const html =
      '<script src="gsap.min.js"></script>\n<script src="sequences-cuts.v1.js"></script>\n' +
      '<script src="sequences-time.v1.js"></script>';
    const { html: out, removed } = stripHostKitAssetReferences(html);
    expect(removed).toHaveLength(0);
    expect(out).toBe(html);
  });
});

describe("reconcileComponentBindings — missing data-part recovery", () => {
  const wrap = (inner: string): string =>
    `<section data-scene="dashboard-overload" id="dashboard-overload" ` +
    `data-start="0" data-duration="6">${inner}</section>`;
  const component = (id: string, kind: string, region?: string) =>
    ({ version: 1 as const, id, kind, ...(region ? { region } : {}) }) as NonNullable<
      DirectScene["components"]
    >[number];

  it("binds a lone unlabeled element of the declared kind (the dashboard-frame class)", () => {
    const html = wrap('<div class="cmp-app-window" data-component="app-window"><h1>Deploys</h1></div>');
    const { html: out, repairs } = reconcileComponentBindings(html, [
      scene("dashboard-overload", 0, { components: [component("dashboard-frame", "app-window")] }),
    ]);
    expect(repairs).toBe(1);
    expect(out).toContain('data-part="dashboard-frame"');
    expect(out).toContain('data-component="app-window"');
  });

  it("binds an element the author named on id instead of data-part", () => {
    const html = wrap('<div id="dashboard-frame" class="cmp-app-window"></div>');
    const { html: out, repairs } = reconcileComponentBindings(html, [
      scene("dashboard-overload", 0, { components: [component("dashboard-frame", "app-window")] }),
    ]);
    expect(repairs).toBe(1);
    expect(out).toContain('data-part="dashboard-frame"');
    expect(out).toContain('data-component="app-window"');
  });

  it("stays blocking when the candidate is ambiguous (two bare app-windows)", () => {
    const html = wrap(
      '<div data-component="app-window"></div><div data-component="app-window"></div>',
    );
    const { html: out, repairs } = reconcileComponentBindings(html, [
      scene("dashboard-overload", 0, { components: [component("dashboard-frame", "app-window")] }),
    ]);
    expect(repairs).toBe(0);
    expect(out).not.toContain("dashboard-frame");
  });

  it("never hijacks a sibling component's correctly-labeled element", () => {
    const html = wrap(
      '<div class="cmp-app-window" data-component="app-window"></div>' +
        '<div data-part="side-search" data-component="search"></div>',
    );
    const { html: out, repairs } = reconcileComponentBindings(html, [
      scene("dashboard-overload", 0, {
        components: [
          component("dashboard-frame", "app-window"),
          component("side-search", "search"),
        ],
      }),
    ]);
    expect(repairs).toBe(1);
    expect(out).toContain('data-part="dashboard-frame"');
    expect(out.match(/data-part="side-search"/g)).toHaveLength(1);
  });

  it("forces the declared kind onto an existing element (the search->palette morph confusion)", () => {
    const html = wrap('<div data-part="dashboard-search-pill" data-component="command-palette"></div>');
    const { html: out, repairs } = reconcileComponentBindings(html, [
      scene("dashboard-overload", 0, {
        components: [component("dashboard-search-pill", "search")],
      }),
    ]);
    expect(repairs).toBeGreaterThanOrEqual(1);
    expect(out).toContain('data-component="search"');
    expect(out).not.toContain('data-component="command-palette"');
  });

  it("claims a lone kind-marked palette root even when it carried a cut alias", () => {
    const html = wrap(
      '<div class="cmp cmp-palette" data-component="command-palette" data-part="palette-input">' +
        '<div class="cmp-input"></div></div>',
    );
    const { html: out, repairs } = reconcileComponentBindings(html, [
      scene("dashboard-overload", 0, {
        components: [component("cmd-palette", "command-palette")],
      }),
    ]);
    expect(repairs).toBe(1);
    expect(out).toContain('data-component="command-palette" data-part="cmd-palette"');
  });

  it("moves a stat binding off a hidden placeholder onto the sole visible metric root", () => {
    const html = wrap(
      '<div class="panel-stat-dock"><span data-cmp-value>7</span></div>' +
        '<div data-part="impact-stat" data-component="stat-card" style="display:none;">' +
        '<span data-cmp-value>142ms</span></div>',
    );
    const { html: out, repairs } = reconcileComponentBindings(html, [
      scene("dashboard-overload", 0, {
        components: [component("impact-stat", "stat-card")],
      }),
    ]);
    expect(repairs).toBe(1);
    expect(out).toContain(
      'class="panel-stat-dock" data-part="impact-stat" data-component="stat-card"',
    );
    expect(out).toContain('data-part="impact-stat-hidden-aux-1"');
  });

  it("leaves a hidden stat binding in place when visible metric roots are ambiguous", () => {
    const html = wrap(
      '<div class="panel-stat-dock"><span data-cmp-value>7</span></div>' +
        '<div class="metric-card"><span data-cmp-value>8</span></div>' +
        '<div data-part="impact-stat" data-component="stat-card" style="display:none"></div>',
    );
    const { html: out, repairs } = reconcileComponentBindings(html, [
      scene("dashboard-overload", 0, {
        components: [component("impact-stat", "stat-card")],
      }),
    ]);
    expect(repairs).toBe(0);
    expect(out).toContain('data-part="impact-stat" data-component="stat-card" style="display:none"');
    expect(out).not.toContain('data-part="impact-stat-hidden-aux-1"');
  });

  it("moves a hidden focal-row binding onto the one item every action names", () => {
    const html = wrap(
      '<div class="cmp cmp-table" data-part="queue-table" data-component="table">' +
        '<div class="cmp-row" data-part="queue-row-1">MG-201</div>' +
        '<div class="cmp-row" data-part="queue-row-2">MG-204</div>' +
        '<div class="cmp-row" data-part="queue-row-3">MG-207</div></div>' +
        '<div data-part="row-mg204" data-component="list" ' +
        'data-layout-important="1" style="display:none"></div>' +
        "<script>tl.to('[data-part=\"queue-row-2\"]',{scale:1.02},7)</script>",
    );
    const { html: out, repairs } = reconcileComponentBindings(html, [
      scene("dashboard-overload", 0, {
        components: [
          component("queue-table", "table"),
          component("row-mg204", "list"),
        ],
        beats: [
          {
            version: 1,
            id: "highlight-row",
            sceneId: "dashboard-overload",
            component: "queue-table",
            kind: "highlight",
            atSec: 2,
            item: 2,
          },
          {
            version: 1,
            id: "underline-row",
            sceneId: "dashboard-overload",
            component: "row-mg204",
            kind: "highlight",
            atSec: 2.3,
            item: 1,
          },
        ],
        interactions: [{
          version: 1,
          id: "pick-row",
          sceneId: "dashboard-overload",
          cursorId: "cursor",
          targetPart: "queue-table",
          action: "click",
          startSec: 1,
          arriveSec: 2,
          item: 2,
          from: "frame:bottom-right",
          path: "arc",
          aimX: 0.5,
          aimY: 0.5,
          feedback: "press-ripple",
        }],
        spatialIntent: {
          version: 1,
          focalPart: "row-mg204",
          composition: "table detail",
          relationships: [],
        },
      }),
    ]);
    expect(repairs).toBe(1);
    expect(out).toContain(
      'class="cmp-row" data-part="row-mg204" data-component="list" ' +
        'data-sequences-part-alias="queue-row-2" data-layout-important="1"',
    );
    expect(out).toContain('data-part="row-mg204-hidden-aux-1"');
    expect(out).toContain("tl.to('[data-part=\"row-mg204\"]'");
    expect(out.match(/<[^>]+data-part="row-mg204"(?:\s|>)/g)).toHaveLength(1);
  });

  it("does not guess a hidden focal row when item evidence disagrees", () => {
    const html = wrap(
      '<div class="cmp cmp-table" data-part="queue-table" data-component="table">' +
        '<div class="cmp-row">MG-201</div><div class="cmp-row">MG-204</div></div>' +
        '<div data-part="row-mg204" data-component="list" style="display:none"></div>',
    );
    const { html: out, repairs } = reconcileComponentBindings(html, [
      scene("dashboard-overload", 0, {
        components: [
          component("queue-table", "table"),
          component("row-mg204", "list"),
        ],
        beats: [{
          version: 1,
          id: "highlight-first",
          sceneId: "dashboard-overload",
          component: "queue-table",
          kind: "highlight",
          atSec: 2,
          item: 1,
        }],
        interactions: [{
          version: 1,
          id: "pick-second",
          sceneId: "dashboard-overload",
          cursorId: "cursor",
          targetPart: "queue-table",
          action: "click",
          startSec: 1,
          arriveSec: 2,
          item: 2,
          from: "frame:bottom-right",
          path: "arc",
          aimX: 0.5,
          aimY: 0.5,
          feedback: "press-ripple",
        }],
        spatialIntent: {
          version: 1,
          focalPart: "row-mg204",
          composition: "table detail",
          relationships: [],
        },
      }),
    ]);
    expect(repairs).toBe(0);
    expect(out).toContain('data-part="row-mg204" data-component="list" style="display:none"');
  });

  it("degrades a volunteered cross-kind morph before browser structure QA", () => {
    const storyboard = [
      scene("proof", 0, {
        components: [{ version: 1, id: "confidence", kind: "stat-card", role: "hero" }],
        cut: {
          version: 1,
          style: "morph",
          focalPartOut: "confidence",
          focalPartIn: "gate-ring",
          shapeOut: "card",
          shapeIn: "circle",
          exitSec: 0.35,
          entrySec: 0.5,
        },
      }),
      scene("gate", 4, {
        components: [{ version: 1, id: "gate-ring", kind: "progress-ring", role: "hero" }],
      }),
    ];
    const result = degradeCrossKindComponentMorphCuts(storyboard);
    expect(result.degraded).toEqual([
      "proof->gate (stat-card:confidence->progress-ring:gate-ring)",
    ]);
    expect(result.scenes[0]!.cut).toEqual({
      version: 1,
      style: "swipe",
      axis: "right",
      exitSec: 0.35,
      entrySec: 0.5,
    });
    expect(result.scenes[0]!.outgoingCut).toContain("host DOM structures differ");
  });

  it("preserves same-kind component morphs", () => {
    const storyboard = [
      scene("before", 0, {
        components: [{ version: 1, id: "card-a", kind: "stat-card", role: "hero" }],
        cut: {
          version: 1,
          style: "morph",
          focalPartOut: "card-a",
          focalPartIn: "card-b",
        },
      }),
      scene("after", 4, {
        components: [{ version: 1, id: "card-b", kind: "stat-card", role: "hero" }],
      }),
    ];
    expect(degradeCrossKindComponentMorphCuts(storyboard)).toEqual({
      scenes: storyboard,
      degraded: [],
    });
  });
});

describe("component camera-station ownership", () => {
  it("rehomes one typed CTA from a sibling station into its declared station", () => {
    const html =
      '<section data-scene="close" id="close" data-start="0" data-duration="5">' +
      '<div data-camera-world>' +
      '<div data-region="savings-station"><div class="hero">' +
      '<button data-part="cta" data-component="button" data-region="cta-station">Go</button>' +
      '</div></div>' +
      '<div data-region="cta-station"></div>' +
      '</div></section>';
    const result = rehomeRegionComponents(html, [{
      id: "close",
      title: "Close",
      purpose: "Land the CTA",
      startSec: 0,
      durationSec: 5,
      components: [{
        version: 1,
        id: "cta",
        kind: "button",
        region: "cta-station",
      }],
    }]);
    expect(result.repairs).toBe(1);
    expect(result.html).toMatch(
      /<div data-region="cta-station"><button data-part="cta"(?![^>]*data-region)[\s\S]*?<\/button><\/div>/,
    );
    expect(result.html).not.toMatch(
      /data-region="savings-station"[\s\S]*?data-part="cta"[\s\S]*?data-region="cta-station"><\/div>/,
    );
  });

  it("creates a station when the component itself was used as the region", () => {
    const html =
      '<section data-scene="close" id="close" data-start="0" data-duration="5">' +
      '<div data-camera-world><div data-region="savings-station">' +
      '<button data-part="cta" data-component="button" data-region="cta-station">Go</button>' +
      '</div></div></section>';
    const result = rehomeRegionComponents(html, [{
      id: "close",
      title: "Close",
      purpose: "Land the CTA",
      startSec: 0,
      durationSec: 5,
      components: [{ version: 1, id: "cta", kind: "button", region: "cta-station" }],
    }]);
    expect(result.repairs).toBe(1);
    expect(result.html).toMatch(
      /<\/div><div data-region="cta-station"><button data-part="cta"(?![^>]*data-region)/,
    );
    expect(result.html.match(/data-region="cta-station"/g)).toHaveLength(1);
  });

  it("preserves a later ambiguous component after an earlier repair", () => {
    const html =
      '<section data-scene="close" id="close" data-start="0" data-duration="5">' +
      '<div data-camera-world><div data-region="wrong">' +
      '<button data-part="cta" data-component="button">Go</button></div>' +
      '<div data-region="cta-station"></div>' +
      '<div data-part="badge" data-component="badge" data-region="badge-station">New</div>' +
      '</div><div data-camera-world></div></section>';
    const result = rehomeRegionComponents(html, [{
      id: "close",
      title: "Close",
      purpose: "Land the CTA",
      startSec: 0,
      durationSec: 5,
      components: [
        { version: 1, id: "cta", kind: "button", region: "cta-station" },
        { version: 1, id: "badge", kind: "toast", region: "badge-station" },
      ],
    }]);
    expect(result.repairs).toBe(1);
    expect(result.html).toContain('data-part="badge"');
    expect(result.html).toContain('data-region="badge-station"');
  });
});

describe("deterministic source repair ordering: camera world + component aliases", () => {
  const storyboard = (): DirectScene[] => [
    scene("dashboard-overwhelm", 0, {
      cut: {
        version: 1,
        style: "shape-match",
        focalPartOut: "palette-input",
        focalPartIn: "palette-input",
      },
    }),
    scene("palette-ship", 4, {
      components: [{ version: 1, id: "cmd-palette", kind: "command-palette" }],
      beats: [{
        version: 1,
        id: "filtered-rows",
        sceneId: "palette-ship",
        component: "cmd-palette",
        kind: "rows",
        atSec: 5,
      }],
    }),
    scene("stat-resolve", 8, {
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "push-in",
          toRegion: "stat-card",
          startSec: 9,
          durationSec: 1,
        }],
      },
    }),
  ];

  function sourceHtml(): string {
    return `<!doctype html><html><head><script src="gsap.min.js"></script></head><body>
<main data-composition-id="c" data-width="1920" data-height="1080" data-duration="12">
  <section id="dashboard-overwhelm" data-scene="dashboard-overwhelm" data-start="0" data-duration="4">
    <div data-part="palette-input"></div>
  </section>
  <section id="palette-ship" data-scene="palette-ship" data-start="4" data-duration="4">
    <div class="cmp cmp-palette material" data-component="command-palette">
      <div class="cmp-input inset-well"><span class="cmp-text">deploy</span></div>
    </div>
  </section>
  <section id="stat-resolve" data-scene="stat-resolve" data-start="8" data-duration="4">
    <div data-region="stat-card"><div class="metric">98%</div></div>
  </section>
</main>
<script>const tl = gsap.timeline({ paused: true }); window.__timelines["c"] = tl;</script>
</body></html>`;
  }

  it("wraps a camera scene that omitted only the data-camera-world plane", () => {
    const { html, repairs } = reconcileCameraWorldPlanes(sourceHtml(), storyboard());
    expect(repairs).toBe(1);
    expect(html).toContain('data-camera-world style="position:absolute;inset:0;transform-origin:0 0"');
    expect(validateCameraContract(
      applyDeterministicSourceRepairs({ html, storyboard: storyboard() }, tempDir(), storyboard()).html,
      storyboard(),
    ).errors).toEqual([]);
  });

  it("materializes a command-palette input alias without stealing the component root", () => {
    const scenes = storyboard();
    const html = reconcileComponentBindings(sourceHtml(), scenes).html;
    const { html: withAlias, repairs } = reconcileComponentInternalPartAliases(html, scenes);
    expect(repairs).toBe(1);
    expect(withAlias).toContain('data-part="cmd-palette"');
    expect(withAlias).toContain('class="cmp-input inset-well" data-part="palette-input"');
  });

  it("recovers the combined latest source-author failure before static validation", () => {
    const scenes = storyboard();
    const repaired = applyDeterministicSourceRepairs(
      { html: sourceHtml(), storyboard: scenes },
      tempDir(),
      scenes,
    );
    expect(repaired.html).toContain("data-camera-world");
    expect(repaired.html).toContain('data-part="cmd-palette"');
    expect(repaired.html).toContain('data-part="palette-input"');
    expect(repaired.html.match(/class="cmp-item"/g)).toHaveLength(3);
    expect(validateCutContract(repaired.html, scenes).errors).toEqual([]);
    expect(validateCameraContract(repaired.html, scenes).errors).toEqual([]);
    expect(validateComponentContract(repaired.html, scenes).errors).toEqual([]);
  });

  it("normalizes the composition root start time without duplicating it", () => {
    const scenes = storyboard();
    const first = applyDeterministicSourceRepairs(
      { html: sourceHtml(), storyboard: scenes },
      tempDir(),
      scenes,
    );
    expect(first.html).toMatch(/<main\b[^>]*\bdata-composition-id="c"[^>]*\bdata-start="0"/);

    const second = applyDeterministicSourceRepairs(first, tempDir(), scenes);
    const rootTag = second.html.match(/<main\b[^>]*>/)?.[0] ?? "";
    expect(rootTag.match(/\bdata-start=/g)).toHaveLength(1);
  });

  it("strips dead literal GSAP tweens while preserving live and dynamic calls", () => {
    const scenes = storyboard();
    const html = sourceHtml().replace(
      'const tl = gsap.timeline({ paused: true });',
      'const tl = gsap.timeline({ paused: true });\n' +
        'tl.to("#missing-panel", { opacity: 1, duration: 0.4 }, 1);\n' +
        'tl.to("#dashboard-overwhelm", { opacity: 1, duration: 0.4 }, 1.5);\n' +
        'tl.to(selectorFromState, { opacity: 1, duration: 0.4 }, 2);',
    );
    const repaired = applyDeterministicSourceRepairs(
      { html, storyboard: scenes },
      tempDir(),
      scenes,
    );
    expect(repaired.html).not.toContain('#missing-panel');
    expect(repaired.html).toContain('#dashboard-overwhelm');
    expect(repaired.html).toContain('selectorFromState');
  });

  it("injects the canonical ripple even when an authored tween selector names the ripple part", () => {
    // The 2026-07-07 TraceKit probe replay: the author built a ripple element
    // AND a tween addressing `[data-part='…-ripple']`. Retiring the element
    // used to leave the selector string in the inline script, which the bare
    // attribute-existence test mistook for a still-bound element — no
    // canonical actor was injected and interaction_ripple_missing survived
    // every paid attempt.
    const scenes = storyboard().map((entry) =>
      entry.id === "palette-ship"
        ? {
            ...entry,
            interactions: [{
              version: 1 as const,
              id: "press-palette",
              sceneId: "palette-ship",
              cursorId: "pointer",
              targetPart: "cmd-palette",
              action: "click" as const,
              startSec: 5,
              arriveSec: 5.6,
              pressSec: 5.7,
              releaseSec: 5.85,
              from: "frame:bottom-right" as const,
              path: "human" as const,
              aimX: 0.5,
              aimY: 0.5,
              feedback: "press-ripple" as const,
              ripplePart: "palette-ripple",
            }],
          }
        : entry
    );
    const html = sourceHtml()
      .replace(
        '<div class="cmp cmp-palette material" data-component="command-palette">',
        '<span data-part="palette-ripple" style="position:absolute;width:0;height:0"></span>' +
          '<div class="cmp cmp-palette material" data-component="command-palette">',
      )
      .replace(
        'const tl = gsap.timeline({ paused: true });',
        'const tl = gsap.timeline({ paused: true });\n' +
          "tl.fromTo(\"#palette-ship [data-part='palette-ripple']\", " +
          '{ width: 0 }, { width: 340, duration: 0.8 }, 5.7);',
      );
    const repaired = applyDeterministicSourceRepairs(
      { html, storyboard: scenes },
      tempDir(),
      scenes,
    );
    // The canonical runtime actor exists and owns the data-part.
    expect(repaired.html).toMatch(
      /data-sequences-runtime-ripple[^>]*\bdata-part="palette-ripple"/,
    );
    // The authored element is retired, and the tween selector follows it with
    // its original quote style intact (the script must still parse).
    expect(repaired.html).toContain('data-sequences-retired-ripple="palette-ripple"');
    expect(repaired.html).toContain(
      "#palette-ship [data-sequences-retired-ripple='palette-ripple']",
    );
    expect(repaired.html).not.toContain("[data-part='palette-ripple']");
    // Exactly one live binding remains — the canonical actor.
    const liveBindings = repaired.html.match(/\bdata-part="palette-ripple"/g) ?? [];
    expect(liveBindings).toHaveLength(1);
  });
});

describe("unused host islands and liveness recovery", () => {
  const quietScenes = (): DirectScene[] => [
    scene("dashboard-noise", 0, { durationSec: 2.5 }),
    scene("proof", 2.5, { durationSec: 4 }),
    scene("close", 6.5, { durationSec: 4 }),
  ];

  function quietHtml(extraHead = ""): string {
    return `<!doctype html><html><head><script src="gsap.min.js"></script>${extraHead}</head><body>
<main data-composition-id="c" data-width="1920" data-height="1080" data-duration="10.5">
  <section id="dashboard-noise" data-scene="dashboard-noise" data-start="0" data-duration="2.5">
    <div id="dashboard-card" class="panel metric-card">Noisy dashboard</div>
  </section>
  <section id="proof" data-scene="proof" data-start="2.5" data-duration="4">
    <h2 id="proof-title">Signal resolves</h2>
  </section>
  <section id="close" data-scene="close" data-start="6.5" data-duration="4">
    <h2 id="close-title">Ship the answer</h2>
  </section>
</main>
<script>const tl = gsap.timeline({ paused: true });
tl.fromTo("#proof-title", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: .45 }, 4.6);
tl.fromTo("#close-title", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: .45 }, 8.8);
window.__timelines["c"] = tl;</script>
</body></html>`;
  }

  it("strips hallucinated interaction/camera/component islands when the locked storyboard has no plan", () => {
    const scenes = quietScenes();
    const html = quietHtml(
      '<script type="application/json" id="sequences-interactions">[]</script>' +
        '<script type="application/json" id="sequences-camera">{"version":1,"scenes":[{}]}</script>' +
        '<script type="application/json" id="sequences-components">[]</script>',
    );
    const { html: out, removed } = stripUnusedHostPlanIslands(html, scenes);
    expect(removed).toEqual([
      "sequences-interactions",
      "sequences-camera",
      "sequences-components",
    ]);
    expect(out).not.toContain("sequences-interactions");
    expect(out).not.toContain("sequences-camera");
    expect(out).not.toContain("sequences-components");
    expect(validateInteractionContract(out, scenes, 10.5).errors).toEqual([]);
    expect(validateCameraContract(out, scenes).errors).toEqual([]);
    expect(validateComponentContract(out, scenes).errors).toEqual([]);
  });

  it("injects a minimal seek-safe child beat for a short slide-like scene", () => {
    const scenes = quietScenes();
    const before = analyzeMotionDensity(quietHtml(), scenes, 10.5);
    expect(before.errors.join("\n")).toContain('scene "dashboard-noise" has 0 authored');
    const { html, repaired } = injectMissingLivenessBeats(quietHtml(), scenes);
    expect(repaired).toEqual(["dashboard-noise"]);
    expect(html).toContain('data-sequences-liveness-beat="dashboard-noise"');
    expect(html).toContain('tl.fromTo("[data-sequences-liveness-beat=\\"dashboard-noise\\"]"');
    const after = analyzeMotionDensity(html, scenes, 10.5);
    expect(after.errors.join("\n")).not.toContain('scene "dashboard-noise"');
  });

  it("recovers the latest unused-island plus dashboard-noise liveness failure end to end", () => {
    const scenes = quietScenes();
    const html = quietHtml(
      '<script type="application/json" id="sequences-interactions">{}</script>' +
        '<script type="application/json" id="sequences-camera">{"version":1,"scenes":[{}]}</script>',
    );
    const repaired = applyDeterministicSourceRepairs({ html, storyboard: scenes }, tempDir(), scenes);
    expect(repaired.html).not.toContain('id="sequences-interactions"');
    expect(repaired.html).not.toContain('id="sequences-camera"');
    expect(repaired.html).toContain('data-sequences-liveness-beat="dashboard-noise"');
    expect(validateInteractionContract(repaired.html, scenes, 10.5).errors).toEqual([]);
    expect(validateCameraContract(repaired.html, scenes).errors).toEqual([]);
    expect(analyzeMotionDensity(repaired.html, scenes, 10.5).errors.join("\n"))
      .not.toContain('scene "dashboard-noise"');
  });
});

// The parked re-run defect (2026-07-05): attempt 3 threw
// `runtime_bind_exception: SequencesInteractions is not defined`. The runtime
// <script src> is idempotently injected on the GSAP anchor, but a compile call
// injected on a different anchor executes against an undefined global when the
// runtime tag is absent or ordered after the inline timeline script.
describe("ensureRuntimeScriptOrdering — the SequencesInteractions is not defined class", () => {
  const gsap = '<script src="gsap.min.js"></script>';
  const inline =
    "<script>var tl = gsap.timeline({ paused: true });\n" +
    'SequencesInteractions.compile(tl, document.querySelector("[data-composition-id]"));\n' +
    'window.__timelines["c"] = tl;</script>';
  const runtime = '<script src="sequences-interactions.v1.js"></script>';

  const srcIndex = (html: string, file: string): number =>
    html.indexOf(`src="${file}"`);
  const inlineIndex = (html: string): number => html.indexOf("gsap.timeline");

  it("moves an author runtime tag written AFTER the inline timeline to before it", () => {
    const html = `${gsap}\n${inline}\n${runtime}`;
    const { html: out, changed } = ensureRuntimeScriptOrdering(html);
    expect(changed).toBe(true);
    // Runtime now loads after GSAP but before the inline compile call.
    expect(srcIndex(out, "gsap.min.js")).toBeLessThan(srcIndex(out, "sequences-interactions.v1.js"));
    expect(srcIndex(out, "sequences-interactions.v1.js")).toBeLessThan(inlineIndex(out));
    // Exactly one runtime tag — no duplication.
    expect(out.match(/sequences-interactions\.v1\.js/g)).toHaveLength(1);
  });

  it("injects a referenced-but-absent runtime the author never loaded", () => {
    const html = `${gsap}\n${inline}`;
    const { html: out, changed } = ensureRuntimeScriptOrdering(html);
    expect(changed).toBe(true);
    expect(out).toContain('src="sequences-interactions.v1.js"');
    expect(srcIndex(out, "sequences-interactions.v1.js")).toBeLessThan(inlineIndex(out));
  });

  it("moves a runtime tag written BEFORE GSAP to after it", () => {
    const html = `${runtime}\n${gsap}\n${inline}`;
    const { html: out } = ensureRuntimeScriptOrdering(html);
    expect(srcIndex(out, "gsap.min.js")).toBeLessThan(srcIndex(out, "sequences-interactions.v1.js"));
    expect(out.match(/sequences-interactions\.v1\.js/g)).toHaveLength(1);
  });

  it("orders every referenced runtime canonically in one block after GSAP", () => {
    const multi =
      "<script>var tl = gsap.timeline({ paused: true });\n" +
      "SequencesCuts.compile(tl, root); SequencesCamera.compile(tl, root);\n" +
      "SequencesComponents.compile(tl, root); SequencesInteractions.compile(tl, root);\n" +
      'window.__timelines["c"] = tl;</script>';
    const { html: out } = ensureRuntimeScriptOrdering(`${gsap}\n${multi}`);
    const order = [
      "sequences-interactions.v1.js",
      "sequences-cuts.v1.js",
      "sequences-camera.v1.js",
      "sequences-components.v1.js",
    ].map((file) => srcIndex(out, file));
    expect(order.every((idx) => idx > 0)).toBe(true);
    expect([...order]).toEqual([...order].sort((a, b) => a - b));
    expect(Math.max(...order)).toBeLessThan(inlineIndex(out));
  });

  it("is a no-op and byte-idempotent for a correctly-ordered composition", () => {
    const correct = `${gsap}\n${runtime}\n${inline}`;
    const first = ensureRuntimeScriptOrdering(correct);
    expect(first.changed).toBe(false);
    expect(first.html).toBe(correct);
    // Running the guard on its own output never drifts.
    const reordered = ensureRuntimeScriptOrdering(`${gsap}\n${inline}\n${runtime}`);
    expect(ensureRuntimeScriptOrdering(reordered.html).changed).toBe(false);
  });

  it("leaves a composition that references no runtime globals untouched", () => {
    const plain = `${gsap}\n<script>var tl = gsap.timeline({ paused: true });\nwindow.__timelines["c"] = tl;</script>`;
    const { html: out, changed } = ensureRuntimeScriptOrdering(plain);
    expect(changed).toBe(false);
    expect(out).toBe(plain);
  });

  it("does not treat a JSON island's payload as a runtime reference", () => {
    const withIsland =
      `${gsap}\n` +
      '<script type="application/json" id="sequences-cuts">{"version":1,"cuts":[]}</script>\n' +
      '<script>var tl = gsap.timeline({ paused: true });\nwindow.__timelines["c"] = tl;</script>';
    // No executed script names a runtime global, so nothing is injected.
    expect(ensureRuntimeScriptOrdering(withIsland).changed).toBe(false);
  });

  it("returns the source unchanged when there is no GSAP anchor", () => {
    const noGsap = `${inline}\n${runtime}`;
    const { html: out, changed } = ensureRuntimeScriptOrdering(noGsap);
    expect(changed).toBe(false);
    expect(out).toBe(noGsap);
  });
});

/* -------------------------------------------- Sentinel Phase 1 — scaffold */

describe("ensureHostCompileOrdering - live target geometry follows scene motion", () => {
  it("runs interaction followers after every scene-producing host compiler", () => {
    const html = `<script>
var tl = gsap.timeline({ paused: true });
SequencesInteractions.compile(tl, root);
SequencesFx.compile(tl, root);
SequencesCuts.compile(tl, root);
SequencesAssets.compile(tl, root);
SequencesComponents.compile(tl, root);
SequencesContinuity.compile(tl, root);
SequencesCamera.compile(tl, root);
var __seqWarped = SequencesTime.wrap(tl);
</script>`;
    const first = ensureHostCompileOrdering(html);
    expect(first.changed).toBe(true);
    const names = ["Cuts", "Camera", "Continuity", "Components", "Fx", "Assets", "Interactions"];
    const positions = names.map((name) => first.html.indexOf(`Sequences${name}.compile`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.at(-1)).toBeLessThan(first.html.indexOf("SequencesTime.wrap"));
    expect(ensureHostCompileOrdering(first.html)).toEqual({ html: first.html, changed: false });
  });

  it("does not mix compiler calls belonging to different timeline variables", () => {
    const html = `<script>
SequencesInteractions.compile(hero, heroRoot);
SequencesCamera.compile(detail, detailRoot);
SequencesCamera.compile(hero, heroRoot);
SequencesInteractions.compile(detail, detailRoot);
</script>`;
    const { html: repaired } = ensureHostCompileOrdering(html);
    expect(repaired.indexOf("SequencesCamera.compile(hero")).toBeLessThan(
      repaired.indexOf("SequencesInteractions.compile(hero"),
    );
    expect(repaired.indexOf("SequencesCamera.compile(detail")).toBeLessThan(
      repaired.indexOf("SequencesInteractions.compile(detail"),
    );
  });
});

/** The 2026-07-05 incident 1 shape: a component scene + a camera-path scene
 * where the model omitted the component `data-part` and the `data-camera-world`
 * plane. The Phase-1 skeleton emits both so those repairs never fire. */
function incident1Storyboard(): DirectScene[] {
  return [
    scene("palette-ship", 0, {
      components: [
        { version: 1, id: "cmd-palette", kind: "command-palette", role: "hero" },
      ],
      beats: [
        {
          version: 1,
          id: "palette-open",
          sceneId: "palette-ship",
          component: "cmd-palette",
          kind: "open",
          atSec: 1,
        },
      ],
    }),
    scene("stat-resolve", 4, {
      worldLayout: [
        { region: "hero-claim", cell: [0, 0] },
        { region: "metric-wall", cell: [1, 0] },
      ],
      camera: {
        version: 1,
        // Absolute times inside the [4, 8) scene window.
        path: [
          { version: 1, move: "hold", toRegion: "hero-claim", startSec: 4.2, durationSec: 0.8 },
          { version: 1, move: "whip", toRegion: "metric-wall", startSec: 5.6, durationSec: 0.5 },
        ],
      },
    }),
  ];
}

function wrapSkeletonDoc(skeletons: string[], id = "incident1"): string {
  return [
    "<!doctype html><html><head></head><body>",
    `<div data-composition-id="${id}" data-width="1920" data-height="1080" data-duration="12">`,
    ...skeletons,
    "</div>",
    '<script src="gsap.min.js"></script>',
    `<script>var tl = gsap.timeline({ paused: true });\nwindow.__timelines["${id}"] = tl;</script>`,
    "</body></html>",
  ].join("\n");
}

function extractIslandBody(html: string, id: string): string | undefined {
  const match = html.match(
    new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`, "i"),
  );
  return match?.[1];
}

describe("Sentinel Phase 1 — skeleton scaffold makes paperwork classes unrepresentable", () => {
  it("incident 1 replay: skeleton emits the camera-world plane + component root; zero repairs", () => {
    const storyboard = incident1Storyboard();
    const [paletteShell, statShell] = buildSceneSkeletons(storyboard);

    // Component root present by construction.
    expect(paletteShell).toContain('data-part="cmd-palette"');
    expect(paletteShell).toContain('data-component="command-palette"');
    // Camera-world plane + both stations present by construction.
    expect(statShell).toContain("data-camera-world");
    expect(statShell).toContain('data-region="hero-claim"');
    expect(statShell).toContain('data-region="metric-wall"');
    // Stations carry the deterministic rects (not guessed coordinates).
    expect(statShell).toMatch(/data-region="hero-claim"[^>]*left:260px/);

    // A document built from the skeletons needs ZERO deterministic repair for
    // the camera-world and component-root classes (attempt-1, no fallback).
    const doc = wrapSkeletonDoc([paletteShell!, statShell!]);
    expect(reconcileCameraWorldPlanes(doc, storyboard).repairs).toBe(0);
    expect(reconcileComponentBindings(doc, storyboard).repairs).toBe(0);
    expect(reconcileContractBindings(doc, storyboard).repairs).toBe(0);
  });

  it("incident 1 replay: without the skeleton the plane + root are absent (proving the class was real)", () => {
    const storyboard = incident1Storyboard();
    // Bare shells — the pre-Sentinel default — omit the plane and the root.
    const bare = storyboard
      .map(
        (s) =>
          `<section id="${s.id}" class="scene clip" data-scene="${s.id}" ` +
          `data-start="${s.startSec}" data-duration="${s.durationSec}" data-track-index="1">` +
          "…content…</section>",
      )
      .join("\n");
    const bareDoc = wrapSkeletonDoc([bare]);
    // The camera-world class was real: the L2 repair must wrap a plane, and the
    // component root is simply absent (a would-be blocking finding).
    expect(reconcileCameraWorldPlanes(bareDoc, storyboard).repairs).toBeGreaterThan(0);
    expect(bareDoc).not.toContain('data-part="cmd-palette"');
    // The skeleton supplies both, so no repair is needed and the root is present.
    const skeletonDoc = wrapSkeletonDoc(buildSceneSkeletons(storyboard));
    expect(reconcileCameraWorldPlanes(skeletonDoc, storyboard).repairs).toBe(0);
    expect(skeletonDoc).toContain('data-part="cmd-palette"');
  });

  it("component skeleton roots stamp the real id and the kit class", () => {
    const [paletteShell] = buildSceneSkeletons([
      scene("s", 0, {
        components: [
          { version: 1, id: "deploy-btn", kind: "button", role: "hero" },
        ],
      }),
    ]);
    expect(paletteShell).toContain('data-part="deploy-btn"');
    expect(paletteShell).toContain('data-component="button"');
    expect(paletteShell).toContain("cmp-button");
    // The exemplar's placeholder data-part is not leaked.
    expect(paletteShell).not.toContain('data-part="deploy-cta"');
  });
});

describe("repairMalformedFromToCalls — the s5-interactions call-shape class", () => {
  it("replays the exact s5 failure as a final-state .to(), never a reversed .from()", () => {
    const source =
      '<script>tl.fromTo("#runbook .cmp-stat", { opacity: 0, scale: 0.96 }, ' +
      '{ opacity: 0, scale: 0.96, duration: 0.01, immediateRender: true }, 13);' +
      'tl.fromTo("#runbook .cmp-stat", { opacity: 1, scale: 1, duration: 0.6, ease: "seqSettle" }, 15.8);</script>';
    const result = repairMalformedFromToCalls(source);
    expect(result.repairs).toBe(1);
    expect(result.toRepairs).toBe(1);
    expect(result.fromRepairs).toBe(0);
    expect(result.html).toContain(
      'tl.to("#runbook .cmp-stat", { opacity: 1, scale: 1, duration: 0.6, ease: "seqSettle" }, 15.8);',
    );
    expect(result.html.match(/fromTo/g)).toHaveLength(1); // the well-formed initializer remains
  });

  it("keeps a lone entrance-looking state blocking because it could be an exit .to()", () => {
    const source =
      'tl.fromTo("#hero", { opacity: 0, y: 40, scale: 0.9, duration: 0.6 }, 0.2);';
    const result = repairMalformedFromToCalls(source);
    expect(result.repairs).toBe(0);
    expect(result.ambiguous).toBe(1);
    expect(result.html).toBe(source);
  });

  it("replays the Vectorline live failure as a settled micro-pin .to()", () => {
    const source =
      `tl.fromTo("[data-part='hero-stat-card']", ` +
      `{ y: 0, opacity: 1, duration: 0.01, ease: "power3.out" }, 26.1);`;
    const result = repairMalformedFromToCalls(source);
    expect(result).toMatchObject({ repairs: 1, toRepairs: 1, ambiguous: 0 });
    expect(result.html).toBe(
      `tl.to("[data-part='hero-stat-card']", ` +
      `{ y: 0, opacity: 1, duration: 0.01, ease: "power3.out" }, 26.1);`,
    );
  });

  it("leaves mixed/cue-less direction ambiguous and blocking", () => {
    const source =
      'tl.fromTo("#mixed", { opacity: 1, y: 40, duration: 0.6 }, 1.2);\n' +
      'tl.fromTo("#color", { color: "#fff", duration: 0.4 }, 2);\n' +
      'tl.fromTo("#lone-final", { opacity: 1, scale: 1, duration: 0.4 }, 3);';
    const result = repairMalformedFromToCalls(source);
    expect(result.repairs).toBe(0);
    expect(result.ambiguous).toBe(3);
    expect(result.html).toBe(source);
  });

  it("never touches a well-formed fromTo (toVars present) or non-literal targets", () => {
    const wellFormed =
      'tl.fromTo("[data-part=\'ack\']",{opacity:0,y:40},{opacity:1,y:0,duration:1.2},0.2);\n' +
      "tl.fromTo(el, { opacity: 0 }, 1.5);"; // variable target — conservative skip
    const result = repairMalformedFromToCalls(wellFormed);
    expect(result.repairs).toBe(0);
    expect(result.html).toBe(wellFormed);
  });
});

describe("Probe 6 mechanical source syntax repairs", () => {
  it("quotes bare CSS var() values only inside executable inline scripts", () => {
    const source = [
      "<style>.button{color:var(--positive)}</style>",
      '<script type="application/json">{"css":"var(--positive)"}</script>',
      "<script>",
      "tl.to(button, { borderColor: var(--positive), color: var( --accent-soft ) }, 24.5);",
      "</script>",
    ].join("\n");
    const result = quoteBareCssVarsInInlineScripts(source);

    expect(result.repairs).toBe(2);
    expect(result.html).toContain(".button{color:var(--positive)}");
    expect(result.html).toContain('{"css":"var(--positive)"}');
    expect(result.html).toContain('borderColor: "var(--positive)"');
    expect(result.html).toContain('color: "var(--accent-soft)"');
  });

  it("removes an unbound SVG ellipsis path but preserves binding-bearing paths", () => {
    const source = [
      '<svg><path d="M0,100 C...,120 100" fill="url(#fill)"/>',
      '<path data-part="hero-line" d="M0,100 C...,120 100"/></svg>',
    ].join("");
    const result = stripInvalidSvgPathPlaceholders(source);

    expect(result.repairs).toBe(1);
    expect(result.html).not.toContain('fill="url(#fill)"');
    expect(result.html).toContain('data-part="hero-line"');
  });
});

describe("Sentinel Phase 1 — host plan islands are host-owned, always", () => {
  it("stripAllHostPlanIslands removes every host island unconditionally", () => {
    const withIslands = HOST_PLAN_ISLAND_IDS.map(
      (id) => `<script type="application/json" id="${id}">{"bogus":true}</script>`,
    ).join("\n");
    const result = stripAllHostPlanIslands(withIslands);
    expect(new Set(result.removed)).toEqual(new Set(HOST_PLAN_ISLAND_IDS));
    for (const id of HOST_PLAN_ISLAND_IDS) {
      expect(result.html).not.toContain(`id="${id}"`);
    }
  });

  it("counts only unmarked islands as model-authored — host-marked islands re-strip as plumbing", () => {
    const mixed = [
      '<script type="application/json" id="sequences-camera">{"model":true}</script>',
      '<script type="application/json" data-sequences-host="1" id="sequences-cuts">{"host":true}</script>',
    ].join("\n");
    const result = stripAllHostPlanIslands(mixed);
    // Both are stripped (host islands are host-owned, always)…
    expect(new Set(result.removed)).toEqual(new Set(["sequences-camera", "sequences-cuts"]));
    // …but only the unmarked one counts as a model-authored normalization.
    expect(result.removedModel).toEqual(["sequences-camera"]);
  });

  it("incident 2 replay: a model-authored shadow sequences-camera island is replaced with the canonical plan", () => {
    const storyboard = incident1Storyboard(); // carries a camera plan (stat-resolve)
    const dir = tempDir();
    const shadow =
      '<script type="application/json" id="sequences-camera">{"version":1,"scenes":"not-an-array"}</script>';
    const skeletons = buildSceneSkeletons(storyboard);
    const html = wrapSkeletonDoc([shadow, ...skeletons]);

    const repaired = applyDeterministicSourceRepairs({ storyboard, html }, dir, storyboard);

    // Exactly one camera island survives, and its scenes is a real array.
    const islands = [...repaired.html.matchAll(/id="sequences-camera"/g)];
    expect(islands.length).toBe(1);
    const body = extractIslandBody(repaired.html, "sequences-camera");
    expect(body).toBeDefined();
    const parsed = JSON.parse(body!);
    expect(Array.isArray(parsed.scenes)).toBe(true);
    expect(parsed.scenes.length).toBeGreaterThan(0);
  });

  it("incident 2 replay: a shadow sequences-interactions island with a bad version is removed when the plan has none", () => {
    const storyboard = incident1Storyboard(); // no interactions declared
    const dir = tempDir();
    const shadow =
      '<script type="application/json" id="sequences-interactions">{"version":9}</script>';
    const html = wrapSkeletonDoc([shadow, ...buildSceneSkeletons(storyboard)]);

    const repaired = applyDeterministicSourceRepairs({ storyboard, html }, dir, storyboard);

    // No interactions in the plan ⇒ the model's island is gone, not re-injected.
    expect(repaired.html).not.toContain('id="sequences-interactions"');
  });
});

describe("hasPausedTimeline — Sentinel Phase 1 false-reject fix", () => {
  it("accepts a paused timeline with a nested config object before paused", () => {
    expect(
      hasPausedTimeline('const tl = gsap.timeline({ defaults: { ease: "none" }, paused: true });'),
    ).toBe(true);
  });

  it("accepts the bare paused form", () => {
    expect(hasPausedTimeline("var tl = gsap.timeline({ paused: true });")).toBe(true);
  });

  it("rejects a timeline that is not paused (even with a nested config)", () => {
    expect(hasPausedTimeline('gsap.timeline({ defaults: { ease: "none" } });')).toBe(false);
  });
});

describe("typed component and interaction source ownership", () => {
  it("scopes centered ring value geometry away from stat-card values", () => {
    const source = `<!doctype html><html><head><style>
.cmp-value {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cmp-value { font-variant-numeric: tabular-nums; }
.cmp-ring .cmp-value { color: cyan; }
</style></head><body>
<div data-component="progress-ring"><div class="cmp-value">43%</div></div>
<div data-component="stat-card"><div class="cmp-value">94%</div></div>
</body></html>`;
    const result = scopeRingValueGeometryStyles(source);
    expect(result.repairs).toBe(1);
    expect(result.html).toContain(
      '[data-component="progress-ring"] .cmp-value {\n  position: absolute;',
    );
    expect(result.html).toContain(".cmp-value { font-variant-numeric: tabular-nums; }");
    expect(result.html).toContain(".cmp-ring .cmp-value { color: cyan; }");
  });

  it("does not guess when the geometry is not a centered ring signature", () => {
    const source = `<style>.cmp-value{position:absolute;inset:0}</style>` +
      `<div data-component="progress-ring"><div class="cmp-value"></div></div>` +
      `<div data-component="stat-card"><div class="cmp-value"></div></div>`;
    expect(scopeRingValueGeometryStyles(source)).toEqual({ html: source, repairs: 0 });
  });

  it("retires a class-only pointer actor but preserves a typing caret", () => {
    const source = `<!doctype html><html><body>` +
      `<main data-composition-id="proof">` +
      `<section data-scene="approval" data-start="0" data-duration="3">` +
      `<div class="cursor-indicator"></div><i class="typing-cursor"></i>` +
      `<button data-part="confirm">Confirm</button></section></main></body></html>`;
    const result = normalizeInteractionActors(source, [{
      version: 1,
      id: "confirm-click",
      sceneId: "approval",
      cursorId: "owner-cursor",
      targetPart: "confirm",
      action: "click",
      startSec: 1,
      arriveSec: 1.4,
      pressSec: 1.5,
      releaseSec: 1.65,
      from: "frame:bottom-right",
      path: "arc",
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press",
    }]);
    expect(result.html).toContain(
      'class="cursor-indicator" data-sequences-retired-cursor="owner-cursor"',
    );
    expect(result.html).toContain('<i class="typing-cursor"></i>');
    expect(result.html).not.toContain(
      'class="typing-cursor" data-sequences-retired-cursor',
    );
    expect(result.html).toContain("data-sequences-runtime-cursor");
  });
});
