import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { inspectDirectComposition } from "../src/engine/layoutInspector.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";
import { CAMERA_RUNTIME_FILE, resolveCameraPlan } from "../src/engine/cameraContract.ts";

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
 * the same discipline once at mid-window, and the film's final resolve is
 * exempt (a compact end card is a deliberate close).
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
      id: "close",
      title: "Closing resolve",
      purpose: "A deliberately compact end card (exempt as the final scene)",
      startSec: 17,
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
.center{position:absolute;inset:0;display:grid;place-items:center}
</style></head><body>
<main id="root" data-composition-id="coverage-smoke" data-width="1920" data-height="1080" data-duration="19.5">
<section id="sparse-cam" class="scene clip" data-scene="sparse-cam" data-start="0" data-duration="4" data-track-index="1">
<div class="world" data-camera-world>
<div class="station" data-region="lonely"><div class="small-card" data-part="lonely-card">one card</div></div>
</div>
</section>
<section id="filled-cam" class="scene clip" data-scene="filled-cam" data-start="4" data-duration="4" data-track-index="1">
<div class="world" data-camera-world>
<div class="station" data-region="packed"><div class="big-panel" data-part="hero-panel">the whole product</div></div>
</div>
</section>
<section id="drift-sparse" class="scene clip" data-scene="drift-sparse" data-start="8" data-duration="3" data-track-index="1">
<div class="world" data-camera-world>
<div class="station" data-region="adrift"><div class="small-card" data-part="adrift-card">tiny toast</div></div>
</div>
</section>
<section id="static-sparse" class="scene clip" data-scene="static-sparse" data-start="11" data-duration="3" data-track-index="1">
<div class="center"><div class="small-card" data-part="tiny-static">small</div></div>
</section>
<section id="static-filled" class="scene clip" data-scene="static-filled" data-start="14" data-duration="3" data-track-index="1">
<div class="center"><div class="big-panel" data-part="big-static">frame-filling</div></div>
</section>
<section id="close" class="scene clip" data-scene="close" data-start="17" data-duration="2.5" data-track-index="1">
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
tl.set("#close",{opacity:1},17).set("#close",{opacity:0},19.5);
tl.fromTo("#static-sparse [data-part=tiny-static]",{opacity:0},{opacity:1,duration:.4},11.2);
tl.fromTo("#static-filled [data-part=big-static]",{opacity:0},{opacity:1,duration:.4},14.2);
tl.fromTo("#close [data-part=end-card]",{opacity:0},{opacity:1,duration:.4},17.2);
SequencesCamera.compile(tl,document.getElementById("root"));
window.__timelines["coverage-smoke"]=tl;tl.seek(0);
</script></body></html>`;
  return { storyboard, html };
}

describe("framing coverage browser audit (camera_framed_sparse)", () => {
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
    expect(stationFinding!.message).toMatch(/fills only \d+% of the frame/);
    // …the filled camera landing does not…
    expect(sparse.some((issue) => issue.selector.includes("packed"))).toBe(false);
    // …a drift-only camera scene has no landing to sample, so it takes the
    // mid-window sample (fix-ws-probe-3: a tiny toast drifted unsampled)…
    expect(sparse.some((issue) => issue.selector === '[data-scene="drift-sparse"]')).toBe(true);
    // …the tiny camera-less scene fires at mid-window…
    expect(sparse.some((issue) => issue.selector === '[data-scene="static-sparse"]')).toBe(true);
    // …the frame-filling camera-less scene stays silent…
    expect(sparse.some((issue) => issue.selector.includes("static-filled"))).toBe(false);
    // …and the film's final resolve is exempt: a compact end card is deliberate.
    expect(sparse.some((issue) => issue.selector.includes("close"))).toBe(false);
    // Sparse framings are polish findings: they block strictOk (the repair
    // loop gets a chance) but never publication.
    expect(qa.strictOk).toBe(false);
  }, 45_000);
});
