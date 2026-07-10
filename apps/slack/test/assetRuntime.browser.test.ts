import "./helpers/enableAssetsFlag.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateDirectComposition, type DirectScene } from "../src/engine/directComposition.ts";
import { inspectDirectComposition } from "../src/engine/layoutInspector.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";
import {
  COMPONENT_RUNTIME_FILE,
  componentKitStyleTag,
  resolveComponentPlan,
} from "../src/engine/componentContract.ts";
import { cinemaKitStyleTag } from "../src/engine/cinemaKit.ts";
import { CAMERA_RUNTIME_FILE } from "../src/engine/cameraContract.ts";
import { ASSET_RUNTIME_FILE, resolveAssetPlan } from "../src/engine/assetRuntime.ts";
import {
  injectPluginContract,
  normalizeStoryboardPluginDeclarations,
  reconcileAndLowerPlugins,
} from "../src/engine/pluginContract.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * A film whose hero visuals are ENTIRELY pre-built assets: a glass-metric
 * medallion, then a laurel badge + CTA button close. The author contributes
 * only scene shells and one headline tween — the live division of labor.
 * Passing real browser QA proves the host-injected units bind every lowered
 * `animate` beat, the spring runtime is seek-safe under out-of-order QA
 * seeks, declared moments find component evidence in asset beats, and the
 * temporal judge sees the springs visibly change frames.
 */
function assetFilm(): { storyboard: DirectScene[]; html: string } {
  const raw: DirectScene[] = [
    {
      id: "shot-metric",
      title: "The number lands",
      purpose: "One hero stat proves the story",
      startSec: 0,
      durationSec: 6,
      plugins: normalizeStoryboardPluginDeclarations([
        {
          version: 1,
          kind: "asset-glass-metric",
          id: "uptime",
          params: { value: "99.98%", label: "Uptime", ring: 86, size: 420 },
        },
      ]),
      moments: [
        {
          version: 1, id: "m-arrive", sceneId: "shot-metric", atSec: 1.0,
          title: "Medallion pops in", visualState: "the glass metric lands",
          change: "the hero stat exists", motionIntent: "reveal", importance: "primary",
        },
        {
          version: 1, id: "m-ring", sceneId: "shot-metric", atSec: 2.6,
          title: "Ring draws to 86%", visualState: "accent ring filled",
          change: "the stat is proven", motionIntent: "ui-state", importance: "supporting",
        },
      ],
    },
    {
      id: "shot-close",
      title: "The close",
      purpose: "Award proof and the ask",
      startSec: 6,
      durationSec: 5,
      plugins: normalizeStoryboardPluginDeclarations([
        {
          version: 1,
          kind: "asset-laurel-badge",
          id: "award",
          params: { label: "Product Hunt", title: "#1 of the Day", size: 320 },
        },
        {
          version: 1,
          kind: "asset-cta-button",
          id: "ask",
          params: { label: "Start shipping" },
        },
      ]),
      moments: [
        {
          version: 1, id: "m-award", sceneId: "shot-close", atSec: 7.1,
          title: "Badge bounces in", visualState: "laurel badge on stage",
          change: "social proof lands", motionIntent: "reveal", importance: "primary",
        },
        {
          version: 1, id: "m-ask", sceneId: "shot-close", atSec: 8.2,
          title: "CTA presses", visualState: "the ask acknowledged",
          change: "the CTA commits", motionIntent: "ui-state", importance: "supporting",
        },
      ],
    },
  ];
  const { scenes: storyboard, notes } = reconcileAndLowerPlugins(raw);
  expect(notes).toEqual([]);
  const componentIsland = JSON.stringify(resolveComponentPlan(storyboard));
  const assetIsland = JSON.stringify(resolveAssetPlan(storyboard));
  const bare = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080">
<title>Asset runtime smoke</title><script src="gsap.min.js"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script>
<script src="${COMPONENT_RUNTIME_FILE}"></script>
<script src="${ASSET_RUNTIME_FILE}"></script>${componentKitStyleTag()}${cinemaKitStyleTag()}<style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0a0f16}
body{color:#eef2f8;font-family:Inter,Arial,sans-serif}
#root{--surface:#141b26;--surface-2:#1a2230;--accent:#5eead4;--accent-text:#06231d;--text:#eef2f8;--muted:#94a3b8;position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;padding:96px;display:grid;align-content:center;justify-items:center;gap:56px;opacity:0;min-width:0;min-height:0}
h2{margin:0;font-size:64px;letter-spacing:-.04em}
</style></head><body>
<main id="root" data-composition-id="asset-smoke" data-width="1920" data-height="1080" data-duration="11">
<section id="shot-metric" class="scene clip" data-scene="shot-metric" data-start="0" data-duration="6" data-track-index="1">
<h2 data-layout-important>Four nines, measured live</h2>
</section>
<section id="shot-close" class="scene clip" data-scene="shot-close" data-start="6" data-duration="5" data-track-index="1">
<h2 data-layout-important>Loved on launch day</h2>
</section>
</main>
<script type="application/json" id="sequences-components">${componentIsland}</script>
<script type="application/json" id="sequences-assets">${assetIsland}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#shot-metric",{opacity:1},0).set("#shot-metric",{opacity:0},5.99);
tl.set("#shot-close",{opacity:1},6).set("#shot-close",{opacity:0},11);
tl.fromTo("#shot-metric h2",{y:50,opacity:0},{y:0,opacity:1,duration:.7,ease:"power3.out"},0.15);
tl.fromTo("#shot-close h2",{y:50,opacity:0},{y:0,opacity:1,duration:.7,ease:"power3.out"},6.15);
SequencesCamera.compile(tl,document.querySelector("[data-composition-id]"));
SequencesComponents.compile(tl,document.querySelector("[data-composition-id]"));
SequencesAssets.compile(tl,document.querySelector("[data-composition-id]"));
window.__timelines["asset-smoke"]=tl;tl.seek(0);
</script></body></html>`;
  const { html, injected } = injectPluginContract(bare, storyboard);
  expect(injected).toEqual(["shot-metric-uptime", "shot-close-award", "shot-close-ask"]);
  return { storyboard, html };
}

describe("asset runtime browser contract", () => {
  it("an all-asset film passes validation and real browser QA seek-safely", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-asset-smoke-"));
    roots.push(dir);
    initializeProject(dir, { name: "AssetSmoke", brandName: "AssetSmoke", seedScreenshot: false });
    const draft = assetFilm();
    const validation = await validateDirectComposition(dir, draft);
    expect(validation.errors).toEqual([]);
    // Every declared moment binds — asset animate beats are first-class evidence.
    expect(validation.moments.filter((moment) => !moment.evidence)).toEqual([]);
    expect(validation.moments.some((moment) => moment.evidence?.kind === "component")).toBe(true);
    const qa = await inspectDirectComposition(dir, draft, { captureGuide: false });
    expect(qa.infraError).toBeUndefined();
    expect(qa.errors).toEqual([]);
    expect(qa.ok).toBe(true);
    // The spring beats visibly change frames: no static-verdict moments.
    expect(
      (qa.temporalJudge ?? []).filter((entry) => entry.verdict === "static"),
    ).toEqual([]);
  }, 30_000);
});
