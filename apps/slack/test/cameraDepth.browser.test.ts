import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { launchHeadlessBrowser } from "../src/engine/browserLifecycle.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import {
  CAMERA_RUNTIME_FILE,
  cameraRuntimeSource,
  resolveCameraPlan,
  validateCameraContract,
} from "../src/engine/cameraContract.ts";
import { findBrowserExecutable } from "../src/engine/render.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * One hero scene proving both camera-depth features in a real browser:
 * a true 3D orbit (perspective on the scene wrapper, rotateY sandwich on the
 * world plane) and a rack-focus pull (host-owned blur across data-depth
 * layers). The assertions are the runtime's two hard promises: the effects
 * actually appear, and every value is a pure function of timeline time —
 * seeking out of order must reproduce byte-identical transforms and filters.
 */
function cameraDepthFilm(): { storyboard: DirectScene[]; html: string } {
  const storyboard: DirectScene[] = [
    {
      id: "hero",
      title: "Logo resolve",
      purpose: "Orbit the mark, then rack focus onto it",
      startSec: 0,
      durationSec: 6,
      camera: {
        version: 1,
        path: [
          {
            version: 1,
            move: "orbit",
            toRegion: "logo-stage",
            startSec: 0.5,
            durationSec: 2,
            arcDeg: 28,
          },
          {
            version: 1,
            move: "push-in",
            toRegion: "logo-stage",
            startSec: 3.5,
            durationSec: 1.5,
            focus: { part: "brand-mark", blurMaxPx: 8 },
          },
        ],
      },
    },
  ];
  const island = JSON.stringify(resolveCameraPlan(storyboard));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<title>Camera depth smoke</title><script src="gsap.min.js"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0a0f16}
#root{position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;opacity:0}
.world{position:relative;width:2400px;height:1400px}
.texture{position:absolute;inset:0;background:radial-gradient(circle at 40% 40%,#1c2a3f,#0a0f16)}
.station{position:absolute;display:grid;place-items:center}
.mark{width:280px;height:280px;border-radius:64px;background:#5eead4;color:#06231d;display:grid;place-items:center;font:700 96px Arial}
</style></head><body>
<main id="root" data-composition-id="depth-smoke" data-width="1920" data-height="1080" data-duration="6">
<section id="hero" class="scene clip" data-scene="hero" data-start="0" data-duration="6" data-track-index="1">
<div class="world" data-camera-world>
<div class="texture" data-depth="0.25"></div>
<div class="station" data-region="logo-stage" style="left:240px;top:160px;width:1600px;height:900px">
<div class="mark" data-part="brand-mark">S</div>
</div>
</div>
</section>
</main>
<script type="application/json" id="sequences-camera">${island}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#hero",{opacity:1},0).set("#hero",{opacity:0},6);
SequencesCamera.compile(tl,document.getElementById("root"));
window.__timelines["depth-smoke"]=tl;tl.seek(0);
</script></body></html>`;
  return { storyboard, html };
}

function importantCompanionFilm(): { storyboard: DirectScene[]; html: string } {
  const storyboard: DirectScene[] = [{
    id: "resolve",
    title: "Metric and lockup",
    purpose: "Keep the load-bearing lockup with its metric",
    startSec: 0,
    durationSec: 3,
    camera: {
      version: 1,
      path: [{
        version: 1,
        move: "push-in",
        fromPart: "ring",
        toPart: "ring",
        startSec: 0.2,
        durationSec: 1.2,
      }],
    },
  }];
  const island = JSON.stringify(resolveCameraPlan(storyboard));
  return {
    storyboard,
    html: `<!doctype html><html><head><meta charset="UTF-8">
<script src="gsap.min.js"></script><script src="${CAMERA_RUNTIME_FILE}"></script>
<style>*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#090d14}
#root,.scene{position:absolute;inset:0;overflow:hidden}.world{position:relative;width:1920px;height:1080px}
.station{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:100px;padding:140px}.depth-lockup{flex:3}.depth-ring{flex:2;display:grid;place-items:center}
[data-depth="0.3"]{position:absolute}.lockup{width:100%;height:260px;background:#1c2635;color:#fff;font:700 52px Arial;display:grid;place-items:center}
.ring{width:300px;height:300px;border-radius:50%;background:#3b82f6}</style></head><body>
<main id="root" data-composition-id="companion" data-width="1920" data-height="1080" data-duration="3">
<section class="scene" data-scene="resolve"><div class="world" data-camera-world><div class="station" data-region="resolve">
<div class="depth-lockup" data-depth="0.3"><div class="lockup" data-part="lockup" data-layout-important="1">OrbitOps resolved</div></div>
<div class="depth-ring" data-depth="1"><div class="ring" data-part="ring" data-layout-important="1"></div></div>
</div></div></section></main><script type="application/json" id="sequences-camera">${island}</script>
<script>window.__timelines={};const tl=gsap.timeline({paused:true});SequencesCamera.compile(tl,document.getElementById("root"));window.__timelines.companion=tl;tl.seek(0);</script>
</body></html>`,
  };
}

function transparentListFilm(): string {
  const storyboard: DirectScene[] = [{
    id: "list-scene",
    title: "Approval trail",
    purpose: "Frame three ordered rows without a void-filled root",
    startSec: 0,
    durationSec: 3,
    camera: {
      version: 1,
      path: [{
        version: 1,
        move: "push-in",
        toPart: "approval-list",
        startSec: 0,
        durationSec: 1,
      }],
    },
  }];
  return `<!doctype html><html><head><meta charset="UTF-8">
<script src="gsap.min.js"></script><script src="${CAMERA_RUNTIME_FILE}"></script>
<style>*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden}#root,.scene{position:absolute;inset:0;overflow:hidden}.world{position:relative;width:1920px;height:1080px}.station{position:absolute;left:260px;top:140px;width:1400px;height:800px;display:flex;align-items:flex-start;padding:100px}.list{width:100%;height:100%;display:flex;flex-direction:column;gap:24px}.row{height:90px;background:#172235;color:white;display:grid;place-items:center;font:700 28px Arial}</style></head><body>
<main id="root" data-composition-id="transparent-list" data-width="1920" data-height="1080" data-duration="3"><section class="scene" data-scene="list-scene"><div class="world" data-camera-world><div class="station" data-region="list-station"><div class="list" data-component="list" data-part="approval-list"><div class="row" data-part="row-1">Assign reviewer</div><div class="row" data-part="row-2">Resolve blocker</div><div class="row" data-part="row-3">Publish approval</div></div></div></div></section></main>
<script type="application/json" id="sequences-camera">${JSON.stringify(resolveCameraPlan(storyboard))}</script>
<script>window.__timelines={};const tl=gsap.timeline({paused:true});SequencesCamera.compile(tl,document.getElementById("root"));window.__timelines.list=tl;tl.seek(0);</script></body></html>`;
}

function serveDir(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
  };
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const file = path.resolve(dir, "." + pathname.replace(/\/$/, "/index.html"));
      if (!file.startsWith(path.resolve(dir)) || !fs.existsSync(file)) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": mime[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      });
      response.end(fs.readFileSync(file));
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("could not bind test server"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/index.html`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

interface DepthState {
  worldTransform: string;
  scenePerspective: string;
  textureFilter: string;
}

interface FramingState {
  width: number;
  centerX: number;
  centerY: number;
}

describe("camera depth browser contract (orbit + rack focus)", () => {
  it("keeps load-bearing station companions in a part-targeted shot", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath, "a Chromium/Chrome/Edge executable is required").toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-camera-companion-"));
    roots.push(dir);
    const draft = importantCompanionFilm();
    fs.writeFileSync(path.join(dir, "index.html"), draft.html, "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
    const server = await serveDir(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: browserPath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      const state = await page.evaluate(() => {
        const timeline = (window as unknown as {
          __timelines: Record<string, { seek: (time: number, suppress?: boolean) => void }>;
        }).__timelines.companion!;
        timeline.seek(1.6, false);
        const lockup = document.querySelector<HTMLElement>(".lockup")!.getBoundingClientRect();
        const ring = document.querySelector<HTMLElement>(".ring")!.getBoundingClientRect();
        return {
          lockupTop: lockup.top,
          lockupBottom: lockup.bottom,
          lockupRight: lockup.right,
          ringTop: ring.top,
          ringBottom: ring.bottom,
          ringLeft: ring.left,
          depthPosition: getComputedStyle(document.querySelector<HTMLElement>(".depth-lockup")!).position,
        };
      });
      expect(state.lockupTop).toBeGreaterThan(90);
      expect(state.lockupBottom).toBeLessThan(990);
      expect(state.ringTop).toBeGreaterThan(90);
      expect(state.ringBottom).toBeLessThan(990);
      expect(state.lockupRight).toBeLessThan(state.ringLeft);
      expect(state.depthPosition).toBe("relative");
    } finally {
      await browser.close();
      await server.close();
    }
  }, 30_000);

  it("shrinkwraps a transparent full-height list to its painted rows", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-camera-list-shrinkwrap-"));
    roots.push(dir);
    fs.writeFileSync(path.join(dir, "index.html"), transparentListFilm(), "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
    const server = await serveDir(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: browserPath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      const state = await page.evaluate(() => {
        const timeline = (window as unknown as {
          __timelines: Record<string, { seek: (time: number, suppress?: boolean) => void }>;
        }).__timelines.list!;
        timeline.seek(1.2, false);
        const list = document.querySelector<HTMLElement>('[data-part="approval-list"]')!;
        const rect = list.getBoundingClientRect();
        return {
          marker: list.getAttribute("data-sequences-camera-shrinkwrap"),
          layoutHeight: list.offsetHeight,
          occupancy: rect.width * rect.height / (1920 * 1080),
        };
      });
      expect(state.marker).toBe("1");
      expect(state.layoutHeight).toBeLessThan(400);
      expect(state.occupancy).toBeGreaterThan(0.08);
      expect(state.occupancy).toBeLessThan(0.5);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 30_000);

  it("orbits in 3D and pulls focus deterministically under out-of-order seek", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath, "a Chromium/Chrome/Edge executable is required").toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-depth-smoke-"));
    roots.push(dir);
    const draft = cameraDepthFilm();
    expect(validateCameraContract(draft.html, draft.storyboard).errors).toEqual([]);
    fs.writeFileSync(path.join(dir, "index.html"), draft.html, "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");

    const server = await serveDir(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: browserPath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        // Resource 404s (the favicon) are not runtime failures.
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
          consoleErrors.push(message.text());
        }
      });
      page.on("pageerror", (error) => consoleErrors.push(String(error)));
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      await page.waitForFunction(
        () => Object.keys((window as unknown as { __timelines?: object }).__timelines ?? {}).length > 0,
        { timeout: 10_000 },
      );

      const capture = async (time: number): Promise<DepthState> =>
        page.evaluate((at: number) => {
          const timelines = (window as unknown as {
            __timelines: Record<string, { pause: () => void; seek: (t: number, s?: boolean) => void }>;
          }).__timelines;
          for (const timeline of Object.values(timelines)) {
            timeline.pause();
            timeline.seek(at, false);
          }
          const world = document.querySelector<HTMLElement>("[data-camera-world]")!;
          const scene = document.querySelector<HTMLElement>("#hero")!;
          const texture = document.querySelector<HTMLElement>(".texture")!;
          return {
            worldTransform: world.style.transform,
            scenePerspective: scene.style.perspective,
            textureFilter: texture.style.filter,
          };
        }, time);

      const framing = async (time: number): Promise<FramingState> =>
        page.evaluate((at: number) => {
          const timelines = (window as unknown as {
            __timelines: Record<string, { pause: () => void; seek: (t: number, s?: boolean) => void }>;
          }).__timelines;
          for (const timeline of Object.values(timelines)) {
            timeline.pause();
            timeline.seek(at, false);
          }
          const rect = document.querySelector<HTMLElement>(".mark")!.getBoundingClientRect();
          return {
            width: rect.width,
            centerX: rect.left + rect.width / 2,
            centerY: rect.top + rect.height / 2,
          };
        }, time);

      // A viewport-sized station containing one compact hero frames the hero,
      // not the station rectangle. This is the live mega-station/top-left
      // failure class: the mark should arrive large and optically centered.
      const heroFrame = await framing(3.1);
      expect(heroFrame.width).toBeGreaterThan(700);
      expect(heroFrame.centerX).toBeCloseTo(960, 0);
      expect(heroFrame.centerY).toBeCloseTo(540, 0);

      // Mid-orbit: the world plane must actually rotate in 3D, with
      // perspective owned by the scene wrapper, and no focus blur yet.
      const midOrbit = await capture(1.5);
      expect(midOrbit.scenePerspective).toBe("1200px");
      expect(midOrbit.worldTransform).toContain("rotateY(");
      expect(midOrbit.textureFilter).toBe("");
      // After the orbit returns to rest the rotation must fully clear.
      const afterOrbit = await capture(3.1);
      expect(afterOrbit.worldTransform).not.toContain("rotateY(");
      // Mid-focus: the off-plane texture layer blurs; the focal plane does not.
      const midFocus = await capture(4.6);
      expect(midFocus.textureFilter).toMatch(/^blur\(\d/);
      const markFilter = await page.evaluate(() =>
        document.querySelector<HTMLElement>(".mark")!.style.filter
      );
      expect(markFilter).toBe("");
      // The rack releases once its segment ends: focus is motivated only
      // while that framing holds, so the field must return to sharp instead
      // of squatting blurred on the rest of the scene.
      const afterFocus = await capture(5.6);
      expect(afterFocus.textureFilter).toBe("");
      // Deterministic seek: replaying the same times after jumping around the
      // timeline must reproduce byte-identical transforms and filters.
      await capture(5.9);
      await capture(0.2);
      const replayOrbit = await capture(1.5);
      expect(replayOrbit).toEqual(midOrbit);
      await capture(0.05);
      const replayFocus = await capture(4.6);
      expect(replayFocus).toEqual(midFocus);
      // Before the first focus segment the field stays sharp even after a
      // round trip through the racked window.
      const rewound = await capture(0.2);
      expect(rewound.textureFilter).toBe("");
      expect(consoleErrors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 45_000);
});

/**
 * Level-2 depth + whip-blur relocation. One scene proves the whole fence from
 * PLAN_camera_depth_level2: the world element NEVER carries a CSS filter
 * (whip blur lives on the backdrop lens overlay), preserve-3d therefore
 * survives on the world, and data-depth layers separate in Z (translateZ, a
 * pure function of orbit deflection) while the camera arcs — byte-identical
 * under out-of-order seek, flat again at rest.
 */
function depth3dFilm(): { storyboard: DirectScene[]; html: string } {
  const storyboard: DirectScene[] = [
    {
      id: "hero",
      title: "Depth orbit + whip",
      purpose: "3D-separated orbit, then a whip with lens blur",
      startSec: 0,
      durationSec: 7,
      camera: {
        version: 1,
        path: [
          {
            version: 1,
            move: "orbit",
            toRegion: "logo-stage",
            startSec: 0.5,
            durationSec: 2,
            arcDeg: 28,
          },
          {
            version: 1,
            move: "whip",
            toRegion: "metric-wall",
            startSec: 4,
            durationSec: 0.8,
          },
        ],
        depth3d: true,
      },
    },
  ];
  const island = JSON.stringify(resolveCameraPlan(storyboard));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<title>Depth3d smoke</title><script src="gsap.min.js"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0a0f16}
#root{position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;opacity:0}
.world{position:relative;width:4200px;height:1400px}
.texture{position:absolute;inset:0;background:radial-gradient(circle at 40% 40%,#1c2a3f,#0a0f16)}
.halo{position:absolute;left:300px;top:200px;width:700px;height:700px;border-radius:50%;background:#123}
.station{position:absolute;display:grid;place-items:center}
.mark{width:280px;height:280px;border-radius:64px;background:#5eead4;color:#06231d;display:grid;place-items:center;font:700 96px Arial}
.wall{width:900px;height:500px;background:#16324a;border-radius:24px}
</style></head><body>
<main id="root" data-composition-id="depth3d-smoke" data-width="1920" data-height="1080" data-duration="7">
<section id="hero" class="scene clip" data-scene="hero" data-start="0" data-duration="7" data-track-index="1">
<div class="world" data-camera-world>
<div class="texture" data-depth="0.25"></div>
<div class="halo" data-depth="0.8"></div>
<div class="station" data-region="logo-stage" style="left:240px;top:160px;width:1600px;height:900px">
<div class="mark" data-part="brand-mark">S</div>
</div>
<div class="station" data-region="metric-wall" style="left:2300px;top:300px;width:1600px;height:900px">
<div class="wall" data-part="metric-wall-card"></div>
</div>
</div>
</section>
</main>
<script type="application/json" id="sequences-camera">${island}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#hero",{opacity:1},0).set("#hero",{opacity:0},7);
SequencesCamera.compile(tl,document.getElementById("root"));
window.__timelines["depth3d-smoke"]=tl;tl.seek(0);
</script></body></html>`;
  return { storyboard, html };
}

interface Depth3dState {
  worldTransform: string;
  worldTransformStyle: string;
  worldFilter: string;
  textureTransform: string;
  haloTransform: string;
  lensBackdrop: string;
}

describe("camera depth level 2 (preserve-3d layers + whip lens)", () => {
  it("separates layers in Z during orbit and keeps the world filter-free through a whip", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath, "a Chromium/Chrome/Edge executable is required").toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-depth3d-smoke-"));
    roots.push(dir);
    const draft = depth3dFilm();
    const validation = validateCameraContract(draft.html, draft.storyboard);
    expect(validation.errors).toEqual([]);
    expect(validation.plan?.scenes[0]?.depth3d).toBe(true);
    fs.writeFileSync(path.join(dir, "index.html"), draft.html, "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");

    const server = await serveDir(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: browserPath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
          consoleErrors.push(message.text());
        }
      });
      page.on("pageerror", (error) => consoleErrors.push(String(error)));
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      await page.waitForFunction(
        () => Object.keys((window as unknown as { __timelines?: object }).__timelines ?? {}).length > 0,
        { timeout: 10_000 },
      );

      const capture = async (time: number): Promise<Depth3dState> =>
        page.evaluate((at: number) => {
          const timelines = (window as unknown as {
            __timelines: Record<string, { pause: () => void; seek: (t: number, s?: boolean) => void }>;
          }).__timelines;
          for (const timeline of Object.values(timelines)) {
            timeline.pause();
            timeline.seek(at, false);
          }
          const world = document.querySelector<HTMLElement>("[data-camera-world]")!;
          const lens = document.querySelector<HTMLElement>(".seq-whip-lens");
          return {
            worldTransform: world.style.transform,
            worldTransformStyle: world.style.transformStyle,
            worldFilter: world.style.filter,
            textureTransform: document.querySelector<HTMLElement>(".texture")!.style.transform,
            haloTransform: document.querySelector<HTMLElement>(".halo")!.style.transform,
            lensBackdrop: lens ? (lens.style.backdropFilter ?? "") : "(no lens)",
          };
        }, time);

      // Mid-orbit: the world preserves 3D, the far layer recedes and the near
      // layer advances (opposite translateZ signs), and nothing is blurred.
      const midOrbit = await capture(1.5);
      expect(midOrbit.worldTransformStyle).toBe("preserve-3d");
      expect(midOrbit.worldTransform).toContain("rotateY(");
      expect(midOrbit.worldFilter).toBe("");
      expect(midOrbit.textureTransform).toMatch(/translateZ\(-\d/);
      expect(midOrbit.haloTransform).toMatch(/translateZ\(\d|translateZ\(3[0-9]/);
      expect(midOrbit.lensBackdrop === "" || midOrbit.lensBackdrop === "(no lens)").toBe(true);
      // At rest after the orbit, layers return to the flat plane.
      const atRest = await capture(3.2);
      expect(atRest.worldTransform).not.toContain("rotateY(");
      expect(atRest.textureTransform).toMatch(/translateZ\(0(\.00)?px\)/);
      // Mid-whip: blur lives on the backdrop lens, never the world element.
      const midWhip = await capture(4.4);
      expect(midWhip.worldFilter).toBe("");
      expect(midWhip.lensBackdrop).toMatch(/^blur\(\d/);
      // After the whip lands the lens clears.
      const landed = await capture(5.4);
      expect(landed.lensBackdrop).toBe("");
      expect(landed.worldFilter).toBe("");
      // Out-of-order seek: identical values on replay.
      await capture(6.8);
      await capture(0.1);
      const replayOrbit = await capture(1.5);
      expect(replayOrbit).toEqual(midOrbit);
      const replayWhip = await capture(4.4);
      expect(replayWhip).toEqual(midWhip);
      expect(consoleErrors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 45_000);
});

/**
 * MD5 `dive` browser contract: one typed move pushes into the palette part,
 * holds while its beat would develop it, and returns EXACTLY to the saved
 * pre-dive camera state — byte-identical transforms under out-of-order seek,
 * so the surrounding path is provably undisturbed.
 */
function diveFilm(): { storyboard: DirectScene[]; html: string } {
  const storyboard: DirectScene[] = [
    {
      id: "workbench",
      title: "Dense workbench",
      purpose: "Dive into the palette, type, return",
      startSec: 0,
      durationSec: 8,
      camera: {
        version: 1,
        path: [
          { version: 1, move: "hold", toRegion: "bench", startSec: 0, durationSec: 2 },
          {
            // Flush with the hold so no connective gap-fill drift shifts the
            // saved state — the return-to-state assertion is then exact.
            version: 1,
            move: "dive",
            toPart: "palette-input",
            startSec: 2,
            durationSec: 5,
            zoom: 1.3,
            // Host-derived legs (deriveDiveWindows) — fixed here so the test
            // asserts exact times: push-in 2→2.7, hold 2.7→6.3, out 6.3→7.
            inSec: 0.7,
            outSec: 0.7,
          },
        ],
      },
    },
  ];
  const island = JSON.stringify(resolveCameraPlan(storyboard));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<title>Dive smoke</title><script src="gsap.min.js"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0a0f16}
#root{position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;opacity:0}
.world{position:relative;width:2400px;height:1400px}
.station{position:absolute;display:grid;place-items:center}
.palette{width:640px;height:88px;border-radius:14px;background:#182338;color:#dbe7ff;display:grid;place-items:center;font:500 28px Arial}
</style></head><body>
<main id="root" data-composition-id="dive-smoke" data-width="1920" data-height="1080" data-duration="8">
<section id="workbench" class="scene clip" data-scene="workbench" data-start="0" data-duration="8" data-track-index="1">
<div class="world" data-camera-world>
<div class="station" data-region="bench" style="left:240px;top:160px;width:1600px;height:900px">
<div class="palette" data-part="palette-input">deploy checkout service</div>
</div>
</div>
</section>
</main>
<script type="application/json" id="sequences-camera">${island}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#workbench",{opacity:1},0).set("#workbench",{opacity:0},8);
SequencesCamera.compile(tl,document.getElementById("root"));
window.__timelines["dive-smoke"]=tl;tl.seek(0);
</script></body></html>`;
  return { storyboard, html };
}

describe("dive camera browser contract (MD5)", () => {
  it("dives to the part, holds, and returns exactly to the saved state", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath, "a Chromium/Chrome/Edge executable is required").toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-dive-smoke-"));
    roots.push(dir);
    const draft = diveFilm();
    expect(validateCameraContract(draft.html, draft.storyboard).errors).toEqual([]);
    fs.writeFileSync(path.join(dir, "index.html"), draft.html, "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
    const server = await serveDir(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: browserPath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
          consoleErrors.push(message.text());
        }
      });
      page.on("pageerror", (error) => consoleErrors.push(String(error)));
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      await page.waitForFunction(
        () => Object.keys((window as unknown as { __timelines?: object }).__timelines ?? {}).length > 0,
        { timeout: 10_000 },
      );
      const worldTransformAt = async (time: number): Promise<string> =>
        page.evaluate((at: number) => {
          const timelines = (window as unknown as {
            __timelines: Record<string, { pause: () => void; seek: (t: number, s?: boolean) => void }>;
          }).__timelines;
          for (const timeline of Object.values(timelines)) {
            timeline.pause();
            timeline.seek(at, false);
          }
          return document.querySelector<HTMLElement>("[data-camera-world]")!.style.transform;
        }, time);

      // Pre-dive state (the bench framing, settled).
      const before = await worldTransformAt(1.0);
      // Push-in complete at 2.7s; mid-hold the palette is framed tighter.
      const midHold = await worldTransformAt(4.5);
      expect(midHold).not.toBe(before);
      // The hold is static: the framing must not drift between hold samples.
      const midHoldLater = await worldTransformAt(6.0);
      expect(midHoldLater).toBe(midHold);
      const numbers = (transform: string): number[] =>
        (transform.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      const expectSubPixelEqual = (actual: string, expected: string): void => {
        const actualNumbers = numbers(actual);
        const expectedNumbers = numbers(expected);
        expect(actualNumbers).toHaveLength(expectedNumbers.length);
        for (const [index, value] of actualNumbers.entries()) {
          expect(Math.abs(value - expectedNumbers[index]!)).toBeLessThan(0.01);
        }
      };
      // At the pull-back's landing (7.0s) the camera is home: the same saved
      // state to sub-pixel precision (GSAP's ease evaluation at the seam can
      // differ by a float-formatting hair, never by geometry).
      const after = await worldTransformAt(7.0);
      expectSubPixelEqual(after, before);
      // Out-of-order seek: the held framing reproduces byte-identically (a
      // tween actively renders it); the tween-less leading hold window is
      // last-render residue — a pre-existing hold property — so it gets the
      // same sub-pixel bar as the homecoming.
      await worldTransformAt(7.9);
      await worldTransformAt(0.1);
      expect(await worldTransformAt(4.5)).toBe(midHold);
      await worldTransformAt(6.9);
      expectSubPixelEqual(await worldTransformAt(1.0), before);
      expect(consoleErrors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 45_000);
});
