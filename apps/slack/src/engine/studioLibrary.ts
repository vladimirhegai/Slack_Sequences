/**
 * Compact, generated inventory of the operator-curated Studio library.
 *
 * The capsule is intentionally evidence-backed: an entry is offered only
 * after a typed declaration has converted in a prior run. The five catalogs
 * remain visible as headings only when they have eligible entries, so the
 * planner sees production vocabulary rather than a wish-list of dead APIs.
 */
import fs from "node:fs";
import path from "node:path";
import type { DirectScene } from "./directComposition.ts";
import { COMPONENT_CATALOG } from "./componentContract.ts";
import { ASSET_LIBRARY } from "./assets/index.ts";
import type { AssetDefinitionV1 } from "./assetContract.ts";
import { DESIGN_DIALECTS } from "./designDialects.ts";
import { CAMERA_PATTERNS } from "./cameraPatterns.ts";
import {
  PLUGIN_CATALOG,
  reconcileAndLowerPlugins,
  type PluginDeclarationV1,
} from "./pluginContract.ts";
import { recordSentinelCatalogConversion } from "./sentinelTelemetry.ts";

export const STUDIO_LIBRARY_CATALOGS = [
  "components",
  "assets",
  "looks",
  "camera",
  "plugins",
  "recipes",
] as const;

export type StudioLibraryCatalog = (typeof STUDIO_LIBRARY_CATALOGS)[number];
export type StudioConversionCounts = {
  [Catalog in StudioLibraryCatalog]: Readonly<Record<string, number>>;
};

function emptyCounts(): Record<StudioLibraryCatalog, Record<string, number>> {
  return {
    components: {},
    assets: {},
    looks: {},
    camera: {},
    plugins: {},
    recipes: {},
  };
}

function count(
  counts: Record<StudioLibraryCatalog, Record<string, number>>,
  catalog: StudioLibraryCatalog,
  entry: string,
  amount = 1,
): void {
  const normalized = entry.trim();
  if (!normalized) return;
  counts[catalog][normalized] = (counts[catalog][normalized] ?? 0) + amount;
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function countStoryboard(
  counts: Record<StudioLibraryCatalog, Record<string, number>>,
  storyboard: unknown,
): void {
  if (!Array.isArray(storyboard)) return;
  for (const rawScene of storyboard) {
    if (!rawScene || typeof rawScene !== "object") continue;
    const scene = rawScene as Record<string, unknown>;
    if (Array.isArray(scene.components)) {
      for (const rawComponent of scene.components) {
        if (!rawComponent || typeof rawComponent !== "object") continue;
        const kind = (rawComponent as Record<string, unknown>).kind;
        if (typeof kind === "string") count(counts, "components", kind);
      }
    }
    if (Array.isArray(scene.plugins)) {
      for (const rawPlugin of scene.plugins) {
        if (!rawPlugin || typeof rawPlugin !== "object") continue;
        const kind = (rawPlugin as Record<string, unknown>).kind;
        if (typeof kind !== "string") continue;
        if (kind.startsWith("asset-")) count(counts, "assets", kind.slice("asset-".length));
        else count(counts, "plugins", kind);
      }
    }
    if (Array.isArray(scene.recipes)) {
      for (const rawRecipe of scene.recipes) {
        if (!rawRecipe || typeof rawRecipe !== "object") continue;
        const id = (rawRecipe as Record<string, unknown>).id;
        if (typeof id === "string") count(counts, "recipes", id);
      }
    }
  }
}

function scanProject(
  counts: Record<StudioLibraryCatalog, Record<string, number>>,
  projectDir: string,
): void {
  const planning = path.join(projectDir, "planning");
  const ledger = readJson(path.join(planning, "attempt-ledger.json"));
  let hasLedgerConversions = false;
  if (Array.isArray(ledger?.events)) {
    for (const rawEvent of ledger.events) {
      if (!rawEvent || typeof rawEvent !== "object") continue;
      const event = rawEvent as Record<string, unknown>;
      if (event.kind === "catalog-conversion" &&
          typeof event.catalog === "string" &&
          STUDIO_LIBRARY_CATALOGS.includes(event.catalog as StudioLibraryCatalog) &&
          typeof event.entry === "string") {
        hasLedgerConversions = true;
        count(
          counts,
          event.catalog as StudioLibraryCatalog,
          event.entry,
          typeof event.count === "number" ? Math.max(1, Math.floor(event.count)) : 1,
        );
      }
    }
  }

  // Pre-S6.3 projects have no conversion events. Their already-persisted
  // typed storyboard/frame artifacts are valid historical evidence and seed
  // the capsule without changing their bytes. New runs have both event and
  // artifact files, so the fallback must not double-count them.
  if (!hasLedgerConversions) {
    const storyboard = readJson(path.join(planning, "storyboard.json"));
    countStoryboard(counts, storyboard?.storyboard);
    const frame = fs.existsSync(path.join(projectDir, "frame.md"))
      ? fs.readFileSync(path.join(projectDir, "frame.md"), "utf8")
      : "";
    const dialectId = frame.match(/"dialectId"\s*:\s*"([a-z0-9-]+)"/i)?.[1];
    if (dialectId) count(counts, "looks", dialectId);
  }
}

const DEFAULT_HISTORY_ROOT = path.resolve(import.meta.dirname, "../../.data", "projects");

/** Fold typed conversion evidence from all locally recorded jobs. */
export function studioLibraryConversionCounts(
  historyRoot = DEFAULT_HISTORY_ROOT,
): StudioConversionCounts {
  const counts = emptyCounts();
  if (!fs.existsSync(historyRoot)) return counts;
  for (const entry of fs.readdirSync(historyRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) scanProject(counts, path.join(historyRoot, entry.name));
  }
  return counts;
}

function line(label: string, entries: string[]): string {
  return entries.length ? `- ${label}: ${entries.join(" · ")}` : "";
}

export interface StudioLibraryVocabularyOptions {
  conversionCounts?: StudioConversionCounts;
}

export function studioLibraryVocabulary(
  options: StudioLibraryVocabularyOptions = {},
): string {
  const counts = options.conversionCounts ?? studioLibraryConversionCounts();
  const eligible = <T extends { id?: string; kind?: string }>(
    catalog: StudioLibraryCatalog,
    entries: readonly T[],
    key: (entry: T) => string,
  ): string[] => entries
    .map(key)
    .filter((id) => (counts[catalog][id] ?? 0) > 0);
  const components = eligible(
    "components",
    COMPONENT_CATALOG.filter((entry) => !entry.internal),
    (entry) => entry.kind,
  );
  const assets = eligible("assets", ASSET_LIBRARY, (entry) => entry.id);
  const looks = eligible("looks", DESIGN_DIALECTS, (entry) => entry.id);
  const cameras = eligible("camera", CAMERA_PATTERNS, (entry) => entry.id);
  const plugins = eligible(
    "plugins",
    PLUGIN_CATALOG.filter((entry) => !entry.kind.startsWith("asset-")),
    (entry) => entry.kind,
  );
  return [
    "## Sequences Studio library (host-curated; proven typed entries only)",
    "These entries converted through host-owned declaration paths in a recorded run. Prefer them over model-made substitutes; do not invent near-duplicates.",
    line("components", components),
    line("assets", assets),
    line("looks", looks),
    line("camera patterns", cameras),
    line("plugins", plugins),
    "Proven recipes are selected separately below and are auto-declared when the brief and scene match strongly enough.",
  ].filter(Boolean).join("\n");
}

function words(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
}

function assetScore(asset: AssetDefinitionV1, query: string): number {
  const lower = query.toLowerCase();
  const idWords = words(asset.id);
  const phrase = idWords.join(" ");
  let score = lower.includes(phrase) ? 6 : 0;
  const queryWords = new Set(words(query));
  for (const token of new Set([...idWords, ...words(asset.title), ...words(asset.purpose), asset.family])) {
    if (queryWords.has(token)) score += idWords.includes(token) ? 3 : 1;
  }
  return score;
}

export interface AssetAutoDeclareResult {
  scenes: DirectScene[];
  declared: Array<{ assetId: string; sceneId: string; score: number }>;
  declined: Array<{
    assetId: string;
    sceneId: string;
    reason:
      | "semantic-params-ungrounded"
      | "typed-hero-already-owns-idea"
      | "plugin-reconciliation-declined";
  }>;
  reconciliationNotes: string[];
}

function sceneAssetText(scene: DirectScene): string {
  return [scene.title, scene.purpose, scene.foreground, scene.background]
    .filter(Boolean)
    .join(" ");
}

function preferredAssetRegion(scene: DirectScene): string | undefined {
  const focal = scene.components?.find((component) =>
    component.id === scene.spatialIntent?.focalPart
  );
  if (focal?.region) return focal.region;
  const heroRegions = [...new Set(
    (scene.components ?? [])
      .filter((component) => component.role === "hero" && component.region)
      .map((component) => component.region!),
  )];
  if (heroRegions.length === 1) return heroRegions[0];
  const regions = [...new Set(
    (scene.components ?? []).flatMap((component) => component.region ? [component.region] : []),
  )];
  return regions.length === 1 ? regions[0] : undefined;
}

/** Host-owned asset adoption; no model opt-in is needed for a clear match. */
export function autoDeclareHighConfidenceAssets(
  scenes: DirectScene[],
  query: string,
  minimumScore = 6,
): AssetAutoDeclareResult {
  const existingKinds = new Set(
    scenes.flatMap((scene) => (scene.plugins ?? []).map((plugin) => plugin.kind)),
  );
  const candidates = ASSET_LIBRARY
    .map((asset) => ({ asset, score: assetScore(asset, query) }))
    .filter(({ asset, score }) =>
      score >= minimumScore &&
      !existingKinds.has(`asset-${asset.id}`) &&
      Boolean(asset.autoDeclare) &&
      asset.params.every((param) => param.default !== undefined),
    )
    .sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id));
  const selected = candidates[0];
  if (!selected) {
    return { scenes, declared: [], declined: [], reconciliationNotes: [] };
  }
  const target = scenes
    .map((scene, index) => ({
      scene,
      index,
      score: assetScore(selected.asset, [scene.title, scene.purpose, scene.foreground, scene.background]
        .filter(Boolean).join(" ")),
    }))
    .filter(({ scene, score }) => scene.durationSec >= 3 && score >= minimumScore)
    .sort((a, b) => b.score - a.score || a.scene.startSec - b.scene.startSec || a.index - b.index)[0];
  if (!target) {
    return { scenes, declared: [], declined: [], reconciliationNotes: [] };
  }
  const groundedParams = selected.asset.autoDeclare!.bindParams({
    query,
    sceneText: sceneAssetText(target.scene),
  });
  if (!groundedParams) {
    return {
      scenes,
      declared: [],
      declined: [{
        assetId: selected.asset.id,
        sceneId: target.scene.id,
        reason: "semantic-params-ungrounded",
      }],
      reconciliationNotes: [],
    };
  }
  const equivalentKinds = new Set(
    selected.asset.autoDeclare?.equivalentComponentKinds ?? [],
  );
  const existingHero = (target.scene.components ?? []).find((component) =>
    component.role === "hero" && equivalentKinds.has(component.kind)
  );
  if (existingHero) {
    return {
      scenes,
      declared: [],
      declined: [{
        assetId: selected.asset.id,
        sceneId: target.scene.id,
        reason: "typed-hero-already-owns-idea",
      }],
      reconciliationNotes: [],
    };
  }
  const region = preferredAssetRegion(target.scene);
  const declaration: PluginDeclarationV1 = {
    version: 1,
    kind: `asset-${selected.asset.id}`,
    id: selected.asset.id,
    ...(region ? { region } : {}),
    params: {
      ...Object.fromEntries(selected.asset.params.map((param) => [param.name, param.default!])),
      ...groundedParams,
    },
  };
  const note = `asset-auto-declare: matched "${selected.asset.id}" to scene "${target.scene.id}"`;
  const next = scenes.map((scene, index) => index === target.index
    ? {
        ...scene,
        plugins: [...(scene.plugins ?? []), declaration],
        sentinelNormalizations: [...(scene.sentinelNormalizations ?? []), note],
      }
    : scene);
  const reconciled = reconcileAndLowerPlugins(next);
  const survived = reconciled.scenes[target.index]?.plugins?.some((plugin) =>
    plugin.kind === declaration.kind && Boolean(plugin.uid)
  ) ?? false;
  return {
    scenes: reconciled.scenes,
    declared: survived
      ? [{ assetId: selected.asset.id, sceneId: target.scene.id, score: selected.score }]
      : [],
    declined: survived ? [] : [{
      assetId: selected.asset.id,
      sceneId: target.scene.id,
      reason: "plugin-reconciliation-declined",
    }],
    reconciliationNotes: reconciled.notes,
  };
}

/** Persist conversion evidence after the plan has passed its typed lowering. */
export function recordStudioCatalogConversions(storyboard: DirectScene[]): void {
  const componentKinds = new Set(
    COMPONENT_CATALOG.filter((entry) => !entry.internal).map((entry) => entry.kind),
  );
  const assetIds = new Set(ASSET_LIBRARY.map((asset) => asset.id));
  const pluginKinds = new Set(
    PLUGIN_CATALOG.filter((entry) => !entry.kind.startsWith("asset-")).map((entry) => entry.kind),
  );
  for (const scene of storyboard) {
    for (const component of scene.components ?? []) {
      if (componentKinds.has(component.kind)) recordSentinelCatalogConversion("components", component.kind);
    }
    for (const plugin of scene.plugins ?? []) {
      if (plugin.kind.startsWith("asset-")) {
        const assetId = plugin.kind.slice("asset-".length);
        // A declaration is evidence only after plugin reconciliation has
        // stamped its uid. A catalog name without a uid is paperwork, not an
        // injectable typed conversion.
        if (assetIds.has(assetId) && plugin.uid) {
          recordSentinelCatalogConversion("assets", assetId);
        }
      } else if (pluginKinds.has(plugin.kind) && plugin.uid) {
        recordSentinelCatalogConversion("plugins", plugin.kind);
      }
    }
    for (const recipe of scene.recipes ?? []) {
      recordSentinelCatalogConversion("recipes", recipe.id);
    }
  }
}
