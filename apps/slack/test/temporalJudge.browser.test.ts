import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { inspectDirectComposition } from "../src/engine/layoutInspector.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * The rendered temporal judge's core promise: static source inspection can
 * prove a tween exists, but only rendered pixels prove the promised change is
 * visible. This film declares two evidence-bound moments — one bound to a
 * headline reveal the viewer actually sees, one bound to a tween inside a
 * permanently invisible container (real to the motion parser, invisible on
 * screen). The judge must pass the first and flag the second.
 */
function judgeFilm(): { storyboard: DirectScene[]; html: string } {
  const storyboard: DirectScene[] = [
    {
      id: "shot-real",
      title: "Headline lands",
      purpose: "A visible reveal the judge should accept",
      startSec: 0,
      durationSec: 6,
      moments: [
        {
          version: 1,
          id: "m-real",
          sceneId: "shot-real",
          atSec: 1,
          title: "Headline flies in",
          visualState: "the promise fills the frame",
          change: "hero copy arrives",
          motionIntent: "reveal",
          importance: "primary",
        },
      ],
    },
    {
      id: "shot-ghost",
      title: "Nothing visibly changes",
      purpose: "An invisible tween the judge should flag",
      startSec: 6,
      durationSec: 6,
      moments: [
        {
          version: 1,
          id: "m-ghost",
          sceneId: "shot-ghost",
          atSec: 7.2,
          title: "Ghost metric shifts",
          visualState: "a hidden dot slides",
          change: "claimed but invisible",
          motionIntent: "reveal",
          importance: "primary",
        },
      ],
    },
  ];
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<title>Temporal judge smoke</title><script src="gsap.min.js"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0a0f16}
body{color:#eef2f8;font-family:Arial,sans-serif}
#root{position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;padding:96px;display:grid;align-content:center;justify-items:center;gap:40px;opacity:0}
h2{margin:0;font-size:96px;letter-spacing:-.04em}
.ghost-wrap{opacity:0;width:600px;height:80px;position:relative}
.ghost-dot{position:absolute;left:0;top:20px;width:40px;height:40px;border-radius:50%;background:#5eead4}
</style></head><body>
<main id="root" data-composition-id="judge-smoke" data-width="1920" data-height="1080" data-duration="12">
<section id="shot-real" class="scene clip" data-scene="shot-real" data-start="0" data-duration="6" data-track-index="1">
<h2 id="real-headline" data-part="real-headline">From shipped to shown</h2>
</section>
<section id="shot-ghost" class="scene clip" data-scene="shot-ghost" data-start="6" data-duration="6" data-track-index="1">
<h2>Steady state</h2>
<div class="ghost-wrap"><div class="ghost-dot" id="ghost-dot" data-part="ghost-dot"></div></div>
</section>
</main>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#shot-real",{opacity:1},0).set("#shot-real",{opacity:0},5.99);
tl.set("#shot-ghost",{opacity:1},6).set("#shot-ghost",{opacity:0},12);
tl.fromTo("#real-headline",{y:220,opacity:0},{y:0,opacity:1,duration:0.7,ease:"power3.out"},0.8);
tl.fromTo("#ghost-dot",{x:0},{x:340,duration:0.8,ease:"power2.out"},7.0);
window.__timelines["judge-smoke"]=tl;tl.seek(0);
</script></body></html>`;
  return { storyboard, html };
}

describe("rendered temporal judge", () => {
  it("accepts a visible reveal and flags an invisible claimed change", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-judge-smoke-"));
    roots.push(dir);
    initializeProject(dir, { name: "Judge", brandName: "Judge", seedScreenshot: false });
    const draft = judgeFilm();
    const qa = await inspectDirectComposition(dir, draft, { captureGuide: false });
    expect(qa.infraError).toBeUndefined();
    const judged = qa.temporalJudge ?? [];
    const real = judged.find((entry) => entry.momentId === "m-real");
    const ghost = judged.find((entry) => entry.momentId === "m-ghost");
    expect(real?.verdict).toBe("changed");
    expect(ghost?.verdict).toBe("static");
    // The flagged moment surfaces as a named repair finding, downgrades
    // strictOk (bounded polish), and never blocks a runnable draft.
    expect(qa.issues.some((issue) =>
      issue.code === "moment_static_frame" && issue.selector === "moment:m-ghost")).toBe(true);
    expect(qa.issues.find((issue) => issue.selector === "moment:m-ghost")?.momentImportance)
      .toBe("primary");
    expect(qa.warnings.some((warning) => warning.includes("moment_static_frame"))).toBe(true);
    expect(qa.strictOk).toBe(false);
    expect(qa.ok).toBe(true);

    // Kill switch: the judge disappears without touching the rest of QA.
    process.env.SLACK_SEQUENCES_TEMPORAL_JUDGE = "0";
    process.env.SLACK_SEQUENCES_QA_CACHE = "0";
    try {
      const off = await inspectDirectComposition(dir, draft, { captureGuide: false });
      expect(off.temporalJudge).toBeUndefined();
      expect(off.issues.filter((issue) => issue.code === "moment_static_frame")).toEqual([]);
    } finally {
      delete process.env.SLACK_SEQUENCES_TEMPORAL_JUDGE;
      delete process.env.SLACK_SEQUENCES_QA_CACHE;
    }
  }, 60_000);
});
