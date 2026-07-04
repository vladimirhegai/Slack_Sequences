import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
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

describe("camera depth browser contract (orbit + rack focus)", () => {
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
    const puppeteer = (await import("puppeteer-core")).default;
    const browser = await puppeteer.launch({
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
