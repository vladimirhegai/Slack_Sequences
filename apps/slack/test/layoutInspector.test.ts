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

describe("direct layout inspector", () => {
  it("combines hero, cut, tween-boundary, and midpoint samples deterministically", () => {
    const times = buildDirectLayoutSampleTimes(unsafeDraft().storyboard, [0.5, 1, 3.5], 6);
    expect(times).toContain(1.74);
    expect(times).toContain(4.74);
    expect(times).toContain(3);
    expect(times).toContain(3.5);
    expect(times).toContain(3.25);
  });

  it.skipIf(!findBrowserExecutable())(
    "runs the vendored HyperFrames audit and blocks important content outside the safe area",
    async () => {
      const result = await inspectDirectComposition(projectDir(), unsafeDraft());
      expect(result.ok).toBe(false);
      expect(result.samples.length).toBeGreaterThan(4);
      expect(result.issues.some((issue) => issue.code === "important_safe_area")).toBe(true);
    },
    30_000,
  );
});
