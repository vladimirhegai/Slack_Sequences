import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyDeterministicSourceRepairs,
  correctLoadBearingContainment,
  evaluateLoadBearingContainmentAdoption,
} from "../src/engine/compositionRunner.ts";
import {
  inspectDirectComposition,
  type LoadBearingContainmentEvidence,
} from "../src/engine/layoutInspector.ts";
import { findBrowserExecutable } from "../src/engine/render.ts";
import type { DirectCompositionDraft, DirectScene } from "../src/engine/directComposition.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function projectDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-containment-browser-"));
  roots.push(dir);
  return dir;
}

function offFramePrimaryDraft(): DirectCompositionDraft {
  const storyboard: DirectScene[] = [
    {
      id: "before",
      title: "Before",
      purpose: "Show the load-bearing result",
      startSec: 0,
      durationSec: 3,
      spatialIntent: {
        version: 1,
        focalPart: "launch-result",
        composition: "One dominant result",
        relationships: ["result is the primary read"],
      },
      components: [{
        version: 1,
        id: "launch-result",
        kind: "stat-card",
        role: "hero",
      }],
      moments: [{
        version: 1,
        id: "result-lands",
        sceneId: "before",
        atSec: 1.2,
        title: "Result lands",
        visualState: "The complete launch result is readable",
        change: "The scattered state resolves",
        motionIntent: "resolve",
        importance: "primary",
      }],
    },
    {
      id: "close",
      title: "Close",
      purpose: "Hold the CTA",
      startSec: 3,
      durationSec: 3,
    },
  ];
  return {
    storyboard,
    html: `<!doctype html>
<html><head><script src="gsap.min.js"></script><style>
html,body{margin:0;width:800px;height:600px;overflow:hidden;background:#10131a}
#root{--space-safe:60px;position:relative;width:800px;height:600px;overflow:hidden;color:#fff}
.scene{position:absolute;inset:0;opacity:0}
.support{position:absolute;left:220px;top:100px;font:700 34px/1.1 Arial}
#launch-result{position:absolute;left:-180px;top:250px;width:300px;height:120px;
  background:#27334c;color:#fff;font:700 44px/120px Arial;text-align:center}
</style></head><body>
<main id="root" data-composition-id="containment-proof" data-width="800" data-height="600" data-duration="6">
  <section id="before" class="scene clip" data-scene="before" data-start="0" data-duration="3" data-track-index="1">
    <div class="support">Release status</div>
    <div id="launch-result" class="cmp cmp-stat" data-component="stat-card" data-part="launch-result">Ready</div>
  </section>
  <section id="close" class="scene clip" data-scene="close" data-start="3" data-duration="3" data-track-index="1">
    <div class="support">Ship the story</div>
  </section>
</main><script>
window.__timelines=window.__timelines||{};
const tl=gsap.timeline({paused:true});
tl.set("#before",{opacity:1},0).set("#before",{opacity:0},2.99);
tl.set("#close",{opacity:1},3).set("#close",{opacity:0},6);
window.__timelines["containment-proof"]=tl;
</script></body></html>`,
  };
}

function targetEvidence(
  values: LoadBearingContainmentEvidence[] | undefined,
): LoadBearingContainmentEvidence | undefined {
  return values?.find((entry) =>
    entry.sceneId === "before" && entry.part === "launch-result"
  );
}

describe("S6.10 load-bearing containment runtime", () => {
  it.skipIf(!findBrowserExecutable())(
    "measures, repairs once, re-inspects, and leaves the same repair idempotent",
    async () => {
      const dir = projectDir();
      const original = offFramePrimaryDraft();
      const beforeQa = await inspectDirectComposition(dir, original);
      const before = targetEvidence(beforeQa.loadBearingContainment);
      expect(before?.visibleFraction).toBeGreaterThan(0);
      expect(before?.visibleFraction).toBeLessThan(0.85);
      expect(beforeQa.issues.some((issue) =>
        issue.code === "spatial_focal_offframe" && issue.part === "launch-result"
      )).toBe(true);

      const correction = correctLoadBearingContainment(original.storyboard, beforeQa);
      expect(correction.corrected).toHaveLength(1);
      const corrected = applyDeterministicSourceRepairs(
        { storyboard: correction.storyboard, html: original.html },
        dir,
        correction.storyboard,
      );
      const afterQa = await inspectDirectComposition(dir, corrected);
      const after = targetEvidence(afterQa.loadBearingContainment);
      expect(after?.visibleFraction).toBeGreaterThanOrEqual(0.85);
      expect(evaluateLoadBearingContainmentAdoption({
        before: beforeQa,
        after: afterQa,
        target: correction.corrected[0]!,
      })).toMatchObject({ accepted: true });
      expect(afterQa.issues.some((issue) =>
        issue.code === "spatial_focal_offframe" && issue.part === "launch-result"
      )).toBe(false);

      const replay = correctLoadBearingContainment(correction.storyboard, beforeQa);
      expect(replay.storyboard).toEqual(correction.storyboard);
    },
    90_000,
  );
});
