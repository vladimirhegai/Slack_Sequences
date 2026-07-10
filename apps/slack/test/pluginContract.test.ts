import { describe, expect, it } from "vitest";
import type { DirectScene } from "../src/engine/directComposition.ts";
import {
  MAX_PLUGINS_PER_FILM,
  PLUGIN_CATALOG,
  injectPluginContract,
  normalizeStoryboardPluginDeclarations,
  pluginPlanningVocabulary,
  reconcileAndLowerPlugins,
  resolvePluginPlan,
  stripPluginMarkup,
  validatePluginContract,
} from "../src/engine/pluginContract.ts";
import {
  auditComponentComplexity,
  componentUnitCount,
  trimOverBudgetComponents,
} from "../src/engine/componentContract.ts";
import { sceneIntroductionTimes } from "../src/engine/pacingAudit.ts";
import { authorStoryboardProjection } from "../src/engine/compositionRunner.ts";
import { createSeededRandom } from "../src/engine/pluginKernel.ts";
import { deriveTopic, seedMetrics, seedToasts } from "../src/engine/seedContent.ts";

function scene(over: Partial<DirectScene> = {}): DirectScene {
  return {
    id: "s1",
    title: "Deploy metrics land",
    purpose: "Prove the deploy metrics story",
    startSec: 0,
    durationSec: 6,
    ...over,
  };
}

function declared(value: unknown): DirectScene {
  return scene({ plugins: normalizeStoryboardPluginDeclarations(value) });
}

/** Minimal single-scene document for exercising markup injection. */
function sceneHtml(id: string): string {
  return (
    `<html><head></head><body>` +
    `<section id="${id}" class="scene clip" data-scene="${id}" data-start="0" data-duration="6"></section>` +
    `</body></html>`
  );
}

const GRID_DECLARATION = [
  { version: 1, kind: "dashboard-grid", id: "metrics", params: { tiles: 4, topic: "deploy speed" } },
];

describe("plugin declarations — parse-time normalization", () => {
  it("accepts params as an object or a name/value array", () => {
    const fromObject = normalizeStoryboardPluginDeclarations([
      { kind: "dashboard-grid", params: { tiles: 5 } },
    ]);
    const fromArray = normalizeStoryboardPluginDeclarations([
      { kind: "dashboard-grid", params: [{ name: "tiles", value: 5 }] },
    ]);
    expect(fromObject[0]?.params).toEqual({ tiles: 5 });
    expect(fromArray[0]?.params).toEqual({ tiles: 5 });
  });

  it("defaults the unit id from the kind and keeps unknown kinds for the reconciler", () => {
    const declarations = normalizeStoryboardPluginDeclarations([
      { kind: "notification-stack" },
      { kind: "made-up-plugin" },
      { bogus: true },
      "junk",
    ]);
    expect(declarations.map((entry) => entry.id)).toEqual(["notices", "made-up-plugin"]);
  });
});

describe("plugin reconciliation + lowering (Sentinel L2, degrade-never-veto)", () => {
  it("lowers a dashboard-grid into pluginUid-stamped components and in-window beats", () => {
    const result = reconcileAndLowerPlugins([declared(GRID_DECLARATION)]);
    const lowered = result.scenes[0]!;
    const components = lowered.components ?? [];
    expect(components).toHaveLength(4);
    expect(new Set(components.map((entry) => entry.pluginUid))).toEqual(new Set(["s1-metrics"]));
    expect(components.map((entry) => entry.id)).toEqual([
      "metrics-tile-1", "metrics-tile-2", "metrics-tile-3", "metrics-tile-4",
    ]);
    const beats = lowered.beats ?? [];
    expect(beats.length).toBeGreaterThanOrEqual(4);
    for (const beat of beats) {
      expect(beat.atSec).toBeGreaterThanOrEqual(0);
      expect(beat.atSec).toBeLessThanOrEqual(6);
    }
    expect(lowered.plugins?.[0]?.uid).toBe("s1-metrics");
  });

  it("no-ops an unknown kind with a note instead of a veto", () => {
    const result = reconcileAndLowerPlugins([
      declared([{ kind: "hologram-carousel", params: {} }]),
    ]);
    expect(result.scenes[0]!.plugins).toBeUndefined();
    expect(result.scenes[0]!.components ?? []).toHaveLength(0);
    expect(result.notes.join(" ")).toContain("hologram-carousel");
  });

  it("drops a lockup missing its required headline, keeps a complete one", () => {
    const result = reconcileAndLowerPlugins([
      declared([
        { kind: "lockup", params: {} },
      ]),
      scene({
        id: "s2",
        plugins: normalizeStoryboardPluginDeclarations([
          { kind: "lockup", params: { headline: "Ship it faster", cta: "Try Sequences" } },
        ]),
      }),
    ]);
    expect(result.scenes[0]!.plugins).toBeUndefined();
    expect(result.notes.join(" ")).toContain('required param "headline"');
    const kept = result.scenes[1]!;
    expect(kept.plugins).toHaveLength(1);
    expect((kept.components ?? []).map((entry) => entry.kind)).toEqual(["headline", "button"]);
    const typeBeat = (kept.beats ?? []).find((beat) => beat.kind === "type");
    expect(typeBeat?.text).toBe("Ship it faster");
    expect(typeBeat?.style).toBe("rise");
  });

  it("enforces the per-film budget, earliest declarations first", () => {
    const scenes = ["a", "b", "c", "d"].map((id, index) =>
      scene({
        id,
        startSec: index * 6,
        plugins: normalizeStoryboardPluginDeclarations([
          { kind: "notification-stack", id: `stack-${id}`, params: {} },
        ]),
      }),
    );
    const result = reconcileAndLowerPlugins(scenes);
    const keptCount = result.scenes.filter((entry) => entry.plugins?.length).length;
    expect(keptCount).toBe(MAX_PLUGINS_PER_FILM);
    expect(result.scenes[3]!.plugins).toBeUndefined();
    expect(result.notes.join(" ")).toContain("budget");
  });

  it("renames a unit whose parts collide with a declared component", () => {
    const result = reconcileAndLowerPlugins([
      scene({
        components: [{ version: 1, id: "metrics-tile-1", kind: "stat-card" }],
        plugins: normalizeStoryboardPluginDeclarations(GRID_DECLARATION),
      }),
    ]);
    const lowered = result.scenes[0]!;
    expect(lowered.plugins?.[0]?.id).toBe("metrics-2");
    const pluginParts = (lowered.components ?? []).filter((entry) => entry.pluginUid);
    expect(pluginParts.every((entry) => entry.id.startsWith("metrics-2-tile-"))).toBe(true);
  });

  it("absorbs a free same-kind component duplicating the unit's content (plugin-probe-1 lesson)", () => {
    const result = reconcileAndLowerPlugins([
      scene({
        components: [{ version: 1, id: "notif-stack", kind: "toast" }],
        beats: [
          { version: 1, id: "toast-1", sceneId: "s1", component: "notif-stack", kind: "open", atSec: 1 },
        ],
        plugins: normalizeStoryboardPluginDeclarations([
          { kind: "notification-stack", params: { count: 3 } },
        ]),
      }),
    ]);
    const lowered = result.scenes[0]!;
    expect((lowered.components ?? []).map((entry) => entry.id)).not.toContain("notif-stack");
    expect((lowered.beats ?? []).map((entry) => entry.id)).not.toContain("toast-1");
    expect((lowered.components ?? []).filter((entry) => entry.pluginUid)).toHaveLength(3);
    expect(result.notes.join(" ")).toContain("absorbed");
  });

  it("keeps a load-bearing same-kind component (cursor target) beside the unit", () => {
    const result = reconcileAndLowerPlugins([
      scene({
        components: [{ version: 1, id: "hero-toast", kind: "toast" }],
        beats: [
          { version: 1, id: "hero-open", sceneId: "s1", component: "hero-toast", kind: "open", atSec: 1 },
        ],
        interactions: [{
          version: 1, id: "click-toast", sceneId: "s1", cursorId: "cursor",
          targetPart: "hero-toast", action: "click", startSec: 2, arriveSec: 2.6,
        } as never],
        plugins: normalizeStoryboardPluginDeclarations([
          { kind: "notification-stack", params: { count: 2 } },
        ]),
      }),
    ]);
    const lowered = result.scenes[0]!;
    expect((lowered.components ?? []).map((entry) => entry.id)).toContain("hero-toast");
  });

  it("re-parses an already-lowered plan idempotently (the plugin-probe-1 notices-2 echo)", () => {
    // A scene-repair merge / findings-retry echo re-parses a plan that already
    // carries the lowered children — but normalizeStoryboardComponents strips
    // the host-only pluginUid stamp. Reconciling again must re-stamp, not
    // lower a duplicate unit.
    const first = reconcileAndLowerPlugins([declared(GRID_DECLARATION)]).scenes[0]!;
    const echoed: DirectScene = {
      ...first,
      components: (first.components ?? []).map(({ pluginUid: _uid, ...rest }) => rest),
    };
    const again = reconcileAndLowerPlugins([echoed]);
    const relowered = again.scenes[0]!;
    expect((relowered.components ?? []).map((entry) => entry.id)).toEqual(
      (first.components ?? []).map((entry) => entry.id),
    );
    expect((relowered.components ?? []).every((entry) => entry.pluginUid === "s1-metrics")).toBe(true);
    expect(relowered.plugins?.[0]?.uid).toBe("s1-metrics");
    expect((relowered.beats ?? []).length).toBe((first.beats ?? []).length);
    expect(componentUnitCount(relowered.components)).toBe(1);
  });

  it("keeps a lockup's typed copy pacing-feasible (static fallback in a tight scene)", () => {
    const roomy = reconcileAndLowerPlugins([
      scene({
        durationSec: 6,
        plugins: normalizeStoryboardPluginDeclarations([
          { kind: "lockup", params: { headline: "Ship it faster", sub: "From shipped to shown in one thread for every team" } },
        ]),
      }),
    ]).scenes[0]!;
    expect((roomy.beats ?? []).filter((beat) => beat.kind === "type")).toHaveLength(2);
    for (const typeBeat of (roomy.beats ?? []).filter((beat) => beat.kind === "type")) {
      const words = typeBeat.text!.split(/\s+/).length;
      const floor = Math.max(1.2, 0.3 * words);
      expect(typeBeat.atSec + typeBeat.durationSec! + floor).toBeLessThanOrEqual(6.01);
    }
    const tight = reconcileAndLowerPlugins([
      scene({
        durationSec: 2,
        plugins: normalizeStoryboardPluginDeclarations([
          { kind: "lockup", params: { headline: "Ship it faster", sub: "From shipped to shown in one thread for every team" } },
        ]),
      }),
    ]).scenes[0]!;
    // No room to type + read: the copy ships static, no beat to reject.
    expect((tight.beats ?? []).filter((beat) => beat.kind === "type")).toHaveLength(0);
    expect((tight.components ?? []).length).toBeGreaterThan(0);
  });

  it("is deterministic: identical input lowers to identical bytes", () => {
    const a = reconcileAndLowerPlugins([declared(GRID_DECLARATION)]);
    const b = reconcileAndLowerPlugins([declared(GRID_DECLARATION)]);
    expect(JSON.stringify(a.scenes)).toBe(JSON.stringify(b.scenes));
    expect(JSON.stringify(resolvePluginPlan(a.scenes))).toBe(
      JSON.stringify(resolvePluginPlan(b.scenes)),
    );
  });
});

describe("one budget/pacing unit regardless of children", () => {
  function loweredGridScene(durationSec = 4): DirectScene {
    const result = reconcileAndLowerPlugins([
      scene({ durationSec, plugins: normalizeStoryboardPluginDeclarations(GRID_DECLARATION) }),
    ]);
    return result.scenes[0]!;
  }

  it("counts a plugin unit once in componentUnitCount", () => {
    const lowered = loweredGridScene();
    expect((lowered.components ?? []).length).toBe(4);
    expect(componentUnitCount(lowered.components)).toBe(1);
  });

  it("passes auditComponentComplexity where 4 free components would fail", () => {
    const lowered = loweredGridScene(4); // cap at 4s = min(4, floor(4/1.2)) = 3
    expect(auditComponentComplexity([lowered])).toEqual([]);
    const free = scene({
      durationSec: 4,
      components: (lowered.components ?? []).map(({ pluginUid: _uid, ...rest }) => rest),
    });
    expect(auditComponentComplexity([free]).length).toBeGreaterThan(0);
  });

  it("never trims plugin children as set dressing", () => {
    const lowered = loweredGridScene(4);
    const withExtra: DirectScene = {
      ...lowered,
      components: [
        ...(lowered.components ?? []),
        { version: 1, id: "free-a", kind: "stat-card" },
        { version: 1, id: "free-b", kind: "stat-card" },
        { version: 1, id: "free-c", kind: "stat-card" },
        { version: 1, id: "free-d", kind: "stat-card" },
      ],
    };
    const trimmed = trimOverBudgetComponents([withExtra]);
    const survivors = trimmed.storyboard[0]!.components ?? [];
    expect(survivors.filter((entry) => entry.pluginUid)).toHaveLength(4);
  });

  it("collapses the unit's cascade to ONE introduction event", () => {
    const lowered = loweredGridScene(6);
    expect(sceneIntroductionTimes(lowered)).toHaveLength(1);
  });
});

describe("plugin markup injection (strip + reinject, recipe seam discipline)", () => {
  function loweredScenes(): DirectScene[] {
    return reconcileAndLowerPlugins([
      scene({
        plugins: normalizeStoryboardPluginDeclarations([
          { version: 1, kind: "dashboard-grid", id: "metrics", region: "metric-wall", params: { tiles: 3 } },
        ]),
      }),
    ]).scenes;
  }

  const HTML =
    `<html><head></head><body>` +
    `<section id="s1" class="scene clip" data-scene="s1" data-start="0" data-duration="6">` +
    `<div data-camera-world><div data-region="metric-wall"></div></div>` +
    `</section></body></html>`;

  it("injects the unit into its declared station with wrapper, uid, and unit data-part", () => {
    const scenes = loweredScenes();
    const { html, injected } = injectPluginContract(HTML, scenes);
    expect(injected).toEqual(["s1-metrics"]);
    expect(html).toContain('data-sequences-plugin="dashboard-grid"');
    expect(html).toContain('data-plugin-uid="s1-metrics"');
    expect(html).toContain('data-part="metrics"');
    expect(html).toContain('data-part="metrics-tile-1"');
    // Landed inside the station, not at the scene root.
    const stationIndex = html.indexOf('data-region="metric-wall"');
    const wrapperIndex = html.indexOf('data-sequences-plugin=');
    expect(wrapperIndex).toBeGreaterThan(stationIndex);
    expect(validatePluginContract(html, scenes).errors).toEqual([]);
  });

  it("converges: re-injection over an already-injected document is byte-identical", () => {
    const scenes = loweredScenes();
    const once = injectPluginContract(HTML, scenes).html;
    const twice = injectPluginContract(once, scenes).html;
    expect(twice).toBe(once);
    expect(stripPluginMarkup(once)).not.toContain("data-sequences-plugin=");
  });

  it("reports plugin_island_missing when the injection seam broke", () => {
    const scenes = loweredScenes();
    const { errors } = validatePluginContract(HTML, scenes);
    expect(errors.some((error) => error.startsWith("plugin_island_missing"))).toBe(true);
  });

  it("generates seeded, kit-valid interiors (no Item 1/2/3 filler)", () => {
    const scenes = loweredScenes();
    const html = injectPluginContract(HTML, scenes).html;
    expect(html).not.toMatch(/Item \d/);
    expect(html).toContain("cmp-value");
    expect(html).toMatch(/data-cmp-value>[^<]*\d/);
  });
});

describe("activity-feed plugin (seedRows cascade)", () => {
  const DECL = [
    { kind: "activity-feed", params: { rows: 4, surface: "list", topic: "deploy pipeline" } },
  ];

  it("lowers to ONE list component and ONE rows beat, pluginUid stamped", () => {
    const lowered = reconcileAndLowerPlugins([declared(DECL)]).scenes[0]!;
    const components = lowered.components ?? [];
    expect(components).toHaveLength(1);
    expect(components[0]!.kind).toBe("list");
    expect(components[0]!.id).toBe("activity-feed");
    expect(components[0]!.pluginUid).toBe("s1-activity");
    const beats = lowered.beats ?? [];
    expect(beats).toHaveLength(1);
    expect(beats[0]!.kind).toBe("rows");
    expect(beats[0]!.atSec).toBeGreaterThanOrEqual(0);
    expect(beats[0]!.atSec).toBeLessThanOrEqual(6);
  });

  it("is deterministic: identical input lowers to identical bytes", () => {
    const a = reconcileAndLowerPlugins([declared(DECL)]);
    const b = reconcileAndLowerPlugins([declared(DECL)]);
    expect(JSON.stringify(a.scenes)).toBe(JSON.stringify(b.scenes));
  });

  it("generates believable rows — no Item N filler, >=3 cmp-item children", () => {
    const scenes = reconcileAndLowerPlugins([declared(DECL)]).scenes;
    const html = injectPluginContract(sceneHtml("s1"), scenes).html;
    expect(html).not.toMatch(/Item \d/);
    expect((html.match(/class="cmp-item/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("renders a table surface with a head and status chips", () => {
    const scenes = reconcileAndLowerPlugins([
      declared([{ kind: "activity-feed", params: { rows: 4, surface: "table" } }]),
    ]).scenes;
    expect(scenes[0]!.components?.[0]?.kind).toBe("table");
    const html = injectPluginContract(sceneHtml("s1"), scenes).html;
    expect(html).toContain('data-component="table"');
    expect(html).toContain('<div class="cmp-head">');
    expect((html.match(/class="cmp-row"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(html).toMatch(/cmp-chip/);
  });
});

describe("terminal-log plugin (seedLogLines stream)", () => {
  const DECL = [
    { kind: "terminal-log", params: { command: "acme deploy --prod", lines: 3, topic: "deploy" } },
  ];

  it("lowers to ONE terminal component with a type beat then a rows beat", () => {
    const lowered = reconcileAndLowerPlugins([declared(DECL)]).scenes[0]!;
    const components = lowered.components ?? [];
    expect(components).toHaveLength(1);
    expect(components[0]!.kind).toBe("terminal");
    expect(components[0]!.id).toBe("terminal-cli");
    expect(components[0]!.pluginUid).toBe("s1-terminal");
    const beats = lowered.beats ?? [];
    expect([...beats].map((beat) => beat.kind).sort()).toEqual(["rows", "type"]);
    const typeBeat = beats.find((beat) => beat.kind === "type");
    expect(typeBeat?.text).toBe("acme deploy --prod");
    // Terminals typewrite — the type beat carries no kinetic style.
    expect(typeBeat?.style).toBeUndefined();
    const rowsBeat = beats.find((beat) => beat.kind === "rows")!;
    expect(rowsBeat.atSec).toBeGreaterThan(typeBeat!.atSec);
    for (const beat of beats) {
      expect(beat.atSec).toBeGreaterThanOrEqual(0);
      expect(beat.atSec).toBeLessThanOrEqual(6);
    }
  });

  it("drops a terminal-log missing its required command", () => {
    const result = reconcileAndLowerPlugins([
      declared([{ kind: "terminal-log", params: { lines: 3 } }]),
    ]);
    expect(result.scenes[0]!.plugins).toBeUndefined();
    expect(result.notes.join(" ")).toContain('required param "command"');
  });

  it("is deterministic and streams believable result lines", () => {
    const a = reconcileAndLowerPlugins([declared(DECL)]);
    const b = reconcileAndLowerPlugins([declared(DECL)]);
    expect(JSON.stringify(a.scenes)).toBe(JSON.stringify(b.scenes));
    const html = injectPluginContract(sceneHtml("s1"), a.scenes).html;
    expect(html).not.toMatch(/Item \d/);
    expect(html).toContain("data-cmp-text>acme deploy --prod");
    expect((html.match(/cmp-line cmp-dim cmp-item/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("team-strip plugin (seedNames avatar stack)", () => {
  const DECL = [{ kind: "team-strip", params: { people: 4, more: 12 } }];

  it("lowers to ONE avatar-stack component with ONE open beat", () => {
    const lowered = reconcileAndLowerPlugins([declared(DECL)]).scenes[0]!;
    const components = lowered.components ?? [];
    expect(components).toHaveLength(1);
    expect(components[0]!.kind).toBe("avatar-stack");
    expect(components[0]!.id).toBe("roster-team");
    expect(components[0]!.pluginUid).toBe("s1-roster");
    const beats = lowered.beats ?? [];
    expect(beats).toHaveLength(1);
    expect(beats[0]!.kind).toBe("open");
  });

  it("is deterministic and renders seeded initials with an overflow chip", () => {
    const a = reconcileAndLowerPlugins([declared(DECL)]);
    const b = reconcileAndLowerPlugins([declared(DECL)]);
    expect(JSON.stringify(a.scenes)).toBe(JSON.stringify(b.scenes));
    const html = injectPluginContract(sceneHtml("s1"), a.scenes).html;
    expect(html).toContain('data-component="avatar-stack"');
    expect(html).toContain('<span class="cmp-more">+12</span>');
    expect((html.match(/<i>[A-Z]{2}<\/i>/g) ?? [])).toHaveLength(4);
  });

  it("auto-seeds a plausible overflow (5..40) when more is omitted", () => {
    const lowered = reconcileAndLowerPlugins([
      declared([{ kind: "team-strip", params: { people: 3 } }]),
    ]).scenes[0]!;
    const html = injectPluginContract(sceneHtml("s1"), [lowered]).html;
    const match = html.match(/cmp-more">\+(\d+)</);
    expect(match).not.toBeNull();
    const value = Number(match![1]);
    expect(value).toBeGreaterThanOrEqual(5);
    expect(value).toBeLessThanOrEqual(40);
  });
});

describe("author-facing projection", () => {
  it("collapses plugin children back to the one-line declaration", () => {
    const lowered = reconcileAndLowerPlugins([declared(GRID_DECLARATION)]).scenes[0]!;
    const projected = authorStoryboardProjection(lowered);
    expect(projected.components).toBeUndefined();
    expect(projected.beats).toBeUndefined();
    expect(projected.plugins).toHaveLength(1);
  });

  it("keeps author-owned components and beats untouched", () => {
    const lowered = reconcileAndLowerPlugins([
      scene({
        components: [{ version: 1, id: "hero-window", kind: "app-window" }],
        beats: [{
          version: 1, id: "hero-rows", sceneId: "s1", component: "hero-window",
          kind: "rows", atSec: 1,
        }],
        plugins: normalizeStoryboardPluginDeclarations(GRID_DECLARATION),
      }),
    ]).scenes[0]!;
    const projected = authorStoryboardProjection(lowered);
    expect(projected.components?.map((entry) => entry.id)).toEqual(["hero-window"]);
    expect(projected.beats?.map((entry) => entry.id)).toEqual(["hero-rows"]);
  });
});

describe("foundations", () => {
  it("seed content is deterministic and on-domain", () => {
    const topic = deriveTopic("deploy pipeline latency dashboards");
    expect(topic.domain).toBe("devtools");
    const a = seedMetrics(createSeededRandom("seed-1"), 4, topic);
    const b = seedMetrics(createSeededRandom("seed-1"), 4, topic);
    expect(a).toEqual(b);
    expect(new Set(a.map((metric) => metric.label)).size).toBe(4);
    const toasts = seedToasts(createSeededRandom("seed-2"), 3, topic, "ok");
    expect(toasts.every((toast) => toast.tone === "ok")).toBe(true);
    expect(toasts.every((toast) => toast.title.length > 3)).toBe(true);
  });

  it("detects the design and ai domains with deterministic non-empty content", () => {
    const design = deriveTopic("design system: files, components, handoffs, review requests");
    const ai = deriveTopic("ai agents: prompts, evals, tokens, and completions");
    expect(design.domain).toBe("design");
    expect(ai.domain).toBe("ai");
    for (const topic of [design, ai]) {
      const metricsA = seedMetrics(createSeededRandom("dom-1"), 4, topic);
      const metricsB = seedMetrics(createSeededRandom("dom-1"), 4, topic);
      expect(metricsA).toEqual(metricsB);
      expect(metricsA).toHaveLength(4);
      expect(metricsA.every((metric) => metric.text.length > 0)).toBe(true);
      const toastsA = seedToasts(createSeededRandom("dom-2"), 3, topic, "mixed");
      const toastsB = seedToasts(createSeededRandom("dom-2"), 3, topic, "mixed");
      expect(toastsA).toEqual(toastsB);
      expect(toastsA).toHaveLength(3);
      expect(toastsA.every((toast) => toast.title.length > 3)).toBe(true);
    }
  });

  it("planning vocabulary teaches every catalog kind", () => {
    const vocabulary = pluginPlanningVocabulary();
    for (const spec of PLUGIN_CATALOG) {
      expect(vocabulary).toContain(spec.kind);
    }
    expect(vocabulary).toContain(`${MAX_PLUGINS_PER_FILM}`);
  });
});

describe("camera-arrival entrance timing (plugin-live-1: count-ups off-screen)", () => {
  const DECL = [
    {
      version: 1,
      kind: "dashboard-grid",
      id: "metrics",
      region: "metric-station",
      params: { tiles: 3 },
    },
  ];

  function firstBeatAt(scenes: DirectScene[]): number {
    const beats = scenes[0]!.beats ?? [];
    return Math.min(...beats.map((beat) => beat.atSec));
  }

  it("keeps the default entrance when no camera move targets the unit", () => {
    const result = reconcileAndLowerPlugins([declared(DECL)]);
    expect(firstBeatAt(result.scenes)).toBeCloseTo(0.6, 2);
  });

  it("waits for the camera's landing on the unit's declared region", () => {
    const result = reconcileAndLowerPlugins([
      scene({
        plugins: normalizeStoryboardPluginDeclarations(DECL),
        camera: {
          version: 1,
          path: [
            { version: 1, move: "hold", toRegion: "intro-stage", startSec: 0, durationSec: 0.4 },
            { version: 1, move: "pan", toRegion: "metric-station", startSec: 0.4, durationSec: 2.1 },
          ],
        },
      }),
    ]);
    // Camera opens on intro-stage; arrival 2.5s, 0.2s lead → 2.3s; well past
    // the 0.6s default anchor.
    expect(firstBeatAt(result.scenes)).toBeCloseTo(2.3, 2);
  });

  it("matches a track-to-anchor landing on a CHILD part of the unit", () => {
    const result = reconcileAndLowerPlugins([
      scene({
        plugins: normalizeStoryboardPluginDeclarations(DECL),
        camera: {
          version: 1,
          path: [
            { version: 1, move: "hold", toRegion: "intro-stage", startSec: 0, durationSec: 0.5 },
            {
              version: 1,
              move: "track-to-anchor",
              toPart: "metrics-tile-2",
              startSec: 0.5,
              durationSec: 1.5,
            },
          ],
        },
      }),
    ]);
    expect(firstBeatAt(result.scenes)).toBeCloseTo(1.8, 2);
  });

  it("keeps the default entrance when the camera OPENS on the unit's station (asset-probe-1)", () => {
    // The g2-still shape: hold AT the station, then a same-region push-in.
    // The push-in re-frames — it never "arrives" — so the entrance anchors at
    // the default instead of the 60% introduction cap (which manufactured a
    // pacing/holds rejection in a 3s scene).
    const result = reconcileAndLowerPlugins([
      scene({
        plugins: normalizeStoryboardPluginDeclarations(DECL),
        camera: {
          version: 1,
          path: [
            { version: 1, move: "hold", toRegion: "metric-station", startSec: 0, durationSec: 0.4 },
            {
              version: 1,
              move: "push-in",
              toRegion: "metric-station",
              zoom: 1.12,
              startSec: 0.5,
              durationSec: 1.9,
            },
          ],
        },
      }),
    ]);
    expect(firstBeatAt(result.scenes)).toBeCloseTo(0.6, 2);
  });

  it("keeps the default entrance when the FIRST segment's to-target is the unit (entry frame)", () => {
    // The runtime derives the scene's opening frame from the first segment's
    // from-else-to target, so a leading full move whose target is the unit's
    // own station starts on frame — no arrival delay.
    const result = reconcileAndLowerPlugins([
      scene({
        plugins: normalizeStoryboardPluginDeclarations(DECL),
        camera: {
          version: 1,
          path: [
            { version: 1, move: "push-in", toRegion: "metric-station", zoom: 1.2, startSec: 0.3, durationSec: 2.4 },
          ],
        },
      }),
    ]);
    expect(firstBeatAt(result.scenes)).toBeCloseTo(0.6, 2);
  });

  it("honors a from-target entry: a pan FROM elsewhere TO the unit still delays", () => {
    const result = reconcileAndLowerPlugins([
      scene({
        plugins: normalizeStoryboardPluginDeclarations(DECL),
        camera: {
          version: 1,
          path: [
            {
              version: 1,
              move: "pan",
              fromRegion: "intro-stage",
              toRegion: "metric-station",
              startSec: 0.4,
              durationSec: 2.1,
            },
          ],
        },
      }),
    ]);
    expect(firstBeatAt(result.scenes)).toBeCloseTo(2.3, 2);
  });

  it("caps the delay at the pacing gate's 60% introduction deadline", () => {
    const result = reconcileAndLowerPlugins([
      scene({
        plugins: normalizeStoryboardPluginDeclarations(DECL),
        camera: {
          version: 1,
          path: [
            { version: 1, move: "hold", toRegion: "intro-stage", startSec: 0, durationSec: 3.5 },
            { version: 1, move: "pan", toRegion: "metric-station", startSec: 3.5, durationSec: 2.2 },
          ],
        },
      }),
    ]);
    // Camera opens on intro-stage; arrival 5.7s in a 6s scene: clamp to
    // min(60% = 3.6s, end - 1.2 = 4.8s).
    expect(firstBeatAt(result.scenes)).toBeCloseTo(3.6, 2);
  });

  it("ignores hold/drift moves — they never re-frame", () => {
    const result = reconcileAndLowerPlugins([
      scene({
        plugins: normalizeStoryboardPluginDeclarations(DECL),
        camera: {
          version: 1,
          path: [
            { version: 1, move: "drift", toRegion: "metric-station", startSec: 0, durationSec: 4 },
          ],
        },
      }),
    ]);
    expect(firstBeatAt(result.scenes)).toBeCloseTo(0.6, 2);
  });
});

describe("author-duplicated absorbed parts are hidden at injection", () => {
  function absorbedScenes(): DirectScene[] {
    return reconcileAndLowerPlugins([
      scene({
        plugins: normalizeStoryboardPluginDeclarations([
          { version: 1, kind: "notification-stack", id: "notices", params: { count: 3 } },
        ]),
        components: [{ version: 1, id: "alert-toast", kind: "toast" }],
        beats: [
          {
            version: 1,
            id: "b-alert",
            sceneId: "s1",
            component: "alert-toast",
            kind: "open",
            atSec: 1,
          },
        ],
      }),
    ]).scenes;
  }

  it("records the absorbed part on the scene", () => {
    expect(absorbedScenes()[0]!.pluginAbsorbedParts).toEqual(["alert-toast"]);
  });

  it("injects a scene-scoped hide rule and stays byte-convergent", () => {
    const scenes = absorbedScenes();
    const once = injectPluginContract(sceneHtml("s1"), scenes).html;
    expect(once).toContain('#s1 [data-part="alert-toast"]{display:none!important}');
    const twice = injectPluginContract(once, scenes).html;
    expect(twice).toBe(once);
  });
});

describe("wrapper placement self-defense", () => {
  it("spans grid parents and clamps min sizing on the injected wrapper", () => {
    const scenes = reconcileAndLowerPlugins([declared(GRID_DECLARATION)]).scenes;
    const html = injectPluginContract(sceneHtml("s1"), scenes).html;
    const wrapper = html.match(/<div class="seq-plugin[^>]*>/)?.[0] ?? "";
    expect(wrapper).toContain('data-layout-important="1"');
    expect(wrapper).toContain("grid-column:1/-1");
    expect(wrapper).toContain("min-width:0");
    expect(wrapper).toContain("max-width:100%");
  });
});

describe("exact-copy duplicate stamping (fix-probe-1 doubled lockup)", () => {
  function lockupScenes(): DirectScene[] {
    return reconcileAndLowerPlugins([
      scene({
        plugins: normalizeStoryboardPluginDeclarations([
          {
            version: 1,
            kind: "lockup",
            id: "brand-lockup",
            params: { headline: "Every deploy, verified.", cta: "Start deploying" },
          },
        ]),
      }),
    ]).scenes;
  }

  const AUTHOR_DUPE_HTML =
    `<html><head></head><body>` +
    `<section id="s1" class="scene clip" data-scene="s1" data-start="0" data-duration="6">` +
    `<div class="stack"><div class="brand-headline">Every deploy, verified.</div>` +
    `<button class="cta"><span>Start deploying</span></button></div>` +
    `</section></body></html>`;

  it("stamps and hides author markup duplicating the unit's typed copy", () => {
    const scenes = lockupScenes();
    const once = injectPluginContract(AUTHOR_DUPE_HTML, scenes).html;
    expect(once).toContain(
      '<div class="brand-headline" data-sequences-plugin-duplicate="">',
    );
    expect(once).toContain('<span data-sequences-plugin-duplicate="">Start deploying</span>');
    expect(once).toContain("[data-sequences-plugin-duplicate]{display:none!important}");
    // The unit's OWN copy is never stamped (wrappers are stripped first, and
    // re-injected host markup carries no stamp).
    expect(once.match(/data-cmp-text[^>]*data-sequences-plugin-duplicate/)).toBeNull();
    const twice = injectPluginContract(once, scenes).html;
    expect(twice).toBe(once);
  });

  it("never stamps copy in OTHER scenes (cross-scene echoes are design)", () => {
    const scenes = lockupScenes();
    const html = AUTHOR_DUPE_HTML.replace(
      "</body>",
      `<section id="s2" class="scene clip" data-scene="s2" data-start="6" data-duration="4">` +
        `<div class="callback">Every deploy, verified.</div></section></body>`,
    );
    const result = injectPluginContract(html, scenes).html;
    expect(result).toContain('<div class="callback">Every deploy, verified.</div>');
  });
});
