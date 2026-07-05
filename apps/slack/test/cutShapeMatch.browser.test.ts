import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { inspectDirectComposition } from "../src/engine/layoutInspector.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";
import {
  CUT_RUNTIME_FILE,
  resolveCutPlan,
  validateCutContract,
} from "../src/engine/cutContract.ts";
import { CAMERA_RUNTIME_FILE } from "../src/engine/cameraContract.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Two shape-match boundaries in one real browser run: a genuinely rhyming
 * silhouette pair (pill → bar, aspect ratios within the 2.5× cap) that must
 * fly the dual bridge, and a deliberately MISmatched pair (a 10:1 banner →
 * a tall card) that must degrade to zoom-through with a recorded reason.
 * The degrade path matters more than the happy path — a bridge between
 * dissimilar elements reads as a glitch.
 */
function shapeMatchFilm(): { storyboard: DirectScene[]; html: string } {
  const storyboard: DirectScene[] = [
    {
      id: "one",
      title: "Search",
      purpose: "The query pill carries into the status bar",
      startSec: 0,
      durationSec: 3,
      cut: {
        version: 1,
        style: "shape-match",
        focalPartOut: "query-pill",
        focalPartIn: "status-bar",
        shapeOut: "pill",
        shapeIn: "bar",
      },
    },
    {
      id: "two",
      title: "Status",
      purpose: "The banner tries to become a card (and must degrade)",
      startSec: 3,
      durationSec: 3,
      cut: {
        version: 1,
        style: "shape-match",
        focalPartOut: "wide-banner",
        focalPartIn: "tall-card",
      },
    },
    { id: "three", title: "Resolve", purpose: "Landing", startSec: 6, durationSec: 3 },
  ];
  const island = JSON.stringify(resolveCutPlan(storyboard));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<title>Shape-match runtime smoke</title><script src="gsap.min.js"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script>
<script src="${CUT_RUNTIME_FILE}"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#101622}
body{color:#eef2f8;font-family:Arial,sans-serif}
#root{position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;padding:120px;display:grid;place-items:center;opacity:0}
.pill{width:320px;height:96px;border-radius:48px;background:#5eead4;color:#06231d;display:grid;place-items:center;font-size:32px}
.bar{width:560px;height:112px;border-radius:16px;background:#38bdf8;color:#082032;display:grid;place-items:center;font-size:32px}
.banner{width:1200px;height:120px;border-radius:12px;background:#f472b6;display:grid;place-items:center;font-size:30px}
.card{width:320px;height:640px;border-radius:24px;background:#a78bfa;display:grid;place-items:center;font-size:30px}
</style></head><body>
<main id="root" data-composition-id="shape-smoke" data-width="1920" data-height="1080" data-duration="9">
<section id="one" class="scene clip" data-scene="one" data-start="0" data-duration="3" data-track-index="1">
<div class="pill" data-part="query-pill" data-layout-important>deploy checkout</div>
</section>
<section id="two" class="scene clip" data-scene="two" data-start="3" data-duration="3" data-track-index="1">
<div style="display:grid;gap:48px;justify-items:center">
<div class="bar" data-part="status-bar" data-layout-important>deploy checkout · queued</div>
<div class="banner" data-part="wide-banner">release banner</div>
</div>
</section>
<section id="three" class="scene clip" data-scene="three" data-start="6" data-duration="3" data-track-index="1">
<div class="card" data-part="tall-card" data-layout-important>release card</div>
</section>
</main>
<script type="application/json" id="sequences-cuts">${island}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#one",{opacity:1},0).set("#one",{opacity:0},2.999);
tl.set("#two",{opacity:1},3).set("#two",{opacity:0},5.999);
tl.set("#three",{opacity:1},6).set("#three",{opacity:0},9);
tl.fromTo("#one [data-part=query-pill]",{y:40,opacity:0},{y:0,opacity:1,duration:.6,ease:"power3.out"},0.2);
tl.fromTo("#two [data-part=wide-banner]",{y:30,opacity:0},{y:0,opacity:1,duration:.5,ease:"power3.out"},3.6);
tl.fromTo("#three [data-part=tall-card] ",{scale:.96},{scale:1,duration:.6,ease:"power3.out"},6.6);
SequencesCuts.compile(tl,document.getElementById("root"));
window.__timelines["shape-smoke"]=tl;tl.seek(0);
</script></body></html>`;
  return { storyboard, html };
}

describe("shape-match cut runtime browser contract", () => {
  it("flies the matched bridge and degrades the mismatched pair to zoom-through", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-shape-smoke-"));
    roots.push(dir);
    initializeProject(dir, { name: "Smoke", brandName: "Smoke", seedScreenshot: false });
    const draft = shapeMatchFilm();
    // The static gate accepts both declared boundaries (existence is proven
    // scene-scoped; silhouette geometry is the runtime's decision).
    const contract = validateCutContract(draft.html, draft.storyboard);
    expect(contract.errors).toEqual([]);
    const qa = await inspectDirectComposition(dir, draft, { captureGuide: false });
    expect(qa.infraError).toBeUndefined();
    expect(qa.errors).toEqual([]);
    const degraded = qa.warnings.filter((warning) => warning.startsWith("cut_degraded:"));
    expect(degraded).toHaveLength(1);
    expect(degraded[0]).toContain("two->three");
    expect(degraded[0]).toContain("zoom-through");
    expect(degraded[0]).toContain("aspect ratio");
    expect(qa.ok).toBe(true);
    // WS1: the degradation of a planner-DECLARED cut is also a repairable
    // polish finding carrying the measured endpoint geometry — it must block
    // strictOk (so the author loop gets a repair chance) but never `ok`.
    const findings = qa.issues.filter((issue) => issue.code === "cut_degraded");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("warning");
    expect(findings[0]!.message).toContain("shape-match cut two->three");
    // Measured numbers, not vibes: both endpoints' px boxes appear.
    expect(findings[0]!.message).toMatch(/"wide-banner" \d+x\d+px/);
    expect(findings[0]!.message).toMatch(/"tall-card" \d+x\d+px/);
    expect(findings[0]!.fixHint).toContain("2.5x");
    expect(qa.strictOk).toBe(false);
    // The healthy one->two bridge earns no finding.
    expect(findings[0]!.message).not.toContain("one->two");
  }, 30_000);
});
