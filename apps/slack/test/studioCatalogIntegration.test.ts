import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { retrieveHyperframesSkillContext } from "../src/agent/skillContext.ts";
import { ASSET_LIBRARY } from "../src/engine/assets/index.ts";
import { CAMERA_PATTERNS } from "../src/engine/cameraPatterns.ts";
import { COMPONENT_CATALOG } from "../src/engine/componentContract.ts";
import { DESIGN_DIALECTS } from "../src/engine/designDialects.ts";
import {
  injectPluginContract,
  PLUGIN_CATALOG,
} from "../src/engine/pluginContract.ts";
import {
  AttemptLedger,
  deriveSentinelRunView,
} from "../src/engine/runner/attemptLedger.ts";
import {
  autoDeclareHighConfidenceAssets,
  recordStudioCatalogConversions,
  studioLibraryConversionCounts,
  studioLibraryVocabulary,
  type StudioConversionCounts,
} from "../src/engine/studioLibrary.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import {
  activeSentinelLedgerEvents,
  beginSentinelRun,
  finalizeSentinelRun,
} from "../src/engine/sentinelTelemetry.ts";

describe("Studio catalog end-to-end discovery", () => {
  it("offers only catalog entries with typed conversion evidence", () => {
    const component = COMPONENT_CATALOG.find((item) => !item.internal)!;
    const asset = ASSET_LIBRARY[0]!;
    const look = DESIGN_DIALECTS[0]!;
    const camera = CAMERA_PATTERNS[0]!;
    const plugin = PLUGIN_CATALOG.find((item) => !item.kind.startsWith("asset-"))!;
    const counts: StudioConversionCounts = {
      components: { [component.kind]: 1 },
      assets: { [asset.id]: 1 },
      looks: { [look.id]: 1 },
      camera: { [camera.id]: 1 },
      plugins: { [plugin.kind]: 1 },
      recipes: {},
    };
    const vocabulary = studioLibraryVocabulary({ conversionCounts: counts });
    expect(vocabulary).toContain(component.kind);
    expect(vocabulary).toContain(asset.id);
    expect(vocabulary).toContain(look.id);
    expect(vocabulary).toContain(camera.id);
    expect(vocabulary).toContain(plugin.kind);
    expect(vocabulary).not.toContain(COMPONENT_CATALOG.find((item) => !item.internal && item.kind !== component.kind)!.kind);
    expect(vocabulary).not.toContain(ASSET_LIBRARY.find((item) => item.id !== asset.id)!.id);
  });

  it("folds persisted conversion events and old typed artifacts", () => {
    const root = fs.mkdtempSync(path.join(process.env.TEMP ?? process.cwd(), "studio-capsule-"));
    try {
      const planning = path.join(root, "job-1", "planning");
      fs.mkdirSync(planning, { recursive: true });
      fs.writeFileSync(path.join(planning, "attempt-ledger.json"), JSON.stringify({
        version: 1,
        events: [
          { kind: "catalog-conversion", catalog: "assets", entry: "glass-metric", count: 2 },
          { kind: "catalog-conversion", catalog: "camera", entry: "push-and-hold" },
        ],
      }), "utf8");
      const oldPlanning = path.join(root, "job-0", "planning");
      fs.mkdirSync(oldPlanning, { recursive: true });
      fs.writeFileSync(path.join(oldPlanning, "storyboard.json"), JSON.stringify({
        storyboard: [{
          components: [{ kind: "stat-card" }],
          plugins: [{ kind: "asset-glass-metric" }],
        }],
      }), "utf8");
      const legacyDialect = DESIGN_DIALECTS[0]!.id;
      fs.writeFileSync(path.join(root, "job-0", "frame.md"),
        `<!-- sequences-frame: {"dialectId":"${legacyDialect}"} -->`, "utf8");
      const counts = studioLibraryConversionCounts(path.join(root));
      expect(counts.assets["glass-metric"]).toBe(3);
      expect(counts.camera["push-and-hold"]).toBe(1);
      expect(counts.components["stat-card"]).toBe(1);
      expect(counts.looks[legacyDialect]).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("host-declares a matching asset without planner opt-in", () => {
    const scene: DirectScene = {
      id: "hero",
      title: "Glass metric hero",
      purpose: "Reveal the glass metric that anchors the launch",
      foreground: "A glass metric medallion at 41% with label 'RELEASE READINESS'",
      background: "Quiet product workspace",
      startSec: 0,
      durationSec: 5,
    };
    const result = autoDeclareHighConfidenceAssets([scene], "Show the glass metric hero");
    expect(result.declared).toEqual([
      { assetId: "glass-metric", sceneId: "hero", score: expect.any(Number) },
    ]);
    expect(result.scenes[0]!.plugins?.[0]).toMatchObject({
      kind: "asset-glass-metric",
      id: "glass-metric",
      uid: "hero-glass-metric",
      params: {
        ring: 41,
        value: "41%",
        label: "RELEASE READINESS",
      },
    });
    expect(result.scenes[0]!.components).toContainEqual(expect.objectContaining({
      id: "glass-metric-core",
      kind: "asset",
      pluginUid: "hero-glass-metric",
    }));
    const injected = injectPluginContract(
      `<html><head></head><body><section id="hero"></section></body></html>`,
      result.scenes,
    );
    expect(injected.injected).toEqual(["hero-glass-metric"]);
    expect(injected.html).toContain('data-sequences-plugin="asset-glass-metric"');
    expect(injected.html).toContain('class="gm-value" data-part="glass-metric-core-value">41%</div>');
    expect(injected.html).toContain('<div class="gm-label">RELEASE READINESS</div>');
  });

  it("declines catalog demo copy when semantic asset params are ungrounded", () => {
    const scene: DirectScene = {
      id: "hero",
      title: "Glass metric hero",
      purpose: "Reveal the glass metric that anchors the launch",
      foreground: "A glass metric medallion",
      background: "Quiet product workspace",
      startSec: 0,
      durationSec: 5,
    };
    const result = autoDeclareHighConfidenceAssets([scene], "Show the glass metric hero");
    expect(result.declared).toEqual([]);
    expect(result.declined).toEqual([{
      assetId: "glass-metric",
      sceneId: "hero",
      reason: "semantic-params-ungrounded",
    }]);
    expect(result.scenes).toEqual([scene]);
  });

  it("keeps one typed metric hero instead of auto-declaring a duplicate asset", () => {
    const scene: DirectScene = {
      id: "hero-metric-41",
      title: "Glass metric hero at 41%",
      purpose: "Establish the one release-readiness metric",
      foreground: "One glass medallion at 41% with label 'RELEASE READINESS'",
      background: "Near-black field",
      startSec: 0,
      durationSec: 3.6,
      components: [{
        version: 1,
        id: "continuity-metric",
        kind: "progress-ring",
        region: "metric-hero",
        role: "hero",
        entityId: "metric",
      }],
      spatialIntent: {
        version: 1,
        focalPart: "continuity-metric",
        composition: "layout-center-stack",
        relationships: [],
      },
    };
    const result = autoDeclareHighConfidenceAssets(
      [scene],
      "Show the glass-metric release-readiness story at 41%",
    );
    expect(result.declared).toEqual([]);
    expect(result.declined).toEqual([{
      assetId: "glass-metric",
      sceneId: "hero-metric-41",
      reason: "typed-hero-already-owns-idea",
    }]);
    expect(result.scenes[0]!.plugins).toBeUndefined();
    expect(result.scenes[0]!.components).toEqual(scene.components);
  });

  it("counts only reconciled asset declarations as conversion evidence", () => {
    const root = fs.mkdtempSync(path.join(process.env.TEMP ?? process.cwd(), "studio-proof-"));
    try {
      beginSentinelRun(root);
      recordStudioCatalogConversions([{
        id: "paperwork",
        title: "Paperwork only",
        purpose: "No injectable unit",
        startSec: 0,
        durationSec: 4,
        plugins: [{
          version: 1,
          kind: "asset-glass-metric",
          id: "glass-metric",
          params: {},
        }],
      }]);
      recordStudioCatalogConversions([{
        id: "typed",
        title: "Typed unit",
        purpose: "Injectable unit",
        startSec: 0,
        durationSec: 4,
        plugins: [{
          version: 1,
          kind: "asset-glass-metric",
          id: "glass-metric",
          params: {},
          uid: "typed-glass-metric",
        }],
      }]);
      const conversions = (activeSentinelLedgerEvents() ?? []).filter((event) =>
        event.kind === "catalog-conversion" && event.catalog === "assets"
      );
      expect(conversions).toHaveLength(1);
      expect(conversions[0]).toMatchObject({ entry: "glass-metric", count: 1 });
      finalizeSentinelRun("published");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("records per-entry conversion totals in the append-only ledger fold", () => {
    const ledger = new AttemptLedger();
    ledger.append({ kind: "run-start", projectDir: "/studio-capsule" }, 0);
    ledger.append({ kind: "catalog-conversion", catalog: "assets", entry: "glass-metric", count: 2 }, 1);
    ledger.append({ kind: "catalog-conversion", catalog: "assets", entry: "glass-metric" }, 2);
    ledger.append({ kind: "finalize", disposition: "published" }, 3);
    const view = deriveSentinelRunView(ledger.events);
    expect(view.catalogConversions?.assets).toEqual({
      conversions: 3,
      entries: { "glass-metric": 3 },
    });
  });


  it("places the inventory in the shared skill context used by planner and author", () => {
    const context = retrieveHyperframesSkillContext("create", "A fast SaaS launch commercial");
    expect(context.text).toContain("## Sequences Studio library");
    expect(context.text).toContain("proven typed entries only");
  });

  it("keeps Studio UI state derived from the same catalogs", () => {
    const server = fs.readFileSync(
      path.resolve(import.meta.dirname, "..", "studio", "server.ts"),
      "utf8",
    );
    for (const symbol of [
      "COMPONENT_CATALOG",
      "ASSET_LIBRARY",
      "DESIGN_DIALECTS",
      "CAMERA_PATTERNS",
      "PLUGIN_CATALOG",
    ]) {
      expect(server, symbol).toContain(symbol);
    }
  });
});
