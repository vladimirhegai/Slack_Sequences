import { describe, expect, it } from "vitest";
import { auditKitMarkupCompleteness } from "../src/engine/kitMarkupAudit.ts";
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

const KIND_FOR_BEAT = {
  chart: "chart-bars",
  rows: "table",
  progress: "progress",
} as const;

function chartScene(beatKind: "chart" | "rows" | "progress" = "chart"): DirectScene {
  return scene({
    id: "s1",
    startSec: 0,
    durationSec: 8,
    components: [{ version: 1, id: "revenue-chart", kind: KIND_FOR_BEAT[beatKind] }],
    beats: [
      {
        version: 1,
        id: "grow",
        sceneId: "s1",
        component: "revenue-chart",
        kind: beatKind,
        atSec: 2,
      },
    ],
  });
}

function doc(body: string): string {
  return `<!doctype html><html><head></head><body>
<main data-composition-id="c" data-width="1920" data-height="1080" data-duration="8">
${body}
</main></body></html>`;
}

describe("auditKitMarkupCompleteness", () => {
  it("accepts a chart with bar children and a complete scene graph", () => {
    const html = doc(`<section data-scene="s1" data-start="0" data-duration="8">
      <div class="cmp cmp-chart" data-component="chart-bar" data-part="revenue-chart">
        <i></i><i></i><i></i>
      </div>
    </section>`);
    expect(auditKitMarkupCompleteness(html, [chartScene()]).errors).toEqual([]);
  });

  it("names a chart beat whose component has neither bars nor a stroke", () => {
    const html = doc(`<section data-scene="s1" data-start="0" data-duration="8">
      <div class="cmp cmp-chart" data-component="chart-bar" data-part="revenue-chart"></div>
    </section>`);
    const { errors } = auditKitMarkupCompleteness(html, [chartScene()]);
    expect(errors.some((error) =>
      error.includes("kit_markup_incomplete") &&
      error.includes("chart beat") &&
      error.includes("revenue-chart"))).toBe(true);
  });

  it("accepts an svg stroke as chart evidence", () => {
    const html = doc(`<section data-scene="s1" data-start="0" data-duration="8">
      <div class="cmp cmp-chart" data-component="chart-bar" data-part="revenue-chart">
        <svg viewBox="0 0 100 40"><path d="M0 40 L100 0"></path></svg>
      </div>
    </section>`);
    expect(auditKitMarkupCompleteness(html, [chartScene()]).errors).toEqual([]);
  });

  it("names rows and progress beats with missing inner markup", () => {
    const emptyRows = doc(`<section data-scene="s1" data-start="0" data-duration="8">
      <div data-component="chart-bar" data-part="revenue-chart"></div>
    </section>`);
    expect(auditKitMarkupCompleteness(emptyRows, [chartScene("rows")]).errors
      .some((error) => error.includes("rows beat"))).toBe(true);
    expect(auditKitMarkupCompleteness(emptyRows, [chartScene("progress")]).errors
      .some((error) => error.includes("progress beat"))).toBe(true);
    const filled = doc(`<section data-scene="s1" data-start="0" data-duration="8">
      <div data-component="chart-bar" data-part="revenue-chart"><i></i></div>
    </section>`);
    expect(auditKitMarkupCompleteness(filled, [chartScene("progress")]).errors).toEqual([]);
  });

  it("reports a scene that exists in source text but not in the parsed DOM", () => {
    // The scene tag only lives inside a script string: visible to regex-based
    // validation, invisible to the browser's DOM — the 2026-07-04 repair bug.
    const html = doc(`<section data-scene="s1" data-start="0" data-duration="8">
      <div data-component="chart-bar" data-part="revenue-chart"><i></i></div>
    </section>
    <script>var ghost = '<section data-scene="s2" data-start="8" data-duration="4"></section>';</script>`);
    const scenes = [
      chartScene(),
      scene({ id: "s2", startSec: 8, durationSec: 4 }),
    ];
    const { errors } = auditKitMarkupCompleteness(html, scenes);
    expect(errors.some((error) =>
      error.includes("dom_markup_broken") && error.includes('"s2"'))).toBe(true);
  });

  it("reports a missing camera world and missing camera targets", () => {
    const scenes = [scene({
      id: "s1",
      startSec: 0,
      durationSec: 8,
      camera: {
        version: 1,
        path: [
          {
            version: 1,
            move: "pan",
            fromRegion: "intro",
            toRegion: "proof",
            startSec: 1,
            durationSec: 2,
          },
        ],
      },
    })];
    const noWorld = doc(`<section data-scene="s1" data-start="0" data-duration="8"></section>`);
    expect(auditKitMarkupCompleteness(noWorld, scenes).errors
      .some((error) => error.includes("data-camera-world"))).toBe(true);
    const noStation = doc(`<section data-scene="s1" data-start="0" data-duration="8">
      <div data-camera-world><div data-region="intro"></div></div>
    </section>`);
    expect(auditKitMarkupCompleteness(noStation, scenes).errors
      .some((error) => error.includes('data-region="proof"'))).toBe(true);
    const complete = doc(`<section data-scene="s1" data-start="0" data-duration="8">
      <div data-camera-world><div data-region="intro"></div><div data-region="proof"></div></div>
    </section>`);
    expect(auditKitMarkupCompleteness(complete, scenes).errors).toEqual([]);
  });

  it("reports a bridged cut whose focal part is absent from the DOM", () => {
    const scenes = [
      scene({
        id: "s1",
        startSec: 0,
        durationSec: 4,
        cut: {
          version: 1,
          style: "object-match",
          focalPartOut: "logo-out",
          focalPartIn: "logo-in",
        },
      }),
      scene({ id: "s2", startSec: 4, durationSec: 4 }),
    ];
    const html = doc(`<section data-scene="s1" data-start="0" data-duration="4">
      <div data-part="logo-out"></div>
    </section>
    <section data-scene="s2" data-start="4" data-duration="4"></section>`);
    const { errors } = auditKitMarkupCompleteness(html, scenes);
    expect(errors.some((error) =>
      error.includes('data-part="logo-in"') && error.includes('"s2"'))).toBe(true);
  });

  it("reports a morph whose twin is absent from the DOM", () => {
    const scenes = [scene({
      id: "s1",
      startSec: 0,
      durationSec: 8,
      components: [
        { version: 1, id: "search-bar", kind: "search" },
        { version: 1, id: "palette", kind: "command-palette" },
      ],
      beats: [{
        version: 1,
        id: "m1",
        sceneId: "s1",
        component: "search-bar",
        kind: "morph",
        atSec: 3,
        morphTo: "palette",
      }],
    })];
    const html = doc(`<section data-scene="s1" data-start="0" data-duration="8">
      <div class="cmp cmp-search" data-component="search" data-part="search-bar"></div>
    </section>`);
    const { errors } = auditKitMarkupCompleteness(html, scenes);
    expect(errors.some((error) =>
      error.includes("morph beat") && error.includes('"palette"'))).toBe(true);
  });
});
