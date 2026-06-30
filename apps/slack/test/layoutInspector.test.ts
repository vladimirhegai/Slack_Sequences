import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDirectLayoutSampleTimes,
  inspectDirectComposition,
} from "../src/engine/layoutInspector.ts";
import { findBrowserExecutable } from "../src/engine/render.ts";
import type { DirectCompositionDraft } from "../src/engine/directComposition.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function projectDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-layout-test-"));
  roots.push(dir);
  return dir;
}

function unsafeDraft(): DirectCompositionDraft {
  return {
    storyboard: [
      { id: "one", title: "One", purpose: "Open", startSec: 0, durationSec: 3 },
      { id: "two", title: "Two", purpose: "Close", startSec: 3, durationSec: 3 },
    ],
    html: `<!doctype html>
<html><head><script src="gsap.min.js"></script><style>
html,body{margin:0;width:800px;height:600px;overflow:hidden;background:#10131a}
#root{--space-safe:60px;position:relative;width:800px;height:600px;overflow:hidden;color:#fff}
.scene{position:absolute;inset:0;opacity:0}
.panel{position:absolute;left:0;top:180px;width:360px;padding:24px;background:#232936}
h1{margin:0;font:700 48px/1.1 Arial}
</style></head><body>
<main id="root" data-composition-id="layout-test" data-width="800" data-height="600" data-duration="6">
  <section id="one" class="scene clip" data-scene="one" data-start="0" data-duration="3" data-track-index="1">
    <div class="panel" data-layout-important><h1>Too close</h1></div>
  </section>
  <section id="two" class="scene clip" data-scene="two" data-start="3" data-duration="3" data-track-index="1">
    <div class="panel" data-layout-important><h1>Still close</h1></div>
  </section>
</main><script>
window.__timelines=window.__timelines||{};
const tl=gsap.timeline({paused:true});
tl.set("#one",{opacity:1},0).set("#one",{opacity:0},2.99);
tl.set("#two",{opacity:1},3).set("#two",{opacity:0},6);
window.__timelines["layout-test"]=tl;
</script></body></html>`,
  };
}

function offCanvasTextDraft(): DirectCompositionDraft {
  const draft = unsafeDraft();
  draft.html = draft.html
    .replace(
      '<div class="panel" data-layout-important><h1>Too close</h1></div>',
      '<span id="live-badge" style="position:absolute;left:850px;top:200px;font:700 24px Arial">LIVE</span>',
    )
    .replace(
      '<div class="panel" data-layout-important><h1>Still close</h1></div>',
      '<span style="position:absolute;left:850px;top:200px;font:700 24px Arial">DONE</span>',
    );
  return draft;
}

function clippedTextDraft(): DirectCompositionDraft {
  const draft = unsafeDraft();
  draft.html = draft.html
    .replace(
      '<div class="panel" data-layout-important><h1>Too close</h1></div>',
      '<div style="position:absolute;left:100px;top:200px;width:80px;height:40px;overflow:hidden">' +
        '<span id="clipped-copy" style="white-space:nowrap;font:700 24px Arial">ACTUALLY CLIPPED COPY</span></div>',
    )
    .replace(
      '<div class="panel" data-layout-important><h1>Still close</h1></div>',
      '<div style="position:absolute;left:100px;top:200px;width:80px;height:40px;overflow:hidden">' +
        '<span style="white-space:nowrap;font:700 24px Arial">ACTUALLY CLIPPED COPY</span></div>',
    );
  return draft;
}

function interactionDraft(endpointNudge = 0): DirectCompositionDraft {
  const interaction = {
    version: 1 as const,
    id: "feature-click",
    sceneId: "one",
    cursorId: "pointer",
    targetPart: "primary-action",
    action: "click" as const,
    startSec: 0.5,
    arriveSec: 1.5,
    pressSec: 1.6,
    releaseSec: 1.75,
    holdUntilSec: 2.5,
    from: "frame:bottom-right" as const,
    path: "human" as const,
    bend: -0.14,
    ease: "power3.out",
    aimX: 0.56,
    aimY: 0.48,
    offsetX: 2,
    offsetY: -1,
    hitInsetPx: 4,
    feedback: "press-ripple" as const,
    ripplePart: "click-ripple",
  };
  return {
    storyboard: [
      {
        id: "one",
        title: "One",
        purpose: "Interact",
        startSec: 0,
        durationSec: 3,
        spatialIntent: {
          version: 1,
          focalPart: "primary-action",
          composition: "Asymmetric product action",
          relationships: ["primary action remains inside the product surface"],
        },
        interactions: [interaction],
      },
      { id: "two", title: "Two", purpose: "Close", startSec: 3, durationSec: 3 },
    ],
    html: `<!doctype html><html><head>
<script src="gsap.min.js"></script>
<script src="sequences-interactions.v1.js"></script>
<style>
html,body{margin:0;width:800px;height:600px;overflow:hidden;background:#10131a}
#root{--space-safe:48px;position:relative;width:800px;height:600px;overflow:hidden;color:#fff}
.scene{position:absolute;inset:0;opacity:0}
[data-camera-world],[data-camera-overlay]{position:absolute;inset:0}
#target{position:absolute;left:410px;top:230px;width:180px;height:72px;border:0;border-radius:18px;background:#74f7c5}
#cursor{position:absolute;left:0;top:0;width:28px;height:28px;pointer-events:none;z-index:20}
#ripple{position:absolute;left:0;top:0;width:64px;height:64px;border:2px solid #74f7c5;border-radius:50%;pointer-events:none;opacity:0}
</style></head><body>
<main id="root" data-composition-id="interaction-test" data-width="800" data-height="600" data-duration="6">
  <section id="one" class="scene clip" data-scene="one" data-start="0" data-duration="3" data-track-index="1">
    <div id="world" data-camera-world>
      <button id="target" data-part="primary-action" data-layout-important>Deploy</button>
    </div>
    <div data-camera-overlay>
      <svg id="cursor" data-cursor-id="pointer" data-cursor-hotspot-x="0.08" data-cursor-hotspot-y="0.06" viewBox="0 0 24 24"><path d="M2 2L20 10L11 13L7 21Z" fill="white"/></svg>
      <div id="ripple" data-part="click-ripple"></div>
    </div>
  </section>
  <section id="two" class="scene clip" data-scene="two" data-start="3" data-duration="3" data-track-index="1">
    <div data-layout-important data-layout-anchor="frame:center">Done</div>
  </section>
</main>
<script type="application/json" id="sequences-interactions">${
  JSON.stringify({ version: 1, interactions: [interaction] })
}</script>
<script>
window.__timelines=window.__timelines||{};
const tl=gsap.timeline({paused:true});
tl.set("#one",{opacity:1},0).set("#one",{opacity:0},2.99);
tl.set("#two",{opacity:1},3).set("#two",{opacity:0},6);
tl.to("#world",{x:-100,duration:1,ease:"power2.inOut"},0.5);
SequencesInteractions.compile(tl,document.getElementById("root"));
${endpointNudge ? `tl.set("#cursor",{x:"+=${endpointNudge}"},1.6);` : ""}
window.__timelines["interaction-test"]=tl;
tl.seek(0);
</script></body></html>`,
  };
}

describe("direct layout inspector", () => {
  it("combines hero, cut, tween-boundary, and midpoint samples deterministically", () => {
    const times = buildDirectLayoutSampleTimes(unsafeDraft().storyboard, [0.5, 1, 3.5], 6);
    expect(times).toContain(1.74);
    expect(times).toContain(4.74);
    expect(times).toContain(3);
    expect(times).toContain(3.5);
    expect(times).toContain(3.25);
  });

  it("prioritizes arrival, press, release, and path evidence for declared interactions", () => {
    const draft = interactionDraft();
    const times = buildDirectLayoutSampleTimes(draft.storyboard, [], 6);
    expect(times).toContain(1);
    expect(times).toContain(1.5);
    expect(times).toContain(1.6);
    expect(times).toContain(1.62);
    expect(times).toContain(1.75);
    expect(times).toContain(2.5);
  });

  it.skipIf(!findBrowserExecutable())(
    "runs the vendored audit and requests repair for important content outside the safe area",
    async () => {
      const result = await inspectDirectComposition(projectDir(), unsafeDraft());
      expect(result.ok).toBe(true);
      expect(result.strictOk).toBe(false);
      expect(result.samples.length).toBeGreaterThan(4);
      expect(result.issues.some((issue) => issue.code === "important_safe_area")).toBe(true);
    },
    30_000,
  );

  it.skipIf(!findBrowserExecutable())(
    "reports genuinely clipped text for repair without blocking runnable output",
    async () => {
      const result = await inspectDirectComposition(projectDir(), clippedTextDraft());
      expect(result.ok).toBe(true);
      expect(result.strictOk).toBe(false);
      expect(result.issues.some((issue) =>
        issue.severity === "error" &&
        (issue.code === "clipped_text" || issue.code === "text_box_overflow") &&
        issue.selector === "#clipped-copy"
      )).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings.some((warning) => warning.includes("#clipped-copy"))).toBe(true);
    },
    30_000,
  );

  it.skipIf(!findBrowserExecutable())(
    "reports canvas-edge text motion as info without inventing a hard text-box failure",
    async () => {
      const result = await inspectDirectComposition(projectDir(), offCanvasTextDraft());
      expect(result.ok).toBe(true);
      expect(result.issues.some((issue) =>
        issue.code === "canvas_overflow" && issue.selector === "#live-badge"
      )).toBe(true);
      expect(result.issues.some((issue) =>
        issue.code === "text_box_overflow" && issue.selector === "#live-badge"
      )).toBe(false);
    },
    30_000,
  );

  it.skipIf(!findBrowserExecutable())(
    "keeps cursor hotspot and ripple on a target inside a moving camera world",
    async () => {
      const result = await inspectDirectComposition(projectDir(), interactionDraft());
      expect(
        result.ok,
        JSON.stringify({ errors: result.errors, issues: result.issues, evidence: result.interactions }),
      ).toBe(true);
      expect(result.issues.some((issue) => issue.code.startsWith("interaction_"))).toBe(false);
      const press = result.interactions?.find((entry) => entry.phase === "press");
      expect(press?.hit).toBe(true);
      expect(press?.deltaPx).toBeLessThanOrEqual(2);
      expect(result.guidePngBase64?.length).toBeGreaterThan(100);
    },
    30_000,
  );

  it.skipIf(!findBrowserExecutable())(
    "hard-fails a four-pixel endpoint regression after interaction compilation",
    async () => {
      const result = await inspectDirectComposition(projectDir(), interactionDraft(4));
      expect(result.ok).toBe(false);
      expect(result.issues.some((issue) => issue.code === "interaction_target_miss")).toBe(true);
      expect(result.errors.some((error) => error.includes("interaction_target_miss"))).toBe(true);
    },
    30_000,
  );
});
