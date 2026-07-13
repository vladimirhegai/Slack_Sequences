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
import { stripDeadGsapTweens } from "../src/engine/deadTweenRepair.ts";
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
        reject(new Error("could not bind progress-selector test server"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/index.html`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

interface ProgressState {
  width: number;
  opacity: number;
  transform: string;
}

describe("dead tween stripping + component progress browser contract", () => {
  it("keeps a live loading-fill selector and the host progress beat visibly advances", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath, "a Chromium/Chrome/Edge executable is required").toBeTruthy();
    const plan = {
      version: 1,
      scenes: [{
        sceneId: "signing",
        beats: [{
          id: "contract-loads",
          kind: "progress",
          component: "sign-contract",
          value: 1,
          startSec: 1,
          endSec: 2,
          ease: "power2.out",
        }],
      }],
    };
    const liveSelector = '[data-part="sign-contract"] [data-cmp-fill]';
    const source = `<!doctype html><html><head><meta charset="UTF-8">
<script src="gsap.min.js"></script><script src="${COMPONENT_RUNTIME_FILE}"></script>
<style>
*{box-sizing:border-box}html,body{margin:0;width:1280px;height:720px;background:#101722}
#root,.scene{position:absolute;inset:0}.scene{display:grid;place-items:center}
.cmp-progress{position:relative;width:720px;height:34px;overflow:hidden;border-radius:999px;background:#28364a}
.cmp-progress [data-cmp-fill]{position:absolute;inset:0;background:#66e3b4;transform-origin:left center}
</style></head><body>
<main id="root" data-composition-id="progress-strip" data-width="1280" data-height="720" data-duration="3">
<section class="scene" data-scene="signing" data-start="0" data-duration="3">
<div class="cmp-progress" data-component="progress" data-part="sign-contract">
<i data-cmp-fill></i>
</div></section></main>
<script type="application/json" id="sequences-components">${JSON.stringify(plan)}</script>
<script>
window.__timelines={};const tl=gsap.timeline({paused:true});
tl.set(${JSON.stringify(liveSelector)},{opacity:1},0);
tl.to("#missing-progress-ghost",{opacity:1,duration:.2},.2);
SequencesComponents.compile(tl,document.getElementById("root"));
window.__timelines["progress-strip"]=tl;tl.seek(0);
</script></body></html>`;

    // The negative control proves the deterministic pass actually inspected
    // this script. The loading fill is present in the final parsed DOM, so its
    // selector must survive byte-for-byte while the genuinely dead call goes.
    const stripped = stripDeadGsapTweens(source);
    expect(stripped.repairs).toBe(1);
    expect(stripped.removed).toBe(1);
    expect(stripped.selectors).toEqual(["#missing-progress-ghost"]);
    expect(stripped.html).toContain(`tl.set(${JSON.stringify(liveSelector)}`);
    expect(stripped.html).not.toContain("#missing-progress-ghost");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-progress-strip-"));
    roots.push(dir);
    fs.writeFileSync(path.join(dir, "index.html"), stripped.html, "utf8");
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
      await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
          errors.push(message.text());
        }
      });
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      await page.waitForFunction(
        () => Boolean((window as unknown as { __timelines?: object }).__timelines),
        { timeout: 10_000 },
      );
      const capture = (time: number): Promise<ProgressState> => page.evaluate((at: number) => {
        const timeline = (window as unknown as {
          __timelines: Record<string, { pause: () => void; seek: (t: number, suppress?: boolean) => void }>;
        }).__timelines["progress-strip"]!;
        timeline.pause();
        timeline.seek(at, false);
        const fill = document.querySelector<HTMLElement>(
          '[data-part="sign-contract"] [data-cmp-fill]',
        )!;
        return {
          width: fill.getBoundingClientRect().width,
          opacity: Number(getComputedStyle(fill).opacity),
          transform: getComputedStyle(fill).transform,
        };
      }, time);

      const before = await capture(0.8);
      const middle = await capture(1.5);
      const after = await capture(2.1);
      const replay = await capture(1.5);
      expect(before.width).toBeLessThan(1);
      expect(middle.width).toBeGreaterThan(300);
      expect(middle.width).toBeLessThan(700);
      expect(after.width).toBeCloseTo(720, 1);
      expect(replay.width).toBeCloseTo(middle.width, 3);
      expect(before.opacity).toBe(1);
      expect(middle.transform).not.toBe("none");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 30_000);
});
