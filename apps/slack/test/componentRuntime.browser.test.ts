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
import { CUT_RUNTIME_FILE, resolveCutPlan } from "../src/engine/cutContract.ts";
import { FX_RUNTIME_FILE, resolveFxPlan } from "../src/engine/fxContract.ts";
import { applyDeterministicSourceRepairs } from "../src/engine/compositionRunner.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * A dense component film exercising the runtime's major beat compilers in a
 * real browser: type + open on a search, morph into a command palette, count
 * on a stat, chart bars, staggered table rows, press, and a progress fill. Its
 * three shots also exercise rise/assemble/materialize root families and one
 * typed follows chain. Passing browser QA proves the compiled choreography is
 * seek-safe and error-free.
 */
function componentFilm(): { storyboard: DirectScene[]; html: string } {
  const storyboard: DirectScene[] = [
    {
      id: "shot-search",
      title: "Search becomes a palette",
      purpose: "Type a query, open results, morph into the command palette",
      startSec: 0,
      durationSec: 6,
      componentEntranceFamily: "rise",
      components: [
        { version: 1, id: "omni-search", kind: "search", role: "hero" },
        { version: 1, id: "omni-palette", kind: "command-palette" },
      ],
      beats: [
        { version: 1, id: "q-typed", sceneId: "shot-search", component: "omni-search", kind: "type", atSec: 0.6, text: "deploy checkout" },
        { version: 1, id: "q-open", sceneId: "shot-search", component: "omni-search", kind: "open", atSec: 2.4 },
        { version: 1, id: "q-morph", sceneId: "shot-search", component: "omni-search", kind: "morph", atSec: 4.2, morphTo: "omni-palette" },
        { version: 1, id: "q-exit", sceneId: "shot-search", component: "omni-palette", kind: "close", atSec: 5.35 },
      ],
      cut: { version: 1, style: "swipe", axis: "left" },
      moments: [
        { version: 1, id: "m-typed", sceneId: "shot-search", atSec: 1.2, title: "Query types in", visualState: "search carries the query", change: "the ask is concrete", motionIntent: "type-on", importance: "primary" },
        { version: 1, id: "m-open", sceneId: "shot-search", atSec: 2.5, title: "Results open", visualState: "result rows under the input", change: "the product answers", motionIntent: "ui-state", importance: "supporting" },
        { version: 1, id: "m-morph", sceneId: "shot-search", atSec: 4.5, title: "Search morphs into the palette", visualState: "palette replaces search", change: "twin transition", motionIntent: "morph", importance: "primary" },
        { version: 1, id: "m-exit", sceneId: "shot-search", atSec: 5.55, title: "Palette recedes", visualState: "palette eases toward the next scene", change: "the outgoing surface yields directionally", motionIntent: "exit", importance: "supporting" },
      ],
    },
    {
      id: "shot-metrics",
      title: "The numbers land",
      purpose: "Stat counts up while the chart grows and rows arrive",
      startSec: 6,
      durationSec: 6,
      componentEntranceFamily: "assemble",
      components: [
        { version: 1, id: "conv-stat", kind: "stat-card", role: "hero" },
        { version: 1, id: "growth-chart", kind: "chart-bars" },
        { version: 1, id: "orders-table", kind: "table" },
      ],
      beats: [
        { version: 1, id: "stat-counts", sceneId: "shot-metrics", component: "conv-stat", kind: "count", atSec: 6.6 },
        {
          version: 1, id: "chart-grows", sceneId: "shot-metrics", component: "growth-chart",
          kind: "chart", atSec: 7.4, follows: "stat-counts", lagMs: 90,
        },
        { version: 1, id: "rows-arrive", sceneId: "shot-metrics", component: "orders-table", kind: "rows", atSec: 9.2 },
        { version: 1, id: "row-underlines", sceneId: "shot-metrics", component: "orders-table", kind: "highlight", style: "underline", item: 2, atSec: 10.1 },
        { version: 1, id: "stat-flags", sceneId: "shot-metrics", component: "conv-stat", kind: "highlight", atSec: 10.9 },
      ],
      moments: [
        { version: 1, id: "m-count", sceneId: "shot-metrics", atSec: 7, title: "Conversion counts up", visualState: "stat hits 42%", change: "metric completes", motionIntent: "ui-state", importance: "primary" },
        { version: 1, id: "m-chart", sceneId: "shot-metrics", atSec: 7.1, title: "Growth bars rise", visualState: "chart follows the count", change: "trend visible", motionIntent: "draw-on", importance: "supporting" },
        { version: 1, id: "m-rows", sceneId: "shot-metrics", atSec: 9.5, title: "Orders stream in", visualState: "table fills", change: "live activity", motionIntent: "reveal", importance: "supporting" },
        { version: 1, id: "m-row-focus", sceneId: "shot-metrics", atSec: 10.3, title: "Second order underlined", visualState: "the second row owns the measured underline", change: "focus moved to the selected evidence row", motionIntent: "draw-on", importance: "supporting" },
        { version: 1, id: "m-flag", sceneId: "shot-metrics", atSec: 11.1, title: "Hero stat flagged", visualState: "accent ring pulses the stat", change: "the key number is marked", motionIntent: "ui-state", importance: "supporting" },
      ],
    },
    {
      id: "shot-cta",
      title: "Deploy",
      purpose: "Press the CTA; the build completes",
      startSec: 12,
      durationSec: 4,
      componentEntranceFamily: "materialize",
      components: [
        { version: 1, id: "deploy-cta", kind: "button", role: "hero" },
        { version: 1, id: "build-bar", kind: "progress" },
      ],
      beats: [
        { version: 1, id: "cta-press", sceneId: "shot-cta", component: "deploy-cta", kind: "press", atSec: 12.7, toState: "success" },
        { version: 1, id: "build-fills", sceneId: "shot-cta", component: "build-bar", kind: "progress", atSec: 13.6 },
      ],
      moments: [
        { version: 1, id: "m-press", sceneId: "shot-cta", atSec: 12.9, title: "CTA pressed", visualState: "button succeeds", change: "action taken", motionIntent: "ui-state", importance: "primary" },
        { version: 1, id: "m-build", sceneId: "shot-cta", atSec: 14, title: "Build completes", visualState: "bar fills", change: "shipped", motionIntent: "ui-state", importance: "supporting" },
      ],
    },
  ];
  const island = JSON.stringify(resolveComponentPlan(storyboard));
  const cutIsland = JSON.stringify(resolveCutPlan(storyboard));
  // MD2: payoff beats + primary moments resolve host fx effects, so the
  // fixture carries the fx contract like every live film does.
  const fxIsland = JSON.stringify(resolveFxPlan(storyboard));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080">
<title>Component runtime smoke</title><script src="gsap.min.js"></script>
<script src="${CUT_RUNTIME_FILE}"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script>
<script src="${COMPONENT_RUNTIME_FILE}"></script>
<script src="${FX_RUNTIME_FILE}"></script>${componentKitStyleTag()}${cinemaKitStyleTag()}<style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0a0f16}
body{color:#eef2f8;font-family:Inter,Arial,sans-serif}
#root{--surface:#141b26;--surface-2:#1a2230;--accent:#5eead4;--accent-text:#06231d;--text:#eef2f8;--muted:#94a3b8;position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;padding:96px;display:grid;align-content:center;justify-items:center;gap:48px;opacity:0;min-width:0;min-height:0}
h2{margin:0;font-size:64px;letter-spacing:-.04em}
.row-wrap{display:flex;gap:48px;align-items:flex-start}
</style></head><body>
<main id="root" data-composition-id="cmp-smoke" data-width="1920" data-height="1080" data-duration="16">
<section id="shot-search" class="scene clip" data-scene="shot-search" data-start="0" data-duration="6" data-track-index="1">
<h2 data-layout-important>Find anything, do anything</h2>
<div class="cmp cmp-search inset-well" data-component="search" data-part="omni-search" data-layout-important>
<span class="cmp-icon">⌕</span><span class="cmp-text" data-cmp-text>deploy checkout</span>
<div class="cmp-results"><div class="cmp-item">Deploy checkout · production</div><div class="cmp-item">Checkout logs</div></div>
</div>
<div class="cmp cmp-palette material-hero" data-component="command-palette" data-part="omni-palette">
<div class="cmp-input inset-well"><span class="cmp-text">deploy checkout</span></div>
<div class="cmp-item" data-active="true">Deploy to production</div><div class="cmp-item">View release notes</div>
</div>
</section>
<section id="shot-metrics" class="scene clip" data-scene="shot-metrics" data-start="6" data-duration="6" data-track-index="1">
<h2 data-layout-important>The launch is working</h2>
<div class="row-wrap" data-layout-important>
<div class="cmp cmp-stat material" data-component="stat-card" data-part="conv-stat">
<div class="cmp-label">Conversion</div><div class="cmp-value" data-cmp-value>42.6%</div><div class="cmp-delta cmp-up">▲ 12%</div>
</div>
<div class="cmp cmp-chart-bars material" style="width:420px;padding:24px" data-component="chart-bars" data-part="growth-chart">
<i style="height:32%"></i><i style="height:48%"></i><i style="height:64%"></i><i class="cmp-hero" style="height:96%"></i>
</div>
<div class="cmp cmp-table material" style="min-width:420px" data-component="table" data-part="orders-table">
<div class="cmp-head"><span>Order</span><span>Status</span></div>
<div class="cmp-row"><span>#1042</span><span class="cmp-chip cmp-ok">Paid</span></div>
<div class="cmp-row"><span>#1043</span><span class="cmp-chip cmp-ok">Paid</span></div>
</div>
</div>
</section>
<section id="shot-cta" class="scene clip" data-scene="shot-cta" data-start="12" data-duration="4" data-track-index="1">
<h2 data-layout-important>Ship it</h2>
<button class="cmp cmp-button" data-component="button" data-part="deploy-cta" data-state="idle" data-layout-important>
<span class="cmp-label">Deploy</span><span class="cmp-spinner"></span><span class="cmp-check">✓</span>
</button>
<div class="cmp cmp-progress" style="width:520px" data-component="progress" data-part="build-bar"><i data-cmp-fill></i></div>
</section>
</main>
<script type="application/json" id="sequences-components">${island}</script>
<script type="application/json" id="sequences-cuts">${cutIsland}</script>
<script type="application/json" id="sequences-fx">${fxIsland}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#shot-search",{opacity:1},0).set("#shot-search",{opacity:0},5.99);
tl.set("#shot-metrics",{opacity:1},6).set("#shot-metrics",{opacity:0},11.99);
tl.set("#shot-cta",{opacity:1},12).set("#shot-cta",{opacity:0},16);
tl.fromTo("#shot-search h2",{y:50,opacity:0},{y:0,opacity:1,duration:.7,ease:"power3.out"},0.15);
tl.fromTo("#shot-metrics h2",{y:50,opacity:0},{y:0,opacity:1,duration:.7,ease:"power3.out"},6.15);
tl.fromTo("#shot-cta h2",{y:50,opacity:0},{y:0,opacity:1,duration:.6,ease:"power3.out"},12.15);
SequencesCuts.compile(tl,document.querySelector("[data-composition-id]"));
SequencesCamera.compile(tl,document.querySelector("[data-composition-id]"));
SequencesComponents.compile(tl,document.querySelector("[data-composition-id]"));
SequencesFx.compile(tl,document.querySelector("[data-composition-id]"));
window.__timelines["cmp-smoke"]=tl;tl.seek(0);
</script></body></html>`;
  return { storyboard, html };
}

function customChatInteractionFilm(): { storyboard: DirectScene[]; html: string } {
  const storyboard: DirectScene[] = [{
    id: "slack-brief-entry",
    title: "Brief entered",
    purpose: "Click the Slack brief and stream permission-scoped context",
    startSec: 0,
    durationSec: 3.5,
    spatialIntent: {
      version: 1,
      focalPart: "slack-chat",
      composition: "one readable Slack product surface",
      relationships: [],
    },
    components: [{ version: 1, id: "slack-chat", kind: "chat", role: "hero" }],
    beats: [
      {
        version: 1,
        id: "brief-swap",
        sceneId: "slack-brief-entry",
        component: "slack-chat",
        kind: "swap",
        atSec: 1.2,
        durationSec: 0.5,
        text: "Draft the v2.0 launch story",
      },
      {
        version: 1,
        id: "response-stream",
        sceneId: "slack-brief-entry",
        component: "slack-chat",
        kind: "stream",
        atSec: 1.8,
        durationSec: 0.8,
        text: "Retrieving permission-scoped context…",
      },
    ],
    interactions: [{
      version: 1,
      id: "brief-cursor",
      sceneId: "slack-brief-entry",
      cursorId: "cursor",
      targetPart: "slack-chat",
      action: "click",
      startSec: 0.2,
      arriveSec: 0.55,
      pressSec: 0.65,
      releaseSec: 0.78,
      holdUntilSec: 0.9,
      from: "frame:bottom-right",
      path: "arc",
      aimX: 0.5,
      aimY: 0.82,
      feedback: "press-ripple",
      ripplePart: "slack-chat-ripple",
    }],
  }, {
    id: "result-hold",
    title: "Context ready",
    purpose: "Hold the permission-scoped result",
    startSec: 3.5,
    durationSec: 2.5,
  }];
  return {
    storyboard,
    html: `<!doctype html><html><head><script src="gsap.min.js"></script><style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#111827;color:#111827}
#root{position:relative;width:1920px;height:1080px;overflow:hidden;--accent:#4f46e5;--surface:#fff;--text:#111827;--muted:#64748b}
.scene{position:absolute;inset:0;display:grid;place-items:center;background:#eef2ff;opacity:0}
.slack-channel{width:1120px;min-height:520px;padding:54px;border-radius:28px;background:#fff;box-shadow:0 30px 80px #1e1b4b33}
.slack-msg,.slack-input{padding:22px 26px;margin:18px 0;border-radius:16px;background:#f1f5f9;font:600 32px/1.25 Arial}
.slack-msg.ai{background:#eef2ff;color:#312e81}
</style></head><body><main id="root" data-composition-id="chat-binding-proof" data-width="1920" data-height="1080" data-duration="6">
<section id="slack-brief-entry" class="scene" data-scene="slack-brief-entry" data-start="0" data-duration="3.5" data-track-index="1">
<div data-camera-world><div class="slack-channel" data-part="slack-chat" data-component="chat" data-layout-important="1">
<div class="slack-msg self">Draft the v2.0 launch story</div>
<div class="slack-input" data-part="chat-input">Draft the v2.0 launch story</div>
<div class="slack-msg ai" data-part="ai-response">Retrieving permission-scoped context…</div>
</div></div></section>
<section id="result-hold" class="scene" data-scene="result-hold" data-start="3.5" data-duration="2.5" data-track-index="1">
<h1 data-layout-important="1">Permission-scoped context ready</h1>
</section></main><script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set('[data-scene="slack-brief-entry"]',{opacity:1},0);
tl.set('[data-scene="slack-brief-entry"]',{opacity:0},3.5);
tl.set('[data-scene="result-hold"]',{opacity:1},3.5);
window.__timelines["chat-binding-proof"]=tl;tl.seek(0);
</script></body></html>`,
  };
}

describe("component runtime browser contract", () => {
  it("keeps a custom chat root visible while its internal swap and stream beats compile", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-chat-binding-"));
    roots.push(dir);
    initializeProject(dir, { name: "Chat binding", brandName: "Chat binding", seedScreenshot: false });
    const raw = customChatInteractionFilm();
    const draft = applyDeterministicSourceRepairs(raw, dir, raw.storyboard);
    expect(draft.html).toContain('data-part="chat-input" data-cmp-text="1"');
    expect(draft.html).toContain('data-part="ai-response" data-cmp-stream="1"');
    const validation = await validateDirectComposition(dir, draft);
    expect(validation.errors).toEqual([]);
    const qa = await inspectDirectComposition(dir, draft, { captureGuide: false });
    expect(qa.infraError).toBeUndefined();
    expect(
      qa.issues.filter((issue) => issue.code.startsWith("interaction_")),
      JSON.stringify({ errors: qa.errors, issues: qa.issues, evidence: qa.interactions }),
    ).toEqual([]);
    expect(qa.interactions?.some((entry) => entry.phase === "arrival" && entry.hit)).toBe(true);
  }, 60_000);

  it("compiles type/open/morph/count/chart/rows/press/progress beats seek-safely", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-component-smoke-"));
    roots.push(dir);
    initializeProject(dir, { name: "Smoke", brandName: "Smoke", seedScreenshot: false });
    const draft = componentFilm();
    const validation = await validateDirectComposition(dir, draft);
    expect(validation.errors).toEqual([]);
    // Every declared moment must bind to typed component/beat evidence.
    expect(validation.moments.filter((moment) => !moment.evidence)).toEqual([]);
    expect(validation.moments.some((moment) => moment.evidence?.kind === "component")).toBe(true);
    const qa = await inspectDirectComposition(dir, draft, { captureGuide: false });
    expect(qa.infraError).toBeUndefined();
    expect(qa.errors).toEqual([]);
    expect(qa.ok).toBe(true);
    expect(
      qa.issues.filter((issue) =>
        issue.code.includes("annotation") || issue.code.includes("attachment")
      ),
    ).toEqual([]);
    // Rendered temporal judge calibration: every one of these beats visibly
    // changes the frame, so no moment may be flagged as static.
    expect(qa.temporalJudge?.length).toBeGreaterThanOrEqual(2);
    expect(
      (qa.temporalJudge ?? []).filter((entry) => entry.verdict === "static"),
    ).toEqual([]);
    expect(qa.settleBlooms?.length).toBeGreaterThan(0);
    for (const bloom of qa.settleBlooms ?? []) {
      expect(bloom.startOpacity, bloom.beatId).toBeGreaterThan(bloom.endOpacity);
      expect(bloom.endOpacity, bloom.beatId).toBeLessThan(0.01);
      expect(bloom.endSec - bloom.startSec, bloom.beatId).toBeLessThanOrEqual(1);
    }
  // The full browser project runs several Chrome-heavy inspectors in parallel.
  // This fixture completes in ~18s alone but can queue behind those processes;
  // keep every runtime/QA assertion intact while allowing orchestration slack.
  }, 60_000);
});
