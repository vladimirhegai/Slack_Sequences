import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditShapeMatchHints,
  dedupeFeedbackBySignature,
  degradeMismatchedShapeHintCuts,
  degradeVolunteeredBridgedCuts,
  ensureRuntimeScriptOrdering,
  findingSignature,
  reconcileComponentBindings,
  reconcileContractBindings,
  repairStrategyAfterStaticRejection,
  rewriteDegradedCutStoryboard,
  stripHostKitAssetReferences,
  topUpRowsMarkup,
  volunteeredCutBoundaries,
} from "../src/engine/compositionRunner.ts";
import { resolveCutPlan, validateCutContract } from "../src/engine/cutContract.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";

const roots: string[] = [];

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

  it("degrades a persistently unbindable volunteered shape-match to zoom-through", () => {
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
    expect(result!.storyboard[0]!.cut).toEqual({ version: 1, style: "zoom-through" });
    const island = result!.draft.html.match(
      /<script[^>]*id="sequences-cuts"[^>]*>([\s\S]*?)<\/script>/,
    );
    expect(island).toBeTruthy();
    expect(island![1]).toContain('"zoom-through"');
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
      "shape-match open->land",
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

  it("degrades a hopeless pair to zoom-through with honest prose", () => {
    const { scenes, degraded } = degradeMismatchedShapeHintCuts(
      hintedStoryboard("pill", "card"),
    );
    expect(degraded).toEqual(["open->land (pill->card)"]);
    expect(scenes[0]!.cut).toEqual({ version: 1, style: "zoom-through" });
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
      style: "zoom-through",
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
