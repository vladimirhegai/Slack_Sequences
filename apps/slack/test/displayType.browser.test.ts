import { createRequire } from "node:module";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { launchHeadlessBrowser } from "../src/engine/browserLifecycle.ts";
import { injectDisplayTypeMoments } from "../src/engine/compositionRunner.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { findBrowserExecutable } from "../src/engine/render.ts";

function fixture(width: number, height: number): string {
  const require = createRequire(import.meta.url);
  const gsap = fs.readFileSync(require.resolve("gsap/dist/gsap.min.js"), "utf8")
    .replace(/<\/script/gi, "<\\/script");
  const scene: DirectScene = {
    id: "focus",
    title: "Focus",
    purpose: "Ghost type remains subordinate to the product subject",
    startSec: 0,
    durationSec: 3,
    displayType: {
      version: 1,
      kind: "ghost-word",
      text: "SIGN",
      atSec: 1,
      focalPart: "hero",
    },
  };
  const source = `<!doctype html><html><head><style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden}
[data-composition-id],[data-scene]{position:relative;width:1920px;height:1080px}
[data-part="hero"]{position:absolute;left:300px;top:220px;width:${width}px;height:${height}px}
</style><script>${gsap}</script></head><body>
<main data-composition-id="display"><section data-scene="focus"><div data-part="hero"></div></section></main>
<script>const tl=gsap.timeline({paused:true});window.__timelines=window.__timelines||{};window.__timelines["display"]=tl;tl.seek(1.6,false);</script>
</body></html>`;
  return injectDisplayTypeMoments(source, [scene]).html;
}

describe("focal-relative display type", () => {
  it("measures the scene focal and scales a ghost word with it", async () => {
    const executablePath = findBrowserExecutable();
    expect(executablePath, "a Chromium/Chrome/Edge executable is required").toBeTruthy();
    const browser = await launchHeadlessBrowser({
      executablePath: executablePath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox"],
    });
    try {
      const measure = async (width: number, height: number) => {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
        await page.setContent(fixture(width, height), { waitUntil: "load" });
        const result = await page.$eval(
          "[data-sequences-display-type]",
          (element): { fontPx: number; opacity: number } => {
            const style = getComputedStyle(element as HTMLElement);
            return { fontPx: Number.parseFloat(style.fontSize), opacity: Number(style.opacity) };
          },
        );
        await page.close();
        expect(errors).toEqual([]);
        return result;
      };

      const compact = await measure(180, 60);
      const hero = await measure(900, 600);
      expect(compact.fontPx).toBeLessThanOrEqual(48);
      expect(hero.fontPx).toBeGreaterThan(150);
      expect(hero.fontPx).toBeGreaterThan(compact.fontPx * 3);
      expect(hero.opacity).toBeCloseTo(0.065, 3);
    } finally {
      await browser.close();
    }
  });
});
