import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { launchHeadlessBrowser } from "../src/engine/browserLifecycle.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { CAMERA_RUNTIME_FILE, cameraRuntimeSource } from "../src/engine/cameraContract.ts";
import { CUT_RUNTIME_FILE, cutRuntimeSource, resolveCutPlan } from "../src/engine/cutContract.ts";
import { FX_RUNTIME_FILE, fxRuntimeSource, type FxPlanV1 } from "../src/engine/fxContract.ts";
import { findBrowserExecutable } from "../src/engine/render.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * One film proving the whole MD2 substrate in a real browser: the masked
 * sweep band (pure transform+opacity, deterministic under out-of-order
 * seek), the glow pulse (returns exactly to rest), the connector trim-path
 * draw (strokeDashoffset honoring the timeline), and the echo ghosts on a
 * morph bridge flight (alive mid-flight, dead at flight end).
 */
function fxFilm(): { storyboard: DirectScene[]; html: string; fxPlan: FxPlanV1 } {
  const storyboard: DirectScene[] = [
    {
      id: "one",
      title: "Payoff",
      purpose: "The stat lands and the light answers",
      startSec: 0,
      durationSec: 4,
      cut: {
        version: 1,
        style: "morph",
        focalPartOut: "query-pill",
        focalPartIn: "status-bar",
        shapeOut: "pill",
        shapeIn: "bar",
      },
    },
    { id: "two", title: "Status", purpose: "Landing", startSec: 4, durationSec: 4 },
  ];
  const fxPlan: FxPlanV1 = {
    version: 1,
    effects: [
      { kind: "sweep", sceneId: "one", target: "proof-stat", atSec: 2, durationSec: 0.7 },
      { kind: "glow-pulse", sceneId: "one", target: "proof-stat", atSec: 1.9, durationSec: 0.9 },
      { kind: "connector", sceneId: "one", region: "metrics", atSec: 1, durationSec: 1 },
    ],
  };
  const cutIsland = JSON.stringify(resolveCutPlan(storyboard));
  const fxIsland = JSON.stringify(fxPlan);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<title>FX runtime smoke</title><script src="gsap.min.js"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script>
<script src="${CUT_RUNTIME_FILE}"></script>
<script src="${FX_RUNTIME_FILE}"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#101622}
body{color:#eef2f8;font-family:Arial,sans-serif}
#root{position:relative;width:1920px;height:1080px;overflow:hidden;--cinema-sheen:rgba(255,255,255,0.3)}
.scene{position:absolute;inset:0;padding:120px;display:grid;place-items:center;opacity:0}
.stat{position:relative;width:520px;height:280px;border-radius:24px;background:#182338;display:grid;place-items:center;font-size:64px}
.bloom{position:absolute;inset:-30%;opacity:0.5;background:radial-gradient(circle,#ffc24d33,transparent);pointer-events:none}
.pill{width:320px;height:96px;border-radius:48px;background:#5eead4;color:#06231d;display:grid;place-items:center;font-size:32px}
.bar{width:560px;height:112px;border-radius:16px;background:#38bdf8;color:#082032;display:grid;place-items:center;font-size:32px}
</style></head><body>
<main id="root" data-composition-id="fx-smoke" data-width="1920" data-height="1080" data-duration="8">
<section id="one" class="scene clip" data-scene="one" data-start="0" data-duration="4" data-track-index="1">
<div style="display:grid;gap:40px;justify-items:center">
<div class="stat" data-part="proof-stat"><span class="bloom" data-layout-ignore></span>99.99%</div>
<svg class="fx-connector" data-fx-toward="metrics" width="320" height="8" viewBox="0 0 320 8" aria-hidden="true">
<line x1="4" y1="4" x2="316" y2="4" stroke="#ffc24d" stroke-width="3"></line>
</svg>
<div class="pill" data-part="query-pill">deploy checkout</div>
</div>
</section>
<section id="two" class="scene clip" data-scene="two" data-start="4" data-duration="4" data-track-index="1">
<div class="bar" data-part="status-bar">deploy checkout · live</div>
</section>
</main>
<script type="application/json" id="sequences-cuts">${cutIsland}</script>
<script type="application/json" id="sequences-fx">${fxIsland}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#one",{opacity:1},0).set("#one",{opacity:0},3.999);
tl.set("#two",{opacity:1},4).set("#two",{opacity:0},8);
SequencesCuts.compile(tl,document.getElementById("root"));
SequencesFx.compile(tl,document.getElementById("root"));
window.__timelines["fx-smoke"]=tl;tl.seek(0);
</script></body></html>`;
  return { storyboard, html, fxPlan };
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

interface FxState {
  bandTransform: string;
  bandOpacity: string;
  bloomOpacity: string;
  lineDashoffset: string;
  ghostOpacities: string[];
  ghostTransforms: string[];
}

describe("sequences-fx runtime browser contract (MD2)", () => {
  it("compiles sweep, glow, draw, and echo as pure functions of timeline time", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath, "a Chromium/Chrome/Edge executable is required").toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-fx-smoke-"));
    roots.push(dir);
    const draft = fxFilm();
    fs.writeFileSync(path.join(dir, "index.html"), draft.html, "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, CUT_RUNTIME_FILE), cutRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, FX_RUNTIME_FILE), fxRuntimeSource(), "utf8");
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

      const capture = async (time: number): Promise<FxState> =>
        page.evaluate((at: number) => {
          const timelines = (window as unknown as {
            __timelines: Record<string, { pause: () => void; seek: (t: number, s?: boolean) => void }>;
          }).__timelines;
          for (const timeline of Object.values(timelines)) {
            timeline.pause();
            timeline.seek(at, false);
          }
          const band = document.querySelector<HTMLElement>(
            '[data-sequences-fx="sweep"] > span',
          )!;
          const bloom = document.querySelector<HTMLElement>(".stat .bloom")!;
          const line = document.querySelector<SVGLineElement>(".fx-connector line")!;
          const ghosts = Array.from(document.querySelectorAll<HTMLElement>(
            '[data-sequences-runtime-cut="echo"]',
          ));
          return {
            bandTransform: band.style.transform,
            bandOpacity: getComputedStyle(band).opacity,
            bloomOpacity: getComputedStyle(bloom).opacity,
            lineDashoffset: line.style.strokeDashoffset || "",
            ghostOpacities: ghosts.map((ghost) => getComputedStyle(ghost).opacity),
            ghostTransforms: ghosts.map((ghost) => ghost.style.transform),
          };
        }, time);

      // Rest state: no sweep band visible, bloom at its authored rest, the
      // connector stroke fully undrawn (dashoffset == full length).
      const rest = await capture(0.4);
      expect(Number.parseFloat(rest.bandOpacity)).toBe(0);
      expect(Number.parseFloat(rest.bloomOpacity)).toBeCloseTo(0.5, 1);
      expect(Number.parseFloat(rest.lineDashoffset)).toBeGreaterThan(300);
      // Mid-draw the connector stroke is partially revealed.
      const midDraw = await capture(1.5);
      const midOffset = Number.parseFloat(midDraw.lineDashoffset);
      expect(midOffset).toBeGreaterThan(0);
      expect(midOffset).toBeLessThan(300);
      // Draw completes at the arrival.
      const drawn = await capture(2.05);
      expect(Number.parseFloat(drawn.lineDashoffset)).toBeCloseTo(0, 1);
      // Mid-sweep: the band is visible and travelling; mid-glow: the bloom
      // swells past its rest opacity.
      const midSweep = await capture(2.35);
      expect(Number.parseFloat(midSweep.bandOpacity)).toBe(1);
      expect(midSweep.bandTransform).toContain("translate");
      expect(Number.parseFloat(midSweep.bloomOpacity)).toBeGreaterThan(0.55);
      // After the pulse the bloom is EXACTLY back at rest, the band hidden.
      const settled = await capture(3.2);
      expect(Number.parseFloat(settled.bloomOpacity)).toBeCloseTo(0.5, 2);
      expect(Number.parseFloat(settled.bandOpacity)).toBe(0);
      // Echo ghosts: alive with decaying opacities mid morph flight
      // (boundary at 4.0), trailing the bridge, dead at flight end.
      const midFlight = await capture(4.0);
      expect(midFlight.ghostOpacities.map(Number)).toEqual([0.35, 0.18]);
      expect(midFlight.ghostTransforms[0]).not.toBe(midFlight.ghostTransforms[1]);
      const flightDone = await capture(4.7);
      expect(flightDone.ghostOpacities.map(Number)).toEqual([0, 0]);
      // Determinism: replaying the same instants after seeking around the
      // timeline reproduces byte-identical fx state. (Hidden echo ghosts keep
      // transform residue at opacity 0 — invisible by construction — so the
      // sweep-instant comparison covers the channels that paint there; the
      // flight-instant comparison covers the ghosts while they are driven.)
      await capture(7.9);
      await capture(0.1);
      const replaySweep = await capture(2.35);
      expect(replaySweep.bandTransform).toBe(midSweep.bandTransform);
      expect(replaySweep.bandOpacity).toBe(midSweep.bandOpacity);
      expect(replaySweep.bloomOpacity).toBe(midSweep.bloomOpacity);
      expect(replaySweep.lineDashoffset).toBe(midSweep.lineDashoffset);
      expect(replaySweep.ghostOpacities).toEqual(midSweep.ghostOpacities);
      await capture(6.5);
      const replayFlight = await capture(4.0);
      expect(replayFlight).toEqual(midFlight);
      expect(consoleErrors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 45_000);

  it("fades in the held full-frame wash, swaps the grade at cover, carries it across cuts, and restores under backward seek (MD4)", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath, "a Chromium/Chrome/Edge executable is required").toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-grade-smoke-"));
    roots.push(dir);
    const fxPlan: FxPlanV1 = {
      version: 1,
      effects: [
        { kind: "grade-shift", sceneId: "turn", toGrade: "warm", atSec: 1.6, durationSec: 0.9 },
      ],
    };
    const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<title>Grade shift smoke</title><script src="gsap.min.js"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script>
<script src="${FX_RUNTIME_FILE}"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#101622}
#root{position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;display:grid;place-items:center;opacity:0}
.grade-cold::after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 90% at 30% 12%,rgba(98,130,200,0.085) 0%,rgba(8,10,20,0.12) 78%)}
.grade-warm::after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 90% at 68% 16%,rgba(255,186,110,0.07) 0%,rgba(30,16,8,0.1) 82%)}
.grade-noir::after{content:"";position:absolute;inset:0;pointer-events:none;background:rgba(6,7,14,0.2)}
.claim{color:#eef2f8;font:800 96px Arial}
</style></head><body>
<main id="root" data-composition-id="grade-smoke" data-width="1920" data-height="1080" data-duration="6">
<section id="turn" class="scene clip grade-cold" data-scene="turn" data-start="0" data-duration="3" data-track-index="1">
<div class="claim" data-part="turn-claim">Problem becomes solution</div>
</section>
<section id="carrying" class="scene clip grade-cold" data-scene="carrying" data-start="3" data-duration="1.5" data-track-index="1">
<div class="claim" data-part="carry-claim">Still warm here</div>
</section>
<section id="regraded" class="scene clip grade-noir" data-scene="regraded" data-start="4.5" data-duration="1.5" data-track-index="1">
<div class="claim" data-part="noir-claim">Deliberate noir ending</div>
</section>
</main>
<script type="application/json" id="sequences-fx">${JSON.stringify(fxPlan)}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#turn",{opacity:1},0).set("#turn",{opacity:0},3);
tl.set("#carrying",{opacity:1},3).set("#carrying",{opacity:0},4.5);
tl.set("#regraded",{opacity:1},4.5).set("#regraded",{opacity:0},6);
SequencesFx.compile(tl,document.getElementById("root"));
window.__timelines["grade-smoke"]=tl;tl.seek(0);
</script></body></html>`;
    fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, FX_RUNTIME_FILE), fxRuntimeSource(), "utf8");
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
      interface GradeState {
        classes: string;
        carryingClasses: string;
        regradedClasses: string;
        panelClasses: string;
        panelOpacity: number;
        panelRect: { width: number; height: number };
      }
      const stateAt = async (time: number): Promise<GradeState> =>
        page.evaluate((at: number) => {
          const timelines = (window as unknown as {
            __timelines: Record<string, { pause: () => void; seek: (t: number, s?: boolean) => void }>;
          }).__timelines;
          for (const timeline of Object.values(timelines)) {
            timeline.pause();
            timeline.seek(at, false);
          }
          const panel = document.querySelector<HTMLElement>('[data-sequences-fx="grade"]')!;
          const rect = panel.getBoundingClientRect();
          return {
            classes: document.querySelector<HTMLElement>("#turn")!.className,
            carryingClasses: document.querySelector<HTMLElement>("#carrying")!.className,
            regradedClasses: document.querySelector<HTMLElement>("#regraded")!.className,
            panelClasses: panel.className,
            panelOpacity: Number.parseFloat(getComputedStyle(panel).opacity),
            panelRect: { width: rect.width, height: rect.height },
          };
        }, time);

      // Before the shift: the authored cold grade, panel hidden.
      const before = await stateAt(1.0);
      expect(before.classes).toContain("grade-cold");
      expect(before.classes).not.toContain("grade-warm");
      expect(before.panelOpacity).toBe(0);
      // Mid-shift: the wash is a full-frame FADE, never an expanding shape —
      // the panel covers the whole frame at partial opacity, wearing the
      // TARGET grade class (its ::after is the settled wash, so full opacity
      // can never overshoot the steady state), and the scene's own class has
      // NOT swapped yet.
      const fading = await stateAt(2.05);
      expect(fading.panelOpacity).toBeGreaterThan(0.05);
      expect(fading.panelOpacity).toBeLessThan(1);
      expect(fading.panelClasses).toContain("grade-warm");
      expect(fading.panelRect.width).toBe(1920);
      expect(fading.panelRect.height).toBe(1080);
      expect(fading.classes).toContain("grade-cold");
      // After cover: warm grade active, panel handed off in the same instant.
      const after = await stateAt(2.8);
      expect(after.classes).toContain("grade-warm");
      expect(after.classes).not.toContain("grade-cold");
      expect(after.panelOpacity).toBe(0);
      // Carry across the cut: the next scene still wearing the pre-shift cold
      // grade inherits the warm turn; the deliberately re-graded noir scene
      // ends the carry and keeps its authored class.
      const carried = await stateAt(3.6);
      expect(carried.carryingClasses).toContain("grade-warm");
      expect(carried.carryingClasses).not.toContain("grade-cold");
      expect(carried.regradedClasses).toContain("grade-noir");
      const ending = await stateAt(5.2);
      expect(ending.regradedClasses).toContain("grade-noir");
      expect(ending.regradedClasses).not.toContain("grade-warm");
      // THE seek-safety promise: seeking backward past the cover restores the
      // authored grades exactly — QA samples frames out of order, so a class
      // swap that sticks would tint every earlier re-sampled frame warm.
      const restored = await stateAt(1.0);
      expect(restored.classes).toContain("grade-cold");
      expect(restored.classes).not.toContain("grade-warm");
      expect(restored.carryingClasses).toContain("grade-cold");
      expect(restored.carryingClasses).not.toContain("grade-warm");
      expect(restored.panelOpacity).toBe(0);
      // And forward again lands warm deterministically.
      const replay = await stateAt(2.8);
      expect(replay.classes).toContain("grade-warm");
      expect(consoleErrors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 45_000);
});
