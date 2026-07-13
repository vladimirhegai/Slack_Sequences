import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { launchHeadlessBrowser } from "../src/engine/browserLifecycle.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import {
  COMPONENT_RUNTIME_FILE,
  componentKitStyleTag,
  componentRuntimeSource,
  resolveComponentPlan,
} from "../src/engine/componentContract.ts";
import { CAMERA_RUNTIME_FILE, cameraRuntimeSource } from "../src/engine/cameraContract.ts";
import { findBrowserExecutable } from "../src/engine/render.ts";

/**
 * Nav/list single-active (probe-audit-01 T4): when a list item becomes active,
 * the runtime must clear the active state on its siblings — a select beat AND a
 * cursor-driven activation. Both are seek-safe: a backward seek restores the
 * authored default-active item.
 */

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

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

/** Run a component film in a real browser and hand back a `read(at)` helper that
 * seeks the paused timeline and returns the `data-active` state of every item. */
async function withActiveStates(
  dir: string,
  html: string,
  run: (
    read: (at: number) => Promise<string[]>,
    consoleErrors: string[],
  ) => Promise<void>,
): Promise<void> {
  const browserPath = findBrowserExecutable();
  expect(browserPath, "a Chromium/Chrome/Edge executable is required").toBeTruthy();
  fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
  const require = createRequire(import.meta.url);
  fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
  fs.writeFileSync(path.join(dir, CAMERA_RUNTIME_FILE), cameraRuntimeSource(), "utf8");
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
    const read = (at: number): Promise<string[]> =>
      page.evaluate((time: number) => {
        const timelines = (window as unknown as {
          __timelines: Record<string, { pause: () => void; seek: (t: number, s?: boolean) => void }>;
        }).__timelines;
        for (const timeline of Object.values(timelines)) {
          timeline.pause();
          timeline.seek(time, false);
        }
        return Array.from(document.querySelectorAll<HTMLElement>("[data-nav-item]")).map((item) =>
          item.getAttribute("data-active") === "true" ? "active" : "inactive",
        );
      }, at);
    await run(read, consoleErrors);
  } finally {
    await browser.close();
    await server.close();
  }
}

describe("nav single-active (probe-audit-01 T4)", () => {
  it("a select beat clears the authored default-active sibling, seek-safely", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-nav-select-"));
    roots.push(dir);
    const storyboard: DirectScene[] = [{
      id: "board",
      title: "Nav selects",
      purpose: "A tab selection clears the default-active sibling",
      startSec: 0,
      durationSec: 4,
      components: [{ version: 1, id: "nav-tabs", kind: "tabs" }],
      beats: [{ version: 1, id: "pick", sceneId: "board", component: "nav-tabs", kind: "select", atSec: 1, durationSec: 0.5, item: 2 }],
    }];
    const island = JSON.stringify(resolveComponentPlan(storyboard));
    const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><title>Nav select smoke</title>
<script src="gsap.min.js"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script>
<script src="${COMPONENT_RUNTIME_FILE}"></script>${componentKitStyleTag()}<style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0a0f16}
body{color:#eef2f8;font-family:Arial,sans-serif}
#root{position:relative;width:1920px;height:1080px}
.scene{position:absolute;inset:0;display:grid;place-items:center;opacity:0}
</style></head><body>
<main id="root" data-composition-id="nav-select" data-width="1920" data-height="1080" data-duration="4">
<section id="board" class="scene clip" data-scene="board" data-start="0" data-duration="4" data-track-index="1">
<div class="cmp cmp-tabs" data-component="tabs" data-part="nav-tabs">
<div class="cmp-item" data-nav-item data-active="true">Home</div>
<div class="cmp-item" data-nav-item>Platform</div>
<div class="cmp-item" data-nav-item>Web</div>
</div>
</section>
</main>
<script type="application/json" id="sequences-components">${island}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#board",{opacity:1},0).set("#board",{opacity:0},4);
SequencesComponents.compile(tl,document.getElementById("root"));
window.__timelines["nav-select"]=tl;tl.seek(0);
</script></body></html>`;
    await withActiveStates(dir, html, async (read, consoleErrors) => {
      // After the select settles: exactly ONE active item — the chosen one (B),
      // and the default-active "Home" is cleared.
      const after = await read(1.5);
      expect(after.filter((state) => state === "active")).toHaveLength(1);
      expect(after).toEqual(["inactive", "active", "inactive"]);
      // Backward seek restores the authored default-active Home.
      const before = await read(0.5);
      expect(before[0]).toBe("active");
      expect(before.filter((state) => state === "active")).toHaveLength(1);
      expect(consoleErrors).toEqual([]);
    });
  }, 45_000);

  it("a cursor-driven activation clears sibling nav items, seek-safely", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-nav-cursor-"));
    roots.push(dir);
    // The probe-01 sidebar shape: authored `.sidebar-item` children (not kit
    // classes), Home default-active, a cursor selects Platform. The interactions
    // runtime routes the click through SequencesComponents.activateExclusiveItem;
    // here we call it directly (the same seam) to isolate the state motion.
    const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><title>Nav cursor smoke</title>
<script src="gsap.min.js"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script>
<script src="${COMPONENT_RUNTIME_FILE}"></script>${componentKitStyleTag()}<style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0a0f16}
body{color:#eef2f8;font-family:Arial,sans-serif}
#root{position:relative;width:1920px;height:1080px}
.scene{position:absolute;inset:0;display:grid;place-items:center;opacity:0}
.sidebar-item[data-active="true"]{background:#22304a}
</style></head><body>
<main id="root" data-composition-id="nav-cursor" data-width="1920" data-height="1080" data-duration="4">
<section id="board" class="scene clip" data-scene="board" data-start="0" data-duration="4" data-track-index="1">
<nav class="cmp cmp-sidebar" data-component="sidebar" data-part="board-sidebar">
<div class="sidebar-item" data-nav-item data-active="true">Home</div>
<div class="sidebar-item" data-nav-item data-part="nav-platform">Platform</div>
<div class="sidebar-item" data-nav-item>Web</div>
</nav>
</section>
</main>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#board",{opacity:1},0).set("#board",{opacity:0},4);
var itemB=document.querySelector('[data-part="nav-platform"]');
SequencesComponents.activateExclusiveItem(tl,itemB,1.0);
window.__timelines["nav-cursor"]=tl;tl.seek(0);
</script></body></html>`;
    await withActiveStates(dir, html, async (read, consoleErrors) => {
      const after = await read(1.5);
      expect(after.filter((state) => state === "active")).toHaveLength(1);
      expect(after).toEqual(["inactive", "active", "inactive"]);
      const before = await read(0.5);
      expect(before[0]).toBe("active");
      expect(before.filter((state) => state === "active")).toHaveLength(1);
      expect(consoleErrors).toEqual([]);
    });
  }, 45_000);

  it("compiles a select beat whose list contains inline SVG decorations (quillsign regression)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-nav-svg-"));
    roots.push(dir);
    // motion-quality-verify-2-quillsign burned a paid author attempt when a
    // decorative inline <svg> sibling reached listSiblings: SVG className is an
    // SVGAnimatedString, `.trim` threw, and the whole compile died before the
    // timeline registered. The ornament must be ignored, not crash the film.
    const storyboard: DirectScene[] = [{
      id: "board",
      title: "Nav selects around an icon",
      purpose: "A selection list with a decorative inline SVG still compiles",
      startSec: 0,
      durationSec: 4,
      components: [{ version: 1, id: "nav-tabs", kind: "tabs" }],
      beats: [{ version: 1, id: "pick", sceneId: "board", component: "nav-tabs", kind: "select", atSec: 1, durationSec: 0.5, item: 2 }],
    }];
    const island = JSON.stringify(resolveComponentPlan(storyboard));
    const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><title>Nav select with SVG sibling</title>
<script src="gsap.min.js"></script>
<script src="${CAMERA_RUNTIME_FILE}"></script>
<script src="${COMPONENT_RUNTIME_FILE}"></script>${componentKitStyleTag()}<style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0a0f16}
body{color:#eef2f8;font-family:Arial,sans-serif}
#root{position:relative;width:1920px;height:1080px}
.scene{position:absolute;inset:0;display:grid;place-items:center;opacity:0}
</style></head><body>
<main id="root" data-composition-id="nav-svg" data-width="1920" data-height="1080" data-duration="4">
<section id="board" class="scene clip" data-scene="board" data-start="0" data-duration="4" data-track-index="1">
<div class="cmp cmp-tabs" data-component="tabs" data-part="nav-tabs">
<svg class="tab-glyph" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>
<div class="cmp-item" data-nav-item data-active="true">Home</div>
<div class="cmp-item" data-nav-item>Platform</div>
<div class="cmp-item" data-nav-item>Web</div>
</div>
</section>
</main>
<script type="application/json" id="sequences-components">${island}</script>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#board",{opacity:1},0).set("#board",{opacity:0},4);
SequencesComponents.compile(tl,document.getElementById("root"));
window.__timelines["nav-svg"]=tl;tl.seek(0);
</script></body></html>`;
    await withActiveStates(dir, html, async (read, consoleErrors) => {
      const after = await read(1.5);
      expect(after.filter((state) => state === "active")).toHaveLength(1);
      expect(after).toEqual(["inactive", "active", "inactive"]);
      const before = await read(0.5);
      expect(before[0]).toBe("active");
      expect(consoleErrors).toEqual([]);
    });
  }, 45_000);
});
