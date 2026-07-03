import { describe, expect, it } from "vitest";
import {
  COMPONENT_CATALOG,
  COMPONENT_KIT_STYLE_ID,
  COMPONENT_RUNTIME_FILE,
  componentAuthoringReference,
  componentKitSource,
  componentMotionWindows,
  componentPlanningVocabulary,
  componentRuntimeSource,
  componentSupportsBeat,
  injectComponentKit,
  injectComponentRuntimeTag,
  normalizeStoryboardComponentBeats,
  normalizeStoryboardComponents,
  parseComponentPlan,
  resolveComponentPlan,
  validateComponentContract,
  type ComponentBeatIntentV1,
  type SceneComponentSpecV1,
} from "../src/engine/componentContract.ts";
import { analyzeMotionDensity } from "../src/engine/motionDensity.ts";
import { resolveMomentContract } from "../src/engine/storyboardMoments.ts";
import { buildFallbackComposition } from "../src/engine/fallbackComposition.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";

function scene(
  overrides: Partial<DirectScene> & Pick<DirectScene, "id" | "startSec" | "durationSec">,
): DirectScene {
  return {
    title: overrides.id,
    purpose: "test",
    ...overrides,
  };
}

const window = { sceneId: "s1", startSec: 0, durationSec: 8 };

function declared(...kinds: Array<[string, SceneComponentSpecV1["kind"]]>): SceneComponentSpecV1[] {
  return kinds.map(([id, kind]) => ({ version: 1, id, kind }));
}

describe("normalizeStoryboardComponents", () => {
  it("keeps valid declarations and drops unknown kinds, bad names, and duplicates", () => {
    const components = normalizeStoryboardComponents([
      { version: 1, id: "search-bar", kind: "search", region: "hero", role: "hero" },
      { version: 1, id: "search-bar", kind: "search" }, // duplicate id
      { version: 1, id: "mystery", kind: "hologram" }, // unknown kind
      { version: 1, id: "Bad Name!", kind: "table" }, // non-kebab id
    ]);
    expect(components).toEqual([
      { version: 1, id: "search-bar", kind: "search", region: "hero", role: "hero" },
    ]);
  });
});

describe("normalizeStoryboardComponentBeats", () => {
  const components = declared(["search-bar", "search"], ["palette", "command-palette"]);

  it("clamps timing into the scene window and sorts by atSec", () => {
    const beats = normalizeStoryboardComponentBeats([
      { version: 1, id: "b2", component: "search-bar", kind: "open", atSec: 99 },
      { version: 1, id: "b1", component: "search-bar", kind: "type", atSec: -2, text: "deploy" },
    ], window, components);
    expect(beats.map((beat) => beat.id)).toEqual(["b1", "b2"]);
    expect(beats[0]!.atSec).toBe(0);
    expect(beats[1]!.atSec).toBe(8);
  });

  it("drops beats referencing undeclared components or missing required args", () => {
    expect(normalizeStoryboardComponentBeats([
      { version: 1, id: "b1", component: "ghost", kind: "open", atSec: 1 },
      { version: 1, id: "b2", component: "search-bar", kind: "type", atSec: 1 }, // no text
      { version: 1, id: "b3", component: "search-bar", kind: "set-state", atSec: 1 }, // no toState
      { version: 1, id: "b4", component: "search-bar", kind: "morph", atSec: 1, morphTo: "search-bar" }, // self-morph
    ], window, components)).toEqual([]);
  });

  it("keeps a morph with an undeclared twin so plan validation can report it", () => {
    const beats = normalizeStoryboardComponentBeats([
      { version: 1, id: "b1", component: "search-bar", kind: "morph", atSec: 2, morphTo: "undeclared-twin" },
    ], window, components);
    expect(beats).toHaveLength(1);
    expect(beats[0]!.morphTo).toBe("undeclared-twin");
  });

  it("rejects unknown eases and clamps progress values into 0..1", () => {
    const beats = normalizeStoryboardComponentBeats([
      { version: 1, id: "b1", component: "search-bar", kind: "open", atSec: 1, ease: "madeUp" },
      { version: 1, id: "b2", component: "search-bar", kind: "highlight", atSec: 2, ease: "seqSettle" },
    ], window, components);
    expect(beats[0]!.ease).toBeUndefined();
    expect(beats[1]!.ease).toBe("seqSettle");
    const progress = normalizeStoryboardComponentBeats([
      { version: 1, id: "p1", component: "bar", kind: "progress", atSec: 1, value: 7 },
    ], window, declared(["bar", "progress"]));
    expect(progress[0]!.value).toBe(1);
  });
});

describe("resolveComponentPlan", () => {
  function planScene(beats: ComponentBeatIntentV1[], components?: SceneComponentSpecV1[]): DirectScene {
    return scene({
      id: "s1",
      startSec: 0,
      durationSec: 8,
      components: components ?? declared(["search-bar", "search"], ["palette", "command-palette"]),
      beats,
    });
  }

  it("applies per-kind ease/duration defaults and scales typing with text length", () => {
    const plan = resolveComponentPlan([planScene([
      { version: 1, id: "t1", sceneId: "s1", component: "search-bar", kind: "type", atSec: 1, text: "hello world query" },
      { version: 1, id: "o1", sceneId: "s1", component: "search-bar", kind: "open", atSec: 3 },
    ])]);
    expect(plan.scenes).toHaveLength(1);
    const [typeBeat, openBeat] = plan.scenes[0]!.beats;
    expect(typeBeat).toMatchObject({ kind: "type", ease: "none", startSec: 1 });
    expect(typeBeat!.endSec - typeBeat!.startSec).toBeCloseTo(17 * 0.055, 2);
    expect(openBeat).toMatchObject({ kind: "open", ease: "seqSettle" });
    expect(openBeat!.endSec - openBeat!.startSec).toBeCloseTo(0.5, 3);
  });

  it("clamps beats to the scene window and drops unsupported component/beat pairings", () => {
    const plan = resolveComponentPlan([planScene([
      { version: 1, id: "late", sceneId: "s1", component: "search-bar", kind: "open", atSec: 7.9 },
      { version: 1, id: "bad", sceneId: "s1", component: "search-bar", kind: "chart", atSec: 2 },
    ])]);
    const beats = plan.scenes[0]!.beats;
    expect(beats.map((beat) => beat.id)).toEqual(["late"]);
    expect(beats[0]!.endSec).toBeLessThanOrEqual(8);
  });

  it("returns an empty plan when no scene declares beats", () => {
    expect(resolveComponentPlan([scene({ id: "s1", startSec: 0, durationSec: 5 })]))
      .toEqual({ version: 1, scenes: [] });
  });
});

describe("kit and runtime injection", () => {
  it("injects the runtime tag after gsap and stays idempotent", () => {
    const html = `<head><script src="gsap.min.js"></script></head>`;
    const injected = injectComponentRuntimeTag(html);
    expect(injected).toContain(`src="${COMPONENT_RUNTIME_FILE}"`);
    expect(injectComponentRuntimeTag(injected)).toBe(injected);
  });

  it("injects the kit style before authored styles and refreshes a stale block", () => {
    const html = `<head><style>.mine{}</style></head>`;
    const injected = injectComponentKit(html);
    expect(injected.indexOf(COMPONENT_KIT_STYLE_ID)).toBeLessThan(injected.indexOf(".mine"));
    const stale = injected.replace(/data-version="1">/, 'data-version="1">/* stale */');
    const refreshed = injectComponentKit(stale);
    expect(refreshed).not.toContain("/* stale */");
    expect([...refreshed.matchAll(new RegExp(COMPONENT_KIT_STYLE_ID, "g"))]).toHaveLength(1);
  });
});

function componentScene(): DirectScene {
  return scene({
    id: "demo",
    startSec: 0,
    durationSec: 8,
    components: [
      { version: 1, id: "search-bar", kind: "search", role: "hero" },
      { version: 1, id: "palette", kind: "command-palette" },
    ],
    beats: [
      { version: 1, id: "typed", sceneId: "demo", component: "search-bar", kind: "type", atSec: 1, text: "deploy" },
      { version: 1, id: "morphed", sceneId: "demo", component: "search-bar", kind: "morph", atSec: 4, morphTo: "palette" },
    ],
  });
}

function componentHtml(options: {
  island?: string;
  runtime?: boolean;
  compile?: boolean;
  palette?: boolean;
  searchAttrs?: string;
} = {}): string {
  const island = options.island ??
    JSON.stringify(resolveComponentPlan([componentScene()]));
  return `<!doctype html><html><head><script src="gsap.min.js"></script>
${options.runtime === false ? "" : `<script src="${COMPONENT_RUNTIME_FILE}"></script>`}
</head><body>
<main data-composition-id="c" data-width="1920" data-height="1080" data-duration="8">
<section id="demo" data-scene="demo" data-start="0" data-duration="8">
<div class="cmp cmp-search" ${options.searchAttrs ?? 'data-component="search" data-part="search-bar"'}></div>
${options.palette === false ? "" : '<div class="cmp cmp-palette" data-component="command-palette" data-part="palette"></div>'}
</section></main>
<script type="application/json" id="sequences-components">${island}</script>
<script>const tl = gsap.timeline({paused:true});
${options.compile === false ? "" : "SequencesComponents.compile(tl, document.querySelector('[data-composition-id]'));"}
window.__timelines["c"]=tl;</script>
</body></html>`;
}

describe("validateComponentContract", () => {
  it("accepts a bound plan with runtime, compile call, and byte-equal island", () => {
    const result = validateComponentContract(componentHtml(), [componentScene()]);
    expect(result.errors).toEqual([]);
    expect(result.plan?.scenes[0]?.beats).toHaveLength(2);
  });

  it("blocks publication when the island, runtime, or compile call is missing", () => {
    const scenes = [componentScene()];
    const noIsland = componentHtml().replace(
      /<script type="application\/json" id="sequences-components">[\s\S]*?<\/script>/,
      "",
    );
    expect(validateComponentContract(noIsland, scenes).errors.some((error) =>
      error.includes("no sequences-components JSON island"))).toBe(true);
    expect(validateComponentContract(componentHtml({ runtime: false }), scenes).errors
      .some((error) => error.includes(COMPONENT_RUNTIME_FILE))).toBe(true);
    expect(validateComponentContract(componentHtml({ compile: false }), scenes).errors
      .some((error) => error.includes("SequencesComponents.compile"))).toBe(true);
  });

  it("rejects an island that drifted from the storyboard resolution", () => {
    const drifted = JSON.stringify({ version: 1, scenes: [] });
    const result = validateComponentContract(componentHtml({ island: drifted }), [componentScene()]);
    expect(result.errors.some((error) => error.includes("differs from the storyboard"))).toBe(true);
  });

  it("requires every declared component to bind to exactly one kind-marked element", () => {
    const scenes = [componentScene()];
    const missingPart = validateComponentContract(
      componentHtml({ searchAttrs: 'data-component="search"' }),
      scenes,
    );
    expect(missingPart.errors.some((error) =>
      error.includes('no data-part="search-bar"'))).toBe(true);
    const wrongKind = validateComponentContract(
      componentHtml({ searchAttrs: 'data-component="table" data-part="search-bar"' }),
      scenes,
    );
    expect(wrongKind.errors.some((error) =>
      error.includes('must carry data-component="search"'))).toBe(true);
    const morphTargetGone = validateComponentContract(
      componentHtml({ palette: false }),
      scenes,
    );
    expect(morphTargetGone.errors.length).toBeGreaterThan(0);
  });

  it("warns (never blocks) when kit classes or planned regions are missing", () => {
    const result = validateComponentContract(
      componentHtml({ searchAttrs: 'class="hand-rolled" data-component="search" data-part="search-bar"' })
        .replace('<div class="cmp cmp-search" class="hand-rolled"', '<div class="hand-rolled"'),
      [componentScene()],
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("cmp-search"))).toBe(true);
  });

  it("is silent for scenes without components", () => {
    const result = validateComponentContract(
      "<main data-composition-id='c'></main>",
      [scene({ id: "plain", startSec: 0, durationSec: 5 })],
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("component motion windows and density evidence", () => {
  it("exposes morph/open windows for layout-QA suppression", () => {
    const windows = componentMotionWindows(resolveComponentPlan([componentScene()]));
    expect(windows).toHaveLength(1); // the morph; type does not suppress QA
    expect(windows[0]!.start).toBeCloseTo(3.95, 2);
  });

  it("counts typed beats as medium activities that satisfy scene liveness", () => {
    const scenes = [
      componentScene(),
      scene({ id: "s2", startSec: 8, durationSec: 4 }),
      scene({ id: "s3", startSec: 12, durationSec: 4 }),
    ];
    const report = analyzeMotionDensity("", scenes, 16);
    const componentActivities = report.activities.filter((activity) =>
      activity.source.startsWith("component:"));
    expect(componentActivities).toHaveLength(2);
    expect(componentActivities.every((activity) => activity.kind === "medium")).toBe(true);
    expect(report.errors.some((error) => error.includes('scene "demo"'))).toBe(false);
  });

  it("binds declared moments to component beat evidence", () => {
    const withMoments: DirectScene = {
      ...componentScene(),
      moments: [{
        version: 1,
        id: "query-typed",
        sceneId: "demo",
        atSec: 1.2,
        title: "Query types in",
        visualState: "search shows the query",
        change: "the ask becomes concrete",
        motionIntent: "type-on",
        importance: "primary",
      }],
    };
    const contract = resolveMomentContract("", [withMoments], 8);
    expect(contract.moments[0]?.evidence?.kind).toBe("component");
  });
});

describe("catalog / kit / runtime coherence", () => {
  it("styles every catalog kind's class in the kit CSS", () => {
    const css = componentKitSource();
    for (const spec of COMPONENT_CATALOG) {
      expect(css, `missing .${spec.className}`).toContain(`.${spec.className}`);
    }
  });

  it("implements every beat kind in the runtime", () => {
    const js = componentRuntimeSource();
    for (const kind of [
      "type", "stream", "count", "progress", "chart", "rows", "open", "close",
      "select", "press", "set-state", "highlight", "swap",
    ]) {
      expect(js, `missing compiler for ${kind}`).toMatch(
        new RegExp(`["']?${kind.replace("-", "\\-")}["']?\\s*:\\s*compile`),
      );
    }
    expect(js).toContain("compileMorph");
    expect(js).not.toMatch(/Math\.random|Date\.now|setTimeout|requestAnimationFrame/);
  });

  it("keeps the kit CSS free of transitions and animations", () => {
    const css = componentKitSource();
    expect(css).not.toMatch(/\btransition\s*:/);
    expect(css).not.toMatch(/\banimation\s*:|@keyframes/);
  });

  it("declares markup with matching data-component and supported beats", () => {
    for (const spec of COMPONENT_CATALOG) {
      expect(spec.markup).toContain(`data-component="${spec.kind}"`);
      expect(spec.markup).toContain("data-part=");
      for (const beat of spec.beats) {
        expect(componentSupportsBeat(spec.kind, beat)).toBe(true);
      }
    }
  });

  it("renders bounded planning vocabulary and an authoring reference", () => {
    const vocabulary = componentPlanningVocabulary();
    expect(vocabulary.length).toBeLessThan(4_000);
    expect(vocabulary).toContain("stat-card");
    const reference = componentAuthoringReference();
    expect(reference).toContain("cmp-window");
    expect(reference).toContain("SequencesComponents.compile");
  });

  it("scopes the authoring reference to the declared kinds", () => {
    const reference = componentAuthoringReference(["search", "stat-card"]);
    expect(reference).toContain("cmp-search");
    expect(reference).toContain("cmp-stat");
    expect(reference).not.toContain("cmp-window");
    expect(componentAuthoringReference([])).toBe("");
  });
});

describe("deterministic fallback proof", () => {
  it("ships a typed component beat with island, runtime, kit, and compile call", () => {
    const draft = buildFallbackComposition({
      product: "RADAR",
      whatShipped: "One live operational view.",
      lengthSec: 20,
    });
    expect(draft.html).toContain(`src="${COMPONENT_RUNTIME_FILE}"`);
    expect(draft.html).toContain(COMPONENT_KIT_STYLE_ID);
    expect(draft.html).toContain("SequencesComponents.compile");
    const result = validateComponentContract(draft.html, draft.storyboard);
    expect(result.errors).toEqual([]);
    expect(result.plan?.scenes[0]?.beats[0]).toMatchObject({
      kind: "progress",
      component: "release-progress",
    });
  });

  it("parses the island back to the resolved plan", () => {
    const draft = buildFallbackComposition({
      product: "RADAR",
      whatShipped: "One live operational view.",
      lengthSec: 20,
    });
    const parsed = parseComponentPlan(draft.html);
    expect(parsed.errors).toEqual([]);
    expect(parsed.plan).toEqual(resolveComponentPlan(draft.storyboard));
  });
});
