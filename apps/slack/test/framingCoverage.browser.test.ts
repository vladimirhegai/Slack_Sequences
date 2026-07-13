import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { inspectDirectComposition } from "../src/engine/layoutInspector.ts";
import { correctSparseFraming } from "../src/engine/runner/repairs.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";
import { CAMERA_RUNTIME_FILE, resolveCameraPlan } from "../src/engine/cameraContract.ts";
import { sourceRetryFeedbackForBrowserQa } from "../src/engine/runner/browserQuality.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Framing-coverage audit (WS5, probe-cutfix-3 m06 / improve-ws15-1 m09-m10
 * class) in one real browser run. Coverage is measured over the whole scene's
 * on-frame content (post camera transform), so a landing whose frame is
 * genuinely mostly empty raises `camera_framed_sparse`, while a landing whose
 * frame is filled — even a tight one — stays silent. Camera-less scenes get
 * the same discipline once at mid-window. Closing frames participate too: a
 * tiny lockup in a void is still an under-composed frame.
 */
function coverageFilm(): { storyboard: DirectScene[]; html: string } {
  const cameraScene = (
    id: string,
    startSec: number,
    region: string,
  ): DirectScene => ({
    id,
    title: id,
    purpose: `land on ${region}`,
    startSec,
    durationSec: 4,
    camera: {
      version: 1,
      path: [
        { version: 1, move: "pan", toRegion: region, startSec: startSec + 0.5, durationSec: 1.2 },
      ],
    },
  });
  const storyboard: DirectScene[] = [
    cameraScene("sparse-cam", 0, "lonely"),
    cameraScene("filled-cam", 4, "packed"),
    {
      id: "drift-sparse",
      title: "Tiny drifting",
      purpose: "A small subject under a drift-only camera (no landing to sample)",
      startSec: 8,
      durationSec: 3,
      camera: {
        version: 1,
        path: [
          { version: 1, move: "drift", toRegion: "adrift", startSec: 8, durationSec: 3 },
        ],
      },
    },
    {
      id: "static-sparse",
      title: "Tiny static",
      purpose: "A small static subject in an empty frame",
      startSec: 11,
      durationSec: 3,
    },
    {
      id: "static-filled",
      title: "Filled static",
      purpose: "A frame-filling static composition",
      startSec: 14,
      durationSec: 3,
    },
    {
      id: "static-scattered",
      title: "Scattered fragments",
      purpose: "A huge bounding box made from two tiny painted islands",
      startSec: 17,
      durationSec: 3,
    },
    {
      id: "close",
      title: "Closing resolve",
      purpose: "A compact end card that must still compose the full frame",
      startSec: 20,
      durationSec: 2.5,
    },
  ];
  const island = JSON.stringify(resolveCameraPlan(storyboard));
  // Each camera scene owns a single station in a world just larger than the
  // viewport (proven-valid geometry from cameraDepth.browser.test), so the
  // pan lands on exactly one region with no second station to leak on frame.
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<title>Framing coverage smoke</title><script src="gsap.min.js"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0c1220}
body{color:#e8edf6;font-family:Arial,sans-serif}
#root{position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;opacity:0}
.world{position:relative;width:2400px;height:1400px}
.station{position:absolute;display:grid;place-items:center;left:240px;top:160px;width:1600px;height:900px}
.small-card{width:360px;height:180px;border-radius:20px;background:#22314a;display:grid;place-items:center;font-size:28px}
.big-panel{width:1500px;height:820px;border-radius:24px;background:#1c2c44;display:grid;place-items:center;font-size:48px}
.scatter-card{position:absolute;width:140px;height:90px;border-radius:12px;background:#22314a;display:grid;place-items:center}
.credited-env{position:absolute;inset:0;background:linear-gradient(135deg,#17263d,#315178)}
.center{position:absolute;inset:0;display:grid;place-items:center}
</style></head><body>
<main id="root" data-composition-id="coverage-smoke" data-width="1920" data-height="1080" data-duration="22.5">
<section id="sparse-cam" class="scene clip" data-scene="sparse-cam" data-start="0" data-duration="4" data-track-index="1">
<div class="world" data-camera-world>
<div class="station" data-region="lonely" data-camera-frame="region"><div class="small-card" data-part="lonely-card">one card</div></div>
</div>
</section>
<section id="filled-cam" class="scene clip" data-scene="filled-cam" data-start="4" data-duration="4" data-track-index="1">
<div class="world" data-camera-world>
<div class="station" data-region="packed"><div class="big-panel" data-part="hero-panel">the whole product</div></div>
</div>
</section>
<section id="drift-sparse" class="scene clip" data-scene="drift-sparse" data-start="8" data-duration="3" data-track-index="1">
<div class="world" data-camera-world>
<div class="station" data-region="adrift" data-camera-frame="region"><div class="small-card" data-part="adrift-card">tiny toast</div></div>
</div>
</section>
<section id="static-sparse" class="scene clip" data-scene="static-sparse" data-start="11" data-duration="3" data-track-index="1">
<div class="center"><div class="small-card" data-part="tiny-static">small</div></div>
</section>
<section id="static-filled" class="scene clip" data-scene="static-filled" data-start="14" data-duration="3" data-track-index="1">
<div class="center"><div class="big-panel" data-part="big-static">frame-filling</div></div>
</section>
<section id="static-scattered" class="scene clip" data-scene="static-scattered" data-start="17" data-duration="3" data-track-index="1">
<div class="scatter-card" style="left:140px;top:120px">A</div><div class="scatter-card" style="right:140px;bottom:120px">B</div>
</section>
<section id="close" class="scene clip" data-scene="close" data-start="20" data-duration="2.5" data-track-index="1">
<div class="credited-env" data-layout-ignore data-composition-credit="1"></div>
<div class="center"><div class="small-card" data-part="end-card">the end card</div></div>
</section>
</main>
<script type="application/json" id="sequences-camera">${island}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#sparse-cam",{opacity:1},0).set("#sparse-cam",{opacity:0},3.999);
tl.set("#filled-cam",{opacity:1},4).set("#filled-cam",{opacity:0},7.999);
tl.set("#drift-sparse",{opacity:1},8).set("#drift-sparse",{opacity:0},10.999);
tl.set("#static-sparse",{opacity:1},11).set("#static-sparse",{opacity:0},13.999);
tl.set("#static-filled",{opacity:1},14).set("#static-filled",{opacity:0},16.999);
tl.set("#static-scattered",{opacity:1},17).set("#static-scattered",{opacity:0},19.999);
tl.set("#close",{opacity:1},20).set("#close",{opacity:0},22.5);
tl.fromTo("#static-sparse [data-part=tiny-static]",{opacity:0},{opacity:1,duration:.4},11.2);
tl.fromTo("#static-filled [data-part=big-static]",{opacity:0},{opacity:1,duration:.4},14.2);
tl.fromTo("#close [data-part=end-card]",{opacity:0},{opacity:1,duration:.4},20.2);
SequencesCamera.compile(tl,document.getElementById("root"));
window.__timelines["coverage-smoke"]=tl;tl.seek(0);
</script></body></html>`;
  return { storyboard, html };
}

/**
 * One deliberately under-composed frame that still clears the older sparse
 * framing floor. Keeping the two thresholds apart isolates A3 mode policy:
 * audit/block must disagree only about strict-polish pressure, not geometry.
 */
function compositionFloorFilm(): { storyboard: DirectScene[]; html: string } {
  const storyboard: DirectScene[] = [{
    id: "composition-floor",
    title: "Underfilled composition",
    purpose: "Exercise the whole-frame composition mode without a sparse focal",
    startSec: 0,
    durationSec: 3,
    spatialIntent: {
      version: 1,
      focalPart: "floor-panel",
      composition: "one medium product panel centered in an otherwise bare frame",
      relationships: ["floor-panel is the sole focal and remains centered"],
    },
  }];
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<title>Composition floor mode smoke</title><script src="gsap.min.js"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0c1220}
#root,.scene{position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;display:grid;place-items:center}
.floor-panel{width:880px;height:480px;border:2px solid #42658f;border-radius:28px;background:#243a5a}
</style></head><body>
<main id="root" data-composition-id="composition-floor-smoke" data-width="1920" data-height="1080" data-duration="3">
<section class="scene clip" data-scene="composition-floor" data-start="0" data-duration="3" data-track-index="1">
<div class="floor-panel" data-part="floor-panel" data-layout-important></div>
</section></main>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set('[data-scene="composition-floor"]',{opacity:1},0);
window.__timelines["composition-floor-smoke"]=tl;tl.seek(0);
</script></body></html>`;
  return { storyboard, html };
}

describe("framing coverage browser audit (camera_framed_sparse)", () => {
  it("keeps the composition floor advisory visible in audit and block modes", async () => {
    const priorComposition = process.env.SLACK_SEQUENCES_COMPOSITION;
    const priorContinuous = process.env.SLACK_SEQUENCES_CONTINUOUS_MOTION;
    process.env.SLACK_SEQUENCES_CONTINUOUS_MOTION = "0";
    const draft = compositionFloorFilm();
    const inspectMode = async (mode: "audit" | "block") => {
      process.env.SLACK_SEQUENCES_COMPOSITION = mode;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sequences-composition-${mode}-`));
      roots.push(dir);
      initializeProject(dir, { name: mode, brandName: mode, seedScreenshot: false });
      return inspectDirectComposition(dir, draft, { captureGuide: false });
    };
    try {
      const audit = await inspectMode("audit");
      const block = await inspectMode("block");
      const auditFinding = audit.issues.find((issue) =>
        issue.code === "composition_frame_underfilled"
      );
      const blockFinding = block.issues.find((issue) =>
        issue.code === "composition_frame_underfilled"
      );

      expect(audit.infraError).toBeUndefined();
      expect(audit.errors).toEqual([]);
      expect(audit.ok).toBe(true);
      expect(audit.strictOk).toBe(true);
      expect(auditFinding).toMatchObject({
        severity: "warning",
        sceneId: "composition-floor",
      });
      expect(auditFinding!.message).toContain("mode=audit");
      expect(audit.issues.some((issue) => issue.code === "camera_framed_sparse")).toBe(false);

      expect(block.infraError).toBeUndefined();
      expect(block.errors).toEqual([]);
      expect(block.ok).toBe(true);
      expect(block.strictOk).toBe(false);
      expect(blockFinding).toMatchObject({
        severity: "warning",
        sceneId: "composition-floor",
      });
      expect(blockFinding!.message).toContain("mode=block");
      expect(blockFinding!.selector).toBe(auditFinding!.selector);
      const blockWarning = block.warnings.find((warning) =>
        warning.startsWith("composition_frame_underfilled")
      );
      expect(blockWarning).toBeDefined();
      expect(sourceRetryFeedbackForBrowserQa(block)).not.toContain(blockWarning!);
    } finally {
      if (priorComposition === undefined) delete process.env.SLACK_SEQUENCES_COMPOSITION;
      else process.env.SLACK_SEQUENCES_COMPOSITION = priorComposition;
      if (priorContinuous === undefined) delete process.env.SLACK_SEQUENCES_CONTINUOUS_MOTION;
      else process.env.SLACK_SEQUENCES_CONTINUOUS_MOTION = priorContinuous;
    }
  }, 60_000);

  it("flags sparse landings and static frames, passes filled ones", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-coverage-smoke-"));
    roots.push(dir);
    initializeProject(dir, { name: "Smoke", brandName: "Smoke", seedScreenshot: false });
    const draft = coverageFilm();
    const qa = await inspectDirectComposition(dir, draft, { captureGuide: false });
    expect(qa.infraError).toBeUndefined();
    expect(qa.errors).toEqual([]);
    expect(qa.ok).toBe(true);
    const sparse = qa.issues.filter((issue) => issue.code === "camera_framed_sparse");
    // The lone-card camera landing fires with the measured percentage…
    const stationFinding = sparse.find((issue) => issue.selector === '[data-region="lonely"]');
    expect(stationFinding).toBeDefined();
    expect(stationFinding!.severity).toBe("warning");
    expect(stationFinding!.message).toMatch(/fills only \d+% of the 24x14 occupancy grid/);
    // …the filled camera landing does not…
    expect(sparse.some((issue) => issue.selector.includes("packed"))).toBe(false);
    // …a drift-only camera scene has no landing to sample, so it takes the
    // mid-window sample (fix-ws-probe-3: a tiny toast drifted unsampled)…
    expect(sparse.some((issue) => issue.selector === '[data-scene="drift-sparse"]')).toBe(true);
    // …the tiny camera-less scene fires at mid-window…
    expect(sparse.some((issue) => issue.selector === '[data-scene="static-sparse"]')).toBe(true);
    // …the frame-filling camera-less scene stays silent…
    expect(sparse.some((issue) => issue.selector.includes("static-filled"))).toBe(false);
    // A large diagonal bbox made from tiny painted islands is still sparse:
    // the grid is the primary signal while the old bbox remains diagnostic.
    const scattered = sparse.find((issue) => issue.selector === '[data-scene="static-scattered"]');
    expect(scattered).toBeDefined();
    expect(scattered!.framing!.bboxFraction).toBeGreaterThan(0.5);
    expect(scattered!.framing!.fraction).toBeLessThan(0.18);
    // …and the film's final resolve is no longer exempt.
    expect(sparse.some((issue) => issue.selector === '[data-scene="close"]')).toBe(true);
    const underfilled = qa.issues.filter((issue) => issue.code === "composition_frame_underfilled");
    // Bare canvas paint does not rescue a tiny semantic composition…
    expect(underfilled.some((issue) => issue.sceneId === "static-sparse")).toBe(true);
    // …but an explicit host environment earns whole-frame composition credit.
    // The semantic sparse finding above remains independent, so the focal
    // still cannot hide behind pretty wallpaper.
    expect(underfilled.some((issue) => issue.sceneId === "close")).toBe(false);
    // Sparse framings are polish findings: they block strictOk (the repair
    // loop gets a chance) but never publication.
    expect(qa.strictOk).toBe(false);
  }, 45_000);

  it("clears the landing sparse finding after the deterministic zoom correction", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-coverage-repair-"));
    roots.push(dir);
    initializeProject(dir, { name: "Smoke", brandName: "Smoke", seedScreenshot: false });
    const draft = coverageFilm();
    const qa = await inspectDirectComposition(dir, draft, { captureGuide: false });
    expect(qa.infraError).toBeUndefined();
    const sparseBefore = qa.issues.filter((issue) => issue.code === "camera_framed_sparse");
    // Sanity: the lonely camera landing is present and carries measured coverage.
    const landing = sparseBefore.find((issue) => issue.selector === '[data-region="lonely"]');
    expect(landing?.framing?.sceneId).toBe("sparse-cam");
    expect(landing!.framing!.fraction).toBeGreaterThan(0);

    // The pure correction bumps the existing landing and promotes the targeted
    // connective drift into one measured push-in. Camera-less sparse scenes
    // remain deliberately untouched.
    const fix = correctSparseFraming(draft.storyboard, qa);
    expect(fix.corrected).toEqual(["sparse-cam", "drift-sparse"]);
    const bumped = fix.storyboard[0]!.camera!.path[0]!.zoom!;
    expect(bumped).toBeGreaterThan(1.05);
    const promoted = fix.storyboard[2]!.camera!.path[0]!;
    expect(promoted.move).toBe("push-in");
    expect(promoted.zoom).toBeGreaterThan(1.05);
    expect(promoted.startSec + promoted.durationSec).toBeLessThanOrEqual(10.58);

    // Re-inject the camera island from the mutated storyboard (the seam
    // applyDeterministicSourceRepairs / cut-discovery use) and re-measure.
    const island = JSON.stringify(resolveCameraPlan(fix.storyboard));
    const repairedHtml = draft.html.replace(
      /(<script type="application\/json" id="sequences-camera">)[\s\S]*?(<\/script>)/,
      `$1${island}$2`,
    );
    const qa2 = await inspectDirectComposition(
      dir,
      { storyboard: fix.storyboard, html: repairedHtml },
      { captureGuide: false },
    );
    expect(qa2.infraError).toBeUndefined();
    expect(qa2.errors).toEqual([]);
    const sparseAfter = qa2.issues.filter((issue) => issue.code === "camera_framed_sparse");
    // The corrected landing no longer reads as sparse…
    expect(sparseAfter.filter((issue) => issue.framing?.sceneId === "sparse-cam")).toEqual([]);
    // …the correction introduced no new clipping…
    const clippedBefore = qa.issues.filter((issue) => issue.code === "camera_framed_clipped").length;
    const clippedAfter = qa2.issues.filter((issue) => issue.code === "camera_framed_clipped").length;
    expect(clippedAfter).toBeLessThanOrEqual(clippedBefore);
    // …and the overall sparse count strictly dropped.
    expect(sparseAfter.length).toBeLessThan(sparseBefore.length);
  }, 75_000);
});
