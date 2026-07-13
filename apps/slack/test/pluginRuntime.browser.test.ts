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
import { FX_RUNTIME_FILE, resolveFxPlan } from "../src/engine/fxContract.ts";
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
 * A film whose product surfaces are ENTIRELY host plugins: a dashboard-grid
 * unit in a station and a closing lockup. The author contributes only the
 * scene shells and one headline tween — exactly the live division of labor.
 * Passing real browser QA proves the injected markup binds every lowered
 * beat, the cascade entrances are seek-safe, and declared moments find
 * component evidence in plugin beats.
 */
function pluginFilm(): { storyboard: DirectScene[]; html: string } {
  const raw: DirectScene[] = [
    {
      id: "shot-metrics",
      title: "Deploy metrics land",
      purpose: "The dashboard proves the deploy story at a glance",
      startSec: 0,
      durationSec: 6,
      plugins: normalizeStoryboardPluginDeclarations([
        {
          version: 1,
          kind: "dashboard-grid",
          id: "metrics",
          region: "metric-wall",
          params: { tiles: 4, emphasis: "mixed", topic: "deploy pipeline speed" },
        },
      ]),
      moments: [
        {
          version: 1, id: "m-cascade", sceneId: "shot-metrics", atSec: 1.1,
          title: "Tiles cascade in", visualState: "metric tiles arrive as one gesture",
          change: "the dashboard exists", motionIntent: "reveal", importance: "primary",
        },
        {
          version: 1, id: "m-counts", sceneId: "shot-metrics", atSec: 2.2,
          title: "Numbers land", visualState: "stat values complete",
          change: "metrics hit their numbers", motionIntent: "ui-state", importance: "supporting",
        },
      ],
    },
    {
      id: "shot-close",
      title: "The close",
      purpose: "The lockup resolves the argument",
      startSec: 6,
      durationSec: 5,
      plugins: normalizeStoryboardPluginDeclarations([
        {
          version: 1,
          kind: "lockup",
          id: "closing",
          params: {
            headline: "Ship it faster",
            sub: "From shipped to shown in one thread",
            cta: "Try Sequences",
            reveal: "rise",
          },
        },
      ]),
      moments: [
        {
          version: 1, id: "m-headline", sceneId: "shot-close", atSec: 6.9,
          title: "Headline rises", visualState: "hero copy assembles",
          change: "the claim lands", motionIntent: "type-on", importance: "primary",
        },
        {
          version: 1, id: "m-cta", sceneId: "shot-close", atSec: 7.7,
          title: "CTA appears", visualState: "button under the lockup",
          change: "the ask is visible", motionIntent: "ui-state", importance: "supporting",
        },
      ],
    },
  ];
  const { scenes: storyboard, notes } = reconcileAndLowerPlugins(raw);
  expect(notes).toEqual([]);
  const island = JSON.stringify(resolveComponentPlan(storyboard));
  const fxIsland = JSON.stringify(resolveFxPlan(storyboard));
  const bare = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080">
<title>Plugin runtime smoke</title><script src="gsap.min.js"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script>
<script src="${COMPONENT_RUNTIME_FILE}"></script>
<script src="${FX_RUNTIME_FILE}"></script>${componentKitStyleTag()}${cinemaKitStyleTag()}<style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0a0f16}
body{color:#eef2f8;font-family:Inter,Arial,sans-serif}
#root{--surface:#141b26;--surface-2:#1a2230;--accent:#5eead4;--accent-text:#06231d;--text:#eef2f8;--muted:#94a3b8;position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;padding:96px;display:grid;align-content:center;justify-items:center;gap:48px;opacity:0;min-width:0;min-height:0}
.station{width:100%;display:grid;justify-items:center}
h2{margin:0;font-size:56px;letter-spacing:-.04em}
</style></head><body>
<main id="root" data-composition-id="plugin-smoke" data-width="1920" data-height="1080" data-duration="11">
<section id="shot-metrics" class="scene clip" data-scene="shot-metrics" data-start="0" data-duration="6" data-track-index="1">
<h2 data-layout-important>The launch is measurably faster</h2>
<div class="station" data-region="metric-wall"></div>
</section>
<section id="shot-close" class="scene clip" data-scene="shot-close" data-start="6" data-duration="5" data-track-index="1">
</section>
</main>
<script type="application/json" id="sequences-components">${island}</script>
<script type="application/json" id="sequences-fx">${fxIsland}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#shot-metrics",{opacity:1},0).set("#shot-metrics",{opacity:0},5.99);
tl.set("#shot-close",{opacity:1},6).set("#shot-close",{opacity:0},11);
tl.fromTo("#shot-metrics h2",{y:50,opacity:0},{y:0,opacity:1,duration:.7,ease:"power3.out"},0.15);
SequencesCamera.compile(tl,document.querySelector("[data-composition-id]"));
SequencesComponents.compile(tl,document.querySelector("[data-composition-id]"));
SequencesFx.compile(tl,document.querySelector("[data-composition-id]"));
window.__timelines["plugin-smoke"]=tl;tl.seek(0);
</script></body></html>`;
  const { html, injected } = injectPluginContract(bare, storyboard);
  expect(injected).toEqual(["shot-metrics-metrics", "shot-close-closing"]);
  return { storyboard, html };
}

/**
 * Browser proof for the generated graph/comparison/pricing vocabulary. The
 * three units consume the complete per-film plugin budget and contribute no
 * author-authored component roots; every moving target is host markup bound by
 * the lowered component plan.
 */
function generatedSetPieceFilm(): { storyboard: DirectScene[]; html: string } {
  const raw: DirectScene[] = [
    {
      id: "shot-flow",
      title: "From prompt to production",
      purpose: "Show the agent workflow as one connected system",
      startSec: 0,
      durationSec: 4,
      plugins: normalizeStoryboardPluginDeclarations([{
        version: 1,
        kind: "flow-diagram",
        id: "agent-flow",
        region: "flow-stage",
        params: { nodes: 4, topology: "fan-out", topic: "agent evaluation workflow" },
      }]),
      moments: [{
        version: 1, id: "m-flow", sceneId: "shot-flow", atSec: 0.8,
        title: "Workflow connects", visualState: "nodes and paths resolve",
        change: "the operating model becomes legible", motionIntent: "reveal", importance: "primary",
      }, {
        version: 1, id: "m-flow-branches", sceneId: "shot-flow", atSec: 1.2,
        title: "Branches draw", visualState: "each route reaches a real node",
        change: "the topology becomes explicit", motionIntent: "reveal", importance: "supporting",
      }, {
        version: 1, id: "m-flow-resolve", sceneId: "shot-flow", atSec: 2.56,
        title: "Result resolves", visualState: "the destination node takes focus",
        change: "the workflow lands on its outcome", motionIntent: "highlight", importance: "supporting",
      }],
    },
    {
      id: "shot-compare",
      title: "The operating model improves",
      purpose: "Compare manual work with an agent platform",
      startSec: 4,
      durationSec: 4,
      plugins: normalizeStoryboardPluginDeclarations([{
        version: 1,
        kind: "comparison-table",
        id: "capability-compare",
        region: "compare-stage",
        params: { choices: 3, features: 4, topic: "agent evaluation controls" },
      }]),
      moments: [{
        version: 1, id: "m-compare", sceneId: "shot-compare", atSec: 4.7,
        title: "Rows compare", visualState: "capabilities arrive row by row",
        change: "the advantage becomes scannable", motionIntent: "reveal", importance: "primary",
      }, {
        version: 1, id: "m-compare-proof", sceneId: "shot-compare", atSec: 6.48,
        title: "Proof is singled out", visualState: "one capability row receives focus",
        change: "the matrix resolves on a concrete advantage", motionIntent: "highlight", importance: "supporting",
      }],
    },
    {
      id: "shot-pricing",
      title: "A plan for every team",
      purpose: "Reveal a clear commercial ladder",
      startSec: 8,
      durationSec: 4,
      plugins: normalizeStoryboardPluginDeclarations([{
        version: 1,
        kind: "pricing-reveal",
        id: "plans",
        region: "pricing-stage",
        params: { tiers: 3, billing: "monthly", currency: "usd", featured: 2, topic: "ai" },
      }]),
      moments: [{
        version: 1, id: "m-price", sceneId: "shot-pricing", atSec: 8.7,
        title: "Pricing resolves", visualState: "tier prices count into place",
        change: "the offer becomes concrete", motionIntent: "ui-state", importance: "primary",
      }, {
        version: 1, id: "m-price-focus", sceneId: "shot-pricing", atSec: 10.56,
        title: "Recommended plan resolves", visualState: "the featured tier takes focus",
        change: "the choice becomes obvious", motionIntent: "highlight", importance: "supporting",
      }],
    },
  ];
  const { scenes: storyboard, notes } = reconcileAndLowerPlugins(raw);
  expect(notes).toEqual([]);
  const island = JSON.stringify(resolveComponentPlan(storyboard));
  const fxIsland = JSON.stringify(resolveFxPlan(storyboard));
  const bare = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080">
<title>Generated plugin runtime smoke</title><script src="gsap.min.js"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script>
<script src="${COMPONENT_RUNTIME_FILE}"></script>
<script src="${FX_RUNTIME_FILE}"></script>${componentKitStyleTag()}${cinemaKitStyleTag()}<style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#080d14}
body{color:#eef2f8;font-family:Inter,Arial,sans-serif}
#root{--surface:#141b26;--surface-2:#1a2230;--accent:#7dd3fc;--accent-text:#06231d;--text:#eef2f8;--muted:#94a3b8;position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;padding:100px 120px;display:grid;align-content:center;justify-items:center;gap:38px;opacity:0;min-width:0;min-height:0}
.station{width:100%;display:grid;justify-items:center;align-items:center;min-width:0}
h2{margin:0;font-size:48px;letter-spacing:-.04em}
</style></head><body>
<main id="root" data-composition-id="generated-plugin-smoke" data-width="1920" data-height="1080" data-duration="12">
<section id="shot-flow" class="scene clip" data-scene="shot-flow" data-start="0" data-duration="4" data-track-index="1">
<h2 data-layout-important>From prompt to production</h2><div class="station" data-region="flow-stage"></div>
</section>
<section id="shot-compare" class="scene clip" data-scene="shot-compare" data-start="4" data-duration="4" data-track-index="1">
<h2 data-layout-important>One system, less handoff</h2><div class="station" data-region="compare-stage"></div>
</section>
<section id="shot-pricing" class="scene clip" data-scene="shot-pricing" data-start="8" data-duration="4" data-track-index="1">
<h2 data-layout-important>Choose how your team scales</h2><div class="station" data-region="pricing-stage"></div>
</section>
</main>
<script type="application/json" id="sequences-components">${island}</script>
<script type="application/json" id="sequences-fx">${fxIsland}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#shot-flow",{opacity:1},0).set("#shot-flow",{opacity:0},3.99);
tl.set("#shot-compare",{opacity:1},4).set("#shot-compare",{opacity:0},7.99);
tl.set("#shot-pricing",{opacity:1},8).set("#shot-pricing",{opacity:0},12);
SequencesCamera.compile(tl,document.querySelector("[data-composition-id]"));
SequencesComponents.compile(tl,document.querySelector("[data-composition-id]"));
SequencesFx.compile(tl,document.querySelector("[data-composition-id]"));
window.__timelines["generated-plugin-smoke"]=tl;tl.seek(0);
</script></body></html>`;
  const { html, injected } = injectPluginContract(bare, storyboard);
  expect(injected).toEqual([
    "shot-flow-agent-flow", "shot-compare-capability-compare", "shot-pricing-plans",
  ]);
  return { storyboard, html };
}

describe("plugin runtime browser contract", () => {
  it("an all-plugin film passes validation and real browser QA seek-safely", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-plugin-smoke-"));
    roots.push(dir);
    initializeProject(dir, { name: "PluginSmoke", brandName: "PluginSmoke", seedScreenshot: false });
    const draft = pluginFilm();
    const validation = await validateDirectComposition(dir, draft);
    expect(validation.errors).toEqual([]);
    // Every declared moment binds — plugin beats are first-class evidence.
    expect(validation.moments.filter((moment) => !moment.evidence)).toEqual([]);
    expect(validation.moments.some((moment) => moment.evidence?.kind === "component")).toBe(true);
    const qa = await inspectDirectComposition(dir, draft, { captureGuide: false });
    expect(qa.infraError).toBeUndefined();
    expect(qa.errors).toEqual([]);
    expect(qa.ok).toBe(true);
    // The lowered beats visibly change frames: no static-verdict moments.
    expect(
      (qa.temporalJudge ?? []).filter((entry) => entry.verdict === "static"),
    ).toEqual([]);
  }, 30_000);

  it("binds flow/comparison/pricing beats through real browser QA seek-safely", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-generated-plugin-smoke-"));
    roots.push(dir);
    initializeProject(dir, {
      name: "GeneratedPluginSmoke",
      brandName: "GeneratedPluginSmoke",
      seedScreenshot: false,
    });
    const draft = generatedSetPieceFilm();
    const validation = await validateDirectComposition(dir, draft);
    expect(validation.errors).toEqual([]);
    expect(validation.moments.filter((moment) => !moment.evidence)).toEqual([]);
    const qa = await inspectDirectComposition(dir, draft, { captureGuide: false });
    expect(qa.infraError).toBeUndefined();
    expect(qa.errors).toEqual([]);
    expect(qa.ok).toBe(true);
    expect((qa.temporalJudge ?? []).filter((entry) => entry.verdict === "static")).toEqual([]);
  }, 30_000);
});
