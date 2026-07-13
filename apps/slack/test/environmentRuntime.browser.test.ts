import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { launchHeadlessBrowser } from "../src/engine/browserLifecycle.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import {
  ENVIRONMENT_RUNTIME_FILE,
  environmentRuntimeSource,
  injectEnvironmentContract,
  injectEnvironmentKit,
  injectEnvironmentRuntimeTag,
  resolveEnvironmentPlan,
  stageEnvironmentAssets,
} from "../src/engine/environmentContract.ts";
import { findBrowserExecutable } from "../src/engine/render.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function serveDir(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".jpg": "image/jpeg",
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
        reject(new Error("could not bind environment test server"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/index.html`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

interface EnvironmentFrame {
  wallpaper: string;
  activity: string;
  furniture: string;
  light: string;
  pedestal: string;
  copy: string;
}

describe("living-canvas environment runtime", () => {
  it("moves only host imagery/furniture/light within catalog caps and is exact under shuffled seeks", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath, "a Chromium/Chrome/Edge executable is required").toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-environment-runtime-"));
    roots.push(dir);
    const storyboard: DirectScene[] = [
      { id: "desktop", title: "Desktop", purpose: "Desktop workspace", startSec: 0, durationSec: 6 },
      { id: "screen", title: "Screen", purpose: "Product screen", startSec: 6, durationSec: 6 },
    ];
    const plan = resolveEnvironmentPlan(storyboard, {
      compositionId: "environment-runtime",
      wallpaperId: "wallpaper-01",
      shapeByScene: {
        desktop: "desktop-stage",
        screen: "screen-over-wallpaper",
      },
      directionScoreByScene: { desktop: 1, screen: 1 },
      settleWindowsByScene: {
        desktop: [{ startSec: 2, endSec: 3, amplitudeScale: 0.12 }],
      },
      readingWindowsByScene: {
        desktop: [{ startSec: 3.4, endSec: 4.2 }],
      },
    });
    stageEnvironmentAssets(dir, plan);
    let html = `<!doctype html><html><head><meta charset="UTF-8"><script src="gsap.min.js"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden}
#root{--surface:#17202d;--surface-2:#121a25;--text:#eef2f6;--accent:#72a7ff;position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;opacity:0}.copy{position:absolute;left:50%;top:50%;translate:-50% -50%;font:700 72px/1 Arial;color:#17202d;z-index:2}
</style></head><body><main id="root" data-composition-id="environment-runtime">
<section class="scene" data-scene="desktop"><h1 class="copy">Text stays still</h1></section>
<section class="scene" data-scene="screen"><h1 class="copy">Screen stays still</h1></section>
</main></body></html>`;
    html = injectEnvironmentContract(html, plan).html;
    html = injectEnvironmentKit(html);
    html = injectEnvironmentRuntimeTag(html);
    html = html.replace("</body>", `<script>
window.__timelines=window.__timelines||{};
const tl=gsap.timeline({paused:true});
tl.set('[data-scene="desktop"]',{opacity:1},0).set('[data-scene="desktop"]',{opacity:0},6);
tl.set('[data-scene="screen"]',{opacity:1},6).set('[data-scene="screen"]',{opacity:0},12);
SequencesEnvironment.compile(tl,document.querySelector('[data-composition-id]'));
window.__timelines['environment-runtime']=tl;tl.seek(0);
</script></body>`);
    fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, ENVIRONMENT_RUNTIME_FILE), environmentRuntimeSource(), "utf8");

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
        () => Array.isArray((window as unknown as { __sequencesEnvironmentBindings?: unknown }).__sequencesEnvironmentBindings),
        { timeout: 10_000 },
      );

      const seek = async (time: number, sceneId: string): Promise<EnvironmentFrame> =>
        page.evaluate(({ at, id }) => {
          const timeline = (window as unknown as {
            __timelines: Record<string, { pause: () => void; seek: (time: number, suppress?: boolean) => void }>;
          }).__timelines["environment-runtime"]!;
          timeline.pause();
          timeline.seek(at, false);
          const scene = document.querySelector<HTMLElement>(`[data-scene="${id}"]`)!;
          const environment = scene.querySelector<HTMLElement>("[data-sequences-environment]")!;
          const wallpaper = environment.querySelector<HTMLElement>("[data-env-wallpaper]");
          const furniture = environment.querySelector<HTMLElement>("[data-env-float]");
          const light = environment.querySelector<HTMLElement>("[data-env-light]");
          const pedestal = environment.querySelector<HTMLElement>(".seq-env__pedestal");
          const copy = scene.querySelector<HTMLElement>(".copy")!;
          return {
            wallpaper: wallpaper?.style.transform ?? "",
            activity: environment.style.getPropertyValue("--seq-env-activity"),
            furniture: furniture?.style.transform ?? "",
            light: `${light?.style.transform ?? ""}|${light?.style.opacity ?? ""}`,
            pedestal: pedestal ? getComputedStyle(pedestal).transform : "",
            copy: getComputedStyle(copy).transform,
          };
        }, { at: time, id: sceneId });

      const activeA = await seek(0.7, "desktop");
      const activeB = await seek(1.35, "desktop");
      const settled = await seek(2.5, "desktop");
      const readingA = await seek(3.55, "desktop");
      const readingB = await seek(4.05, "desktop");
      expect(Number(activeA.activity)).toBeCloseTo(1, 5);
      expect(Number(settled.activity)).toBeCloseTo(0.12, 5);
      expect(activeB.wallpaper).not.toBe(activeA.wallpaper);
      expect(activeB.furniture).not.toBe(activeA.furniture);
      expect(activeB.light).not.toBe(activeA.light);
      // B1 shakiness endgame: the wallpaper field beneath primary copy is
      // pixel-stable through the read, while edge furniture/light keep the
      // frame alive and the copy itself never moves.
      expect(readingA.wallpaper).toBe(readingB.wallpaper);
      expect(readingA.furniture).not.toBe(readingB.furniture);
      expect(readingA.light).not.toBe(readingB.light);
      expect(readingA.copy).toBe(readingB.copy);

      const pose = /translate3d\(\s*([-\d.]+)%\s*,\s*([-\d.]+)%\s*,\s*(?:0|0px)\s*\)\s*scale\(\s*([-\d.]+)\s*\)/.exec(activeB.wallpaper);
      expect(pose).not.toBeNull();
      expect(Math.abs(Number(pose![1]))).toBeLessThanOrEqual(plan.wallpaper.motion.maxTravelPercent);
      expect(Math.abs(Number(pose![2]))).toBeLessThanOrEqual(plan.wallpaper.motion.maxTravelPercent);
      expect(Number(pose![3])).toBeGreaterThanOrEqual(1);
      expect(Number(pose![3])).toBeLessThanOrEqual(plan.wallpaper.motion.maxScale);

      const screenA = await seek(6.8, "screen");
      const screenB = await seek(7.5, "screen");
      expect(screenA.wallpaper).not.toBe(screenB.wallpaper);
      expect(screenA.light).not.toBe(screenB.light);
      expect(screenA.pedestal).toBe(screenB.pedestal);
      expect(screenA.copy).toBe(screenB.copy);

      const times = [0.4, 1.35, 2.5, 3.4, 5.1, 6.8, 7.5, 10.2];
      const ordered = new Map<number, EnvironmentFrame>();
      for (const time of times) ordered.set(time, await seek(time, time < 6 ? "desktop" : "screen"));
      for (const time of [7.5, 0.4, 10.2, 2.5, 6.8, 5.1, 1.35, 3.4]) {
        expect(await seek(time, time < 6 ? "desktop" : "screen")).toEqual(ordered.get(time));
      }
      expect(consoleErrors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 30_000);
});
