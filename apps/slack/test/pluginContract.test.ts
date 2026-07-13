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
import { auditPacing, sceneIntroductionTimes } from "../src/engine/pacingAudit.ts";
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
      { kind: "flow-diagram" },
      { kind: "comparison-table" },
      { kind: "pricing-reveal" },
      { kind: "made-up-plugin" },
      { bogus: true },
      "junk",
    ]);
    expect(declarations.map((entry) => entry.id)).toEqual([
      "notices", "flow", "comparison", "pricing", "made-up-plugin",
    ]);
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

  it("retires a team-strip when a typed load-bearing avatar stack owns the station", () => {
    const result = reconcileAndLowerPlugins([
      scene({
        components: [{
          version: 1,
          id: "owner-avatar",
          kind: "avatar-stack",
          region: "team-strip",
          role: "support",
        }],
        camera: {
          version: 1,
          path: [{
            version: 1,
            move: "track-to-anchor",
            startSec: 1,
            durationSec: 1,
            toPart: "owner-avatar",
          }],
        },
        spatialIntent: {
          version: 1,
          focalPart: "owner-avatar",
          composition: "owner led",
          relationships: [],
        },
        plugins: normalizeStoryboardPluginDeclarations([{
          kind: "team-strip",
          id: "owner-strip",
          region: "team-strip",
          params: { people: 3, more: 2 },
        }]),
      }),
    ]);
    const lowered = result.scenes[0]!;
    expect(lowered.plugins).toBeUndefined();
    expect((lowered.components ?? []).map((entry) => entry.id)).toEqual(["owner-avatar"]);
    expect(result.notes.join(" ")).toContain(
      'team-strip" retired because load-bearing avatar stack "owner-avatar"',
    );
  });

  it("lets a load-bearing station CTA complete a lockup without generating a second button", () => {
    const raw = scene({
      components: [{
        version: 1, id: "cta-pill", kind: "button", region: "cta-station", role: "hero",
      }],
      beats: [{
        version: 1, id: "cta-press", sceneId: "s1", component: "cta-pill",
        kind: "set-state", atSec: 4.5, durationSec: 0.6, toState: "open",
      }],
      interactions: [{
        version: 1, id: "press-cta", sceneId: "s1", cursorId: "cursor",
        targetPart: "cta-pill", action: "click", startSec: 4, arriveSec: 4.5,
      } as never],
      plugins: normalizeStoryboardPluginDeclarations([{
        kind: "lockup", id: "cta-lockup", region: "cta-station",
        params: { headline: "Book with Roamly", sub: "One calm click.", cta: "Start shipping" },
      }]),
    });
    const first = reconcileAndLowerPlugins([raw]);
    const lowered = first.scenes[0]!;
    expect((lowered.components ?? []).map((entry) => entry.id)).toContain("cta-pill");
    expect((lowered.components ?? []).map((entry) => entry.id)).not.toContain("cta-lockup-cta");
    expect((lowered.beats ?? []).some((entry) => entry.component === "cta-lockup-cta")).toBe(false);
    expect(lowered.plugins?.[0]?.params.cta).toBe("");
    expect(first.notes.join(" ")).toContain("reuses load-bearing station CTA");

    // Reconcile an older persisted lowering as well: its generated child and
    // entrance beat are retired while the authored interaction target stays.
    const legacy = reconcileAndLowerPlugins([raw]).scenes[0]!;
    legacy.components = [
      ...(legacy.components ?? []),
      { version: 1, id: "cta-lockup-cta", kind: "button", pluginUid: "s1-cta-lockup" },
    ];
    legacy.beats = [
      ...(legacy.beats ?? []),
      { version: 1, id: "cta-lockup-b3", sceneId: "s1", component: "cta-lockup-cta", kind: "open", atSec: 1 },
    ];
    legacy.plugins![0]!.params.cta = "Start shipping";
    const replayed = reconcileAndLowerPlugins([legacy]).scenes[0]!;
    expect((replayed.components ?? []).map((entry) => entry.id)).not.toContain("cta-lockup-cta");
    expect((replayed.beats ?? []).some((entry) => entry.component === "cta-lockup-cta")).toBe(false);
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

  it("keeps every plugin child in its declared camera station across re-parses", () => {
    const first = reconcileAndLowerPlugins([scene({
      plugins: normalizeStoryboardPluginDeclarations([{
        kind: "lockup",
        id: "ship-lockup",
        region: "cta-center",
        params: {
          headline: "Start shipping",
          sub: "One board. One timeline. One confident ship.",
          cta: "Get started",
        },
      }]),
    })]).scenes[0]!;
    expect((first.components ?? []).every((entry) => entry.region === "cta-center")).toBe(true);

    const echoed: DirectScene = {
      ...first,
      components: (first.components ?? []).map(
        ({ pluginUid: _uid, region: _region, ...entry }) => entry,
      ),
    };
    const replayed = reconcileAndLowerPlugins([echoed]).scenes[0]!;
    expect((replayed.components ?? []).every((entry) => entry.pluginUid === "s1-ship-lockup")).toBe(true);
    expect((replayed.components ?? []).every((entry) => entry.region === "cta-center")).toBe(true);
  });

  it("refreshes host beat timing when an existing plugin's camera arrival changes", () => {
    const first = reconcileAndLowerPlugins([scene({
      plugins: normalizeStoryboardPluginDeclarations([{
        kind: "lockup", id: "proof-lockup", region: "proof-station",
        params: { headline: "Proof lands here" },
      }]),
    })]).scenes[0]!;
    const early = first.beats?.find((entry) => entry.id === "proof-lockup-b1")?.atSec;
    const replayed = reconcileAndLowerPlugins([{
      ...first,
      camera: {
        version: 1,
        path: [{
          version: 1, move: "pan", fromRegion: "overview", toRegion: "proof-station",
          startSec: 3, durationSec: 2,
        }],
      },
    }]).scenes[0]!;
    const refreshed = replayed.beats?.filter((entry) => entry.id === "proof-lockup-b1") ?? [];
    expect(early).toBeLessThan(1);
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]!.atSec).toBeGreaterThan(3);
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

  it("ships lockups at display scale instead of inheriting compact component type", () => {
    const scenes = reconcileAndLowerPlugins([
      scene({
        plugins: normalizeStoryboardPluginDeclarations([{
          kind: "lockup",
          params: { headline: "Book with Roamly", sub: "One calm click.", cta: "Start now" },
        }]),
      }),
    ]).scenes;
    const html = injectPluginContract(
      `<html><head></head><body><section id="s1" class="scene" data-scene="s1"></section></body></html>`,
      scenes,
    ).html;
    expect(html).toContain("font-size:clamp(72px,7.2vw,138px)");
    expect(html).toContain("font-size:clamp(24px,2.2vw,42px)");
    expect(html).toContain("width:min(100%,1200px)");
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

  it("keeps a regionless lockup above opaque authored surfaces in a safe station", () => {
    const scenes = reconcileAndLowerPlugins([
      scene({
        plugins: normalizeStoryboardPluginDeclarations([{
          version: 1,
          kind: "lockup",
          id: "cta-lockup",
          params: { headline: "Resolve in minutes", cta: "Start now" },
        }]),
      }),
    ]).scenes;
    const html = injectPluginContract(
      `<html><head></head><body><section id="s1" class="scene" data-scene="s1">` +
        `<div class="cmp-window" style="position:absolute;inset:64px;z-index:10"></div>` +
        `</section></body></html>`,
      scenes,
    ).html;
    expect(html).toContain('data-sequences-plugin-placement="scene-center-overlay"');
    expect(html).toContain("position:absolute;left:50%;top:50%;z-index:30");
  });

  it("lands a regionless lockup in an authored semantic CTA slot instead of floating over the UI", () => {
    const scenes = reconcileAndLowerPlugins([
      scene({
        plugins: normalizeStoryboardPluginDeclarations([{
          version: 1,
          kind: "lockup",
          id: "cta-lockup",
          params: { headline: "Resolve in minutes", cta: "Start now" },
        }]),
      }),
    ]).scenes;
    const html = injectPluginContract(
      `<html><head></head><body><section id="s1" class="scene" data-scene="s1">` +
        `<div class="cmp-window"><div class="cmp-body">` +
        `<div class="cta-area"><!-- host lockup --></div>` +
        `</div></div></section></body></html>`,
      scenes,
    ).html;
    const slotIndex = html.indexOf('class="cta-area"');
    const pluginIndex = html.indexOf('data-sequences-plugin="lockup"');
    const slotCloseIndex = html.indexOf("</div>", slotIndex);
    expect(pluginIndex).toBeGreaterThan(slotIndex);
    expect(pluginIndex).toBeLessThan(slotCloseIndex);
    expect(html).toContain('data-sequences-plugin-placement="semantic-slot"');
    expect(html).not.toContain('data-sequences-plugin-placement="scene-center-overlay"');
    expect(html).not.toContain("position:absolute;left:50%;top:50%");
    expect(injectPluginContract(html, scenes).html).toBe(html);
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

describe("flow-diagram plugin (endpoint-bound topology)", () => {
  const DECL = [{
    kind: "flow-diagram",
    params: { nodes: 5, topology: "fan-out", topic: "deploy approval workflow" },
  }];

  it("lowers seeded nodes and connector paths into typed component beats", () => {
    const first = reconcileAndLowerPlugins([declared(DECL)]);
    const second = reconcileAndLowerPlugins([declared(DECL)]);
    expect(JSON.stringify(first.scenes)).toBe(JSON.stringify(second.scenes));
    expect(resolvePluginPlan(first.scenes)).toEqual(resolvePluginPlan(second.scenes));
    const lowered = first.scenes[0]!;
    const components = lowered.components ?? [];
    const nodes = components.filter((entry) => entry.kind === "stat-card");
    const edges = components.filter((entry) => entry.kind === "chart-line");
    expect(nodes).toHaveLength(5);
    expect(edges).toHaveLength(6);
    expect(new Set(components.map((entry) => entry.pluginUid))).toEqual(new Set(["s1-flow"]));
    expect((lowered.beats ?? []).filter((entry) => entry.kind === "open")).toHaveLength(5);
    expect((lowered.beats ?? []).filter((entry) => entry.kind === "chart")).toHaveLength(6);
    for (const entry of lowered.beats ?? []) {
      expect(entry.atSec).toBeGreaterThanOrEqual(0);
      expect(entry.atSec).toBeLessThanOrEqual(6);
    }
  });

  it("binds every edge to emitted node parts and their exact anchor sides", () => {
    const scenes = reconcileAndLowerPlugins([declared(DECL)]).scenes;
    const markup = resolvePluginPlan(scenes)[0]!.markup;
    const nodeParts = new Set(
      [...markup.matchAll(/data-flow-node="\d+" data-part="([^"]+)"/g)]
        .map((match) => match[1]!),
    );
    const edges = [...markup.matchAll(
      /data-flow-edge="[^"]+" data-part="[^"]+" data-edge-from="([^"]+)" data-edge-from-anchor="([^"]+)" data-edge-to="([^"]+)" data-edge-to-anchor="([^"]+)"/g,
    )];
    expect(nodeParts.size).toBe(5);
    expect(edges).toHaveLength(6);
    for (const edge of edges) {
      expect(nodeParts.has(edge[1]!)).toBe(true);
      expect(edge[2]).toBe("right");
      expect(nodeParts.has(edge[3]!)).toBe(true);
      expect(edge[4]).toBe("left");
    }
    expect((markup.match(/<path class="cmp-stroke"/g) ?? [])).toHaveLength(6);
    expect(markup).not.toMatch(/Item \d/);
  });
});

describe("comparison-table plugin (seeded aligned matrix)", () => {
  const DECL = [{
    kind: "comparison-table",
    params: { choices: 3, features: 5, topic: "agent evaluation controls" },
  }];

  it("lowers to one table and one rows beat with deterministic real content", () => {
    const first = reconcileAndLowerPlugins([declared(DECL)]);
    const second = reconcileAndLowerPlugins([declared(DECL)]);
    expect(JSON.stringify(first.scenes)).toBe(JSON.stringify(second.scenes));
    expect(resolvePluginPlan(first.scenes)).toEqual(resolvePluginPlan(second.scenes));
    const lowered = first.scenes[0]!;
    expect(lowered.components).toEqual([
      { version: 1, id: "comparison-matrix", kind: "table", pluginUid: "s1-comparison" },
    ]);
    expect(lowered.beats).toHaveLength(2);
    expect(lowered.beats?.map((entry) => entry.kind)).toEqual(["rows", "highlight"]);
    const markup = resolvePluginPlan(first.scenes)[0]!.markup;
    expect((markup.match(/data-comparison-row=/g) ?? [])).toHaveLength(5);
    expect((markup.match(/data-comparison-choice=/g) ?? [])).toHaveLength(15);
    expect(markup).toContain("--seq-comparison-choices:3");
    expect(markup).not.toMatch(/Item \d/);
  });
});

describe("pricing-reveal plugin (seeded tier count-ups)", () => {
  const DECL = [{
    kind: "pricing-reveal",
    params: { tiers: 4, billing: "annual", currency: "eur", featured: 3, topic: "analytics" },
  }];

  it("lowers every card to an open plus count beat and one featured tier", () => {
    const first = reconcileAndLowerPlugins([declared(DECL)]);
    const second = reconcileAndLowerPlugins([declared(DECL)]);
    expect(JSON.stringify(first.scenes)).toBe(JSON.stringify(second.scenes));
    expect(resolvePluginPlan(first.scenes)).toEqual(resolvePluginPlan(second.scenes));
    const lowered = first.scenes[0]!;
    expect(lowered.components).toHaveLength(4);
    expect(lowered.components?.every((entry) => entry.kind === "stat-card")).toBe(true);
    expect((lowered.beats ?? []).filter((entry) => entry.kind === "open")).toHaveLength(4);
    const countBeats = (lowered.beats ?? []).filter((entry) => entry.kind === "count");
    expect(countBeats).toHaveLength(4);
    expect(countBeats.every((entry) => Number(entry.value) > 0)).toBe(true);
    const markup = resolvePluginPlan(first.scenes)[0]!.markup;
    expect((markup.match(/data-price-tier=/g) ?? [])).toHaveLength(4);
    expect((markup.match(/data-featured="true"/g) ?? [])).toHaveLength(1);
    expect(markup).toMatch(/€\d+\/yr/);
  });

  it("retargets an unresolved morph carrier to the one featured plugin card", () => {
    const result = reconcileAndLowerPlugins([
      scene({
        id: "plans",
        cut: {
          version: 1,
          style: "morph",
          focalPartOut: "growth-card",
          focalPartIn: "invoice-panel",
        },
        spatialIntent: {
          version: 1,
          focalPart: "growth-card",
          composition: "layout-split",
          relationships: ["Featured plan resolves before the invoice"],
        },
        plugins: normalizeStoryboardPluginDeclarations([{
          kind: "pricing-reveal",
          id: "plan-cards",
          params: { tiers: 3, featured: 2 },
        }]),
      }),
      scene({
        id: "invoice",
        startSec: 6,
        components: [{ version: 1, id: "invoice-panel", kind: "app-window" }],
      }),
    ]);
    const plans = result.scenes[0]!;
    expect(plans.spatialIntent?.focalPart).toBe("plan-cards-tier-2");
    expect(plans.cut?.style).toBe("swipe");
    expect(plans.sentinelNormalizations?.join(" ")).toContain(
      'retargeted unresolved focal "growth-card" to selected plugin child "plan-cards-tier-2"',
    );
    expect(plans.sentinelNormalizations?.join(" ")).toContain(
      "downgraded impossible metric->product-surface morph to swipe-right",
    );
  });
});

describe("generated plugin defaults", () => {
  it("ships complete no-paperwork defaults for all three generated set-pieces", () => {
    const result = reconcileAndLowerPlugins([
      declared([
        { kind: "flow-diagram", params: {} },
        { kind: "comparison-table", params: {} },
        { kind: "pricing-reveal", params: {} },
      ]),
    ]);
    expect(result.notes).toEqual([]);
    expect(result.scenes[0]!.plugins?.map((entry) => [entry.kind, entry.params])).toEqual([
      ["flow-diagram", { nodes: 4, topology: "pipeline", topic: "" }],
      ["comparison-table", { choices: 3, features: 4, topic: "" }],
      ["pricing-reveal", {
        tiers: 3, billing: "monthly", currency: "usd", featured: 2, topic: "",
      }],
    ]);
  });
});

describe("asset metric ownership", () => {
  it("retires a glass metric that duplicates a counted hero stat in its station", () => {
    const result = reconcileAndLowerPlugins([scene({
      components: [{
        version: 1,
        id: "savings-card",
        kind: "stat-card",
        region: "savings-station",
        role: "hero",
      }],
      beats: [{
        version: 1,
        id: "savings-count",
        sceneId: "s1",
        component: "savings-card",
        kind: "count",
        atSec: 1,
        value: 18,
      }],
      plugins: normalizeStoryboardPluginDeclarations([{
        kind: "asset-glass-metric",
        id: "savings-medallion",
        region: "savings-station",
        params: { value: "18%", label: "Team savings" },
      }]),
    })]);
    expect(result.scenes[0]!.plugins).toBeUndefined();
    expect(result.scenes[0]!.components?.map((entry) => entry.id)).toEqual(["savings-card"]);
    expect(result.notes.join(" ")).toContain(
      'load-bearing hero metric "savings-card" already owns region "savings-station"',
    );
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

  it("keeps the default entrance when a target-less drift opens a single-station scene (quillsign)", () => {
    // motion-quality-verify-2-quillsign ship-it shape: "drift, push-in→cta-stage".
    // The drift has no target, but the camera path never names any OTHER
    // station — the world IS the unit's station, so the push-in is a re-frame.
    // Reading it as a late arrival anchored the final CTA lockup's entrance at
    // 24.85s of a 25.7s film and stranded the declared assemble moment.
    const result = reconcileAndLowerPlugins([
      scene({
        plugins: normalizeStoryboardPluginDeclarations(DECL),
        camera: {
          version: 1,
          path: [
            { version: 1, move: "drift", startSec: 0, durationSec: 2 },
            {
              version: 1,
              move: "push-in",
              toRegion: "metric-station",
              zoom: 1.15,
              startSec: 3.2,
              durationSec: 1.6,
            },
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

  it("treats a first drift to the unit as its opening frame", () => {
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

  it("anchors a plugin near a later cross-station drift instead of animating it offscreen", () => {
    const result = reconcileAndLowerPlugins([
      scene({
        plugins: normalizeStoryboardPluginDeclarations(DECL),
        camera: {
          version: 1,
          path: [
            { version: 1, move: "hold", toRegion: "intro-stage", startSec: 0, durationSec: 3 },
            { version: 1, move: "drift", toRegion: "metric-station", startSec: 3, durationSec: 2 },
          ],
        },
      }),
    ]);
    // Arrival is 5.0s; the shared 60%-introduction cap keeps the entrance at
    // 3.6s instead of letting the unit animate unseen at 0.6s.
    expect(firstBeatAt(result.scenes)).toBeCloseTo(3.6, 2);
  });

  it("compresses a source-station toast cascade before the camera departs (LaunchRelay)", () => {
    const result = reconcileAndLowerPlugins([
      scene({
        durationSec: 4.9,
        plugins: normalizeStoryboardPluginDeclarations([{
          version: 1,
          kind: "notification-stack",
          id: "scatter-notifs",
          region: "chaos-zone",
          params: { count: 4, tone: "mixed" },
        }]),
        camera: {
          version: 1,
          path: [
            { version: 1, move: "hold", toRegion: "chaos-zone", startSec: 0, durationSec: 2.6 },
            {
              version: 1,
              move: "whip",
              fromRegion: "chaos-zone",
              toRegion: "rail-zone",
              startSec: 2.6,
              durationSec: 0.8,
            },
          ],
        },
      }),
    ]);
    const lowered = result.scenes[0]!;
    const opens = lowered.beats!.filter((entry) => entry.id.startsWith("scatter-notifs-b"));
    expect(opens.map((entry) => entry.atSec)).toEqual([0.588, 0.825, 1.063, 1.3]);
    expect(Math.max(...opens.map((entry) => entry.atSec + (entry.durationSec ?? 0) + 0.8)))
      .toBeLessThanOrEqual(2.6);
    expect(auditPacing([lowered]).filter((finding) =>
      finding.startsWith("pacing/outcome:")
    )).toEqual([]);
  });

  it("honors an explicit from-region after a targetless opening drift", () => {
    const result = reconcileAndLowerPlugins([
      scene({
        durationSec: 4.9,
        plugins: normalizeStoryboardPluginDeclarations([{
          version: 1,
          kind: "notification-stack",
          id: "alerts",
          region: "source-zone",
          params: { count: 4 },
        }]),
        camera: {
          version: 1,
          path: [
            { version: 1, move: "drift", startSec: 0, durationSec: 0.4 },
            {
              version: 1,
              move: "pan",
              fromRegion: "source-zone",
              toRegion: "proof-zone",
              startSec: 2.6,
              durationSec: 0.8,
            },
          ],
        },
      }),
    ]);
    const opens = result.scenes[0]!.beats!.filter((entry) => entry.id.startsWith("alerts-b"));
    expect(Math.max(...opens.map((entry) => entry.atSec + (entry.durationSec ?? 0) + 0.8)))
      .toBeLessThanOrEqual(2.6);
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
    expect(wrapper).toContain('data-layout-important-from="');
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
            params: {
              headline: "Every deploy, verified.",
              sub: "One release command center.",
              cta: "Start deploying",
            },
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

  it("lands the CTA inside the lockup entrance ensemble", () => {
    const lowered = lockupScenes()[0]!;
    const headline = lowered.beats!.find((beat) => beat.component === "brand-lockup-headline")!;
    const cta = lowered.beats!.find((beat) => beat.component === "brand-lockup-cta")!;
    expect(cta.atSec - headline.atSec).toBeCloseTo(0.2, 3);
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

  it("clears a stale CTA duplicate stamp when a lockup starts reusing authored control copy", () => {
    const first = injectPluginContract(AUTHOR_DUPE_HTML, lockupScenes()).html;
    const withoutGeneratedCta = lockupScenes();
    withoutGeneratedCta[0]!.plugins![0]!.params.cta = "";
    const replayed = injectPluginContract(first, withoutGeneratedCta).html;
    expect(replayed).toContain("<span>Start deploying</span>");
    expect(replayed).not.toContain(
      '<span data-sequences-plugin-duplicate="">Start deploying</span>',
    );
    // Headline duplication is still current and remains hidden.
    expect(replayed).toContain(
      '<div class="brand-headline" data-sequences-plugin-duplicate="">',
    );
  });
});

describe("anonymous dashboard-grid duplicate stamping (LumaFlowQC1 clipped metric wall)", () => {
  const scenes = reconcileAndLowerPlugins([
    scene({
      plugins: normalizeStoryboardPluginDeclarations([
        {
          version: 1,
          kind: "dashboard-grid",
          id: "metrics",
          region: "dashboard-overview",
          params: { tiles: 4, emphasis: "mixed", topic: "release readiness" },
        },
      ]),
      components: [{ version: 1, id: "risk-card", kind: "stat-card", region: "dashboard-overview" }],
    }),
  ]).scenes;
  const html = sceneHtml("s1").replace(
    "</section>",
    `<div data-region="dashboard-overview">` +
      `<div class="row" data-part="metric-row">` +
      `<div class="metric-tile" data-part="tile-1">Latency</div>` +
      `<div class="metric-tile" data-part="tile-2">Errors</div>` +
      `<div class="metric-tile" data-part="tile-3">Deploys</div>` +
      `<div class="metric-tile" data-part="tile-4">MTTR</div></div>` +
      `<div data-component="stat-card" data-part="risk-card">87</div></div></section>`,
  );

  it("hides the anonymous duplicate row but preserves the declared focal component", () => {
    const once = injectPluginContract(html, scenes).html;
    expect(once).toContain(
      '<div class="row" data-part="metric-row" data-sequences-plugin-duplicate="">',
    );
    expect(once).toContain('<div data-component="stat-card" data-part="risk-card">87</div>');
    expect(once).toContain("[data-sequences-plugin-duplicate]{display:none!important}");
    expect(injectPluginContract(once, scenes).html).toBe(once);
  });
});
