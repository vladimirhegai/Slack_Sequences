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
  // Each scene keeps an on-canvas headline so the film is not near-blank —
  // this fixture tests canvas-edge classification, not the blank-film guard.
  draft.html = draft.html
    .replace(
      '<div class="panel" data-layout-important><h1>Too close</h1></div>',
      '<h1 style="position:absolute;left:200px;top:250px">Signal</h1>' +
        '<span id="live-badge" style="position:absolute;left:850px;top:200px;font:700 24px Arial">LIVE</span>',
    )
    .replace(
      '<div class="panel" data-layout-important><h1>Still close</h1></div>',
      '<h1 style="position:absolute;left:200px;top:250px">Signal</h1>' +
        '<span style="position:absolute;left:850px;top:200px;font:700 24px Arial">DONE</span>',
    );
  return draft;
}

/**
 * "one": a 2s decorative-gradient scene inside a 10s film — stays a repair
 * warning (under the 4s single-scene cap and the 30% film fraction).
 * "both": 10s of gradient-only frames — must block publication.
 */
function nearBlankDraft(blankScenes: "one" | "both"): DirectCompositionDraft {
  const sceneTwoContent = blankScenes === "both"
    ? '<div style="position:absolute;inset:0;background:radial-gradient(#232936,#10131a)"></div>'
    : '<div class="panel"><h1>Visible closing line</h1></div>';
  return {
    storyboard: [
      { id: "one", title: "One", purpose: "Open", startSec: 0, durationSec: 2 },
      { id: "two", title: "Two", purpose: "Close", startSec: 2, durationSec: 8 },
    ],
    html: `<!doctype html>
<html><head><script src="gsap.min.js"></script><style>
html,body{margin:0;width:800px;height:600px;overflow:hidden;background:#10131a}
#root{--space-safe:60px;position:relative;width:800px;height:600px;overflow:hidden;color:#fff}
.scene{position:absolute;inset:0;opacity:0}
.panel{position:absolute;left:120px;top:180px;width:360px;padding:24px;background:#232936}
h1{margin:0;font:700 48px/1.1 Arial}
</style></head><body>
<main id="root" data-composition-id="blank-test" data-width="800" data-height="600" data-duration="10">
  <section id="one" class="scene clip" data-scene="one" data-start="0" data-duration="2" data-track-index="1">
    <div style="position:absolute;inset:0;background:linear-gradient(#1a2030,#10131a)"></div>
  </section>
  <section id="two" class="scene clip" data-scene="two" data-start="2" data-duration="8" data-track-index="1">
    ${sceneTwoContent}
  </section>
</main><script>
window.__timelines=window.__timelines||{};
const tl=gsap.timeline({paused:true});
tl.set("#one",{opacity:1},0).set("#one",{opacity:0},1.99);
tl.set("#two",{opacity:1},2).set("#two",{opacity:0},10);
window.__timelines["blank-test"]=tl;
</script></body></html>`,
  };
}

function titleCardDraft(): DirectCompositionDraft {
  const draft = unsafeDraft();
  // A minimalist title card: one centered headline on a dark ground must
  // never read as a blank frame.
  draft.html = draft.html
    .replace(
      '<div class="panel" data-layout-important><h1>Too close</h1></div>',
      '<h1 style="position:absolute;left:220px;top:260px;margin:0">From shipped to shown</h1>',
    )
    .replace(
      '<div class="panel" data-layout-important><h1>Still close</h1></div>',
      '<h1 style="position:absolute;left:300px;top:270px;margin:0">Sequences</h1>',
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

function misalignedUnderlineDraft(): DirectCompositionDraft {
  const draft = unsafeDraft();
  draft.html = draft.html.replace(
    '<div class="panel" data-layout-important><h1>Too close</h1></div>',
    '<div style="position:absolute;left:180px;top:200px">' +
      '<span id="measured-word" style="display:inline-block;font:700 56px Arial">Signal</span>' +
      '<span id="hero-underline" data-layout-attach="#measured-word" ' +
      'data-layout-role="underline" style="position:absolute;left:145px;top:58px;' +
      'width:42px;height:6px;background:#74f7c5"></span></div>',
  );
  return draft;
}

function interactionDraft(
  endpointNudge = 0,
  ease = "power3.out",
  nestedCursor = false,
  revealTargetOnArrival = false,
): DirectCompositionDraft {
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
    ease,
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
      ${nestedCursor ? "<span class=\"cursor-shell\">" : ""}
      <svg id="cursor" data-cursor-id="pointer" data-cursor-hotspot-x="0.08" data-cursor-hotspot-y="0.06" viewBox="0 0 24 24"><path d="M2 2L20 10L11 13L7 21Z" fill="white"/></svg>
      ${nestedCursor ? "</span>" : ""}
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
${revealTargetOnArrival
  ? 'tl.fromTo("#target",{opacity:0},{opacity:1,duration:.1,ease:"none"},1.35);'
  : ""}
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
    60_000,
  );

  it.skipIf(!findBrowserExecutable())(
    "keeps a loaded document with no registered timeline as a blocking runtime failure",
    async () => {
      const draft = unsafeDraft();
      draft.html = draft.html.replace(
        'window.__timelines["layout-test"]=tl;',
        "",
      );
      const result = await inspectDirectComposition(projectDir(), draft);
      expect(result.ok).toBe(false);
      expect(result.infraError).toBeUndefined();
      expect(result.errors.some((error) => error.includes("browser validate/layout inspect failed")))
        .toBe(true);
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
    60_000,
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
    60_000,
  );

  it.skipIf(!findBrowserExecutable())(
    "flags a single short blank scene for repair without blocking the film",
    async () => {
      const result = await inspectDirectComposition(projectDir(), nearBlankDraft("one"));
      expect(result.ok, JSON.stringify(result.errors)).toBe(true);
      expect(result.strictOk).toBe(false);
      expect(result.issues.some((issue) =>
        issue.code === "near_blank_scene" && issue.selector === '[data-scene="one"]'
      )).toBe(true);
      expect(result.issues.some((issue) =>
        issue.code === "near_blank_scene" && issue.selector === '[data-scene="two"]'
      )).toBe(false);
    },
    60_000,
  );

  it.skipIf(!findBrowserExecutable())(
    "blocks a film that renders as blank frames so the fallback ships instead",
    async () => {
      const result = await inspectDirectComposition(projectDir(), nearBlankDraft("both"));
      expect(result.ok).toBe(false);
      expect(result.errors.some((error) => error.startsWith("near_blank_film:"))).toBe(true);
    },
    60_000,
  );

  it.skipIf(!findBrowserExecutable())(
    "never mistakes a minimalist title card for a blank frame",
    async () => {
      const result = await inspectDirectComposition(projectDir(), titleCardDraft());
      expect(result.ok, JSON.stringify(result.errors)).toBe(true);
      expect(result.issues.some((issue) => issue.code === "near_blank_scene")).toBe(false);
      expect(result.errors.some((error) => error.startsWith("near_blank_film:"))).toBe(false);
    },
    60_000,
  );

  it.skipIf(!findBrowserExecutable())(
    "detects a visible underline whose position is detached from the measured word",
    async () => {
      const result = await inspectDirectComposition(projectDir(), misalignedUnderlineDraft());
      expect(result.ok).toBe(true);
      expect(result.issues.some((issue) =>
        issue.selector === "#hero-underline" &&
        (
          issue.code === "layout_annotation_width_mismatch" ||
          issue.code === "layout_annotation_alignment_mismatch"
        )
      )).toBe(true);
    },
    60_000,
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
    60_000,
  );

  it.skipIf(!findBrowserExecutable())(
    "allows a measurable target to reveal while the cursor is approaching",
    async () => {
      const result = await inspectDirectComposition(
        projectDir(),
        interactionDraft(0, "power3.out", false, true),
      );
      expect(
        result.ok,
        JSON.stringify({ errors: result.errors, issues: result.issues }),
      ).toBe(true);
      expect(result.issues.some((issue) => issue.code === "interaction_not_visible")).toBe(false);
      expect(result.interactions?.some((entry) => entry.phase === "arrival")).toBe(true);
    },
    60_000,
  );

  it.skipIf(!findBrowserExecutable())(
    "hard-fails a four-pixel endpoint regression after interaction compilation",
    async () => {
      const result = await inspectDirectComposition(projectDir(), interactionDraft(4));
      expect(result.ok).toBe(false);
      expect(result.issues.some((issue) =>
        issue.code === "interaction_target_miss" && issue.interactionId === "feature-click"
      )).toBe(true);
      expect(result.errors.some((error) => error.includes("interaction_target_miss"))).toBe(true);
    },
    60_000,
  );

  it.skipIf(!findBrowserExecutable())(
    "falls back safely when an authored interaction ease is unknown",
    async () => {
      const result = await inspectDirectComposition(
        projectDir(),
        interactionDraft(0, "model-invented.ease"),
      );
      expect(
        result.ok,
        JSON.stringify({ errors: result.errors, issues: result.issues }),
      ).toBe(true);
      expect(result.interactions?.some((entry) => entry.phase === "arrival")).toBe(true);
    },
    60_000,
  );

  it.skipIf(!findBrowserExecutable())(
    "canonicalizes a cursor nested inside a decorative overlay wrapper",
    async () => {
      const result = await inspectDirectComposition(
        projectDir(),
        interactionDraft(0, "power3.out", true),
      );
      expect(
        result.ok,
        JSON.stringify({ errors: result.errors, issues: result.issues }),
      ).toBe(true);
      expect(result.issues.some((issue) =>
        issue.code === "interaction_overlay_invalid" ||
        issue.code === "interaction_target_miss"
      )).toBe(false);
    },
    60_000,
  );
});
