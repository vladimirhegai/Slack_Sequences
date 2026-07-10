import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { launchHeadlessBrowser } from "../src/engine/browserLifecycle.ts";
import {
  COMPONENT_RUNTIME_FILE,
  componentRuntimeSource,
} from "../src/engine/componentContract.ts";
import { findBrowserExecutable } from "../src/engine/render.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function serveDir(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
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
        "content-type": path.extname(file) === ".js"
          ? "text/javascript; charset=utf-8"
          : "text/html; charset=utf-8",
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

interface MorphState {
  sourceOpacity: number;
  sourceTransform: string;
  sourceWidth: number;
  targetOpacity: number;
  bridgeOpacity: number;
  bridgeVisibility: string;
  bridgeLeft: number;
  bridgeWidth: number;
  bridgeContentOpacity: number;
  sourceBindings: number;
  targetBindings: number;
}

describe("component morph bridge browser contract", () => {
  it("morphs the material shell without stretching live source content", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath, "a Chromium/Chrome/Edge executable is required").toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-component-morph-"));
    roots.push(dir);
    const plan = {
      version: 1,
      scenes: [{
        sceneId: "morph",
        beats: [{
          id: "search-to-palette",
          kind: "morph",
          component: "search",
          morphTo: "palette",
          startSec: 1,
          endSec: 2.4,
          ease: "power2.inOut",
        }],
      }],
    };
    const html = `<!doctype html><html><head><meta charset="UTF-8">
<script src="gsap.min.js"></script><script src="${COMPONENT_RUNTIME_FILE}"></script>
<style>*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0b0f16;color:#eef2f8}
#root,.scene{position:absolute;inset:0}.source,.target{position:absolute;border:1px solid #4c5d74;box-shadow:0 18px 50px rgba(0,0,0,.25)}
.source{left:200px;top:430px;width:320px;height:72px;border-radius:36px;background:#182231;padding:20px 28px;font:600 24px Arial}
.target{left:900px;top:250px;width:720px;height:440px;border-radius:18px;background:#222b39;padding:36px;font:600 24px Arial}
.row{height:70px;margin-top:18px;padding:20px;border-radius:10px;background:#303b4b}</style></head><body>
<main id="root" data-composition-id="morph-smoke" data-width="1920" data-height="1080" data-duration="3.5">
<section class="scene" data-scene="morph"><div class="source" data-part="search" data-component="search"><span>Deploy checkout</span></div>
<div class="target" data-part="palette" data-component="command-palette"><strong>Deploy checkout</strong><div class="row">Deploy production</div><div class="row">View release notes</div></div></section></main>
<script type="application/json" id="sequences-components">${JSON.stringify(plan)}</script>
<script>window.__timelines={};const tl=gsap.timeline({paused:true});SequencesComponents.compile(tl,document.getElementById("root"));window.__timelines["morph-smoke"]=tl;tl.seek(0);</script>
</body></html>`;
    fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, COMPONENT_RUNTIME_FILE), componentRuntimeSource(), "utf8");

    const server = await serveDir(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: browserPath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      await page.waitForFunction(() => Boolean((window as unknown as { __timelines?: object }).__timelines));
      const capture = (time: number): Promise<MorphState> => page.evaluate((at: number) => {
        const timeline = (window as unknown as {
          __timelines: Record<string, { pause: () => void; seek: (t: number, s?: boolean) => void }>;
        }).__timelines["morph-smoke"]!;
        timeline.pause();
        timeline.seek(at, false);
        const source = document.querySelector<HTMLElement>(".source")!;
        const target = document.querySelector<HTMLElement>(".target")!;
        const bridge = document.querySelector<HTMLElement>(".seq-component-morph-bridge")!;
        const content = bridge.querySelector<HTMLElement>(".seq-component-morph-content")!;
        return {
          sourceOpacity: Number(getComputedStyle(source).opacity),
          sourceTransform: source.style.transform,
          sourceWidth: source.getBoundingClientRect().width,
          targetOpacity: Number(getComputedStyle(target).opacity),
          bridgeOpacity: Number(getComputedStyle(bridge).opacity),
          bridgeVisibility: getComputedStyle(bridge).visibility,
          bridgeLeft: bridge.getBoundingClientRect().left,
          bridgeWidth: bridge.getBoundingClientRect().width,
          bridgeContentOpacity: Number(getComputedStyle(content).opacity),
          sourceBindings: document.querySelectorAll('[data-part="search"]').length,
          targetBindings: document.querySelectorAll('[data-part="palette"]').length,
        };
      }, time);

      const before = await capture(0.5);
      expect(before.sourceOpacity).toBe(1);
      expect(before.targetOpacity).toBe(0);
      expect(before.bridgeVisibility).toBe("hidden");

      const middle = await capture(1.6);
      expect(middle.sourceOpacity).toBe(0);
      expect(middle.sourceTransform).not.toMatch(/scale/i);
      expect(middle.sourceWidth).toBeCloseTo(320, 0);
      expect(middle.bridgeOpacity).toBe(1);
      expect(middle.bridgeLeft).toBeGreaterThan(200);
      expect(middle.bridgeLeft).toBeLessThan(900);
      expect(middle.bridgeWidth).toBeGreaterThan(320);
      expect(middle.bridgeWidth).toBeLessThan(720);
      expect(middle.bridgeContentOpacity).toBeLessThan(0.05);

      const after = await capture(2.6);
      expect(after.sourceOpacity).toBe(0);
      expect(after.targetOpacity).toBe(1);
      expect(after.bridgeOpacity).toBe(0);
      expect(after.sourceBindings).toBe(1);
      expect(after.targetBindings).toBe(1);

      await capture(3.2);
      const replay = await capture(1.6);
      expect(replay).toEqual(middle);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 30_000);
});
