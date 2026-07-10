/**
 * Asset animation runtime plumbing — the film side of the pre-built asset
 * system (ASSETS.md). The asset plugin lowering emits typed `animate` beats on
 * the unit's internal `asset` component; those beats flow through
 * `resolveComponentPlan` so every existing gate (pacing, motion density,
 * moments, complexity, layout-QA motion windows) judges them like any other
 * beat. THIS module resolves the spring payload those beats need — sampled
 * ease, GSAP var maps, pre-beat writes — into the `sequences-assets` island
 * that `sequences-assets.v1.js` compiles into the ONE paused timeline.
 *
 * Determinism: `resolveAssetPlan` is a pure function of the locked storyboard
 * (declaration params → coerced params → compiled tracks, all rounded), so the
 * island is byte-stable across repair passes and the strip-and-reinject
 * discipline holds. Timing comes FROM the resolved component plan — the
 * paperwork window and the executed window can never drift apart.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DirectScene } from "./directComposition.ts";
import { resolveComponentPlan } from "./componentContract.ts";
import {
  coerceAssetParams,
  compileAssetAnimationGsap,
  type AssetDefinitionV1,
} from "./assetContract.ts";
import { getAsset } from "./assets/index.ts";
import { assetsEnabled } from "./sentinelFlags.ts";

export const ASSET_RUNTIME_VERSION = 1;
export const ASSET_RUNTIME_FILE = "sequences-assets.v1.js";

const TEMPLATES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "templates",
);

export function assetRuntimeSource(): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, ASSET_RUNTIME_FILE), "utf8");
}

export function assetRuntimeHash(): string {
  return createHash("sha256").update(assetRuntimeSource()).digest("hex");
}

/* ------------------------------------------------------------------ plan */

export interface ResolvedAssetBeatV1 {
  id: string;
  /** The unit root's data-part (the internal `asset` component id). */
  part: string;
  asset: string;
  animation: string;
  startSec: number;
  endSec: number;
  yoyo: boolean;
  /** Normalized spring ease samples (the runtime linear-interpolates). */
  ease: number[];
  from: Record<string, number | string>;
  to: Record<string, number | string>;
  /** Custom-prop from-values written inline pre-beat (preBeat:"from"). */
  preBeat?: Record<string, string>;
}

export interface SceneAssetPlanV1 {
  sceneId: string;
  beats: ResolvedAssetBeatV1[];
}

export interface AssetPlanV1 {
  version: 1;
  scenes: SceneAssetPlanV1[];
}

interface AssetUnit {
  definition: AssetDefinitionV1;
  params: Record<string, string | number>;
}

/** The scene's asset units keyed by their core part id (`<unit>-core`). */
function assetUnitsByPart(scene: DirectScene): Map<string, AssetUnit> {
  const units = new Map<string, AssetUnit>();
  for (const declaration of scene.plugins ?? []) {
    if (!declaration.uid || !declaration.kind.startsWith("asset-")) continue;
    const definition = getAsset(declaration.kind.slice("asset-".length));
    if (!definition) continue;
    units.set(`${declaration.id}-core`, {
      definition,
      params: coerceAssetParams(definition, declaration.params).params,
    });
  }
  return units;
}

/**
 * Resolve every `animate` beat into its executable spring payload. Timing is
 * read from the RESOLVED component plan (not raw intents) so clamping,
 * dedupe, and stagger paperwork all agree with what the runtime executes.
 */
export function resolveAssetPlan(scenes: DirectScene[]): AssetPlanV1 {
  const planScenes: SceneAssetPlanV1[] = [];
  const resolved = resolveComponentPlan(scenes);
  for (const scenePlan of resolved.scenes) {
    const scene = scenes.find((entry) => entry.id === scenePlan.sceneId);
    if (!scene) continue;
    const units = assetUnitsByPart(scene);
    if (!units.size) continue;
    const beats: ResolvedAssetBeatV1[] = [];
    for (const beat of scenePlan.beats) {
      if (beat.kind !== "animate" || !beat.animation) continue;
      const unit = units.get(beat.component);
      if (!unit) continue;
      const spec = unit.definition.animations.find(
        (animation) => animation.name === beat.animation,
      );
      if (!spec) continue;
      const compiled = compileAssetAnimationGsap(spec, unit.params);
      beats.push({
        id: beat.id,
        part: beat.component,
        asset: unit.definition.id,
        animation: compiled.name,
        startSec: beat.startSec,
        endSec: beat.endSec,
        yoyo: compiled.yoyo,
        ease: compiled.ease,
        from: compiled.from,
        to: compiled.to,
        ...(compiled.preBeat ? { preBeat: compiled.preBeat } : {}),
      });
    }
    if (beats.length) planScenes.push({ sceneId: scenePlan.sceneId, beats });
  }
  return { version: 1, scenes: planScenes };
}

/* ------------------------------------------------------------- validation */

/**
 * Host-plumbing self-check (the validatePluginContract disposition): these
 * codes are reachable only if the injection seam breaks — the lowering is
 * host-owned and the host injects the island/runtime/compile call itself.
 * Kill-switch discipline: with `SLACK_SEQUENCES_ASSETS` off the runtime is
 * not injected and `animate` beats no-op in the components runtime, so this
 * gate stands down rather than vetoing a flag-flipped film.
 */
export function validateAssetContract(
  html: string,
  scenes: DirectScene[],
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!assetsEnabled()) return { errors, warnings };
  const expected = resolveAssetPlan(scenes);
  if (!expected.scenes.length) return { errors, warnings };
  const island = html.match(
    /<script\b[^>]*\bid\s*=\s*(["'])sequences-assets\1[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!island) {
    errors.push(
      "asset_island_missing: the storyboard resolves asset animations but " +
        "index_html has no sequences-assets JSON island",
    );
    return { errors, warnings };
  }
  if (island[2]!.trim() !== JSON.stringify(expected)) {
    errors.push(
      "asset_island_stale: the sequences-assets island differs from the " +
        "storyboard's resolved asset plan",
    );
  }
  if (
    !html.includes(`src="${ASSET_RUNTIME_FILE}"`) &&
    !html.includes(`src='${ASSET_RUNTIME_FILE}'`)
  ) {
    errors.push(`asset_runtime_missing: composition must load local ${ASSET_RUNTIME_FILE}`);
  }
  if (!/\bSequencesAssets\.compile\s*\(/.test(html)) {
    errors.push(
      "asset_runtime_missing: composition must call SequencesAssets.compile(timeline, root)",
    );
  }
  return { errors, warnings };
}
