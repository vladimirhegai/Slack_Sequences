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
  it("flies the matched bridge and degrades the mismatched pair to an axis-derived swipe", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-shape-smoke-"));
    roots.push(dir);
    initializeProject(dir, { name: "Smoke", brandName: "Smoke", seedScreenshot: false });
    const draft = shapeMatchFilm();
    // The static gate accepts both declared boundaries (existence is proven
    // scene-scoped; silhouette geometry is the runtime's decision). The
    // legacy shape-match declarations canonicalize to morph in the island.
    const contract = validateCutContract(draft.html, draft.storyboard);
    expect(contract.errors).toEqual([]);
    const qa = await inspectDirectComposition(dir, draft, { captureGuide: false });
    expect(qa.infraError).toBeUndefined();
    expect(qa.errors).toEqual([]);
    const degraded = qa.warnings.filter((warning) => warning.startsWith("cut_degraded:"));
    expect(degraded).toHaveLength(1);
    expect(degraded[0]).toContain("two->three");
    // MD1: the degrade target is a swipe whose axis is measured from the two
    // focal centers, never a zoom — the shipped film speaks the 3-transition
    // language even on its degrade paths.
    expect(degraded[0]).toMatch(/compiled as swipe-(left|right|up|down):/);
    expect(degraded[0]).toContain("aspect ratio");
    expect(qa.ok).toBe(true);
    // WS1: the degradation of a planner-DECLARED cut is also a repairable
    // polish finding carrying the measured endpoint geometry — it must block
    // strictOk (so the author loop gets a repair chance) but never `ok`.
    const findings = qa.issues.filter((issue) => issue.code === "cut_degraded");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("warning");
    expect(findings[0]!.message).toContain("morph cut two->three");
    expect(findings[0]!.message).toMatch(/degraded it to swipe-(left|right|up|down)/);
    // Measured numbers, not vibes: both endpoints' px boxes appear.
    expect(findings[0]!.message).toMatch(/"wide-banner" \d+x\d+px/);
    expect(findings[0]!.message).toMatch(/"tall-card" \d+x\d+px/);
    expect(findings[0]!.fixHint).toContain("2.5x");
    expect(qa.strictOk).toBe(false);
    // The healthy one->two bridge earns no finding.
    expect(findings[0]!.message).not.toContain("one->two");
  }, 30_000);

  it("degrades a row list → windowed table morph on structure mismatch (probe-audit-03 T8)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-structure-smoke-"));
    roots.push(dir);
    initializeProject(dir, { name: "Structure", brandName: "Structure", seedScreenshot: false });
    // A bare 4-row list morphing into a table wrapped in a chrome app-window:
    // the focal aspect ratios rhyme (both wide row stacks, so the aspect cap
    // passes) but the incoming surface carries a header + body the list has no
    // counterpart for — the FLIP smears. The structure audit measures the table
    // through its framing window (depth 4) vs the standalone list (depth 2).
    const row = (a: string, b: string, c: string): string =>
      `<div class="cmp-item" style="display:flex;gap:24px;padding:20px 32px;background:#161c28;border:1px solid #263041;">` +
      `<span style="width:90px;">${a}</span><span style="flex:1;">${b}</span><span style="width:120px;text-align:right;">${c}</span></div>`;
    const trow = (a: string, b: string, c: string): string =>
      `<div class="cmp-row" style="display:flex;gap:24px;padding:16px 24px;background:#161c28;border:1px solid #263041;">` +
      `<span style="width:80px;">${a}</span><span style="flex:1;">${b}</span><span style="width:120px;text-align:right;">${c}</span></div>`;
    const storyboard: DirectScene[] = [
      {
        id: "list",
        title: "Aligned list",
        purpose: "A standalone row list",
        startSec: 0,
        durationSec: 3,
        cut: { version: 1, style: "morph", focalPartOut: "aligned-list", focalPartIn: "momentum-table" },
      },
      { id: "board", title: "Board", purpose: "A windowed table", startSec: 3, durationSec: 3 },
    ];
    const island = JSON.stringify(resolveCutPlan(storyboard));
    const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<title>Structure-mismatch morph smoke</title><script src="gsap.min.js"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script>
<script src="${CUT_RUNTIME_FILE}"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0b0f16}
body{color:#eef2f8;font-family:Arial,sans-serif}
#root{position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;padding:120px;display:grid;place-items:center;opacity:0}
.cmp-list{width:1200px;display:flex;flex-direction:column;gap:16px}
.cmp-window{width:1440px;height:760px;display:flex;flex-direction:column;background:#10151f;border:1px solid #263041;border-radius:14px;overflow:hidden}
.cmp-chrome{display:flex;align-items:center;gap:10px;padding:16px 24px;border-bottom:1px solid #263041}
.cmp-chrome i{width:12px;height:12px;border-radius:50%;background:#F08080;display:inline-block}
.cmp-body{padding:32px;flex:1}
.cmp-table{width:1120px;display:flex;flex-direction:column;gap:12px}
.cmp-head{display:flex;gap:24px;padding:12px 24px;border-bottom:2px solid #263041}
</style></head><body>
<main id="root" data-composition-id="structure-smoke" data-width="1920" data-height="1080" data-duration="6">
<section id="list" class="scene clip" data-scene="list" data-start="0" data-duration="3" data-track-index="1">
<div class="cmp-list" data-part="aligned-list" data-layout-important>
${row("9:14", "Merged #412 — rate limiter", "shipped")}
${row("9:32", "Debugging auth pipeline", "in progress")}
${row("10:02", "Cannot deploy — staging down", "blocked")}
${row("10:15", "Digest mockups ready", "draft")}
</div>
</section>
<section id="board" class="scene clip" data-scene="board" data-start="3" data-duration="3" data-track-index="1">
<div class="cmp-window">
<div class="cmp-chrome"><i></i><i></i><i></i><span>Momentum · engineering</span></div>
<div class="cmp-body">
<div class="cmp-table" data-part="momentum-table" data-layout-important>
<div class="cmp-head"><span style="width:80px;">Time</span><span style="flex:1;">Update</span><span style="width:120px;text-align:right;">Status</span></div>
${trow("9:14", "Merged #412 — rate limiter", "shipped")}
${trow("9:32", "Debugging auth pipeline", "in progress")}
${trow("10:02", "Cannot deploy — staging down", "blocked")}
</div>
</div>
</div>
</section>
</main>
<script type="application/json" id="sequences-cuts">${island}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#list",{opacity:1},0).set("#list",{opacity:0},2.999);
tl.set("#board",{opacity:1},3).set("#board",{opacity:0},6);
tl.fromTo("#list [data-part=aligned-list]",{y:30,opacity:0},{y:0,opacity:1,duration:.5,ease:"power3.out"},0.3);
tl.fromTo("#board [data-part=momentum-table]",{y:30,opacity:0},{y:0,opacity:1,duration:.5,ease:"power3.out"},3.3);
SequencesCuts.compile(tl,document.getElementById("root"));
window.__timelines["structure-smoke"]=tl;tl.seek(0);
</script></body></html>`;
    const draft = { storyboard, html };
    expect(validateCutContract(draft.html, draft.storyboard).errors).toEqual([]);
    const qa = await inspectDirectComposition(dir, draft, { captureGuide: false });
    expect(qa.infraError).toBeUndefined();
    const degraded = qa.warnings.filter((warning) => warning.startsWith("cut_degraded:"));
    expect(degraded).toHaveLength(1);
    expect(degraded[0]).toContain("list->board");
    expect(degraded[0]).toMatch(/compiled as swipe-(left|right|up|down):/);
    expect(degraded[0]).toContain("mismatched structure");
    const findings = qa.issues.filter((issue) => issue.code === "cut_degraded");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("mismatched structure");
    expect(qa.ok).toBe(true);
  }, 30_000);

  it("keeps a cover swipe invisible to layout/near-blank audits", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-cover-smoke-"));
    roots.push(dir);
    initializeProject(dir, { name: "Cover", brandName: "Cover", seedScreenshot: false });
    const storyboard: DirectScene[] = [
      {
        id: "one",
        title: "Claim",
        purpose: "The claim lands",
        startSec: 0,
        durationSec: 3,
        cut: { version: 1, style: "swipe", axis: "left", cover: true },
      },
      { id: "two", title: "Proof", purpose: "The proof lands", startSec: 3, durationSec: 3 },
    ];
    const island = JSON.stringify(resolveCutPlan(storyboard));
    const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<title>Cover swipe smoke</title><script src="gsap.min.js"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script>
<script src="${CUT_RUNTIME_FILE}"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#101622}
body{color:#eef2f8;font-family:Arial,sans-serif}
#root{position:relative;width:1920px;height:1080px;overflow:hidden;--accent:#f59e0b}
.scene{position:absolute;inset:0;padding:120px;display:grid;place-items:center;opacity:0}
.claim{font-size:96px;font-weight:800}
</style></head><body>
<main id="root" data-composition-id="cover-smoke" data-width="1920" data-height="1080" data-duration="6">
<section id="one" class="scene clip" data-scene="one" data-start="0" data-duration="3" data-track-index="1">
<div class="claim" data-part="hero-claim" data-layout-important>Ship the launch film</div>
</section>
<section id="two" class="scene clip" data-scene="two" data-start="3" data-duration="3" data-track-index="1">
<div class="claim" data-part="proof-claim" data-layout-important>In one Slack thread</div>
</section>
</main>
<script type="application/json" id="sequences-cuts">${island}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#one",{opacity:1},0).set("#one",{opacity:0},2.999);
tl.set("#two",{opacity:1},3).set("#two",{opacity:0},6);
tl.fromTo("#one [data-part=hero-claim]",{y:40,opacity:0},{y:0,opacity:1,duration:.6,ease:"power3.out"},0.2);
tl.fromTo("#two [data-part=proof-claim]",{y:40,opacity:0},{y:0,opacity:1,duration:.6,ease:"power3.out"},3.6);
SequencesCuts.compile(tl,document.getElementById("root"));
window.__timelines["cover-smoke"]=tl;tl.seek(0);
</script></body></html>`;
    const draft = { storyboard, html };
    expect(validateCutContract(draft.html, draft.storyboard).errors).toEqual([]);
    const qa = await inspectDirectComposition(dir, draft, { captureGuide: false });
    expect(qa.infraError).toBeUndefined();
    // The panel and blur lens are runtime overlay artifacts
    // (data-layout-ignore + data-sequences-runtime-cut): no near-blank,
    // overlap, or coverage finding may fire because a wipe crossed the frame.
    expect(qa.errors).toEqual([]);
    expect(qa.ok).toBe(true);
  }, 30_000);
});
