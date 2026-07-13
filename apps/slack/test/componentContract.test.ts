import { describe, expect, it } from "vitest";
import {
  COMPACT_POP_KINDS,
  COMPONENT_CATALOG,
  COMPONENT_KIT_STYLE_ID,
  COMPONENT_RUNTIME_FILE,
  DEFAULT_COMPONENT_FOLLOW_LAG_MS,
  MAX_COMPONENT_EXIT_RECEDE_PERCENT,
  MAX_COMPONENT_FOLLOW_CHAIN_DEPTH,
  MAX_COMPONENT_FOLLOW_LAG_MS,
  MIN_COMPONENT_FOLLOW_LAG_MS,
  MAX_POP_OPENS_PER_SCENE,
  auditComponentComplexity,
  auditSurfaceExits,
  componentAuthoringReference,
  componentKindsMorphCompatible,
  dedupeRedundantBeats,
  degradeOpenPopStyles,
  componentKitSource,
  componentMotionWindows,
  componentPlanningVocabulary,
  componentRuntimeSource,
  componentSupportsBeat,
  injectComponentKit,
  injectComponentRuntimeTag,
  normalizeStoryboardComponentBeats,
  normalizeStoryboardComponentEntranceFamily,
  normalizeStoryboardComponents,
  parseComponentPlan,
  reconcileMetricComponentKinds,
  retimeLateLoadBearingEntrances,
  resolveComponentPlan,
  topUpHeldInteractionResultDevelopment,
  trimOverBudgetComponents,
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

describe("component morph families", () => {
  it("treats two declared instances of one kind as semantic peers", () => {
    expect(componentKindsMorphCompatible("button", "button")).toBe(true);
    expect(componentKindsMorphCompatible("stat-card", "stat-card")).toBe(true);
    expect(componentKindsMorphCompatible("search", "command-palette")).toBe(true);
    expect(componentKindsMorphCompatible("button", "progress-ring")).toBe(false);
    expect(componentPlanningVocabulary()).toContain("button:");
    expect(componentPlanningVocabulary()).toContain("morphs↔same-kind");
  });
});

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

describe("reconcileMetricComponentKinds", () => {
  it("upgrades only a counted metric headline to a stat card", () => {
    const components: SceneComponentSpecV1[] = [
      { version: 1, id: "score", kind: "headline", entityId: "metric" },
      { version: 1, id: "title", kind: "headline", entityId: "metric" },
      { version: 1, id: "copy", kind: "headline" },
    ];
    const beats: ComponentBeatIntentV1[] = [{
      version: 1,
      id: "score-count",
      sceneId: "proof",
      component: "score",
      kind: "count",
      atSec: 1,
      value: 66,
    }];
    const result = reconcileMetricComponentKinds(components, beats);
    expect(result.components.map((component) => component.kind)).toEqual([
      "stat-card",
      "headline",
      "headline",
    ]);
    expect(result.normalized).toHaveLength(1);
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

  it("recovers scene-relative beat times in later shots", () => {
    const beats = normalizeStoryboardComponentBeats([
      { version: 1, id: "b1", component: "search-bar", kind: "type", atSec: 1.4, text: "latency" },
    ], { sceneId: "later", startSec: 6, durationSec: 4 }, components);
    expect(beats[0]!.atSec).toBe(7.4);
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

  it("normalizes follows references and clamps optional lag to 60..120ms", () => {
    const beats = normalizeStoryboardComponentBeats([
      { id: "lead", component: "search-bar", kind: "open", atSec: 1 },
      { id: "fast", component: "search-bar", kind: "highlight", atSec: 2, follows: "lead", lagMs: 5 },
      { id: "slow", component: "search-bar", kind: "highlight", atSec: 3, follows: "palette", lagMs: 900 },
      { id: "bad", component: "search-bar", kind: "highlight", atSec: 4, follows: "Bad ref!", lagMs: 90 },
    ], window, components);
    expect(beats[1]).toMatchObject({ follows: "lead", lagMs: MIN_COMPONENT_FOLLOW_LAG_MS });
    expect(beats[2]).toMatchObject({ follows: "palette", lagMs: MAX_COMPONENT_FOLLOW_LAG_MS });
    expect(beats[3]!.follows).toBeUndefined();
    expect(beats[3]!.lagMs).toBeUndefined();
  });

  it("accepts only the three scene entrance families", () => {
    expect(normalizeStoryboardComponentEntranceFamily(" RISE ")).toBe("rise");
    expect(normalizeStoryboardComponentEntranceFamily("assemble")).toBe("assemble");
    expect(normalizeStoryboardComponentEntranceFamily("materialize")).toBe("materialize");
    expect(normalizeStoryboardComponentEntranceFamily("scatter")).toBeUndefined();
  });
});

describe("retimeLateLoadBearingEntrances", () => {
  it("moves an existing hero rows entrance into the opening runway and carries its moment", () => {
    const result = retimeLateLoadBearingEntrances([
      scene({
        id: "review",
        startSec: 0,
        durationSec: 4,
        cut: {
          version: 1,
          style: "morph",
          focalPartOut: "confirm-pill",
          focalPartIn: "confirmed-row",
        },
      }),
      scene({
        id: "confirmation",
        startSec: 4,
        durationSec: 6,
        components: [{
          version: 1,
          id: "confirmation-list",
          kind: "list",
          role: "hero",
          region: "confirmation-stage",
        }],
        beats: [{
          version: 1,
          id: "rows-arrive",
          sceneId: "confirmation",
          component: "confirmation-list",
          kind: "rows",
          atSec: 5.8,
          durationSec: 1.2,
        }],
        moments: [{
          version: 1,
          id: "rows-readable",
          sceneId: "confirmation",
          atSec: 5.8,
          title: "Confirmed rows arrive",
          visualState: "The confirmed list is readable",
          change: "The existing rows resolve",
          motionIntent: "reveal",
          importance: "primary",
        }],
        camera: {
          version: 1,
          path: [{
            version: 1,
            move: "pull-back",
            startSec: 4,
            durationSec: 2,
            toRegion: "confirmation-stage",
          }],
        },
        spatialIntent: {
          version: 1,
          focalPart: "confirmation-list",
          composition: "centered confirmation",
          relationships: [],
        },
      }),
    ]);

    expect(result.scenes[1]!.beats![0]!.atSec).toBe(4.48);
    expect(result.scenes[1]!.moments![0]!.atSec).toBe(4.48);
    expect(result.normalized).toHaveLength(1);
    expect(result.normalized[0]).toContain("cannot leave the opening station blank");
    expect(result.scenes[1]!.sentinelNormalizations?.[0]).toContain("entrance-retime:");
  });

  it("does not pull a deliberate late CTA open forward", () => {
    const late = scene({
      id: "close",
      startSec: 0,
      durationSec: 6,
      components: [{ version: 1, id: "cta", kind: "button", role: "hero", region: "cta-stage" }],
      beats: [{
        version: 1,
        id: "cta-opens",
        sceneId: "close",
        component: "cta",
        kind: "open",
        atSec: 4.2,
      }],
      camera: {
        version: 1,
        path: [{ version: 1, move: "hold", startSec: 0, durationSec: 3, toRegion: "metric-stage" }],
      },
      spatialIntent: { version: 1, focalPart: "metric", composition: "metric then CTA", relationships: [] },
    });
    const result = retimeLateLoadBearingEntrances([late]);
    expect(result.scenes[0]!.beats![0]!.atSec).toBe(4.2);
    expect(result.normalized).toEqual([]);
  });

  it("leaves a later rows refresh in place when the component already entered", () => {
    const refresh = scene({
      id: "feed",
      startSec: 0,
      durationSec: 6,
      components: [{ version: 1, id: "activity", kind: "list", role: "hero" }],
      beats: [
        { version: 1, id: "initial", sceneId: "feed", component: "activity", kind: "rows", atSec: 0.4 },
        { version: 1, id: "new-page", sceneId: "feed", component: "activity", kind: "rows", atSec: 4.2 },
      ],
      spatialIntent: { version: 1, focalPart: "activity", composition: "live feed", relationships: [] },
    });
    const result = retimeLateLoadBearingEntrances([refresh]);
    expect(result.scenes[0]!.beats!.map((beat) => beat.atSec)).toEqual([0.4, 4.2]);
    expect(result.normalized).toEqual([]);
  });

  it("keeps supporting rows as mid-shot development when they only share the hero region", () => {
    const review = scene({
      id: "review",
      startSec: 4,
      durationSec: 5.6,
      components: [
        { version: 1, id: "date-card", kind: "app-window", role: "support", region: "review-stage" },
        { version: 1, id: "confirm", kind: "button", role: "hero", region: "review-stage" },
      ],
      beats: [{
        version: 1,
        id: "metadata-shift",
        sceneId: "review",
        component: "date-card",
        kind: "rows",
        atSec: 5.8,
      }],
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "push-in",
          startSec: 4,
          durationSec: 2,
          toRegion: "review-stage",
        }],
      },
      spatialIntent: {
        version: 1,
        focalPart: "confirm",
        composition: "support develops under the hero",
        relationships: [],
      },
    });
    const result = retimeLateLoadBearingEntrances([review]);
    expect(result.scenes[0]!.beats![0]!.atSec).toBe(5.8);
    expect(result.normalized).toEqual([]);
  });
});

describe("resolveComponentPlan", () => {
  it("starts a repeated metric from the prior resolved continuity value", () => {
    const metric = (id: string, startSec: number, part: string, value: number): DirectScene => ({
      id,
      title: id,
      purpose: "advance a persistent metric",
      startSec,
      durationSec: 3,
      components: [{ version: 1, id: part, kind: "stat-card", entityId: "score" }],
      beats: [{
        version: 1, id: `${part}-count`, sceneId: id, component: part,
        kind: "count", atSec: startSec + 0.5, durationSec: 1, value,
      }],
    });
    const plan = resolveComponentPlan([
      { ...metric("one", 0, "score-a", 38), cut: { version: 1, style: "swipe", axis: "left" } },
      metric("two", 3, "score-b", 71),
    ]);
    expect(plan.scenes[1]?.initialStates).toEqual([
      { component: "score-b", state: { kind: "metric", value: 38 } },
    ]);
    expect(plan.scenes[1]?.beats[0]).toMatchObject({ value: 71, fromValue: 38 });
    expect(parseComponentPlan(
      `<script type="application/json" id="sequences-components">${JSON.stringify(plan)}</script>`,
    )).toEqual({ plan, errors: [] });
  });

  it("initializes a metric after an intervening continuity hold", () => {
    const metric = (
      id: string,
      startSec: number,
      part: string,
      value?: number,
    ): DirectScene => ({
      id,
      title: id,
      purpose: "hold one persistent score",
      startSec,
      durationSec: 3,
      components: [{ version: 1, id: part, kind: "stat-card", entityId: "score" }],
      ...(value === undefined
        ? {}
        : {
            beats: [{
              version: 1 as const,
              id: `${part}-count`,
              sceneId: id,
              component: part,
              kind: "count" as const,
              atSec: startSec + 0.5,
              durationSec: 1,
              value,
            }],
          }),
    });
    const plan = resolveComponentPlan([
      metric("one", 0, "score-a", 38),
      metric("hold", 3, "score-b"),
      metric("three", 6, "score-c", 94),
    ]);

    expect(plan.scenes.find((scene) => scene.sceneId === "hold")?.initialStates)
      .toEqual([{ component: "score-b", state: { kind: "metric", value: 38 } }]);
    expect(plan.scenes.find((scene) => scene.sceneId === "three")?.beats[0])
      .toMatchObject({ value: 94, fromValue: 38 });
  });
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

  it("compiles beat-id/component follows with bounded lag, subtle ease, and last settle", () => {
    const plan = resolveComponentPlan([planScene([
      {
        version: 1, id: "lead", sceneId: "s1", component: "metric", kind: "count",
        atSec: 1, durationSec: 1,
      },
      {
        version: 1, id: "chart", sceneId: "s1", component: "growth", kind: "chart",
        atSec: 5, durationSec: 0.6, follows: "lead", lagMs: 60,
      },
      {
        version: 1, id: "rows", sceneId: "s1", component: "orders", kind: "rows",
        atSec: 6, durationSec: 0.5, follows: "growth",
      },
    ], declared(["metric", "stat-card"], ["growth", "chart-bars"], ["orders", "table"]))]);
    const [lead, chart, rows] = plan.scenes[0]!.beats;
    expect(chart).toMatchObject({
      follows: "lead", lagMs: 60, followDepth: 1, startSec: 1.06, ease: "sine.out",
    });
    expect(chart!.endSec).toBeGreaterThan(lead!.endSec);
    expect(rows).toMatchObject({
      follows: "growth", lagMs: DEFAULT_COMPONENT_FOLLOW_LAG_MS,
      followDepth: 2, startSec: 1.15, ease: "sine.out",
    });
    expect(rows!.endSec).toBeGreaterThan(chart!.endSec);
  });

  it("degrades a follow that would overlap one component's same property channel", () => {
    const plan = resolveComponentPlan([planScene([
      { version: 1, id: "ring-a", sceneId: "s1", component: "cta", kind: "highlight", atSec: 1 },
      {
        version: 1, id: "ring-b", sceneId: "s1", component: "cta", kind: "highlight",
        atSec: 3, follows: "ring-a",
      },
    ], declared(["cta", "button"]))]);
    expect(plan.scenes[0]!.beats[1]).toMatchObject({ id: "ring-b", startSec: 3 });
    expect(plan.scenes[0]!.beats[1]!.follows).toBeUndefined();
  });

  it("degrades cycles, missing leads, and relationships beyond the depth cap", () => {
    const beat = (
      id: string,
      atSec: number,
      follows?: string,
    ): ComponentBeatIntentV1 => ({
      version: 1, id, sceneId: "s1", component: `${id}-cmp`, kind: "highlight", atSec,
      ...(follows ? { follows } : {}),
    });
    const ids = ["a", "b", "c", "d", "over-depth", "cycle-a", "cycle-b", "missing"];
    const components: SceneComponentSpecV1[] = ids.map((id) => ({
      version: 1, id: `${id}-cmp`, kind: "button",
    }));
    const plan = resolveComponentPlan([planScene([
      beat("a", 1),
      beat("b", 2, "a"),
      beat("c", 3, "b"),
      beat("d", 4, "c"),
      beat("over-depth", 5, "d"),
      beat("cycle-a", 6, "cycle-b"),
      beat("cycle-b", 6.5, "cycle-a"),
      beat("missing", 7, "ghost"),
    ], components)]);
    const byId = new Map(plan.scenes[0]!.beats.map((entry) => [entry.id, entry]));
    expect(byId.get("d")?.followDepth).toBe(MAX_COMPONENT_FOLLOW_CHAIN_DEPTH);
    expect(byId.get("over-depth")).toMatchObject({ startSec: 5 });
    expect(byId.get("over-depth")?.follows).toBeUndefined();
    expect(byId.get("cycle-a")).toMatchObject({ startSec: 6 });
    expect(byId.get("cycle-b")).toMatchObject({ startSec: 6.5 });
    expect(byId.get("cycle-a")?.follows).toBeUndefined();
    expect(byId.get("cycle-b")?.follows).toBeUndefined();
    expect(byId.get("missing")).toMatchObject({ startSec: 7 });
    expect(byId.get("missing")?.follows).toBeUndefined();
  });

  it("resolves one scene entrance family into offset free-component windows", () => {
    const storyboard = scene({
      id: "family",
      startSec: 0,
      durationSec: 6,
      componentEntranceFamily: "assemble",
      components: [
        { version: 1, id: "early", kind: "button" },
        { version: 1, id: "matrix", kind: "table" },
        { version: 1, id: "plugin-tile", kind: "stat-card", pluginUid: "family-plugin" },
        { version: 1, id: "source", kind: "search" },
        { version: 1, id: "target", kind: "command-palette" },
      ],
      beats: [
        { version: 1, id: "early-open", sceneId: "family", component: "early", kind: "open", atSec: 0.4 },
        { version: 1, id: "later-morph", sceneId: "family", component: "source", kind: "morph", morphTo: "target", atSec: 3 },
      ],
    });
    const scenePlan = resolveComponentPlan([storyboard]).scenes[0]!;
    expect(scenePlan.entranceFamily).toBe("assemble");
    expect(scenePlan.entrances?.map((entry) => entry.component)).toEqual(["matrix", "source"]);
    expect(scenePlan.entrances?.[1]!.startSec).toBeGreaterThan(scenePlan.entrances?.[0]!.startSec ?? 0);
    expect(scenePlan.entrances?.every((entry) => entry.ease === "power3.out")).toBe(true);

    const familyOnly = resolveComponentPlan([scene({
      id: "material",
      startSec: 6,
      durationSec: 3,
      componentEntranceFamily: "materialize",
      components: declared(["matrix", "table"]),
    })]).scenes[0]!;
    expect(familyOnly.beats).toEqual([]);
    expect(familyOnly.entrances?.[0]).toMatchObject({ component: "matrix", ease: "sine.out" });
  });

  it("derives subtle directional close metadata from the outgoing swipe", () => {
    const plan = resolveComponentPlan([scene({
      id: "exit",
      startSec: 0,
      durationSec: 5,
      components: declared(["search", "search"]),
      beats: [{
        version: 1, id: "retire", sceneId: "exit", component: "search", kind: "close",
        atSec: 4, ease: "expo.out",
      }],
      cut: { version: 1, style: "swipe", axis: "up" },
    })]);
    expect(plan.scenes[0]!.beats[0]).toMatchObject({
      kind: "close",
      ease: "power2.in",
      exitAxis: "up",
      exitRecedePercent: 18,
    });
    expect(plan.scenes[0]!.beats[0]!.exitRecedePercent)
      .toBeLessThanOrEqual(MAX_COMPONENT_EXIT_RECEDE_PERCENT);
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

  it("round-trips a beat's style so a styled film's island stays byte-equal (md-audit-probe-1)", () => {
    // resolveComponentPlan emits the MD3/MD6 `style` variant and the runtime
    // reads it; parseComponentPlan MUST parse it back or the island-equality
    // check rejects every styled film — the exact defect md-audit-probe-1 hit
    // (wordmark-slam pop, subline rise, cta pop, cta underline all dropped).
    const styledScene = scene({
      id: "hero",
      startSec: 0,
      durationSec: 6,
      components: declared(["hero-copy", "headline"], ["cta", "button"]),
      beats: [
        { version: 1, id: "name", sceneId: "hero", component: "hero-copy", kind: "type", atSec: 0.6, durationSec: 1.6, text: "SHIPFAST", style: "assemble" },
        { version: 1, id: "cta-pop", sceneId: "hero", component: "cta", kind: "open", atSec: 3.5, style: "pop" },
      ],
    });
    const resolved = resolveComponentPlan([styledScene]);
    expect(resolved.scenes[0]?.beats.map((entry) => entry.style)).toEqual(["assemble", "pop"]);
    const island = JSON.stringify(resolved);
    const parsed = parseComponentPlan(
      `<script type="application/json" id="sequences-components">${island}</script>`,
    );
    expect(parsed.errors).toEqual([]);
    expect(JSON.stringify(parsed.plan)).toBe(island);
    const html =
      `<main data-composition-id="x"><section data-scene="hero">` +
      `<h1 class="cmp cmp-headline" data-component="headline" data-part="hero-copy"><span class="cmp-text" data-cmp-text>SHIPFAST</span></h1>` +
      `<button class="cmp cmp-button" data-component="button" data-part="cta"><span class="cmp-label">Go</span></button></section>` +
      `<script src="${COMPONENT_RUNTIME_FILE}"></script>` +
      `<script type="application/json" id="sequences-components">${island}</script>` +
      `<script>SequencesComponents.compile(tl, root);</script></main>`;
    expect(validateComponentContract(html, [styledScene]).errors).toEqual([]);
  });

  it("round-trips entrance, follows, and directional-exit additions in the v1 island", () => {
    const choreographyScene = scene({
      id: "choreo",
      startSec: 0,
      durationSec: 5,
      componentEntranceFamily: "rise",
      components: declared(["matrix", "table"], ["search", "search"]),
      beats: [
        { version: 1, id: "rows", sceneId: "choreo", component: "matrix", kind: "rows", atSec: 1 },
        {
          version: 1, id: "retire", sceneId: "choreo", component: "search", kind: "close",
          atSec: 4, follows: "rows", lagMs: 120,
        },
      ],
      cut: { version: 1, style: "swipe", axis: "right" },
    });
    const resolved = resolveComponentPlan([choreographyScene]);
    const island = JSON.stringify(resolved);
    const parsed = parseComponentPlan(
      `<script type="application/json" id="sequences-components">${island}</script>`,
    );
    expect(parsed.errors).toEqual([]);
    expect(JSON.stringify(parsed.plan)).toBe(island);
    expect(parsed.plan?.scenes[0]?.entranceFamily).toBe("rise");
    expect(parsed.plan?.scenes[0]?.beats[1]).toMatchObject({
      follows: "rows", lagMs: 120, followDepth: 1,
      exitAxis: "right", exitRecedePercent: 18,
    });
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

  it("ignores data-part strings in trailing scripts after a closed scene", () => {
    const html = componentHtml().replace(
      "</body>",
      '<script>const template = `<div data-part="search-bar"></div>`;</script></body>',
    );
    expect(validateComponentContract(html, [componentScene()]).errors).toEqual([]);
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
    expect(windows).toHaveLength(1); // the morph; plain typewriter type does not suppress QA
    expect(windows[0]!.start).toBeCloseTo(3.95, 2);
  });

  it("exposes host entrance-family windows for layout-QA suppression", () => {
    const plan = resolveComponentPlan([scene({
      id: "family-window",
      startSec: 2,
      durationSec: 4,
      componentEntranceFamily: "materialize",
      components: declared(["stat", "stat-card"], ["table", "table"]),
    })]);
    const entrances = plan.scenes[0]!.entrances!;
    const windows = componentMotionWindows(plan);
    expect(windows).toHaveLength(entrances.length);
    expect(windows[0]).toEqual({
      start: entrances[0]!.startSec - 0.05,
      end: entrances[0]!.endSec + 0.1,
    });
  });

  it("suppresses layout QA during a split-style headline entrance (MD3 scatter)", () => {
    // A plain typewriter type stays audited; a rise/pop/assemble type displaces
    // letters transiently (assemble scatters ~96px) before converging to the
    // authored copy, so its entrance window is a designed-motion suppression.
    const styledScene = scene({
      id: "hero",
      startSec: 0,
      durationSec: 6,
      components: declared(["hero-copy", "headline"]),
      beats: [
        { version: 1, id: "plain", sceneId: "hero", component: "hero-copy", kind: "type", atSec: 0.5, durationSec: 1, text: "hi" },
        { version: 1, id: "assemble", sceneId: "hero", component: "hero-copy", kind: "type", atSec: 2, durationSec: 1.5, text: "SHIPFAST", style: "assemble" },
      ],
    });
    const windows = componentMotionWindows(resolveComponentPlan([styledScene]));
    // Only the assemble window is exposed — the plain type is still audited.
    expect(windows).toHaveLength(1);
    expect(windows[0]!.start).toBeCloseTo(1.95, 2);
  });

  it("suppresses layout QA during in-place component motion (swap/count/highlight)", () => {
    // probe-audit-01: a swap crossfade (absolute .cmp-swap-new over the slot), a
    // count (value text reflows every frame) and a highlight (ring pulse) perturb
    // a surface's OWN internal geometry, which the vendored static overlap/overflow
    // heuristics misread as "two text blocks overlap"/"container overflow". Those
    // beats now get a designed-motion suppression window like morph/open/close; a
    // plain cursor `press` (audited by interaction QA) still does NOT suppress.
    const inPlaceScene = scene({
      id: "resolve",
      startSec: 0,
      durationSec: 8,
      components: declared(["stat", "stat-card"], ["cta", "headline"], ["btn", "button"]),
      beats: [
        { version: 1, id: "count", sceneId: "resolve", component: "stat", kind: "count", atSec: 1, durationSec: 1.5, value: 47 },
        { version: 1, id: "hl", sceneId: "resolve", component: "stat", kind: "highlight", atSec: 3, durationSec: 0.8 },
        { version: 1, id: "swap", sceneId: "resolve", component: "cta", kind: "swap", atSec: 5, durationSec: 0.5, text: "Ship with momentum" },
        { version: 1, id: "press", sceneId: "resolve", component: "btn", kind: "press", atSec: 6.5, durationSec: 0.4 },
      ],
    });
    const windows = componentMotionWindows(resolveComponentPlan([inPlaceScene]))
      .sort((a, b) => a.start - b.start);
    // count + highlight + swap suppress; the plain press stays audited.
    expect(windows).toHaveLength(3);
    expect(windows[0]!.start).toBeCloseTo(0.95, 2); // count: 1 - 0.05
    expect(windows[0]!.end).toBeCloseTo(2.6, 2); //    count end: 2.5 + 0.1
    expect(windows[1]!.start).toBeCloseTo(2.95, 2); // highlight: 3 - 0.05
    expect(windows[2]!.start).toBeCloseTo(4.95, 2); // swap: 5 - 0.05
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
    expect(js).toContain("compileSceneEntrances");
    expect(js).toContain("exitRecedePercent");
    expect(js).toContain("assembleEntranceOffset");
    expect(js).toContain("compileSettleBlooms");
    expect(js).toContain("cmp-settle-bloom");
    expect(js).toContain('beat.kind === "close"');
    expect(js).not.toContain("el.style.filter");
    expect(js).toContain('return ":scope > " + entry.trim()');
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

  it("supports streamed terminal confirmation output", () => {
    expect(componentSupportsBeat("terminal", "stream")).toBe(true);
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

describe("topUpHeldInteractionResultDevelopment", () => {
  const heldApproval = (): DirectScene => scene({
    id: "approval",
    startSec: 10,
    durationSec: 6,
    camera: {
      version: 1,
      path: [{ version: 1, move: "hold", startSec: 10, durationSec: 6, toRegion: "approval" }],
    },
    components: [{ version: 1, id: "confirm", kind: "button", region: "approval" }],
    beats: [{
      version: 1,
      id: "confirm-ready",
      sceneId: "approval",
      component: "confirm",
      kind: "set-state",
      atSec: 12,
      toState: "succeeded",
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
        id: "cursor-arrives",
        sceneId: "approval",
        atSec: 11.5,
        title: "Cursor arrives",
        visualState: "Cursor is on confirm",
        change: "Confirmation begins",
        motionIntent: "interaction",
        importance: "primary",
      },
      {
        version: 1,
        id: "ready",
        sceneId: "approval",
        atSec: 12,
        title: "Ready",
        visualState: "Confirmation succeeded",
        change: "Result is ready",
        motionIntent: "resolve",
        importance: "primary",
      },
    ],
  });

  it("adds one late typed highlight to a successful result held under a camera lock", () => {
    const result = topUpHeldInteractionResultDevelopment([heldApproval()]);
    expect(result.normalized).toHaveLength(1);
    expect(result.scenes[0]!.beats).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "approval-held-result-highlight",
        component: "confirm",
        kind: "highlight",
        atSec: 14.4,
        durationSec: 0.8,
        style: "ring",
      }),
    ]));
    expect(topUpHeldInteractionResultDevelopment(result.scenes)).toEqual({
      scenes: result.scenes,
      normalized: [],
    });
  });

  it("binds an unsupported late held-result moment after an early push and drift", () => {
    const candidate = heldApproval();
    candidate.camera = {
      version: 1,
      path: [
        {
          version: 1,
          move: "push-in",
          startSec: 10,
          durationSec: 1,
          toRegion: "approval",
        },
        {
          version: 1,
          move: "drift",
          startSec: 11,
          durationSec: 5,
        },
      ],
    };
    candidate.beats![0] = { ...candidate.beats![0]!, toState: "succeed" };
    candidate.moments!.push({
      version: 1,
      id: "ready-holds",
      sceneId: "approval",
      atSec: 15.5,
      title: "Ready state holds",
      visualState: "Confirmation remains ready under the held frame",
      change: "The successful result settles without a new surface",
      motionIntent: "resolve",
      importance: "supporting",
    });

    const result = topUpHeldInteractionResultDevelopment([candidate]);
    expect(result.normalized).toHaveLength(1);
    expect(result.scenes[0]!.beats).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "approval-held-result-highlight",
        component: "confirm",
        kind: "highlight",
        atSec: 14.4,
        durationSec: 0.8,
      }),
    ]));
  });

  it("does not manufacture a late accent for travel, a non-final state, or a cramped tail", () => {
    const moving = heldApproval();
    moving.camera = {
      version: 1,
      path: [{ version: 1, move: "push-in", startSec: 12.8, durationSec: 2, toRegion: "approval" }],
    };
    const pending = heldApproval();
    pending.beats![0] = { ...pending.beats![0]!, toState: "pending" };
    const cramped = heldApproval();
    cramped.beats![0] = { ...cramped.beats![0]!, atSec: 13.9 };
    for (const candidate of [moving, pending, cramped]) {
      expect(topUpHeldInteractionResultDevelopment([candidate])).toEqual({
        scenes: [candidate],
        normalized: [],
      });
    }
  });
});

describe("dedupeRedundantBeats", () => {
  const beat = (
    id: string,
    component: string,
    kind: ComponentBeatIntentV1["kind"],
    atSec: number,
    extra: Partial<ComponentBeatIntentV1> = {},
  ): ComponentBeatIntentV1 => ({
    version: 1,
    id,
    sceneId: "s1",
    component,
    kind,
    atSec,
    ...extra,
  });

  it("drops a same-kind pulse repeated on one component in quick succession", () => {
    const result = dedupeRedundantBeats([scene({
      id: "s1",
      startSec: 0,
      durationSec: 8,
      components: declared(["cta", "button"]),
      beats: [beat("first", "cta", "press", 2), beat("stutter", "cta", "press", 2.8)],
    })]);
    expect(result.scenes[0]?.beats?.map((entry) => entry.id)).toEqual(["first"]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]).toContain("stutter");
  });

  it("drops an open that re-enters a twin a morph already brings on stage (Rule 4)", () => {
    // The 2026-07-06 sentinel-p5-denseui artifact: morph→modal at 3.1s then
    // open on the modal at 3.7s — the open re-ran the entrance over the morph
    // reveal and the modal flashed. The morph IS the twin's entrance.
    const result = dedupeRedundantBeats([scene({
      id: "s1",
      startSec: 0,
      durationSec: 8,
      components: declared(["palette", "search"], ["confirm", "modal"]),
      beats: [
        beat("the-morph", "palette", "morph", 3.1, { morphTo: "confirm" }),
        beat("re-open", "confirm", "open", 3.7),
      ],
    })]);
    expect(result.scenes[0]?.beats?.map((entry) => entry.id)).toEqual(["the-morph"]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]).toContain("re-open");
  });

  it("keeps an open on a morph twin when a close intervened (a real second entrance)", () => {
    const result = dedupeRedundantBeats([scene({
      id: "s1",
      startSec: 0,
      durationSec: 12,
      components: declared(["palette", "search"], ["confirm", "modal"]),
      beats: [
        beat("the-morph", "palette", "morph", 2, { morphTo: "confirm" }),
        beat("put-away", "confirm", "close", 5),
        beat("second-look", "confirm", "open", 8),
      ],
    })]);
    expect(result.scenes[0]?.beats).toHaveLength(3);
    expect(result.dropped).toEqual([]);
  });

  it("keeps pulses that are far apart, on different components, or different select items", () => {
    const result = dedupeRedundantBeats([scene({
      id: "s1",
      startSec: 0,
      durationSec: 12,
      components: declared(["cta", "button"], ["menu", "dropdown"]),
      beats: [
        beat("a", "cta", "press", 1),
        beat("b", "cta", "press", 4), // far apart: emphasis, not stutter
        beat("c", "menu", "select", 5, { item: 1 }),
        beat("d", "menu", "select", 5.8, { item: 3 }), // navigation, not stutter
      ],
    })]);
    expect(result.scenes[0]?.beats).toHaveLength(4);
    expect(result.dropped).toEqual([]);
  });

  it("drops the later of two overlapping beats in one property channel", () => {
    const result = dedupeRedundantBeats([scene({
      id: "s1",
      startSec: 0,
      durationSec: 8,
      components: declared(["metric", "stat-card"]),
      beats: [
        beat("count-a", "metric", "count", 2, { durationSec: 1.6 }),
        beat("count-b", "metric", "count", 2.8, { durationSec: 1.2 }), // fights count-a
        beat("shine", "metric", "highlight", 2.9), // different channel: kept
      ],
    })]);
    expect(result.scenes[0]?.beats?.map((entry) => entry.id)).toEqual(["count-a", "shine"]);
  });

  it("degrades a press beat under a cursor press to set-state (or drops it)", () => {
    const interaction = {
      version: 1 as const,
      id: "click-cta",
      sceneId: "s1",
      cursorId: "cursor",
      targetPart: "cta",
      action: "click" as const,
      startSec: 16,
      arriveSec: 17.2,
      pressSec: 17.4,
      releaseSec: 17.6,
      from: "frame:center" as const,
      path: "direct" as const,
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press-ripple" as const,
    };
    const withState = dedupeRedundantBeats([scene({
      id: "s1",
      startSec: 15,
      durationSec: 4,
      components: declared(["cta", "button"]),
      beats: [beat("cta-press", "cta", "press", 17.5, { toState: "sent" })],
      interactions: [interaction],
    })]);
    expect(withState.scenes[0]?.beats?.[0]).toMatchObject({ kind: "set-state", toState: "sent" });
    const bare = dedupeRedundantBeats([scene({
      id: "s1",
      startSec: 15,
      durationSec: 4,
      components: declared(["cta", "button"]),
      beats: [beat("cta-press", "cta", "press", 17.5)],
      interactions: [interaction],
    })]);
    expect(bare.scenes[0]?.beats).toEqual([]);
    expect(bare.dropped[0]).toContain("duplicates a cursor press");
  });

  it("returns scenes untouched when nothing is redundant", () => {
    const input = [scene({
      id: "s1",
      startSec: 0,
      durationSec: 6,
      components: declared(["search-bar", "search"]),
      beats: [beat("typing", "search-bar", "type", 1, { text: "latency" })],
    })];
    const result = dedupeRedundantBeats(input);
    expect(result.scenes[0]).toBe(input[0]);
    expect(result.dropped).toEqual([]);
  });

  it("drops a swap to text a prior beat already put on the same component (Rule 5, T1)", () => {
    const result = dedupeRedundantBeats([scene({
      id: "s1",
      startSec: 0,
      durationSec: 8,
      components: declared(["wordmark", "headline"]),
      beats: [
        beat("type-name", "wordmark", "type", 1, { text: "Cadence" }),
        beat("noop-swap", "wordmark", "swap", 4, { text: " Cadence " }),
      ],
    })]);
    expect(result.scenes[0]?.beats?.map((entry) => entry.id)).toEqual(["type-name"]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]).toContain("noop-swap");
    expect(result.dropped[0]).toContain("already shows");
  });

  it("keeps a swap that genuinely changes the copy", () => {
    const result = dedupeRedundantBeats([scene({
      id: "s1",
      startSec: 0,
      durationSec: 8,
      components: declared(["wordmark", "headline"]),
      beats: [
        beat("type-name", "wordmark", "type", 1, { text: "Cadence" }),
        beat("real-swap", "wordmark", "swap", 4, { text: "Ship with momentum" }),
      ],
    })]);
    expect(result.scenes[0]?.beats).toHaveLength(2);
    expect(result.dropped).toEqual([]);
  });

  it("keeps a popped open under a cursor press — press ≠ open (MD6)", () => {
    // A compact surface pops IN (open) at the same time a cursor presses it.
    // The pop is the entrance; the press is the acknowledgment — they are
    // different gestures on different frames, so the open must survive dedupe.
    const interaction = {
      version: 1 as const,
      id: "tap-toast",
      sceneId: "s1",
      cursorId: "cursor",
      targetPart: "toast",
      action: "click" as const,
      startSec: 1,
      arriveSec: 1.8,
      pressSec: 2,
      releaseSec: 2.2,
      from: "frame:center" as const,
      path: "direct" as const,
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press" as const,
    };
    const result = dedupeRedundantBeats([scene({
      id: "s1",
      startSec: 0,
      durationSec: 5,
      components: declared(["toast", "toast"]),
      beats: [beat("toast-open", "toast", "open", 2, { style: "pop" })],
      interactions: [interaction],
    })]);
    expect(result.scenes[0]?.beats).toHaveLength(1);
    expect(result.scenes[0]?.beats?.[0]).toMatchObject({ kind: "open", style: "pop" });
    expect(result.dropped).toEqual([]);
  });
});

describe("degradeOpenPopStyles (MD6 compact-pop governor)", () => {
  const popBeat = (id: string, component: string, atSec: number): ComponentBeatIntentV1 => ({
    version: 1, id, sceneId: "s1", component, kind: "open", atSec, style: "pop",
  });

  it("targets exactly the compact acknowledgment kinds", () => {
    expect([...COMPACT_POP_KINDS].sort()).toEqual(
      ["avatar-stack", "button", "progress", "progress-ring", "stat-card", "toast", "toggle"].sort(),
    );
  });

  it("drops a pop on a non-compact kind to the default open", () => {
    const result = degradeOpenPopStyles([scene({
      id: "s1",
      startSec: 0,
      durationSec: 5,
      components: declared(["hero-modal", "modal"]),
      beats: [popBeat("modal-open", "hero-modal", 1)],
    })]);
    expect(result.scenes[0]?.beats?.[0]?.style).toBeUndefined();
    expect(result.dropped[0]).toContain("compact-surface only");
  });

  it("caps pop opens at two per scene and degrades the excess", () => {
    const result = degradeOpenPopStyles([scene({
      id: "s1",
      startSec: 0,
      durationSec: 6,
      components: declared(["a", "toast"], ["b", "button"], ["c", "stat-card"]),
      beats: [popBeat("p1", "a", 1), popBeat("p2", "b", 2), popBeat("p3", "c", 3)],
    })]);
    const styles = result.scenes[0]?.beats?.map((entry) => entry.style);
    expect(styles).toEqual(["pop", "pop", undefined]);
    expect(MAX_POP_OPENS_PER_SCENE).toBe(2);
    expect(result.dropped).toHaveLength(1);
  });
});

describe("auditComponentComplexity", () => {
  it("flags a scene declaring more components than its window can read", () => {
    // The 2026-07-04 baseline failure: 4 components in one 2.7s scene.
    const findings = auditComponentComplexity([
      scene({
        id: "anomaly-whip-peak",
        startSec: 0,
        durationSec: 2.7,
        components: declared(
          ["win", "app-window"],
          ["side", "sidebar"],
          ["chart", "chart-line"],
          ["stat", "stat-card"],
        ),
      }),
    ]);
    expect(findings.some((finding) => finding.includes('scene "anomaly-whip-peak"'))).toBe(true);
  });

  it("flags a film declaring more components than its duration can introduce", () => {
    const scenes = Array.from({ length: 6 }, (_, index) =>
      scene({
        id: `s${index}`,
        startSec: index * 3,
        durationSec: 3,
        components: declared([`a${index}`, "stat-card"], [`b${index}`, "toast"]),
      }));
    const findings = auditComponentComplexity(scenes);
    expect(findings.some((finding) => finding.includes("across"))).toBe(true);
  });

  it("accepts a plan an author can actually build", () => {
    expect(auditComponentComplexity([
      scene({
        id: "s1",
        startSec: 0,
        durationSec: 4,
        components: declared(["palette", "command-palette"]),
      }),
      scene({ id: "s2", startSec: 4, durationSec: 3, components: [] }),
      scene({
        id: "s3",
        startSec: 7,
        durationSec: 5,
        components: declared(["metric", "stat-card"], ["chart", "chart-line"]),
      }),
    ])).toEqual([]);
  });

  it("charges one stable continuity entity once across the film", () => {
    const shots = ["token", "active-pill", "approve", "final-cta"].map((id, index) =>
      scene({
        id: `s${index}`,
        startSec: index * 4,
        durationSec: 4,
        components: [
          { version: 1, id, kind: "button", entityId: "cta" },
          { version: 1, id: `surface-${index}`, kind: "stat-card" },
        ],
      })
    );
    // Eight declarations in 16s fit the cap either way; the extra two surfaces
    // prove that the four CTA appearances cost one film-wide unit, not four.
    shots[1]!.components!.push({ version: 1, id: "nav", kind: "sidebar" });
    shots[2]!.components!.push({ version: 1, id: "toast", kind: "toast" });
    expect(shots.reduce((count, shot) => count + shot.components!.length, 0)).toBe(10);
    expect(auditComponentComplexity(shots)).toEqual([]);
  });

  it("still charges same-scene duplicates and unrelated entities independently", () => {
    const shots = [
      scene({
        id: "a",
        startSec: 0,
        durationSec: 4,
        components: [
          { version: 1, id: "cta-a", kind: "button", entityId: "cta" },
          { version: 1, id: "cta-a-copy", kind: "button", entityId: "cta" },
          { version: 1, id: "card-a", kind: "stat-card" },
        ],
      }),
      scene({
        id: "b",
        startSec: 4,
        durationSec: 4,
        components: [
          { version: 1, id: "cta-b", kind: "button", entityId: "cta" },
          { version: 1, id: "card-b", kind: "stat-card" },
          { version: 1, id: "toast-b", kind: "toast" },
        ],
      }),
    ];
    expect(auditComponentComplexity(shots).some((finding) => finding.includes("across"))).toBe(true);
  });

  it("counts one app-window chassis and its same-station child as one surface", () => {
    const bridge = scene({
      id: "lateral-collapse",
      startSec: 3,
      durationSec: 2,
      components: [
        { version: 1, id: "action-bar", kind: "button", region: "dashboard-station" },
        { version: 1, id: "product-shell", kind: "app-window", region: "dashboard-station" },
      ],
    });
    expect(auditComponentComplexity([bridge])).toEqual([]);

    const withOverlay = {
      ...bridge,
      components: [
        ...bridge.components!,
        { version: 1 as const, id: "notice", kind: "toast" as const, region: "dashboard-station" },
      ],
    };
    expect(auditComponentComplexity([withOverlay]).some((finding) =>
      finding.includes('scene "lateral-collapse"')
    )).toBe(true);
  });
});

describe("Sentinel — trimOverBudgetComponents (normalize-before-retry)", () => {
  const beat = (
    spec: Partial<ComponentBeatIntentV1> &
      Pick<ComponentBeatIntentV1, "id" | "sceneId" | "component" | "kind" | "atSec">,
  ): ComponentBeatIntentV1 => ({ version: 1, ...spec });

  it("trims a per-scene over-count by one, keeping the bound focal surface", () => {
    // 2.7s scene → cap = min(4, floor(2.7/1.2)) = 2; 3 components → over by 1.
    const s = scene({
      id: "dense",
      startSec: 0,
      durationSec: 2.7,
      components: declared(["hero", "app-window"], ["deco1", "stat-card"], ["deco2", "toast"]),
      spatialIntent: { version: 1, focalPart: "hero", composition: "hero centered", relationships: [] },
    });
    expect(auditComponentComplexity([s]).some((f) => f.includes('"dense"'))).toBe(true);
    const result = trimOverBudgetComponents([s]);
    expect(result.normalized).toHaveLength(1);
    const kept = result.storyboard[0]!.components!.map((c) => c.id);
    expect(kept).toContain("hero"); // the declared focal is load-bearing — never trimmed
    expect(kept).toHaveLength(2);
    expect(auditComponentComplexity(result.storyboard).some((f) => f.startsWith("components/complexity"))).toBe(
      false,
    );
  });

  it("drops the fewest-beat surface and carries its (absent) beats out", () => {
    const s = scene({
      id: "dense",
      startSec: 0,
      durationSec: 2.7,
      components: declared(["hero", "app-window"], ["busy", "table"], ["idle", "toast"]),
      spatialIntent: { version: 1, focalPart: "hero", composition: "x", relationships: [] },
      beats: [
        beat({ id: "b1", sceneId: "dense", component: "busy", kind: "rows", atSec: 0.5 }),
        beat({ id: "b2", sceneId: "dense", component: "busy", kind: "highlight", atSec: 1.2 }),
      ],
    });
    const result = trimOverBudgetComponents([s]);
    const kept = result.storyboard[0]!.components!.map((c) => c.id);
    expect(kept).toEqual(["hero", "busy"]); // "idle" (0 beats) dropped, "busy" (2 beats) kept
    // "busy"'s beats survive; no orphaned beat references a dropped component.
    const beatComponents = new Set((result.storyboard[0]!.beats ?? []).map((b) => b.component));
    expect(beatComponents.has("idle")).toBe(false);
    expect(result.storyboard[0]!.beats).toHaveLength(2);
  });

  it("keeps the finding when nothing is safely droppable (ambiguity stays a finding)", () => {
    // Every extra surface is load-bearing: focal, camera target, cut focal.
    const s = scene({
      id: "dense",
      startSec: 0,
      durationSec: 2.7,
      components: declared(["a", "app-window"], ["b", "stat-card"], ["c", "button"]),
      spatialIntent: { version: 1, focalPart: "a", composition: "x", relationships: [] },
      camera: {
        version: 1,
        path: [{ version: 1, move: "track-to-anchor", toPart: "b", startSec: 0.5, durationSec: 1 }],
      },
      cut: { version: 1, style: "match", focalPartOut: "c", focalPartIn: "next-hero" },
    });
    const result = trimOverBudgetComponents([s]);
    expect(result.normalized).toEqual([]);
    expect(auditComponentComplexity(result.storyboard).some((f) => f.includes('"dense"'))).toBe(true);
  });

  it("never trims a surface a declared moment binds to", () => {
    const s = scene({
      id: "dense",
      startSec: 0,
      durationSec: 2.7,
      components: declared(["hero", "app-window"], ["metric", "stat-card"], ["idle", "toast"]),
      spatialIntent: { version: 1, focalPart: "hero", composition: "x", relationships: [] },
      beats: [beat({ id: "m1", sceneId: "dense", component: "metric", kind: "count", atSec: 1.0, value: 9 })],
      moments: [
        {
          version: 1,
          id: "count-lands",
          sceneId: "dense",
          atSec: 1.0,
          title: "metric counts up",
          visualState: "9",
          change: "count",
          motionIntent: "count",
          importance: "primary",
        },
      ],
    });
    const result = trimOverBudgetComponents([s]);
    const kept = result.storyboard[0]!.components!.map((c) => c.id);
    expect(kept).toContain("metric"); // moment-bearing beat protects it
    expect(kept).not.toContain("idle"); // the unbound toast is trimmed instead
  });

  it("trims a film-wide over-count by one across scenes", () => {
    // 3 shots × 5s = 15s; filmCap = ceil(15/2) = 8; 9 components → over by 1.
    // Each shot's per-scene cap is floor(5/1.2)=4, so only the FILM finding fires.
    const shot = (id: string, startSec: number): DirectScene =>
      scene({
        id,
        startSec,
        durationSec: 5,
        components: declared([`${id}-a`, "app-window"], [`${id}-b`, "stat-card"], [`${id}-c`, "toast"]),
        spatialIntent: { version: 1, focalPart: `${id}-a`, composition: "x", relationships: [] },
      });
    const storyboard = [shot("s0", 0), shot("s1", 5), shot("s2", 10)];
    expect(auditComponentComplexity(storyboard).some((f) => f.includes("across"))).toBe(true);
    const result = trimOverBudgetComponents(storyboard);
    expect(result.normalized).toHaveLength(1);
    const total = result.storyboard.reduce((n, s) => n + (s.components?.length ?? 0), 0);
    expect(total).toBe(8);
    expect(auditComponentComplexity(result.storyboard).some((f) => f.includes("across"))).toBe(false);
  });

  it("leaves a large over-count (>= 3) as a finding — a real over-reach", () => {
    const s = scene({
      id: "dense",
      startSec: 0,
      durationSec: 2.7, // cap 2
      components: declared(
        ["a", "app-window"],
        ["b", "stat-card"],
        ["c", "toast"],
        ["d", "button"],
        ["e", "chart-line"],
      ), // 5 → over by 3
    });
    expect(trimOverBudgetComponents([s]).normalized).toEqual([]);
  });
});

describe("auditSurfaceExits", () => {
  const beat = (
    id: string,
    component: string,
    kind: ComponentBeatIntentV1["kind"],
    atSec: number,
    extra: Partial<ComponentBeatIntentV1> = {},
  ): ComponentBeatIntentV1 => ({ version: 1, id, sceneId: "s1", component, kind, atSec, ...extra });

  it("flags a second overlay opening over a still-open one in the same station", () => {
    const findings = auditSurfaceExits([
      scene({
        id: "s1",
        startSec: 0,
        durationSec: 8,
        components: declared(["palette", "command-palette"], ["dialog", "modal"]),
        beats: [beat("p-open", "palette", "open", 1), beat("m-open", "dialog", "open", 3.5)],
      }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('opens "dialog"');
    expect(findings[0]).toContain('"palette"');
  });

  it("accepts an overlay opening over base content (⌘K over a window is the designed pattern)", () => {
    expect(auditSurfaceExits([
      scene({
        id: "s1",
        startSec: 0,
        durationSec: 8,
        components: declared(["app", "app-window"], ["palette", "command-palette"]),
        beats: [beat("p-open", "palette", "open", 2)],
      }),
    ])).toEqual([]);
  });

  it("accepts a stack where the first overlay is closed before the second opens", () => {
    expect(auditSurfaceExits([
      scene({
        id: "s1",
        startSec: 0,
        durationSec: 9,
        components: declared(["palette", "command-palette"], ["dialog", "modal"]),
        beats: [
          beat("p-open", "palette", "open", 1),
          beat("p-close", "palette", "close", 3),
          beat("m-open", "dialog", "open", 3.5),
        ],
      }),
    ])).toEqual([]);
  });

  it("accepts two overlays that open into distinct stations", () => {
    expect(auditSurfaceExits([
      scene({
        id: "s1",
        startSec: 0,
        durationSec: 8,
        components: [
          { version: 1, id: "menu-a", kind: "dropdown", region: "left" },
          { version: 1, id: "menu-b", kind: "context-menu", region: "right" },
        ],
        beats: [beat("a-open", "menu-a", "open", 1), beat("b-open", "menu-b", "open", 3)],
      }),
    ])).toEqual([]);
  });

  it("accepts a statically composed overlay under a later open (no clashing open window)", () => {
    // Only a real open beat stacks — a statically entranced surface is the QA
    // stage's rendered-overlap job, not this plan gate.
    expect(auditSurfaceExits([
      scene({
        id: "s1",
        startSec: 0,
        durationSec: 8,
        components: declared(["palette", "command-palette"], ["dialog", "modal"]),
        beats: [beat("m-open", "dialog", "open", 3)],
      }),
    ])).toEqual([]);
  });
});
