import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import type { DirectScene } from "../src/engine/directComposition.ts";
import {
  TIME_RUNTIME_FILE,
  resolveTimeRampPlan,
  timeRampRuntimeSource,
  validateTimeRampContract,
  warpOf,
} from "../src/engine/timeRamp.ts";
import { findBrowserExecutable } from "../src/engine/render.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Two scenes; scene two carries a speed-ramp dip across an authored tween.
 * The wrapper's two hard promises: (1) the registered master genuinely warps
 * time — seeking output time t renders the content timeline at warp(t), and
 * (2) every value is a pure function of master position — a shuffled frame
 * sequence across the ramp reproduces byte-identical transforms.
 */
function rampFilm(): { storyboard: DirectScene[]; html: string } {
  const storyboard: DirectScene[] = [
    { id: "open", title: "Open", purpose: "start", startSec: 0, durationSec: 3 },
    {
      id: "payoff",
      title: "Payoff",
      purpose: "resolve",
      startSec: 3,
      durationSec: 7,
      timeRamp: { version: 1, atSec: 4.5, slowTo: 0.3, holdSec: 0.7, recoverSec: 1.0 },
    },
  ];
  const island = JSON.stringify(resolveTimeRampPlan(storyboard));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<title>Time ramp smoke</title><script src="gsap.min.js"></script>
<script src="${TIME_RUNTIME_FILE}"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0a0f16}
#root{position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;opacity:0}
.card{position:absolute;left:200px;top:400px;width:400px;height:200px;border-radius:24px;background:#5eead4}
</style></head><body>
<main id="root" data-composition-id="ramp-smoke" data-width="1920" data-height="1080" data-duration="10">
<section id="open" class="scene" data-scene="open" data-start="0" data-duration="3"></section>
<section id="payoff" class="scene" data-scene="payoff" data-start="3" data-duration="7">
<div class="card" id="mover"></div>
</section>
</main>
<script type="application/json" id="sequences-time">${island}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#open",{opacity:1},0).set("#open",{opacity:0},3);
tl.set("#payoff",{opacity:1},3).set("#payoff",{opacity:0},10);
tl.fromTo("#mover",{x:0},{x:1000,duration:5,ease:"none"},3.5);
var __seqWarped = SequencesTime.wrap(tl); window.__timelines["ramp-smoke"] = __seqWarped;
tl.seek(0);
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

describe("time-warp browser contract (speed ramping)", () => {
  it("warps time through the master and stays deterministic under out-of-order seek", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath, "a Chromium/Chrome/Edge executable is required").toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-ramp-smoke-"));
    roots.push(dir);
    const draft = rampFilm();
    expect(validateTimeRampContract(draft.html, draft.storyboard).errors).toEqual([]);
    fs.writeFileSync(path.join(dir, "index.html"), draft.html, "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, TIME_RUNTIME_FILE), timeRampRuntimeSource(), "utf8");

    const plan = resolveTimeRampPlan(draft.storyboard);
    const warp = warpOf(plan);
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

      const seekMaster = async (time: number): Promise<string> =>
        page.evaluate((at: number) => {
          const timelines = (window as unknown as {
            __timelines: Record<string, { pause: () => void; seek: (t: number, s?: boolean) => void }>;
          }).__timelines;
          for (const timeline of Object.values(timelines)) {
            timeline.pause();
            timeline.seek(at, false);
          }
          return document.querySelector<HTMLElement>("#mover")!.style.transform;
        }, time);
      const seekChild = async (time: number): Promise<string> =>
        page.evaluate((at: number) => {
          const timelines = (window as unknown as {
            __timelines: Record<string, { __seqChild: { pause: () => void; seek: (t: number, s?: boolean) => void } }>;
          }).__timelines;
          for (const timeline of Object.values(timelines)) {
            timeline.__seqChild.pause();
            timeline.__seqChild.seek(at, false);
          }
          return document.querySelector<HTMLElement>("#mover")!.style.transform;
        }, time);

      // The master genuinely warps: at an output time deep in the dip, the
      // rendered state equals the child sought directly at warp(t) — and
      // warp(t) meaningfully differs from t.
      const holdMid = 4.5 + 0.18 + 0.35;
      expect(Math.abs(warp(holdMid) - holdMid)).toBeGreaterThan(0.2);
      const warped = await seekMaster(holdMid);
      const reference = await seekChild(warp(holdMid));
      expect(warped).toBe(reference);
      expect(warped).not.toBe(await seekChild(holdMid));

      // Determinism: a shuffled frame sequence across the ramp reproduces
      // byte-identical transforms versus in-order seeks.
      const times = [3.6, 4.7, 5.0, 5.6, 6.4, 7.2, 9.0];
      const inOrder = new Map<number, string>();
      for (const time of times) inOrder.set(time, await seekMaster(time));
      const shuffled = [7.2, 3.6, 9.0, 5.0, 6.4, 4.7, 5.6];
      for (const time of shuffled) {
        expect(await seekMaster(time), `t=${time}`).toBe(inOrder.get(time)!);
      }
      expect(consoleErrors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 45_000);
});
