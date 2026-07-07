import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import type { DirectScene } from "../src/engine/directComposition.ts";
import {
  COMPONENT_RUNTIME_FILE,
  componentKitStyleTag,
  componentRuntimeSource,
  degradeExcessAssembles,
  resolveComponentPlan,
} from "../src/engine/componentContract.ts";
import {
  CAMERA_RUNTIME_FILE,
  cameraRuntimeSource,
} from "../src/engine/cameraContract.ts";
import {
  FX_RUNTIME_FILE,
  fxRuntimeSource,
  resolveFxPlan,
} from "../src/engine/fxContract.ts";
import { cinemaKitStyleTag } from "../src/engine/cinemaKit.ts";
import { auditKitMarkupCompleteness } from "../src/engine/kitMarkupAudit.ts";
import { topUpUnderlineMarkup } from "../src/engine/compositionRunner.ts";
import { resolveMomentContract } from "../src/engine/storyboardMoments.ts";
import { findBrowserExecutable } from "../src/engine/render.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * One scene exercising the MD3 kinetic-headline machinery in a real browser:
 * an `assemble` hero headline (seeded rectilinear scatter + echo trails +
 * lock glow), a `rise` sub-headline, an `underline` highlight (fx trim-path
 * draw), and a `pop` toast open. The assertions are the load-bearing promises:
 * the letters split, the scatter is a pure function of (beat.id, index) —
 * byte-identical across compiles and under out-of-order seek — and the word
 * settles to the authored copy at lock.
 */
function headlineFilm(): { storyboard: DirectScene[]; html: string } {
  const storyboard: DirectScene[] = [
    {
      id: "hero",
      title: "The name lands",
      purpose: "Assemble the product name, rise the tagline, underline the noun",
      startSec: 0,
      durationSec: 6,
      components: [
        { version: 1, id: "hero-copy", kind: "headline", role: "hero" },
        { version: 1, id: "sub-copy", kind: "headline" },
        { version: 1, id: "ship-toast", kind: "toast" },
      ],
      beats: [
        { version: 1, id: "name-assembles", sceneId: "hero", component: "hero-copy", kind: "type", atSec: 0.6, durationSec: 1.8, text: "SHIPFAST", style: "assemble" },
        { version: 1, id: "name-underline", sceneId: "hero", component: "hero-copy", kind: "highlight", atSec: 2.6, durationSec: 0.8, style: "underline" },
        { version: 1, id: "tag-rises", sceneId: "hero", component: "sub-copy", kind: "type", atSec: 3.2, durationSec: 1.2, text: "from shipped to shown", style: "rise" },
        { version: 1, id: "toast-pops", sceneId: "hero", component: "ship-toast", kind: "open", atSec: 4.6, durationSec: 0.6, style: "pop" },
      ],
      moments: [
        { version: 1, id: "m-name", sceneId: "hero", atSec: 2.4, title: "Product name assembles", visualState: "letters converge into SHIPFAST", change: "the name lands hard", motionIntent: "type-on", importance: "primary" },
        { version: 1, id: "m-tag", sceneId: "hero", atSec: 4.3, title: "Tagline rises in", visualState: "tagline under the name", change: "the promise reads", motionIntent: "type-on", importance: "supporting" },
        { version: 1, id: "m-toast", sceneId: "hero", atSec: 5, title: "Ship toast pops", visualState: "confirmation toast", change: "acknowledgment", motionIntent: "ui-state", importance: "supporting" },
      ],
    },
  ];
  const island = JSON.stringify(resolveComponentPlan(storyboard));
  const fxIsland = JSON.stringify(resolveFxPlan(storyboard));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080">
<title>Text FX smoke</title><script src="gsap.min.js"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script>
<script src="${COMPONENT_RUNTIME_FILE}"></script>
<script src="${FX_RUNTIME_FILE}"></script>${componentKitStyleTag()}${cinemaKitStyleTag()}<style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0a0f16}
body{color:#eef2f8;font-family:Inter,Arial,sans-serif}
#root{--surface:#141b26;--surface-2:#1a2230;--accent:#5eead4;--accent-text:#06231d;--text:#eef2f8;--muted:#94a3b8;--font-display:Inter;position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;padding:120px;display:grid;align-content:center;justify-items:start;gap:36px;opacity:0;min-width:0;min-height:0}
</style></head><body>
<main id="root" data-composition-id="text-fx-smoke" data-width="1920" data-height="1080" data-duration="6">
<section id="hero" class="scene clip grade-cold" data-scene="hero" data-start="0" data-duration="6" data-track-index="1">
<h1 class="cmp cmp-headline material-hero" data-component="headline" data-part="hero-copy" data-layout-important><span class="cmp-text" data-cmp-text>SHIPFAST</span><span class="fx-underline" data-sequences-fx="underline" data-layout-ignore aria-hidden="true" style="display:block;height:0.14em;pointer-events:none"><svg viewBox="0 0 100 4" preserveAspectRatio="none" style="display:block;width:100%;height:100%;overflow:visible"><line x1="0" y1="2" x2="100" y2="2" stroke="var(--accent,#6ea8ff)" stroke-width="3" stroke-linecap="round"/></svg></span></h1>
<h1 class="cmp cmp-headline" data-component="headline" data-part="sub-copy" style="font-size:1.4em"><span class="cmp-text" data-cmp-text>from shipped to shown</span></h1>
<div class="cmp cmp-toast material" data-component="toast" data-part="ship-toast"><span class="cmp-icon cmp-ok">✓</span><div><div class="cmp-title">Shipped</div><div class="cmp-meta">production · now</div></div></div>
</section>
</main>
<script type="application/json" id="sequences-components">${island}</script>
<script type="application/json" id="sequences-fx">${fxIsland}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#hero",{opacity:1},0).set("#hero",{opacity:0},6);
tl.fromTo("#hero .cmp-toast",{opacity:0},{opacity:1,duration:.3,ease:"none"},4.4);
SequencesComponents.compile(tl,document.querySelector("[data-composition-id]"));
SequencesFx.compile(tl,document.querySelector("[data-composition-id]"));
window.__timelines["text-fx-smoke"]=tl;tl.seek(0);
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

describe("MD3 text FX — deterministic caps (no browser)", () => {
  function assembleScene(id: string, startSec: number, kind: "headline" | "stat-card", onPrimary: boolean): DirectScene {
    return {
      id, title: id, purpose: "assemble", startSec, durationSec: 5,
      components: [{ version: 1, id: `${id}-copy`, kind }],
      beats: [{ version: 1, id: `${id}-a`, sceneId: id, component: `${id}-copy`, kind: "type", atSec: startSec + 1, durationSec: 1.5, text: "LAUNCH", style: "assemble" }],
      moments: onPrimary
        ? [{ version: 1, id: `${id}-m`, sceneId: id, atSec: startSec + 2, title: "lands", visualState: "x", change: "y", motionIntent: "type-on", importance: "primary" }]
        : [],
    };
  }

  it("keeps ONE headline assemble on a primary moment and degrades the rest to rise", () => {
    // headline scene 1 (primary) keeps assemble; headline scene 2 (primary) is
    // the second → rise; a stat-card assemble → rise (headline-only).
    const board = [
      assembleScene("s1", 0, "headline", true),
      assembleScene("s2", 5, "headline", true),
      assembleScene("s3", 10, "stat-card", true),
    ];
    const result = degradeExcessAssembles(board);
    const styleOf = (scenes: DirectScene[], id: string): string | undefined =>
      scenes.flatMap((scene) => scene.beats ?? []).find((beat) => beat.id === id)?.style;
    expect(styleOf(result.scenes, "s1-a")).toBe("assemble");
    expect(styleOf(result.scenes, "s2-a")).toBe("rise");
    expect(styleOf(result.scenes, "s3-a")).toBe("rise");
    expect(result.dropped.length).toBe(2);
  });

  it("degrades an assemble that misses a primary moment to rise", () => {
    const result = degradeExcessAssembles([assembleScene("solo", 0, "headline", false)]);
    expect(result.scenes[0]!.beats![0]!.style).toBe("rise");
  });

  it("linkedom mirror: a headline + underline scene raises no kit_markup findings", () => {
    const { html, storyboard } = headlineFilm();
    // The audit must see the pre-split DOM (the runtime splits AFTER the audit)
    // and must not require the fx-underline SVG (the top-up owns that).
    const audit = auditKitMarkupCompleteness(html, storyboard);
    expect(audit.errors).toEqual([]);
  });

  it("tops up the fx-underline SVG when the author left it out", () => {
    const scenes: DirectScene[] = [{
      id: "hero", title: "hero", purpose: "underline", startSec: 0, durationSec: 5,
      components: [{ version: 1, id: "hero-copy", kind: "headline" }],
      beats: [{ version: 1, id: "u", sceneId: "hero", component: "hero-copy", kind: "highlight", atSec: 2, style: "underline" }],
    }];
    const html = '<main data-composition-id="x"><section data-scene="hero"><h1 data-part="hero-copy"><span data-cmp-text>Ship</span></h1></section></main>';
    const before = topUpUnderlineMarkup(html, scenes);
    expect(before.repaired).toEqual(["hero-copy"]);
    expect(before.html).toContain('class="fx-underline"');
    // Idempotent: a target that already carries the SVG is left untouched.
    const after = topUpUnderlineMarkup(before.html, scenes);
    expect(after.repaired).toEqual([]);
  });

  it("WS7: an assemble moment's evidence settles at the lock, so the thumbnail is captured after the letters assemble", () => {
    // A minimal scene isolating the assemble beat (no nearer competing beat):
    // the moment binds to the assemble's component evidence, which ends at the
    // lock (0.6s → 2.4s). The thumbnail rule captures at evidence.endSec + ε —
    // so the frame shows the settled word, never a mid-assembly scatter.
    const scenes: DirectScene[] = [{
      id: "hero", title: "hero", purpose: "assemble", startSec: 0, durationSec: 6,
      components: [{ version: 1, id: "hero-copy", kind: "headline" }],
      beats: [{ version: 1, id: "name", sceneId: "hero", component: "hero-copy", kind: "type", atSec: 0.6, durationSec: 1.8, text: "SHIPFAST", style: "assemble" }],
      moments: [{ version: 1, id: "m-name", sceneId: "hero", atSec: 2.4, title: "name lands", visualState: "x", change: "y", motionIntent: "type-on", importance: "primary" }],
    }];
    const contract = resolveMomentContract("<main></main>", scenes, 6);
    const nameMoment = contract.moments.find((moment) => moment.id === "m-name");
    expect(nameMoment?.evidence?.kind).toBe("component");
    expect(nameMoment?.evidence?.endSec).toBeCloseTo(2.4, 1);
  });
});

describe("MD3 text FX browser contract (assemble / rise / underline / pop)", () => {
  it("splits letters, scatters deterministically, and settles to the authored copy", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath, "a Chromium/Chrome/Edge executable is required").toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-textfx-smoke-"));
    roots.push(dir);
    const draft = headlineFilm();
    fs.writeFileSync(path.join(dir, "index.html"), draft.html, "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, COMPONENT_RUNTIME_FILE), componentRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, FX_RUNTIME_FILE), fxRuntimeSource(), "utf8");

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

      // Read every hero-copy split letter's viewport rect at a seeked time,
      // seeking every timeline out of order first (determinism under seek).
      const letterRects = async (time: number): Promise<Array<[number, number]>> =>
        page.evaluate((at: number) => {
          const timelines = (window as unknown as {
            __timelines: Record<string, { pause: () => void; seek: (t: number, s?: boolean) => void }>;
          }).__timelines;
          for (const timeline of Object.values(timelines)) {
            timeline.pause();
            timeline.seek(at, false);
          }
          const hero = document.querySelector('[data-part="hero-copy"] [data-cmp-text]')!;
          const spans = hero.querySelectorAll(".cmp-split:not([data-sequences-fx])");
          return Array.prototype.map.call(spans, (span: Element) => {
            const r = span.getBoundingClientRect();
            return [Math.round(r.left * 100) / 100, Math.round(r.top * 100) / 100];
          }) as Array<[number, number]>;
        }, time);

      // Echo-ghost visibility discipline: the ghosts exist from compile time,
      // so BEFORE the assemble beat they must be fully invisible — on the
      // fresh forward render (the first seek this test makes) AND after
      // seeking back from beyond the flight. Without the css+t=0 pin, stray
      // duplicate letters float at rest before the reveal.
      const ghostOpacities = async (time: number): Promise<number[]> =>
        page.evaluate((at: number) => {
          const timelines = (window as unknown as {
            __timelines: Record<string, { pause: () => void; seek: (t: number, s?: boolean) => void }>;
          }).__timelines;
          for (const timeline of Object.values(timelines)) {
            timeline.pause();
            timeline.seek(at, false);
          }
          return Array.prototype.map.call(
            document.querySelectorAll('[data-sequences-fx="echo"]'),
            (ghost: Element) => Number.parseFloat(getComputedStyle(ghost).opacity),
          ) as number[];
        }, time);
      const freshPreBeat = await ghostOpacities(0.2);
      expect(freshPreBeat).toHaveLength(6); // 3 echoed letters x 2 ghosts
      expect(freshPreBeat.every((opacity) => opacity === 0)).toBe(true);
      // Mid-flight at least one ghost is actually painting the trail.
      const midFlight = await ghostOpacities(0.85);
      expect(midFlight.some((opacity) => opacity > 0.02)).toBe(true);
      // Round trip through the flight and back: still invisible pre-beat.
      await ghostOpacities(5.5);
      const revisitedPreBeat = await ghostOpacities(0.2);
      expect(revisitedPreBeat.every((opacity) => opacity === 0)).toBe(true);

      // The copy is split into one span per letter (SHIPFAST = 8).
      const midA = await letterRects(0.9);
      expect(midA.length).toBe(8);

      // Mid-assembly the letters are scattered off their resting row: at least
      // one letter is displaced from where it locks.
      const locked = await letterRects(2.5);
      const anyDisplaced = midA.some(([x, y], index) =>
        Math.abs(x - locked[index]![0]) > 1 || Math.abs(y - locked[index]![1]) > 1
      );
      expect(anyDisplaced).toBe(true);

      // Determinism under out-of-order seek: revisit 0.9s after jumping around.
      await letterRects(5.5);
      await letterRects(0.1);
      const replay = await letterRects(0.9);
      expect(replay).toEqual(midA);

      // The underline draws on: its stroke-dashoffset shrinks across the window.
      const dashAt = (time: number): Promise<number> =>
        page.evaluate((at: number) => {
          const timelines = (window as unknown as {
            __timelines: Record<string, { pause: () => void; seek: (t: number, s?: boolean) => void }>;
          }).__timelines;
          for (const timeline of Object.values(timelines)) {
            timeline.pause();
            timeline.seek(at, false);
          }
          const line = document.querySelector('[data-part="hero-copy"] .fx-underline line') as SVGElement | null;
          return line ? Number.parseFloat(getComputedStyle(line).strokeDashoffset) || 0 : -1;
        }, time);
      const dashBefore = await dashAt(2.6);
      const dashAfter = await dashAt(3.35);
      expect(dashBefore).toBeGreaterThan(0);
      expect(dashAfter).toBeLessThan(dashBefore);

      expect(consoleErrors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 45_000);

  it("reproduces byte-identical scatter across two independent compiles", async () => {
    const browserPath = findBrowserExecutable();
    expect(browserPath).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-textfx-det-"));
    roots.push(dir);
    const draft = headlineFilm();
    fs.writeFileSync(path.join(dir, "index.html"), draft.html, "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, COMPONENT_RUNTIME_FILE), componentRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, FX_RUNTIME_FILE), fxRuntimeSource(), "utf8");
    const server = await serveDir(dir);
    const puppeteer = (await import("puppeteer-core")).default;
    const browser = await puppeteer.launch({
      executablePath: browserPath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    async function captureOnce(): Promise<string> {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      await page.waitForFunction(
        () => Object.keys((window as unknown as { __timelines?: object }).__timelines ?? {}).length > 0,
        { timeout: 10_000 },
      );
      const value = await page.evaluate(() => {
        const timelines = (window as unknown as {
          __timelines: Record<string, { pause: () => void; seek: (t: number, s?: boolean) => void }>;
        }).__timelines;
        for (const timeline of Object.values(timelines)) { timeline.pause(); timeline.seek(0.9, false); }
        const hero = document.querySelector('[data-part="hero-copy"] [data-cmp-text]')!;
        const spans = hero.querySelectorAll(".cmp-split:not([data-sequences-fx])");
        return Array.prototype.map.call(spans, (s: Element) => (s as HTMLElement).style.transform).join("|");
      });
      await page.close();
      return value;
    }
    try {
      const first = await captureOnce();
      const second = await captureOnce();
      expect(first).toBe(second);
      expect(first.length).toBeGreaterThan(0);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 45_000);
});
