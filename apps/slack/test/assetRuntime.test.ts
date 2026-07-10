/**
 * Asset animation runtime plumbing (assetRuntime.ts): the resolved plan is a
 * byte-stable pure function of the locked storyboard, its timing mirrors the
 * component plan the gates judged, param references resolve into the spring
 * payload, and validateAssetContract behaves as a host-plumbing self-check
 * that stands down when the assets flag is off.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { assetPluginSpecs } from "../src/engine/assetContract.ts";
import { ASSET_LIBRARY } from "../src/engine/assets/index.ts";
import { resolveComponentPlan } from "../src/engine/componentContract.ts";
import {
  ASSET_RUNTIME_FILE,
  assetRuntimeSource,
  resolveAssetPlan,
  validateAssetContract,
} from "../src/engine/assetRuntime.ts";
import { deriveTopic } from "../src/engine/seedContent.ts";
import { createSeededRandom } from "../src/engine/pluginKernel.ts";

const previousFlag = process.env.SLACK_SEQUENCES_ASSETS;

beforeAll(() => {
  process.env.SLACK_SEQUENCES_ASSETS = "1";
});

afterAll(() => {
  if (previousFlag === undefined) delete process.env.SLACK_SEQUENCES_ASSETS;
  else process.env.SLACK_SEQUENCES_ASSETS = previousFlag;
});

/** A scene holding one lowered glass-metric unit (the real lowering output). */
function assetScene(params: Record<string, string | number> = { ring: 64 }): DirectScene {
  const spec = assetPluginSpecs(ASSET_LIBRARY).find(
    (entry) => entry.kind === "asset-glass-metric",
  )!;
  const lowering = spec.lower({
    sceneId: "s1",
    startSec: 0,
    durationSec: 6,
    id: "hero",
    uid: "s1-hero",
    params,
    topic: deriveTopic("probe"),
    rng: createSeededRandom("probe"),
  });
  return {
    id: "s1",
    title: "Hero metric",
    purpose: "Prove the asset runtime",
    startSec: 0,
    durationSec: 6,
    plugins: [
      { version: 1, kind: "asset-glass-metric", id: "hero", params, uid: "s1-hero" },
    ],
    components: lowering.components,
    beats: lowering.beats,
  } as DirectScene;
}

describe("resolveAssetPlan", () => {
  it("is a byte-stable pure function of the storyboard", () => {
    const a = JSON.stringify(resolveAssetPlan([assetScene()]));
    const b = JSON.stringify(resolveAssetPlan([assetScene()]));
    expect(a).toBe(b);
    expect(a).toContain('"asset":"glass-metric"');
  });

  it("mirrors the component plan's resolved timing exactly", () => {
    const scenes = [assetScene()];
    const assetPlan = resolveAssetPlan(scenes);
    const componentPlan = resolveComponentPlan(scenes);
    const componentBeats = new Map(
      componentPlan.scenes.flatMap((scene) => scene.beats.map((beat) => [beat.id, beat])),
    );
    const beats = assetPlan.scenes[0]!.beats;
    expect(beats.length).toBeGreaterThanOrEqual(2); // enter + ring-fill
    for (const beat of beats) {
      const paperwork = componentBeats.get(beat.id)!;
      expect(paperwork).toBeDefined();
      expect(beat.startSec).toBe(paperwork.startSec);
      expect(beat.endSec).toBe(paperwork.endSec);
    }
  });

  it("resolves $param references and pre-beat writes from the declaration", () => {
    const plan = resolveAssetPlan([assetScene({ ring: 64 })]);
    const ringFill = plan.scenes[0]!.beats.find((beat) => beat.animation === "ring-fill")!;
    expect(ringFill.to["--gm-ring"]).toBe("64");
    expect(ringFill.preBeat).toEqual({ "--gm-ring": "0" });
    const enter = plan.scenes[0]!.beats.find((beat) => beat.animation === "enter")!;
    expect(enter.from.opacity).toBe(0);
    expect(enter.to.scale).toBe(1);
    expect(Math.max(...enter.ease)).toBeGreaterThan(1.05); // the pop overshoot survives
  });

  it("resolves nothing for scenes without asset units", () => {
    const scene = { ...assetScene(), plugins: [] };
    expect(resolveAssetPlan([scene as DirectScene]).scenes).toEqual([]);
  });
});

describe("validateAssetContract", () => {
  const scenes = [assetScene()];
  const island =
    `<script type="application/json" data-sequences-host="1" id="sequences-assets">` +
    `${JSON.stringify(resolveAssetPlan(scenes))}</script>`;
  const runtimeTag = `<script src="${ASSET_RUNTIME_FILE}"></script>`;
  const compileCall = `<script>SequencesAssets.compile(tl, root);</script>`;

  it("passes a fully injected composition", () => {
    const html = `<html>${runtimeTag}${island}${compileCall}</html>`;
    expect(validateAssetContract(html, scenes).errors).toEqual([]);
  });

  it("reports the missing island / runtime / compile call", () => {
    const errors = validateAssetContract(`<html></html>`, scenes).errors;
    expect(errors.some((error) => error.startsWith("asset_island_missing"))).toBe(true);
    const stale =
      `<html>${runtimeTag}` +
      `<script type="application/json" id="sequences-assets">{"version":1,"scenes":[]}</script>` +
      `${compileCall}</html>`;
    const staleErrors = validateAssetContract(stale, scenes).errors;
    expect(staleErrors.some((error) => error.startsWith("asset_island_stale"))).toBe(true);
    const noRuntime = `<html>${island}</html>`;
    const runtimeErrors = validateAssetContract(noRuntime, scenes).errors;
    expect(runtimeErrors.some((error) => error.startsWith("asset_runtime_missing"))).toBe(true);
  });

  it("stands down when the assets flag is off (kill-switch discipline)", () => {
    process.env.SLACK_SEQUENCES_ASSETS = "0";
    try {
      expect(validateAssetContract(`<html></html>`, scenes).errors).toEqual([]);
    } finally {
      process.env.SLACK_SEQUENCES_ASSETS = "1";
    }
  });
});

describe("runtime source", () => {
  it("ships the versioned island compiler", () => {
    const source = assetRuntimeSource();
    expect(source).toContain("SequencesAssets");
    expect(source).toContain('getElementById("sequences-assets")');
    expect(source).toContain("immediateRender");
  });
});
